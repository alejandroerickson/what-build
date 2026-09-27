import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Glyph } from "./glyph.tsx";
import { prefersReducedMotion } from "./media.ts";

export type ToastTone = "neutral" | "negative";

interface Toast {
  id: number;
  message: ReactNode;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
  leaving?: boolean;
}

type Push = (message: ReactNode, opts?: { tone?: ToastTone; action?: Toast["action"] }) => void;
const ToastContext = createContext<Push>(() => {});

const EXIT_MS = 160;

/**
 * Short confirmations at the bottom of the window, at most three. A toast leaves after 5s (8s when
 * it carries an action such as Undo); hovering or focusing the toasts pauses every timer, so the
 * action stays reachable for as long as someone is on it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, { left: number; started: number; handle?: ReturnType<typeof setTimeout> }>());
  const paused = useRef(false);

  const remove = useCallback((id: number) => {
    timers.current.delete(id);
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), prefersReducedMotion() ? 0 : EXIT_MS);
  }, []);

  const arm = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      if (!t || paused.current) return;
      t.started = Date.now();
      t.handle = setTimeout(() => remove(id), t.left);
    },
    [remove],
  );

  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    for (const t of timers.current.values()) {
      if (t.handle) clearTimeout(t.handle);
      t.left = Math.max(1500, t.left - (Date.now() - t.started));
    }
  };
  const resume = () => {
    if (!paused.current) return;
    paused.current = false;
    for (const id of timers.current.keys()) arm(id);
  };

  const push = useCallback<Push>(
    (message, opts = {}) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.filter((t) => !t.leaving).slice(-2), { id, message, tone: opts.tone ?? "neutral", action: opts.action }]);
      timers.current.set(id, { left: opts.action ? 8000 : 5000, started: Date.now() });
      arm(id);
    },
    [arm],
  );

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) if (t.handle) clearTimeout(t.handle);
    };
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite" onPointerEnter={pause} onPointerLeave={resume} onFocus={pause} onBlur={resume}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} data-state={t.leaving ? "closing" : "open"}>
            {t.tone === "negative" ? <Glyph name="circle-alert" className="toast-icon" /> : null}
            <span className="toast-text">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  remove(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" className="toast-close" aria-label="Close" onClick={() => remove(t.id)}>
              <Glyph name="x" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
