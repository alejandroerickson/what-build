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

  it("sends only key names to the app and opens in-frame links in a new tab", () => {
    expect(FRAME_SCRIPT).toContain('whatbuild:"story-key"');
    expect(FRAME_SCRIPT).toContain('setAttribute("target","_blank")');
    expect(FRAME_SCRIPT).not.toMatch(/innerHTML|textContent|document\.cookie|location/);
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
