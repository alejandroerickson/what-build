import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createPorts } from "../src/app.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe("the service's requests and its worker", () => {
  it("wake the worker for the API, MCP and sign-in, and not for the app's pages and files", async () => {
    const seen: string[] = [];
    let path = "";
    const app = createApp({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer), config: h.config, onRequest: () => seen.push(path) });
    const get = async (p: string, init?: RequestInit) => {
      path = p;
      await (await app.fetch(new Request(`${h.baseUrl}${p}`, init))).arrayBuffer();
    };
    for (const p of ["/api/v1/meta", "/auth/methods", "/", "/favicon.svg", "/t/acme/core/planner", "/health"]) await get(p);
    await get("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(seen).toEqual(["/api/v1/meta", "/auth/methods", "/mcp"]);
  });
});
