import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OPERATIONS, RESET_CONFIRMATION, type OperationDef } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
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

const page = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><p>${title}</p></body></html>`;

/** Every product, team and tenant operation, with an attack on real ids. */
const SCOPED: Record<string, Probe> = {
  "products.create_team": { input: () => ({ name: "Planted team" }) },
  "products.create": { input: () => ({ name: "Planted product" }) },
  "products.get": { input: () => ({}) },
  "products.update": { input: (a) => ({ expected_etag: a.product.etag, name: "Renamed by an outsider" }) },
  "products.archive": { input: (a) => ({ expected_etag: a.product.etag }) },
  "products.restore": { input: (a) => ({ expected_etag: a.product.etag }) },
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
  "sandbox.status": { input: () => ({}) },
  "sandbox.settings": { input: () => ({}) },
  "sandbox.update_settings": { input: (a) => ({ expected_etag: sandbox(a).settingsEtag, visitor_access: "closed" }) },
  "sandbox.save_baseline": { input: () => ({ note: "Planted baseline" }) },
  "sandbox.baselines": { input: () => ({}) },
  "sandbox.reset": { input: (a) => ({ baseline_id: sandbox(a).baselineId, confirm: RESET_CONFIRMATION }) },
  "sandbox.invites": { input: () => ({}) },
  "sandbox.create_invite": { input: () => ({ label: "Planted invitation", places: 5 }) },
  "sandbox.revoke_invite": { input: (a) => ({ invite_id: sandbox(a).inviteId }) },
  "sandbox.visitors": { input: () => ({}) },
  "sandbox.remove_visitor": { input: (a) => ({ account_id: sandbox(a).visitorId }) },
  "outcomes.list": { input: () => ({}) },
  "outcomes.get": { input: (a) => ({ outcome_id: a.outcome.id }) },
  "outcomes.create": { input: () => ({ title: "Planted outcome" }) },
  "outcomes.update": { input: (a) => ({ outcome_id: a.outcome.id, expected_etag: a.outcome.etag, title: "Changed by an outsider" }) },
  "outcomes.revisions": { input: (a) => ({ outcome_id: a.outcome.id }) },
  "outcomes.get_revision": { input: (a) => ({ outcome_id: a.outcome.id, n: 1 }) },
  "outcomes.restore_revision": { input: (a) => ({ outcome_id: a.outcome.id, n: 1, expected_etag: a.outcome.etag }) },
  "sources.list": { input: () => ({}) },
  "sources.get": { input: (a) => ({ record_id: a.source.id, detail: "full" }) },
  "sources.create": {
    input: () => ({ kind: "other", title: "Planted source" }),
    inside: (a) => [{ kind: "view", title: "Planted view", related_records: [a.source.id] }],
  },
  "sources.update": {
    input: (a) => ({ record_id: a.source.id, expected_etag: a.source.etag, title: "Changed by an outsider" }),
    inside: async (a, b) => [
      { record_id: a.source.id, expected_etag: a.source.etag, title: "Changed by an outsider" },
      { record_id: b.view.id, expected_etag: await etagOf(b, `sources/${b.view.id}`), related_records: [a.source.id] },
    ],
  },
  "sources.archive": { input: (a) => ({ record_ids: [a.source.id] }) },
  "sources.restore": { input: (a) => ({ record_ids: [a.source.id] }) },
  "sources.annotate": { input: (a) => ({ record_id: a.source.id, note: "Planted annotation", seq_start: 0, seq_end: 1 }) },
  "sources.list_annotations": { input: (a) => ({ record_id: a.source.id, include_archived: true }) },
  "sources.update_annotation": { input: (a) => ({ annotation_id: a.annotation.id, expected_etag: a.annotation.etag, note: "Changed by an outsider" }) },
  "sources.used_by": { input: (a) => ({ record_id: a.source.id }) },
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
  "files.request_upload": { input: (a) => ({ record_id: a.source.id, path: "planted.md", role: "supplement" }) },
  "files.create_upload": {
    input: () => ({ kind: "other", title: "Planted upload", path: "planted.md", role: "primary" }),
    inside: (a) => [{ kind: "view", title: "Planted upload", path: "planted.md", role: "primary", related_records: [a.source.id] }],
  },
  "files.complete_upload": { input: (a) => ({ record_id: a.source.id, path: a.source.path }) },
  "files.add_note": { input: (a) => ({ record_id: a.source.id, path: "planted.md", text: "Planted note.", role: "supplement" }) },
  // A public address only; the call must be refused long before anything is fetched.
  "files.fetch_url": { input: (a) => ({ record_id: a.source.id, url: "https://example.com/planted.html", role: "supplement" }) },
  "files.set_role": { input: (a) => ({ record_id: a.source.id, path: a.source.path, role: "origin" }) },
  "files.get_download": {
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
  "derived.outline": {
    input: (a) => ({ record_id: a.source.id }),
    inside: (a, b) => [{ record_id: a.source.id }, { record_id: b.source.id, derivation_id: a.source.derivationId }],
  },
  "derived.text": {
    input: (a) => ({ record_id: a.source.id }),
    inside: (a, b) => [{ record_id: a.source.id }, { record_id: b.source.id, derivation_id: a.source.derivationId }],
  },
  "derived.list": { input: (a) => ({ record_id: a.source.id }) },
  "derived.rederive": { input: (a) => ({ record_id: a.source.id }) },
  "derived.write_note": { input: (a) => ({ record_id: a.source.id, note_kind: "summary", content: "Planted summary." }) },
  "derived.read_note": { input: (a) => ({ record_id: a.source.id, note_kind: "summary" }) },
  read_passage: {
    input: (a) => ({ record_id: a.source.id, start: 0, end: 2, unit: "seq" }),
    inside: (a, b) => [
      { record_id: a.source.id, start: 0, end: 2, unit: "seq" },
      { record_id: b.source.id, start: 0, end: 2, unit: "seq", derivation_id: a.source.derivationId },
    ],
  },
  search: {
    input: () => ({ query: "crews", scope: "all" }),
    inside: (a) => [{ query: "crews", scope: "all" }, { query: "crews", record_id: a.source.id }],
  },
  "assumptions.list": { input: (a) => ({ record_id: a.source.id, include_archived: true }) },
  "assumptions.get": { input: (a) => ({ id: a.assumption.id }) },
  "assumptions.create": {
    input: () => ({ statement: "Planted assumption." }),
    inside: (a) => [
      { statement: "Planted assumption.", citations: [{ record_id: a.source.id, seq_start: 1, seq_end: 1 }] },
      { statement: "Planted assumption.", outcome_ids: [a.outcome.id] },
      { statement: "Planted assumption.", links: [{ id: a.assumption.id, type: "supports" }] },
    ],
  },
  "assumptions.update": {
    input: (a) => ({ id: a.assumption.id, expected_etag: a.assumption.etag, statement: "Changed by an outsider." }),
    inside: async (a, b) => [
      { id: a.assumption.id, expected_etag: a.assumption.etag, statement: "Changed by an outsider." },
      { id: b.assumption.id, expected_etag: await etagOf(b, `assumptions/${b.assumption.id}`), citations: [{ record_id: a.source.id, seq_start: 1, seq_end: 1 }] },
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
  "assumptions.check_citations": { input: (a) => ({ id: a.assumption.id }) },
  "story.guidance": { input: () => ({}) },
  "story.get_style": { input: () => ({ include_stylesheet: true }) },
  "story.set_style": { input: (a) => ({ house_style: "tufte", expected_etag: a.styleEtag }) },
  "story.list_pages": { input: () => ({ include_archived: true }) },
  "story.get_page": { input: (a) => ({ page_id: a.page.id }) },
  "story.list_versions": { input: (a) => ({ page_id: a.page.id }) },
  "story.get_version": { input: (a) => ({ page_id: a.page.id, version: 1 }) },
  "story.publish": {
    input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag, title: "Changed by an outsider", body: "<p>Planted.</p>" }),
    inside: (a) => [
      { page_id: "planted", title: "Planted", body: "<p>Planted.</p>", refs: { outcomes: [a.outcome.id], sources: [a.source.id], assumptions: [a.assumption.id] } },
      { page_id: "planted-cites", title: "Planted", body: "<p>Planted.</p>", citations: [{ record_id: a.source.id, seq_start: 1, seq_end: 1 }] },
    ],
  },
  "story.promote_mockup": { input: (a) => ({ mockup_id: a.mockup.id, mockup_page_id: a.mockup.pageId, title: "Promoted by an outsider" }) },
  "story.write_notes": { input: (a) => ({ page_id: a.page.id, notes: "Planted notes.", expected_etag: a.page.notesEtag }) },
  "story.check_citations": { input: (a) => ({ page_id: a.page.id }) },
  "story.print_view": { input: (a) => ({ page_ids: [a.page.id, a.promotedPage.id] }) },
  "story.get_hierarchy": { input: () => ({}) },
  "story.set_hierarchy": { input: (a) => ({ items: [{ page_id: a.page.id, children: [] }], expected_etag: a.hierarchyEtag }) },
  "story.archive_page": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag }) },
  "story.restore_page": { input: (a) => ({ page_id: a.page.id, expected_etag: a.page.etag }) },
  "mockups.list": { input: () => ({ include_archived: true }) },
  "mockups.get": { input: (a) => ({ mockup_id: a.mockup.id, include_html: true, include_files: true }) },
  "mockups.list_versions": { input: (a) => ({ mockup_id: a.mockup.id }) },
  "mockups.get_version": { input: (a) => ({ mockup_id: a.mockup.id, version: 1, include_html: true, include_files: true }) },
  "mockups.publish": {
    input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag, title: "Changed by an outsider" }),
    inside: (a) => [
      { mockup_id: a.mockup.id, expected_etag: a.mockup.etag, title: "Changed by an outsider" },
      { title: "Planted mockup", brief: "Planted.", pages: [{ page_id: "p", title: "P", html: page("P") }], refs: { sources: [a.source.id], assumptions: [a.assumption.id] } },
      { title: "Planted mockup", brief: "Planted.", pages: [{ page_id: "p", title: "P", html: page("P") }], citations: [{ record_id: a.source.id, seq_start: 1, seq_end: 1 }] },
    ],
  },
  "mockups.archive": { input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag }) },
  "mockups.restore": { input: (a) => ({ mockup_id: a.mockup.id, expected_etag: a.mockup.etag }) },
  "mockups.get_download": { input: (a) => ({ mockup_id: a.mockup.id }) },
  "mockups.check_citations": { input: (a) => ({ mockup_id: a.mockup.id }) },
  "lineage.capture": { input: (a) => ({ inputs: [{ kind: "record", id: a.source.id }, { kind: "assumption", id: a.assumption.id }] }) },
  "lineage.write": {
    input: (a) => ({ record_id: a.view.id, inputs: [{ kind: "record", id: a.source.id, fingerprint: "0".repeat(64) }], query_spec: { description: "Planted." } }),
    // Their own source, claiming to be built from the victim's (their view already has lineage).
    inside: (a, b) => [{ record_id: b.source.id, inputs: [{ kind: "record", id: a.source.id, fingerprint: "0".repeat(64) }], query_spec: { description: "Planted." } }],
  },
  "lineage.check": { input: (a) => ({ record_id: a.view.id }) },
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
  "sandbox.join": "admits only the holder of a real invitation code",
  "sources.kinds": "the same fixed list for everyone",
  get_skill: "the same document for everyone",
  submit_feedback: "write-only: says nothing back about anyone",
};

interface SandboxIds {
  settingsEtag: string;
  baselineId: string;
  inviteId: string;
  visitorId: string;
}
const sandboxIds = new Map<string, SandboxIds>();
const sandbox = (o: Organization) => sandboxIds.get(o.tenant.id) ?? { settingsEtag: "none", baselineId: "none", inviteId: "none", visitorId: "none" };

let h: Harness;
let a: Organization; // the victim: a public sandbox, so its control panel has real ids too
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

  // The victim's organization is the deployment's public sandbox, with an invitation, a baseline and a visitor.
  expect(await syncSandboxTenant(h.db, a.tenant.slug, () => {})).toBe(a.tenant.id);
  const T = `/api/v1/tenants/${a.tenant.slug}`;
  const settings = (await alice.api("GET", `${T}/sandbox/settings`)).body;
  // No scheduled reset during the test: one would change what the victim holds.
  const opened = await alice.api("PATCH", `${T}/sandbox/settings`, { expected_etag: settings.etag, visitor_access: "write", reset_enabled: false });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  const invite = await alice.api("POST", `${T}/sandbox/invites`, { label: "NORTHWIND7 launch", places: 5 });
  expect(invite.status, JSON.stringify(invite.body)).toBe(201);
  const visitor = await h.signIn("visitor@northwind.example", "NORTHWIND7 Visitor");
  const joined = await visitor.api("POST", "/api/v1/sandbox/join", { code: String(invite.body.invite_link).split("/join/")[1] });
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);
  const baseline = await alice.api("POST", `${T}/sandbox/baselines`, { note: "NORTHWIND7 baseline" });
  expect(baseline.status, JSON.stringify(baseline.body)).toBe(200);
  const visitorId = (await visitor.api("GET", "/api/v1/me")).body.account_id as string;
  sandboxIds.set(a.tenant.id, {
    settingsEtag: (await alice.api("GET", `${T}/sandbox/settings`)).body.etag,
    baselineId: baseline.body.baseline_id,
    inviteId: invite.body.invite_id,
    visitorId,
  });
  a.secrets.push(invite.body.invite_id, baseline.body.baseline_id, visitorId, "visitor@northwind.example", String(invite.body.invite_link).split("/join/")[1]!);

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
        if (r.status !== 404 || r.body?.error?.code !== "not_found" || leaks.length) failures.push(`${door} ${op.name} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}${leaks.length ? ` LEAKED ${leaks.join(", ")}` : ""}`);
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

  it("refuses the instance's allowances to anyone but its owners, and changes none", async () => {
    const before = (await h.db.selectFrom("tenant_allowances").selectAll().execute()).length;
    for (const [name, input] of [
      ["products.tenant_allowances", {}],
      ["products.set_tenant_allowance", { email: a.owner.email, allowed: 0 }],
      ["products.remove_tenant_allowance", { email: a.owner.email, expected_etag: "x" }],
    ] as const) {
      for (const r of await both(name, input)) {
        expect(r.status, `${name} ${JSON.stringify(r.body)}`).toBe(403);
        expect(leaked(a, r.body, r.sent)).toEqual([]);
      }
    }
    expect((await h.db.selectFrom("tenant_allowances").selectAll().execute()).length).toBe(before);
  });

  it("admits no one to a sandbox without a real invitation code", async () => {
    for (const r of await both("sandbox.join", { code: "not-a-real-invitation-code-at-all" })) {
      expect(r.status).toBe(404);
      expect(leaked(a, r.body, r.sent)).toEqual([]);
    }
    expect((await mallory.api("GET", "/api/v1/me/products")).body.items.some((i: { path: string }) => i.path === a.product.path)).toBe(false);
  });

  it("answers the fixed lists, the skill and feedback with nothing of any organization", async () => {
    for (const [name, input] of [["sources.kinds", {}], ["get_skill", {}], ["submit_feedback", { category: "other", message: "A probe from another organization." }]] as const) {
      for (const r of await both(name, input)) {
        expect([200, 201], `${name} ${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.status);
        expect(leaked(a, r.body, r.sent)).toEqual([]);
      }
    }
  });
});
