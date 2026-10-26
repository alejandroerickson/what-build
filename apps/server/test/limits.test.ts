import { CONTENT_TABLES, dayOf, FREE_LIMITS, LIMITS, OTHER_TENANT_TABLES } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An organization created on an allowance is on the free plan, whose limits everyone in it meets,
// its owners included. Only an instance owner changes an organization's plan or limits.

let h: Harness;
let root: Browser; // an instance owner
let fay: Browser; // owns a free organization she created on an allowance
let ned: Browser; // an editor there
let free: { slug: string; id: string };
let unlimited: { slug: string };
let P: string; // the free organization's product
let U: string; // the unlimited organization's product
let seeded: string; // a source in the free organization
let etag: string | undefined; // the free organization's limits etag, once they have been changed

const L = "/api/v1/organizations/limits";

/** Change the free organization's limits as the instance owner, from the etag of the moment. */
async function set(patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const r = await root.api("PATCH", L, { tenant: free.slug, limits: patch, ...extra, ...(etag ? { expected_etag: etag } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  etag = r.body.etag;
  return r.body;
}

async function limitsOf(who: Browser, slug = free.slug) {
  return (await who.api("GET", `/api/v1/tenants/${slug}/limits`)).body;
}

const used = async (who: Browser, key: string) => (await limitsOf(who)).limits.find((l: { key: string }) => l.key === key).used as number;

beforeAll(async () => {
  // Sign-up is limited, and nobody but the instance's owner creates organizations unless given an allowance.
  h = await startHarness({ signupAllowlist: ["@example.com"], instanceOwners: ["root@example.com"], defaultTenantAllowance: 0, newOrganizationPlan: "free" });
  root = await h.signIn("root@example.com", "Root Owner");
  const u = await root.api("POST", "/api/v1/tenants", { name: "Unlimited Co" });
  expect(u.body.tenant.plan).toBe("unlimited");
  unlimited = { slug: u.body.tenant.slug };
  U = `/api/v1/p/${(await root.api("POST", `/api/v1/teams/${unlimited.slug}/${u.body.team.slug}/products`, { name: "Roomy" })).body.path}`;

  expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "fay@example.com", allowed: 1, notify: false })).status).toBeLessThan(300);
  fay = await h.signIn("fay@example.com", "Fay Free");
  const f = await fay.api("POST", "/api/v1/tenants", { name: "Free Co" });
  expect(f.status, JSON.stringify(f.body)).toBe(201);
  free = { slug: f.body.tenant.slug, id: f.body.tenant.tenant_id };
  const team = f.body.team.slug;
  P = `/api/v1/p/${(await fay.api("POST", `/api/v1/teams/${free.slug}/${team}/products`, { name: "Snug" })).body.path}`;
  expect((await fay.api("POST", `/api/v1/tenants/${free.slug}/members`, { email: "ned@example.com", role: "editor", team })).status).toBe(201);
  ned = await h.signIn("ned@example.com", "Ned Editor");
  seeded = (await fay.api("POST", `${P}/sources`, { title: "Sample visit notes", tags: ["notes"] })).body.record_id;
}, 120_000);
afterAll(async () => h?.close());

describe("every table that carries a tenant", () => {
  it("is content, or another table with a reason", async () => {
    const r = await sql<{ table_name: string }>`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' order by 1`.execute(h.db);
    const known = new Set<string>([...CONTENT_TABLES, ...Object.keys(OTHER_TENANT_TABLES), "tenants"]);
    expect(r.rows.map((x) => x.table_name).filter((t) => !known.has(t))).toEqual([]);
    // And each listed table exists.
    expect([...known].filter((t) => !r.rows.some((x) => x.table_name === t))).toEqual([]);
  });
});

describe("a day", () => {
  it("runs from midnight UTC to the next", () => {
    expect(dayOf(new Date("2026-10-25T23:59:59.999Z"))).toEqual({ day_start: "2026-10-25T00:00:00.000Z", day_end: "2026-10-26T00:00:00.000Z" });
    expect(dayOf(new Date("2026-12-31T00:00:00.000Z"))).toEqual({ day_start: "2026-12-31T00:00:00.000Z", day_end: "2027-01-01T00:00:00.000Z" });
  });
});

describe("an organization's plan", () => {
  it("is the deployment's plan for new organizations when created on an allowance, and unlimited when an instance owner creates it", async () => {
    const list = (await fay.api("GET", "/api/v1/me/products")).body;
    expect(list.tenants.find((t: { slug: string }) => t.slug === free.slug)).toMatchObject({ plan: "free" });
    // Nobody is anyone's guest: this deployment names no example organization.
    expect(list.tenants.some((t: { example?: boolean }) => t.example)).toBe(false);
    expect((await fay.api("GET", "/api/v1/me")).body.new_organization_plan).toBe("free");
    expect((await root.api("GET", "/api/v1/me")).body.new_organization_plan).toBe("unlimited");
    const orgs = (await root.api("GET", "/api/v1/organizations")).body;
    expect(orgs.new_organization_plan).toBe("free");
    expect(orgs.items.map((o: { slug: string; plan: string }) => [o.slug, o.plan]).sort()).toEqual([[free.slug, "free"], [unlimited.slug, "unlimited"]].sort());
    expect(orgs.free_limits).toEqual(FREE_LIMITS);
    expect(orgs.items.find((o: { slug: string }) => o.slug === free.slug)).toMatchObject({ people: 2, changed_limits: {}, etag: null });
  });

  it("tells every member the limits, what they used today, and whether they meet them", async () => {
    const mine = await limitsOf(ned);
    expect(mine).toMatchObject({ plan: "free", plan_name: "Free", you_meet_them: true });
    expect(mine.limits.map((l: { key: string }) => l.key)).toEqual(LIMITS.map((l) => l.key));
    for (const l of mine.limits) expect(l.value, l.key).toBe(FREE_LIMITS[l.key as keyof typeof FREE_LIMITS]);
    expect(mine.limits.find((l: { key: string }) => l.key === "writes_per_day").used).toBeGreaterThanOrEqual(0);
    expect(mine.limits.find((l: { key: string }) => l.key === "file_max_bytes").used).toBeUndefined();
    expect(Date.parse(mine.allowances_restart_at)).toBe(Date.parse(dayOf(new Date()).day_end));
    expect(mine.deployment_limits.length).toBeGreaterThan(0);
    // The web app picks out the few a person can run into by key.
    const keys = mine.deployment_limits.map((l: { key: string }) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["file_max_bytes", "parse_cap_bytes", "attachments_per_source", "mockups_per_product", "story_pages_per_product"]));
    expect(await limitsOf(root, unlimited.slug)).toMatchObject({ plan: "unlimited", you_meet_them: false });
  });

  it("is listed and changed by instance owners alone", async () => {
    expect((await fay.api("GET", "/api/v1/organizations")).status).toBe(403);
    const raise = await fay.api("PATCH", L, { tenant: free.slug, plan: "unlimited" });
    expect(raise.status).toBe(403);
    expect((await limitsOf(fay)).plan).toBe("free");
    expect((await root.api("PATCH", L, { tenant: "no-such-org", plan: "unlimited" })).status).toBe(404);
  });

  it("guards its limits with an etag once they have been changed", async () => {
    // Never changed: there is no etag to match.
    const early = await root.api("PATCH", L, { tenant: free.slug, limits: { batch_max: 20 }, expected_etag: "made-up" });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: null } });
    const first = await set({ batch_max: 20 });
    expect(first.changed_limits).toEqual({ batch_max: 20 });
    expect(first.etag).toEqual(expect.any(String));
    const missing = await root.api("PATCH", L, { tenant: free.slug, limits: { batch_max: 21 } });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: etag } });
    const stale = await root.api("PATCH", L, { tenant: free.slug, limits: { batch_max: 21 }, expected_etag: "made-up" });
    expect(stale.status).toBe(409);
    // Back to the free plan's, all at once; the record says who changed it.
    const back = await set({}, { reset_limits: true });
    expect(back.changed_limits).toEqual({});
    const listed = (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === free.slug);
    expect(listed).toMatchObject({ etag, limits_updated_by: { display_name: "Root Owner" } });
    const refused = await root.api("PATCH", L, { tenant: free.slug, limits: { writes_per_minute: -1 }, expected_etag: etag });
    expect(refused.status).toBe(422);
  });
});

describe("the free plan's limits", () => {
  it("count writes by the minute for everyone, its owner included, leave reads alone, and say when to come back", async () => {
    await set({ writes_per_minute: 2 });
    try {
      const statuses: number[] = [];
      let last: { status: number; body: any; headers: Headers } | null = null;
      // A minute may turn over during the run, so a third write is allowed for.
      for (let i = 0; i < 5; i++) {
        last = await ned.api("POST", `${P}/outcomes`, { title: `Outcome ${i}` });
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 2)).toEqual([201, 201]);
      expect(last!.status).toBe(429);
      expect(last!.body.error).toMatchObject({ code: "rate_limited", details: { limit: 2, per: "minute" } });
      expect(last!.body.error.message).toMatch(/^This organization's plan allows each person 2 writes a minute/);
      expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await ned.api("GET", `${P}/outcomes`)).status).toBe(200);
      const owner: number[] = [];
      for (let i = 0; i < 5; i++) owner.push((await fay.api("POST", `${P}/outcomes`, { title: `Owner outcome ${i}` })).status);
      expect(owner).toContain(429);
      // An unlimited organization meets none of it.
      for (let i = 0; i < 5; i++) expect((await root.api("POST", `${U}/outcomes`, { title: `Roomy outcome ${i}` })).status).toBe(201);
    } finally {
      await set({ writes_per_minute: FREE_LIMITS.writes_per_minute });
    }
  });

  it("count calls by the minute, reads included", async () => {
    await set({ requests_per_minute: 0 });
    try {
      const r = await ned.api("GET", `${P}/outcomes`);
      expect(r.status).toBe(429);
      expect(r.body.error.message).toMatch(/0 calls a minute/);
      expect((await fay.api("GET", `${P}/outcomes`)).status).toBe(429);
      expect((await root.api("GET", `${U}/outcomes`)).status).toBe(200);
      // A call that names no organization meets no organization's limits.
      expect((await ned.api("GET", "/api/v1/me/products")).status).toBe(200);
    } finally {
      await set({ requests_per_minute: FREE_LIMITS.requests_per_minute });
    }
    expect((await ned.api("GET", `${P}/outcomes`)).status).toBe(200);
  });

  it("give each person a day's writes, sources and exports, and refuse beyond them without touching a read", async () => {
    const before = await used(ned, "writes_per_day");
    const fays = await used(fay, "writes_per_day");
    await set({ writes_per_day: before + 1 });
    expect((await ned.api("POST", `${P}/outcomes`, { title: "The last one today" })).status).toBe(201);
    const over = await ned.api("POST", `${P}/outcomes`, { title: "One too many" });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "writes_per_day", limit: before + 1, used: before + 1, unit: "writes" } });
    expect(over.body.error.details.resets_at).toBe(dayOf(new Date()).day_end);
    // A refused write took nothing from the allowance, and reads and search go on.
    expect(await used(ned, "writes_per_day")).toBe(before + 1);
    expect((await ned.api("GET", `${P}/search?query=visit`)).status).toBe(200);
    // Each person's allowance is their own: Ned's writes took nothing from Fay's.
    expect(await used(fay, "writes_per_day")).toBe(fays);
    // The day's writes never stop an export, which has an allowance of its own.
    await set({ exports_per_day: 1 });
    expect((await ned.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    const again = await ned.api("POST", `${P}/exports`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details).toMatchObject({ quota: "exports_per_day", limit: 1, used: 1 });

    await set({ writes_per_day: 100000, exports_per_day: FREE_LIMITS.exports_per_day });
    const sources = await used(ned, "sources_per_day");
    await set({ sources_per_day: sources + 1 });
    expect((await ned.api("POST", `${P}/sources`, { title: "Sample source within the allowance", tags: ["notes"] })).status).toBe(201);
    const source = await ned.api("POST", `${P}/sources`, { title: "Sample source over the allowance", tags: ["notes"] });
    expect(source.status).toBe(409);
    expect(source.body.error.details).toMatchObject({ quota: "sources_per_day", limit: sources + 1, used: sources + 1 });
    await set({ sources_per_day: 100 });
  });

  it("count every source of a batch against the day's sources, and add none of a batch that would pass it", async () => {
    const batch = (label: string, n: number) => ({ sources: Array.from({ length: n }, (_, i) => ({ title: `Sample ${label} ${i + 1}`, path: `${label}-${i + 1}.md`, tags: ["notes"] })) });
    const before = await used(ned, "sources_per_day");
    await set({ sources_per_day: before + 3 });
    const two = await ned.api("POST", `${P}/sources/with-uploads`, batch("first-batch", 2));
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    expect(await used(ned, "sources_per_day")).toBe(before + 2);
    const over = await ned.api("POST", `${P}/sources/with-uploads`, batch("refused-batch", 2));
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sources_per_day", limit: before + 3, used: before + 2, unit: "sources" } });
    expect(over.body.error.message).toMatch(/new sources a day, and this call would add 2 with 1 left today\./);
    expect(await used(ned, "sources_per_day")).toBe(before + 2);
    await set({ sources_per_day: 100 });
  });

  it("count writes from everyone together against the organization's day", async () => {
    const all = (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === free.slug).today.writes as number;
    await set({ org_writes_per_day: all + 1 });
    try {
      expect((await fay.api("POST", `${P}/outcomes`, { title: "The organization's last write today" })).status).toBe(201);
      const over = await ned.api("POST", `${P}/outcomes`, { title: "Past the organization's day" });
      expect(over.status).toBe(409);
      expect(over.body.error.details).toMatchObject({ quota: "org_writes_per_day", limit: all + 1 });
      expect(over.body.error.message).toMatch(/writes a day from everyone together/);
    } finally {
      await set({ org_writes_per_day: FREE_LIMITS.org_writes_per_day });
    }
  });

  it("refuse what a limit of 0 switches off as off, not as an allowance used up", async () => {
    await set({ exports_per_day: 0 });
    try {
      const off = await fay.api("POST", `${P}/exports`, {});
      expect(off.status).toBe(403);
      expect(off.body.error).toMatchObject({ code: "plan_restricted", details: { setting: "exports_per_day", limit: 0 } });
      expect(off.body.error.message).toMatch(/^Exporting a product is off on this organization's plan\./);
      expect(off.body.error.message).not.toMatch(/starts again/);
      const listed = (await limitsOf(fay)).limits as { key: string; refusal: string }[];
      expect(listed.find((l) => l.key === "exports_per_day")?.refusal).toBe("403 plan_restricted");
      expect(listed.find((l) => l.key === "sources_per_day")?.refusal).toBe("409 quota_exceeded");
      await set({ exports_per_day: FREE_LIMITS.exports_per_day, writes_per_day: 0 });
      const write = await ned.api("POST", `${P}/outcomes`, { title: "While writing is off" });
      expect(write.status).toBe(403);
      expect(write.body.error.message).toMatch(/^Writing is off on this organization's plan\./);
      // A preview asks as a write does.
      const preview = await ned.api("POST", `${P}/story/pages/visit/preview`, { title: "A visit", body: "<main class=\"page\"><p>Text.</p></main>" });
      expect(preview.body.error).toMatchObject({ code: "plan_restricted", details: { setting: "writes_per_day" } });
      await set({ writes_per_day: 100000, bytes_per_day: 0 });
      const file = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "more.md", size: 10 });
      expect(file.status).toBe(403);
      expect(file.body.error.details).toMatchObject({ setting: "bytes_per_day" });
      expect((await ned.api("GET", `${P}/outcomes`)).status).toBe(200);
    } finally {
      await set({}, { reset_limits: true });
    }
  });

  it("limit how much one call carries", async () => {
    await set({ text_max_chars: 50, batch_max: 1 });
    try {
      const long = await fay.api("POST", `${P}/assumptions`, { statement: "Too long", body: "x".repeat(51) });
      expect(long.status).toBe(413);
      expect(long.body.error.details).toMatchObject({ field: "body", limit: 50, unit: "characters" });
      const batch = await fay.api("POST", `${P}/sources/archive`, { record_ids: [seeded, "01ARZ3NDEKTSV4RRFFQ69G5FAV"] });
      expect(batch.status).toBe(413);
      expect(batch.body.error.details).toMatchObject({ field: "record_ids", limit: 1 });
      expect((await root.api("POST", `${U}/assumptions`, { statement: "Unlimited writes at length", body: "x".repeat(500) })).status).toBe(201);
      // A canvas uploaded as a ZIP would carry text past the cap on a field.
      expect((await fay.api("POST", `${P}/mockups/uploads`, {})).body.error.code).toBe("plan_restricted");
    } finally {
      await set({}, { reset_limits: true });
    }
  });

  it("limit what is uploaded: the kind of file, its size and the day's bytes, and the fetching of a URL", async () => {
    const recording = await ned.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Sample recording", path: "call.m4a" });
    expect(recording.status).toBe(403);
    expect(recording.body.error.code).toBe("plan_restricted");
    await set({ fetch_url: false });
    const fetched = await ned.api("POST", `${P}/sources/${seeded}/fetch`, { url: "https://example.com/notes.txt" });
    expect(fetched.status).toBe(403);
    expect(fetched.body.error.message).toMatch(/^Fetching a file from a URL is off on this organization's plan/);

    await set({ fetch_url: true, file_max_bytes: 100 });
    const declared = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "big.md", size: 101 });
    expect(declared.status).toBe(413);
    const grant = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "big.md" });
    expect(grant.status).toBe(201);
    expect(grant.body.max_bytes).toBe(100);
    expect(grant.body.direct).toBeUndefined();
    // The relay enforces the size as the bytes arrive, whatever the caller declared.
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "y".repeat(101) })).status).toBe(413);
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "y".repeat(100) })).status).toBe(201);
    const bytes = await used(ned, "bytes_per_day");
    expect(bytes).toBeGreaterThanOrEqual(100);

    await set({ file_max_bytes: 1000, bytes_per_day: bytes + 50 });
    expect((await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "more.md" })).body.max_bytes).toBe(50);
    await set({ bytes_per_day: bytes });
    const none = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "none.md" });
    expect(none.status).toBe(409);
    expect(none.body.error.details).toMatchObject({ quota: "bytes_per_day", limit: bytes, used: bytes, unit: "bytes" });
    // In an unlimited organization a grant may go straight to the store when it can.
    await set({}, { reset_limits: true });
  });

  it("stop applying once an instance owner moves the organization to the unlimited plan, from the next call", async () => {
    await set({ writes_per_minute: 0 });
    expect((await ned.api("POST", `${P}/outcomes`, { title: "Not now" })).status).toBe(429);
    await set({}, { plan: "unlimited" });
    expect((await limitsOf(ned)).you_meet_them).toBe(false);
    expect((await ned.api("POST", `${P}/outcomes`, { title: "Unlimited now" })).status).toBe(201);
    await set({}, { plan: "free", reset_limits: true });
    expect((await limitsOf(ned)).plan).toBe("free");
  });
});

describe("a deployment that leaves the plan of new organizations as it is", () => {
  let d: Harness;
  beforeAll(async () => {
    d = await startHarness({ instanceOwners: ["root@example.com"] });
  });
  afterAll(async () => d?.close());

  it("makes an allowance holder's new organization unlimited, and says so", async () => {
    const someone = await d.signIn("kim@example.com", "Kim Allowed");
    expect((await someone.api("GET", "/api/v1/me")).body.new_organization_plan).toBe("unlimited");
    const t = await someone.api("POST", "/api/v1/tenants", { name: "Kim Co" });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.tenant.plan).toBe("unlimited");
    expect((await someone.api("GET", `/api/v1/tenants/${t.body.tenant.slug}/limits`)).body).toMatchObject({ plan: "unlimited", you_meet_them: false });
    const root = await d.signIn("root@example.com", "Root Owner");
    expect((await root.api("GET", "/api/v1/organizations")).body.new_organization_plan).toBe("unlimited");
  });
});
