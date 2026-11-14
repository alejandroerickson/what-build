import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMove, type MockupList } from "../src/routes/mockup-folders-model.ts";

// The mockups in the panel: those in no folder, then each folder with its own. Anyone who can write
// arranges them with Alt and the arrow keys, a mockup's menu, or by dragging; a viewer reads the
// same arrangement and changes none of it. Which folders are folded away is kept in this browser.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/crew";
const APP = "/t/acme/crew";
const mockup = (id: string, title: string, folder: string | null = null) => ({ mockup_id: id, title, summary: "", folder_id: folder, current_version: 1, archived_at: null, etag: `${id}-1`, updated_at: "2026-10-01T09:00:00.000Z", page_count: 1 });
const start = (): MockupList => ({
  items: [mockup("m1", "Late booking"), mockup("m2", "Crew message"), mockup("m3", "Jobs board", "f1"), mockup("m4", "Day planner", "f1")],
  folders: [{ folder_id: "f1", name: "Weekly planning", etag: "f1-1", mockup_count: 2 }, { folder_id: "f2", name: "Parked", etag: "f2-1", mockup_count: 0 }],
});

const server: { list: MockupList; calls: { method: string; path: string; body: unknown }[] } = { list: start(), calls: [] };
const who = { canWrite: true };

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (method: string, path: string, body?: unknown) => {
      if (method === "GET" && path === `${BASE}/mockups`) return structuredClone(server.list);
      server.calls.push({ method, path, body });
      // The server arranges as the panel does, so the list read again after a move holds it.
      const moved = /\/mockups\/([^/]+)\/move$/.exec(path);
      const folder = /\/mockup-folders\/([^/]+)\/move$/.exec(path);
      const sent = body as { folder_id: string | null; before_mockup_id: string | null; before_folder_id: string | null };
      if (moved) server.list = applyMove(server.list, { kind: "mockup", id: moved[1]!, folder: sent.folder_id, before: sent.before_mockup_id });
      if (folder) server.list = applyMove(server.list, { kind: "folder", id: folder[1]!, before: sent.before_folder_id });
      if (method === "POST" && path === `${BASE}/mockup-folders`) return { folder_id: "f3", name: (body as { name: string }).name, etag: "f3-1", mockup_count: 0 };
      return {};
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product: { product_id: "p1" }, ...who }),
}));

const { MockupTree } = await import("../src/routes/mockup-tree.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  localStorage.clear();
  server.list = start();
  server.calls = [];
  who.canWrite = true;
});

async function open(path = `${APP}/exploration/mockups/m1`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <MockupTree />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** Lets what was asked of the server answer, and the screen follow. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  // What is announced is said on the next frame.
  await act(async () => new Promise((r) => setTimeout(r, 40)));
}

/** The rows on screen, top to bottom: a folder as "[name count]", its mockups indented. */
const rows = () =>
  [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((el) =>
    el.classList.contains("mockup-folder") ? `[${el.textContent}]` : `${el.getAttribute("aria-level") === "2" ? "  " : ""}${el.textContent}`,
  );
const item = (title: string) => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((el) => el.textContent?.startsWith(title))!;
const key = async (el: HTMLElement, init: KeyboardEventInit) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  await settle();
};
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};

describe("the mockups in the panel", () => {
  it("lists the mockups in no folder, then each folder with its own, the open mockup marked", async () => {
    await open();
    expect(rows()).toEqual(["Late booking", "Crew message", "[Weekly planning2]", "  Jobs board", "  Day planner", "[Parked0]"]);
    expect(item("Late booking").getAttribute("aria-current")).toBe("page");
    expect(item("Jobs board").getAttribute("href")).toBe(`${APP}/exploration/mockups/m3`);
    expect(document.body.textContent).toContain("No mockups in this folder");
  });

  it("folds a folder away and remembers it in this browser, but opens the folder of the mockup on screen", async () => {
    await open();
    await click(item("Weekly planning"));
    expect(rows()).toEqual(["Late booking", "Crew message", "[Weekly planning2]", "[Parked0]"]);
    expect(item("Weekly planning").getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(localStorage.getItem("whatbuild.mockup-folders-collapsed.p1")!)).toEqual(["f1"]);
    unmount?.();
    document.body.innerHTML = "";
    await open(`${APP}/exploration/mockups/m4`);
    expect(rows()).toContain("  Day planner");
    expect(item("Day planner").getAttribute("aria-current")).toBe("page");
  });

  it("moves a mockup with Alt and the arrow keys, at once on screen and then on the server", async () => {
    await open();
    await key(item("Crew message"), { key: "ArrowUp", altKey: true });
    expect(rows().slice(0, 2)).toEqual(["Crew message", "Late booking"]);
    expect(server.calls).toEqual([{ method: "POST", path: `${BASE}/mockups/m2/move`, body: { folder_id: null, before_mockup_id: "m1" } }]);
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe("Moved “Crew message” to the top of the mockups in no folder.");
  });

  it("takes a mockup out of its folder with Alt and Left, and says why a move cannot be made", async () => {
    await open();
    await key(item("Jobs board"), { key: "ArrowUp", altKey: true });
    expect(server.calls).toEqual([]);
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe("“Jobs board” is already first in the folder “Weekly planning”.");
    await key(item("Jobs board"), { key: "ArrowLeft", altKey: true });
    expect(server.calls).toEqual([{ method: "POST", path: `${BASE}/mockups/m3/move`, body: { folder_id: null, before_mockup_id: null } }]);
  });

  it("moves a folder among the folders with Alt and the arrow keys", async () => {
    await open();
    await key(item("Parked"), { key: "ArrowUp", altKey: true });
    expect(rows()).toEqual(["Late booking", "Crew message", "[Parked0]", "[Weekly planning2]", "  Jobs board", "  Day planner"]);
    expect(server.calls).toEqual([{ method: "POST", path: `${BASE}/mockup-folders/f2/move`, body: { before_folder_id: "f1" } }]);
  });

  it("walks the rows with the arrow keys, into an open folder and back to it", async () => {
    await open();
    item("Crew message").focus();
    await key(item("Crew message"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Weekly planning"));
    await key(item("Weekly planning"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Jobs board"));
    await key(item("Jobs board"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Weekly planning"));
    await key(item("Weekly planning"), { key: "ArrowLeft" });
    expect(item("Weekly planning").getAttribute("aria-expanded")).toBe("false");
  });

  it("makes a folder from the section's button", async () => {
    await open();
    await click(document.querySelector('button[aria-label="New folder"]')!);
    const input = document.querySelector<HTMLInputElement>("dialog input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Checkout ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Create folder")!);
    expect(server.calls).toEqual([{ method: "POST", path: `${BASE}/mockup-folders`, body: { name: "Checkout" } }]);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("gives a viewer the same arrangement with nothing to move it by", async () => {
    who.canWrite = false;
    await open();
    expect(rows()).toHaveLength(6);
    expect(document.querySelector(".story-grip")).toBeNull();
    expect(document.querySelector(".story-row-more")).toBeNull();
    expect(document.querySelector('button[aria-label="New folder"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Drag a mockup");
    await key(item("Crew message"), { key: "ArrowUp", altKey: true });
    expect(server.calls).toEqual([]);
    // Folding a folder away is theirs to do: it changes nothing anyone else sees.
    await click(item("Weekly planning"));
    expect(rows()).toHaveLength(4);
  });

  it("says there are none yet, and still offers a folder to whoever can write", async () => {
    server.list = { items: [], folders: [] };
    await open(`${APP}/exploration/mockups`);
    expect(document.body.textContent).toContain("None yet");
    expect(document.querySelector('button[aria-label="New folder"]')).not.toBeNull();
  });
});
