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
 * - Frames take turns after the screen's reads have had theirs, one every FRAME_SPACING_MS, and no
 *   message changes that pace. One refused again stops the turns until the next minute, so a minute
 *   something else has used costs one call. Nothing takes a turn while the tab is hidden.
 * - Each refused frame is asked for at most FRAME_RELOADS times. Then it waits for the person's Try
 *   again.
 * - A page replaced in its frame is put back at once, as a new frame, which is a call. A screen puts
 *   back at most SCREEN_PUT_BACKS_A_MINUTE in all and one page at most PAGE_PUT_BACKS_A_MINUTE. Past
 *   either, the page waits for the next minute with no frame on show, and then comes back. After
 *   PUT_BACK_WAITS such waits in a row without settling, it stops and offers Try again. Leaving the
 *   screen starts it afresh too, so no page is gone for good. While the tab is hidden nothing is put
 *   back: the page takes a turn when the tab is visible again.
 * - A prototype's frames meet no limit and cost no calls, so they meet none of this.
 *
 * A page can send the message the refused page sends. It is heard only from the frame's own window
 * and only while that frame is on show, and what it gains is listed here and in okf/system/security.md:
 * a new frame at its own address, in turn, FRAME_RELOADS times at most until the person says to; a
 * stop in place of its own frame; and the wait it names, held to 1 to 60 seconds. For that wait
 * Loading says the minute's calls are used, and frames' turns hold back until the wait and the
 * reads' spread are over. It takes nothing else from the message, the pace above least of all.
 */

/** What a refusal says that is taken at its word: a minute's calls start again within a minute. */
const LONGEST_WAIT_SECONDS = 60;
/** The shortest wait a frame's message may name. */
const SHORTEST_FRAME_WAIT_SECONDS = 1;
/** How far apart a screen's refused reads come back. */
export const READ_SPREAD_MS = 5_000;
/** How many times a frame is asked for again by itself. */
export const FRAME_RELOADS = 3;
/** The pace of frames: half of a 50-call minute. A deployment with a much lower limit gets refused again, which stops the turns. */
export const FRAME_SPACING_MS = 2_400;
/** How many counted frames a screen puts back in a minute, in all. */
export const SCREEN_PUT_BACKS_A_MINUTE = 10;
/** How many of those are one page's. */
export const PAGE_PUT_BACKS_A_MINUTE = 3;
/** How many waits for the next minute in a row, without settling, before a page stops. */
export const PUT_BACK_WAITS = 3;
/** How long a page stays in its frame, not replaced, to have settled. */
export const SETTLES_AFTER_MS = 60_000;
const MINUTE_MS = 60_000;

/** Whether a refusal's wait is one for the next minute. */
export function isMinuteWait(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= LONGEST_WAIT_SECONDS;
}

/** What a frame's message says of its wait, held to what a refusal can mean. Anything but a number is no such message. */
function frameWait(seconds: unknown): number | null {
  return typeof seconds === "number" && !Number.isNaN(seconds) ? Math.min(LONGEST_WAIT_SECONDS, Math.max(SHORTEST_FRAME_WAIT_SECONDS, seconds)) : null;
}

export interface MinuteWait {
  /** The minute's calls are used up: what is read now is refused. */
  waiting: boolean;
  /** Refused frames waiting for their turn. */
  frames: number;
  /** Refused frames WhatBuild has stopped asking for, until the person says to. */
  stopped: number;
  /** Pages that keep reloading, waiting for the next minute. */
  reloading: number;
  /** Pages that keep reloading, which WhatBuild has stopped bringing back until the person says to. */
  reloadingStopped: number;
}

/** Why no frame is on show. */
type Held = "refused" | "asked" | "coming" | "reloading" | "reloading-stopped";

interface WaitingFrame {
  state: "shown" | "queued" | "stopped";
  /** What took the frame off show last. */
  why: "refused" | "replaced";
  /** How many times it was asked for again after being refused. */
  reloads: number;
  /** When it was put back, in the last minute. */
  putBacks: number[];
  /** Until when it waits for its next minute, past its own limit. */
  waitsUntil: number;
  /** Its waits for the next minute in a row, without settling. */
  waits: number;
  /** When its frame was last made. */
  cameBack: number;
  back: () => void;
  hold: (held: Held) => void;
  /** The person said to try again. */
  asked: () => void;
}

const IDLE: MinuteWait = { waiting: false, frames: 0, stopped: 0, reloading: 0, reloadingStopped: 0 };
let current = IDLE;
let resumesAt = 0;
/** When frames' turns begin, after the screen's reads have had theirs. */
let framesFrom = 0;
let lastTurn = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: WaitingFrame[] = [];
const stopped = new Set<WaitingFrame>();
/** The counted frames on the screen. With none left the person has left it, and its put-backs start afresh. */
const onScreen = new Set<WaitingFrame>();
/** When the screen put a page back, in the last minute. */
let screenPutBacks: number[] = [];
const listeners = new Set<() => void>();

function publish(now: number) {
  const next: MinuteWait = {
    waiting: resumesAt > now,
    frames: queue.filter((f) => f.why === "refused").length,
    stopped: [...stopped].filter((f) => f.why === "refused").length,
    reloading: queue.filter((f) => f.why === "replaced" && f.waits > 0).length,
    reloadingStopped: [...stopped].filter((f) => f.why === "replaced").length,
  };
  if ((Object.keys(next) as (keyof MinuteWait)[]).every((k) => next[k] === current[k])) return;
  current = next;
  listeners.forEach((l) => l());
}

const hidden = () => document.visibilityState === "hidden";

/**
 * When a page may next be put back: by now, or later when either limit holds it. Past its own limit a
 * page waits until its last put-back is a minute old, so what follows is a minute of its own. The
 * screen's limit opens as each of its put-backs turns a minute old, so no page there waits on another for long.
 */
function putBackFrom(frame: WaitingFrame, now: number): number {
  const inTheMinute = (times: number[]) => times.filter((t) => now - t < MINUTE_MS);
  frame.putBacks = inTheMinute(frame.putBacks);
  screenPutBacks = inTheMinute(screenPutBacks);
  if (frame.putBacks.length >= PAGE_PUT_BACKS_A_MINUTE) frame.waitsUntil = frame.putBacks[frame.putBacks.length - 1]! + MINUTE_MS;
  const screenFreeAt = screenPutBacks.length < SCREEN_PUT_BACKS_A_MINUTE ? 0 : screenPutBacks[screenPutBacks.length - SCREEN_PUT_BACKS_A_MINUTE]! + MINUTE_MS;
  return Math.max(frame.waitsUntil, screenFreeAt);
}

/** The moment from which a waiting frame may take a turn, its limits aside. */
const mayComeFrom = (frame: WaitingFrame, now: number) => (frame.why === "refused" ? 0 : putBackFrom(frame, now));

function comeBack(frame: WaitingFrame, now: number) {
  if (frame.why === "replaced") {
    frame.putBacks.push(now);
    screenPutBacks.push(now);
  } else frame.reloads += 1;
  frame.state = "shown";
  frame.cameBack = now;
  frame.back();
}

function takeTurns() {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  if (queue.length && !hidden() && Math.max(framesFrom, lastTurn + FRAME_SPACING_MS) <= now) {
    // The first that may come: a page held by its own limit lets those behind it go ahead.
    const next = queue.findIndex((f) => mayComeFrom(f, now) <= now);
    if (next >= 0) {
      lastTurn = now;
      comeBack(queue.splice(next, 1)[0]!, now);
    }
  }
  publish(now);
  const nextTurn = queue.length && !hidden() ? Math.max(framesFrom, lastTurn + FRAME_SPACING_MS, Math.min(...queue.map((f) => mayComeFrom(f, now)))) : Infinity;
  const nextChange = Math.min(nextTurn, resumesAt > now ? resumesAt : Infinity);
  if (nextChange !== Infinity) timer = setTimeout(takeTurns, Math.max(0, nextChange - now));
}

// A tab coming back takes up the turns it left.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => void (hidden() || takeTurns()));

/** Note a refusal: frames take no turn until its wait is over. */
export function minuteRefused(seconds: number): void {
  const until = Date.now() + seconds * 1000;
  if (until > resumesAt) {
    resumesAt = until;
    // Two tabs of one person do not take their turns together either.
    framesFrom = until + READ_SPREAD_MS + Math.random() * FRAME_SPACING_MS;
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

/** The person said to try again: the frame starts afresh, and waits for its turn. */
function ask(frame: WaitingFrame) {
  stopped.delete(frame);
  frame.state = "queued";
  frame.reloads = 0;
  frame.putBacks = [];
  frame.waitsUntil = 0;
  frame.waits = 0;
  frame.asked();
  queue.push(frame);
  takeTurns();
}

/** Try again, for every frame WhatBuild stopped asking for: they take turns as before, each afresh. */
export function tryStoppedFramesAgain(): void {
  [...stopped].forEach(ask);
}

/** A second load in a frame: something took the page's place, so that goes at once, and the page comes back when it may. */
function frameReplaced(frame: WaitingFrame) {
  const now = Date.now();
  if (now - frame.cameBack >= SETTLES_AFTER_MS) frame.waits = 0;
  const queued = queue.indexOf(frame);
  if (queued >= 0) queue.splice(queued, 1);
  frame.why = "replaced";
  if (frame.waits >= PUT_BACK_WAITS) {
    frame.state = "stopped";
    stopped.add(frame);
    frame.hold("reloading-stopped");
  } else {
    const from = putBackFrom(frame, now);
    if (from <= now && !hidden() && !queue.some((f) => f.why === "replaced")) comeBack(frame, now);
    else {
      if (from > now) frame.waits += 1;
      frame.state = "queued";
      queue.push(frame);
      frame.hold(frame.waits ? "reloading" : "coming");
    }
  }
  takeTurns();
}

/**
 * Brings a frame back when the document in it says it was refused, or when something takes its place
 * (`replaced`, which the caller calls on a second load). `frame` is the iframe, and `reload` makes a
 * new one at the same address. A message counts only from this frame's own window, and only while
 * the frame is on show, so one page's many messages are one refusal.
 *
 * The caller shows no frame while `stopped` or `reloading`: `stopped` means WhatBuild has stopped
 * asking after refusals, `reloading` says why a page that keeps being replaced is waiting or has
 * stopped, and `tryAgain` asks once more. A frame that holds a prototype passes `enabled` false: its
 * documents meet no limit, can't be refused and cost no calls, so it is put back at once, always.
 */
export function useFrameReturn(frame: RefObject<HTMLIFrameElement | null>, reload: () => void, enabled = true) {
  const [held, setHeld] = useState<Held | null>(null);
  const [wasReplaced, setWasReplaced] = useState(false);
  const latest = useRef(reload);
  latest.current = reload;
  const entry = useRef<WaitingFrame | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const me: WaitingFrame = {
      state: "shown",
      why: "refused",
      reloads: 0,
      putBacks: [],
      waitsUntil: 0,
      waits: 0,
      cameBack: Date.now(),
      back() {
        setHeld(null);
        latest.current();
      },
      hold: setHeld,
      asked() {
        setWasReplaced(false);
        setHeld(me.why === "refused" ? "asked" : "coming");
      },
    };
    entry.current = me;
    onScreen.add(me);
    const heard = (e: MessageEvent) => {
      if (me.state !== "shown" || !e.source || e.source !== frame.current?.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; retry_after_seconds?: unknown } | null;
      const seconds = data?.whatbuild === "frame-refused" ? frameWait(data.retry_after_seconds) : null;
      if (seconds === null) return;
      me.why = "refused";
      if (me.reloads >= FRAME_RELOADS) {
        me.state = "stopped";
        stopped.add(me);
        me.hold("refused");
      } else {
        me.state = "queued";
        queue.push(me);
      }
      minuteRefused(seconds);
    };
    window.addEventListener("message", heard);
    return () => {
      window.removeEventListener("message", heard);
      const at = queue.indexOf(me);
      if (at >= 0) queue.splice(at, 1);
      stopped.delete(me);
      onScreen.delete(me);
      if (!onScreen.size) screenPutBacks = [];
      entry.current = null;
      takeTurns();
    };
  }, [enabled, frame]);
  const replaced = useCallback(() => {
    setWasReplaced(true);
    if (entry.current) frameReplaced(entry.current);
    else latest.current();
  }, []);
  const tryAgain = useCallback(() => {
    const me = entry.current;
    if (me?.state === "stopped") ask(me);
  }, []);
  return {
    stopped: held === "refused" || held === "asked",
    asking: held === "asked",
    reloading: held === "coming" || held === "reloading" || held === "reloading-stopped" ? held : null,
    wasReplaced,
    replaced,
    tryAgain,
  };
}

/** For tests: nothing refused, nothing waiting. */
export function forgetMinute(): void {
  clearTimeout(timer);
  timer = undefined;
  queue.length = 0;
  stopped.clear();
  onScreen.clear();
  screenPutBacks = [];
  resumesAt = 0;
  framesFrom = 0;
  lastTurn = 0;
  current = IDLE;
  listeners.forEach((l) => l());
}
