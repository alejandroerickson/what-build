/**
 * While the tutorial is up, the page holds still: no app shortcut (search, Focus, the panels, the
 * arrows, a list's keys) reaches the screens behind it. One listener, on the window and captured, put
 * there when this module loads, so it hears every key before any screen's own listener does.
 *
 * What gets through: the bubble's own buttons (Tab moves among them and the thing in the light, Enter
 * and Space press them), Esc (which closes the tutorial), a menu opened from the thing in the light,
 * and at a live stop the keys of the thing in the light (the canvas's 1, 2, 3, V, H and its zoom keys).
 */

export interface KeyPolicy {
  /** The tutorial's own layer: the bubble, the welcome, the agent stage. */
  layer: () => HTMLElement | null;
  /** The thing in the light, when it is there to be tried. */
  live: () => HTMLElement | null;
  /** The canvas's keys work at this stop, Focus (F) among them. */
  canvasKeys: boolean;
  onEscape: () => void;
  /** F at the stop where the canvas's keys work: in and out of Focus. */
  onFocus?: () => void;
}

/** The canvas's own keys, which work at the stop that lights it. */
const CANVAS_KEYS = new Set(["1", "2", "3", "v", "V", "h", "H", "+", "=", "-", "_", "0"]);
/** Keys whose default moves the page. */
const SCROLL_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let policy: KeyPolicy | null = null;

export function setKeyPolicy(next: KeyPolicy | null) {
  policy = next;
}

const inside = (el: HTMLElement | null, target: EventTarget | null) => Boolean(el && target instanceof Node && el.contains(target));

/** What Tab moves among: the tutorial's own controls, then the thing in the light when it is live. */
export function focusables(p: Pick<KeyPolicy, "layer" | "live">): HTMLElement[] {
  const within = (el: HTMLElement | null) => (el ? [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.closest("[inert], [hidden]") && x.getClientRects().length > 0) : []);
  return [...within(p.layer()), ...within(p.live())];
}

function guard(e: KeyboardEvent) {
  const p = policy;
  if (!p) return;
  const target = e.target;
  const menu = target instanceof Element ? target.closest(".menu") : null;
  // A menu opened from the canvas's toolbar answers its own keys, Esc included.
  if (menu || (e.key === "Escape" && document.querySelector(".menu"))) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    p.onEscape();
    return;
  }
  if (e.key === "Tab") {
    e.stopImmediatePropagation();
    e.preventDefault();
    const list = focusables(p);
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length;
    list[next]!.focus();
    return;
  }
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  // F at that stop goes in and out of Focus, as it does on a canvas, from anywhere.
  if (p.canvasKeys && plain && (e.key === "f" || e.key === "F") && !(target instanceof Element && target.closest("input, textarea, [contenteditable]"))) {
    e.preventDefault();
    e.stopImmediatePropagation();
    p.onFocus?.();
    return;
  }
  // The canvas's keys reach it from anywhere at the stop that lights it, the bubble's buttons included.
  if (p.canvasKeys && plain && CANVAS_KEYS.has(e.key)) return;
  // The bubble's buttons: only their own default (a press), never a screen's shortcut.
  if (inside(p.layer(), target)) {
    e.stopImmediatePropagation();
    return;
  }
  // Search opens over the whole app and leaves the tutorial behind, so / stays out even from the thing in the light.
  if (plain && e.key === "/") {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  // Inside what is there to be tried, everything works as it does without the tutorial.
  if (inside(p.live(), target) && !e.metaKey && !e.ctrlKey) return;
  e.stopImmediatePropagation();
  if (SCROLL_KEYS.has(e.key) || (plain && e.key.length === 1)) e.preventDefault();
}

if (typeof window !== "undefined") window.addEventListener("keydown", guard, true);
