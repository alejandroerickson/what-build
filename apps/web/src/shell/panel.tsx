import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router";
import { useHasNoAgent } from "../lib/agents.ts";
import { usePlans } from "../lib/limits.ts";
import {
  currentProductPath, lastProduct, mayCreateProducts, ownFirst, productHome, useMe, useProducts, useSignOut,
  type Product, type ProductsResponse, type ProductSummary,
} from "../lib/session.tsx";
import { Avatar, Button, Glyph, IconButton, Menu, MenuGroup, MenuItem, MenuLabel, MenuRadio, MenuSeparator, OneLine, type GlyphName } from "../ui/index.tsx";
import { shortcutLabel } from "../ui/media.ts";
import { CreateProductDialog } from "../routes/new-product.tsx";
import { useAllowances } from "../routes/instance.tsx";
import { AgentSeat } from "./agent-seat.tsx";
import { BrandMark } from "./brand.tsx";
import { FeedbackDialog } from "./feedback-dialog.tsx";
import { ReleaseItem, useRelease } from "./release.tsx";
import { SETTINGS_PARAM, useSettingsTo } from "./settings-link.ts";
import { useTheme } from "./theme.ts";

/** The four L1 destinations, in the order that tells the product's story. */
export const L1 = [
  { id: "idea", label: "Idea", icon: "lightbulb" },
  { id: "evidence", label: "Evidence", icon: "library" },
  { id: "exploration", label: "Exploration", icon: "blend" },
  { id: "story", label: "Story", icon: "book-open" },
] as const satisfies readonly { id: keyof Product["stage_counts"]; label: string; icon: GlyphName }[];

/** What the panel shows of a product: the product's own screens and the overview give it the same. */
export type PanelProduct = Pick<ProductSummary, "product_id" | "name" | "path" | "your_role" | "stage_counts"> & { tenant: Pick<ProductSummary["tenant"], "tenant_id" | "slug" | "name" | "example"> };

type Tenant = ProductsResponse["tenants"][number];

/** Which L1 (or quiet) item a product screen belongs to, from the first path segment after the product. */
export function productSection(segment: string | undefined): { id: string; label: string } {
  switch (segment) {
    case "evidence":
    case "search":
      return { id: "evidence", label: "Evidence" };
    case "exploration":
      return { id: "exploration", label: "Exploration" };
    case "story":
      return { id: "story", label: "Story" };
    case "activity":
      return { id: "activity", label: "Activity" };
    default:
      return { id: "idea", label: "Idea" };
  }
}

/** Screens that exist in every product, so switching product can keep the person on the same one. */
const KEEP_ON_SWITCH = new Set(["idea", "evidence", "exploration", "story", "activity", "search"]);

export function BrandRow({ to, label, current, onHide, hideLabel }: { to: string; label: string; current?: boolean; onHide: () => void; hideLabel: string }) {
  return (
    <div className="panel-brand">
      <Link to={to} className="brand" aria-label={label} aria-current={current ? "page" : undefined}>
        <BrandMark />
        <span className="brand-word">WhatBuild</span>
      </Link>
      <IconButton label={hideLabel} title={`${hideLabel} (${shortcutLabel("\\")})`} icon="panel-left-close" onClick={onHide} data-panel-hide="" />
    </div>
  );
}

/** How the app names an organization where one is named alone: the example organization says so. */
function organizationLabel(t: Pick<Tenant, "name" | "example">): string {
  return t.example ? `Example organization · ${t.name}` : t.name;
}

/**
 * The panel's one organization's menu: its products, New product where the person may create one,
 * then the person's other organizations, each opening the product they last had open there, and New
 * organization where they may start one. The example organization is left out for a guest who hid it.
 */
function OrganizationMenu({ tenant, current, onCreate }: { tenant: Pick<Tenant, "tenant_id" | "name" | "example"> & { your_role?: Tenant["your_role"] }; current?: PanelProduct; onCreate: () => void }) {
  const products = useProducts();
  const me = useMe();
  const loc = useLocation();
  const navigate = useNavigate();
  const segment = loc.pathname.split("/")[4] ?? "idea";
  const keep = KEEP_ON_SWITCH.has(segment) ? segment : "idea";
  const here = products.data?.tenants.find((t) => t.tenant_id === tenant.tenant_id);
  const inOrg = (products.data?.items ?? []).filter((p) => p.tenant.tenant_id === tenant.tenant_id);
  const others = ownFirst(products.data?.tenants ?? []).filter((t) => t.tenant_id !== tenant.tenant_id && !(t.example && t.your_role === "guest" && me.data?.hide_example));
  const mayCreate = here ? mayCreateProducts(here) : false;
  const mayStart = Boolean(me.data) && me.data?.tenant_allowance.remaining !== 0;
  return (
    <>
      {inOrg.length ? (
        <MenuGroup label={organizationLabel(tenant)}>
          {inOrg.map((p) => (
            <MenuRadio key={p.product_id} checked={p.product_id === current?.product_id} onSelect={() => navigate(`/t/${p.path}/${p.your_role === "story_reader" ? "story" : keep}`)}>
              {p.name}
            </MenuRadio>
          ))}
        </MenuGroup>
      ) : products.isPending ? (
        <MenuLabel>Loading products…</MenuLabel>
      ) : (
        <MenuLabel>No products in {tenant.name} yet</MenuLabel>
      )}
      {mayCreate ? (
        <MenuItem icon="plus" onSelect={onCreate}>
          New product
        </MenuItem>
      ) : null}
      {others.length || mayStart ? <MenuSeparator /> : null}
      {others.length ? (
        <MenuGroup label="Switch organization">
          {others.map((t) => (
            <MenuItem key={t.tenant_id} icon={t.example ? "library" : "building"} to={`/t/${t.slug}`}>
              {t.example ? `${t.name} (example)` : t.name}
            </MenuItem>
          ))}
        </MenuGroup>
      ) : null}
      {mayStart ? (
        <MenuItem icon="plus" to="/welcome">
          New organization
        </MenuItem>
      ) : null}
    </>
  );
}

/** The product's name and its organization's, opening the organization's menu. */
export function ProductSwitcher({ current }: { current: PanelProduct }) {
  const products = useProducts();
  const [creating, setCreating] = useState(false);
  return (
    <div className="panel-product">
      <Menu
        label={`Product: ${current.name}, in ${current.tenant.name}. Switch product or organization`}
        triggerClassName="product-switch"
        align="start"
        minWidth={240}
        trigger={
          <>
            <span className="product-name">
              <OneLine text={current.name} />
              <Glyph name="chevron-down" size="sm" />
            </span>
            <OneLine className="product-context" text={organizationLabel(current.tenant)} />
          </>
        }
      >
        <OrganizationMenu tenant={current.tenant} current={current} onCreate={() => setCreating(true)} />
      </Menu>
      {creating && products.data ? <CreateProductDialog tenants={products.data.tenants} tenant={current.tenant.slug} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NavNode({ to, icon, label, count, quiet, current }: { to: string; icon: GlyphName; label: string; count?: number; quiet?: boolean; current?: boolean }) {
  return (
    <NavLink to={to} className={`nav-node${quiet ? " nav-node-quiet" : ""}`} aria-current={current ? "page" : undefined} end={false}>
      <Glyph name={icon} />
      <OneLine text={label} />
      {count !== undefined ? <span className="nav-count num">{count}</span> : null}
    </NavLink>
  );
}

/** The panel's Settings row: it opens Settings over the screen, at the product's sections where the person has them. */
function SettingsRow({ to }: { to: string }) {
  const open = useSearchParams()[0].has(SETTINGS_PARAM);
  return (
    <Link to={to} className="nav-node nav-node-quiet" data-open={open ? "" : undefined}>
      <Glyph name="settings" />
      <OneLine text="Settings" />
    </Link>
  );
}

/**
 * The panel's rows for one product, the same on every screen and for every role, an instance
 * owner's included: Idea, Evidence, Exploration and Story with their counts (a Story reader has the
 * Story alone), then the quiet group: the empty seat while the person has no agent connected, the product's
 * Activity, and Settings. `section` marks the screen's own row; the overview marks none.
 */
export function ProductNav({ product, section }: { product: PanelProduct; section: string | null }) {
  const app = `/t/${product.path}`;
  const seat = useHasNoAgent();
  const settingsTo = useSettingsTo();
  const storyOnly = product.your_role === "story_reader";
  const stages = storyOnly ? L1.filter((d) => d.id === "story") : L1;
  return (
    <>
      <div className="nav-l1">
        {stages.map((d) => (
          <NavNode key={d.id} to={`${app}/${d.id}`} icon={d.icon} label={d.label} count={product.stage_counts[d.id]} current={section === d.id} />
        ))}
      </div>
      <div className="nav-quiet">
        {seat ? <AgentSeat to={settingsTo("agents")} /> : null}
        {storyOnly ? null : <NavNode to={`${app}/activity`} icon="activity" label="Activity" quiet current={section === "activity"} />}
        <SettingsRow to={settingsTo(storyOnly ? "account" : "product")} />
      </div>
    </>
  );
}

/**
 * The panel for an organization with no product the person can open: its name, opening the same
 * menu as a product's, then Create a product where the four sections would be, for whoever may
 * create one, or who to ask, and Settings.
 */
export function EmptyOrganizationNav({ tenant }: { tenant: Tenant }) {
  const products = useProducts();
  const seat = useHasNoAgent();
  const settingsTo = useSettingsTo();
  const [creating, setCreating] = useState(false);
  const mayCreate = mayCreateProducts(tenant);
  return (
    <>
      <div className="panel-product">
        <Menu
          label={`Organization: ${tenant.name}. Switch organization`}
          triggerClassName="product-switch"
          align="start"
          minWidth={240}
          trigger={
            <>
              <span className="product-name">
                <OneLine text={organizationLabel(tenant)} />
                <Glyph name="chevron-down" size="sm" />
              </span>
              <OneLine className="product-context" text="No products yet" />
            </>
          }
        >
          <OrganizationMenu tenant={tenant} onCreate={() => setCreating(true)} />
        </Menu>
      </div>
      <div className="nav-empty">
        {mayCreate ? (
          <>
            <p className="nav-empty-title">Start your first product</p>
            {/* The page beside it carries the screen's one accent button, and the empty seat the panel's. */}
            <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
              Create a product
            </Button>
          </>
        ) : (
          <p className="nav-empty-text">Nothing to open yet. An admin of {tenant.name} can give you a role on a product.</p>
        )}
      </div>
      <div className="nav-quiet">
        {seat ? <AgentSeat to={settingsTo("agents")} /> : null}
        <SettingsRow to={settingsTo("organization")} />
      </div>
      {creating && products.data ? <CreateProductDialog tenants={products.data.tenants} tenant={tenant.slug} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/**
 * Instance admin's panel, for the owners of this WhatBuild only: its sections, with how many people
 * are waiting for an organization, and the way back to the product they had open.
 */
export function AdminNav() {
  const plans = usePlans();
  const allowances = useAllowances();
  const back = useContextProduct().product;
  const waiting = allowances.data?.waitlist.length ?? 0;
  return (
    <>
      <div className="panel-product admin-head">
        <span className="product-name">
          <Glyph name="building" size="sm" />
          <OneLine text="Instance admin" />
        </span>
        <OneLine className="product-context" text="Only this WhatBuild’s owners see this" />
      </div>
      <div className="nav-l1">
        <NavNode to="/admin/organizations" icon="building" label="Organizations" />
        <NavNode to="/admin/people" icon="users" label="People" />
        {plans.data?.plans.length ? <NavNode to="/admin/plans" icon="scale" label="Plans" /> : null}
        {plans.data?.example ? <NavNode to="/admin/guests" icon="library" label="Guests" /> : null}
        <NavNode to="/admin/starting" icon="user-plus" label="Starting organizations" count={waiting || undefined} />
      </div>
      <div className="nav-quiet">
        <NavNode to={back ? `/t/${back.path}/${productHome(back.your_role)}` : "/"} icon="arrow-left" label={back ? `Back to ${back.name}` : "Back to WhatBuild"} quiet />
      </div>
    </>
  );
}

/**
 * The panel footer: the signed-in person, and the account menu, which is only about them: their
 * email, their Settings (opening on Account), the theme, Instance admin for an owner of this
 * WhatBuild, feedback, and sign out. Joining another organization adds nothing to it.
 */
export function AccountMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const [theme, setTheme] = useTheme();
  const settingsTo = useSettingsTo();
  const instanceOwner = Boolean(me.data?.tenant_allowance.instance_owner);
  const release = useRelease();
  const name = me.data?.display_name ?? "Signed in";
  // Mounted on first use and kept, so a draft survives closing the dialog.
  const [feedback, setFeedback] = useState<"closed" | "open" | null>(null);
  return (
    <div className="panel-foot">
      <Menu
        label={`${name}, account menu`}
        triggerClassName="account-button"
        side="top"
        align="start"
        minWidth={232}
        trigger={
          <>
            <Avatar name={name} />
            <OneLine text={name} />
          </>
        }
      >
        {me.data?.email ? (
          <>
            <MenuLabel>{me.data.email}</MenuLabel>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon="settings" to={settingsTo("account")}>
          Settings
        </MenuItem>
        <MenuGroup label="Theme">
          <MenuRadio checked={theme === "light"} onSelect={() => setTheme("light")} icon="sun" keepOpen>
            Light
          </MenuRadio>
          <MenuRadio checked={theme === "dark"} onSelect={() => setTheme("dark")} icon="moon" keepOpen>
            Dark
          </MenuRadio>
          <MenuRadio checked={theme === "system"} onSelect={() => setTheme("system")} icon="monitor" keepOpen>
            System
          </MenuRadio>
        </MenuGroup>
        {instanceOwner ? (
          <>
            <MenuSeparator />
            <MenuItem icon="building" to="/admin">
              Instance admin
            </MenuItem>
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem icon="message-square" onSelect={() => setFeedback("open")}>
          Submit feedback
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="log-out" onSelect={() => void signOut()}>
          Sign out
        </MenuItem>
        <ReleaseItem release={release} />
      </Menu>
      {feedback ? <FeedbackDialog open={feedback === "open"} onClose={() => setFeedback("closed")} /> : null}
    </div>
  );
}

/** The product the person was last in, if they can still reach it. */
export function useLastProduct() {
  const products = useProducts();
  const items = products.data?.items;
  const kept = lastProduct()?.split("/") ?? [];
  // A path kept from before teams were removed has three parts: it leads where its address does now.
  const path = kept.length === 3 ? currentProductPath(items, kept[0]!, kept[1]!, kept[2]!) : kept.join("/");
  const hit = path ? items?.find((p) => p.path === path) : undefined;
  return hit ?? null;
}

/** How much of a product a person works in, for choosing the one the panel shows first: where they write before where they read. */
const ROLE_RANK: Record<string, number> = { admin: 0, editor: 0, viewer: 1, guest: 2, story_reader: 3 };

/**
 * What the panel shows on a screen that is no product's own (the overview, a page that wasn't
 * found): the product the person was last in, or else their first, their own organizations' before
 * the example organization's and, within those, one they write in before one they only read; with
 * no product at all, their first organization, with Create a product.
 */
export function useContextProduct(): { product: ProductSummary | null; tenant: Tenant | null; pending: boolean } {
  const products = useProducts();
  const me = useMe();
  const last = useLastProduct();
  const items = [...(products.data?.items ?? [])].sort(
    (a, b) => Number(Boolean(a.tenant.example)) - Number(Boolean(b.tenant.example)) || (ROLE_RANK[a.your_role] ?? 9) - (ROLE_RANK[b.your_role] ?? 9),
  );
  const product = last ?? items[0] ?? null;
  const tenants = ownFirst(products.data?.tenants ?? []).filter((t) => !(t.example && t.your_role === "guest" && me.data?.hide_example));
  const tenant = product ? (products.data?.tenants.find((t) => t.tenant_id === product.tenant.tenant_id) ?? null) : (tenants[0] ?? null);
  return { product, tenant, pending: products.isPending };
}
