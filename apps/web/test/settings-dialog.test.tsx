import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Settings is one dialog over whatever screen the person is on, addressed by ?settings=<section>: the
// product's sections, its organization's and the person's own, only those they may use. Closing it
// leaves the screen as it was. The addresses Settings' sections had as pages of their own lead into it,
// and Instance admin is not found by anyone but an owner of this WhatBuild.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

const state = { role: "owner" as string, instanceOwner: false };
const acme = () => ({ tenant_id: "t1", slug: "acme", name: "Acme", name_etag: "e", plan: "free", your_role: state.role });

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "olive@example.com", display_name: "Olive", tenant_allowance: { instance_owner: state.instanceOwner, remaining: 0 } };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [{ product_id: "p1", name: "Planner", path: "acme/planner", tenant: acme(), your_role: "admin", stage_counts: { idea: 1, evidence: 2, exploration: 3, story: 4 } }], tenants: [acme()] };
    if (path === "/api/v1/plans") return { plans: [{ id: "free", name: "Free" }], limits: [], file_max_bytes: 1 };
    if (path === "/api/v1/tenant-allowances") return { items: [], waitlist: [], instance_owners: [], default_allowed: 0, new_organization_plan: "free" };
    if (path.startsWith("/api/v1/me/")) return { items: [] };
    return {};
  }),
}));
// The sections themselves are tested where they are written; here each says which it is.
vi.mock("../src/routes/org.tsx", async (original) => ({
  ...(await original<typeof import("../src/routes/org.tsx")>()),
  OrganizationGeneral: () => <p>Section: organization general</p>,
  OrganizationPeople: () => <p>Section: organization people</p>,
  OrganizationAccessChanges: () => <p>Section: access changes</p>,
}));
vi.mock("../src/routes/settings.tsx", async (original) => ({
  ...(await original<typeof import("../src/routes/settings.tsx")>()),
  AccountSettings: () => <p>Section: account</p>,
}));
vi.mock("../src/routes/connect.tsx", async (original) => ({
  ...(await original<typeof import("../src/routes/connect.tsx")>()),
  AgentsSettings: ({ herePath }: { herePath: string | null }) => <p>Section: agents over {herePath ?? "nothing"}</p>,
}));

const { settingsGroups, SettingsDialog } = await import("../src/shell/settings-dialog.tsx");
const { settingsSearch } = await import("../src/shell/settings-link.ts");
const { OrganizationSettingsAddress, YourSettingsAddress } = await import("../src/routes/addresses.tsx");
const { AdminGate } = await import("../src/routes/admin.tsx");

const product = (role: string) => ({ product_id: "p1", name: "Planner", path: "acme/planner", your_role: role, stage_counts: { story: 4 }, tenant: { tenant_id: "t1", slug: "acme", name: "Acme" } }) as never;
const tenant = (over: Record<string, unknown> = {}) => ({ ...acme(), ...over }) as never;
const keys = (groups: ReturnType<typeof settingsGroups>) => groups.map((g) => `${g.label}: ${g.items.map((i) => i.label).join(", ")}`);

describe("the sections a person may use", () => {
  it("gives an organization's owner every section, grouped by whose it is", () => {
    expect(keys(settingsGroups(product("admin"), tenant(), true))).toEqual(["Planner: General, People, Export", "Acme: General, People, Plan, Access changes", "You: Account, Agents"]);
  });

  it("gives a member the organization's People and Plan, and leaves Plan out where no plans are offered", () => {
    expect(keys(settingsGroups(product("editor"), tenant({ your_role: "member" }), true))).toEqual(["Planner: General, People, Export", "Acme: People, Plan", "You: Account, Agents"]);
    expect(keys(settingsGroups(product("editor"), tenant({ your_role: "member" }), false))[1]).toBe("Acme: People");
  });

  it("gives a reader of the Story their own sections only", () => {
    expect(keys(settingsGroups(product("reader"), tenant({ your_role: "member", story_only: true }), true))).toEqual(["You: Account, Agents"]);
  });

  it("gives a guest of the example organization nothing of the organization", () => {
    expect(keys(settingsGroups(product("guest"), tenant({ your_role: "guest", example: true }), true))).toEqual(["Planner: General, People, Export", "You: Account, Agents"]);
  });

  it("gives an organization with no product its own sections and the person's", () => {
    expect(keys(settingsGroups(null, tenant({ your_role: "creator" }), true))).toEqual(["Acme: People, Plan", "You: Account, Agents"]);
  });
});

describe("Settings' address", () => {
  it("opens over the screen with the rest of its query kept, and slashes left readable", () => {
    expect(settingsSearch("?q=crew", "organization/plan")).toBe("?q=crew&settings=organization/plan");
  });

  it("drops what one section kept when another opens, and everything of Settings when it closes", () => {
    expect(settingsSearch("?settings=agents&reach=product&product=acme/planner&q=crew", "account")).toBe("?settings=account&q=crew");
    expect(settingsSearch("?settings=account&delete=account&q=crew", null)).toBe("?q=crew");
    expect(settingsSearch("?settings=agents", "agents", { reach: "all" })).toBe("?settings=agents&reach=all");
  });
});

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, { role: "owner", instanceOwner: false });
});

async function mount(at: string, routes: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>{routes}</Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const where = (host: HTMLElement) => host.querySelector("output")?.textContent;
const dialogAt = (at: string) => mount(at, <Route path="/t/acme/planner/idea" element={<SettingsDialog product={product("admin")} tenantId="t1" />} />);

describe("the dialog", () => {
  it("opens at the section asked for, over the product, naming the groups", async () => {
    const host = await dialogAt("/t/acme/planner/idea?settings=agents");
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(host.textContent).toContain("Section: agents over acme/planner");
    expect([...host.querySelectorAll(".settings-nav-head")].map((h) => h.textContent)).toEqual(["Planner", "Acme", "You"]);
    expect(host.querySelector('.settings-nav [aria-current="page"]')?.textContent).toBe("Agents");
  });

  it("opens the first section of the group it can when the one asked for isn't the person's", async () => {
    state.role = "member";
    const host = await dialogAt("/t/acme/planner/idea?settings=organization/access");
    expect(host.textContent).toContain("Section: organization people");
  });

  it("closes with Esc, leaving the screen and the rest of its address as they were", async () => {
    const host = await dialogAt("/t/acme/planner/idea?view=x&settings=agents&reach=all");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(where(host)).toBe("/t/acme/planner/idea?view=x");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("leaves Esc to a menu open inside it", async () => {
    const host = await dialogAt("/t/acme/planner/idea?settings=agents");
    const menu = document.createElement("div");
    menu.className = "menu";
    document.body.append(menu);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(where(host)).toBe("/t/acme/planner/idea?settings=agents");
  });
});

describe("the addresses Settings' sections had", () => {
  it("lead /connect into Agents and /settings into Account over the overview, keeping their query", async () => {
    const connect = await mount("/connect?reach=product&product=acme/planner", <Route path="/connect" element={<YourSettingsAddress section="agents" />} />);
    expect(where(connect)).toBe("/?reach=product&product=acme/planner&settings=agents");
    unmount?.();
    const settings = await mount("/settings?delete=account", <Route path="/settings" element={<YourSettingsAddress section="account" />} />);
    expect(where(settings)).toBe("/?delete=account&settings=account");
  });

  it("lead an organization's Members into its People, and to its General for deleting it", async () => {
    const members = await mount("/t/acme/members", <Route path="/t/:tenant/members" element={<OrganizationSettingsAddress section="organization/people" />} />);
    expect(where(members)).toBe("/t/acme?settings=organization/people");
    unmount?.();
    const deleting = await mount("/t/acme/members#delete-org-title", <Route path="/t/:tenant/members" element={<OrganizationSettingsAddress section="organization/people" />} />);
    expect(where(deleting)).toBe("/t/acme?settings=organization");
  });
});

describe("Instance admin", () => {
  it("is a page that wasn't found to anyone but an owner of this WhatBuild", async () => {
    const host = await mount("/admin/organizations", <Route path="/admin/*" element={<AdminGate />} />);
    expect(host.querySelector("h1")?.textContent).toBe("Page not found");
    expect(host.textContent).not.toContain("Instance admin");
  });

  it("has its own panel for an owner, with the way back to their product", async () => {
    state.instanceOwner = true;
    const host = await mount("/admin/organizations", <Route path="/admin/*" element={<AdminGate />} />);
    const panel = host.querySelector(".panel-left");
    expect(panel?.textContent).toContain("Instance admin");
    expect([...(panel?.querySelectorAll(".nav-l1 a") ?? [])].map((a) => a.textContent)).toEqual(["Organizations", "People", "Plans", "Starting organizations"]);
    expect(panel?.querySelector(".nav-quiet a")?.textContent).toBe("Back to Planner");
  });
});
