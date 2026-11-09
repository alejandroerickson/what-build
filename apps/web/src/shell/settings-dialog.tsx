import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { usePlansOffered } from "../lib/limits.ts";
import { ProductProvider, useProducts, type ProductsResponse } from "../lib/session.tsx";
import { AgentsSettings } from "../routes/connect.tsx";
import { OrganizationPlan } from "../routes/limits.tsx";
import { OrganizationAccessChanges, OrganizationGeneral, OrganizationPeople } from "../routes/org.tsx";
import { ProductExportSettings, ProductGeneralSettings, ProductPeopleSettings } from "../routes/product-misc.tsx";
import { AccountSettings } from "../routes/settings.tsx";
import { ErrorCallout, IconButton, Loading, SelectField, Sheet, SheetBody } from "../ui/index.tsx";
import type { PanelProduct } from "./panel.tsx";
import { SETTINGS_PARAM, settingsSearch, useSettingsTo, type SettingsKey } from "./settings-link.ts";
import "../styles/screens/settings-dialog.css";

type Tenant = ProductsResponse["tenants"][number];

/**
 * What had focus outside Settings last. Opening Settings makes the panel inert, which takes focus
 * from a row in it before the dialog mounts, so the element to give focus back to is noted as focus
 * moves, not read when the dialog opens.
 */
let focusedOutside: HTMLElement | null = null;
if (typeof document !== "undefined")
  document.addEventListener(
    "focusin",
    (e) => {
      if (e.target instanceof HTMLElement && !e.target.closest(".settings-layer")) focusedOutside = e.target;
    },
    true,
  );

interface SettingsGroup {
  id: "product" | "organization" | "you";
  label: string;
  items: { key: SettingsKey; label: string }[];
}

/**
 * The sections a person may use, grouped by whose they are: the product's, unless they read only its
 * Story; its organization's, unless they read only the Story in it or are a guest of the example
 * organization (General and Access changes for its owners and admins, Plan where the deployment
 * offers plans); and their own. A section they can't use is not listed.
 */
export function settingsGroups(product: PanelProduct | null, tenant: Tenant | null, plansOffered: boolean): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  if (product && product.your_role !== "reader")
    groups.push({
      id: "product",
      label: product.name,
      items: [
        { key: "product", label: "General" },
        { key: "product/people", label: "People" },
        { key: "product/export", label: "Export" },
      ],
    });
  if (tenant && !tenant.story_only && tenant.your_role !== "guest") {
    const admin = tenant.your_role === "owner" || tenant.your_role === "admin";
    groups.push({
      id: "organization",
      label: tenant.example ? `${tenant.name} (example)` : tenant.name,
      items: [
        ...(admin ? [{ key: "organization" as const, label: "General" }] : []),
        { key: "organization/people", label: "People" },
        ...(plansOffered ? [{ key: "organization/plan" as const, label: "Plan" }] : []),
        ...(admin ? [{ key: "organization/access" as const, label: "Access changes" }] : []),
      ],
    });
  }
  groups.push({
    id: "you",
    label: "You",
    items: [
      { key: "account", label: "Account" },
      { key: "agents", label: "Agents" },
    ],
  });
  return groups;
}

/**
 * Settings: one large dialog over the screen the person is on, for everything that is not the
 * product's work, opened by `?settings=<section>` (Settings in the panel, Settings in the account
 * menu, the empty seat, a banner, a link in an email). It is about the product the panel shows, its
 * organization, and the person. A section asked for that the person can't use opens the first one of
 * its group they can, else the first of all. Closing it (Esc, the close button, the scrim) takes
 * `?settings` and what its sections keep in the address away, and leaves the screen as it was.
 */
export function SettingsDialog({ product, tenantId }: { product: PanelProduct | null; tenantId: string | null }) {
  const [params] = useSearchParams();
  const requested = params.get(SETTINGS_PARAM);
  if (requested === null) return null;
  return <SettingsLayer requested={requested} product={product} tenantId={tenantId} />;
}

function SettingsLayer({ requested, product, tenantId }: { requested: string; product: PanelProduct | null; tenantId: string | null }) {
  const products = useProducts();
  const offered = usePlansOffered();
  const navigate = useNavigate();
  const loc = useLocation();
  const settingsTo = useSettingsTo();
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tenant = products.data?.tenants.find((t) => t.tenant_id === tenantId) ?? null;
  const groups = settingsGroups(product, tenant, offered === true);
  const all = groups.flatMap((g) => g.items);
  const group = requested.split("/")[0];
  const current = all.find((s) => s.key === requested) ?? all.find((s) => s.key.split("/")[0] === group) ?? all[0]!;
  const { pathname, search, hash } = loc;
  const close = useCallback(() => navigate({ pathname, search: settingsSearch(search, null), hash }, { replace: true }), [navigate, pathname, search, hash]);

  // Opening moves focus into the dialog, which is named Settings; closing gives it back to whatever had it.
  useEffect(() => {
    const before = focusedOutside;
    boxRef.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
      // Opened from a drawer that closed under it, the opener can't take focus back: the pill that opens the panel does.
      if (document.activeElement !== before) document.querySelector<HTMLElement>(".show-pill:not([hidden])")?.focus({ preventScroll: true });
    };
  }, []);

  // Esc closes it, unless a menu or a dialog opened from inside is open: that one closes first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open], .menu")) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Another section starts at its top.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [current.key]);

  return (
    <div className="settings-layer">
      <div className="settings-scrim" aria-hidden="true" onClick={close} />
      <div ref={boxRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="settings-head">
          <h2 id={titleId} className="settings-title">
            Settings
          </h2>
          <IconButton label="Close settings" icon="x" onClick={close} />
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {groups.map((g) => (
              <div key={g.id} className="settings-nav-group" role="group" aria-labelledby={`${titleId}-${g.id}`}>
                <p id={`${titleId}-${g.id}`} className="settings-nav-head">
                  {g.label}
                </p>
                {g.items.map((s) => (
                  <Link key={s.key} to={settingsTo(s.key)} replace className="settings-nav-item" aria-current={s.key === current.key ? "page" : undefined}>
                    {s.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="settings-pick">
            <SelectField label="Section" value={current.key} onChange={(e) => navigate(settingsTo(e.target.value as SettingsKey), { replace: true })}>
              {groups.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {g.items.map((s) => (
                    <option key={s.key} value={s.key}>
                      {g.label} · {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </SelectField>
          </div>
          <div ref={contentRef} className="settings-content">
            <div key={current.key} className="settings-section">
              {/* Until the organization's sections are known, none is chosen in their place. */}
              {products.isPending && tenantId ? <Loading lines={3} /> : <Section id={current.key} product={product} tenant={tenant} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ id, product, tenant }: { id: SettingsKey; product: PanelProduct | null; tenant: Tenant | null }) {
  switch (id) {
    case "product":
    case "product/people":
    case "product/export":
      if (!product) return null;
      return (
        <InProduct path={product.path}>
          {id === "product" ? <ProductGeneralSettings /> : id === "product/people" ? <ProductPeopleSettings /> : <ProductExportSettings />}
        </InProduct>
      );
    case "organization":
      return tenant ? <OrganizationGeneral tenant={tenant.slug} /> : null;
    case "organization/people":
      return tenant ? <OrganizationPeople tenant={tenant.slug} /> : null;
    case "organization/plan":
      return tenant ? <OrganizationPlan tenant={tenant.slug} /> : null;
    case "organization/access":
      return tenant ? <OrganizationAccessChanges tenant={tenant.slug} /> : null;
    case "account":
      return <AccountSettings />;
    case "agents":
      return <AgentsSettings herePath={product?.path ?? null} />;
  }
}

/** The product's sections read it as its own screens do, whatever screen Settings is open over. */
function InProduct({ path, children }: { path: string; children: ReactNode }) {
  return (
    <ProductProvider
      path={path}
      fallback={(error, retry) => (
        <Sheet label="Product">
          <SheetBody>
            <ErrorCallout inset title="This product couldn’t be loaded" error={error} onRetry={retry} />
          </SheetBody>
        </Sheet>
      )}
    >
      {() => children}
    </ProductProvider>
  );
}
