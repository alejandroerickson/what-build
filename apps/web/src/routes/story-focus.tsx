import { useCallback, useEffect, useRef, useState } from "react";
import { useSlots } from "../shell/slots.tsx";
import { Glyph } from "../ui/index.tsx";
import { isTypingTarget, PHONE_QUERY, useMediaQuery } from "../ui/media.ts";

const FOCUS_KEY = "whatbuild.story.focus";

/** The keys a page's frame passes on: F and Esc for focus mode, the arrows for flipping through mockup pages, 2 and 3 to fit or fill one. */
export type StoryKey = "f" | "Escape" | "ArrowLeft" | "ArrowRight" | "2" | "3";

function readChoice(): "on" | "off" | null {
  try {
    const v = localStorage.getItem(FOCUS_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

function saveChoice(on: boolean) {
  try {
    localStorage.setItem(FOCUS_KEY, on ? "on" : "off");
  } catch {
    // The choice lasts for this visit.
  }
}

/**
 * Focus mode on the Story: the shell's panels step aside so the app falls away around the page.
 * The page keeps the canvas's ordinary measure, so it does not reflow on a wide screen.
 *
 * - The first time this browser opens a Story that has a page, the panels fall away on their own,
 *   with a hint that F or Esc brings them back. After that the last choice holds: someone who left
 *   focus mode sees the panels next time, and someone who stayed in it does not.
 * - F toggles it and Esc leaves it, from the app or from inside the page (the frame passes the keys
 *   on). Not while typing, with a dialog or menu open, or at phone width, where the panels are
 *   drawers already.
 * - A screen that gains more than the panels' room (a canvas takes the whole screen) offers
 *   it on a phone too (`onPhone`). There it never turns on by itself, since its hint is about keys,
 *   but the remembered choice holds.
 * - Leaving the Story ends it; the panels come back as they were.
 */
export function useStoryFocus(ready: boolean, { onPhone = false }: { onPhone?: boolean } = {}) {
  const slots = useSlots();
  const setShellFocus = slots?.setFocus;
  const focus = Boolean(slots?.focus);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const blocked = isPhone && !onPhone;
  const [hint, setHint] = useState(false);
  const decided = useRef(false);
  const last = useRef(focus);

  useEffect(() => {
    if (!ready || blocked || decided.current || !setShellFocus) return;
    decided.current = true;
    const choice = readChoice();
    if (choice === null && !isPhone) {
      setHint(true);
      setShellFocus(true);
    } else if (choice === "on") setShellFocus(true);
  }, [ready, blocked, isPhone, setShellFocus]);

  // Remember each change, including the shell's panel shortcuts ending focus mode.
  useEffect(() => {
    if (last.current === focus) return;
    last.current = focus;
    if (decided.current && !blocked) saveChoice(focus);
    if (!focus) setHint(false);
  }, [focus, blocked]);

  useEffect(() => {
    if (blocked) setShellFocus?.(false);
  }, [blocked, setShellFocus]);
  useEffect(() => () => setShellFocus?.(false), [setShellFocus]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  const available = ready && !blocked && Boolean(setShellFocus);
  const onKey = useCallback(
    (key: StoryKey) => {
      if (!available) return;
      if (key === "f") setShellFocus?.(!focus);
      else if (key === "Escape" && focus) setShellFocus?.(false);
    },
    [available, focus, setShellFocus],
  );

  useEffect(() => {
    if (!available) return;
    const handle = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open], .menu")) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        onKey("f");
      } else if (e.key === "Escape" && focus) onKey("Escape");
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [available, focus, onKey]);

  return { available, focus, hint, toggle: () => onKey("f"), onKey };
}

/** The focus mode control beside the crumbs: always there, so the mode is never a secret. */
export function FocusToggle({ focus, hint, onToggle }: { focus: boolean; hint: boolean; onToggle: () => void }) {
  return (
    <div className="story-focus">
      <p className="story-focus-hint" role="status">
        {hint ? (
          <>
            Panels hidden. <kbd>F</kbd> or <kbd>Esc</kbd> brings them back.
          </>
        ) : null}
      </p>
      <button type="button" className="btn btn-quiet btn-sm story-focus-button" onClick={onToggle} aria-keyshortcuts="F">
        <Glyph name={focus ? "minimize" : "maximize"} />
        {focus ? "Show panels" : "Focus"}
        <kbd className="story-focus-kbd">F</kbd>
      </button>
    </div>
  );
}
