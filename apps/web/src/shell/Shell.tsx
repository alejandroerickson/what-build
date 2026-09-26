import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useMe, useProducts, useSignOut, type Product } from "../lib/session.tsx";
import { IconChevronDown, IconClock, IconMenu, IconPlug } from "../ui/icons.tsx";
import { Badge, Menu, MenuItem, MenuSeparator } from "../ui/index.tsx";
import { ActivityDrawer } from "./ActivityDrawer.tsx";
import "./shell.css";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function AccountMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const name = me.data?.display_name ?? "Signed in";
  return (
    <Menu label={`Account for ${name}`} trigger={<span className="avatar" aria-hidden="true">{initials(name)}</span>}>
      <div className="menu-heading">
        <div className="account-name">{name}</div>
        <div className="faint">{me.data?.email}</div>
      </div>
      <MenuSeparator />
      <MenuItem to="/products">All products</MenuItem>
      <MenuItem to="/connect">Connect an agent</MenuItem>
      <MenuItem to="/account">Account and tokens</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={signOut}>Sign out</MenuItem>
    </Menu>
  );
}

function ProductSwitcher({ current }: { current?: Product }) {
  const products = useProducts();
  const loc = useLocation();
  // Switching product keeps the screen: from Sources in one product to Sources in the next.
  const screen = current ? loc.pathname.split("/")[5] ?? "objectives" : "objectives";
  const keep = ["objectives", "sources", "insights", "story", "activity", "search"].includes(screen) ? screen : "objectives";
  return (
    <Menu
      label="Switch product"
      align="start"
      trigger={
        <span className="switcher">
          <span className="switcher-text">
            {current ? (
              <>
                <span className="switcher-context">
                  {current.tenant.name} / {current.team.name}
                </span>
                <span className="switcher-name">{current.name}</span>
              </>
            ) : (
              <span className="switcher-name">Choose a product</span>
            )}
          </span>
          <IconChevronDown />
        </span>
      }
    >
      {products.data?.items.map((p) => (
        <MenuItem key={p.product_id} to={`/t/${p.path}/${keep}`}>
          <span className="row-between">
            <span>
              {p.name}
              <span className="faint small"> · {p.team.name}</span>
            </span>
            {current?.product_id === p.product_id ? <Badge tone="accent">Current</Badge> : null}
          </span>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem to="/products">All products and teams</MenuItem>
      <MenuItem to="/products?create=1">New product</MenuItem>
    </Menu>
  );
}

export function TopBar({ product, onMenu, onActivity }: { product?: Product; onMenu?: () => void; onActivity?: () => void }) {
  return (
    <header className="topbar">
      {onMenu ? (
        <button type="button" className="icon-btn rail-toggle" onClick={onMenu} aria-label="Open navigation">
          <IconMenu />
        </button>
      ) : null}
      <Link to="/" className="wordmark" aria-label="WhatBuild home">
        WhatBuild
      </Link>
      <ProductSwitcher current={product} />
      <div className="grow" />
      {onActivity ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onActivity}>
          <IconClock /> <span className="hide-narrow">Activity</span>
        </button>
      ) : null}
      <Link to="/connect" className="btn btn-quiet btn-sm">
        <IconPlug /> <span className="hide-narrow">Connect an agent</span>
      </Link>
      <AccountMenu />
    </header>
  );
}

const DESTINATIONS = [
  { id: "objectives", label: "Objectives", children: [] as { to: string; label: string }[] },
  { id: "sources", label: "Sources", children: [{ to: "sources", label: "Browse" }, { to: "search", label: "Search passages" }, { to: "sources/new", label: "Add a source" }] },
  { id: "insights", label: "Insights", children: [{ to: "insights", label: "Insights" }, { to: "insights/assumptions", label: "Assumptions" }, { to: "insights/decisions", label: "Decisions" }] },
  { id: "story", label: "Story", children: [] },
];

export function ProductShell({ product, app, children }: { product: Product; app: string; children: ReactNode }) {
  const [railOpen, setRailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const loc = useLocation();
  const section = loc.pathname.split("/")[5] ?? "objectives";
  const active = section === "search" ? "sources" : section;
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopBar product={product} onMenu={() => setRailOpen((o) => !o)} onActivity={() => setActivityOpen(true)} />
      <div className="app-body">
        <nav className={`rail ${railOpen ? "rail-open" : ""}`} aria-label="Product" onClick={() => setRailOpen(false)}>
          <ul>
            {DESTINATIONS.map((d) => (
              <li key={d.id}>
                <NavLink to={`${app}/${d.id}`} className="rail-link" aria-current={active === d.id ? "page" : undefined} end={false}>
                  {d.label}
                </NavLink>
                {active === d.id && d.children.length ? (
                  <ul className="rail-sub">
                    {d.children.map((c) => (
                      <li key={c.to}>
                        <NavLink to={`${app}/${c.to}`} end className={({ isActive }) => `rail-sublink ${isActive ? "active" : ""}`}>
                          {c.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="rail-foot">
            <NavLink to={`${app}/settings`} className="rail-sublink">
              Product settings
            </NavLink>
            <NavLink to={`/t/${product.tenant.slug}/members`} className="rail-sublink">
              People and roles
            </NavLink>
            <p className="faint small rail-role">
              You are {product.your_role === "admin" ? "an admin" : `a ${product.your_role}`} here.
            </p>
          </div>
        </nav>
        <main id="main" className="content" tabIndex={-1}>
          {product.archived_at ? (
            <div className="archived-banner" role="status">
              This product is archived and read-only. An admin can restore it in product settings.
            </div>
          ) : null}
          {children}
        </main>
      </div>
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}

/** Screens outside a product: the product list, members, Connect, account. */
export function PlainShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="content content-plain" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
