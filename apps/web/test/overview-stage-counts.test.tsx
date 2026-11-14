import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each product on the overview links to its four stages, each tile showing the stage's count. A
// screen reader hears the count with what it counts, in the word each stage holds: Exploration
// holds mockups only, so its tile says mockups, as Idea's says outcomes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = { exploration: 1 };

const tenant = { tenant_id: "t-acme", slug: "acme", name: "Acme", name_etag: "e", example: false, plan: "free", your_role: "owner" };

const product = () => ({
  product_id: "p-1",
  path: "acme/product-team/crewboard",
  name: "Crewboard",
  archived_at: null,
  updated_at: "2026-11-01T10:00:00.000Z",
  tenant: { tenant_id: "t-acme", slug: "acme", name: "Acme" },
  your_role: "owner",
  counts: {},
  stage_counts: { idea: 2, evidence: 1, exploration: state.exploration, story: 4 },
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/auth/session")
      return {
        signed_in: true,
        account_id: "a",
        email: "ana@example.com",
        display_name: "Ana",
        tenant_allowance: { instance_owner: false, allowed: 1, created: 1, remaining: 0, source: "default" },
        new_organization_plan: "free",
        hide_example: false,
        asked_for_organization_at: null,
      };
    if (path.startsWith("/api/v1/me/products")) return { items: [product()], tenants: [tenant] };
    return {};
  }),
}));

const { OverviewPage } = await import("../src/routes/overview.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  state.exploration = 1;
});

async function show() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/"]}>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(() => new Promise((r) => setTimeout(r, 20)));
  return host;
}

/** Each stage tile's label and count as a screen reader reads them, the hidden unit included. */
const tiles = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLAnchorElement>(".overview-go")].map((a) =>
    `${a.querySelector(".overview-go-label")?.textContent} ${a.querySelector(".overview-go-count")?.textContent}`.replace(/\s+/g, " ").trim(),
  );

describe("A product's stage tiles on the overview", () => {
  it("name Exploration's count in mockups, beside outcomes, sources and pages", async () => {
    const host = await show();
    expect(tiles(host)).toEqual(["Idea 2 outcomes", "Evidence 1 source", "Exploration 1 mockup", "Story 4 pages"]);
  });

  it("say mockups for more than one", async () => {
    state.exploration = 3;
    const host = await show();
    expect(tiles(host)).toContain("Exploration 3 mockups");
  });
});
