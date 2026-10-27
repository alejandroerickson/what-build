import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, providersText } from "../src/config.ts";
import { startHarness, type Harness } from "./harness.ts";

/** A web build with the site's privacy page, which the server writes the deployment's facts into. */
function webDist() {
  const dist = mkdtempSync(join(tmpdir(), "wb-web-"));
  mkdirSync(join(dist, "site", "privacy"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<p>the app</p>");
  writeFileSync(join(dist, "site", "privacy", "index.html"), "<html><head><title>privacy</title></head><body></body></html>");
  return dist;
}

/** The facts a served page carries in its `whatbuild-site` meta. */
function written(html: string) {
  const meta = /<meta name="whatbuild-site" content="([^"]*)" \/>/.exec(html)?.[1] ?? "";
  return JSON.parse(meta.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
}

/** A GET with a Host header of our choosing, which fetch does not allow. */
function hostGet(baseUrl: string, host: string, path: string) {
  const { port } = new URL(baseUrl);
  return new Promise<{ status: number; location: string | undefined; text: string }>((done, reject) => {
    request({ host: "localhost", port, path, headers: { host } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => done({ status: res.statusCode ?? 0, location: res.headers.location, text }));
    })
      .on("error", reject)
      .end();
  });
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    operator: "Example Labs",
    privacyContact: "privacy@example.com",
    providers: providersText("Example Cloud runs the service and keeps its files and logs.\n  Example DB holds the database, and Example Mail sends the email."),
    sessionDays: 21,
    webDist: webDist(),
  });
});
afterAll(async () => h?.close());

describe("the privacy page's facts", () => {
  it("come from the deployment, signed out, with the site's other facts", async () => {
    const site = (await (await fetch(`${h.baseUrl}/api/v1/plans`)).json()) as { privacy: Record<string, unknown> };
    expect(site.privacy).toEqual({
      operator: "Example Labs",
      contact: "privacy@example.com",
      providers: "Example Cloud runs the service and keeps its files and logs. Example DB holds the database, and Example Mail sends the email.",
      analytics: false,
    });
    const meta = (await (await fetch(`${h.baseUrl}/api/v1/meta`)).json()) as Record<string, unknown>;
    expect(meta).not.toHaveProperty("privacy");
  });

  it("are empty where the deployment names nothing", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://x/y" });
    expect([config.operator, config.privacyContact, config.providers]).toEqual([null, null, null]);
    expect(providersText(" \n ")).toBeNull();
  });
});

describe("the privacy page", () => {
  it("is the site's, at /site/privacy/ on the app's origin, with the facts written in", async () => {
    const res = await fetch(`${h.baseUrl}/site/privacy/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>privacy</title>");
    expect(written(html).privacy.operator).toBe("Example Labs");
  });

  it("is where the app links to, there being no site", async () => {
    const meta = (await (await fetch(`${h.baseUrl}/api/v1/meta`)).json()) as { privacy_url: string };
    expect(meta.privacy_url).toBe(`${h.config.publicBaseUrl}/site/privacy/`);
  });

  describe("on a deployment with a site", () => {
    let s: Harness;
    const site = "what-build.test";
    beforeAll(async () => {
      s = await startHarness({ siteUrl: `https://${site}`, webDist: webDist(), operator: "Example Labs" });
    });
    afterAll(async () => s?.close());

    it("is served at /privacy on the site's domain, with the facts written in", async () => {
      for (const path of ["/privacy", "/privacy/"]) {
        const res = await hostGet(s.baseUrl, site, path);
        expect(res.status, path).toBe(200);
        expect(written(res.text).privacy.operator).toBe("Example Labs");
      }
    });

    it("is where the app links to, and the app has no page of its own there", async () => {
      const meta = (await (await fetch(`${s.baseUrl}/api/v1/meta`)).json()) as { privacy_url: string };
      expect(meta.privacy_url).toBe(`https://${site}/privacy`);
      const app = await fetch(`${s.baseUrl}/privacy`, { redirect: "manual" });
      expect(app.status).toBe(200);
      expect(await app.text()).toContain("the app");
    });
  });
});
