import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../i18n";

interface Props {
  /** Какую панель тянем: левая расширяется вправо, правая — влево. */
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
}

const KEYBOARD_STEP = 16;

/** Полоска на краю боковой панели: тянуть мышью, стрелками с клавиатуры, двойной клик — ширина по умолчанию. */
export function Resizer({ side, width, min, max, onResize, onReset }: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));
  const direction = side === "left" ? 1 : -1;

  const endDrag = () => {
    dragRef.current = null;
    document.body.classList.remove("resizing");
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
    // Пока тянем, курсор не меняется над редактором и текст не выделяется.
    document.body.classList.add("resizing");
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onResize(clamp(drag.startWidth + (e.clientX - drag.startX) * direction));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = (e.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP) * direction;
    onResize(clamp(width + delta));
  };

  return (
    <div
      className={`resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={t("resizer.title")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
