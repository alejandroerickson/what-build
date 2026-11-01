import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMinute, FRAME_RELOADS, FRAME_SPACING_MS, minuteRefused, PAGE_PUT_BACKS_A_MINUTE, PUT_BACK_WAITS, SCREEN_PUT_BACKS_A_MINUTE, SETTLES_AFTER_MS, useMinuteWait, type MinuteWait } from "../src/lib/minute.ts";
import { Canvas, type CanvasPage, type CanvasVersion } from "../src/routes/mockup-canvas.tsx";
import { FrameStopped, Loading, MinuteAnnouncer } from "../src/ui/index.tsx";

// A frame refused for the minute's calls answers with a short page, which tells the app so. The app
// alone brings it back, as a new frame at the page's own address, so the check that puts back a
// page replaced in its frame stands as it was. It does so a bounded number of times, one frame at a
// time, and never before the minute has turned. Each new frame is a call, so a page that keeps being
// replaced in its frame waits, and in time stops, and no page is gone for good.

vi.mock("../src/lib/session.tsx", async (original) => ({ ...(await original<object>()), useProduct: () => ({ app: "/t/acme/core/planner", api: "/api/v1/p/acme/core/planner" }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Some of these live through many minutes on the fake clock, one render at a time.
vi.setConfig({ testTimeout: 60_000 });

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

/** `prototypes` of the pages, the first ones, enter the version's prototype. */
function showCanvas(n: number, prototype: boolean | number = false) {
  const entering = prototype === true ? n : Number(prototype);
  const pages = pagesOf(n).map((p, i) => (i < entering ? { ...p, prototype_url: `/prototypes/grant/${p.page_id}.html` } : p));
  const version: CanvasVersion = { version: 1, title: "Sample canvas", columns: null, pages, ...(entering ? { prototype: { base_url: "/prototypes/grant/", expires_at: "2099-01-01T00:00:00Z", sandbox: "allow-scripts" } } : {}) };
  draw(<Canvas version={version} pageSrc={(p) => `about:blank#${p.page_id}`} selected={null} onSelect={() => {}} onKey={() => {}} canFocus pageView="fit" onPageView={() => {}} showRequest={0} />);
}

const frames = () => [...host.querySelectorAll("iframe")];
/** The page in a frame saying it was refused, as the document the server answers with does. */
function refuse(frame: HTMLIFrameElement, seconds = 20, source: Window | null = frame.contentWindow) {
  act(() => window.dispatchEvent(new MessageEvent("message", { source, data: { whatbuild: "frame-refused", retry_after_seconds: seconds, limit: LIMIT } })));
}
const loaded = (frame: HTMLIFrameElement) => act(() => frame.dispatchEvent(new Event("load")));
/** A frame's window saying anything at all. */
const says = (frame: HTMLIFrameElement, data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data })));
/** The frame of one page on a canvas, if it has one on show. */
const frameOf = (i: number) => host.querySelector<HTMLIFrameElement>(`[data-page="page-${i}"] iframe`);
const noteOf = (i: number) => host.querySelector(`[data-page="page-${i}"] .xc-refused`)?.textContent ?? "";
/** A page that reloads itself as soon as it has loaded. */
function reloadsItself(frame: HTMLIFrameElement) {
  loaded(frame);
  loaded(frame);
}
function setHidden(isHidden: boolean) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(isHidden ? "hidden" : "visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}
/** What the app knows of the wait, as anything on screen reads it. */
function watchMinute() {
  let seen: MinuteWait;
  function Probe() {
    seen = useMinuteWait();
    return null;
  }
  const r = createRoot(document.createElement("div"));
  act(() => r.render(<Probe />));
  return { now: () => seen, stop: () => act(() => r.unmount()) };
}
const tryAgain = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");

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

  it("goes on being put back, however long, when that stays within what a minute allows", async () => {
    showCanvas(1);
    for (let i = 0; i < 12; i++) {
      const f = frames()[0]!;
      reloadsItself(f);
      expect(frames()[0]).not.toBe(f);
      await advance(30_000);
    }
    expect(host.querySelector(".xc-refused")).toBeNull();
    expect(host.querySelector(".xc-note")).toBeNull();
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

  it("takes nothing but that exact message for a refusal", async () => {
    showCanvas(1);
    const f = frames()[0]!;
    const status = watchMinute();
    for (const data of [
      null,
      "frame-refused",
      20,
      {},
      { whatbuild: "frame-refused" },
      { whatbuild: "frame-refused", retry_after_seconds: "20" },
      { whatbuild: "frame-refused", retry_after_seconds: Number.NaN },
      { whatbuild: "frame-refused", retry_after_seconds: null },
      { whatbuild: "frame-refused", retry_after_seconds: { valueOf: () => 20 } },
      { whatbuild: "frame-ready", retry_after_seconds: 20 },
      { retry_after_seconds: 20 },
    ])
      says(f, data);
    expect(status.now()).toMatchObject({ waiting: false, frames: 0, stopped: 0 });
    await advance(120_000);
    expect(frames()[0]).toBe(f);
    status.stop();
  });

  it("keeps a fixed pace whatever a frame's message says of a limit: none stalls the rest, and none lifts the pace", async () => {
    for (const limit of [5e-324, 1e9, -1, 0, Number.POSITIVE_INFINITY, "soon"]) {
      forgetMinute();
      showCanvas(6);
      const refused = frames();
      refused.forEach((f) => says(f, { whatbuild: "frame-refused", retry_after_seconds: 20, limit }));
      const times: number[] = [];
      for (let at = 0; at < 60_000 && times.length < refused.length; at += 100) {
        await advance(100);
        const back = refused.filter((f, i) => frames()[i] !== f).length;
        while (times.length < back) times.push(Date.now());
      }
      expect(times, String(limit)).toHaveLength(refused.length);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! - times[i - 1]!, String(limit)).toBeGreaterThanOrEqual(FRAME_SPACING_MS);
        expect(times[i]! - times[i - 1]!, String(limit)).toBeLessThanOrEqual(FRAME_SPACING_MS + 100);
      }
      act(() => root!.unmount());
      root = null;
    }
  });

  it("holds a frame's wait to between 1 and 60 seconds", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const status = watchMinute();
    // The wait, the reads' five seconds, then its turn.
    for (const [said, wait] of [[5e-324, 1], [0, 1], [-5, 1], [1e9, 60], [Number.POSITIVE_INFINITY, 60], [61, 60], [20, 20]] as const) {
      forgetMinute();
      showCanvas(1);
      const f = frames()[0]!;
      says(f, { whatbuild: "frame-refused", retry_after_seconds: said });
      expect(status.now().waiting, String(said)).toBe(true);
      await advance(wait * 1000 - 100);
      expect(status.now().waiting, String(said)).toBe(true);
      await advance(200);
      expect(status.now().waiting, String(said)).toBe(false);
      await advance(4_700);
      expect(frames()[0], String(said)).toBe(f);
      await advance(200);
      expect(frames()[0], String(said)).not.toBe(f);
      act(() => root!.unmount());
      root = null;
    }
    status.stop();
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
    await act(async () => tryAgain()!.click());
    // In place of the frame until its turn: the board no longer says it didn't come back, and neither does the page.
    expect(host.textContent).not.toContain("didn’t come back");
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

  it("says it is coming back, once the person has asked, until its turn comes", async () => {
    showCanvas(1);
    for (let i = 0; i < 8 && frames()[0]; i++) {
      refuse(frames()[0]!);
      await advance(120_000);
    }
    expect(noteOf(0)).toBe("This page didn’t come back.");
    act(() => minuteRefused(20));
    await act(async () => tryAgain()!.click());
    expect(frames()).toHaveLength(0);
    expect(noteOf(0)).toBe("This page is coming back.");
    await advance(30_000);
    expect(frames()).toHaveLength(1);
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
    const status = watchMinute();
    frames().forEach((f) => refuse(f, 60));
    expect(status.now().frames).toBe(3);
    act(() => root!.unmount());
    root = null;
    // While the wait still has most of a minute to run, so the queue has not drained by itself.
    expect(status.now().frames).toBe(0);
    await advance(120_000);
    expect(vi.getTimerCount()).toBe(0);
    status.stop();
  });

  it("takes nothing with it when the person leaves the screen after WhatBuild stopped asking", async () => {
    showCanvas(1);
    const status = watchMinute();
    for (let i = 0; i < 8 && frames()[0]; i++) {
      refuse(frames()[0]!);
      await advance(120_000);
    }
    expect(status.now().stopped).toBe(1);
    act(() => root!.unmount());
    root = null;
    expect(status.now().stopped).toBe(0);
    status.stop();
  });

  it("takes no turn while the tab is hidden, and takes them up one at a time when it is visible again", async () => {
    showCanvas(3);
    const refused = frames();
    const back = () => refused.filter((f, i) => frames()[i] !== f).length;
    refused.forEach((f) => refuse(f, 20));
    setHidden(true);
    await advance(10 * 60_000);
    expect(back()).toBe(0);
    setHidden(false);
    await advance(100);
    expect(back()).toBe(1);
    await advance(FRAME_SPACING_MS - 200);
    expect(back()).toBe(1);
    await advance(200);
    expect(back()).toBe(2);
    await advance(FRAME_SPACING_MS);
    expect(back()).toBe(3);
  });

  it("says so at screen size above the board while it waits, and offers Try again once WhatBuild stops asking", async () => {
    showCanvas(1);
    expect(host.querySelector(".xc-note")).toBeNull();
    refuse(frames()[0]!, 20);
    expect(host.querySelector(".xc-note")?.textContent).toContain("Waiting for the next minute");
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

describe("the bounds", () => {
  it("are these, and nothing a page sends changes them", () => {
    expect(FRAME_SPACING_MS).toBe(2_400);
    expect(FRAME_RELOADS).toBe(3);
    expect(SCREEN_PUT_BACKS_A_MINUTE).toBe(10);
    expect(PAGE_PUT_BACKS_A_MINUTE).toBe(3);
    expect(PUT_BACK_WAITS).toBe(3);
    expect(SETTLES_AFTER_MS).toBe(60_000);
  });
});

describe("a page that keeps being replaced in its frame", () => {
  /** Reloads the page at once, whenever it is on show, until `ms` have passed; how many new frames that made. */
  async function keepReloading(ms: number) {
    let made = 0;
    let last: HTMLIFrameElement | undefined;
    for (let at = 0; at < ms; at += 200) {
      const f = frames()[0];
      if (f) {
        if (last && f !== last) made++;
        last = f;
        reloadsItself(f);
        if (frames()[0] && frames()[0] !== f) {
          made++;
          last = frames()[0];
        }
      }
      await advance(200);
    }
    return made;
  }

  it("is put back at most three times a minute, then waits with a note and no frame, then comes back by itself", async () => {
    showCanvas(1);
    for (let i = 0; i < PAGE_PUT_BACKS_A_MINUTE; i++) {
      const f = frames()[0]!;
      reloadsItself(f);
      expect(frames()[0]).not.toBe(f);
      expect(host.querySelector(".xc-replaced")?.textContent).toContain("tried to open another address");
      await advance(200);
    }
    reloadsItself(frames()[0]!);
    // What took the page's place is not left on show while it waits.
    expect(frames()).toHaveLength(0);
    expect(noteOf(0)).toBe("This page keeps reloading. It comes back with the next minute.");
    expect(host.querySelector(".xc-note")?.textContent).toContain("1 page keeps reloading");
    expect(host.querySelector(".xc-note button")).toBeNull();
    await advance(58_000);
    expect(frames()).toHaveLength(0);
    await advance(2_000);
    expect(frames()).toHaveLength(1);
    expect(noteOf(0)).toBe("");
    expect(host.querySelector(".xc-note")).toBeNull();
  });

  it("stops after three waits in a row without settling, blaming no one, until Try again starts it afresh", async () => {
    showCanvas(1);
    const made = await keepReloading(4 * 60_000);
    // Three in the first minute, three after each of the first two waits, and one after the third.
    expect(made).toBe(PAGE_PUT_BACKS_A_MINUTE * PUT_BACK_WAITS + 1);
    expect(frames()).toHaveLength(0);
    expect(noteOf(0)).toContain("keeps reloading");
    expect(host.textContent).not.toContain("another address");
    expect(host.querySelector(".xc-note")?.textContent).toContain("1 page keeps reloading");
    await advance(30 * 60_000);
    expect(frames()).toHaveLength(0);
    await act(async () => tryAgain()!.click());
    await advance(100);
    expect(frames()).toHaveLength(1);
    expect(host.querySelector(".xc-replaced")).toBeNull();
    expect(host.querySelector(".xc-note")).toBeNull();
    // Afresh: the first of three in its minute, and all the waits before it stops again.
    expect(await keepReloading(4 * 60_000)).toBe(PAGE_PUT_BACKS_A_MINUTE * PUT_BACK_WAITS);
    expect(frames()).toHaveLength(0);
  });

  it("counts no wait against a page that has settled since", async () => {
    showCanvas(1);
    // Up to the third wait's end: one more replacement would stop it.
    await keepReloading(2 * 60_000 + 30_000);
    for (let at = 0; at < 60_000 && !frames()[0]; at += 200) await advance(200);
    expect(frames()).toHaveLength(1);
    await advance(SETTLES_AFTER_MS);
    const f = frames()[0]!;
    reloadsItself(f);
    expect(frames()[0]).toBeDefined();
    expect(frames()[0]).not.toBe(f);
    expect(host.querySelector(".xc-note")).toBeNull();
    // And it has all its waits again.
    expect(await keepReloading(90_000)).toBeGreaterThanOrEqual(PAGE_PUT_BACKS_A_MINUTE);
    expect(noteOf(0)).toContain("comes back with the next minute");
  });

  it("starts afresh when the person leaves the screen and comes back, so no page is gone for good", async () => {
    showCanvas(1);
    await keepReloading(4 * 60_000);
    expect(frames()).toHaveLength(0);
    act(() => root!.unmount());
    root = null;
    showCanvas(1);
    expect(frames()).toHaveLength(1);
    for (let i = 0; i < PAGE_PUT_BACKS_A_MINUTE; i++) {
      const f = frames()[0]!;
      reloadsItself(f);
      expect(frames()[0]).toBeDefined();
      expect(frames()[0]).not.toBe(f);
    }
  });

  it("is one of at most ten a screen puts back in a minute: the others wait, then come back at the pace of frames", async () => {
    const pages = SCREEN_PUT_BACKS_A_MINUTE + 2;
    showCanvas(pages);
    const first = pages - 1;
    for (let i = 0; i < pages; i++) reloadsItself(frameOf(i)!);
    for (let i = 0; i < SCREEN_PUT_BACKS_A_MINUTE; i++) expect(frameOf(i), `page ${i}`).not.toBeNull();
    expect(frameOf(first - 1)).toBeNull();
    expect(frameOf(first)).toBeNull();
    expect(noteOf(first)).toContain("comes back with the next minute");
    expect(host.querySelector(".xc-note")?.textContent).toContain("2 pages keep reloading");
    await advance(59_000);
    expect(frameOf(first - 1)).toBeNull();
    await advance(1_100);
    expect(frameOf(first - 1)).not.toBeNull();
    expect(frameOf(first)).toBeNull();
    await advance(FRAME_SPACING_MS);
    expect(frameOf(first)).not.toBeNull();
  });

  it("gives the next screen a minute of its own: leaving starts the screen's count afresh too", async () => {
    showCanvas(SCREEN_PUT_BACKS_A_MINUTE + 1);
    for (let i = 0; i <= SCREEN_PUT_BACKS_A_MINUTE; i++) reloadsItself(frameOf(i)!);
    expect(frameOf(SCREEN_PUT_BACKS_A_MINUTE)).toBeNull();
    act(() => root!.unmount());
    root = null;
    showCanvas(1);
    const f = frames()[0]!;
    reloadsItself(f);
    expect(frames()[0]).toBeDefined();
    expect(frames()[0]).not.toBe(f);
  });

  it("costs at most ten new frames in any minute on a canvas of pages reloading every 21 seconds, until they stop, and Try again brings them back", async () => {
    showCanvas(20);
    const status = watchMinute();
    const made: number[] = [];
    const known = new Map<number, { frame: HTMLIFrameElement; born: number }>();
    const started = Date.now();
    for (let at = 0; at < 60 * 60_000; at += 1_000) {
      for (let i = 0; i < 20; i++) {
        const f = frameOf(i);
        if (f && known.get(i)?.frame !== f) {
          if (known.has(i)) made.push(Date.now());
          known.set(i, { frame: f, born: Date.now() });
          loaded(f);
        }
      }
      for (let i = 0; i < 20; i++) {
        const k = known.get(i);
        if (k && frameOf(i) === k.frame && Date.now() - k.born >= 21_000) loaded(k.frame);
      }
      if (status.now().reloadingStopped === 20) break;
      await advance(1_000);
    }
    // Each stops after three times three, and the one after the third wait: never a loop.
    expect(frames()).toHaveLength(0);
    expect(made.length).toBeLessThanOrEqual(20 * (PAGE_PUT_BACKS_A_MINUTE * PUT_BACK_WAITS + 1));
    // Seen once a second, so up to a second after each was made: 59 seconds of seeing them lies within a minute of making them.
    for (const t of made) expect(made.filter((u) => u >= t && u < t + 59_000).length).toBeLessThanOrEqual(SCREEN_PUT_BACKS_A_MINUTE);
    expect(Date.now() - started).toBeLessThan(60 * 60_000);
    expect(host.querySelector(".xc-note")?.textContent).toContain("20 pages keep reloading");
    await act(async () => tryAgain()!.click());
    await advance(100);
    expect(frames()).toHaveLength(1);
    await advance(FRAME_SPACING_MS);
    expect(frames()).toHaveLength(2);
    status.stop();
  });

  it("is not put back while the tab is hidden, and comes back at the pace of frames when it is visible again", async () => {
    showCanvas(3);
    const was = frames();
    was.forEach(loaded);
    setHidden(true);
    was.forEach(loaded);
    expect(frames()).toHaveLength(0);
    await advance(10 * 60_000);
    expect(frames()).toHaveLength(0);
    setHidden(false);
    expect(noteOf(1)).toBe("This page is coming back.");
    await advance(100);
    expect(frames()).toHaveLength(1);
    await advance(FRAME_SPACING_MS - 200);
    expect(frames()).toHaveLength(1);
    await advance(200);
    expect(frames()).toHaveLength(2);
    await advance(FRAME_SPACING_MS);
    expect(frames()).toHaveLength(3);
    // Hidden is no sign of a page reloading too often.
    expect(host.querySelector(".xc-note")).toBeNull();
  });

  it("said to be refused and then replaced comes back once, not again at the turn it was waiting for", async () => {
    showCanvas(1);
    const first = frames()[0]!;
    loaded(first);
    refuse(first, 20);
    loaded(first);
    const put = frames()[0]!;
    expect(put).not.toBe(first);
    loaded(put);
    await advance(120_000);
    expect(frames()[0]).toBe(put);
  });

  it("in a prototype costs no calls, so it is put back at once however often, hidden or not, and takes nothing from the rest", async () => {
    // A prototype's page, and a page that counts.
    showCanvas(2, 1);
    const counted = frameOf(1)!;
    loaded(counted);
    const notReady = async () => {
      const f = frameOf(0)!;
      loaded(f);
      await advance(1_500);
      expect(frameOf(0)).not.toBeNull();
      expect(frameOf(0)).not.toBe(f);
    };
    for (let i = 0; i < 30; i++) await notReady();
    setHidden(true);
    for (let i = 0; i < 5; i++) await notReady();
    setHidden(false);
    expect(host.querySelector(".xc-refused")).toBeNull();
    expect(host.querySelector(".xc-note")).toBeNull();
    expect(host.querySelector('[data-page="page-0"] .xc-replaced')?.textContent).toContain("tried to open another address");
    // The other page's minute is whole.
    await advance(60_000);
    for (let i = 0; i < PAGE_PUT_BACKS_A_MINUTE; i++) {
      const f = frameOf(1)!;
      reloadsItself(f);
      expect(frameOf(1)).not.toBeNull();
    }
  });

  it("in a prototype moves between the prototype's documents, and a link to a missing file comes back to its entry", async () => {
    showCanvas(1, true);
    const entry = frames()[0]!;
    // One of its documents says so, then its frame loads: another document, then another.
    for (let i = 0; i < 20; i++) {
      says(entry, { whatbuild: "frame-ready" });
      loaded(entry);
      await advance(2_000);
    }
    expect(frames()[0]).toBe(entry);
    expect(host.querySelector(".xc-replaced")).toBeNull();
    // A missing file answers plain words, which say nothing.
    loaded(entry);
    await advance(1_400);
    expect(frames()[0]).toBe(entry);
    await advance(200);
    expect(frames()[0]).not.toBe(entry);
    expect(frames()[0]!.getAttribute("src")).toBe(entry.getAttribute("src"));
    expect(host.querySelector(".xc-replaced")?.textContent).toContain("WhatBuild put it back");
  });
});

describe("what a screen reader is told", () => {
  /** The region as the app mounts it, apart from what is on screen. */
  function announcer() {
    const place = document.createElement("div");
    document.body.append(place);
    const r = createRoot(place);
    act(() => r.render(<MinuteAnnouncer />));
    return { region: place.querySelector('[role="status"][aria-live="polite"]')!, stop: () => act(() => r.unmount()) };
  }

  it("hears the wait from a region mounted before it, and hears it stop", async () => {
    const { region, stop } = announcer();
    expect(region.textContent).toBe("");
    minuteRefused(20);
    await advance(200);
    expect(document.querySelector("[data-minute-announcer]")).toBe(region);
    expect(region.textContent).toContain("Waiting for the next minute");
    await advance(21_000);
    expect(region.textContent).toBe("");
    stop();
  });

  it("hears a region that is mounted when the wait has already begun, as a change", async () => {
    minuteRefused(20);
    const { region, stop } = announcer();
    expect(region.textContent).toBe("");
    await advance(200);
    expect(region.textContent).toContain("Waiting for the next minute");
    stop();
  });

  it("is not held back by a loading place while it waits, and hears it once however many are loading", async () => {
    const { region, stop } = announcer();
    draw(
      <>
        <Loading label="Loading sources…" />
        <Loading label="Loading mockups…" />
      </>,
    );
    expect(host.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(2);
    minuteRefused(20);
    await advance(200);
    expect(host.textContent).toContain("Waiting for the next minute");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(region.textContent).toContain("Waiting for the next minute");
    stop();
  });

  it("hears a canvas's pages stop, and focus stays with the board when Try again goes", async () => {
    const { region, stop } = announcer();
    showCanvas(1);
    for (let i = 0; i < 8 && frames()[0]; i++) {
      refuse(frames()[0]!);
      await advance(120_000);
    }
    expect(region.textContent).toContain("didn’t come back");
    expect(host.querySelector('.xc-note [role="status"]')).toBeNull();
    const button = tryAgain()!;
    button.focus();
    await act(async () => button.click());
    expect(button.isConnected).toBe(false);
    const board = host.querySelector(".xc-viewport");
    expect(document.activeElement).toBe(board);
    await advance(5_000);
    expect(document.activeElement).toBe(board);
    stop();
  });

  it("hears a page that keeps reloading, and that it comes back", async () => {
    const { region, stop } = announcer();
    showCanvas(1);
    for (let i = 0; i <= PAGE_PUT_BACKS_A_MINUTE; i++) reloadsItself(frames()[0]!);
    await advance(200);
    expect(region.textContent).toContain("keeps reloading");
    expect(region.textContent).toContain("comes back with the next minute");
    await advance(61_000);
    expect(region.textContent).toBe("");
    stop();
  });

  it("leaves a board's frames alone: the board takes focus only for as long as it holds it", async () => {
    showCanvas(1);
    for (let i = 0; i < 8 && frames()[0]; i++) {
      refuse(frames()[0]!);
      await advance(120_000);
    }
    const board = host.querySelector<HTMLElement>(".xc-viewport")!;
    expect(board.hasAttribute("tabindex")).toBe(false);
    const button = tryAgain()!;
    button.focus();
    await act(async () => button.click());
    expect(board.getAttribute("tabindex")).toBe("-1");
    act(() => board.blur());
    expect(board.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps focus around a stopped frame in what holds it, when Try again goes", async () => {
    const asked = vi.fn();
    draw(
      <div className="holds-it">
        <FrameStopped what="This picture" refusal={{ asking: false, tryAgain: asked }} />
      </div>,
    );
    const button = tryAgain()!;
    button.focus();
    await act(async () => button.click());
    expect(asked).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(host.querySelector(".holds-it"));
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

  it("waits when it keeps being replaced, then stops, then Try again in the reading pane starts it afresh", async () => {
    story();
    let made = 0;
    for (let at = 0; at < 4 * 60_000; at += 200) {
      const f = frames()[0];
      if (f) {
        reloadsItself(f);
        if (frames()[0] && frames()[0] !== f) made++;
      } else if (host.textContent!.includes("It comes back with the next minute")) {
        // Waiting: nothing of what took its place, and no frame.
        expect(tryAgain()).toBeUndefined();
      }
      const before = frames()[0];
      await advance(200);
      if (frames()[0] && frames()[0] !== before && !before) made++;
    }
    expect(made).toBe(PAGE_PUT_BACKS_A_MINUTE * PUT_BACK_WAITS + 1);
    expect(frames()).toHaveLength(0);
    expect(host.textContent).toContain("This page keeps reloading");
    expect(host.textContent).not.toContain("another address");
    const wrap = host.querySelector(".story-frame-wrap");
    const button = tryAgain()!;
    button.focus();
    await act(async () => button.click());
    expect(document.activeElement).toBe(wrap);
    await advance(100);
    expect(frames()).toHaveLength(1);
    expect(host.textContent).not.toContain("keeps reloading");
    expect(host.textContent).not.toContain("another address");
    // One element through it all, so focus was not lost when the frame came back.
    expect(host.querySelector(".story-frame-wrap")).toBe(wrap);
    expect(document.activeElement).toBe(wrap);
  });

  it("in a prototype is put back at once however often, and never waits or stops", async () => {
    draw(<StoryFrame title="Overview" scheme="light" src="/prototypes/grant/entry.html" prototype={{ sandbox: "allow-scripts" }} />);
    for (let i = 0; i < 30; i++) {
      const f = frames()[0]!;
      loaded(f);
      await advance(1_500);
      expect(frames()[0]).toBeDefined();
      expect(frames()[0]).not.toBe(f);
    }
    expect(host.textContent).not.toContain("keeps reloading");
    expect(host.textContent).toContain("tried to open another address");
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
    const button = tryAgain()!;
    button.focus();
    const wrap = host.querySelector(".story-frame-wrap");
    await act(async () => button.click());
    expect(document.activeElement).toBe(wrap);
    // Refused moments ago, so its turn is to come; it says so rather than sit there unchanged.
    expect(host.textContent).not.toContain("didn’t come back");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await advance(5_000);
    expect(frames()).toHaveLength(1);
    expect(host.querySelector(".story-frame-wrap")).toBe(wrap);
    expect(document.activeElement).toBe(wrap);
  });
});
