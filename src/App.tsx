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
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Heading, TreeNode } from "./types";
import { renderMarkdown } from "./markdown";
import { basename, dirname, isExternalUrl, relativePath, resolvePath } from "./paths";
import { FileTree } from "./components/FileTree";
import { Outline } from "./components/Outline";
import { FindBar } from "./components/FindBar";
import { SearchPanel } from "./components/SearchPanel";
import { QuickOpen, type QuickOpenItem } from "./components/QuickOpen";
import "./App.css";

const LAST_ROOT_KEY = "md-reader:lastRoot";

type SidebarMode = "files" | "search";

interface OpenOptions {
  /** Якорь заголовка (без префикса "h-"), к которому прокрутить. */
  anchor?: string;
  /** Перезагрузка того же файла: сохранить позицию прокрутки и не писать в историю. */
  keepScroll?: boolean;
  /** Переход кнопками назад/вперёд: не писать в историю. */
  fromHistory?: boolean;
  /** Открыть поиск по документу с этим запросом (переход из поиска по папке). */
  find?: string;
}

type PendingScroll = { kind: "top" } | { kind: "anchor"; id: string } | { kind: "keep"; top: number };

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
  const rootRef = useRef<string | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const pendingScrollRef = useRef<PendingScroll>({ kind: "top" });
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });

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

  const openFile = useCallback(
    async (path: string, options: OpenOptions = {}) => {
      // Если пользователь успел открыть другой файл, устаревший результат отбрасываем.
      const request = ++requestRef.current;
      try {
        const source = await invoke<string>("read_file", { path });
        const result = await renderMarkdown(source, path);
        if (request !== requestRef.current) return;

        if (!options.fromHistory && !options.keepScroll) pushHistory(path);
        pendingScrollRef.current = options.keepScroll
          ? { kind: "keep", top: contentRef.current?.scrollTop ?? 0 }
          : options.anchor
            ? { kind: "anchor", id: "h-" + options.anchor }
            : { kind: "top" };

        currentFileRef.current = path;
        setCurrentFile(path);
        setHtml(result.html);
        setHeadings(result.headings);
        setError(null);
        setRenderId((n) => n + 1);

        if (options.find !== undefined) {
          setFindQuery(options.find);
          setFindOpen(true);
          setFindJumpKey((k) => k + 1);
        }
      } catch (e) {
        if (request === requestRef.current) setError(String(e));
      }
    },
    [pushHistory],
  );

  const goHistory = useCallback(
    (delta: number) => {
      const history = historyRef.current;
      const index = history.index + delta;
      if (index < 0 || index >= history.stack.length) return;
      history.index = index;
      setHistoryVersion((v) => v + 1);
      openFile(history.stack[index], { fromHistory: true });
    },
    [openFile],
  );

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
      const current = currentFileRef.current?.toLowerCase();
      if (current && event.payload.some((p) => p.toLowerCase() === current)) {
        openFile(currentFileRef.current!, { keepScroll: true });
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [openFile, refreshTree]);

  // Горячие клавиши и боковые кнопки мыши.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && key === "p") {
        e.preventDefault();
        if (rootRef.current) setQuickOpen(true);
      } else if (e.ctrlKey && e.shiftKey && key === "f") {
        e.preventDefault();
        if (rootRef.current) {
          setSidebarMode("search");
          setSearchFocusKey((k) => k + 1);
        }
      } else if (e.ctrlKey && !e.shiftKey && key === "f") {
        e.preventDefault();
        if (currentFileRef.current) {
          setFindOpen(true);
          setFindFocusKey((k) => k + 1);
        }
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goHistory(-1);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goHistory(1);
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
  }, [goHistory]);

  useEffect(() => {
    document.title = currentFile ? `${basename(currentFile)} — MD Reader` : "MD Reader";
  }, [currentFile]);

  const quickOpenItems = useMemo<QuickOpenItem[]>(
    () => (tree && root ? collectFiles(tree).map((path) => ({ path, label: relativePath(root, path) })) : []),
    [tree, root],
  );

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      requestRef.current++;
      currentFileRef.current = null;
      historyRef.current = { stack: [], index: -1 };
      setHistoryVersion((v) => v + 1);
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
        openFile(target, { anchor: anchor && decodeURIComponent(anchor) });
      }
    }
  };

  const history = historyRef.current;

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
            <FileTree key={root} root={tree} currentFile={currentFile} onOpen={(p) => openFile(p)} />
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
              onOpenMatch={(path, query) => openFile(path, { find: query })}
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
          </span>
          <button className="icon-button" onClick={() => root && setQuickOpen(true)} disabled={!root} title="Перейти к файлу (Ctrl+P)">
            ⌕
          </button>
          <button className="icon-button" onClick={showFind} disabled={!html} title="Найти в документе (Ctrl+F)">
            🔍
          </button>
        </div>

        {findOpen && html && (
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

        <div className="content" ref={contentRef}>
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
                  Ctrl+P — перейти к файлу · Ctrl+Shift+F — поиск по папке · Ctrl+F — поиск в документе
                </p>
              )}
            </div>
          )}
        </div>
      </main>

      <aside className="outline-panel">
        <div className="panel-header">
          <span className="panel-title">Оглавление</span>
        </div>
        <div className="panel-body">{html && <Outline headings={headings} scrollRef={contentRef} />}</div>
      </aside>

      {quickOpen && (
        <QuickOpen
          items={quickOpenItems}
          onOpen={(path) => {
            setQuickOpen(false);
            openFile(path);
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
}
