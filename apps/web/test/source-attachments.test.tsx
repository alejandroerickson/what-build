import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The line over a source's attachments says where the source's text comes from: one of them, or,
// once someone wrote or edited the text, none of them. Each row says who added the attachment, and
// through which agent, as Details does. An attachment whose reading was given up says so, and
// offers Read it again.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const read = { status: "ready", status_detail: null, chars: 120, duration_ms: null, parser: "text", derivation_id: "d1", read_at: "2026-10-01T09:00:00.000Z" };
const attachment = { path: "interview.txt", media_type: "text/plain", size: 120, file_version_id: "f1", versions: [], added_at: "2026-10-01T09:00:00.000Z", added_by: by, text: read, is_text_source: false };
/** The attachment's latest reading, which a test may change. */
let reading: Record<string, unknown> = read;
/** Who added the attachment, which a test may change. */
let addedBy: Record<string, unknown> = by;
/** The attachment's name and type, which a test may change. */
let file: Record<string, unknown> = {};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === `${BASE}/sources/${ID}?detail=full`)
      return {
        record_id: ID, title: "Crew lead interview — Example Co", date: null, tags: [], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z",
        updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, archived_at: null, derived_status: "ready", text_chars: 30, attachment_count: 1,
        etag: "source-etag", duration_ms: null, status_detail: null, warnings: [], annotation_count: 0, pending_upload_path: null, attachments: [{ ...attachment, ...file, text: reading, added_by: addedBy }],
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

const { api } = await import("../src/lib/api.ts");
const { attachmentsNote } = await import("../src/routes/source-attachments.tsx");
const { SourceDetailPage } = await import("../src/routes/source-detail.tsx");

beforeAll(() => {
  // jsdom draws no modal layer; a dialog that opens is enough here.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  // A menu asks whether motion is reduced; jsdom has no media queries.
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  reading = read;
  addedBy = by;
  file = {};
  vi.mocked(api).mockClear();
  vi.restoreAllMocks();
});

/** The source's Attachments, as its page shows them. */
async function openAttachments() {
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
  return host;
}

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
    const host = await openAttachments();
    expect(host.querySelector(".source-files-note")?.textContent).toContain("The source’s text was written here and follows no attachment.");
    expect(host.textContent).not.toContain("taken from one of them");
  });
});

describe("an attachment whose reading was given up", () => {
  it("says it couldn't be read, and why, and offers Read it again, which asks for it to be read again", async () => {
    const detail =
      'this file could not be read: reading it failed 5 times, so it was given up; the file is stored, and reading it again may help (Read it again in the web app, or derived_write(action="rederive"))';
    reading = { status: "failed", status_detail: detail, chars: 0, duration_ms: null, parser: "none", derivation_id: "d2", read_at: "2026-10-02T09:00:00.000Z" };
    const host = await openAttachments();
    const row = host.querySelector(".source-file")!;
    expect(row.textContent).toContain("Couldn’t be read");
    expect(row.querySelector(".source-file-detail")?.textContent).toBe(detail);
    await act(async () => row.querySelector<HTMLButtonElement>('button[aria-label="Actions for interview.txt"]')!.click());
    // A command with a line under it holds its words in a line of their own.
    const again = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((m) => m.querySelector(".menu-text-line")?.textContent?.trim() === "Read it again");
    expect(again).toBeTruthy();
    await act(async () => again!.click());
    for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(vi.mocked(api).mock.calls).toContainEqual(["POST", `${BASE}/sources/${ID}/rederive`, { path: "interview.txt" }]);
  });
});

describe("an attachment's row", () => {
  /** The facts under the row's name: its type, size, and who added it when. */
  const facts = async () => (await openAttachments()).querySelector(".source-file-sub")?.textContent ?? "";

  it("says which agent added it, when an agent did, as Details does", async () => {
    addedBy = { ...by, surface: "mcp", client: "claude-code" };
    expect(await facts()).toMatch(/ · added .+ by Riley Chen via claude-code$/);
  });

  it("says only who added it on the web", async () => {
    expect(await facts()).toMatch(/ · added .+ by Riley Chen$/);
  });
});

describe("an uploaded HTML page's preview", () => {
  it("frames the page from its own route, in a sandbox that runs nothing, and never fetches its bytes into the app's page", async () => {
    file = { path: "brief.html", media_type: "text/html" };
    const fetched = vi.spyOn(globalThis, "fetch");
    const host = await openAttachments();
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Show brief.html"]')!.click());
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="brief.html"]')!;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("src")).toBe(`${BASE}/sources/${ID}/attachment/view?path=brief.html`);
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(fetched).not.toHaveBeenCalled();
  });
});
