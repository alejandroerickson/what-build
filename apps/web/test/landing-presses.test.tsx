import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The landing pages are compared by what their visitors do (okf/operations/analytics.md, the
// landing-page funnel): each press of a button is counted for its page and button, and a link to
// sign in carries both through it, for the new account to keep.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

// The scroll's pictures draw nothing that matters here.
vi.mock("../src/site/landing/one-line.ts", () => ({ startOneLine: () => () => undefined }));
vi.mock("../src/site/landing/window.ts", () => ({ startWindow: () => () => undefined }));

const sent: { url: string; init: RequestInit }[] = [];
const meta = document.createElement("meta");

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (sent.push({ url, init }), new Response("{}"))));
  // What whoever serves the page writes into it: anyone may sign up, and guests may come in.
  meta.name = "whatbuild-site";
  meta.content = JSON.stringify({ plans: [], sign_up: true, guests: { self_serve: true, open: true } });
  document.head.append(meta);
});
afterAll(() => {
  vi.unstubAllGlobals();
  meta.remove();
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  sent.length = 0;
});

async function show(which: "LandingOneLine" | "LandingWindow") {
  const landing = await import("../src/site/landing/Landing.tsx");
  const Page = landing[which];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(<Page />));
  // jsdom does not navigate; the press is what is looked at.
  host.addEventListener("click", (e) => e.preventDefault());
  return host;
}

const links = (host: HTMLElement, name: RegExp) => [...host.querySelectorAll<HTMLAnchorElement>("a")].filter((a) => name.test(a.textContent ?? ""));
const presses = () => sent.filter((s) => s.url === "/api/v1/pressed").map((s) => JSON.parse(String(s.init.body)) as unknown);

describe("a landing page's buttons", () => {
  it("count each press for the front page, and carry the page and the button through sign-in", async () => {
    const host = await show("LandingOneLine");
    const explore = links(host, /Explore the demo/);
    const start = links(host, /start using WhatBuild/i);
    expect(explore.length).toBeGreaterThan(0);
    expect(start.length).toBeGreaterThan(0);
    for (const a of explore) expect(new URL(a.href).searchParams.get("next")).toBe("/?landing=/&button=explore");
    for (const a of start) expect(new URL(a.href).searchParams.get("next")).toBe("/start?landing=/&button=start");
    act(() => explore[0]!.click());
    act(() => start[0]!.click());
    expect(presses()).toEqual([
      { page: "/", button: "explore" },
      { page: "/", button: "start" },
    ]);
    expect(sent[0]!.init).toMatchObject({ method: "POST", keepalive: true });
  });

  it("say which page they are on at /what-to-build/", async () => {
    const host = await show("LandingWindow");
    act(() => links(host, /Explore the demo/)[0]!.click());
    expect(presses()).toEqual([{ page: "/what-to-build/", button: "explore" }]);
    expect(new URL(links(host, /start using WhatBuild/i)[0]!.href).searchParams.get("next")).toBe("/start?landing=/what-to-build/&button=start");
  });

  it("send nothing until one is pressed", async () => {
    await show("LandingOneLine");
    expect(presses()).toEqual([]);
  });
});
