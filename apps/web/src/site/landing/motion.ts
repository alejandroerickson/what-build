/**
 * What the site's two landing pages share: easing, the marks their pictures are drawn with, and the
 * stage that follows the scroll. Each picture is drawn on a 1440 × 900 stage scaled to fit the
 * window. On a narrow or upright window the words leave the stage and the picture shows only the
 * part of the stage it uses, in the room the words leave.
 */

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** How far p is from a to b, 0 to 1. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const eOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const eIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The same scatter on every visit. */
export function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The card kit's hues, for material before anyone has organized it. */
export const HUES = ["#ecebfd", "#dcf2ee", "#fcefd8", "#fce6e8", "#e1f3e6", "#e1eefb", "#f0f0f0"];
/** What a piece of evidence may be, drawn without its contents: documents, sheets, recordings, chats, slides, photos. */
export const KINDS = ["doc", "doc", "sheet", "rec", "chat", "chat", "slide", "photo", "doc", "sheet"];

export const pick = <T,>(list: readonly T[], r: () => number): T => list[Math.floor(r() * list.length)]!;

export function div(parent: Element, className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}

/** One piece of evidence: a coloured tile while it is loose, white once it is in its place (--c from 1 to 0). */
export function makeTile(parent: Element, kind: string, hue: string): HTMLDivElement {
  const el = div(parent, `ld-tile ld-k-${kind}`);
  el.style.setProperty("--hue", hue);
  return el;
}

export function place(el: HTMLElement, x: number, y: number, r = 0, s = 1) {
  el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(3)})`;
}

const SVG = "http://www.w3.org/2000/svg";
export function svg(parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent.appendChild(el);
  return el;
}

/** A person, drawn as the app's person glyph is. */
export function person(parent: Element, hue: string): HTMLDivElement {
  const el = div(parent, "ld-who");
  el.style.setProperty("--hue", hue);
  const s = svg(el, "svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round" });
  svg(s, "circle", { cx: 12, cy: 8, r: 4 });
  svg(s, "path", { d: "M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" });
  return el;
}

/** Find a part of the page's markup by its data-ld name. */
export function part<T extends Element = HTMLElement>(root: Element, name: string): T {
  const el = root.querySelector<T>(`[data-ld="${name}"]`);
  if (!el) throw new Error(`The landing page has no ${name}.`);
  return el;
}

/** Where the words leave the stage: a narrow window, or one taller than it is wide. */
export const NARROW = "(max-width: 720px), (max-aspect-ratio: 6/5)";

/** The part of the stage a picture uses, and where it goes on a narrow window (fractions of its height). */
export interface NarrowFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The top and bottom of the room the picture has, as fractions of the window's height. */
  top: number;
  bottom: number;
}

export interface Clock {
  /** The pinned section's progress, 0 to 1, eased toward the scroll so motion feels weighty. */
  p: number;
  /** Whether motion is reduced, in which case each scene shows its settled picture. */
  reduced: boolean;
  narrow: boolean;
}

/**
 * Run a landing page's picture: fit the stage to the window, follow the scroll through the section
 * that pins it, and draw a frame while that section is on screen. Returns what stops it all.
 */
export function startStage(root: HTMLElement, journey: HTMLElement, frame: NarrowFrame, draw: (clock: Clock, now: number, dt: number) => void): () => void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = window.matchMedia(NARROW);
  const clock: Clock = { p: 0, reduced: reduce.matches, narrow: narrow.matches };

  const fit = () => {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min(vw / 1440, vh / 900);
    const ox = (vw - 1440 * s) / 2;
    const oy = (vh - 900 * s) / 2;
    clock.narrow = narrow.matches;
    clock.reduced = reduce.matches;
    root.style.setProperty("--ld-fit", String(s));
    root.style.setProperty("--ld-ox", `${ox}px`);
    root.style.setProperty("--ld-oy", `${oy}px`);
    let x = ox, y = oy, k = s;
    if (clock.narrow) {
      const room = (frame.bottom - frame.top) * vh;
      k = Math.min((vw - 24) / frame.w, room / frame.h);
      x = vw / 2 - (frame.x + frame.w / 2) * k;
      y = (frame.top * vh + room / 2) - (frame.y + frame.h / 2) * k;
    }
    root.style.setProperty("--ld-s", String(k));
    root.style.setProperty("--ld-x", `${x}px`);
    root.style.setProperty("--ld-y", `${y}px`);
  };

  let target = 0;
  const measure = () => {
    const r = journey.getBoundingClientRect();
    target = clamp(-r.top / Math.max(1, r.height - window.innerHeight));
  };
  const onScroll = () => {
    root.toggleAttribute("data-scrolled", window.scrollY > 24);
    measure();
    wake();
  };

  let raf = 0, last = 0, visible = true;
  const tick = (ms: number) => {
    raf = 0;
    const now = ms / 1000;
    const dt = last ? Math.min(0.05, now - last) : 0;
    last = now;
    clock.p += (target - clock.p) * (clock.reduced ? 1 : 0.12);
    if (Math.abs(target - clock.p) < 0.0004) clock.p = target;
    draw(clock, now, dt);
    if (visible) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!raf && visible) raf = requestAnimationFrame(tick);
  };

  // Draw only while the section is on screen.
  const seen = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible) wake();
    else last = 0;
  });
  seen.observe(journey);

  const onResize = () => (fit(), measure(), wake());
  fit();
  measure();
  clock.p = target;
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  reduce.addEventListener("change", onResize);
  narrow.addEventListener("change", onResize);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    visible = false;
    seen.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    reduce.removeEventListener("change", onResize);
    narrow.removeEventListener("change", onResize);
  };
}
