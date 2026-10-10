import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { copyTenant } from "../src/e2e-golden.ts";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
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
  it("copies the sandbox's people but none of its visitors: no seat, and no role on a team or product", async () => {
    const owner = await h.signIn("owner@sample.example", "Sample Owner");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Sample Sandbox" });
    const { slug, tenant_id: tenantId } = t.body.tenant;
    const team = t.body.team.slug;
    const T = `/api/v1/tenants/${slug}`;
    expect((await owner.api("POST", `/api/v1/teams/${slug}/${team}/products`, { name: "Showcase" })).status).toBe(201);
    await h.signIn("editor@sample.example", "Sample Editor");
    expect((await owner.api("POST", `${T}/members`, { email: "editor@sample.example", role: "editor", team })).status).toBe(201);
    expect(await syncSandboxTenant(h.db, slug, () => {})).toBe(tenantId);

    // A visitor whose account was not made by the invitation, and who was given a role on a team too.
    const visitor = await h.signIn("visitor@sample.example", "Sample Visitor");
    const invite = await owner.api("POST", `${T}/sandbox/invites`, { label: "Sample", places: 5 });
    const code = String(invite.body.invite_link).split("/join/")[1]!;
    expect((await visitor.api("POST", "/api/v1/sandbox/join", { code })).body).toMatchObject({ already: false, role: "visitor" });
    expect((await owner.api("POST", `${T}/members`, { email: "visitor@sample.example", role: "viewer", team })).status).toBe(201);
    const visitorId = (await visitor.api("GET", "/api/v1/me")).body.account_id as string;

    const ids = await copyTenant(admin, tenantId, `${slug}-standard`, "Sample Sandbox (standard)");
    const copy = ids.get(tenantId)!;
    const held = await admin.query<{ email: string; scope_type: string; role: string }>(
      "select a.email, m.scope_type, m.role from memberships m join accounts a using (account_id) where m.tenant_id = $1 order by 1, 2",
      [copy],
    );
    expect(held.rows).toEqual([
      { email: "editor@sample.example", scope_type: "team", role: "editor" },
      { email: "owner@sample.example", scope_type: "tenant", role: "owner" },
    ]);
    expect(held.rows.some((r) => r.role === "visitor")).toBe(false);
    expect((await admin.query("select 1 from memberships where tenant_id = $1 and account_id = $2", [copy, visitorId])).rowCount).toBe(0);
    // The sandbox itself keeps its visitor.
    expect((await admin.query("select 1 from memberships where tenant_id = $1 and account_id = $2", [tenantId, visitorId])).rowCount).toBe(2);
    expect((await admin.query<{ sandbox: boolean }>("select sandbox from tenants where tenant_id = $1", [copy])).rows[0]!.sandbox).toBe(false);
  });
});
