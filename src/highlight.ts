import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
  return highlighterPromise;
}

function isBundled(lang: string): lang is BundledLanguage {
  return lang in bundledLanguages;
}

/** Загружает нужные языки (каждый грузится один раз) и возвращает готовый подсветчик. */
export async function prepareHighlighter(langs: string[]): Promise<Highlighter> {
  const highlighter = await getHighlighter();
  const loaded = new Set(highlighter.getLoadedLanguages());
  const missing = [...new Set(langs)].filter((lang) => isBundled(lang) && !loaded.has(lang));
  if (missing.length > 0) {
    await highlighter.loadLanguage(...(missing as BundledLanguage[]));
  }
  return highlighter;
}

/** HTML блока кода с цветами для обеих тем или null, если язык неизвестен. */
export function highlightCode(highlighter: Highlighter, code: string, lang: string): string | null {
  if (!highlighter.getLoadedLanguages().includes(lang)) return null;
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
