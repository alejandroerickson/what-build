import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CONTENT_TABLES, OTHER_TENANT_TABLES } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// Permanent delete belongs to admins, for everything that can be archived, and to an organization's
// owners, in the web app alone, for the organization itself. Every delete is guarded the same way
// and leaves a tombstone; a product or an organization is also confirmed by its name.

let h: Harness;
let owner: Browser;
let editor: Browser;
let reader: Browser;
let org: Organization;
let P: string;

const guards = (etag: string, reason = "Added by mistake") => ({ expected_etag: etag, reason, confirm: "delete permanently" });

/** Rows of a table that carry this organization's tenant_id, counted inside its row-level security. */
async function rowsIn(tenantId: string, table: string, extra = sql`true`): Promise<number> {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    const r = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where tenant_id = ${tenantId} and ${extra}`.execute(trx);
    return Number(r.rows[0]!.n);
  });
}

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signIn("olga@delta.example", "Olga Delta");
  org = await buildOrganization(h, owner, "Delta Works", "DELTA3");
  P = `/api/v1/p/${org.product.path}`;
  await owner.api("POST", `/api/v1/tenants/${org.tenant.slug}/members`, { team: org.team.slug, email: "eddie@delta.example", role: "editor" });
  editor = await h.signIn("eddie@delta.example", "Eddie Delta");
  await owner.api("POST", `/api/v1/tenants/${org.tenant.slug}/members`, { product: org.product.id, email: "rita@delta.example", role: "reader" });
  reader = await h.signIn("rita@delta.example", "Rita Delta");
}, 120_000);
afterAll(async () => h?.close());

describe("who deletes", () => {
  it("refuses every permanent delete to an editor, who still archives and previews", async () => {
    const refused = [
      [`${P}/sources/${org.source.id}`, guards(org.source.etag)],
      [`${P}/annotations/${org.annotation.id}`, guards(org.annotation.etag)],
      [`${P}/assumptions/${org.assumption.id}`, guards(org.assumption.etag)],
      [`${P}/outcomes/${org.outcome.id}`, guards(org.outcome.etag)],
      [`${P}/story/pages/${org.page.id}`, guards(org.page.etag)],
      [`${P}/mockups/${org.mockup.id}`, guards(org.mockup.etag)],
      [P, { ...guards(org.product.etag), name: "DELTA3 Atlas" }],
    ] as const;
    for (const [path, body] of refused) {
      const r = await editor.api("DELETE", path, body);
      expect(r.status, `${path} → ${JSON.stringify(r.body)}`).toBe(403);
      expect(r.body.error.details).toMatchObject({ role: "editor", needed: "admin" });
    }
    expect((await editor.api("GET", `${P}/sources/${org.source.id}/delete-impact`)).status).toBe(200);
    expect((await editor.api("GET", `${P}/assumptions/${org.assumption.id}/delete-impact`)).status).toBe(200);
    // Deleting the whole organization is its owners' alone.
    const tenant = await editor.api("DELETE", `/api/v1/tenants/${org.tenant.slug}`, { name: "Delta Works", reason: "x", confirm: "delete permanently" });
    expect(tenant.status).toBe(403);
    expect((await editor.api("GET", `${P}/sources/${org.source.id}`)).status).toBe(200);
  });
});

describe("deleting what is in a product", () => {
  it("deletes a comment with every guard, and answers 410 afterwards", async () => {
    const path = `${P}/annotations/${org.annotation.id}`;
    expect((await owner.api("DELETE", path, { ...guards(org.annotation.etag), confirm: "yes" })).body.error.code).toBe("confirmation_required");
    expect((await owner.api("DELETE", path, guards("stale"))).status).toBe(409);
    const del = await owner.api("DELETE", path, guards(org.annotation.etag, "On the wrong source"));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, annotation_id: org.annotation.id, reason: "On the wrong source" });
    const again = await owner.api("DELETE", path, guards(org.annotation.etag));
    expect(again.status).toBe(410);
    expect(again.body.error).toMatchObject({ code: "annotation_deleted", details: { tombstone: { reason: "On the wrong source" } } });
    const notes = await owner.api("GET", `${P}/sources/${org.source.id}/annotations?include_archived=true`);
    expect(notes.body.items.map((a: { annotation_id: string }) => a.annotation_id)).not.toContain(org.annotation.id);
    const log = await owner.api("GET", `${P}/activity?entity_id=${org.source.id}`);
    expect(log.body.items.map((i: { action: string }) => i.action)).toContain("note_deleted");
  });

  it("deletes an assumption: its links from others go", async () => {
    const impact = await owner.api("GET", `${P}/assumptions/${org.linked.id}/delete-impact`);
    expect(impact.status).toBe(200);
    expect(impact.body.linked_from).toEqual([expect.objectContaining({ id: org.assumption.id, type: "supports" })]);

    const before = await owner.api("GET", `${P}/assumptions/${org.assumption.id}`);
    // A reviewed, frozen assumption is deleted like any other.
    const del = await owner.api("DELETE", `${P}/assumptions/${org.linked.id}`, guards(impact.body.etag, "Duplicate of another"));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const after = await owner.api("GET", `${P}/assumptions/${org.assumption.id}`);
    expect(after.body.links).toEqual([]);
    expect(after.body.etag).not.toBe(before.body.etag);
    const gone = await owner.api("GET", `${P}/assumptions/${org.linked.id}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe("assumption_deleted");
    expect(await rowsIn(org.tenant.id, "reviews", sql`entry_id = ${org.linked.id}`)).toBe(0);
  });

  it("deletes an outcome: the assumptions that served it stop naming it", async () => {
    const impact = await owner.api("GET", `${P}/outcomes/${org.outcome.id}/delete-impact`);
    expect(impact.body.assumptions.map((a: { id: string }) => a.id)).toEqual([org.assumption.id]);
    const del = await owner.api("DELETE", `${P}/outcomes/${org.outcome.id}`, guards(impact.body.etag));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect((await owner.api("GET", `${P}/assumptions/${org.assumption.id}`)).body.outcome_ids).toEqual([]);
    expect((await owner.api("GET", `${P}/outcomes/${org.outcome.id}`)).status).toBe(410);
    expect(await rowsIn(org.tenant.id, "revisions", sql`object_id = ${org.outcome.id}`)).toBe(0);
  });

  it("deletes a Story page, promoting its sub-pages, and keeps one tombstone for an id used again", async () => {
    const page = (title: string) => ({ title, body: `<h1>${title}</h1><p>${title}.</p>` });
    const parent = await owner.api("POST", `${P}/story/pages/plan/versions`, page("The plan"));
    await owner.api("POST", `${P}/story/pages/plan-detail/versions`, page("The plan in detail"));
    const tree = await owner.api("GET", `${P}/story/hierarchy`);
    const set = await owner.api("PUT", `${P}/story/hierarchy`, { expected_etag: tree.body.etag, items: [...tree.body.items, { page_id: "plan", children: [{ page_id: "plan-detail", children: [] }] }] });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const impact = await owner.api("GET", `${P}/story/pages/plan/delete-impact`);
    expect(impact.body.sub_pages_promoted).toEqual(["plan-detail"]);
    const del = await owner.api("DELETE", `${P}/story/pages/plan`, guards(parent.body.etag));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const after = await owner.api("GET", `${P}/story/hierarchy`);
    expect(JSON.stringify(after.body.items)).not.toContain('"plan"');
    expect(after.body.items.map((n: { page_id: string }) => n.page_id)).toContain("plan-detail");
    expect((await owner.api("GET", `${P}/story/pages/plan`)).status).toBe(410);
    // A reader learns no more of a deleted page than of an archived one.
    expect((await reader.api("GET", `${P}/story/pages/plan`)).status).toBe(404);

    const again = await owner.api("POST", `${P}/story/pages/plan/versions`, page("The plan, again"));
    expect(again.status).toBe(201);
    expect((await owner.api("DELETE", `${P}/story/pages/plan`, guards(again.body.etag, "Second try"))).status).toBe(200);
    expect(await rowsIn(org.tenant.id, "tombstones", sql`object_type = 'story_page' and object_id = 'plan'`)).toBe(1);
  });

  it("refuses to delete a mockup a Story page shows, and deletes it once the page is gone", async () => {
    const impact = await owner.api("GET", `${P}/mockups/${org.mockup.id}/delete-impact`);
    expect(impact.body.story_pages_showing.map((p: { page_id: string }) => p.page_id)).toEqual([org.promotedPage.id]);
    const held = await owner.api("DELETE", `${P}/mockups/${org.mockup.id}`, guards(impact.body.etag));
    expect(held.status).toBe(409);
    expect(held.body.error.code).toBe("mockup_on_story");
    const promoted = await owner.api("GET", `${P}/story/pages/${org.promotedPage.id}`);
    expect((await owner.api("DELETE", `${P}/story/pages/${org.promotedPage.id}`, guards(promoted.body.etag))).status).toBe(200);
    const del = await owner.api("DELETE", `${P}/mockups/${org.mockup.id}`, guards(impact.body.etag, "Wrong direction"));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect((await owner.api("GET", `${P}/mockups/${org.mockup.id}`)).status).toBe(410);
    // Only the other mockup's page is left: the one that enters its prototype, whose files stay with it.
    expect(await rowsIn(org.tenant.id, "mockup_pages", sql`product_id = ${org.product.id}`)).toBe(1);
    expect(await rowsIn(org.tenant.id, "mockup_pages", sql`product_id = ${org.product.id} and entry is not null`)).toBe(1);
    expect(await rowsIn(org.tenant.id, "mockup_files", sql`product_id = ${org.product.id}`)).toBe(0);
    expect(await rowsIn(org.tenant.id, "mockup_prototype_files", sql`product_id = ${org.product.id}`)).toBe(2);
  });
});

describe("deleting a product", () => {
  it("needs its name typed, deletes everything in it, and keeps the bytes a copy elsewhere still uses", async () => {
    const copy = await owner.api("POST", `${P}/sources/${org.source.id}/copy`, { to_product: org.annex.id });
    expect(copy.status, JSON.stringify(copy.body)).toBe(200);
    const impact = await owner.api("GET", `${P}/delete-impact`);
    expect(impact.status).toBe(200);
    expect(impact.body.contents.sources).toBeGreaterThan(0);
    expect((await editor.api("GET", `${P}/delete-impact`)).status).toBe(403);

    const misnamed = await owner.api("DELETE", P, { ...guards(impact.body.etag), name: "Delta Atlas" });
    expect(misnamed.status).toBe(422);
    expect(misnamed.body.error.code).toBe("name_mismatch");
    // Archived, it can still be deleted.
    const archived = await owner.api("POST", `${P}/archive`, { expected_etag: impact.body.etag });
    expect(archived.status).toBe(200);
    const etag = (await owner.api("GET", P)).body.etag;
    const del = await owner.api("DELETE", P, { ...guards(etag, "A test product"), name: "DELTA3 Atlas" });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect((await owner.api("GET", P)).status).toBe(404);
    for (const table of ["records", "outcomes", "register_entries", "story_pages", "story_versions", "mockups", "exports", "activity", "annotations"])
      expect(await rowsIn(org.tenant.id, table, sql`product_id = ${org.product.id}`), table).toBe(0);
    expect(await rowsIn(org.tenant.id, "tombstones", sql`object_type = 'product' and object_id = ${org.product.id}`)).toBe(1);
    // A source's derived text and what search held of it go with it.
    for (const table of ["source_texts", "text_chunks"]) expect(await rowsIn(org.tenant.id, table, sql`record_id = ${org.source.id}`), table).toBe(0);

    await h.worker.drain();
    // The copy in the other product reads the same bytes, which stay.
    const annex = `/api/v1/p/${org.annex.path}`;
    const copied = await owner.api("GET", `${annex}/sources/${copy.body.record_id}?detail=full`);
    const file = copied.body.attachments[0];
    const download = await owner.api("POST", `${annex}/sources/${copy.body.record_id}/downloads`, { path: file.path });
    expect(download.status, JSON.stringify(download.body)).toBe(200);
    const bytes = await fetch(download.body.url, { headers: download.body.headers });
    expect(bytes.status).toBe(200);
    // The product's own export is gone from the store.
    expect([...h.blobs.blobs.keys()].some((k) => k.includes(org.exportId))).toBe(false);
  });
});

describe("deleting an organization", () => {
  it("is never offered to an agent, even at Admin", async () => {
    const token = await h.connectAgent(owner, "Delta agent", "/mcp", "admin");
    const client = new Client({ name: "delta-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const { tools } = await client.listTools();
    const actions = (tools.find((t) => t.name === "products_delete")!.inputSchema.properties!["action"] as { enum: string[] }).enum;
    expect(actions).toEqual(["delete"]);
    const r = (await client.callTool({ name: "products_delete", arguments: { action: "delete_tenant", params: { tenant: org.tenant.slug, name: "Delta Works", reason: "x", confirm: "delete permanently" } } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain("unknown_action");
    await client.close();
    expect((await owner.api("GET", "/api/v1/me/products")).body.tenants.map((t: { slug: string }) => t.slug)).toContain(org.tenant.slug);
  });

  it("refuses the example organization", async () => {
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Delta Example" });
    expect(await syncExampleTenant(h.db, t.body.tenant.slug, () => {})).toBe(t.body.tenant.tenant_id);
    const r = await owner.api("DELETE", `/api/v1/tenants/${t.body.tenant.slug}`, { name: "Delta Example", reason: "x", confirm: "delete permanently" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("example_organization");
    await syncExampleTenant(h.db, null, () => {});
  });

  it("needs its name typed, and then erases every row and file it holds, and every role in it", async () => {
    const T = `/api/v1/tenants/${org.tenant.slug}`;
    const impact = await owner.api("GET", `${T}/delete-impact`);
    expect(impact.status, JSON.stringify(impact.body)).toBe(200);
    expect(impact.body.contents.people).toBeGreaterThanOrEqual(3);
    expect((await owner.api("DELETE", T, { name: "Delta", reason: "x", confirm: "delete permanently" })).body.error.code).toBe("name_mismatch");
    expect((await owner.api("DELETE", T, { name: "Delta Works", reason: "x", confirm: "yes" })).body.error.code).toBe("confirmation_required");
    const other = await owner.api("POST", "/api/v1/tenants", { name: "Delta Elsewhere" });

    const del = await owner.api("DELETE", T, { name: "Delta Works", reason: "Closing the trial", confirm: "delete permanently" });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const mine = await owner.api("GET", "/api/v1/me/products");
    expect(mine.body.tenants.map((t: { slug: string }) => t.slug)).not.toContain(org.tenant.slug);
    expect(mine.body.tenants.map((t: { slug: string }) => t.slug)).toContain(other.body.tenant.slug);
    expect((await editor.api("GET", "/api/v1/me/products")).body.tenants).toEqual([]);
    // Every table that holds an organization's rows is empty of this one's, but for the feedback sent to
    // the maintainers and the jobs that delete its files.
    for (const table of [...CONTENT_TABLES, ...Object.keys(OTHER_TENANT_TABLES).filter((t) => t !== "feedback" && t !== "jobs")])
      expect(await rowsIn(org.tenant.id, table), table).toBe(0);
    expect(await rowsIn(org.tenant.id, "jobs", sql`kind != 'delete_blobs'`)).toBe(0);
    expect(await h.db.selectFrom("tenants").select("tenant_id").where("tenant_id", "=", org.tenant.id).executeTakeFirst()).toBeUndefined();
    await h.worker.drain();
    expect([...h.blobs.blobs.keys()].filter((k) => k.startsWith(`t/${org.tenant.id}/`))).toEqual([]);
  });
});
