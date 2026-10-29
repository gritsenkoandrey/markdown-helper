// Простые операции с путями Windows без Node-модуля path.

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return path.slice(i + 1);
}

export function isAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** Склеивает базовую папку и относительный путь, раскрывая "." и "..". */
export function resolvePath(baseDir: string, relative: string): string {
  if (isAbsolute(relative)) return relative.replace(/\//g, "\\");
  const parts = baseDir.split(/[\\/]/);
  for (const part of relative.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("\\");
}

/** Внешняя ссылка (http, mailto и т.п.), а не путь к файлу. */
export function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-zA-Z]:[\\/]/.test(url);
}
