import { useEffect, useRef } from "react";

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
}

export interface DialogRequest {
  title: string;
  message: string;
  buttons: DialogButton[];
  /** Что вернуть при Esc или клике мимо окна. */
  cancelValue: string;
}

interface Props {
  request: DialogRequest;
  onResult: (value: string) => void;
}

export function ConfirmDialog({ request, onResult }: Props) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onResult(request.cancelValue);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [request, onResult]);

  return (
    <div className="overlay" onMouseDown={() => onResult(request.cancelValue)}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{request.title}</h2>
        <p>{request.message}</p>
        <div className="dialog-buttons">
          {request.buttons.map((button) => (
            <button
              key={button.value}
              ref={button.primary ? primaryRef : undefined}
              className={button.primary ? "primary-button" : "secondary-button"}
              onClick={() => onResult(button.value)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
