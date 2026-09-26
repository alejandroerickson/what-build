import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api.ts";
import { IconClose } from "./icons.tsx";
import "./ui.css";

// ---- Buttons ------------------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
  busyLabel?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", busy, busyLabel, children, disabled, className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
});

export function ButtonLink({ to, variant = "secondary", size = "md", children, className = "" }: { to: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`btn btn-${variant} btn-${size} ${className}`}>
      {children}
    </Link>
  );
}

// ---- Fields -------------------------------------------------------------------------------------

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

function FieldFrame({ id, label, hint, error, optional, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional ? <span className="field-optional"> (optional)</span> : null}
      </label>
      {hint ? (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
      {children}
      {error ? (
        <div className="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function TextField({ label, hint, error, optional, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} {...rest} />
    </FieldFrame>
  );
}

export function TextArea({ label, hint, error, optional, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea id={id} className="input textarea" aria-invalid={error ? true : undefined} aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} {...rest} />
    </FieldFrame>
  );
}

export function SelectField({ label, hint, error, optional, children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <select id={id} className="input select" aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
    </FieldFrame>
  );
}

// ---- Status and feedback ------------------------------------------------------------------------

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Callout({ tone = "info", title, children, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`callout callout-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <div className="grow">
        {title ? <div className="callout-title">{title}</div> : null}
        {children ? <div className="callout-body">{children}</div> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function ErrorCallout({ error, onRetry, title = "That did not work" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  return <Callout tone="danger" title={title} action={onRetry ? <Button size="sm" onClick={onRetry}>Try again</Button> : undefined}>{msg}</Callout>;
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** Skeleton lines that appear only when loading takes long enough to notice. */
export function Loading({ label = "Loading…", lines = 3 }: { label?: string; lines?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {show
        ? Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 17}%` }} />)
        : null}
    </div>
  );
}

// ---- Page structure -----------------------------------------------------------------------------

export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  return (
    <header className="page-header">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumbs" className="crumbs">
          <ol>
            {crumbs.map((c, i) => (
              <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="page-header-row">
        <div className="grow stack-sm">
          <h1>{title}</h1>
          {description ? <p className="muted">{description}</p> : null}
        </div>
        {actions ? <div className="row page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Card({ children, className = "", as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "article" | "div" | "li" }) {
  return <As className={`card ${className}`}>{children}</As>;
}

export function Tabs({ items, current, label }: { items: { id: string; label: ReactNode; to: string }[]; current: string; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((t) => (
        <Link key={t.id} to={t.to} className="tab" aria-current={t.id === current ? "page" : undefined} replace>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

// ---- Dialog -------------------------------------------------------------------------------------

/** A native modal dialog: focus is trapped and restored by the browser; Escape closes unless busy. */
export function Dialog({ open, onClose, title, children, footer, dismissable = true, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; dismissable?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClick={(e) => {
        if (dismissable && e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="row-between">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {dismissable ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          ) : null}
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </dialog>
  );
}

// ---- Toasts -------------------------------------------------------------------------------------

interface Toast {
  id: number;
  message: ReactNode;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}
const ToastContext = createContext<(message: ReactNode, opts?: { tone?: Tone; action?: Toast["action"] }) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: ReactNode, opts: { tone?: Tone; action?: Toast["action"] } = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone: opts.tone ?? "neutral", action: opts.action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.action ? 8000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span className="grow">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---- Menu (popover) -----------------------------------------------------------------------------

export function Menu({ label, trigger, children, align = "end" }: { label: string; trigger: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        (ref.current?.querySelector("[data-menu-trigger]") as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="menu-trigger" data-menu-trigger aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open ? (
        <div id={menuId} role="menu" className={`menu menu-${align}`} onKeyDown={onKeyDown} onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ onSelect, to, children, tone }: { onSelect?: () => void; to?: string; children: ReactNode; tone?: "danger" }) {
  if (to)
    return (
      <Link role="menuitem" to={to} className={`menu-item ${tone === "danger" ? "menu-item-danger" : ""}`}>
        {children}
      </Link>
    );
  return (
    <button type="button" role="menuitem" className={`menu-item ${tone === "danger" ? "menu-item-danger" : ""}`} onClick={onSelect}>
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="menu-sep" />;
}
