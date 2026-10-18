import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { json, newId } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENTITY_TYPES } from "../../../packages/core/src/ops/activity.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A product's activity log, filtered: by the kind of object an entry is about, and by who made the
// change (people in the app, agents over MCP). What WhatBuild does by itself is neither.

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let productPath: string;
let tenantId: string;
let productId: string;

interface Entry {
  activity_id: string;
  action: string;
  entity_type: string;
  channel: string | null;
  actor: { account_id: string };
  summary: string;
}

const log = async (query = "") => (await alice.api<{ items: Entry[] }>("GET", `${P}/activity?limit=200${query}`)).body.items;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Log Co" });
  tenantId = t.body.tenant.tenant_id;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Logbook" });
  productPath = p.body.path;
  productId = p.body.product_id;
  P = `/api/v1/p/${productPath}`;
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "logbook", email: "vic@example.com", role: "viewer" })).status).toBe(201);

  // One change to every kind of object a product's log holds entries about.
  expect((await alice.api("POST", `${P}/outcomes`, { title: "Plan the week in ten minutes" })).status).toBe(201);
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: "Sample crew call", tags: ["call"], path: "call.md" });
  expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: "# Call\n\nCrews text the office.\n" })).status).toBe(201);
  await h.worker.drain();
  const a = await alice.api("POST", `${P}/assumptions`, { statement: "Crews read texts before calls." });
  const b = await alice.api("POST", `${P}/assumptions`, { statement: "Crews answer texts within the hour." });
  expect((await alice.api("POST", `${P}/assumptions/${a.body.id}/links`, { expected_etag: a.body.etag, target_id: b.body.id, type: "supports" })).status).toBe(200);
  expect((await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", body: '<main class="page"><h1>Overview</h1></main>' })).status).toBe(201);
  expect((await alice.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: "overview", children: [] }] })).status).toBe(200);
  expect((await alice.api("PUT", `${P}/story/style`, { house_style: "clear" })).status).toBe(200);
  const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Board</title></head><body><h1>Board</h1></body></html>';
  expect((await alice.api("POST", `${P}/mockups`, { title: "Board", pages: [{ page_id: "board", title: "Board", html: page }] })).status).toBe(201);
  // Someone invited to the product joins it by signing in with the address.
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "logbook", email: "newcomer@example.com", role: "viewer" })).status).toBe(201);
  await h.signIn("newcomer@example.com", "Nia Newcomer");
  expect((await alice.api("POST", `${P}/exports`, {})).status).toBe(201);

  // An agent's change, over MCP.
  const client = new Client({ name: "log-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice, "Log agent")}` } } }));
  const viaMcp = await client.callTool({ name: "assumptions", arguments: { action: "create", product: productPath, params: { statement: "Written by an agent" } } });
  expect(viaMcp.isError).toBeFalsy();
  await client.close();
});
afterAll(async () => h?.close());

describe("filtering a product's log by the kind of object", () => {
  it("offers exactly the kinds of object the log holds entries about", async () => {
    const logged = new Set((await log()).map((i) => i.entity_type));
    expect([...logged].sort()).toEqual([...ENTITY_TYPES].sort());
    for (const type of ENTITY_TYPES) {
      const items = await log(`&entity_type=${type}`);
      expect(items.length, type).toBeGreaterThan(0);
      expect(items.every((i) => i.entity_type === type), type).toBe(true);
    }
  });

  it("refuses the kinds that belong to the organization or are never logged", async () => {
    for (const type of ["team", "tenant", "sandbox", "feedback", "annotation"]) {
      const r = await alice.api("GET", `${P}/activity?entity_type=${type}`);
      expect(r.status, type).toBe(422);
    }
  });
});

describe("filtering a product's log by who made the change", () => {
  it("counts as people only what people did, and as agents only what agents did over MCP", async () => {
    const all = await log();
    // WhatBuild reading an attachment is its own work: no channel, and the system account.
    const read = all.filter((i) => i.action === "derived");
    expect(read.length).toBeGreaterThan(0);
    for (const i of read) expect(i).toMatchObject({ channel: null, actor: { account_id: "system" } });

    const people = await log("&by=people");
    expect(people.length).toBeGreaterThan(0);
    expect(new Set(people.map((i) => i.channel))).toEqual(new Set(["web"]));
    expect(people.some((i) => i.action === "derived")).toBe(false);
    const agents = await log("&by=agents");
    expect(agents.map((i) => i.summary)).toContain("Recorded an unconfirmed assumption");
    expect(agents.every((i) => i.channel === "mcp")).toBe(true);
    // Between them, everything but WhatBuild's own work.
    expect(people.length + agents.length).toBe(all.filter((i) => i.channel !== null).length);
  });

  it("counts a change made through the REST API with a personal token, in a log kept from before tokens were removed, as a person's", async () => {
    const activityId = newId();
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      await trx
        .insertInto("activity")
        .values({
          activity_id: activityId, tenant_id: tenantId, team_id: null, product_id: productId,
          actor: json({ account_id: "someone", display_name: "Someone", surface: "rest", client: "curl" }),
          actor_account_id: "someone", channel: "rest", action: "updated", entity_type: "outcome", entity_id: null, entity_title: "Plan the week in ten minutes", summary: "Edited the outcome",
        })
        .execute();
    });
    expect((await log("&by=people")).map((i) => i.activity_id)).toContain(activityId);
    expect((await log("&by=agents")).map((i) => i.activity_id)).not.toContain(activityId);
  });

  it("is read by a viewer as by an admin", async () => {
    const r = await vic.api("GET", `${P}/activity?by=people&entity_type=assumption`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
  });
});

describe("what an entry says", () => {
  it("names a link between assumptions in words", async () => {
    const linked = (await log("&entity_type=assumption")).find((i) => i.action === "linked");
    expect(linked?.summary).toBe("Linked to an assumption it supports");
  });
});
