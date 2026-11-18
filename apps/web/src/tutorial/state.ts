import type { TutorialState } from "../lib/session.tsx";
import { partLabel, PLACES, type Part, type Place } from "./stops.ts";

/**
 * The tutorials' rules as pure functions, so who gets them, which starts by itself where, what the
 * account menu says and what the pill says are decided in one place and tested without a screen.
 */

export const NEW_TUTORIAL: TutorialState = { seen: [], off: false };

/**
 * The narrowest window the tutorial is offered in: the width its layout was designed and checked for,
 * with the panel, the canvas or a source's preview and the inspector side by side. The tutorial's own,
 * not the app's phone width (`PHONE_QUERY`), which other screens use.
 */
export const TUTORIAL_MIN_WIDTH = 1024;
/** A window too narrow for the tutorial. */
export const TOO_NARROW_QUERY = `(max-width: ${TUTORIAL_MIN_WIDTH - 0.02}px)`;

/**
 * Who gets the tutorials, on the product they are in: someone who can edit it (an editor or admin, the
 * product not archived, the organization not read-only), and a guest of the example organization.
 * Viewers and Story readers given those roles get nothing, and nobody does in a window narrower than
 * `TUTORIAL_MIN_WIDTH`.
 */
export function tutorialFor(p: { canWrite: boolean; role: string; example: boolean; narrow: boolean }): boolean {
  if (p.narrow) return false;
  return p.canWrite || (p.role === "guest" && p.example);
}

const isPlace = (s: string | undefined): s is Place => Boolean(s && s in PLACES);

/**
 * The page of a product an address is in (`/t/<organization>/<product>/<page>/…`), a source's own
 * screen in Evidence included: whose tutorial the account menu offers there.
 */
export function sectionOf(pathname: string): Place | null {
  const top = pathname.split("/")[4];
  return isPlace(top) ? top : null;
}

/**
 * The page whose tutorial an address can show: Idea and Evidence at their own address only (a source's
 * own screen has no examples to show), Exploration and Story at any of theirs.
 */
export function pageOf(pathname: string): Place | null {
  const [, , , , top, more] = pathname.split("/");
  if (!isPlace(top)) return null;
  return (top === "idea" || top === "evidence") && more ? null : top;
}

/**
 * The tutorial that starts by itself on arriving at a screen: the welcome until it has been offered,
 * then the page's own the first time that page is opened. Nothing once tutorials are off, and nothing
 * before the account is known.
 */
export function dueTutorial(state: TutorialState | undefined, page: Place | null): Part | null {
  if (!state || state.off) return null;
  if (!state.seen.includes("welcome")) return "welcome";
  return page && !state.seen.includes(page) ? page : null;
}

/** The account menu's one tutorial item: the tutorial of the page on screen, or the welcome elsewhere. */
export function menuItem(part: Part, count: number): { title: string; detail: string } {
  return { title: `Take the ${partLabel(part)} tutorial`, detail: `${count} stops` };
}

/** What the pill says as the tutorial flies into the account menu, or out of it. */
export function pillWords(kind: "welcome" | "stop" | "finished", stop: number, count: number): string {
  if (kind === "finished") return "Tutorial finished";
  if (kind === "welcome") return "Tutorial";
  return `Tutorial · ${stop + 1} of ${count}`;
}
