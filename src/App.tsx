import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Heading, TreeNode } from "./types";
import { renderMarkdown } from "./markdown";
import { basename, dirname, isExternalUrl, resolvePath } from "./paths";
import { FileTree } from "./components/FileTree";
import { Outline } from "./components/Outline";
import "./App.css";

const LAST_ROOT_KEY = "md-reader:lastRoot";

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

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  const loadFolder = useCallback(async (path: string) => {
    try {
      const result = await invoke<TreeNode | null>("read_tree", { root: path });
      setRoot(path);
      setTree(result);
      setError(null);
      saveLastRoot(path);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const openFile = useCallback(async (path: string, anchor?: string) => {
    try {
      const source = await invoke<string>("read_file", { path });
      const result = renderMarkdown(source, path);
      setCurrentFile(path);
      setHtml(result.html);
      setHeadings(result.headings);
      setError(null);
      requestAnimationFrame(() => {
        const target = anchor ? document.getElementById("h-" + anchor) : null;
        if (target) target.scrollIntoView();
        else contentRef.current?.scrollTo(0, 0);
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

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

  useEffect(() => {
    document.title = currentFile ? `${basename(currentFile)} — MD Reader` : "MD Reader";
  }, [currentFile]);

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setCurrentFile(null);
      setHtml("");
      setHeadings([]);
      await loadFolder(selected);
    }
  };

  // Ссылки в документе: якоря, другие .md файлы и внешние адреса.
  const handleContentClick = (e: MouseEvent<HTMLElement>) => {
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
        openFile(target, anchor && decodeURIComponent(anchor));
      }
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="panel-header">
          <span className="panel-title" title={root ?? undefined}>
            {root ? basename(root) : "Нет папки"}
          </span>
          <button className="icon-button" onClick={pickFolder} title="Открыть папку">
            📂
          </button>
          {root && (
            <button className="icon-button" onClick={() => loadFolder(root)} title="Обновить">
              ⟳
            </button>
          )}
        </div>
        <div className="panel-body">
          {tree ? (
            <FileTree key={root} root={tree} currentFile={currentFile} onOpen={(p) => openFile(p)} />
          ) : (
            <p className="muted">{root ? "В папке нет .md файлов" : "Откройте папку с markdown-файлами"}</p>
          )}
        </div>
      </aside>

      <main className="content" ref={contentRef}>
        {error && <div className="error">{error}</div>}
        {html ? (
          <article className="markdown" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="empty">
            <p>Выберите файл слева</p>
            {!root && (
              <button className="primary-button" onClick={pickFolder}>
                Открыть папку
              </button>
            )}
          </div>
        )}
      </main>

      <aside className="outline-panel">
        <div className="panel-header">
          <span className="panel-title">Оглавление</span>
        </div>
        <div className="panel-body">
          {html && <Outline headings={headings} scrollRef={contentRef} />}
        </div>
      </aside>
    </div>
  );
}
