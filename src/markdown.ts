import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Heading } from "./types";
import { dirname, isExternalUrl, resolvePath } from "./paths";

const md = new MarkdownIt({ html: true, linkify: true });

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

/** Отрисовывает markdown в безопасный HTML и собирает список заголовков. */
export function renderMarkdown(source: string, filePath: string): RenderResult {
  const env = {};
  const tokens = md.parse(source, env);
  const headings: Heading[] = [];
  const usedIds = new Map<string, number>();
  const baseDir = dirname(filePath);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const text = tokens[i + 1]?.content ?? "";
      // Префикс "h-" не даёт id пересечься со свойствами DOM (DOMPurify такие вырезает).
      let id = "h-" + (slugify(text) || "section");
      const count = usedIds.get(id) ?? 0;
      usedIds.set(id, count + 1);
      if (count > 0) id += `-${count}`;
      token.attrSet("id", id);
      headings.push({ id, level: Number(token.tag.slice(1)), text });
    }

    // Картинки с относительными путями отдаём через asset-протокол Tauri.
    if (token.type === "inline" && token.children) {
      for (const child of token.children) {
        if (child.type !== "image") continue;
        const src = child.attrGet("src");
        if (typeof src === "string" && src && !isExternalUrl(src) && !src.startsWith("data:")) {
          child.attrSet("src", convertFileSrc(resolvePath(baseDir, decodeURI(src))));
        }
      }
    }
  }

  const html = DOMPurify.sanitize(md.renderer.render(tokens, md.options, env));
  return { html, headings };
}
