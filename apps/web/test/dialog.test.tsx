import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Dialog } from "../src/ui/dialog.tsx";

// A click on the backdrop closes a dialog. Selecting text in one of its fields and letting go
// outside it is not such a click, though the browser reports one on the dialog.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom draws no modal layer; a dialog that opens is enough here.
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

async function opened(onClose: () => void) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () =>
    root.render(
      <Dialog open onClose={onClose} title="Rename Acme">
        <input aria-label="Name" defaultValue="Acme" />
      </Dialog>,
    ),
  );
  return { dialog: document.querySelector("dialog")!, field: document.querySelector("input")! };
}

/** A press on `down` let go on `up`: the browser clicks the nearest element holding both. */
function press(down: Element, up: Element, clicked: Element) {
  act(() => {
    down.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    up.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    clicked.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("a dialog's backdrop", () => {
  it("closes the dialog when pressed and let go on", async () => {
    const onClose = vi.fn();
    const { dialog } = await opened(onClose);
    press(dialog, dialog, dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open when a selection started in a field ends on it", async () => {
    const onClose = vi.fn();
    const { dialog, field } = await opened(onClose);
    press(field, dialog, dialog);
    expect(onClose).not.toHaveBeenCalled();
    // The next real click on the backdrop still closes it.
    press(dialog, dialog, dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
