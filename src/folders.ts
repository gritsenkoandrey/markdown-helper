// Избранные папки. Хранятся в localStorage WebView — это удобство,
// поэтому при недоступном хранилище просто работаем с пустым списком.

const FAVORITES_KEY = "md-reader:favorites";

function normalize(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

export function containsPath(list: string[], path: string): boolean {
  return list.some((p) => samePath(p, path));
}

export function loadFavorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveFavorites(list: string[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // Не критично: список просто не запомнится.
  }
}

/** Переключает папку в избранном и возвращает новый список. */
export function toggleFavorite(list: string[], path: string): string[] {
  return containsPath(list, path) ? list.filter((p) => !samePath(p, path)) : [...list, path];
}
