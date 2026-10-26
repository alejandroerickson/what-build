import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { EDGE_KEY_HEADER } from "../src/edge-key.ts";
import { startHarness, type Harness } from "./harness.ts";

const KEY = "an-edge-key-of-at-least-32-random-characters";

describe("a deployment with an edge key", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ edgeKey: KEY });
  });
  afterAll(async () => h?.close());

  const send = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) => fetch(`${h.baseUrl}${path}`, { redirect: "manual", ...init, headers });

  it("refuses every request that does not carry the key, before anything else runs", async () => {
    const paths = ["/", "/api/v1/meta", "/auth/methods", "/.well-known/oauth-authorization-server", "/t/acme/core/planner", "/favicon.svg"];
    for (const p of paths) {
      const without: Record<string, string>[] = [{}, { [EDGE_KEY_HEADER]: "not the key" }, { [EDGE_KEY_HEADER]: `${KEY}x` }];
      for (const headers of without) {
        const res = await send(p, headers);
        expect([p, res.status]).toEqual([p, 403]);
        expect(await res.text()).toContain(h.config.publicBaseUrl);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    }
    const mcp = await send("/mcp", { "content-type": "application/json" }, { method: "POST", body: "{}" });
    expect(mcp.status).toBe(403);
  });

  it("serves a request that carries it as it would without a key", async () => {
    const meta = await send("/api/v1/meta", { [EDGE_KEY_HEADER]: KEY });
    expect(meta.status).toBe(200);
    const mcp = await send("/mcp", { [EDGE_KEY_HEADER]: KEY, "content-type": "application/json" }, { method: "POST", body: "{}" });
    expect(mcp.status).toBe(401);
  });

  it("answers the health check without it, for the platform's probes", async () => {
    expect((await send("/health")).status).toBe(200);
  });
});

describe("the edge key's setting", () => {
  it("is off unless set, and refuses a short key at start", () => {
    expect(loadConfig({ NODE_ENV: "test" }).edgeKey).toBeNull();
    expect(loadConfig({ NODE_ENV: "test", WHATBUILD_EDGE_KEY: ` ${KEY} ` }).edgeKey).toBe(KEY);
    expect(() => loadConfig({ NODE_ENV: "test", WHATBUILD_EDGE_KEY: "short" })).toThrow(/WHATBUILD_EDGE_KEY/);
  });
});
