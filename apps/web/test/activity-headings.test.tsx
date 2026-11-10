import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The feed's days are headings one level below the heading of the section that shows it: under the
// Activity screen's h1 they are h2, and under Settings → Access changes, whose heading is an h2,
// they are h3. A screen reader's list of headings then nests each day under its section.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/crew";
const APP = "/t/acme/crew";
const change = {
  activity_id: "a1", occurred_at: "2026-09-01T12:00:00Z", actor: { account_id: "acc_1", display_name: "Riley Chen", surface: "web", client: null }, channel: "web",
  through_agent: false, action: "granted", entity_type: "membership", entity_id: "acc_2", entity_title: "Pete Editor", summary: "Gave editor on product Planner",
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path.includes("/activity")) return { items: [change], next_cursor: null };
    return { items: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product: { product_id: "p1", name: "Crewboard" }, canWrite: true, canDelete: true }),
}));

const { ActivityPage } = await import("../src/routes/product-misc.tsx");
const { OrganizationAccessChanges } = await import("../src/routes/org.tsx");

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function render(screen: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`${APP}/activity`]}>{screen}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

/** The section's heading, then each day's, as their tag names. */
const levels = (host: HTMLElement) => [host.querySelector(".sheet-title")?.tagName, ...[...host.querySelectorAll(".activity-day")].map((d) => d.tagName)];

describe("the feed's day headings", () => {
  it("are h2 under the Activity screen's h1", async () => {
    expect(levels(await render(<ActivityPage />))).toEqual(["H1", "H2"]);
  });

  it("are h3 under the h2 of Settings → Access changes", async () => {
    expect(levels(await render(<OrganizationAccessChanges tenant="acme" />))).toEqual(["H2", "H3"]);
  });
});
