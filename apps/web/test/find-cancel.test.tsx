import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, retryRead } from "../src/lib/api.ts";
import { useFind } from "../src/lib/find.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A search typed past is cancelled, and one that fails is not asked again by itself, so abandoned
// and failed searches do not pile up on the server.

let seen: ReturnType<typeof useFind>;
function Probe({ q }: { q: string }) {
  seen = useFind("/api/v1/p/a/b/c", q);
  return null;
}

const asked: { url: string; signal: AbortSignal }[] = [];
let answer: () => Promise<Response>;
const hangs = (signal: AbortSignal) =>
  new Promise<Response>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });

let root: Root;
const show = async (q: string) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe q={q} />
      </QueryClientProvider>,
    );
  });
};
let client: QueryClient;

beforeEach(() => {
  asked.length = 0;
  answer = () => new Promise(() => {});
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    asked.push({ url, signal: init.signal! });
    return answer === undefined ? hangs(init.signal!) : answer();
  });
  // As the app has it (main.tsx): a read asks again after a server error, unless it says not to.
  client = new QueryClient({ defaultOptions: { queries: { retry: retryRead, retryDelay: 1 } } });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("searching as you type", () => {
  it("cancels the search typed past, and keeps the one asked for now", async () => {
    answer = undefined as never;
    await show("cre");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toContain("query=cre");
    expect(asked[0]!.signal.aborted).toBe(false);
    await show("crew");
    expect(asked).toHaveLength(2);
    expect(asked[0]!.signal.aborted).toBe(true);
    expect(asked[1]!.signal.aborted).toBe(false);
  });

  it("cancels the search when the person leaves it", async () => {
    answer = undefined as never;
    await show("crew");
    expect(asked[0]!.signal.aborted).toBe(false);
    act(() => root.unmount());
    expect(asked[0]!.signal.aborted).toBe(true);
    root = createRoot(document.createElement("div"));
  });

  it("does not ask again by itself after a search fails, and says what the server said", async () => {
    answer = async () => new Response(JSON.stringify({ error: { code: "search_timed_out", status: 503, message: "This search took longer than 5 seconds, so it was stopped." } }), { status: 503 });
    await show("crew");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(asked).toHaveLength(1);
    expect(seen.isError).toBe(true);
    expect(seen.error).toBeInstanceOf(ApiError);
    expect((seen.error as ApiError).code).toBe("search_timed_out");
  });
});
