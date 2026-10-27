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
      "/.well-known/oauth-protected-resource/mcp/t/acme/core/planner",
      "/favicon.svg",
      "/theme-boot.js",
      "/robots.txt",
      "/api/v1/meta",
      "/mcp",
      "/t/acme/core/planner",
      "/acme/core/planner",
      "/prototypes/grant/app/server.php",
      "/api/v1/p/acme/core/planner/sources/01ABC/files/notes.json",
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
    await worker.fetch(new Request("https://app.example.com/mcp", forged), env);
    expect(keys).toEqual(["the deployment's edge key", "the deployment's edge key", null]);
  });
});
