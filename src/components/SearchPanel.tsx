import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relativePath } from "../paths";

interface SearchMatch {
  line: number;
  text: string;
}

interface SearchResult {
  path: string;
  matches: SearchMatch[];
}

interface Props {
  root: string;
  focusKey: number;
  onOpenMatch: (path: string, query: string) => void;
}

const DEBOUNCE_MS = 250;

/** Русское склонение: plural(5, ["файл", "файла", "файлов"]). */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Разбивает строку так, чтобы найденный фрагмент можно было выделить. */
function highlightParts(text: string, query: string) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

export function SearchPanel({ root, focusKey, onOpenMatch }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await invoke<SearchResult[]>("search_folder", { root, query: trimmed });
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, root]);

  const total = results.reduce((sum, r) => sum + r.matches.length, 0);
  const trimmed = query.trim();

  return (
    <div className="search-panel">
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по папке"
        spellCheck={false}
      />
      {trimmed && !searching && (
        <p className="muted">
          {total
            ? `${total} ${plural(total, ["совпадение", "совпадения", "совпадений"])} в ${results.length} ${plural(results.length, ["файле", "файлах", "файлах"])}`
            : "Ничего не найдено"}
        </p>
      )}
      <ul className="search-results">
        {results.map((result) => (
          <li key={result.path}>
            <div className="search-file" title={result.path}>
              {relativePath(root, result.path)}
            </div>
            {result.matches.map((match) => (
              <button
                key={match.line}
                className="search-match"
                onClick={() => onOpenMatch(result.path, trimmed)}
              >
                <span className="search-line">{match.line}</span>
                <span className="search-text">{highlightParts(match.text, trimmed)}</span>
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
