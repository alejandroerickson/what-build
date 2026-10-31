import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

// ---- What a line is measured against ------------------------------------------------------------

/** One ResizeObserver for every line on the screen: each element watched calls what watches it. */
const watchers = new Map<Element, Set<() => void>>();
let observer: ResizeObserver | null = null;

function watch(elements: Element[], onResize: () => void): () => void {
  // Missing where nothing is laid out (the tests' DOM, unless a test provides one).
  if (typeof ResizeObserver === "undefined") return () => {};
  observer ??= new ResizeObserver((entries) => {
    const calls = new Set<() => void>();
    for (const entry of entries) watchers.get(entry.target)?.forEach((call) => calls.add(call));
    calls.forEach((call) => call());
  });
  for (const el of elements) {
    let calls = watchers.get(el);
    if (!calls) {
      calls = new Set();
      watchers.set(el, calls);
      observer.observe(el);
    }
    calls.add(onResize);
  }
  return () => {
    for (const el of elements) {
      const calls = watchers.get(el);
      calls?.delete(onResize);
      if (calls && !calls.size) {
        watchers.delete(el);
        observer?.unobserve(el);
      }
    }
  };
}

/** Called when a font finishes loading, which changes how wide text is drawn. */
const fontWatchers = new Set<() => void>();
const fontsLoaded = () => fontWatchers.forEach((call) => call());

function watchFonts(onLoad: () => void): () => void {
  // Missing where nothing draws text (the tests' DOM).
  const set: FontFaceSet | undefined = document.fonts;
  if (!set) return () => {};
  if (!fontWatchers.size) set.addEventListener("loadingdone", fontsLoaded);
  fontWatchers.add(onLoad);
  return () => {
    fontWatchers.delete(onLoad);
    if (!fontWatchers.size) set.removeEventListener("loadingdone", fontsLoaded);
  };
}

/**
 * What lines inside a container are measured against: its width, and the fonts loaded so far.
 * Changes with either. For a line whose own box is as wide as its words (a crumb, a chip), so that
 * neither it nor its parent grows when the room around them does.
 */
export function useMeasure(ref: RefObject<HTMLElement | null>): string {
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watch([el], () => setWidth(el.clientWidth));
  }, [ref]);
  useEffect(() => watchFonts(() => setFonts((n) => n + 1)), []);
  return `${width}:${fonts}`;
}

// ---- A title on one line ------------------------------------------------------------------------

const BETWEEN_WORDS = /[\s,;:·—–-]*\s[\s,;:·—–-]*/gu;

/** Where a title may be cut: at the end of each word, before the spaces and the dash, comma or dot that join it to the next. */
export function wordEnds(text: string): number[] {
  return [...text.matchAll(BETWEEN_WORDS)].map((m) => m.index).filter((i) => i > 0);
}

/** Where a title may start later than it does: at the start of each word after the first. */
function wordStarts(text: string): number[] {
  return [...text.matchAll(BETWEEN_WORDS)].map((m) => m.index + m[0].length).filter((i) => i < text.length);
}

/**
 * The part of a title one word smaller, for a line that turned out too wide: it ends a word sooner,
 * or starts a word later when that would lose what it keeps. Nothing, when it is down to that word.
 */
function aWordLess(text: string, from: number, at: number, keep = 0): { from: number; at: number } | null {
  const end = wordEnds(text).filter((i) => i < at).pop() ?? -1;
  if (!from && end > keep) return { from, at: end };
  if (!keep) return { from, at: end };
  const later = wordStarts(text).find((i) => i > from && i <= keep);
  return later === undefined ? null : { from: later, at };
}

/** The widths a line was last cut for: its own, and its parent's. */
const sizes = (el: HTMLElement) => `${el.clientWidth}:${el.parentElement?.clientWidth ?? 0}`;

/**
 * A title on one line, in its own direction (a title in Arabic reads right to left). The CSS clamp
 * cuts it where its line breaks, so it keeps the words it starts with; but where the ellipsis has no
 * room it clips at the line's edge, which in a title that mixes directions (English, then Arabic) is
 * where the other direction's words start. So a title that doesn't fit is cut here after the last
 * word that leaves room for the ellipsis, measured before the browser paints. It is measured again
 * only when its box or its parent's changes width, a font loads, or `measure` changes; never while
 * nothing moves. The rest stays in the text, hidden, so assistive technology reads it all, and a
 * cut title shows the whole of it on hover.
 *
 * Given `keep`, the line does not leave that place out: when its first words end before it, the
 * line starts at a word nearer it, after an ellipsis, as far back as still fits.
 */
export function OneLine({ text, measure = "", render, keep, className = "" }: {
  text: string;
  /** From useMeasure, where the line's own box and its parent's are as wide as their content. */
  measure?: string;
  /** Draws the part shown (a match marked in it, say), which starts `from` into the text. The line is measured as plain text. */
  render?: (shown: string, from: number) => ReactNode;
  /** The offset of what the line must show, such as a match. */
  keep?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef("");
  const again = useRef(false);
  const [moved, setMoved] = useState(0);
  const key = `${measure}:${moved}:${keep ?? ""}:${text}`;
  // Where the part shown starts and ends: to the whole text's end when it fits, -1 when not even its first word does.
  const [fit, setFit] = useState<{ key: string; from: number; at: number } | null>(null);
  const current = fit?.key === key;
  const from = current ? fit.from : 0;
  const at = current ? fit.at : text.length;
  const cut = at >= 0 && at < text.length;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fits = () => el.scrollHeight <= el.clientHeight;
    if (current) {
      if (at >= 0 && !fits()) {
        // Not as it was measured. Measured before it was laid out (in a panel not shown yet), it is
        // measured again; still too wide, as what render adds may draw it, it loses a word.
        if (!again.current) {
          again.current = true;
          setMoved((n) => n + 1);
          return;
        }
        const less = aWordLess(text, from, at, keep);
        if (less) {
          setFit({ key, ...less });
          return;
        }
      }
      again.current = false;
      seen.current = sizes(el);
      return;
    }
    const node = el.firstChild;
    let best = text.length;
    let start = 0;
    if (node instanceof Text && !fits()) {
      // Each try is drawn and measured before the browser paints, then the whole text put back.
      best = -1;
      const ends = wordEnds(text);
      for (let lo = 0, hi = ends.length - 1; lo <= hi; ) {
        const mid = (lo + hi) >> 1;
        node.data = `${text.slice(0, ends[mid])}…`;
        if (fits()) {
          best = ends[mid]!;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (keep !== undefined && keep > 0 && keep >= best) {
        // The earliest start that still leaves room, or else the kept word itself.
        best = wordEnds(text).find((i) => i > keep) ?? text.length;
        const starts = wordStarts(text).filter((i) => i <= keep);
        start = keep;
        for (let lo = 0, hi = starts.length - 1; lo <= hi; ) {
          const mid = (lo + hi) >> 1;
          node.data = `…${text.slice(starts[mid], best)}${best < text.length ? "…" : ""}`;
          if (fits()) {
            start = starts[mid]!;
            hi = mid - 1;
          } else lo = mid + 1;
        }
      }
      node.data = text;
    }
    setFit({ key, from: start, at: best });
  }, [current, from, at, key, keep, text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unwatch = watch(el.parentElement ? [el, el.parentElement] : [el], () => {
      if (sizes(el) !== seen.current) setMoved((n) => n + 1);
    });
    const unwatchFonts = watchFonts(() => setMoved((n) => n + 1));
    return () => {
      unwatch();
      unwatchFonts();
    };
  }, []);
  const shown = text.slice(from, cut ? at : text.length);
  return (
    <span ref={ref} className={`one-line${className ? ` ${className}` : ""}`} dir="auto" title={cut || from ? text : undefined} data-cut={cut ? "" : undefined} data-lead={from ? "" : undefined}>
      {from ? <span className="visually-hidden">{text.slice(0, from)}</span> : null}
      {!current || !render ? shown : render(shown, from)}
      {cut ? <span className="visually-hidden">{text.slice(at)}</span> : null}
    </span>
  );
}
