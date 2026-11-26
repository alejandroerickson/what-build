import { afterEach, describe, expect, it, vi } from "vitest";

// deploy/cloudflare/worker.js, the Worker in front of the Cloud Run service.
const worker = (await import(new URL("../../../deploy/cloudflare/worker.js", import.meta.url).href)).default as {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
};
const env = {
  ORIGIN: "https://whatbuild-abc.a.run.app",
  SITE_HOST: "example.com",
  APP_URL: "https://app.example.com",
  ASSETS: { fetch: async () => new Response("not in this build", { status: 404 }) },
};

afterEach(() => vi.unstubAllGlobals());

describe("the Cloudflare Worker", () => {
  it("serves the site's plans page from the build, with the plans the service gives through the cache", async () => {
    const asked: { path: string; cf?: unknown; key: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (r: Request, init?: { cf?: unknown }) => (asked.push({ path: new URL(r.url).pathname, cf: init?.cf, key: r.headers.get("x-whatbuild-edge-key") }), new Response('{"plans":[{"id":"pro","price":"$10 a \\"month\\""}]}'))));
    const built: string[] = [];
    const ASSETS = { fetch: async (r: Request) => (built.push(new URL(r.url).pathname), new Response("<html><head></head><body>plans</body></html>", { headers: { "Content-Type": "text/html" } })) };
    for (const path of ["/plans", "/plans/"]) {
      const res = await worker.fetch(new Request(`https://example.com${path}`), { ...env, ASSETS, EDGE_KEY: "the deployment's edge key" });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<meta name="whatbuild-site" content="{&quot;plans&quot;:[{&quot;id&quot;:&quot;pro&quot;,&quot;price&quot;:&quot;$10 a \\&quot;month\\&quot;&quot;}]}" />');
    }
    expect(built).toEqual(["/site/plans/", "/site/plans/"]);
    // Only the plans are asked of the service, through Cloudflare's cache, with the edge key.
    expect(asked.map((a) => a.path)).toEqual(["/api/v1/plans", "/api/v1/plans"]);
    expect(asked[0]).toMatchObject({ cf: { cacheTtl: 3600, cacheEverything: true }, key: "the deployment's edge key" });
  });

  it("serves the second landing page from its own page in the build", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const built: string[] = [];
    const ASSETS = { fetch: async (r: Request) => (built.push(new URL(r.url).pathname), new Response("<html><head></head><body>window</body></html>", { headers: { "Content-Type": "text/html" } })) };
    for (const path of ["/what-to-build", "/what-to-build/"]) {
      const res = await worker.fetch(new Request(`https://example.com${path}`), { ...env, ASSETS });
      expect(res.status).toBe(200);
    }
    expect(built).toEqual(["/site/what-to-build/", "/site/what-to-build/"]);
  });

  it("sends a share of the front page's visitors to the second landing page, the same ones each time, and never a crawler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const ASSETS = { fetch: async () => new Response("<html><head></head><body>front</body></html>", { headers: { "Content-Type": "text/html" } }) };
    const visit = (ip: string, split?: string, ua = "Mozilla/5.0 (Macintosh)", query = "?ref=hn") =>
      worker.fetch(new Request(`https://example.com/${query}`, { headers: { "cf-connecting-ip": ip, "user-agent": ua } }), { ...env, ASSETS, ...(split === undefined ? {} : { LANDING_SPLIT: split }) });
    // Off unless the deployment asks for it.
    expect((await visit("203.0.113.7")).status).toBe(200);
    expect((await visit("203.0.113.7", "0")).status).toBe(200);
    // All of them, keeping the address's query, and never cached.
    const sent = await visit("203.0.113.7", "1");
    expect(sent.status).toBe(302);
    expect(sent.headers.get("location")).toBe("https://example.com/what-to-build/?ref=hn");
    expect(sent.headers.get("cache-control")).toBe("no-store");
    expect((await visit("203.0.113.7", "1", "Mozilla/5.0 (compatible; Googlebot/2.1)")).status).toBe(200);
    expect((await visit("203.0.113.7", "1", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)")).status).toBe(200);
    // Someone reading in LinkedIn's app is a person, split like anyone else.
    expect((await visit("203.0.113.7", "1", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.1")).status).toBe(302);
    // Anyone who asks for the front page itself gets it, so both pages can be seen from any address.
    expect((await visit("203.0.113.7", "1", undefined, "?split=off")).status).toBe(200);
    expect((await visit("203.0.113.7", "1", undefined, "?ref=hn&split=off")).status).toBe(200);
    expect((await visit("203.0.113.7", "1", undefined, "?split=on")).status).toBe(302);
    // Half of them, each the same way every time.
    const ips = Array.from({ length: 400 }, (_, i) => `198.51.${i >> 8}.${i & 255}`);
    const first = await Promise.all(ips.map(async (ip) => (await visit(ip, "0.5")).status));
    const again = await Promise.all(ips.map(async (ip) => (await visit(ip, "0.5")).status));
    expect(again).toEqual(first);
    const share = first.filter((s) => s === 302).length / ips.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  it("names each page's address and its social card's whole, on the site's domain, for link previews", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const page = `<html><head><link rel="canonical" href="/"  />\n<meta property="og:url" content="/" />\n<meta property="og:image" content="/social-card.png" />\n<meta name="twitter:image" content="/social-card.png" />\n<meta property="og:image:width" content="1200" /></head><body>front</body></html>`;
    const ASSETS = {
      fetch: async (r: Request) =>
        new URL(r.url).pathname === "/social-card.png" ? new Response("the card", { headers: { "Content-Type": "image/png" } }) : new Response(page, { headers: { "Content-Type": "text/html", "Content-Length": String(page.length) } }),
    };
    // A link preview of the front page, and the second page's own address.
    for (const [path, ua] of [["/", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)"], ["/what-to-build/", "Mozilla/5.0 (Macintosh)"]]) {
      const res = await worker.fetch(new Request(`https://example.com${path}`, { headers: { "user-agent": ua } }), { ...env, ASSETS, LANDING_SPLIT: "1" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBeNull();
      const text = await res.text();
      expect(text).toContain('<link rel="canonical" href="https://example.com/"  />');
      expect(text).toContain('<meta property="og:url" content="https://example.com/" />');
      expect(text).toContain('<meta property="og:image" content="https://example.com/social-card.png" />');
      expect(text).toContain('<meta name="twitter:image" content="https://example.com/social-card.png" />');
      expect(text).toContain('<meta property="og:image:width" content="1200" />');
    }
    // The card itself is the build's, served on the site's domain.
    const card = await worker.fetch(new Request("https://example.com/social-card.png", { headers: { "user-agent": "LinkedInBot/1.0" } }), { ...env, ASSETS });
    expect([card.status, card.headers.get("content-type"), await card.text()]).toEqual([200, "image/png", "the card"]);
  });

  it("serves the site's pages as the build has them when the service does not answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const ASSETS = { fetch: async () => new Response("<html><head></head><body>front</body></html>", { headers: { "Content-Type": "text/html" } }) };
    const res = await worker.fetch(new Request("https://example.com/"), { ...env, ASSETS });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("whatbuild-site");
  });

  it("answers paths the app never serves itself, so scanners never wake the service", async () => {
    const forwarded = vi.fn(async () => new Response("from the service"));
    vi.stubGlobal("fetch", forwarded);
    const junk = ["/.env", "/.env.backup", "/.git/config", "/.aws/credentials", "/.DS_Store", "/xmlrpc.php", "/wp-login.php", "/phpinfo.php~", "/info.php.bak", "/service-account.json", "/config.yml"];
    for (const p of junk) {
      const res = await worker.fetch(new Request(`https://app.example.com${p}`), env);
      expect([p, res.status]).toEqual([p, 404]);
    }
    expect(forwarded).not.toHaveBeenCalled();
  });

  it("passes on every path of the app's own, its root files and organizations' paths included", async () => {
    const forwarded = vi.fn(async (r: Request) => new Response(new URL(r.url).pathname));
    vi.stubGlobal("fetch", forwarded);
    const own = [
      "/",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/mcp/t/acme/planner",
      "/favicon.svg",
      "/theme-boot.js",
      "/robots.txt",
      "/api/v1/meta",
      "/mcp",
      "/t/acme/planner",
      "/acme/planner",
      // An address from when products were in teams, which the app sends on to the product's.
      "/t/acme/core/planner",
      "/prototypes/grant/app/server.php",
      "/api/v1/p/acme/planner/sources/01ABC/files/notes.json",
    ];
    for (const p of own) {
      const res = await worker.fetch(new Request(`https://app.example.com${p}`), env);
      expect([p, await res.text()]).toEqual([p, p]);
    }
  });

  it("sends the edge key with every request it passes on, and never one a caller sent", async () => {
    const keys: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (r: Request) => (keys.push(r.headers.get("x-whatbuild-edge-key")), new Response("from the service"))));
    const forged = { headers: { "X-WhatBuild-Edge-Key": "a key guessed by a caller" } };
    await worker.fetch(new Request("https://app.example.com/api/v1/meta", forged), { ...env, EDGE_KEY: "the deployment's edge key" });
    await worker.fetch(new Request("https://example.com/api/v1/interest", { method: "POST", body: "{}" }), { ...env, EDGE_KEY: "the deployment's edge key" });
    await worker.fetch(new Request("https://example.com/api/v1/pressed", { method: "POST", body: "{}" }), { ...env, EDGE_KEY: "the deployment's edge key" });
    await worker.fetch(new Request("https://app.example.com/mcp", forged), env);
    expect(keys).toEqual(["the deployment's edge key", "the deployment's edge key", "the deployment's edge key", null]);
  });

  it("passes a live stream on as it arrives, unread and unkept", async () => {
    const encoder = new TextEncoder();
    let send!: (text: string) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        send = (text) => c.enqueue(encoder.encode(text));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } })));
    const answer = await worker.fetch(new Request("https://app.example.com/api/v1/p/acme/planner/live"), env);
    expect(answer.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(answer.headers.get("cache-control")).toBe("no-store, no-transform");
    const reader = answer.body!.getReader();
    send(": listening\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": listening\n\n");
    // The first part arrived with the stream still open: nothing waited for it to end.
    send('event: change\ndata: {"areas":["story"]}\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: change\ndata: {"areas":["story"]}\n\n');
    await reader.cancel();
  });
});
