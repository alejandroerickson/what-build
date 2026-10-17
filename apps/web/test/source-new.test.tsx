import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: { method: string; path: string }[] = [];
vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string) => {
    calls.push({ method, path });
    if (method === "POST" && path.endsWith("/sources")) return { record_id: "rec_1" };
    return { records: [], tags: [], added_by: [], sources: 0 };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: "/api/v1/products/p", app: "/t/acme/core/app", canWrite: true }),
}));

const { SourceNewPage } = await import("../src/routes/source-new.tsx");

function Where() {
  const loc = useLocation();
  return <output>{loc.pathname}</output>;
}

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  calls.length = 0;
  vi.restoreAllMocks();
});

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`No button “${label}”`);
  return b;
}

describe("adding a source in the app", () => {
  it("opens the new source once it is created, without updating the router while the page renders", async () => {
    const errors = vi.spyOn(console, "error");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = () => act(() => root.unmount());
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={["/t/acme/core/app/evidence/new"]}>
            <Routes>
              <Route path="/t/acme/core/app/evidence/new" element={<SourceNewPage />} />
              <Route path="*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => type(host.querySelector("input")!, "Workshop notes"));
    await act(async () => button(host, "Continue").click());
    await act(async () => button(host, "Continue without attachments").click());
    await act(async () => button(host, "Create source").click());
    expect(calls).toContainEqual({ method: "POST", path: "/api/v1/products/p/sources" });
    expect(host.querySelector("output")?.textContent).toBe("/t/acme/core/app/evidence/rec_1");
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("Cannot update a component"))).toEqual([]);
  });
});
