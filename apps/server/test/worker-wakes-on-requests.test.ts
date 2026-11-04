import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createPorts } from "../src/app.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let token: string;
let acme: string;
let scopedToken: string;
beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice");
  token = await h.connectAgent(alice);
  acme = (await alice.api("POST", "/api/v1/tenants", { name: "Acme" })).body.tenant.slug;
  scopedToken = await h.connectAgent(alice, "scoped-agent", `/mcp/t/${acme}`);
});
afterAll(async () => h?.close());

describe("the service's requests and its worker", () => {
  const rpc = (message: unknown, authorization?: string): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(message),
  });
  const listTools = (authorization?: string) => rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, authorization);
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
  const callTool = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "products_read", arguments: { action: "list" } } };

  const watch = () => {
    const seen: string[] = [];
    let label = "";
    const app = createApp({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer), config: h.config, onRequest: () => seen.push(label) });
    const send = async (name: string, path: string, init?: RequestInit) => {
      label = name;
      await (await app.fetch(new Request(`${h.baseUrl}${path}`, init))).arrayBuffer();
    };
    return { seen, send };
  };

  it("wake the worker for the API, MCP's tool calls and sign-in when someone signed in makes them, and not for the app's pages and files", async () => {
    const { seen, send } = watch();
    const cookie = { headers: { cookie: alice.cookie } };
    await send("me, signed in", "/api/v1/me", cookie);
    await send("session, signed in", "/auth/session", cookie);
    await send("a tool call, with a good token", "/mcp", rpc(callTool, `Bearer ${token}`));
    await send("a page, signed in", "/", cookie);
    await send("a file, signed in", "/favicon.svg", cookie);
    await send("health", "/health");
    expect(seen).toEqual(["me, signed in", "session, signed in", "a tool call, with a good token"]);
  });

  it("never wake it for an MCP request that calls no tool, which a client sends whenever a conversation starts", async () => {
    const { seen, send } = watch();
    const bearer = `Bearer ${token}`;
    await send("initialize", "/mcp", rpc(initialize, bearer));
    await send("initialized", "/mcp", rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, bearer));
    await send("a cancellation", "/mcp", rpc({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } }, bearer));
    await send("tools/list", "/mcp", listTools(bearer));
    await send("ping", "/mcp", rpc({ jsonrpc: "2.0", id: 3, method: "ping" }, bearer));
    expect(seen).toEqual([]);
  });

  it("wake it for a batch that calls a tool among requests that do not", async () => {
    const { seen, send } = watch();
    await send("a batch with a call", "/mcp", rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, callTool], `Bearer ${token}`));
    await send("a batch without", "/mcp", rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }], `Bearer ${token}`));
    expect(seen).toEqual(["a batch with a call"]);
  });

  it("wake it for a tool call that is refused, since its handler ran", async () => {
    const { seen, send } = watch();
    const bearer = `Bearer ${token}`;
    await send("an unknown tool", "/mcp", rpc({ ...callTool, params: { name: "no_such_tool", arguments: {} } }, bearer));
    await send("an unknown action", "/mcp", rpc({ ...callTool, params: { name: "products_read", arguments: { action: "no_such_action" } } }, bearer));
    expect(seen).toEqual(["an unknown tool", "an unknown action"]);
  });

  it("wake it for a tool call on a scoped connector's endpoint, and not for listing its tools", async () => {
    const { seen, send } = watch();
    const bearer = `Bearer ${scopedToken}`;
    await send("initialize, scoped", `/mcp/t/${acme}`, rpc(initialize, bearer));
    await send("tools/list, scoped", `/mcp/t/${acme}`, listTools(bearer));
    await send("a tool call, scoped", `/mcp/t/${acme}`, rpc(callTool, bearer));
    expect(seen).toEqual(["a tool call, scoped"]);
  });

  it("never wake it for a GET or DELETE on the MCP endpoint, which is stateless and refuses them", async () => {
    const { seen, send } = watch();
    const headers = { authorization: `Bearer ${token}`, accept: "text/event-stream" };
    await send("GET", "/mcp", { method: "GET", headers });
    await send("DELETE", "/mcp", { method: "DELETE", headers });
    expect(seen).toEqual([]);
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
    await send("a tool call, no token", "/mcp", rpc(callTool));
    await send("a tool call, a token that is no good", "/mcp", rpc(callTool, "Bearer wbat_not-a-token"));
    await send("a tool call, a token for another endpoint", "/mcp", rpc(callTool, `Bearer ${scopedToken}`));
    await send("tools, a session instead of a token", "/mcp", { ...listTools(), headers: { ...(listTools().headers as Record<string, string>), cookie: alice.cookie } });
    expect(seen).toEqual([]);
  });
});
