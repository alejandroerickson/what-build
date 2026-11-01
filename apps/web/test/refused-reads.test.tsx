import { QueryClient, QueryClientProvider, QueryObserver, useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, isMinuteRefusal, readDefaults, readRetryDelay, retryRead, retryRefusedRead } from "../src/lib/api.ts";
import { forgetMinute } from "../src/lib/minute.ts";
import { ProductProvider, type Product } from "../src/lib/session.tsx";
import { useSourceTitles } from "../src/lib/source-titles.ts";
import { Dialog, Loading, MinuteAnnouncer } from "../src/ui/index.tsx";

// A read refused because the person's calls a minute ran out comes back by itself once it may
// succeed, a bounded number of times and not all at once, and says so meanwhile. A product the app
// holds stays on screen through a refused re-check, and only through that.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refusal = (seconds = 20) => new ApiError(429, "rate_limited", "The example organization allows each person 50 calls a minute. Wait for the next minute, then carry on.", { limit: 50, per: "minute", retry_after_seconds: seconds });

/** The refusal as the server sends it. */
function refused(seconds: number) {
  return new Response(JSON.stringify({ error: { code: "rate_limited", message: "The example organization allows each person 50 calls a minute. Wait for the next minute, then carry on.", details: { limit: 50, per: "minute", retry_after_seconds: seconds } } }), { status: 429, headers: { "Retry-After": String(seconds), "Content-Type": "application/json" } });
}
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A client with the app's defaults. */
const client = () => new QueryClient({ defaultOptions: { queries: { ...readDefaults, staleTime: 10_000, refetchOnWindowFocus: false } } });

/** Follow a read the way a screen does, recording what the screen would have seen. */
function follow(qc: QueryClient, path: string) {
  const seen: QueryObserverResult<unknown>[] = [];
  const observer = new QueryObserver(qc, { queryKey: [path], queryFn: () => api("GET", path) });
  const stop = observer.subscribe((r) => seen.push(r));
  return { seen, stop, now: () => observer.getCurrentResult() };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  forgetMinute();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  forgetMinute();
  document.body.innerHTML = "";
});

describe("whether a read asks again", () => {
  it("asks again after a refusal for the minute's calls, and only a few times", () => {
    expect(retryRead(0, refusal())).toBe(true);
    expect(retryRead(1, refusal())).toBe(true);
    expect(retryRead(2, refusal())).toBe(true);
    expect(retryRead(3, refusal())).toBe(false);
  });

  it("leaves every other answer as it was: a 5xx or no answer twice, and never a 4xx that won't change", () => {
    for (const e of [new ApiError(500, "error", "x"), new ApiError(0, "network", "x"), new Error("x")]) {
      expect(retryRead(0, e)).toBe(true);
      expect(retryRead(1, e)).toBe(true);
      expect(retryRead(2, e)).toBe(false);
    }
    for (const status of [401, 403, 404, 409, 410, 422]) expect(retryRead(0, new ApiError(status, "x", "x"))).toBe(false);
  });

  it("does not wait on a refusal that gives no wait, or one longer than a minute", () => {
    const noWait = new ApiError(429, "rate_limited", "Too many requests right now. Try again in an hour.");
    const anHour = new ApiError(429, "rate_limited", "Not until tomorrow.", { retry_after_seconds: 3600 });
    const words = new ApiError(429, "rate_limited", "x", { retry_after_seconds: "soon" });
    for (const e of [noWait, anHour, words]) {
      expect(isMinuteRefusal(e)).toBe(false);
      expect(retryRead(0, e)).toBe(false);
    }
    expect(isMinuteRefusal(refusal(59))).toBe(true);
    expect(isMinuteRefusal(refusal(60))).toBe(true);
    expect(isMinuteRefusal(new ApiError(429, "other", "x", { retry_after_seconds: 5 }))).toBe(false);
  });

  it("gives a read that asks only when refused the same bound, and nothing else", () => {
    expect(retryRefusedRead(0, refusal())).toBe(true);
    expect(retryRefusedRead(3, refusal())).toBe(false);
    expect(retryRefusedRead(0, new ApiError(500, "error", "x"))).toBe(false);
    expect(retryRefusedRead(0, new ApiError(404, "not_found", "x"))).toBe(false);
  });

  it("waits for the refusal's seconds and a little more, never less, and keeps the usual pause for anything else", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValue(0);
    expect(readRetryDelay(0, refusal(20))).toBe(20_000);
    random.mockReturnValue(0.999);
    expect(readRetryDelay(2, refusal(20))).toBeGreaterThan(24_000);
    expect(readRetryDelay(2, refusal(20))).toBeLessThan(25_001);
    expect(readRetryDelay(0, new ApiError(500, "error", "x"))).toBe(1000);
    expect(readRetryDelay(1, new ApiError(500, "error", "x"))).toBe(2000);
  });
});

describe("a read refused for the minute's calls", () => {
  it("comes back by itself once it may, asks nothing before then, and never shows as failed", async () => {
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? refused(20) : answer({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    const { seen, now, stop } = follow(client(), "/api/v1/p/a/b/c/sources");
    await advance(19_900);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(now().status).toBe("pending");
    await advance(5_200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(now().status).toBe("success");
    expect(now().data).toEqual({ ok: true });
    expect(seen.some((r) => r.isError)).toBe(false);
    stop();
  });

  it("stops after a bound however long it is refused, and then says so as a failure with the server's words", async () => {
    const fetch = vi.fn(async () => refused(59));
    vi.stubGlobal("fetch", fetch);
    const { now, stop } = follow(client(), "/api/v1/p/a/b/c/sources");
    await advance(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(now().status).toBe("error");
    expect((now().error as ApiError).code).toBe("rate_limited");
    stop();
  });

  it("asks nothing more once nobody is reading it", async () => {
    const fetch = vi.fn(async () => refused(20));
    vi.stubGlobal("fetch", fetch);
    const { stop } = follow(client(), "/api/v1/p/a/b/c/sources");
    await advance(1000);
    stop();
    await advance(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not spend the next minute at once: reads refused together come back spread out", async () => {
    const times: number[] = [];
    let first = true;
    const fetch = vi.fn(async () => {
      if (first) return refused(20);
      times.push(Date.now());
      return answer({ ok: true });
    });
    vi.stubGlobal("fetch", fetch);
    const qc = client();
    const started = Date.now();
    const reads = Array.from({ length: 30 }, (_, i) => follow(qc, `/api/v1/p/a/b/c/read-${i}`));
    await advance(10);
    first = false;
    await advance(40_000);
    expect(times).toHaveLength(30);
    for (const t of times) expect(t - started).toBeGreaterThanOrEqual(20_000);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(1_000);
    // One read's second ask, then the next's: no more than a few in any one instant.
    const sameInstant = new Map<number, number>();
    for (const t of times) sameInstant.set(t, (sameInstant.get(t) ?? 0) + 1);
    expect(Math.max(...sameInstant.values())).toBeLessThan(5);
    reads.forEach((r) => r.stop());
  });

  it("does not ask again after an answer that stands", async () => {
    const fetch = vi.fn(async () => answer({ error: { code: "not_found", message: "Gone." } }, 404));
    vi.stubGlobal("fetch", fetch);
    const { now, stop } = follow(client(), "/api/v1/p/a/b/c");
    await advance(5 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(now().status).toBe("error");
    stop();
  });

  it("is said in the product's words wherever a screen is loading, and only while the minute lasts", async () => {
    let pending = true;
    const fetch = vi.fn(async () => (pending ? refused(20) : answer({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    const qc = client();
    function Screen() {
      const q = useQuery({ queryKey: ["a-read"], queryFn: () => api("GET", "/api/v1/p/a/b/c/sources") });
      return q.isPending ? <Loading label="Loading sources…" /> : q.isError ? <p>failed</p> : <p>Read.</p>;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={qc}><Screen /></QueryClientProvider>));
    await advance(1000);
    expect(host.textContent).toContain("Waiting for the next minute");
    expect(host.textContent).toContain("this minute’s calls");
    expect(host.textContent).not.toContain("failed");
    expect(host.textContent).not.toContain("rate_limited");
    pending = false;
    await advance(26_000);
    expect(host.textContent).toBe("Read.");
    await act(async () => root.unmount());
  });

  it("leaves a loading screen as it was when nothing was refused", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Loading label="Loading sources…" />));
    expect(host.textContent).toContain("Loading sources…");
    expect(host.textContent).not.toContain("Waiting for the next minute");
    await act(async () => root.unmount());
  });

  it("does not count a refused write as the minute's calls running out: a write's limit leaves reads alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => refused(20)));
    await expect(api("POST", "/api/v1/p/a/b/c/outcomes", { title: "x" })).rejects.toBeInstanceOf(ApiError);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Loading label="Loading sources…" />));
    expect(host.textContent).not.toContain("Waiting for the next minute");
    await act(async () => root.unmount());
  });
});

describe("a source's title on a chip", () => {
  async function chip(fetch: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetch);
    let seen: Record<string, string | undefined> = {};
    function Chip() {
      seen = useSourceTitles("/api/v1/p/a/b/c", ["s1"]);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<QueryClientProvider client={client()}><Chip /></QueryClientProvider>));
    return { title: () => seen["s1"], close: () => act(async () => root.unmount()) };
  }

  it("waits for the next minute when refused, and arrives by itself", async () => {
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? refused(20) : answer({ title: "Yard visit notes" })));
    const c = await chip(fetch);
    await advance(1000);
    expect(c.title()).toBeUndefined();
    await advance(25_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(c.title()).toBe("Yard visit notes");
    await c.close();
  });

  it("asks once, as before, for anything else", async () => {
    const fetch = vi.fn(async () => answer({ error: { code: "internal", message: "WhatBuild ran into a problem." } }, 500));
    const c = await chip(fetch);
    await advance(5 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(c.title()).toBeUndefined();
    await c.close();
  });
});

describe("the region that says so", () => {
  it("is in a modal dialog too, whose words the app's own would not reach", async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Dialog open onClose={() => {}} title="Story style">A preview</Dialog>));
    const region = host.querySelector("dialog [data-minute-announcer]")!;
    expect(region.textContent).toBe("");
    vi.stubGlobal("fetch", vi.fn(async () => refused(20)));
    await api("GET", "/api/v1/p/a/b/c/sources").catch(() => {});
    await advance(200);
    expect(host.querySelector("dialog [data-minute-announcer]")).toBe(region);
    expect(region.textContent).toContain("Waiting for the next minute");
    await act(async () => root.unmount());
  });

  it("is mounted empty, and says nothing of a refused write", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MinuteAnnouncer />));
    vi.stubGlobal("fetch", vi.fn(async () => refused(20)));
    await api("POST", "/api/v1/p/a/b/c/outcomes", { title: "x" }).catch(() => {});
    await advance(200);
    expect(host.textContent).toBe("");
    await act(async () => root.unmount());
  });
});

const PATH = "acme/core/planner";
const HELD: Product = {
  product_id: "p1", slug: "planner", name: "Planner", archived_at: null, etag: "e1", path: PATH,
  tenant: { tenant_id: "t1", slug: "acme", name: "Acme" }, team: { team_id: "c1", slug: "core", name: "Core" },
  your_role: "viewer", counts: { story_pages: 0 }, stage_counts: { story: 0 },
};

/** The product's screen, as the app's route draws it; `held` is what the app already holds, its answer old enough to be asked again. */
async function productScreen(opts: { held?: boolean } = {}) {
  const qc = client();
  if (opts.held) qc.setQueryData(["product", PATH], HELD, { updatedAt: Date.now() - 60_000 });
  const retried: (() => void)[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/t/${PATH}`]}>
          <Routes>
            <Route
              path="/t/:tenant/:team/:product"
              element={
                <ProductProvider
                  fallback={(e, retry) => {
                    retried[0] = retry;
                    return <p>Couldn’t load: {(e as Error).message}</p>;
                  }}
                >
                  {(ctx) => <p>Showing {ctx.product.name}</p>}
                </ProductProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return { host, qc, retried, close: () => act(async () => root.unmount()) };
}

describe("a product the app already holds", () => {
  it("stays on screen while a re-check of it is refused, and through every refusal the bound allows", async () => {
    const fetch = vi.fn(async () => refused(30));
    vi.stubGlobal("fetch", fetch);
    const s = await productScreen({ held: true });
    await advance(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.host.textContent).toBe("Showing Planner");
    await advance(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(s.qc.getQueryState(["product", PATH])?.status).toBe("error");
    expect(s.host.textContent).toBe("Showing Planner");
    await s.close();
  });

  for (const [status, code] of [[403, "forbidden"], [404, "not_found"], [410, "gone"]] as const)
    it(`is taken away by a ${status}: someone whose access was removed does not keep it`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => answer({ error: { code, message: "No such product is visible to you." } }, status)));
      const s = await productScreen({ held: true });
      await advance(1000);
      expect(s.host.textContent).toBe("Couldn’t load: No such product is visible to you.");
      await s.close();
    });

  it("is taken away when the answer after a refusal is a 404: a refusal delays the answer, and never replaces it", async () => {
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? refused(30) : answer({ error: { code: "not_found", message: "No such product is visible to you." } }, 404)));
    vi.stubGlobal("fetch", fetch);
    const s = await productScreen({ held: true });
    await advance(1000);
    expect(s.host.textContent).toBe("Showing Planner");
    await advance(36_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(s.host.textContent).toBe("Couldn’t load: No such product is visible to you.");
    await s.close();
  });

  for (const [what, error] of [
    ["another code", { code: "too_busy", message: "Too busy.", details: { retry_after_seconds: 20 } }],
    ["no wait", { code: "rate_limited", message: "Too many requests right now." }],
    ["a wait longer than a minute", { code: "rate_limited", message: "Not until tomorrow.", details: { retry_after_seconds: 3600 } }],
  ] as const)
    it(`gives way to a 429 with ${what}: only a refusal for the minute's calls leaves it standing`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => answer({ error }, 429)));
      const s = await productScreen({ held: true });
      await advance(1000);
      expect(s.host.textContent).toBe(`Couldn’t load: ${error.message}`);
      await s.close();
    });

  it("gives way to the failure, as before, on an answer that is not a refusal", async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => answer({ error: { code: "internal", message: "WhatBuild ran into a problem." } }, 500)));
    const s = await productScreen({ held: true });
    s.qc.setDefaultOptions({ queries: { ...readDefaults, retry: false } });
    await act(() => s.qc.invalidateQueries({ queryKey: ["product", PATH] }));
    await vi.waitFor(() => expect(s.host.textContent).toBe("Couldn’t load: WhatBuild ran into a problem."));
    await s.close();
  });
});

describe("a product the app does not hold yet", () => {
  it("waits rather than fail when refused, then opens by itself", async () => {
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? refused(30) : answer(HELD)));
    vi.stubGlobal("fetch", fetch);
    const s = await productScreen();
    await advance(1000);
    expect(s.host.textContent).toContain("Waiting for the next minute");
    expect(s.host.textContent).not.toContain("Couldn’t load");
    await advance(36_000);
    expect(s.host.textContent).toBe("Showing Planner");
    await s.close();
  });

  it("past the bound says so, and asking again from there works without a reload", async () => {
    let open = false;
    const fetch = vi.fn(async () => (open ? answer(HELD) : refused(30)));
    vi.stubGlobal("fetch", fetch);
    const s = await productScreen();
    await advance(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(s.host.textContent).toContain("Couldn’t load");
    open = true;
    await act(async () => s.retried[0]!());
    await advance(100);
    expect(s.host.textContent).toBe("Showing Planner");
    await s.close();
  });
});
