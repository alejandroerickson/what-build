import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalHost } from "../src/canonical-host.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";
import { startHarness, type Harness } from "./harness.ts";

const PUBLIC = "https://app.example.com";
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

/** The redirect alone, in front of a route that answers every request. */
function appWith(overrides: Partial<ServerConfig> = {}, env: Record<string, string> = {}) {
  const config = { ...loadConfig({ NODE_ENV: "test", WHATBUILD_PUBLIC_URL: PUBLIC, ...env }), ...overrides };
  const app = new Hono();
  app.use("*", canonicalHost(config));
  app.all("*", (c) => c.text("answered here"));
  return app;
}

const open = (app: Hono, path: string, headers: Record<string, string>, method = "GET") => app.request(`http://ignored${path}`, { method, headers });

describe("one address for the app", () => {
  const app = appWith({ siteUrl: "https://example.com" });

  it("sends a page opened on another name for the deployment to the same path and query on the public URL", async () => {
    for (const host of ["whatbuild-abc123-uc.a.run.app", "whatbuild.kindsky-1234.westeurope.azurecontainerapps.io", "old.example.net"]) {
      const res = await open(app, "/t/acme/core/planner/evidence/01ABC?view=passages&seq=4", { host, ...NAVIGATE });
      expect(res.status, host).toBe(302);
      expect(res.headers.get("location")).toBe(`${PUBLIC}/t/acme/core/planner/evidence/01ABC?view=passages&seq=4`);
    }
    // Starting a sign-in on another name would lose its state at the public URL's callback, so it moves too.
    const signIn = await open(app, "/auth/google?next=%2Fsettings", { host: "old.example.net", ...NAVIGATE });
    expect(signIn.headers.get("location")).toBe(`${PUBLIC}/auth/google?next=%2Fsettings`);
  });

  it("answers the public URL, and the host a proxy in front forwards, where they asked", async () => {
    expect((await open(app, "/settings", { host: "app.example.com", ...NAVIGATE })).status).toBe(200);
    expect((await open(app, "/settings", { host: "APP.example.com", ...NAVIGATE })).status).toBe(200);
    // The Cloudflare Worker sends Cloud Run its run.app name and the browser's domain beside it.
    expect((await open(app, "/settings", { host: "whatbuild-abc123-uc.a.run.app", "x-forwarded-host": "app.example.com", ...NAVIGATE })).status).toBe(200);
    const forwardedElsewhere = await open(app, "/settings", { host: "app.example.com", "x-forwarded-host": "old.example.net", ...NAVIGATE });
    expect(forwardedElsewhere.status).toBe(302);
  });

  it("never moves a probe, an agent, an API client or a write", async () => {
    const host = "whatbuild.kindsky-1234.westeurope.azurecontainerapps.io";
    // Probes and agents send no Sec-Fetch-Mode, whatever the path.
    for (const path of ["/health", "/", "/t/acme/core/planner", "/api/v1/meta"]) expect((await open(app, path, { host })).status, path).toBe(200);
    // A browser's navigation to a machine's path: health, the API with its grants, MCP, OAuth and the metadata beside them.
    for (const path of ["/health", "/api/v1/meta", "/api/v1/downloads/01ABC?grant=x", "/api/v1/uploads/01ABC", "/mcp", "/mcp/t/acme", "/oauth/authorize?client_id=x", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"])
      expect((await open(app, path, { host, ...NAVIGATE })).status, path).toBe(200);
    // A fetch the page makes is not a page load.
    expect((await open(app, "/auth/session", { host, "sec-fetch-mode": "cors" })).status).toBe(200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect((await open(app, "/signin", { host, ...NAVIGATE }, method)).status, method).toBe(200);
  });

  it("never moves a prototype frame's navigation between the prototype's documents, on whatever host it is served", async () => {
    // A frame inside the app moves from one of a prototype's documents to the next with a navigation.
    const frame = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" };
    for (const host of ["app.example.com", "whatbuild-abc123-uc.a.run.app"])
      expect((await open(app, "/prototypes/eyJ2IjoxfQ.abc/checkout.html?plan=pro", { host, ...frame })).status, host).toBe(200);
  });

  it("never moves a navigation to a document's address, a frame's or a tab's, on whatever host it is served", async () => {
    const withContent = appWith({ siteUrl: "https://example.com", contentUrl: "https://usercontent.example.net" });
    for (const host of ["usercontent.example.net", "app.example.com", "whatbuild-abc123-uc.a.run.app"])
      for (const dest of ["iframe", "document"])
        expect((await open(withContent, "/documents/eyJ2IjoxfQ.abc/page.html?theme=dark", { host, ...NAVIGATE, "sec-fetch-dest": dest })).status, `${host} ${dest}`).toBe(200);
  });

  it("leaves the content site alone: every navigation there is a prototype's or a document's, served where its address points", async () => {
    const withContent = appWith({ siteUrl: "https://example.com", contentUrl: "https://usercontent.example.net" });
    expect((await open(withContent, "/prototypes/eyJ2IjoxfQ.abc/index.html", { host: "usercontent.example.net", ...NAVIGATE })).status).toBe(200);
    expect((await open(withContent, "/anything", { host: "usercontent.example.net", ...NAVIGATE })).status).toBe(200);
    // Another name for the deployment still moves.
    expect((await open(withContent, "/settings", { host: "old.example.net", ...NAVIGATE })).status).toBe(302);
  });

  it("leaves this machine's hosts and the public site's host alone", async () => {
    for (const host of ["localhost:5347", "localhost", "127.0.0.1:8787", "[::1]:8787", "app.localhost:5273", "example.com", "www.example.com"])
      expect((await open(app, "/settings", { host, ...NAVIGATE })).status, host).toBe(200);
  });

  it("is off when the public URL is a loopback address or the deployment turns it off", async () => {
    // A deployment never told its address would otherwise send everyone to localhost.
    const untold = appWith({}, { WHATBUILD_PUBLIC_URL: "http://localhost:8787" });
    expect((await open(untold, "/settings", { host: "whatbuild.example.net", ...NAVIGATE })).status).toBe(200);
    const off = appWith({}, { WHATBUILD_REDIRECT_TO_PUBLIC_URL: "0" });
    expect((await open(off, "/settings", { host: "whatbuild.example.net", ...NAVIGATE })).status).toBe(200);
    expect(loadConfig({ NODE_ENV: "test" }).redirectToPublicUrl).toBe(true);
    expect(loadConfig({ NODE_ENV: "test", WHATBUILD_REDIRECT_TO_PUBLIC_URL: "0" }).redirectToPublicUrl).toBe(false);
  });
});

describe("the server", () => {
  let h: Harness;
  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), "wb-web-"));
    writeFileSync(join(dist, "index.html"), "<p>the app</p>");
    h = await startHarness({ publicBaseUrl: PUBLIC, webDist: dist });
  });
  afterAll(() => h.close());

  const get = (host: string, path: string, headers: Record<string, string> = {}) => {
    const { port } = new URL(h.baseUrl);
    return new Promise<{ status: number; location: string | undefined }>((done, reject) => {
      request({ host: "localhost", port, path, headers: { host, ...headers } }, (res) => {
        res.resume();
        res.on("end", () => done({ status: res.statusCode ?? 0, location: res.headers.location }));
      })
        .on("error", reject)
        .end();
    });
  };

  it("redirects a page opened on its default host, and still answers probes and agents there", async () => {
    const host = "whatbuild.kindsky-1234.westeurope.azurecontainerapps.io";
    expect(await get(host, "/t/acme/core/planner/story/overview", NAVIGATE)).toEqual({ status: 302, location: `${PUBLIC}/t/acme/core/planner/story/overview` });
    expect((await get(host, "/health")).status).toBe(200);
    expect((await get(host, "/api/v1/meta", NAVIGATE)).status).toBe(200);
    expect((await get(host, "/mcp")).status).toBe(401);
    expect((await get("app.example.com", "/t/acme/core/planner", NAVIGATE)).status).toBe(200);
  });
});
