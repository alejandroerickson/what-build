import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Crumbs } from "../src/ui/layout.tsx";
import { wordEnds } from "../src/ui/one-line.tsx";

// A crumb's label takes its own direction, and a long one is cut after a word in reading order, so a
// title that mixes English and Arabic keeps the words it starts with. Layout decides where; these
// check what it may choose from, and that the whole label is always there to be read.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

describe("crumbs", () => {
  it("are cut only at the end of a word, leaving out the spaces and the dash or comma before the next", () => {
    const title = "Crew lead interview — Example Co, Sep 2026";
    expect(wordEnds(title).map((i) => title.slice(0, i))).toEqual([
      "Crew", "Crew lead", "Crew lead interview", "Crew lead interview — Example", "Crew lead interview — Example Co", "Crew lead interview — Example Co, Sep",
    ]);
    const mixed = "Crew lead interview مقابلة مع قائد الطاقم";
    expect(wordEnds(mixed).map((i) => mixed.slice(0, i)).slice(2, 4)).toEqual(["Crew lead interview", "Crew lead interview مقابلة"]);
    expect(wordEnds(" Leading space")).toEqual([8]);
    expect(wordEnds("Unbroken")).toEqual([]);
  });

  it("give each label its own direction and the whole of it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = () => act(() => root.unmount());
    const title = "مقابلة مع قائد الطاقم — Crew lead interview";
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Crumbs items={[{ label: "Evidence", to: "/evidence" }, { label: title }]} />
        </MemoryRouter>,
      );
    });
    const labels = [...host.querySelectorAll(".one-line")];
    expect(labels.map((l) => l.getAttribute("dir"))).toEqual(["auto", "auto"]);
    expect(labels.map((l) => l.textContent)).toEqual(["Evidence", title]);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(title);
  });
});
