import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Heading, TreeNode } from "./types";
import { extractHeadings, renderMarkdown, type RenderResult } from "./markdown";
import { parseFile, serializeFile, type FileFormat } from "./fileFormat";
import { basename, dirname, isExternalUrl, relativePath, resolvePath } from "./paths";
import { FileTree, type TreeActions, type TreeEdit } from "./components/FileTree";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { FavoritesList } from "./components/FavoritesList";
import { containsPath, loadFavorites, saveFavorites, toggleFavorite } from "./folders";
import { codeMirrorPhrases, formatError, getLanguage, LANGUAGES, setLanguage, t, type Lang } from "./i18n";
import { Outline } from "./components/Outline";
import { FindBar } from "./components/FindBar";
import { SearchPanel } from "./components/SearchPanel";
import { QuickOpen, type QuickOpenItem } from "./components/QuickOpen";
import { SourceEditor, type SourceEditorHandle } from "./components/SourceEditor";
import { ConfirmDialog, type DialogRequest } from "./components/ConfirmDialog";
import { Resizer } from "./components/Resizer";
import "./App.css";

const LAST_ROOT_KEY = "md-reader:lastRoot";
const OUTLINE_DEBOUNCE_MS = 300;

type SidebarMode = "files" | "search";
type ViewMode = "view" | "edit";

interface OpenOptions {
  /** Якорь заголовка (без префикса "h-"), к которому прокрутить. */
  anchor?: string;
  /** Переход кнопками назад/вперёд: не писать в историю. */
  fromHistory?: boolean;
  /** Открыть поиск по документу с этим запросом (переход из поиска по папке). */
  find?: string;
}

type PendingScroll = { kind: "top" } | { kind: "anchor"; id: string } | { kind: "keep"; top: number };

/** Открытый документ: путь, формат файла на диске и последний сохранённый текст. */
interface OpenDocument {
  path: string;
  format: FileFormat;
  savedText: string;
}

const PANELS_KEY = "md-reader:panels";
const DEFAULT_PANELS = { left: 260, right: 240 };
const PANEL_MIN = { left: 232, right: 160 };
const PANEL_MAX = { left: 560, right: 480 };
/** Сколько места всегда оставляем документу при растягивании панелей. */
const CONTENT_MIN = 320;

type PanelWidths = typeof DEFAULT_PANELS;

function loadPanelWidths(): PanelWidths {
  try {
    const value = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null");
    if (typeof value?.left === "number" && typeof value?.right === "number") return value;
  } catch {
    // Повреждённое значение — берём ширину по умолчанию.
  }
  return DEFAULT_PANELS;
}

function savePanelWidths(widths: PanelWidths) {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(widths));
  } catch {
    // Не критично: ширина просто не запомнится.
  }
}

function loadLastRoot(): string | null {
  try {
    return localStorage.getItem(LAST_ROOT_KEY);
  } catch {
    return null;
  }
}

function saveLastRoot(path: string) {
  try {
    localStorage.setItem(LAST_ROOT_KEY, path);
  } catch {
    // Не критично: просто не запомним папку.
  }
}

/** Путь равен base или лежит внутри него (без учёта регистра, как в Windows). */
function isSameOrInside(path: string, base: string): boolean {
  const p = path.toLowerCase();
  const b = base.toLowerCase().replace(/[\\/]+$/, "");
  return p === b || p.startsWith(b + "\\");
}

function collectFiles(node: TreeNode, out: string[] = []): string[] {
  for (const child of node.children) {
    if (child.is_dir) collectFiles(child, out);
    else out.push(child.path);
  }
  return out;
}

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [renderId, setRenderId] = useState(0);

  const [mode, setMode] = useState<ViewMode>("view");
  const [dirty, setDirty] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [editorCursorAtEnd, setEditorCursorAtEnd] = useState(false);
  const [dialog, setDialog] = useState<(DialogRequest & { resolve: (value: string) => void }) | null>(null);

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findFocusKey, setFindFocusKey] = useState(0);
  const [findJumpKey, setFindJumpKey] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const [treeEdit, setTreeEdit] = useState<TreeEdit | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [lang, setLang] = useState<Lang>(getLanguage);
  const [panels, setPanels] = useState<PanelWidths>(loadPanelWidths);

  const contentRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  const rootRef = useRef<string | null>(null);
  const docRef = useRef<OpenDocument | null>(null);
  /** Текущий текст документа, включая несохранённые правки. */
  const textRef = useRef("");
  const dirtyRef = useRef(false);
  const modeRef = useRef<ViewMode>("view");
  const viewScrollRef = useRef(0);
  const outlineTimerRef = useRef<number | undefined>(undefined);
  const requestRef = useRef(0);
  const pendingScrollRef = useRef<PendingScroll>({ kind: "top" });
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });

  const setDirtyState = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const switchMode = useCallback((value: ViewMode) => {
    modeRef.current = value;
    setMode(value);
  }, []);

  const askDialog = useCallback(
    (request: DialogRequest) => new Promise<string>((resolve) => setDialog({ ...request, resolve })),
    [],
  );

  /** Показывает уже отрисованный документ и запоминает, куда прокрутить. */
  const applyRender = useCallback((result: RenderResult, scroll: PendingScroll) => {
    pendingScrollRef.current = scroll;
    setHtml(result.html);
    setHeadings(result.headings);
    setRenderId((n) => n + 1);
  }, []);

  const loadFolder = useCallback(async (path: string) => {
    try {
      const result = await invoke<TreeNode | null>("read_tree", { root: path });
      rootRef.current = path;
      setRoot(path);
      setTree(result);
      setError(null);
      saveLastRoot(path);
      setTreeCollapsed(false);
      invoke("watch_folder", { root: path }).catch((e) => console.warn("watch_folder failed:", e));
    } catch (e) {
      setError(formatError(e));
    }
  }, []);

  const refreshTree = useCallback(async () => {
    const path = rootRef.current;
    if (!path) return;
    try {
      setTree(await invoke<TreeNode | null>("read_tree", { root: path }));
    } catch (e) {
      setError(formatError(e));
    }
  }, []);

  const pushHistory = useCallback((path: string) => {
    const history = historyRef.current;
    if (history.stack[history.index] === path) return;
    history.stack = [...history.stack.slice(0, history.index + 1), path];
    history.index = history.stack.length - 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  /** Загружает файл с диска и показывает его в режиме просмотра. Несохранённые правки не проверяет. */
  const openFile = useCallback(
    async (path: string, options: OpenOptions = {}) => {
      // Если пользователь успел открыть другой файл, устаревший результат отбрасываем.
      const request = ++requestRef.current;
      try {
        const parsed = parseFile(await invoke<string>("read_file", { path }));
        const result = await renderMarkdown(parsed.text, path);
        if (request !== requestRef.current) return;

        if (!options.fromHistory) pushHistory(path);
        docRef.current = { path, format: parsed.format, savedText: parsed.text };
        textRef.current = parsed.text;
        setDirtyState(false);
        switchMode("view");
        setCurrentFile(path);
        setError(null);
        applyRender(result, options.anchor ? { kind: "anchor", id: "h-" + options.anchor } : { kind: "top" });

        if (options.find !== undefined) {
          setFindQuery(options.find);
          setFindOpen(true);
          setFindJumpKey((k) => k + 1);
        }
      } catch (e) {
        if (request === requestRef.current) setError(formatError(e));
      }
    },
    [applyRender, pushHistory, setDirtyState, switchMode],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const doc = docRef.current;
    if (!doc) return false;
    const text = textRef.current;
    try {
      await invoke("write_file", { path: doc.path, content: serializeFile(text, doc.format) });
      doc.savedText = text;
      setDirtyState(textRef.current !== text);
      setError(null);
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    }
  }, [setDirtyState]);

  /** Спрашивает про несохранённые правки. true — можно уходить с документа. */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    const doc = docRef.current;
    if (!dirtyRef.current || !doc) return true;
    const choice = await askDialog({
      title: t("dialog.unsavedTitle"),
      message: t("dialog.unsavedMessage", { name: basename(doc.path) }),
      buttons: [
        { label: t("dialog.cancel"), value: "cancel" },
        { label: t("dialog.dontSave"), value: "discard" },
        { label: t("dialog.save"), value: "save", primary: true },
      ],
      cancelValue: "cancel",
    });
    if (choice === "save") return save();
    if (choice === "discard") {
      setDirtyState(false);
      return true;
    }
    return false;
  }, [askDialog, save, setDirtyState]);

  /** Переход по действию пользователя: сначала разбираемся с несохранёнными правками. */
  const navigateTo = useCallback(
    async (path: string, options: OpenOptions = {}) => {
      if (path === docRef.current?.path && modeRef.current === "view" && !options.fromHistory) {
        // Тот же файл: только прокрутка или поиск, без перечитывания с диска.
        if (options.anchor) document.getElementById("h-" + options.anchor)?.scrollIntoView();
        if (options.find !== undefined) {
          setFindQuery(options.find);
          setFindOpen(true);
          setFindJumpKey((k) => k + 1);
        }
        return;
      }
      if (await confirmLeave()) await openFile(path, options);
    },
    [confirmLeave, openFile],
  );

  const goHistory = useCallback(
    async (delta: number) => {
      const history = historyRef.current;
      const index = history.index + delta;
      if (index < 0 || index >= history.stack.length) return;
      if (!(await confirmLeave())) return;
      history.index = index;
      setHistoryVersion((v) => v + 1);
      openFile(history.stack[index], { fromHistory: true });
    },
    [confirmLeave, openFile],
  );

  const enterEdit = useCallback((cursorAtEnd = false) => {
    if (!docRef.current || modeRef.current === "edit") return;
    viewScrollRef.current = contentRef.current?.scrollTop ?? 0;
    setEditorText(textRef.current);
    setEditorCursorAtEnd(cursorAtEnd);
    setEditorKey((k) => k + 1);
    setFindOpen(false);
    switchMode("edit");
  }, [switchMode]);

  const exitEdit = useCallback(async () => {
    const doc = docRef.current;
    if (!doc || modeRef.current === "view") return;
    clearTimeout(outlineTimerRef.current);
    // Просмотр показывает текущий текст, даже если он ещё не сохранён.
    const result = await renderMarkdown(textRef.current, doc.path);
    switchMode("view");
    applyRender(result, { kind: "keep", top: viewScrollRef.current });
  }, [applyRender, switchMode]);

  const toggleMode = useCallback(() => {
    if (modeRef.current === "edit") exitEdit();
    else enterEdit();
  }, [enterEdit, exitEdit]);

  const handleEditorChange = useCallback(
    (text: string) => {
      textRef.current = text;
      const isDirty = text !== docRef.current?.savedText;
      if (isDirty !== dirtyRef.current) setDirtyState(isDirty);
      // Оглавление обновляем не на каждую букву.
      clearTimeout(outlineTimerRef.current);
      outlineTimerRef.current = window.setTimeout(() => setHeadings(extractHeadings(text)), OUTLINE_DEBOUNCE_MS);
    },
    [setDirtyState],
  );

  const jumpToHeading = useCallback((heading: Heading) => editorRef.current?.scrollToLine(heading.line), []);

  /** Открытый файл изменился на диске. */
  const reloadFromDisk = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return;
    let parsed;
    try {
      parsed = parseFile(await invoke<string>("read_file", { path: doc.path }));
    } catch {
      return; // Файл удалён или занят: оставляем то, что на экране.
    }
    // Совпадает с сохранённым — это эхо нашего же сохранения.
    if (parsed.text === doc.savedText || docRef.current !== doc) return;

    if (dirtyRef.current) {
      const choice = await askDialog({
        title: t("dialog.conflictTitle"),
        message: t("dialog.conflictMessage", { name: basename(doc.path) }),
        buttons: [
          { label: t("dialog.loadFromDisk"), value: "disk" },
          { label: t("dialog.keepMine"), value: "mine", primary: true },
        ],
        cancelValue: "mine",
      });
      if (choice !== "disk") {
        // При сохранении перезапишем версию с диска своими правками.
        doc.savedText = parsed.text;
        doc.format = parsed.format;
        setDirtyState(textRef.current !== parsed.text);
        return;
      }
    }

    doc.savedText = parsed.text;
    doc.format = parsed.format;
    textRef.current = parsed.text;
    setDirtyState(false);
    if (modeRef.current === "edit") {
      editorRef.current?.setText(parsed.text);
      setHeadings(extractHeadings(parsed.text));
    } else {
      const result = await renderMarkdown(parsed.text, doc.path);
      applyRender(result, { kind: "keep", top: contentRef.current?.scrollTop ?? 0 });
    }
  }, [applyRender, askDialog, setDirtyState]);

  /** Закрывает документ (без вопросов про правки — это делается раньше). */
  const resetDocument = useCallback(() => {
    requestRef.current++;
    docRef.current = null;
    textRef.current = "";
    setDirtyState(false);
    switchMode("view");
    setCurrentFile(null);
    setHtml("");
    setHeadings([]);
    setFindOpen(false);
  }, [setDirtyState, switchMode]);

  const resetHistory = useCallback(() => {
    historyRef.current = { stack: [], index: -1 };
    setHistoryVersion((v) => v + 1);
  }, []);

  /** Открывает путь снаружи: повторный запуск, перетаскивание в окно, аргумент при старте. */
  const openExternalPath = useCallback(
    async (path: string) => {
      const kind = await invoke<"dir" | "markdown" | "missing" | "other">("path_kind", { path });
      if (kind === "missing") {
        setError(t("error.missing", { path }));
        return;
      }
      if (kind === "other") {
        setError(t("error.notOpenable", { name: basename(path) }));
        return;
      }
      const root = rootRef.current;
      if (root && isSameOrInside(path, root)) {
        // Уже открытая папка или файл внутри неё — обычный переход.
        if (kind === "markdown") await navigateTo(path);
        else setSidebarMode("files");
        return;
      }
      if (!(await confirmLeave())) return;
      resetDocument();
      resetHistory();
      if (kind === "dir") {
        await loadFolder(path);
      } else {
        await loadFolder(dirname(path));
        await openFile(path);
      }
    },
    [confirmLeave, loadFolder, navigateTo, openFile, resetDocument, resetHistory],
  );

  /** После переименования поправляем пути открытого документа и истории. */
  const remapPaths = useCallback((oldPath: string, newPath: string) => {
    const remap = (p: string) => (isSameOrInside(p, oldPath) ? newPath + p.slice(oldPath.length) : p);
    const doc = docRef.current;
    if (doc && isSameOrInside(doc.path, oldPath)) {
      doc.path = remap(doc.path);
      setCurrentFile(doc.path);
    }
    historyRef.current.stack = historyRef.current.stack.map(remap);
    setHistoryVersion((v) => v + 1);
  }, []);

  const submitTreeEdit = useCallback(
    async (value: string): Promise<string | null> => {
      const edit = treeEdit;
      if (!edit) return null;
      try {
        if (edit.kind === "new-file") {
          const path = await invoke<string>("create_file", { dir: edit.dir, name: value });
          setTreeEdit(null);
          await refreshTree();
          if (await confirmLeave()) {
            await openFile(path);
            enterEdit(true);
          }
        } else if (edit.kind === "new-folder") {
          await invoke<string>("create_folder", { dir: edit.dir, name: value });
          setTreeEdit(null);
          await refreshTree();
        } else if (edit.kind === "rename") {
          const newPath = await invoke<string>("rename_path", { path: edit.path, newName: value });
          setTreeEdit(null);
          remapPaths(edit.path, newPath);
          await refreshTree();
        }
        return null;
      } catch (e) {
        return formatError(e);
      }
    },
    [confirmLeave, enterEdit, openFile, refreshTree, remapPaths, treeEdit],
  );

  const deleteNode = useCallback(
    async (node: TreeNode) => {
      const choice = await askDialog({
        title: t("dialog.deleteTitle"),
        message: t(node.is_dir ? "dialog.deleteFolder" : "dialog.deleteFile", { name: node.name }),
        buttons: [
          { label: t("dialog.delete"), value: "delete" },
          { label: t("dialog.cancel"), value: "cancel", primary: true },
        ],
        cancelValue: "cancel",
      });
      if (choice !== "delete") return;
      try {
        await invoke("delete_path", { path: node.path });
      } catch (e) {
        setError(formatError(e));
        return;
      }
      if (docRef.current && isSameOrInside(docRef.current.path, node.path)) resetDocument();
      const history = historyRef.current;
      history.stack = history.stack.filter((p) => !isSameOrInside(p, node.path));
      history.index = Math.min(history.index, history.stack.length - 1);
      setHistoryVersion((v) => v + 1);
      await refreshTree();
    },
    [askDialog, refreshTree, resetDocument],
  );

  const toggleFavoriteFolder = useCallback((path: string) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, path);
      saveFavorites(next);
      return next;
    });
  }, []);

  const startCreate = useCallback((kind: "new-file" | "new-folder", dir: string) => {
    setSidebarMode("files");
    setTreeCollapsed(false);
    setTreeEdit({ kind, dir });
  }, []);

  const handleTreeContextMenu = useCallback(
    (e: ReactMouseEvent, node: TreeNode | null) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const dir = node ? (node.is_dir ? node.path : null) : root;
      const items: MenuItem[] = [];
      if (dir) {
        items.push(
          { label: t("menu.newDocument"), onSelect: () => startCreate("new-file", dir) },
          { label: t("menu.newFolder"), onSelect: () => startCreate("new-folder", dir) },
          "separator",
          containsPath(favorites, dir)
            ? { label: t("menu.removeFavorite"), onSelect: () => toggleFavoriteFolder(dir) }
            : { label: t("menu.addFavorite"), onSelect: () => toggleFavoriteFolder(dir) },
        );
      }
      if (node) {
        if (items.length) items.push("separator");
        items.push(
          { label: t("menu.rename"), onSelect: () => setTreeEdit({ kind: "rename", path: node.path, name: node.name }) },
          { label: t("menu.delete"), danger: true, onSelect: () => deleteNode(node) },
        );
      }
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [deleteNode, favorites, startCreate, toggleFavoriteFolder],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Прокрутка после того, как новый документ попал в DOM.
  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const pending = pendingScrollRef.current;
    if (pending.kind === "keep") {
      container.scrollTop = pending.top;
    } else if (pending.kind === "anchor" && document.getElementById(pending.id)) {
      document.getElementById(pending.id)?.scrollIntoView();
    } else {
      container.scrollTop = 0;
    }
  }, [renderId]);

  // При запуске: путь из командной строки или последняя открытая папка.
  useEffect(() => {
    (async () => {
      const path = await invoke<string | null>("initial_path");
      if (path) {
        await openExternalPath(path);
        return;
      }
      const last = loadLastRoot();
      if (last) await loadFolder(last);
    })();
    // Только при старте.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Повторный запуск приложения (двойной клик по другому .md) присылает путь сюда.
  useEffect(() => {
    const unlisten = listen<string>("open-path", (event) => openExternalPath(event.payload));
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [openExternalPath]);

  // Перетаскивание файлов и папок из проводника в окно.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setDragging(true);
      } else if (payload.type === "leave") {
        setDragging(false);
      } else if (payload.type === "drop") {
        setDragging(false);
        if (payload.paths[0]) openExternalPath(payload.paths[0]);
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [openExternalPath]);

  // Изменения на диске: обновляем дерево и, если поменялся открытый файл, сам документ.
  useEffect(() => {
    const unlisten = listen<string[]>("fs-changed", (event) => {
      refreshTree();
      const current = docRef.current?.path.toLowerCase();
      if (current && event.payload.some((p) => p.toLowerCase() === current)) reloadFromDisk();
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [refreshTree, reloadFromDisk]);

  // Не даём закрыть окно с несохранёнными правками.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      if (await confirmLeave()) await appWindow.destroy();
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [confirmLeave]);

  // Горячие клавиши и боковые кнопки мыши.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && key === "s") {
        e.preventDefault();
        if (dirtyRef.current) save();
      } else if (e.ctrlKey && !e.shiftKey && key === "e") {
        e.preventDefault();
        toggleMode();
      } else if (e.ctrlKey && !e.shiftKey && key === "p") {
        e.preventDefault();
        if (rootRef.current) setQuickOpen(true);
      } else if (e.ctrlKey && e.shiftKey && key === "f") {
        e.preventDefault();
        if (rootRef.current) {
          setSidebarMode("search");
          setSearchFocusKey((k) => k + 1);
        }
      } else if (e.ctrlKey && !e.shiftKey && key === "f") {
        // В редакторе Ctrl+F обрабатывает сам CodeMirror.
        if (modeRef.current === "edit") return;
        e.preventDefault();
        if (docRef.current) {
          setFindOpen(true);
          setFindFocusKey((k) => k + 1);
        }
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        // В редакторе Alt+стрелки двигают курсор.
        if (modeRef.current === "edit") return;
        e.preventDefault();
        goHistory(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) goHistory(-1);
      else if (e.button === 4) goHistory(1);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [goHistory, save, toggleMode]);

  useEffect(() => savePanelWidths(panels), [panels]);

  useEffect(() => {
    const name = currentFile ? `${dirty ? "● " : ""}${basename(currentFile)} — ` : "";
    document.title = name + "MD Reader";
    // Заголовок окна в панели задач Tauri сам не обновляет.
    getCurrentWindow()
      .setTitle(document.title)
      .catch(() => {});
  }, [currentFile, dirty]);

  const quickOpenItems = useMemo<QuickOpenItem[]>(
    () => (tree && root ? collectFiles(tree).map((path) => ({ path, label: relativePath(root, path) })) : []),
    [tree, root],
  );

  const pickFolder = async () => {
    if (!(await confirmLeave())) return;
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      resetDocument();
      resetHistory();
      setTreeEdit(null);
      await loadFolder(selected);
    }
  };

  const changeLanguage = (code: Lang) => {
    setLanguage(code);
    setLang(code);
  };

  const showSearch = () => {
    setSidebarMode("search");
    setSearchFocusKey((k) => k + 1);
  };

  const showFind = () => {
    setFindOpen(true);
    setFindFocusKey((k) => k + 1);
  };

  const closeDialog = useCallback(
    (value: string) => {
      dialog?.resolve(value);
      setDialog(null);
    },
    [dialog],
  );

  // Ссылки в документе: якоря, другие .md файлы и внешние адреса.
  const handleContentClick = (e: ReactMouseEvent<HTMLElement>) => {
    const link = (e.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");
    if (!link || !href) return;
    e.preventDefault();

    if (href.startsWith("#")) {
      document.getElementById("h-" + decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
    } else if (isExternalUrl(href)) {
      openUrl(href);
    } else if (currentFile) {
      const [pathPart, anchor] = href.split("#");
      const target = resolvePath(dirname(currentFile), decodeURI(pathPart));
      if (/\.(md|markdown)$/i.test(target)) {
        navigateTo(target, { anchor: anchor && decodeURIComponent(anchor) });
      }
    }
  };

  const treeActions: TreeActions = {
    currentFile,
    edit: treeEdit,
    onOpen: (path) => navigateTo(path),
    onEditSubmit: submitTreeEdit,
    onEditCancel: () => setTreeEdit(null),
    onContextMenu: handleTreeContextMenu,
  };

  const history = historyRef.current;
  const editing = mode === "edit";

  return (
    <div
      className="layout"
      style={{
        // min(..., 40vw): при сужении окна панели не съедают документ целиком.
        gridTemplateColumns: `min(${panels.left}px, 40vw) minmax(0, 1fr) min(${panels.right}px, 40vw)`,
      }}
    >
      <aside className="sidebar">
        <Resizer
          side="left"
          width={panels.left}
          min={PANEL_MIN.left}
          max={Math.max(PANEL_MIN.left, Math.min(PANEL_MAX.left, window.innerWidth - panels.right - CONTENT_MIN))}
          onResize={(left) => setPanels((p) => ({ ...p, left }))}
          onReset={() => setPanels((p) => ({ ...p, left: DEFAULT_PANELS.left }))}
        />
        <div className="panel-header">
          <button
            className={"tab" + (sidebarMode === "files" ? " active" : "")}
            onClick={() => setSidebarMode("files")}
          >
            {t("tab.files")}
          </button>
          <button
            className={"tab" + (sidebarMode === "search" ? " active" : "")}
            onClick={showSearch}
            disabled={!root}
            title={t("tab.searchTitle")}
          >
            {t("tab.search")}
          </button>
          <span className="spacer" />
          {root && (
            <button
              className="icon-button"
              onClick={() => startCreate("new-file", root)}
              title={t("sidebar.newDocument")}
            >
              +
            </button>
          )}
          <button className="icon-button" onClick={pickFolder} title={t("sidebar.openFolder")}>
            📂
          </button>
          {root && (
            <button className="icon-button" onClick={refreshTree} title={t("sidebar.refresh")}>
              ⟳
            </button>
          )}
        </div>

        <div className="panel-body files" hidden={sidebarMode !== "files"}>
          <FavoritesList
            favorites={favorites}
            root={root}
            onOpen={openExternalPath}
            onRemove={toggleFavoriteFolder}
          />
          <div className="root-row">
            <button
              className="root-switch"
              title={root ?? undefined}
              disabled={!root}
              onClick={() => setTreeCollapsed((c) => !c)}
            >
              <span className={"chevron" + (treeCollapsed ? "" : " open")}>▸</span>
              <span className="root-switch-name">{root ? basename(root) : t("sidebar.noFolder")}</span>
            </button>
            {root && (
              <button
                className={"icon-button star" + (containsPath(favorites, root) ? " on" : "")}
                onClick={() => toggleFavoriteFolder(root)}
                title={containsPath(favorites, root) ? t("favorites.remove") : t("favorites.add")}
              >
                {containsPath(favorites, root) ? "★" : "☆"}
              </button>
            )}
          </div>
          {treeCollapsed ? null : tree ? (
            <FileTree key={root} root={tree} actions={treeActions} />
          ) : (
            <p className="muted">{root ? t("sidebar.noMarkdown") : t("sidebar.openPrompt")}</p>
          )}
        </div>

        {root && (
          <div className="panel-body" hidden={sidebarMode !== "search"}>
            <SearchPanel
              key={root}
              root={root}
              focusKey={searchFocusKey}
              onOpenMatch={(path, query) => navigateTo(path, { find: query })}
            />
          </div>
        )}
      </aside>

      <main className="main">
        <div className="toolbar">
          <button
            className="icon-button"
            onClick={() => goHistory(-1)}
            disabled={history.index <= 0}
            title={t("toolbar.back")}
          >
            ←
          </button>
          <button
            className="icon-button"
            onClick={() => goHistory(1)}
            disabled={history.index >= history.stack.length - 1}
            title={t("toolbar.forward")}
          >
            →
          </button>
          <span className="breadcrumb" title={currentFile ?? undefined}>
            {currentFile && root ? relativePath(root, currentFile) : ""}
            {dirty && <span className="dirty-mark" title={t("toolbar.unsaved")}> ●</span>}
          </span>
          {dirty && (
            <button className="text-button" onClick={save} title={t("toolbar.saveTitle")}>
              {t("toolbar.save")}
            </button>
          )}
          {currentFile && (
            <button
              className={"text-button" + (editing ? " active" : "")}
              onClick={toggleMode}
              title={t("toolbar.toggleTitle")}
            >
              {editing ? t("toolbar.view") : t("toolbar.edit")}
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => root && setQuickOpen(true)}
            disabled={!root}
            title={t("toolbar.quickOpen")}
          >
            ⌕
          </button>
          <button
            className="icon-button"
            onClick={showFind}
            disabled={!html || editing}
            title={t("toolbar.find")}
          >
            🔍
          </button>
        </div>

        {findOpen && html && !editing && (
          <FindBar
            query={findQuery}
            onQueryChange={setFindQuery}
            onClose={() => setFindOpen(false)}
            target={articleRef}
            contentKey={renderId}
            focusKey={findFocusKey}
            jumpKey={findJumpKey}
          />
        )}

        {editing && (
          <SourceEditor
            key={editorKey}
            ref={editorRef}
            initialText={editorText}
            cursorAtEnd={editorCursorAtEnd}
            phrases={codeMirrorPhrases[lang]}
            onChange={handleEditorChange}
          />
        )}

        <div className="content" ref={contentRef} hidden={editing}>
          {error && <div className="error">{error}</div>}
          {html ? (
            <article
              ref={articleRef}
              className="markdown"
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="empty">
              <p>{t("empty.selectFile")}</p>
              {!root && (
                <button className="primary-button" onClick={pickFolder}>
                  {t("empty.openFolder")}
                </button>
              )}
              {root && (
                <p className="hints">{t("empty.hints")}</p>
              )}
            </div>
          )}
        </div>
        {editing && error && <div className="error floating">{error}</div>}
      </main>

      <aside className="outline-panel">
        <Resizer
          side="right"
          width={panels.right}
          min={PANEL_MIN.right}
          max={Math.max(PANEL_MIN.right, Math.min(PANEL_MAX.right, window.innerWidth - panels.left - CONTENT_MIN))}
          onResize={(right) => setPanels((p) => ({ ...p, right }))}
          onReset={() => setPanels((p) => ({ ...p, right: DEFAULT_PANELS.right }))}
        />
        <div className="panel-header">
          <span className="panel-title">{t("outline.title")}</span>
          <div className="lang-switch" title={t("sidebar.language")}>
            {LANGUAGES.map(({ code, label }) => (
              <button
                key={code}
                className={"lang-option" + (code === lang ? " active" : "")}
                onClick={() => changeLanguage(code)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {html && (
            <Outline headings={headings} scrollRef={contentRef} onSelect={editing ? jumpToHeading : undefined} />
          )}
        </div>
      </aside>

      {quickOpen && (
        <QuickOpen
          items={quickOpenItems}
          onOpen={(path) => {
            setQuickOpen(false);
            navigateTo(path);
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>{t("drop.hint")}</div>
        </div>
      )}

      {dialog && <ConfirmDialog request={dialog} onResult={closeDialog} />}
    </div>
  );
}
