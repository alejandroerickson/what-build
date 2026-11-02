import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The empty seat: until the person has an agent connected, Connect an agent's row in the panel is a
// card in its place, for everyone, and goes the moment an agent is connected.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

let agents: unknown[] = [];
const acme = { tenant_id: "t1", slug: "acme", name: "Acme", example: false, your_role: "member", teams: [] };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/api/v1/me/agents") return { items: agents };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [{ product_id: "p1", name: "Harvest", path: "acme/core/harvest", tenant: acme, team: { slug: "core" }, your_role: "editor" }], tenants: [acme] };
    if (path === "/api/v1/me") return { display_name: "Sam", tenant_allowance: { remaining: 1, instance_owner: false } };
    throw new Error(`unexpected ${path}`);
  }),
}));

const { api } = await import("../src/lib/api.ts");
const { PlainNav, ProductNav } = await import("../src/shell/panel.tsx");

const product = (role: "editor" | "reader") =>
  ({
    product_id: "p1",
    name: "Harvest",
    path: "acme/core/harvest",
    your_role: role,
    stage_counts: { idea: 3, evidence: 12, exploration: 4, story: 2 },
    tenant: { ...acme },
    team: { team_id: "tm1", slug: "core", name: "Core" },
  }) as never;

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function mount(ui: React.ReactNode, at = "/t/acme/core/harvest/evidence") {
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

describe("the empty seat", () => {
  it("takes the row's place in a product while no agent is connected, and opens Connect an agent for this product", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("editor")} app="/t/acme/core/harvest" section="evidence" />);
    expect(seat(host)?.textContent).toContain("No agent connected");
    expect(seatLink(host)).toBe("/t/acme/core/harvest/connect");
    expect(row(host)).toBeUndefined();
    // Activity and Settings keep their places under it.
    expect([...host.querySelectorAll("a.nav-node-quiet")].map((a) => a.textContent)).toEqual(["Activity", "Settings"]);
  });

  it("gives way to the plain row once an agent is connected", async () => {
    agents = [{ family_id: "f1" }];
    const host = await mount(<ProductNav product={product("editor")} app="/t/acme/core/harvest" section="evidence" />);
    expect(seat(host)).toBeNull();
    expect(row(host)?.getAttribute("href")).toBe("/t/acme/core/harvest/connect");
  });

  it("goes when the person comes back to the tab having connected an agent elsewhere, and stops asking", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("editor")} app="/t/acme/core/harvest" section="evidence" />);
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
    expect(row(host)?.getAttribute("href")).toBe("/t/acme/core/harvest/connect");
    // With an agent connected, coming back reads nothing.
    vi.mocked(api).mockClear();
    await comeBack();
    expect(vi.mocked(api).mock.calls.filter(([, path]) => path === "/api/v1/me/agents")).toHaveLength(0);
    focusManager.setFocused(undefined);
  });

  it("leaves the row, marked current, on Connect an agent itself", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("editor")} app="/t/acme/core/harvest" section="connect" />, "/t/acme/core/harvest/connect");
    expect(seat(host)).toBeNull();
    expect(row(host)?.getAttribute("aria-current")).toBe("page");
  });

  it("shows a reader the seat under the Story, opening Connect an agent outside the product", async () => {
    agents = [];
    const host = await mount(<ProductNav product={product("reader")} app="/t/acme/core/harvest" section="story" />);
    expect([...host.querySelectorAll("a.nav-node")].map((a) => a.textContent)).toEqual(["Story2"]);
    expect(seatLink(host)).toBe("/connect");
  });

  it("sits in the panel outside a product too", async () => {
    agents = [];
    const host = await mount(<PlainNav section="home" />);
    expect(seatLink(host)).toBe("/connect");
    expect(row(host)).toBeUndefined();
    agents = [{ family_id: "f1" }];
    const again = await mount(<PlainNav section="home" />);
    expect(seat(again)).toBeNull();
    expect(row(again)?.getAttribute("href")).toBe("/connect");
  });
});
