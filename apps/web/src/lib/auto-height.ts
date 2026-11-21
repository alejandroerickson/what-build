import { nextAutoHeight } from "@whatbuild/core/page-sandbox";
import { useCallback, useRef } from "react";

/**
 * What a frame showing a mockup page whose height is "auto" does with the heights its document
 * reports (`page-height`, from the frame script once the frame asks with `measure-height`): grows to
 * each, as nextAutoHeight says, by calling `grow`, and stops once the page grows with its frame, as
 * one sized in vh does. `from` names what the frame shows (its address): what was learnt of one page
 * is forgotten when the frame shows another. Returns what the frame's message listener calls with a
 * report.
 */
export function useAutoHeight(auto: boolean, frameHeight: number, grow: (height: number) => void, from: string) {
  const last = useRef<{ from: number; to: number; reported: number; at: number } | null>(null);
  const stopped = useRef(false);
  const shown = useRef(from);
  if (shown.current !== from) {
    shown.current = from;
    last.current = null;
    stopped.current = false;
  }
  return useCallback(
    (reported: unknown) => {
      if (!auto || stopped.current || typeof reported !== "number" || !Number.isFinite(reported)) return;
      // A report may come before the frame is drawn at the height it was last given.
      const frame = Math.max(frameHeight, last.current?.to ?? 0);
      const now = performance.now();
      const next = nextAutoHeight(frame, reported, last.current, now);
      if (!next) return;
      if (next.stop) {
        stopped.current = true;
        return;
      }
      last.current = { from: frame, to: next.height, reported, at: now };
      grow(next.height);
    },
    [auto, frameHeight, grow],
  );
}
