import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/**
 * Waiting for the next minute. A plan or the example organization limits each person's calls a
 * minute, by the clock, and a refused call says how long is left. What was refused comes back by
 * itself, with limits that keep the waiting from costing what it waits for:
 *
 * - A refused read asks again when the wait is over, a few times at most (`retryRead`, in api.ts),
 *   each at its own moment within a few seconds, so a screen's reads do not all land at once.
 * - A refused frame answers a short page that tells the app so, and never reloads itself. The app
 *   asks for it again by making a new frame at the page's own address, which is how it puts back a
 *   page replaced in its frame too, so a second load of one frame is still never accepted.
 * - Frames take turns after the screen's reads have had theirs, at a pace that leaves half the
 *   minute's calls for what the person does next. One refused again stops the turns until the next
 *   minute, so a minute something else has used costs one call. Nothing takes a turn while the tab
 *   is hidden.
 * - Each frame is asked for at most FRAME_RELOADS times. Then it waits for the person's Try again,
 *   so no page, whatever it says of itself, spends their calls without end.
 * - A page that keeps replacing itself is put back only so often (usePutBacks): each new frame is a
 *   call, so a page reloading itself would otherwise spend every minute's.
 */

/** What a refusal says that is taken at its word: a minute's calls start again within a minute. */
const LONGEST_WAIT_SECONDS = 60;
/** How far apart a screen's refused reads come back. */
export const READ_SPREAD_MS = 5_000;
/** How many times a frame is asked for again by itself. */
export const FRAME_RELOADS = 3;
/** The pace of frames when a refusal has not said the limit: 30 a minute. */
const FRAME_SPACING_MS = 2_000;
const SHORTEST_FRAME_SPACING_MS = 100;

/** Whether a refusal's wait is one for the next minute. */
export function isMinuteWait(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= LONGEST_WAIT_SECONDS;
}

export interface MinuteWait {
  /** The minute's calls are used up: what is read now is refused. */
  waiting: boolean;
  /** Frames waiting for their turn. */
  frames: number;
  /** Frames WhatBuild has stopped asking for, until the person says to. */
  stopped: number;
}

interface WaitingFrame {
  state: "shown" | "queued" | "stopped";
  reloads: number;
  back: () => void;
  stop: () => void;
  /** The person said to try again, and the frame waits for its turn. */
  asked: () => void;
}

const IDLE: MinuteWait = { waiting: false, frames: 0, stopped: 0 };
let current = IDLE;
let resumesAt = 0;
/** When frames' turns begin, after the screen's reads have had theirs. */
let framesFrom = 0;
let spacing = FRAME_SPACING_MS;
let lastTurn = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: WaitingFrame[] = [];
const stopped = new Set<WaitingFrame>();
const listeners = new Set<() => void>();

function publish(now: number) {
  const next = { waiting: resumesAt > now, frames: queue.length, stopped: stopped.size };
  if (next.waiting === current.waiting && next.frames === current.frames && next.stopped === current.stopped) return;
  current = next;
  listeners.forEach((l) => l());
}

const hidden = () => document.visibilityState === "hidden";

function takeTurns() {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  const turnAt = Math.max(framesFrom, lastTurn + spacing);
  if (queue.length && !hidden() && turnAt <= now) {
    lastTurn = now;
    const frame = queue.shift()!;
    frame.state = "shown";
    frame.reloads += 1;
    frame.back();
  }
  publish(now);
  const nextTurn = queue.length && !hidden() ? Math.max(framesFrom, lastTurn + spacing) : Infinity;
  const nextChange = Math.min(nextTurn, resumesAt > now ? resumesAt : Infinity);
  if (nextChange !== Infinity) timer = setTimeout(takeTurns, Math.max(0, nextChange - now));
}

// A tab coming back takes up the turns it left.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => void (hidden() || takeTurns()));

/** Note a refusal: nothing is read until its wait is over. `limit` is the calls a minute it names. */
export function minuteRefused(seconds: number, limit?: number): void {
  const until = Date.now() + seconds * 1000;
  if (typeof limit === "number" && limit > 0) spacing = Math.max(SHORTEST_FRAME_SPACING_MS, Math.ceil(120_000 / limit));
  if (until > resumesAt) {
    resumesAt = until;
    // Two tabs of one person do not take their turns together either.
    framesFrom = until + READ_SPREAD_MS + Math.random() * spacing;
  }
  takeTurns();
}

/** Whether the minute's calls are used up, what is waiting, and what has stopped. */
export function useMinuteWait(): MinuteWait {
  return useSyncExternalStore(
    useCallback((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    () => current,
    () => IDLE,
  );
}

function ask(frame: WaitingFrame) {
  stopped.delete(frame);
  frame.state = "queued";
  frame.reloads = 0;
  frame.asked();
  queue.push(frame);
  takeTurns();
}

/** Try again, for every frame WhatBuild stopped asking for: they take turns as before, each with its bound anew. */
export function tryStoppedFramesAgain(): void {
  [...stopped].forEach(ask);
}

/**
 * Brings a frame back when the document in it says it was refused. `frame` is the iframe, and
 * `reload` makes a new one at the same address. A message counts only from this frame's own window,
 * and only while the frame is on show, so one page's many messages are one refusal. `stopped` means
 * WhatBuild has stopped asking: the caller shows no frame, and `tryAgain` asks once more. A frame
 * that holds a prototype passes `enabled` false: its documents meet no limit and can't be refused.
 */
export function useRefusedFrame(frame: RefObject<HTMLIFrameElement | null>, reload: () => void, enabled = true): { stopped: boolean; asking: boolean; tryAgain: () => void } {
  const [isStopped, setStopped] = useState(false);
  const [asking, setAsking] = useState(false);
  const latest = useRef(reload);
  latest.current = reload;
  const entry = useRef<WaitingFrame | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const me: WaitingFrame = {
      state: "shown",
      reloads: 0,
      back() {
        setStopped(false);
        setAsking(false);
        latest.current();
      },
      stop() {
        setStopped(true);
      },
      asked() {
        setAsking(true);
      },
    };
    entry.current = me;
    const heard = (e: MessageEvent) => {
      if (me.state !== "shown" || !e.source || e.source !== frame.current?.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; retry_after_seconds?: unknown; limit?: unknown } | null;
      if (data?.whatbuild !== "frame-refused" || !isMinuteWait(data.retry_after_seconds)) return;
      if (me.reloads >= FRAME_RELOADS) {
        me.state = "stopped";
        stopped.add(me);
        me.stop();
      } else {
        me.state = "queued";
        queue.push(me);
      }
      minuteRefused(data.retry_after_seconds, typeof data.limit === "number" ? data.limit : undefined);
    };
    window.addEventListener("message", heard);
    return () => {
      window.removeEventListener("message", heard);
      const at = queue.indexOf(me);
      if (at >= 0) queue.splice(at, 1);
      stopped.delete(me);
      entry.current = null;
      takeTurns();
    };
  }, [enabled, frame]);
  const tryAgain = useCallback(() => {
    const me = entry.current;
    if (me?.state === "stopped") ask(me);
  }, []);
  return { stopped: isStopped, asking, tryAgain };
}

/** How many times in a minute a page is put back before WhatBuild stops showing it. */
export const PUT_BACKS_A_MINUTE = 3;

/**
 * Whether a page replaced in its frame may be put back as a new frame, once more. Past the bound the
 * caller shows no frame at all: neither the page, which would only do it again, nor what replaced it.
 * Put back more slowly than this, a page costs too few calls to matter, and keeps its place.
 */
export function usePutBacks(): () => boolean {
  const times = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    times.current = [...times.current.filter((t) => now - t < 60_000), now];
    return times.current.length <= PUT_BACKS_A_MINUTE;
  }, []);
}

/** For tests: nothing refused, nothing waiting. */
export function forgetMinute(): void {
  clearTimeout(timer);
  timer = undefined;
  queue.length = 0;
  stopped.clear();
  resumesAt = 0;
  framesFrom = 0;
  lastTurn = 0;
  spacing = FRAME_SPACING_MS;
  current = IDLE;
  listeners.forEach((l) => l());
}
