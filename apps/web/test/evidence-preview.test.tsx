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
const video = { path: "walkround.mp4", media_type: "video/mp4", size: 20_000_000, file_version_id: "v3", text: { status: "needs_transcript", chars: 0, duration_ms: 147_000 }, picture: null };
const unknown = { path: "rota.fig", media_type: "application/octet-stream", size: 900, file_version_id: "v4", text: { status: "unsupported", chars: 0, duration_ms: null }, picture: null };
const sources = [
  { ...base, record_id: "S1", title: "Friday workshop", attachment_count: 2, text_from: "notes.docx", summary: "Crews plan on **Friday**.", first_lines: "# Notes\n\nCrews plan on Friday.", attachments: [image, notes] },
  { ...base, record_id: "S2", title: "Site walk-round", derived_status: "needs_transcript", attachment_count: 1, text_from: null, summary: null, first_lines: null, attachments: [video] },
  { ...base, record_id: "S3", title: "Rota working file", derived_status: "unsupported", attachment_count: 1, text_from: null, summary: null, first_lines: null, attachments: [unknown] },
];

const calls: string[] = [];
const who = { canGivePicture: false };
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
    return { records: sources, next_cursor: null };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite: false, canDelete: false, canGivePicture: who.canGivePicture }),
}));
vi.mock("../src/lib/html-picture.ts", () => ({ pictureOfHtml: vi.fn(async () => "drawn") }));

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
    expect(preview()!.querySelector("video")!.getAttribute("preload")).toBe("none");
  });

  it("says a recording can't play here when its browser plays only its sound", async () => {
    await open("?source=S2");
    await act(async () => {
      const video = preview()!.querySelector("video")!;
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(preview()!.textContent).toMatch(/can’t be played here/);
    expect(preview()!.querySelector("a[href*='download=1']")).not.toBeNull();
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
