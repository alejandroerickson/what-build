import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readDefaults } from "../src/lib/api.ts";
import { forgetMinute } from "../src/lib/minute.ts";

// Search refused for the minute's calls says why it is waiting, wherever it waits, in the words
// Loading uses, and what other words found does not stand as an answer to these.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const product = { name: "Crewboard", path: "acme/core/crew", your_role: "editor" };

vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite: true, canDelete: false }),
}));

const { SearchPage } = await import("../src/routes/search.tsx");
const { FindProvider, FindLauncher } = await import("../src/shell/find-palette.tsx");

const found = (query: string, title: string) => ({
  query,
  terms: [{ text: query, phrase: false }],
  ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
  results: [{ kind: "assumption", id: `a-${query}`, title, title_marks: [], snippet: null, snippet_marks: [], missing: [], score: 1, meta: { status: "confirmed" } }],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refused = (seconds: number) => json({ error: { code: "rate_limited", message: "The example organization allows each person 50 calls a minute.", details: { limit: 50, per: "minute", retry_after_seconds: seconds } } }, 429);

/** Which words are refused, for how long; anything else finds one assumption titled after its words. */
let refusing: Record<string, number> = {};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
/** Past a field's debounce, through the address it writes and the answer it brings. */
async function settle() {
  for (let i = 0; i < 6; i++) await advance(100);
}

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let unmount: (() => Promise<void>) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  forgetMinute();
  refusing = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const query = new URLSearchParams(url.split("?")[1]).get("query") ?? "";
      const wait = refusing[query];
      return wait ? refused(wait) : json(found(query, `Found by ${query}`));
    }),
  );
});
afterEach(async () => {
  await unmount?.();
  unmount = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetMinute();
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode, at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { ...readDefaults, refetchOnWindowFocus: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(async () => root.unmount());
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
  return host;
}

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the palette, refused for the minute's calls", () => {
  async function open() {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    return document.querySelector<HTMLDialogElement>("dialog.find-pal")!;
  }
  const search = async (dialog: HTMLDialogElement, words: string) => {
    await act(async () => type(dialog.querySelector<HTMLInputElement>('input[role="combobox"]')!, words));
    await settle();
  };
  const region = (dialog: HTMLDialogElement) => dialog.querySelector('[role="status"]')!;
  const spinning = (dialog: HTMLDialogElement) => dialog.querySelector(".find-pal-field > .spin") !== null;

  it("says so from a region mounted before there is anything to say, with nothing held", async () => {
    refusing = { crews: 20 };
    const dialog = await open();
    const mounted = region(dialog);
    expect(mounted.textContent).toBe("");
    await search(dialog, "crews");
    expect(region(dialog)).toBe(mounted);
    expect(mounted.textContent).toContain("Waiting for the next minute");
    expect(mounted.textContent).toContain("You’ve used this minute’s calls");
    expect(spinning(dialog)).toBe(true);
  });

  it("takes away what other words found, so nothing stale can be chosen, and shows the answer when it comes", async () => {
    const dialog = await open();
    await search(dialog, "vans");
    expect(dialog.textContent).toContain("Found by vans");
    refusing = { crews: 20 };
    await search(dialog, "crews");
    expect(region(dialog).textContent).toContain("Waiting for the next minute");
    expect(dialog.textContent).not.toContain("Found by vans");
    expect(dialog.querySelector('[role="option"]')).toBeNull();
    expect(spinning(dialog)).toBe(true);
    expect(dialog.querySelector(".find-pal-all")?.textContent).toContain("All results");
    // Enter finds nothing to open.
    const field = dialog.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(document.querySelector("dialog.find-pal")).toBe(dialog);
    refusing = {};
    await advance(26_000);
    expect(region(dialog).textContent).toBe("");
    expect(dialog.textContent).toContain("Found by crews");
    expect(spinning(dialog)).toBe(false);
  });

  it("keeps what other words found while it is only loading, as ever", async () => {
    const dialog = await open();
    await search(dialog, "vans");
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    await search(dialog, "crews");
    expect(region(dialog).textContent).toBe("");
    expect(dialog.textContent).toContain("Found by vans");
  });

  it("leaves the field alone in a closed space when there is nothing to say", async () => {
    const dialog = await open();
    expect(dialog.querySelector(".find-pal-field + .find-pal-wait:empty:last-child")).not.toBeNull();
  });
});

describe("the Search screen, refused for the minute's calls", () => {
  const go = (host: HTMLElement, words: string) => act(async () => type(host.querySelector<HTMLInputElement>('[role="search"] input')!, words));

  it("says so with nothing held, in Loading's words", async () => {
    refusing = { crews: 20 };
    const host = await render(<SearchPage />, `${APP}/search?q=crews`);
    await advance(100);
    expect(host.textContent).toContain("Waiting for the next minute");
    expect(host.textContent).toContain("You’ve used this minute’s calls");
    expect(host.textContent).not.toContain("Search didn’t finish");
  });

  it("takes away what other words found, says why it waits, and comes back by itself", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=vans`);
    await advance(100);
    expect(host.textContent).toContain("Found by vans");
    refusing = { crews: 20 };
    await go(host, "crews");
    await settle();
    expect(host.textContent).toContain("Waiting for the next minute");
    expect(host.textContent).not.toContain("Found by vans");
    expect(host.querySelector('a[data-kind="assumption"]')).toBeNull();
    refusing = {};
    await advance(26_000);
    expect(host.textContent).not.toContain("Waiting for the next minute");
    expect(host.textContent).toContain("Found by crews");
  });

  it("keeps what other words found while it is only loading, as ever", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=vans`);
    await advance(100);
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    await go(host, "crews");
    await settle();
    expect(host.textContent).toContain("Found by vans");
    expect(host.textContent).not.toContain("Waiting for the next minute");
  });

  it("keeps these words' own answer through a refused re-check, and says why it is not new", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=vans`);
    await advance(100);
    await go(host, "crews");
    await settle();
    expect(host.textContent).toContain("Found by crews");
    refusing = { vans: 20 };
    await advance(31_000);
    await go(host, "vans");
    await settle();
    expect(host.textContent).toContain("Found by vans");
    expect(host.textContent).toContain("Waiting for the next minute");
  });

  it("past the bound says it didn't finish, with Try again", async () => {
    refusing = { crews: 59 };
    const host = await render(<SearchPage />, `${APP}/search?q=crews`);
    await advance(30 * 60_000);
    expect(host.textContent).toContain("Search didn’t finish");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(true);
  });
});
