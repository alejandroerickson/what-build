import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A source's details say what their third date covers: its details (title, date captured, tags) or
// its archiving, which its text, summary, notes and comments leave alone.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const record = { updated_at: "2026-10-01T09:00:00.000Z" };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === `${BASE}/sources/${ID}?detail=full`)
      return {
        record_id: ID, title: "Crew lead interview — Example Co", date: null, tags: [], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z",
        updated_at: record.updated_at, updated_by: by, archived_at: null, derived_status: "ready", text_chars: 20, attachment_count: 0, etag: "e1",
        duration_ms: null, status_detail: null, warnings: [], annotation_count: 0, pending_upload_path: null, attachments: [], annotations: [], agent_notes: [],
        // Written since it was added: the text has a date of its own.
        text: { chars: 20, etag: "t2", updated_at: "2026-10-05T09:00:00.000Z", updated_by: by, taken_from: null },
      };
    return { sources: 0, tags: [], added_by: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, canWrite: true, canDelete: false }),
}));

const { SourceDetailPage } = await import("../src/routes/source-detail.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

/** The shell's inspector, which a source page fills with its details. */
const inspector = document.createElement("aside");
const slots = {
  panelContextEl: null, inspectorEl: inspector, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: true, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function details() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host, inspector);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots}>
          <MemoryRouter initialEntries={[`${APP}/evidence/${ID}`]}>
            <Routes>
              <Route path={`${APP}/evidence/:recordId`} element={<SourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  const value = (label: string) => {
    const dt = [...inspector.querySelectorAll("dt")].find((d) => d.textContent === label);
    return dt?.nextElementSibling?.textContent ?? null;
  };
  return { labels: [...inspector.querySelectorAll("dt")].map((d) => d.textContent), value };
}

describe("a source's details", () => {
  it("name their third date for what it covers, and say when the details have not changed, whatever its text did", async () => {
    record.updated_at = "2026-10-01T09:00:00.000Z";
    const d = await details();
    expect(d.labels).toEqual(["Tags", "Date captured", "Date added", "Details updated"]);
    expect(d.value("Details updated")).toBe("Not changed since it was added");
  });

  it("say when and by whom the details last changed", async () => {
    record.updated_at = "2026-10-03T09:00:00.000Z";
    const d = await details();
    expect(d.value("Details updated")).toContain("by Riley Chen");
  });
});
