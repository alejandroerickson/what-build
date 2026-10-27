import { act, useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Inspector, PanelFilter, ShellContext, type ShellSlots } from "../src/shell/slots.tsx";
import { FiltersInUse } from "../src/ui/layout.tsx";
import { OneLine, wordEnds } from "../src/ui/one-line.tsx";

// A title kept to one line (in a panel, the inspector, a list of results, a filter chip) is cut
// after its last whole word that leaves room for the ellipsis, in reading order, as a crumb is: a
// title that mixes English and Arabic keeps the words it starts with. jsdom lays nothing out, so
// these give each line a room of so many characters, and say what it may draw there.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINE = 20;
/** How many characters a line has room for; none while it is hidden. */
let room = 30;
let hidden = false;

/** What a line draws: its words but the hidden rest, a character more for each marked match (its padding), and the ellipsis. */
function drawn(el: Element): string {
  let text = "";
  for (const node of el.childNodes) {
    if (node instanceof Text) text += node.data;
    else if (node instanceof Element && !node.classList.contains("visually-hidden")) text += (node.localName === "mark" ? " " : "") + drawn(node);
  }
  return text;
}

/** One ResizeObserver, told by the test when the room has changed. */
class Observer {
  static all = new Set<Observer>();
  targets = new Set<Element>();
  call: ResizeObserverCallback;
  constructor(call: ResizeObserverCallback) {
    this.call = call;
    Observer.all.add(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
}
async function resize(chars: number, show = true) {
  room = chars;
  hidden = !show;
  await act(async () => {
    for (const o of Observer.all) if (o.targets.size) o.call([...o.targets].map((target) => ({ target })) as ResizeObserverEntry[], o as unknown as ResizeObserver);
  });
}

const one = (el: Element) => !hidden && el.classList.contains("one-line");
const layout = {
  clientHeight: (el: Element) => (one(el) ? LINE : 0),
  scrollHeight: (el: Element) => (one(el) ? LINE * Math.max(1, Math.ceil(([...drawn(el)].length + (el.hasAttribute("data-cut") ? 1 : 0)) / room)) : 0),
  clientWidth: (el: Element) => (one(el) ? room * 8 : 0),
};

beforeAll(() => {
  for (const [name, get] of Object.entries(layout)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return get(this); } });
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observer;
});
afterAll(() => {
  for (const name of Object.keys(layout)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  room = 30;
  hidden = false;
});

async function render(node: ReactNode): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return host;
}

/** The line, what it shows, and whether it is cut with the whole title kept to be read and hovered. */
function line(host: HTMLElement, within = "") {
  const el = host.querySelector<HTMLElement>(`${within} .one-line`.trim())!;
  return { el, shown: drawn(el), cut: el.hasAttribute("data-cut"), title: el.getAttribute("title"), text: el.textContent, dir: el.getAttribute("dir") };
}

const MIXED = "Crew lead interview مقابلة مع قائد الطاقم";
const ARABIC = "مقابلة مع قائد الطاقم حول جدول المناوبات";
const SHORT = "Crew lead interview";

describe("a title on one line", () => {
  it("that mixes directions is cut after its last whole word that leaves room for the ellipsis", async () => {
    const l = line(await render(<OneLine text={MIXED} />));
    expect(l).toMatchObject({ shown: "Crew lead interview مقابلة مع", cut: true, title: MIXED, text: MIXED, dir: "auto" });
  });

  it("in Arabic alone is cut after a whole word, in its own direction", async () => {
    const l = line(await render(<OneLine text={ARABIC} />));
    expect(l).toMatchObject({ shown: "مقابلة مع قائد الطاقم حول", cut: true, title: ARABIC, text: ARABIC, dir: "auto" });
  });

  it("that fits is shown whole, with no ellipsis and no tooltip", async () => {
    const l = line(await render(<OneLine text={SHORT} />));
    expect(l).toMatchObject({ shown: SHORT, cut: false, title: null, text: SHORT });
  });

  it("of names joined by a dot is cut before the dot, not after it", async () => {
    const context = "Harbor Labs · Product team";
    expect(wordEnds(context).map((i) => context.slice(0, i))).toEqual(["Harbor", "Harbor Labs", "Harbor Labs · Product"]);
  });

  it("is cut again when its room changes, and only then", async () => {
    const host = await render(<OneLine text={MIXED} />);
    expect(line(host).shown).toBe("Crew lead interview مقابلة مع");
    await resize(60);
    expect(line(host)).toMatchObject({ shown: MIXED, cut: false });
    await resize(12);
    expect(line(host)).toMatchObject({ shown: "Crew lead", cut: true, text: MIXED });
  });

  it("is measured again when the panel it is in is shown just after it was measured", async () => {
    // As the shell shows the panel a screen fills: in a layout effect after the line's own.
    function ShowPanel() {
      useLayoutEffect(() => {
        hidden = false;
      }, []);
      return null;
    }
    hidden = true;
    const host = await render(
      <>
        <OneLine text={MIXED} />
        <ShowPanel />
      </>,
    );
    expect(line(host)).toMatchObject({ shown: "Crew lead interview مقابلة مع", cut: true });
  });

  it("drawn with a marked match is cut a word earlier when the mark leaves no room", async () => {
    const host = await render(<OneLine text={MIXED} render={(shown) => <>{shown.slice(0, 5)}<mark>{shown.slice(5, 9)}</mark>{shown.slice(9)}</>} />);
    const l = line(host);
    expect(l).toMatchObject({ cut: true, text: MIXED, title: MIXED });
    const parts = [...l.el.childNodes].filter((n) => !(n instanceof Element && n.classList.contains("visually-hidden")));
    expect(parts.map((n) => [n.nodeName, n.textContent])).toEqual([["#text", "Crew "], ["MARK", "lead"], ["#text", " interview مقابلة"]]);
  });
});

describe("titles cut on one line", () => {
  it("in a side panel's filters, such as its mockups", async () => {
    const host = await render(
      <PanelFilter to="/mockups/m1" current={false} count={3}>
        {MIXED}
      </PanelFilter>,
    );
    expect(line(host, ".panel-filter")).toMatchObject({ shown: "Crew lead interview مقابلة مع", cut: true, title: MIXED });
    expect(host.querySelector(".panel-filter")?.textContent).toBe(`${MIXED}3`);
  });

  it("at the head of the inspector", async () => {
    const inspectorEl = document.createElement("aside");
    document.body.append(inspectorEl);
    const slots: ShellSlots = {
      panelContextEl: null, inspectorEl, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
      inspectorOpen: true, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
    };
    await render(
      <ShellContext.Provider value={slots}>
        <Inspector title={ARABIC}>Details</Inspector>
      </ShellContext.Provider>,
    );
    expect(line(inspectorEl, ".inspector-title")).toMatchObject({ shown: "مقابلة مع قائد الطاقم حول", cut: true, title: ARABIC });
    expect(inspectorEl.querySelector("h2")?.textContent).toBe(ARABIC);
  });

  it("in a filter chip, which is as wide as its words", async () => {
    const label = `For ${ARABIC}`;
    const host = await render(<FiltersInUse chips={[{ label, to: "/" }]} clearTo="/" />);
    expect(line(host, ".filters-in-use-chip")).toMatchObject({ shown: "For مقابلة مع قائد الطاقم حول", cut: true, title: label, text: label });
  });

  it("but not when they fit", async () => {
    const host = await render(
      <PanelFilter to="/mockups/m1" current>
        {SHORT}
      </PanelFilter>,
    );
    expect(line(host, ".panel-filter")).toMatchObject({ shown: SHORT, cut: false, title: null });
  });
});
