import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface QuickOpenItem {
  path: string;
  /** Путь относительно открытой папки, по нему идёт поиск. */
  label: string;
}

interface Props {
  items: QuickOpenItem[];
  onOpen: (path: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

/** Совпадают все слова запроса. Файлы, у которых совпало имя, идут выше. */
function filterItems(items: QuickOpenItem[], query: string): QuickOpenItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.slice(0, MAX_RESULTS);
  const scored = items
    .map((item) => {
      const label = item.label.toLowerCase();
      if (!words.every((w) => label.includes(w))) return null;
      const name = label.slice(Math.max(label.lastIndexOf("\\"), label.lastIndexOf("/")) + 1);
      const score = words.filter((w) => name.includes(w)).length * 100 - label.length;
      return { item, score };
    })
    .filter((x): x is { item: QuickOpenItem; score: number } => x !== null);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map((x) => x.item);
}

export function QuickOpen({ items, onOpen, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => filterItems(items, query), [items, query]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[selected];
      if (item) onOpen(item.path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="quick-open" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Перейти к файлу…"
          spellCheck={false}
        />
        <ul ref={listRef}>
          {filtered.map((item, i) => (
            <li key={item.path}>
              <button
                className={"quick-open-row" + (i === selected ? " active" : "")}
                onMouseEnter={() => setSelected(i)}
                onClick={() => onOpen(item.path)}
              >
                {item.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="muted">Ничего не найдено</li>}
        </ul>
      </div>
    </div>
  );
}
