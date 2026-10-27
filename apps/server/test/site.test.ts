import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { siteRoutes } from "../src/site.ts";
import { startHarness, type Harness } from "./harness.ts";

/** A request with a Host header of our choosing, which fetch does not allow. */
function hostRequest(baseUrl: string, host: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const { port } = new URL(baseUrl);
  return new Promise<{ status: number; location: string | undefined; text: string }>((resolveRes, reject) => {
    const req = request({ host: "localhost", port, method, path, headers: { host, ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
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

  it("takes a request from a visitor who has answered the cookie question, but no cross-origin write that carries a session", async () => {
    const answered = { origin: `https://${site}`, cookie: "wb_cookies=granted" };
    const res = await hostRequest(h.baseUrl, site, "POST", "/api/v1/interest", { email: "lee@example.com" }, answered);
    expect(res.status).toBe(200);
    const signedIn = await hostRequest(h.baseUrl, site, "POST", "/api/v1/interest", { email: "lee@example.com" }, { ...answered, cookie: "wb_cookies=granted; __Host-wb_session=x" });
    expect(signedIn.status).toBe(403);
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

describe("the public site with Google Analytics", () => {
  it("carries the measurement ID and lets Google's hosts in, only when the deployment sets one", async () => {
    const dist = mkdtempSync(join(tmpdir(), "wb-web-"));
    mkdirSync(join(dist, "site"));
    writeFileSync(join(dist, "site", "index.html"), "<html><head><title>site</title></head><body></body></html>");
    const page = async (analyticsId: string | null) => {
      const config = { ...loadConfig({ NODE_ENV: "test", WHATBUILD_PUBLIC_URL: "https://app.what-build.test" }), siteUrl: "https://what-build.test", webDist: dist, analyticsId };
      const res = await siteRoutes({ db: null as never, config }).request("/", { headers: { host: "what-build.test" } });
      return { text: await res.text(), csp: res.headers.get("content-security-policy") ?? "" };
    };
    const without = await page(null);
    expect(without.text).not.toContain("whatbuild-analytics");
    expect(without.csp).not.toContain("googletagmanager");
    const withIt = await page("G-TEST123");
    expect(withIt.text).toContain('<meta name="whatbuild-analytics" content="G-TEST123" />');
    expect(withIt.csp).toContain("https://*.googletagmanager.com");
  });
});

describe("the public site's plans page", () => {
  let h: Harness;
  const site = "what-build.test";
  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), "wb-web-"));
    mkdirSync(join(dist, "site", "plans"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<p>the app</p>");
    writeFileSync(join(dist, "site", "index.html"), "<html><head><title>site</title></head><body></body></html>");
    writeFileSync(join(dist, "site", "plans", "index.html"), "<html><head><title>plans</title></head><body></body></html>");
    h = await startHarness({ siteUrl: `https://${site}`, webDist: dist, instanceOwners: ["root@example.com"] });
  });
  afterAll(() => h.close());

  it("is served at /plans from its own page, carrying the plans and guests as an instance owner set them", async () => {
    const root = await h.signIn("root@example.com", "Root Owner");
    expect((await root.api("PATCH", "/api/v1/plans", { plan: "pro", price: 'US$10 a "month"' })).status).toBe(200);
    expect((await root.api("PATCH", "/api/v1/guests", { self_serve: true })).status).toBe(200);
    for (const path of ["/plans", "/plans/"]) {
      const res = await hostRequest(h.baseUrl, site, "GET", path);
      expect(res.status).toBe(200);
      expect(res.text).toContain("<title>plans</title>");
      const meta = /<meta name="whatbuild-site" content="([^"]*)" \/>/.exec(res.text)?.[1] ?? "";
      const written = JSON.parse(meta.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      expect(written.plans.find((p: { id: string }) => p.id === "pro").price).toBe('US$10 a "month"');
      expect(written.guests).toEqual({ self_serve: true, open: true });
    }
    // The same, from the service, for the Cloudflare Worker to write in: answered on the site's host too.
    const asked = await hostRequest(h.baseUrl, site, "GET", "/api/v1/plans");
    expect(asked.status).toBe(200);
    expect(JSON.parse(asked.text).guests.self_serve).toBe(true);
  });
});
