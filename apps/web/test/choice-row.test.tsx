import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ChoiceRow } from "../src/ui/field.tsx";

// A checkbox or radio is named by its label, and described by the hint under it: a screen reader
// says "Can submit feedback, checkbox", then the hint, not the whole hint as the name.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  unmount = () => act(() => root.unmount());
  return host;
}

/** The text of the elements an aria-labelledby or aria-describedby names, as a name is computed from them. */
const textOf = (ids: string | null) => (ids ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? `#${id}?`).join(" ");

describe("a choice with a hint", () => {
  it("is named by its label and described by its hint", () => {
    const host = render(<ChoiceRow label="Can submit feedback" hint="When a tool fails or confuses it, it may tell the developer of WhatBuild. Its reports never name you." checked onChange={() => {}} />);
    const box = host.querySelector("input")!;
    expect(textOf(box.getAttribute("aria-labelledby"))).toBe("Can submit feedback");
    expect(textOf(box.getAttribute("aria-describedby"))).toBe("When a tool fails or confuses it, it may tell the developer of WhatBuild. Its reports never name you.");
  });

  it("keeps its count in its name", () => {
    const host = render(<ChoiceRow type="radio" label="This page" count="1 page" hint="Only the page you are on." />);
    expect(textOf(host.querySelector("input")!.getAttribute("aria-labelledby"))).toBe("This page 1 page");
  });

  it("without a hint, is named by the label around it, as before", () => {
    const host = render(<ChoiceRow label="Archived" count={0} />);
    const box = host.querySelector("input")!;
    expect(box.hasAttribute("aria-labelledby")).toBe(false);
    expect(box.hasAttribute("aria-describedby")).toBe(false);
    expect(box.closest("label")?.textContent).toBe("Archived0");
  });
});
