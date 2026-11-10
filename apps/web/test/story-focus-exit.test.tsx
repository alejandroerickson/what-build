import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ShellContext, type ShellSlots } from "../src/shell/slots.tsx";

// Focus mode hides the panels. A Story screen that has no page to show (a link to a page that isn't
// in the Story, a page that was deleted, a Story with no pages) still shows the way back while focus
// mode is on, so the panels never stay away behind a screen that doesn't say how to bring them back.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/crew";
const APP = "/t/acme/crew";
const story = { pages: 1, fail: false };

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (_method: string, path: string) => {
      if (path === `${BASE}/story/hierarchy` && story.fail) throw new real.ApiError(500, "internal", "Something went wrong.");
      if (path === `${BASE}/story/hierarchy`)
        return { etag: "h1", items: story.pages ? [{ page_id: "overview", title: "Overview", kind: "page", archived_at: null, children: [] }] : [], unplaced: [] };
      if (path.startsWith(`${BASE}/story/pages/missing`)) throw new real.ApiError(404, "not_found", "No such page.");
      if (path.startsWith(`${BASE}/story/pages?`)) return { items: [] };
      if (path.startsWith(`${BASE}/story/style`)) return { style: null, styles: [] };
      return { items: [] };
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product: { product_id: "p1", name: "Crewboard" }, storyOnly: true, canWrite: false, canDelete: false }),
}));

const { StoryPage } = await import("../src/routes/story.tsx");

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  story.pages = 1;
  story.fail = false;
});

async function open(path: string, focus: boolean) {
  const setFocus = vi.fn();
  const slots: ShellSlots = {
    panelContextEl: null, inspectorEl: null, inspectorId: "ins", registerPanelContext: () => () => {}, registerInspector: () => () => {},
    inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus, setFocus,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={`${APP}/story`} element={<StoryPage />} />
              <Route path={`${APP}/story/:pageId`} element={<StoryPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { host, setFocus };
}

const showPanels = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show panels"));

describe("the way out of focus mode on a Story screen with no page to show", () => {
  it("offers Show panels on a page that isn't in the Story, and it brings the panels back", async () => {
    const { host, setFocus } = await open(`${APP}/story/missing`, true);
    expect(host.textContent).toContain("This page isn’t in the Story");
    const button = showPanels(host);
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(setFocus).toHaveBeenCalledWith(false);
  });

  it("offers Show panels on a Story with no pages", async () => {
    story.pages = 0;
    const { host } = await open(`${APP}/story`, true);
    expect(host.textContent).toContain("No Story pages yet");
    expect(showPanels(host)).toBeDefined();
  });

  it("lets F and Esc bring the panels back there too", async () => {
    for (const key of ["Escape", "f"]) {
      const { setFocus } = await open(`${APP}/story/missing`, true);
      act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      expect(setFocus).toHaveBeenCalledWith(false);
      unmount?.();
      unmount = null;
      document.body.innerHTML = "";
    }
  });

  it("offers Show panels when the Story couldn't be loaded", async () => {
    story.fail = true;
    const { host } = await open(`${APP}/story/overview`, true);
    expect(host.textContent).toContain("The Story couldn’t be loaded");
    expect(showPanels(host)).toBeDefined();
  });

  it("offers no focus mode there when it is off", async () => {
    const { host } = await open(`${APP}/story/missing`, false);
    expect(host.textContent).toContain("This page isn’t in the Story");
    expect(host.querySelector(".story-focus-button")).toBeNull();
  });
});
