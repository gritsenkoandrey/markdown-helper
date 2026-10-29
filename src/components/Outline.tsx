import { useEffect, useState, type RefObject } from "react";
import type { Heading } from "../types";
import { t } from "../i18n";

interface Props {
  headings: Heading[];
  scrollRef: RefObject<HTMLElement | null>;
  /** Свой обработчик клика (в режиме редактирования). Без него прокручиваем документ. */
  onSelect?: (heading: Heading) => void;
}

const MAX_LEVEL = 4;

export function Outline({ headings, scrollRef, onSelect }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const visible = headings.filter((h) => h.level <= MAX_LEVEL);
  const minLevel = Math.min(...visible.map((h) => h.level));

  // Подсвечиваем последний заголовок, который уже прокручен до верха.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || onSelect) {
      setActiveId(null);
      return;
    }
    const update = () => {
      const top = container.getBoundingClientRect().top + 80;
      let current: string | null = visible[0]?.id ?? null;
      for (const h of visible) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= top) current = h.id;
      }
      setActiveId(current);
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [headings, scrollRef, onSelect]);

  if (visible.length === 0) {
    return <p className="muted">{t("outline.empty")}</p>;
  }

  return (
    <ul className="outline">
      {visible.map((h) => (
        <li key={h.id}>
          <button
            className={"outline-row" + (h.id === activeId ? " active" : "")}
            style={{ paddingLeft: 8 + (h.level - minLevel) * 12 }}
            onClick={() =>
              onSelect ? onSelect(h) : document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth" })
            }
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
