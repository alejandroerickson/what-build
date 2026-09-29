import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME_SCRIPT, HOUSE_STYLES, houseSpecimen, inspectStoryCss, inspectStoryHtml, withStoryFrame } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staticRoutes } from "../src/public-routes.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Style Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "vic@example.com", role: "viewer" });
});
afterAll(async () => h?.close());

describe("house styles", () => {
  it("are complete, valid and self-contained", () => {
    expect(HOUSE_STYLES.map((s) => s.id)).toEqual(["broadsheet", "tufte", "swiss", "briefing"]);
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
      for (const selector of [".timeline", ".lines", ".facts", ".pages a", ".tag", "h2[data-label]::before", "::selection"])
        expect(s.stylesheet, `${s.id} ${selector}`).toContain(selector);
      // A step may hold a link or bold text, so its number is placed beside the text, not in a grid.
      expect(s.stylesheet, s.id).not.toMatch(/\.steps li \{[^}]*display: grid/);
    }
    const specimen = houseSpecimen(HOUSE_STYLES[2]!);
    for (const markup of ['<section class="wide"', '<ol class="timeline">', '<ul class="lines">', '<dl class="facts">', '<nav class="pages"'])
      expect(specimen, markup).toContain(markup);
  });

  it("name each typeface once, so a page's stylesheet stays small", () => {
    for (const s of HOUSE_STYLES) {
      expect(s.stylesheet.match(/Helvetica Neue/g)?.length ?? 0, s.id).toBeLessThanOrEqual(1);
      expect(s.stylesheet.length, s.id).toBeLessThan(16_000);
    }
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
    expect(g.body.house_styles.map((s: { id: string }) => s.id)).toEqual(["broadsheet", "tufte", "swiss", "briefing"]);
    expect(g.body.house_styles[0].stylesheet).toBeUndefined();
    expect(g.body.design_passes.map((p: { pass: string }) => p.pass)).toEqual(expect.arrayContaining(["critique", "distill", "bolder", "quieter", "typeset", "layout", "adapt", "polish"]));
    expect(JSON.stringify(g.body.design_tools)).toContain("Impeccable");
    const text = JSON.stringify(g.body);
    for (const appToken of ["#5a53e8", "#8b85ff", '\\"Inter', "Inter Variable", "--wb-"]) expect(text, appToken).not.toContain(appToken);
  });

  it("returns one house style in full on request", async () => {
    const g = await vic.api("GET", `${P}/story/guidance?section=style&house_style=swiss`);
    expect(g.body.house_style.id).toBe("swiss");
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
    expect(s.body.house_styles).toHaveLength(4);
    expect((await alice.api("PUT", `${P}/story/style`, { name: "Ours" })).status).toBe(422);
    expect((await vic.api("PUT", `${P}/story/style`, { house_style: "tufte" })).status).toBe(403);
    expect((await vic.api("GET", `${P}/story/style/specimen`)).status).toBe(404);
  });

  it("adopts a house style whole, and records it", async () => {
    const r = await alice.api("PUT", `${P}/story/style`, { house_style: "tufte" });
    expect(r.status).toBe(200);
    expect(r.body.style).toMatchObject({ name: "Tufte", based_on: "tufte", kind: "house", has_own_specimen: false });
    etag = r.body.style.etag;
    const act = await vic.api("GET", `${P}/activity?limit=5`);
    expect(act.body.items[0].summary).toBe("Adopted the Tufte house style for the Story");
    const g = await vic.api("GET", `${P}/story/guidance?section=checklist`);
    expect(g.body.product_style).toMatchObject({ name: "Tufte", based_on: "tufte" });
  });

  it("needs the style's etag to change it, and carries forward what an update omits", async () => {
    expect((await alice.api("PUT", `${P}/story/style`, { name: "Tufte, ours" })).status).toBe(409);
    const r = await alice.api("PUT", `${P}/story/style`, { name: "Tufte, ours", expected_etag: etag });
    expect(r.status).toBe(200);
    const s = await vic.api("GET", `${P}/story/style`);
    expect(s.body.style).toMatchObject({ name: "Tufte, ours", based_on: "tufte" });
    expect(s.body.style.stylesheet).toBe(HOUSE_STYLES[1]!.stylesheet);
    etag = s.body.style.etag;
    const same = await alice.api("PUT", `${P}/story/style`, { name: "Tufte, ours", expected_etag: etag });
    expect(same.body.changed).toBe(false);
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
    const r = await vic.api("GET", `${P}/story/house-styles/briefing/specimen?theme=light`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(r.body).toContain("scroll-snap-type");
    expect(r.body).not.toContain(FRAME_SCRIPT);
    expect((await vic.api("GET", `${P}/story/house-styles/inter/specimen`)).status).toBe(404);
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
    const swiss = await alice.api("PUT", `${P}/story/style`, { house_style: "swiss", expected_etag: current.etag });
    expect(swiss.status).toBe(200);
    const pub = await alice.api("POST", `${P}/story/pages/plan/versions`, { restyle: true, expected_etag: etag });
    expect(pub.status).toBeLessThan(300);
    expect(pub.body.current_version).toBe(2);
    expect(pub.body.carried_forward).toEqual(["title", "summary", "refs", "citations"]);
    const html = (await vic.api("GET", `${P}/story/pages/plan/versions/2/html`)).body as string;
    expect(html).toContain(`<style>\n${HOUSE_STYLES[2]!.stylesheet}</style>`);
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
});
