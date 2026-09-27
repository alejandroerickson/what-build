import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api.ts";
import { Button } from "./button.tsx";
import { Glyph, type GlyphName } from "./glyph.tsx";

/**
 * Status tones. Each is a mark plus a word, never colour alone:
 * positive (filled dot), attention (ring), negative (diamond), progress (turning ring), neutral (faint ring).
 * lib/status.ts maps every domain status to one of these.
 */
export type StatusTone = "positive" | "attention" | "negative" | "progress" | "neutral";

export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-mark" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A small bordered label for a category: a kind, a role, a tag. Not a status. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

/** A compact link (or static label) to a related thing, e.g. "I-1" or "3 insights". */
export function Chip({ to, icon, children, title }: { to?: string; icon?: GlyphName; children: ReactNode; title?: string }) {
  const body = (
    <>
      {icon ? <Glyph name={icon} size="sm" /> : null}
      <span className="ellipsis">{children}</span>
    </>
  );
  return to ? (
    <Link to={to} className="chip" title={title}>
      {body}
    </Link>
  ) : (
    <span className="chip" title={title}>
      {body}
    </span>
  );
}

export type CalloutTone = "info" | "attention" | "negative" | "positive";
const CALLOUT_GLYPH: Record<CalloutTone, GlyphName> = { info: "info", attention: "triangle-alert", negative: "circle-alert", positive: "circle-check" };

/**
 * A notice. On the canvas it floats like a small panel; inside a sheet or the inspector pass
 * `inset` so it becomes a quiet fill instead.
 */
export function Callout({ tone = "info", title, children, action, inset }: { tone?: CalloutTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; inset?: boolean }) {
  return (
    <div className={`callout callout-${tone}${inset ? " callout-inset" : ""}`} role={tone === "negative" ? "alert" : undefined}>
      <Glyph name={CALLOUT_GLYPH[tone]} className="callout-icon" />
      <div className="callout-body">
        {title ? <div className="callout-title">{title}</div> : null}
        {children ? <div className="callout-text">{children}</div> : null}
      </div>
      {action ? <div className="callout-action">{action}</div> : null}
    </div>
  );
}

/**
 * An error, worded for the person. Two server answers get their own wording:
 * 409 stale_etag (someone else changed it; the person's input is kept, reload and apply again) and
 * 409 quota_exceeded (a limit was reached; the message says which).
 */
export function ErrorCallout({ error, onRetry, title, inset, retryLabel }: { error: unknown; onRetry?: () => void; title?: string; inset?: boolean; retryLabel?: string }) {
  const api = error instanceof ApiError ? error : null;
  const msg = api ? api.message : error instanceof Error ? error.message : String(error);
  if (api?.code === "stale_etag")
    return (
      <Callout
        tone="attention"
        inset={inset}
        title={title ?? "This changed while you were working"}
        action={onRetry ? <Button size="sm" onClick={onRetry}>{retryLabel ?? "Load their version"}</Button> : undefined}
      >
        Someone else saved a newer version. Your input is still here; load their version, check what changed, then save again.
      </Callout>
    );
  if (api?.code === "quota_exceeded")
    return (
      <Callout tone="attention" inset={inset} title={title ?? "A limit was reached"}>
        {msg} An admin of the organization can tell you what the limit is for.
      </Callout>
    );
  return (
    <Callout tone="negative" inset={inset} title={title ?? "That did not work"} action={onRetry ? <Button size="sm" onClick={onRetry}>{retryLabel ?? "Try again"}</Button> : undefined}>
      {msg}
    </Callout>
  );
}

/**
 * What a place looks like with nothing in it: one sentence and, when there is one, the next step.
 * `block` stands alone on the canvas; `inline` sits inside a sheet, a panel or the inspector.
 */
export function EmptyState({ title, children, action, size = "block" }: { title?: ReactNode; children?: ReactNode; action?: ReactNode; size?: "block" | "inline" }) {
  return (
    <div className={`empty empty-${size}`}>
      {title ? <p className="empty-title">{title}</p> : null}
      {children ? <div className="empty-text">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** Skeleton rows that appear only when loading takes long enough to notice (250ms). */
export function Loading({ label = "Loading…", lines = 3, variant = "rows" }: { label?: string; lines?: number; variant?: "rows" | "lines" }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`loading loading-${variant}`} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {show
        ? Array.from({ length: lines }, (_, i) =>
            variant === "rows" ? (
              <div key={i} className="skeleton-row" aria-hidden="true">
                <span className="skeleton" style={{ width: 28 }} />
                <span className="skeleton-stack">
                  <span className="skeleton" style={{ width: `${72 - i * 11}%` }} />
                  <span className="skeleton skeleton-thin" style={{ width: `${48 - i * 7}%` }} />
                </span>
              </div>
            ) : (
              <span key={i} className="skeleton" aria-hidden="true" style={{ width: `${90 - i * 17}%` }} />
            ),
          )
        : null}
    </div>
  );
}
