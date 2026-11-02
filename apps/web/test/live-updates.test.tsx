import { QueryClient, QueryClientProvider, useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { areasIn, HIDDEN_AFTER_MS, IDLE_AFTER_MS, LIVE_AREAS as WEB_AREAS, LiveStream, LiveUpdates, MOST_FAILURES, refreshAutomatically, refreshHeld, REFRESH_SPACING_MS, SILENCE_LIMIT_MS, useHeldUpdate, useHoldRefresh, type LiveArea } from "../src/lib/live.tsx";
import { forgetMinute, minuteRefused } from "../src/lib/minute.ts";
import { noteServerCommit } from "../src/lib/new-release.ts";
import { ToastProvider } from "../src/ui/index.tsx";
import { LIVE_AREAS } from "@whatbuild/core";

// A tab listens only while someone can be using it, and gives up when listening keeps failing. Lists
// and cards follow by themselves, never under someone's hands; a Story page or a mockup stays as it
// is until the person refreshes, with a toast that says there is something newer.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const encoder = new TextEncoder();

/** A stream the test speaks into, as the server would. Taking away its request ends it, as a browser does. */
function serverStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  let gone = false;
  const beats: ReturnType<typeof setInterval>[] = [];
  const say = (text: string) => {
    if (!gone) controller.enqueue(encoder.encode(text));
  };
  return {
    body,
    say,
    change: (...areas: LiveArea[]) => say(`event: change\ndata: ${JSON.stringify({ areas })}\n\n`),
    /** Says it is still there, as the server does every 25 seconds. */
    beat: () => void beats.push(setInterval(() => say(": still here\n\n"), 25_000)),
    end: () => {
      beats.forEach(clearInterval);
      gone = true;
      controller.close();
    },
    taken: () => {
      beats.forEach(clearInterval);
      gone = true;
      controller.error(new DOMException("Aborted", "AbortError"));
    },
  };
}

let visibility: DocumentVisibilityState = "visible";
function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

let fetches: { url: string; signal?: AbortSignal | null }[] = [];
/** Answers each call to the stream in turn; a function is called, so that it can make a fresh response. */
function answerStreamWith(...answers: ((signal?: AbortSignal | null) => Response | Promise<Response>)[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetches.push({ url, signal: init?.signal });
      const next = answers.shift();
      if (!next) throw new TypeError("no connection");
      return next(init?.signal);
    }),
  );
}
const opened = (s: ReturnType<typeof serverStream>) => (signal?: AbortSignal | null) => {
  signal?.addEventListener("abort", s.taken);
  s.say(": listening\n\n");
  return new Response(s.body, { status: 200 });
};

const started: LiveStream[] = [];
function listening() {
  const changed: LiveArea[][] = [];
  const resumed = vi.fn();
  const stream = new LiveStream("/api/v1/p/a/b/c/live", { changed: (a) => changed.push(a), resumed });
  started.push(stream);
  return { stream, changed, resumed };
}

beforeEach(() => {
  vi.useFakeTimers();
  forgetMinute();
  fetches = [];
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  window.dispatchEvent(new Event("pointerup"));
});
afterEach(() => {
  started.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  forgetMinute();
  document.body.innerHTML = "";
});

describe("what a tab hears", () => {
  it("knows the same areas the server can name", () => {
    expect([...WEB_AREAS]).toEqual([...LIVE_AREAS]);
  });

  it("takes the areas of a change, and nothing else the stream could say", () => {
    expect(areasIn('event: change\ndata: {"areas":["story","idea"]}')).toEqual(["story", "idea"]);
    expect(areasIn(": still here")).toEqual([]);
    expect(areasIn(": listening")).toEqual([]);
    expect(areasIn('data: {"areas":["story"]}')).toEqual([]);
    expect(areasIn("event: change\ndata: not json")).toEqual([]);
    expect(areasIn('event: change\ndata: {"areas":["story","<img src=x>"]}')).toEqual(["story"]);
    expect(areasIn('event: change\ndata: {"areas":"story"}')).toEqual([]);
  });
});

describe("when a tab listens", () => {
  it("listens while it is in view and in use, and says what it hears, across chunks", async () => {
    const s = serverStream();
    answerStreamWith(opened(s));
    const { stream, changed } = listening();
    stream.start();
    await advance(0);
    expect(fetches.map((f) => f.url)).toEqual(["/api/v1/p/a/b/c/live"]);
    s.say('event: change\ndata: {"areas":');
    await advance(0);
    expect(changed).toEqual([]);
    s.say('["evidence"]}\n\n');
    await advance(0);
    expect(changed).toEqual([["evidence"]]);
    stream.stop();
  });

  it("does not listen from a tab that opened hidden", async () => {
    visibility = "hidden";
    answerStreamWith();
    const { stream } = listening();
    stream.start();
    await advance(60_000);
    expect(fetches).toEqual([]);
    stream.stop();
  });

  it("goes on listening through a moment in another window, and stops after a while hidden, and looks for what it missed on coming back", async () => {
    const first = serverStream();
    const second = serverStream();
    answerStreamWith(opened(first), opened(second));
    const { stream, resumed } = listening();
    stream.start();
    await advance(0);
    first.beat();
    setVisibility("hidden");
    await advance(HIDDEN_AFTER_MS - 30_000);
    setVisibility("visible");
    expect(fetches[0]!.signal!.aborted).toBe(false);
    expect(fetches).toHaveLength(1);
    expect(resumed).not.toHaveBeenCalled();

    setVisibility("hidden");
    await advance(HIDDEN_AFTER_MS + 30_000);
    expect(fetches[0]!.signal!.aborted).toBe(true);
    expect(fetches).toHaveLength(1);
    setVisibility("visible");
    await advance(0);
    expect(fetches).toHaveLength(2);
    expect(resumed).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("stops when nobody has used it for a while, on a tab left in view all night, and comes back when someone does", async () => {
    const heartbeat = serverStream();
    const second = serverStream();
    answerStreamWith(opened(heartbeat), opened(second));
    const { stream, resumed } = listening();
    stream.start();
    await advance(0);
    heartbeat.beat();
    await advance(IDLE_AFTER_MS + 30_000);
    expect(fetches[0]!.signal!.aborted).toBe(true);
    await advance(8 * 3_600_000);
    expect(fetches).toHaveLength(1);
    window.dispatchEvent(new Event("keydown"));
    await advance(0);
    expect(fetches).toHaveLength(2);
    expect(resumed).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("counts use inside a frame, which says so, and not a message from itself or of any other kind", async () => {
    const s = serverStream();
    answerStreamWith(opened(s));
    const { stream } = listening();
    stream.start();
    await advance(0);
    s.beat();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    for (let m = 0; m < 3; m++) {
      await advance(IDLE_AFTER_MS / 2);
      window.dispatchEvent(new MessageEvent("message", { data: { whatbuild: "frame-active" }, source: frame.contentWindow }));
    }
    expect(fetches[0]!.signal!.aborted).toBe(false);
    window.dispatchEvent(new MessageEvent("message", { data: { whatbuild: "frame-active" }, source: window }));
    window.dispatchEvent(new MessageEvent("message", { data: { whatbuild: "frame-height" }, source: frame.contentWindow }));
    await advance(IDLE_AFTER_MS + 30_000);
    expect(fetches[0]!.signal!.aborted).toBe(true);
    stream.stop();
  });

  it("stops listening when its screen goes", async () => {
    const s = serverStream();
    answerStreamWith(opened(s));
    const { stream } = listening();
    stream.start();
    await advance(0);
    stream.stop();
    expect(fetches[0]!.signal!.aborted).toBe(true);
    window.dispatchEvent(new Event("keydown"));
    await advance(60_000);
    expect(fetches).toHaveLength(1);
  });
});

describe("when a release replaces the server", () => {
  it("moves to the new one once any answer names it, rather than stay deaf on the old, and not before", async () => {
    const first = serverStream();
    const second = serverStream();
    answerStreamWith(
      (signal) => {
        signal?.addEventListener("abort", first.taken);
        first.say(": listening\n\n");
        return new Response(first.body, { status: 200, headers: { "X-WhatBuild-Commit": "old" } });
      },
      (signal) => {
        signal?.addEventListener("abort", second.taken);
        second.say(": listening\n\n");
        return new Response(second.body, { status: 200, headers: { "X-WhatBuild-Commit": "new" } });
      },
    );
    const { stream, resumed } = listening();
    stream.start();
    await advance(0);
    first.beat();
    await advance(60_000);
    expect(fetches).toHaveLength(1);
    noteServerCommit("new");
    await advance(46_000);
    expect(fetches[0]!.signal!.aborted).toBe(true);
    expect(fetches).toHaveLength(2);
    expect(resumed).toHaveBeenCalledTimes(1);
    second.beat();
    await advance(120_000);
    expect(fetches).toHaveLength(2);
    expect(fetches[1]!.signal!.aborted).toBe(false);
    stream.stop();
  });
});

describe("when listening fails", () => {
  it.each([
    ["the deployment turned it off, or a guest", 204],
    ["signed out", 401],
    ["no longer allowed", 403],
    ["no such product", 404],
  ])("stops asking when told %s", async (_, status) => {
    answerStreamWith(() => new Response(null, { status }));
    const { stream } = listening();
    stream.start();
    await advance(0);
    window.dispatchEvent(new Event("keydown"));
    await advance(3_600_000);
    window.dispatchEvent(new Event("keydown"));
    await advance(0);
    expect(fetches).toHaveLength(1);
    stream.stop();
  });

  it("waits as long as a server with no room says, and does not ask meanwhile", async () => {
    const s = serverStream();
    answerStreamWith(() => new Response(null, { status: 429, headers: { "Retry-After": "300" } }), opened(s));
    const { stream } = listening();
    stream.start();
    await advance(0);
    window.dispatchEvent(new Event("keydown"));
    await advance(299_000);
    expect(fetches).toHaveLength(1);
    window.dispatchEvent(new Event("keydown"));
    await advance(80_000);
    expect(fetches).toHaveLength(2);
    stream.stop();
  });

  it("comes back after a stream that worked has ended, each at its own moment, and looks for what it missed", async () => {
    const first = serverStream();
    const second = serverStream();
    answerStreamWith(opened(first), opened(second));
    const { stream, resumed } = listening();
    stream.start();
    await advance(0);
    first.say(": still here\n\n");
    await advance(0);
    first.end();
    await advance(500);
    expect(fetches).toHaveLength(1);
    window.dispatchEvent(new Event("keydown"));
    await advance(16_000);
    expect(fetches).toHaveLength(2);
    expect(resumed).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("waits longer each time a stream fails, and gives up until the page is loaded again", async () => {
    answerStreamWith();
    const { stream } = listening();
    stream.start();
    let gaps = 0;
    for (let i = 0; i < 40; i++) {
      await advance(60_000);
      window.dispatchEvent(new Event("keydown"));
      gaps = fetches.length;
    }
    expect(gaps).toBe(MOST_FAILURES);
    await advance(3_600_000);
    window.dispatchEvent(new Event("keydown"));
    await advance(0);
    expect(fetches).toHaveLength(MOST_FAILURES);
    stream.stop();
  });

  it("takes a proxy that holds everything back for a stream that failed, not one that worked", async () => {
    // Each answers its opening, and then nothing: no heartbeat ever comes through.
    answerStreamWith(...Array.from({ length: 20 }, () => opened(serverStream())));
    const { stream } = listening();
    stream.start();
    for (let i = 0; i < 40; i++) {
      await advance(SILENCE_LIMIT_MS);
      window.dispatchEvent(new Event("keydown"));
    }
    expect(fetches).toHaveLength(MOST_FAILURES);
    stream.stop();
  });
});

describe("what refreshes by itself", () => {
  const product = { api: "/api/v1/p/a/b/c", path: "a/b/c" };

  /** Follows these queries as screens do, and says how often each was read. */
  function following(keys: unknown[][]) {
    const qc = new QueryClient();
    const reads = new Map<string, number>();
    function Reads({ queryKey }: { queryKey: unknown[] }) {
      useQuery({
        queryKey,
        staleTime: Infinity,
        queryFn: () => {
          const k = JSON.stringify(queryKey);
          reads.set(k, (reads.get(k) ?? 0) + 1);
          return { n: reads.get(k) };
        },
      });
      return null;
    }
    return { qc, reads, tree: <QueryClientProvider client={qc}>{keys.map((k) => <Reads key={JSON.stringify(k)} queryKey={k} />)}</QueryClientProvider> };
  }

  async function mount(tree: ReactNode) {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(tree);
      await vi.advanceTimersByTimeAsync(0);
    });
    return root;
  }

  it("refreshes each area's lists and cards, and never a Story page, a mockup, or anything of another product", async () => {
    const api = product.api;
    const stays = [["story-page", api, "p1"], ["story-versions", api, "p1"], ["story-version", api, "p1", 2], ["mockup", api, "m1"], ["mockup-versions", api, "m1"], ["mockup-version", api, "m1", 2], ["mockup-files", api, "m1", 2], ["delete-impact", api, "s1"], ["story-style", api], ["limits", "a"], ["me"]];
    const follows = [["product", product.path], ["story-tree", api], ["story-pages", api], ["outcomes", api, false], ["sources", api, "facets", false], ["source", api, "s1"], ["source-comments", api, "s1"], ["mockups", api], ["register", api, "assumptions", "every", false], ["entry", api, "assumptions", "a1"]];
    const elsewhere = [["product", "x/y/z"], ["outcomes", "/api/v1/p/x/y/z", false]];
    const { qc, reads, tree } = following([...stays, ...follows, ...elsewhere]);
    const root = await mount(tree);
    refreshAutomatically(qc, product, ["other"]);
    await advance(0);
    for (const k of stays) expect(reads.get(JSON.stringify(k)), JSON.stringify(k)).toBe(1);
    for (const k of follows) expect(reads.get(JSON.stringify(k)), JSON.stringify(k)).toBe(2);
    for (const k of elsewhere) expect(reads.get(JSON.stringify(k)), JSON.stringify(k)).toBe(1);
    act(() => root.unmount());
  });

  it.each([
    ["story", ["story-tree", "story-pages"]],
    ["idea", ["outcomes"]],
    ["evidence", ["sources", "source", "source-comments"]],
    ["exploration", ["mockups", "register", "entry"]],
  ] as const)("reads for a change to %s only what it changed, and the counts on every screen", async (area, names) => {
    const api = product.api;
    const all = ["story-tree", "story-pages", "outcomes", "sources", "source", "source-comments", "mockups", "register", "entry"];
    const { qc, reads, tree } = following([["product", product.path], ...all.map((n) => [n, api])]);
    const root = await mount(tree);
    refreshAutomatically(qc, product, [area]);
    await advance(0);
    expect(reads.get(JSON.stringify(["product", product.path]))).toBe(2);
    for (const n of all) expect(reads.get(JSON.stringify([n, api])), n).toBe((names as readonly string[]).includes(n) ? 2 : 1);
    act(() => root.unmount());
  });

  it("does not let a read that fails change what a screen shows", async () => {
    const qc = new QueryClient();
    let fail = false;
    let seen: { isError: boolean; data: unknown } | null = null;
    function Screen() {
      const q = useQuery({
        queryKey: ["product", product.path],
        staleTime: Infinity,
        queryFn: () => {
          if (fail) throw new Error("the server is away");
          return { name: "Planner" };
        },
      });
      seen = { isError: q.isError, data: q.data };
      return null;
    }
    const root = await mount(<QueryClientProvider client={qc}><Screen /></QueryClientProvider>);
    fail = true;
    refreshAutomatically(qc, product, ["idea"]);
    await advance(10_000);
    expect(seen).toEqual({ isError: false, data: { name: "Planner" } });
    act(() => root.unmount());
  });

  it("reads a short long list again, and leaves one someone has read far into until it is next opened", async () => {
    const qc = new QueryClient();
    let reads = 0;
    const pages = { n: 1 };
    function Screen() {
      useInfiniteQuery({
        queryKey: ["sources", product.api, {}, "date", "desc"],
        initialPageParam: 0,
        staleTime: Infinity,
        getNextPageParam: (last: { page: number }) => (last.page + 1 < pages.n ? last.page + 1 : undefined),
        queryFn: ({ pageParam }) => {
          reads += 1;
          return { page: pageParam };
        },
      });
      return null;
    }
    const root = await mount(<QueryClientProvider client={qc}><Screen /></QueryClientProvider>);
    expect(reads).toBe(1);
    refreshAutomatically(qc, product, ["evidence"]);
    await advance(0);
    expect(reads).toBe(2);
    qc.setQueryData(["sources", product.api, {}, "date", "desc"], { pages: [{ page: 0 }, { page: 1 }, { page: 2 }, { page: 3 }], pageParams: [0, 1, 2, 3] });
    refreshAutomatically(qc, product, ["evidence"]);
    await advance(0);
    expect(reads).toBe(2);
    expect(qc.getQueryState(["sources", product.api, {}, "date", "desc"])!.isInvalidated).toBe(true);
    act(() => root.unmount());
  });
});

describe("what holds a refresh back", () => {
  it("holds it for typing, a dialog, a form that says so, a press, and a hidden tab; and not for a search box or a button", async () => {
    expect(refreshHeld()).toBe(false);

    const textarea = document.createElement("textarea");
    const text = document.createElement("input");
    const search = document.createElement("input");
    search.type = "search";
    const button = document.createElement("button");
    document.body.append(textarea, text, search, button);
    textarea.focus();
    expect(refreshHeld()).toBe(true);
    text.focus();
    expect(refreshHeld()).toBe(true);
    search.focus();
    expect(refreshHeld()).toBe(false);
    button.focus();
    expect(refreshHeld()).toBe(false);
    button.blur();

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(refreshHeld()).toBe(true);
    dialog.remove();

    window.dispatchEvent(new Event("pointerdown"));
    expect(refreshHeld()).toBe(true);
    window.dispatchEvent(new Event("pointerup"));
    expect(refreshHeld()).toBe(false);
    // A release over a frame is never heard, and holds nothing back for good.
    window.dispatchEvent(new Event("pointerdown"));
    await advance(31_000);
    expect(refreshHeld()).toBe(false);

    visibility = "hidden";
    expect(refreshHeld()).toBe(true);
    visibility = "visible";

    function Form() {
      useHoldRefresh();
      return null;
    }
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => root.render(<Form />));
    expect(refreshHeld()).toBe(true);
    await act(async () => root.unmount());
    expect(refreshHeld()).toBe(false);
  });
});

describe("a tab on a product", () => {
  const API = "/api/v1/p/a/b/c";

  /** A screen on a product, with a query that refreshes by itself, and a stream the test speaks into. */
  async function onProduct(screen: ReactNode, opts: { guest?: boolean } = {}) {
    const s = serverStream();
    s.beat();
    const qc = new QueryClient();
    let reads = 0;
    function Follows() {
      useQuery({ queryKey: ["outcomes", API, false], staleTime: Infinity, queryFn: () => ({ n: ++reads }) });
      return null;
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetches.push({ url, signal: init?.signal });
        if (String(url).endsWith("/live")) return opened(s)(init?.signal);
        throw new TypeError("nothing else is answered here");
      }),
    );
    const el = document.createElement("div");
    document.body.append(el);
    const root: Root = createRoot(el);
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <ToastProvider>
            <LiveUpdates api={API} path="a/b/c" guest={Boolean(opts.guest)}>
              <Follows />
              {screen}
            </LiveUpdates>
          </ToastProvider>
        </QueryClientProvider>,
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    return { s, reads: () => reads, root };
  }

  it("does not listen for a guest of the example organization", async () => {
    await onProduct(null, { guest: true });
    expect(fetches.filter((f) => f.url.endsWith("/live"))).toEqual([]);
  });

  it("reads what changed at once, then at most every half minute however much changes", async () => {
    const { s, reads, root } = await onProduct(null);
    expect(reads()).toBe(1);
    s.change("idea");
    await advance(0);
    expect(reads()).toBe(2);
    for (let i = 0; i < 25; i++) {
      s.change("idea");
      await advance(1_000);
    }
    expect(reads()).toBe(2);
    await advance(REFRESH_SPACING_MS - 25_000);
    expect(reads()).toBe(3);
    await advance(10 * REFRESH_SPACING_MS);
    expect(reads()).toBe(3);
    act(() => root.unmount());
  });

  it("waits while someone is typing, and reads once they stop", async () => {
    const { s, reads } = await onProduct(<textarea />);
    document.querySelector("textarea")!.focus();
    s.change("idea");
    await advance(120_000);
    expect(reads()).toBe(1);
    document.querySelector("textarea")!.blur();
    await advance(6_000);
    expect(reads()).toBe(2);
  });

  it("waits out a minute whose calls are used up, rather than be refused", async () => {
    const { s, reads } = await onProduct(null);
    minuteRefused(20);
    s.change("idea");
    await advance(19_000);
    expect(reads()).toBe(1);
    await advance(7_000);
    expect(reads()).toBe(2);
  });

  describe("on a screen that stays as it is", () => {
    let current = "v1";
    let refreshed = 0;
    let shown: string;
    const message = "This page was updated. Refresh to see the latest.";
    function Held() {
      useHeldUpdate({ area: "story", shown, peek: async () => current, refresh: () => void (refreshed += 1), message });
      return null;
    }
    const toast = () => document.querySelector(".toast");
    const press = (label: string) =>
      act(async () => {
        ([...document.querySelectorAll<HTMLButtonElement>(".toast button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === label) as HTMLButtonElement).click();
        await vi.advanceTimersByTimeAsync(0);
      });

    beforeEach(() => {
      current = "v1";
      shown = "v1";
      refreshed = 0;
    });

    it("says a newer one is there, and it stays until the person acts, whatever the time", async () => {
      const { s } = await onProduct(<Held />);
      expect(toast()).toBeNull();
      s.beat();
      current = "v2";
      s.change("story");
      await advance(0);
      expect(toast()?.textContent).toContain(message);
      await advance(3_600_000);
      expect(toast()?.textContent).toContain(message);
    });

    it("says nothing when what changed elsewhere in the Story left this page as it is", async () => {
      const { s } = await onProduct(<Held />);
      s.change("story");
      await advance(0);
      expect(toast()).toBeNull();
    });

    it("says nothing for a change to another part of the product, and does not look", async () => {
      const peek = vi.fn(async () => "v2");
      function Quiet() {
        useHeldUpdate({ area: "story", shown: "v1", peek, refresh: () => undefined, message });
        return null;
      }
      const { s } = await onProduct(<Quiet />);
      s.change("evidence");
      await advance(0);
      expect(peek).not.toHaveBeenCalled();
      expect(toast()).toBeNull();
    });

    it("refreshes only when the person says, and the toast goes", async () => {
      const { s, root } = await onProduct(<Held />);
      current = "v2";
      s.change("story");
      await advance(0);
      expect(refreshed).toBe(0);
      await press("Refresh");
      expect(refreshed).toBe(1);
      expect(toast()).toBeNull();
      act(() => root.unmount());
    });

    it("stays closed once closed, until there is something newer still", async () => {
      const { s } = await onProduct(<Held />);
      current = "v2";
      s.change("story");
      await advance(0);
      await press("Close");
      expect(toast()).toBeNull();
      s.change("story");
      await advance(REFRESH_SPACING_MS);
      expect(toast()).toBeNull();
      current = "v3";
      s.change("story");
      await advance(REFRESH_SPACING_MS);
      expect(toast()?.textContent).toContain(message);
    });

    it("goes when the screen moves on", async () => {
      const { s, root } = await onProduct(<Held />);
      current = "v2";
      s.change("story");
      await advance(0);
      expect(toast()).not.toBeNull();
      await act(async () => root.unmount());
      expect(toast()).toBeNull();
    });

    it("never tells someone of their own edit, which their screen already shows", async () => {
      const { s } = await onProduct(<Held />);
      shown = "v2";
      current = "v2";
      s.change("story");
      await advance(0);
      expect(toast()).toBeNull();
    });

    it("says so when the page is gone, and says nothing when looking failed", async () => {
      const { ApiError } = await import("../src/lib/api.ts");
      let answer: () => Promise<string> = async () => {
        throw new ApiError(500, "error", "away");
      };
      function Gone() {
        useHeldUpdate({ area: "story", shown: "v1", peek: () => answer(), refresh: () => undefined, message });
        return null;
      }
      const { s } = await onProduct(<Gone />);
      s.change("story");
      await advance(0);
      expect(toast()).toBeNull();
      answer = async () => {
        throw new ApiError(404, "not_found", "gone");
      };
      s.change("story");
      await advance(REFRESH_SPACING_MS);
      expect(toast()?.textContent).toContain(message);
    });
  });
});
