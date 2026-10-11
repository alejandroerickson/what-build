import { createHmac } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { clientFamily, personOf, pruneUsage, usageSettled } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loggedPath } from "../src/app.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let owner: Browser;
let ana: Browser;
let path: string;
let agent: Client;

async function connect(token: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

const report = async (b: Browser, query = "") => {
  await usageSettled();
  return b.api("GET", `/api/v1/usage${query}`);
};

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["owen@example.com"], analyticsId: "G-TEST123" });
  owner = await h.signIn("owen@example.com", "Owen Owner");
  ana = await h.signIn("ana@example.com", "Ana Planner");
  const t = await ana.api("POST", "/api/v1/tenants", { name: "Quillon Works" });
  const p = await ana.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Harbor Plan" });
  path = p.body.path;
  // The name a client registers with is its own, and often carries the person's label for the connection.
  agent = await connect(await h.connectAgent(ana, "Claude Code (quillon-private-label)"));
});
afterAll(async () => {
  await agent?.close();
  await h?.close();
});

describe("counting calls", () => {
  it("counts every call by operation, door, agent client and outcome, and names nobody", async () => {
    const listed = await ana.api("GET", "/api/v1/me/products");
    expect(listed.headers.get("X-WhatBuild-Operation")).toBe("products.list");
    expect((await ana.api("PATCH", `/api/v1/p/${path}`, { colour: "red" })).status).toBe(422);
    await agent.callTool({ name: "products", arguments: { action: "list" } });
    expect((await agent.callTool({ name: "products", arguments: { action: "explode" } })).isError).toBe(true);
    expect((await agent.callTool({ name: "sources", arguments: { action: "list", product: "no-such/team/product" } })).isError).toBe(true);
    await usageSettled();

    const calls = await h.db.selectFrom("usage_calls").selectAll().execute();
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "products.list", surface: "web", client: "", outcome: "ok", owner: false, sandbox: false }),
        expect.objectContaining({ operation: "products.list", surface: "mcp", client: "Claude Code", outcome: "ok" }),
        expect.objectContaining({ operation: "products.update", surface: "web", outcome: "invalid_input" }),
        expect.objectContaining({ operation: "products.(unknown)", surface: "mcp", outcome: "unknown_action" }),
        // Refused before it reached the operation: the product is not there.
        expect.objectContaining({ operation: "sources.list", surface: "mcp", outcome: "not_found" }),
      ]),
    );

    const people = await h.db.selectFrom("usage_people").selectAll().execute();
    const account = await h.db.selectFrom("accounts").select("account_id").where("email", "=", "ana@example.com").executeTakeFirstOrThrow();
    const key = createHmac("sha256", h.config.grantKey).update("whatbuild usage people").digest("base64url");
    expect(people.filter((p) => p.person === personOf(key, account.account_id)).map((p) => `${p.feature} ${p.surface}`)).toEqual(expect.arrayContaining(["products web", "products mcp"]));
    // Nothing kept says who, or where: no account, address, name, organization, product or connection label.
    const kept = JSON.stringify([calls, people]);
    for (const told of [account.account_id, "ana@example.com", "Ana Planner", "Quillon", "quillon", "Harbor", ...path.split("/")]) expect(kept).not.toContain(told);
  });

  it("knows agent clients by family only", () => {
    const mcp = (client: string) => clientFamily({ surface: "mcp", client });
    expect(mcp("Claude Code (my connection)")).toBe("Claude Code");
    expect(mcp("Claude")).toBe("Claude");
    expect(mcp("Cursor")).toBe("Cursor");
    expect(mcp("Visual Studio Code")).toBe("VS Code");
    expect(mcp("Dana's helper bot")).toBe("other");
    expect(clientFamily({ surface: "web", client: null })).toBe("");
  });

  it("names organizations, teams and products in request logs only by kind", () => {
    expect(loggedPath("/api/v1/p/acme/core/planner/assumptions/01HX0000000000000000000000/review")).toBe("/api/v1/p/:org/:team/:product/assumptions/:id/review");
    expect(loggedPath("/api/v1/teams/acme/core/products")).toBe("/api/v1/teams/:org/:team/products");
    expect(loggedPath("/api/v1/tenants/acme/members")).toBe("/api/v1/tenants/:org/members");
    expect(loggedPath("/api/v1/tenants")).toBe("/api/v1/tenants");
    expect(loggedPath("/mcp/t/acme/core/planner")).toBe("/mcp/t/:org/:team/:product");
    expect(loggedPath("/mcp/t/acme")).toBe("/mcp/t/:org");
    expect(loggedPath("/.well-known/oauth-protected-resource/mcp/t/acme/core/planner")).toBe("/.well-known/oauth-protected-resource/mcp/t/:org/:team/:product");
    expect(loggedPath("/t/acme/core/planner/story/01HX0000000000000000000000")).toBe("/t/:org/:team/:product/story/:id");
    expect(loggedPath("/t/acme/members")).toBe("/t/:org/members");
    expect(loggedPath("/invite/secret-token")).toBe("/invite/:token");
    expect(loggedPath("/api/v1/me/products")).toBe("/api/v1/me/products");
    // The OAuth and OpenID metadata clients ask for beside a scoped connector, and a product's path typed without /t/.
    expect(loggedPath("/.well-known/oauth-authorization-server/mcp/t/acme/core/planner")).toBe("/.well-known/oauth-authorization-server/mcp/t/:org/:team/:product");
    expect(loggedPath("/.well-known/openid-configuration/mcp/t/acme")).toBe("/.well-known/openid-configuration/mcp/t/:org");
    expect(loggedPath("/acme/core/planner/story")).toBe("/:org/:team/:product/story");
    expect(loggedPath("/assets/index-abc/x.js")).toBe("/assets/index-abc/x.js");
    expect(loggedPath("/api/v1/sandbox/reset-if-due")).toBe("/api/v1/sandbox/reset-if-due");
  });
});

describe("a deployment without the key people are counted under", () => {
  it("counts calls and no people", async () => {
    const { countCall } = await import("@whatbuild/core");
    const before = (await h.db.selectFrom("usage_people").select("person").execute()).length;
    const principal = { account_id: "acct-without-key", email: "nokey@example.com", display_name: "No Key", auth_kind: "session" as const, surface: "web" as const, client: null };
    countCall({ db: h.db, ports: { config: { instanceOwners: [] } } as never }, principal, { operation: "outcomes.list", feature: "outcomes", outcome: "ok", sandbox: false });
    await usageSettled();
    expect((await h.db.selectFrom("usage_people").select("person").execute()).length).toBe(before);
    expect(await h.db.selectFrom("usage_calls").select("calls").where("operation", "=", "outcomes.list").where("surface", "=", "web").execute()).not.toEqual([]);
  });
});

describe("the usage report", () => {
  it("is the instance owners' alone", async () => {
    const refused = await report(ana);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("forbidden");
    expect((await report(owner)).status).toBe(200);
  });

  it("leaves the instance's owners out unless asked", async () => {
    await owner.api("GET", "/api/v1/me/products");
    const without = (await report(owner)).body;
    expect(without.owners).toBe("excluded");
    expect(without.people.active).toBe(1);
    const usage = (r: { operations: { operation: string }[] }) => r.operations.find((o) => o.operation === "products.usage");
    // Only Ana's refused try; the owner's own reads are left out.
    expect(usage(without)).toMatchObject({ calls: 1, failed: 1 });
    const withOwners = (await report(owner, "?include_owners=true")).body;
    expect(withOwners.people.active).toBe(2);
    expect(usage(withOwners)).toMatchObject({ calls: expect.toSatisfy((n: number) => n > 1), failed: 1 });
  });

  it("reports operations, features, clients, failures and what nobody called", async () => {
    const r = (await report(owner)).body;
    expect(r.calls).toMatchObject({ web: expect.any(Number), agents: expect.any(Number) });
    expect(r.calls.failed).toBeGreaterThanOrEqual(2);
    expect(r.operations.find((o: { operation: string }) => o.operation === "products.list")).toMatchObject({ web: expect.any(Number), agents: expect.any(Number) });
    expect(r.features.find((f: { feature: string }) => f.feature === "products")).toMatchObject({ people: 1, web_people: 1, agent_people: 1 });
    expect(r.clients).toEqual([expect.objectContaining({ client: "Claude Code", people: 1 })]);
    expect(r.failures).toEqual(expect.arrayContaining([{ operation: "products.update", outcome: "invalid_input", calls: 1 }, { operation: "products.(unknown)", outcome: "unknown_action", calls: 1 }]));
    expect(r.not_called).toContain("mockups.restore");
    expect(r.not_called).not.toContain("products.list");
    expect(r.counting_since.calls).toBe(new Date().toISOString().slice(0, 10));
  });

  it("says how many came back, and when, without saying who", async () => {
    const day = (n: number) => sql<string>`((now() at time zone 'utc')::date - ${n}::int)`;
    const row = (person: string, n: number) =>
      sql`insert into usage_people (day, person, feature, surface, client, sandbox, owner) values (${day(n)}, ${person}, 'sources', 'mcp', 'Claude', false, false)`.execute(h.db);
    // One person first seen three weeks ago and back today; one first seen yesterday and back today;
    // one first seen two weeks ago who never came back.
    for (const [person, n] of [["back-later", 21], ["back-later", 0], ["new-twice", 1], ["new-twice", 0], ["gone-quiet", 14]] as const) await row(person, n);

    const week = (await report(owner, "?days=7")).body.people;
    // Ana, counted today for the first time, is new too.
    expect(week).toMatchObject({ active: 3, new: 2, returning: 1, days_active: { "1": 2, "2-3": 1, "4-7": 0, "8+": 0 } });

    const month = (await report(owner, "?days=28")).body.people;
    const thisWeek = month.weeks.at(-1);
    expect(thisWeek).toMatchObject({ active: 3, returning: thisWeek.active - thisWeek.new });
    // The newcomer from three weeks ago, followed through the weeks after: back in the third.
    const cohort = month.cohorts.find((c: { people: number; weeks_after: number[] }) => c.weeks_after.length === 3);
    expect(cohort).toMatchObject({ people: 1, weeks_after: [0, 0, 1] });
    // Nobody back is a row of zeros up to this week, not an empty row.
    expect(month.cohorts.find((c: { weeks_after: number[] }) => c.weeks_after.length === 2)).toMatchObject({ people: 1, weeks_after: [0, 0] });
  });

  it("can leave the public sandbox out, or count only it", async () => {
    await sql`insert into usage_people (day, person, feature, surface, client, sandbox, owner) values ((now() at time zone 'utc')::date, 'sandbox-visitor', 'story', 'web', '', true, false)`.execute(h.db);
    const all = (await report(owner, "?days=1")).body.people.active;
    expect((await report(owner, "?days=1&sandbox=exclude")).body.people.active).toBe(all - 1);
    expect((await report(owner, "?days=1&sandbox=only")).body.people.active).toBe(1);
  });

  it("keeps a person's days for 14 months, and the counts of calls", async () => {
    await sql`insert into usage_people (day, person, feature, surface, client, sandbox, owner) values ((now() at time zone 'utc')::date - interval '15 months', 'long-gone', 'sources', 'web', '', false, false)`.execute(h.db);
    await sql`insert into usage_calls (day, operation, surface, client, sandbox, owner, outcome) values ((now() at time zone 'utc')::date - interval '15 months', 'sources.list', 'web', '', false, false, 'ok')`.execute(h.db);
    await pruneUsage(h.db);
    expect(await h.db.selectFrom("usage_people").select("person").where("person", "=", "long-gone").execute()).toEqual([]);
    expect(await h.db.selectFrom("usage_people").select("person").where("person", "=", "back-later").execute()).toHaveLength(2);
    expect((await sql<{ n: number }>`select count(*)::int as n from usage_calls where day < (now() at time zone 'utc')::date - interval '14 months'`.execute(h.db)).rows[0]!.n).toBe(1);
  });
});

describe("Google Analytics in the app", () => {
  const methods = async (headers: Record<string, string> = {}) => ((await (await fetch(`${h.baseUrl}/auth/methods`, { headers })).json()) as { analytics_id: string | null }).analytics_id;

  it("measures on the deployment's own address, for everyone but its owners", async () => {
    expect(await methods()).toBe("G-TEST123");
    expect(await methods({ cookie: ana.cookie })).toBe("G-TEST123");
    expect(await methods({ cookie: owner.cookie })).toBeNull();
    // Another name for the same service, such as Cloud Run's run.app address.
    expect(await methods({ "x-forwarded-host": "whatbuild-123.a.run.app" })).toBeNull();
  });
});
