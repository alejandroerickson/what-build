import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The list of sources and the preview beside it: what a row shows, a click that opens the preview,
// the keys that move through sources and pages, and that moving spends no call.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
Element.prototype.scrollIntoView = () => {};

const BASE = "/api/v1/p/acme/crew";
const APP = "/t/acme/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
const product = { name: "Crewboard", path: "acme/crew", your_role: "editor", counts: { sources: 3 } };
const base = {
  date: "2026-09-10", tags: ["van checks"], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", updated_by: by,
  archived_at: null, derived_status: "ready", text_chars: 1200, etag: "e1",
};
const picture = { made_from: "image", thumb_url: "/api/v1/pictures/thumb", preview_url: "/api/v1/pictures/preview", width: 1600, height: 1200, pages: null, card: null };
const image = { path: "whiteboard.jpg", media_type: "image/jpeg", size: 2_000_000, file_version_id: "v1", text: { status: "unsupported", chars: 0, duration_ms: null }, picture };
const notes = { path: "notes.docx", media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 40_000, file_version_id: "v2", text: { status: "ready", chars: 900, duration_ms: null }, picture: null };
const recording = { path: "crew-call.m4a", media_type: "audio/mp4", size: 2_400_000, file_version_id: "v3", text: { status: "needs_transcript", chars: 0, duration_ms: 147_000 }, picture: null };
const unknown = { path: "rota.fig", media_type: "application/octet-stream", size: 900, file_version_id: "v4", text: { status: "unsupported", chars: 0, duration_ms: null }, picture: null };
const sources = [
  { ...base, record_id: "S1", title: "Friday workshop", attachment_count: 2, text_from: "notes.docx", summary: "Crews plan on **Friday**.", first_lines: "# Notes\n\nCrews plan on Friday.", attachments: [image, notes] },
  { ...base, record_id: "S2", title: "Crew call", derived_status: "needs_transcript", attachment_count: 1, text_from: null, summary: null, first_lines: null, attachments: [recording] },
  { ...base, record_id: "S3", title: "Rota working file", derived_status: "unsupported", attachment_count: 1, text_from: null, summary: null, first_lines: null, attachments: [unknown] },
];

const calls: string[] = [];
const who = { canGivePicture: false };
// Set, the list comes in two pages: the three sources, then these, once `held` (if set) resolves.
const later: { records: typeof sources | null; held: Promise<void> | null } = { records: null, held: null };
const sent: unknown[] = [];
vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string, body?: unknown) => {
    calls.push(path);
    if (path.endsWith("/first-picture")) {
      sent.push(body);
      return { made: true };
    }
    if (path.startsWith(`${BASE}/sources/facets`)) return { sources: 3, tags: [], tags_truncated: false, added_by: [] };
    if (path.includes("/derived/text")) return { text: "# Notes\n\nThe whole of what was read.", truncated: false, total_chars: 30 };
    if (later.records && path.includes("cursor=c2")) {
      if (later.held) await later.held;
      return { records: later.records, next_cursor: null };
    }
    if (later.records) return { records: sources, next_cursor: "c2" };
    // Filtered by a tag no source has, the list is empty; by any other tag, it leaves out the third source.
    if (path.includes("tags=none")) return { records: [], next_cursor: null };
    if (path.includes("tags=")) return { records: sources.slice(0, 2), next_cursor: null };
    return { records: sources, next_cursor: null };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite: false, canDelete: false, canGivePicture: who.canGivePicture }),
}));
vi.mock("../src/lib/html-picture.ts", async (original) => ({ ...(await original<typeof import("../src/lib/html-picture.ts")>()), pictureOfHtml: vi.fn(async () => "drawn") }));

const { EvidencePage } = await import("../src/routes/evidence.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

let unmount: (() => void) | null = null;
let here = "";
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  calls.length = 0;
  sent.length = 0;
  who.canGivePicture = false;
  later.records = null;
  later.held = null;
});

const panel = document.createElement("div");
const slots = {
  panelContextEl: panel, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {}, isPhone: false,
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

function Where() {
  const l = useLocation();
  here = `${l.pathname}${l.search}`;
  return null;
}

async function open(search = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host, panel);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots as never}>
          <MemoryRouter initialEntries={[`${APP}/evidence${search}`]}>
            <Where />
            <Routes>
              <Route path={`${APP}/evidence`} element={<EvidencePage />} />
              <Route path={`${APP}/evidence/:id`} element={<p id="source-page">The source's page</p>} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    await new Promise((r) => setTimeout(r, 0));
  });
const rowLink = (id: string) => document.querySelector<HTMLAnchorElement>(`[data-source="${id}"] .source-row-link`)!;
const click = (el: Element, init: MouseEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
    await new Promise((r) => setTimeout(r, 0));
  });
const preview = () => document.querySelector(".sources-preview");

describe("the list alone", () => {
  it("opens with no preview, and has no summary toggle", async () => {
    await open();
    expect(preview()).toBeNull();
    expect(document.querySelectorAll(".source-row")).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/Show summaries/);
    expect(document.querySelector(".source-row-toggle")).toBeNull();
  });

  it("says nothing of a recording's transcript or a format not read, and counts its attachments instead", async () => {
    await open();
    expect(document.body.textContent).not.toMatch(/Needs transcript|Not read as text/);
    expect(document.querySelector('[data-source="S2"] .source-row-attachments')).not.toBeNull();
  });

  it("shows a source's picture, or its icon, in its row", async () => {
    await open();
    expect(document.querySelector<HTMLImageElement>('[data-source="S1"] .face img')!.getAttribute("src")).toBe("/api/v1/pictures/thumb");
    expect(document.querySelector('[data-source="S2"] .face-icon')).not.toBeNull();
    expect(document.querySelector('[data-source="S2"] .face-mark')!.textContent).toContain("2:27");
    expect(document.querySelector('[data-source="S3"] .face-icon')!.textContent).toContain("FIG");
  });

  it("asks the list for what the preview shows, once", async () => {
    await open();
    const list = calls.filter((c) => c.startsWith(`${BASE}/sources?`));
    expect(list).toHaveLength(1);
    expect(list[0]).toContain("include_preview=true");
    expect(list[0]).toContain("include_summary=true");
  });
});

describe("the preview", () => {
  it("opens on a click, on the summary, with the row selected and the address saying so", async () => {
    await open();
    await click(rowLink("S1"));
    expect(preview()).not.toBeNull();
    expect(preview()!.querySelector("strong")!.textContent).toBe("Friday");
    expect(here).toContain("source=S1");
    expect(document.querySelector('[data-source="S1"]')!.getAttribute("aria-current")).toBe("true");
    expect(document.getElementById("source-page")).toBeNull();
  });

  it("leaves a click that opens a new tab to the link", async () => {
    await open();
    await click(rowLink("S1"), { metaKey: true });
    expect(preview()).toBeNull();
    expect(rowLink("S1").getAttribute("href")).toBe(`${APP}/evidence/S1`);
  });

  it("opens from the address, on the page it names", async () => {
    await open("?source=S1&page=2");
    expect(preview()!.querySelector<HTMLImageElement>(".preview-stage img")!.getAttribute("src")).toBe("/api/v1/pictures/preview");
  });

  it("opens on the attachment when a source has no summary, with no pager for one page", async () => {
    await open("?source=S3");
    expect(preview()!.querySelector(".preview-none")!.textContent).toContain("rota.fig");
    expect(preview()!.querySelector(".preview-pager")).toBeNull();
    expect(preview()!.querySelector(".preview-none a")!.getAttribute("href")).toContain("download=1");
  });

  it("fetches nothing of a recording until someone presses play", async () => {
    await open("?source=S2");
    expect(preview()!.querySelector("audio")!.getAttribute("preload")).toBe("none");
  });

  it("says a recording can't play here when its browser can't play it", async () => {
    await open("?source=S2");
    await act(async () => {
      preview()!.querySelector("audio")!.dispatchEvent(new Event("error"));
    });
    expect(preview()!.textContent).toMatch(/can’t be played here/);
    expect(preview()!.querySelector("a[href*='download=1']")).not.toBeNull();
  });
});

describe("an address naming a source the list doesn't hold", () => {
  const gone = () => document.querySelector(".sources-gone");
  const more = () => Array.from({ length: 4 }, (_, i) => ({ ...sources[1]!, record_id: `L${i}`, title: `Later call ${i}` }));

  it("loads on to the end, then says so above the rows, where it is seen on arrival", async () => {
    later.records = more();
    await open("?source=ELSEWHERE");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls.some((c) => c.includes("cursor=c2"))).toBe(true);
    expect(gone()?.textContent).toContain("isn’t in this list");
    expect(gone()!.getAttribute("role")).toBe("status");
    expect(preview()).toBeNull();
    // Before every row in the document, so a long list never pushes it out of sight.
    const firstRow = document.querySelector('[data-source="S1"]')!;
    expect(gone()!.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says nothing while it is still loading on towards the source", async () => {
    later.records = more();
    let release = () => {};
    later.held = new Promise<void>((r) => (release = r));
    await open("?source=ELSEWHERE");
    // The second page is asked for, and held: the list is still loading on.
    await vi.waitFor(() => expect(calls.some((c) => c.includes("cursor=c2"))).toBe(true));
    expect(gone()).toBeNull();
    await act(async () => {
      release();
    });
    await vi.waitFor(() => expect(gone()?.textContent).toContain("isn’t in this list"));
  });

  it("says nothing when the source is found further down", async () => {
    later.records = more();
    await open("?source=L2");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(gone()).toBeNull();
    expect(preview()).not.toBeNull();
  });

  it("stops saying so once a row is chosen, or on Esc", async () => {
    await open("?source=ELSEWHERE");
    expect(gone()).not.toBeNull();
    await click(rowLink("S2"));
    expect(gone()).toBeNull();
    expect(here).toContain("source=S2");
    unmount?.();
    document.body.innerHTML = "";
    await open("?source=ELSEWHERE");
    await press("Escape");
    expect(here).not.toContain("source=");
    expect(gone()).toBeNull();
  });
});

describe("what the line above the rows says of a source not in the list", () => {
  const gone = () => document.querySelector(".sources-gone");
  it.each([
    ["archived sources hidden and no filter", "?source=ELSEWHERE", "The source this address names isn’t in this list. It may have been archived."],
    ["archived sources hidden and a filter in use", "?source=ELSEWHERE&tags=vans", "The source this address names isn’t in this list. It may have been archived or filtered out."],
    ["archived sources listed and a filter in use", "?source=ELSEWHERE&tags=vans&include_archived=1", "The source this address names isn’t in this list. It may have been filtered out."],
    ["archived sources listed and no filter", "?source=ELSEWHERE&include_archived=1", "The source this address names isn’t in this product. It may have been deleted."],
  ])("with %s, says only what can be the case", async (_, search, said) => {
    await open(search);
    await vi.waitFor(() => expect(gone()?.textContent).toBe(said));
  });
});

describe("clearing the filter that hid the source in the address", () => {
  const gone = () => document.querySelector(".sources-gone");
  const controls: [string, () => Element | undefined][] = [
    ["its chip", () => document.querySelector('[aria-label="Remove filter: Tagged vans"]') ?? undefined],
    ["Clear filters above the rows", () => Array.from(document.querySelectorAll(".filters-in-use a")).find((a) => a.textContent === "Clear filters")],
    ["All tags in the panel", () => Array.from(panel.querySelectorAll("a")).find((a) => a.textContent?.includes("All tags"))],
    ["Clear filters in the panel", () => Array.from(panel.querySelectorAll("a")).find((a) => a.textContent === "Clear filters")],
  ];
  it.each(controls)("with %s brings back its preview, and the line goes", async (_, control) => {
    await open("?tags=vans&source=S3");
    await vi.waitFor(() => expect(gone()?.textContent).toContain("filtered out"));
    expect(preview()).toBeNull();
    await click(control()!);
    await vi.waitFor(() => expect(preview()).not.toBeNull());
    expect(here).toContain("source=S3");
    expect(here).not.toContain("tags=");
    expect(gone()).toBeNull();
    expect(document.querySelector('[data-source="S3"]')!.getAttribute("aria-current")).toBe("true");
  });

  it("with the empty list's Clear filters brings back its preview, keeping the order", async () => {
    await open("?tags=none&order=asc&source=S3");
    await vi.waitFor(() => expect(document.querySelector(".empty-title")?.textContent).toBe("No sources match these filters"));
    await click(document.querySelector(".empty")!.querySelector("a")!);
    await vi.waitFor(() => expect(preview()).not.toBeNull());
    expect(here).toContain("source=S3");
    expect(here).toContain("order=asc");
    expect(here).not.toContain("tags=");
  });

  it("keeps it when Include archived is chosen too", async () => {
    await open("?source=ELSEWHERE");
    await click(Array.from(panel.querySelectorAll("a")).find((a) => a.textContent?.includes("Include archived"))!);
    expect(here).toContain("source=ELSEWHERE");
    expect(here).toContain("include_archived=1");
    await vi.waitFor(() => expect(gone()?.textContent).toContain("isn’t in this product"));
  });
});

describe("the keys", () => {
  it("move through sources with the arrows and J and K, the preview open or not", async () => {
    await open();
    await press("ArrowDown");
    expect(document.querySelector('[data-source="S1"]')!.getAttribute("aria-current")).toBe("true");
    expect(preview()).toBeNull();
    await press("j");
    expect(document.querySelector('[data-source="S2"]')!.getAttribute("aria-current")).toBe("true");
    await press(" ");
    expect(here).toContain("source=S2");
    await press("ArrowDown");
    expect(here).toContain("source=S3");
    await press("k");
    expect(here).toContain("source=S2");
  });

  it("move through a source's pages side to side, and start again at the first in the next source", async () => {
    await open("?source=S1");
    await press("ArrowRight");
    expect(here).toContain("page=2");
    await press("ArrowRight");
    expect(here).toContain("page=3");
    // There is no fourth.
    await press("ArrowRight");
    expect(here).toContain("page=3");
    await press("ArrowLeft");
    expect(here).toContain("page=2");
    await press("ArrowDown");
    expect(here).toContain("source=S2");
    expect(here).not.toContain("page=");
  });

  it("spend no call moving through sources", async () => {
    await open("?source=S1");
    const before = calls.length;
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(calls.length).toBe(before);
  });

  it("close the preview with Esc, keep the source, and open it again with Space", async () => {
    await open("?source=S1");
    await press("Escape");
    expect(preview()).toBeNull();
    expect(here).not.toContain("source=");
    expect(document.querySelector('[data-source="S1"]')).not.toBeNull();
    await press(" ");
    expect(here).toContain("source=");
  });

  it("go to the source's page with Enter", async () => {
    await open("?source=S1");
    await press("Enter");
    expect(document.getElementById("source-page")).not.toBeNull();
  });

  it("leave a field and a modified key alone", async () => {
    await open();
    const input = document.createElement("input");
    document.body.append(input);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector("[aria-current='true'][data-source]")).toBeNull();
    await press("ArrowDown", { metaKey: true });
    expect(document.querySelector("[aria-current='true'][data-source]")).toBeNull();
  });
});

describe("a web page with no picture yet", () => {
  const page = { path: "report.html", media_type: "text/html", size: 900, text: { status: "ready", chars: 20, duration_ms: null }, picture: null };
  /** Stop on the page, as the preview waits to before it asks for anything. A version is drawn once in a tab, so each test has its own. */
  async function stopOnIt(file_version_id: string) {
    sources.push({ ...base, record_id: "S4", title: "Crew report", attachment_count: 1, text_from: "report.html", summary: null, first_lines: null, attachments: [{ ...page, file_version_id }] } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<h1>Crew report</h1>")));
    try {
      await open("?source=S4&page=1");
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
    } finally {
      vi.unstubAllGlobals();
      sources.pop();
    }
  }

  it("gets its picture from anyone who may give one, a viewer among them", async () => {
    who.canGivePicture = true;
    await stopOnIt("v5");
    expect(sent).toEqual([{ path: "report.html", image_base64: "drawn" }]);
  });

  it("is left alone by a guest of the example organization, and in a read-only organization", async () => {
    await stopOnIt("v6");
    expect(sent).toEqual([]);
  });
});

describe("a video stored before WhatBuild stopped taking video", () => {
  const frame = { ...picture, made_from: "frame", thumb_url: "/api/v1/pictures/frame-thumb", preview_url: "/api/v1/pictures/frame-preview" };
  const video = { path: "walkround.mp4", media_type: "video/mp4", size: 20_000_000, text: { status: "unsupported", chars: 0, duration_ms: 147_000 } };
  async function openIt(file_version_id: string, pictured: boolean) {
    sources.push({ ...base, record_id: "S4", title: "Site walk-round", derived_status: "unsupported", attachment_count: 1, text_from: null, summary: null, first_lines: null, attachments: [{ ...video, file_version_id, picture: pictured ? frame : null }] } as never);
    try {
      await open("?source=S4&page=1");
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
    } finally {
      sources.pop();
    }
  }

  it("keeps the picture it has, and is never played", async () => {
    who.canGivePicture = true;
    await openIt("v7", true);
    expect(preview()!.querySelector("video")).toBeNull();
    expect(preview()!.querySelector<HTMLImageElement>(".preview-stage img")!.getAttribute("src")).toBe("/api/v1/pictures/frame-preview");
    expect(preview()!.textContent).toMatch(/no longer plays video/);
    expect(preview()!.querySelector("a[href*='download=1']")).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it("without a picture, says so and offers the file to download", async () => {
    who.canGivePicture = true;
    await openIt("v8", false);
    expect(preview()!.querySelector("video")).toBeNull();
    expect(preview()!.querySelector(".preview-none")!.textContent).toMatch(/no longer plays video/);
    expect(preview()!.querySelector(".preview-none a")!.getAttribute("href")).toContain("download=1");
    expect(sent).toEqual([]);
  });
});
