import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Sources list narrowed by a link's ?query= says what the words were matched in: titles, tags
// and attachment names, as sources.list matches them, never what sources say.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const product = { name: "Crewboard", path: "acme/core/crew", your_role: "editor", counts: { sources: 2 } };
const source = {
  record_id: "01K8A2B3C4D5E6F7G8H9J0K1M2", title: "Crew lead interview — Example Co", date: "2026-09-10", tags: ["van checks"], uploaded_by: by,
  uploaded_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, archived_at: null, derived_status: "ready",
  text_chars: 1200, attachment_count: 1, etag: "e1", text_from: "interview.txt", summary: null,
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path.startsWith(`${BASE}/sources/facets`)) return { sources: 2, tags: [{ tag: "van checks", count: 1 }], tags_truncated: false, added_by: [{ account_id: "a1", display_name: "Riley Chen", count: 2 }] };
    const query = new URLSearchParams(path.split("?")[1]).get("query");
    return { records: query === "van" ? [source] : [], next_cursor: null };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite: false, canDelete: false }),
}));

const { EvidencePage } = await import("../src/routes/evidence.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

/** The shell's panel slot, which the Evidence screen fills with its filters. */
const panel = document.createElement("div");
const slots = {
  panelContextEl: panel, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

async function open(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host, panel);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots}>
          <MemoryRouter initialEntries={[`${APP}/evidence${search}`]}>
            <Routes>
              <Route path={`${APP}/evidence`} element={<EvidencePage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("sources narrowed by a link's words", () => {
  it("say the words are matched in titles, tags or attachment names", async () => {
    const host = await open("?query=van");
    expect([...host.querySelectorAll(".filters-in-use-chip")].map((c) => c.textContent)).toEqual(["“van” in titles, tags or attachment names"]);
    // The chips are a group named for what they are, which a screen reader announces.
    const group = host.querySelector(".filters-in-use")!;
    expect([group.getAttribute("role"), group.getAttribute("aria-label")]).toEqual(["group", "Filters in use"]);
    expect(host.textContent).not.toContain("Titles matching");
  });

  it("say so when nothing holds them, and where to find what sources say", async () => {
    const host = await open("?query=gate");
    expect(host.querySelector(".empty-title")?.textContent).toBe("No titles, tags or attachment names hold “gate”");
    expect(host.querySelector(".empty-text")?.textContent).toBe("Use Search to find what sources say.");
  });
});

describe("the Sources list's orders", () => {
  it("name the third date for what it covers, as a source's details do", async () => {
    const host = await open("?query=van&sort=updated");
    const sort = host.querySelector(".sources-sort")!.textContent!;
    expect(sort).toContain("Details updated");
    expect(sort).not.toContain("Date updated");
    // Ordered by it, a row's date says so.
    expect(host.querySelector(".source-row-date")?.getAttribute("title")).toMatch(/^Details updated .+ by Riley Chen$/);
  });
});

describe("the Evidence panel", () => {
  it("titles each group of filters with a heading that names the group", async () => {
    await open("");
    const groups = [...panel.querySelectorAll<HTMLElement>('[role="group"]')];
    expect(groups.map((g) => document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["Tags", "Archived"]);
    expect(groups.map((g) => document.getElementById(g.getAttribute("aria-labelledby")!)?.tagName)).toEqual(["H2", "H2"]);
  });
});
