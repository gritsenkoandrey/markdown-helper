import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { t } from "../i18n";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  target: RefObject<HTMLElement | null>;
  /** Меняется при каждой новой отрисовке документа, чтобы пересчитать совпадения. */
  contentKey: number;
  /** Меняется, когда нужно снова поставить фокус в поле (повторный Ctrl+F). */
  focusKey: number;
  /** Меняется, когда нужно прокрутить к первому совпадению даже при том же запросе. */
  jumpKey: number;
}

const ALL = "find";
const CURRENT = "find-current";

function findRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const needle = query.toLowerCase();
  if (!needle) return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase();
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
      const range = new Range();
      range.setStart(node, i);
      range.setEnd(node, i + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function scrollToRange(range: Range) {
  range.startContainer.parentElement?.scrollIntoView({ block: "center" });
}

/** Поиск по открытому документу. Совпадения подсвечиваются через CSS Highlight API, DOM не меняется. */
export function FindBar({ query, onQueryChange, onClose, target, contentKey, focusKey, jumpKey }: Props) {
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQueryRef = useRef<string | null>(null);
  const lastJumpKeyRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  useEffect(() => {
    const root = target.current;
    const found = root ? findRanges(root, query) : [];
    setRanges(found);
    setIndex(0);
    CSS.highlights.set(ALL, new Highlight(...found));
    // При перезагрузке файла не прыгаем: прокручиваем только на новый запрос или явный переход.
    const shouldJump = lastQueryRef.current !== query || lastJumpKeyRef.current !== jumpKey;
    if (shouldJump && found.length > 0) scrollToRange(found[0]);
    lastQueryRef.current = query;
    lastJumpKeyRef.current = jumpKey;
  }, [query, contentKey, jumpKey, target]);

  useEffect(() => {
    const current = ranges[index];
    if (current) CSS.highlights.set(CURRENT, new Highlight(current));
    else CSS.highlights.delete(CURRENT);
  }, [ranges, index]);

  useEffect(
    () => () => {
      CSS.highlights.delete(ALL);
      CSS.highlights.delete(CURRENT);
    },
    [],
  );

  const step = (delta: number) => {
    if (ranges.length === 0) return;
    const next = (index + delta + ranges.length) % ranges.length;
    setIndex(next);
    scrollToRange(ranges[next]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("find.placeholder")}
        spellCheck={false}
      />
      <span className="find-count">
        {query
          ? ranges.length
            ? t("find.count", { current: index + 1, total: ranges.length })
            : t("find.none")
          : ""}
      </span>
      <button className="icon-button" onClick={() => step(-1)} title={t("find.previous")}>
        ↑
      </button>
      <button className="icon-button" onClick={() => step(1)} title={t("find.next")}>
        ↓
      </button>
      <button className="icon-button" onClick={onClose} title={t("find.close")}>
        ✕
      </button>
    </div>
  );
}
