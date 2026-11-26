import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Explore the demo on the public site signs a visitor in and goes on to /demo, which opens the demo
// itself: the example organization's first product, on its first screen. The landing page and
// button it came by are told to the server on the way, and leave the address.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const own = { tenant_id: "t1", slug: "acme", name: "Acme", name_etag: "e1", plan: "free", your_role: "owner" };
const example = { tenant_id: "t2", slug: "harbor-labs", name: "Harbor Labs", name_etag: "e2", plan: "unlimited", your_role: "member", example: true };
type Tenant = typeof own | typeof example;
const state = {
  tenants: [] as Tenant[],
  items: [] as { product_id: string; path: string; name: string; tenant: Tenant; your_role: string }[],
  cameFrom: [] as unknown[],
};
const ME = { account_id: "a1", email: "new@example.com", display_name: "New", guest: false, tenant_allowance: { remaining: 0 }, tutorial: { seen: [], off: false } };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string, body?: unknown) => {
    if (path === "/auth/session") return { signed_in: true, ...ME };
    if (path.startsWith("/api/v1/me/products")) return { items: state.items, tenants: state.tenants };
    if (path === "/api/v1/me/came-from") return (state.cameFrom.push(body), {});
    throw new Error(`unexpected request ${path}`);
  }),
}));

const { RequireSession } = await import("../src/lib/session.tsx");
const { DemoAddress, PRODUCT_ROUTE } = await import("../src/routes/addresses.tsx");

let unmount: (() => void) | null = null;
function close() {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
}
afterEach(() => {
  close();
  state.tenants = [];
  state.items = [];
  state.cameFrom = [];
});

function Screen({ name }: { name: string }) {
  const { pathname, search, hash } = useLocation();
  return <output data-screen={name} data-where={`${pathname}${search}${hash}`} />;
}

/** Arrives at `to` once more, just after the screens have acted on the first arrival, as the development sign-in does. */
function Again({ to }: { to: string }) {
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

/**
 * The app's signed-in routes as main.tsx has them, opened at `at`: where it ends, and on which
 * screen. `known` has the session and the products already read, so the demo opens in the same
 * moment the address is first read; `again` arrives at `at` a second time just after.
 */
async function open(at: string, { known = false, again = false } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: known ? Infinity : 0 } } });
  if (known) {
    qc.setQueryData(["me"], ME);
    qc.setQueryData(["products", false], { items: state.items, tenants: state.tenants });
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route element={<RequireSession><Outlet /></RequireSession>}>
              <Route path="/" element={<Screen name="overview" />} />
              <Route path="/demo" element={<DemoAddress />} />
              <Route path={PRODUCT_ROUTE} element={<Outlet />}>
                <Route path="idea" element={<Screen name="idea" />} />
                <Route path="story" element={<Screen name="story" />} />
              </Route>
            </Route>
            {/* Sign-in, or anywhere else the app has no screen for here. */}
            <Route path="*" element={<Screen name="elsewhere" />} />
          </Routes>
          {again ? <Again to={at} /> : null}
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 40 && !host.querySelector("[data-screen]"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  // Anything still on its way to another address arrives.
  await act(() => new Promise((r) => setTimeout(r, 20)));
  const shown = host.querySelector<HTMLElement>("[data-screen]");
  return { screen: shown?.dataset["screen"], where: shown?.dataset["where"] };
}

const demoOnly = () => {
  state.tenants = [example];
  state.items = [{ product_id: "p2", path: "harbor-labs/crewboard", name: "Crewboard", tenant: example, your_role: "guest" }];
};
const told = () => new Set(state.cameFrom.map((c) => JSON.stringify(c)));

describe("the demo's address", () => {
  it("opens the example organization's first product on its Idea, after the person's own organizations", async () => {
    state.tenants = [own, example];
    state.items = [
      { product_id: "p1", path: "acme/onboarding", name: "Onboarding", tenant: own, your_role: "admin" },
      { product_id: "p2", path: "harbor-labs/crewboard", name: "Crewboard", tenant: example, your_role: "guest" },
      { product_id: "p3", path: "harbor-labs/dockside", name: "Dockside", tenant: example, your_role: "guest" },
    ];
    expect(await open("/demo")).toEqual({ screen: "idea", where: "/t/harbor-labs/crewboard/idea" });
  });

  it("tells the server the landing page and button once, and leaves neither on the address", async () => {
    demoOnly();
    expect(await open(`/demo?landing=${encodeURIComponent("/what-to-build/")}&button=explore`)).toEqual({ screen: "idea", where: "/t/harbor-labs/crewboard/idea" });
    expect(state.cameFrom).toEqual([{ page: "/what-to-build/", button: "explore" }]);
  });

  it("does the same where the session and the products were read before", async () => {
    demoOnly();
    expect(await open("/demo?landing=/&button=explore", { known: true })).toEqual({ screen: "idea", where: "/t/harbor-labs/crewboard/idea" });
    expect(state.cameFrom).toEqual([{ page: "/", button: "explore" }]);
  });

  it("takes them off an arrival that brings them back, and opens the demo all the same", async () => {
    demoOnly();
    expect(await open("/demo?landing=/&button=explore", { known: true, again: true })).toEqual({ screen: "idea", where: "/t/harbor-labs/crewboard/idea" });
    // Told again, it is the same: the server keeps only the first.
    expect(told()).toEqual(new Set([JSON.stringify({ page: "/", button: "explore" })]));
  });

  it("opens the overview where there is no example organization to open", async () => {
    state.tenants = [own];
    state.items = [{ product_id: "p1", path: "acme/onboarding", name: "Onboarding", tenant: own, your_role: "admin" }];
    expect(await open("/demo")).toEqual({ screen: "overview", where: "/" });
    close();
    // The example organization, with nothing in it to open.
    state.tenants = [own, example];
    expect(await open("/demo")).toEqual({ screen: "overview", where: "/" });
  });
});
