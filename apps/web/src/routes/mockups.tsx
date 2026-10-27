import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCKUP_PAGE_SANDBOX } from "@whatbuild/core/page-sandbox";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { attribution, formatBytes, formatDate, formatDateTime, plural, quotedAtEnd } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { Inspector, usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, Crumbs, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuItem, MenuNote, MenuRadio, MenuSeparator, OneLine, TextField, useToast } from "../ui/index.tsx";
import { COARSE_POINTER_QUERY, isTypingTarget, useMediaQuery } from "../ui/media.ts";
import { DeleteDialog } from "./delete-dialog.tsx";
import { FirstUse } from "./first-use.tsx";
import { usePageView, type PageView } from "./story-flip.tsx";
import { FocusToggle, useStoryFocus } from "./story-focus.tsx";
import type { Actor } from "./story-model.ts";
import "../styles/screens/story.css";
import "../styles/screens/mockups.css";

/**
 * Mockups: canvases of agent-made HTML pages in Exploration. The panel lists them; one opens as
 * a canvas the width of the window, every page at its own size with its label above it, to pan
 * and zoom around. The inspector holds the version, the selected page's notes and the brief.
 */

export interface MockupSummary {
  mockup_id: string;
  title: string;
  summary: string;
  current_version: number;
  archived_at: string | null;
  etag: string;
  updated_at: string;
  page_count: number;
}

interface CanvasPage {
  page_id: string;
  title: string;
  notes: string;
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

/** A version's prototype: a team's multi-file prototype, served under a short-lived address of its own. */
interface PrototypeInfo {
  file_count: number;
  bytes: number;
  /** The prototype's address, a capability that lasts until expires_at. */
  base_url: string;
  expires_at: string;
  /** What the frame's sandbox attribute must say, as the server's policy does. */
  sandbox: string;
}

interface MockupVersion {
  version: number;
  title: string;
  summary: string;
  brief: string;
  columns: number | null;
  pages: CanvasPage[];
  /** Text files the version carries for collaborators: never used to draw a page. */
  files: MockupFile[];
  prototype?: PrototypeInfo | null;
  published_at: string;
  published_by: Actor;
}

interface MockupFile {
  path: string;
  chars: number;
  content?: string;
}

/** A Story page whose current version shows one of this mockup's pages, at the mockup version it was promoted from. */
interface StoryShowing {
  page_id: string;
  title: string;
  etag: string;
  archived_at: string | null;
  mockup_page_id: string;
  version: number;
}

interface MockupView extends MockupSummary {
  current: MockupVersion;
  story_pages: StoryShowing[];
}

interface VersionItem {
  version: number;
  page_count: number;
  published_at: string;
}

export function useMockupList() {
  const { api: base } = useProduct();
  return useQuery({ queryKey: ["mockups", base], queryFn: () => api<{ items: MockupSummary[] }>("GET", `${base}/mockups`) });
}

function rememberKey(productId: string) {
  return `whatbuild.mockup.${productId}`;
}

/** Exploration → Mockups with none chosen: the last one opened, or the most recent, or what mockups are. */
export function MockupsIndex() {
  const { app, product } = useProduct();
  const list = useMockupList();
  usePageTitle("Mockups");
  if (list.isPending) return <Loading variant="lines" />;
  if (list.isError) return <ErrorCallout title="Mockups couldn’t be loaded" error={list.error} onRetry={() => list.refetch()} />;
  const items = list.data.items;
  if (items.length) {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(rememberKey(product.product_id));
    } catch {
      remembered = null;
    }
    const pick = items.find((e) => e.mockup_id === remembered) ?? items[0]!;
    return <Navigate to={`${app}/exploration/mockups/${pick.mockup_id}`} replace />;
  }
  return (
    <div className="mockup-view">
      <Crumbs label="Location" currentAsHeading items={[{ label: "Exploration" }, { label: "Mockups" }]} />
      <FirstUse title="No mockups yet" ask={`Read the outcomes and assumptions of ${product.name} in WhatBuild, then mock up a few directions side by side in one mockup, with a brief.`}>
        A mockup is a canvas of pages your agent builds from the evidence: screens, flows or alternatives side by side.
      </FirstUse>
    </div>
  );
}

// ---- The canvas ---------------------------------------------------------------------------------

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
/** World pixels between pages: room for each page's label above it at ordinary zooms. */
const GAP_X = 120;
const GAP_Y = 160;
const MODE_KEY = "whatbuild.mockup.mode";

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
  | { kind: "select" };

/** The keys a page's frame passes on to the canvas: focus mode's, the arrows, and the canvas's own. */
const FRAME_KEYS = new Set(["f", "Escape", "ArrowLeft", "ArrowRight", " ", "h", "H", "v", "V", "0", "1", "2", "3", "+", "=", "-", "_"]);

/**
 * One page in its sandbox, at its own size. The frame is the Story's: the same sandbox, and the
 * frame script that opens links in a new tab. Told it is on a canvas, the script passes on the
 * canvas's keys, Space, a pinch and a press, so the canvas works the same once someone is inside a
 * page. A page that loads another address in its place is put back. In pan mode the frame takes no
 * pointer, so a click selects the page and a drag moves the canvas.
 *
 * A page that enters a prototype moves between the prototype's documents inside its frame, so a
 * second load is not a replacement: each of the prototype's documents says it has loaded
 * (frame-ready, from the frame script the prototype route adds), and a load that does not say so
 * within a moment is put back.
 */
function PageFrame({ page, src, title, selected, onSignal, frameRef, prototype }: {
  page: CanvasPage;
  src: string;
  title: string;
  selected: boolean;
  onSignal: (pageId: string, s: FrameSignal) => void;
  frameRef: (el: HTMLDivElement | null) => void;
  /** Set for a page that enters the version's prototype: the sandbox its frame takes. */
  prototype?: { sandbox: string } | null;
}) {
  const { app } = useProduct();
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const ready = useRef(false);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reloads, setReloads] = useState(0);
  const [replaced, setReplaced] = useState(false);
  // The sandboxed page has an opaque origin, so the message cannot be addressed to one.
  const hello = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ whatbuild: "canvas-host" }, "*");
    frame.current?.contentWindow?.postMessage({ whatbuild: "app-home", home: `${window.location.origin}${app}` }, "*");
  }, [app]);
  const putBack = useCallback(() => {
    ready.current = false;
    loads.current = 0;
    setReplaced(true);
    setReloads((n) => n + 1);
  }, []);
  useEffect(() => () => {
    if (waiting.current) clearTimeout(waiting.current);
  }, []);
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      const el = frame.current;
      if (!el || e.source !== el.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; key?: unknown; x?: unknown; y?: unknown; dy?: unknown; line?: unknown; pinch?: unknown } | null;
      if (data?.whatbuild === "frame-ready" && prototype) {
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
          if (prototype) {
            // One of the prototype's own documents has said so already, or will in a moment.
            if (ready.current) {
              ready.current = false;
              hello();
            } else waiting.current = setTimeout(() => {
              waiting.current = null;
              putBack();
            }, 1500);
            return;
          }
          loads.current += 1;
          if (loads.current > 1) {
            putBack();
            return;
          }
          hello();
        }}
      />
      {replaced ? <p className="xc-replaced">This page tried to open another address in its place. WhatBuild put it back.</p> : null}
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
 * - + and − zoom, 0 shows 100%, 1 fits the canvas, 2 fits the selected page (or the one nearest the
 *   middle) to the screen, and 3 fills the screen's width with it, its top at the top, to scroll
 *   down through it. ← and → select the previous or next page and show it the way 2 or 3 last did.
 *   Each page's label has its own fit button, and the toolbar has fit and fill, the arrows and a list
 *   of every key. A page's frame passes these keys on, so they work from inside a page.
 */
function Canvas({ version, pageSrc, selected, onSelect, onKey, canFocus, pageView, onPageView, showRequest }: {
  version: MockupVersion;
  pageSrc: (page: CanvasPage) => string;
  selected: string | null;
  onSelect: (pageId: string | null) => void;
  onKey: (k: "f" | "Escape") => void;
  /** Whether focus mode is on offer here, so the list of keys names it. */
  canFocus: boolean;
  /** Fit or fill: how a page is shown when the arrows or the inspector select it. */
  pageView: PageView;
  onPageView: (v: PageView) => void;
  /** Bumped by the inspector to show the selected page, the way pageView says. */
  showRequest: number;
}) {
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
  const columns = Math.max(1, version.columns ?? version.pages.length);
  const panning = mode === "pan" || space;

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

  /** Move to a view, gliding there unless the person prefers less motion. */
  const go = useCallback(
    (v: View) => {
      if (!reduceMotion) {
        setGliding(true);
        window.setTimeout(() => setGliding(false), 220);
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
      const z = clamp(Math.min((vp.clientWidth - pad * 2) / b.width, (vp.clientHeight - pad * 2 - 24) / b.height));
      const v = { z, x: (vp.clientWidth - b.width * z) / 2 - b.left * z, y: (vp.clientHeight - b.height * z) / 2 + 12 - b.top * z };
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
      const pad = 48;
      const z = clamp((vp.clientWidth - pad * 2) / b.width);
      const v = { z, x: (vp.clientWidth - b.width * z) / 2 - b.left * z, y: pad + 24 - b.top * z };
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
      onSelect(id);
      if (how === "fill") fillBox(boxes[id]);
      else fitBox(boxes[id]);
    },
    [boxes, fitBox, fillBox, onSelect, pageView],
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
  // someone moves it.
  useLayoutEffect(() => {
    touched.current = false;
    fitCanvas(false);
  }, [version.version, fitCanvas]);
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      if (!touched.current) fitCanvas(false);
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fitCanvas]);
  useEffect(() => {
    if (showRequest) showPage(selected);
    // Only a new request shows the page; selecting a page from the inspector's list does too, through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRequest]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number, glide = false) => {
    const vp = viewport.current;
    if (!vp) return;
    touched.current = true;
    const apply = (v: View) => {
      const z = clamp(v.z * factor);
      const px = cx ?? vp.clientWidth / 2;
      const py = cy ?? vp.clientHeight / 2;
      return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
    };
    if (glide) go(apply(view));
    else setView(apply);
  }, [go, view]);

  /** A pinch, or ⌘ or Ctrl with scroll, zooms about the pointer; a pinch arrives as Ctrl with small steps. */
  const wheelZoom = useCallback(
    (dy: number, line: boolean, pinch: boolean, clientX: number, clientY: number) => {
      const r = viewport.current?.getBoundingClientRect();
      if (!r) return;
      nudge();
      zoomAt(Math.exp(-dy * (line ? 0.05 : 0.0025) * (pinch ? 4 : 1)), clientX - r.left, clientY - r.top);
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
      touched.current = true;
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
      if (k === "h" || k === "H") setMode("pan");
      else if (k === "v" || k === "V") setMode("interact");
      else if (k === "+" || k === "=") zoomAt(1.25, undefined, undefined, true);
      else if (k === "-" || k === "_") zoomAt(0.8, undefined, undefined, true);
      else if (k === "0") zoomAt(1 / view.z, undefined, undefined, true);
      else if (k === "1") {
        touched.current = true;
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
    [setMode, zoomAt, view.z, fitCanvas, fitShown, fillShown, selected, step, onSelect],
  );

  /** What a page's frame passes on: the same keys, Space held, a pinch, a press that selects the page. */
  const handleSignal = (pageId: string, s: FrameSignal) => {
    if (s.kind === "keyup") setSpace(false);
    else if (s.kind === "select") {
      if (pageId !== selected) onSelect(pageId);
    } else if (s.kind === "zoom") wheelZoom(s.dy, s.line, s.pinch, s.clientX, s.clientY);
    else if (document.querySelector("dialog[open], .menu")) return;
    else if (s.key === " ") setSpace(true);
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
      touched.current = true;
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
      touched.current = true;
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
      if (g && !g.moved) onSelect(g.page);
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
          frameRef={(el) => {
            if (el) frames.current.set(p.page_id, el);
            else frames.current.delete(p.page_id);
          }}
        />
      )),
    [version.pages, version.prototype, pageSrc, selected, onSignal],
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
        {selected && boxes[selected] ? (
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
        <ol className="xc-labels" aria-label="Pages" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
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
                style={{ transform: `translate(${b.left * view.z}px, ${b.top * view.z}px)`, width: Math.max(w, 28) }}
              >
                <button type="button" className="xc-label-name" onClick={() => onSelect(p.page_id)} aria-pressed={p.page_id === selected} title={`${p.title} · ${p.width} × ${p.height}`}>
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
              </li>
            );
          })}
        </ol>
      </div>

      <div className="xc-tools" role="toolbar" aria-label="Canvas">
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
          <MenuItem onSelect={() => { touched.current = true; fitCanvas(); }} kbd={coarse ? undefined : "1"}>Fit the canvas</MenuItem>
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
        <span className="xc-tools-rule" aria-hidden="true" />
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
        <button type="button" className="xc-tool" onClick={() => { touched.current = true; fitCanvas(); }} title="Fit the canvas (1)" aria-keyshortcuts="1">
          <Glyph name="layout-grid" />
          <span className="visually-hidden">Fit the canvas</span>
        </button>
        <span className="xc-tools-rule" aria-hidden="true" />
        <button type="button" className="xc-tool" onClick={() => step(-1)} disabled={selectedIndex === 0} title="Previous page (←)" aria-keyshortcuts="ArrowLeft">
          <Glyph name="chevron-left" />
          <span className="visually-hidden">Previous page</span>
        </button>
        <button type="button" className="xc-tool" onClick={() => step(1)} disabled={selectedIndex === version.pages.length - 1} title="Next page (→)" aria-keyshortcuts="ArrowRight">
          <Glyph name="chevron-right" />
          <span className="visually-hidden">Next page</span>
        </button>
        {coarse ? null : (
          <>
            <span className="xc-tools-rule" aria-hidden="true" />
            <Menu label="Keyboard shortcuts" title="Keyboard shortcuts" triggerClassName="xc-tool" align="end" side="top" minWidth={240} trigger={<Glyph name="keyboard" />}>
              <MenuItem onSelect={() => step(-1)} disabled={selectedIndex === 0} kbd="←">Previous page</MenuItem>
              <MenuItem onSelect={() => step(1)} disabled={selectedIndex === version.pages.length - 1} kbd="→">Next page</MenuItem>
              <MenuItem onSelect={fitShown} kbd="2">{selected ? "Fit the selected page" : "Fit the page in the middle"}</MenuItem>
              <MenuItem onSelect={fillShown} kbd="3">{selected ? "Fill the width with the selected page" : "Fill the width with the page in the middle"}</MenuItem>
              <MenuItem onSelect={() => { touched.current = true; fitCanvas(); }} kbd="1">Fit the canvas</MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => zoomAt(1.25, undefined, undefined, true)} kbd="+">Zoom in</MenuItem>
              <MenuItem onSelect={() => zoomAt(0.8, undefined, undefined, true)} kbd="−">Zoom out</MenuItem>
              <MenuItem onSelect={() => zoomAt(1 / view.z, undefined, undefined, true)} kbd="0">Zoom to 100%</MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => setMode("pan")} kbd="H">Pan</MenuItem>
              <MenuItem onSelect={() => setMode("interact")} kbd="V">Interact</MenuItem>
              {canFocus ? <MenuItem onSelect={() => onKey("f")} kbd="F">Focus mode</MenuItem> : null}
              <MenuNote>The arrows show each page as 2 or 3 last did. Hold Space and drag to pan. Esc clears the selection.</MenuNote>
            </Menu>
          </>
        )}
      </div>
    </div>
  );
}

// ---- The inspector ------------------------------------------------------------------------------

function MockupInspector({ e, shown, versions, onVersion, selected, onSelect, pageView, onShow }: {
  e: MockupView;
  shown: MockupVersion;
  versions: VersionItem[] | undefined;
  onVersion: (n: number) => void;
  selected: string | null;
  onSelect: (pageId: string | null) => void;
  pageView: PageView;
  /** Shows the selected page fitted or filling the width, as 2 and 3 do. */
  onShow: (how: PageView) => void;
}) {
  const { api: base, canDelete } = useProduct();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isCurrent = shown.version === e.current_version;
  const numbered = isCurrent ? `${shown.version}, current` : `${shown.version} of ${e.current_version}`;
  const index = shown.pages.findIndex((p) => p.page_id === selected);
  const page = index >= 0 ? shown.pages[index]! : null;

  const download = async () => {
    setDownloading(true);
    try {
      const g = await api<{ url: string; headers: Record<string, string> }>("POST", `${base}/mockups/${e.mockup_id}/downloads`, { version: shown.version });
      const res = await fetch(g.url, { headers: g.headers });
      if (!res.ok) throw new Error(`The download failed (${res.status}).`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `mockup-v${shown.version}.zip`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The download failed.", { tone: "negative" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="story-inspector xc-inspector">
      <Group title="Version">
        <KeyValue
          items={[
            {
              label: "Version",
              value:
                versions && versions.length > 1 ? (
                  <Menu
                    label={`Version ${numbered}. Choose a version`}
                    triggerClassName="field-button"
                    align="start"
                    minWidth={240}
                    trigger={
                      <>
                        <span className="ellipsis grow num">
                          {shown.version}
                          {isCurrent ? " · current" : ` of ${e.current_version}`}
                        </span>
                        <Glyph name="chevron-down" size="sm" />
                      </>
                    }
                  >
                    {versions.map((v) => (
                      <MenuRadio key={v.version} checked={v.version === shown.version} meta={`${plural(v.page_count, "page")} · ${formatDate(v.published_at)}`} onSelect={() => onVersion(v.version)}>
                        Version {v.version}
                        {v.version === e.current_version ? " · current" : ""}
                      </MenuRadio>
                    ))}
                  </Menu>
                ) : (
                  <span className="num">{shown.version}</span>
                ),
            },
            { label: "By", value: attribution(shown.published_by) },
            { label: "Date", value: <time dateTime={shown.published_at}>{formatDateTime(shown.published_at)}</time> },
            { label: "Pages", value: <span className="num">{shown.pages.length}</span> },
            ...(shown.prototype
              ? [{ label: "Prototype", value: <span className="num">{plural(shown.prototype.file_count, "file")} · {formatBytes(shown.prototype.bytes)}</span> }]
              : []),
          ]}
        />
        <Button size="sm" icon="download" className="story-export-button" onClick={download} disabled={downloading}>
          {downloading ? "Preparing…" : `Download version ${shown.version}`}
        </Button>
        {canDelete ? (
          <Button size="sm" variant="quiet" icon="trash" className="story-delete-button" onClick={() => setDeleting(true)}>
            Delete permanently…
          </Button>
        ) : null}
        {deleting ? <DeleteMockup mockup={e} onClose={() => setDeleting(false)} /> : null}
      </Group>

      <Group title="Page">
        <div className="xc-page-pick">
          <Menu
            label={page ? `Page ${index + 1}, ${page.title}. Choose a page` : "Choose a page"}
            triggerClassName="field-button xc-page-trigger"
            align="start"
            minWidth={240}
            trigger={
              <>
                {page ? (
                  <span className="xc-page-name grow">
                    <span className="num faint">{index + 1}{"\u00a0"}</span>
                    <OneLine text={page.title} />
                  </span>
                ) : (
                  <span className="ellipsis grow">
                    <span className="faint">Choose a page</span>
                  </span>
                )}
                <Glyph name="chevron-down" size="sm" />
              </>
            }
          >
            {shown.pages.map((p, i) => (
              <MenuRadio key={p.page_id} checked={p.page_id === selected} meta={`${p.width} × ${p.height}`} onSelect={() => onSelect(p.page_id)}>
                {i + 1}. {p.title}
              </MenuRadio>
            ))}
          </Menu>
          <Button size="sm" icon="scan" onClick={() => onShow("fit")} disabled={!page} aria-pressed={pageView === "fit"} title="Fit to the screen (2)">
            Fit
          </Button>
          <Button size="sm" icon="move-horizontal" onClick={() => onShow("fill")} disabled={!page} aria-pressed={pageView === "fill"} title="Fill the width, to scroll through the page (3)">
            Fill
          </Button>
        </div>
        {page?.entry ? (
          <p className="xc-entry">
            Enters the prototype at <code className="ellipsis" title={page.entry}>{page.entry}</code>
          </p>
        ) : null}
        {page ? <OnTheStory mockup={e} shown={shown} page={page} /> : null}
        {page ? (
          page.notes.trim() ? (
            <Markdown source={page.notes} className="prose story-notes xc-notes" headingShift={3} />
          ) : (
            <EmptyState size="inline">No notes on this page.</EmptyState>
          )
        ) : (
          <p className="xc-hint">Select a page to read its notes.</p>
        )}
      </Group>

      <Group title="Brief">
        {shown.brief.trim() ? (
          <Markdown source={shown.brief} className="prose story-notes xc-brief" headingShift={2} />
        ) : (
          <EmptyState size="inline">This version has no brief.</EmptyState>
        )}
      </Group>

      <Files mockupId={e.mockup_id} shown={shown} />
    </div>
  );
}

/**
 * The files a version carries for collaborators (a DESIGN.md, components, tokens), to pull into
 * their own projects. WhatBuild never draws a page with them, so a file opens as text: Markdown
 * rendered, anything else as source, never as HTML.
 */
function Files({ mockupId, shown }: { mockupId: string; shown: MockupVersion }) {
  const { api: base } = useProduct();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const full = useQuery({
    queryKey: ["mockup-files", base, mockupId, shown.version],
    enabled: open !== null,
    queryFn: () => api<{ files: MockupFile[] }>("GET", `${base}/mockups/${mockupId}/versions/${shown.version}?include_files=true`),
  });
  const file = full.data?.files.find((x) => x.path === open);
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast("Copied."))
      .catch(() => toast("Couldn’t copy. Download the version instead.", { tone: "negative" }));
  return (
    <Group title="Files" count={shown.files.length}>
      {shown.files.length ? (
        <ul className="xc-files">
          {shown.files.map((x) => (
            <li key={x.path}>
              <Glyph name="file-text" size="sm" />
              <button type="button" className="xc-file story-ref-link ellipsis" title={x.path} onClick={() => setOpen(x.path)}>
                {x.path}
              </button>
              <span className="faint num">{plural(x.chars, "character")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="inline">No files on this version.</EmptyState>
      )}
      {open ? (
        <Dialog
          open
          wide
          onClose={() => setOpen(null)}
          title={open}
          footer={
            <>
              <Button onClick={() => setOpen(null)}>Close</Button>
              <Button icon="copy" disabled={file?.content === undefined} onClick={() => copy(file!.content!)}>
                Copy
              </Button>
            </>
          }
        >
          {full.isPending ? (
            <Loading variant="lines" lines={6} label="Loading the file…" />
          ) : full.isError ? (
            <ErrorCallout inset error={full.error} onRetry={() => full.refetch()} />
          ) : file?.content === undefined ? (
            <EmptyState size="inline">This file isn’t on this version any more.</EmptyState>
          ) : /\.(md|markdown)$/i.test(file.path) ? (
            <Markdown source={file.content} className="prose story-notes xc-file-text" headingShift={1} />
          ) : (
            <pre className="xc-file-code">{file.content}</pre>
          )}
        </Dialog>
      ) : null}
    </Group>
  );
}

/**
 * Where the selected page stands in the Story: the Story pages that show it, and the way to put it
 * there or move one to the version shown. A Story page shows a mockup page as it is in one version,
 * never a copy, and stays on that version until it is promoted again.
 */
function OnTheStory({ mockup, shown, page }: { mockup: MockupView; shown: MockupVersion; page: CanvasPage }) {
  const { app, api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<StoryShowing | "new" | null>(null);
  const [title, setTitle] = useState(page.title);
  const showing = mockup.story_pages.filter((p) => p.mockup_page_id === page.page_id);
  const promote = useMutation({
    mutationFn: (to: StoryShowing | "new") =>
      api<{ page_id: string; title: string }>("POST", `${base}/story/promote-mockup`, {
        mockup_id: mockup.mockup_id,
        mockup_page_id: page.page_id,
        version: shown.version,
        ...(to === "new" ? { title: title.trim() || page.title } : { page_id: to.page_id, expected_etag: to.etag }),
      }),
    onSuccess: (r) => {
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ["mockup", base, mockup.mockup_id] });
      for (const key of [["story-tree", base], ["story-pages", base], ["story-page", base, r.page_id], ["story-versions", base, r.page_id]]) void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["product"] });
      toast(`“${r.title}” is on the Story, under Published mockups.`, { action: { label: "Open", onClick: () => navigate(`${app}/story/${r.page_id}`) } });
    },
  });
  if (!showing.length && !canWrite) return null;
  return (
    <div className="xc-story">
      {showing.map((p) => (
        <p key={p.page_id} className="xc-story-line">
          <Glyph name="book-open" size="sm" />
          <span>
            On the Story as <Link to={`${app}/story/${p.page_id}`} className="story-ref-link">{p.title}</Link>
            <span className="faint">, showing version {p.version}{p.archived_at ? " (archived)" : ""}</span>
          </span>
          {canWrite && !p.archived_at && p.version !== shown.version ? (
            <Button size="sm" onClick={() => setAsking(p)}>
              Show version {shown.version}
            </Button>
          ) : null}
        </p>
      ))}
      {canWrite && !showing.length ? (
        <Button size="sm" icon="book-open" onClick={() => { setTitle(page.title); setAsking("new"); }}>
          Promote to Story
        </Button>
      ) : null}
      {asking ? (
        <Dialog
          open
          onClose={() => setAsking(null)}
          dismissable={!promote.isPending}
          title={asking === "new" ? "Promote to Story" : `Show version ${shown.version} on the Story`}
          description={
            asking === "new"
              ? `A new Story page at the end of Published mockups will show “${page.title}” as it is in version ${shown.version}. It stays on version ${shown.version} until someone promotes a newer one.`
              : `“${asking.title}” will show “${page.title}” as it is in version ${shown.version}. Its earlier versions stay readable.`
          }
          footer={
            <>
              <Button onClick={() => setAsking(null)} disabled={promote.isPending}>
                Cancel
              </Button>
              <Button variant="primary" busy={promote.isPending} busyLabel="Promoting…" onClick={() => promote.mutate(asking)}>
                {asking === "new" ? "Promote" : `Show version ${shown.version}`}
              </Button>
            </>
          }
        >
          {asking === "new" ? <TextField label="Title on the Story" maxLength={200} value={title} onChange={(ev) => setTitle(ev.target.value)} /> : null}
          {promote.isError ? <ErrorCallout inset error={promote.error} /> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

// ---- The screen ---------------------------------------------------------------------------------

export function MockupPage() {
  const { mockupId } = useParams();
  const { api: base, app, product, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const vParam = params.get("v");
  const asked = vParam && /^\d+$/.test(vParam) ? Number(vParam) : null;

  const e = useQuery({
    queryKey: ["mockup", base, mockupId],
    retry: (n, err) => !(err instanceof ApiError && err.isNotFound) && n < 2,
    queryFn: () => api<MockupView>("GET", `${base}/mockups/${mockupId}`),
  });
  const versions = useQuery({
    queryKey: ["mockup-versions", base, mockupId],
    enabled: e.isSuccess,
    queryFn: () => api<{ items: VersionItem[] }>("GET", `${base}/mockups/${mockupId}/versions?limit=100`),
  });
  const wantsOld = asked !== null && e.data !== undefined && asked !== e.data.current_version;
  const old = useQuery({
    queryKey: ["mockup-version", base, mockupId, asked],
    enabled: wantsOld,
    retry: (n, err) => !(err instanceof ApiError && err.isNotFound) && n < 2,
    queryFn: () => api<MockupVersion>("GET", `${base}/mockups/${mockupId}/versions/${asked}`),
  });
  // On a phone too: the board gains the whole screen.
  const focusMode = useStoryFocus(e.isSuccess, { onPhone: true });
  usePageTitle(e.data?.title ?? null);
  // The selected page lives in the URL (?page=), so a link can open a canvas at one page.
  const selected = params.get("page");
  const [showRequest, setShowRequest] = useState(0);
  // Fit (2) or fill (3): how the arrows and the inspector show a page, remembered in this browser.
  const [pageView, setPageView] = usePageView("whatbuild.mockup.page-view", "fit");
  const mockups = useMockupList();
  const select = useCallback(
    (pageId: string | null) => {
      const next = new URLSearchParams(params);
      if (pageId) next.set("page", pageId);
      else next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // A prototype's address lasts hours: back on a tab whose address is nearly spent, read the version again.
  const pinnedPrototype = useRef<{ version: number; info: PrototypeInfo } | null>(null);
  useEffect(() => {
    const onVisible = () => {
      const kept = pinnedPrototype.current;
      if (document.visibilityState !== "visible" || !kept || Date.parse(kept.info.expires_at) - Date.now() > PROTOTYPE_KEEP_MS) return;
      void e.refetch();
      if (wantsOld) void old.refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [e, old, wantsOld]);

  useEffect(() => {
    if (!e.isSuccess || !mockupId) return;
    try {
      localStorage.setItem(rememberKey(product.product_id), mockupId);
    } catch {
      // The URL still carries it.
    }
  }, [e.isSuccess, mockupId, product.product_id]);

  const onVersion = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === e.data?.current_version) next.delete("v");
    else next.set("v", String(n));
    setParams(next);
  };

  const crumbs = [{ label: "Exploration" }, { label: "Mockups" }, { label: e.isError ? "Not found" : (e.data?.title ?? "…") }];

  if (e.isPending)
    return (
      <>
        <Loading variant="lines" />
        {/* Kept while the next mockup loads, so the inspector does not slide away and back. */}
        <Inspector title={mockups.data?.items.find((m) => m.mockup_id === mockupId)?.title ?? "Mockup"}>
          <Loading variant="lines" />
        </Inspector>
      </>
    );
  if (e.isError) {
    const gone = e.error instanceof ApiError && e.error.isNotFound;
    return (
      <div className="mockup-view">
        <Crumbs label="Location" currentAsHeading items={crumbs} />
        {gone ? (
          <EmptyState title="This mockup isn’t in this product" action={<ButtonLink to={`${app}/exploration/mockups`}>Open mockups</ButtonLink>}>
            The link may be mistyped, or the mockup belongs to another product.
          </EmptyState>
        ) : (
          <ErrorCallout title="This mockup couldn’t be loaded" error={e.error} onRetry={() => e.refetch()} />
        )}
      </div>
    );
  }

  const x = e.data;
  const shown = wantsOld ? old.data : x.current;
  const pinned = pinPrototype(pinnedPrototype, shown);
  return (
    <div className="mockup-view" data-focus={focusMode.focus ? "" : undefined}>
      <div className="story-bar">
        <Crumbs label="Location" currentAsHeading items={crumbs} />
        <span className="xc-version num" aria-live="polite">
          {shown ? `Version ${shown.version}${shown.version === x.current_version ? "" : ` of ${x.current_version}`}` : null}
        </span>
        {focusMode.available ? <FocusToggle focus={focusMode.focus} hint={focusMode.hint} onToggle={focusMode.toggle} /> : null}
      </div>
      {x.archived_at ? (
        <Callout tone="attention" title="This mockup is archived">
          {canWrite ? "Your agent can restore it." : null}
        </Callout>
      ) : null}
      {wantsOld && old.data ? (
        <Callout tone="attention" title={`You’re looking at an earlier version: ${old.data.version} of ${x.current_version}`} action={<Button size="sm" onClick={() => onVersion(x.current_version)}>Show the current version</Button>} />
      ) : null}
      {wantsOld && old.isError ? (
        <Callout tone="attention" title={`This mockup has no version ${asked}`} action={<Button size="sm" onClick={() => onVersion(x.current_version)}>Show the current version</Button>} />
      ) : null}
      {shown ? <Canvas
          key={shown.version}
          version={shown}
          pageSrc={(p) =>
            p.prototype_url && shown.prototype && pinned
              ? `${pinned.base_url}${p.prototype_url.slice(shown.prototype.base_url.length)}`
              : `${base}/mockups/${x.mockup_id}/versions/${shown.version}/pages/${p.page_id}/html`
          }
          selected={shown.pages.some((p) => p.page_id === selected) ? selected : null}
          onSelect={select}
          onKey={focusMode.onKey}
          canFocus={focusMode.available}
          pageView={pageView}
          onPageView={setPageView}
          showRequest={showRequest}
        /> : <Loading variant="lines" />}
      <Inspector title={x.title}>{shown ? <MockupInspector
            e={x}
            shown={shown}
            versions={versions.data?.items}
            onVersion={onVersion}
            selected={shown.pages.some((p) => p.page_id === selected) ? selected : null}
            onSelect={(id) => {
              select(id);
              setShowRequest((n) => n + 1);
            }}
            pageView={pageView}
            onShow={(how) => {
              setPageView(how);
              setShowRequest((n) => n + 1);
            }}
          /> : <Loading variant="lines" />}</Inspector>
    </div>
  );
}

/** How long before its expiry a prototype's address is replaced by a fresher one. */
const PROTOTYPE_KEEP_MS = 30 * 60_000;

/**
 * The prototype address the shown version's frames use. The server rounds an address's expiry to
 * the hour, so a read later in the day gives a new one; the frames keep the one they opened with
 * until it nears its end, since a new address reloads every frame and loses where people were.
 */
function pinPrototype(kept: { current: { version: number; info: PrototypeInfo } | null }, shown: MockupVersion | undefined): PrototypeInfo | null {
  const info = shown?.prototype ?? null;
  if (!shown || !info) return null;
  const k = kept.current;
  if (k && k.version === shown.version && Date.parse(k.info.expires_at) - Date.now() > PROTOTYPE_KEEP_MS) return k.info;
  kept.current = { version: shown.version, info };
  return info;
}

/** What deleting a mockup destroys, as mockups.delete_impact reports it. */
interface MockupImpact {
  etag: string;
  version_count: number;
  story_pages_showing: { page_id: string; title: string; archived: boolean }[];
  earlier_story_versions_showing: { page_id: string; title: string; version: number }[];
}

/** What deleting a mockup deletes, as its dialog says it: every version, each with its own pages, notes, files and brief. */
export function mockupImpactWords(title: string, versions: number): string {
  return versions === 1
    ? `This deletes “${title}” with its only version: its pages, notes, files and brief.`
    : `This deletes “${title}” with all ${versions} of its versions: their pages, notes, files and briefs.`;
}

/** Delete a mockup for good. A Story page that shows it holds it: that page goes, or gets HTML of its own, first. */
function DeleteMockup({ mockup, onClose }: { mockup: MockupView; onClose: () => void }) {
  const { app, api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const archive = useMutation({
    mutationFn: () => api("POST", `${base}/mockups/${mockup.mockup_id}/archive`, { expected_etag: mockup.etag }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mockup", base, mockup.mockup_id] });
      void qc.invalidateQueries({ queryKey: ["mockups", base] });
      toast("Mockup archived.");
    },
    onError: () => toast("The mockup couldn’t be archived. Reload and try again.", { tone: "negative" }),
  });
  return (
    <DeleteDialog<MockupImpact>
      title="Delete this mockup permanently?"
      impactPath={`${base}/mockups/${mockup.mockup_id}/delete-impact`}
      deletePath={`${base}/mockups/${mockup.mockup_id}`}
      alternative={mockup.archived_at ? undefined : { label: "Archive instead", onSelect: () => archive.mutate() }}
      allowed={(i) => !i.story_pages_showing.length}
      renderImpact={(i) =>
        i.story_pages_showing.length ? (
          <>
            <p>
              <strong>{i.story_pages_showing.length === 1 ? "A Story page shows" : `${i.story_pages_showing.length} Story pages show`} this mockup.</strong> Delete{" "}
              {i.story_pages_showing.length === 1 ? "that page" : "those pages"} first.
            </p>
            <ul className="delete-impact-list">
              {i.story_pages_showing.map((p) => (
                <li key={p.page_id}>
                  <Link to={`${app}/story/${p.page_id}`}>{p.title}</Link>
                  {p.archived ? <span className="faint"> · archived</span> : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>{mockupImpactWords(mockup.title, i.version_count)}</p>
            {i.earlier_story_versions_showing.length ? (
              <p>
                {i.earlier_story_versions_showing.length === 1 ? "An earlier version of a Story page shows it, and will" : `${i.earlier_story_versions_showing.length} earlier versions of Story pages show it, and will`}{" "}
                show an empty page.
              </p>
            ) : null}
          </>
        )
      }
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["mockups", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        toast(`Deleted ${quotedAtEnd(mockup.title)} The activity log records who, when and why.`);
        navigate(`${app}/exploration/mockups`);
      }}
      onClose={onClose}
    />
  );
}
