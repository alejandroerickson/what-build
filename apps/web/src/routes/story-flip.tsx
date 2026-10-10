import { useEffect } from "react";
import { IconButton } from "../ui/index.tsx";
import { isTypingTarget } from "../ui/media.ts";
import type { StoryNode } from "./story-model.ts";

export type FlipKey = "ArrowLeft" | "ArrowRight";

/** Controls that use the arrow keys themselves keep them. */
const OWNS_ARROWS = "input, select, textarea, [role=tree], [role=menu], [role=listbox], [role=radiogroup], [role=tablist], [role=slider], [role=grid]";

/**
 * The left and right arrows flip through the Story's published mockups while one is shown, in focus
 * mode or not. Not while typing, with a dialog or menu open, or when a control has used the key
 * (the page tree moves through its rows with them). Keys pressed inside the page's frame arrive
 * through the frame instead.
 */
export function useFlipKeys(onFlip: ((key: FlipKey) => void) | null) {
  useEffect(() => {
    if (!onFlip) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTypingTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest(OWNS_ARROWS)) return;
      if (document.querySelector("dialog[open], .menu")) return;
      e.preventDefault();
      onFlip(e.key);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onFlip]);
}

/** Beside the crumbs on a published mockup: where it stands among them, and the way to the ones either side. */
export function MockupFlip({ index, count, prev, next, onFlip }: { index: number; count: number; prev: StoryNode | null; next: StoryNode | null; onFlip: (key: FlipKey) => void }) {
  return (
    <div className="story-flip" role="group" aria-label="Published mockups">
      <IconButton
        size="sm"
        icon="chevron-left"
        label={prev ? `Previous mockup: ${prev.title}` : "This is the first mockup"}
        title={prev ? `${prev.title} (←)` : undefined}
        aria-keyshortcuts="ArrowLeft"
        disabled={!prev}
        onClick={() => onFlip("ArrowLeft")}
      />
      <span className="story-flip-count num" aria-live="polite">
        {index + 1} of {count}
      </span>
      <IconButton
        size="sm"
        icon="chevron-right"
        label={next ? `Next mockup: ${next.title}` : "This is the last mockup"}
        title={next ? `${next.title} (→)` : undefined}
        aria-keyshortcuts="ArrowRight"
        disabled={!next}
        onClick={() => onFlip("ArrowRight")}
      />
    </div>
  );
}
