import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// An assumption's page: its menu holds only what this person can do to it, with a separator only
// between groups of things to do.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const riley = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
/** The assumption the page shows, which a test may archive. */
const entry = {
  id: ID, kind: "assumption", statement: "Crews plan by the day.", body: "", status: "unconfirmed", frozen: false, links: [], linked_from: [], outcome_ids: [], tags: [],
  author: riley, author_type: "human", reviews: [], review_count: 0, human_review: { confidence: "unreviewed", reviewer: null, reviewed_at: null },
  archived_at: null as string | null, etag: "e1", created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z",
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === `${BASE}/assumptions/${ID}`) return { ...entry };
    return { items: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, canWrite: true, canDelete: true }),
}));

const { RegisterEntryPage } = await import("../src/routes/registers.tsx");

beforeAll(() => {
  // A menu asks whether motion is reduced; jsdom has no media queries.
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  entry.archived_at = null;
});

async function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`${APP}/exploration/assumptions/${ID}`]}>
          <Routes>
            <Route path={`${APP}/exploration/assumptions/:id`} element={<RegisterEntryPage kind="assumptions" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

/** The page's More actions menu, opened: each item's words, and "—" for a separator. */
async function moreActions(host: HTMLElement): Promise<string[]> {
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click());
  const menu = document.querySelector('[role="menu"]')!;
  return [...menu.children].map((el) => (el.getAttribute("role") === "separator" ? "—" : (el.querySelector(".menu-text")?.textContent ?? el.textContent ?? "").trim()));
}

describe("an assumption's menu", () => {
  it("sets Delete apart from what an editor can do to it", async () => {
    const host = await open();
    expect(await moreActions(host)).toEqual(["Edit", "Archive", "Archiving takes it out of lists and search. Nothing is erased.", "—", "Delete permanently…"]);
  });

  it("holds Delete alone once it is archived, with no separator before it", async () => {
    entry.archived_at = "2026-10-02T09:00:00.000Z";
    const host = await open();
    expect(await moreActions(host)).toEqual(["Delete permanently…"]);
  });
});
