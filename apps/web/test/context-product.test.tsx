import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// On a screen that is no product's own (the overview), the panel shows the product the person was
// last in; with none kept, one they write in before one they only read, their own organizations'
// before the example organization's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

const org = (id: string, example = false) => ({ tenant_id: id, slug: id, name: id, name_etag: "e", plan: "free", your_role: example ? "guest" : "member", ...(example ? { example: true } : {}) });
const product = (id: string, tenant: ReturnType<typeof org>, your_role: string) => ({ product_id: id, name: id, path: `${tenant.slug}/${id}`, tenant, your_role, stage_counts: { story: 1 } });

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "sam@example.com", display_name: "Sam", hide_example: false, tenant_allowance: { instance_owner: false, remaining: 0 } };
    if (path.startsWith("/api/v1/me/products")) {
      const [example, reads, writes] = [org("example", true), org("reads"), org("writes")];
      return {
        items: [product("showcase", example, "guest"), product("brief", reads, "reader"), product("planner", writes, "editor")],
        tenants: [example, reads, writes],
      };
    }
    return {};
  }),
}));

const { useContextProduct } = await import("../src/shell/panel.tsx");

function Shows() {
  const { product } = useContextProduct();
  return <output>{product?.path ?? "none"}</output>;
}

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function shown() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Shows />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && host.textContent === "none"; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host.textContent;
}

describe("the product the panel shows beside the overview", () => {
  it("is one the person writes in, in their own organization, when none was open before", async () => {
    expect(await shown()).toBe("writes/planner");
  });

  it("is the one they were last in, whatever their role there", async () => {
    localStorage.setItem("whatbuild.last-product", "reads/brief");
    expect(await shown()).toBe("reads/brief");
  });
});
