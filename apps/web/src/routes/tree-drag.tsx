import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Glyph, type GlyphName } from "../ui/index.tsx";

/**
 * A row of a panel tree while it is dragged (the Story's pages, the mockups and their folders): a
 * lifted copy of it follows the pointer, held where the person took hold of it, so the hand is
 * seen carrying the row to where it will land.
 */

/** Where a row was taken hold of: how far into it the pointer pressed, and the row's width and type as it stood. */
export interface Hold {
  dx: number;
  dy: number;
  width: number;
  font: string;
}

/** The hold a press on a row's handle takes: the row is the handle's `[data-row]`. */
export function holdOf(e: ReactPointerEvent<HTMLElement>): Hold {
  const row = e.currentTarget.closest<HTMLElement>("[data-row]") ?? e.currentTarget;
  const r = row.getBoundingClientRect();
  return { dx: e.clientX - r.left, dy: e.clientY - r.top, width: r.width, font: getComputedStyle(row).font };
}

/** The dragged row, lifted, under the pointer at `x`, `y`. It takes no pointer events, so the row beneath is still found. */
export function DragGhost({ hold, x, y, glyph, title }: { hold: Hold; x: number; y: number; glyph: GlyphName; title: string }) {
  return createPortal(
    <div className="tree-drag-ghost" aria-hidden="true" style={{ width: hold.width, font: hold.font, transform: `translate(${Math.round(x - hold.dx)}px, ${Math.round(y - hold.dy)}px)` }}>
      <span className="tree-drag-ghost-grip">
        <Glyph name="grip" size="sm" />
      </span>
      <Glyph name={glyph} />
      <span className="tree-drag-ghost-title">{title}</span>
    </div>,
    document.body,
  );
}
