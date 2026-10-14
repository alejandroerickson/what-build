import { useCallback, useEffect, useState } from "react";
import { Glyph, IconButton } from "../ui/index.tsx";
import { isTypingTarget } from "../ui/media.ts";
import type { StoryNode } from "./story-model.ts";

export type FlipKey = "ArrowLeft" | "ArrowRight";

/**
 * How a mockup page is shown: whole on the screen (fit, 2), or with its width filling the screen and
 * its top at the top, to scroll down through it (fill, 3). The choice holds while flipping from one
 * page to the next, and is remembered in this browser under `key`.
 */
export type PageView = "fit" | "fill";
export const PAGE_VIEW_KEYS: Record<string, PageView> = { "2": "fit", "3": "fill" };

export function usePageView(key: string, fallback: PageView): [PageView, (v: PageView) => void] {
  const [view, setView] = useState<PageView>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === "fit" || v === "fill" ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = useCallback(
    (v: PageView) => {
      setView(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        // The choice lasts for this visit.
      }
    },
    [key],
  );
  return [view, choose];
}

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

/** 2 fits a published mockup to the screen and 3 fills the screen's width with it; not while typing, or with a dialog or menu open. */
export function usePageViewKeys(onView: ((view: PageView) => void) | null) {
  useEffect(() => {
    if (!onView) return;
    const handle = (e: KeyboardEvent) => {
      const view = PAGE_VIEW_KEYS[e.key];
      if (!view || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open], .menu")) return;
      e.preventDefault();
      onView(view);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onView]);
}

/** Fit or fill, beside the crumbs on a published mockup. */
export function PageViewToggle({ view, onView }: { view: PageView; onView: (view: PageView) => void }) {
  return (
    <div className="story-flip story-page-view" role="radiogroup" aria-label="Show the page">
      <button type="button" role="radio" aria-checked={view === "fit"} className="icon-btn icon-btn-sm" onClick={() => onView("fit")} title="Fit the page to the screen (2)" aria-keyshortcuts="2">
        <Glyph name="scan" />
        <span className="visually-hidden">Fit the page to the screen</span>
      </button>
      <button type="button" role="radio" aria-checked={view === "fill"} className="icon-btn icon-btn-sm" onClick={() => onView("fill")} title="Fill the width, to scroll through the page (3)" aria-keyshortcuts="3">
        <Glyph name="move-horizontal" />
        <span className="visually-hidden">Fill the width</span>
      </button>
    </div>
  );
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
