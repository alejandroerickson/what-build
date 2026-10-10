import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { attribution, formatDate, formatDateTime, nestQuotes, plural } from "../lib/format.ts";
import { Markdown, passageHref } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS, toneFor } from "../lib/status.ts";
import { Inspector, usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, Crumbs, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuItem, MenuRadio, MenuSeparator, StatusBadge, TextField, useToast } from "../ui/index.tsx";
import { isTypingTarget, useMediaQuery } from "../ui/media.ts";
import { FirstUse } from "./first-use.tsx";
import { FocusToggle, useStoryFocus } from "./story-focus.tsx";
import { driftWords } from "./story-inspector.tsx";
import type { Actor, CitationCheck, CitationView, ResolvedRef } from "./story-model.ts";
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
  html_sha256: string;
  html_path: string;
}

type RefKind = "outcomes" | "sources" | "assumptions";

interface MockupVersion {
  version: number;
  title: string;
  summary: string;
  brief: string;
  columns: number | null;
  pages: CanvasPage[];
  resolved_refs: Record<RefKind, ResolvedRef[]>;
  citations: CitationView[];
  published_at: string;
  published_by: Actor;
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
  if (list.isError) return <ErrorCallout title="The mockups could not be loaded" error={list.error} onRetry={() => list.refetch()} />;
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
      <FirstUse title="No mockups yet" ask={`Explore ${product.name} in WhatBuild: read the outcomes and assumptions, then mock up two or three directions side by side in one mockup, with a brief.`}>
        A mockup is a canvas of pages your agent builds from the evidence: screens, flows and alternatives side by side, each with design notes, and a brief that says what the canvas explores and why. Every version is kept, and an agent can download one to build the next.
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

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "interact" ? "interact" : "pan";
  } catch {
    return "pan";
  }
}

/**
 * One page in its sandbox, at its own size. The frame is the Story's: the same sandbox, and the
 * frame script that passes F and Esc on and opens links in a new tab. A page that loads another
 * address in its place is put back. In pan mode the frame takes no pointer, so a click selects the
 * page and a drag moves the canvas.
 */
function PageFrame({ page, src, title, selected, onKey, frameRef }: {
  page: CanvasPage;
  src: string;
  title: string;
  selected: boolean;
  onKey: (k: "f" | "Escape") => void;
  frameRef: (el: HTMLDivElement | null) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [reloads, setReloads] = useState(0);
  const [replaced, setReplaced] = useState(false);
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; key?: unknown } | null;
      if (data?.whatbuild === "story-key" && (data.key === "f" || data.key === "Escape")) onKey(data.key);
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onKey]);
  return (
    <div ref={frameRef} className="xc-frame" data-page={page.page_id} data-selected={selected ? "" : undefined} style={{ width: page.width, height: page.height }}>
      <iframe
        key={reloads}
        ref={frame}
        title={title}
        width={page.width}
        height={page.height}
        loading="lazy"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        src={`${src}?frame=1`}
        onLoad={() => {
          loads.current += 1;
          if (loads.current > 1) {
            loads.current = 0;
            setReplaced(true);
            setReloads((n) => n + 1);
          }
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
 *   a drag on the background still moves the canvas. Holding Space pans from either mode.
 * - Scroll moves the canvas up and down, Shift+scroll sideways; ⌘ or Ctrl with scroll, or a pinch,
 *   zooms about the pointer. In interact mode, scrolling over a page scrolls the page.
 * - + and − zoom, 0 shows 100%, 1 fits the canvas, 2 fits the selected page; each page's label has
 *   its own fit button.
 */
function Canvas({ version, pageSrc, selected, onSelect, onKey, fitRequest }: {
  version: MockupVersion;
  pageSrc: (pageId: string) => string;
  selected: string | null;
  onSelect: (pageId: string | null) => void;
  onKey: (k: "f" | "Escape") => void;
  /** Bumped by the inspector to fit the selected page. */
  fitRequest: number;
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
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; page: string | null; pinch?: { d: number; z: number; cx: number; cy: number } } | null>(null);
  const touched = useRef(false);
  const columns = Math.max(1, version.columns ?? version.pages.length);
  const panning = mode === "pan" || space;

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // The choice lasts for this visit.
    }
  };

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
  const worldBox = useCallback((): Box | undefined => {
    const w = world.current;
    return w ? { left: 0, top: 0, width: w.offsetWidth, height: w.offsetHeight } : undefined;
  }, []);
  const fitCanvas = useCallback((glide = true) => fitBox(worldBox(), glide), [fitBox, worldBox]);
  const fitPage = useCallback(
    (id: string | null) => {
      if (!id) return;
      touched.current = true;
      onSelect(id);
      fitBox(boxes[id]);
    },
    [boxes, fitBox, onSelect],
  );

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
    if (fitRequest) fitPage(selected);
    // Only a new request fits; selecting a page from the inspector's list does too, through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

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

  // The wheel needs a listener that is not passive, so it can keep the page behind from scrolling.
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 4 : 1)), e.clientX - r.left, e.clientY - r.top);
        return;
      }
      touched.current = true;
      const step = e.deltaMode === 1 ? 16 : 1;
      const dx = (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * step;
      const dy = (e.shiftKey ? 0 : e.deltaY) * step;
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    };
    vp.addEventListener("wheel", wheel, { passive: false });
    return () => vp.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector("dialog[open], .menu")) return;
      const k = e.key;
      if (k === " ") {
        // Space presses a focused control; it pans only from the canvas or the page around it.
        if (e.target instanceof Element && e.target.closest("button, a[href], summary, select, [role=button], [role=menuitem], [role=menuitemradio], [role=radio], [role=tab]")) return;
        e.preventDefault();
        setSpace(true);
      } else if (k === "h" || k === "H") setMode("pan");
      else if (k === "v" || k === "V") setMode("interact");
      else if (k === "+" || k === "=") zoomAt(1.25, undefined, undefined, true);
      else if (k === "-" || k === "_") zoomAt(0.8, undefined, undefined, true);
      else if (k === "0") zoomAt(1 / view.z, undefined, undefined, true);
      else if (k === "1") {
        touched.current = true;
        fitCanvas();
      } else if (k === "2") fitPage(selected);
      else if (k === "Escape" && selected) {
        // The first Esc clears the selection; only the next leaves focus mode.
        e.preventDefault();
        onSelect(null);
      }
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
  }, [zoomAt, fitCanvas, fitPage, selected, onSelect, view.z]);

  const pageAt = (target: EventTarget | null) => (target instanceof HTMLElement ? (target.closest<HTMLElement>(".xc-frame")?.dataset["page"] ?? null) : null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest(".xc-label, .xc-tools")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const vp = viewport.current!.getBoundingClientRect();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { x: 0, y: 0, vx: view.x, vy: view.y, moved: true, page: null, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, cx: (a.x + b.x) / 2 - vp.left, cy: (a.y + b.y) / 2 - vp.top } };
      return;
    }
    gesture.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, page: pageAt(e.target) };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const z = clamp((g.pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinch.d);
      const { cx, cy } = g.pinch;
      touched.current = true;
      setView({ z, x: cx - ((cx - g.vx) * z) / g.pinch.z, y: cy - ((cy - g.vy) * z) / g.pinch.z });
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    if (!g.moved) {
      g.moved = true;
      touched.current = true;
      setDragging(true);
    }
    setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      // A click without a drag selects the page under it, or clears the selection on the background.
      if (g && !g.moved) onSelect(g.page);
      gesture.current = null;
      setDragging(false);
    }
  };

  const worldStyle: CSSProperties = {
    ["--xc-z" as string]: view.z,
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
        role="region"
        aria-roledescription="canvas"
        aria-label={`${version.title}: ${plural(version.pages.length, "page")}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={world} className="xc-world" style={worldStyle}>
          {version.pages.map((p) => (
            <PageFrame
              key={p.page_id}
              page={p}
              src={pageSrc(p.page_id)}
              title={`${p.title}, shown in a sandbox`}
              selected={p.page_id === selected}
              onKey={onKey}
              frameRef={(el) => {
                if (el) frames.current.set(p.page_id, el);
                else frames.current.delete(p.page_id);
              }}
            />
          ))}
        </div>
        {/* Labels sit above their pages at screen size, so a page's name reads at any zoom. */}
        <ol className="xc-labels" aria-label="Pages">
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
                style={{ transform: `translate(${view.x + b.left * view.z}px, ${view.y + b.top * view.z}px)`, width: Math.max(w, 28) }}
              >
                <button type="button" className="xc-label-name" onClick={() => onSelect(p.page_id)} aria-pressed={p.page_id === selected} title={`${p.title} · ${p.width} × ${p.height}`}>
                  <span className="xc-label-n num">{i + 1}</span>
                  <span className="xc-label-title ellipsis">{p.title}</span>
                  <span className="xc-label-size num">
                    {p.width} × {p.height}
                  </span>
                </button>
                <button type="button" className="xc-label-fit" onClick={() => fitPage(p.page_id)} aria-label={`Fit ${p.title} to the screen`} title="Fit to the screen (2)">
                  <Glyph name="scan" size="sm" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="xc-tools" role="toolbar" aria-label="Canvas">
        <div className="xc-modes" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={mode === "pan"} className="xc-tool" onClick={() => setMode("pan")} title="Pan: drag to move, click to select (H, or hold Space)">
            <Glyph name="hand" />
            <span className="visually-hidden">Pan</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === "interact"} className="xc-tool" onClick={() => setMode("interact")} title="Interact: use the pages themselves (V)">
            <Glyph name="pointer" />
            <span className="visually-hidden">Interact</span>
          </button>
        </div>
        <span className="xc-tools-rule" aria-hidden="true" />
        <button type="button" className="xc-tool" onClick={() => zoomAt(0.8, undefined, undefined, true)} disabled={view.z <= MIN_ZOOM} title="Zoom out (−)">
          <Glyph name="zoom-out" />
          <span className="visually-hidden">Zoom out</span>
        </button>
        <Menu
          label={`Zoom ${pct}%`}
          triggerClassName="xc-tool xc-zoom num"
          align="end"
          side="top"
          minWidth={200}
          trigger={<>{pct}%</>}
        >
          <MenuItem onSelect={() => { touched.current = true; fitCanvas(); }} kbd="1">Fit the canvas</MenuItem>
          <MenuItem onSelect={() => fitPage(selected)} disabled={!selected} kbd="2">Fit the selected page</MenuItem>
          <MenuSeparator />
          {[50, 100, 200].map((n) => (
            <MenuItem key={n} onSelect={() => zoomAt(n / 100 / view.z, undefined, undefined, true)} kbd={n === 100 ? "0" : undefined}>
              {n}%
            </MenuItem>
          ))}
        </Menu>
        <button type="button" className="xc-tool" onClick={() => zoomAt(1.25, undefined, undefined, true)} disabled={view.z >= MAX_ZOOM} title="Zoom in (+)">
          <Glyph name="zoom-in" />
          <span className="visually-hidden">Zoom in</span>
        </button>
        <span className="xc-tools-rule" aria-hidden="true" />
        <button type="button" className="xc-tool" onClick={() => { touched.current = true; fitCanvas(); }} title="Fit the canvas (1)">
          <Glyph name="scan" />
          <span className="visually-hidden">Fit the canvas</span>
        </button>
      </div>
    </div>
  );
}

// ---- The inspector ------------------------------------------------------------------------------

const REF_KINDS: { kind: RefKind; label: string }[] = [
  { kind: "outcomes", label: "Outcomes" },
  { kind: "assumptions", label: "Assumptions" },
  { kind: "sources", label: "Sources" },
];

function refLink(app: string, kind: RefKind, id: string) {
  return kind === "outcomes" ? `${app}/idea` : kind === "sources" ? `${app}/evidence/${id}` : `${app}/exploration/assumptions/${id}`;
}

function MockupInspector({ e, shown, versions, onVersion, selected, onSelect, onFit }: {
  e: MockupView;
  shown: MockupVersion;
  versions: VersionItem[] | undefined;
  onVersion: (n: number) => void;
  selected: string | null;
  onSelect: (pageId: string | null) => void;
  onFit: () => void;
}) {
  const { app, api: base } = useProduct();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const isCurrent = shown.version === e.current_version;
  const numbered = isCurrent ? `${shown.version}, the current one` : `${shown.version} of ${e.current_version}`;
  const refs = shown.resolved_refs;
  const refCount = REF_KINDS.reduce((n, k) => n + (refs[k.kind]?.length ?? 0), 0);
  const index = shown.pages.findIndex((p) => p.page_id === selected);
  const page = index >= 0 ? shown.pages[index]! : null;
  const checks = useQuery({
    queryKey: ["mockup-citations", base, e.mockup_id, shown.version],
    enabled: shown.citations.length > 0,
    queryFn: () => api<{ citations: CitationCheck[] }>("GET", `${base}/mockups/${e.mockup_id}/check-citations?version=${shown.version}`),
  });

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
                    label={`Version ${numbered}. Choose a version to show`}
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
          ]}
        />
        <Button size="sm" icon="download" className="story-export-button" onClick={download} disabled={downloading}>
          {downloading ? "Preparing…" : `Download version ${shown.version}`}
        </Button>
        <p className="story-about-note">A ZIP with the brief, each page&rsquo;s HTML and notes, and a manifest: what an agent needs to build the next version.</p>
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
                <span className="ellipsis grow">{page ? <><span className="num faint">{index + 1}</span> {page.title}</> : <span className="faint">Choose a page</span>}</span>
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
          <Button size="sm" icon="scan" onClick={onFit} disabled={!page} title="Fit to the screen (2)">
            Fit
          </Button>
        </div>
        {page ? <OnTheStory mockup={e} shown={shown} page={page} /> : null}
        {page ? (
          page.notes.trim() ? (
            <Markdown source={page.notes} className="prose story-notes xc-notes" headingShift={3} />
          ) : (
            <EmptyState size="inline">No notes on this page. Agents write them when they publish: what the page tries, and what to watch for.</EmptyState>
          )
        ) : (
          <p className="xc-hint">Select a page on the canvas to read its notes.</p>
        )}
      </Group>

      <Group title="Brief">
        {shown.brief.trim() ? (
          <Markdown source={shown.brief} className="prose story-notes xc-brief" headingShift={2} />
        ) : (
          <EmptyState size="inline">This version has no brief. Agents write one when they publish: what the canvas explores, for whom, and what each page tries.</EmptyState>
        )}
      </Group>

      <Group title="Explores" count={refCount}>
        {refCount ? (
          <div className="story-refs">
            {REF_KINDS.filter((k) => refs[k.kind]?.length).map((k) => (
              <div key={k.kind} className="story-ref-kind">
                <h4 className="story-ref-label">{k.label}</h4>
                <ul>
                  {refs[k.kind].map((r) => (
                    <li key={r.id}>
                      {r.missing ? <span className="faint">{r.id}</span> : <Link className="story-ref-link" to={refLink(app, k.kind, r.id)}>{r.title ?? r.id}</Link>}
                      {r.missing ? <span className="story-ref-status"> · No longer in this product</span> : r.archived ? <span className="story-ref-status"> · Archived</span> : k.kind === "assumptions" && r.status ? <span className="story-ref-status"> · {REVIEW_STATUS[r.status]?.label ?? r.status}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState size="inline">This version links no outcomes, assumptions or sources.</EmptyState>
        )}
      </Group>

      {shown.citations.length ? (
        <Group title="Cited passages" count={shown.citations.length}>
          <ol className="story-cites">
            {shown.citations.map((c) => {
              const check = checks.data?.citations.find((x) => x.index === c.index);
              return (
                <li key={c.index} className="story-cite">
                  <div className="story-cite-head">
                    <Link className="story-cite-source story-ref-link" to={`${app}/evidence/${c.record_id}`}>
                      {c.source_title ?? "Source"}
                    </Link>
                    <Link className="story-cite-address num" to={passageHref(app, c.record_id, c.seq_start, c.seq_end)}>
                      {c.seq_start === c.seq_end ? `¶${c.seq_start}` : `¶${c.seq_start}–${c.seq_end}`}
                    </Link>
                  </div>
                  <q className="story-cite-quote">{nestQuotes(c.quote)}</q>
                  <div className="story-cite-status">
                    {check ? (
                      <StatusBadge tone={check.version_drift && check.status === "ok" ? "attention" : toneFor("citation", check.status)}>{driftWords(check)}</StatusBadge>
                    ) : checks.isError ? (
                      <span className="faint">Could not check against the source</span>
                    ) : (
                      <span className="faint">Checking against the source…</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Group>
      ) : null}
    </div>
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
      toast(`“${r.title}” is on the Story, outside its navigation until an agent places it.`, { action: { label: "Open", onClick: () => navigate(`${app}/story/${r.page_id}`) } });
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
              ? `A new Story page will show “${page.title}” as it is in version ${shown.version} of this mockup. Nothing is copied: the page stays on version ${shown.version} until someone promotes a newer one, and agents place it in the Story’s navigation.`
              : `“${asking.title}” will show “${page.title}” as it is in version ${shown.version}, as its next version. Its earlier versions stay readable.`
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
  const { api: base, app, product } = useProduct();
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
  const focusMode = useStoryFocus(e.isSuccess);
  usePageTitle(e.data?.title ?? null);
  // The selected page lives in the URL (?page=), so a link can open a canvas at one page.
  const selected = params.get("page");
  const [fitRequest, setFitRequest] = useState(0);
  const select = useCallback(
    (pageId: string | null) => {
      const next = new URLSearchParams(params);
      if (pageId) next.set("page", pageId);
      else next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

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

  if (e.isPending) return <Loading variant="lines" />;
  if (e.isError) {
    const gone = e.error instanceof ApiError && e.error.isNotFound;
    return (
      <div className="mockup-view">
        <Crumbs label="Location" currentAsHeading items={crumbs} />
        {gone ? (
          <EmptyState title="This mockup is not in this product" action={<ButtonLink to={`${app}/exploration/mockups`}>Open mockups</ButtonLink>}>
            The link may be mistyped, or the mockup belongs to another product.
          </EmptyState>
        ) : (
          <ErrorCallout title="This mockup could not be loaded" error={e.error} onRetry={() => e.refetch()} />
        )}
      </div>
    );
  }

  const x = e.data;
  const shown = wantsOld ? old.data : x.current;
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
          It is out of the list. Every version is still here.
        </Callout>
      ) : null}
      {wantsOld && old.data ? (
        <Callout tone="attention" title={`You are looking at an earlier version: ${old.data.version} of ${x.current_version}`} action={<Button size="sm" onClick={() => onVersion(x.current_version)}>Show the current version</Button>} />
      ) : null}
      {wantsOld && old.isError ? (
        <Callout tone="attention" title={`This mockup has no version ${asked}`} action={<Button size="sm" onClick={() => onVersion(x.current_version)}>Show the current version</Button>} />
      ) : null}
      {shown ? <Canvas
          key={shown.version}
          version={shown}
          pageSrc={(pageId) => `${base}/mockups/${x.mockup_id}/versions/${shown.version}/pages/${pageId}/html`}
          selected={shown.pages.some((p) => p.page_id === selected) ? selected : null}
          onSelect={select}
          onKey={focusMode.onKey}
          fitRequest={fitRequest}
        /> : <Loading variant="lines" />}
      <Inspector title={x.title}>{shown ? <MockupInspector
            e={x}
            shown={shown}
            versions={versions.data?.items}
            onVersion={onVersion}
            selected={shown.pages.some((p) => p.page_id === selected) ? selected : null}
            onSelect={(id) => {
              select(id);
              setFitRequest((n) => n + 1);
            }}
            onFit={() => setFitRequest((n) => n + 1)}
          /> : <Loading variant="lines" />}</Inspector>
    </div>
  );
}
