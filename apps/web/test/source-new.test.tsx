import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MiB = 1024 * 1024;
const calls: { method: string; path: string }[] = [];
const puts: { url: string; headers: Record<string, string> }[] = [];
const completed: unknown[] = [];
let grant: unknown = null;
let refuseComplete = false;
vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path });
    if (method === "POST" && path.endsWith("/sources")) return { record_id: "rec_1" };
    if (path.endsWith("/limits"))
      return {
        you_meet_them: true,
        limits: [{ key: "file_max_bytes", value: 100 * MiB }],
        deployment_limits: [{ key: "upload_max_bytes", value: MiB }],
      };
    if (path.endsWith("/uploads")) return grant;
    if (path.endsWith("/uploads/complete")) {
      if (refuseComplete) throw new Error("Not added.");
      completed.push(body);
      return {};
    }
    return { records: [], tags: [], added_by: [], sources: 0 };
  }),
  putWithProgress: vi.fn(async (url: string, headers: Record<string, string>, file: File, onProgress: (loaded: number) => void) => {
    puts.push({ url, headers });
    onProgress(file.size);
  }),
}));
const product = { readOnlyOrganization: false };
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({
    api: "/api/v1/products/p",
    app: "/t/acme/core/app",
    canWrite: !product.readOnlyOrganization,
    readOnlyOrganization: product.readOnlyOrganization,
    product: { archived_at: null, tenant: { slug: "acme", name: "Acme" } },
  }),
}));

const { SourceNewPage, uploadFiles } = await import("../src/routes/source-new.tsx");
type UploadItem = import("../src/routes/source-new.tsx").UploadItem;

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
  puts.length = 0;
  completed.length = 0;
  refuseComplete = false;
  product.readOnlyOrganization = false;
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

describe("uploading a file", () => {
  const relay = { url: "/api/v1/uploads/g1", headers: { "X-WhatBuild-Upload-Grant": "t" }, max_bytes: 100 };
  const direct = { url: "https://storage.example/k", headers: { "x-goog-content-length-range": "0,1000" }, max_bytes: 1000 };
  const item = (size: number): UploadItem => ({ file: new File([new Uint8Array(size)], "deck.pptx"), state: "waiting", loaded: 0 });

  it("sends a file through the server's own route, with nothing more to call", async () => {
    grant = relay;
    const updates: Partial<UploadItem>[] = [];
    expect(await uploadFiles("/api/v1/p/a", "rec_1", [item(50)], (_i, patch) => updates.push(patch))).toBe(true);
    expect(puts).toEqual([{ url: relay.url, headers: relay.headers }]);
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/p/a/sources/rec_1/uploads"]);
    expect(updates.at(-1)).toMatchObject({ state: "done", loaded: 50 });
  });

  it("sends a file past that route straight to the store, then tells the server to add it", async () => {
    grant = { ...relay, direct };
    expect(await uploadFiles("/api/v1/p/a", "rec_1", [item(500)], () => {})).toBe(true);
    expect(puts).toEqual([{ url: direct.url, headers: direct.headers }]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/v1/p/a/sources/rec_1/uploads", "POST /api/v1/p/a/sources/rec_1/uploads/complete"]);
    expect(completed).toEqual([{ path: "deck.pptx" }]);
  });

  it("says a failure of either step, and does not call the file uploaded", async () => {
    grant = { ...relay, direct };
    refuseComplete = true;
    const updates: Partial<UploadItem>[] = [];
    expect(await uploadFiles("/api/v1/p/a", "rec_1", [item(500)], (_i, patch) => updates.push(patch))).toBe(false);
    expect(updates.at(-1)).toMatchObject({ state: "failed", error: "Not added." });
  });
});

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

  it("refuses a file past what the organization takes as it is picked, with no source made and no bytes sent", async () => {
    grant = { url: "/api/v1/uploads/g1", headers: {}, max_bytes: MiB };
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
    const pick = async (...files: File[]) => {
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", { value: files, configurable: true });
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    };
    await act(async () => type(host.querySelector("input")!, "Workshop notes"));
    await act(async () => button(host, "Continue").click());

    await pick(new File([new Uint8Array(MiB + 1)], "too-big.bin"), new File([new Uint8Array(MiB + 1)], "too-big-too.bin"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("too-big.bin, too-big-too.bin are over the 1 MB a file can be here, so they weren’t added.");
    expect(host.querySelector(".intake-file-list")).toBeNull();
    button(host, "Continue without attachments");

    await pick(new File([new Uint8Array(MiB + 1)], "too-big.bin"), new File([new Uint8Array(MiB)], "fits.txt"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("too-big.bin is over the 1 MB a file can be here, so it wasn’t added.");
    expect(host.querySelector(".intake-file-list")?.textContent).toContain("fits.txt");
    expect(host.querySelector(".intake-file-list")?.textContent).not.toContain("too-big.bin");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);

    await pick(new File(["x"], "also-fits.txt"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("says why there is no form in a read-only organization, rather than refusing at Create", async () => {
    product.readOnlyOrganization = true;
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
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Acme is read-only, so nothing new can be added to it or changed until it moves to another plan.");
  });
});
