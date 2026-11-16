import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CANVAS_TOOLS, type CanvasTool } from "../routes/mockup-canvas.tsx";
import type { Box } from "./flight.ts";

/**
 * The canvas toolbar as a labelled diagram, in the tutorial's layer: every control named with its
 * key, all at once, with a thin leader line from the control to its label. Names and keys come from
 * the toolbar's own definitions (`CANVAS_TOOLS`), and the controls' places from the toolbar on the
 * screen (`data-tool`), so the diagram cannot drift from the toolbar. The toolbar itself is unchanged.
 *
 * The labels stand in rows above the bar, on its two sides, split where one of the bar's groups ends:
 * each control's line rises from it and turns to its label, the outermost control's lowest, so no line
 * crosses another or a label; a gap between rows shows where the bar's groups part. Where the bar is
 * short of room its last group wraps onto a second row (at 1024 wide, beside the panels): that
 * control's line leaves along its row, past the bar's edge, before it rises.
 */

export interface ToolLabel {
  id: CanvasTool;
  name: string;
  key: string | null;
}

/** What labels a control: its name and key, as the toolbar's own definitions give them. */
export function toolLabel(id: CanvasTool): ToolLabel {
  return { id, name: CANVAS_TOOLS[id].name, key: CANVAS_TOOLS[id].key };
}

/** How a screen reader hears the diagram: each control's name and key, in the bar's order. */
export function toolsSaid(labels: ToolLabel[]): string {
  return labels.map((l) => (l.key ? `${l.name}, ${l.key}` : l.name)).join(". ");
}

export interface Control {
  label: ToolLabel;
  /** The control on the screen. */
  box: Box;
  /** Which of the bar's groups it is in, counted from the left. */
  group: number;
}

/** The toolbar's controls on the screen, in the bar's own order, each with its label and its group. */
export function controlsOnScreen(bar: Element | null): Control[] {
  if (!bar) return [];
  const groups = [...bar.children];
  return [...bar.querySelectorAll<HTMLElement>("[data-tool], .xc-tool-keys")]
    .map((el) => {
      const r = el.getBoundingClientRect();
      const id = (el.dataset["tool"] ?? "keys") as CanvasTool;
      const top = groups.findIndex((g) => g === el || g.contains(el));
      return { label: toolLabel(id), box: { x: r.left, y: r.top, w: r.width, h: r.height }, group: top };
    })
    .filter((c) => c.box.w > 0 && c.label.name);
}

export interface Placed {
  /** The label's own box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The leader, from the control to the label: up and across, or out along a wrapped row first. */
  points: { x: number; y: number }[];
  side: "left" | "right";
}

const LABEL_H = 22;
const ROW = 27;
const GROUP_GAP = 8;
const LIFT = 16;
const SIDE_GAP = 18;
const EDGE = 12;

/**
 * Where each label goes. The controls split into a left and a right side at the group boundary
 * nearest the middle; on each side the outermost control's label is the lowest row, and each next
 * one a row higher (a little higher again where a group ends), standing beside the bar.
 */
export function layoutLabels(controls: Control[], widths: number[], window: { w: number }, bar?: Box): Placed[] {
  const n = controls.length;
  if (!n) return [];
  const barLeft = bar?.x ?? Math.min(...controls.map((c) => c.box.x));
  const barRight = bar ? bar.x + bar.w : Math.max(...controls.map((c) => c.box.x + c.box.w));
  const barTop = Math.min(...controls.map((c) => c.box.y));
  // The split: where a group ends, as near the middle as the groups allow.
  let split = Math.ceil(n / 2);
  let best = Infinity;
  for (let i = 1; i < n; i++) {
    if (controls[i]!.group === controls[i - 1]!.group) continue;
    const d = Math.abs(i - n / 2);
    if (d < best) {
      best = d;
      split = i;
    }
  }
  const out: Placed[] = new Array(n);
  const place = (order: number[], side: "left" | "right") => {
    let y = barTop - LIFT - LABEL_H / 2;
    order.forEach((i, k) => {
      const c = controls[i]!;
      if (k > 0 && controls[order[k - 1]!]!.group !== c.group) y -= GROUP_GAP;
      const w = widths[i]!;
      const x = side === "left" ? Math.max(EDGE, barLeft - SIDE_GAP - w) : Math.min(window.w - EDGE - w, barRight + SIDE_GAP);
      const cx = c.box.x + c.box.w / 2;
      const to = { x: side === "left" ? x + w : x, y };
      // A control on a wrapped row leaves along it, past the bar's edge, then rises: never through the row above.
      const wrapped = c.box.y > barTop + c.box.h / 2;
      const out_ = side === "left" ? barLeft - 8 : barRight + 8;
      const cy = c.box.y + c.box.h / 2;
      const points = wrapped
        ? [{ x: side === "left" ? c.box.x : c.box.x + c.box.w, y: cy }, { x: out_, y: cy }, { x: out_, y }, to]
        : [{ x: cx, y: c.box.y }, { x: cx, y }, to];
      out[i] = { x, y: y - LABEL_H / 2, w, h: LABEL_H, points, side };
      y -= ROW;
    });
  };
  // Outermost first: on the left the first control, on the right the last.
  place(controls.map((_, i) => i).slice(0, split), "left");
  place(controls.map((_, i) => i).slice(split).reverse(), "right");
  return out;
}

/** The labels' extent, for the bubble to keep clear of. */
export function extentOf(placed: Placed[]): Box | null {
  if (!placed.length) return null;
  const l = Math.min(...placed.map((p) => p.x));
  const t = Math.min(...placed.map((p) => p.y));
  const r = Math.max(...placed.map((p) => p.x + p.w));
  const b = Math.max(...placed.flatMap((p) => p.points.map((q) => q.y)));
  return { x: l, y: t, w: r - l, h: b - t };
}

/** The diagram over the lit toolbar. `hole` changes as the toolbar settles; the labels follow it. */
export function ToolDiagram({ hole, onExtent }: { hole: Box; onExtent: (b: Box | null) => void }) {
  const [controls, setControls] = useState<Control[]>([]);
  const [placed, setPlaced] = useState<Placed[] | null>(null);
  const [bar, setBar] = useState<Box | null>(null);
  const sizer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const read = () => {
      const el = document.querySelector('[data-tut-screen="exploration"] .xc-tools');
      const r = el?.getBoundingClientRect();
      setBar(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
      setControls(controlsOnScreen(el));
    };
    read();
    addEventListener("resize", read);
    return () => removeEventListener("resize", read);
  }, [hole]);
  useLayoutEffect(() => {
    const labels = sizer.current ? [...sizer.current.children] as HTMLElement[] : [];
    if (!controls.length || labels.length !== controls.length) {
      setPlaced(null);
      onExtent(null);
      return;
    }
    const p = layoutLabels(controls, labels.map((l) => l.offsetWidth), { w: innerWidth }, bar ?? undefined);
    setPlaced(p);
    onExtent(extentOf(p));
  }, [controls, bar, onExtent]);
  const label = (c: Control, style?: CSSProperties, i = 0) => (
    <div key={c.label.id} className="tut-tool-label" style={{ ...style, "--i": i } as CSSProperties}>
      <span>{c.label.name}</span>
      {c.label.key ? <kbd className="kbd tut-kbd">{c.label.key}</kbd> : null}
    </div>
  );
  return (
    <div className="tut-diagram" aria-hidden="true">
      {/* Measured once, unseen, so the labels can be placed at their own widths. */}
      <div ref={sizer} className="tut-diagram-sizer">
        {controls.map((c) => label(c))}
      </div>
      {placed ? (
        <>
          <svg className="tut-diagram-lines" width="100%" height="100%">
            {placed.map((p, i) => (
              <g key={controls[i]!.label.id} style={{ "--i": i } as CSSProperties}>
                <polyline points={p.points.map((q) => `${q.x},${q.y}`).join(" ")} />
                <circle cx={p.points[0]!.x} cy={p.points[0]!.y} r="2" />
              </g>
            ))}
          </svg>
          {placed.map((p, i) => label(controls[i]!, { transform: `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)` }, i))}
        </>
      ) : null}
    </div>
  );
}
