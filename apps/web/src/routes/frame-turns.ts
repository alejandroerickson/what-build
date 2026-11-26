import { useCallback, useEffect, useState } from "react";

/**
 * Which of a canvas's pages that enter a prototype may load their frames now.
 *
 * Such a page loads every file its document loads, and a frame keeps none of them between loads
 * (browsers cache nothing an opaque origin loads). A canvas of dozens of them loading at once asks
 * for thousands of files together, which is more than a browser will take: it refuses some, and a
 * page left without a script or a stylesheet never draws until it loads again. So they take turns,
 * outward from the page asked for: that page first and alone, so it shows as soon as it can; then
 * the pages either side of it, which the arrows show next; then the rest, FRAMES_AT_ONCE at a time,
 * nearest first and the next before the previous, until every page has loaded. A page keeps its
 * frame once it has had its turn, so moving between pages that have loaded loads nothing, and a page
 * asked for later goes to the front. A page whose frame has not said it loaded within FRAME_TURN_MS
 * no longer holds back the others.
 *
 * A page with HTML of its own is one document that loads nothing else, and loads as it always has.
 */
export const FRAMES_AT_ONCE = 8;
export const FRAME_TURN_MS = 8_000;

/** Every page in the order it takes its turn: the page asked for (or the first), then outward from it, the next before the previous. */
export function turnOrder(ids: readonly string[], asked: string | null): string[] {
  if (!ids.length) return [];
  const at = Math.max(0, asked ? ids.indexOf(asked) : 0);
  const out = [ids[at]!];
  for (let d = 1; out.length < ids.length; d++) {
    if (at + d < ids.length) out.push(ids[at + d]!);
    if (at - d >= 0) out.push(ids[at - d]!);
  }
  return out;
}

export interface FrameTurns {
  /** Whether a page has had its turn, and may have a frame. */
  has: (id: string) => boolean;
  /** What a page's frame says of itself: its document has loaded, or a new one has begun to. */
  heard: (id: string, loaded: boolean) => void;
}

/** Turns for `queued`, the pages that enter a prototype, among `pages` in the canvas's order. */
export function useFrameTurns(pages: readonly string[], queued: ReadonlySet<string>, asked: string | null): FrameTurns {
  const [granted, setGranted] = useState<ReadonlySet<string>>(() => new Set());
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  // When each page's current document began to load, to tell a turn that has run out.
  const [since] = useState(() => new Map<string, number>());
  const [woken, wake] = useState(0);

  const heard = useCallback(
    (id: string, loaded: boolean) => {
      if (!loaded) since.set(id, Date.now());
      setDone((was) => {
        if (was.has(id) === loaded) return was;
        const next = new Set(was);
        if (loaded) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [since],
  );

  useEffect(() => {
    const now = Date.now();
    const order = turnOrder(pages, asked).filter((id) => queued.has(id));
    const ranOut = (id: string) => granted.has(id) && now - (since.get(id) ?? now) >= FRAME_TURN_MS;
    const settled = (id: string) => done.has(id) || ranOut(id);
    const loading = (id: string) => granted.has(id) && !settled(id);
    // The page asked for alone, then with the pages either side of it, then the rest a few at a time.
    const phase = !order.slice(0, 1).every(settled) ? 1 : !order.slice(0, 3).every(settled) ? 3 : order.length;
    const most = phase < order.length ? phase : FRAMES_AT_ONCE;
    // The page asked for and those beside it start at once, whatever else is loading.
    let room = most - order.slice(0, phase).filter(loading).length;
    const add: string[] = [];
    for (const id of order.slice(0, phase)) {
      if (room <= 0) break;
      if (granted.has(id)) continue;
      add.push(id);
      room--;
    }
    if (add.length) {
      for (const id of add) since.set(id, now);
      setGranted((was) => new Set([...was, ...add]));
      return;
    }
    // Look again when the first turn still running runs out.
    const left = order.filter(loading).map((id) => since.get(id)! + FRAME_TURN_MS - now);
    if (!left.length) return;
    const again = window.setTimeout(() => wake((n) => n + 1), Math.max(0, Math.min(...left)) + 1);
    return () => window.clearTimeout(again);
  }, [pages, queued, asked, granted, done, since, woken]);

  return { has: useCallback((id: string) => granted.has(id), [granted]), heard };
}
