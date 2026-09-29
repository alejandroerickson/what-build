import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";
import type { Product } from "../lib/session.tsx";
import { Callout, Glyph } from "../ui/index.tsx";
import { isTypingTarget, NARROW_QUERY, PHONE_QUERY, shortcutLabel, useMediaQuery } from "../ui/media.ts";
import { BrandMark } from "./brand.tsx";
import { AccountMenu, BrandRow, PlainNav, ProductNav, ProductSwitcher, productSection, useLastProduct } from "./panel.tsx";
import { ShellContext, type ShellSlots } from "./slots.tsx";

const NAV_KEY = "whatbuild.nav";

function readNavHidden(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === "closed";
  } catch {
    return false;
  }
}

/**
 * The stage every signed-in screen lives on: a floating left panel, the canvas (the one scroller),
 * and an inspector when a route provides one.
 *
 * - The panel hides fully with its button or ⌘\ / Ctrl+\ (not while typing); the choice is remembered.
 *   While hidden, a pill with the mark, the product and the section brings it back.
 * - At ≤760px the panel is a drawer with a scrim: focus is trapped, Esc closes it, and it closes on
 *   navigation.
 * - The inspector docks at the right above 1100px; at or below it is an overlay (focus trapped, Esc).
 * - On a route change the canvas scrolls to the top, focus moves to the new h1, and the new page is
 *   announced politely.
 */
function Stage({ variant, panel, panelFoot, pillName, section, title, banner, children }: {
  variant: "product" | "plain";
  /** The panel above the context slot: brand row and navigation. */
  panel: (hide: () => void, hideLabel: string) => ReactNode;
  /** The panel below the context slot: the account menu. */
  panelFoot: ReactNode;
  pillName: string | null;
  section: string;
  /** Default document title parts, before any usePageTitle override. */
  title: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const loc = useLocation();
  const [navHidden, setNavHidden] = useState(readNavHidden);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelContextEl, setPanelContextEl] = useState<HTMLElement | null>(null);
  const [inspectorEl, setInspectorEl] = useState<HTMLElement | null>(null);
  const [contextCount, setContextCount] = useState(0);
  const [inspectorCount, setInspectorCount] = useState(0);
  const [inspectorOpen, setInspectorOpenState] = useState(false);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inspectorId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const inspectorReturn = useRef<HTMLElement | null>(null);

  const navOpen = isPhone ? drawerOpen : !navHidden;
  const hasInspector = inspectorCount > 0;
  const insState = !hasInspector ? "none" : !isNarrow ? "docked" : inspectorOpen ? "open" : "closed";
  const drawerActive = isPhone && drawerOpen;
  const overlayActive = insState === "open";

  const toggleNav = useCallback(() => {
    if (window.matchMedia(PHONE_QUERY).matches) {
      setDrawerOpen((o) => !o);
      return;
    }
    // Keep focus somewhere visible: hiding the panel from inside it lands on the pill; showing it
    // from the pill lands on the panel's hide button.
    const active = document.activeElement;
    const fromPanel = !active || active === document.body || Boolean(panelRef.current?.contains(active));
    const fromPill = active === pillRef.current;
    setNavHidden((h) => {
      try {
        localStorage.setItem(NAV_KEY, h ? "open" : "closed");
      } catch {
        // The choice lasts for this visit.
      }
      return !h;
    });
    requestAnimationFrame(() => {
      const pill = pillRef.current;
      if (pill && !pill.hidden && fromPanel) pill.focus();
      else if (pill?.hidden && fromPill) panelRef.current?.querySelector<HTMLElement>("[data-panel-hide]")?.focus();
    });
  }, []);

  const setInspectorOpen = useCallback((open: boolean) => {
    if (open) inspectorReturn.current = document.activeElement as HTMLElement | null;
    setInspectorOpenState(open);
    if (!open) {
      const back = inspectorReturn.current;
      requestAnimationFrame(() => (back?.isConnected ? back : document.querySelector<HTMLElement>("[data-inspector-toggle]"))?.focus());
    }
  }, []);

  // Global keys: the panel shortcut, and Esc for the open overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        toggleNav();
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        if (document.querySelector("dialog[open], .menu")) return;
        if (drawerActive) {
          setDrawerOpen(false);
          pillRef.current?.focus();
        } else if (overlayActive) setInspectorOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNav, drawerActive, overlayActive, setInspectorOpen]);

  // Opening the drawer moves focus into it; opening the inspector overlay focuses its close button.
  useEffect(() => {
    if (drawerActive) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [drawerActive]);
  useEffect(() => {
    if (overlayActive) requestAnimationFrame(() => document.getElementById(inspectorId)?.querySelector<HTMLElement>(".inspector-close, button, a")?.focus());
  }, [overlayActive, inspectorId]);

  // Route changes: close overlays, scroll to top, move focus to the h1, announce.
  const firstPath = useRef(true);
  useEffect(() => {
    setDrawerOpen(false);
    setInspectorOpenState(false);
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    let done = false;
    const land = () => {
      const h1 = main.querySelector<HTMLElement>("h1");
      if (!h1 || done) return false;
      done = true;
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
      setAnnouncement(h1.textContent?.trim() || document.title);
      return true;
    };
    if (land()) return;
    const obs = new MutationObserver(() => land() && obs.disconnect());
    obs.observe(main, { childList: true, subtree: true });
    const t = setTimeout(() => {
      obs.disconnect();
      if (!done) {
        done = true;
        main.focus({ preventScroll: true });
        setAnnouncement(document.title);
      }
    }, 3000);
    return () => {
      obs.disconnect();
      clearTimeout(t);
    };
  }, [loc.pathname]);

  useEffect(() => {
    // A screen named after its section ("Evidence · Evidence") says it once.
    const parts = [...(pageTitle ? [pageTitle] : []), ...title.split(" · ")];
    document.title = parts.filter((p, i) => p !== parts[i - 1]).join(" · ");
  }, [pageTitle, title]);

  const slots = useMemo<ShellSlots>(
    () => ({
      panelContextEl,
      inspectorEl,
      inspectorId,
      registerPanelContext: () => {
        setContextCount((n) => n + 1);
        return () => setContextCount((n) => n - 1);
      },
      registerInspector: () => {
        setInspectorCount((n) => n + 1);
        return () => setInspectorCount((n) => n - 1);
      },
      inspectorOverlay: isNarrow,
      inspectorOpen,
      setInspectorOpen,
      setPageTitle,
    }),
    [panelContextEl, inspectorEl, inspectorId, isNarrow, inspectorOpen, setInspectorOpen],
  );

  const hideLabel = isPhone ? "Close navigation" : "Hide panel";
  const scrim = drawerActive || overlayActive;

  return (
    <ShellContext.Provider value={slots}>
      <div className="stage" data-nav={navOpen ? "open" : "closed"} data-ins={insState} data-variant={variant}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <button
          ref={pillRef}
          type="button"
          className="show-pill"
          hidden={navOpen}
          inert={drawerActive || overlayActive}
          title={`Show panel (${shortcutLabel("\\")})`}
          aria-expanded={isPhone ? drawerOpen : undefined}
          onClick={toggleNav}
        >
          <BrandMark size={18} />
          {pillName ? <span className="show-pill-name">{pillName}</span> : null}
          <span className="show-pill-section">{section}</span>
          <span className="visually-hidden">, show panel</span>
          <Glyph name="panel-left-open" />
        </button>
        <div
          className="scrim"
          hidden={!scrim}
          data-tone={drawerActive || isPhone ? "dim" : "clear"}
          aria-hidden="true"
          onClick={() => (drawerActive ? setDrawerOpen(false) : setInspectorOpen(false))}
        />
        <div
          ref={panelRef}
          className="panel panel-left"
          role={drawerActive ? "dialog" : undefined}
          aria-modal={drawerActive || undefined}
          aria-label={drawerActive ? "Navigation" : undefined}
          inert={!navOpen || overlayActive}
        >
          {panel(toggleNav, hideLabel)}
          <div className="panel-context" ref={setPanelContextEl} hidden={contextCount === 0} />
          {contextCount === 0 ? <div className="panel-spacer" /> : null}
          {panelFoot}
        </div>
        <main id="main" ref={mainRef} className="canvas" tabIndex={-1} inert={drawerActive || overlayActive}>
          <div className="canvas-wrap">
            {banner}
            {children}
          </div>
        </main>
        <aside
          id={inspectorId}
          ref={setInspectorEl}
          className="panel inspector"
          hidden={!hasInspector}
          inert={insState === "closed" || drawerActive}
          role={overlayActive ? "dialog" : undefined}
          aria-modal={overlayActive || undefined}
          aria-labelledby={`${inspectorId}-title`}
        />
        <div className="visually-hidden" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </div>
    </ShellContext.Provider>
  );
}

/** Every screen inside a product: L1, the quiet group, the context slot, the account menu. */
export function ProductShell({ product, app, children }: { product: Product; app: string; children: ReactNode }) {
  const loc = useLocation();
  const section = productSection(loc.pathname.split("/")[5]);
  return (
    <Stage
      variant="product"
      pillName={product.name}
      section={section.label}
      title={`${section.label} · ${product.name} · WhatBuild`}
      banner={
        product.archived_at ? (
          <div className="canvas-banner">
            <Callout tone="attention" title="This product is archived">
              It is read-only. An admin can restore it in Settings.
            </Callout>
          </div>
        ) : null
      }
      panel={(hide, hideLabel) => (
        <>
          <BrandRow to={`${app}/idea`} label={`WhatBuild, ${product.name} idea`} onHide={hide} hideLabel={hideLabel} />
          <nav className="panel-nav" aria-label={product.name}>
            <ProductSwitcher current={product} />
            <ProductNav product={product} app={app} section={section.id} />
          </nav>
        </>
      )}
      panelFoot={<AccountMenu activityTo={`${app}/activity`} />}
    >
      {children}
    </Stage>
  );
}

const PLAIN_SECTIONS: Record<string, string> = { connect: "Agents", account: "Account", products: "Products", members: "Members", _system: "System" };

/**
 * Screens outside a product (Agents, account, organization members, all products): the same stage
 * with the non-product panel, which offers "Back to <product>" for the product the person came from.
 */
export function PlainShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const params = useParams();
  const last = useLastProduct();
  const parts = loc.pathname.split("/").filter(Boolean);
  const key = parts[0] === "t" ? "members" : (parts[0] ?? "products");
  const section = PLAIN_SECTIONS[key] ?? "WhatBuild";
  const sectionId = key === "connect" ? "agents" : key;
  const tenantSlug = params["tenant"] ?? last?.tenant.slug ?? null;
  const tenantName = last && last.tenant.slug === tenantSlug ? last.tenant.name : null;
  const home = last ? `/t/${last.path}/idea` : "/products";
  return (
    <Stage
      variant="plain"
      pillName={null}
      section={section}
      title={`${section} · WhatBuild`}
      panel={(hide, hideLabel) => (
        <>
          <BrandRow to={home} label={last ? `WhatBuild, ${last.name} idea` : "WhatBuild, all products"} onHide={hide} hideLabel={hideLabel} />
          <nav className="panel-nav" aria-label="Account and organization">
            <PlainNav section={sectionId} backTo={last ? `/t/${last.path}/idea` : null} backLabel={last?.name ?? null} tenantSlug={tenantSlug} tenantName={tenantName} />
          </nav>
        </>
      )}
      panelFoot={<AccountMenu activityTo={last ? `/t/${last.path}/activity` : null} />}
    >
      {children}
    </Stage>
  );
}
