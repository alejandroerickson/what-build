import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// What the Search screen and the palette say of the words searched: a quoted query keeps its own
// quotation marks, never doubled inside the app's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const product = { name: "Crewboard", path: "acme/core/crew", your_role: "editor" };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    const query = new URLSearchParams(path.split("?")[1]).get("query") ?? "";
    return { query, terms: [], ignored: [], kind_hint: null, corrections: [], partial: false, counts: {}, results: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite: true, canDelete: false }),
}));

const { SearchPage } = await import("../src/routes/search.tsx");
const { FindProvider, FindLauncher } = await import("../src/shell/find-palette.tsx");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode, at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the words a search found nothing for", () => {
  it("are quoted once on the Search screen, a quoted query in its own marks", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=${encodeURIComponent('"van checklist"')}`);
    expect(host.querySelector(".empty-title")?.textContent).toBe("Nothing matches “van checklist”");
    expect(host.querySelector(".empty-text")?.textContent).toBe("Try another word, or fewer words.");
  });

  it("keep a quoted phrase within other words as an inner quotation", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=${encodeURIComponent('"van checklist" crew')}`);
    expect(host.querySelector(".empty-title")?.textContent).toBe("Nothing matches “‘van checklist’ crew”");
  });

  it("are quoted once in the palette", async () => {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    const field = document.querySelector<HTMLInputElement>("dialog.find-pal input")!;
    await act(async () => type(field, '"van checklist"'));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    await settle();
    expect(document.querySelector(".find-pal-empty")?.textContent).toBe("Nothing in Crewboard matches “van checklist”. Try another word.");
  });
});
