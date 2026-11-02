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

/** A toast with no timer: it says something still true and offers what to do about it, and stays until that is done, it is closed, or its screen goes. */
export interface StandingToast {
  message: string;
  action: { label: string; onClick: () => void };
  onClose: () => void;
}
const StandingContext = createContext<(toast: StandingToast | null) => void>(() => {});

const EXIT_MS = 160;

/**
 * Short confirmations at the bottom of the window, at most three. A toast leaves after 5s (8s when
 * it carries an action such as Undo); hovering or focusing the toasts pauses every timer, so the
 * action stays reachable for as long as someone is on it. A screen may also hold one standing toast
 * above them (`useStandingToast`).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [standing, setStanding] = useState<StandingToast | null>(null);
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
      <StandingContext.Provider value={setStanding}>{children}</StandingContext.Provider>
      <div className="toasts" role="status" aria-live="polite" onPointerEnter={pause} onPointerLeave={resume} onFocus={pause} onBlur={resume}>
        {standing ? (
          <div className="toast toast-neutral" data-state="open">
            <span className="toast-text">{standing.message}</span>
            <button type="button" className="toast-action" onClick={standing.action.onClick}>
              {standing.action.label}
            </button>
            <button type="button" className="toast-close" aria-label="Close" onClick={standing.onClose}>
              <Glyph name="x" size="sm" />
            </button>
          </div>
        ) : null}
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

/** Holds a standing toast on the screen for as long as this is given one, and takes it away after. */
export function useStandingToast(toast: StandingToast | null) {
  const set = useContext(StandingContext);
  const latest = useRef(toast);
  latest.current = toast;
  const message = toast?.message;
  const label = toast?.action.label;
  useEffect(() => {
    if (message === undefined || label === undefined) return;
    set({ message, action: { label, onClick: () => latest.current?.action.onClick() }, onClose: () => latest.current?.onClose() });
    return () => set(null);
  }, [message, label, set]);
}
