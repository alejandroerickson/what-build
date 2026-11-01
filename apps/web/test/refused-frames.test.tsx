import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMinute, FRAME_RELOADS, PUT_BACKS_A_MINUTE } from "../src/lib/minute.ts";
import { Canvas, type CanvasPage, type CanvasVersion } from "../src/routes/mockup-canvas.tsx";

// A frame refused for the minute's calls answers with a short page, which tells the app so. The app
// alone brings it back, as a new frame at the page's own address, so the check that puts back a
// page replaced in its frame stands as it was. It does so a bounded number of times, one frame at a
// time, and never before the minute has turned.

vi.mock("../src/lib/session.tsx", async (original) => ({ ...(await original<object>()), useProduct: () => ({ app: "/t/acme/core/planner", api: "/api/v1/p/acme/core/planner" }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The theme module reads the system's scheme as it loads, and the Story's screen brings it in.
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as never;
const { StoryFrame } = await import("../src/routes/story.tsx");

const LIMIT = 50;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const pagesOf = (n: number): CanvasPage[] => Array.from({ length: n }, (_, i) => ({ page_id: `page-${i}`, title: `Page ${i}`, width: 400, height: 300 }));

let root: Root | null = null;
let host: HTMLDivElement;

function draw(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<MemoryRouter>{node}</MemoryRouter>));
}

function showCanvas(n: number, prototype = false) {
  const pages = pagesOf(n).map((p) => (prototype ? { ...p, prototype_url: `/prototypes/grant/${p.page_id}.html` } : p));
  const version: CanvasVersion = { version: 1, title: "Sample canvas", columns: null, pages, ...(prototype ? { prototype: { base_url: "/prototypes/grant/", expires_at: "2099-01-01T00:00:00Z", sandbox: "allow-scripts" } } : {}) };
  draw(<Canvas version={version} pageSrc={(p) => `about:blank#${p.page_id}`} selected={null} onSelect={() => {}} onKey={() => {}} canFocus pageView="fit" onPageView={() => {}} showRequest={0} />);
}

const frames = () => [...host.querySelectorAll("iframe")];
/** The page in a frame saying it was refused, as the document the server answers with does. */
function refuse(frame: HTMLIFrameElement, seconds = 20, source: Window | null = frame.contentWindow) {
  act(() => window.dispatchEvent(new MessageEvent("message", { source, data: { whatbuild: "frame-refused", retry_after_seconds: seconds, limit: LIMIT } })));
}
const loaded = (frame: HTMLIFrameElement) => act(() => frame.dispatchEvent(new Event("load")));

beforeEach(() => {
  vi.useFakeTimers();
  forgetMinute();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  forgetMinute();
  document.body.innerHTML = "";
});

describe("a page on a canvas, refused", () => {
  it("is asked for again as a new frame once the minute has turned, and nothing calls it replaced", async () => {
    showCanvas(1);
    const first = frames()[0]!;
    loaded(first);
    refuse(first, 20);
    await advance(19_500);
    expect(frames()[0]).toBe(first);
    await advance(30_000);
    const second = frames()[0]!;
    expect(second).not.toBe(first);
    expect(second.getAttribute("src")).toBe(first.getAttribute("src"));
    expect(second.getAttribute("sandbox")).toBe(first.getAttribute("sandbox"));
    loaded(second);
    expect(host.querySelector(".xc-replaced")).toBeNull();
  });

  it("is still put back and said to be when something loads in its place afterwards: coming back spends nothing of that check", async () => {
    showCanvas(1);
    const first = frames()[0]!;
    loaded(first);
    refuse(first, 20);
    await advance(50_000);
    const second = frames()[0]!;
    loaded(second);
    expect(host.querySelector(".xc-replaced")).toBeNull();
    loaded(second);
    expect(frames()[0]).not.toBe(second);
    expect(host.querySelector(".xc-replaced")?.textContent).toContain("tried to open another address");
  });

  it("cannot use a refusal as cover: a page that says it was refused and then loads another address is put back at once", async () => {
    showCanvas(1);
    const first = frames()[0]!;
    loaded(first);
    refuse(first, 20);
    loaded(first);
    expect(frames()[0]).not.toBe(first);
    expect(host.querySelector(".xc-replaced")?.textContent).toContain("tried to open another address");
  });

  it("stops being shown when it keeps replacing itself: each new frame is a call, and a page reloading itself would spend every minute's", async () => {
    showCanvas(1);
    let made = 1;
    for (let i = 0; i < 50 && frames()[0]; i++) {
      const f = frames()[0]!;
      // The page loads, then something loads in its place.
      loaded(f);
      loaded(f);
      if (frames()[0] && frames()[0] !== f) made++;
      await advance(200);
    }
    expect(made).toBe(1 + PUT_BACKS_A_MINUTE);
    expect(frames()).toHaveLength(0);
    expect(host.textContent).toContain("stopped showing it");
    await advance(10 * 60_000);
    expect(frames()).toHaveLength(0);
  });

  it("is still put back, however often, when that is slow enough to cost little", async () => {
    showCanvas(1);
    let made = 1;
    for (let i = 0; i < 12; i++) {
      const f = frames()[0]!;
      loaded(f);
      loaded(f);
      expect(frames()[0]).not.toBe(f);
      made++;
      await advance(30_000);
    }
    expect(made).toBe(13);
    expect(host.textContent).not.toContain("stopped showing it");
  });

  it("hears only its own frame", async () => {
    showCanvas(2);
    const [a, b] = frames() as [HTMLIFrameElement, HTMLIFrameElement];
    refuse(a, 20, window);
    refuse(a, 20, null);
    await advance(120_000);
    expect(frames()[0]).toBe(a);
    expect(frames()[1]).toBe(b);
    act(() => window.dispatchEvent(new MessageEvent("message", { source: a.contentWindow, data: { whatbuild: "something-else", retry_after_seconds: 1 } })));
    await advance(120_000);
    expect(frames()[0]).toBe(a);
  });

  it("is asked for at most a few times, however often it says it was refused, then waits for the person", async () => {
    showCanvas(1);
    let reloads = 0;
    let frame = frames()[0]!;
    for (let i = 0; i < 20; i++) {
      for (let said = 0; said < 5; said++) refuse(frame);
      await advance(120_000);
      const now = frames()[0];
      if (!now) break;
      if (now !== frame) reloads++;
      frame = now;
    }
    expect(reloads).toBe(FRAME_RELOADS);
    expect(FRAME_RELOADS).toBeLessThan(5);
    expect(frames()).toHaveLength(0);
    expect(host.textContent).toContain("didn’t come back");
    await advance(30 * 60_000);
    expect(frames()).toHaveLength(0);
    const tryAgain = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    await act(async () => tryAgain.click());
    await advance(5_000);
    expect(frames()).toHaveLength(1);
    expect(host.textContent).not.toContain("didn’t come back");
    // The person's asking is the first of as many asks again, and no more.
    frame = frames()[0]!;
    reloads = 1;
    for (let i = 0; i < 20; i++) {
      refuse(frame);
      await advance(120_000);
      const now = frames()[0];
      if (!now) break;
      if (now !== frame) reloads++;
      frame = now;
    }
    expect(reloads).toBe(FRAME_RELOADS);
  });

  it("does not bring many frames back in one instant, or spend the next minute at once", async () => {
    showCanvas(40);
    const refused = frames();
    const replaced = (i: number) => frames()[i] !== refused[i];
    refused.forEach((f) => refuse(f, 20));
    await advance(19_900);
    expect(refused.filter((_, i) => replaced(i))).toHaveLength(0);
    const cameBack = new Map<number, number>();
    const started = Date.now();
    for (let at = 0; at < 60_000; at += 100) {
      await advance(100);
      refused.forEach((_, i) => {
        if (replaced(i) && !cameBack.has(i)) cameBack.set(i, Date.now() - started);
      });
    }
    const times = [...cameBack.values()].sort((a, b) => a - b);
    // Half the minute's calls at most, the rest left for what the person does.
    const inTheMinute = times.filter((t) => t < times[0]! + 60_000);
    expect(inTheMinute.length).toBeLessThanOrEqual(LIMIT / 2 + 1);
    expect(inTheMinute.length).toBeGreaterThan(5);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(2_300);
    expect(new Set(times).size).toBe(times.length);
  });

  it("holds the rest back when one is refused again, so a minute taken by something else costs one call", async () => {
    showCanvas(6);
    const refused = frames();
    refused.forEach((f) => refuse(f, 20));
    // The first turn comes after the minute, and is refused again.
    let first = -1;
    for (let at = 0; at < 40_000 && first < 0; at += 100) {
      await advance(100);
      first = frames().findIndex((f, i) => f !== refused[i]);
    }
    expect(first).toBeGreaterThanOrEqual(0);
    refuse(frames()[first]!, 60);
    await advance(50_000);
    expect(frames().filter((f, i) => f !== refused[i])).toHaveLength(1);
    await advance(20_000);
    expect(frames().filter((f, i) => f !== refused[i]).length).toBeGreaterThan(1);
  });

  it("is forgotten when the person leaves the screen", async () => {
    showCanvas(3);
    frames().forEach((f) => refuse(f, 20));
    act(() => root!.unmount());
    root = null;
    await advance(120_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says so at screen size above the board while it waits, and offers Try again once WhatBuild stops asking", async () => {
    showCanvas(1);
    expect(host.querySelector(".xc-note")).toBeNull();
    refuse(frames()[0]!, 20);
    expect(host.querySelector(".xc-note")?.textContent).toContain("Waiting for the next minute");
    expect(host.querySelector('.xc-note[role="status"]')).not.toBeNull();
    for (let i = 0; i < 8; i++) {
      const f = frames()[0];
      if (f) refuse(f);
      await advance(120_000);
    }
    expect(host.querySelector(".xc-note")?.textContent).toContain("1 page didn’t come back");
    expect(host.querySelector(".xc-note button")?.textContent).toBe("Try again");
  });

  it("in a prototype, takes no such word from the frame: a prototype's route meets no limit, and only its own documents speak there", async () => {
    showCanvas(1, true);
    const first = frames()[0]!;
    refuse(first, 20);
    await advance(120_000);
    expect(frames()[0]).toBe(first);
    expect(host.querySelector(".xc-note")).toBeNull();
  });
});

describe("a Story page, refused", () => {
  const story = () => draw(<StoryFrame title="Overview" scheme="light" src="/api/v1/p/acme/core/planner/story/pages/overview/versions/1/html?theme=light" />);

  it("keeps its sandbox and its address, comes back by itself, and shows the skeleton while it does", async () => {
    story();
    const first = frames()[0]!;
    const sandbox = first.getAttribute("sandbox");
    const src = first.getAttribute("src");
    expect(src).toContain("frame=1");
    loaded(first);
    expect(host.querySelector(".story-frame-status")).toBeNull();
    refuse(first, 20);
    await advance(40_000);
    const second = frames()[0]!;
    expect(second).not.toBe(first);
    expect(second.getAttribute("src")).toBe(src);
    expect(second.getAttribute("sandbox")).toBe(sandbox);
    expect(host.querySelector(".story-frame-status")).not.toBeNull();
    loaded(second);
    expect(host.querySelector(".story-frame-status")).toBeNull();
    expect(host.textContent).not.toContain("tried to open another address");
  });

  it("is put back as before when something else loads in its place", async () => {
    story();
    const first = frames()[0]!;
    loaded(first);
    loaded(first);
    expect(frames()[0]).not.toBe(first);
    expect(host.textContent).toContain("tried to open another address");
  });

  it("stops being shown when it keeps replacing itself", async () => {
    story();
    let made = 1;
    for (let i = 0; i < 50 && frames()[0]; i++) {
      const f = frames()[0]!;
      loaded(f);
      loaded(f);
      if (frames()[0] && frames()[0] !== f) made++;
      await advance(200);
    }
    expect(made).toBe(1 + PUT_BACKS_A_MINUTE);
    expect(frames()).toHaveLength(0);
    expect(host.textContent).toContain("WhatBuild stopped showing it");
  });

  it("past the bound leaves the app standing and offers Try again in the reading pane", async () => {
    story();
    for (let i = 0; i < 10; i++) {
      const f = frames()[0];
      if (f) refuse(f);
      await advance(120_000);
    }
    expect(frames()).toHaveLength(0);
    expect(host.textContent).toContain("didn’t come back");
    const tryAgain = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    await act(async () => tryAgain.click());
    // Refused moments ago, so its turn is to come; it says so rather than sit there unchanged.
    expect(host.textContent).not.toContain("didn’t come back");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await advance(5_000);
    expect(frames()).toHaveLength(1);
  });
});
