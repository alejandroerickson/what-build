import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hitHref, type FindHit } from "../src/lib/find.tsx";

// Each place the Search screen and the palette show of a source opens the source's text at the match
// that place's line shows (`?at=`, where it starts), not at the first of its piece; a link without it
// starts at the first, as before.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const TEXT = "**Interviewer:** What goes wrong?\n\n**Jo:** Gate codes. 😀 The gate code in the text is old.\n\n**Jo:** We ring the office for the gate.\n";
/** What the text answers with: `TEXT`, or another a test sets. */
let served = TEXT;

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
  vi.stubGlobal("fetch", async () => new Response(served, { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8", ETag: '"text-1"' } }));
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  served = TEXT;
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

/** The cell or paragraph that holds the match the find stands on. */
const standsIn = (host: HTMLElement) => host.querySelector("mark.text-find-current")?.closest("td, th, p")?.textContent;

describe("a search hit in a source's text", () => {
  it("links to its own place", () => {
    const hit = (char_start: number): FindHit => ({ field: "text", annotation_id: null, char_start, match_start: char_start + 12, text: "gate", marks: [[0, 4]] });
    // Where the match starts, not where its piece does.
    expect(hitHref(APP, ID, hit(57), "gate")).toBe(`${APP}/evidence/${ID}?view=text&find=gate&at=69`);
    // Elsewhere than the text, there is no find to start.
    expect(hitHref(APP, ID, { ...hit(3), field: "comment", annotation_id: "c1" }, "gate")).toBe(`${APP}/evidence/${ID}?view=comments`);
  });

  it("starts at the first match from that place, counting as search does, in code points", () => {
    const pattern = findPattern("gate")!;
    expect(matchFrom(TEXT, pattern, 0)).toBe(0);
    expect(matchFrom(TEXT, pattern, nth(1))).toBe(1);
    // A place past a match starts at the next, however near the one before it.
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

  it("counts only the matches the text draws, so a word in a link's address or an image's moves nothing", async () => {
    served = "See [the guide](https://example.com/gate/rules) and ![a sign](gate.png) first.\n\nThe gate at the depot is old. The gate at the yard is new.\n";
    const pattern = findPattern("gate")!;
    expect(matchFrom(served, pattern, served.indexOf("The gate at the yard"))).toBe(1);
    const host = await open(`?view=text&find=gate&at=${served.indexOf("gate at the yard")}`);
    expect(current(host)).toEqual({ count: "2 of 2", at: 1, marks: 2 });
  });

  it("stands on the row a line shows of a table, not on a column's heading in the same piece", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => `| crew ${i} | hedges |`).join("\n");
    served = `| crew | spare_mulcher |\n|---|---|\n${rows}\n| crew 7 | mulcher only |\n| crew 8 | mulcher only |\n`;
    const host = await open(`?view=text&find=mulcher&at=${served.indexOf("mulcher only")}`);
    expect(current(host)).toEqual({ count: "2 of 3", at: 1, marks: 3 });
    expect(standsIn(host)).toBe("mulcher only");
  });

  it("stands on the sentence a line shows, not on an earlier word that only starts like a word searched", async () => {
    served = "Nothing is settled, and the notes are thin.\n\nThe lead said she would not trust a rota that changes daily.\n";
    const host = await open(`?view=text&find=${encodeURIComponent("not trust rota")}&at=${served.indexOf("not trust")}`);
    expect(current(host)).toEqual({ count: "3 of 5", at: 2, marks: 5 });
    expect(standsIn(host)).toContain("she would not trust");
  });

  it("marks another form of a word whose ending doubles a letter, as search reads it, so a line showing that form is arrived at", async () => {
    served = "Planning comes first.\n\nThe crew keeps its plans on the board.\n";
    const host = await open(`?view=text&find=planning&at=${served.indexOf("plans")}`);
    expect(current(host)).toEqual({ count: "2 of 2", at: 1, marks: 2 });
    expect(host.querySelector("mark.text-find-current")?.textContent).toBe("plans");
  });

  it("stands on the last match when a text has changed and none follows the place", async () => {
    const host = await open(`?view=text&find=gate&at=${[...TEXT].length + 40}`);
    expect(current(host)).toEqual({ count: "3 of 3", at: 2, marks: 3 });
  });
});
