import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { characters, TextArea, TextField, tooLong } from "../src/ui/field.tsx";

// A limit on a field is never the browser's, which cuts what is pasted without a word. Text past a
// limit stays as typed, the field says how much is over, and the form refuses to save it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: { method: string; path: string }[] = [];
vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string) => {
    calls.push({ method, path });
    if (method === "POST" && path.endsWith("/sources")) return { record_id: "rec_1" };
    if (method === "POST" && path.endsWith("/assumptions")) return { id: "asm_1" };
    if (path.endsWith("/feedback")) return { ok: true };
    return { items: [], records: [], tags: [], added_by: [], sources: 0 };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: "/api/v1/p/acme/core/app", app: "/t/acme/core/app", canWrite: true, product: { archived_at: null, tenant: { name: "Acme" } } }),
  useMe: () => ({ isPending: false, data: { email: "sam@example.com" } }),
}));

// Asked as the shell's modules load; jsdom has no media queries.
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;

const { SourceNewPage } = await import("../src/routes/source-new.tsx");
const { EditDetails } = await import("../src/routes/source-detail.tsx");
const { EntryEditPage } = await import("../src/routes/registers.tsx");
const { FeedbackDialog } = await import("../src/shell/feedback-dialog.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

const slots = {
  panelContextEl: null, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

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
  calls.length = 0;
  vi.useRealTimers();
});

async function mount(element: React.ReactNode, at = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots as never}>
          <MemoryRouter initialEntries={[at]}>
            <Routes>
              <Route path="*" element={element} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  return host;
}

/** What pasting leaves in a field the browser doesn't cut: the whole text, one input event. */
function paste(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`No button “${label}”`);
  return b;
}

const words = (n: number) => "Crew leads plan by the week. ".repeat(Math.ceil(n / 29)).slice(0, n).replace(/ $/, "x");
const posts = () => calls.filter((c) => c.method !== "GET");

function Field({ as: Control, limit, start, readOnly }: { as: typeof TextField | typeof TextArea; limit: number; start: string; readOnly?: boolean }) {
  const [value, setValue] = useState(start);
  return <Control label="Statement" hint="In one sentence." maxLength={limit} value={value} readOnly={readOnly} onChange={(e: { target: { value: string } }) => setValue(e.target.value)} />;
}

describe.each([
  ["a text field", TextField, "input"],
  ["a text area", TextArea, "textarea"],
] as const)("%s with a limit", (_, Control, tag) => {
  const field = (host: HTMLElement) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(tag)!;

  it("gives the browser no limit, which would cut what is pasted", async () => {
    const host = await mount(<Field as={Control} limit={10} start="" />);
    expect(field(host).hasAttribute("maxlength")).toBe(false);
  });

  it("keeps all of what is pasted, and says how much is over and what to do", async () => {
    const host = await mount(<Field as={Control} limit={1000} start="" />);
    await act(async () => paste(field(host), words(1140)));
    expect(field(host).value).toHaveLength(1140);
    expect(host.querySelector(".field-error")?.textContent).toBe("140 characters over the limit of 1,000. Shorten it to save.");
    expect(host.querySelector(".field-invalid")).not.toBeNull();
  });

  it("tells a screen reader at the field, and once typing rests, without saying it at every key", async () => {
    vi.useFakeTimers();
    const host = await mount(<Field as={Control} limit={10} start="" />);
    const live = host.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("");
    expect(field(host).getAttribute("aria-invalid")).toBeNull();
    await act(async () => paste(field(host), words(12)));
    // Read with the field: it is invalid, and described by its hint and what is wrong.
    expect(field(host).getAttribute("aria-invalid")).toBe("true");
    const described = field(host).getAttribute("aria-describedby")!.split(" ");
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(["In one sentence.", "2 characters over the limit of 10. Shorten it to save."]);
    expect(live.textContent).toBe("");
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => paste(field(host), words(13)));
    await act(async () => vi.advanceTimersByTime(400));
    expect(live.textContent).toBe("");
    await act(async () => vi.advanceTimersByTime(400));
    expect(live.textContent).toBe("3 characters over the limit of 10. Shorten it to save.");
    // And when it fits again, as nothing else would tell them.
    await act(async () => paste(field(host), words(10)));
    await act(async () => vi.advanceTimersByTime(800));
    expect(live.textContent).toBe("Within the limit now.");
  });

  it("says nothing at the limit, and counts one character over as one", async () => {
    const host = await mount(<Field as={Control} limit={10} start="" />);
    await act(async () => paste(field(host), words(10)));
    expect(host.querySelector(".field-error")).toBeNull();
    await act(async () => paste(field(host), words(11)));
    expect(host.querySelector(".field-error")?.textContent).toBe("1 character over the limit of 10. Shorten it to save.");
  });

  it("says nothing of what it can't change", async () => {
    const host = await mount(<Field as={Control} limit={10} start={words(20)} readOnly />);
    expect(host.querySelector(".field-error")).toBeNull();
    expect(field(host).getAttribute("aria-invalid")).toBeNull();
  });
});

describe("tooLong", () => {
  it("counts all of the text in characters, as the server's limits do", () => {
    expect(tooLong("x".repeat(300), 300)).toBe(false);
    expect(tooLong("x".repeat(301), 300)).toBe(true);
    // The server trims only some of what it is sent, so what is at the edges counts everywhere.
    expect(tooLong(`${"x".repeat(300)}\n`, 300)).toBe(true);
    expect(tooLong("😀".repeat(150), 150)).toBe(false);
    expect(tooLong("😀".repeat(151), 150)).toBe(true);
    expect(tooLong("\ud83d".repeat(150), 150)).toBe(false);
    expect(characters("a😀b")).toBe(3);
  });
});

describe("adding a source", () => {
  const start = () => mount(<SourceNewPage />, "/t/acme/core/app/evidence/new");

  it("stays on its first step with a title that's too long, keeping it, and goes on once it fits", async () => {
    const host = await start();
    const title = () => host.querySelector("input")!;
    await act(async () => paste(title(), words(460)));
    expect(host.querySelector(".field-error")?.textContent).toBe("160 characters over the limit of 300. Shorten it to save.");
    await act(async () => button(host, "Continue").click());
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Describe it");
    expect(title().value).toHaveLength(460);
    expect(document.activeElement).toBe(title());
    expect(posts()).toEqual([]);
    await act(async () => paste(title(), words(300)));
    await act(async () => button(host, "Continue").click());
    await act(async () => button(host, "Continue without attachments").click());
    await act(async () => button(host, "Create source").click());
    expect(posts()).toEqual([{ method: "POST", path: "/api/v1/p/acme/core/app/sources" }]);
  });
});

describe("editing a source's details", () => {
  it("refuses a title that's too long, keeping it", async () => {
    const record = { record_id: "rec_1", title: "Crew lead interview", date: null, tags: [], etag: "e1" } as never;
    const host = await mount(<EditDetails record={record} onClose={() => {}} onReload={() => {}} />, "/t/acme/core/app/evidence/rec_1");
    const title = document.querySelector<HTMLInputElement>('dialog input[required]')!;
    await act(async () => paste(title, words(301)));
    expect(title.value).toHaveLength(301);
    expect(document.querySelector("dialog .field-error")?.textContent).toBe("1 character over the limit of 300. Shorten it to save.");
    const save = button(document, "Save");
    expect(save.disabled).toBe(true);
    await act(async () => save.click());
    expect(posts()).toEqual([]);
    await act(async () => paste(title, words(300)));
    expect(button(document, "Save").disabled).toBe(false);
    expect(host).toBeDefined();
  });
});

describe("recording an assumption", () => {
  const start = async () => {
    const host = await mount(<EntryEditPage kind="assumptions" />, "/t/acme/core/app/exploration/assumptions/new");
    for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    return { host, statement: host.querySelector<HTMLTextAreaElement>("textarea.entry-statement")!, form: host.querySelector("form")! };
  };
  const save = (host: HTMLElement) => button(host, "Save assumption");

  it("refuses a statement that's too long, keeping it, even when the form is submitted anyway", async () => {
    const { host, statement, form } = await start();
    await act(async () => paste(statement, words(1140)));
    expect(statement.value).toHaveLength(1140);
    expect(host.querySelector(".field-error")?.textContent).toBe("140 characters over the limit of 1,000. Shorten it to save.");
    expect(save(host).disabled).toBe(true);
    await act(async () => form.requestSubmit());
    expect(posts()).toEqual([]);
    expect(statement.value).toHaveLength(1140);
  });

  it("saves a statement at the limit, whole", async () => {
    const { host, statement } = await start();
    await act(async () => paste(statement, words(1000)));
    expect(host.querySelector(".field-error")).toBeNull();
    expect(save(host).disabled).toBe(false);
    await act(async () => save(host).click());
    expect(posts()).toEqual([{ method: "POST", path: "/api/v1/p/acme/core/app/assumptions" }]);
  });

  it("refuses what is too long in Why too, the other field the form saves", async () => {
    const { host, statement } = await start();
    await act(async () => paste(statement, "Crew leads plan by the week."));
    const why = [...host.querySelectorAll("textarea")].find((t) => t !== statement)!;
    await act(async () => paste(why, words(10_001)));
    expect(save(host).disabled).toBe(true);
    expect(why.value).toHaveLength(10_001);
  });
});

describe("submitting feedback", () => {
  it("refuses a message that's too long, by button and by key, keeping it", async () => {
    await mount(<FeedbackDialog open onClose={() => {}} />);
    const message = document.querySelector<HTMLTextAreaElement>("dialog textarea")!;
    expect(message.hasAttribute("maxlength")).toBe(false);
    await act(async () => paste(message, words(4001)));
    expect(message.value).toHaveLength(4001);
    expect(document.querySelector("dialog .field-error")?.textContent).toBe("1 character over the limit of 4,000. Shorten it to save.");
    expect(document.querySelector("dialog .field-hint")?.textContent).toBe("4,001 of 4,000 characters");
    await act(async () => paste(message, words(4000)));
    expect(document.querySelector("dialog .field-error")).toBeNull();
    expect(document.querySelector("dialog .field-hint")?.textContent).toBe("4,000 of 4,000 characters");
    await act(async () => paste(message, words(4001)));
    expect(button(document, "Send feedback").disabled).toBe(true);
    await act(async () => message.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true })));
    expect(posts()).toEqual([]);
    await act(async () => paste(message, words(4000)));
    expect(button(document, "Send feedback").disabled).toBe(false);
  });
});

describe("every form with a limit", () => {
  const SRC = join(import.meta.dirname, "../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));
  const sources = files(SRC).map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, "utf8") }));

  it("sets it on the app's field, never on the browser's", () => {
    for (const { path, text } of sources) expect(text.match(/<(?:input|textarea)\b(?:[^>]|=>)*?\bmaxLength=/g) ?? [], path).toEqual([]);
  });

  it("refuses to save past it, as its field says it does", () => {
    const limited = sources.filter(({ path, text }) => !path.startsWith("ui/") && /\bmaxLength=\{/.test(text));
    expect(limited.length).toBeGreaterThan(10);
    for (const { path, text } of limited) {
      const limits = [...text.matchAll(/\bmaxLength=\{([^}]+)\}/g)].map((m) => m[1]!);
      // Slugs are refused by their own check, and any other limit is a named constant each of its fields' forms tests.
      for (const limit of new Set(limits)) {
        if (/^\d+$/.test(limit)) {
          expect(text, `${path}: a limit of ${limit} with no check of its own`).toContain("slugProblem");
          continue;
        }
        expect(limit, path).toMatch(/^[A-Z_]+$/);
        const checks = text.match(new RegExp(`tooLong\\((?:[^()]|\\([^()]*\\))*\\b${limit}\\)`, "g")) ?? [];
        expect(checks.length, `${path}: ${limit}`).toBeGreaterThanOrEqual(limits.filter((l) => l === limit).length);
      }
    }
  });

  it("holds a product's concept to what the server holds it to", () => {
    const server = readFileSync(join(SRC, "../../../packages/core/src/ops/products.ts"), "utf8").match(/const CONCEPT_MAX = ([\d_]+)/)![1];
    for (const form of ["routes/org.tsx", "routes/new-product.tsx"]) expect(sources.find((s) => s.path === form)!.text, form).toContain(`const CONCEPT_MAX = ${server};`);
  });
});
