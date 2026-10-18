import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Editing a source's summary, notes or text names the etag of what the editor opened. When someone
// changed it meanwhile, the save is refused (409 stale_etag): the editor keeps the person's words,
// shows theirs, and saving again names their etag, so nothing is overwritten unseen.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
const calls: Call[] = [];
/** What the server holds: the summary (null when there is none) and the text, with their etags. */
const server: { summary: { content: string; etag: string } | null; text: { content: string; etag: string } | null; puts: ((c: Call) => unknown)[] } = { summary: null, text: null, puts: [] };

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      calls.push({ method, path, body });
      if (method === "PUT") {
        const next = server.puts.shift();
        if (!next) throw new Error(`unexpected ${method} ${path}`);
        return next({ method, path, body });
      }
      if (path === `${BASE}/sources/${ID}?detail=full`)
        return {
          record_id: ID, title: "Crew lead interview — Example Co", date: null, tags: [], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z",
          updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, archived_at: null, derived_status: server.text ? "ready" : "awaiting_file",
          text_chars: server.text?.content.length ?? 0, attachment_count: 0, etag: "source-etag", duration_ms: null, status_detail: null, warnings: [],
          annotation_count: 0, pending_upload_path: null, attachments: [], annotations: [],
          text: server.text ? { chars: server.text.content.length, etag: server.text.etag, updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, taken_from: null } : null,
          agent_notes: server.summary ? [{ kind: "summary", etag: server.summary.etag, updated_at: "2026-10-01T09:00:00.000Z", updated_by: by }] : [],
        };
      if (path === `${BASE}/sources/${ID}/agent-notes/summary`) {
        if (!server.summary) throw new real.ApiError(404, "not_found", "No summary has been written for this source.");
        return { note_kind: "summary", content: server.summary.content, etag: server.summary.etag, updated_at: "2026-10-01T09:00:00.000Z", updated_by: by };
      }
      return { sources: 0, tags: [], added_by: [] };
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: "/t/acme/core/crew", canWrite: true, canDelete: false }),
}));

const { ApiError } = await import("../src/lib/api.ts");
const { SourceDetailPage } = await import("../src/routes/source-detail.tsx");

const stale = (current: string | null) => () => {
  throw new ApiError(409, "stale_etag", "This changed since you read it.", { current_etag: current });
};

beforeAll(() => {
  // jsdom draws no modal layer; a dialog that opens is enough here.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  // As browsers that answer it with a promise do: an effect must not hand that to React as a cleanup.
  Element.prototype.scrollIntoView = function () {
    return Promise.resolve();
  };
  // The whole text, read with the etag it has now.
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push({ method: "GET", path: url, body: undefined });
    if (!server.text) return new Response("", { status: 404 });
    return new Response(server.text.content, { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8", ETag: `"${server.text.etag}"` } });
  });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  calls.length = 0;
  server.summary = null;
  server.text = null;
  server.puts = [];
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
        <MemoryRouter initialEntries={[`/t/acme/core/crew/evidence/${ID}`]}>
          <Routes>
            <Route path="/t/acme/core/crew/evidence/:recordId" element={<SourceDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

function button(host: HTMLElement, label: string | RegExp): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find((x) => (typeof label === "string" ? x.textContent?.trim() === label : label.test(x.textContent ?? "")));
  if (!b) throw new Error(`No button “${label}”: ${[...host.querySelectorAll("button")].map((x) => x.textContent?.trim()).join(" | ")}`);
  return b;
}

/** The text box with this label, by the label's text. */
function box(host: HTMLElement, label: string): HTMLTextAreaElement {
  const l = [...host.querySelectorAll("label")].find((x) => x.textContent?.trim().startsWith(label));
  const el = l ? (document.getElementById(l.htmlFor) as HTMLTextAreaElement | null) : null;
  if (!el) throw new Error(`No box labelled “${label}”`);
  return el;
}

function type(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const puts = () => calls.filter((c) => c.method === "PUT");

describe("editing a source's summary", () => {
  it("names the etag it opened, and after someone else's change shows theirs and saves over it only when asked", async () => {
    server.summary = { content: "Crews plan by the day.", etag: "summary-1" };
    const host = await open();
    await act(async () => button(host, "Edit").click());
    await act(async () => type(box(host, "Summary"), "Crews plan by the job."));
    // Meanwhile someone rewrote it.
    server.summary = { content: "Crews plan by the week.", etag: "summary-2" };
    server.puts.push(stale("summary-2"));
    await act(async () => button(host, "Save").click());
    await settle();
    expect(puts()[0]).toMatchObject({ path: `${BASE}/sources/${ID}/agent-notes/summary`, body: { content: "Crews plan by the job.", expected_etag: "summary-1" } });
    expect(host.textContent).toContain("Someone changed the summary while you were editing");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Saving replaces theirs with yours");
    expect(box(host, "Their version").value).toBe("Crews plan by the week.");
    expect(box(host, "Their version").readOnly).toBe(true);
    // The page behind shows theirs, and reloading it left the person's words in the dialog.
    expect(host.querySelector(".source-summary")?.textContent).toContain("Crews plan by the week.");
    expect(box(host, "Summary").value).toBe("Crews plan by the job.");

    server.puts.push(() => ({ record_id: ID, note_kind: "summary", chars: 21, etag: "summary-3", updated_at: "2026-10-01T10:00:00.000Z" }));
    await act(async () => button(host, "Save mine over theirs").click());
    await settle();
    expect(puts()[1]).toMatchObject({ body: { content: "Crews plan by the job.", expected_etag: "summary-2" } });
    expect(host.textContent).not.toContain("Their version");
  });

  it("writes the first summary without an etag, and says so when someone removed it meanwhile", async () => {
    const host = await open();
    await act(async () => button(host, "Add a summary").click());
    await act(async () => type(box(host, "Summary"), "Gate codes go stale."));
    server.puts.push(() => ({ record_id: ID, note_kind: "summary", chars: 20, etag: "summary-1", updated_at: "2026-10-01T10:00:00.000Z" }));
    await act(async () => button(host, "Save").click());
    await settle();
    expect(puts()[0]!.body).toEqual({ content: "Gate codes go stale." });

    server.summary = { content: "Gate codes go stale.", etag: "summary-1" };
    unmount?.();
    const again = await open();
    await act(async () => button(again, "Edit").click());
    await act(async () => type(box(again, "Summary"), "Gate codes go stale twice a week."));
    server.summary = null;
    server.puts.push(stale(null));
    await act(async () => button(again, "Save").click());
    await settle();
    expect(again.textContent).toContain("Someone removed the summary while you were editing");
    expect(again.textContent).toContain("Saving puts it back.");
    server.puts.push(() => ({ record_id: ID, note_kind: "summary", chars: 33, etag: "summary-2", updated_at: "2026-10-01T10:00:00.000Z" }));
    await act(async () => button(again, "Save").click());
    await settle();
    // Nothing to match now: the write is a first one again.
    expect(puts().at(-1)!.body).toEqual({ content: "Gate codes go stale twice a week." });
  });
});

describe("editing a source's text", () => {
  it("names the etag of the text it opened, and after someone else's change shows theirs and saves over it only when asked", async () => {
    server.text = { content: "Crews leave at six.\n", etag: "text-1" };
    const host = await open();
    await act(async () => button(host, "Edit").click());
    await act(async () => type(box(host, "Text"), "Crews leave at half past six.\n"));
    server.text = { content: "Crews leave at seven.\n", etag: "text-2" };
    server.puts.push(stale("text-2"));
    await act(async () => button(host, "Save").click());
    await settle();
    expect(puts()[0]).toMatchObject({ path: `${BASE}/sources/${ID}/derived/text`, body: { content: "Crews leave at half past six.\n", expected_etag: "text-1" } });
    expect(host.textContent).toContain("Someone changed the text while you were editing");
    expect(box(host, "Their version").value).toBe("Crews leave at seven.\n");
    expect(box(host, "Text").value).toBe("Crews leave at half past six.\n");

    server.puts.push(() => ({ record_id: ID, chars: 30, etag: "text-3", updated_at: "2026-10-01T10:00:00.000Z", taken_from: null }));
    await act(async () => button(host, "Save mine over theirs").click());
    await settle();
    expect(puts()[1]).toMatchObject({ body: { content: "Crews leave at half past six.\n", expected_etag: "text-2" } });
  });
});
