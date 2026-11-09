import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A product's Settings say how many products the person can see in its organization, and name
// them: archived ones too, the one on screen among them, each marked archived.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/crew";
const tenant = { tenant_id: "t1", slug: "acme", name: "Acme" };
/** The archived product whose Settings show, to an admin. */
const product = {
  product_id: "p1", name: "Crewboard", slug: "crew", concept: "", archived_at: "2026-10-02T09:00:00.000Z", etag: "product-etag", path: "acme/crew",
  tenant, your_role: "admin",
};
const live = { ...product, product_id: "p2", name: "Rota", slug: "rota", archived_at: null, path: "acme/rota" };

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (_method: string, path: string) => {
      const tenants = [{ ...tenant, your_role: "admin" }];
      // The server leaves archived products out unless asked for them.
      if (path === "/api/v1/me/products") return { items: [live], tenants };
      if (path === "/api/v1/me/products?include_archived=true") return { items: [product, live], tenants };
      if (path === `${BASE}/exports`) return { items: [] };
      if (path.startsWith("/api/v1/tenants/acme/members")) return { product: { product_id: product.product_id, name: product.name }, members: [], invitations: [] };
      return {};
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: "/t/acme/crew", canWrite: false, canDelete: false, isAdmin: true, product }),
}));

window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

const { ProductSettingsPage } = await import("../src/routes/product-misc.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProductSettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("an archived product's Settings", () => {
  it("count and name every product the person can see in the organization, this one included", async () => {
    const host = await render();
    const sentence = [...host.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => t.startsWith("You can see"));
    expect(sentence).toBe("You can see 2 products in Acme: Crewboard (archived) and Rota.");
  });
});
