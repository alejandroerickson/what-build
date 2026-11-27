import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_TOOLS, Canvas, toolTitle, type CanvasVersion } from "../src/routes/mockup-canvas.tsx";
import { ToastProvider } from "../src/ui/toast.tsx";
import { FRAME_TURN_MS, FRAMES_AT_ONCE, turnOrder } from "../src/routes/frame-turns.ts";
import { BACK_STEP_GAP_MS, backSteps, PAGE_MOVE_GAP_MS, pageMoves } from "../src/routes/page-moves.ts";
import type { PageView } from "../src/routes/story-flip.tsx";
import { AUTO_HEIGHT_ANSWER_MS, nextAutoHeight, PAGE_HEIGHT_MAX, PAGE_HEIGHT_MIN } from "@whatbuild/core/page-sandbox";

// The canvas's view, what it does as the board around it changes, and what its labels are called.
// The board is laid out by hand here: the document this runs in has no layout.

vi.mock("../src/lib/session.tsx", async (original) => ({ ...(await original<object>()), useProduct: () => ({ app: "/t/acme/planner", api: "/api/v1/p/acme/planner" }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const version: CanvasVersion = {
  version: 1,
  title: "Sample canvas",
  columns: null,
  pages: [
    { page_id: "phone", title: "Crew message", width: 390, height: 760 },
    { page_id: "wide", title: "Jobs board", width: 1280, height: 800 },
  ],
};
const GAP = 120;

/** The board's corner on the screen and its size, as the next look at it finds them. */
let board = { left: 304, top: 100, width: 800, height: 600 };
let observers: (() => void)[] = [];
let unmount: (() => void) | null = null;

/** The board changes, as a panel or focus mode makes it, and the browser says so. */
function boardBecomes(next: Partial<typeof board>) {
  board = { ...board, ...next };
  act(() => observers.forEach((cb) => cb()));
}

function left(el: HTMLElement): number {
  let x = 0;
  for (let e = el.previousElementSibling; e; e = e.previousElementSibling) x += parseFloat((e as HTMLElement).style.width) + GAP;
  return x;
}

beforeEach(() => {
  board = { left: 304, top: 100, width: 800, height: 600 };
  observers = [];
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;
  window.ResizeObserver = class {
    cb: () => void;
    constructor(cb: () => void) {
      this.cb = cb;
    }
    observe() {
      observers.push(this.cb);
    }
    unobserve() {}
    disconnect() {
      observers = observers.filter((o) => o !== this.cb);
    }
  } as never;
  const frame = (el: HTMLElement) => el.classList.contains("xc-frame");
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (frame(this)) return parseFloat(this.style.width);
    return this.classList.contains("xc-world") ? version.pages.reduce((sum, p) => sum + p.width, GAP * (version.pages.length - 1)) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    if (frame(this)) return parseFloat(this.style.height);
    return this.classList.contains("xc-world") ? Math.max(...version.pages.map((p) => (p.height === "auto" ? 240 : p.height))) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return frame(this) ? left(this) : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => board.width);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => board.height);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return (this.classList.contains("xc-viewport") ? { ...board, x: board.left, y: board.top, right: board.left + board.width, bottom: board.top + board.height } : { left: 0, top: 0, width: 0, height: 0, x: 0, y: 0, right: 0, bottom: 0 }) as DOMRect;
  });
});

afterEach(() => {
  unmount?.();
  unmount = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function show(pageView: PageView = "fit", onPageView: (v: PageView) => void = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const selected: { id: string | null } = { id: null };
  const draw = () =>
    root.render(
      <Canvas
        version={version}
        pageSrc={(p) => `about:blank#${p.page_id}`}
        selected={selected.id}
        onSelect={(id) => {
          selected.id = id;
          draw();
        }}
        onKey={() => {}}
        canFocus
        pageView={pageView}
        onPageView={onPageView}
      />,
    );
  act(draw);
  unmount = () => act(() => root.unmount());
  // The first look the browser takes when the board is observed.
  act(() => observers.forEach((cb) => cb()));
}

/** The view as the pages are drawn with it. */
function view() {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec((document.querySelector(".xc-world") as HTMLElement).style.transform)!;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

/**
 * A view to compare with `view()`, to the precision a style string keeps. Browsers write the numbers
 * in a transform to six significant digits, so a view read back from the page and one worked out from
 * an earlier read can differ in their last digit. Within 0.05px, and the scale within 0.00005, is far
 * finer than any move of the board and coarser than that rounding while positions stay under 1000px,
 * where six digits still keep three decimal places.
 */
function near(v: { x: number; y: number; z: number }) {
  return { x: expect.closeTo(v.x, 1), y: expect.closeTo(v.y, 1), z: expect.closeTo(v.z, 4) };
}

const viewport = () => document.querySelector(".xc-viewport") as HTMLElement;
const scroll = (deltaX: number, deltaY: number) => act(() => viewport().dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, cancelable: true })));
const handZoom = (deltaY: number) => act(() => viewport().dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey: true, clientX: board.left + 100, clientY: board.top + 100, bubbles: true, cancelable: true })));
const key = (k: string) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
const label = (n: number) => document.querySelectorAll<HTMLElement>(".xc-label")[n]!;
const markedRadio = () => [...document.querySelectorAll('[aria-label="Show pages"] [role=radio]')].map((b) => b.getAttribute("aria-checked"));

describe("a canvas placed by hand as the board around it changes", () => {
  it("keeps the pages where they are on the screen when the board's corner moves, as focus mode moves it", () => {
    show();
    scroll(40, 60);
    const placed = view();
    boardBecomes({ left: 0, top: 0, width: 1440, height: 900 });
    expect(view()).toEqual(near({ x: placed.x + 304, y: placed.y + 100, z: placed.z }));
    boardBecomes({ left: 304, top: 100, width: 800, height: 600 });
    expect(view()).toEqual(near(placed));
  });

  it("holds them at each step of a panel sliding away", () => {
    show();
    scroll(0, 30);
    const placed = view();
    for (const left of [250, 120, 80]) boardBecomes({ left, width: 1104 - left });
    expect(view()).toEqual(near({ ...placed, x: placed.x + 224 }));
  });

  it("leaves the view alone when the board only grows or shrinks at its far side", () => {
    show();
    scroll(40, 60);
    const placed = view();
    boardBecomes({ width: 1000, height: 700 });
    expect(view()).toEqual(near(placed));
  });
});

describe("a canvas nobody has moved as the board around it changes", () => {
  it("stays fitted, however the board's corner moves", () => {
    show();
    const fitted = view();
    boardBecomes({ left: 0, top: 0, width: 1440, height: 900 });
    expect(view().z).toBeGreaterThan(fitted.z);
  });

  it("keeps a page it has fitted fitted as the board changes, until someone moves it", () => {
    show();
    act(() => label(1).querySelector<HTMLElement>(".xc-label-fit")!.click());
    const fitted = view();
    boardBecomes({ left: 0, top: 0, width: 1440, height: 900 });
    expect(view().z).toBeGreaterThan(fitted.z);
    scroll(0, 10);
    const placed = view();
    boardBecomes({ left: 304, top: 100, width: 800, height: 600 });
    expect(view()).toEqual(near({ ...placed, x: placed.x - 304, y: placed.y - 100 }));
  });
});

describe("the wheel over the toolbar", () => {
  const toolbar = () => document.querySelector(".xc-tools") as HTMLElement;
  const wheel = (init: WheelEventInit) => {
    const e = new WheelEvent("wheel", { clientX: board.left + 400, clientY: board.top + 560, bubbles: true, cancelable: true, ...init });
    act(() => toolbar().dispatchEvent(e));
    return e;
  };

  it("zooms the canvas with a pinch, ⌘ or Ctrl, and never lets the browser zoom the app", () => {
    show();
    const before = view();
    expect(wheel({ deltaY: -40, ctrlKey: true }).defaultPrevented).toBe(true);
    const pinched = view();
    expect(pinched.z).toBeGreaterThan(before.z);
    expect(wheel({ deltaY: -40, metaKey: true }).defaultPrevented).toBe(true);
    expect(view().z).toBeGreaterThan(pinched.z);
  });

  it("leaves a scroll alone, so a long menu of pages still scrolls", () => {
    show();
    const before = view();
    expect(wheel({ deltaY: 60 }).defaultPrevented).toBe(false);
    expect(view()).toEqual(before);
  });
});

describe("a page's label", () => {
  it("names its button for the page at any zoom, though a narrow one shows only its number", () => {
    show();
    expect(label(0).hasAttribute("data-tiny")).toBe(false);
    expect(label(0).querySelector(".xc-label-name")!.getAttribute("aria-label")).toBe("Crew message");
    for (let i = 0; i < 5; i++) key("-");
    expect(label(0).hasAttribute("data-tiny")).toBe(true);
    expect(label(0).querySelector(".xc-label-name")!.getAttribute("aria-label")).toBe("Crew message");
    expect(label(1).hasAttribute("data-tiny")).toBe(false);
    expect(label(1).querySelector(".xc-label-name")!.getAttribute("aria-label")).toBe("Jobs board");
  });

  it("names its fit button for the page too", () => {
    show();
    expect(label(0).querySelector(".xc-label-fit")!.getAttribute("aria-label")).toBe("Fit Crew message to the screen");
  });

  it("gives up its fit button only when that would run into the next page's label", () => {
    show();
    expect(label(0).hasAttribute("data-cramped")).toBe(false);
    for (let i = 0; i < 12; i++) key("-");
    expect(view().z).toBe(0.05);
    expect(label(0).hasAttribute("data-cramped")).toBe(true);
    expect(label(1).hasAttribute("data-cramped")).toBe(false);
  });
});

describe("fit and fill in the toolbar", () => {
  it("mark how the arrows show pages, which a hand zoom does not change", () => {
    const chosen = vi.fn();
    show("fill", chosen);
    key("ArrowRight");
    const filled = view().z;
    handZoom(100);
    expect(view().z).toBeLessThan(filled);
    expect(markedRadio()).toEqual(["false", "true"]);
    expect(chosen).not.toHaveBeenCalled();
    // The next page still fills the board's width, less the 48px kept at each side.
    key("ArrowRight");
    expect(view().z).toBeCloseTo((board.width - 96) / 1280);
    expect(markedRadio()).toEqual(["false", "true"]);
  });
});

describe("links between a canvas's pages", () => {
  /** What the app hears when a link is clicked inside a page's frame. */
  function linkClicked(from: string, to: string, extra: Record<string, string> = {}) {
    const iframe = document.querySelector(`.xc-frame[data-page="${from}"] iframe`) as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { whatbuild: "canvas-page", page: to, hash: "", ...extra } }));
    });
  }

  function showClickable(opts: { clickable?: boolean; onFollow?: (id: string) => void; onDownloadPage?: (id: string) => void } = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const state = { id: opts.clickable ? "phone" : null as string | null, clickable: Boolean(opts.clickable) };
    const follow = opts.onFollow;
    const draw = () =>
      root.render(
        <ToastProvider>
          <Canvas
            version={version}
            pageSrc={(p) => `about:blank#${p.page_id}`}
            selected={state.id}
            onSelect={(id) => {
              state.id = id;
              draw();
            }}
            onKey={() => {}}
            canFocus
            pageView="fit"
            onPageView={() => {}}
            clickable={state.clickable}
            onFollow={(id) => {
              follow?.(id);
              state.id = id;
              draw();
            }}
            onDownloadPage={opts.onDownloadPage ? (p) => opts.onDownloadPage!(p.page_id) : undefined}
          />
        </ToastProvider>,
      );
    act(draw);
    unmount = () => act(() => root.unmount());
    act(() => observers.forEach((cb) => cb()));
    return { state, setClickable: (on: boolean) => { state.clickable = on; act(draw); }, redraw: () => act(draw) };
  }

  it("follows a link on the canvas by moving to the page it names, whose frame is never replaced", () => {
    const followed: string[] = [];
    showClickable({ onFollow: (id) => followed.push(id) });
    const frameOfWide = document.querySelector('.xc-frame[data-page="wide"] iframe');
    const before = view();
    linkClicked("phone", "wide");
    expect(followed).toEqual(["wide"]);
    expect(view()).not.toEqual(before);
    expect(document.querySelector('.xc-frame[data-page="wide"] iframe')).toBe(frameOfWide);
    expect(document.querySelector('.xc-frame[data-page="phone"] iframe')).toBeTruthy();
  });

  it("goes nowhere for a page the canvas does not hold, and says so", () => {
    const followed: string[] = [];
    showClickable({ onFollow: (id) => followed.push(id) });
    linkClicked("phone", "last-week");
    expect(followed).toEqual([]);
    expect(document.body.textContent).toContain("This link leads to a page that isn’t on this canvas.");
  });

  it("never puts a page's own words in the app's message, and does not stack it", () => {
    showClickable();
    const spoof = "Your session has expired: sign in again at https://attacker.example/signin";
    linkClicked("phone", spoof, { href: spoof });
    linkClicked("phone", "another", { href: spoof });
    expect(document.body.textContent).not.toContain("attacker.example");
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("moves nothing and says nothing for a script no person prompted", () => {
    vi.stubGlobal("navigator", Object.create(navigator, { userActivation: { value: { isActive: false } } }));
    try {
      const followed: string[] = [];
      showClickable({ onFollow: (id) => followed.push(id) });
      linkClicked("phone", "last-week");
      linkClicked("phone", "wide");
      expect(document.querySelector(".toast")).toBeNull();
      expect(followed).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("as a clickable prototype, hears nothing from a page that is not showing", () => {
    const followed: string[] = [];
    showClickable({ clickable: true, onFollow: (id) => followed.push(id) });
    linkClicked("wide", "phone");
    linkClicked("wide", "wide");
    expect(followed).toEqual([]);
  });

  it("as a clickable prototype, opens one page for a burst of requests, not one for each", () => {
    const followed: string[] = [];
    showClickable({ clickable: true, onFollow: (id) => followed.push(id) });
    linkClicked("phone", "wide");
    linkClicked("wide", "phone");
    linkClicked("phone", "wide");
    expect(followed).toEqual(["wide"]);
  });

  it("ignores a message from anything but the page's own frame", () => {
    const followed: string[] = [];
    showClickable({ onFollow: (id) => followed.push(id) });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source: window, data: { whatbuild: "canvas-page", page: "wide", hash: "", href: "wide.html" } }));
    });
    expect(followed).toEqual([]);
  });

  it("as a clickable prototype, shows one page with no labels or pan and zoom, and a linked page at once in the frame it loaded in", () => {
    showClickable({ clickable: true });
    expect(viewport().dataset["view"]).toBe("clickable");
    expect(document.querySelector(".xc-labels")).toBeNull();
    expect(document.querySelector(".xc-ring")).toBeNull();
    expect(document.querySelector('[aria-label="Mode"]')).toBeNull();
    expect(document.querySelector('[aria-label="Show pages"]')).toBeTruthy();
    expect(view().z).toBeLessThanOrEqual(1);
    // Every page loads behind the one on show, wherever it sits, so the next is ready.
    expect([...document.querySelectorAll("iframe")].map((f) => f.getAttribute("loading"))).toEqual(["eager", "eager"]);
    const was = document.querySelector('.xc-frame[data-page="wide"] iframe');
    linkClicked("phone", "wide");
    expect((document.querySelector('.xc-frame[data-page="wide"]') as HTMLElement).dataset["selected"]).toBe("");
    expect(document.querySelector('.xc-frame[data-page="wide"] iframe')).toBe(was);
  });

  it("as a clickable prototype, keeps the pages not on show beneath the one that is, in the view, taking nothing", () => {
    const { state, redraw, setClickable } = showClickable({ clickable: true });
    const frame = (id: string) => document.querySelector(`.xc-frame[data-page="${id}"]`) as HTMLElement;
    // Drawn in the view, where the browser keeps drawing it, so it never shows white when moved to.
    expect(frame("wide").style.transform).toBe("translate(-510px)");
    expect(frame("wide").hasAttribute("inert")).toBe(true);
    expect(frame("phone").hasAttribute("inert")).toBe(false);
    expect(frame("phone").style.transform).toBe("");
    state.id = "wide";
    redraw();
    expect(frame("phone").style.transform).toBe("translate(510px)");
    expect(frame("phone").hasAttribute("inert")).toBe(true);
    expect(frame("wide").hasAttribute("inert")).toBe(false);
    expect(frame("wide").style.transform).toBe("");
    // Back on the board each page is where it belongs, and takes the pointer and the keyboard.
    setClickable(false);
    expect([frame("phone"), frame("wide")].map((f) => [f.hasAttribute("inert"), f.style.transform])).toEqual([
      [false, ""],
      [false, ""],
    ]);
  });

  it("as a clickable prototype, keeps drawn beneath only the pages next to the one on show, the first page and the pages shown last, and hides the rest where they are", () => {
    const was = version.pages;
    version.pages = Array.from({ length: 9 }, (_, i) => ({ page_id: `p${i + 1}`, title: `Page ${i + 1}`, width: 390, height: 760 }));
    try {
      const { state, redraw } = showClickable({ clickable: true });
      const frame = (id: string) => document.querySelector(`.xc-frame[data-page="${id}"]`) as HTMLElement;
      // Each page not on show takes nothing. Those drawn wait beneath it; the others, hidden
      // (mockups.css), at their own place.
      const waiting = () =>
        Object.fromEntries(
          version.pages.map(({ page_id: id }) => {
            const f = frame(id);
            const under = f.getAttribute("data-under");
            if (under === null) return [id, f.hasAttribute("inert") ? "inert on show" : "on show"];
            if (!f.hasAttribute("inert")) return [id, "waits, not inert"];
            return [id, under === "drawn" && f.style.transform ? "drawn" : under === "hidden" && !f.style.transform ? "hidden" : "misplaced"];
          }),
        );
      const go = (id: string) => {
        state.id = id;
        redraw();
      };
      go("p1");
      expect(waiting()).toMatchObject({ p1: "on show", p2: "drawn", p3: "hidden", p9: "hidden" });
      // By the arrows to p6: its neighbours are drawn, the three pages shown before it, and the first,
      // where a link back to the start goes.
      for (const id of ["p2", "p3", "p4", "p5", "p6"]) go(id);
      expect(waiting()).toEqual({ p1: "drawn", p2: "hidden", p3: "drawn", p4: "drawn", p5: "drawn", p6: "on show", p7: "drawn", p8: "hidden", p9: "hidden" });
      // A jump to a far page: the page left stays drawn, so a link back to it is instant, and so do the two before it.
      go("p9");
      expect(waiting()).toEqual({ p1: "drawn", p2: "hidden", p3: "hidden", p4: "drawn", p5: "drawn", p6: "drawn", p7: "hidden", p8: "drawn", p9: "on show" });
    } finally {
      version.pages = was;
    }
  });

  it("takes the keyboard back from a page that takes it by itself, and leaves it with a page a person pressed in", () => {
    vi.useFakeTimers();
    try {
      showClickable();
      const phone = document.querySelector('.xc-frame[data-page="phone"] iframe') as HTMLIFrameElement;
      // The document this runs in moves no focus out of a frame, so what is checked is that the canvas gives it back.
      const givesBack = vi.spyOn(phone, "blur");
      const takes = () => {
        phone.tabIndex = 0;
        phone.focus();
        // A frame taking the focus is heard only as the window losing it.
        act(() => window.dispatchEvent(new Event("blur")));
        act(() => vi.advanceTimersByTime(200));
      };
      takes();
      expect(givesBack).toHaveBeenCalledTimes(1);
      act(() => window.dispatchEvent(new MessageEvent("message", { source: phone.contentWindow, data: { whatbuild: "canvas-select" } })));
      takes();
      expect(givesBack).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rings the page whose frame holds the focus when it came from the keyboard, follows it to the next frame, and rings none after a press in a page", () => {
    vi.useFakeTimers();
    try {
      for (const clickable of [false, true]) {
        const { state, redraw } = showClickable({ clickable });
        const iframe = (id: string) => document.querySelector(`.xc-frame[data-page="${id}"] iframe`) as HTMLIFrameElement;
        const ring = () => document.querySelector(".xc-focus") as HTMLElement | null;
        // At screen size around the page, whatever the zoom.
        const rings = (width: number) => expect(parseFloat(ring()?.style.width ?? ""), `clickable ${clickable}`).toBeCloseTo(width * view().z, 2);
        const into = (el: HTMLIFrameElement, tab: boolean) => {
          if (tab) act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
          el.tabIndex = 0;
          el.focus();
          act(() => window.dispatchEvent(new Event("blur")));
          act(() => vi.advanceTimersByTime(200));
        };
        into(iframe("phone"), true);
        rings(390);
        if (clickable) {
          state.id = "wide";
          redraw();
        }
        // The next frame takes the focus, which the app hears nothing of.
        iframe("wide").tabIndex = 0;
        act(() => iframe("wide").focus());
        act(() => vi.advanceTimersByTime(200));
        rings(1280);
        // Back in the app, or a press inside the page, and nothing is ringed.
        act(() => window.dispatchEvent(new Event("focus")));
        expect(ring()).toBeNull();
        act(() => vi.advanceTimersByTime(2_000));
        into(iframe("wide"), true);
        rings(1280);
        act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe("wide").contentWindow, data: { whatbuild: "canvas-select" } })));
        expect(ring()).toBeNull();
        unmount?.();
        unmount = null;
        document.body.innerHTML = "";
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops looking for the frame that holds the keyboard's focus while the tab is hidden or the window has lost the focus, and looks again once either is back", () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    try {
      showClickable();
      const iframe = (id: string) => document.querySelector(`.xc-frame[data-page="${id}"] iframe`) as HTMLIFrameElement;
      const ringed = () => {
        const w = parseFloat((document.querySelector(".xc-focus") as HTMLElement | null)?.style.width ?? "");
        return Math.abs(w - 390 * view().z) < 0.01 ? "phone" : Math.abs(w - 1280 * view().z) < 0.01 ? "wide" : null;
      };
      const into = (id: string) => {
        iframe(id).tabIndex = 0;
        act(() => iframe(id).focus());
      };
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
      into("phone");
      act(() => window.dispatchEvent(new Event("blur")));
      act(() => vi.advanceTimersByTime(200));
      expect(ringed()).toBe("phone");
      // Hidden, nothing is looked at; shown again, the ring finds the frame at once.
      hidden.mockReturnValue(true);
      act(() => vi.advanceTimersByTime(200));
      into("wide");
      act(() => vi.advanceTimersByTime(5_000));
      expect(ringed()).toBe("phone");
      hidden.mockReturnValue(false);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(ringed()).toBe("wide");
      // The window without the focus: the ring is left as it is until the focus is back.
      hasFocus.mockReturnValue(false);
      act(() => vi.advanceTimersByTime(200));
      into("phone");
      act(() => vi.advanceTimersByTime(500));
      expect(ringed()).toBe("wide");
      hasFocus.mockReturnValue(true);
      act(() => vi.advanceTimersByTime(1_100));
      expect(ringed()).toBe("phone");
    } finally {
      hidden.mockRestore();
      hasFocus.mockRestore();
      vi.useRealTimers();
    }
  });

  it("as a clickable prototype, opens a page someone used afresh once it is left, and leaves one nobody used as it is", () => {
    const { state, redraw } = showClickable({ clickable: true });
    const phone = document.querySelector('.xc-frame[data-page="phone"] iframe') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent("message", { source: phone.contentWindow, data: { whatbuild: "frame-active" } })));
    linkClicked("phone", "wide");
    expect(document.querySelector('.xc-frame[data-page="phone"] iframe')).not.toBe(phone);
    const wide = document.querySelector('.xc-frame[data-page="wide"] iframe');
    state.id = "phone";
    redraw();
    expect(document.querySelector('.xc-frame[data-page="wide"] iframe')).toBe(wide);
  });

  /** A page's frame loads and its document says so, and the canvas greets it. */
  function greeted(id: string) {
    const iframe = document.querySelector(`.xc-frame[data-page="${id}"] iframe`) as HTMLIFrameElement;
    act(() => iframe.dispatchEvent(new Event("load")));
    act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { whatbuild: "frame-ready" } })));
    return iframe;
  }
  /** The places within it the canvas has told a page's frame to go to. */
  function placesTold(iframe: HTMLIFrameElement) {
    const told: string[] = [];
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((data: unknown) => {
      const m = data as { whatbuild?: string; hash?: string };
      if (m.whatbuild === "canvas-hash") told.push(m.hash!);
    });
    return told;
  }

  it("as a clickable prototype, opens a page already loaded at the place a link names, and keeps the place for nothing later", () => {
    const { state, redraw } = showClickable({ clickable: true });
    greeted("phone");
    const wide = greeted("wide");
    const told = placesTold(wide);
    linkClicked("phone", "wide", { hash: "place" });
    expect(state.id).toBe("wide");
    expect(told).toEqual(["place"]);
    // Used, left by the arrows and opened afresh behind: its new frame is greeted with no place.
    act(() => window.dispatchEvent(new MessageEvent("message", { source: wide.contentWindow, data: { whatbuild: "frame-active" } })));
    state.id = "phone";
    redraw();
    const again = document.querySelector('.xc-frame[data-page="wide"] iframe') as HTMLIFrameElement;
    expect(again).not.toBe(wide);
    const toldAgain = placesTold(again);
    greeted("wide");
    expect(toldAgain).toEqual([]);
  });

  it("as a clickable prototype, opens a page still loading at the place a link names once it has loaded, and drops the place once the person is elsewhere", () => {
    // Moves a page asks for are a moment apart at least, so the clock is the test's.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { state, redraw } = showClickable({ clickable: true });
      greeted("phone");
      const wide = document.querySelector('.xc-frame[data-page="wide"] iframe') as HTMLIFrameElement;
      const told = placesTold(wide);
      linkClicked("phone", "wide", { hash: "place" });
      expect(told).toEqual([]);
      greeted("wide");
      expect(told).toEqual(["place"]);
      // A place named for a page that has not loaded by the time the person leaves it is never used.
      vi.setSystemTime(Date.now() + 10_000);
      state.id = "phone";
      redraw();
      const phone = document.querySelector('.xc-frame[data-page="phone"] iframe') as HTMLIFrameElement;
      act(() => window.dispatchEvent(new MessageEvent("message", { source: phone.contentWindow, data: { whatbuild: "frame-active" } })));
      state.id = "wide";
      redraw();
      // phone, used, opens afresh behind; a link names a place in it, then the person moves on before it loads.
      const fresh = document.querySelector('.xc-frame[data-page="phone"] iframe') as HTMLIFrameElement;
      expect(fresh).not.toBe(phone);
      const toldFresh = placesTold(fresh);
      linkClicked("wide", "phone", { hash: "top" });
      expect(state.id).toBe("phone");
      state.id = "wide";
      redraw();
      greeted("phone");
      expect(toldFresh).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a page's download on its label on the canvas alone, and for a page with its own HTML alone", () => {
    version.pages[1] = { ...version.pages[1]!, html_path: "/x" };
    try {
      const asked: string[] = [];
      const { setClickable } = showClickable({ onDownloadPage: (id) => asked.push(id) });
      expect(label(0).querySelector('[aria-label^="Download"]')).toBeNull();
      const button = label(1).querySelector('[aria-label="Download Jobs board"]') as HTMLButtonElement;
      act(() => button.click());
      expect(asked).toEqual(["wide"]);
      setClickable(true);
      expect(document.querySelector('[aria-label^="Download"]')).toBeNull();
    } finally {
      version.pages[1] = { page_id: "wide", title: "Jobs board", width: 1280, height: 800 };
    }
  });

  it("keeps choosing a page in the toolbar, and has no view or download control there", () => {
    showClickable();
    const tools = document.querySelector(".xc-tools")!;
    expect(tools.querySelector('.xc-page-menu')).toBeTruthy();
    expect(tools.textContent).not.toMatch(/Clickable|Download/);
    expect(tools.querySelector('[aria-label="View"]')).toBeNull();
  });
});

describe("pages that enter a prototype, loading in turns", () => {
  const before = { pages: version.pages, prototype: version.prototype };
  beforeEach(() => {
    version.pages = Array.from({ length: 16 }, (_, i) => ({ page_id: `p${i + 1}`, title: `Screen ${i + 1}`, width: 400, height: 300, prototype_url: `/prototypes/grant/p/${i + 1}.html` }));
    version.prototype = { base_url: "/prototypes/grant/", expires_at: "2099-01-01T00:00:00Z", sandbox: "allow-scripts" };
  });
  afterEach(() => {
    version.pages = before.pages;
    version.prototype = before.prototype;
  });

  function showPrototype(first: string, clickable = false) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const state = { id: first as string | null };
    const draw = () =>
      root.render(
        <ToastProvider>
          <Canvas
            version={version}
            pageSrc={(p) => `about:blank#${p.page_id}`}
            selected={state.id}
            onSelect={(id) => {
              state.id = id;
              draw();
            }}
            onKey={() => {}}
            canFocus
            pageView="fit"
            onPageView={() => {}}
            clickable={clickable}
            onFollow={(id) => {
              state.id = id;
              draw();
            }}
          />
        </ToastProvider>,
      );
    act(draw);
    unmount = () => act(() => root.unmount());
    act(() => observers.forEach((cb) => cb()));
    return { select: (id: string) => ((state.id = id), act(draw)) };
  }
  /** The pages with a frame, by number. */
  const framed = () => [...document.querySelectorAll<HTMLElement>(".xc-frame")].filter((f) => f.querySelector("iframe")).map((f) => Number(f.dataset["page"]!.slice(1))).sort((a, b) => a - b);
  const frameOf = (n: number) => document.querySelector<HTMLIFrameElement>(`.xc-frame[data-page="p${n}"] iframe`)!;
  const loadingSays = (n: number) => document.querySelector(`.xc-frame[data-page="p${n}"] .xc-loading`)?.textContent ?? null;
  const loads = (...ns: number[]) => {
    for (const n of ns) {
      act(() => frameOf(n).dispatchEvent(new Event("load")));
      act(() => window.dispatchEvent(new MessageEvent("message", { source: frameOf(n).contentWindow, data: { whatbuild: "frame-ready" } })));
    }
  };
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  it("take turns outward from the page asked for, the next before the previous", () => {
    expect(turnOrder(["a", "b", "c", "d", "e"], "c")).toEqual(["c", "d", "b", "e", "a"]);
    expect(turnOrder(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
    expect(turnOrder(["a", "b", "c"], "c")).toEqual(["c", "b", "a"]);
  });

  it("load the page asked for alone, then those beside it, then a few at a time, each saying it is loading until it has", () => {
    showPrototype("p5");
    expect(framed()).toEqual([5]);
    expect(loadingSays(5)).toBe("Loading");
    expect(loadingSays(9)).toBe("Loading");
    const first = frameOf(5);
    loads(5);
    expect(loadingSays(5)).toBeNull();
    expect(framed()).toEqual([4, 5, 6]);
    loads(6, 4);
    expect(FRAMES_AT_ONCE).toBe(8);
    expect(framed()).toEqual(range(1, 11));
    loads(7);
    expect(framed()).toEqual(range(1, 12));
    loads(3, 8, 2, 9, 1, 10, 11, 12);
    expect(framed()).toEqual(range(1, 16));
    // A page keeps the frame it loaded in.
    expect(frameOf(5)).toBe(first);
  });

  it("give a page asked for its turn at once, whatever else is loading", () => {
    const { select } = showPrototype("p1");
    loads(1, 2, 3);
    expect(framed()).toEqual(range(1, 11));
    select("p16");
    expect(framed()).toEqual([...range(1, 11), 16]);
  });

  it("let the others go on when a page has not said it loaded in time", () => {
    vi.useFakeTimers();
    try {
      showPrototype("p5");
      act(() => vi.advanceTimersByTime(FRAME_TURN_MS - 10));
      expect(framed()).toEqual([5]);
      act(() => vi.advanceTimersByTime(20));
      expect(framed()).toEqual([4, 5, 6]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("as a clickable prototype, load behind the page on show, show a loaded page at once, and show one still to load at once too, saying so", () => {
    const { select } = showPrototype("p5", true);
    loads(5, 6, 4);
    const next = frameOf(6);
    act(() => (document.querySelector('[data-tool="next"]') as HTMLButtonElement).click());
    expect((document.querySelector(".xc-frame[data-selected]") as HTMLElement).dataset["page"]).toBe("p6");
    expect(frameOf(6)).toBe(next);
    expect(loadingSays(6)).toBeNull();
    // A page far from the one on show takes the place at once, and says it is loading until it has.
    select("p16");
    expect((document.querySelector(".xc-frame[data-selected]") as HTMLElement).dataset["page"]).toBe("p16");
    expect(framed()).toContain(16);
    expect(loadingSays(16)).toBe("Loading");
    loads(16);
    expect(loadingSays(16)).toBeNull();
  });
});

describe("how many steps a page can add to the browser's Back", () => {
  const stepsAfter = (asks: number[], active = () => true) => {
    let at = 0;
    vi.stubGlobal("navigator", Object.create(navigator, { userActivation: { get: () => ({ isActive: active() }) } }));
    try {
      const may = backSteps(() => at);
      return asks.filter((t) => {
        at = t;
        return may();
      });
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("takes none from a script no person prompted", () => {
    expect(stepsAfter([0, 50, 2000], () => false)).toEqual([]);
  });

  it("holds a script to one step in each gap, however often it asks", () => {
    const flood = Array.from({ length: 100 }, (_, i) => i * 50);
    expect(stepsAfter(flood)).toEqual(flood.filter((t) => t % BACK_STEP_GAP_MS === 0));
  });

  it("moves nothing for a script no person prompted, and holds one that follows a click to the gap", () => {
    const allowed = (active: boolean) => {
      let at = 0;
      vi.stubGlobal("navigator", Object.create(navigator, { userActivation: { value: { isActive: active } } }));
      try {
        const may = pageMoves(() => at);
        return [0, 50, PAGE_MOVE_GAP_MS, PAGE_MOVE_GAP_MS + 50].filter((t) => {
          at = t;
          return may();
        });
      } finally {
        vi.unstubAllGlobals();
      }
    };
    expect(allowed(false)).toEqual([]);
    expect(allowed(true)).toEqual([0, PAGE_MOVE_GAP_MS]);
  });

  it("gives a person's clicks a step each, once they are a gap apart", () => {
    expect(stepsAfter([0, BACK_STEP_GAP_MS, BACK_STEP_GAP_MS * 3])).toEqual([0, BACK_STEP_GAP_MS, BACK_STEP_GAP_MS * 3]);
  });
});

describe("the toolbar's controls", () => {
  it("are each marked with the control they are and take their tooltips from the toolbar's definitions, which the tutorial labels the toolbar from", () => {
    show();
    const marked = [...document.querySelectorAll<HTMLElement>(".xc-tools [data-tool]")];
    expect(marked.map((b) => b.dataset["tool"])).toEqual(["pan", "interact", "zoom-out", "zoom-in", "fit-page", "fill-width", "fit-canvas", "previous", "next"]);
    for (const b of marked) expect(b.getAttribute("title")).toBe(toolTitle(b.dataset["tool"] as keyof typeof CANVAS_TOOLS, false));
    expect(document.querySelector(".xc-tools .xc-tool-keys")?.getAttribute("title")).toBe(CANVAS_TOOLS.keys.name);
  });
});

describe("a page whose height is its content's", () => {
  const auto: CanvasVersion = { ...version, pages: [{ page_id: "list", title: "Crew list", width: 390, height: "auto" }, version.pages[1]!] };
  const frameOf = (id: string) => document.querySelector(`.xc-frame[data-page="${id}"]`) as HTMLElement;
  /** The page's document says how tall it is, as the frame script does once asked. */
  function reports(id: string, height: number, source?: Window | null) {
    const iframe = frameOf(id).querySelector("iframe")!;
    act(() => window.dispatchEvent(new MessageEvent("message", { source: source === undefined ? iframe.contentWindow : source, data: { whatbuild: "page-height", height } })));
  }
  function showAuto() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<Canvas version={auto} pageSrc={(p) => `about:blank#${p.page_id}`} selected={null} onSelect={() => {}} onKey={() => {}} canFocus pageView="fit" onPageView={() => {}} />));
    unmount = () => act(() => root.unmount());
    act(() => observers.forEach((cb) => cb()));
  }

  it("opens at the least height, grows to what its document reports, and says auto on its label", () => {
    showAuto();
    expect(frameOf("list").style.height).toBe(`${PAGE_HEIGHT_MIN}px`);
    expect(label(0).querySelector(".xc-label-size")!.textContent).toBe("390 × auto");
    reports("list", 1234.4);
    expect(frameOf("list").style.height).toBe("1235px");
    expect(frameOf("list").querySelector("iframe")!.getAttribute("height")).toBe("1235");
    // A page with a height of its own keeps it.
    expect(frameOf("wide").style.height).toBe("800px");
    // Never shorter, never past the most, and nothing from another window.
    reports("list", 600);
    expect(frameOf("list").style.height).toBe("1235px");
    reports("list", 1500, window);
    expect(frameOf("list").style.height).toBe("1235px");
    reports("list", 9000);
    expect(frameOf("list").style.height).toBe(`${PAGE_HEIGHT_MAX}px`);
  });

  it("stops growing a page that grows with its frame, as one sized in vh does", () => {
    showAuto();
    reports("list", 840);
    expect(frameOf("list").style.height).toBe("840px");
    // A 100vh section and 600 pixels under it: the frame grew 600, and so did the page.
    reports("list", 1440);
    expect(frameOf("list").style.height).toBe("840px");
    reports("list", 2000);
    expect(frameOf("list").style.height).toBe("840px");
  });

  it("follows content a script adds to now and then, in steps of any size", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    showAuto();
    reports("list", 1000);
    // A row of 48 pixels a second after another: the page growing by itself, not with its frame.
    for (const h of [1048, 1096, 1144]) {
      now += 1000;
      reports("list", h);
    }
    expect(frameOf("list").style.height).toBe("1144px");
  });

  it("follows the rule the canvas and the Story share", () => {
    const grewAt = (at: number) => ({ from: 240, to: 1000, reported: 1000, at });
    expect(nextAutoHeight(240, 1000, null, 0)).toEqual({ height: 1000 });
    expect(nextAutoHeight(240, 100, null, 0)).toBeNull();
    expect(nextAutoHeight(1000, 1000, grewAt(0), 10)).toBeNull();
    // Right after the frame grew, by what it grew or twice that: a page sized in vh.
    expect(nextAutoHeight(1000, 1760, grewAt(0), 10)).toEqual({ height: 1000, stop: true });
    expect(nextAutoHeight(1000, 2520, grewAt(0), 10)).toEqual({ height: 1000, stop: true });
    // Three times, later, or by something else: content growing by itself, followed.
    expect(nextAutoHeight(1000, 3280, grewAt(0), 10)).toEqual({ height: 3280 });
    expect(nextAutoHeight(1000, 1760, grewAt(0), AUTO_HEIGHT_ANSWER_MS + 1)).toEqual({ height: 1760 });
    expect(nextAutoHeight(1000, 1200, grewAt(0), 10)).toEqual({ height: 1200 });
    // A frame that grew a few pixels says nothing of how the page answers it.
    expect(nextAutoHeight(1002, 1004, { from: 1000, to: 1002, reported: 1002, at: 0 }, 10)).toEqual({ height: 1004 });
  });
});
