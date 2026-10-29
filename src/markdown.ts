import MarkdownIt, { type Token } from "markdown-it";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Highlighter } from "shiki";
import type { Heading } from "./types";
import { dirname, isExternalUrl, resolvePath } from "./paths";
import { highlightCode, prepareHighlighter } from "./highlight";

// markdown-it вызывает highlight синхронно, поэтому подсветчик готовим заранее.
let highlighter: Highlighter | null = null;

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight: (code, lang) => (highlighter && lang ? highlightCode(highlighter, code, lang.toLowerCase()) : null) ?? "",
});

function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0].toLowerCase();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export interface RenderResult {
  html: string;
  headings: Heading[];
}

/** Проставляет заголовкам id для якорей и возвращает их список для оглавления. */
function annotateHeadings(tokens: Token[]): Heading[] {
  const headings: Heading[] = [];
  const usedIds = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const text = tokens[i + 1]?.content ?? "";
    // Префикс "h-" не даёт id пересечься со свойствами DOM (DOMPurify такие вырезает).
    let id = "h-" + (slugify(text) || "section");
    const count = usedIds.get(id) ?? 0;
    usedIds.set(id, count + 1);
    if (count > 0) id += `-${count}`;
    token.attrSet("id", id);
    headings.push({ id, level: Number(token.tag.slice(1)), text, line: token.map?.[0] ?? 0 });
  }
  return headings;
}

/** Только заголовки, без отрисовки: для оглавления во время редактирования. */
export function extractHeadings(source: string): Heading[] {
  return annotateHeadings(md.parse(source, {}));
}

/** Отрисовывает markdown в безопасный HTML и собирает список заголовков. */
export async function renderMarkdown(source: string, filePath: string): Promise<RenderResult> {
  const env = {};
  const tokens = md.parse(source, env);
  const langs = tokens.filter((t) => t.type === "fence").map((t) => fenceLanguage(t.info));
  if (langs.some(Boolean)) {
    highlighter = await prepareHighlighter(langs.filter(Boolean));
  }
  const headings = annotateHeadings(tokens);
  const baseDir = dirname(filePath);

  // Картинки с относительными путями отдаём через asset-протокол Tauri.
  for (const token of tokens) {
    if (token.type !== "inline" || !token.children) continue;
    for (const child of token.children) {
      if (child.type !== "image") continue;
      const src = child.attrGet("src");
      if (typeof src === "string" && src && !isExternalUrl(src) && !src.startsWith("data:")) {
        child.attrSet("src", convertFileSrc(resolvePath(baseDir, decodeURI(src))));
      }
    }
  }

  const html = DOMPurify.sanitize(md.renderer.render(tokens, md.options, env));
  return { html, headings };
}
