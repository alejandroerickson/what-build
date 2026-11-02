import { useQueryClient, type Query, type QueryClient, type QueryFunction } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useStandingToast } from "../ui/index.tsx";
import { ApiError } from "./api.ts";
import { minuteUsedUp } from "./minute.ts";
import { noteServerCommit, serverCommit } from "./new-release.ts";

/**
 * A tab hears when the product it is open on changes, from one stream the server keeps open, instead
 * of asking over and over (apps/server/src/live.ts). What it hears says only which part of the
 * product changed, and it then reads the rest through the same calls as any other read.
 *
 * What a screen does with that depends on what a person may be in the middle of:
 *
 * - Lists and cards (Idea, Evidence, assumptions, the Story's tree, activity) refresh by themselves
 *   (`AUTOMATIC`), and never while someone is typing, dragging or in a dialog (`refreshHeld`).
 * - A Story page and a mockup's canvas never change by themselves: a frame reloading would lose
 *   someone's place, and what they entered in a mockup. They look, and say a newer one is there with
 *   a toast that stays until they refresh or close it (`useHeldUpdate`).
 *
 * The stream costs the server an instance kept awake, so a tab holds it only while someone can be
 * using it: visible, and used in the last while. A tab that was not listening looks for what it
 * missed when it listens again. One that keeps failing to listen gives up until the page is loaded again.
 */

export const LIVE_AREAS = ["story", "idea", "evidence", "exploration", "other"] as const;
export type LiveArea = (typeof LIVE_AREAS)[number];

/** How long a tab listens after anyone last used it. */
export const IDLE_AFTER_MS = 10 * 60_000;
/** How long a tab goes on listening while it is hidden, so that looking at another window for a moment costs nothing. */
export const HIDDEN_AFTER_MS = 2 * 60_000;
/** How often a tab reads what changed, at most: these reads count toward the person's calls a minute. */
export const REFRESH_SPACING_MS = 30_000;
/** How long with nothing from the server before a stream is taken to be dead; the server speaks every 25 seconds. */
export const SILENCE_LIMIT_MS = 70_000;
/** How many streams in a row may fail, having heard nothing past their opening, before the tab stops trying. */
export const MOST_FAILURES = 6;
const LONGEST_WAIT_MS = 5 * 60_000;
const HOW_OFTEN_TO_REVIEW_MS = 30_000;
const HELD_LOOK_AGAIN_MS = 5_000;
/** The most pages of a long list refreshed: past that, it is read again when next opened. */
const MOST_PAGES_REFRESHED = 3;

/** What each part of a product changing refreshes by itself, by the first part of a query's key. Anything not here refreshes only as it always has. */
const AUTOMATIC: Record<LiveArea, readonly string[]> = {
  story: ["story-tree", "story-pages"],
  idea: ["outcomes"],
  evidence: ["sources", "source", "source-comments"],
  exploration: ["mockups", "register", "entry"],
  other: ["story-tree", "story-pages", "outcomes", "sources", "source", "source-comments", "mockups", "register", "entry"],
};

/** The areas a block of the stream names: nothing but those this app knows, and nothing for anything else it might say. */
export function areasIn(block: string): LiveArea[] {
  const lines = block.split("\n");
  if (!lines.includes("event: change")) return [];
  const data = lines.find((l) => l.startsWith("data: "));
  if (!data) return [];
  try {
    const areas = (JSON.parse(data.slice(6)) as { areas?: unknown }).areas;
    return Array.isArray(areas) ? LIVE_AREAS.filter((a) => areas.includes(a)) : [];
  } catch {
    return [];
  }
}

/** A tab's connection to the stream of one product. */
export class LiveStream {
  private controller: AbortController | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private review: ReturnType<typeof setInterval> | undefined;
  private waitUntil = 0;
  private failures = 0;
  /** The server said not to ask, or it failed too often: nothing until the page is loaded again. */
  private finished = false;
  private stopped = false;
  /** The tab stopped listening for its own reasons, so nothing is retried until someone comes back. */
  private left = false;
  /** Changes may have gone by unheard. */
  private missed = false;
  private lastUsed = Date.now();
  private hiddenAt: number | null = null;
  /** The commit the stream's server was built from. */
  private servedBy: string | null = null;

  constructor(
    private readonly url: string,
    private readonly on: { changed(areas: LiveArea[]): void; resumed(): void },
  ) {}

  start() {
    if (document.visibilityState === "hidden") this.hiddenAt = Date.now();
    for (const name of USE_EVENTS) window.addEventListener(name, this.used, { capture: true, passive: true });
    window.addEventListener("message", this.frameUsed);
    document.addEventListener("visibilitychange", this.visibility);
    this.review = setInterval(this.look, HOW_OFTEN_TO_REVIEW_MS);
    this.look();
  }

  stop() {
    this.stopped = true;
    for (const name of USE_EVENTS) window.removeEventListener(name, this.used, { capture: true });
    window.removeEventListener("message", this.frameUsed);
    document.removeEventListener("visibilitychange", this.visibility);
    clearInterval(this.review);
    clearTimeout(this.retry);
    this.controller?.abort();
  }

  private readonly used = () => {
    this.lastUsed = Date.now();
    if (!this.controller) this.look();
  };

  /** A person using a frame shows the app nothing, so the frame says so. A page in a frame can say this falsely, and gains only that a tab in view goes on listening. */
  private readonly frameUsed = (e: MessageEvent) => {
    if ((e.data as { whatbuild?: unknown } | null)?.whatbuild !== "frame-active" || !e.source || e.source === window) return;
    this.used();
  };

  private readonly visibility = () => {
    if (document.visibilityState === "hidden") this.hiddenAt = Date.now();
    else {
      this.hiddenAt = null;
      this.lastUsed = Date.now();
    }
    this.look();
  };

  private readonly look = () => {
    const now = Date.now();
    const hidden = document.visibilityState === "hidden";
    if (this.controller) {
      const mayStay = hidden ? now - (this.hiddenAt ?? now) < HIDDEN_AFTER_MS : now - this.lastUsed < IDLE_AFTER_MS;
      if (!mayStay) {
        this.left = true;
        this.controller.abort();
      }
      // A deploy leaves this stream on the old revision, which then hears of nothing and goes on being
      // billed until its streams end. Any later answer names the new one, so this one goes to it.
      else if (this.servedBy && serverCommit() && serverCommit() !== this.servedBy) this.controller.abort();
      return;
    }
    if (this.stopped || this.finished || hidden || now - this.lastUsed >= IDLE_AFTER_MS || now < this.waitUntil) return;
    void this.listen();
  };

  private wait(ms: number) {
    this.waitUntil = Date.now() + ms;
    clearTimeout(this.retry);
    // The wait is over when this says so: a timer may run a moment before the clock agrees.
    this.retry = setTimeout(() => {
      this.waitUntil = 0;
      this.look();
    }, ms);
  }

  private failed(ms?: number) {
    this.missed = true;
    this.failures += 1;
    if (this.failures >= MOST_FAILURES) this.finished = true;
    else this.wait(ms ?? Math.min(LONGEST_WAIT_MS, 5_000 * 2 ** this.failures) * (0.5 + Math.random() * 0.5));
  }

  private async listen() {
    const controller = new AbortController();
    this.controller = controller;
    this.left = false;
    let silence: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(silence);
      silence = setTimeout(() => controller.abort(), SILENCE_LIMIT_MS);
    };
    heard();
    /** Heard past the opening: the stream worked, however it ended. */
    let spoke = false;
    try {
      const res = await fetch(this.url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "text/event-stream" }, signal: controller.signal });
      this.servedBy = res.headers.get("X-WhatBuild-Commit");
      noteServerCommit(this.servedBy);
      if (res.status === 429 || res.status === 503) {
        const seconds = Number(res.headers.get("Retry-After"));
        this.failed((seconds > 0 ? seconds * 1000 : 60_000) * (1 + Math.random() * 0.25));
        return;
      }
      if (res.status >= 500) {
        this.failed();
        return;
      }
      // Off, a guest, signed out, or no longer allowed: nothing here will change by asking again.
      if (res.status !== 200 || !res.body) {
        this.finished = true;
        return;
      }
      if (this.missed) {
        this.missed = false;
        this.on.resumed();
      }
      spoke = await this.read(res.body, heard);
    } catch {
      // No connection, or it was taken away; what follows is the same.
    } finally {
      clearTimeout(silence);
      this.controller = null;
    }
    if (this.stopped) return;
    this.missed = true;
    if (this.left) return;
    if (spoke) {
      this.failures = 0;
      // Ended as streams do. A release ends them all at once, so they do not all come back at once.
      this.wait(1_000 + Math.random() * 14_000);
    } else this.failed();
  }

  /** Reads a stream until it ends, saying what it hears. Whether it heard anything past its opening. */
  private async read(body: ReadableStream<Uint8Array>, heard: () => void): Promise<boolean> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let chunks = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        heard();
        chunks += 1;
        text += decoder.decode(value, { stream: true });
        for (let end = text.indexOf("\n\n"); end >= 0; end = text.indexOf("\n\n")) {
          const areas = areasIn(text.slice(0, end));
          text = text.slice(end + 2);
          if (areas.length) this.on.changed(areas);
        }
      }
    } catch {
      // Taken away while reading.
    }
    return chunks > 1;
  }
}

const USE_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

/** The screens' forms that hold what a person started from outside a dialog. */
let holds = 0;
/** When a pointer went down and has not come up, for how long a drag may hold things still. A release over a frame is never heard, so it holds them only so long. */
let pressedAt = 0;
const LONGEST_PRESS_MS = 30_000;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => void (pressedAt = Date.now()), { capture: true, passive: true });
  for (const name of ["pointerup", "pointercancel"]) window.addEventListener(name, () => void (pressedAt = 0), { capture: true, passive: true });
}

const NOT_TYPED_IN = new Set(["search", "button", "submit", "reset", "checkbox", "radio", "file", "range", "color"]);

/**
 * Whether what is on screen must not change by itself now: someone is typing, holding something (a
 * card or a row in mid-drag), in a dialog, or on a form that holds its own start. Typing in a search
 * box is not such a moment: the list it searches is what it is for.
 */
export function refreshHeld(): boolean {
  if (holds > 0 || Date.now() - pressedAt < LONGEST_PRESS_MS || document.visibilityState === "hidden") return true;
  if (document.querySelector("dialog[open]")) return true;
  const a = document.activeElement;
  if (!(a instanceof HTMLElement)) return false;
  if (a.isContentEditable || a.tagName === "TEXTAREA" || a.tagName === "SELECT") return true;
  return a.tagName === "INPUT" && !NOT_TYPED_IN.has((a as HTMLInputElement).type);
}

/**
 * For a form outside a dialog that saves over what it opened (naming its etag): nothing refreshes by
 * itself while it is on screen. The etag it names comes from what it read, and a refresh beneath it
 * would move that etag on past a change the person has not seen, and their save would overwrite it unseen.
 */
export function useHoldRefresh() {
  useEffect(() => {
    holds += 1;
    return () => {
      holds -= 1;
    };
  }, []);
}

/**
 * Reads a query again without its failing changing anything: a screen that shows an error for a failed
 * read would otherwise lose someone's place to a blip they did not ask about.
 */
async function readQuietly(qc: QueryClient, query: Query) {
  const fn = query.options.queryFn;
  if (typeof fn !== "function") return;
  try {
    const data = await (fn as QueryFunction)({ client: qc, queryKey: query.queryKey, signal: new AbortController().signal, meta: query.meta } as never);
    qc.setQueryData(query.queryKey, data);
  } catch {
    // The next change, or the person, reads it again.
  }
}

/** Refreshes what these areas changing refreshes by itself, and only that, for this product. */
export function refreshAutomatically(qc: QueryClient, product: { api: string; path: string }, areas: readonly LiveArea[]) {
  const names = new Set(["activity", ...areas.flatMap((a) => AUTOMATIC[a])]);
  const ours = (q: Query) => (q.queryKey[0] === "product" ? q.queryKey[1] === product.path : names.has(String(q.queryKey[0])) && q.queryKey[1] === product.api);
  for (const query of qc.getQueryCache().findAll({ predicate: ours })) {
    const pages = (query.state.data as { pages?: unknown[] } | undefined)?.pages;
    // A long list keeps its place in a page it has read: reading every page again costs a call for each.
    if (!query.isActive() || (pages && pages.length > MOST_PAGES_REFRESHED)) void qc.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: "none" });
    else if (pages) void qc.invalidateQueries({ queryKey: query.queryKey, exact: true });
    else void readQuietly(qc, query);
  }
}

type Listener = (areas: readonly LiveArea[]) => void;
const LiveContext = createContext<(listener: Listener) => () => void>(() => () => undefined);

/** Listens for changes to the product on screen, for everything inside it. A guest of the example organization does not listen. */
export function LiveUpdates({ api, path, guest, children }: { api: string; path: string; guest: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  useEffect(() => {
    if (guest) return;
    const pending = new Set<LiveArea>();
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = undefined;
      // Waiting for the next minute's calls, reads would only be refused.
      if (refreshHeld() || minuteUsedUp()) {
        timer = setTimeout(run, HELD_LOOK_AGAIN_MS);
        return;
      }
      const areas = [...pending];
      pending.clear();
      last = Date.now();
      refreshAutomatically(qc, { api, path }, areas);
      for (const l of listeners.current) l(areas);
    };
    const note = (areas: readonly LiveArea[]) => {
      for (const a of areas) pending.add(a);
      timer ??= setTimeout(run, Math.max(0, last + REFRESH_SPACING_MS - Date.now()));
    };
    const stream = new LiveStream(`${api}/live`, { changed: note, resumed: () => note(LIVE_AREAS) });
    stream.start();
    return () => {
      stream.stop();
      clearTimeout(timer);
    };
  }, [api, path, guest, qc]);
  const subscribe = useRef((listener: Listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  });
  return <LiveContext.Provider value={subscribe.current}>{children}</LiveContext.Provider>;
}

/** What `peek` answers for something that is no longer there. */
const GONE = "gone";

/**
 * For a screen that must not change by itself. `shown` says what is on screen, as a string that
 * changes when it does. When `area` changes the screen looks again with `peek`, which reads the same
 * thing and changes nothing, and if that differs a toast stays until the person refreshes or closes
 * it; closed, it comes back only for a newer change still. What they do themselves changes `shown`
 * first, so it never tells them of their own edit.
 */
export function useHeldUpdate(held: { area: LiveArea; shown: string | null; peek: () => Promise<string>; refresh: () => void; message: string }) {
  const subscribe = useContext(LiveContext);
  const [found, setFound] = useState<{ shown: string; now: string } | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const latest = useRef(held);
  latest.current = held;
  useEffect(
    () =>
      subscribe((areas) => {
        const { area, shown, peek } = latest.current;
        if (!shown || !areas.some((a) => a === area || a === "other")) return;
        void peek()
          .catch((e: unknown) => {
            if (e instanceof ApiError && e.isNotFound) return GONE;
            throw e;
          })
          .then(
            (now) => setFound(now === shown ? null : { shown, now }),
            () => undefined,
          );
      }),
    [subscribe],
  );
  const newer = found && found.shown === held.shown && found.now !== closed ? found : null;
  useStandingToast(
    newer
      ? {
          message: held.message,
          action: {
            label: "Refresh",
            onClick: () => {
              setFound(null);
              latest.current.refresh();
            },
          },
          onClose: () => setClosed(newer.now),
        }
      : null,
  );
}
