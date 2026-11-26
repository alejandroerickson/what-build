import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Start using WhatBuild on the public site (spec §7.3): the plans page offers it as the landing pages
// do, wherever anyone may make an account, and where nobody may yet it leads to the form at the foot
// of a landing page, whose email field takes focus.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

// The scroll's pictures draw nothing that matters here.
vi.mock("../src/site/landing/one-line.ts", () => ({ startOneLine: () => () => undefined }));
vi.mock("../src/site/landing/window.ts", () => ({ startWindow: () => () => undefined }));

const sent: { url: string; init: RequestInit }[] = [];
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (sent.push({ url, init }), new Response("{}"))));
  // jsdom lays nothing out, so it cannot scroll.
  Element.prototype.scrollIntoView ??= function () {};
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  document.head.querySelector('meta[name="whatbuild-site"]')?.remove();
  sent.length = 0;
  history.replaceState(null, "", "/");
});

/** What whoever serves the page writes into it: whether anyone may sign up, and whether guests may come in. */
type Told = { sign_up: boolean; guests: { self_serve: boolean; open: boolean } };
const OPEN_WITH_GUESTS: Told = { sign_up: true, guests: { self_serve: true, open: true } };
const OPEN: Told = { sign_up: true, guests: { self_serve: false, open: true } };
const CLOSED: Told = { sign_up: false, guests: { self_serve: false, open: false } };

/** Renders a page of the site as a deployment that told it `told`; the page reads it once, when it loads. */
async function show(told: Told, page: (site: typeof import("../src/site/SitePage.tsx"), landing: typeof import("../src/site/landing/Landing.tsx")) => ComponentType) {
  const meta = document.createElement("meta");
  meta.name = "whatbuild-site";
  meta.content = JSON.stringify({ plans: [], example_about: { organization: "Harbor Labs", product: "Crewboard", about: "Crewboard is a planner for field crews." }, ...told });
  document.head.append(meta);
  vi.resetModules();
  const Page = page(await import("../src/site/SitePage.tsx"), await import("../src/site/landing/Landing.tsx"));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(<Page />));
  return host;
}

const links = (host: HTMLElement, name: RegExp) => [...host.querySelectorAll<HTMLAnchorElement>("a")].filter((a) => name.test(a.textContent ?? ""));
const next = (a: HTMLAnchorElement) => new URL(a.href).searchParams.get("next");

describe("the plans page", () => {
  const plans = (told: Told) => show(told, (site) => site.SitePlansPage);

  it("leads with Explore the demo and offers Start using WhatBuild while guests may come in", async () => {
    const host = await plans(OPEN_WITH_GUESTS);
    expect(links(host, /^Explore the demo$/).map(next)).toEqual(["/?landing=/plans/&button=explore"]);
    expect(links(host, /^Start using WhatBuild/).map(next)).toEqual(["/start?landing=/plans/&button=start"]);
    expect(host.textContent).toContain("in the demo, they are building Crewboard, a planner for field crews.");
    expect(host.textContent).not.toMatch(/a few at a time|hear when you can start/i);
    expect(host.textContent).toContain("Been here before?");
  });

  it("offers Start using WhatBuild alone where anyone may sign up but guests may not come in", async () => {
    const host = await plans(OPEN);
    expect(links(host, /Explore the demo/)).toEqual([]);
    expect(links(host, /^Start using WhatBuild/).map(next)).toEqual(["/start?landing=/plans/&button=start"]);
    expect(host.textContent).not.toMatch(/a few at a time/);
  });

  it("says people are let in a few at a time, and how to hear when, while nobody may sign up", async () => {
    const host = await plans(CLOSED);
    expect(links(host, /Start using WhatBuild|Explore the demo/)).toEqual([]);
    expect(host.textContent).toContain("People are let in a few at a time.");
    expect(links(host, /^Hear when you can start$/).map((a) => a.getAttribute("href"))).toEqual(["/#start"]);
    expect(host.textContent).toContain("Already invited?");
  });

  it("counts no presses: only the landing pages are compared by them", async () => {
    const host = await plans(OPEN_WITH_GUESTS);
    host.addEventListener("click", (e) => e.preventDefault());
    act(() => links(host, /Start using WhatBuild/)[0]!.click());
    expect(sent.filter((s) => s.url === "/api/v1/pressed")).toEqual([]);
  });
});

describe("Start using WhatBuild on a landing page, while nobody may sign up", () => {
  it("goes to the form at the foot and puts the cursor in its email field, and still counts the press", async () => {
    const host = await show(CLOSED, (_, landing) => landing.LandingOneLine);
    const start = links(host, /^Start using WhatBuild$/);
    expect(start.map((a) => a.getAttribute("href"))).toEqual(["#start"]);
    act(() => start[0]!.click());
    expect(document.activeElement).toBe(host.querySelector("#ld-email"));
    expect(location.hash).toBe("#start");
    expect(sent.filter((s) => s.url === "/api/v1/pressed").map((s) => JSON.parse(String(s.init.body)) as unknown)).toEqual([{ page: "/", button: "start" }]);
  });
});
