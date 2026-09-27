import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { lastProduct, useMe, useProducts, useSignOut, type Product } from "../lib/session.tsx";
import { Avatar, Glyph, IconButton, Menu, MenuGroup, MenuItem, MenuLabel, MenuRadio, MenuSeparator, type GlyphName } from "../ui/index.tsx";
import { shortcutLabel } from "../ui/media.ts";
import { BrandMark } from "./brand.tsx";
import { useTheme } from "./theme.ts";

/** The four L1 destinations, in the order that tells the product's story. */
export const L1 = [
  { id: "objectives", label: "Objectives", icon: "target", count: "objectives" },
  { id: "evidence", label: "Evidence", icon: "library", count: "sources" },
  { id: "synthesis", label: "Synthesis", icon: "lightbulb", count: "insights" },
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
      return { id: "objectives", label: "Objectives" };
  }
}

/** Screens that exist in every product, so switching product can keep the person on the same one. */
const KEEP_ON_SWITCH = new Set(["objectives", "evidence", "synthesis", "story", "activity", "search", "settings"]);

export function BrandRow({ to, label, onHide, hideLabel }: { to: string; label: string; onHide: () => void; hideLabel: string }) {
  return (
    <div className="panel-brand">
      <Link to={to} className="brand" aria-label={label}>
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
  const segment = loc.pathname.split("/")[5] ?? "objectives";
  const keep = KEEP_ON_SWITCH.has(segment) ? segment : "objectives";
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
        <NavNode to="/connect" icon="plug" label="Agents" quiet />
        <NavNode to={`${app}/settings`} icon="settings" label="Settings" quiet current={section === "settings"} />
      </div>
    </>
  );
}

/** The panel outside a product (Agents, account, members, products): a way back, then these screens. */
export function PlainNav({ section, backTo, backLabel, tenantSlug, tenantName }: { section: string; backTo: string | null; backLabel: string | null; tenantSlug: string | null; tenantName: string | null }) {
  return (
    <>
      {backTo && backLabel ? (
        <div className="nav-back">
          <Link to={backTo} className="nav-node nav-node-back">
            <Glyph name="arrow-left" />
            <span className="nav-label">Back to {backLabel}</span>
          </Link>
        </div>
      ) : null}
      <div className="nav-l1">
        <NavNode to="/connect" icon="plug" label="Agents" current={section === "agents"} />
        <NavNode to="/account" icon="key" label="Account and tokens" current={section === "account"} />
        {tenantSlug ? <NavNode to={`/t/${tenantSlug}/members`} icon="users" label={`${tenantName ?? "Organization"} members`} current={section === "members"} /> : null}
        <NavNode to="/products" icon="library" label="All products" current={section === "products"} />
      </div>
    </>
  );
}

/** The panel footer: the signed-in person, and the account menu (Activity, theme, account, sign out). */
export function AccountMenu({ activityTo }: { activityTo: string | null }) {
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
        {me.data?.email ? <MenuLabel>{me.data.email}</MenuLabel> : null}
        {activityTo ? (
          <MenuItem icon="activity" to={activityTo}>
            Activity
          </MenuItem>
        ) : null}
        <MenuSeparator />
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
        <MenuItem icon="user" to="/account">
          Account and tokens
        </MenuItem>
        <MenuItem icon="library" to="/products">
          All products
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="log-out" onSelect={() => void signOut()}>
          Sign out
        </MenuItem>
      </Menu>
    </div>
  );
}

/** For the plain shell: the product the person was last in, to offer a way back. */
export function useLastProduct() {
  const products = useProducts();
  const path = lastProduct();
  const hit = path ? products.data?.items.find((p) => p.path === path) : undefined;
  return hit ?? null;
}
