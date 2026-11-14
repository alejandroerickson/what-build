import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The empty seat: until the person has an agent connected, the panel holds a card that opens
// Settings at Agents, for everyone, and it goes the moment an agent is connected.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

let agents: unknown[] = [];
const acme = { tenant_id: "t1", slug: "acme", name: "Acme", example: false, your_role: "member" };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/api/v1/me/agents") return { items: agents };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [{ product_id: "p1", name: "Harvest", path: "acme/harvest", tenant: acme, your_role: "editor" }], tenants: [acme] };
    if (path === "/api/v1/me") return { display_name: "Sam", tenant_allowance: { remaining: 1, instance_owner: false } };
    throw new Error(`unexpected ${path}`);
  }),
}));

const { api } = await import("../src/lib/api.ts");
const { EmptyOrganizationNav, ProductNav } = await import("../src/shell/panel.tsx");

const product = (role: "editor" | "story_reader") =>
  ({
    product_id: "p1",
    name: "Harvest",
    path: "acme/harvest",
    your_role: role,
    stage_counts: { idea: 3, evidence: 12, exploration: 4, story: 2 },
    tenant: { ...acme },
  }) as never;

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function mount(ui: React.ReactNode, at = "/t/acme/harvest/evidence") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const seat = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-agent-seat]");
const seatLink = (host: HTMLElement) => seat(host)?.querySelector("a")?.getAttribute("href");
const row = (host: HTMLElement) => [...host.querySelectorAll("a.nav-node")].find((a) => a.textContent === "Connect an agent");
const quiet = (host: HTMLElement) => [...host.querySelectorAll("a.nav-node-quiet")].map((a) => [a.textContent, a.getAttribute("href")]);

describe("the empty seat", () => {
  it("sits in the panel while no agent is connected, and opens Settings at Agents over the screen", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("editor")} section="evidence" />);
    expect(seat(host)?.textContent).toContain("No agent connected");
    expect(seatLink(host)).toBe("/t/acme/harvest/evidence?settings=agents");
    expect(row(host)).toBeUndefined();
    // Activity and Settings keep their places under it; Settings opens over the screen too.
    expect(quiet(host)).toEqual([
      ["Activity", "/t/acme/harvest/activity"],
      ["Settings", "/t/acme/harvest/evidence?settings=product"],
    ]);
  });

  it("goes once an agent is connected, leaving no row of its own", async () => {
    agents = [{ family_id: "f1" }];
    const host = await mount(<ProductNav product={product("editor")} section="evidence" />);
    expect(seat(host)).toBeNull();
    expect(row(host)).toBeUndefined();
    expect(quiet(host).map(([label]) => label)).toEqual(["Activity", "Settings"]);
  });

  it("goes when the person comes back to the tab having connected an agent elsewhere, and stops asking", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("editor")} section="evidence" />);
    expect(seat(host)).not.toBeNull();
    agents = [{ family_id: "f1" }];
    const comeBack = async () => {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
    };
    await comeBack();
    expect(seat(host)).toBeNull();
    expect(row(host)).toBeUndefined();
    // With an agent connected, coming back reads nothing.
    vi.mocked(api).mockClear();
    await comeBack();
    expect(vi.mocked(api).mock.calls.filter(([, path]) => path === "/api/v1/me/agents")).toHaveLength(0);
    focusManager.setFocused(undefined);
  });

  it("shows a Story reader the seat under the Story, and Settings at their own account", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("story_reader")} section="story" />, "/t/acme/harvest/story");
    expect([...host.querySelectorAll("a.nav-node:not(.nav-node-quiet)")].map((a) => a.textContent)).toEqual(["Story2"]);
    expect(seatLink(host)).toBe("/t/acme/harvest/story?settings=agents");
    expect(quiet(host)).toEqual([["Settings", "/t/acme/harvest/story?settings=account"]]);
  });

  it("sits in an organization's panel with no product too", async () => {
    agents = [];
    const host = await mount(<EmptyOrganizationNav tenant={{ ...acme, name_etag: "e", plan: "free" } as never} />, "/t/acme");
    expect(seatLink(host)).toBe("/t/acme?settings=agents");
    expect(host.textContent).toContain("Nothing to open yet");
    agents = [{ family_id: "f1" }];
    const again = await mount(<EmptyOrganizationNav tenant={{ ...acme, your_role: "creator", name_etag: "e", plan: "free" } as never} />, "/t/acme");
    expect(seat(again)).toBeNull();
    expect(again.textContent).toContain("Create a product");
  });
});
