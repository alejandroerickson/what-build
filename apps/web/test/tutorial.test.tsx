import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The spotlight tutorial: who gets it, the line of stops, what the account menu says, the content it
// shows on each page, and the welcome, a stop, closing and finishing as a person meets them.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// No motion here unless a test asks for it: nothing flies, so closing is immediate. A window as wide as
// `width`, for the queries that ask for a width.
let reduced = true;
let width = 1440;
const matches = (query: string) => {
  if (query.includes("reduce")) return reduced;
  const max = /max-width:\s*([\d.]+)px/.exec(query);
  return max ? width <= Number(max[1]) : false;
};
window.matchMedia = (query: string) =>
  ({ matches: matches(query), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const calls: { method: string; path: string; body?: unknown }[] = [];
let role = "editor";
let example = false;
let kept: { offered: boolean; stop: number | null; finished: boolean } = { offered: false, stop: null, finished: false };
const tenant = () => ({ tenant_id: "t1", slug: "acme", name: "Acme", example });

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "sam@example.com", display_name: "Sam Okafor", tenant_allowance: { remaining: 1, instance_owner: false }, hide_example: false, tutorial: kept };
    if (path === "/api/v1/me" && method === "PATCH") {
      kept = { ...kept, ...(body as { tutorial: typeof kept }).tutorial };
      return { display_name: "Sam Okafor", tutorial: kept };
    }
    if (path === "/api/v1/me/agents") return { items: [] };
    if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: [{ ...tenant(), your_role: role === "guest" ? "guest" : "member" }] };
    if (path === "/api/v1/p/acme/harvest")
      return { product_id: "p1", slug: "harvest", name: "Harvest", archived_at: null, etag: "e", path: "acme/harvest", tenant: tenant(), your_role: role, counts: { story_pages: 0 }, stage_counts: { story: 0 } };
    throw new Error(`unexpected ${method} ${path}`);
  }),
}));

const { tutorialFor, offerWelcome, standing, menuItem, pillWords, resumeAt, TUTORIAL_MIN_WIDTH, TOO_NARROW_QUERY } = await import("../src/tutorial/state.ts");
const { PHONE_QUERY } = await import("../src/ui/media.ts");
const { CANVAS_TOOLS, toolTitle } = await import("../src/routes/mockup-canvas.tsx");
const { toolLabel, toolsSaid, layoutLabels } = await import("../src/tutorial/diagram.tsx");
const { STOPS, PLACES, stopsFor, nextPlace, lineText } = await import("../src/tutorial/stops.ts");
const { TUTORIAL } = await import("../src/tutorial/content/index.ts");
const { TARGETS } = await import("../src/tutorial/layer.tsx");
const { previewPages } = await import("../src/routes/source-preview.tsx");
const { flatten } = await import("../src/routes/story-model.ts");
const { ProductProvider, useProduct } = await import("../src/lib/session.tsx");
const { TutorialProvider, useTutorial } = await import("../src/tutorial/provider.tsx");
const { AccountMenu } = await import("../src/shell/panel.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

describe("who gets the tutorial", () => {
  it("is someone who can edit the product, or a guest of the example organization, never in a window narrower than 1024", () => {
    expect(tutorialFor({ canWrite: true, role: "editor", example: false, narrow: false })).toBe(true);
    expect(tutorialFor({ canWrite: true, role: "admin", example: false, narrow: false })).toBe(true);
    expect(tutorialFor({ canWrite: false, role: "guest", example: true, narrow: false })).toBe(true);
    // Viewers and Story readers given those roles, and an editor who can't write here (archived, read-only), get nothing.
    expect(tutorialFor({ canWrite: false, role: "viewer", example: false, narrow: false })).toBe(false);
    expect(tutorialFor({ canWrite: false, role: "story_reader", example: false, narrow: false })).toBe(false);
    expect(tutorialFor({ canWrite: false, role: "viewer", example: true, narrow: false })).toBe(false);
    expect(tutorialFor({ canWrite: false, role: "editor", example: false, narrow: false })).toBe(false);
    expect(tutorialFor({ canWrite: true, role: "editor", example: false, narrow: true })).toBe(false);
    expect(tutorialFor({ canWrite: false, role: "guest", example: true, narrow: true })).toBe(false);
  });

  it("draws the line at 1024 pixels wide, with a query of its own and not the app's phone width", () => {
    expect(TUTORIAL_MIN_WIDTH).toBe(1024);
    expect(TOO_NARROW_QUERY).not.toBe(PHONE_QUERY);
    width = 1023;
    expect(window.matchMedia(TOO_NARROW_QUERY).matches).toBe(true);
    width = 1024;
    expect(window.matchMedia(TOO_NARROW_QUERY).matches).toBe(false);
    width = 1440;
  });

  it("offers the welcome once per person, where they get it", () => {
    expect(offerWelcome({ offered: false, stop: null, finished: false }, true)).toBe(true);
    expect(offerWelcome({ offered: true, stop: null, finished: false }, true)).toBe(false);
    expect(offerWelcome({ offered: false, stop: null, finished: false }, false)).toBe(false);
    // Before the account is known, nothing is offered.
    expect(offerWelcome(undefined, true)).toBe(false);
  });
});

describe("the line of stops", () => {
  it("walks twenty stops in one line across the four pages, in order", () => {
    expect(STOPS).toHaveLength(20);
    expect(STOPS.map((s) => s.id)).toEqual([
      "nav", "idea", "concept", "more-info-button", "more-info", "outcomes",
      "evidence", "sources", "preview",
      "exploration", "canvas", "toolbar", "view", "download", "promote",
      "story", "story-pages", "pdf", "agents", "connect",
    ]);
    expect(STOPS.map((s) => s.place).join(" ")).toBe(
      "idea idea idea idea idea idea evidence evidence evidence exploration exploration exploration exploration exploration exploration story story story story story",
    );
  });

  it("lists F among the canvas's keys to try, and follows the canvas with the toolbar as a diagram", () => {
    expect(lineText(STOPS[10]!.line)).toBe("Try it: 1 the whole canvas, 2 one page, 3 full width. V clicks inside a page, H moves the canvas. F hides the panels.");
    expect(STOPS[10]).toMatchObject({ id: "canvas", live: true, keys: true });
    expect(STOPS[11]).toMatchObject({ id: "toolbar", title: "Toolbar", line: ["The same commands, and their keys."], target: "toolbar", diagram: true });
    expect(STOPS[11]!.live).toBeUndefined();
  });

  it("stops on what is pressed, More info and the source's row, before the stop that shows what it opens", () => {
    expect(STOPS[3]).toMatchObject({ title: "More info", line: ["Each card has text behind its picture."], target: "more-info-button", aim: "more-info-button" });
    expect(STOPS[3]!.opens).toBeUndefined();
    expect(STOPS[4]).toMatchObject({ title: "More info", line: ["The same concept in words, for agents to read."], target: "more-info", opens: "more-info", presses: "more-info-button", aim: "more-info-button" });
    expect(STOPS[7]).toMatchObject({ title: "Sources", line: ["Select a source to preview it."], target: "source-row" });
    expect(STOPS[7]!.opens).toBeUndefined();
    expect(STOPS[8]).toMatchObject({ title: "Preview", line: ["What’s visual in a source: whiteboard photos, slides, recordings."], target: "preview", opens: "preview", presses: "source-row" });
  });

  it("enters each page at its item in the main navigation, after the navigation itself", () => {
    expect(STOPS[0]!.target).toBe("nav");
    expect(STOPS[1]!.target).toBe("nav-idea");
    for (const place of ["evidence", "exploration", "story"] as const) expect(STOPS.find((s) => s.place === place)!.target).toBe(`nav-${place}`);
  });

  it("names the next page on the last stop of each page", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => nextPlace(STOPS, n))).toEqual([null, null, null, null, null, "evidence", null, null, "exploration", null]);
    expect(nextPlace(STOPS, 13)).toBeNull();
    expect(nextPlace(STOPS, 14)).toBe("story");
    expect(nextPlace(STOPS, 19)).toBeNull();
  });

  it("lets only the canvas and the View switch be tried, and opens More info and the preview where it shows them", () => {
    expect(STOPS.filter((s) => s.live).map((s) => s.id)).toEqual(["canvas", "view"]);
    expect(STOPS.filter((s) => s.keys).map((s) => s.id)).toEqual(["canvas"]);
    expect(STOPS.filter((s) => s.opens).map((s) => [s.id, s.opens])).toEqual([["more-info", "more-info"], ["preview", "preview"]]);
    expect(STOPS.filter((s) => s.stage).map((s) => s.id)).toEqual(["agents"]);
    expect(STOPS.at(-1)).toMatchObject({ id: "connect", target: "seat", last: true });
  });

  it("finds every thing a stop lights on the screen", () => {
    for (const s of STOPS) if (s.target) expect(TARGETS[s.target], s.id).toBeTypeOf("function");
  });

  it("ends on the agent stage for someone with an agent connected, who has no empty seat to light", () => {
    expect(stopsFor(false)).toHaveLength(20);
    const withAgent = stopsFor(true);
    expect(withAgent).toHaveLength(19);
    expect(withAgent.at(-1)!.stage).toBe(true);
  });

  it("keeps to the words the app uses: a thing's own name, one short line, never the word tour", () => {
    for (const s of STOPS) {
      expect(s.title.length, s.id).toBeLessThanOrEqual(30);
      expect(`${s.title} ${lineText(s.line)}`, s.id).not.toMatch(/\btour\b/i);
    }
    expect(JSON.stringify(TUTORIAL.agents)).not.toMatch(/\btour\b/i);
  });
});

describe("where it stands, as the account menu and the pill say it", () => {
  it("offers to take it, to resume it where it was left, or to take it again", () => {
    expect(menuItem(standing({ offered: false, stop: null, finished: false }, 20), STOPS)).toEqual({ title: "Take the tutorial", detail: "About three minutes", progress: null });
    expect(menuItem(standing({ offered: true, stop: 4, finished: false }, 20), STOPS)).toEqual({ title: "Resume tutorial", detail: "Stop 5 of 20 · Idea", progress: 4 / 20 });
    expect(menuItem(standing({ offered: true, stop: 8, finished: false }, 20), STOPS).detail).toBe("Stop 9 of 20 · Evidence");
    expect(menuItem(standing({ offered: true, stop: null, finished: true }, 20), STOPS)).toEqual({ title: "Take the tutorial again", detail: "About three minutes", progress: null });
    // Taken again after finishing and closed part-way, it resumes.
    expect(menuItem(standing({ offered: true, stop: 9, finished: true }, 20), STOPS).title).toBe("Resume tutorial");
  });

  it("resumes at the stop it was left at, within the stops there are now", () => {
    expect(resumeAt(standing({ offered: true, stop: 6, finished: false }, 20))).toBe(6);
    expect(resumeAt(standing({ offered: true, stop: 19, finished: false }, 19))).toBe(18);
    expect(resumeAt(standing({ offered: true, stop: null, finished: true }, 20))).toBe(0);
  });

  it("says on the pill where it went", () => {
    expect(pillWords("welcome", 0, 20)).toBe("Tutorial");
    expect(pillWords("stop", 4, 20)).toBe("Tutorial · 5 of 20");
    expect(pillWords("finished", 19, 20)).toBe("Tutorial finished");
  });
});

describe("the tutorial's content, one object per page", () => {
  it("has the concept with its picture and its More info text, and the outcome", () => {
    expect(TUTORIAL.idea.concept.text).toMatch(/^Crewboard helps/);
    expect(TUTORIAL.idea.concept.front.pitch.marked).toBe("Friday afternoon");
    expect(TUTORIAL.idea.outcomes.map((o) => o.title)).toEqual(["Plan next week in minutes, not an afternoon"]);
  });

  it("opens the source's preview on its whiteboard photo, page 2 of 3", () => {
    const { sources, preview } = TUTORIAL.evidence;
    const s = sources.find((x) => x.record_id === preview.source)!;
    expect(s.title).toBe("Crew lead interview — Greenline Landscaping, Aug 2026");
    expect(s.tags).toEqual(["interview", "greenline landscaping", "planning"]);
    const pages = previewPages(s);
    expect(pages).toHaveLength(3);
    const shown = pages[preview.page]!;
    expect(shown.kind === "attachment" && shown.a.path).toBe("whiteboard.jpg");
    // The photo ships with the app: no address on the server.
    expect(shown.kind === "attachment" && shown.a.picture?.preview_url).not.toMatch(/\/api\//);
    // Its picture is drawn from the photo, and no card asks for a frame.
    expect(s.card_etag).toBeNull();
  });

  it("draws a canvas of three pages that link only to each other, at version 2, not on the Story", () => {
    const { mockup, pages } = TUTORIAL.exploration;
    expect(mockup).toMatchObject({ title: "Planning the week: jobs first or days first", version: 2 });
    expect(pages.map((p) => p.title)).toEqual(["Jobs board", "Day planner", "Crew message"]);
    const ids = new Set(pages.map((p) => p.page_id));
    for (const p of pages) {
      const html = renderToStaticMarkup(p.draw() as ReactNode);
      const links = [...html.matchAll(/data-page-link="([^"]+)"/g)].map((m) => m[1]);
      expect(links.length, p.page_id).toBeGreaterThan(0);
      for (const to of links) expect(ids.has(to!), `${p.page_id} → ${to}`).toBe(true);
      // A page's picture asks for nothing: no frame, script or address elsewhere.
      expect(html).not.toMatch(/<(iframe|script|img)\b|https?:/);
    }
  });

  it("has the Story page, and under it the canvas promoted from Exploration with its three pages", () => {
    const { tree, page, draw } = TUTORIAL.story;
    const rows = flatten(tree);
    expect(rows[0]!.node).toMatchObject({ page_id: page.id, title: "Where Crewboard’s discovery stands", kind: "story_page" });
    expect(rows[1]!.node.kind).toBe("canvas");
    expect(rows.slice(2).map((r) => r.node.title)).toEqual(TUTORIAL.exploration.pages.map((p) => p.title));
    expect(isValidElement(draw())).toBe(true);
    expect(renderToStaticMarkup(draw() as ReactNode)).not.toMatch(/<(iframe|script|img)\b|https?:/);
  });

  it("plays the agent writing each of the four pages with its own tool", () => {
    const { beats, tools, done } = TUTORIAL.agents;
    expect(beats.map((b) => b.place).sort()).toEqual(["evidence", "exploration", "idea", "story"]);
    for (const b of beats) expect(tools[b.place]).toContain(b.tool);
    expect(done).toBe("Done. A source, an outcome, a mockup and a Story page are in WhatBuild.");
    expect(Object.keys(PLACES)).toEqual(["idea", "evidence", "exploration", "story"]);
  });
});

// ---- As a person meets it --------------------------------------------------------------------

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  calls.length = 0;
  document.body.innerHTML = "";
});

/** The tutorial as a product's own screens have it (ProductShell). */
function InProduct({ children }: { children: ReactNode }) {
  const { product, canWrite } = useProduct();
  return (
    <TutorialProvider target={{ path: product.path, role: product.your_role, example: Boolean(product.tenant.example), canWrite }} inside>
      {children}
    </TutorialProvider>
  );
}

let api: ReturnType<typeof useTutorial> = null;
function Probe() {
  api = useTutorial();
  return null;
}

async function mount(entry: string | { pathname: string; state: unknown } = "/t/acme/harvest/idea") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route
                path="/t/:tenant/:product/*"
                element={
                  <ProductProvider fallback={() => <p>missing</p>}>
                    {() => (
                      <InProduct>
                        <div className="panel-left">
                          <AccountMenu />
                        </div>
                        <Probe />
                      </InProduct>
                    )}
                  </ProductProvider>
                }
              />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  unmount = () => act(() => root.unmount());
  // The welcome comes a moment after the product opens.
  await act(async () => new Promise((r) => setTimeout(r, 900)));
}

const welcome = () => document.querySelector('[role="dialog"].tut-welcome');
const press = async (name: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>(".tut-layer button")].find((x) => x.textContent?.trim() === name || x.getAttribute("aria-label") === name);
  if (!b) throw new Error(`no button ${name}`);
  await act(async () => b.click());
  await act(async () => new Promise((r) => setTimeout(r, 300)));
};

describe("the welcome, a stop, closing and finishing", () => {
  it("offers an editor the welcome on their first product, and keeps that it was offered", async () => {
    role = "editor";
    example = false;
    kept = { offered: false, stop: null, finished: false };
    await mount();
    expect(welcome()?.textContent).toContain("Take the WhatBuild tutorial?");
    expect(welcome()?.getAttribute("aria-modal")).toBe("true");
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { offered: true } } });
    // Nothing starts until it is asked for.
    expect(api?.mode).toBe("welcome");
    expect(api?.showing).toBe(false);
  });

  it("offers a guest of the example organization the welcome too", async () => {
    role = "guest";
    example = true;
    kept = { offered: false, stop: null, finished: false };
    await mount();
    expect(welcome()).not.toBeNull();
  });

  it("offers nothing to a viewer, a Story reader, or someone who was offered it before", async () => {
    for (const [r, ex, k] of [
      ["viewer", false, { offered: false, stop: null, finished: false }],
      ["story_reader", false, { offered: false, stop: null, finished: false }],
      ["editor", false, { offered: true, stop: null, finished: false }],
      ["guest", true, { offered: true, stop: null, finished: false }],
    ] as const) {
      role = r;
      example = ex;
      kept = { ...k };
      await mount();
      expect(welcome(), r).toBeNull();
      unmount?.();
      unmount = null;
      document.body.innerHTML = "";
    }
  });

  it("starts at the main navigation, moves one stop at a time, and closes into the account menu at its stop", async () => {
    role = "editor";
    example = false;
    kept = { offered: false, stop: null, finished: false };
    await mount();
    await press("Start the tutorial");
    expect(api).toMatchObject({ mode: "stop", at: 0, showing: true });
    expect(kept.stop).toBe(0);
    expect(document.querySelector(".tut-title")?.textContent).toBe("Main navigation");
    expect(document.querySelector(".tut-count")?.textContent).toBe("1 of 20");
    // The first stop has no Back.
    expect([...document.querySelectorAll(".tut-foot button")].map((b) => b.textContent?.trim())).toEqual(["Finish later", "Next"]);
    await press("Next");
    expect(api?.at).toBe(1);
    expect(kept.stop).toBe(1);
    await press("Back");
    expect(api?.at).toBe(0);
    await press("Next");
    await press("Finish later");
    expect(api?.mode).toBe("off");
    expect(api?.showing).toBe(false);
    expect(kept).toEqual({ offered: true, stop: 1, finished: false });
    expect(document.body.textContent).toContain("The tutorial is in your account menu.");
  });

  it("finishes from its last stop, and is offered again from the account menu", async () => {
    role = "editor";
    example = false;
    kept = { offered: true, stop: 19, finished: false };
    await mount();
    expect(welcome()).toBeNull();
    expect(api?.standing).toEqual({ kind: "paused", stop: 19 });
    await act(async () => api!.start("menu"));
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(document.querySelector(".tut-title")?.textContent).toBe("Connect an agent");
    expect([...document.querySelectorAll(".tut-foot button")].map((b) => b.textContent?.trim())).toEqual(["Back", "Finish", "Connect an agent"]);
    await press("Finish");
    expect(kept).toEqual({ offered: true, stop: null, finished: true });
    expect(api?.mode).toBe("off");
    expect(document.body.textContent).toContain("Tutorial finished. It stays in your account menu.");
    expect(api?.standing).toEqual({ kind: "finished" });
  });
});

describe("pressing what a stop opens", () => {
  /** Starts from the account menu at a stop, with no motion, and returns once it is up. */
  async function resumeAt(stop: number) {
    role = "editor";
    example = false;
    kept = { offered: true, stop, finished: false };
    reduced = true;
    await mount();
    await act(async () => api!.start("menu"));
  }
  const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

  it("waits on More info with the text closed; Next presses it and the text opens; Back folds it again", async () => {
    await resumeAt(3);
    expect(api).toMatchObject({ at: 3, reveal: null, opens: null });
    expect(document.querySelector(".tut-title")?.textContent).toBe("More info");
    expect(document.querySelector(".tut-line")?.textContent).toBe("Each card has text behind its picture.");
    // It waits: nothing happens by itself.
    await wait(1200);
    expect(api).toMatchObject({ at: 3, opens: null });
    reduced = false;
    try {
      await act(async () => api!.go(4));
      expect(api).toMatchObject({ at: 4, reveal: "press", opens: null });
      await wait(400);
      expect(api).toMatchObject({ at: 4, reveal: "open", opens: "more-info" });
      expect(document.querySelector(".tut-line")?.textContent).toBe("The same concept in words, for agents to read.");
      await act(async () => api!.go(3));
      expect(api).toMatchObject({ at: 3, reveal: null, opens: null });
      // On to the outcome, and Back: open at once.
      await act(async () => api!.go(4));
      await wait(400);
      await act(async () => api!.go(5));
      await act(async () => api!.go(4));
      expect(api).toMatchObject({ at: 4, reveal: "open", opens: "more-info" });
    } finally {
      reduced = true;
    }
    // With reduced motion, Next opens it at once.
    await act(async () => api!.go(3));
    await act(async () => api!.go(4));
    expect(api).toMatchObject({ at: 4, reveal: "open", opens: "more-info" });
  });

  it("waits on the source's row with the preview closed; Next selects it and opens the preview; Back closes it", async () => {
    await resumeAt(7);
    expect(api).toMatchObject({ at: 7, reveal: null, opens: null });
    expect(document.querySelector(".tut-title")?.textContent).toBe("Sources");
    await wait(1200);
    expect(api).toMatchObject({ at: 7, opens: null });
    reduced = false;
    try {
      await act(async () => api!.go(8));
      expect(api).toMatchObject({ at: 8, reveal: "press", opens: null });
      await wait(400);
      expect(api).toMatchObject({ at: 8, reveal: "open", opens: "preview" });
      await act(async () => api!.go(7));
      expect(api).toMatchObject({ at: 7, opens: null });
    } finally {
      reduced = true;
    }
  });

  it("resumes at More info and at the source closed, and at the text and the preview open", async () => {
    for (const [stop, opens] of [[3, null], [4, "more-info"], [7, null], [8, "preview"]] as const) {
      reduced = false;
      try {
        await resumeAt(stop);
        // Resumed, nothing is pressed: what the stop shows is there at once.
        expect(api, String(stop)).toMatchObject({ at: stop, opens });
        expect(api?.reveal, String(stop)).toBe(opens ? "open" : null);
      } finally {
        reduced = true;
        unmount?.();
        unmount = null;
        document.body.innerHTML = "";
      }
    }
  });
});

describe("taking over from the overview", () => {
  it("begins at the first stop when the overview's Start the tutorial brought the person here, offering no second welcome", async () => {
    role = "editor";
    example = false;
    kept = { offered: true, stop: null, finished: false };
    await mount({ pathname: "/t/acme/harvest/idea", state: { tutorial: "welcome" } });
    expect(welcome()).toBeNull();
    expect(api).toMatchObject({ mode: "stop", at: 0, showing: true });
    expect(kept.stop).toBe(0);
  });

  it("resumes at the stop it was left at when the overview's account menu brought the person here", async () => {
    role = "guest";
    example = true;
    kept = { offered: true, stop: 4, finished: false };
    await mount({ pathname: "/t/acme/harvest/idea", state: { tutorial: "menu" } });
    expect(api).toMatchObject({ mode: "stop", at: 4 });
  });
});


describe("Focus at the canvas stop", () => {
  it("goes in and out with F, counts as tried, and is off again whichever way the stop is left", async () => {
    role = "editor";
    example = false;
    kept = { offered: true, stop: 10, finished: false };
    await mount();
    await act(async () => api!.start("menu"));
    expect(api).toMatchObject({ at: 10, focus: false });
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(true);
    expect(api?.hit.has("f")).toBe(true);
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(false);
    // Next, and Back, from Focus: the next stop has its panels.
    await act(async () => api!.toggleFocus());
    await act(async () => api!.go(11));
    expect(api).toMatchObject({ at: 11, focus: false });
    await act(async () => api!.go(10));
    await act(async () => api!.toggleFocus());
    await act(async () => api!.go(9));
    expect(api).toMatchObject({ at: 9, focus: false });
    // F does nothing at any other stop.
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(false);
    // Finish later from Focus.
    await act(async () => api!.go(10));
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(true);
    await press("Finish later");
    expect(api).toMatchObject({ mode: "off", focus: false });
    expect(kept.stop).toBe(10);
  });
});

describe("in a window narrower than 1024 pixels", () => {
  it("offers nothing and no menu item at 1023 wide, and the welcome at 1024", async () => {
    role = "editor";
    example = false;
    try {
      width = 1023;
      kept = { offered: false, stop: null, finished: false };
      await mount();
      expect(welcome()).toBeNull();
      expect(api?.eligible).toBe(false);
      unmount?.();
      unmount = null;
      document.body.innerHTML = "";
      width = 1024;
      kept = { offered: false, stop: null, finished: false };
      await mount();
      expect(welcome()).not.toBeNull();
      expect(api?.eligible).toBe(true);
    } finally {
      width = 1440;
    }
  });
});

describe("the toolbar as a diagram", () => {
  it("names each control and its key as the toolbar's own definitions do", () => {
    const ids = Object.keys(CANVAS_TOOLS) as (keyof typeof CANVAS_TOOLS)[];
    expect(ids.map((id) => [toolLabel(id).name, toolLabel(id).key])).toEqual([
      ["Pan", "H"], ["Interact", "V"], ["Zoom out", "−"], ["Zoom in", "+"], ["Fit the page", "2"], ["Fill the width", "3"],
      ["Fit the canvas", "1"], ["Previous page", "←"], ["Next page", "→"], ["Keyboard shortcuts", null],
    ]);
    // The toolbar's tooltips are made from the same definitions: each label's name begins its control's tooltip, which ends in its key.
    for (const id of ids) {
      const l = toolLabel(id);
      expect(toolTitle(id, true).startsWith(l.name.split(" ")[0]!), id).toBe(true);
      if (l.key) expect(toolTitle(id), id).toMatch(new RegExp(`\\(${l.key.replace(/[+]/g, "\\+")}\\)$`));
    }
    expect(toolsSaid(ids.slice(0, 2).map(toolLabel).concat(toolLabel("keys")))).toBe("Pan, H. Interact, V. Keyboard shortcuts");
  });

  it("stands the labels in rows above the bar on its two sides, split where a group ends, none overlapping and none leaving the window", () => {
    // A bar as the canvas draws it at 1024 wide: its last group wrapped onto a second row.
    const ids = Object.keys(CANVAS_TOOLS) as (keyof typeof CANVAS_TOOLS)[];
    const groups = [0, 0, 1, 1, 2, 2, 2, 3, 3, 4];
    const controls = ids.map((id, i) => ({ label: toolLabel(id), group: groups[i]!, box: i < 9 ? { x: 300 + i * 40, y: 680, w: 28, h: 28 } : { x: 520, y: 712, w: 28, h: 28 } }));
    const widths = ids.map((id) => 40 + toolLabel(id).name.length * 6);
    const placed = layoutLabels(controls, widths, { w: 1024 }, { x: 290, y: 674, w: 400, h: 70 });
    const boxes = placed.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(12);
      expect(b.x + b.w).toBeLessThanOrEqual(1024 - 12);
      expect(b.y + b.h).toBeLessThan(674);
    }
    // Split at a group boundary: the first two groups on the left, the rest on the right.
    expect(placed.map((p) => p.side)).toEqual(["left", "left", "left", "left", "right", "right", "right", "right", "right", "right"]);
    // The wrapped control's line leaves along its row, past the bar's right edge, before it rises.
    expect(placed[9]!.points[1]).toEqual({ x: 698, y: 726 });
    // A control on the bar's own row rises straight from its top.
    expect(placed[0]!.points[0]).toEqual({ x: 314, y: 680 });
  });
});

describe("the keys while it is up", () => {
  it("keeps / (search) from the page even from the thing in the light, and lets the canvas's own keys through", async () => {
    const { setKeyPolicy } = await import("../src/tutorial/keys.ts");
    const layer = document.createElement("div");
    const live = document.createElement("div");
    const control = document.createElement("button");
    live.append(control);
    document.body.append(layer, live);
    const heard: string[] = [];
    const listen = (e: KeyboardEvent) => heard.push(e.key);
    window.addEventListener("keydown", listen);
    setKeyPolicy({ layer: () => layer, live: () => live, canvasKeys: true, onEscape: () => {} });
    try {
      for (const key of ["/", "1", "v", "x"]) control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      // The search shortcut never reaches the app's listener; the canvas's keys do, and the light's own (x) as without the tutorial.
      expect(heard).toEqual(["1", "v", "x"]);
      heard.length = 0;
      const bubbleButton = document.createElement("button");
      layer.append(bubbleButton);
      bubbleButton.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      expect(heard).toEqual([]);
    } finally {
      setKeyPolicy(null);
      window.removeEventListener("keydown", listen);
    }
  });
});
