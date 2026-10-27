import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An agent's connection has a level the person chooses when they approve it: Read only, Edit (the
// default) or Admin. It caps what the person can do and never adds to it, the agent is offered only
// what its level allows, and only the person, signed in to the web app, changes it.

let h: Harness;
let olga: Browser;
let eddie: Browser;
let path: string;

function result(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

async function connect(token: string) {
  const client = new Client({ name: "levels-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

/** Every action the connection is offered, as tool.action. */
async function offered(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.flatMap((t) => {
    const action = t.inputSchema.properties?.["action"] as { enum?: string[] } | undefined;
    return action?.enum ? action.enum.map((a) => `${t.name.replace(/_(read|write|delete)$/, "")}.${a}`) : [t.name];
  });
}

async function newSource(client: Client, title: string) {
  return result(await client.callTool({ name: "sources_write", arguments: { action: "create", product: path, params: { title } } }));
}

beforeAll(async () => {
  h = await startHarness();
  olga = await h.signIn("olga@levels.example", "Olga Levels");
  const t = await olga.api("POST", "/api/v1/tenants", { name: "Levels" });
  path = (await olga.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Ledger" })).body.path;
  await olga.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, email: "eddie@levels.example", role: "editor" });
  eddie = await h.signIn("eddie@levels.example", "Eddie Levels");
});
afterAll(async () => h?.close());

describe("choosing a level", () => {
  it("offers Read only, Edit and Admin on the consent page, with Edit chosen", async () => {
    const reg = await (await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Picker", redirect_uris: ["http://127.0.0.1:9999/cb"] }) })).json() as { client_id: string };
    const page = await fetch(`${h.baseUrl}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/cb")}&code_challenge=x&code_challenge_method=S256`, { headers: { cookie: olga.cookie } });
    const html = await page.text();
    expect(html).toContain('name="level" value="viewer"');
    expect(html).toContain('name="level" value="editor" checked');
    expect(html).toContain('name="level" value="admin"');
    expect(html).toContain("never does more than you can yourself");
  });

  it("refuses a level that isn't one of the three", async () => {
    await expect(h.connectAgent(olga, "Greedy", "/mcp", "owner" as never)).rejects.toThrow();
  });

  it("makes a connection approved without a choice an Edit one", async () => {
    await h.connectAgent(olga, "Unchosen", "/mcp", null);
    const agents = await olga.api("GET", "/api/v1/me/agents");
    expect(agents.body.items.find((a: { client_name: string }) => a.client_name === "Unchosen").level).toBe("editor");
  });
});

describe("what each level may do", () => {
  it("lets Edit write and archive, never offers it a delete, and refuses one it calls anyway", async () => {
    const client = await connect(await h.connectAgent(olga, "Editing agent", "/mcp", "editor"));
    const actions = await offered(client);
    expect(actions).toContain("sources.create");
    expect(actions).toContain("sources.archive");
    for (const a of ["sources.delete", "sources.delete_annotation", "assumptions.delete", "outcomes.delete", "story.delete_page", "mockups.delete", "products.delete", "products.archive", "members.grant"])
      expect(actions, a).not.toContain(a);
    const made = await newSource(client, "Edited by an agent");
    expect(made.status).toBe(200);
    // Olga is an admin, but this connection acts as an editor.
    expect(made.json.scope.your_role).toBe("editor");
    expect(made.json.scope.connection_level).toBe("editor");
    const del = result(await client.callTool({ name: "sources_delete", arguments: { action: "delete", product: path, params: { record_id: made.json.record_id, expected_etag: made.json.etag, reason: "x", confirm: "delete permanently" } } }));
    expect(del.status).toBe(403);
    expect(del.json.error).toMatchObject({ code: "connection_level", details: { level: "editor", needed: "admin" } });
    expect(del.json.error.message).toContain("Connect an agent");
    const list = result(await client.callTool({ name: "products_read", arguments: { action: "list" } }));
    expect(list.json.connection_level).toBe("editor");
    expect(list.json.items[0].your_role).toBe("editor");
    await client.close();
  });

  it("names only the actions the connection is offered when an action is missing or unknown", async () => {
    const levels = ["viewer", "editor", "admin"] as const;
    const clients = await Promise.all(levels.map(async (level) => connect(await h.connectAgent(olga, `Naming agent (${level})`, "/mcp", level))));
    const named: Record<string, Record<string, string[]>> = {};
    for (const [k, client] of clients.entries()) {
      const { tools } = await client.listTools();
      for (const tool of tools.map((t) => t.name).filter((t) => /^(sources|products)_/.test(t))) {
        const listed = (tools.find((t) => t.name === tool)!.inputSchema.properties!["action"] as { enum: string[] }).enum;
        const missing = result(await client.callTool({ name: tool, arguments: { params: {} } }));
        expect(missing.status).toBe(422);
        expect(missing.json.error.details.actions).toEqual(listed);
        expect(missing.json.error.message).toContain(`${tool} needs one of its actions (${listed.join(", ")}),`);
        const unknown = result(await client.callTool({ name: tool, arguments: { action: "explode", product: path, params: {} } }));
        expect(unknown.json.error).toMatchObject({ code: "unknown_action", details: { actions: listed } });
        expect(unknown.json.error.message).toContain(`offers this connection these ${tool} actions: ${listed.join(", ")}.`);
        const noun = tool.slice(0, tool.indexOf("_"));
        (named[levels[k]!] ??= {})[noun] = [...((named[levels[k]!] ??= {})[noun] ?? []), ...listed];
      }
      await client.close();
    }
    // An Edit connection is told of no permanent delete, and of no new organization.
    expect(named["editor"]!["sources"]).toContain("archive");
    for (const a of ["delete", "delete_annotation"]) {
      expect(named["editor"]!["sources"]).not.toContain(a);
      expect(named["admin"]!["sources"]).toContain(a);
    }
    // Olga owns her organization, not this WhatBuild: every organization's plan is not hers to see.
    for (const level of levels) {
      expect(named[level]!["products"]).toEqual(expect.arrayContaining(["list", "limits"]));
      expect(named[level]!["products"]).not.toContain("organizations");
    }
    expect(named["viewer"]!["products"]).not.toContain("create_tenant");
    expect(named["editor"]!["products"]).not.toContain("create_tenant");
    expect(named["admin"]!["products"]).toContain("create_tenant");
  });

  it("lets Read only read and nothing else", async () => {
    const client = await connect(await h.connectAgent(olga, "Reading agent", "/mcp", "viewer"));
    const actions = await offered(client);
    expect(actions).toContain("sources.list");
    expect(actions).toContain("submit_feedback");
    expect(actions).not.toContain("sources.create");
    expect(actions).not.toContain("outcomes.update");
    const refused = await newSource(client, "Should not exist");
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("connection_level");
    expect(result(await client.callTool({ name: "sources_read", arguments: { action: "list", product: path, params: {} } })).status).toBe(200);
    await client.close();
  });

  it("lets Admin delete, and only what the person may delete themselves", async () => {
    const admin = await connect(await h.connectAgent(olga, "Admin agent", "/mcp", "admin"));
    expect(await offered(admin)).toContain("sources.delete");
    const made = await newSource(admin, "Deleted by an agent");
    const impact = result(await admin.callTool({ name: "sources_read", arguments: { action: "delete_impact", product: path, params: { record_id: made.json.record_id } } }));
    const del = result(await admin.callTool({ name: "sources_delete", arguments: { action: "delete", product: path, params: { record_id: made.json.record_id, expected_etag: impact.json.etag, reason: "The person asked", confirm: "delete permanently" } } }));
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    await admin.close();

    // Eddie is an editor: an Admin connection gives him nothing more.
    const his = await connect(await h.connectAgent(eddie, "Eddie's agent", "/mcp", "admin"));
    const mine = await newSource(his, "Eddie's source");
    expect(mine.json.scope.your_role).toBe("editor");
    const refused = result(await his.callTool({ name: "sources_delete", arguments: { action: "delete", product: path, params: { record_id: mine.json.record_id, expected_etag: mine.json.etag, reason: "x", confirm: "delete permanently" } } }));
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("forbidden");
    await his.close();
  });
});

describe("changing a level", () => {
  it("is the person's alone, takes effect on the next call, and carries to every token of the connection", async () => {
    const token = await h.connectAgent(olga, "Raised agent", "/mcp", "editor");
    const client = await connect(token);
    const made = await newSource(client, "Raised later");
    const agent = (await olga.api("GET", "/api/v1/me/agents")).body.items.find((a: { client_name: string }) => a.client_name === "Raised agent");

    // The agent's own token reaches no account route, so it cannot raise itself.
    const self = await fetch(`${h.baseUrl}/api/v1/me/agents/${agent.family_id}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ level: "admin" }) });
    expect(self.status).toBe(401);
    expect((await olga.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { level: "owner" })).status).toBe(422);
    expect((await eddie.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { level: "admin" })).status).toBe(404);

    const raised = await olga.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { level: "admin" });
    expect(raised.status).toBe(200);
    const rows = await h.db.selectFrom("oauth_tokens").select("level").where("family_id", "=", agent.family_id).where("revoked_at", "is", null).execute();
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.level === "admin")).toBe(true);
    const del = result(await client.callTool({ name: "sources_delete", arguments: { action: "delete", product: path, params: { record_id: made.json.record_id, expected_etag: made.json.etag, reason: "Raised to delete", confirm: "delete permanently" } } }));
    expect(del.status, JSON.stringify(del.json)).toBe(200);

    await olga.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { level: "viewer" });
    expect((await newSource(client, "Lowered")).json.error.code).toBe("connection_level");
    await client.close();
  });
});
