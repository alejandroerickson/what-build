import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ShellContext, type ShellSlots } from "../src/shell/slots.tsx";

// A link to a version the plan no longer keeps (410 version_deleted), or to a number never published
// (404), says so in a notice. Once that version has failed to load, nothing on the screen is left
// loading: the canvas shows nothing, and the inspector holds the current version's details.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/crew";
const APP = "/t/acme/crew";
const NOW = "2026-11-01T10:00:00.000Z";
const actor = { account_id: "a1", display_name: "Robin Example", surface: "mcp" as const, client: null };

const mockupVersion = (version: number) => ({
  version,
  title: "Checkout",
  columns: 1,
  summary: "",
  brief: "",
  pages: [],
  files: [],
  prototype: null,
  clickable: { viewable: false },
  published_at: NOW,
  published_by: actor,
});
const mockup = {
  mockup_id: "m1",
  title: "Checkout",
  summary: "",
  folder_id: null,
  folder: null,
  current_version: 12,
  archived_at: null,
  etag: "e1",
  updated_at: NOW,
  page_count: 0,
  current: mockupVersion(12),
  story_pages: [],
};
const storyVersion = (version: number) => ({ version, page_id: "overview", title: "Overview", summary: "", published_at: NOW, published_by: actor });
const storyPage = {
  page_id: "overview",
  title: "Overview",
  summary: "",
  current_version: 12,
  archived_at: null,
  etag: "s1",
  updated_at: NOW,
  current: storyVersion(12),
};

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  const gone = () => new real.ApiError(410, "version_deleted", "Version 1 was deleted.", { versions_kept: [3, 12] });
  const never = () => new real.ApiError(404, "not_found", "No such version.");
  const failed = () => new real.ApiError(500, "internal", "Something went wrong.");
  return {
    ...real,
    api: vi.fn(async (_method: string, path: string) => {
      if (path === `${BASE}/mockups`) return { items: [mockup], folders: [] };
      if (path === `${BASE}/mockups/m1`) return mockup;
      if (path.startsWith(`${BASE}/mockups/m1/versions?`)) return { items: [{ version: 12, page_count: 0, published_at: NOW }, { version: 3, page_count: 0, published_at: NOW }], versions_kept: 10 };
      if (path === `${BASE}/mockups/m1/versions/1`) throw gone();
      if (path === `${BASE}/mockups/m1/versions/40`) throw never();
      if (path === `${BASE}/mockups/m1/versions/50`) throw failed();
      if (path === `${BASE}/story/hierarchy`) return { etag: "h1", items: [{ page_id: "overview", title: "Overview", kind: "page", archived_at: null, children: [] }], unplaced: [] };
      if (path.startsWith(`${BASE}/story/pages?`)) return { items: [{ page_id: "overview", title: "Overview", archived_at: null, etag: "s1" }] };
      if (path.startsWith(`${BASE}/story/pages/overview?`)) return storyPage;
      if (path.startsWith(`${BASE}/story/pages/overview/versions?`)) return { items: [{ version: 12, title: "Overview", published_at: NOW, published_by: actor }], versions_kept: 10 };
      if (path.startsWith(`${BASE}/story/pages/overview/versions/1?`)) throw gone();
      if (path.startsWith(`${BASE}/story/pages/overview/versions/40?`)) throw never();
      if (path.startsWith(`${BASE}/story/pages/overview/versions/50?`)) throw failed();
      if (path.startsWith(`${BASE}/story/style`)) return { style: null, styles: [] };
      return { items: [] };
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product: { product_id: "p1", name: "Crewboard" }, storyOnly: false, canWrite: true, canDelete: true }),
}));

const { MockupPage } = await import("../src/routes/mockups.tsx");
const { StoryPage } = await import("../src/routes/story.tsx");

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function open(path: string) {
  const inspector = document.createElement("aside");
  const slots: ShellSlots = {
    panelContextEl: null, inspectorEl: inspector, inspectorId: "ins", registerPanelContext: () => () => {}, registerInspector: () => () => {},
    inspectorOpen: true, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host, inspector);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={`${APP}/exploration/mockups/:mockupId`} element={<MockupPage />} />
              <Route path={`${APP}/story/:pageId`} element={<StoryPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { host, inspector };
}

const loading = (el: HTMLElement) => el.querySelectorAll(".loading").length;
const showCurrent = (host: HTMLElement) => [...host.querySelectorAll("a, button")].find((b) => b.textContent?.includes("Show the current version"));

describe("a mockup at a version it no longer has", () => {
  it("says a deleted version was deleted, and leaves nothing loading", async () => {
    const { host, inspector } = await open(`${APP}/exploration/mockups/m1?v=1`);
    expect(host.textContent).toContain("Version 1 was deleted");
    expect(showCurrent(host)).toBeDefined();
    expect(loading(host)).toBe(0);
    expect(loading(inspector)).toBe(0);
    // The inspector holds the current version's details, and the versions kept.
    expect(inspector.textContent).toContain("Checkout");
    expect(inspector.textContent).toContain("12 · current");
  });

  it("says a number never published isn't there, and leaves nothing loading", async () => {
    const { host, inspector } = await open(`${APP}/exploration/mockups/m1?v=40`);
    expect(host.textContent).toContain("This mockup has no version 40");
    expect(loading(host)).toBe(0);
    expect(loading(inspector)).toBe(0);
  });

  it("says a version that failed for another reason couldn't be loaded, and offers to try again", async () => {
    const { host, inspector } = await open(`${APP}/exploration/mockups/m1?v=50`);
    expect(host.textContent).toContain("Version 50 couldn’t be loaded");
    expect(host.textContent).not.toContain("has no version");
    expect(loading(host)).toBe(0);
    expect(loading(inspector)).toBe(0);
  });
});

describe("a Story page at a version it no longer has", () => {
  it("says a deleted version was deleted, and leaves nothing loading", async () => {
    const { host, inspector } = await open(`${APP}/story/overview?v=1`);
    expect(host.textContent).toContain("Version 1 was deleted");
    expect(showCurrent(host)).toBeDefined();
    expect(loading(host)).toBe(0);
    expect(loading(inspector)).toBe(0);
    expect(inspector.textContent).toContain("Robin Example");
  });

  it("says a number never published isn't there, and leaves nothing loading", async () => {
    const { host, inspector } = await open(`${APP}/story/overview?v=40`);
    expect(host.textContent).toContain("This page has no version 40");
    expect(loading(host)).toBe(0);
    expect(loading(inspector)).toBe(0);
  });

  it("says a version that failed for another reason couldn't be loaded, and offers to try again", async () => {
    const { host } = await open(`${APP}/story/overview?v=50`);
    expect(host.textContent).toContain("Version 50 couldn’t be loaded");
    expect(host.textContent).not.toContain("has no version");
    expect(loading(host)).toBe(0);
  });
});
