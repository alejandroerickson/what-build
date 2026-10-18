import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// An editor archives a comment, saying why if they like, and restores it; archived comments are left
// out until asked for, then shown muted under the others with when and why. A comment's delete
// dialog offers Archive instead, as every other delete dialog does. On an archived source, which is
// read-only until restored, a comment offers nothing to change.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const riley = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };

interface Comment {
  annotation_id: string;
  record_id: string;
  note: string;
  tags: string[];
  etag: string;
  created_at: string;
  created_by: typeof riley;
  archived_at: string | null;
  archive_reason: string | null;
}
const comment = (id: string, note: string, archived: { at: string; reason: string | null } | null = null): Comment => ({
  annotation_id: id, record_id: ID, note, tags: [], etag: `${id}-1`, created_at: "2026-10-01T09:00:00.000Z", created_by: riley,
  archived_at: archived?.at ?? null, archive_reason: archived?.reason ?? null,
});

/** What the server holds, newest comment first, whether the source is archived, and what was asked of it. */
const server: { comments: Comment[]; archivedAt: string | null; patches: { path: string; body: Record<string, unknown> }[] } = { comments: [], archivedAt: null, patches: [] };
const who = { canWrite: true, canDelete: false };

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      const live = server.comments.filter((c) => !c.archived_at);
      if (path === `${BASE}/sources/${ID}?detail=full`)
        return {
          record_id: ID, title: "Crew lead interview — Example Co", date: null, tags: [], uploaded_by: riley, uploaded_at: "2026-10-01T09:00:00.000Z",
          updated_at: "2026-10-01T09:00:00.000Z", updated_by: riley, archived_at: server.archivedAt, derived_status: "awaiting_file", text_chars: 0, attachment_count: 0,
          etag: "source-etag", duration_ms: null, status_detail: null, warnings: [], annotation_count: live.length, pending_upload_path: null, attachments: [],
          annotations: live, text: null, agent_notes: [],
        };
      if (method === "GET" && path.startsWith(`${BASE}/sources/${ID}/annotations?`)) {
        expect(new URLSearchParams(path.split("?")[1]).get("include_archived")).toBe("true");
        return { items: server.comments, next_cursor: null };
      }
      if (method === "PATCH" && path.startsWith(`${BASE}/annotations/`)) {
        server.patches.push({ path, body: body! });
        const c = server.comments.find((x) => path.endsWith(`/${x.annotation_id}`))!;
        if (body!["expected_etag"] !== c.etag) throw new real.ApiError(409, "stale_etag", "This comment changed since you read it.");
        c.archived_at = body!["archived"] ? new Date().toISOString() : null;
        c.archive_reason = body!["archived"] ? ((body!["archive_reason"] as string | undefined) ?? null) : null;
        c.etag = `${c.annotation_id}-${Number(c.etag.split("-").at(-1)) + 1}`;
        return { ...c };
      }
      return { sources: 0, tags: [], added_by: [] };
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, ...who }),
}));

const { SourceDetailPage } = await import("../src/routes/source-detail.tsx");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  server.comments = [];
  server.archivedAt = null;
  server.patches = [];
  Object.assign(who, { canWrite: true, canDelete: false });
});

function Where() {
  const loc = useLocation();
  return <output className="where">{loc.search}</output>;
}

async function open(search = "?view=comments") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`${APP}/evidence/${ID}${search}`]}>
          <Routes>
            <Route
              path={`${APP}/evidence/:recordId`}
              element={
                <>
                  <SourceDetailPage />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

function button(label: string): HTMLButtonElement {
  const all = [...document.querySelectorAll("button")];
  const b = all.find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`No button “${label}”: ${all.map((x) => x.textContent?.trim()).join(" | ")}`);
  return b;
}

/** A command in the open menu, by its words (without the faint note beside them). */
function item(label: string): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
  const m = all.find((x) => x.querySelector(".menu-text")?.textContent?.trim() === label);
  if (!m) throw new Error(`No menu item “${label}”`);
  return m;
}

/** The menu of the comment holding these words. */
async function menuOf(words: string): Promise<string[]> {
  const article = [...document.querySelectorAll("article.comment")].find((a) => a.textContent?.includes(words));
  if (!article) throw new Error(`No comment saying “${words}”`);
  const trigger = article.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (!trigger) return [];
  expect(trigger.getAttribute("aria-label")).toMatch(/^Actions for Riley Chen’s comment from /);
  await act(async () => trigger.click());
  return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent?.trim() ?? "");
}

const comments = (host: HTMLElement) => [...host.querySelectorAll("article.comment")].map((a) => ({ text: a.querySelector(".comment-text")?.textContent?.trim(), archived: a.classList.contains("is-archived") }));

function type(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("archiving a comment in the web app", () => {
  it("lets an editor archive a comment with a reason, show it among the archived ones, and restore it", async () => {
    server.comments = [comment("c2", "Gate codes again."), comment("c1", "Crews plan by the day.")];
    const host = await open();
    expect(comments(host)).toEqual([{ text: "Gate codes again.", archived: false }, { text: "Crews plan by the day.", archived: false }]);
    // An editor archives; deleting is an admin's.
    expect(await menuOf("Gate codes again.")).toEqual(["Archive…Reversible"]);
    await act(async () => item("Archive…").click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.querySelector(".dialog-title")?.textContent).toBe("Archive this comment");
    type(dialog.querySelector("textarea")!, "Said again in the summary.");
    await act(async () => button("Archive").click());
    await settle();
    expect(server.patches[0]).toEqual({ path: `${BASE}/annotations/c2`, body: { expected_etag: "c2-1", archived: true, archive_reason: "Said again in the summary." } });
    expect(document.querySelector("dialog[open]")).toBeNull();

    // Out of the comments, until asked for.
    expect(comments(host)).toEqual([{ text: "Crews plan by the day.", archived: false }]);
    const show = button("Show 1 archived comment");
    expect(show.getAttribute("aria-expanded")).toBe("false");
    await act(async () => show.click());
    await settle();
    expect(host.querySelector(".where")?.textContent).toBe("?view=comments&include_archived=1");
    expect(comments(host)).toEqual([{ text: "Crews plan by the day.", archived: false }, { text: "Gate codes again.", archived: true }]);
    const archived = host.querySelector("article.comment.is-archived")!;
    expect(archived.textContent).toContain("Archived");
    expect(archived.querySelector(".comment-archived")?.textContent).toBe("Archived just now: Said again in the summary.");
    expect(button("Hide archived comments").getAttribute("aria-expanded")).toBe("true");

    expect(await menuOf("Gate codes again.")).toEqual(["Restore"]);
    await act(async () => item("Restore").click());
    await settle();
    expect(server.patches[1]).toEqual({ path: `${BASE}/annotations/c2`, body: { expected_etag: "c2-2", archived: false } });
    expect(comments(host)).toEqual([{ text: "Gate codes again.", archived: false }, { text: "Crews plan by the day.", archived: false }]);
    expect(host.textContent).not.toContain("archived comment");
  });

  it("archives without a reason when none is given, and says only when", async () => {
    server.comments = [comment("c1", "Crews plan by the day.")];
    const host = await open("?view=comments&include_archived=1");
    await menuOf("Crews plan by the day.");
    await act(async () => item("Archive…").click());
    await act(async () => button("Archive").click());
    await settle();
    expect(server.patches[0]!.body).toEqual({ expected_etag: "c1-1", archived: true });
    // Every comment is archived: the list says so rather than that there are none.
    expect(host.textContent).toContain("No current comments");
    expect(host.querySelector(".comment-archived")?.textContent).toBe("Archived just now.");
  });

  it("offers an admin Archive instead in a comment's delete dialog, beside Cancel", async () => {
    Object.assign(who, { canWrite: true, canDelete: true });
    server.comments = [comment("c1", "Crews plan by the day.")];
    const host = await open();
    expect(await menuOf("Crews plan by the day.")).toEqual(["Archive…Reversible", "Delete permanently…"]);
    await act(async () => item("Delete permanently…").click());
    await settle();
    expect(document.querySelector("dialog[open] .dialog-title")?.textContent).toBe("Delete this comment permanently?");
    expect([...document.querySelectorAll("dialog[open] .dialog-foot button")].map((b) => b.textContent?.trim())).toEqual(["Cancel", "Archive instead", "Delete permanently"]);
    await act(async () => button("Archive instead").click());
    await settle();
    expect(server.patches[0]!.body).toEqual({ expected_etag: "c1-1", archived: true });
    expect(comments(host)).toEqual([]);
    expect(button("Show 1 archived comment")).toBeTruthy();
  });

  it("gives a viewer the archived comments to read, and nothing to change", async () => {
    Object.assign(who, { canWrite: false, canDelete: false });
    server.comments = [comment("c2", "Gate codes again.", { at: "2026-10-02T09:00:00.000Z", reason: "Said again in the summary." }), comment("c1", "Crews plan by the day.")];
    const host = await open();
    expect(await menuOf("Crews plan by the day.")).toEqual([]);
    await act(async () => button("Show 1 archived comment").click());
    await settle();
    expect(comments(host)).toEqual([{ text: "Crews plan by the day.", archived: false }, { text: "Gate codes again.", archived: true }]);
    expect(await menuOf("Gate codes again.")).toEqual([]);
  });

  it("offers nothing to change on an archived source's comments, an admin's delete included, which the server refuses until it is restored", async () => {
    Object.assign(who, { canWrite: true, canDelete: true });
    server.archivedAt = "2026-10-03T09:00:00.000Z";
    server.comments = [comment("c2", "Gate codes again.", { at: "2026-10-02T09:00:00.000Z", reason: null }), comment("c1", "Crews plan by the day.")];
    const host = await open("?view=comments&include_archived=1");
    expect(comments(host)).toEqual([{ text: "Crews plan by the day.", archived: false }, { text: "Gate codes again.", archived: true }]);
    expect(await menuOf("Crews plan by the day.")).toEqual([]);
    expect(await menuOf("Gate codes again.")).toEqual([]);
    expect([...host.querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("Comment");
  });
});
