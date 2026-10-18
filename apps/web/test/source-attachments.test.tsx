import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The line over a source's attachments says where the source's text comes from: one of them, or,
// once someone wrote or edited the text, none of them.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const read = { status: "ready", status_detail: null, chars: 120, duration_ms: null, parser: "text", derivation_id: "d1", read_at: "2026-10-01T09:00:00.000Z" };
const attachment = { path: "interview.txt", media_type: "text/plain", size: 120, file_version_id: "f1", versions: [], added_at: "2026-10-01T09:00:00.000Z", added_by: by, text: read, is_text_source: false };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === `${BASE}/sources/${ID}?detail=full`)
      return {
        record_id: ID, title: "Crew lead interview — Example Co", date: null, tags: [], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z",
        updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, archived_at: null, derived_status: "ready", text_chars: 30, attachment_count: 1,
        etag: "source-etag", duration_ms: null, status_detail: null, warnings: [], annotation_count: 0, pending_upload_path: null, attachments: [attachment],
        annotations: [], agent_notes: [],
        // Written by hand: it follows no attachment.
        text: { chars: 30, etag: "text-1", updated_at: "2026-10-02T09:00:00.000Z", updated_by: by, taken_from: null },
      };
    return { sources: 0, tags: [], added_by: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: "/t/acme/core/crew", canWrite: true, canDelete: false }),
}));

const { attachmentsNote } = await import("../src/routes/source-attachments.tsx");
const { SourceDetailPage } = await import("../src/routes/source-detail.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

const text = (taken_from: { path: string; file_version_id: string } | null) => ({ chars: 30, etag: "text-1", updated_at: "2026-10-02T09:00:00.000Z", updated_by: by as never, taken_from });

describe("the line over a source's attachments", () => {
  it("says the source's text is taken from one of them while it is", () => {
    expect(attachmentsNote({ text: text({ path: "interview.txt", file_version_id: "f1" }) })).toBe(
      "Each attachment’s text is read and kept with the source; the source’s text is taken from one of them. Attachments are never searched.",
    );
  });

  it("says the text was written here, following no attachment, once someone wrote or edited it", () => {
    expect(attachmentsNote({ text: text(null) })).toBe(
      "Each attachment’s text is read and kept with the source. The source’s text was written here and follows no attachment. Attachments are never searched.",
    );
  });

  it("says nothing of the source's text while it has none", () => {
    expect(attachmentsNote({ text: null })).toBe("Each attachment’s text is read and kept with the source. Attachments are never searched.");
  });

  it("is the one a source with a hand-written text shows", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = () => act(() => root.unmount());
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[`/t/acme/core/crew/evidence/${ID}?view=attachments`]}>
            <Routes>
              <Route path="/t/acme/core/crew/evidence/:recordId" element={<SourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.querySelector(".source-files-note")?.textContent).toContain("The source’s text was written here and follows no attachment.");
    expect(host.textContent).not.toContain("taken from one of them");
  });
});
