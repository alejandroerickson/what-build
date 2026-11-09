import { READ_ONLY_ALLOWS } from "@whatbuild/core/read-only";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router";
import { useHasNoAgent } from "../lib/agents.ts";
import { keptLine, type ReadOnly } from "../lib/limits.ts";
import { useProducts, type Product, type ProductsResponse } from "../lib/session.tsx";
import { ButtonLink, Callout, Glyph } from "../ui/index.tsx";
import { isTypingTarget, NARROW_QUERY, PHONE_QUERY, shortcutLabel, useMediaQuery } from "../ui/media.ts";
import { BrandMark } from "./brand.tsx";
import { AccountMenu, AdminNav, BrandRow, EmptyOrganizationNav, ProductNav, ProductSwitcher, productSection, useContextProduct, type PanelProduct } from "./panel.tsx";
import { FindLauncher, FindProvider } from "./find-palette.tsx";
import { ExampleBanner } from "./ExampleBanner.tsx";
import { InvitationsBanner } from "./invitations.tsx";
import { SettingsDialog } from "./settings-dialog.tsx";
import { SETTINGS_PARAM, useSettingsTo } from "./settings-link.ts";
import { ShellContext, type ShellSlots } from "./slots.tsx";

const NAV_KEY = "whatbuild.nav";
const INS_KEY = "whatbuild.inspector";
/** This visit has shown the empty seat once; per tab, so a hidden panel is opened for it once a visit. */
const SEAT_KEY = "whatbuild.seat";

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
 * - While the person has no agent connected the panel holds the empty seat (`AgentSeat`): a hidden
 *   panel is shown for it once a visit, never on a phone, where the drawer opens only by hand, and
 *   the pill carries a mark with the same words while the panel is away.
 */
function Stage({ variant, panel, panelFoot, pillName, section, title, banner, settings, children }: {
  variant: "product" | "plain" | "admin";
  /** The panel above the context slot: brand row and navigation. */
  panel: (hide: () => void, hideLabel: string) => ReactNode;
  /** The panel below the context slot: the account menu. */
  panelFoot: ReactNode;
  pillName: string | null;
  section: string;
  /** Default document title parts, before any usePageTitle override. */
  title: string;
  banner?: ReactNode;
  /** Settings, over the whole stage while the address asks for it (`?settings=`). */
  settings?: ReactNode;
  children: ReactNode;
}) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [params] = useSearchParams();
  const settingsOpen = Boolean(settings) && params.has(SETTINGS_PARAM);
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
  const noAgent = useHasNoAgent();

  // The first time a visit learns there is no agent connected, a hidden panel is shown, so the seat is
  // seen; after that the person's choice stands, and the pill carries the mark instead.
  useEffect(() => {
    // In focus mode the panels are away by choice, so the once a visit waits until it ends.
    if (!noAgent || focus) return;
    let seen = true;
    try {
      seen = sessionStorage.getItem(SEAT_KEY) === "shown";
      sessionStorage.setItem(SEAT_KEY, "shown");
    } catch {
      // Storage may be blocked; then the panel stays as it is.
    }
    if (seen || window.matchMedia(PHONE_QUERY).matches) return;
    setNavHidden((h) => {
      if (h) saveHidden(NAV_KEY, false);
      return false;
    });
  }, [noAgent, focus]);
  const hasInspector = inspectorCount > 0;
  const inspectorOpen = !focus && hasInspector && (isNarrow ? insSmallOpen : !insHidden);
  const insState = !hasInspector ? "none" : !inspectorOpen ? "closed" : isPhone ? "drawer" : "docked";
  const drawerActive = isPhone && drawerOpen;
  const insDrawerActive = insState === "drawer";
  const modal = drawerActive || insDrawerActive || settingsOpen;

  useEffect(() => setInsSmallOpen(false), [isNarrow]);
  // Settings opens over everything, so a drawer it was opened from steps aside.
  useEffect(() => {
    if (!settingsOpen) return;
    setDrawerOpen(false);
    if (window.matchMedia(PHONE_QUERY).matches) setInsSmallOpen(false);
  }, [settingsOpen]);

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
      // Settings is over the panels: it answers its own keys, and the panels' wait until it closes.
      if (settingsOpen) return;
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
  }, [toggleNav, toggleInspector, hasInspector, drawerActive, insDrawerActive, setInspectorOpen, focus, settingsOpen]);

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
          {noAgent ? (
            <span className="seat-mark">
              <span className="visually-hidden">No agent connected</span>
            </span>
          ) : null}
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
          inert={!navOpen || insDrawerActive || settingsOpen}
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
          inert={insState === "closed" || drawerActive || settingsOpen}
          role={insDrawerActive ? "dialog" : undefined}
          aria-modal={insDrawerActive || undefined}
          aria-labelledby={`${inspectorId}-title`}
        />
        <div className="visually-hidden" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
        {settings}
      </div>
    </ShellContext.Provider>
  );
}

/** That the organization is read-only, and what that means. Whoever reads only the Story in it has no Plan page to go to. */
export function ReadOnlyBanner({ tenant, readOnly }: { tenant: Pick<Product["tenant"], "name" | "slug">; readOnly: ReadOnly }) {
  const storyOnly = useProducts().data?.tenants.find((t) => t.slug === tenant.slug)?.story_only;
  const settingsTo = useSettingsTo();
  return (
    <div className="canvas-banner">
      <Callout
        tone="attention"
        title={`${tenant.name} is read-only`}
        action={
          storyOnly ? null : (
            <ButtonLink to={settingsTo("organization/plan")} size="sm">
              See plan
            </ButtonLink>
          )
        }
      >
        It went back to the plan new organizations start on while whoever started it already has one there, so nothing new can be added. {READ_ONLY_ALLOWS} {keptLine(readOnly)}.
      </Callout>
    </div>
  );
}

/** Every screen inside a product: the product's panel, the context slot, the account menu, and Settings over it all. */
export function ProductShell({ product, app, children }: { product: Product; app: string; children: ReactNode }) {
  const loc = useLocation();
  const section = productSection(loc.pathname.split("/")[4]);
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
          <InvitationsBanner />
          {product.tenant.example ? <ExampleBanner tenant={product.tenant} /> : null}
          {product.tenant.read_only ? <ReadOnlyBanner tenant={product.tenant} readOnly={product.tenant.read_only} /> : null}
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
            <ProductNav product={product} section={section.id} />
          </nav>
        </>
      )}
      panelFoot={<AccountMenu />}
      settings={<SettingsDialog product={product} tenantId={product.tenant.tenant_id} />}
    >
      {children}
    </Stage>
    </FindProvider>
  );
}

const PLAIN_SECTIONS: Record<string, string> = { _system: "System" };

/**
 * The plain screen an address names: its one part. Anything else (a product that didn't open, an
 * address the app doesn't know) is in no section, so it takes no section's title.
 */
export function plainSection(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "home";
  return parts.length === 1 ? parts[0]! : "";
}

/**
 * Screens that are no product's own (the overview, a page that wasn't found): the same stage, with
 * the panel of the product the person was last in, marking none of its rows, so the panel is the
 * same everywhere. With no product to show it is their first organization's, with Create a product.
 */
export function PlainShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const key = plainSection(loc.pathname);
  const section = PLAIN_SECTIONS[key] ?? "WhatBuild";
  const { product, tenant } = useContextProduct();
  return <PanelStage product={product} tenant={tenant} current={key === "home"} section={section} title={`${section} · WhatBuild`}>{children}</PanelStage>;
}

/** An organization with no product the person can open (`/t/<organization>`): its panel offers Create a product. */
export function OrganizationShell({ tenant, children }: { tenant: ProductsResponse["tenants"][number]; children: ReactNode }) {
  return <PanelStage product={null} tenant={tenant} section={tenant.name} title={`${tenant.name} · WhatBuild`}>{children}</PanelStage>;
}

function PanelStage({ product, tenant, current, section, title, children }: {
  product: PanelProduct | null;
  tenant: ProductsResponse["tenants"][number] | null;
  current?: boolean;
  section: string;
  title: string;
  children: ReactNode;
}) {
  const nav = product ? (
    <nav className="panel-nav" aria-label={product.name}>
      <ProductSwitcher current={product} />
      <FindLauncher product={product} />
      <ProductNav product={product} section={null} />
    </nav>
  ) : tenant ? (
    <nav className="panel-nav" aria-label={tenant.name}>
      <EmptyOrganizationNav tenant={tenant} />
    </nav>
  ) : null;
  const stage = (
    <Stage
      variant="plain"
      pillName={product?.name ?? tenant?.name ?? null}
      section={section}
      title={title}
      banner={<InvitationsBanner />}
      panel={(hide, hideLabel) => (
        <>
          <BrandRow to="/" label="WhatBuild, home" current={current} onHide={hide} hideLabel={hideLabel} />
          {nav}
        </>
      )}
      panelFoot={<AccountMenu />}
      settings={<SettingsDialog product={product} tenantId={product?.tenant.tenant_id ?? tenant?.tenant_id ?? null} />}
    >
      {children}
    </Stage>
  );
  // The panel's search reaches the product it shows.
  return product ? (
    <FindProvider app={`/t/${product.path}`} base={`/api/v1/p/${product.path}`} product={product}>
      {stage}
    </FindProvider>
  ) : (
    stage
  );
}

const ADMIN_SECTIONS: Record<string, string> = { organizations: "Organizations", people: "People", plans: "Plans", guests: "Guests", starting: "Starting organizations" };

/**
 * Instance admin (`/admin/…`): running this WhatBuild, a place of its own outside every product,
 * with its own panel and a way back to the product the person had open. Only its owners reach it.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const section = ADMIN_SECTIONS[loc.pathname.split("/")[2] ?? ""] ?? "Instance admin";
  return (
    <Stage
      variant="admin"
      pillName="Instance admin"
      section={section}
      title={`${section} · Instance admin · WhatBuild`}
      panel={(hide, hideLabel) => (
        <>
          <BrandRow to="/" label="WhatBuild, home" onHide={hide} hideLabel={hideLabel} />
          <nav className="panel-nav" aria-label="Instance admin">
            <AdminNav />
          </nav>
        </>
      )}
      panelFoot={<AccountMenu />}
    >
      {children}
    </Stage>
  );
}
