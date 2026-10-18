import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PERMISSIONS_POLICY } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createPorts, FALLBACK_HTML_POLICY, RESPONSE_HEADERS } from "../src/app.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// The headers the weekly OWASP ZAP baseline checks (.github/zap-rules.tsv), held here on every
// kind of response, including those the scan cannot reach without signing in.

let h: Harness;
let alice: Browser;
let P: string;
let agentToken: string;
let pdfSource: string;
let textSource: string;
let mockupId: string;
const site = "what-build.test";

/** GET with a Host header of our choosing, which fetch does not allow; the response's headers. */
function onHost(host: string, path: string) {
  const { port } = new URL(h.baseUrl);
  return new Promise<Headers>((resolve, reject) => {
    request({ host: "localhost", port, path, headers: { host } }, (res) => {
      res.resume();
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers.set(k, v);
      resolve(headers);
    })
      .on("error", reject)
      .end();
  });
}

async function upload(path: string, body: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: `Upload of ${path}`, path });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body })).status).toBe(201);
  return created.body.record.record_id as string;
}

/** A page of the app's own, and every kind of HTML the server sends, by name. */
async function htmlResponses(): Promise<[string, Headers][]> {
  const consent = await (async () => {
    const reg = (await (await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Headers", redirect_uris: ["http://127.0.0.1:9999/callback"] }) })).json()) as { client_id: string };
    const url = `${h.baseUrl}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&code_challenge=abc&code_challenge_method=S256&state=s`;
    return fetch(url, { headers: { cookie: alice.cookie } });
  })();
  const get = async (path: string) => (await alice.api("GET", path)).headers;
  return [
    ["the app's shell", (await fetch(`${h.baseUrl}/`)).headers],
    ["an app page", (await fetch(`${h.baseUrl}/t/acme/core/planner/story/overview`)).headers],
    ["the public site", await onHost(site, "/")],
    ["a Story page", await get(`${P}/story/pages/overview/versions/1/html?frame=1`)],
    ["a mockup page", await get(`${P}/mockups/${mockupId}/versions/1/pages/board/html?frame=1`)],
    ["a house style's specimen", await get(`${P}/story/house-styles/clear/specimen?theme=light`)],
    ["the print view", await get(`${P}/story/print?page_ids=overview`)],
    ["the OAuth consent page", consent.headers],
  ];
}

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), "wb-headers-"));
  mkdirSync(join(dist, "assets"));
  mkdirSync(join(dist, "site"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>WhatBuild</title>");
  writeFileSync(join(dist, "assets", "app-1234.js"), "console.log(1)");
  writeFileSync(join(dist, "site", "index.html"), "<!doctype html><title>The site</title>");
  h = await startHarness({ webDist: dist, siteUrl: `https://${site}` });
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Header Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  expect((await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", html: "<!doctype html><title>t</title><h1>Hello</h1>" })).status).toBe(201);
  const m = await alice.api("POST", `${P}/mockups`, { title: "Board", brief: "One board.", pages: [{ page_id: "board", title: "Board", html: "<!doctype html><html lang=\"en\"><head><title>Board</title></head><body><p>Jobs</p></body></html>" }] });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  mockupId = m.body.mockup_id;
  pdfSource = await upload("plan.pdf", "%PDF-1.4\n%%EOF\n");
  textSource = await upload("notes.txt", "Crews text the office.\n");
  await h.worker.drain();
  agentToken = await h.connectAgent(alice);
});
afterAll(async () => h?.close());

describe("every response", () => {
  it("is for this origin only, embeds nothing that sends credentials, is never sniffed, and turns off the features no page uses", async () => {
    const responses: [string, Response][] = [
      ["the app's shell", await fetch(`${h.baseUrl}/`)],
      ["a hashed asset", await fetch(`${h.baseUrl}/assets/app-1234.js`)],
      ["a missing asset", await fetch(`${h.baseUrl}/assets/gone.js`)],
      ["the health check", await fetch(`${h.baseUrl}/health`)],
      ["OAuth metadata", await fetch(`${h.baseUrl}/.well-known/oauth-authorization-server`)],
      ["an unknown API route", await fetch(`${h.baseUrl}/api/v1/nothing-here`)],
      ["an MCP call without a token", await fetch(`${h.baseUrl}/mcp`, { method: "POST", body: "{}" })],
    ];
    for (const [what, r] of responses) {
      expect(r.headers.get("cross-origin-resource-policy"), what).toBe("same-origin");
      expect(r.headers.get("cross-origin-embedder-policy"), what).toBe("credentialless");
      expect(r.headers.get("x-content-type-options"), what).toBe("nosniff");
      expect(r.headers.get("permissions-policy"), what).toBe(PERMISSIONS_POLICY);
    }
    // What the app uses keeps its default: full screen for images and video, and the clipboard.
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    for (const feature of ["fullscreen", "clipboard-write", "picture-in-picture"]) expect(PERMISSIONS_POLICY).not.toContain(feature);
  });
});

describe("the build that answers", () => {
  it("is named on every response by the commit its image was built from, which the app compares with its own", async () => {
    const commit = "fced2c9a1b2c3d4e5f60718293a4b5c6d7e8f901";
    const config = { ...h.config, webDist: null, siteUrl: null };
    const built = createApp({ db: h.db, ports: createPorts(config, h.blobs, h.mailer), config, clock: h.clock, release: { version: "v0.15.0", commit, built_at: null } });
    for (const path of ["/health", "/api/v1/meta", "/api/v1/nothing-here", "/api/v1/me"]) expect((await built.request(path)).headers.get("x-whatbuild-commit"), path).toBe(commit);
    expect(await (await built.request("/api/v1/meta")).json()).toMatchObject({ server_version: "v0.15.0", release: { commit } });
    // A development server records no commit, and names none.
    expect((await fetch(`${h.baseUrl}/api/v1/meta`)).headers.get("x-whatbuild-commit")).toBeNull();
  });
});

describe("responses that carry people's material, identity or credentials", () => {
  it("are kept by no cache, the browser's included", async () => {
    const mcp = await fetch(`${h.baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(200);
    const derived = await alice.api("GET", `${P}/sources/${textSource}/text`);
    expect(derived.status).toBe(200);
    const responses: [string, Headers][] = [
      ["who is signed in", (await alice.api("GET", "/api/v1/me")).headers],
      ["a list of sources", (await alice.api("GET", `${P}/sources`)).headers],
      ["a PDF", (await alice.api("GET", `${P}/sources/${pdfSource}/attachment?path=plan.pdf`)).headers],
      ["a text file", (await alice.api("GET", `${P}/sources/${textSource}/attachment?path=notes.txt`)).headers],
      ["a derived text", derived.headers],
      ["a Story page", (await alice.api("GET", `${P}/story/pages/overview/versions/1/html`)).headers],
      ["the print view", (await alice.api("GET", `${P}/story/print?page_ids=overview`)).headers],
      ["an MCP answer", mcp.headers],
      ["sign-in methods", (await fetch(`${h.baseUrl}/auth/methods`)).headers],
      ["a refused token request", (await fetch(`${h.baseUrl}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token" }) })).headers],
    ];
    for (const [what, headers] of responses) expect(headers.get("cache-control"), what).toMatch(/(^|, )no-store$/);
    // The app's files are not personal: hashed ones are kept for a year, the shell is checked each time.
    expect((await fetch(`${h.baseUrl}/assets/app-1234.js`)).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await fetch(`${h.baseUrl}/`)).headers.get("cache-control")).toBe("no-cache");
  });
});

describe("every HTML response", () => {
  it("has a policy that defines the directives with no fallback: frame-ancestors, form-action and base-uri", async () => {
    for (const [what, headers] of await htmlResponses()) {
      expect(headers.get("content-type"), what).toContain("text/html");
      const csp = headers.get("content-security-policy") ?? "";
      for (const directive of ["frame-ancestors", "form-action", "base-uri"]) expect(csp, `${what}: ${directive}`).toMatch(new RegExp(`(^|; )${directive} `));
      expect(headers.get("cross-origin-embedder-policy"), what).toBe("credentialless");
    }
  });

  it("keeps app pages out of other sites' frames, and cuts the handle a page it opens would keep", async () => {
    const shell = (await fetch(`${h.baseUrl}/`)).headers;
    expect(shell.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(shell.get("x-frame-options")).toBe("DENY");
    expect(shell.get("cross-origin-opener-policy")).toBe("same-origin");
    // Story and mockup pages are framed by the app alone.
    const story = (await alice.api("GET", `${P}/story/pages/overview/versions/1/html`)).headers;
    expect(story.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  it("gets the strictest policy when its route set none", async () => {
    const config = { ...h.config, webDist: null, siteUrl: null };
    const app = createApp({ db: h.db, ports: createPorts(config, h.blobs, h.mailer), config, clock: h.clock });
    app.get("/an-unguarded-page", (c) => c.html("<p>No policy of its own.</p>"));
    const r = await app.request("/an-unguarded-page");
    expect(r.headers.get("content-security-policy")).toBe(FALLBACK_HTML_POLICY);
  });
});

describe("attachments served back", () => {
  it("may be framed only by the app, which shows PDFs in a frame", async () => {
    for (const [source, path] of [[pdfSource, "plan.pdf"], [textSource, "notes.txt"]] as const) {
      const csp = (await alice.api("GET", `${P}/sources/${source}/attachment?path=${path}`)).headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("frame-ancestors 'self'");
      expect(csp, path).toContain("form-action 'none'");
      expect(csp, path).toContain("base-uri 'none'");
    }
  });
});

describe("the public site behind Cloudflare", () => {
  it("is sent with the headers the server sends with every response", () => {
    // deploy/cloudflare/worker.js serves the site's page itself, with its own copy of the headers.
    const worker = readFileSync(new URL("../../../deploy/cloudflare/worker.js", import.meta.url), "utf8").replace(/":\s+"/g, '": "');
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) expect(worker, name).toContain(`"${name}": "${value}"`);
  });
});
