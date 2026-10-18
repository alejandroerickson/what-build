import { createHash, randomBytes } from "node:crypto";
import { request } from "node:http";
import { PERMISSIONS_POLICY, prototypePath, prototypeWarnings, requestedPrototypePath } from "@whatbuild/core";
import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough, zipSync } from "fflate";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HmacGrantSigner } from "../src/adapters/misc.ts";
import { loggedPath } from "../src/app.ts";
import { pageHeaders } from "../src/public-routes.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * A mockup's prototype: a team's multi-file prototype carried by a version and entered by its
 * pages, served under a capability path in the sandbox, given back byte for byte.
 */

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const MiB = 1024 * 1024;

/** A small synthetic prototype: several documents, relative assets, a nested frame, a form, a module, a font, a guarded storage call. */
function fixture() {
  const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...randomBytes(200)]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...randomBytes(64)]);
  const pdf = new Uint8Array([...strToU8("%PDF-1.4\n"), ...randomBytes(300)]);
  return {
    "prototype/index.html": strToU8(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Crew board</title><link rel="stylesheet" href="css/app.css"></head><body>' +
        '<h1>Crew board</h1><a href="about.html">About</a> <a href="https://example.com/help">Help</a> <a href="fixtures/report.pdf">Report</a>' +
        '<form id="f"><input name="q"><button>Find</button></form><iframe src="embed/earlier.html" title="Earlier"></iframe>' +
        '<img src="img/dot.png" alt=""><img src="img/missing.png" alt="">' +
        '<script type="module" src="js/app.mjs"></script></body></html>',
    ),
    "prototype/about.html": strToU8('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>About</title></head><body><a href="index.html">Back</a></body></html>'),
    "prototype/embed/earlier.html": strToU8('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Earlier</title></head><body><p>An earlier direction.</p></body></html>'),
    "prototype/css/app.css": strToU8('@font-face { font-family: Crew; src: url("../fonts/crew.woff2") format("woff2"); } body { font-family: Crew; background: url(../img/dot.png); } .logo { background: url(/assets/logo.png); }'),
    "prototype/js/app.mjs": strToU8('const data = await (await fetch("../data.json")).json(); try { localStorage.setItem("seen", "1"); } catch { /* stateless */ } document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); document.title = data.title; });'),
    "prototype/data.json": strToU8('{"title":"Found"}'),
    "prototype/fonts/crew.woff2": font,
    "prototype/img/dot.png": png,
    "prototype/fixtures/report.pdf": pdf,
    "prototype/notes.xyz": strToU8("not a known type"),
    "prototype/feed.xml": strToU8("<?xml version=\"1.0\"?><feed/>"),
  };
}

let h: Harness;
let alice: Browser;
let rita: Browser;
let mallory: Browser;
let P: string;
let tenantId: string;
let productId: string;

async function upload(b: Browser, base: string, entries: Record<string, Uint8Array | string>) {
  const g = await b.api("POST", `${base}/mockups/uploads`, {});
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
  const put = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: bytes });
  expect(put.status).toBe(201);
  return g.body.upload_id as string;
}

/** PUT raw ZIP bytes under a new grant. */
async function uploadBytes(bytes: Uint8Array) {
  const g = await alice.api("POST", `${P}/mockups/uploads`, {});
  const put = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: bytes });
  expect(put.status).toBe(201);
  return g.body.upload_id as string;
}

const manifest = (pages: unknown[], more: Record<string, unknown> = {}) => JSON.stringify({ title: "Crew board", pages, ...more });
const rows = (table: string, where = sql`true`) =>
  h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return (await sql<Record<string, unknown>>`select * from ${sql.table(table)} where ${where}`.execute(trx)).rows;
  });

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  mallory = await h.signIn("mallory@example.com", "Mallory Elsewhere");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Prototype Co" });
  tenantId = t.body.tenant.tenant_id ?? t.body.tenant.id;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Crews" });
  P = `/api/v1/p/${p.body.path}`;
  productId = p.body.product_id;
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "crews", email: "rita@example.com", role: "reader" })).status).toBe(201);
  // Mallory has an organization of her own, and nothing in Alice's.
  await mallory.api("POST", "/api/v1/tenants", { name: "Elsewhere Ltd" });
});
afterAll(async () => h?.close());

describe("a mockup's prototype", () => {
  let mockupId: string;
  let etag: string;
  let base: string;
  let files: ReturnType<typeof fixture>;
  let versionOne: { path: string; blob_key: string; sha256: string }[];

  it("publishes a canvas whose pages enter its prototype, keeping every file as it is and saying what will not load", async () => {
    files = fixture();
    const uploadId = await upload(alice, P, {
      "manifest.json": manifest([
        { page_id: "board", title: "Board", entry: "index.html?crew=north#today", width: 1280, height: 800 },
        { page_id: "about", title: "About", entry: "about.html", poster: "img/dot.png" },
      ]),
      "brief.md": "# Crew board\n\nDoes a crew read its day at a glance?",
      ...files,
    });
    const r = await alice.api("POST", `${P}/mockups`, { upload_id: uploadId });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    mockupId = r.body.mockup_id;
    etag = r.body.etag;
    // Publish answers with what comes next; get reads the version, with its prototype's address.
    const current = (await alice.api("GET", `${P}/mockups/${mockupId}`)).body.current;
    expect(current.version_id).toBe(r.body.current_version_id);
    const proto = current.prototype;
    expect(proto).toMatchObject({ file_count: 11, sandbox: "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" });
    expect(proto.bytes).toBe(Object.values(files).reduce((n, b) => n + b.length, 0));
    base = proto.base_url;
    expect(base).toMatch(new RegExp(`^${h.baseUrl}/prototypes/[A-Za-z0-9_.-]+/$`));
    // The address names no account, so a prototype cannot tell who views it.
    const claims = JSON.parse(Buffer.from(base.split("/")[4]!.split(".")[0]!, "base64url").toString());
    expect(Object.keys(claims).sort()).toEqual(["exp", "purpose", "t", "v", "xv"]);
    expect(claims.exp % 3600).toBe(0);
    expect(Date.parse(proto.expires_at) - Date.now()).toBeGreaterThan(8 * 3600_000 - 60_000);
    expect(current.pages).toEqual([
      expect.objectContaining({ page_id: "board", entry: "index.html?crew=north#today", prototype_url: `${base}index.html?crew=north#today` }),
      expect.objectContaining({ page_id: "about", entry: "about.html", poster: "img/dot.png", prototype_url: `${base}about.html` }),
    ]);
    expect(current.pages[0]).not.toHaveProperty("html_path");
    expect(r.body.page_ids).toEqual(["board", "about"]);
    expect(r.body.prototype_warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^css\/app\.css names \/assets\/logo\.png, a root-relative address/),
        expect.stringMatching(/^index\.html names img\/missing\.png, which the prototype does not hold/),
        "js/app.mjs uses localStorage: unavailable in WhatBuild's sandbox, and it throws; guard it or remove it.",
      ]),
    );
    // A link to elsewhere opens a tab, so it is no warning.
    expect(r.body.prototype_warnings.join(" ")).not.toContain("example.com");
    versionOne = (await rows("mockup_prototype_files", sql`version_id = ${r.body.current_version_id}`)) as never;
    for (const f of versionOne) {
      expect(f.blob_key).toBe(`t/${tenantId}/p/${productId}/mockup-prototypes/${uploadId}/${f.sha256}`);
      expect(f.blob_key).not.toContain(f.path);
    }
  });

  it("serves each file under its grant in the prototype's sandbox, byte for byte, and its documents with the frame script", async () => {
    const css = await fetch(`${base}css/app.css`, { headers: { "sec-fetch-dest": "style" } });
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const csp = css.headers.get("content-security-policy")!;
    expect(csp).toBe(
      [
        "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
        "default-src 'none'",
        `script-src ${base} 'unsafe-inline' 'unsafe-eval'`,
        `style-src ${base} 'unsafe-inline'`,
        `img-src ${base} data: blob:`,
        `font-src ${base} data:`,
        `media-src ${base} data: blob:`,
        `connect-src ${base}`,
        `frame-src ${base}`,
        "worker-src 'none'",
        "manifest-src 'none'",
        "object-src 'none'",
        `base-uri ${base}`,
        "form-action 'none'",
      ].join("; "),
    );
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("frame-ancestors");
    expect(Object.fromEntries(["x-content-type-options", "referrer-policy", "cross-origin-resource-policy", "cross-origin-embedder-policy", "access-control-allow-origin", "cache-control", "permissions-policy"].map((k) => [k, css.headers.get(k)]))).toEqual({
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "cross-origin",
      "cross-origin-embedder-policy": "credentialless",
      "access-control-allow-origin": "*",
      "cache-control": "private, no-store",
      "permissions-policy": PERMISSIONS_POLICY,
    });
    expect(css.headers.get("access-control-allow-credentials")).toBeNull();
    expect(css.headers.get("set-cookie")).toBeNull();
    expect(await css.text()).toBe(strFromU8(files["prototype/css/app.css"]));

    for (const [path, type] of [
      ["fonts/crew.woff2", "font/woff2"],
      ["img/dot.png", "image/png"],
      ["fixtures/report.pdf", "application/pdf"],
      ["js/app.mjs", "text/javascript; charset=utf-8"],
      ["data.json", "application/json; charset=utf-8"],
      ["feed.xml", "text/plain; charset=utf-8"],
    ] as const) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe(type);
      expect(res.headers.get("content-disposition"), path).toBeNull();
      expect(sha(new Uint8Array(await res.arrayBuffer())), path).toBe(sha(files[`prototype/${path}` as keyof typeof files]));
    }
    const unknown = await fetch(`${base}notes.xyz`);
    expect(unknown.headers.get("content-type")).toBe("application/octet-stream");
    expect(unknown.headers.get("content-disposition")).toBe("attachment");

    // A document: the stored bytes, then the frame script for this prototype's address.
    const doc = await fetch(`${base}index.html`, { headers: { "sec-fetch-dest": "iframe" } });
    expect(doc.status).toBe(200);
    expect(doc.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const text = await doc.text();
    expect(text.startsWith(strFromU8(files["prototype/index.html"]))).toBe(true);
    expect(text).toContain('send({whatbuild:"frame-ready"})');
    expect(text).toContain(`proto=${JSON.stringify(base)},inPlace=true`);
    // The prototype's root is its index.html; a folder ending in / is its index.html too.
    expect((await fetch(base)).status).toBe(200);
    expect((await fetch(`${base}embed/`)).status).toBe(404);
    // Ranges, for media; HEAD, without a body.
    const part = await fetch(`${base}fixtures/report.pdf`, { headers: { range: "bytes=0-8" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("%PDF-1.4\n");
    const head = await fetch(`${base}img/dot.png`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(files["prototype/img/dot.png"].length));
  });

  it("refuses what is not a frame's read of that one version: other methods, top-level documents, service workers, bad grants and traversal", async () => {
    expect((await fetch(`${base}index.html`, { method: "POST", body: "x" })).status).toBe(405);
    const top = await fetch(`${base}index.html`, { headers: { "sec-fetch-dest": "document" } });
    expect(top.status).toBe(403);
    expect(top.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect((await fetch(`${base}js/app.mjs`, { headers: { "service-worker": "script" } })).status).toBe(403);
    const grant = base.split("/")[4]!;
    const tampered = base.replace(grant, `${grant.slice(0, -2)}xx`);
    expect((await fetch(`${tampered}index.html`)).status).toBe(401);
    const signer = new HmacGrantSigner(h.config.grantKey);
    const claims = JSON.parse(Buffer.from(grant.split(".")[0]!, "base64url").toString());
    const expired = signer.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await fetch(`${h.baseUrl}/prototypes/${expired}/index.html`)).status).toBe(401);
    const otherPurpose = signer.sign({ ...claims, purpose: "mockup" });
    expect((await fetch(`${h.baseUrl}/prototypes/${otherPurpose}/index.html`)).status).toBe(401);
    for (const path of ["%2e%2e/index.html", "css%2fapp.css", "css%5capp.css", "index.html%00", "%E0%A4%A", "css%2F..%2Fdata.json"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(404);
    }
    // Dot segments a browser would resolve before sending, sent as they are: the server resolves them
    // too, before routing, so this address is /api/v1/me, which wants a session, and no prototype file.
    const raw = await new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, path: `${u.pathname}../../api/v1/me`, method: "GET" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(raw).toBe(401);
  });

  it("never takes a session: another organization's cookie changes nothing, and a cookie without a grant reads nothing", async () => {
    const withCookie = await fetch(`${base}data.json`, { headers: { cookie: mallory.cookie } });
    expect(withCookie.status).toBe(200);
    expect(await withCookie.text()).toBe('{"title":"Found"}');
    expect(withCookie.headers.get("set-cookie")).toBeNull();
    expect((await fetch(`${h.baseUrl}/prototypes/x/data.json`, { headers: { cookie: alice.cookie } })).status).toBe(401);
  });

  it("carries the prototype forward, stores again only what changed, and keeps a listed file's bytes from the base", async () => {
    // A version published in a call keeps the prototype, and its pages may enter it.
    const v2 = await alice.api("POST", `${P}/mockups`, {
      mockup_id: mockupId,
      expected_etag: etag,
      pages: [{ page_id: "board" }, { page_id: "about", title: "About us", entry: "about.html#team" }, { page_id: "embed", title: "Earlier", entry: "embed/earlier.html" }],
    });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    etag = v2.body.etag;
    const two = (await alice.api("GET", `${P}/mockups/${mockupId}`)).body.current;
    expect(two.prototype.file_count).toBe(11);
    expect(two.pages.map((p: { entry: string }) => p.entry)).toEqual(["index.html?crew=north#today", "about.html#team", "embed/earlier.html"]);
    expect(v2.body).not.toHaveProperty("prototype_warnings");
    const kept = await rows("mockup_prototype_files", sql`version_id = ${v2.body.current_version_id}`);
    expect(kept.map((r) => r["blob_key"]).sort()).toEqual(versionOne.map((r) => r.blob_key).sort());

    // An upload listing every path, with only one file in it: the rest keep the base's blobs.
    await h.worker.drain();
    const before = h.blobs.blobs.size;
    const changed = strToU8("body { background: white; }");
    const listed = versionOne.map((r) => ({ path: r.path, sha256: r.path === "css/app.css" ? sha(changed) : r.sha256 }));
    const v3 = await alice.api("POST", `${P}/mockups`, {
      mockup_id: mockupId,
      expected_etag: etag,
      upload_id: await upload(alice, P, { "manifest.json": manifest([{ page_id: "board", entry: "index.html" }], { prototype: listed }), "prototype/css/app.css": changed }),
    });
    expect(v3.status, JSON.stringify(v3.body)).toBe(201);
    etag = v3.body.etag;
    const three = await rows("mockup_prototype_files", sql`version_id = ${v3.body.current_version_id}`);
    expect(three).toHaveLength(11);
    for (const r of three) {
      const one = versionOne.find((x) => x.path === r["path"])!;
      if (r["path"] === "css/app.css") expect(r["blob_key"]).not.toBe(one.blob_key);
      else expect(r["blob_key"]).toBe(one.blob_key);
    }
    // One new blob, the changed file (the upload's ZIP is deleted once the worker runs).
    await h.worker.drain();
    expect(h.blobs.blobs.size).toBe(before + 1);

    // A listed file that is neither in the ZIP nor in the base, or whose hash is not the base's, is refused.
    const wrong = await alice.api("POST", `${P}/mockups`, {
      mockup_id: mockupId,
      expected_etag: etag,
      upload_id: await upload(alice, P, { "manifest.json": manifest([{ page_id: "board", entry: "index.html" }], { prototype: [{ path: "index.html", sha256: "0".repeat(64) }, { path: "gone.js" }] }) }),
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.problems).toEqual([
      "manifest.json's prototype gives index.html a sha256 the base version's file does not have.",
      "manifest.json's prototype lists gone.js, which is neither under prototype/ nor in the base version.",
    ]);
  });

  it("downloads a version with its prototype byte for byte, and the download uploads again storing nothing new", async () => {
    const g = await alice.api("POST", `${P}/mockups/${mockupId}/downloads`, { version: 1 });
    const zip = unzipSync(new Uint8Array(await (await fetch(g.body.url, { headers: g.body.headers })).arrayBuffer()));
    const m = JSON.parse(strFromU8(zip["manifest.json"]!));
    expect(m.format_version).toBe(2);
    expect(m.pages[0]).toMatchObject({ page_id: "board", entry: "index.html?crew=north#today" });
    expect(m.pages[0]).not.toHaveProperty("html");
    expect(zip["pages/board.html"]).toBeUndefined();
    for (const [name, bytes] of Object.entries(files)) {
      expect(sha(zip[name]!), name).toBe(sha(bytes));
      expect(m.prototype.find((x: { path: string }) => `prototype/${x.path}` === name)?.sha256).toBe(sha(bytes));
    }
    // Back in as it came out: a new version, every blob the old one's.
    await h.worker.drain();
    const before = h.blobs.blobs.size;
    const again = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, from_version: 1, upload_id: await uploadBytes(zipSync(zip)) });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    etag = again.body.etag;
    const back = await rows("mockup_prototype_files", sql`version_id = ${again.body.current_version_id}`);
    expect(back.map((r) => r["blob_key"]).sort()).toEqual(versionOne.map((r) => r.blob_key).sort());
    await h.worker.drain();
    expect(h.blobs.blobs.size).toBe(before);
  });

  it("refuses entries and posters the prototype cannot give, and a page with both html and an entry", async () => {
    const pages = [
      { page_id: "a", title: "A", entry: "missing.html" },
      { page_id: "b", title: "B", entry: "css/app.css" },
      { page_id: "c", title: "C", entry: "index.html", poster: "about.html" },
      { page_id: "d", title: "D", entry: "../index.html" },
      { page_id: "e", title: "E", entry: "index.html", html: "<p>e</p>" },
    ];
    const r = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, pages });
    expect(r.status).toBe(422);
    expect(r.body.error.details.problems).toEqual([
      "Page 5 (e) gives both html and entry; a page has its own HTML or enters the prototype.",
      "Page 1 (a)'s entry names missing.html, which the prototype does not hold.",
      "Page 2 (b)'s entry names css/app.css, which is not an HTML document (.html or .htm).",
      "Page 3 (c)'s poster about.html is not a PNG, JPEG, GIF, WebP or AVIF image.",
      "Page 4 (d)'s entry ../index.html: its path has a .. in the path.",
    ]);
    // Dropping the prototype leaves entries with nothing to enter.
    const dropped = await alice.api("POST", `${P}/mockups`, {
      mockup_id: mockupId,
      expected_etag: etag,
      upload_id: await upload(alice, P, { "manifest.json": manifest([{ page_id: "board", entry: "index.html" }], { prototype: [] }) }),
    });
    expect(dropped.status).toBe(422);
    expect(dropped.body.error.details.problems).toEqual(["Page 1 (board) enters the prototype, and this version carries none: upload one under prototype/ in the canvas ZIP."]);
    // 48 pages fit on a canvas; 49 do not.
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ page_id: `p${i}`, title: `P${i}`, entry: "index.html" }));
    expect((await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, pages: many(49) })).status).toBe(422);
    const full = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, pages: many(48) });
    expect(full.status, JSON.stringify(full.body)).toBe(201);
    etag = full.body.etag;
  });

  it("shows a promoted entry to a Story reader, whose address reaches that version's prototype and nothing else of the mockup", async () => {
    const promoted = await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "p0", title: "The board" });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    const page = await rita.api("GET", `${P}/story/pages/${promoted.body.page_id}`);
    expect(page.status).toBe(200);
    const shown = page.body.current.mockup;
    expect(shown).toMatchObject({ width: 1280, height: 800, entry: "index.html", prototype_sandbox: "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" });
    expect(shown).not.toHaveProperty("mockup_id");
    expect((await fetch(shown.prototype_url, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(200);
    expect((await fetch(new URL("about.html", shown.prototype_url))).status).toBe(200);
    expect((await rita.api("GET", `${P}/mockups/${mockupId}`)).status).toBe(403);
    // Its HTML, where HTML is needed, is a notice: the frame opens the entry itself.
    const html = await fetch(`${h.baseUrl}${P}/story/pages/${promoted.body.page_id}/versions/1/html`, { headers: { cookie: rita.cookie } });
    expect(await html.text()).toContain("This page is an interactive prototype");
    // Printed, it shows its poster when it has one.
    await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, pages: [{ page_id: "p0", poster: "img/dot.png" }] });
    const latest = await alice.api("GET", `${P}/mockups/${mockupId}`);
    etag = latest.body.etag;
    const pageNow = await alice.api("GET", `${P}/story/pages/${promoted.body.page_id}`);
    await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "p0", page_id: promoted.body.page_id, expected_etag: pageNow.body.etag });
    const print = await fetch(`${h.baseUrl}${P}/story/print?page_ids=${promoted.body.page_id}`, { headers: { cookie: alice.cookie } });
    expect(await print.text()).toContain(`data:image/png;base64,${Buffer.from(files["prototype/img/dot.png"]).toString("base64")}`);
    // Clean up for the delete below: a mockup a Story page shows cannot be deleted.
    const p = await alice.api("GET", `${P}/story/pages/${promoted.body.page_id}`);
    expect((await alice.api("DELETE", `${P}/story/pages/${promoted.body.page_id}`, { expected_etag: p.body.etag, reason: "Tidying", confirm: "delete permanently" })).status).toBe(200);
  });

  it("deletes a mockup's prototype with it: its addresses at once, its bytes when the worker runs", async () => {
    const keys = [...new Set((await rows("mockup_prototype_files")).map((r) => r["blob_key"] as string))];
    expect(keys.length).toBeGreaterThan(0);
    const impact = await alice.api("GET", `${P}/mockups/${mockupId}/delete-impact`);
    expect(impact.body).toMatchObject({ prototype_files: keys.length });
    const del = await alice.api("DELETE", `${P}/mockups/${mockupId}`, { expected_etag: impact.body.etag, reason: "Done", confirm: "delete permanently" });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect((await fetch(`${base}index.html`)).status).toBe(404);
    expect(await rows("mockup_prototype_files")).toEqual([]);
    await h.worker.drain();
    for (const k of keys) expect(await h.blobs.stat(k), k).toBeNull();
  });

  it("takes the bytes a failed publish stored with the upload nobody published", async () => {
    const uploadId = await upload(alice, P, { "manifest.json": manifest([{ page_id: "x", title: "X", entry: "nowhere.html" }]), "prototype/index.html": "<p>lonely</p>" });
    expect((await alice.api("POST", `${P}/mockups`, { upload_id: uploadId })).status).toBe(422);
    const staged = [...h.blobs.blobs.keys()].filter((k) => k.includes(`/mockup-prototypes/${uploadId}/`));
    expect(staged).toHaveLength(1);
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      await trx.updateTable("mockup_uploads").set({ expires_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).where("upload_id", "=", uploadId).execute();
    });
    (h.worker as unknown as { lastPrune: number }).lastPrune = 0;
    await h.worker.drain();
    expect(await h.blobs.stat(staged[0]!)).toBeNull();
  });
});

describe("what a prototype's ZIP may not hold", () => {
  const publish = async (bytes: Uint8Array) => alice.api("POST", `${P}/mockups`, { upload_id: await uploadBytes(bytes) });
  const page = manifest([{ page_id: "a", title: "A", entry: "index.html" }]);
  /** A ZIP with entries as given, names repeated and attributes set: what zipSync will not make. */
  const rawZip = (entries: [string, Uint8Array, number?][]) => {
    const chunks: Uint8Array[] = [];
    const z = new Zip((err, data) => {
      if (err) throw err;
      chunks.push(data);
    });
    for (const [name, data, attrs] of entries) {
      const f = new ZipPassThrough(name);
      if (attrs !== undefined) Object.assign(f, { os: 3, attrs });
      z.add(f);
      f.push(data, true);
    }
    z.end();
    return new Uint8Array(Buffer.concat(chunks));
  };

  it("refuses unsafe or ambiguous paths, case and accent collisions, repeated names and symbolic links", async () => {
    const r = await publish(
      zipSync({
        "manifest.json": strToU8(page),
        "prototype/index.html": strToU8("<p>a</p>"),
        "prototype/a\\b.js": strToU8("1"),
        "prototype/c:d.js": strToU8("1"),
        "prototype/q?.js": strToU8("1"),
        "prototype/Card.html": strToU8("1"),
        "prototype/card.html": strToU8("2"),
        "prototype/café.css": strToU8("1"),
        "prototype/café.css": strToU8("2"),
        "prototype/trailing.": strToU8("1"),
      }),
    );
    expect(r.status).toBe(422);
    const problems = r.body.error.details.problems.join("\n");
    expect(problems).toContain('prototype/a\\b.js: the character "\\\\"');
    expect(problems).toContain('prototype/c:d.js: the character ":"');
    expect(problems).toContain('prototype/q?.js: the character "?"');
    expect(problems).toMatch(/prototype\/Card\.html and prototype\/card\.html name the same file|prototype\/card\.html and prototype\/Card\.html name the same file/);
    expect(problems).toMatch(/caf.\.css and prototype\/caf.+\.css name the same file/);
    expect(problems).toContain("prototype/trailing.: a name that ends in a space or a dot");

    const twice = await publish(rawZip([["manifest.json", strToU8(page)], ["prototype/index.html", strToU8("1")], ["prototype/index.html", strToU8("2")]]));
    expect(twice.status).toBe(422);
    expect(twice.body.error.details.problems).toEqual(["prototype/index.html appears more than once in the ZIP."]);
    const link = await publish(rawZip([["manifest.json", strToU8(page)], ["prototype/index.html", strToU8("/etc/passwd"), 0o120777 * 65536]]));
    expect(link.status).toBe(422);
    expect(link.body.error.details.problems).toEqual(["prototype/index.html is a symbolic link; zip the file it points to instead."]);
    // The paths the ZIP reader itself takes apart: a dot part, an absolute path, an empty folder.
    for (const bad of ["prototype/../index.html", "prototype//index.html", "prototype/./index.html"]) {
      const res = await publish(rawZip([["manifest.json", strToU8(page)], [bad, strToU8("1")]]));
      expect(res.status, bad).toBe(422);
    }
  });

  it("stops a ZIP bomb at the unpacked budget, and refuses too many entries and a file too large", async () => {
    const bomb = await publish(zipSync({ "manifest.json": strToU8(page), "prototype/index.html": new Uint8Array(97 * MiB) }, { level: 9 }));
    expect(bomb.status).toBe(422);
    expect(bomb.body.error.message).toBe(
      "Nothing was published: the ZIP unpacks to more than 96 MB, and a canvas's ZIP unpacks to at most that. Leave out what the canvas does not need and request a new upload.",
    );
    const big = await publish(zipSync({ "manifest.json": strToU8(page), "prototype/index.html": strToU8("<p>a</p>"), "prototype/video.mp4": new Uint8Array(26 * MiB) }, { level: 9 }));
    expect(big.status).toBe(422);
    expect(big.body.error.details.problems).toEqual(["prototype/video.mp4 is 27,262,976 bytes; a prototype file is at most 26,214,400."]);
    const entries: Record<string, Uint8Array> = { "manifest.json": strToU8(page) };
    for (let i = 0; i < 2200; i++) entries[`prototype/f${i}.txt`] = strToU8("x");
    const crowd = await publish(zipSync(entries));
    expect(crowd.status).toBe(422);
    expect(crowd.body.error.message).toMatch(/the archive holds 2201 entries; at most \d+ are read/);
  });
});

describe("prototype paths and warnings", () => {
  it("stores paths in NFC and decodes a request's path strictly", () => {
    expect(prototypePath("café/index.html")).toEqual({ path: "café/index.html" });
    expect(prototypePath("/abs.html")).toEqual({ problem: "an absolute path; prototype paths are relative" });
    expect(requestedPrototypePath("")).toBe("index.html");
    expect(requestedPrototypePath("a%20b/c.html")).toBe("a b/c.html");
    expect(requestedPrototypePath("caf%C3%A9.css")).toBe("café.css");
    expect(requestedPrototypePath("cafe%CC%81.css")).toBe("café.css");
    for (const bad of ["%2e%2e/x", "a%2fb", "a%5cb", "..", "a/../b", "%zz", "a%00"]) expect(requestedPrototypePath(bad), bad).toBeNull();
  });

  it("warns about each state API a script uses, inline or in a file", () => {
    const html = strToU8('<!doctype html><button onclick="document.cookie=\'a=1\'">x</button><script>sessionStorage.x = 1; indexedDB.open("d")</script>');
    expect(prototypeWarnings([{ path: "a.html", media_type: "text/html; charset=utf-8", data: html }])).toEqual([
      "a.html uses sessionStorage, indexedDB, document.cookie: unavailable in WhatBuild's sandbox, and each throws; guard them or remove them.",
    ]);
  });

  it("masks a prototype's address in the server's log, and the app frames a content site's prototypes only", () => {
    expect(loggedPath("/prototypes/eyJ2IjoxfQ.abc/secret-plans.html")).toBe("/prototypes/:grant/…");
    const csp = pageHeaders(false, "https://usercontent.example.net")["Content-Security-Policy"];
    expect(csp).toContain("frame-src 'self' https://usercontent.example.net/prototypes/;");
  });
});

describe("on a content site of its own", () => {
  let c: Harness;
  let owner: Browser;
  let content: string;
  let base: string;

  beforeAll(async () => {
    c = await startHarness((app) => ({ contentUrl: app.replace("localhost", "127.0.0.1") }));
    content = c.config.contentUrl!;
    owner = await c.signIn("olive@example.com", "Olive Owner");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Content Co" });
    const p = await owner.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Site" });
    const Q = `/api/v1/p/${p.body.path}`;
    const g = await owner.api("POST", `${Q}/mockups/uploads`, {});
    const zip = zipSync({ "manifest.json": strToU8(manifest([{ page_id: "a", title: "A", entry: "index.html" }])), "prototype/index.html": strToU8("<p>on the content site</p>") });
    expect((await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: zip })).status).toBe(201);
    const r = await owner.api("POST", `${Q}/mockups`, { upload_id: g.body.upload_id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { prototype } = (await owner.api("GET", `${Q}/mockups/${r.body.mockup_id}`)).body.current;
    base = prototype.base_url;
    expect(prototype.sandbox).toBe("allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals");
  });
  afterAll(async () => c?.close());

  it("serves prototypes there only, opens a document at the top level there, and serves nothing else there", async () => {
    expect(base.startsWith(`${content}/prototypes/`)).toBe(true);
    const top = await fetch(`${base}index.html`, { headers: { "sec-fetch-dest": "document" } });
    expect(top.status).toBe(200);
    expect(top.headers.get("content-security-policy")).toContain("sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals;");
    // The app's own host does not serve them, and the content site serves nothing of the app's.
    expect((await fetch(base.replace(content, c.baseUrl) + "index.html")).status).toBe(404);
    expect((await fetch(`${content}/api/v1/me`, { headers: { cookie: owner.cookie } })).status).toBe(404);
    expect((await fetch(`${content}/`, { headers: { "sec-fetch-mode": "navigate" } })).status).toBe(404);
  });
});
