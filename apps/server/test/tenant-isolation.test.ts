import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OPERATIONS, type OperationDef } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restPath } from "../src/rest.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// Cross-tenant isolation for every operation in the registry. Someone who owns an organization of
// their own calls each operation through both front doors, twice: once addressed to another
// organization's product, team or tenant with that organization's real ids, and once inside their
// own organization with those ids. Every operation must be classified below, so a new one is
// covered as soon as it is registered. access.test.ts covers a caller with no organization and
// made-up ids; this file covers a member of another organization holding real ones.

/** The other organization's real objects, as the attacker would name them. */
type Input = Record<string, unknown>;

interface Probe {
  /** The call aimed at the victim's objects. Path parameters are fields of the input. */
  input: (a: Organization) => Input;
  /**
   * The same attack made from inside the attacker's own organization, where they are owner: their
   * own objects pointed at the victim's. Defaults to `input`. Called before each call, so it can
   * read the current etag of the attacker's own object.
   */
  inside?: (a: Organization, b: Organization) => Input[] | Promise<Input[]>;
}

/** The current etag of one of the attacker's own objects, under their product's routes. */
async function etagOf(o: Organization, path: string): Promise<string> {
  return (await o.owner.api("GET", `/api/v1/p/${o.product.path}/${path}`)).body.etag;
}

/** Every product, team and tenant operation, with an attack on real ids. */
const SCOPED: Record<string, Probe> = {
  "products.create_team": { input: () => ({ name: "Planted team" }) },
  "products.create": { input: () => ({ name: "Planted product" }) },
  "products.get": { input: () => ({}) },
  "products.update": { input: (a) => ({ expected_etag: a.product.etag, name: "Renamed by an outsider" }) },
  "products.update_concept": { input: (a) => ({ expected_etag: a.product.etag, concept: "Rewritten by an outsider" }) },
  "products.archive": { input: (a) => ({ expected_etag: a.product.etag }) },
  "products.restore": { input: (a) => ({ expected_etag: a.product.etag }) },
  "products.delete_impact": { input: () => ({}) },
  "products.delete": { input: (a) => ({ expected_etag: a.product.etag, name: a.marker, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "products.delete_tenant_impact": { input: () => ({}) },
  "products.delete_tenant": { input: (a) => ({ name: a.marker, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "products.export": { input: () => ({}) },
  "products.exports": { input: () => ({}) },
  "members.list": { input: (a) => ({ product: a.product.id }) },
  "members.grant": {
    input: (a) => ({ team: a.team.id, email: "planted@example.com", role: "admin" }),
    inside: (a) => [
      { team: a.team.id, email: "planted@example.com", role: "admin" },
      { product: a.product.id, email: "planted@example.com", role: "admin" },
    ],
  },
  "members.revoke": {
    input: (a) => ({ account_id: a.member.accountId, team: a.team.id }),
    inside: (a) => [{ account_id: a.member.accountId, team: a.team.id }, { account_id: a.ownerAccountId, whole_tenant: true }],
  },
  "members.cancel_invitation": { input: (a) => ({ invitation_id: a.invitationId }) },
  "members.activity": { input: () => ({}) },
  "products.limits": { input: () => ({}) },
  "outcomes.list": { input: () => ({}) },
  "outcomes.get": { input: (a) => ({ outcome_id: a.outcome.id }) },
  "outcomes.create": { input: () => ({ title: "Planted outcome" }) },
  "outcomes.update": { input: (a) => ({ outcome_id: a.outcome.id, expected_etag: a.outcome.etag, title: "Changed by an outsider" }) },
  "outcomes.archive": { input: (a) => ({ outcome_id: a.outcome.id, expected_etag: a.outcome.etag }) },
  "outcomes.restore": { input: (a) => ({ outcome_id: a.outcome.id, expected_etag: a.outcome.etag }) },
  "outcomes.delete_impact": { input: (a) => ({ outcome_id: a.outcome.id }) },
  "outcomes.delete": { input: (a) => ({ outcome_id: a.outcome.id, expected_etag: a.outcome.etag, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "outcomes.revisions": { input: (a) => ({ outcome_id: a.outcome.id }) },
  "outcomes.get_revision": { input: (a) => ({ outcome_id: a.outcome.id, n: 1 }) },
  "outcomes.restore_revision": { input: (a) => ({ outcome_id: a.outcome.id, n: 1, expected_etag: a.outcome.etag }) },
  "outcomes.card_guidance": { input: () => ({}) },
  "outcomes.card_preview": { input: () => ({ card_html: "<p class=\"wb-pitch\">Planted.</p>" }) },
  "sources.facets": { input: () => ({ include_archived: true }) },
  "sources.list": {
    input: () => ({ include_archived: true }),
    // Their own product's list, filtered by the victim's tag, by the person who added the victim's sources, and by their title.
    inside: (a) => [{ include_archived: true }, { tags: [a.source.tag] }, { added_by: a.ownerAccountId, include_archived: true }, { query: a.marker }],
  },
  "sources.get": { input: (a) => ({ record_id: a.source.id, detail: "full" }) },
  "sources.create": { input: () => ({ title: "Planted source", tags: ["planted"] }) },
  "sources.update": { input: (a) => ({ record_id: a.source.id, expected_etag: a.source.etag, title: "Changed by an outsider" }) },
  "sources.archive": { input: (a) => ({ record_ids: [a.source.id] }) },
  "sources.restore": { input: (a) => ({ record_ids: [a.source.id] }) },
  "sources.annotate": { input: (a) => ({ record_id: a.source.id, note: "Planted annotation" }) },
  "sources.list_annotations": { input: (a) => ({ record_id: a.source.id, include_archived: true }) },
  "sources.update_annotation": { input: (a) => ({ annotation_id: a.annotation.id, expected_etag: a.annotation.etag, note: "Changed by an outsider" }) },
  "sources.delete_annotation": { input: (a) => ({ annotation_id: a.annotation.id, expected_etag: a.annotation.etag, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "sources.move_to_product": {
    input: (a) => ({ record_id: a.source.id, to_product: a.annex.id, expected_etag: a.source.etag }),
    // Their own source, moved into the victim's product.
    inside: async (a, b) => [
      { record_id: b.source.id, to_product: a.product.id, expected_etag: await etagOf(b, `sources/${b.source.id}`) },
      { record_id: b.source.id, to_product: a.product.slug, expected_etag: await etagOf(b, `sources/${b.source.id}`) },
    ],
  },
  "sources.copy_to_product": {
    input: (a) => ({ record_id: a.source.id, to_product: a.annex.id }),
    inside: (a, b) => [{ record_id: b.source.id, to_product: a.product.id }, { record_id: a.source.id, to_product: b.annex.id }],
  },
  "sources.delete_impact": { input: (a) => ({ record_id: a.source.id }) },
  "sources.delete": { input: (a) => ({ record_id: a.source.id, expected_etag: a.source.etag, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "attachments.request_upload": { input: (a) => ({ record_id: a.source.id, path: "planted.md" }) },
  "attachments.create_upload": { input: () => ({ title: "Planted upload", path: "planted.md" }) },
  "attachments.create_uploads": { input: () => ({ sources: [{ title: "Planted upload", path: "planted.md" }] }) },
  "attachments.complete_upload": { input: (a) => ({ record_id: a.source.id, path: a.source.path }) },
  // A public address only; the call must be refused long before anything is fetched.
  "attachments.fetch_url": { input: (a) => ({ record_id: a.source.id, url: "https://example.com/planted.html" }) },
  "attachments.get_download": {
    input: (a) => ({ record_id: a.source.id, path: a.source.path, file_version_id: a.source.fileVersionId }),
    inside: (a, b) => [
      { record_id: a.source.id, path: a.source.path, file_version_id: a.source.fileVersionId },
      // Their own source and path, with the victim's file version.
      { record_id: b.source.id, path: b.source.path, file_version_id: a.source.fileVersionId },
    ],
  },
  "derived.manifest": {
    input: (a) => ({ record_id: a.source.id, derivation_id: a.source.derivationId }),
    inside: (a, b) => [{ record_id: a.source.id }, { record_id: b.source.id, derivation_id: a.source.derivationId }],
  },
  "derived.text": {
    input: (a) => ({ record_id: a.source.id }),
    inside: (a, b) => [{ record_id: a.source.id }, { record_id: b.source.id, derivation_id: a.source.derivationId }, { record_id: a.source.id, path: a.source.path }],
  },
  // With the victim's real etags, so a probe would be let through if isolation failed.
  "derived.write_text": {
    input: (a) => ({ record_id: a.source.id, content: "Planted text.", expected_etag: a.source.textEtag }),
    inside: (a) => [
      { record_id: a.source.id, content: "Planted text.", expected_etag: a.source.textEtag },
      { record_id: a.source.id, edits: [{ old_text: a.marker, new_text: "Planted" }], expected_etag: a.source.textEtag },
      { record_id: a.source.id, from_attachment: a.source.path, expected_etag: a.source.textEtag },
    ],
  },
  "derived.list": { input: (a) => ({ record_id: a.source.id }) },
  "derived.rederive": { input: (a) => ({ record_id: a.source.id }) },
  "derived.write_note": {
    input: (a) => ({ record_id: a.source.id, note_kind: "summary", content: "Planted summary.", expected_etag: a.source.summaryEtag }),
    inside: (a) => [
      { record_id: a.source.id, note_kind: "summary", content: "Planted summary.", expected_etag: a.source.summaryEtag },
      { record_id: a.source.id, note_kind: "notes", content: "Planted notes." },
    ],
  },
  "derived.read_note": { input: (a) => ({ record_id: a.source.id, note_kind: "summary" }) },
  search: {
    input: () => ({ query: "crews", scope: "all" }),
    inside: (a) => [{ query: "crews", scope: "all" }, { query: "crews", record_id: a.source.id }],
  },
  "assumptions.list": { input: (a) => ({ outcome_id: a.outcome.id, include_archived: true }) },
  "assumptions.get": { input: (a) => ({ id: a.assumption.id }) },
  "assumptions.create": {
    input: () => ({ statement: "Planted assumption." }),
    inside: (a) => [
      { statement: "Planted assumption.", outcome_ids: [a.outcome.id] },
      { statement: "Planted assumption.", links: [{ id: a.assumption.id, type: "supports" }] },
    ],
  },
  "assumptions.update": {
    input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, statement: "Changed by an outsider." }),
    inside: async (a, b) => [
      { id: a.assumption.id, expected_etag: a.assumption.etag, statement: "Changed by an outsider." },
      { id: b.assumption.id, expected_etag: await etagOf(b, `assumptions/${b.assumption.id}`), outcome_ids: [a.outcome.id] },
      { id: b.assumption.id, expected_etag: await etagOf(b, `assumptions/${b.assumption.id}`), links: [{ id: a.assumption.id, type: "supports" }] },
    ],
  },
  "assumptions.review": { input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, status: "refuted", note: "Refuted by an outsider." }) },
  "assumptions.supersede": { input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, note: "Superseded by an outsider.", statement: "Planted replacement." }) },
  "assumptions.link": {
    input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, target_id: a.linked.id, type: "contradicts" }),
    // Their own assumption, linked to the victim's.
    inside: async (a, b) => [{ id: b.assumption.id, expected_etag: await etagOf(b, `assumptions/${b.assumption.id}`), target_id: a.assumption.id, type: "contradicts" }],
  },
  "assumptions.unlink": { input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, target_id: a.linked.id, type: "supports" }) },
  "assumptions.archive": { input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, archived: true }) },
  "assumptions.delete_impact": { input: (a) => ({ id: a.assumption.id }) },
  "assumptions.delete": { input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "story.guidance": { input: () => ({}) },
  "story.get_style": { input: () => ({ include_stylesheet: true }) },
  "story.set_style": { input: (a) => ({ house_style: "clear", expected_etag: a.styleEtag }) },
  "story.list_pages": { input: () => ({ include_archived: true }) },
  "story.get_page": { input: (a) => ({ page_id: a.page.id }) },
  "story.list_versions": { input: (a) => ({ page_id: a.page.id }) },
  "story.get_version": { input: (a) => ({ page_id: a.page.id, version: 1 }) },
  "story.publish": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag, title: "Changed by an outsider", body: "<p>Planted.</p>" }) },
  "story.preview": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag, title: "Previewed by an outsider", body: "<p>Planted.</p>" }) },
  "story.promote_mockup": { input: (a) => ({ mockup_id: a.mockup.id, mockup_page_id: a.mockup.pageId, title: "Promoted by an outsider" }) },
  "story.write_notes": { input: (a) => ({ page_id: a.page.id, notes: "Planted notes.", expected_etag: a.page.notesEtag }) },
  "story.print_view": { input: (a) => ({ page_ids: [a.page.id, a.promotedPage.id] }) },
  "story.get_hierarchy": { input: () => ({}) },
  "story.set_hierarchy": {
    input: (a) => ({ items: [{ page_id: a.page.id, children: [] }], expected_etag: a.hierarchyEtag }),
    // Their own navigation, with its current etag, naming the victim's page in the tree and the victim's promoted page among the Published mockups.
    inside: async (a, b) => [
      { items: [{ page_id: a.page.id, children: [] }], expected_etag: await etagOf(b, "story/hierarchy") },
      { items: [], mockups: [a.promotedPage.id], expected_etag: await etagOf(b, "story/hierarchy") },
    ],
  },
  "story.archive_page": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag }) },
  "story.restore_page": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag }) },
  "story.delete_page_impact": { input: (a) => ({ page_id: a.page.id }) },
  "story.delete_page": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "mockups.list": { input: () => ({ include_archived: true }) },
  "mockups.get": { input: (a) => ({ mockup_id: a.mockup.id, include_html: true, include_files: true }) },
  "mockups.list_versions": { input: (a) => ({ mockup_id: a.mockup.id }) },
  "mockups.get_version": { input: (a) => ({ mockup_id: a.mockup.id, version: 1, include_html: true, include_files: true }) },
  "mockups.publish": { input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag, title: "Changed by an outsider" }) },
  "mockups.request_upload": { input: () => ({}) },
  "mockups.archive": { input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag }) },
  "mockups.restore": { input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag }) },
  "mockups.get_download": { input: (a) => ({ mockup_id: a.mockup.id }) },
  "mockups.delete_impact": { input: (a) => ({ mockup_id: a.mockup.id }) },
  "mockups.delete": { input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag, reason: "Removed by an outsider", confirm: "delete permanently" }) },
  "activity.list": { input: (a) => ({ entity_id: a.source.id }) },
};

/** Writes that act on each of a list of objects, and report the ones they could not act on. */
const BATCH = new Set(["sources.archive", "sources.restore"]);

/** Operations that belong to no organization: each has its own assertion. */
const ACCOUNT: Record<string, string> = {
  "products.list": "lists only what the caller can reach",
  "products.create_tenant": "creates an organization of the caller's own",
  "products.tenant_allowances": "the instance owners' alone: 403 to anyone else",
  "products.set_tenant_allowance": "the instance owners' alone: 403 to anyone else",
  "products.remove_tenant_allowance": "the instance owners' alone: 403 to anyone else",
  "products.usage": "the instance owners' alone: 403 to anyone else, and names no organization",
  "products.organizations": "the instance owners' alone: 403 to anyone else",
  "products.set_limits": "the instance owners' alone: 403 to anyone else",
  "products.accounts": "the instance owners' alone: 403 to anyone else",
  "products.remove_account": "the instance owners' alone, in the web app: 403 to anyone else",
  get_skill: "the same document for everyone",
  submit_feedback: "write-only: says nothing back about anyone",
};

let h: Harness;
let a: Organization; // the victim, on the free plan, so its limits are its own
let b: Organization; // the attacker's own organization
let mallory: Browser;
let token: string;

/** Everything the victim's organization holds, row by row, so the end can show nothing changed. */
async function holdings(o: Organization): Promise<string> {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${o.tenant.id}, true)`.execute(trx);
    const tables = await sql<{ name: string }>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
      where n.nspname = current_schema() and c.relkind = 'r' and a.attname = 'tenant_id' and not a.attisdropped order by 1`.execute(trx);
    const parts: string[] = [];
    for (const { name } of tables.rows) {
      const rows = await sql<{ row: string }>`select to_jsonb(t)::text as row from ${sql.table(name)} t where tenant_id = ${o.tenant.id} order by 1`.execute(trx);
      parts.push(`${name}: ${rows.rows.map((r) => r.row).join("\n")}`);
    }
    return parts.join("\n");
  });
}

/** The victim's secrets that appear in a response, leaving out what the caller sent. */
function leaked(org: Organization, body: unknown, sent: string): string[] {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return org.secrets.filter((s) => text.includes(s) && !sent.includes(s));
}

/** Where a call lands in an organization: its product, its team or its tenant. */
function address(o: Organization) {
  const [tenant, team, product] = o.product.path.split("/") as [string, string, string];
  return { tenant, team, product, path: o.product.path };
}

async function rest(op: OperationDef, o: Organization, input: Input) {
  const at = address(o);
  const fields = { ...input };
  const path = restPath(op).replace(/:([a-z_]+)/g, (_m, name: string) => {
    if (name === "tenant" || name === "team" || name === "product") return encodeURIComponent(at[name]);
    const v = fields[name];
    delete fields[name];
    return encodeURIComponent(String(v));
  });
  if (op.rest.method === "GET") {
    const q = new URLSearchParams(Object.entries(fields).map(([k, v]): [string, string] => [k, Array.isArray(v) ? v.join(",") : String(v)]));
    const query = q.toString();
    return { ...(await mallory.api("GET", query ? `${path}?${query}` : path)), sent: `${path} ${query}` };
  }
  return { ...(await mallory.api(op.rest.method, path, fields)), sent: `${path} ${JSON.stringify(fields)}` };
}

let client: Client;
async function mcp(op: OperationDef, o: Organization, input: Input) {
  const at = address(o);
  const params: Input = { ...input };
  let args: Input;
  if (op.scope === "tenant" || op.scope === "team") {
    params["tenant"] = at.tenant;
    if (op.scope === "team") params["team"] = at.team;
  }
  if (op.mcp.action) args = { action: op.mcp.action, params, ...(op.scope === "product" ? { product: at.path } : {}) };
  else args = { ...params, ...(op.scope === "product" ? { product: at.path } : {}) };
  const r = (await client.callTool({ name: op.mcp.tool, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content[0]!.text;
  const status = r.isError ? Number(text.slice(0, 3)) : 200;
  const body = r.isError ? JSON.parse(text.slice(text.indexOf("\n") + 1)) : JSON.parse(text);
  return { status, body, sent: JSON.stringify(args) };
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["root@example.com"] });
  const alice = await h.signIn("alice@northwind.example", "Alice Northwind");
  a = await buildOrganization(h, alice, "Northwind Vault", "NORTHWIND7");
  mallory = await h.signIn("mallory@quillon.example", "Mallory Quillon");
  b = await buildOrganization(h, mallory, "Quillon Works", "QUILLON5");

  // The victim's organization is on the free plan, with limits an instance owner changed and a day's counts.
  await h.db.updateTable("tenants").set({ plan: "free", limits: JSON.stringify({ writes_per_day: 777 }), limits_etag: "NORTHWIND7-limits" }).where("tenant_id", "=", a.tenant.id).execute();
  expect((await alice.api("POST", `/api/v1/p/${a.product.path}/outcomes`, { title: "Counted against NORTHWIND7's day" })).status).toBe(201);
  a.secrets.push("NORTHWIND7-limits");

  token = await h.connectAgent(mallory, "Quillon agent");
  client = new Client({ name: "quillon-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
}, 120_000);
afterAll(async () => {
  await client?.close();
  await h?.close();
});

describe("every operation is classified", () => {
  it("names each registered operation once: scoped with a probe, or account-level with its own assertion", () => {
    const names = OPERATIONS.map((o) => o.name).sort();
    expect([...Object.keys(SCOPED), ...Object.keys(ACCOUNT)].sort()).toEqual(names);
    for (const op of OPERATIONS) expect(op.name in ACCOUNT, `${op.name} is ${op.scope}-scoped`).toBe(op.scope === "account");
  });
});

describe("another organization's product, team or tenant, with its real ids", () => {
  it("answers 404, and nothing of it, to every scoped operation over REST and MCP, and changes nothing", async () => {
    const before = await holdings(a);
    const failures: string[] = [];
    for (const op of OPERATIONS.filter((o) => o.name in SCOPED)) {
      const input = SCOPED[op.name]!.input(a);
      for (const [door, call] of [["REST", rest], ["MCP", mcp]] as const) {
        const r = await call(op, a, input);
        const leaks = leaked(a, r.body, r.sent);
        // What only a person does in the web app is not there at all for an agent.
        const expected = door === "MCP" && op.webOnly ? "unknown_action" : "not_found";
        if ((expected === "not_found" && r.status !== 404) || r.body?.error?.code !== expected || leaks.length)
          failures.push(`${door} ${op.name} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}${leaks.length ? ` LEAKED ${leaks.join(", ")}` : ""}`);
      }
    }
    expect(failures).toEqual([]);
    expect(await holdings(a)).toBe(before);
  });
});

describe("the attacker's own organization, pointed at another's ids", () => {
  it("never returns, reaches or changes the other organization's objects, over REST and MCP", async () => {
    const before = await holdings(a);
    const failures: string[] = [];
    let calls = 0;
    for (const op of OPERATIONS.filter((o) => o.name in SCOPED)) {
      const probe = SCOPED[op.name]!;
      for (const [door, call] of [["REST", rest], ["MCP", mcp]] as const) {
        for (const input of probe.inside ? await probe.inside(a, b) : [probe.input(a)]) {
          const r = await call(op, b, input);
          calls++;
          const leaks = leaked(a, r.body, r.sent);
          const named = a.secrets.filter((x) => JSON.stringify(input).includes(x));
          const done = JSON.stringify(r.body?.archived ?? r.body?.restored ?? []);
          const why = [
            leaks.length ? `leaked ${leaks.join(", ")}` : "",
            r.status >= 500 ? "server error" : "",
            // The probe must reach the handler: an input the schema refuses tests nothing.
            r.body?.error?.code === "invalid_input" ? "the probe's input is invalid" : "",
            // A write that names the other organization's objects never succeeds; a batch reports each as not done.
            op.mutates && named.length && r.status < 400 && !BATCH.has(op.name) ? "a write naming the other organization's objects succeeded" : "",
            BATCH.has(op.name) && named.some((x) => done.includes(x)) ? "the batch acted on the other organization's objects" : "",
          ].filter(Boolean);
          if (why.length) failures.push(`${door} ${op.name} ${JSON.stringify(input).slice(0, 120)} → ${r.status} ${why.join("; ")}: ${JSON.stringify(r.body).slice(0, 240)}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(calls).toBeGreaterThan(2 * Object.keys(SCOPED).length);
    expect(await holdings(a)).toBe(before);
  });

  it("answers 404 when the path names another organization's object", async () => {
    const owned = [a.outcome.id, a.source.id, a.view.id, a.annotation.id, a.assumption.id, a.mockup.id];
    const failures: string[] = [];
    for (const op of OPERATIONS.filter((o) => o.scope === "product" && o.name in SCOPED)) {
      const input = SCOPED[op.name]!.input(a);
      const pathIds = [...op.rest.path.matchAll(/:([a-z_]+)/g)].map((m) => input[m[1]!]);
      if (!pathIds.some((v) => owned.includes(String(v)))) continue;
      const r = await rest(op, b, input);
      if (r.status !== 404) failures.push(`${op.name} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("operations that belong to no organization", () => {
  const both = async (name: string, input: Input) => {
    const op = OPERATIONS.find((o) => o.name === name)!;
    return [await rest(op, b, input), await mcp(op, b, input)];
  };

  it("lists only the caller's own products and organizations", async () => {
    for (const r of await both("products.list", { include_archived: true })) {
      expect(r.status).toBe(200);
      expect(leaked(a, r.body, r.sent)).toEqual([]);
      expect(r.body.items.length).toBeGreaterThan(0);
    }
  });

  it("creates an organization that holds nothing of another", async () => {
    for (const r of await both("products.create_tenant", { name: "Quillon Spare" })) {
      expect([200, 201]).toContain(r.status);
      expect(leaked(a, r.body, r.sent)).toEqual([]);
    }
  });

  it("refuses the instance's allowances, its organizations' plans and its usage to anyone but its owners, and changes none", async () => {
    const before = (await h.db.selectFrom("tenant_allowances").selectAll().execute()).length;
    const plans = async () => JSON.stringify(await h.db.selectFrom("tenants").select(["tenant_id", "plan", "limits", "limits_etag"]).orderBy("tenant_id").execute());
    const plansBefore = await plans();
    for (const [name, input] of [
      ["products.tenant_allowances", {}],
      ["products.set_tenant_allowance", { email: a.owner.email, allowed: 0 }],
      ["products.remove_tenant_allowance", { email: a.owner.email, expected_etag: "x" }],
      ["products.usage", {}],
      ["products.organizations", {}],
      ["products.set_limits", { tenant: a.tenant.slug, plan: "unlimited", limits: { writes_per_day: 1 }, expected_etag: "NORTHWIND7-limits" }],
      ["products.set_limits", { tenant: b.tenant.slug, plan: "unlimited" }],
      ["products.accounts", {}],
    ] as const) {
      for (const r of await both(name, input)) {
        expect(r.status, `${name} ${JSON.stringify(r.body)}`).toBe(403);
        expect(leaked(a, r.body, r.sent)).toEqual([]);
      }
    }
    // Removing an account is a person's act in the web app, and an instance owner's.
    const victimId = (await h.db.selectFrom("accounts").select("account_id").where("email", "=", a.owner.email).executeTakeFirstOrThrow()).account_id;
    const removal = await b.owner.api("POST", "/api/v1/accounts/remove", { account_id: victimId, email: a.owner.email, confirm: "delete permanently" });
    expect(removal.status, JSON.stringify(removal.body)).toBe(403);
    expect(leaked(a, removal.body, JSON.stringify({ account_id: victimId, email: a.owner.email }))).toEqual([]);
    expect((await h.db.selectFrom("accounts").select("deleted_at").where("account_id", "=", victimId).executeTakeFirstOrThrow()).deleted_at).toBeNull();
    expect((await h.db.selectFrom("tenant_allowances").selectAll().execute()).length).toBe(before);
    expect(await plans()).toBe(plansBefore);
  });

  it("answers the skill and feedback with nothing of any organization", async () => {
    for (const [name, input] of [["get_skill", {}], ["submit_feedback", { category: "other", message: "A probe from another organization." }]] as const) {
      for (const r of await both(name, input)) {
        expect([200, 201], `${name} ${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.status);
        expect(leaked(a, r.body, r.sent)).toEqual([]);
      }
    }
  });
});
