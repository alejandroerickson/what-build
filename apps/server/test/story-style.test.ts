import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composePrintDocument, FRAME_SCRIPT, GUIDANCE_VERSION, HOUSE_STYLE_IDS, HOUSE_STYLES, houseSpecimen, inspectStoryCss, inspectStoryHtml, STORY_FONTS, STORY_HTML_MAX, STORY_MAX_SCRIPTS,
  STORY_SCRIPT_BUDGET, storyFontFaces, storyFontsNamed, withStoryFonts, withStoryFrame,
} from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staticRoutes } from "../src/public-routes.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let tenantId: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Style Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  tenantId = t.body.tenant.tenant_id;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "vic@example.com", role: "viewer" });
});
afterAll(async () => h?.close());

const ALL_IDS = ["clear", "large", "report", "tonal", "wide", "pastel", "wayfinding", "isotype", "blocks", "riso"];

describe("house styles", () => {
  it("are complete, valid and self-contained", () => {
    expect(HOUSE_STYLES.map((s) => s.id)).toEqual(ALL_IDS);
    for (const s of HOUSE_STYLES) {
      expect(inspectStoryCss(s.stylesheet), s.id).toEqual([]);
      expect(inspectStoryHtml(houseSpecimen(s)), s.id).toEqual([]);
      expect(s.stylesheet, s.id).toContain('[data-wb-theme="dark"]');
      expect(s.stylesheet, s.id).toContain("prefers-color-scheme: dark");
      expect(s.rules, s.id).toMatch(/^# /);
    }
  });

  it("each style the whole vocabulary, plans and landing pages included", () => {
    for (const s of HOUSE_STYLES) {
      for (const selector of [".timeline", ".lines", ".facts", ".pages a", ".tag", "h2[data-label]::before", "::selection", "mark", ".quotes", ".flow", ".diagram .node", ".diagram .edge", ".shot .screen", ".pin", ".pins", ".tally"])
        expect(s.stylesheet, `${s.id} ${selector}`).toContain(selector);
      // A step may hold a link or bold text, so its number is placed beside the text, not in a grid.
      expect(s.stylesheet, s.id).not.toMatch(/\.steps li \{[^}]*display: grid/);
    }
    const specimen = houseSpecimen(HOUSE_STYLES[2]!);
    for (const markup of ['<section class="wide"', '<ol class="timeline">', '<ul class="lines">', '<dl class="facts">', '<nav class="pages"', '<li aria-current="step">', '<li data-state="done">', '<div class="quotes">', "<mark>", '<ol class="flow">', '<figure class="diagram">', '<figure class="shot" data-device="phone">', '<span class="pin"', '<ol class="pins">', '<span class="tally"'])
      expect(specimen, markup).toContain(markup);
  });

  it("give every style a designed dark scheme of its own, not the light one inverted", () => {
    for (const s of HOUSE_STYLES) {
      const dark = /\[data-wb-theme="dark"\] \{([^}]*)\}/.exec(s.stylesheet)![1]!;
      const paper = /--paper: (#[0-9a-f]{6})/.exec(dark)?.[1];
      expect(paper, s.id).toBeDefined();
      expect(paper, s.id).not.toBe("#000000");
    }
  });

  it("name each typeface once, so a page's stylesheet stays small", () => {
    for (const s of HOUSE_STYLES) {
      expect(s.stylesheet.match(/Helvetica Neue/g)?.length ?? 0, s.id).toBeLessThanOrEqual(1);
      // A face WhatBuild carries is named, never embedded: the server adds it when it shows the page.
      expect(s.stylesheet, s.id).not.toContain("data:font/");
      expect(s.stylesheet.length, s.id).toBeLessThan(28_000);
    }
  });

  it("each use a typeface the server carries", () => {
    for (const s of HOUSE_STYLES) expect(storyFontsNamed(s.stylesheet).length, s.id).toBeGreaterThan(0);
  });

  it("draw every mark of a tally in the width it gets, with exactly --n of them filled", () => {
    // Each declaration on a rule whose subject is the tally, in or out of a media query.
    const tallyDeclarations = (css: string) =>
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selectors]) => selectors!.split(",").some((sel) => /\.tally\b/.test(sel.trim().split(/\s*[>+~]\s*|\s+/).pop()!)))
        .flatMap(([, , body]) => body!.split(";").map((d) => d.trim()).filter(Boolean))
        .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()] as const);
    for (const s of HOUSE_STYLES) {
      const decls = tallyDeclarations(s.stylesheet);
      const values = (...props: string[]) => decls.filter(([p]) => props.includes(p)).map(([, v]) => v);
      // A fixed size would clip a long tally in a narrow block, leaving only filled marks in view.
      expect(values("width"), s.id).toEqual(["calc(var(--of, 10) * var(--dot))"]);
      expect(values("max-width"), s.id).toEqual(["100%"]);
      expect(values("height", "min-width"), s.id).toEqual([]);
      expect(values("aspect-ratio").length, s.id).toBeGreaterThan(0);
      for (const v of values("aspect-ratio")) expect(v, s.id).toMatch(/^var\(--of, 10\) \/ [\d.]+$/);
      // A mark is a share of the width the tally gets, and so is the fill, so they always agree.
      const masks = values("mask", "-webkit-mask", "mask-size", "-webkit-mask-size", "mask-position", "-webkit-mask-position");
      expect(masks.length, s.id).toBeGreaterThan(0);
      for (const v of masks) {
        expect(v, s.id).not.toContain("--dot");
        if (/repeat-x/.test(v)) expect(v, s.id).toContain("/ calc(100% / var(--of, 10)) 100% repeat-x");
      }
      for (const v of values("background", "background-size", "background-image")) expect(v, s.id).not.toContain("--dot");
      expect(values("background").join(" "), s.id).toContain("calc(100% * var(--n, 0) / var(--of, 10))");
    }
  });
});

describe("carried typefaces", () => {
  const page = (style: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title><style>${style}</style></head><body><p>x</p></body></html>`;

  it("embed the faces a page names in quotes, in a style block at the start of its head", () => {
    const html = page(`body { font-family: "Red Hat Text", sans-serif; } h1 { font-family: 'Signika'; }`);
    expect(storyFontsNamed(html).map((f) => f.family)).toEqual(["Red Hat Text", "Signika"]);
    const shown = withStoryFonts(html);
    expect(shown.startsWith('<!doctype html><html lang="en"><head><style>\n@font-face { font-family: "Red Hat Text"; src: url(data:font/woff2;base64,')).toBe(true);
    expect(shown).toContain('font-family: "Signika"; src: url(data:font/woff2;base64,');
    expect(shown).not.toContain('font-family: "Red Hat Display";');
    expect(shown.endsWith(html.slice(html.indexOf("<meta")))).toBe(true);
    expect(inspectStoryHtml(shown)).toEqual([]);
  });

  it("leave a page that names none exactly as stored, and find a page with no head", () => {
    const plain = page("body { font-family: system-ui, sans-serif; }");
    expect(withStoryFonts(plain)).toBe(plain);
    expect(withStoryFonts('<p style="font-family: \'Jost\'">x</p>')).toMatch(/^<style>\n@font-face \{ font-family: "Jost";[^]*<\/style><p style/);
  });

  it("each exist, and come with their licence", async () => {
    const { readFileSync } = await import("node:fs");
    const readme = readFileSync(new URL("../../../packages/core/src/story-fonts/README.md", import.meta.url), "utf8");
    for (const f of STORY_FONTS) {
      expect(storyFontFaces(`"${f.family}"`), f.family).toContain(`font-weight: ${f.weight}`);
      expect(readme, f.family).toContain(`| \`${f.file}\` | ${f.family} |`);
    }
    expect(readme).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("are declared once for a print view, outside the pages' shadow roots", () => {
    const html = houseSpecimen(HOUSE_STYLES.find((s) => s.id === "report")!);
    const doc = composePrintDocument({ productName: "P", exportedAt: "2026-10-13T00:00:00Z", nonce: "n", pages: [1, 2].map((i) => ({ page_id: `p${i}`, title: `P${i}`, version: 1, published_at: "2026-10-13T00:00:00Z", level: 1, html })) });
    expect(doc.match(/@font-face \{ font-family: "Libre Franklin"/g)).toHaveLength(1);
    expect(doc.indexOf('@font-face { font-family: "Libre Franklin"')).toBeLessThan(doc.indexOf("<template"));
  });
});

describe("what a stylesheet may load", () => {
  it("accepts a data: URI, quoted or not, and a fragment", () => {
    expect(inspectStoryCss(".a { background: url(data:image/svg+xml,%3Csvg/%3E); }")).toEqual([]);
    expect(inspectStoryCss(`.a { background: url("data:image/svg+xml,%3Csvg/%3E"); }`)).toEqual([]);
    expect(inspectStoryCss("@font-face { font-family: X; src: url('data:font/woff2;base64,AAAA') format('woff2'); }")).toEqual([]);
    expect(inspectStoryCss(".a { fill: url(#grad); }")).toEqual([]);
  });

  it("refuses anything that would reach the network, quoted or not", () => {
    for (const css of ["url(https://example.com/a.png)", `url("https://example.com/a.png")`, "url( 'https://example.com/a.png' )", "url(//example.com/a.png)", "url(a.png)"])
      expect(inspectStoryCss(`.a { background: ${css}; }`), css).toHaveLength(1);
    const page = (style: string) => `<!doctype html><html lang="en"><head><title>T</title><style>${style}</style></head><body><p style="background: url('https://example.com/a.png')">x</p></body></html>`;
    expect(inspectStoryHtml(page(`.a { background: url("data:image/png;base64,AAAA"); }`))).toHaveLength(1);
    expect(inspectStoryHtml(page(`.a { background: url("https://example.com/a.png"); }`))).toHaveLength(2);
  });
});

describe("Story guidance", () => {
  it("gives taste, passes and house styles, and never WhatBuild's own look", async () => {
    const g = await vic.api("GET", `${P}/story/guidance`);
    expect(g.status).toBe(200);
    expect(g.body.product_style).toMatchObject({ none: true });
    expect(g.body.house_styles.map((s: { id: string }) => s.id)).toEqual(ALL_IDS);
    expect(g.body.carried_typefaces.families).toEqual(STORY_FONTS.map((f) => f.family));
    expect(g.body.house_styles[0].stylesheet).toBeUndefined();
    expect(g.body.design_passes.map((p: { pass: string }) => p.pass)).toEqual(expect.arrayContaining(["critique", "distill", "bolder", "quieter", "typeset", "layout", "adapt", "polish"]));
    // It says how to look at a page before publishing it, and promotes no tool.
    expect(JSON.stringify(g.body.design_tools)).toContain('story_read(action=\\"preview\\")');
    expect(JSON.stringify(g.body.design_tools)).not.toMatch(/Impeccable|install|tell the person/i);
    const text = JSON.stringify(g.body);
    for (const appToken of ["#5a53e8", "#8b85ff", '\\"Inter', "Inter Variable", "--wb-"]) expect(text, appToken).not.toContain(appToken);
  });

  it("says what the Story is for, sets no rule about quoting, attributing or linking, and keeps the accuracy checks", async () => {
    const g = await vic.api("GET", `${P}/story/guidance`);
    expect(g.body.version).toBe(GUIDANCE_VERSION);
    expect(g.body.writing.purpose).toContain("not a quoted or cited record of how decisions were reached");
    expect(g.body.writing.purpose).toContain("quote it, paraphrase it, sum it up or link to it");
    const text = JSON.stringify(g.body);
    for (const rule of ["exact quotation", "exact words", "by role", "source reference", "source links", "No link", "Open the mockup", "analysis, not evidence", "consent note", "naming people", "passage", "evidence_wall"])
      expect(text, rule).not.toContain(rule);
    // Linking is the author's choice: every template stays, with who can follow each.
    expect(Object.keys(g.body.links)).toEqual(["source", "outcome", "assumption", "mockup", "story_page"]);
    expect(g.body.links_note).toContain("A reader (the role that may read only the Story) opens story_page links");
    // What a page must not misstate stays.
    expect(g.body.writing.fact_guardrails.join(" ")).toContain("Never add a person, owner, date, source, quote, count");
    expect(g.body.checklist.find((c: { check: string }) => c.check === "Accuracy").question).toContain("quotation");
    expect(g.body.limits).toMatchObject({ html_characters: STORY_HTML_MAX, inline_scripts: STORY_MAX_SCRIPTS, script_characters: STORY_SCRIPT_BUDGET });
  });

  it("returns one house style in full on request", async () => {
    const g = await vic.api("GET", `${P}/story/guidance?section=style&house_style=wide`);
    expect(g.body.house_style.id).toBe("wide");
    expect(g.body.house_style.stylesheet).toContain("--accent");
    expect(g.body.house_style.starter_html).toContain('<main class="page">');
    expect((await vic.api("GET", `${P}/story/guidance?house_style=inter`)).status).toBe(422);
  });
});

describe("the product's Story style", () => {
  let etag: string;

  it("starts empty, and the first style needs a house style or a whole design system", async () => {
    const s = await vic.api("GET", `${P}/story/style`);
    expect(s.body.style).toBeNull();
    expect(s.body.house_styles).toHaveLength(HOUSE_STYLE_IDS.length);
    expect((await alice.api("PUT", `${P}/story/style`, { name: "Ours" })).status).toBe(422);
    expect((await vic.api("PUT", `${P}/story/style`, { house_style: "clear" })).status).toBe(403);
    expect((await vic.api("GET", `${P}/story/style/specimen`)).status).toBe(404);
  });

  it("adopts a house style whole, and records it", async () => {
    const r = await alice.api("PUT", `${P}/story/style`, { house_style: "clear" });
    expect(r.status).toBe(200);
    expect(r.body.style).toMatchObject({ name: "Clear", based_on: "clear", kind: "house", has_own_specimen: false });
    etag = r.body.style.etag;
    const act = await vic.api("GET", `${P}/activity?limit=5`);
    expect(act.body.items[0].summary).toBe("Adopted the Clear house style for the Story");
    const g = await vic.api("GET", `${P}/story/guidance?section=checklist`);
    expect(g.body.product_style).toMatchObject({ name: "Clear", based_on: "clear" });
  });

  it("needs the style's etag to change it, and carries forward what an update omits", async () => {
    expect((await alice.api("PUT", `${P}/story/style`, { name: "Clear, ours" })).status).toBe(409);
    const r = await alice.api("PUT", `${P}/story/style`, { name: "Clear, ours", expected_etag: etag });
    expect(r.status).toBe(200);
    const s = await vic.api("GET", `${P}/story/style`);
    expect(s.body.style).toMatchObject({ name: "Clear, ours", based_on: "clear" });
    expect(s.body.style.stylesheet).toBe(HOUSE_STYLES.find((s) => s.id === "clear")!.stylesheet);
    etag = s.body.style.etag;
    const same = await alice.api("PUT", `${P}/story/style`, { name: "Clear, ours", expected_etag: etag });
    expect(same.body.changed).toBe(false);
  });

  it("keeps a product's copy of a house style that has since been retired, and lets it change", async () => {
    const setBasedOn = (id: string) =>
      h.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
        await sql`update story_styles set based_on = ${id}`.execute(trx);
      });
    await setBasedOn("tufte");
    const s = await vic.api("GET", `${P}/story/style`);
    expect(s.body.style).toMatchObject({ name: "Clear, ours", based_on: "tufte", based_on_name: null, kind: "house" });
    expect(s.body.style.stylesheet).toBe(HOUSE_STYLES.find((s) => s.id === "clear")!.stylesheet);
    // Its stylesheet was written before the vocabulary's newer blocks, and the style says so, with the way on.
    expect(s.body.style.note).toMatch(/^Based on tufte, a house style no longer in the catalogue: its stylesheet predates the current vocabulary, so \.quotes, \.tally,.* set_style \{ house_style \} and publish each page with restyle: true\.$/);
    const g = await vic.api("GET", `${P}/story/guidance?section=checklist`);
    expect(g.body.product_style).toMatchObject({ based_on: "tufte", note: s.body.style.note });
    const r = await alice.api("PUT", `${P}/story/style`, { summary: "Ours now.", expected_etag: s.body.style.etag });
    expect(r.status).toBe(200);
    expect(r.body.style).toMatchObject({ based_on: "tufte", summary: "Ours now.", note: s.body.style.note });
    await setBasedOn("clear");
    const current = (await vic.api("GET", `${P}/story/style`)).body.style;
    expect(current).not.toHaveProperty("note");
    expect((await vic.api("GET", `${P}/story/guidance?section=checklist`)).body.product_style).not.toHaveProperty("note");
    etag = current.etag;
  });

  it("refuses a stylesheet or specimen that would reach the network", async () => {
    const bad = await alice.api("PUT", `${P}/story/style`, { stylesheet: "@import url(https://example.com/a.css);", specimen_html: '<script src="https://example.com/x.js"></script>', expected_etag: etag });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_style");
    expect(bad.body.error.details.problems.join(" ")).toMatch(/@import.*Specimen: <script src>/s);
  });

  it("saves a team's own design system, and previews it on the sample page", async () => {
    const r = await alice.api("PUT", `${P}/story/style`, {
      name: "Acme reports",
      rules: "# Acme reports\n\n- Navy and white.",
      stylesheet: ":root { --ink: #0b1f3a; } body { color: var(--ink); }",
      based_on: null,
      expected_etag: etag,
    });
    expect(r.status).toBe(200);
    expect(r.body.style).toMatchObject({ name: "Acme reports", based_on: null, kind: "team" });
    const spec = await vic.api("GET", `${P}/story/style/specimen?theme=dark&frame=1`);
    expect(spec.status).toBe(200);
    expect(spec.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(spec.body).toContain("--ink: #0b1f3a");
    expect(spec.body).toContain('data-wb-theme="dark"');
    expect(spec.body).toContain(FRAME_SCRIPT);
  });

  it("serves each house style's specimen in the sandbox", async () => {
    const r = await vic.api("GET", `${P}/story/house-styles/wide/specimen?theme=light`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(r.body).toContain("font-stretch: var(--wide)");
    expect(r.body).not.toContain(FRAME_SCRIPT);
    expect((await vic.api("GET", `${P}/story/house-styles/inter/specimen`)).status).toBe(404);
    const carried = await vic.api("GET", `${P}/story/house-styles/wayfinding/specimen?theme=dark&frame=1`);
    expect(carried.body).toContain('@font-face { font-family: "Signika"; src: url(data:font/woff2;base64,');
    expect(carried.body).toContain('data-wb-theme="dark"');
    expect(carried.headers.get("content-security-policy")).toContain("font-src data:");
  });
});

describe("the app's frame", () => {
  it("adds the frame script only when the frame asks", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><main class="page"><h1>Hello</h1><p><a href="https://example.com">x</a></p></main></body></html>`;
    const pub = await alice.api("POST", `${P}/story/pages/hello/versions`, { title: "Hello", html });
    expect(pub.status).toBeLessThan(300);
    const plain = await vic.api("GET", `${P}/story/pages/hello/versions/1/html`);
    expect(plain.body).toBe(html);
    const framed = await vic.api("GET", `${P}/story/pages/hello/versions/1/html?theme=dark&frame=1`);
    expect(framed.body).toBe(withStoryFrame(html, "dark"));
    expect(framed.body).toContain('<html data-wb-theme="dark" lang="en">');
    expect(framed.body.endsWith(`<script>${FRAME_SCRIPT}</script>`)).toBe(true);
  });

  it("embeds the carried typefaces a stored page names when it shows it, and stores the page as published", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title><style>body { font-family: "Jost", sans-serif; }</style></head><body><main class="page"><h1>Hello</h1></main></body></html>`;
    expect((await alice.api("POST", `${P}/story/pages/typeset/versions`, { title: "Typeset", html })).status).toBeLessThan(300);
    const shown = await vic.api("GET", `${P}/story/pages/typeset/versions/1/html?theme=light`);
    expect(shown.body).toContain('@font-face { font-family: "Jost"; src: url(data:font/woff2;base64,');
    expect(shown.body).toContain('data-wb-theme="light"');
    const page = await vic.api("GET", `${P}/story/pages/typeset`);
    expect(JSON.stringify(page.body)).not.toContain("data:font/woff2");
  });

  it("sends only key names and page slugs to the app, and opens other in-frame links in a new tab", () => {
    expect(FRAME_SCRIPT).toContain('whatbuild:"story-key"');
    expect(FRAME_SCRIPT).toContain('whatbuild:"story-page"');
    expect(FRAME_SCRIPT).toContain('setAttribute("target","_blank")');
    expect(FRAME_SCRIPT).not.toMatch(/innerHTML|textContent|document\.cookie|location/);
    expect(() => new Function(FRAME_SCRIPT)).not.toThrow();
  });

  it("hands a plain click on a link to another page of the Story to the app, and nothing else", () => {
    const base = "https://app.example/t/acme/core/planner/story/";
    const run = (href: string, click: Record<string, unknown> = {}, told = true) => {
      const listeners: Record<string, (e: unknown) => void> = {};
      const sent: unknown[] = [];
      const parent = { postMessage: (m: unknown) => sent.push(m) };
      const attrs: Record<string, string> = { href };
      const a = {
        href,
        getAttribute: (n: string) => attrs[n] ?? null,
        setAttribute: (n: string, v: string) => void (attrs[n] = v),
        hasAttribute: (n: string) => n in attrs,
      };
      new Function("addEventListener", "parent", FRAME_SCRIPT)((type: string, fn: (e: unknown) => void) => void (listeners[type] = fn), parent);
      if (told) listeners["message"]!({ source: parent, data: { whatbuild: "story-base", base } });
      let prevented = false;
      listeners["click"]!({ target: { closest: () => a }, button: 0, defaultPrevented: false, preventDefault: () => void (prevented = true), ...click });
      return { sent, prevented, target: attrs["target"] };
    };
    expect(run(`${base}release-plan`)).toEqual({ sent: [{ whatbuild: "story-page", page: "release-plan" }], prevented: true, target: undefined });
    expect(run(`${base}epics?v=2#matrix`).sent).toEqual([{ whatbuild: "story-page", page: "epics" }]);
    // A modifier key, another part of the app, another product, another site: the link opens in a new tab.
    for (const [href, click] of [
      [`${base}release-plan`, { metaKey: true }],
      [`${base}release-plan`, { button: 1 }],
      ["https://app.example/t/acme/core/planner/evidence/01ABC", {}],
      ["https://app.example/t/acme/core/other/story/overview", {}],
      [`${base}Not-A-Slug/more`, {}],
      ["https://example.com/story/overview", {}],
    ] as const)
      expect(run(href, click), href).toEqual({ sent: [], prevented: false, target: "_blank" });
    // Until the app has said where its Story lives, nothing is handed over; and only the app may say.
    expect(run(`${base}release-plan`, {}, false)).toEqual({ sent: [], prevented: false, target: "_blank" });
  });

  it("points a link into the product on another deployment at this one, once the app says where it is", () => {
    const run = (href: string, told = true) => {
      const listeners: Record<string, (e: unknown) => void> = {};
      const parent = { postMessage: () => undefined };
      const a = { href, getAttribute: () => href, setAttribute: () => undefined, hasAttribute: () => false };
      new Function("addEventListener", "parent", FRAME_SCRIPT)((type: string, fn: (e: unknown) => void) => void (listeners[type] = fn), parent);
      if (told) listeners["message"]!({ source: parent, data: { whatbuild: "app-home", home: "https://dev.example/t/acme/core/planner" } });
      listeners["click"]!({ target: { closest: () => a }, button: 0, defaultPrevented: false, preventDefault: () => undefined });
      return a.href;
    };
    expect(run("https://app.example/t/acme/core/planner/evidence/01ABC?seq=4")).toBe("https://dev.example/t/acme/core/planner/evidence/01ABC?seq=4");
    expect(run("https://app.example/t/acme/core/planner")).toBe("https://dev.example/t/acme/core/planner");
    for (const href of ["https://app.example/t/acme/core/other/idea", "https://app.example/t/acme/core/planner-2/idea", "https://example.com/story"]) expect(run(href)).toBe(href);
    expect(run("https://app.example/t/acme/core/planner/idea", false)).toBe("https://app.example/t/acme/core/planner/idea");
  });

  it("opens a root-relative link in the app, not on the content site the page is served from", () => {
    const home = "https://app.example/t/acme/core/planner";
    const run = (raw: string, story = false) => {
      const listeners: Record<string, (e: unknown) => void> = {};
      const sent: unknown[] = [];
      const parent = { postMessage: (m: unknown) => sent.push(m) };
      // A browser resolves the attribute against the page's own address, on the content site.
      const attrs: Record<string, string> = { href: raw };
      const a = {
        href: new URL(raw, "https://usercontent.example.net/documents/grant/page.html").href,
        getAttribute: (n: string) => attrs[n] ?? null,
        setAttribute: (n: string, v: string) => void (attrs[n] = v),
        hasAttribute: (n: string) => n in attrs,
      };
      new Function("addEventListener", "parent", FRAME_SCRIPT)((type: string, fn: (e: unknown) => void) => void (listeners[type] = fn), parent);
      listeners["message"]!({ source: parent, data: { whatbuild: "app-home", home } });
      if (story) listeners["message"]!({ source: parent, data: { whatbuild: "story-base", base: `${home}/story/` } });
      listeners["click"]!({ target: { closest: () => a }, button: 0, defaultPrevented: false, preventDefault: () => undefined });
      return { href: a.href, sent };
    };
    expect(run("/t/acme/core/planner/evidence/01ABC").href).toBe("https://app.example/t/acme/core/planner/evidence/01ABC");
    expect(run("/t/acme/core/other/idea").href).toBe("https://app.example/t/acme/core/other/idea");
    // A link to another page of the Story is still shown in place.
    expect(run("/t/acme/core/planner/story/release-plan", true).sent).toEqual([{ whatbuild: "story-page", page: "release-plan" }]);
    // A protocol-relative or absolute link names its own host, and keeps it.
    expect(run("//example.com/story").href).toBe("https://example.com/story");
    expect(run("https://example.com/story").href).toBe("https://example.com/story");
  });

  it("passes the canvas's keys, Space, a pinch and a press on, only once the app says the page is on a canvas", () => {
    const run = (canvas: boolean) => {
      const listeners: Record<string, (e: unknown) => void> = {};
      const sent: unknown[] = [];
      const parent = { postMessage: (m: unknown) => sent.push(m) };
      new Function("addEventListener", "parent", FRAME_SCRIPT)((type: string, fn: (e: unknown) => void) => void (listeners[type] = fn), parent);
      if (canvas) listeners["message"]!({ source: parent, data: { whatbuild: "canvas-host" } });
      const prevented: string[] = [];
      const event = (name: string, e: Record<string, unknown>) => listeners[name]!({ target: { tagName: "DIV" }, defaultPrevented: false, preventDefault: () => prevented.push(name), ...e });
      event("keydown", { key: "2" });
      event("keydown", { key: "1" });
      event("keydown", { key: " " });
      event("keydown", { key: "ArrowRight" });
      event("keydown", { key: "h", target: { tagName: "INPUT" } });
      event("keyup", { key: " " });
      event("wheel", { ctrlKey: true, metaKey: false, clientX: 10, clientY: 20, deltaY: -3, deltaMode: 0 });
      event("wheel", { ctrlKey: false, metaKey: false, clientX: 10, clientY: 20, deltaY: 30, deltaMode: 0 });
      event("pointerdown", {});
      return { sent, prevented };
    };
    expect(run(true)).toEqual({
      sent: [
        { whatbuild: "story-key", key: "2" },
        { whatbuild: "story-key", key: "1" },
        { whatbuild: "story-key", key: " " },
        { whatbuild: "story-key", key: "ArrowRight" },
        { whatbuild: "canvas-keyup", key: " " },
        { whatbuild: "canvas-zoom", x: 10, y: 20, dy: -3, line: false, pinch: true },
        { whatbuild: "canvas-select" },
      ],
      prevented: ["keydown", "wheel"],
    });
    // On the Story, the page keeps Space, the canvas's other keys and the wheel to itself; 2 and 3 fit or fill a published mockup.
    expect(run(false)).toEqual({ sent: [{ whatbuild: "story-key", key: "2" }, { whatbuild: "story-key", key: "ArrowRight" }], prevented: [] });
  });
});

describe("publishing a page from its body", () => {
  const body = '<main class="page"><header class="opening"><h1>Plan</h1></header><section><h2>One</h2><p>Text.</p></section></main>';
  let etag: string;

  it("wraps the body in the product's Story style, so the stylesheet is never sent", async () => {
    const style = (await vic.api("GET", `${P}/story/style`)).body.style;
    const pub = await alice.api("POST", `${P}/story/pages/plan/versions`, { title: "The <plan>", body });
    expect(pub.status).toBeLessThan(300);
    etag = pub.body.etag;
    const html = (await vic.api("GET", `${P}/story/pages/plan/versions/1/html`)).body as string;
    expect(html).toContain(`<style>\n${style.stylesheet}</style>`);
    expect(html).toContain(`<body>\n${body}\n</body>`);
    expect(html).toContain("<title>The &#60;plan&#62;</title>");
    expect(inspectStoryHtml(html)).toEqual([]);
  });

  it("takes a body only, and one way of giving the page at a time", async () => {
    const whole = await alice.api("POST", `${P}/story/pages/plan/versions`, { body: `<!doctype html><html><body>${body}</body></html>`, expected_etag: etag });
    expect(whole.status).toBe(422);
    expect(whole.body.error.message).toContain("inside <body>");
    const both = await alice.api("POST", `${P}/story/pages/plan/versions`, { body, restyle: true, expected_etag: etag });
    expect(both.status).toBe(422);
    expect(both.body.error.message).toContain("body and restyle");
    expect((await alice.api("POST", `${P}/story/pages/fresh/versions`, { title: "Fresh", restyle: true })).status).toBe(422);
    const external = await alice.api("POST", `${P}/story/pages/plan/versions`, { body: '<main class="page"><img src="https://example.com/a.png" alt=""></main>', expected_etag: etag });
    expect(external.status).toBe(422);
    expect(external.body.error.code).toBe("invalid_html");
  });

  it("gives a page the product's new style and keeps its content", async () => {
    const current = (await vic.api("GET", `${P}/story/style`)).body.style;
    const wide = await alice.api("PUT", `${P}/story/style`, { house_style: "wide", expected_etag: current.etag });
    expect(wide.status).toBe(200);
    const pub = await alice.api("POST", `${P}/story/pages/plan/versions`, { restyle: true, expected_etag: etag });
    expect(pub.status).toBeLessThan(300);
    expect(pub.body.current_version).toBe(2);
    expect(pub.body.carried_forward).toEqual(["title", "summary"]);
    const html = (await vic.api("GET", `${P}/story/pages/plan/versions/2/html`)).body as string;
    expect(html).toContain(`<style>\n${HOUSE_STYLES.find((s) => s.id === "wide")!.stylesheet}</style>`);
    expect(html).not.toContain(current.stylesheet);
    expect(html).toContain(`<body>\n${body}\n</body>`);
    // A page with no stylesheet of its own has nothing to replace.
    const bare = await alice.api("GET", `${P}/story/pages/hello`);
    const none = await alice.api("POST", `${P}/story/pages/hello/versions`, { restyle: true, expected_etag: bare.body.etag });
    expect(none.status).toBe(422);
    expect(none.body.error.message).toContain("no <style> block");
  });
});

describe("the web app's headers", () => {
  it("cut the opener, so a Story page cannot redirect an app tab it opened", async () => {
    const dist = mkdtempSync(join(tmpdir(), "wb-dist-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>WhatBuild</title>");
    const res = await staticRoutes(dist).request("/t/acme/core/planner/story/overview");
    expect(res.status).toBe(200);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("let Google Analytics in only when the deployment uses it", async () => {
    const dist = mkdtempSync(join(tmpdir(), "wb-dist-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>WhatBuild</title>");
    const without = (await staticRoutes(dist).request("/")).headers.get("content-security-policy") ?? "";
    const withIt = (await staticRoutes(dist, { analytics: true }).request("/")).headers.get("content-security-policy") ?? "";
    expect(without).not.toContain("google-analytics");
    expect(withIt).toContain("script-src 'self' https://*.googletagmanager.com;");
    expect(withIt).toContain("https://*.google-analytics.com");
    expect(withIt).toContain("object-src 'none'");
  });
});
