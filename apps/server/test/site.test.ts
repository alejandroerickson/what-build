import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.ts";

/** A request with a Host header of our choosing, which fetch does not allow. */
function hostRequest(baseUrl: string, host: string, method: string, path: string, body?: unknown) {
  const { port } = new URL(baseUrl);
  return new Promise<{ status: number; location: string | undefined; text: string }>((resolveRes, reject) => {
    const req = request({ host: "localhost", port, method, path, headers: { host, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolveRes({ status: res.statusCode ?? 0, location: res.headers.location, text }));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

describe("the public site", () => {
  let h: Harness;
  const site = "what-build.test";
  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), "wb-web-"));
    mkdirSync(join(dist, "site"));
    writeFileSync(join(dist, "index.html"), "<p>the app</p>");
    writeFileSync(join(dist, "site", "index.html"), "<p>the site</p>");
    h = await startHarness({ siteUrl: `https://${site}`, webDist: dist });
  });
  afterAll(() => h.close());

  it("serves its page on its own host, and the app everywhere else", async () => {
    const page = await hostRequest(h.baseUrl, site, "GET", "/");
    expect(page.status).toBe(200);
    expect(page.text).toContain("the site");
    const app = await fetch(`${h.baseUrl}/`);
    expect(await app.text()).toContain("the app");
  });

  it("redirects www to the site, and the app's paths to the app", async () => {
    const www = await hostRequest(h.baseUrl, `www.${site}`, "GET", "/?ref=x");
    expect(www.status).toBe(301);
    expect(www.location).toBe(`https://${site}/?ref=x`);
    for (const path of ["/signin", "/mcp", "/api/v1/meta", "/t/acme/core/crewboard/idea"]) {
      const res = await hostRequest(h.baseUrl, site, "GET", path);
      expect(res.status, path).toBe(302);
      expect(res.location).toBe(`${h.baseUrl}${path}`);
    }
  });

  it("follows the domain a proxy forwards, as the Cloudflare Worker does", async () => {
    const { port } = new URL(h.baseUrl);
    const page = await new Promise<string>((done, reject) => {
      request({ host: "localhost", port, path: "/", headers: { host: `localhost:${port}`, "x-forwarded-host": site } }, (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => done(text));
      })
        .on("error", reject)
        .end();
    });
    expect(page).toContain("the site");
  });

  it("records a request to hear from us once per address, and keeps what was said before", async () => {
    const first = await hostRequest(h.baseUrl, site, "POST", "/api/v1/interest", { email: "Pat@Example.com", name: "Pat", note: "Pricing pages" });
    expect(first.status).toBe(200);
    const again = await fetch(`${h.baseUrl}/api/v1/interest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pat@example.com", organization: "Example Co" }) });
    expect(await again.json()).toEqual({ received: true });
    const rows = await h.db.selectFrom("interest").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "Pat@Example.com", name: "Pat", organization: "Example Co", note: "Pricing pages" });
  });

  it("refuses a missing address, and thanks a bot without storing anything", async () => {
    const bad = await fetch(`${h.baseUrl}/api/v1/interest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "not an address" }) });
    expect(bad.status).toBe(422);
    const bot = await fetch(`${h.baseUrl}/api/v1/interest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bot@example.com", website: "https://spam.example" }) });
    expect(await bot.json()).toEqual({ received: true });
    const rows = await h.db.selectFrom("interest").select("email").where("email", "=", "bot@example.com").execute();
    expect(rows).toHaveLength(0);
  });
});
