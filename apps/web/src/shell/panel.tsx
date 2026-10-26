import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { ROLE_WORD } from "../lib/format.ts";
import { lastProduct, ownFirst, productHome, useHideExample, useMe, useProducts, useSignOut, type Product } from "../lib/session.tsx";
import { Avatar, Glyph, IconButton, Menu, MenuGroup, MenuItem, MenuLabel, MenuRadio, MenuSeparator, type GlyphName } from "../ui/index.tsx";
import { shortcutLabel } from "../ui/media.ts";
import { CreateProductDialog } from "../routes/new-product.tsx";
import { BrandMark } from "./brand.tsx";
import { FeedbackDialog } from "./feedback-dialog.tsx";
import { ReleaseItem, useRelease } from "./release.tsx";
import { useTheme } from "./theme.ts";

/** The four L1 destinations, in the order that tells the product's story. */
export const L1 = [
  { id: "idea", label: "Idea", icon: "lightbulb" },
  { id: "evidence", label: "Evidence", icon: "library" },
  { id: "exploration", label: "Exploration", icon: "blend" },
  { id: "story", label: "Story", icon: "book-open" },
] as const satisfies readonly { id: keyof Product["stage_counts"]; label: string; icon: GlyphName }[];

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
    case "connect":
      return { id: "connect", label: "Connect an agent" };
    case "activity":
      return { id: "activity", label: "Activity" };
    case "settings":
      return { id: "settings", label: "Settings" };
    default:
      return { id: "idea", label: "Idea" };
  }
}

/** Screens that exist in every product, so switching product can keep the person on the same one. */
const KEEP_ON_SWITCH = new Set(["idea", "evidence", "exploration", "story", "connect", "activity", "search", "settings"]);

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
  const [creating, setCreating] = useState(false);
  const segment = loc.pathname.split("/")[5] ?? "idea";
  const keep = KEEP_ON_SWITCH.has(segment) ? segment : "idea";
  // The person's own products first, the example organization's last, as everywhere.
  const items = [...(products.data?.items ?? [])].sort((a, b) => Number(Boolean(a.tenant.example)) - Number(Boolean(b.tenant.example)));
  const groups = new Map<string, typeof items>();
  for (const p of items) {
    const key = p.tenant.example ? `Example organization · ${p.tenant.name}` : `${p.tenant.name} · ${p.team.name}`;
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
              {current.tenant.example ? `Example organization · ${current.tenant.name}` : `${current.tenant.name} · ${current.team.name}`}
            </span>
          </>
        }
      >
        {[...groups.entries()].map(([label, list]) => (
          <MenuGroup key={label} label={label}>
            {list.map((p) => (
              <MenuRadio key={p.product_id} checked={p.product_id === current.product_id} onSelect={() => navigate(`/t/${p.path}/${p.your_role === "reader" ? "story" : keep}`)}>
                {p.name}
              </MenuRadio>
            ))}
          </MenuGroup>
        ))}
        {products.isPending ? <MenuLabel>Loading products…</MenuLabel> : null}
        <MenuSeparator />
        <MenuItem icon="plus" onSelect={() => setCreating(true)}>
          New product
        </MenuItem>
      </Menu>
      {creating && products.data ? <CreateProductDialog tenants={products.data.tenants} onClose={() => setCreating(false)} /> : null}
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
  // A reader has only the Story: no other stage, and nothing in the quiet group.
  if (product.your_role === "reader")
    return (
      <div className="nav-l1">
        <NavNode to={`${app}/story`} icon="book-open" label="Story" count={product.stage_counts.story} current={section === "story"} />
      </div>
    );
  return (
    <>
      <div className="nav-l1">
        {L1.map((d) => (
          <NavNode key={d.id} to={`${app}/${d.id}`} icon={d.icon} label={d.label} count={product.stage_counts[d.id]} current={section === d.id} />
        ))}
      </div>
      <div className="nav-quiet">
        <NavNode to={`${app}/connect`} icon="bot" label="Connect an agent" quiet current={section === "connect"} />
        <NavNode to={`${app}/activity`} icon="activity" label="Activity" quiet current={section === "activity"} />
        <NavNode to={`${app}/settings`} icon="settings" label="Settings" quiet current={section === "settings"} />
      </div>
    </>
  );
}

/**
 * The panel outside a product (the overview, Connect an agent, members, settings). It is the same on
 * every one of these screens, so it never depends on where the person came from: each organization's
 * name, headed "Products" over its products, then Connect an agent, and for an owner of the instance
 * its Organizations and People. The example organization comes last, headed as the example, and a
 * guest may hide it here; the overview still shows it.
 */
export function PlainNav({ section }: { section: string }) {
  const products = useProducts();
  const me = useMe();
  const hide = useHideExample();
  const instanceOwner = Boolean(me.data?.tenant_allowance.instance_owner);
  const items = products.data?.items ?? [];
  const tenants = ownFirst(products.data?.tenants ?? []).filter((t) => !(t.example && t.your_role === "guest" && me.data?.hide_example));
  return (
    <>
      {tenants.map((t) => {
        const orgId = `nav-org-${t.tenant_id}`;
        const labelId = `nav-org-products-${t.tenant_id}`;
        const guest = t.your_role === "guest";
        return (
          <div key={t.tenant_id} className={`nav-l1 nav-products${t.example ? " nav-example" : ""}`} role="group" aria-labelledby={`${orgId} ${labelId}`}>
            <div className="nav-org">
              <div id={orgId} className="nav-org-name ellipsis">
                {t.example ? (
                  <>
                    <Glyph name="library" size="sm" />
                    Example organization
                  </>
                ) : (
                  t.name
                )}
              </div>
              <div id={labelId} className="nav-org-label ellipsis">
                {t.example ? `${t.name} · ${guest ? "read only" : "you’re an author"}` : "Products"}
              </div>
              {t.example && guest ? (
                <IconButton className="nav-org-hide" size="sm" icon="x" label="Hide the example organization from the panel" title="Hide from the panel" disabled={hide.isPending} onClick={() => hide.mutate(true)} />
              ) : null}
            </div>
            {items
              .filter((p) => p.tenant.tenant_id === t.tenant_id)
              .map((p) => (
                <NavNode key={p.product_id} to={`/t/${p.path}/${productHome(p.your_role)}`} icon="box" label={p.name} />
              ))}
          </div>
        );
      })}
      <div className="nav-quiet">
        <NavNode to="/connect" icon="bot" label="Connect an agent" quiet current={section === "connect"} />
        {instanceOwner ? (
          <>
            <NavNode to="/instance" icon="building" label="Organizations" quiet current={section === "instance"} />
            <NavNode to="/people" icon="users" label="People" quiet current={section === "people"} />
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * The panel footer: the signed-in person, and the account menu: their email, their role in each
 * organization with its members and, on the free plan, its plan and limits, the theme, their settings,
 * feedback, and sign out. An organization where the person reads only the Story is left out: its
 * members are not shown to them.
 */
export function AccountMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const [theme, setTheme] = useTheme();
  const instanceOwner = Boolean(me.data?.tenant_allowance.instance_owner);
  // A guest of the example organization has nothing here: its members are not shown to them, and they
  // change nothing there, so have no allowances to see. An instance owner sees every plan.
  const tenants = (useProducts().data?.tenants ?? []).filter((t) => !t.story_only && (t.your_role !== "guest" || instanceOwner));
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
        {tenants.map((t) => {
          const guest = t.your_role === "guest";
          // An owner of the instance sets every organization's plan and limits, so sees them for each.
          const showLimits = t.plan === "free" || instanceOwner;
          return (
            <MenuGroup key={t.tenant_id} label={t.your_role ? `${t.name} · ${ROLE_WORD[t.your_role] ?? t.your_role}` : t.name}>
              {!guest ? (
                <MenuItem icon="users" to={`/t/${t.slug}/members`}>
                  Members
                </MenuItem>
              ) : null}
              {showLimits ? (
                <MenuItem icon="scale" to={`/t/${t.slug}/limits`}>
                  Plan and limits
                </MenuItem>
              ) : null}
            </MenuGroup>
          );
        })}
        {tenants.length ? <MenuSeparator /> : null}
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
        {me.data && me.data.tenant_allowance.remaining !== 0 ? (
          <MenuItem icon="plus" to="/welcome">
            New organization
          </MenuItem>
        ) : null}
        {me.data?.tenant_allowance.instance_owner ? (
          <>
            <MenuItem icon="building" to="/instance">
              Organizations
            </MenuItem>
            <MenuItem icon="users" to="/people">
              People
            </MenuItem>
          </>
        ) : null}
        <MenuItem icon="settings" to="/settings">
          Settings
        </MenuItem>
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
  const path = lastProduct();
  const hit = path ? products.data?.items.find((p) => p.path === path) : undefined;
  return hit ?? null;
}
