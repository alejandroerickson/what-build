import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STYLESHEET, TOKENS, TOKENS_DARK, WEB_TOKEN } from "../../../packages/core/src/story-guidance.ts";

/**
 * Story guidance embeds resolved copies of the web app's design tokens, because a Story page renders
 * in a sandbox that cannot load the app's stylesheet. This test keeps the copies honest.
 */

const TOKENS_CSS = fileURLToPath(new URL("../../web/src/styles/tokens.css", import.meta.url));

type Block = { selectors: string[]; vars: Record<string, string> };

function parseBlocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const vars: Record<string, string> = {};
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]!] = d[2]!.trim();
    blocks.push({ selectors: m[1]!.split(",").map((s) => s.trim()), vars });
  }
  return blocks;
}

function webThemes() {
  const blocks = parseBlocks(readFileSync(TOKENS_CSS, "utf8"));
  const pick = (test: (sel: string[]) => boolean) => {
    const found = blocks.filter((b) => test(b.selectors));
    expect(found.length, "tokens.css block").toBeGreaterThan(0);
    return Object.assign({}, ...found.map((b) => b.vars)) as Record<string, string>;
  };
  const base = pick((s) => s.length === 1 && s[0] === ":root");
  const light = { ...base, ...pick((s) => s.includes(".theme-light")) };
  const dark = { ...light, ...pick((s) => s.includes(".theme-dark") && s.some((x) => x.startsWith(":root"))) };
  return { light, dark };
}

describe("story guidance tokens", () => {
  const web = webThemes();
  const guidance = { light: TOKENS, dark: { ...TOKENS, ...TOKENS_DARK } };

  for (const scheme of ["light", "dark"] as const) {
    it(`match the web design tokens in the ${scheme} scheme`, () => {
      for (const [ours, theirs] of Object.entries(WEB_TOKEN)) {
        expect(web[scheme][theirs], `${theirs} in tokens.css`).toBeDefined();
        expect(guidance[scheme][ours], `${ours} (from ${theirs}, ${scheme})`).toBe(web[scheme][theirs]);
      }
    });
  }

  it("derive every colour and every dark override from a web token", () => {
    for (const [k, v] of Object.entries(TOKENS)) {
      if (/^#|rgb|hsl|color-mix/.test(v)) expect(WEB_TOKEN[k], `${k} has no web source`).toBeDefined();
    }
    for (const k of Object.keys(TOKENS_DARK)) expect(WEB_TOKEN[k], `${k} has no web source`).toBeDefined();
  });

  it("put every token into the stylesheet, dark values inside the dark-scheme query", () => {
    const [light, dark] = STYLESHEET.split("@media (prefers-color-scheme: dark)");
    for (const [k, v] of Object.entries(TOKENS)) expect(light).toContain(`${k}: ${v};`);
    for (const [k, v] of Object.entries(TOKENS_DARK)) expect(dark).toContain(`${k}: ${v};`);
  });

  it("let the app force a scheme with the theme attribute, over the system's", () => {
    const forcedDark = STYLESHEET.split(':root[data-wb-theme="dark"] {')[1]!.split("}")[0]!;
    for (const [k, v] of Object.entries(TOKENS_DARK)) expect(forcedDark).toContain(`${k}: ${v};`);
    expect(forcedDark).toContain("color-scheme: dark;");
    expect(STYLESHEET).toContain(':root[data-wb-theme="light"] { color-scheme: light; }');
    expect(STYLESHEET).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-wb-theme="light"]) {');
  });

  it("name Inter first for headings, with system fallbacks", () => {
    const ui = TOKENS["--wb-font-ui"]!;
    expect(ui).toMatch(/^"Inter/);
    expect(ui).toMatch(/system-ui.*sans-serif$/);
  });
});
