import { MOCKUP_PAGE_SANDBOX } from "@whatbuild/core/page-sandbox";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";
import { plural } from "../lib/format.ts";
import { SAYS_LOADED_WITHIN_MS, tryStoppedFramesAgain, useFrameReturn, useMinuteWait } from "../lib/minute.ts";
import { useProduct } from "../lib/session.tsx";
import { Button, Callout, Glyph, keepFocusAt, Menu, MenuItem, MenuNote, MenuRadio, MenuSeparator, useToast } from "../ui/index.tsx";
import { COARSE_POINTER_QUERY, isTypingTarget, useMediaQuery } from "../ui/media.ts";
import { wheelZoomFactor } from "./mockup-wheel-zoom.ts";
import { pageMoves, personActed } from "./page-moves.ts";
import type { PageView } from "./story-flip.tsx";
import "../styles/screens/story.css";
import "../styles/screens/mockups.css";

/**
 * A mockup's canvas: every page at its own size with its label above it, to pan and zoom around.
 * Exploration shows it for the team, and a Story page that shows a whole canvas shows it to readers,
 * each with the pages' addresses its reader may use.
 */

export interface CanvasPage {
  page_id: string;
  title: string;
  width: number;
  height: number;
  /** A page with HTML of its own. */
  html_sha256?: string;
  html_path?: string;
  /** A page that enters the version's prototype: the path (with a query and fragment) and its frame's address. */
  entry?: string | null;
  poster?: string | null;
  prototype_url?: string | null;
}

/** A version's prototype address, a capability that lasts until expires_at. */
export interface PrototypeAddress {
  base_url: string;
  expires_at: string;
  /** What the frame's sandbox attribute must say, as the server's policy does. */
  sandbox: string;
}

/** What the canvas draws of a mockup version. */
export interface CanvasVersion {
  version: number;
  title: string;
  columns: number | null;
  pages: CanvasPage[];
  prototype?: PrototypeAddress | null;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
/** World pixels between pages: room for each page's label above it at ordinary zooms. */
const GAP_X = 120;
const GAP_Y = 160;
const MODE_KEY = "whatbuild.mockup.mode";
/** How long before a link to no page says so again. */
const NO_PAGE_SAID_EVERY_MS = 4000;

type Mode = "pan" | "interact";

interface View {
  x: number;
  y: number;
  z: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * A drag or a pinch on the board, in client pixels. It moves the view by what changed since the
 * last move, never from where it began, so a finger joining or leaving a pinch carries on from
 * where the fingers are instead of jumping.
 */
interface Gesture {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  /** The page a press began on, which a click without a drag selects. */
  page: string | null;
  /** Two fingers down: how far apart they were and where their midpoint was, at the last move. */
  pinch?: { d: number; x: number; y: number };
}

/** The first two pointers down: their distance and midpoint, or null with fewer than two. */
function pinchOf(pointers: Map<number, { x: number; y: number }>): { d: number; x: number; y: number } | null {
  const [a, b] = [...pointers.values()];
  return a && b ? { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "interact" ? "interact" : "pan";
  } catch {
    return "pan";
  }
}

/** What a page's frame tells the canvas: a key pressed or let go inside it, a pinch over it, a press on it. */
type FrameSignal =
  | { kind: "key"; key: string }
  | { kind: "keyup"; key: string }
  | { kind: "zoom"; clientX: number; clientY: number; dy: number; line: boolean; pinch: boolean }
  | { kind: "select" }
  | { kind: "follow"; page: string; hash: string };

/** The keys a page's frame passes on to the canvas: focus mode's, the arrows, and the canvas's own. */
const FRAME_KEYS = new Set(["f", "Escape", "ArrowLeft", "ArrowRight", " ", "h", "H", "v", "V", "0", "1", "2", "3", "+", "=", "-", "_"]);

/** What a page says in place of its frame while it comes back, waits, or has stopped reloading. */
const HELD_WORDS = {
  coming: "This page is coming back.",
  reloading: "This page keeps reloading. It comes back with the next minute.",
  "reloading-stopped": "This page keeps reloading, so WhatBuild stopped bringing it back.",
};

/**
 * One page in its sandbox, at its own size. The frame is the Story's: the same sandbox, and the
 * frame script that opens links in a new tab. Told it is on a canvas, the script passes on the
 * canvas's keys, Space, a pinch and a press, so the canvas works the same once someone is inside a
 * page. A page that loads another address in its place is put back. In pan mode the frame takes no
 * pointer, so a click selects the page and a drag moves the canvas.
 *
 * Every document WhatBuild frames says it has loaded (frame-ready, from the frame script, at its
 * load event), and a load that does not say so within a moment is put back: a page that sends its
 * frame elsewhere while it is still loading never gets that far. A second load of a page's frame is
 * put back at once, whatever it says. A page that enters a prototype moves between the prototype's
 * documents inside its frame, so there a second load is not a replacement when it says so too.
 *
 * A page refused for the minute's calls gets a short document that says so and tells the canvas,
 * and comes back the way a page is put back: as a new frame, whose first load is its first. A second
 * load of one frame is never let through, whatever a page says of itself. Each new frame is a call,
 * so a page that keeps being replaced waits for the next minute with no frame on show, and in time
 * stops until the person says to (useFrameReturn). A prototype's frames cost no calls, and meet none of that.
 *
 * A link to another page of the canvas comes here as that page's name, and the canvas checks it. A
 * new `visit` opens the page afresh, as following a link to a file in a folder does.
 */
function PageFrame({ page, src, title, selected, onSignal, frameRef, prototype, entries, visit, takeHash }: {
  page: CanvasPage;
  src: string;
  title: string;
  selected: boolean;
  onSignal: (pageId: string, s: FrameSignal) => void;
  frameRef: (el: HTMLDivElement | null) => void;
  /** Set for a page that enters the version's prototype: the sandbox its frame takes. */
  prototype?: { sandbox: string } | null;
  /** The prototype's documents that canvas pages enter, by path, so a link to one moves to its page. */
  entries: Record<string, string> | null;
  visit: number;
  /** The place within this page that a link just named, once it has loaded. */
  takeHash: (pageId: string) => string | null;
}) {
  const { app } = useProduct();
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const ready = useRef(false);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reloads, setReloads] = useState(0);
  // The sandboxed page has an opaque origin, so the message cannot be addressed to one.
  const hello = useCallback(() => {
    const others = entries ? Object.fromEntries(Object.entries(entries).filter(([, id]) => id !== page.page_id)) : null;
    frame.current?.contentWindow?.postMessage({ whatbuild: "canvas-host", ...(others ? { entries: others } : {}) }, "*");
    frame.current?.contentWindow?.postMessage({ whatbuild: "app-home", home: `${window.location.origin}${app}` }, "*");
    const hash = takeHash(page.page_id);
    if (hash) frame.current?.contentWindow?.postMessage({ whatbuild: "canvas-hash", hash }, "*");
  }, [app, entries, page.page_id, takeHash]);
  const newFrame = useCallback(() => {
    ready.current = false;
    loads.current = 0;
    if (waiting.current) clearTimeout(waiting.current);
    waiting.current = null;
    setReloads((n) => n + 1);
  }, []);
  const { stopped, asking, reloading, wasReplaced, replaced: putBack } = useFrameReturn(frame, newFrame, !prototype);
  const visited = useRef(visit);
  useEffect(() => {
    if (visited.current === visit) return;
    visited.current = visit;
    newFrame();
  }, [visit, newFrame]);
  useEffect(() => () => {
    if (waiting.current) clearTimeout(waiting.current);
  }, []);
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      const el = frame.current;
      if (!el || e.source !== el.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; key?: unknown; x?: unknown; y?: unknown; dy?: unknown; line?: unknown; pinch?: unknown; page?: unknown; hash?: unknown } | null;
      if (data?.whatbuild === "frame-ready") {
        if (waiting.current) {
          clearTimeout(waiting.current);
          waiting.current = null;
          hello();
        } else ready.current = true;
        return;
      }
      if (data?.whatbuild === "story-key" && typeof data.key === "string" && FRAME_KEYS.has(data.key)) onSignal(page.page_id, { kind: "key", key: data.key });
      else if (data?.whatbuild === "canvas-keyup" && data.key === " ") onSignal(page.page_id, { kind: "keyup", key: " " });
      else if (data?.whatbuild === "canvas-select") onSignal(page.page_id, { kind: "select" });
      else if (data?.whatbuild === "canvas-page" && typeof data.page === "string") onSignal(page.page_id, { kind: "follow", page: data.page, hash: typeof data.hash === "string" ? data.hash : "" });
      else if (data?.whatbuild === "canvas-zoom" && typeof data.x === "number" && typeof data.y === "number" && typeof data.dy === "number" && Number.isFinite(data.x + data.y + data.dy)) {
        // The page reports its own pixels; the frame is drawn at the canvas's zoom.
        const r = el.getBoundingClientRect();
        const scale = r.width / page.width;
        onSignal(page.page_id, { kind: "zoom", clientX: r.left + data.x * scale, clientY: r.top + data.y * scale, dy: data.dy, line: data.line === true, pinch: data.pinch === true });
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onSignal, page.page_id, page.width, prototype, hello]);
  return (
    <div ref={frameRef} className="xc-frame" data-page={page.page_id} data-selected={selected ? "" : undefined} style={{ width: page.width, height: page.height }}>
      {stopped || reloading ? (
        // At the page's own scale, so it still reads with the canvas zoomed out. Try again is above the board at screen size.
        <p className="xc-refused" style={{ fontSize: Math.max(20, page.width * 0.032) }}>
          {asking ? HELD_WORDS.coming : reloading ? HELD_WORDS[reloading] : "This page didn’t come back."}
        </p>
      ) : (
        <iframe
          key={reloads}
          ref={frame}
          title={title}
          width={page.width}
          height={page.height}
          loading="lazy"
          sandbox={prototype?.sandbox ?? MOCKUP_PAGE_SANDBOX}
          referrerPolicy="no-referrer"
          src={prototype ? src : `${src}?frame=1`}
          onLoad={() => {
            loads.current += 1;
            if (!prototype && loads.current > 1) {
              putBack();
              return;
            }
            // The document has said it is one of WhatBuild's already, or will in a moment. A load before is judged no more.
            if (waiting.current) clearTimeout(waiting.current);
            waiting.current = null;
            if (ready.current) {
              ready.current = false;
              hello();
            } else waiting.current = setTimeout(() => {
              waiting.current = null;
              putBack();
            }, SAYS_LOADED_WITHIN_MS);
          }}
        />
      )}
      {wasReplaced && !reloading ? <p className="xc-replaced">This page tried to open another address in its place. WhatBuild put it back.</p> : null}
    </div>
  );
}

/**
 * What the board says of pages waiting or stopped, at screen size above them, however far the canvas
 * is zoomed out: refused for the minute's calls, or reloading too often to bring back at once. Try
 * again goes with the note when it is pressed, so focus stays with the board the pages come back to.
 * A region mounted with the app announces all of it (MinuteAnnouncer), since this comes and goes with its words.
 */
function PagesNote({ board }: { board: RefObject<HTMLElement | null> }) {
  const wait = useMinuteWait();
  if (!wait.frames && !wait.stopped && !wait.reloading && !wait.reloadingStopped) return null;
  const tryAgain = () => {
    keepFocusAt(board.current);
    tryStoppedFramesAgain();
  };
  const action = <Button size="sm" onClick={tryAgain}>Try again</Button>;
  const keep = (n: number) => `${plural(n, "page")} keep${n === 1 ? "s" : ""} reloading`;
  return (
    <div className="xc-note">
      {wait.stopped ? (
        <Callout tone="attention" title={`${plural(wait.stopped, "page")} didn’t come back`} action={action}>
          Your calls a minute keep running out, so WhatBuild stopped asking.
        </Callout>
      ) : wait.frames && wait.waiting ? (
        <Callout title="Waiting for the next minute">You’ve used this minute’s calls. These pages come back by themselves.</Callout>
      ) : wait.frames ? (
        <Callout title="Bringing these pages back">A few at a time, so this minute’s calls last.</Callout>
      ) : null}
      {wait.reloadingStopped ? (
        <Callout tone="attention" title={keep(wait.reloadingStopped)} action={wait.stopped ? undefined : action}>
          Each time costs one of your calls a minute, so WhatBuild stopped bringing {wait.reloadingStopped === 1 ? "it" : "them"} back.
        </Callout>
      ) : wait.reloading ? (
        <Callout title={keep(wait.reloading)}>{wait.reloading === 1 ? "It comes" : "They come"} back with the next minute.</Callout>
      ) : null}
    </div>
  );
}

/**
 * The pages in a grid of `columns` (one row when null), drawn at their own size and scaled as a
 * whole, with each page's label drawn at screen size above it so it reads at any zoom.
 *
 * - Pan mode (the hand, H): a drag anywhere moves the canvas and a click selects a page. Interact
 *   mode (the pointer, V): the pages take the pointer, so their links, buttons and scrolling work;
 *   a drag on the background still moves the canvas, and a press on a page selects it. Holding Space
 *   pans from either mode, from inside a page too.
 * - Scroll moves the canvas up and down, Shift+scroll sideways; ⌘ or Ctrl with scroll, or a pinch,
 *   zooms about the pointer, over a page in interact mode too. In interact mode, scrolling over a
 *   page scrolls the page.
 * - On a touch screen one finger drags and two pinch, the point under them staying under them; a
 *   finger lifting from a pinch leaves the other dragging from where it is. The toolbar's controls
 *   grow for a thumb, and the zoom buttons and the list of keys give way.
 * - A link from one page to another flies the view to the page it names; the page clicked stays as
 *   it was. Viewed as a clickable prototype (`clickable`), only the selected page shows, at its own
 *   size or smaller, and a link changes it in place, opening it afresh as a link to a file in a folder
 *   does. There the toolbar keeps only what moves between and shows pages.
 * - + and − zoom, 0 shows 100%, 1 fits the canvas, 2 fits the selected page (or the one nearest the
 *   middle) to the screen, and 3 fills the screen's width with it, its top at the top, to scroll
 *   down through it. ← and → select the previous or next page and show it the way 2 or 3 last did.
 *   Each page's label has its own fit button, and the toolbar has fit and fill, the arrows and a list
 *   of every key. A page's frame passes these keys on, so they work from inside a page.
 */
export function Canvas({ version, pageSrc, selected, onSelect: selectPage, onKey, canFocus, pageView, onPageView, clickable = false, onFollow, onDownloadPage }: {
  version: CanvasVersion;
  pageSrc: (page: CanvasPage) => string;
  selected: string | null;
  onSelect: (pageId: string | null) => void;
  onKey: (k: "f" | "Escape") => void;
  /** Whether focus mode is on offer here, so the list of keys names it. */
  canFocus: boolean;
  /** Fit or fill: how a page is shown when the arrows or the inspector select it. */
  pageView: PageView;
  onPageView: (v: PageView) => void;
  /** Viewed as a clickable prototype: one page at a time. */
  clickable?: boolean;
  /** A link was followed to this page: unlike a selection, it is a step the browser's Back returns from. */
  onFollow?: (pageId: string) => void;
  /** Where a page's label offers to download the page. */
  onDownloadPage?: (page: CanvasPage) => void;
}) {
  const toast = useToast();
  // The page this canvas last asked to select, so it can tell when the selection changed by another way.
  const asked = useRef(selected);
  const onSelect = useCallback(
    (pageId: string | null) => {
      asked.current = pageId;
      selectPage(pageId);
    },
    [selectPage],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<string, HTMLDivElement>());
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 0.25 });
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [mode, setModeState] = useState<Mode>(readMode);
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [gliding, setGliding] = useState(false);
  // Whether the view is being moved by hand, until it has kept still a moment.
  const [moving, setMoving] = useState(false);
  const settle = useRef<number | undefined>(undefined);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Fingers pinch to zoom and carry no keyboard: the toolbar gives up its zoom buttons and the list
  // of keys for room to make its controls big enough for a thumb.
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const touched = useRef(false);
  // Where the board's corner was on the screen when it last changed size.
  const boardAt = useRef<{ left: number; top: number } | null>(null);
  // The page last shown fitted or filling the width, kept so while the window changes until someone moves it.
  const following = useRef<{ id: string; how: PageView } | null>(null);
  const moved = useCallback(() => {
    touched.current = true;
    following.current = null;
  }, []);
  const columns = Math.max(1, version.columns ?? version.pages.length);
  const panning = space || (!clickable && mode === "pan");
  // Read when the view moves, so the calls that move it stay the same across the switch.
  const asPrototype = useRef(clickable);
  asPrototype.current = clickable;
  const [visits, setVisits] = useState<Record<string, number>>({});
  const saidNoPage = useRef(-Infinity);
  const [mayMove] = useState(() => pageMoves());
  // Set in the render that switches the view, so the pages' fade is in place before they change.
  const [folding, setFolding] = useState(false);
  const [viewWas, setViewWas] = useState(clickable);
  if (viewWas !== clickable) {
    setViewWas(clickable);
    setFolding(true);
  }
  useEffect(() => {
    if (!folding) return;
    const done = window.setTimeout(() => setFolding(false), 220);
    return () => window.clearTimeout(done);
  }, [folding]);
  const hashes = useRef(new Map<string, string>());
  const takeHash = useCallback((pageId: string) => {
    const hash = hashes.current.get(pageId) ?? null;
    hashes.current.delete(pageId);
    return hash;
  }, []);
  const entries = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of version.pages) {
      if (!p.entry) continue;
      const path = p.entry.split(/[?#]/)[0]!;
      try {
        out[decodeURIComponent(path)] ??= p.page_id;
      } catch {
        // An entry the server would have refused to serve leads nowhere.
      }
    }
    return Object.keys(out).length ? out : null;
  }, [version.pages]);

  /**
   * Marks the view as moving by hand, and as settled once it keeps still. Only while it moves is the
   * board its own layer: kept as one, Chrome keeps drawing it at the largest zoom it was shown at, so
   * after zooming far in and back out a phone runs out of graphics memory, and a panel that opens
   * over the board, the toolbar and the labels are not drawn at all.
   */
  const nudge = useCallback(() => {
    setMoving(true);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setMoving(false), 200);
  }, []);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // The choice lasts for this visit.
    }
  }, []);

  // Where each page sits in the world, read once its layout settles; zoom never changes it.
  useLayoutEffect(() => {
    const next: Record<string, Box> = {};
    frames.current.forEach((el, id) => {
      next[id] = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    });
    setBoxes(next);
  }, [version.version, version.pages, columns]);

  const glide = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(glide.current), []);

  /** Move to a view, gliding there unless the person prefers less motion. */
  const go = useCallback(
    (v: View) => {
      if (!reduceMotion) {
        setGliding(true);
        window.clearTimeout(glide.current);
        glide.current = window.setTimeout(() => setGliding(false), 220);
      }
      setView(v);
    },
    [reduceMotion],
  );

  const fitBox = useCallback(
    (b: Box | undefined, glide = true) => {
      const vp = viewport.current;
      if (!vp || !b || !b.width) return;
      const pad = 48;
      // As a clickable prototype a page has no label above it, the toolbar under it, and never grows past its own size.
      const room = asPrototype.current ? { side: 16, top: 16, bottom: 64, most: 1 } : { side: pad, top: pad + 24, bottom: pad, most: MAX_ZOOM };
      const z = clamp(Math.min(room.most, (vp.clientWidth - room.side * 2) / b.width, (vp.clientHeight - room.top - room.bottom) / b.height));
      const v = { z, x: (vp.clientWidth - b.width * z) / 2 - b.left * z, y: room.top + (vp.clientHeight - room.top - room.bottom - b.height * z) / 2 - b.top * z };
      if (glide) go(v);
      else setView(v);
    },
    [go],
  );
  /** The box's width filling the screen and its top at the top, room left for its label above it. */
  const fillBox = useCallback(
    (b: Box | undefined, glide = true) => {
      const vp = viewport.current;
      if (!vp || !b || !b.width) return;
      const pad = asPrototype.current ? 16 : 48;
      const z = clamp((vp.clientWidth - pad * 2) / b.width);
      const v = { z, x: (vp.clientWidth - b.width * z) / 2 - b.left * z, y: (asPrototype.current ? pad : pad + 24) - b.top * z };
      if (glide) go(v);
      else setView(v);
    },
    [go],
  );
  const worldBox = useCallback((): Box | undefined => {
    const w = world.current;
    return w ? { left: 0, top: 0, width: w.offsetWidth, height: w.offsetHeight } : undefined;
  }, []);
  const fitCanvas = useCallback((glide = true) => fitBox(worldBox(), glide), [fitBox, worldBox]);
  /** Selects a page and shows it fitted or filling the width; the way the arrows show pages, unless said. */
  const showPage = useCallback(
    (id: string | null, how: PageView = pageView) => {
      if (!id) return;
      touched.current = true;
      following.current = { id, how };
      onSelect(id);
      // As a clickable prototype, a new page is placed once it is selected (below).
      if (asPrototype.current && id !== selected) return;
      if (how === "fill") fillBox(boxes[id]);
      else fitBox(boxes[id]);
    },
    [boxes, fitBox, fillBox, onSelect, pageView, selected],
  );
  // The view as last drawn, for what reads it only when asked, so a drag does not remake them.
  const shownView = useRef(view);
  useLayoutEffect(() => {
    shownView.current = view;
  }, [view]);
  /** The page whose middle is nearest the middle of the screen: what "fit the page" means with none selected. */
  const middlePage = useCallback((): string | null => {
    const vp = viewport.current;
    if (!vp) return null;
    const v = shownView.current;
    const cx = (vp.clientWidth / 2 - v.x) / v.z;
    const cy = (vp.clientHeight / 2 - v.y) / v.z;
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, b] of Object.entries(boxes)) {
      const d = Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }, [boxes]);
  /** Fit (2) or fill (3) the selected page, or the one in the middle, and show the next ones the same way. */
  const showShown = useCallback(
    (how: PageView) => {
      onPageView(how);
      showPage(selected ?? middlePage(), how);
    },
    [onPageView, showPage, selected, middlePage],
  );
  const fitShown = useCallback(() => showShown("fit"), [showShown]);
  const fillShown = useCallback(() => showShown("fill"), [showShown]);

  // Fit the whole canvas when a version opens, and keep it fitted while the window changes until
  // someone moves it. Once they have, the pages stay where they are on the screen when the board's
  // edges move, as they do when a panel hides or focus mode begins and ends.
  useLayoutEffect(() => {
    touched.current = false;
    following.current = null;
    fitCanvas(false);
  }, [version.version, fitCanvas]);
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      const { left, top } = vp.getBoundingClientRect();
      const was = boardAt.current;
      boardAt.current = { left, top };
      const shown = following.current;
      if (shown) (shown.how === "fill" ? fillBox : fitBox)(boxes[shown.id], false);
      else if (!touched.current) fitCanvas(false);
      // Drawn before this frame paints: a later render would show the pages slid for a frame.
      else if (was && (was.left !== left || was.top !== top)) flushSync(() => setView((v) => ({ ...v, x: v.x + was.left - left, y: v.y + was.top - top })));
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fitCanvas, fitBox, fillBox, boxes]);
  // Folding into a clickable prototype glides to the selected page as the others fade, and unfolding
  // glides back out. Within it a new page takes the place at once, and opens afresh.
  const placed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!clickable) {
      if (placed.current === null) return;
      placed.current = null;
      touched.current = false;
      following.current = null;
      fitCanvas();
      return;
    }
    const b = selected ? boxes[selected] : undefined;
    if (!selected || !b || placed.current === selected) return;
    const folding = placed.current === null;
    placed.current = selected;
    touched.current = true;
    following.current = { id: selected, how: pageView };
    (pageView === "fill" ? fillBox : fitBox)(b, folding);
    if (!folding) setVisits((v) => ({ ...v, [selected]: (v[selected] ?? 0) + 1 }));
  }, [clickable, selected, boxes, pageView, fitBox, fillBox, fitCanvas]);
  // A selection this canvas did not make, such as the browser's Back after following a link, takes the view with it.
  useEffect(() => {
    if (asked.current === selected) return;
    asked.current = selected;
    if (clickable || !selected) return;
    following.current = { id: selected, how: pageView };
    (pageView === "fill" ? fillBox : fitBox)(boxes[selected]);
    // Only a change of page moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number, glide = false) => {
    const vp = viewport.current;
    if (!vp) return;
    moved();
    const apply = (v: View) => {
      const z = clamp(v.z * factor);
      const px = cx ?? vp.clientWidth / 2;
      const py = cy ?? vp.clientHeight / 2;
      return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
    };
    if (glide) go(apply(view));
    else setView(apply);
  }, [go, view]);

  /** A pinch, or ⌘ or Ctrl with scroll, zooms about the pointer. */
  const wheelZoom = useCallback(
    (dy: number, line: boolean, pinch: boolean, clientX: number, clientY: number) => {
      const r = viewport.current?.getBoundingClientRect();
      if (!r) return;
      nudge();
      zoomAt(wheelZoomFactor(dy, line, pinch), clientX - r.left, clientY - r.top);
    },
    [zoomAt, nudge],
  );

  // The wheel needs a listener that is not passive, so it can keep the page behind from scrolling.
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        wheelZoom(e.deltaY, e.deltaMode === 1, e.ctrlKey && !e.metaKey, e.clientX, e.clientY);
        return;
      }
      moved();
      nudge();
      const step = e.deltaMode === 1 ? 16 : 1;
      const dx = (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * step;
      const dy = (e.shiftKey ? 0 : e.deltaY) * step;
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    };
    vp.addEventListener("wheel", wheel, { passive: false });
    return () => vp.removeEventListener("wheel", wheel);
  }, [wheelZoom, nudge]);

  /** Selects the page before or after the selected one and shows it as the last one was; with none selected, the first or the last. */
  const step = useCallback(
    (by: -1 | 1) => {
      const pages = version.pages;
      const at = pages.findIndex((p) => p.page_id === selected);
      const next = at < 0 ? (by > 0 ? 0 : pages.length - 1) : at + by;
      const page = pages[next];
      if (page) showPage(page.page_id);
    },
    [version.pages, selected, showPage],
  );
  const selectedIndex = version.pages.findIndex((p) => p.page_id === selected);

  /** The canvas's keys, pressed in the app or inside a page. False when the key is not one of them here. */
  const press = useCallback(
    (k: string): boolean => {
      // As a clickable prototype the keys that move between and show pages are all there is.
      if (clickable && k !== "2" && k !== "3" && k !== "ArrowLeft" && k !== "ArrowRight") return false;
      if (k === "h" || k === "H") setMode("pan");
      else if (k === "v" || k === "V") setMode("interact");
      else if (k === "+" || k === "=") zoomAt(1.25, undefined, undefined, true);
      else if (k === "-" || k === "_") zoomAt(0.8, undefined, undefined, true);
      else if (k === "0") zoomAt(1 / view.z, undefined, undefined, true);
      else if (k === "1") {
        moved();
        fitCanvas();
      } else if (k === "2") fitShown();
      else if (k === "3") fillShown();
      else if (k === "ArrowLeft") step(-1);
      else if (k === "ArrowRight") step(1);
      // The first Esc clears the selection; only the next leaves focus mode.
      else if (k === "Escape" && selected) onSelect(null);
      else return false;
      return true;
    },
    [clickable, setMode, zoomAt, view.z, fitCanvas, fitShown, fillShown, selected, step, onSelect],
  );

  /** A link inside a page: the app checks the name it sent against this version's pages, and goes nowhere else. */
  const follow = (from: string, s: { page: string; hash: string }) => {
    // A script with nobody behind it moves nothing, or it could flip pages forever and spend the
    // person's calls, and a page that is not showing has nothing to ask for.
    if (!personActed() || (clickable && from !== selected)) return;
    if (!version.pages.some((p) => p.page_id === s.page)) {
      // In the app's own words, never the page's: whatever a page sends could be made to read as
      // WhatBuild talking. Not again for a while, so a script cannot stack these over the screen.
      const at = Date.now();
      if (at - saidNoPage.current > NO_PAGE_SAID_EVERY_MS) {
        saidNoPage.current = at;
        toast("This link leads to a page that isn’t on this canvas.", { tone: "negative" });
      }
      return;
    }
    const inFrame = () => frames.current.get(s.page)?.querySelector("iframe")?.contentWindow;
    // Already there: a place within the page at most, and never a step for Back.
    if (s.page === from || s.page === selected) {
      if (s.hash) inFrame()?.postMessage({ whatbuild: "canvas-hash", hash: s.hash }, "*");
      return;
    }
    if (!mayMove()) return;
    // For a page still to load; one already open is told now.
    if (s.hash) hashes.current.set(s.page, s.hash);
    asked.current = s.page;
    if (clickable) {
      (onFollow ?? onSelect)(s.page);
      return;
    }
    if (s.hash) inFrame()?.postMessage({ whatbuild: "canvas-hash", hash: s.hash }, "*");
    touched.current = true;
    following.current = { id: s.page, how: pageView };
    (onFollow ?? onSelect)(s.page);
    (pageView === "fill" ? fillBox : fitBox)(boxes[s.page]);
  };

  /** What a page's frame passes on: the same keys, Space held, a pinch, a press that selects the page. */
  const handleSignal = (pageId: string, s: FrameSignal) => {
    if (s.kind === "keyup") setSpace(false);
    else if (s.kind === "follow") follow(pageId, s);
    else if (s.kind === "select") {
      if (pageId !== selected) onSelect(pageId);
    } else if (s.kind === "zoom") wheelZoom(s.dy, s.line, s.pinch, s.clientX, s.clientY);
    else if (document.querySelector("dialog[open], .menu")) return;
    else if (s.key === " ") setSpace(true);
    // A page's arrow moves between pages, so a page's script is held as a link is.
    else if ((s.key === "ArrowLeft" || s.key === "ArrowRight") && ((clickable && pageId !== selected) || !mayMove())) return;
    else if (!press(s.key) && (s.key === "f" || s.key === "Escape")) onKey(s.key);
  };
  // The frames hold one listener that never changes, so moving the view leaves them alone.
  const signal = useRef(handleSignal);
  useLayoutEffect(() => {
    signal.current = handleSignal;
  });
  const onSignal = useCallback((pageId: string, s: FrameSignal) => signal.current(pageId, s), []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector("dialog[open], .menu")) return;
      const k = e.key;
      if (k === " ") {
        // Space presses a focused control; it pans only from the canvas or the page around it.
        if (e.target instanceof Element && e.target.closest("button, a[href], summary, select, [role=button], [role=menuitem], [role=menuitemradio], [role=radio], [role=tab]")) return;
        e.preventDefault();
        setSpace(true);
      } else if (press(k) && (k === "Escape" || k === "ArrowLeft" || k === "ArrowRight")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpace(false);
    };
    const blur = () => setSpace(false);
    // Captured, so the canvas sees a key before focus mode's own listener does.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [press]);

  const pageAt = (target: EventTarget | null) => (target instanceof HTMLElement ? (target.closest<HTMLElement>(".xc-frame")?.dataset["page"] ?? null) : null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest(".xc-label, .xc-tools")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // A hand on the board stops a glide, so the view follows the fingers at once.
    setGliding(false);
    const pinch = pinchOf(pointers.current);
    if (pinch) {
      // A second finger turns the gesture into a pinch, which never selects.
      gesture.current = { startX: pinch.x, startY: pinch.y, lastX: pinch.x, lastY: pinch.y, moved: true, page: null, pinch };
      return;
    }
    gesture.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, page: pageAt(e.target) };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.pinch) {
      const now = pinchOf(pointers.current);
      const r = viewport.current?.getBoundingClientRect();
      if (!now || !r) return;
      const was = g.pinch;
      g.pinch = now;
      const factor = was.d > 0 ? now.d / was.d : 1;
      moved();
      nudge();
      // The point of the page under the fingers' midpoint stays under it as they spread and move.
      setView((v) => {
        const z = clamp(v.z * factor);
        return { z, x: now.x - r.left - ((was.x - r.left - v.x) * z) / v.z, y: now.y - r.top - ((was.y - r.top - v.y) * z) / v.z };
      });
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) return;
    if (!g.moved) {
      g.moved = true;
      moved();
      setDragging(true);
    }
    nudge();
    const dx = e.clientX - g.lastX;
    const dy = e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size === 0) {
      // A click without a drag selects the page under it, or clears the selection on the background.
      if (g && !g.moved && !clickable) onSelect(g.page);
      gesture.current = null;
      setDragging(false);
      return;
    }
    if (!g) return;
    // A finger lifted: what is still down carries on from where it is, as a pinch or a drag.
    const pinch = pinchOf(pointers.current);
    if (pinch) g.pinch = pinch;
    else {
      const [p] = [...pointers.current.values()];
      g.pinch = undefined;
      g.lastX = p!.x;
      g.lastY = p!.y;
    }
  };

  // The pages do not change as the view moves, so a drag or a pinch re-renders only the transform
  // and the labels, never the frames.
  const pageFrames = useMemo(
    () =>
      version.pages.map((p) => (
        <PageFrame
          key={p.page_id}
          page={p}
          src={pageSrc(p)}
          prototype={p.prototype_url && version.prototype ? { sandbox: version.prototype.sandbox } : null}
          title={p.title}
          selected={p.page_id === selected}
          onSignal={onSignal}
          entries={entries}
          visit={visits[p.page_id] ?? 0}
          takeHash={takeHash}
          frameRef={(el) => {
            if (el) frames.current.set(p.page_id, el);
            else frames.current.delete(p.page_id);
          }}
        />
      )),
    [version.pages, version.prototype, pageSrc, selected, onSignal, entries, visits, takeHash],
  );

  const worldStyle: CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
    gridTemplateColumns: `repeat(${columns}, max-content)`,
    columnGap: GAP_X,
    rowGap: GAP_Y,
  };
  const pct = Math.round(view.z * 100);

  return (
    <div className="xc">
      <div
        ref={viewport}
        className="xc-viewport"
        data-mode={panning ? "pan" : "interact"}
        data-view={clickable ? "clickable" : undefined}
        data-folding={folding ? "" : undefined}
        data-dragging={dragging ? "" : undefined}
        data-gliding={gliding ? "" : undefined}
        data-moving={moving ? "" : undefined}
        role="region"
        aria-roledescription="canvas"
        aria-label={`${version.title}: ${plural(version.pages.length, "page")}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={world} className="xc-world" style={worldStyle}>
          {pageFrames}
        </div>
        {/* The selected page's outline, drawn at screen size over it, so it keeps its width at any
            zoom and the pages never redraw as the view zooms. */}
        {!clickable && selected && boxes[selected] ? (
          <div
            className="xc-ring"
            aria-hidden="true"
            style={{
              transform: `translate(${view.x + boxes[selected].left * view.z}px, ${view.y + boxes[selected].top * view.z}px)`,
              width: boxes[selected].width * view.z,
              height: boxes[selected].height * view.z,
            }}
          />
        ) : null}
        {/* Labels sit above their pages at screen size, so a page's name reads at any zoom. They
            move together, so a drag moves one layer and redraws nothing. */}
        {clickable ? null : <ol className="xc-labels" aria-label="Pages" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
          {version.pages.map((p, i) => {
            const b = boxes[p.page_id];
            if (!b) return null;
            // A label may run into the gap after its page, so a narrow page still shows its title.
            const w = b.width * view.z + GAP_X * view.z - 8;
            return (
              <li
                key={p.page_id}
                className="xc-label"
                data-selected={p.page_id === selected ? "" : undefined}
                data-narrow={w < 200 ? "" : undefined}
                data-tiny={w < 72 ? "" : undefined}
                data-cramped={w < 42 ? "" : undefined}
                style={{ transform: `translate(${b.left * view.z}px, ${b.top * view.z}px)`, width: Math.max(w, 28) }}
              >
                {/* Named for the page, whatever the zoom leaves room to show. */}
                <button type="button" className="xc-label-name" onClick={() => onSelect(p.page_id)} aria-label={p.title} aria-pressed={p.page_id === selected} title={`${p.title} · ${p.width} × ${p.height}`}>
                  <span className="xc-label-n num">{i + 1}</span>
                  <span className="xc-label-title ellipsis">{p.title}</span>
                  <span className="xc-label-size num">
                    {p.width} × {p.height}
                  </span>
                </button>
                <button
                  type="button"
                  className="xc-label-fit"
                  onClick={() => {
                    onPageView("fit");
                    showPage(p.page_id, "fit");
                  }}
                  aria-label={`Fit ${p.title} to the screen`}
                  title="Fit to the screen (2)"
                >
                  <Glyph name="scan" size="sm" />
                </button>
                {/* A page that enters a prototype has no document of its own to give. */}
                {onDownloadPage && p.html_path ? (
                  <button type="button" className="xc-label-fit" onClick={() => onDownloadPage(p)} aria-label={`Download ${p.title}`} title="Download this page">
                    <Glyph name="download" size="sm" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>}
      </div>

      <PagesNote board={viewport} />
      <div className="xc-tools" role="toolbar" aria-label="Canvas">
        {clickable ? null : (
          <>
            <div className="xc-modes" role="radiogroup" aria-label="Mode">
              <button type="button" role="radio" aria-checked={mode === "pan"} className="xc-tool" onClick={() => setMode("pan")} title="Pan (H)">
                <Glyph name="hand" />
                <span className="visually-hidden">Pan</span>
              </button>
              <button type="button" role="radio" aria-checked={mode === "interact"} className="xc-tool" onClick={() => setMode("interact")} title="Interact with the pages (V)">
                <Glyph name="pointer" />
                <span className="visually-hidden">Interact</span>
              </button>
            </div>
            <span className="xc-tools-rule" aria-hidden="true" />
            <div className="xc-tools-group">
              {coarse ? null : (
                <button type="button" className="xc-tool" onClick={() => zoomAt(0.8, undefined, undefined, true)} disabled={view.z <= MIN_ZOOM} title="Zoom out (−)">
                  <Glyph name="zoom-out" />
                  <span className="visually-hidden">Zoom out</span>
                </button>
              )}
              <Menu
                label={`Zoom ${pct}%`}
                triggerClassName="xc-tool xc-zoom num"
                align="end"
                side="top"
                minWidth={200}
                trigger={<>{pct}%</>}
              >
                <MenuItem onSelect={() => { moved(); fitCanvas(); }} kbd={coarse ? undefined : "1"}>Fit the canvas</MenuItem>
                <MenuItem onSelect={fitShown} kbd={coarse ? undefined : "2"}>{selected ? "Fit the selected page" : "Fit the page in the middle"}</MenuItem>
                <MenuItem onSelect={fillShown} kbd={coarse ? undefined : "3"}>{selected ? "Fill the width with the selected page" : "Fill the width with the page in the middle"}</MenuItem>
                <MenuSeparator />
                {[50, 100, 200].map((n) => (
                  <MenuItem key={n} onSelect={() => zoomAt(n / 100 / view.z, undefined, undefined, true)} kbd={n === 100 && !coarse ? "0" : undefined}>
                    {n}%
                  </MenuItem>
                ))}
              </Menu>
              {coarse ? null : (
                <button type="button" className="xc-tool" onClick={() => zoomAt(1.25, undefined, undefined, true)} disabled={view.z >= MAX_ZOOM} title="Zoom in (+)">
                  <Glyph name="zoom-in" />
                  <span className="visually-hidden">Zoom in</span>
                </button>
              )}
            </div>
            <span className="xc-tools-rule" aria-hidden="true" />
          </>
        )}
        <div className="xc-tools-group">
          {/* Fit and fill show a page now, and are how the arrows show the next one: the one in use is marked. */}
          <div className="xc-modes" role="radiogroup" aria-label="Show pages">
            <button type="button" role="radio" aria-checked={pageView === "fit"} className="xc-tool" onClick={fitShown} title={selected ? "Fit the selected page (2)" : "Fit the page in the middle (2)"} aria-keyshortcuts="2">
              <Glyph name="scan" />
              <span className="visually-hidden">{selected ? "Fit the selected page" : "Fit the page in the middle"}</span>
            </button>
            <button type="button" role="radio" aria-checked={pageView === "fill"} className="xc-tool" onClick={fillShown} title={selected ? "Fill the width with the selected page (3)" : "Fill the width with the page in the middle (3)"} aria-keyshortcuts="3">
              <Glyph name="move-horizontal" />
              <span className="visually-hidden">{selected ? "Fill the width with the selected page" : "Fill the width with the page in the middle"}</span>
            </button>
          </div>
          {clickable ? null : (
            <button type="button" className="xc-tool" onClick={() => { moved(); fitCanvas(); }} title="Fit the canvas (1)" aria-keyshortcuts="1">
              <Glyph name="layout-grid" />
              <span className="visually-hidden">Fit the canvas</span>
            </button>
          )}
        </div>
        <span className="xc-tools-rule" aria-hidden="true" />
        <div className="xc-tools-group">
          <button type="button" className="xc-tool" onClick={() => step(-1)} disabled={selectedIndex === 0} title="Previous page (←)" aria-keyshortcuts="ArrowLeft">
            <Glyph name="chevron-left" />
            <span className="visually-hidden">Previous page</span>
          </button>
          <button type="button" className="xc-tool" onClick={() => step(1)} disabled={selectedIndex === version.pages.length - 1} title="Next page (→)" aria-keyshortcuts="ArrowRight">
            <Glyph name="chevron-right" />
            <span className="visually-hidden">Next page</span>
          </button>
          <Menu
            label={selectedIndex >= 0 ? `Page ${selectedIndex + 1} of ${version.pages.length}, ${version.pages[selectedIndex]!.title}. Choose a page` : "Choose a page"}
            triggerClassName="xc-tool xc-page-menu"
            align="end"
            side="top"
            minWidth={240}
            trigger={
              selectedIndex >= 0 ? (
                <>
                  <span className="num">{selectedIndex + 1} of {version.pages.length}</span>
                  <span className="xc-page-menu-title ellipsis">{version.pages[selectedIndex]!.title}</span>
                </>
              ) : (
                <span className="num">{plural(version.pages.length, "page")}</span>
              )
            }
          >
            {version.pages.map((p, i) => (
              <MenuRadio key={p.page_id} checked={p.page_id === selected} meta={`${p.width} × ${p.height}`} onSelect={() => showPage(p.page_id)}>
                {i + 1}. {p.title}
              </MenuRadio>
            ))}
          </Menu>
        </div>
        {coarse ? null : (
          <>
            <span className="xc-tools-rule" aria-hidden="true" />
            <Menu label="Keyboard shortcuts" title="Keyboard shortcuts" triggerClassName="xc-tool" align="end" side="top" minWidth={240} trigger={<Glyph name="keyboard" />}>
              <MenuItem onSelect={() => step(-1)} disabled={selectedIndex === 0} kbd="←">Previous page</MenuItem>
              <MenuItem onSelect={() => step(1)} disabled={selectedIndex === version.pages.length - 1} kbd="→">Next page</MenuItem>
              <MenuItem onSelect={fitShown} kbd="2">{selected ? "Fit the selected page" : "Fit the page in the middle"}</MenuItem>
              <MenuItem onSelect={fillShown} kbd="3">{selected ? "Fill the width with the selected page" : "Fill the width with the page in the middle"}</MenuItem>
              {clickable ? null : (
                <>
                  <MenuItem onSelect={() => { moved(); fitCanvas(); }} kbd="1">Fit the canvas</MenuItem>
                  <MenuSeparator />
                  <MenuItem onSelect={() => zoomAt(1.25, undefined, undefined, true)} kbd="+">Zoom in</MenuItem>
                  <MenuItem onSelect={() => zoomAt(0.8, undefined, undefined, true)} kbd="−">Zoom out</MenuItem>
                  <MenuItem onSelect={() => zoomAt(1 / view.z, undefined, undefined, true)} kbd="0">Zoom to 100%</MenuItem>
                  <MenuSeparator />
                  <MenuItem onSelect={() => setMode("pan")} kbd="H">Pan</MenuItem>
                  <MenuItem onSelect={() => setMode("interact")} kbd="V">Interact</MenuItem>
                </>
              )}
              {canFocus ? <MenuItem onSelect={() => onKey("f")} kbd="F">Focus mode</MenuItem> : null}
              <MenuNote>{clickable ? "The arrows show each page as 2 or 3 last did. Hold Space and drag to pan." : "The arrows show each page as 2 or 3 last did. Hold Space and drag to pan. Esc clears the selection."}</MenuNote>
            </Menu>
          </>
        )}
      </div>
    </div>
  );
}

/** How long before its expiry a prototype's address is replaced by a fresher one. */
const PROTOTYPE_KEEP_MS = 30 * 60_000;

/**
 * The prototype address the shown version's frames use. The server rounds an address's expiry to
 * the hour, so a read later in the day gives a new one; the frames keep the one they opened with
 * until it nears its end, since a new address reloads every frame and loses where people were. Back
 * on a tab whose address is nearly spent, the version is read again (reread).
 */
export function usePinnedPrototype(shown: { version: number; prototype?: PrototypeAddress | null } | undefined, reread: () => void): PrototypeAddress | null {
  const kept = useRef<{ version: number; info: PrototypeAddress } | null>(null);
  const rereadRef = useRef(reread);
  rereadRef.current = reread;
  useEffect(() => {
    const onVisible = () => {
      const k = kept.current;
      if (document.visibilityState !== "visible" || !k || Date.parse(k.info.expires_at) - Date.now() > PROTOTYPE_KEEP_MS) return;
      rereadRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const info = shown?.prototype ?? null;
  if (!shown || !info) return null;
  const k = kept.current;
  if (k && k.version === shown.version && Date.parse(k.info.expires_at) - Date.now() > PROTOTYPE_KEEP_MS) return k.info;
  kept.current = { version: shown.version, info };
  return info;
}

/** A page's address in a frame: its prototype entry under the pinned address when it enters one, or else the address its screen gives. */
export function pageAddress(p: CanvasPage, shown: { prototype?: PrototypeAddress | null }, pinned: PrototypeAddress | null, own: string): string {
  return p.prototype_url && shown.prototype && pinned ? `${pinned.base_url}${p.prototype_url.slice(shown.prototype.base_url.length)}` : own;
}
