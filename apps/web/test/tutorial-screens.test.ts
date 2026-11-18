import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { mcpTool, OPERATIONS } from "@whatbuild/core";
import { describe, expect, it, vi } from "vitest";

// The tutorial walks through the app's real screens. These tests fail when a screen, its controls'
// names, the canvas's keys or the agents' tools move from under it, so that the change that moves
// them moves the tutorial too (AGENTS.md, "The tutorial walks through the real screens"). When one
// fails, change `apps/web/src/tutorial/` (the stops, what each lights, the examples), §7.4 of
// `okf/spec/07-web-app.md` and `e2e/plans/the-tutorial.md` with the screen. Do not loosen the test.

const { ALL_STOPS: STOPS } = await import("../src/tutorial/stops.ts");
const { TARGETS } = await import("../src/tutorial/layer.tsx");
const { TUTORIAL } = await import("../src/tutorial/content/index.ts");
const { CANVAS_TOOLS } = await import("../src/routes/mockup-canvas.tsx");

const SRC = join(import.meta.dirname, "../src");
const TUTORIAL_DIR = join(SRC, "tutorial");

/** The web app's own code, outside the tutorial: what draws the screens the tutorial lights. */
function appSource(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (p !== TUTORIAL_DIR) walk(p);
      } else if (/\.tsx?$/.test(e.name)) out.set(relative(SRC, p), readFileSync(p, "utf8"));
    }
  };
  walk(SRC);
  return out;
}
const APP = appSource();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether the app's own code names `word` as a whole class or attribute name. */
const drawn = (word: string) => {
  const re = new RegExp(`(^|[^\\w-])${escape(word)}($|[^\\w-])`);
  return [...APP.values()].some((text) => re.test(text));
};
/** Whether the app's own code writes `words` anywhere: a label, a heading, a button. */
const written = (words: string) => [...APP.values()].some((text) => text.includes(words));

/** The selectors a target asks the document for, without a screen to find them on. */
function selectorsOf(target: keyof typeof TARGETS): string[] {
  const asked: string[] = [];
  const spy = vi.spyOn(document, "querySelector").mockImplementation((s: string) => {
    asked.push(s);
    return null;
  });
  try {
    TARGETS[target]();
  } finally {
    spy.mockRestore();
  }
  return asked;
}

/**
 * The class and attribute names in a selector. `data-tut…` marks are left out: the tutorial puts them
 * on its own examples.
 */
function anchors(selector: string): string[] {
  const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
  const attributes = [...selector.matchAll(/\[([\w-]+)/g)].map((m) => m[1]!).filter((a) => !a.startsWith("data-tut"));
  return [...classes, ...attributes];
}

/**
 * Stop titles that are the tutorial's own words for a thing, which no label on the screen carries.
 * Every other title, and every name a line sets in bold, is a name the screen shows.
 */
const OWN_WORDS = new Set(["Main navigation", "Toolbar", "Story pages"]);

describe("the tutorial against the screens it walks through", () => {
  it("lights only what the app's own screens still draw", () => {
    const missing: string[] = [];
    for (const s of STOPS) {
      if (!s.target) continue;
      const selectors = selectorsOf(s.target);
      expect(selectors.length, `stop ${s.id} lights nothing`).toBeGreaterThan(0);
      for (const sel of selectors) for (const a of anchors(sel)) if (!drawn(a)) missing.push(`stop "${s.id}" lights ${sel}, and no screen outside the tutorial draws "${a}"`);
    }
    expect(missing, "A screen the tutorial lights has changed: move the tutorial with it (AGENTS.md).").toEqual([]);
  });

  it("names each control as the screen does", () => {
    const names = new Set<string>();
    for (const s of STOPS) {
      if (!OWN_WORDS.has(s.title)) names.add(s.title);
      for (const part of s.line) if (typeof part === "object" && "b" in part) names.add(part.b);
    }
    const unwritten = [...names].filter((n) => !written(n));
    expect(unwritten, "A name the tutorial uses is no longer on the screen: rename it in the tutorial too (AGENTS.md).").toEqual([]);
  });

  it("asks only for canvas keys the canvas has", () => {
    const keys = new Set<string>(Object.values(CANVAS_TOOLS).flatMap((t) => (t.key ? [t.key] : [])));
    // F is Focus, which the canvas shares with the Story (story-focus.tsx), not a toolbar control.
    if (written('e.key === "F"')) keys.add("F");
    for (const s of STOPS) {
      if (!s.keys) continue;
      const asked = s.line.flatMap((part) => (typeof part === "object" && "kbd" in part ? [part.kbd] : []));
      expect(asked.length, s.id).toBeGreaterThan(0);
      for (const k of asked) expect(keys.has(k), `stop "${s.id}" asks for ${k}, which the canvas no longer has`).toBe(true);
    }
  });

  it("plays only tools and actions agents are offered", () => {
    const offered = OPERATIONS.filter((op) => !op.webOnly);
    const tools = new Set(offered.map((op) => mcpTool(op)));
    for (const b of TUTORIAL.agents.beats) {
      expect(
        offered.some((op) => mcpTool(op) === b.tool && op.mcp.action === b.act),
        `the agent stage calls ${b.tool}(action="${b.act}"), which agents are not offered`,
      ).toBe(true);
    }
    for (const line of Object.values(TUTORIAL.agents.tools)) for (const t of line.split(" · ")) expect(tools.has(t), `the agent stage lists ${t}, which agents are not offered`).toBe(true);
  });
});
