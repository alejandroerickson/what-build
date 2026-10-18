import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hitHref, type FindHit } from "../src/lib/find.tsx";

// Each place the Search screen lists in a source opens the source's text at that place's own match
// (`?at=`, where its piece of the text starts), not at the first; a link without it starts at the first, as before.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const TEXT = "**Interviewer:** What goes wrong?\n\n**Jo:** Gate codes. 😀 The gate code in the text is old.\n\n**Jo:** We ring the office for the gate.\n";

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === `${BASE}/sources/${ID}?detail=full`)
      return {
        record_id: ID, title: "Dispatcher interview — Example Co", date: null, tags: [], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z",
        updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, archived_at: null, derived_status: "ready", text_chars: [...TEXT].length, attachment_count: 0,
        etag: "source-etag", duration_ms: null, status_detail: null, warnings: [], annotation_count: 0, pending_upload_path: null, attachments: [], annotations: [],
        text: { chars: [...TEXT].length, etag: "text-1", updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, taken_from: null }, agent_notes: [],
      };
    return { sources: 0, tags: [], added_by: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, canWrite: true, canDelete: false }),
}));

const { SourceDetailPage } = await import("../src/routes/source-detail.tsx");
const { findPattern, matchFrom } = await import("../src/routes/source-text.tsx");

beforeAll(() => {
  Element.prototype.scrollIntoView = function () {};
  vi.stubGlobal("fetch", async () => new Response(TEXT, { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8", ETag: '"text-1"' } }));
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

/** Where, in code points as search counts them, the nth "gate" starts (from 0). */
const nth = (n: number) => [...TEXT.matchAll(/gate/gi)].map((m) => [...TEXT.slice(0, m.index)].length)[n]!;

async function open(search: string) {
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
            <Route path={`${APP}/evidence/:recordId`} element={<SourceDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

const current = (host: HTMLElement) => {
  const marks = [...host.querySelectorAll("mark.text-find")];
  return { count: host.querySelector(".text-find-count")?.textContent, at: marks.findIndex((m) => m.classList.contains("text-find-current")), marks: marks.length };
};

describe("a search hit in a source's text", () => {
  it("links to its own place", () => {
    const hit = (char_start: number): FindHit => ({ field: "text", annotation_id: null, char_start, text: "gate", marks: [[0, 4]] });
    expect(hitHref(APP, ID, hit(57), "gate")).toBe(`${APP}/evidence/${ID}?view=text&find=gate&at=57`);
    // Elsewhere than the text, there is no find to start.
    expect(hitHref(APP, ID, { ...hit(3), field: "comment", annotation_id: "c1" }, "gate")).toBe(`${APP}/evidence/${ID}?view=comments`);
  });

  it("starts at the first match from where its piece of the text starts, counting as search does, in code points", () => {
    const pattern = findPattern("gate")!;
    expect(matchFrom(TEXT, pattern, 0)).toBe(0);
    expect(matchFrom(TEXT, pattern, nth(1))).toBe(1);
    // A piece starts before its first match, however near the one before it.
    expect(matchFrom(TEXT, pattern, nth(1) + 5)).toBe(2);
    expect(matchFrom(TEXT, pattern, nth(2))).toBe(2);
    // Past the last match (a text changed since), the last.
    expect(matchFrom(TEXT, pattern, [...TEXT].length)).toBe(2);
  });

  it("opens the text at that match, and at the first without a place, as older links do", async () => {
    let host = await open(`?view=text&find=gate&at=${nth(2)}`);
    expect(current(host)).toEqual({ count: "3 of 3", at: 2, marks: 3 });
    unmount?.();
    host = await open("?view=text&find=gate");
    expect(current(host)).toEqual({ count: "1 of 3", at: 0, marks: 3 });
  });
});
