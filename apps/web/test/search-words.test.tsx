import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// What the Search screen and the palette say of the words searched: a quoted query keeps its own
// quotation marks, never doubled inside the app's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/api/v1/p/acme/core/crew";
const APP = "/t/acme/core/crew";
const product = { name: "Crewboard", path: "acme/core/crew", your_role: "editor" };

const SOURCE = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const LATE = "…the crews meet at the yard before seven, load the vans from the list on the board, check the mowers and the trimmers, and then the lead takes the pallet of mulch to the first job of the day.";
/** What plain search answers for a query, when it finds anything: a source whose title holds the words too, or an assumption. */
const found: Record<string, unknown> = {
  "two crews": {
    query: "two crews",
    terms: [{ text: "two", phrase: false }, { text: "crews", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
    results: [
      { kind: "assumption", id: "a1", title: "Two crews share one van on Mondays.", title_marks: [[0, 9]], snippet: null, snippet_marks: [], missing: [], score: 1, meta: { status: "confirmed" } },
    ],
  },
  // A piece whose words come late in its excerpt, past what two lines hold on a phone.
  "pallet": {
    query: "pallet",
    terms: [{ text: "pallet", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { source: 1 },
    results: [
      {
        kind: "source", id: SOURCE, title: "Yard visit notes", title_marks: [], snippet: null, snippet_marks: [], missing: [], score: 1,
        meta: { date: "2026-09-12", tags: [] }, hit_count: 1,
        hits: [{ field: "text", annotation_id: null, char_start: 0, match_start: 160, text: LATE, marks: [[LATE.indexOf("pallet"), LATE.indexOf("pallet") + 6]] }],
      },
    ],
  },
  // What a page says of markup, as plain search returns it: text that only looks like a tag.
  "markup": {
    query: "markup",
    terms: [{ text: "markup", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { mockup: 1 },
    results: [
      {
        kind: "mockup", id: "m1", title: "<img src=x onerror=alert(1)> markup", title_marks: [[29, 35]], snippet: "markup < script>alert(1)</ script> <b onclick=alert(1)", snippet_marks: [[0, 6]], missing: [], score: 1,
        meta: { page_id: "board", page_title: "<svg onload=alert(1)>", pages: 1 },
      },
    ],
  },
  // A title whose word falls past where its line is cut.
  "schedulers": {
    query: "schedulers",
    terms: [{ text: "schedulers", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
    results: [
      {
        kind: "assumption", id: "a2", title: "Quarterly planning review of the northern depots and their lead schedulers on call", title_marks: [[64, 74]], snippet: null, snippet_marks: [], missing: [], score: 1,
        meta: { status: "unreviewed" },
      },
    ],
  },
  // The same words as a phrase, one mark, and as two words side by side, a mark each.
  '"lead schedulers"': {
    query: '"lead schedulers"',
    terms: [{ text: "lead schedulers", phrase: true }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
    results: [
      {
        kind: "assumption", id: "a2", title: "Quarterly planning review of the northern depots and their lead schedulers on call", title_marks: [[59, 74]], snippet: null, snippet_marks: [], missing: [], score: 1,
        meta: { status: "unreviewed" },
      },
    ],
  },
  "lead schedulers": {
    query: "lead schedulers",
    terms: [{ text: "lead", phrase: false }, { text: "schedulers", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
    results: [
      {
        kind: "assumption", id: "a2", title: "Quarterly planning review of the northern depots and their lead schedulers on call", title_marks: [[59, 63], [64, 74]], snippet: null, snippet_marks: [], missing: [], score: 1,
        meta: { status: "unreviewed" },
      },
    ],
  },
  // Two words far apart: the line shows the first, and does not move to reach the second.
  "planning schedulers": {
    query: "planning schedulers",
    terms: [{ text: "planning", phrase: false }, { text: "schedulers", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
    results: [
      {
        kind: "assumption", id: "a2", title: "Quarterly planning review of the northern depots and their lead schedulers on call", title_marks: [[10, 18], [64, 74]], snippet: null, snippet_marks: [], missing: [], score: 1,
        meta: { status: "unreviewed" },
      },
    ],
  },
  // A title that says one of the words early, and both together late, with its marks as search gives them.
  ...Object.fromEntries(
    (
      [
        ["common mowerlog", "Yard leads across the northern depots keep one common rota for each crew they run, and each common mowerlog"],
        ["shared depotlog", "One shared rota for each crew and each shared depotlog is signed off at the end of a long hard week"],
        ["common weekly", "Yard leads across the northern depots keep one common rota for each crew they run, and a common and weekly log"],
        ["plan board", "Plans planning across the northern depots, then a long review of each plan and the board"],
        ["common", "Yard leads across the northern depots keep one common rota for each crew they run, and each common log"],
      ] as const
    ).map(([query, title]) => {
      const words = query.trim().split(" ");
      const title_marks = [...title.matchAll(new RegExp(`\\b(?:${words.join("|")})\\w*`, "gi"))].map((m) => [m.index, m.index + m[0].length]);
      return [
        query,
        {
          query,
          terms: words.map((text) => ({ text, phrase: false })),
          ignored: [], kind_hint: null, corrections: [], partial: false, counts: { assumption: 1 },
          results: [{ kind: "assumption", id: "a3", title, title_marks, snippet: null, snippet_marks: [], missing: [], score: 1, meta: { status: "unreviewed" } }],
        },
      ];
    }),
  ),
  "gate codes": {
    query: "gate codes",
    terms: [{ text: "gate", phrase: false }, { text: "codes", phrase: false }],
    ignored: [], kind_hint: null, corrections: [], partial: false, counts: { source: 1 },
    results: [
      {
        kind: "source", id: SOURCE, title: "Gate codes — crew lead interview", title_marks: [[0, 10]], snippet: null, snippet_marks: [], missing: [], score: 1,
        meta: { date: "2026-09-10", tags: [] }, hit_count: 3,
        hits: [
          { field: "text", annotation_id: null, char_start: 412, match_start: 530, text: "the gate codes in the text are old", marks: [[4, 14]] },
          { field: "text", annotation_id: null, char_start: 980, match_start: 984, text: "new gate codes every week", marks: [[4, 14]] },
        ],
      },
    ],
  },
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    const query = new URLSearchParams(path.split("?")[1]).get("query") ?? "";
    return found[query] ?? { query, terms: [], ignored: [], kind_hint: null, corrections: [], partial: false, counts: {}, results: [] };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite: true, canDelete: false }),
}));

const { SearchPage } = await import("../src/routes/search.tsx");
const { PHONE_QUERY } = await import("../src/ui/media.ts");
const { FindProvider, FindLauncher } = await import("../src/shell/find-palette.tsx");

/** Whether the window is phone width, as matchMedia answers it here. */
let phone = false;

beforeAll(() => {
  window.matchMedia ??= (query: string) =>
    ({ matches: phone && query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let unmount: (() => void) | null = null;
afterEach(() => {
  phone = false;
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

describe("the palette", () => {
  it("names its dialog and its field apart", async () => {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    const dialog = document.querySelector<HTMLDialogElement>("dialog.find-pal")!;
    const field = dialog.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Search Crewboard");
    expect(field.getAttribute("aria-label")).toBe("Words to search for");
    expect(field.placeholder).toBe("Search Crewboard");
  });
});

describe("a palette line on a phone", () => {
  async function line(query: string) {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    await act(async () => type(document.querySelector<HTMLInputElement>("dialog.find-pal input")!, query));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    await settle();
    return document.querySelector(".find-pal-line")!;
  }

  it("starts a few words before the word it matched, so its two lines show it", async () => {
    phone = true;
    const shown = (await line("pallet")).textContent!.replace(/^In its text /, "");
    expect(shown.startsWith("…")).toBe(true);
    expect(shown.indexOf("pallet")).toBeLessThanOrEqual(41);
    expect(shown).toMatch(/^…\S/);
    expect(LATE.endsWith(shown.slice(1))).toBe(true);
  });

  it("keeps the excerpt as it came on a wider screen", async () => {
    expect((await line("pallet")).textContent).toBe(`In its text ${LATE}`);
  });
});

describe("what a search says of a page, whatever it looks like", () => {
  const noMarkup = (root: Element) => {
    for (const made of ["img", "script", "b", "[onerror]", "[onload]", "[onclick]"]) expect(root.querySelector(made), made).toBeNull();
  };

  it("is drawn as text on the Search screen", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=markup`);
    noMarkup(host);
    expect(host.textContent).toContain("<img src=x onerror=alert(1)> markup");
    expect(host.textContent).toContain("markup < script>alert(1)</ script> <b onclick=alert(1)");
    expect(host.querySelector("mark")?.textContent).toBe("markup");
  });

  it("is drawn as text in the palette", async () => {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    await act(async () => type(document.querySelector<HTMLInputElement>("dialog.find-pal input")!, "markup"));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    await settle();
    const row = document.querySelector(".find-pal-opt")!;
    noMarkup(row);
    expect(row.textContent).toContain("<img src=x onerror=alert(1)> markup");
    expect(row.textContent).toContain("< script>alert(1)</ script>");
    expect(row.textContent).toContain("<svg onload=alert(1)>");
  });
});

describe("a palette title cut before the word it matched", () => {
  const LINE = 20;
  const ROOM = 30;
  const drawn = (el: Element): string => {
    let text = "";
    for (const node of el.childNodes) {
      if (node instanceof Text) text += node.data;
      else if (node instanceof Element && !node.classList.contains("visually-hidden")) text += drawn(node);
    }
    return text;
  };
  const one = (el: Element) => el.classList.contains("one-line");
  const layout = {
    clientHeight: (el: Element) => (one(el) ? LINE : 0),
    scrollHeight: (el: Element) => (one(el) ? LINE * Math.max(1, Math.ceil((drawn(el).length + (el.hasAttribute("data-cut") ? 1 : 0) + (el.hasAttribute("data-lead") ? 1 : 0)) / ROOM)) : 0),
  };
  beforeAll(() => {
    for (const [name, get] of Object.entries(layout)) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return get(this); } });
  });
  afterAll(() => {
    for (const name of Object.keys(layout)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });

  async function title(query: string) {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    await act(async () => type(document.querySelector<HTMLInputElement>("dialog.find-pal input")!, query));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    await settle();
    return document.querySelector<HTMLElement>(".find-pal-title .one-line")!;
  }

  it("shows the word, marked, after an ellipsis, with the whole title still read and on hover", async () => {
    const line = await title("schedulers");
    const whole = "Quarterly planning review of the northern depots and their lead schedulers on call";
    expect(line.querySelector("mark")?.textContent).toBe("schedulers");
    expect(drawn(line).endsWith("schedulers")).toBe(true);
    expect(line.hasAttribute("data-lead")).toBe(true);
    expect(line.textContent).toBe(whole);
    expect(line.getAttribute("title")).toBe(whole);
  });

  it("shows all of a phrase past the cut, marked, and not only its first word", async () => {
    const line = await title('"lead schedulers"');
    expect(line.querySelector("mark")?.textContent).toBe("lead schedulers");
    expect(drawn(line)).toContain("lead schedulers");
    expect(line.hasAttribute("data-lead")).toBe(true);
  });

  it("shows words side by side together too, each marked", async () => {
    const line = await title("lead schedulers");
    expect([...line.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["lead", "schedulers"]);
    expect(drawn(line)).toContain("lead schedulers");
  });

  it("stays at its first words for a word they hold, though another falls past the cut", async () => {
    const line = await title("planning schedulers");
    expect(line.querySelector("mark")?.textContent).toBe("planning");
    expect(line.hasAttribute("data-lead")).toBe(false);
  });

  const marked = (line: Element) => [...line.querySelectorAll("mark")].map((m) => m.textContent);

  it("shows two words where they stand together, though one of them also comes earlier in the title", async () => {
    const line = await title("common mowerlog");
    expect(marked(line)).toEqual(["common", "mowerlog"]);
    expect(drawn(line)).toContain("common mowerlog");
    expect(line.hasAttribute("data-lead")).toBe(true);
    // The whole title is still read, and shown on hover.
    expect(line.textContent).toContain("keep one common rota");
    expect(line.getAttribute("title")).toContain("keep one common rota");
  });

  it("prefers the place where they stand closest, when the earlier place is near enough to hold them both on a wider line", async () => {
    const line = await title("shared depotlog");
    expect(marked(line)).toEqual(["shared", "depotlog"]);
    expect(drawn(line)).toContain("shared depotlog");
  });

  it("shows two words with a word between them, where one of them also comes earlier", async () => {
    const line = await title("common weekly");
    expect(marked(line)).toEqual(["common", "weekly"]);
    expect(drawn(line)).toContain("common and weekly");
  });

  it("does not take two forms of one word for two words", async () => {
    const line = await title("plan board");
    expect(marked(line)).toEqual(["plan", "board"]);
    expect(drawn(line)).toContain("plan and the board");
  });

  it("starts at a single word's first place, however often the title says it", async () => {
    const line = await title("common");
    expect(marked(line)).toEqual(["common"]);
    expect(drawn(line)).toContain("keep one common");
  });

  it("keeps the words a title starts with when the word is among them", async () => {
    const line = await title("gate codes");
    expect(line.querySelector("mark")?.textContent).toBe("Gate codes");
    expect(line.hasAttribute("data-lead")).toBe(false);
    expect(drawn(line).startsWith("Gate codes")).toBe(true);
  });
});

function Where() {
  const loc = useLocation();
  return <output className="where">{`${loc.pathname}${loc.search}`}</output>;
}

describe("following a source in the palette", () => {
  it("opens it where the words are in its text, marked from the match its line shows, even when its title holds them too", async () => {
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
        <Where />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    const field = document.querySelector<HTMLInputElement>("dialog.find-pal input")!;
    await act(async () => type(field, "gate codes"));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    await settle();
    expect(document.querySelector(".find-pal-opt")?.textContent).toContain("In its text");
    await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    const where = new URL(document.querySelector(".where")!.textContent!, "http://app.example.com");
    expect(where.pathname).toBe(`${APP}/evidence/${SOURCE}`);
    expect(where.searchParams.get("view")).toBe("text");
    expect(where.searchParams.get("find")).toBe("gate codes");
    // At the match the line shows, past where its piece starts.
    expect(where.searchParams.get("at")).toBe("530");
  });
});

describe("an assumption among the results", () => {
  it("says its status once on the Search screen, as a badge, and once in the palette, in its line", async () => {
    const host = await render(<SearchPage />, `${APP}/search?q=${encodeURIComponent("two crews")}`);
    const row = host.querySelector(".find-item")!;
    expect(row.querySelector(".find-meta")?.textContent).toBe("Assumption");
    expect(row.querySelector(".status")?.textContent).toBe("Confirmed");
    expect(row.textContent!.match(/Confirmed/g)).toHaveLength(1);
    unmount?.();
    await render(
      <FindProvider app={APP} base={BASE} product={product as never}>
        <FindLauncher product={product as never} />
      </FindProvider>,
      `${APP}/evidence`,
    );
    await act(async () => document.querySelector<HTMLButtonElement>(".find-launch")!.click());
    await act(async () => type(document.querySelector<HTMLInputElement>("dialog.find-pal input")!, "two crews"));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    await settle();
    expect(document.querySelector(".find-pal-meta")?.textContent).toBe("Assumption · Confirmed");
  });
});
