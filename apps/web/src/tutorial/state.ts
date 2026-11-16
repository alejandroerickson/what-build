import type { TutorialState } from "../lib/session.tsx";
import { PLACES, type Stop } from "./stops.ts";

/**
 * The tutorial's rules as pure functions, so who gets it, what the account menu says and what the
 * pill says are decided in one place and tested without a screen.
 */

export const NEW_TUTORIAL: TutorialState = { offered: false, stop: null, finished: false };

/**
 * The narrowest window the tutorial is offered in: the width its layout was designed and checked for,
 * with the panel, the canvas or a source's preview and the inspector side by side. The tutorial's own,
 * not the app's phone width (`PHONE_QUERY`), which other screens use.
 */
export const TUTORIAL_MIN_WIDTH = 1024;
/** A window too narrow for the tutorial. */
export const TOO_NARROW_QUERY = `(max-width: ${TUTORIAL_MIN_WIDTH - 0.02}px)`;

/**
 * Who gets the tutorial, on the product they are in: someone who can edit it (an editor or admin, the
 * product not archived, the organization not read-only), and a guest of the example organization.
 * Viewers and Story readers given those roles get nothing, and nobody does in a window narrower than
 * `TUTORIAL_MIN_WIDTH`.
 */
export function tutorialFor(p: { canWrite: boolean; role: string; example: boolean; narrow: boolean }): boolean {
  if (p.narrow) return false;
  return p.canWrite || (p.role === "guest" && p.example);
}

/** The welcome is offered once per person, on the first product where they get the tutorial. */
export function offerWelcome(state: TutorialState | undefined, eligible: boolean): boolean {
  return eligible && Boolean(state) && !state!.offered;
}

/** Where the tutorial stands for the account menu: part-way, finished, or not taken yet. */
export type Standing = { kind: "new" } | { kind: "paused"; stop: number } | { kind: "finished" };

/** A stop kept from before stays inside the stops there are now (an agent connected since takes the last away). */
export function standing(state: TutorialState | undefined, count: number): Standing {
  const s = state ?? NEW_TUTORIAL;
  if (s.stop !== null && s.stop >= 0) return { kind: "paused", stop: Math.min(s.stop, count - 1) };
  return s.finished ? { kind: "finished" } : { kind: "new" };
}

/** The account menu's one tutorial item: its words, the line under them, and how far along, for a bar. */
export function menuItem(st: Standing, stops: readonly Stop[]): { title: string; detail: string; progress: number | null } {
  if (st.kind === "paused") {
    const stop = stops[st.stop]!;
    return { title: "Resume tutorial", detail: `Stop ${st.stop + 1} of ${stops.length} · ${PLACES[stop.place].label}`, progress: st.stop / stops.length };
  }
  return { title: st.kind === "finished" ? "Take the tutorial again" : "Take the tutorial", detail: "About three minutes", progress: null };
}

/** What the pill says as the tutorial flies into the account menu, or out of it. */
export function pillWords(kind: "welcome" | "stop" | "finished", stop: number, count: number): string {
  if (kind === "finished") return "Tutorial finished";
  if (kind === "welcome") return "Tutorial";
  return `Tutorial · ${stop + 1} of ${count}`;
}

/** Where a resumed or restarted tutorial begins. */
export function resumeAt(st: Standing): number {
  return st.kind === "paused" ? st.stop : 0;
}
