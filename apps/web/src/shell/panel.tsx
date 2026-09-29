import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { lastProduct, useMe, useProducts, useSignOut, type Product } from "../lib/session.tsx";
import { Avatar, Glyph, IconButton, Menu, MenuGroup, MenuItem, MenuLabel, MenuRadio, MenuSeparator, type GlyphName } from "../ui/index.tsx";
import { shortcutLabel } from "../ui/media.ts";
import { BrandMark } from "./brand.tsx";
import { useTheme } from "./theme.ts";

/** The four L1 destinations, in the order that tells the product's story. */
export const L1 = [
  { id: "idea", label: "Idea", icon: "lightbulb", count: "outcomes" },
  { id: "evidence", label: "Evidence", icon: "library", count: "sources" },
  { id: "synthesis", label: "Synthesis", icon: "blend", count: "insights" },
  { id: "story", label: "Story", icon: "book-open", count: "story_pages" },
] as const satisfies readonly { id: string; label: string; icon: GlyphName; count: keyof Product["counts"] }[];

/** Which L1 (or quiet) item a product screen belongs to, from the first path segment after the product. */
export function productSection(segment: string | undefined): { id: string; label: string } {
  switch (segment) {
    case "evidence":
    case "search":
      return { id: "evidence", label: "Evidence" };
    case "synthesis":
      return { id: "synthesis", label: "Synthesis" };
    case "story":
      return { id: "story", label: "Story" };
    case "activity":
      return { id: "activity", label: "Activity" };
    case "settings":
      return { id: "settings", label: "Settings" };
    default:
      return { id: "idea", label: "Idea" };
  }
}

/** Screens that exist in every product, so switching product can keep the person on the same one. */
const KEEP_ON_SWITCH = new Set(["idea", "evidence", "synthesis", "story", "activity", "search", "settings"]);

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

export function ProductSwitcher({ current }: { current: Product }) {
  const products = useProducts();
  const loc = useLocation();
  const navigate = useNavigate();
  const segment = loc.pathname.split("/")[5] ?? "idea";
  const keep = KEEP_ON_SWITCH.has(segment) ? segment : "idea";
  const items = products.data?.items ?? [];
  const groups = new Map<string, typeof items>();
  for (const p of items) {
    const key = `${p.tenant.name} · ${p.team.name}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <div className="panel-product">
      <Menu
        label={`Product: ${current.name}. Switch product`}
        triggerClassName="product-switch"
        align="start"
        minWidth={240}
        trigger={
          <>
            <span className="product-name">
              <span className="ellipsis">{current.name}</span>
              <Glyph name="chevron-down" size="sm" />
            </span>
            <span className="product-context ellipsis">
              {current.tenant.name} · {current.team.name}
            </span>
          </>
        }
      >
        {[...groups.entries()].map(([label, list]) => (
          <MenuGroup key={label} label={label}>
            {list.map((p) => (
              <MenuRadio key={p.product_id} checked={p.product_id === current.product_id} onSelect={() => navigate(`/t/${p.path}/${keep}`)}>
                {p.name}
              </MenuRadio>
            ))}
          </MenuGroup>
        ))}
        {products.isPending ? <MenuLabel>Loading products…</MenuLabel> : null}
        <MenuSeparator />
        <MenuItem icon="plus" to="/products?create=1">
          New product
        </MenuItem>
        <MenuItem icon="building" to={`/t/${current.tenant.slug}/members`}>
          {current.tenant.name} members
        </MenuItem>
        <MenuItem icon="library" to="/products">
          All products
        </MenuItem>
      </Menu>
    </div>
  );
}

function NavNode({ to, icon, label, count, quiet, current }: { to: string; icon: GlyphName; label: string; count?: number; quiet?: boolean; current?: boolean }) {
  return (
    <NavLink to={to} className={`nav-node${quiet ? " nav-node-quiet" : ""}`} aria-current={current ? "page" : undefined} end={false}>
      <Glyph name={icon} />
      <span className="nav-label">{label}</span>
      {count !== undefined ? <span className="nav-count num">{count}</span> : null}
    </NavLink>
  );
}

export function ProductNav({ product, app, section }: { product: Product; app: string; section: string }) {
  return (
    <>
      <div className="nav-l1">
        {L1.map((d) => (
          <NavNode key={d.id} to={`${app}/${d.id}`} icon={d.icon} label={d.label} count={product.counts[d.count]} current={section === d.id} />
        ))}
      </div>
      <div className="nav-quiet">
        <NavNode to="/connect" icon="bot" label="Connect an agent" quiet />
        <NavNode to={`${app}/activity`} icon="activity" label="Activity" quiet current={section === "activity"} />
        <NavNode to={`${app}/settings`} icon="settings" label="Settings" quiet current={section === "settings"} />
      </div>
    </>
  );
}

/**
 * The panel outside a product (the overview, Connect an agent, members, all products, settings). It is
 * the same on every one of these screens, so it never depends on where the person came from: their
 * products, then the organization-level screens, with the current one marked.
 */
export function PlainNav({ section, tenantSlug }: { section: string; tenantSlug: string | null }) {
  const products = useProducts();
  const items = products.data?.items ?? [];
  const tenants = products.data?.tenants ?? [];
  const orgs = [...new Set(items.map((p) => p.tenant.name))];
  // With one organization its name is on its members link; with several, it heads each group.
  const grouped = orgs.length > 1;
  return (
    <>
      {items.length ? (
        <div className="nav-l1 nav-products" role="group" aria-labelledby="nav-products-label">
          <div id="nav-products-label" className="nav-group-label">
            Products
          </div>
          {orgs.map((org) => (
            <div key={org} className="nav-org" role={grouped ? "group" : undefined} aria-label={grouped ? org : undefined}>
              {grouped ? (
                <div className="nav-org-label ellipsis" aria-hidden="true">
                  {org}
                </div>
            ) : null}
            {items
              .filter((p) => p.tenant.name === org)
              .map((p) => (
                <NavNode key={p.product_id} to={`/t/${p.path}/idea`} icon="box" label={p.name} />
              ))}
          </div>
        ))}
      </div>
      ) : null}
      <div className="nav-quiet">
        <NavNode to="/connect" icon="bot" label="Connect an agent" quiet current={section === "connect"} />
        {tenants.map((t) => (
          <NavNode key={t.tenant_id} to={`/t/${t.slug}/members`} icon="users" label={`${t.name} members`} quiet current={section === "members" && t.slug === tenantSlug} />
        ))}
        <NavNode to="/products" icon="library" label="All products" quiet current={section === "products"} />
      </div>
    </>
  );
}

/** The panel footer: the signed-in person, and the account menu (theme, their settings, sign out). */
export function AccountMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const [theme, setTheme] = useTheme();
  const name = me.data?.display_name ?? "Signed in";
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
            <span className="ellipsis">{name}</span>
          </>
        }
      >
        {me.data?.email ? (
          <>
            <MenuLabel>{me.data.email}</MenuLabel>
            <MenuSeparator />
          </>
        ) : null}
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
        <MenuSeparator />
        <MenuItem icon="settings" to="/settings">
          Settings
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="log-out" onSelect={() => void signOut()}>
          Sign out
        </MenuItem>
      </Menu>
    </div>
  );
}

/** The product the person was last in, if they can still reach it. */
export function useLastProduct() {
  const products = useProducts();
  const path = lastProduct();
  const hit = path ? products.data?.items.find((p) => p.path === path) : undefined;
  return hit ?? null;
}
