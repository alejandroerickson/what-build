import { createContext, useContext, useEffect, useId, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Glyph, IconButton } from "../ui/index.tsx";
import { shortcutLabel } from "../ui/media.ts";

/**
 * What a route can put into the shell. A screen renders these anywhere in its own tree; the content is
 * portalled into the shell, so it keeps the screen's React context (router, queries, product).
 *
 *   <PanelContext label="Story pages">…</PanelContext>   the left panel's context slot, under the nav
 *   <Inspector title="…" actions={…}>…</Inspector>       the right-hand inspector (Story page, source)
 *   usePageTitle("…")                                     the document title for this screen
 */
export interface ShellSlots {
  panelContextEl: HTMLElement | null;
  inspectorEl: HTMLElement | null;
  inspectorId: string;
  /** Registers a mounted slot; returns the unregister function. */
  registerPanelContext: () => () => void;
  registerInspector: () => () => void;
  /** Whether the inspector is showing, at the current width. */
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  /** "Hide details", or "Close details" where the inspector is a phone drawer. */
  inspectorHideLabel: string;
  setPageTitle: (title: string | null) => void;
  /** Focus mode: both panels hidden so the content has the whole window. Leaving it restores them as they were. */
  focus: boolean;
  setFocus: (on: boolean) => void;
}

export const ShellContext = createContext<ShellSlots | null>(null);

export function useSlots(): ShellSlots | null {
  return useContext(ShellContext);
}

/**
 * Fills the left panel's context slot (under L1 and the quiet group): the Story tree, source
 * filters, Exploration's mockups and lists.
 * It scrolls on its own. Give it a label; it becomes the region's accessible name.
 */
export function PanelContext({ label, children }: { label: string; children: ReactNode }) {
  const slots = useSlots();
  const register = slots?.registerPanelContext;
  useLayoutEffect(() => register?.(), [register]);
  if (!slots?.panelContextEl) return null;
  return createPortal(
    <section className="panel-context-body" aria-label={label}>
      {children}
    </section>,
    slots.panelContextEl,
  );
}

/**
 * Fills the inspector, the right-hand panel. Only a Story page and a source page use it. The shell
 * owns showing and hiding it: the hide button in its head, the show button at the top right, and
 * ⇧⌘\ / Ctrl+Shift+\. It docks beside the content, and on a phone it is a drawer.
 */
export function Inspector({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const slots = useSlots();
  const register = slots?.registerInspector;
  useLayoutEffect(() => register?.(), [register]);
  if (!slots?.inspectorEl) return null;
  return createPortal(
    <>
      <header className="inspector-head">
        <h2 className="inspector-title" id={`${slots.inspectorId}-title`}>
          {title}
        </h2>
        {actions}
        <IconButton
          label={slots.inspectorHideLabel}
          title={`${slots.inspectorHideLabel} (${shortcutLabel("\\", true)})`}
          icon="panel-right-close"
          onClick={() => slots.setInspectorOpen(false)}
          data-inspector-hide=""
        />
      </header>
      <div className="inspector-body">{children}</div>
    </>,
    slots.inspectorEl,
  );
}

/** Sets the document title while the screen is mounted: "<title> · <product> · WhatBuild". */
export function usePageTitle(title: string | null | undefined) {
  const slots = useSlots();
  const set = slots?.setPageTitle;
  useEffect(() => {
    if (!set || !title) return;
    set(title);
    return () => set(null);
  }, [set, title]);
}

/**
 * A section inside the panel's context slot, with an optional right-hand control: a group named by
 * its title, which is a heading, as the inspector's groups' are, so assistive technology reads the
 * panel's structure and can move by its headings.
 */
export function PanelSection({ title, end, children }: { title: ReactNode; end?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="panel-section" role="group" aria-labelledby={id}>
      <div className="panel-section-head">
        <h2 id={id} className="panel-section-title">
          {title}
        </h2>
        {end}
      </div>
      {children}
    </div>
  );
}

/**
 * One single-select filter in a panel section: a real link that sets URL parameters. The current
 * one is marked with a check or, where the filters carry counts, the way the nav marks its current
 * section: the selection fill, with the count beside it.
 */
export function PanelFilter({ to, current, count, sub, replace = true, children }: {
  to: string;
  current: boolean;
  count?: ReactNode;
  /** Indented under the filter before it (a kind under its group). */
  sub?: boolean;
  /** Filters that narrow the same list replace the history entry; ones that open another list add one. */
  replace?: boolean;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`panel-filter${sub ? " panel-filter-sub" : ""}`} aria-current={current ? "true" : undefined} replace={replace}>
      <span className="panel-filter-label">{children}</span>
      {count !== undefined ? <span className="panel-filter-count num">{count}</span> : current ? <Glyph name="check" size="sm" /> : null}
    </Link>
  );
}
