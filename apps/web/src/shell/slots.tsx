import { createContext, useContext, useEffect, useId, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../ui/index.tsx";

/**
 * What a route can put into the shell. A screen renders these anywhere in its own tree; the content is
 * portalled into the shell, so it keeps the screen's React context (router, queries, product).
 *
 *   <PanelContext label="Story pages">…</PanelContext>   the left panel's context slot, under the nav
 *   <Inspector title="…" actions={…}>…</Inspector>       the right-hand inspector (Story page, source)
 *   <InspectorToggle />                                   "Details": opens the inspector at ≤1100px
 *   usePageTitle("…")                                     the document title for this screen
 */
export interface ShellSlots {
  panelContextEl: HTMLElement | null;
  inspectorEl: HTMLElement | null;
  inspectorId: string;
  /** Registers a mounted slot; returns the unregister function. */
  registerPanelContext: () => () => void;
  registerInspector: () => () => void;
  /** At ≤1100px the inspector is an overlay: whether it is open. */
  inspectorOverlay: boolean;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  setPageTitle: (title: string | null) => void;
}

export const ShellContext = createContext<ShellSlots | null>(null);

function useSlots(): ShellSlots | null {
  return useContext(ShellContext);
}

/**
 * Fills the left panel's context slot (under L1 and the quiet group): the Story tree, source filters.
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
 * Fills the inspector, the right-hand panel. Only a Story page and a source page use it. Above 1100px
 * it docks beside the content; at or below, it is an overlay opened by <InspectorToggle />, with a
 * scrim on a phone, a focus trap and Esc to close.
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
        {slots.inspectorOverlay ? <IconButton className="inspector-close" label="Close details" icon="x" onClick={() => slots.setInspectorOpen(false)} /> : null}
      </header>
      <div className="inspector-body">{children}</div>
    </>,
    slots.inspectorEl,
  );
}

/** The "Details" button that opens the inspector overlay. Renders nothing while the inspector is docked. */
export function InspectorToggle({ label = "Details" }: { label?: string }) {
  const slots = useSlots();
  if (!slots?.inspectorOverlay) return null;
  return (
    <Button
      size="sm"
      variant="quiet"
      icon="panel-right"
      aria-expanded={slots.inspectorOpen}
      aria-controls={slots.inspectorId}
      data-inspector-toggle=""
      onClick={() => slots.setInspectorOpen(!slots.inspectorOpen)}
    >
      {label}
    </Button>
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

/** A labelled section inside the panel's context slot, with an optional right-hand control. */
export function PanelSection({ title, end, children }: { title: ReactNode; end?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="panel-section" role="group" aria-labelledby={id}>
      <div className="panel-section-head">
        <span id={id}>{title}</span>
        {end}
      </div>
      {children}
    </div>
  );
}
