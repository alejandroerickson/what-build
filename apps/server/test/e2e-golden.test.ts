import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { copyTenant } from "../src/e2e-golden.ts";
import { syncExampleTenant } from "../src/example-organization.ts";
import { addSamplePeople } from "../src/fixture.ts";
import { SEED_ACCOUNTS } from "../src/seed.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;
let admin: pg.Client;

beforeAll(async () => {
  h = await startHarness();
  // The builder runs as the database's superuser, as it does on the restored copy.
  const name = (await sql<{ db: string }>`select current_database() as db`.execute(h.db)).rows[0]!.db;
  const url = new URL(inject("adminUrl"));
  url.pathname = `/${name}`;
  admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
});
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

describe("the golden master's standard organization", () => {
  it("copies the example's people and their roles, and is not the example itself", async () => {
    const owner = await h.signIn("owner@sample.example", "Sample Owner");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Sample Example" });
    const { slug, tenant_id: tenantId } = t.body.tenant;
    const T = `/api/v1/tenants/${slug}`;
    expect((await owner.api("POST", `/api/v1/tenants/${slug}/products`, { name: "Showcase" })).status).toBe(201);
    await h.signIn("editor@sample.example", "Sample Editor");
    expect((await owner.api("POST", `${T}/members`, { email: "editor@sample.example", role: "editor", all_products: true })).status).toBe(201);
    expect(await syncExampleTenant(h.db, slug, () => {})).toBe(tenantId);
    // A guest holds no stored grant, so there is none to copy.
    const guest = await h.signIn("guest@sample.example", "Sample Guest");
    expect((await guest.api("GET", "/api/v1/me/products")).body.tenants.map((x: { slug: string }) => x.slug)).toEqual([slug]);

    const ids = await copyTenant(admin, tenantId, `${slug}-standard`, "Sample Example (standard)");
    const copy = ids.get(tenantId)!;
    const held = await admin.query<{ email: string; scope_type: string; role: string }>(
      "select a.email, m.scope_type, m.role from memberships m join accounts a using (account_id) where m.tenant_id = $1 order by 1, 2",
      [copy],
    );
    expect(held.rows).toEqual([
      { email: "editor@sample.example", scope_type: "all_products", role: "editor" },
      { email: "owner@sample.example", scope_type: "tenant", role: "owner" },
    ]);
    expect((await admin.query<{ example: boolean }>("select example from tenants where tenant_id = $1", [copy])).rows[0]!.example).toBe(false);
    await syncExampleTenant(h.db, null, () => {});
  });

  it("gives the copy a name etag of its own, and none of the original's renames, which never happened to it", async () => {
    const owner = await h.signIn("renamer@sample.example", "Sample Renamer");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "First Sample" });
    const { slug: first, tenant_id: tenantId, name_etag: etag } = t.body.tenant;
    expect((await owner.api("POST", `/api/v1/tenants/${first}/products`, { name: "Kept" })).status).toBe(201);
    const renamed = await owner.api("PATCH", `/api/v1/tenants/${first}`, { name: "Renamed Sample", slug: `${first}-renamed`, expected_etag: etag });
    expect(renamed.status).toBe(200);
    // A slug changed on its own is recorded apart from a rename.
    const moved = await owner.api("PATCH", `/api/v1/tenants/${renamed.body.slug}`, { slug: `${first}-moved`, expected_etag: renamed.body.name_etag });
    expect(moved.status).toBe(200);
    const slug = moved.body.slug as string;

    const ids = await copyTenant(admin, tenantId, `${slug}-standard`, "Renamed Sample (standard)");
    const copy = ids.get(tenantId)!;
    const etagOf = async (id: string) => (await admin.query<{ name_etag: string }>("select name_etag from tenants where tenant_id = $1", [id])).rows[0]!.name_etag;
    expect(await etagOf(tenantId)).toBe(moved.body.name_etag);
    expect(await etagOf(copy)).toMatch(/\S/);
    expect(await etagOf(copy)).not.toBe(await etagOf(tenantId));

    type Event = { action: string; entity_type: string; entity_id: string; entity_title: string };
    const events = async (id: string) =>
      (await admin.query<Event>("select action, entity_type, entity_id, entity_title from activity where tenant_id = $1 order by activity_id", [id])).rows;
    const original = await events(tenantId);
    expect(original.filter((e) => e.entity_type === "tenant").map((e) => e.action)).toEqual(["created", "renamed", "slug_changed"]);
    // The rest of its activity, in its order, under the copy's ids.
    const itsRenames = (e: Event) => e.entity_type === "tenant" && (e.action === "renamed" || e.action === "slug_changed");
    expect(await events(copy)).toEqual(original.filter((e) => !itsRenames(e)).map((e) => ({ ...e, entity_id: ids.get(e.entity_id) ?? e.entity_id })));
    expect((await admin.query("select slug from tenant_slugs where tenant_id = $1", [copy])).rows).toEqual([]);

    // Over the API too, where its owners read it.
    const copySlug = `${slug}-standard`;
    const listed = (await owner.api("GET", "/api/v1/me/products")).body.tenants as { slug: string; name_etag: string }[];
    expect(listed.find((x) => x.slug === copySlug)!.name_etag).not.toBe(listed.find((x) => x.slug === slug)!.name_etag);
  });

  it("copies the search index with what it indexes, so plain search finds the same words in the copy", async () => {
    const owner = await h.signIn("indexer@sample.example", "Sample Indexer");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Indexed Sample" });
    const { slug, tenant_id: tenantId } = t.body.tenant;
    const product = await owner.api("POST", `/api/v1/tenants/${slug}/products`, { name: "Yard" });
    const P = `/api/v1/p/${product.body.path}`;
    const source = await owner.api("POST", `${P}/sources`, { title: "Yard walk — Example Co", tags: ["visit"] });
    const recordId = source.body.record_id as string;
    expect((await owner.api("PUT", `${P}/sources/${recordId}/derived/text`, { content: "The crews keep a quorvel board by the gate.\n\nNobody in the office reads it.\n" })).status).toBe(200);
    const comment = await owner.api("POST", `${P}/sources/${recordId}/annotations`, { note: "Ask the lead about the zantic rota." });
    expect(comment.status).toBe(201);

    const ids = await copyTenant(admin, tenantId, `${slug}-standard`, "Indexed Sample (standard)");
    type Piece = { record_id: string; field: string; ref: string; n: number; char_start: number; char_end: number; text: string; words: string };
    const pieces = async (tenant: string) =>
      (await admin.query<Piece>("select record_id, field, ref, n, char_start, char_end, text, tsv::text as words from text_chunks where tenant_id = $1", [tenant])).rows;
    const key = (p: Piece) => `${p.record_id} ${p.field} ${p.ref} ${p.n}`;
    const original = await pieces(tenantId);
    // Its title, tags, text and comment.
    expect(original.map((p) => p.field).sort()).toEqual(["comment", "tags", "text", "title"]);
    // The same pieces, word for word and offset for offset, under the copy's ids, the comment's among them.
    const expected = original.map((p) => ({ ...p, record_id: ids.get(p.record_id)!, ref: p.ref ? ids.get(p.ref)! : "" }));
    expect((await pieces(ids.get(tenantId)!)).sort((a, b) => key(a).localeCompare(key(b)))).toEqual(expected.sort((a, b) => key(a).localeCompare(key(b))));
    expect(expected.find((p) => p.field === "comment")!.ref).toBe(ids.get(comment.body.annotation_id));

    const C = `/api/v1/p/${slug}-standard/${product.body.path.split("/").slice(1).join("/")}`;
    for (const base of [P, C])
      for (const word of ["quorvel", "zantic"]) {
        const r = await owner.api("GET", `${base}/search?mode=plain&query=${word}`);
        expect(r.status, `${base} ${word}`).toBe(200);
        expect(r.body.results.map((x: { kind: string; title: string }) => [x.kind, x.title]), `${base} ${word}`).toEqual([["source", "Yard walk — Example Co"]]);
      }
  });
});

describe("the golden master's synthetic organization", () => {
  it("is left out when the sample people are given their roles, which every other organization gets", async () => {
    const owner = await h.signIn("own-owner@sample.example", "Own Owner");
    const own = (await owner.api("POST", "/api/v1/tenants", { name: "Own People" })).body.tenant;
    const shared = (await owner.api("POST", "/api/v1/tenants", { name: "Shared People" })).body;
    const other = shared.tenant;
    // Jordan's place is on a product: a Story reader of its product.
    expect((await owner.api("POST", `/api/v1/tenants/${other.slug}/products`, { name: "Shared" })).status).toBe(201);
    await addSamplePeople(h.db, [own.slug]);
    const held = async (tenantId: string) =>
      (
        await admin.query<{ email: string }>(
          "select distinct a.email from memberships m join accounts a using (account_id) where m.tenant_id = $1 and a.email = any($2) order by 1",
          [tenantId, SEED_ACCOUNTS.map((a) => a.email)],
        )
      ).rows.map((r) => r.email);
    expect(await held(own.tenant_id)).toEqual([]);
    expect(await held(other.tenant_id)).toEqual(SEED_ACCOUNTS.map((a) => a.email).sort());
  });
});
