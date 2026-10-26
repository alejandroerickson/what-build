import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createPorts } from "../src/app.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let token: string;
beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice");
  token = await h.connectAgent(alice);
});
afterAll(async () => h?.close());

describe("the service's requests and its worker", () => {
  const listTools = (authorization?: string): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  const watch = () => {
    const seen: string[] = [];
    let label = "";
    const app = createApp({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer), config: h.config, clock: h.clock, onRequest: () => seen.push(label) });
    const send = async (name: string, path: string, init?: RequestInit) => {
      label = name;
      await (await app.fetch(new Request(`${h.baseUrl}${path}`, init))).arrayBuffer();
    };
    return { seen, send };
  };

  it("wake the worker for the API, MCP and sign-in when someone signed in makes them, and not for the app's pages and files", async () => {
    const { seen, send } = watch();
    const cookie = { headers: { cookie: alice.cookie } };
    await send("me, signed in", "/api/v1/me", cookie);
    await send("session, signed in", "/auth/session", cookie);
    await send("tools, with a good token", "/mcp", listTools(`Bearer ${token}`));
    await send("a page, signed in", "/", cookie);
    await send("a file, signed in", "/favicon.svg", cookie);
    await send("health", "/health");
    expect(seen).toEqual(["me, signed in", "session, signed in", "tools, with a good token"]);
  });

  it("never wake it for a request from nobody signed in, so a stranger cannot keep the database awake", async () => {
    const { seen, send } = watch();
    await send("meta", "/api/v1/meta");
    await send("methods", "/auth/methods");
    await send("me, no session", "/api/v1/me");
    await send("me, a session that is no good", "/api/v1/me", { headers: { cookie: "wb_session=not-a-session" } });
    await send("an unknown route", "/api/v1/nothing-here");
    await send("tools, no token", "/mcp", listTools());
    await send("tools, a token that is no good", "/mcp", listTools("Bearer wbat_not-a-token"));
    await send("tools, a session instead of a token", "/mcp", { ...listTools(), headers: { ...(listTools().headers as Record<string, string>), cookie: alice.cookie } });
    expect(seen).toEqual([]);
  });
});
