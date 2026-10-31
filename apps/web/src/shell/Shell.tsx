import { READ_ONLY_ALLOWS } from "@whatbuild/core/read-only";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { keptLine } from "../lib/limits.ts";
import type { Product } from "../lib/session.tsx";
import { ButtonLink, Callout, Glyph } from "../ui/index.tsx";
import { isTypingTarget, NARROW_QUERY, PHONE_QUERY, shortcutLabel, useMediaQuery } from "../ui/media.ts";
import { BrandMark } from "./brand.tsx";
import { AccountMenu, BrandRow, PlainNav, ProductNav, ProductSwitcher, productSection } from "./panel.tsx";
import { FindLauncher, FindProvider } from "./find-palette.tsx";
import { ExampleBanner } from "./ExampleBanner.tsx";
import { ShellContext, type ShellSlots } from "./slots.tsx";

const NAV_KEY = "whatbuild.nav";
const INS_KEY = "whatbuild.inspector";

function readHidden(key: string): boolean {
  try {
    return localStorage.getItem(key) === "closed";
  } catch {
    return false;
  }
}

function saveHidden(key: string, hidden: boolean) {
  try {
    localStorage.setItem(key, hidden ? "closed" : "open");
  } catch {
    // The choice lasts for this visit.
  }
}

/**
 * The stage every signed-in screen lives on: a floating left panel, the canvas (the one scroller),
 * and an inspector when a route provides one.
 *
 * - The panel hides fully with its button or ⌘\ / Ctrl+\ (not while typing); the choice is remembered.
 *   While hidden, a pill with the mark brings it back; it is named for the product and the section.
 * - Hiding or showing a panel never moves the content up or down: the canvas keeps clear of the
 *   show buttons at the sides.
 * - The inspector works the same way on the right: it hides with the button in its head or ⇧⌘\ /
 *   Ctrl+Shift+\, and a button at the top right brings it back. Open, it docks beside the canvas at
 *   every width above a phone. Above 1100px the choice is remembered; at or below it starts hidden,
 *   so a narrowing window hands the space to the content.
 * - At ≤760px either panel is a drawer with a scrim: focus is trapped, Esc closes it, and it closes
 *   on navigation. Only one drawer is open at a time.
 * - On a route change the canvas scrolls to the top, focus moves to the new h1, and the new page is
 *   announced politely.
 * - A screen may turn on focus mode (the Story does): both panels and their show buttons go, and the
 *   canvas takes the window. Turning it off, or either panel shortcut, restores the panels as they were.
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
  const [navHidden, setNavHidden] = useState(() => readHidden(NAV_KEY));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [insHidden, setInsHidden] = useState(() => readHidden(INS_KEY));
  // At ≤1100px the inspector starts hidden, and hides again whenever the window crosses 1100px.
  const [insSmallOpen, setInsSmallOpen] = useState(false);
  const [panelContextEl, setPanelContextEl] = useState<HTMLElement | null>(null);
  const [inspectorEl, setInspectorEl] = useState<HTMLElement | null>(null);
  const [contextCount, setContextCount] = useState(0);
  const [inspectorCount, setInspectorCount] = useState(0);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focus, setFocus] = useState(false);
  const inspectorId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const insShowRef = useRef<HTMLButtonElement>(null);

  const navOpen = !focus && (isPhone ? drawerOpen : !navHidden);
  const hasInspector = inspectorCount > 0;
  const inspectorOpen = !focus && hasInspector && (isNarrow ? insSmallOpen : !insHidden);
  const insState = !hasInspector ? "none" : !inspectorOpen ? "closed" : isPhone ? "drawer" : "docked";
  const drawerActive = isPhone && drawerOpen;
  const insDrawerActive = insState === "drawer";
  const modal = drawerActive || insDrawerActive;

  useEffect(() => setInsSmallOpen(false), [isNarrow]);

  const toggleNav = useCallback(() => {
    if (window.matchMedia(PHONE_QUERY).matches) {
      setInsSmallOpen(false);
      setDrawerOpen((o) => !o);
      return;
    }
    // Keep focus somewhere visible: hiding the panel from inside it lands on the pill; showing it
    // from the pill lands on the panel's hide button.
    const active = document.activeElement;
    const fromPanel = !active || active === document.body || Boolean(panelRef.current?.contains(active));
    const fromPill = active === pillRef.current;
    setNavHidden((h) => {
      saveHidden(NAV_KEY, !h);
      return !h;
    });
    requestAnimationFrame(() => {
      const pill = pillRef.current;
      if (pill && !pill.hidden && fromPanel) pill.focus({ preventScroll: true });
      else if (pill?.hidden && fromPill) panelRef.current?.querySelector<HTMLElement>("[data-panel-hide]")?.focus({ preventScroll: true });
    });
  }, []);

  /**
   * Shows or hides the inspector at the current width. Focus follows the control, as with the left
   * panel: hiding from inside the inspector lands on the button that brings it back, and showing it
   * lands on its hide button.
   */
  const setInspectorOpen = useCallback((open: boolean) => {
    const active = document.activeElement;
    const inspector = document.getElementById(inspectorId);
    const fromInspector = !active || active === document.body || Boolean(inspector?.contains(active));
    const fromShow = active === insShowRef.current;
    if (window.matchMedia(NARROW_QUERY).matches) {
      if (open && window.matchMedia(PHONE_QUERY).matches) setDrawerOpen(false);
      setInsSmallOpen(open);
    } else {
      saveHidden(INS_KEY, !open);
      setInsHidden(!open);
    }
    requestAnimationFrame(() => {
      // The inspector is still sliding in, partly outside the window: focusing without preventScroll
      // would pull the whole stage sideways to reveal the button.
      if (!open && fromInspector) insShowRef.current?.focus({ preventScroll: true });
      else if (open && fromShow) inspector?.querySelector<HTMLElement>("[data-inspector-hide]")?.focus({ preventScroll: true });
    });
  }, [inspectorId]);
  const toggleInspector = useCallback(() => setInspectorOpen(!inspectorOpen), [setInspectorOpen, inspectorOpen]);

  // Global keys: the two panel shortcuts, and Esc for an open drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !isTypingTarget(e.target);
      const navKey = mod && !e.shiftKey && e.key === "\\";
      const insKey = mod && e.shiftKey && (e.key === "|" || e.key === "\\") && hasInspector;
      if (focus && (navKey || insKey)) {
        e.preventDefault();
        setFocus(false);
      } else if (navKey) {
        e.preventDefault();
        toggleNav();
      } else if (insKey) {
        e.preventDefault();
        toggleInspector();
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        if (document.querySelector("dialog[open], .menu")) return;
        if (drawerActive) {
          setDrawerOpen(false);
          pillRef.current?.focus();
        } else if (insDrawerActive) setInspectorOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNav, toggleInspector, hasInspector, drawerActive, insDrawerActive, setInspectorOpen, focus]);

  // Opening a drawer moves focus into it.
  useEffect(() => {
    if (drawerActive) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, [drawerActive]);
  useEffect(() => {
    if (insDrawerActive) requestAnimationFrame(() => document.getElementById(inspectorId)?.querySelector<HTMLElement>("[data-inspector-hide]")?.focus({ preventScroll: true }));
  }, [insDrawerActive, inspectorId]);

  // Route changes: close drawers, scroll to top, move focus to the h1, announce.
  const firstPath = useRef(true);
  useEffect(() => {
    setDrawerOpen(false);
    if (window.matchMedia(PHONE_QUERY).matches) setInsSmallOpen(false);
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
      inspectorOpen,
      setInspectorOpen,
      inspectorHideLabel: isPhone ? "Close details" : "Hide details",
      setPageTitle,
      focus,
      setFocus,
    }),
    [panelContextEl, inspectorEl, inspectorId, isPhone, inspectorOpen, setInspectorOpen, focus],
  );

  const hideLabel = isPhone ? "Close navigation" : "Hide panel";

  return (
    <ShellContext.Provider value={slots}>
      <div className="stage" data-nav={navOpen ? "open" : "closed"} data-ins={insState} data-variant={variant} data-focus={focus ? "on" : undefined}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <button
          ref={pillRef}
          type="button"
          className="show-pill"
          hidden={navOpen || focus}
          inert={modal}
          title={`Show panel (${shortcutLabel("\\")})`}
          aria-expanded={isPhone ? drawerOpen : undefined}
          onClick={toggleNav}
        >
          <BrandMark size={18} />
          <span className="visually-hidden">Show panel: {pillName ? `${pillName}, ` : ""}{section}</span>
          <Glyph name="panel-left-open" />
        </button>
        <button
          ref={insShowRef}
          type="button"
          className="show-ins"
          hidden={insState !== "closed" || focus}
          inert={modal}
          aria-label="Show details"
          title={`Show details (${shortcutLabel("\\", true)})`}
          aria-controls={inspectorId}
          aria-expanded={isPhone ? false : undefined}
          onClick={() => setInspectorOpen(true)}
        >
          <Glyph name="panel-right-open" />
        </button>
        <div className="scrim" hidden={!modal} aria-hidden="true" onClick={() => (drawerActive ? setDrawerOpen(false) : setInspectorOpen(false))} />
        <div
          ref={panelRef}
          className="panel panel-left"
          role={drawerActive ? "dialog" : undefined}
          aria-modal={drawerActive || undefined}
          aria-label={drawerActive ? "Navigation" : undefined}
          inert={!navOpen || insDrawerActive}
        >
          {panel(toggleNav, hideLabel)}
          <div className="panel-context" ref={setPanelContextEl} hidden={contextCount === 0} />
          {contextCount === 0 ? <div className="panel-spacer" /> : null}
          {panelFoot}
        </div>
        <main id="main" ref={mainRef} className="canvas" tabIndex={-1} inert={modal}>
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
          role={insDrawerActive ? "dialog" : undefined}
          aria-modal={insDrawerActive || undefined}
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
  const base = `/api/v1/p/${product.path}`;
  return (
    <FindProvider app={app} base={base} product={product}>
    <Stage
      variant="product"
      pillName={product.name}
      section={section.label}
      title={`${section.label} · ${product.name} · WhatBuild`}
      banner={
        <>
          {product.tenant.example ? <ExampleBanner tenant={product.tenant} /> : null}
          {product.tenant.read_only ? (
            <div className="canvas-banner">
              <Callout
                tone="attention"
                title={`${product.tenant.name} is read-only`}
                action={
                  <ButtonLink to={`/t/${product.tenant.slug}/plan`} size="sm">
                    See plan
                  </ButtonLink>
                }
              >
                It went back to the plan new organizations start on while whoever started it already has one there, so nothing new can be added. {READ_ONLY_ALLOWS}{" "}
                {keptLine(product.tenant.read_only)}.
              </Callout>
            </div>
          ) : null}
          {product.archived_at ? (
            <div className="canvas-banner">
              <Callout tone="attention" title="This product is archived">
                It&rsquo;s read-only. An admin can restore it in Settings.
              </Callout>
            </div>
          ) : null}
        </>
      }
      panel={(hide, hideLabel) => (
        <>
          <BrandRow to="/" label="WhatBuild, home" onHide={hide} hideLabel={hideLabel} />
          <nav className="panel-nav" aria-label={product.name}>
            <ProductSwitcher current={product} />
            <FindLauncher product={product} />
            <ProductNav product={product} app={app} section={section.id} />
          </nav>
        </>
      )}
      panelFoot={<AccountMenu />}
    >
      {children}
    </Stage>
    </FindProvider>
  );
}

const PLAIN_SECTIONS: Record<string, string> = { connect: "Connect an agent", settings: "Settings", instance: "Organizations", people: "People", members: "Members", plan: "Plan", limits: "Plan", _system: "System" };

/**
 * The plain screen an address names: its one part, or Members or Plan under
 * /t/<organization>/. Anything else (a product that didn't open, an address the app doesn't know)
 * is in no section, so it takes no section's title and marks nothing current in the panel.
 */
export function plainSection(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "home";
  if (parts.length === 1) return parts[0]!;
  return parts[0] === "t" && parts.length === 3 && (parts[2] === "members" || parts[2] === "plan" || parts[2] === "limits") ? parts[2] : "";
}

/**
 * Screens outside a product (the overview, Connect an agent, settings, organization members): the
 * same stage with the non-product panel, which is identical on each of them.
 */
export function PlainShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const key = plainSection(loc.pathname);
  const section = PLAIN_SECTIONS[key] ?? "WhatBuild";
  const isHome = key === "home";
  return (
    <Stage
      variant="plain"
      pillName={null}
      section={section}
      title={`${section} · WhatBuild`}
      panel={(hide, hideLabel) => (
        <>
          <BrandRow to="/" label="WhatBuild, home" current={isHome} onHide={hide} hideLabel={hideLabel} />
          <nav className="panel-nav" aria-label="Products and organization">
            <PlainNav section={key} />
          </nav>
        </>
      )}
      panelFoot={<AccountMenu />}
    >
      {children}
    </Stage>
  );
}
