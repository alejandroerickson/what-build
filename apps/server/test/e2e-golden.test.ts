import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { copyTenant } from "../src/e2e-golden.ts";
import { syncExampleTenant } from "../src/example-organization.ts";
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
    const team = t.body.team.slug;
    const T = `/api/v1/tenants/${slug}`;
    expect((await owner.api("POST", `/api/v1/teams/${slug}/${team}/products`, { name: "Showcase" })).status).toBe(201);
    await h.signIn("editor@sample.example", "Sample Editor");
    expect((await owner.api("POST", `${T}/members`, { email: "editor@sample.example", role: "editor", team })).status).toBe(201);
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
      { email: "editor@sample.example", scope_type: "team", role: "editor" },
      { email: "owner@sample.example", scope_type: "tenant", role: "owner" },
    ]);
    expect((await admin.query<{ example: boolean }>("select example from tenants where tenant_id = $1", [copy])).rows[0]!.example).toBe(false);
    await syncExampleTenant(h.db, null, () => {});
  });

  it("copies the search index with what it indexes, so plain search finds the same words in the copy", async () => {
    const owner = await h.signIn("indexer@sample.example", "Sample Indexer");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Indexed Sample" });
    const { slug, tenant_id: tenantId } = t.body.tenant;
    const team = t.body.team.slug;
    const product = await owner.api("POST", `/api/v1/teams/${slug}/${team}/products`, { name: "Yard" });
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
