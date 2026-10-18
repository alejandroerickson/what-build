import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Menu, MenuItem, MenuLabel, MenuNote, MenuSeparator } from "../src/ui/menu.tsx";

// A separator divides what is around it. Whatever a person's role and the object's state leave in
// a menu, none is drawn at its start or its end, and two are never drawn together.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(import.meta.dirname, "../src/styles/ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** The selectors of the stylesheet's rule that leaves a separator undrawn. */
const undrawn = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector, body]) => selector!.includes(".menu-sep") && /display:\s*none/.test(body!))?.[1]?.trim();

beforeAll(() => {
  // A menu asks whether motion is reduced; jsdom has no media queries.
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

/** The menu as it is drawn once opened: each item's words, and "—" for a separator drawn. */
async function drawn(children: ReactNode): Promise<string[]> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(<Menu label="Actions" trigger="More">{children}</Menu>));
  await act(async () => host.querySelector("button")!.click());
  const menu = document.querySelector('[role="menu"]')!;
  return [...menu.children].flatMap((el) => (el.classList.contains("menu-sep") ? (el.matches(undrawn!) ? [] : ["—"]) : [el.textContent?.trim() ?? ""]));
}

describe("a menu's separators", () => {
  it("are left undrawn by a rule of the stylesheet", () => {
    expect(undrawn).toBeTruthy();
  });

  it("never begin a menu, as one left with only what follows a separator would", async () => {
    expect(
      await drawn(
        <>
          {false ? <MenuItem>Edit</MenuItem> : null}
          <MenuSeparator />
          <MenuItem tone="danger">Delete permanently…</MenuItem>
        </>,
      ),
    ).toEqual(["Delete permanently…"]);
  });

  it("never end a menu, or meet another", async () => {
    expect(
      await drawn(
        <>
          <MenuSeparator />
          <MenuSeparator />
          <MenuItem>Edit</MenuItem>
          <MenuSeparator />
          <MenuSeparator />
          <MenuItem>Archive</MenuItem>
          <MenuSeparator />
          {null}
          <MenuSeparator />
        </>,
      ),
    ).toEqual(["Edit", "—", "Archive"]);
  });

  it("divide what they sit between, a label or a note as much as an item", async () => {
    expect(
      await drawn(
        <>
          <MenuLabel>riley@example.com</MenuLabel>
          <MenuSeparator />
          <MenuItem>Settings</MenuItem>
          <MenuSeparator />
          <MenuItem>Sign out</MenuItem>
          <MenuSeparator />
          <MenuNote>Development server</MenuNote>
        </>,
      ),
    ).toEqual(["riley@example.com", "—", "Settings", "—", "Sign out", "—", "Development server"]);
  });
});
