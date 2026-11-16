import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The tutorial is offered on the first screen that shows a product's panel, the overview included,
// before anything is clicked: whoever the panel's product gives it to gets the welcome there, and the
// account menu's item. Starting it goes into the product, which takes it from there.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = (query: string) =>
  ({ matches: query.includes("reduce"), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let role: string | null = "editor";
let example = false;
let kept = { offered: false, stop: null as number | null, finished: false };
const calls: { method: string; path: string; body?: unknown }[] = [];
const tenant = () => ({ tenant_id: "t1", slug: "acme", name: "Acme", example, name_etag: "e", plan: "free", your_role: role === "guest" ? "guest" : "member" });

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "sam@example.com", display_name: "Sam Okafor", tenant_allowance: { remaining: 0, instance_owner: false }, hide_example: false, tutorial: kept };
    if (path === "/api/v1/me" && method === "PATCH") {
      kept = { ...kept, ...(body as { tutorial: typeof kept }).tutorial };
      return { display_name: "Sam Okafor", tutorial: kept };
    }
    if (path === "/api/v1/me/agents") return { items: [] };
    if (path === "/api/v1/me/invitations") return { items: [] };
    if (path.startsWith("/api/v1/me/products"))
      return {
        items: role
          ? [{ product_id: "p1", name: "Harvest", path: "acme/harvest", archived_at: null, updated_at: "2026-11-01T00:00:00Z", tenant: tenant(), your_role: role, counts: { story_pages: 0 }, stage_counts: { idea: 0, evidence: 0, exploration: 0, story: 0 } }]
          : [],
        tenants: [tenant()],
      };
    return {};
  }),
}));

const { PlainShell } = await import("../src/shell/Shell.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

function Product() {
  const { pathname, state } = useLocation();
  return <output data-testid="product">{`${pathname} ${JSON.stringify(state)}`}</output>;
}

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  calls.length = 0;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function overview() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<PlainShell><h1>Your products</h1></PlainShell>} />
              <Route path="/t/:tenant/:product/*" element={<Product />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  unmount = () => act(() => root.unmount());
  // Nothing is clicked: the welcome comes a moment after the screen opens.
  await act(async () => new Promise((r) => setTimeout(r, 1000)));
}

const welcome = () => document.querySelector('[role="dialog"].tut-welcome');
const product = () => document.querySelector('[data-testid="product"]')?.textContent ?? null;
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error("nothing to click");
  await act(async () => (el as HTMLElement).click());
  await act(async () => new Promise((r) => setTimeout(r, 300)));
};
const menuItem = async () => {
  await click(document.querySelector(".panel-foot .account-button"));
  return document.querySelector(".menu .menu-tutorial");
};

describe("the tutorial on the overview", () => {
  it("offers an editor of the panel's product the welcome before anything is clicked, and Start the tutorial begins it at that product's Idea", async () => {
    role = "editor";
    example = false;
    kept = { offered: false, stop: null, finished: false };
    await overview();
    expect(welcome()?.textContent).toContain("Take the WhatBuild tutorial?");
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { offered: true } } });
    await click([...document.querySelectorAll(".tut-welcome button")].find((b) => b.textContent === "Start the tutorial"));
    expect(product()).toBe('/t/acme/harvest/idea {"tutorial":"welcome"}');
  });

  it("offers a guest of the example organization the welcome there too", async () => {
    role = "guest";
    example = true;
    kept = { offered: false, stop: null, finished: false };
    await overview();
    expect(welcome()).not.toBeNull();
  });

  it("closes with Not now, and offers it from the account menu after, going into the product at the stop it was left at", async () => {
    role = "editor";
    example = false;
    kept = { offered: false, stop: null, finished: false };
    await overview();
    await click([...document.querySelectorAll(".tut-welcome button")].find((b) => b.textContent === "Not now"));
    expect(welcome()).toBeNull();
    expect(document.body.textContent).toContain("The tutorial is in your account menu.");
    expect((await menuItem())?.textContent).toContain("Take the tutorial");
    // Closed part-way at the source, in Evidence: Resume goes there.
    kept = { offered: true, stop: 7, finished: false };
    unmount?.();
    document.body.innerHTML = "";
    await overview();
    expect(welcome()).toBeNull();
    const item = await menuItem();
    expect(item?.textContent).toContain("Resume tutorial");
    expect(item?.textContent).toContain("Stop 8 of 20 · Evidence");
    await click(item);
    expect(product()).toBe('/t/acme/harvest/evidence {"tutorial":"menu"}');
  });

  it("offers nothing, and no menu item, with no product in the panel, or to a viewer or a Story reader", async () => {
    for (const r of [null, "viewer", "story_reader"]) {
      role = r;
      example = false;
      kept = { offered: false, stop: null, finished: false };
      await overview();
      expect(welcome(), String(r)).toBeNull();
      if (document.querySelector(".panel-foot .account-button")) expect(await menuItem(), String(r)).toBeNull();
      expect(calls.some((c) => c.method === "PATCH"), String(r)).toBe(false);
      unmount?.();
      unmount = null;
      document.body.innerHTML = "";
    }
  });
});
