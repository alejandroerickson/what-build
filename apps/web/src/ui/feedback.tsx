import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useMinuteWait, type MinuteWait } from "../lib/minute.ts";
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

/** A compact link (or static label) to a related thing, e.g. "3 assumptions". */
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
        Someone else saved a newer version. Your changes are still here: load theirs, then save again.
      </Callout>
    );
  if (api?.code === "quota_exceeded")
    return (
      <Callout tone="attention" inset={inset} title={title ?? "A limit was reached"}>
        {msg.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (iso) => formatDateTime(iso))}
      </Callout>
    );
  return (
    <Callout tone="negative" inset={inset} title={title ?? "That didn’t work"} action={onRetry ? <Button size="sm" onClick={onRetry}>{retryLabel ?? "Try again"}</Button> : undefined}>
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

/**
 * Keeps focus somewhere that stays when the control holding it is about to go, a Try again above all.
 * The place takes focus only for now, so it gains no focus from a click later.
 */
export function keepFocusAt(place: HTMLElement | null | undefined): void {
  if (!place) return;
  place.tabIndex = -1;
  place.focus({ preventScroll: true });
  place.addEventListener("blur", () => place.removeAttribute("tabindex"), { once: true });
}

/** Try again, in a callout that goes when it is pressed: focus goes to what holds the callout, which outlasts it and the frame that takes its place. */
function TryAgain({ onAsk }: { onAsk: () => void }) {
  return (
    <Button
      size="sm"
      onClick={(e) => {
        keepFocusAt(e.currentTarget.closest(".callout")?.parentElement);
        onAsk();
      }}
    >
      Try again
    </Button>
  );
}

/**
 * A frame WhatBuild has stopped asking for after being refused again and again, in place of the
 * frame: the person decides. Once they ask, it loads as anything does, or says what it waits for.
 */
export function FrameStopped({ what, refusal }: { what: string; refusal: { asking: boolean; tryAgain: () => void } }) {
  if (refusal.asking) return <Loading variant="lines" lines={3} />;
  return (
    <Callout tone="attention" inset title={`${what} didn’t come back`} action={<TryAgain onAsk={refusal.tryAgain} />}>
      Your calls a minute keep running out, so WhatBuild stopped asking for it.
    </Callout>
  );
}

/**
 * A page that keeps being replaced in its frame, in place of the frame, in words that blame no one: a
 * person's own button can do this as well as a page's script. It waits and comes back by itself, and
 * past that the person decides.
 */
export function FrameReloading({ state, tryAgain }: { state: "coming" | "reloading" | "reloading-stopped"; tryAgain: () => void }) {
  if (state === "coming") return <Loading variant="lines" lines={3} label="Bringing the page back…" />;
  if (state === "reloading") return <Callout inset title="This page keeps reloading">It comes back with the next minute.</Callout>;
  return (
    <Callout tone="attention" inset title="This page keeps reloading" action={<TryAgain onAsk={tryAgain} />}>
      Each time costs one of your calls a minute, so WhatBuild stopped bringing it back.
    </Callout>
  );
}

/** What the wait for the next minute comes to, in the app's words, wherever something waits for it. */
export function MinuteWaitWords() {
  return (
    <div className="loading-minute">
      <StatusBadge tone="progress">Waiting for the next minute</StatusBadge>
      <p>You’ve used this minute’s calls. WhatBuild carries on by itself.</p>
    </div>
  );
}

/** What a screen reader hears of the wait: once, whichever places show it. */
function minuteAnnouncement(wait: MinuteWait): string {
  const said: string[] = [];
  if (wait.waiting) said.push("Waiting for the next minute. You’ve used this minute’s calls. WhatBuild carries on by itself.");
  else if (wait.frames) said.push("Bringing back what was refused, a little at a time.");
  if (wait.stopped) said.push("Part of this screen didn’t come back. Your calls a minute keep running out, so WhatBuild stopped asking. Try again asks once more.");
  if (wait.reloadingStopped) said.push("A page keeps reloading. Each time costs one of your calls a minute, so WhatBuild stopped bringing it back. Try again starts it afresh.");
  else if (wait.reloading) said.push("A page keeps reloading. It comes back with the next minute.");
  return said.join(" ");
}

/**
 * Announces the wait for the next minute and what stops because of it. A live region is heard only
 * when it changes after it is mounted, and what shows the wait comes and goes with its words, so this
 * one is mounted first and stays: with the app, and in a modal dialog, which makes the app inert.
 * Mounted while something is already waiting, it starts empty, so that too is a change.
 */
export function MinuteAnnouncer() {
  const words = minuteAnnouncement(useMinuteWait());
  const [said, setSaid] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSaid(words), 100);
    return () => clearTimeout(t);
  }, [words]);
  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-minute-announcer="">
      {said}
    </div>
  );
}

/**
 * Skeleton rows that appear only when loading takes long enough to notice (250ms). While the
 * person's calls a minute are used up, what it waits for is the next minute, and it says so; that
 * comes back by itself, so it reads as waiting and never as a failure. It is not busy then, so
 * nothing holds its words back from whoever reads on to them, and MinuteAnnouncer says them once
 * however many places are loading.
 */
export function Loading({ label = "Loading…", lines = 3, variant = "rows" }: { label?: string; lines?: number; variant?: "rows" | "lines" }) {
  const [show, setShow] = useState(false);
  const { waiting } = useMinuteWait();
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`loading loading-${variant}`} {...(waiting ? {} : { "aria-busy": "true", role: "status" })}>
      {waiting ? <MinuteWaitWords /> : <span className="visually-hidden">{label}</span>}
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
