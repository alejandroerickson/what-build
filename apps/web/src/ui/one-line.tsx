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

/** Where a title may be cut: at the end of each word, before the spaces and the dash, comma or dot that join it to the next. */
export function wordEnds(text: string): number[] {
  return [...text.matchAll(/[\s,;:·—–-]*\s[\s,;:·—–-]*/gu)].map((m) => m.index).filter((i) => i > 0);
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
 */
export function OneLine({ text, measure = "", render, className = "" }: {
  text: string;
  /** From useMeasure, where the line's own box and its parent's are as wide as their content. */
  measure?: string;
  /** Draws the part shown (a match marked in it, say). The line is measured as plain text. */
  render?: (shown: string) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef("");
  const again = useRef(false);
  const [moved, setMoved] = useState(0);
  const key = `${measure}:${moved}:${text}`;
  // Where the part shown ends: the whole text when it fits, -1 when not even its first word does.
  const [fit, setFit] = useState<{ key: string; at: number } | null>(null);
  const current = fit?.key === key;
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
        } else setFit({ key, at: wordEnds(text).filter((i) => i < at).pop() ?? -1 });
        return;
      }
      again.current = false;
      seen.current = sizes(el);
      return;
    }
    const node = el.firstChild;
    let best = text.length;
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
      node.data = text;
    }
    setFit({ key, at: best });
  }, [current, at, key, text]);
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
  const shown = cut ? text.slice(0, at) : text;
  return (
    <span ref={ref} className={`one-line${className ? ` ${className}` : ""}`} dir="auto" title={cut ? text : undefined} data-cut={cut ? "" : undefined}>
      {!current || !render ? shown : render(shown)}
      {cut ? <span className="visually-hidden">{text.slice(at)}</span> : null}
    </span>
  );
}
