import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMinute } from "../src/lib/minute.ts";
import { storyLinkPath } from "../src/routes/story-model.ts";

// A mockup page shown alone on the Story has no canvas to fly over: its link to another page of the
// canvas goes to the Story page that shows that page, which the server names, and nowhere else.

vi.mock("../src/lib/session.tsx", async (original) => ({ ...(await original<object>()), useProduct: () => ({ app: "/t/acme/core/planner", api: "/api/v1/p/acme/core/planner" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as never;
const { StoryFrame } = await import("../src/routes/story.tsx");

describe("where a link from a mockup page shown alone leads on the Story", () => {
  const links = { two: { page_id: "step-two", on_canvas: false }, three: { page_id: "all-steps", on_canvas: true } };

  it("is the Story page that shows the page it names, or a whole canvas opened at that page", () => {
    expect(storyLinkPath(links, "two")).toBe("step-two");
    expect(storyLinkPath(links, "three")).toBe("all-steps?page=three");
  });

  it("is nowhere for a name the server gave none, whatever the name", () => {
    for (const name of ["gone", "constructor", "__proto__", "toString", "hasOwnProperty", ""]) expect(storyLinkPath(links, name), name).toBeNull();
    expect(storyLinkPath(undefined, "two")).toBeNull();
  });
});

describe("a mockup page's frame on the Story", () => {
  let root: Root | null = null;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    forgetMinute();
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

  function show(onLink?: (name: string) => void) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <MemoryRouter>
          <StoryFrame title="One" scheme="light" src="/api/v1/p/acme/core/planner/story/pages/step-one/versions/1/html" size={{ width: 400, height: 300 }} onLink={onLink} />
        </MemoryRouter>,
      ),
    );
    const frame = host.querySelector("iframe")!;
    const told = vi.spyOn(frame.contentWindow!, "postMessage");
    act(() => frame.dispatchEvent(new Event("load")));
    const says = (data: unknown, source: Window | null = frame.contentWindow) => act(() => window.dispatchEvent(new MessageEvent("message", { source, data })));
    says({ whatbuild: "frame-ready" });
    return { told, says };
  }

  it("tells the page that its relative links name pages, and hands the app each name it sends from its own frame", () => {
    const followed: string[] = [];
    const { told, says } = show((name) => followed.push(name));
    expect(told).toHaveBeenCalledWith({ whatbuild: "page-links" }, "*");
    says({ whatbuild: "canvas-page", page: "two", hash: "" });
    says({ whatbuild: "canvas-page", page: "three" }, window);
    says({ whatbuild: "canvas-page", page: 3 });
    expect(followed).toEqual(["two"]);
  });

  it("says nothing of links where no one follows them", () => {
    const { told } = show();
    expect(told).not.toHaveBeenCalledWith({ whatbuild: "page-links" }, "*");
  });
});
