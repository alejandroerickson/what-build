import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A product's address is /t/<organization>/<product>. An address from before teams were removed,
// /t/<organization>/<team>/<product>/…, still opens the product, the rest of it kept: the product
// that lists it among its former paths, or else the same address without its middle part. A
// product's own screens and the organization's pages are never taken for one, and a path pasted
// without /t/ opens the product too.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const acme = { tenant_id: "t1", slug: "acme", name: "Acme", name_etag: "e1", plan: "free", your_role: "owner", former_slugs: ["acme-old"] };
const state = { items: [] as { product_id: string; path: string; name: string; former_paths?: string[] }[] };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path.startsWith("/api/v1/me/products")) return { items: state.items.map((p) => ({ ...p, tenant: acme, your_role: "editor" })), tenants: [acme] };
    throw new Error(`unexpected request ${path}`);
  }),
}));
// The plain shell around Not found is the app's frame, not what is tested here.
vi.mock("../src/shell/Shell.tsx", () => ({ PlainShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../src/routes/auth.tsx", () => ({ NotFound: () => <p data-screen="not-found">Not found</p> }));

const { currentProductPath, CurrentTenantAddress } = await import("../src/lib/session.tsx");
const { BARE_PRODUCT_ROUTE, BareProductPath, FORMER_PRODUCT_ROUTE, FormerProductAddress, PRODUCT_ROUTE } = await import("../src/routes/addresses.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  state.items = [];
});

/** Where the app is, and the screen and product drawn there. */
function Screen({ name }: { name: string }) {
  const { pathname, search, hash } = useLocation();
  const params = useParams();
  return <output data-screen={name} data-product={params["product"] ?? ""} data-where={`${pathname}${search}${hash}`} />;
}

/** The app's routes for a product, its organization's pages and the older forms, as main.tsx has them. */
async function open(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/t/:tenant/members" element={<Screen name="members" />} />
            <Route path="/t/:tenant/plan" element={<Screen name="plan" />} />
            <Route path="/t/:tenant/limits" element={<Screen name="plan" />} />
            <Route path={PRODUCT_ROUTE} element={<Outlet />}>
              <Route index element={<Screen name="product" />} />
              <Route path="idea" element={<Screen name="idea" />} />
              <Route path="story" element={<Screen name="story" />} />
              <Route path="story/:pageId" element={<Screen name="story-page" />} />
              <Route path="evidence" element={<Screen name="evidence" />} />
              <Route path="evidence/:recordId" element={<Screen name="source" />} />
              <Route path="exploration" element={<Outlet />}>
                <Route path="mockups/:mockupId" element={<Screen name="mockup" />} />
              </Route>
            </Route>
            <Route path={FORMER_PRODUCT_ROUTE} element={<CurrentTenantAddress><FormerProductAddress /></CurrentTenantAddress>} />
            <Route path={BARE_PRODUCT_ROUTE} element={<BareProductPath />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && !host.querySelector("[data-screen]"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  const shown = host.querySelector<HTMLElement>("[data-screen]");
  return { screen: shown?.dataset["screen"], product: shown?.dataset["product"], where: shown?.dataset["where"] };
}

describe("a product's address", () => {
  it("opens the product and each of its screens, never taken for an older address", async () => {
    state.items = [{ product_id: "p1", path: "acme/crewboard", name: "Crewboard" }];
    expect(await open("/t/acme/crewboard")).toEqual({ screen: "product", product: "crewboard", where: "/t/acme/crewboard" });
    expect(await open(`/t/acme/crewboard/evidence/${ID}`)).toEqual({ screen: "source", product: "crewboard", where: `/t/acme/crewboard/evidence/${ID}` });
    expect(await open("/t/acme/crewboard/story/x")).toEqual({ screen: "story-page", product: "crewboard", where: "/t/acme/crewboard/story/x" });
    expect(await open("/t/acme/crewboard/exploration/mockups/m1")).toMatchObject({ screen: "mockup", where: "/t/acme/crewboard/exploration/mockups/m1" });
  });

  it("leaves the organization's own pages to the organization", async () => {
    expect(await open("/t/acme/members")).toMatchObject({ screen: "members", where: "/t/acme/members" });
    expect(await open("/t/acme/plan")).toMatchObject({ screen: "plan", where: "/t/acme/plan" });
    expect(await open("/t/acme/limits")).toMatchObject({ screen: "plan", where: "/t/acme/limits" });
  });
});

describe("an address from before teams were removed", () => {
  it("opens the product at the same address without its middle part, keeping the rest, the query and the hash", async () => {
    state.items = [{ product_id: "p1", path: "acme/crewboard", name: "Crewboard" }];
    expect(await open("/t/acme/core/crewboard")).toEqual({ screen: "product", product: "crewboard", where: "/t/acme/crewboard" });
    expect(await open(`/t/acme/core/crewboard/evidence/${ID}?view=text#quote`)).toEqual({ screen: "source", product: "crewboard", where: `/t/acme/crewboard/evidence/${ID}?view=text#quote` });
    expect(await open("/t/acme/core/crewboard/story/launch")).toMatchObject({ screen: "story-page", where: "/t/acme/crewboard/story/launch" });
  });

  it("opens the product that lists it among its former paths, where removing teams changed the product's slug", async () => {
    state.items = [
      { product_id: "p1", path: "acme/crewboard", name: "Crewboard" },
      { product_id: "p2", path: "acme/crewboard-2", name: "Crewboard", former_paths: ["acme/research/crewboard"] },
    ];
    expect(await open("/t/acme/research/crewboard/story/launch?page=two")).toEqual({ screen: "story-page", product: "crewboard-2", where: "/t/acme/crewboard-2/story/launch?page=two" });
    // Another middle part names no other product: the same address without it.
    expect(await open("/t/acme/core/crewboard/idea")).toMatchObject({ screen: "idea", product: "crewboard", where: "/t/acme/crewboard/idea" });
  });

  it("follows the organization's current slug too", async () => {
    state.items = [{ product_id: "p1", path: "acme/crewboard", name: "Crewboard" }];
    expect(await open("/t/acme-old/core/crewboard/evidence")).toMatchObject({ screen: "evidence", where: "/t/acme/crewboard/evidence" });
  });

  it("is not a screen the app doesn't have in a product the person has", async () => {
    state.items = [{ product_id: "p1", path: "acme/crewboard", name: "Crewboard" }];
    expect((await open("/t/acme/crewboard/nowhere")).screen).toBe("not-found");
  });
});

describe("a product's path without /t/", () => {
  it("opens the product, in either form, keeping the rest of it", async () => {
    state.items = [{ product_id: "p1", path: "acme/crewboard", name: "Crewboard" }];
    expect(await open("/acme/crewboard/idea")).toMatchObject({ screen: "idea", where: "/t/acme/crewboard/idea" });
    expect(await open("/acme/core/crewboard?from=mail")).toMatchObject({ screen: "product", where: "/t/acme/crewboard?from=mail" });
  });

  it("is never a path that starts with t/", async () => {
    expect((await open("/t/acme")).screen).toBe("not-found");
  });
});

describe("currentProductPath", () => {
  const items = [
    { path: "acme/crewboard" },
    { path: "acme/crewboard-2", former_paths: ["acme/research/crewboard"] },
  ];
  it("is the product that lists the address, or the address without its middle part", () => {
    expect(currentProductPath(items, "acme", "research", "crewboard")).toBe("acme/crewboard-2");
    expect(currentProductPath(items, "acme", "core", "crewboard")).toBe("acme/crewboard");
    // A product the person can't see is the server's to answer.
    expect(currentProductPath(items, "acme", "core", "rota")).toBe("acme/rota");
    expect(currentProductPath(undefined, "acme", "core", "rota")).toBe("acme/rota");
  });
  it("is nothing for a screen the app doesn't have in a product the person has", () => {
    expect(currentProductPath(items, "acme", "crewboard", "nowhere")).toBeNull();
  });
});
