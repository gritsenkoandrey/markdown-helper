import { useEffect, useState, type RefObject } from "react";
import type { Heading } from "../types";

interface Props {
  headings: Heading[];
  scrollRef: RefObject<HTMLElement | null>;
}

const MAX_LEVEL = 4;

export function Outline({ headings, scrollRef }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const visible = headings.filter((h) => h.level <= MAX_LEVEL);
  const minLevel = Math.min(...visible.map((h) => h.level));

  // Подсвечиваем последний заголовок, который уже прокручен до верха.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
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
  }, [headings, scrollRef]);

  if (visible.length === 0) {
    return <p className="muted">Нет заголовков</p>;
  }

  return (
    <ul className="outline">
      {visible.map((h) => (
        <li key={h.id}>
          <button
            className={"outline-row" + (h.id === activeId ? " active" : "")}
            style={{ paddingLeft: 8 + (h.level - minLevel) * 12 }}
            onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth" })}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
