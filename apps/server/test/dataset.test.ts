import { definedPlans } from "@whatbuild/core";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { addHarborLabs, addSyntheticOrganizations, clearDeploymentRows, SYNTHETIC, syntheticProducts, syntheticSource, type SyntheticOrganizations } from "../src/dataset.ts";
import { keepOnlyTenants } from "../src/e2e-golden.ts";
import { planPeople } from "../src/people.ts";
import { startHarness, type Harness } from "./harness.ts";

const OWNER = "riley@example.com";
const COUNT = 30;

describe("what the dataset's synthetic organizations hold", () => {
  it("is the same every time, of four kinds of source, and plainly synthetic", () => {
    expect(syntheticProducts(0, null)).toEqual(syntheticProducts(0, null));
    const kinds = new Set(Array.from({ length: 8 }, (_, i) => syntheticSource(i, 3).path));
    expect([...kinds].sort()).toEqual(["call.vtt", "interview.md", "survey.csv", "tickets.txt"]);
    for (const p of syntheticProducts(0, null)) for (const s of p.sources) {
      expect(s.tags).toContain("synthetic");
      expect(s.text).not.toMatch(/@/);
    }
  });

  it("gives the biggest organization the most, and never more than its plan holds", () => {
    const big = syntheticProducts(0, null);
    expect(big.length).toBe(6);
    expect(big.reduce((n, p) => n + p.sources.length, 0)).toBe(6 * 24);
    expect(syntheticProducts(4, null).reduce((n, p) => n + p.sources.length, 0)).toBeLessThan(big.reduce((n, p) => n + p.sources.length, 0));
    const free = syntheticProducts(0, { products_max: 1, sources_max: 10 });
    expect(free.length).toBe(1);
    expect(free[0]!.sources.length).toBe(10);
  });

  it("archives the last source of a product with eight or more, and summarizes every third", () => {
    const [p] = syntheticProducts(0, null);
    expect(p!.sources.filter((s) => s.archived)).toEqual([p!.sources.at(-1)]);
    expect(p!.sources.filter((s) => s.summary).length).toBe(Math.floor(p!.sources.length / 3));
    expect(syntheticProducts(7, null).flatMap((x) => x.sources).some((s) => s.archived)).toBe(false);
  });
});

describe("making the synthetic organizations on an instance", () => {
  let h: Harness;
  let admin: pg.Client;
  let made: SyntheticOrganizations;

  beforeAll(async () => {
    h = await startHarness({ instanceOwners: [OWNER], signupAllowlist: [planPeople(COUNT).allowlist], newOrganizationPlan: "free", defaultTenantAllowance: 0 });
    const name = (await sql<{ db: string }>`select current_database() as db`.execute(h.db)).rows[0]!.db;
    const url = new URL(inject("adminUrl"));
    url.pathname = `/${name}`;
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    made = await addSyntheticOrganizations({ env: { db: h.db, ports: h.ports }, worker: h.worker, admin, url: h.baseUrl, count: COUNT });
  }, 120_000);
  afterAll(async () => {
    await admin?.end();
    await h?.close();
  });

  const n = async (query: string, params: unknown[] = []) => (await admin.query<{ n: number }>(query, params)).rows[0]!.n;

  it("makes each organization with its people, its pending invitations, and products and sources within its plan", async () => {
    expect(made.organizations.map((o) => o.slug)).toEqual(made.plan.organizations.map((o) => o.slug));
    for (const [rank, org] of made.plan.organizations.entries()) {
      const limits = definedPlans().find((p) => p.id === org.plan)?.limits ?? null;
      const want = syntheticProducts(rank, limits);
      const tenant = (await admin.query<{ tenant_id: string; plan: string }>("select tenant_id, plan from tenants where slug = $1", [org.slug])).rows[0]!;
      expect(tenant.plan).toBe(org.plan);
      expect(await n("select count(*)::int as n from products where tenant_id = $1", [tenant.tenant_id])).toBe(want.length);
      expect(await n("select count(*)::int as n from records where tenant_id = $1", [tenant.tenant_id])).toBe(want.reduce((x, p) => x + p.sources.length, 0));
      expect(await n("select count(*)::int as n from outcomes where tenant_id = $1", [tenant.tenant_id])).toBe(want.length * 2);
    }
    expect(made.sources).toBe(await n("select count(*)::int as n from records"));
    expect(await n("select count(*)::int as n from invitations where accepted_at is null")).toBe(made.plan.people.filter((p) => p.kind === "invited").length);
    expect(await n("select count(*)::int as n from interest")).toBe(made.plan.people.filter((p) => p.kind === "waitlist").length);
  });

  it("reads every attachment, as a deployment would, and archives and summarizes some sources", async () => {
    expect(await n("select count(*)::int as n from file_versions")).toBe(made.sources);
    expect(await n("select count(*)::int as n from file_versions v where not exists (select 1 from derivations d where d.file_version_id = v.file_version_id)")).toBe(0);
    expect(await n("select count(*)::int as n from jobs where done_at is null")).toBe(0);
    expect(await n("select count(*)::int as n from records where archived_at is not null")).toBeGreaterThan(0);
  });

  it("puts each plan's limits on how often back as they were", () => {
    expect(definedPlans().find((p) => p.id === "free")!.limits.writes_per_minute).toBe(30);
  });

  it("adds the development sample once, and leaves out the deployment's own rows but the waitlist and allowances", async () => {
    expect(await addHarborLabs({ db: h.db, ports: h.ports }, h.worker, admin)).toBe(true);
    expect(await addHarborLabs({ db: h.db, ports: h.ports }, h.worker, admin)).toBe(false);
    expect(await n("select count(*)::int as n from tenants where slug = $1", [SYNTHETIC])).toBe(1);
    const allowances = await n("select count(*)::int as n from tenant_allowances");
    await clearDeploymentRows(admin);
    for (const t of ["sessions", "usage_calls", "guest_passes"]) expect(await n(`select count(*)::int as n from ${t}`), t).toBe(0);
    expect(await n("select count(*)::int as n from interest")).toBeGreaterThan(0);
    expect(await n("select count(*)::int as n from tenant_allowances")).toBe(allowances);
  });

  it("is kept whole when the golden master keeps only some organizations", async () => {
    const [kept, gone] = made.organizations;
    const ids = (await admin.query<{ tenant_id: string; slug: string }>("select tenant_id, slug from tenants where slug = any($1)", [[kept!.slug, gone!.slug, SYNTHETIC]])).rows;
    const id = (slug: string) => ids.find((t) => t.slug === slug)!.tenant_id;
    const onlyGone = made.plan.people.find((p) => p.kind !== "invited" && p.organizations.length === 1 && p.organizations[0]!.slug === gone!.slug)!;
    const nowhere = made.plan.people.find((p) => p.kind === "signed-in")!;
    const waitlist = await n("select count(*)::int as n from interest");
    await keepOnlyTenants(admin, [id(kept!.slug), id(SYNTHETIC)]);
    expect((await admin.query("select slug from tenants order by 1")).rows.map((r) => r.slug)).toEqual([kept!.slug, SYNTHETIC].sort());
    expect(await n("select count(*)::int as n from accounts where email = $1", [onlyGone.email])).toBe(0);
    expect(await n("select count(*)::int as n from accounts where email = $1", [nowhere.email])).toBe(1);
    expect(await n("select count(*)::int as n from interest")).toBe(waitlist);
  });
});
