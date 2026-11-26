import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TutorialSeen } from "../src/lib/session.tsx";

// The spotlight tutorials: who gets them, the welcome and the four pages' tutorials and their stops,
// which starts by itself where, what the account menu says, the content they show on each page, and
// the welcome, a stop, closing, turning tutorials off and finishing as a person meets them.

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
type Kept = { seen: string[]; off: boolean };
let kept: Kept = { seen: [], off: false };
let agents: unknown[] = [];
/** The welcome offered on a product of the person's own: what the account keeps for it there. */
const OFFERED: TutorialSeen[] = ["welcome", "welcome-own"];
const ALL: TutorialSeen[] = [...OFFERED, "idea", "evidence", "exploration", "story"];
const tenant = () => ({ tenant_id: "t1", slug: "acme", name: "Acme", example });

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "sam@example.com", display_name: "Sam Okafor", tenant_allowance: { remaining: 1, instance_owner: false }, hide_example: false, tutorial: kept };
    if (path === "/api/v1/me" && method === "PATCH") {
      const t = (body as { tutorial: Partial<Kept> }).tutorial;
      kept = { seen: [...new Set([...kept.seen, ...(t.seen ?? [])])], off: t.off ?? kept.off };
      return { display_name: "Sam Okafor", tutorial: kept };
    }
    if (path === "/api/v1/me/agents") return { items: agents };
    if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: [{ ...tenant(), your_role: role === "guest" ? "guest" : "member" }] };
    if (path === "/api/v1/p/acme/harvest")
      return { product_id: "p1", slug: "harvest", name: "Harvest", archived_at: null, etag: "e", path: "acme/harvest", tenant: tenant(), your_role: role, counts: { story_pages: 0 }, stage_counts: { story: 0 } };
    throw new Error(`unexpected ${method} ${path}`);
  }),
}));

const { tutorialFor, dueTutorial, welcomeSeen, pageOf, sectionOf, menuItem, pillWords, TUTORIAL_MIN_WIDTH, TOO_NARROW_QUERY } = await import("../src/tutorial/state.ts");
const { PHONE_QUERY } = await import("../src/ui/media.ts");
const { CANVAS_TOOLS, toolTitle } = await import("../src/routes/mockup-canvas.tsx");
const { toolLabel, toolsSaid, layoutLabels } = await import("../src/tutorial/diagram.tsx");
const { TUTORIALS, PARTS, ALL_STOPS, CONNECT, PLACES, stopsFor, partLabel, lineText } = await import("../src/tutorial/stops.ts");
const { TUTORIAL } = await import("../src/tutorial/content/index.ts");
const { TARGETS } = await import("../src/tutorial/layer.tsx");
const { previewPages } = await import("../src/routes/source-preview.tsx");
const { flatten } = await import("../src/routes/story-model.ts");
const { ProductProvider, useProduct } = await import("../src/lib/session.tsx");
const { TutorialProvider, useTutorial } = await import("../src/tutorial/provider.tsx");
const { AccountMenu } = await import("../src/shell/panel.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

describe("who gets the tutorials", () => {
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

  it("starts the welcome by itself until it has been offered, then each page's the first time that page is opened, and nothing once tutorials are off", () => {
    for (const example of [false, true]) {
      const offered: TutorialSeen[] = example ? ["welcome"] : OFFERED;
      expect(dueTutorial({ seen: [], off: false }, "evidence", example)).toBe("welcome");
      expect(dueTutorial({ seen: [], off: false }, null, example)).toBe("welcome");
      expect(dueTutorial({ seen: [...offered], off: false }, "evidence", example)).toBe("evidence");
      expect(dueTutorial({ seen: [...offered, "evidence"], off: false }, "evidence", example)).toBeNull();
      expect(dueTutorial({ seen: [...offered], off: false }, null, example)).toBeNull();
      expect(dueTutorial({ seen: [], off: true }, "idea", example)).toBeNull();
      expect(dueTutorial({ seen: [...offered], off: true }, "story", example)).toBeNull();
      // Before the account is known, nothing starts.
      expect(dueTutorial(undefined, "idea", example)).toBeNull();
    }
  });

  it("offers the welcome offered in the example organization once more on a product of the person's own, and offered there, nowhere again", () => {
    expect(welcomeSeen(true)).toEqual(["welcome"]);
    expect(welcomeSeen(false)).toEqual(["welcome", "welcome-own"]);
    // Offered as a guest of the example, with every page's seen there too: on their own product, the welcome again.
    expect(dueTutorial({ seen: ["welcome", "idea", "evidence", "exploration", "story"], off: false }, "idea", false)).toBe("welcome");
    expect(dueTutorial({ seen: ["welcome"], off: false }, null, false)).toBe("welcome");
    // Offered there, it comes no more, and the pages seen in the example start nothing.
    expect(dueTutorial({ seen: ["welcome", "welcome-own", "idea"], off: false }, "idea", false)).toBeNull();
    expect(dueTutorial({ seen: ["welcome", "welcome-own"], off: false }, "story", false)).toBe("story");
    // Offered first on their own product, it is not offered in the example either.
    expect(dueTutorial({ seen: ["welcome", "welcome-own"], off: false }, null, true)).toBeNull();
    // Turned off, nothing comes on their own product either.
    expect(dueTutorial({ seen: ["welcome"], off: true }, "idea", false)).toBeNull();
  });

  it("knows the page an address is in, and the page whose tutorial it can show", () => {
    expect(pageOf("/t/acme/harvest/idea")).toBe("idea");
    expect(pageOf("/t/acme/harvest/evidence")).toBe("evidence");
    // A source's own screen has no examples to show: no tutorial starts there, and the menu's goes to the list.
    expect(pageOf("/t/acme/harvest/evidence/rec1")).toBeNull();
    expect(sectionOf("/t/acme/harvest/evidence/rec1")).toBe("evidence");
    expect(pageOf("/t/acme/harvest/exploration/mockups/m1")).toBe("exploration");
    expect(pageOf("/t/acme/harvest/story/pg1")).toBe("story");
    for (const elsewhere of ["/", "/t/acme/harvest", "/t/acme/harvest/activity", "/t/acme/harvest/search"]) {
      expect(pageOf(elsewhere), elsewhere).toBeNull();
      expect(sectionOf(elsewhere), elsewhere).toBeNull();
    }
  });
});

describe("the tutorials and their stops", () => {
  it("are a welcome and one for each page, none longer than seven stops with the seat", () => {
    expect(PARTS).toEqual(["welcome", "idea", "evidence", "exploration", "story"]);
    expect(Object.fromEntries(PARTS.map((p) => [p, TUTORIALS[p].map((s) => s.id)]))).toEqual({
      welcome: ["nav", "agents"],
      idea: ["idea", "concept", "more-info-button", "more-info", "outcomes"],
      evidence: ["evidence", "sources", "preview"],
      exploration: ["exploration", "canvas", "toolbar", "view", "download", "promote"],
      story: ["story", "story-pages", "pdf"],
    });
    for (const p of PARTS) expect(stopsFor(p, false).length, p).toBeLessThanOrEqual(7);
  });

  it("end on the empty agent seat while the person has no agent connected, and without it once they have one", () => {
    for (const p of PARTS) {
      expect(stopsFor(p, false).at(-1), p).toBe(CONNECT);
      expect(stopsFor(p, true), p).toEqual(TUTORIALS[p]);
    }
    expect(CONNECT).toMatchObject({ id: "connect", title: "Connect an agent", target: "seat", last: true });
    expect(ALL_STOPS.filter((s) => s.last)).toEqual([CONNECT]);
  });

  it("enter each page at its item in the main navigation; the welcome lights the navigation, then plays an agent at work", () => {
    expect(TUTORIALS.welcome[0]).toMatchObject({ title: "Main navigation", line: ["Four stages of product discovery."], target: "nav" });
    expect(TUTORIALS.welcome[1]).toMatchObject({ id: "agents", stage: true });
    for (const place of ["idea", "evidence", "exploration", "story"] as const) expect(TUTORIALS[place][0]!.target, place).toBe(`nav-${place}`);
  });

  it("lists F among the canvas's keys to try, and follows the canvas with the toolbar as a diagram", () => {
    const [, canvas, toolbar] = TUTORIALS.exploration;
    expect(lineText(canvas!.line)).toBe("Try it: 1 the whole canvas, 2 one page, 3 full width. V clicks inside a page, H moves the canvas. F hides the panels.");
    expect(canvas).toMatchObject({ id: "canvas", live: true, keys: true });
    expect(toolbar).toMatchObject({ id: "toolbar", title: "Toolbar", line: ["The same commands, and their keys."], target: "toolbar", diagram: true });
    expect(toolbar!.live).toBeUndefined();
  });

  it("stops on what is pressed, More info and the source's row, before the stop that shows what it opens", () => {
    const [, , button, text] = TUTORIALS.idea;
    expect(button).toMatchObject({ title: "More info", line: ["Each card has text behind its picture."], target: "more-info-button", aim: "more-info-button" });
    expect(button!.opens).toBeUndefined();
    expect(text).toMatchObject({ title: "More info", line: ["The same concept in words, for agents to read."], target: "more-info", opens: "more-info", presses: "more-info-button", aim: "more-info-button" });
    const [, row, preview] = TUTORIALS.evidence;
    expect(row).toMatchObject({ title: "Sources", line: ["Select a source to preview it."], target: "source-row" });
    expect(row!.opens).toBeUndefined();
    expect(preview).toMatchObject({ title: "Preview", line: ["What’s visual in a source: whiteboard photos, slides, recordings."], target: "preview", opens: "preview", presses: "source-row" });
  });

  it("lets only the canvas and the View switch be tried, and opens More info and the preview where it shows them", () => {
    expect(ALL_STOPS.filter((s) => s.live).map((s) => s.id)).toEqual(["canvas", "view"]);
    expect(ALL_STOPS.filter((s) => s.keys).map((s) => s.id)).toEqual(["canvas"]);
    expect(ALL_STOPS.filter((s) => s.opens).map((s) => [s.id, s.opens])).toEqual([["more-info", "more-info"], ["preview", "preview"]]);
    expect(ALL_STOPS.filter((s) => s.stage).map((s) => s.id)).toEqual(["agents"]);
  });

  it("finds every thing a stop lights on the screen", () => {
    for (const s of ALL_STOPS) if (s.target) expect(TARGETS[s.target], s.id).toBeTypeOf("function");
  });

  it("keeps to the words the app uses: a thing's own name, one short line, never the word tour", () => {
    for (const s of ALL_STOPS) {
      expect(s.title.length, s.id).toBeLessThanOrEqual(30);
      expect(`${s.title} ${lineText(s.line)}`, s.id).not.toMatch(/\btour\b/i);
    }
    expect(JSON.stringify(TUTORIAL.agents)).not.toMatch(/\btour\b/i);
    for (const p of PARTS) expect(menuItem(p, 3).title, p).not.toMatch(/\btour\b/i);
  });
});

describe("the account menu and the pill", () => {
  it("offers the tutorial of the page on screen, or the welcome elsewhere, with its stops", () => {
    expect(menuItem("evidence", 4)).toEqual({ title: "Take the Evidence tutorial", detail: "4 stops" });
    expect(menuItem("welcome", 3)).toEqual({ title: "Take the WhatBuild tutorial", detail: "3 stops" });
    expect(PARTS.map(partLabel)).toEqual(["WhatBuild", "Idea", "Evidence", "Exploration", "Story"]);
  });

  it("says on the pill where it went", () => {
    expect(pillWords("welcome", 0, 3)).toBe("Tutorial");
    expect(pillWords("stop", 1, 4)).toBe("Tutorial · 2 of 4");
    expect(pillWords("finished", 3, 4)).toBe("Tutorial finished");
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

// Time here is the test's own: a wait moves the clock at once, so a test takes no longer on a slow
// machine, and a timer a test left behind never fires in the next.
beforeEach(() => {
  vi.useFakeTimers();
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  calls.length = 0;
  agents = [];
  document.body.innerHTML = "";
  vi.useRealTimers();
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
let at = "";
function Probe() {
  api = useTutorial();
  at = useLocation().pathname;
  return null;
}

/** Waits as long as a person would: the tutorial that starts by itself comes a moment after the screen opens. */
const settle = (ms = 900) => act(() => vi.advanceTimersByTimeAsync(ms));

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
                        <Go />
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
  await settle();
}

/** Moves to another screen of the product as the panel's navigation would. */
let goTo: (path: string) => void = () => {};
function Go() {
  const navigate = useNavigate();
  goTo = (path) => navigate(path);
  return null;
}

const welcome = () => document.querySelector('[role="dialog"].tut-welcome');
const title = () => document.querySelector(".tut-title, .tut-stage-title")?.textContent;
const count = () => document.querySelector(".tut-count")?.textContent;
const foot = () => [...document.querySelectorAll(".tut-foot button")].map((b) => b.textContent?.trim());
const press = async (name: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>(".tut-layer button")].find((x) => x.textContent?.trim() === name || x.getAttribute("aria-label") === name);
  if (!b) throw new Error(`no button ${name}`);
  await act(async () => b.click());
  await settle(300);
};
const menuItemEl = async () => {
  const button = document.querySelector<HTMLElement>(".panel-left .account-button");
  if (!button) throw new Error("no account button");
  await act(async () => button.click());
  await settle(300);
  return document.querySelector(".menu .menu-tutorial");
};
const fresh = () => {
  unmount?.();
  unmount = null;
  calls.length = 0;
  document.body.innerHTML = "";
};

describe("the welcome", () => {
  it("is offered to an editor on their first product, and kept as seen", async () => {
    role = "editor";
    example = false;
    kept = { seen: [], off: false };
    await mount();
    expect(welcome()?.textContent).toContain("Take the WhatBuild tutorial?");
    expect(welcome()?.textContent).toContain("Each page has a short tutorial of its own the first time you open it.");
    expect(welcome()?.getAttribute("aria-modal")).toBe("true");
    expect([...welcome()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Turn off tutorials", "Not now", "Start the tutorial"]);
    // Offered on a product of their own, it is kept as offered there, so it comes nowhere again.
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { seen: ["welcome", "welcome-own"] } } });
    // Nothing starts until it is asked for.
    expect(api).toMatchObject({ mode: "welcome", showing: false });
  });

  it("is offered to a guest of the example organization too, kept as offered in the example only", async () => {
    role = "guest";
    example = true;
    kept = { seen: [], off: false };
    await mount();
    expect(welcome()).not.toBeNull();
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { seen: ["welcome"] } } });
  });

  it("is offered once more on a product of their own to someone offered it in the example, and then no more", async () => {
    // Every tutorial seen in the example as a guest, then an organization of their own started.
    role = "admin";
    example = false;
    kept = { seen: ["welcome", "idea", "evidence", "exploration", "story"], off: false };
    await mount();
    expect(welcome()?.textContent).toContain("Take the WhatBuild tutorial?");
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { seen: ["welcome", "welcome-own"] } } });
    await press("Not now");
    expect(kept.seen).toEqual(["welcome", "idea", "evidence", "exploration", "story", "welcome-own"]);
    // A reload: nothing comes, on Idea or on any page, whose tutorials were seen in the example.
    fresh();
    await mount();
    expect(welcome()).toBeNull();
    expect(api?.mode).toBe("off");
    await act(async () => goTo("/t/acme/harvest/evidence"));
    await settle();
    expect(api?.mode).toBe("off");
  });

  it("taken from the account menu on a product of their own before it was offered there, counts as offered there", async () => {
    role = "editor";
    example = false;
    // Offered in the example, then tutorials turned off: nothing comes by itself on their own product.
    kept = { seen: ["welcome"], off: true };
    await mount("/t/acme/harvest/activity");
    expect(welcome()).toBeNull();
    // Beside the product's pages, the account menu offers the welcome.
    const welcomeItem = await menuItemEl();
    expect(welcomeItem?.textContent).toContain("Take the WhatBuild tutorial");
    await act(async () => (welcomeItem as HTMLElement).click());
    await settle(300);
    expect(api).toMatchObject({ mode: "stop", part: "welcome" });
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { seen: ["welcome", "welcome-own"] } } });
  });

  it("is offered to nobody who is a viewer or a Story reader, who was offered it before, or who turned tutorials off", async () => {
    for (const [r, ex, k] of [
      ["viewer", false, { seen: [], off: false }],
      ["story_reader", false, { seen: [], off: false }],
      ["editor", false, { seen: ALL, off: false }],
      ["guest", true, { seen: ALL, off: false }],
      ["editor", false, { seen: [], off: true }],
    ] as const) {
      role = r;
      example = ex;
      kept = { seen: [...k.seen], off: k.off };
      await mount();
      expect(welcome(), r).toBeNull();
      expect(api?.mode, r).toBe("off");
      fresh();
    }
  });

  it("walks the navigation, an agent at work and the empty seat, and leaves Idea's own tutorial for the next visit to Idea", async () => {
    role = "editor";
    example = false;
    kept = { seen: [], off: false };
    await mount();
    await press("Start the tutorial");
    expect(api).toMatchObject({ mode: "stop", part: "welcome", at: 0 });
    // The welcome lights the product's own screen: no examples in place of its content.
    expect(api?.showing).toBe(false);
    expect(title()).toBe("Main navigation");
    expect(count()).toBe("1 of 3");
    // The first stop has no Back.
    expect(foot()).toEqual(["Turn off tutorials", "Next"]);
    await press("Next");
    expect(api?.at).toBe(1);
    expect(title()).toBe("Agents");
    expect(foot()).toEqual(["Turn off tutorials", "Replay", "Back", "Next"]);
    await press("Next");
    expect(title()).toBe("Connect an agent");
    expect(foot()).toEqual(["Back", "Finish", "Connect an agent"]);
    await press("Finish");
    expect(api?.mode).toBe("off");
    expect(document.body.textContent).toContain("Tutorial finished. It stays in your account menu.");
    // Still on Idea: its own tutorial waits.
    await settle();
    expect(api?.mode).toBe("off");
    expect(kept.seen).toEqual(OFFERED);
    // Away and back to Idea, it starts.
    await act(async () => goTo("/t/acme/harvest/activity"));
    await settle();
    expect(api?.mode).toBe("off");
    await act(async () => goTo("/t/acme/harvest/idea"));
    await settle();
    expect(api).toMatchObject({ mode: "stop", part: "idea", at: 0 });
  });

  it("closes with Not now into the account menu, which offers it again", async () => {
    role = "editor";
    example = false;
    kept = { seen: [], off: false };
    await mount("/t/acme/harvest/activity");
    await press("Not now");
    expect(api?.mode).toBe("off");
    expect(document.body.textContent).toContain("The tutorial is in your account menu.");
    const item = await menuItemEl();
    expect(item?.textContent).toContain("Take the WhatBuild tutorial");
    expect(item?.textContent).toContain("3 stops");
  });
});

describe("each page's tutorial", () => {
  it("starts by itself the first time its page is opened, on example content, and is kept as seen", async () => {
    role = "editor";
    example = false;
    for (const [path, part, first, n] of [
      ["/t/acme/harvest/idea", "idea", "Idea", 6],
      ["/t/acme/harvest/evidence", "evidence", "Evidence", 4],
      ["/t/acme/harvest/exploration/mockups/m1", "exploration", "Exploration", 7],
      ["/t/acme/harvest/story", "story", "Story", 4],
    ] as const) {
      kept = { seen: [...OFFERED], off: false };
      await mount(path);
      expect(api, part).toMatchObject({ mode: "stop", part, at: 0, showing: true });
      expect(title(), part).toBe(first);
      expect(count(), part).toBe(`1 of ${n}`);
      expect(calls, part).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { seen: [part] } } });
      fresh();
    }
  });

  it("starts on no other screen, nor on a source's own, nor once seen", async () => {
    role = "editor";
    example = false;
    for (const [path, seen] of [
      ["/t/acme/harvest/activity", OFFERED],
      ["/t/acme/harvest/evidence/rec1", OFFERED],
      ["/t/acme/harvest/evidence", [...OFFERED, "evidence"]],
    ] as const) {
      kept = { seen: [...seen], off: false };
      await mount(path);
      expect(api?.mode, path).toBe("off");
      fresh();
    }
  });

  it("ends without the seat for someone with an agent connected", async () => {
    role = "editor";
    example = false;
    agents = [{ client_name: "Claude" }];
    kept = { seen: [...OFFERED], off: false };
    await mount("/t/acme/harvest/evidence");
    expect(count()).toBe("1 of 3");
    await press("Next");
    await press("Next");
    expect(title()).toBe("Preview");
    expect(foot()).toEqual(["Turn off tutorials", "Back", "Finish"]);
  });

  it("closes with the close button into the account menu, which offers the page's tutorial", async () => {
    role = "editor";
    example = false;
    kept = { seen: [...OFFERED], off: false };
    await mount("/t/acme/harvest/idea");
    await press("Next");
    await press("Close the tutorial");
    expect(api).toMatchObject({ mode: "off", showing: false });
    expect(document.body.textContent).toContain("The tutorial is in your account menu.");
    const item = await menuItemEl();
    expect(item?.textContent).toContain("Take the Idea tutorial");
    expect(item?.textContent).toContain("6 stops");
    // Taken again, it begins at its first stop.
    await act(async () => (item as HTMLElement).click());
    await settle(300);
    expect(api).toMatchObject({ mode: "stop", part: "idea", at: 0 });
  });

  it("from the account menu on a source's own screen, goes to the list of sources and runs there", async () => {
    role = "editor";
    example = false;
    kept = { seen: ALL, off: false };
    await mount("/t/acme/harvest/evidence/rec1");
    const item = await menuItemEl();
    expect(item?.textContent).toContain("Take the Evidence tutorial");
    await act(async () => (item as HTMLElement).click());
    await settle(300);
    expect(at).toBe("/t/acme/harvest/evidence");
    expect(api).toMatchObject({ mode: "stop", part: "evidence", at: 0, showing: true });
  });

  it("leaves its toast up across the product's screens, and takes it away on leaving the product for a screen without the account menu", async () => {
    // A guest closes Evidence's tutorial, then presses Start using WhatBuild for the Welcome form.
    role = "guest";
    example = true;
    kept = { seen: ["welcome"], off: false };
    await mount("/t/acme/harvest/evidence");
    expect(api).toMatchObject({ mode: "stop", part: "evidence" });
    await press("Close the tutorial");
    expect(document.body.textContent).toContain("The tutorial is in your account menu.");
    await act(async () => goTo("/t/acme/harvest/activity"));
    await settle(300);
    expect(document.body.textContent).toContain("The tutorial is in your account menu.");
    await act(async () => goTo("/welcome"));
    await settle(300);
    expect(document.body.textContent).not.toContain("The tutorial is in your account menu.");
    expect(document.querySelector(".toast")).toBeNull();
  });

  it("closes, without a word, when a move it did not make (the browser's Back) leaves its page", async () => {
    role = "editor";
    example = false;
    kept = { seen: [...OFFERED], off: false };
    await mount("/t/acme/harvest/evidence");
    expect(api?.mode).toBe("stop");
    await act(async () => goTo("/t/acme/harvest/story"));
    // The screen arrived at decides what comes next: Story's own tutorial, the first time.
    expect(api?.part).not.toBe("evidence");
    await settle();
    expect(api).toMatchObject({ mode: "stop", part: "story" });
    expect(document.body.textContent).not.toContain("The tutorial is in your account menu.");
  });
});

describe("turning tutorials off", () => {
  it("closes the tutorial, keeps tutorials off on the account, and Undo turns them on again", async () => {
    role = "editor";
    example = false;
    kept = { seen: [...OFFERED], off: false };
    await mount("/t/acme/harvest/story");
    await press("Turn off tutorials");
    expect(api?.mode).toBe("off");
    expect(calls).toContainEqual({ method: "PATCH", path: "/api/v1/me", body: { tutorial: { off: true } } });
    expect(kept.off).toBe(true);
    expect(document.body.textContent).toContain("Tutorials are off. Turn them on again in Settings.");
    const undo = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Undo");
    await act(async () => undo!.click());
    expect(kept.off).toBe(false);
  });

  it("from the welcome, and then no page's tutorial starts by itself", async () => {
    role = "editor";
    example = false;
    kept = { seen: [], off: false };
    await mount();
    await press("Turn off tutorials");
    expect(kept).toEqual({ seen: OFFERED, off: true });
    await act(async () => goTo("/t/acme/harvest/evidence"));
    await settle();
    expect(api?.mode).toBe("off");
  });

  it("leaves each tutorial in the account menu, whose bubble then has no Turn off tutorials", async () => {
    role = "editor";
    example = false;
    kept = { seen: [...OFFERED], off: true };
    await mount("/t/acme/harvest/evidence");
    expect(api?.mode).toBe("off");
    const item = await menuItemEl();
    expect(item?.textContent).toContain("Take the Evidence tutorial");
    await act(async () => (item as HTMLElement).click());
    await settle(300);
    expect(api).toMatchObject({ mode: "stop", part: "evidence" });
    expect(foot()).toEqual(["Next"]);
  });
});

describe("pressing what a stop opens", () => {
  /** Takes the page's tutorial from the account menu, with no motion, and walks it to a stop. */
  async function walkTo(path: string, part: "idea" | "evidence", stop: number) {
    role = "editor";
    example = false;
    kept = { seen: ALL, off: false };
    reduced = true;
    await mount(path);
    await act(async () => api!.start(part, "menu"));
    for (let n = 1; n <= stop; n++) await act(async () => api!.go(n));
  }

  it("waits on More info with the text closed; Next presses it and the text opens; Back folds it again", async () => {
    await walkTo("/t/acme/harvest/idea", "idea", 2);
    expect(api).toMatchObject({ at: 2, reveal: null, opens: null });
    expect(document.querySelector(".tut-title")?.textContent).toBe("More info");
    expect(document.querySelector(".tut-line")?.textContent).toBe("Each card has text behind its picture.");
    // It waits: nothing happens by itself.
    await settle(1200);
    expect(api).toMatchObject({ at: 2, opens: null });
    reduced = false;
    try {
      await act(async () => api!.go(3));
      expect(api).toMatchObject({ at: 3, reveal: "press", opens: null });
      await settle(400);
      expect(api).toMatchObject({ at: 3, reveal: "open", opens: "more-info" });
      expect(document.querySelector(".tut-line")?.textContent).toBe("The same concept in words, for agents to read.");
      await act(async () => api!.go(2));
      expect(api).toMatchObject({ at: 2, reveal: null, opens: null });
      // On to the outcome, and Back: open at once.
      await act(async () => api!.go(3));
      await settle(400);
      await act(async () => api!.go(4));
      await act(async () => api!.go(3));
      expect(api).toMatchObject({ at: 3, reveal: "open", opens: "more-info" });
    } finally {
      reduced = true;
    }
    // With reduced motion, Next opens it at once.
    await act(async () => api!.go(2));
    await act(async () => api!.go(3));
    expect(api).toMatchObject({ at: 3, reveal: "open", opens: "more-info" });
  });

  it("waits on the source's row with the preview closed; Next selects it and opens the preview; Back closes it", async () => {
    await walkTo("/t/acme/harvest/evidence", "evidence", 1);
    expect(api).toMatchObject({ at: 1, reveal: null, opens: null });
    expect(document.querySelector(".tut-title")?.textContent).toBe("Sources");
    await settle(1200);
    expect(api).toMatchObject({ at: 1, opens: null });
    reduced = false;
    try {
      await act(async () => api!.go(2));
      expect(api).toMatchObject({ at: 2, reveal: "press", opens: null });
      await settle(400);
      expect(api).toMatchObject({ at: 2, reveal: "open", opens: "preview" });
      await act(async () => api!.go(1));
      expect(api).toMatchObject({ at: 1, opens: null });
    } finally {
      reduced = true;
    }
  });
});

describe("taking over from the overview", () => {
  it("begins the welcome's first stop when the overview's Start the tutorial brought the person here, and leaves Idea's for later", async () => {
    role = "editor";
    example = false;
    kept = { seen: [...OFFERED], off: false };
    await mount({ pathname: "/t/acme/harvest/idea", state: { tutorial: { part: "welcome", from: "welcome" } } });
    expect(welcome()).toBeNull();
    expect(api).toMatchObject({ mode: "stop", part: "welcome", at: 0 });
    await press("Close the tutorial");
    await settle();
    expect(api?.mode).toBe("off");
  });

  it("begins the tutorial the overview's account menu offered", async () => {
    role = "guest";
    example = true;
    kept = { seen: ALL, off: false };
    await mount({ pathname: "/t/acme/harvest/idea", state: { tutorial: { part: "welcome", from: "menu" } } });
    expect(api).toMatchObject({ mode: "stop", part: "welcome", at: 0 });
  });
});

describe("Focus at the canvas stop", () => {
  it("goes in and out with F, counts as tried, and is off again whichever way the stop is left", async () => {
    role = "editor";
    example = false;
    kept = { seen: ALL, off: false };
    await mount("/t/acme/harvest/exploration/mockups");
    await act(async () => api!.start("exploration", "menu"));
    await act(async () => api!.go(1));
    expect(api).toMatchObject({ at: 1, focus: false });
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(true);
    expect(api?.hit.has("f")).toBe(true);
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(false);
    // Next, and Back, from Focus: the next stop has its panels.
    await act(async () => api!.toggleFocus());
    await act(async () => api!.go(2));
    expect(api).toMatchObject({ at: 2, focus: false });
    await act(async () => api!.go(1));
    await act(async () => api!.toggleFocus());
    await act(async () => api!.go(0));
    expect(api).toMatchObject({ at: 0, focus: false });
    // F does nothing at any other stop.
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(false);
    // Closed from Focus.
    await act(async () => api!.go(1));
    await act(async () => api!.toggleFocus());
    expect(api?.focus).toBe(true);
    await press("Close the tutorial");
    expect(api).toMatchObject({ mode: "off", focus: false });
  });
});

describe("in a window narrower than 1024 pixels", () => {
  it("offers nothing and no menu item at 1023 wide, and the welcome at 1024", async () => {
    role = "editor";
    example = false;
    try {
      width = 1023;
      kept = { seen: [], off: false };
      await mount();
      expect(welcome()).toBeNull();
      expect(api?.eligible).toBe(false);
      fresh();
      width = 1024;
      kept = { seen: [], off: false };
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
      if (l.key) expect(toolTitle(id).endsWith(`(${l.key})`), id).toBe(true);
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
