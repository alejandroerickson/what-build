import { describe, expect, it } from "vitest";
import { setBox } from "../src/e2e-browser.ts";

/** A box as the browser sees it. `settlesAfter` is how many looks it takes to show a click: a controlled box shows it once the app has it. */
function box({ checked = false, type = "radio", settlesAfter = 0, changes = true } = {}) {
  let state = checked;
  let pending = -1;
  const made = {
    clicks: 0,
    async isChecked() {
      if (pending === 0) {
        state = !state;
        pending = -1;
      } else if (pending > 0) pending--;
      return state;
    },
    async getAttribute(name: string) {
      return name === "type" ? type : null;
    },
    async click() {
      made.clicks++;
      if (changes) pending = settlesAfter;
    },
  };
  return made;
}

describe("pnpm e2e browser check and uncheck", () => {
  it("passes on a box whose state lives in the app, once it shows the change", async () => {
    const radio = box({ settlesAfter: 3 });
    await setBox(radio, true, "One product");
    expect(radio.clicks).toBe(1);
    expect(await radio.isChecked()).toBe(true);
  });

  it("clicks nothing when the box already shows it", async () => {
    const radio = box({ checked: true });
    await setBox(radio, true, "One product");
    expect(radio.clicks).toBe(0);
  });

  it("clears a checkbox", async () => {
    const tick = box({ checked: true, type: "checkbox", settlesAfter: 1 });
    await setBox(tick, false, "Send me mail");
    expect(await tick.isChecked()).toBe(false);
  });

  it("still fails on a box that never shows it, saying so", async () => {
    const stuck = box({ changes: false });
    await expect(setBox(stuck, true, "One product", 60)).rejects.toThrow('Clicking "One product" did not check it: it still shows the old state 60 ms later.');
    expect(stuck.clicks).toBe(1);
  });

  it("refuses to clear a radio without clicking it", async () => {
    const radio = box({ checked: true });
    await expect(setBox(radio, false, "One product")).rejects.toThrow('"One product" is a radio, which clears only when another in its group is checked.');
    expect(radio.clicks).toBe(0);
  });
});
