import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean } | "separator";

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const MARGIN = 8;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Не даём меню вылезти за край окна.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={position}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={"context-menu-item" + (item.danger ? " danger" : "")}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
