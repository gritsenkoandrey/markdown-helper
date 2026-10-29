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
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Heading, TreeNode } from "./types";
import { extractHeadings, renderMarkdown, type RenderResult } from "./markdown";
import { parseFile, serializeFile, type FileFormat } from "./fileFormat";
import { basename, dirname, isExternalUrl, relativePath, resolvePath } from "./paths";
import { FileTree } from "./components/FileTree";
import { Outline } from "./components/Outline";
import { FindBar } from "./components/FindBar";
import { SearchPanel } from "./components/SearchPanel";
import { QuickOpen, type QuickOpenItem } from "./components/QuickOpen";
import { SourceEditor, type SourceEditorHandle } from "./components/SourceEditor";
import { ConfirmDialog, type DialogRequest } from "./components/ConfirmDialog";
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
  const [dialog, setDialog] = useState<(DialogRequest & { resolve: (value: string) => void }) | null>(null);

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findFocusKey, setFindFocusKey] = useState(0);
  const [findJumpKey, setFindJumpKey] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [, setHistoryVersion] = useState(0);

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
      invoke("watch_folder", { root: path }).catch((e) => console.warn("Не удалось следить за папкой:", e));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshTree = useCallback(async () => {
    const path = rootRef.current;
    if (!path) return;
    try {
      setTree(await invoke<TreeNode | null>("read_tree", { root: path }));
    } catch (e) {
      setError(String(e));
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
        if (request === requestRef.current) setError(String(e));
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
      setError(String(e));
      return false;
    }
  }, [setDirtyState]);

  /** Спрашивает про несохранённые правки. true — можно уходить с документа. */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    const doc = docRef.current;
    if (!dirtyRef.current || !doc) return true;
    const choice = await askDialog({
      title: "Несохранённые изменения",
      message: `Сохранить изменения в «${basename(doc.path)}»?`,
      buttons: [
        { label: "Отмена", value: "cancel" },
        { label: "Не сохранять", value: "discard" },
        { label: "Сохранить", value: "save", primary: true },
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

  const enterEdit = useCallback(() => {
    if (!docRef.current || modeRef.current === "edit") return;
    viewScrollRef.current = contentRef.current?.scrollTop ?? 0;
    setEditorText(textRef.current);
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
        title: "Файл изменён на диске",
        message: `«${basename(doc.path)}» изменили в другой программе, а у вас есть несохранённые правки.`,
        buttons: [
          { label: "Загрузить с диска", value: "disk" },
          { label: "Оставить мои правки", value: "mine", primary: true },
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

  // При запуске: файл из командной строки или последняя открытая папка.
  useEffect(() => {
    (async () => {
      const file = await invoke<string | null>("initial_file");
      if (file) {
        await loadFolder(dirname(file));
        await openFile(file);
        return;
      }
      const last = loadLastRoot();
      if (last) await loadFolder(last);
    })();
  }, [loadFolder, openFile]);

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

  useEffect(() => {
    const name = currentFile ? `${dirty ? "● " : ""}${basename(currentFile)} — ` : "";
    document.title = name + "MD Reader";
  }, [currentFile, dirty]);

  const quickOpenItems = useMemo<QuickOpenItem[]>(
    () => (tree && root ? collectFiles(tree).map((path) => ({ path, label: relativePath(root, path) })) : []),
    [tree, root],
  );

  const pickFolder = async () => {
    if (!(await confirmLeave())) return;
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      requestRef.current++;
      docRef.current = null;
      textRef.current = "";
      historyRef.current = { stack: [], index: -1 };
      setHistoryVersion((v) => v + 1);
      setDirtyState(false);
      switchMode("view");
      setCurrentFile(null);
      setHtml("");
      setHeadings([]);
      setFindOpen(false);
      await loadFolder(selected);
    }
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

  const history = historyRef.current;
  const editing = mode === "edit";

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="panel-header">
          <button
            className={"tab" + (sidebarMode === "files" ? " active" : "")}
            onClick={() => setSidebarMode("files")}
          >
            Файлы
          </button>
          <button
            className={"tab" + (sidebarMode === "search" ? " active" : "")}
            onClick={showSearch}
            disabled={!root}
            title="Поиск по папке (Ctrl+Shift+F)"
          >
            Поиск
          </button>
          <span className="spacer" />
          <button className="icon-button" onClick={pickFolder} title="Открыть папку">
            📂
          </button>
          {root && (
            <button className="icon-button" onClick={refreshTree} title="Обновить">
              ⟳
            </button>
          )}
        </div>

        <div className="panel-body" hidden={sidebarMode !== "files"}>
          {root && (
            <div className="root-name" title={root}>
              {basename(root)}
            </div>
          )}
          {tree ? (
            <FileTree key={root} root={tree} currentFile={currentFile} onOpen={(p) => navigateTo(p)} />
          ) : (
            <p className="muted">{root ? "В папке нет .md файлов" : "Откройте папку с markdown-файлами"}</p>
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
            title="Назад (Alt+←)"
          >
            ←
          </button>
          <button
            className="icon-button"
            onClick={() => goHistory(1)}
            disabled={history.index >= history.stack.length - 1}
            title="Вперёд (Alt+→)"
          >
            →
          </button>
          <span className="breadcrumb" title={currentFile ?? undefined}>
            {currentFile && root ? relativePath(root, currentFile) : ""}
            {dirty && <span className="dirty-mark" title="Есть несохранённые изменения"> ●</span>}
          </span>
          {dirty && (
            <button className="text-button" onClick={save} title="Сохранить (Ctrl+S)">
              Сохранить
            </button>
          )}
          {currentFile && (
            <button
              className={"text-button" + (editing ? " active" : "")}
              onClick={toggleMode}
              title="Переключить режим (Ctrl+E)"
            >
              {editing ? "Просмотр" : "Редактировать"}
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => root && setQuickOpen(true)}
            disabled={!root}
            title="Перейти к файлу (Ctrl+P)"
          >
            ⌕
          </button>
          <button
            className="icon-button"
            onClick={showFind}
            disabled={!html || editing}
            title="Найти в документе (Ctrl+F)"
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
          <SourceEditor key={editorKey} ref={editorRef} initialText={editorText} onChange={handleEditorChange} />
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
              <p>Выберите файл слева</p>
              {!root && (
                <button className="primary-button" onClick={pickFolder}>
                  Открыть папку
                </button>
              )}
              {root && (
                <p className="hints">
                  Ctrl+P — перейти к файлу · Ctrl+Shift+F — поиск по папке · Ctrl+F — поиск в документе · Ctrl+E —
                  редактирование
                </p>
              )}
            </div>
          )}
        </div>
        {editing && error && <div className="error floating">{error}</div>}
      </main>

      <aside className="outline-panel">
        <div className="panel-header">
          <span className="panel-title">Оглавление</span>
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

      {dialog && <ConfirmDialog request={dialog} onResult={closeDialog} />}
    </div>
  );
}
