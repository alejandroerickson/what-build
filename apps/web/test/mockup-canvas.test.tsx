import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas, type CanvasVersion } from "../src/routes/mockup-canvas.tsx";
import type { PageView } from "../src/routes/story-flip.tsx";

// The canvas's view, what it does as the board around it changes, and what its labels are called.
// The board is laid out by hand here: the document this runs in has no layout.

vi.mock("../src/lib/session.tsx", async (original) => ({ ...(await original<object>()), useProduct: () => ({ app: "/t/acme/core/planner", api: "/api/v1/p/acme/core/planner" }) }));

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
    return this.classList.contains("xc-world") ? Math.max(...version.pages.map((p) => p.height)) : 0;
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
        showRequest={0}
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
    expect(view()).toEqual({ x: placed.x + 304, y: placed.y + 100, z: placed.z });
    boardBecomes({ left: 304, top: 100, width: 800, height: 600 });
    expect(view()).toEqual(placed);
  });

  it("holds them at each step of a panel sliding away", () => {
    show();
    scroll(0, 30);
    const placed = view();
    for (const left of [250, 120, 80]) boardBecomes({ left, width: 1104 - left });
    expect(view()).toEqual({ ...placed, x: placed.x + 224 });
  });

  it("leaves the view alone when the board only grows or shrinks at its far side", () => {
    show();
    scroll(40, 60);
    const placed = view();
    boardBecomes({ width: 1000, height: 700 });
    expect(view()).toEqual(placed);
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
    expect(view()).toEqual({ ...placed, x: placed.x - 304, y: placed.y - 100 });
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
