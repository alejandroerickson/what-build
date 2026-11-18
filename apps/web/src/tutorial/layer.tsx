import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useMe } from "../lib/session.tsx";
import { Avatar, Button, Glyph, IconButton } from "../ui/index.tsx";
import { controlsOnScreen, toolLabel, ToolDiagram, toolsSaid, type ToolLabel } from "./diagram.tsx";
import type { Box } from "./flight.ts";
import { focusables, setKeyPolicy } from "./keys.ts";
import { useTutorial } from "./provider.tsx";
import { AgentStage } from "./stage.tsx";
import { lineText, type Line, type Stop, type Target } from "./stops.ts";
import { CANVAS_TOOLS, type CanvasTool } from "../routes/mockup-canvas.tsx";

/**
 * The tutorial's layer, over the whole window: a scrim with one hole in it for the thing being shown,
 * four blocks around the hole (and one over it, unless the thing is there to be tried) so nothing
 * else can be clicked, and the card: the welcome, a stop's bubble beside the hole, or the agent stage.
 * Clicking the dark does not close it: it points at the way out (the close button, or Not now).
 */

const q = (s: string) => document.querySelector(s);

/** Where each thing a stop lights is on the screen. */
export const TARGETS: Record<Target, () => (Element | null)[]> = {
  nav: () => [q(".panel-left .nav-l1")],
  "nav-idea": () => [q('.panel-left .nav-l1 [data-nav="idea"]')],
  "nav-evidence": () => [q('.panel-left .nav-l1 [data-nav="evidence"]')],
  "nav-exploration": () => [q('.panel-left .nav-l1 [data-nav="exploration"]')],
  "nav-story": () => [q('.panel-left .nav-l1 [data-nav="story"]')],
  concept: () => [q('[data-tut="concept"]')],
  "more-info-button": () => [q('[data-tut="concept"] .idea-more')],
  "more-info": () => [q('[data-tut="concept"] .idea-card-head'), q('[data-tut="concept"] .idea-card-more[data-open]')],
  outcome: () => [q('[data-tut="outcome"]')],
  "source-row": () => [q('[data-tut-screen="evidence"] .source-row')],
  preview: () => [q('[data-tut-screen="evidence"] .sources-preview')],
  // The canvas, and Focus beside it (Show panels in Focus), which works there as F does.
  canvas: () => [q('[data-tut-screen="exploration"] .xc'), q('[data-tut-screen="exploration"] .story-focus-button')],
  toolbar: () => [q('[data-tut-screen="exploration"] .xc-tools')],
  view: () => [q(".inspector .xc-inspector > .group:first-child")],
  download: () => [q(".inspector .xc-inspector .story-export-button")],
  promote: () => [q(".inspector .xc-inspector .xc-story button")],
  "story-pages": () => [q('.panel-left .panel-context ul.story-tree[role="tree"]')],
  pdf: () => [q(".inspector .story-about-actions .btn")],
  seat: () => [q(".panel-left [data-agent-seat]")],
};

const PAD = 6;
const MARGIN = 12;
const GAP = 12;
const NARROWEST = 240;

/** Two boxes as one. */
function joined(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** The nearest element holding all of them: what is there to be tried when a stop lights several. */
function holding(els: Element[]): HTMLElement | null {
  let a: Element | null = els[0] ?? null;
  while (a && !els.every((e) => a!.contains(e))) a = a.parentElement;
  return a as HTMLElement | null;
}

function union(els: Element[]): Box | null {
  const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
  if (!rs.length) return null;
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((r) => r.right));
  const b = Math.max(...rs.map((r) => r.bottom));
  // Padded, and never past the window, so a tall card's hole ends where the window does.
  const x = Math.max(0, l - PAD);
  const y = Math.max(0, t - PAD);
  return { x, y, w: Math.min(innerWidth, r + PAD) - x, h: Math.min(innerHeight, b + PAD) - y };
}

type Side = NonNullable<Stop["side"]>;
interface Placed {
  x: number;
  y: number;
  w: number;
  /** Beside the light, or null inside it, where the light leaves no room around it (the canvas in Focus). */
  side: Side | null;
  beak: number;
}

/**
 * The bubble beside the hole: on the stop's side when it fits there whole, else the opposite side,
 * else either other, narrowing to fit a side where it can. It stays inside the window and never
 * covers the thing it names. With an `aim`, it lines up with that and its beak points at it, rather
 * than at the middle of the hole.
 */
function placeBubble(hole: Box, natural: number, heightAt: (w: number) => number, side: Side, aim: Box | null = null): Placed {
  const focus = aim ?? hole;
  const vw = innerWidth;
  const vh = innerHeight;
  const opposite: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
  const order: Side[] = [side, opposite[side], ...(["right", "left", "bottom", "top"] as Side[]).filter((s) => s !== side && s !== opposite[side])];
  const attempt = (s: Side): Placed | null => {
    const room = s === "left" ? hole.x - GAP - MARGIN : s === "right" ? vw - (hole.x + hole.w) - GAP - MARGIN : vw - 2 * MARGIN;
    const w = Math.min(natural, room);
    if (w < NARROWEST) return null;
    const h = heightAt(w);
    let x = s === "left" ? hole.x - GAP - w : s === "right" ? hole.x + hole.w + GAP : focus.x + focus.w / 2 - w / 2;
    let y = s === "top" ? hole.y - GAP - h : s === "bottom" ? hole.y + hole.h + GAP : focus.y + focus.h / 2 - h / 2;
    x = Math.min(Math.max(x, MARGIN), vw - w - MARGIN);
    y = Math.min(Math.max(y, MARGIN), vh - h - MARGIN);
    if (s === "top" && y + h > hole.y - GAP / 2) return null;
    if (s === "bottom" && y < hole.y + hole.h + GAP / 2) return null;
    if (y < MARGIN - 0.5 || y + h > vh - MARGIN + 0.5) return null;
    const along = s === "top" || s === "bottom" ? focus.x + focus.w / 2 - x : focus.y + focus.h / 2 - y;
    const length = s === "top" || s === "bottom" ? w : h;
    return { x, y, w, side: s, beak: Math.min(Math.max(along, 18), length - 18) };
  };
  for (const s of order) {
    const p = attempt(s);
    if (p) return p;
  }
  // Nowhere it fits whole, as when the canvas in Focus takes the window: inside the light at its top
  // left, clear of the toolbar at its foot and of Show panels at its top right, with no beak.
  const w = Math.min(natural, vw - 2 * MARGIN);
  const h = heightAt(w);
  return { x: Math.max(MARGIN, Math.min(hole.x + 16, vw - w - MARGIN)), y: Math.max(MARGIN, Math.min(hole.y + 16, vh - h - MARGIN)), w, side: null, beak: 18 };
}

/** A stop's line: its words, a key cap that turns green once that key is used, a few words in bold. */
function LineText({ line, hit }: { line: Line; hit: ReadonlySet<string> }) {
  return (
    <>
      {line.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : "kbd" in part ? (
          <kbd key={i} className="kbd tut-kbd" data-hit={hit.has(part.kbd.toLowerCase()) ? "" : undefined}>
            {hit.has(part.kbd.toLowerCase()) ? <Glyph name="check" size="sm" /> : null}
            {part.kbd}
            {hit.has(part.kbd.toLowerCase()) ? <span className="visually-hidden"> (used)</span> : null}
          </kbd>
        ) : (
          <b key={i}>{part.b}</b>
        ),
      )}
    </>
  );
}

/** The progress bar: one segment a stop, the ones passed and the one shown marked. Its words say the same. */
export function ProgressBar({ at, count }: { at: number; count: number }) {
  return (
    <ol className="tut-bar" aria-hidden="true">
      {Array.from({ length: count }, (_, k) => (
        <li key={k} data-s={k < at ? "done" : k === at ? "now" : undefined} />
      ))}
    </ol>
  );
}

export function TutorialLayer() {
  const t = useTutorial()!;
  const me = useMe();
  const layerRef = useRef<HTMLDivElement>(null);
  const [hole, setHole] = useState<Box | null>(null);
  const [aim, setAim] = useState<Box | null>(null);
  // What the toolbar's labels take, for the bubble to keep clear of; and what they say.
  const [extra, setExtra] = useState<Box | null>(null);
  const [tools, setTools] = useState<ToolLabel[]>([]);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [announce, setAnnounce] = useState("");
  const [entered, setEntered] = useState(false);
  const liveEl = useRef<HTMLElement | null>(null);
  /** What the stop lit when last measured, which the light follows as it changes size. */
  const litEls = useRef<Element[]>([]);
  const titleId = useId();
  const lineId = useId();
  const { current, mode, phase, at, stops } = t;
  const stage = Boolean(current?.stage);
  const closing = phase === "closing";
  const key = mode === "welcome" ? "welcome" : (current?.id ?? "none");

  // Find what the stop lights (a page may still be drawing it), bring it into view, and follow it while it settles.
  const measure = useCallback((): boolean => {
    if (mode !== "stop" || !current || current.stage || !current.target) {
      setHole(null);
      liveEl.current = null;
      litEls.current = [];
      return true;
    }
    // While the tutorial presses what opens it, that alone is lit; once open, what it opened.
    const lit = current.presses && t.reveal !== "open" ? current.presses : current.target;
    const els = TARGETS[lit]().filter((e): e is Element => Boolean(e));
    litEls.current = els;
    if (!els.length) return false;
    const aimed = current.aim ? TARGETS[current.aim]()[0] : null;
    const a = aimed ? aimed.getBoundingClientRect() : null;
    setAim((old) => (a ? (old && Math.abs(old.x - a.left) < 0.5 && Math.abs(old.y - a.top) < 0.5 && old.w === a.width && old.h === a.height ? old : { x: a.left, y: a.top, w: a.width, h: a.height }) : null));
    const first = els[0]!;
    const scroller = first.closest(".canvas");
    if (scroller) {
      const r = first.getBoundingClientRect();
      const v = scroller.getBoundingClientRect();
      if (r.top < v.top + 20 || (r.bottom > v.bottom - 20 && r.height < v.height - 40)) first.scrollIntoView({ block: r.height > v.height - 40 ? "start" : "center" });
    }
    liveEl.current = current.live ? holding(els) : null;
    const next = union(els);
    setHole((h) => (h && next && Math.abs(h.x - next.x) < 0.5 && Math.abs(h.y - next.y) < 0.5 && Math.abs(h.w - next.w) < 0.5 && Math.abs(h.h - next.h) < 0.5 ? h : next));
    return Boolean(next);
  }, [mode, current, t.reveal, t.focus]);

  useLayoutEffect(() => {
    let frame = 0;
    let found = 0;
    const began = performance.now();
    const onResize = () => measure();
    const ro = new ResizeObserver(onResize);
    // What the stop lights can change size on its own (the canvas's toolbar wraps onto a second row as
    // the window narrows), so the light follows it as well as the window.
    const watched = new Set<Element>();
    const watch = () => {
      for (const el of litEls.current)
        if (!watched.has(el)) {
          watched.add(el);
          ro.observe(el);
        }
    };
    const tick = () => {
      const ok = measure();
      watch();
      if (ok && !found) found = performance.now();
      const now = performance.now();
      // Keep following for a moment after it is found, through panels sliding and a fold opening; give up looking after a few seconds.
      if ((found && now - found < 900) || (!found && now - began < 4000)) frame = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("resize", onResize);
    const main = q(".stage");
    if (main) ro.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [measure, key]);

  // The bubble goes beside the hole once both are known.
  const cardRef = t.cardRef;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (mode !== "stop" || stage || !card || !hole || !current) {
      setPlaced(null);
      return;
    }
    const natural = current.last ? 316 : 304;
    const heightAt = (w: number) => {
      card.style.width = `${w}px`;
      return card.offsetHeight;
    };
    // Where the stop labels what it lights, the bubble keeps clear of the labels too, lined up with the light.
    const keep = current.diagram && extra ? joined(hole, extra) : hole;
    const p = placeBubble(keep, natural, heightAt, current.side ?? "right", aim ?? (current.diagram ? hole : null));
    card.style.width = `${p.w}px`;
    setPlaced((old) => (old && old.x === p.x && old.y === p.y && old.w === p.w && old.side === p.side && old.beak === p.beak ? old : p));
  }, [hole, aim, extra, mode, stage, current, cardRef, t.hit]);

  // The toolbar's controls, named with their keys, for the stop that labels them: read from the toolbar itself.
  useEffect(() => {
    if (!current?.diagram || !hole) {
      setTools([]);
      setExtra(null);
      return;
    }
    const on = controlsOnScreen(q('[data-tut-screen="exploration"] .xc-tools')).map((c) => c.label);
    setTools(on.length ? on : (Object.keys(CANVAS_TOOLS) as CanvasTool[]).map(toolLabel));
  }, [current, hole]);

  // Coming out of the account menu: once the card is in place, the pill flies out to it.
  useEffect(() => {
    if (phase !== "entering") return;
    if (stage || mode === "welcome" || placed) {
      const f = requestAnimationFrame(() => t.placed());
      return () => cancelAnimationFrame(f);
    }
  }, [phase, placed, stage, mode, t]);

  // Each stop takes focus to its primary button and is announced; the welcome too.
  useEffect(() => {
    if (closing || phase === "entering") return;
    const f = requestAnimationFrame(() => {
      layerRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus({ preventScroll: true });
      if (mode === "stop" && current) {
        const said = current.diagram ? ` ${toolsSaid(controlsOnScreen(q('[data-tut-screen="exploration"] .xc-tools')).map((c) => c.label))}.` : "";
        setAnnounce(`${at + 1} of ${stops.length}. ${current.title}. ${lineText(current.line)}${said}`);
      }
    });
    return () => cancelAnimationFrame(f);
  }, [key, phase, closing, mode, current, at, stops.length]);

  // While it is up, the keys belong to it, and focus cannot leave it but for the thing in the light.
  useEffect(() => {
    if (closing) {
      setKeyPolicy(null);
      return;
    }
    setKeyPolicy({ layer: () => layerRef.current, live: () => liveEl.current, canvasKeys: Boolean(current?.keys), onEscape: t.later, onFocus: t.toggleFocus });
    const keep = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.closest(".menu")) return;
      const allowed = focusables({ layer: () => layerRef.current, live: () => liveEl.current });
      if (allowed.includes(el) || layerRef.current?.contains(el) || liveEl.current?.contains(el)) return;
      layerRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", keep);
    return () => {
      setKeyPolicy(null);
      document.removeEventListener("focusin", keep);
    };
  }, [closing, current, t.later, t.toggleFocus]);

  useEffect(() => {
    const f = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(f);
  }, []);

  // A click on the dark says where the way out is.
  const nudge = () => {
    const b = layerRef.current?.querySelector<HTMLElement>("[data-later]");
    if (!b) return;
    b.removeAttribute("data-nudge");
    void b.offsetWidth;
    b.setAttribute("data-nudge", "");
  };

  const blocks: CSSProperties[] = hole
    ? [
        { left: 0, top: 0, width: "100%", height: Math.max(0, hole.y) },
        { left: 0, top: hole.y + hole.h, width: "100%", bottom: 0 },
        { left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h },
        { left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h },
      ]
    : [{ inset: 0 }];
  const spot: CSSProperties = hole
    ? { transform: `translate(${hole.x}px, ${hole.y}px)`, width: hole.w, height: hole.h }
    : { transform: `translate(${innerWidth / 2 + 137}px, ${innerHeight / 2}px)`, width: 0, height: 0 };
  const name = me.data?.display_name ?? "";

  return createPortal(
    <div
      ref={layerRef}
      className="tut-layer"
      data-dark={stage ? "" : undefined}
      data-enter={entered ? undefined : ""}
      data-leaving={closing ? "" : undefined}
      data-entering={phase === "entering" ? "" : undefined}
    >
      {blocks.map((style, i) => (
        <div key={i} className="tut-block" style={style} onClick={nudge} aria-hidden="true" />
      ))}
      {hole && !current?.live ? <div className="tut-block" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} onClick={nudge} aria-hidden="true" /> : null}
      <div className="tut-spot" data-none={hole ? undefined : ""} style={spot} aria-hidden="true" />

      {mode === "welcome" ? (
        <div
          ref={(el) => {
            cardRef.current = el;
          }}
          className="tut-card tut-welcome"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={lineId}
        >
          <div className="tut-welcome-top">
            <h2 className="tut-welcome-title" id={titleId}>
              Take the WhatBuild tutorial?
            </h2>
            <p className="tut-line" id={lineId}>
              Under a minute: the four pages, and an agent at work.
            </p>
          </div>
          <p className="tut-welcome-later">
            <Avatar name={name} />
            <span>Each page has a short tutorial of its own the first time you open it. They stay in your account menu.</span>
          </p>
          <div className="tut-foot">
            <Button size="sm" variant="quiet" className="tut-later" onClick={t.turnOff}>
              Turn off tutorials
            </Button>
            <Button size="sm" onClick={t.later} data-later="">
              Not now
            </Button>
            <Button size="sm" variant="primary" onClick={() => t.start("welcome", "welcome")} data-primary="">
              Start the tutorial
            </Button>
          </div>
        </div>
      ) : current && stage ? (
        <AgentStage />
      ) : current ? (
        <>
          {current.diagram && hole && !closing ? <ToolDiagram hole={hole} onExtent={setExtra} /> : null}
          <Bubble stop={current} placed={placed} titleId={titleId} lineId={lineId} tools={current.diagram ? tools : []} />
        </>
      ) : null}

      <div
        ref={(el) => {
          t.pillRef.current = el;
        }}
        className="tut-pill"
        hidden
        aria-hidden="true"
      >
        <Glyph name="signpost" size="sm" />
        <span>{t.pill}</span>
      </div>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>,
    document.body,
  );
}

/** A stop's bubble: where it is in its tutorial, the thing's name, its one line, and the way on. */
function Bubble({ stop, placed, titleId, lineId, tools }: { stop: Stop; placed: Placed | null; titleId: string; lineId: string; tools: ToolLabel[] }) {
  const t = useTutorial()!;
  const { at, stops } = t;
  const last = at === stops.length - 1;
  const style: CSSProperties = placed ? { transform: `translate(${Math.round(placed.x)}px, ${Math.round(placed.y)}px)` } : { visibility: "hidden" };
  const beak: CSSProperties | undefined = placed ? (placed.side === "top" || placed.side === "bottom" ? { left: placed.beak } : { top: placed.beak }) : undefined;
  return (
    <div
      ref={(el) => {
        t.cardRef.current = el;
      }}
      className="tut-card tut-bubble"
      data-side={placed?.side ?? undefined}
      data-wide={stop.last ? "" : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={lineId}
      style={style}
    >
      <span className="tut-beak" style={beak} />
      <IconButton className="tut-x" size="sm" icon="x" label="Close the tutorial" title="Close the tutorial (Esc)" onClick={t.later} data-later="" />
      <div className="tut-swap" key={stop.id}>
        <ProgressBar at={at} count={stops.length} />
        <p className="tut-count num">
          {at + 1} of {stops.length}
        </p>
        <h2 className="tut-title" id={titleId}>
          {stop.title}
        </h2>
        <p className="tut-line" id={lineId}>
          <LineText line={stop.line} hit={t.hit} />
        </p>
        {tools.length ? (
          // The diagram, for a screen reader: the controls, each with its key.
          <ul className="visually-hidden">
            {tools.map((l) => (
              <li key={l.id}>{l.key ? `${l.name}, ${l.key}` : l.name}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="tut-foot">
        {stop.last ? (
          <>
            <Button size="sm" onClick={() => t.go(at - 1)}>
              Back
            </Button>
            <span className="tut-gap" />
            <Button size="sm" onClick={() => t.finish(false)} data-later="">
              Finish
            </Button>
            <Button size="sm" variant="primary" icon="bot" onClick={() => t.finish(true)} data-primary="">
              Connect an agent
            </Button>
          </>
        ) : (
          <>
            {t.off ? (
              <span className="tut-gap" />
            ) : (
              <Button size="sm" variant="quiet" className="tut-later" onClick={t.turnOff}>
                Turn off tutorials
              </Button>
            )}
            {at > 0 ? (
              <Button size="sm" onClick={() => t.go(at - 1)}>
                Back
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => (last ? t.finish(false) : t.go(at + 1))} data-primary="">
              {last ? "Finish" : "Next"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

