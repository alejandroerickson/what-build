import { prefersReducedMotion } from "../ui/media.ts";

/**
 * The tutorial goes into the account menu, and comes back out of it: a pill with its stop flies along
 * a curve between the bubble and the account button at the foot of the panel, which pulses once as it
 * lands. With reduced motion nothing flies: the account button pulses, and that is all.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxOf(el: Element | null | undefined): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

export function accountButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".panel-left .panel-foot .account-button");
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The account button pulses once: where the tutorial went. */
export function land() {
  const b = accountButton();
  if (!b) return;
  b.removeAttribute("data-tutorial-landed");
  void b.offsetWidth;
  b.setAttribute("data-tutorial-landed", "");
  setTimeout(() => b.removeAttribute("data-tutorial-landed"), 1400);
}

/**
 * Flies `pill` (the layer's own, holding the words) from `from` into the account button, or (`out`)
 * from the account button to `from`. Resolves when it has landed.
 */
export async function fly(pill: HTMLElement | null, from: Box | null, out = false): Promise<void> {
  const a = boxOf(accountButton());
  if (prefersReducedMotion() || !from || !a || !pill) {
    if (!out) land();
    return;
  }
  pill.hidden = false;
  const pw = pill.offsetWidth;
  const ph = pill.offsetHeight;
  const card = { x: from.x + from.w / 2 - pw / 2, y: from.y + Math.min(from.h / 2, 60) - ph / 2 };
  const menu = { x: a.x + 3, y: a.y + a.h / 2 - ph / 2 };
  const ctrl = { x: menu.x + 30, y: card.y };
  const [p0, p2] = out ? [menu, card] : [card, menu];
  const at = (t: number) => {
    const u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p2.y };
  };
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const k = out ? 1 - t : t;
    const p = at(t);
    const opacity = k > 0.88 ? (1 - k) / 0.12 : out && t < 0.1 ? t / 0.1 : 1;
    frames.push({ offset: t, transform: `translate(${p.x}px, ${p.y}px) scale(${(1 - 0.5 * k).toFixed(3)})`, opacity: opacity.toFixed(3) });
  }
  try {
    if (!out) {
      pill.animate([{ transform: `translate(${p0.x}px, ${p0.y}px) scale(0.7)`, opacity: 0 }, { transform: `translate(${p0.x}px, ${p0.y}px) scale(1)`, opacity: 1 }], { duration: 150, easing: "ease-out", fill: "forwards" });
      await wait(170);
    }
    await pill.animate(frames, { duration: out ? 560 : 720, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" }).finished;
  } catch {
    // An animation cancelled (the screen went away) just ends.
  }
  pill.getAnimations?.().forEach((x) => x.cancel());
  pill.hidden = true;
  if (!out) land();
}
