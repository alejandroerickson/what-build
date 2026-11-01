import { CONTENT_TABLES, dayOf, definedPlans, LIMITS, OTHER_TENANT_TABLES, type Limits } from "@whatbuild/core";
import { plansFrom } from "../src/plans-config.ts";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXAMPLE_PLANS, startHarness, type Browser, type Harness } from "./harness.ts";

// An organization created on an allowance is on the free plan, whose limits everyone in it meets,
// its owners included. Limits belong to plans: only an instance owner moves an organization to another
// plan, and nobody changes one organization's limits. A test changes a plan's limits as the code would,
// and puts them back.

let h: Harness;
let root: Browser; // an instance owner
let fay: Browser; // owns a free organization she created on an allowance
let ned: Browser; // an editor there
let free: { slug: string; id: string };
let unlimited: { slug: string };
let P: string; // the free organization's product
let U: string; // the unlimited organization's product
let seeded: string; // a source in the free organization
let team: string; // the free organization's team
let etag: string | undefined; // the free organization's plan etag, once it has been changed

const L = "/api/v1/organizations/plan";
// The example plans file's Free and Pro, which every harness offers.
const [FREE_AS_SHIPPED, PRO_AS_SHIPPED] = plansFrom(EXAMPLE_PLANS).map((p) => p.limits) as [Limits, Limits];
/** The free plan as the running server has it, which a test changes as the deployment's configuration would. */
const freePlan = () => definedPlans().find((p) => p.id === "free")!.limits;
/** The free plan as these tests run on it: as it ships, but with calls and writes a minute to spare for a test's many. */
const BASE: Limits = { ...FREE_AS_SHIPPED, requests_per_minute: 10_000, writes_per_minute: 10_000 };

/** Change the free plan's limits, as a change to the deployment's configuration would, for every organization on it. */
function tweak(patch: Partial<Limits>) {
  Object.assign(freePlan(), patch);
}
/** Put the free plan's limits back as these tests run on it. */
function reset() {
  Object.assign(freePlan(), BASE);
}

/** Move the free organization to a plan as the instance owner, from the etag of the moment. */
async function move(plan: "free" | "pro" | "unlimited") {
  const r = await root.api("PATCH", L, { tenant: free.slug, plan, ...(etag ? { expected_etag: etag } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  etag = r.body.etag ?? etag;
  return r.body;
}

async function limitsOf(who: Browser, slug = free.slug) {
  return (await who.api("GET", `/api/v1/tenants/${slug}/limits`)).body;
}

const used = async (who: Browser, key: string) => (await limitsOf(who)).limits.find((l: { key: string }) => l.key === key).used as number;

beforeAll(async () => {
  // Sign-up is limited, and nobody but the instance's owner creates organizations unless given an allowance.
  h = await startHarness({ signupAllowlist: ["@example.com"], instanceOwners: ["root@example.com"], defaultTenantAllowance: 0, newOrganizationPlan: "free" });
  reset();
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
  team = f.body.team.slug;
  P = `/api/v1/p/${(await fay.api("POST", `/api/v1/teams/${free.slug}/${team}/products`, { name: "Snug" })).body.path}`;
  expect((await fay.api("POST", `/api/v1/tenants/${free.slug}/members`, { email: "ned@example.com", role: "editor", team })).status).toBe(201);
  ned = await h.signIn("ned@example.com", "Ned Editor");
  seeded = (await fay.api("POST", `${P}/sources`, { title: "Sample visit notes", tags: ["notes"] })).body.record_id;
}, 120_000);
afterAll(async () => {
  if (definedPlans().length) Object.assign(freePlan(), FREE_AS_SHIPPED);
  await h?.close();
});

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
    expect(orgs.plans.map((p: { id: string }) => p.id)).toEqual(["free", "pro"]);
    expect(orgs.plans[0].limits).toEqual(freePlan());
    expect(orgs.items.find((o: { slug: string }) => o.slug === free.slug)).toMatchObject({ holds: { members: 2, products: 1, sources: 1 }, etag: null });
  });

  it("tells every member the limits, what they used today, and whether they meet them", async () => {
    const mine = await limitsOf(ned);
    expect(mine).toMatchObject({ plan: "free", plan_name: "Free", you_meet_them: true });
    expect(mine.limits.map((l: { key: string }) => l.key)).toEqual(LIMITS.map((l) => l.key));
    for (const l of mine.limits) expect(l.value, l.key).toBe(freePlan()[l.key as keyof Limits]);
    expect(mine.holds).toMatchObject({ members: 2, products: 1, sources: 1 });
    expect(mine.limits.find((l: { key: string }) => l.key === "members_max").used).toBe(2);
    expect(mine.plans.map((p: { id: string }) => p.id)).toEqual(["free", "pro"]);
    expect(mine.limits.find((l: { key: string }) => l.key === "writes_per_day").used).toBeGreaterThanOrEqual(0);
    expect(mine.limits.find((l: { key: string }) => l.key === "file_max_bytes").used).toBeUndefined();
    expect(Date.parse(mine.allowances_restart_at)).toBe(Date.parse(dayOf(new Date()).day_end));
    expect(mine.deployment_limits.length).toBeGreaterThan(0);
    // The web app picks out the few a person can run into by key.
    const keys = mine.deployment_limits.map((l: { key: string }) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["file_max_bytes", "parse_cap_bytes", "attachments_per_source", "mockups_per_product", "story_pages_per_product"]));
    // Nobody meets them on the unlimited plan, and what each person does there is counted all the same.
    const roomy = await limitsOf(root, unlimited.slug);
    expect(roomy).toMatchObject({ plan: "unlimited", you_meet_them: false });
    expect(roomy.limits.every((l: { value: unknown }) => l.value === null)).toBe(true);
    expect(roomy.limits.find((l: { key: string }) => l.key === "writes_per_day").used).toBeGreaterThan(0);
  });

  it("is listed and changed by instance owners alone", async () => {
    expect((await fay.api("GET", "/api/v1/organizations")).status).toBe(403);
    const raise = await fay.api("PATCH", L, { tenant: free.slug, plan: "unlimited" });
    expect(raise.status).toBe(403);
    expect((await limitsOf(fay)).plan).toBe("free");
    expect((await root.api("PATCH", L, { tenant: "no-such-org", plan: "unlimited" })).status).toBe(404);
  });

  it("guards its plan with an etag once it has been changed, and takes no limits of one organization's own", async () => {
    // Never changed: there is no etag to match.
    const early = await root.api("PATCH", L, { tenant: free.slug, plan: "pro", expected_etag: "made-up" });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: null } });
    const pro = await move("pro");
    expect(pro).toMatchObject({ plan: "pro", plan_name: "Pro" });
    expect(pro.etag).toEqual(expect.any(String));
    expect((await limitsOf(ned)).limits.find((l: { key: string }) => l.key === "members_max").value).toBe(PRO_AS_SHIPPED.members_max);
    const missing = await root.api("PATCH", L, { tenant: free.slug, plan: "free" });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: etag } });
    expect((await root.api("PATCH", L, { tenant: free.slug, plan: "free", expected_etag: "made-up" })).status).toBe(409);
    // One organization's own limits are no longer a thing anyone sets.
    expect((await root.api("PATCH", L, { tenant: free.slug, plan: "free", limits: { writes_per_day: 1 }, expected_etag: etag })).status).toBe(422);
    expect((await root.api("PATCH", "/api/v1/organizations/limits", { tenant: free.slug, plan: "free" })).status).toBe(404);
    await move("free");
    const listed = (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === free.slug);
    expect(listed).toMatchObject({ plan: "free", etag, plan_changed_by: { display_name: "Root Owner" } });
  });
});

describe("a frame refused for the minute's calls", () => {
  // Refused before anything is looked up, so no page need exist at these addresses.
  const PAGES = [
    ["a Story page", () => `${P}/story/pages/overview/versions/1/html`],
    ["a page of a canvas on the Story", () => `${P}/story/pages/overview/versions/1/pages/board/html`],
    ["a mockup page", () => `${P}/mockups/01ARZ3NDEKTSV4RRFFQ69G5FAV/versions/1/pages/board/html`],
  ] as const;
  const OTHER_FRAMES = [
    ["the product concept's card", () => `${P}/idea/concept/card`],
    ["an outcome's card", () => `${P}/outcomes/01ARZ3NDEKTSV4RRFFQ69G5FAV/card`],
    ["the Story style's specimen", () => `${P}/story/style/specimen`],
    ["a house style's specimen", () => `${P}/story/house-styles/clear/specimen`],
  ] as const;
  const FRAME = { "sec-fetch-dest": "iframe", accept: "text/html" };

  /** The refusal's own fields, read from what the document's script tells the app. */
  function toldToTheApp(html: string) {
    const told = /postMessage\((\{.*?\}),"\*"\)/.exec(html);
    expect(told, html).not.toBeNull();
    return JSON.parse(told![1]!) as { whatbuild: string; retry_after_seconds: number; limit: number };
  }

  it("answers a short page in the product's words, with the refusal's status and wait, and never the JSON", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      for (const [what, path] of PAGES) {
        const r = await ned.api("GET", `${path()}?frame=1`);
        expect(r.status, what).toBe(429);
        expect(r.headers.get("content-type"), what).toMatch(/^text\/html/);
        expect(Number(r.headers.get("retry-after")), what).toBeGreaterThan(0);
        const html = r.body as unknown as string;
        expect(html, what).toMatch(/^<!doctype html>/i);
        expect(html, what).toContain("Waiting for the next minute");
        expect(html, what).toContain("this minute’s calls");
        for (const inner of ["rate_limited", "\"error\"", "requests_per_minute"]) expect(html, what).not.toContain(inner);
        const told = toldToTheApp(html);
        expect(told, what).toMatchObject({ whatbuild: "frame-refused", limit: 0 });
        expect(told.retry_after_seconds, what).toBe(Number(r.headers.get("retry-after")));
      }
    } finally {
      reset();
    }
  });

  it("holds nothing that loads, navigates or reloads, and runs in a sandbox as narrow as any frame's", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      const { body, headers } = await ned.api("GET", `${P}/story/pages/overview/versions/1/html?frame=1&theme=dark`);
      const html = body as unknown as string;
      // The document never asks again by itself: only the app that framed it may, a bounded number of times.
      for (const way of ["location", "reload", "http-equiv", "setTimeout", "setInterval", "fetch(", "<a ", "<form", "<img", "src=", "href="]) expect(html).not.toContain(way);
      expect(html).toContain('data-wb-theme="dark"');
      const csp = headers.get("content-security-policy")!;
      expect(csp).toMatch(/^sandbox allow-scripts; default-src 'none';/);
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(headers.get("cross-origin-embedder-policy")).toBe("credentialless");
      expect(headers.get("cache-control")).toBe("no-store");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      reset();
    }
  });

  it("takes only light or dark from the address", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      const html = (await ned.api("GET", `${P}/story/pages/overview/versions/1/html?frame=1&theme=${encodeURIComponent('"><script>x</script>')}`)).body as unknown as string;
      expect(html).not.toContain("<script>x");
      expect(html).toContain('<html lang="en"><head>');
    } finally {
      reset();
    }
  });

  it("is told apart by the browser where the frame's address does not say", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      for (const [what, path] of [...PAGES, ...OTHER_FRAMES]) {
        const r = await ned.api("GET", path(), undefined, FRAME);
        expect(r.status, what).toBe(429);
        expect(r.headers.get("content-type"), what).toMatch(/^text\/html/);
        expect(toldToTheApp(r.body as unknown as string).whatbuild, what).toBe("frame-refused");
      }
    } finally {
      reset();
    }
  });

  it("still gives agents and API callers the JSON error, at the same addresses", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      for (const [what, path] of [...PAGES, ...OTHER_FRAMES]) {
        for (const headers of [{}, { accept: "application/json" }, { accept: "text/html" }, { "sec-fetch-dest": "document", accept: "text/html" }, { "sec-fetch-dest": "empty" }] as Record<string, string>[]) {
          const r = await ned.api("GET", path(), undefined, headers);
          expect(r.status, what).toBe(429);
          expect(r.headers.get("content-type"), what).toMatch(/^application\/json/);
          expect(r.body.error, what).toMatchObject({ code: "rate_limited", details: { limit: 0, per: "minute" } });
          expect(r.body.error.details.retry_after_seconds, what).toBeGreaterThan(0);
          expect(Number(r.headers.get("retry-after")), what).toBeGreaterThan(0);
        }
      }
      // An operation's refusal is JSON whatever the request says of itself.
      const op = await ned.api("GET", `${P}/outcomes?frame=1`, undefined, FRAME);
      expect(op.headers.get("content-type")).toMatch(/^application\/json/);
      expect(op.body.error.code).toBe("rate_limited");
    } finally {
      reset();
    }
  });

  it("changes no other answer a frame gets, and spares a frame nothing: its call counts and is refused like any other", async () => {
    const missing = await ned.api("GET", `${P}/story/pages/no-such-page/versions/1/html?frame=1`, undefined, FRAME);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toMatch(/^application\/json/);
    const stranger = await root.api("GET", `${P}/story/pages/overview/versions/1/html?frame=1`, undefined, FRAME);
    expect(stranger.status).toBe(404);
    expect(stranger.headers.get("content-type")).toMatch(/^application\/json/);
    // What frames spend leaves that much less for reads.
    tweak({ requests_per_minute: 3 });
    try {
      const framesThenARead = async () => {
        for (let i = 0; i < 3; i++) await ned.api("GET", `${P}/story/pages/overview/versions/1/html?frame=1`);
        return (await ned.api("GET", `${P}/outcomes`)).status;
      };
      // A minute may turn over during the run, so a second go is allowed for.
      const first = await framesThenARead();
      expect(first === 429 ? first : await framesThenARead()).toBe(429);
    } finally {
      reset();
    }
  });

  it("in an attachment's preview, says what to do, since no script runs there to bring it back", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      for (const route of ["attachment", "attachment/view"]) {
        const r = await ned.api("GET", `${P}/sources/${seeded}/${route}?path=notes.pdf`, undefined, FRAME);
        expect(r.status, route).toBe(429);
        expect(r.headers.get("content-type"), route).toMatch(/^text\/html/);
        const html = r.body as unknown as string;
        expect(html, route).toContain("Close this preview");
        expect(html, route).not.toContain("<script");
        expect(r.headers.get("content-security-policy"), route).toMatch(/^sandbox ?; default-src 'none';/);
        // An image, a video or a download keeps the JSON, as an API caller's does.
        const asImage = await ned.api("GET", `${P}/sources/${seeded}/${route}?path=notes.pdf`, undefined, { "sec-fetch-dest": "image" });
        expect(asImage.headers.get("content-type"), route).toMatch(/^application\/json/);
      }
    } finally {
      reset();
    }
  });
});

describe("the free plan's limits", () => {
  it("count writes by the minute for everyone, its owner included, leave reads alone, and say when to come back", async () => {
    tweak({ writes_per_minute: 2 });
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
      reset();
    }
  });

  it("count calls by the minute, reads included", async () => {
    tweak({ requests_per_minute: 0 });
    try {
      const r = await ned.api("GET", `${P}/outcomes`);
      expect(r.status).toBe(429);
      expect(r.body.error.message).toMatch(/0 calls a minute/);
      expect((await fay.api("GET", `${P}/outcomes`)).status).toBe(429);
      expect((await root.api("GET", `${U}/outcomes`)).status).toBe(200);
      // A call that names no organization meets no organization's limits.
      expect((await ned.api("GET", "/api/v1/me/products")).status).toBe(200);
    } finally {
      reset();
    }
    expect((await ned.api("GET", `${P}/outcomes`)).status).toBe(200);
  });

  it("give each person a day's writes, sources and exports, and refuse beyond them without touching a read", async () => {
    const before = await used(ned, "writes_per_day");
    const fays = await used(fay, "writes_per_day");
    tweak({ writes_per_day: before + 1 });
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
    tweak({ exports_per_day: 1 });
    expect((await ned.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    const again = await ned.api("POST", `${P}/exports`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details).toMatchObject({ quota: "exports_per_day", limit: 1, used: 1 });

    tweak({ writes_per_day: 100000, exports_per_day: BASE.exports_per_day });
    const sources = await used(ned, "sources_per_day");
    tweak({ sources_per_day: sources + 1 });
    expect((await ned.api("POST", `${P}/sources`, { title: "Sample source within the allowance", tags: ["notes"] })).status).toBe(201);
    const source = await ned.api("POST", `${P}/sources`, { title: "Sample source over the allowance", tags: ["notes"] });
    expect(source.status).toBe(409);
    expect(source.body.error.details).toMatchObject({ quota: "sources_per_day", limit: sources + 1, used: sources + 1 });
    tweak({ sources_per_day: 100 });
  });

  it("count every source of a batch against the day's sources, and add none of a batch that would pass it", async () => {
    const batch = (label: string, n: number) => ({ sources: Array.from({ length: n }, (_, i) => ({ title: `Sample ${label} ${i + 1}`, path: `${label}-${i + 1}.md`, tags: ["notes"] })) });
    const before = await used(ned, "sources_per_day");
    tweak({ sources_per_day: before + 3 });
    const two = await ned.api("POST", `${P}/sources/with-uploads`, batch("first-batch", 2));
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    expect(await used(ned, "sources_per_day")).toBe(before + 2);
    const over = await ned.api("POST", `${P}/sources/with-uploads`, batch("refused-batch", 2));
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sources_per_day", limit: before + 3, used: before + 2, unit: "sources" } });
    expect(over.body.error.message).toMatch(/new sources a day, and this call would add 2 with 1 left today\./);
    expect(await used(ned, "sources_per_day")).toBe(before + 2);
    tweak({ sources_per_day: 100 });
  });

  it("count writes from everyone together against the organization's day", async () => {
    const all = (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === free.slug).today.writes as number;
    tweak({ org_writes_per_day: all + 1 });
    try {
      expect((await fay.api("POST", `${P}/outcomes`, { title: "The organization's last write today" })).status).toBe(201);
      const over = await ned.api("POST", `${P}/outcomes`, { title: "Past the organization's day" });
      expect(over.status).toBe(409);
      expect(over.body.error.details).toMatchObject({ quota: "org_writes_per_day", limit: all + 1 });
      expect(over.body.error.message).toMatch(/writes a day from everyone together/);
    } finally {
      reset();
    }
  });

  it("refuse what a limit of 0 switches off as off, not as an allowance used up", async () => {
    tweak({ exports_per_day: 0 });
    try {
      const off = await fay.api("POST", `${P}/exports`, {});
      expect(off.status).toBe(403);
      expect(off.body.error).toMatchObject({ code: "plan_restricted", details: { setting: "exports_per_day", limit: 0 } });
      expect(off.body.error.message).toMatch(/^Exporting a product is off on this organization's plan\./);
      expect(off.body.error.message).not.toMatch(/starts again/);
      const listed = (await limitsOf(fay)).limits as { key: string; refusal: string }[];
      expect(listed.find((l) => l.key === "exports_per_day")?.refusal).toBe("403 plan_restricted");
      expect(listed.find((l) => l.key === "sources_per_day")?.refusal).toBe("409 quota_exceeded");
      tweak({ exports_per_day: BASE.exports_per_day, writes_per_day: 0 });
      const write = await ned.api("POST", `${P}/outcomes`, { title: "While writing is off" });
      expect(write.status).toBe(403);
      expect(write.body.error.message).toMatch(/^Writing is off on this organization's plan\./);
      // A preview asks as a write does.
      const preview = await ned.api("POST", `${P}/story/pages/visit/preview`, { title: "A visit", body: "<main class=\"page\"><p>Text.</p></main>" });
      expect(preview.body.error).toMatchObject({ code: "plan_restricted", details: { setting: "writes_per_day" } });
      tweak({ writes_per_day: 100000, bytes_per_day: 0 });
      const file = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "more.md", size: 10 });
      expect(file.status).toBe(403);
      expect(file.body.error.details).toMatchObject({ setting: "bytes_per_day" });
      expect((await ned.api("GET", `${P}/outcomes`)).status).toBe(200);
    } finally {
      reset();
    }
  });

  it("limit how much one call carries", async () => {
    tweak({ text_max_chars: 50, batch_max: 1 });
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
      reset();
    }
  });

  it("limit what is uploaded: the kind of file, its size and the day's bytes, and the fetching of a URL", async () => {
    const recording = await ned.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Sample recording", path: "call.m4a" });
    expect(recording.status).toBe(403);
    expect(recording.body.error.code).toBe("plan_restricted");
    tweak({ fetch_url: false });
    const fetched = await ned.api("POST", `${P}/sources/${seeded}/fetch`, { url: "https://example.com/notes.txt" });
    expect(fetched.status).toBe(403);
    expect(fetched.body.error.message).toMatch(/^Fetching a file from a URL is off on this organization's plan/);

    tweak({ fetch_url: true, file_max_bytes: 100 });
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

    tweak({ file_max_bytes: 1000, bytes_per_day: bytes + 50 });
    expect((await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "more.md" })).body.max_bytes).toBe(50);
    tweak({ bytes_per_day: bytes });
    const none = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "none.md" });
    expect(none.status).toBe(409);
    expect(none.body.error.details).toMatchObject({ quota: "bytes_per_day", limit: bytes, used: bytes, unit: "bytes" });
    // In an unlimited organization a grant may go straight to the store when it can.
    reset();
  });

  it("meet, after a move to the free plan during a day, what was used that day while the organization was unlimited", async () => {
    reset();
    await move("unlimited");
    // Counted on the unlimited plan too, and said so, though nobody meets the limits there.
    const mine = await limitsOf(ned);
    expect(mine).toMatchObject({ plan: "unlimited", you_meet_them: false });
    const writes = await used(ned, "writes_per_day");
    const sources = await used(ned, "sources_per_day");
    const bytes = await used(ned, "bytes_per_day");
    const orgWrites = await used(ned, "org_writes_per_day");
    const today = async () => (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === free.slug).today;
    const everyone = await today();
    for (let i = 0; i < 3; i++) expect((await ned.api("POST", `${P}/outcomes`, { title: `Written while unlimited ${i + 1}` })).status).toBe(201);
    expect((await ned.api("POST", `${P}/sources`, { title: "Sample source added while unlimited", tags: ["notes"] })).status).toBe(201);
    const grant = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "while-unlimited.md" });
    expect(grant.status).toBe(201);
    // Through the relay, outside execute, the file still counts against whoever asked for the grant.
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "z".repeat(40) })).status).toBe(201);
    expect(await used(ned, "writes_per_day")).toBe(writes + 5);
    expect(await used(ned, "sources_per_day")).toBe(sources + 1);
    expect(await used(ned, "bytes_per_day")).toBe(bytes + 40);
    expect(await used(ned, "org_writes_per_day")).toBe(orgWrites + 5);
    expect(await today()).toMatchObject({ writes: everyone.writes + 5, sources: everyone.sources + 1, bytes: everyone.bytes + 40 });

    // Moved to the free plan the same day, the day's allowances start from what it already used.
    await move("free");
    expect(await limitsOf(ned)).toMatchObject({ plan: "free", you_meet_them: true });
    expect(await used(ned, "writes_per_day")).toBe(writes + 5);
    expect(await used(ned, "bytes_per_day")).toBe(bytes + 40);
    tweak({ writes_per_day: writes + 6, sources_per_day: sources + 1 });
    try {
      const source = await ned.api("POST", `${P}/sources`, { title: "Sample source past the allowance", tags: ["notes"] });
      expect(source.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sources_per_day", limit: sources + 1, used: sources + 1 } });
      expect((await ned.api("POST", `${P}/outcomes`, { title: "The last write today" })).status).toBe(201);
      const over = await ned.api("POST", `${P}/outcomes`, { title: "Past the day's writes" });
      expect(over.status).toBe(409);
      expect(over.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "writes_per_day", limit: writes + 6, used: writes + 6 } });
    } finally {
      reset();
    }
  });

  it("stop applying once an instance owner moves the organization to the unlimited plan, from the next call", async () => {
    tweak({ writes_per_minute: 0 });
    expect((await ned.api("POST", `${P}/outcomes`, { title: "Not now" })).status).toBe(429);
    await move("unlimited");
    expect((await limitsOf(ned)).you_meet_them).toBe(false);
    expect((await ned.api("POST", `${P}/outcomes`, { title: "Unlimited now" })).status).toBe(201);
    reset();
    await move("free");
    expect((await limitsOf(ned)).plan).toBe("free");
  });
});

describe("the plans offered", () => {
  it("are public, with every limit and the price an instance owner set", async () => {
    expect((await fay.api("PATCH", "/api/v1/plans", { plan: "pro", price: "$49 a month" })).status).toBe(403);
    const priced = await root.api("PATCH", "/api/v1/plans", { plan: "pro", price: "$49 a month" });
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    const r = await fetch(`${h.baseUrl}/api/v1/plans`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { plans: unknown[]; limits: { key: string }[]; file_max_bytes: number };
    expect(body.plans).toEqual([
      expect.objectContaining({ id: "free", name: "Free", price: null, limits: freePlan() }),
      expect.objectContaining({ id: "pro", name: "Pro", price: "$49 a month", limits: PRO_AS_SHIPPED }),
    ]);
    expect(body.limits.map((l) => l.key)).toEqual(LIMITS.map((l) => l.key));
    expect(body.file_max_bytes).toBe(h.config.fileMaxBytes);
  });

  it("are changed by an instance owner alone, for every organization on a plan, under the plan's etag", async () => {
    const records = async () => (await root.api("GET", "/api/v1/organizations")).body.plan_records;
    const first = (await records()).free;
    expect(first.etag).toBeNull();
    expect((await fay.api("PATCH", "/api/v1/plans", { plan: "free", limits: { sources_max: 75 } })).status).toBe(403);
    const raised = await root.api("PATCH", "/api/v1/plans", { plan: "free", limits: { sources_max: 75, storage_max_bytes: null } });
    expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    // Every organization on the plan meets it from the next call; none has limits of its own.
    const mine = await limitsOf(ned);
    expect(mine.limits.find((l: { key: string }) => l.key === "sources_max").value).toBe(75);
    expect(mine.limits.find((l: { key: string }) => l.key === "storage_max_bytes").value).toBeNull();
    const etag = (await records()).free.etag as string;
    expect((await records()).free.changed).toEqual({ sources_max: 75, storage_max_bytes: null });
    const stale = await root.api("PATCH", "/api/v1/plans", { plan: "free", limits: { sources_max: 80 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: etag } });
    expect((await root.api("PATCH", "/api/v1/plans", { plan: "free", limits: { sources_max: -1 }, expected_etag: etag })).status).toBe(422);
    expect((await root.api("PATCH", "/api/v1/plans", { plan: "unlimited", limits: { sources_max: 1 } })).status).toBe(422);
    // Back to the defaults, all at once.
    const back = await root.api("PATCH", "/api/v1/plans", { plan: "free", reset: true, expected_etag: etag });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await records()).free.changed).toEqual({});
    expect((await limitsOf(ned)).limits.find((l: { key: string }) => l.key === "sources_max").value).toBe(BASE.sources_max);
  });
});

describe("the totals of a plan", () => {
  afterAll(() => reset());

  it("count the people who do more than read the Story, invitations included, and refuse one more", async () => {
    const add = (email: string, role: string) => fay.api("POST", `/api/v1/tenants/${free.slug}/members`, { email, role, team });
    // The free plan allows 2: Fay and Ned.
    const third = await add("ola@example.com", "editor");
    expect(third.status).toBe(409);
    expect(third.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "members_max", limit: 2, used: 2, unit: "people" } });
    expect(third.body.error.message).toMatch(/Readers of the Story don't count/);
    // A reader takes no place, and someone already in it changes role without taking another.
    expect((await add("rae@example.com", "reader")).status).toBe(201);
    expect((await add("ned@example.com", "editor")).status).toBeLessThan(300);
    // An invitation holds its place until it is accepted.
    tweak({ members_max: 3 });
    expect((await add("ola@example.com", "editor")).status).toBe(201);
    const fourth = await add("pat@example.com", "editor");
    expect(fourth.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "members_max", limit: 3, used: 3 } });
    expect(fourth.body.error.message).toMatch(/it has 2 and 1 invited/);
    reset();
  });

  /** Delete a product as an admin does, name typed. */
  const deleteProduct = async (who: Browser, path: string, name: string) => {
    const { etag } = (await who.api("GET", `${path}/delete-impact`)).body;
    return who.api("DELETE", path, { expected_etag: etag, name, reason: "A test product", confirm: "delete permanently" });
  };
  /** Delete a source as an admin does. */
  const deleteSource = async (who: Browser, record_id: string) => {
    const { etag } = (await fay.api("GET", `${P}/sources/${record_id}`)).body;
    return who.api("DELETE", `${P}/sources/${record_id}`, { expected_etag: etag, reason: "A test source", confirm: "delete permanently" });
  };
  const addSource = (who: Browser, title: string) => who.api("POST", `${P}/sources`, { title, tags: ["notes"] });
  const holds = async () => (await limitsOf(fay)).holds as { products: number; sources: number; storage: { total: number } };

  it("count products whether archived or not, so archiving makes no room, restoring is free, and deleting makes room", async () => {
    const products = `/api/v1/teams/${free.slug}/${team}/products`;
    const second = await fay.api("POST", products, { name: "Second thoughts" });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "products_max", limit: 1, used: 1 } });
    expect(second.body.error.message).toMatch(/allows 1 product, archived ones included, and it has 1\./);
    tweak({ products_max: 2 });
    const made = await fay.api("POST", products, { name: "Second thoughts" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const Q = `/api/v1/p/${made.body.path}`;
    expect((await fay.api("POST", `${Q}/archive`, { expected_etag: made.body.etag })).status).toBe(200);
    // At the limit, archiving made no room for another.
    expect((await holds()).products).toBe(2);
    const third = await fay.api("POST", products, { name: "Third thoughts" });
    expect(third.status).toBe(409);
    expect(third.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "products_max", limit: 2, used: 2, unit: "products" } });
    expect(third.body.error.message).toMatch(/Deleting a product no longer needed makes room, which its admins can do; archiving one does not\./);
    expect(third.body.error.message).not.toMatch(/Archive/);
    // Restoring adds nothing, even past the total.
    tweak({ products_max: 1 });
    const archived = (await fay.api("GET", Q)).body;
    const restore = await fay.api("POST", `${Q}/restore`, { expected_etag: archived.etag });
    expect(restore.status, JSON.stringify(restore.body)).toBe(200);
    expect((await holds()).products).toBe(2);
    // Deleting makes room, whether or not the product is archived.
    tweak({ products_max: 2 });
    expect((await fay.api("POST", `${Q}/archive`, { expected_etag: (await fay.api("GET", Q)).body.etag })).status).toBe(200);
    const gone = await deleteProduct(fay, Q, "Second thoughts");
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect((await holds()).products).toBe(1);
    const again = await fay.api("POST", products, { name: "Third thoughts" });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect((await deleteProduct(fay, `/api/v1/p/${again.body.path}`, "Third thoughts")).status).toBe(200);
    reset();
  });

  it("count sources whether archived or not, and an editor told to delete is told who can", async () => {
    const held = (await holds()).sources;
    tweak({ sources_max: held + 1, sources_per_day: 1000 });
    const last = await addSource(ned, "Sample source that fills the plan");
    expect(last.status).toBe(201);
    const over = await addSource(ned, "Sample source past the plan");
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sources_max", limit: held + 1, used: held + 1 } });
    expect(over.body.error.message).toMatch(/allows \d+ sources, archived ones included; it has \d+\./);
    // At the limit, archiving made no room for another, and restoring took none.
    expect((await ned.api("POST", `${P}/sources/archive`, { record_ids: [last.body.record_id] })).status).toBe(200);
    expect((await holds()).sources).toBe(held + 1);
    const stillOver = await addSource(ned, "Sample source after archiving");
    expect(stillOver.status).toBe(409);
    expect(stillOver.body.error.details).toMatchObject({ quota: "sources_max", used: held + 1 });
    const restored = await ned.api("POST", `${P}/sources/restore`, { record_ids: [last.body.record_id] });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.restored).toHaveLength(1);
    // The message names who deletes, since the editor it reached cannot.
    expect(over.body.error.message).toMatch(/Deleting sources no longer needed makes room, which their product's admins can do \(in an archived product, by restoring it first or deleting it whole\); archiving them does not\./);
    expect((await deleteSource(ned, last.body.record_id)).status).toBe(403);
    expect((await deleteSource(fay, last.body.record_id)).status).toBe(200);
    const room = await addSource(ned, "Sample source once there is room");
    expect(room.status).toBe(201);
    expect((await deleteSource(fay, room.body.record_id)).status).toBe(200);
    reset();
  });

  it("never refuse a restore for a total, however large a batch it names, and keep what limits a call", async () => {
    const one = await addSource(fay, "Sample source to restore");
    expect((await fay.api("POST", `${P}/sources/archive`, { record_ids: [one.body.record_id] })).status).toBe(200);
    // Two hundred ids carry more than the 4 KB of text that meets the storage total.
    const ids = [one.body.record_id, ...Array.from({ length: 199 }, (_, i) => `01ARZ3NDEKTSV4RRFFQ69G${String(i).padStart(4, "0")}`)];
    tweak({ sources_max: 1, products_max: 1, storage_max_bytes: 1, batch_max: 200 });
    const restored = await fay.api("POST", `${P}/sources/restore`, { record_ids: ids });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.restored).toHaveLength(1);
    // How many a call names is its own limit.
    tweak({ batch_max: 1 });
    const batch = await fay.api("POST", `${P}/sources/restore`, { record_ids: ids.slice(0, 2) });
    expect(batch.status).toBe(413);
    expect(batch.body.error.details).toMatchObject({ field: "record_ids", limit: 1 });
    reset();
    expect((await deleteSource(fay, one.body.record_id)).status).toBe(200);
  });

  it("say a total as well when a call past a day's allowance would meet it, and the day's alone when it would not", async () => {
    const { sources: held } = await holds();
    const today = await used(ned, "sources_per_day");
    // The day's sources used up, and every source the plan allows held.
    tweak({ sources_max: held, sources_per_day: today, writes_per_day: 100_000 });
    const both = await addSource(ned, "Sample source past both");
    expect(both.status).toBe(409);
    expect(both.body.error).toMatchObject({
      code: "quota_exceeded",
      details: { quota: "sources_max", limit: held, used: held, unit: "sources", also: { quota: "sources_per_day", limit: today, used: today, unit: "sources", resets_at: dayOf(new Date()).day_end } },
    });
    expect(both.body.error.message).toMatch(/Deleting sources no longer needed makes room/);
    expect(both.body.error.message).toMatch(new RegExp(`Today's allowance is used up too\\. This organization's plan allows each person ${today} new sources a day\\. It starts again at ${dayOf(new Date()).day_end}\\.$`));
    // A refused call took nothing from the day.
    expect(await used(ned, "sources_per_day")).toBe(today);
    // With room under the total, waiting for tomorrow is the whole truth.
    tweak({ sources_max: held + 1 });
    const day = await addSource(ned, "Sample source past the day");
    expect(day.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sources_per_day", resets_at: dayOf(new Date()).day_end } });
    expect(day.body.error.details.also).toBeUndefined();
    expect(day.body.error.message).not.toMatch(/Deleting/);
    reset();

    // The day's writes, past each of the other totals.
    tweak({ writes_per_day: await used(fay, "writes_per_day"), org_writes_per_day: 100_000 });
    const product = await fay.api("POST", `/api/v1/teams/${free.slug}/${team}/products`, { name: "Past the day and the total" });
    expect(product.body.error.details).toMatchObject({ quota: "products_max", also: { quota: "writes_per_day" } });
    const person = await fay.api("POST", `/api/v1/tenants/${free.slug}/members`, { email: "sol@example.com", role: "editor", team });
    expect(person.body.error.details).toMatchObject({ quota: "members_max", also: { quota: "writes_per_day" } });
    expect(person.body.error.message).toMatch(/Removing someone or cancelling an invitation makes room/);
    // A role that takes no place is refused for the day alone.
    const reader = await fay.api("POST", `/api/v1/tenants/${free.slug}/members`, { email: "ren@example.com", role: "reader", team });
    expect(reader.body.error.details).toMatchObject({ quota: "writes_per_day" });
    expect(reader.body.error.details.also).toBeUndefined();
    tweak({ storage_max_bytes: 1 });
    const upload = await fay.api("POST", `${P}/sources/${seeded}/uploads`, { path: "past-both.md" });
    expect(upload.body.error.details).toMatchObject({ quota: "storage_max_bytes", also: { quota: "writes_per_day" } });
    const long = await fay.api("POST", `${P}/assumptions`, { statement: "A premise at length", body: "x".repeat(6000) });
    expect(long.body.error.details).toMatchObject({ quota: "storage_max_bytes", also: { quota: "writes_per_day" } });
    // Without a total in play, the day's alone.
    const short = await fay.api("POST", `${P}/outcomes`, { title: "A short outcome past the day" });
    expect(short.body.error.details).toMatchObject({ quota: "writes_per_day" });
    expect(short.body.error.details.also).toBeUndefined();
    reset();
  });

  it("leave an organization past its totals with everything it holds: read, searched, exported, restored and deleted, and adding refused with what makes room", async () => {
    const products = `/api/v1/teams/${free.slug}/${team}/products`;
    tweak({ products_max: 2, sources_per_day: 1000, exports_per_day: 1000 });
    const made = await fay.api("POST", products, { name: "Shelved discovery" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const Q = `/api/v1/p/${made.body.path}`;
    const shelved = await addSource(fay, "Sample source later shelved");
    expect(shelved.status).toBe(201);
    expect((await fay.api("POST", `${P}/sources/archive`, { record_ids: [shelved.body.record_id] })).status).toBe(200);
    expect((await fay.api("POST", `${Q}/archive`, { expected_etag: made.body.etag })).status).toBe(200);
    const before = await holds();
    const listed = (await fay.api("GET", `${P}/sources?include_archived=true`)).body.records.length as number;

    // The plan's totals now sit below what it holds, as an upgrade would leave one with archived material.
    tweak({ products_max: 1, sources_max: 1 });
    const limits = await limitsOf(fay);
    expect(limits.holds).toMatchObject({ products: before.products, sources: before.sources });
    expect(limits.limits.find((l: { key: string }) => l.key === "sources_max")).toMatchObject({ value: 1, used: before.sources });
    // Nothing is removed, and it is not read-only.
    expect(limits.read_only).toBeUndefined();
    expect((await fay.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === free.slug).read_only).toBeUndefined();
    expect((await fay.api("GET", `${P}/sources?include_archived=true`)).body.records).toHaveLength(listed);
    expect((await ned.api("GET", `${P}/sources/${shelved.body.record_id}`)).status).toBe(200);
    expect((await ned.api("GET", `${P}/search?query=visit`)).status).toBe(200);
    const exported = await ned.api("POST", `${P}/exports`, {});
    expect(exported.status, JSON.stringify(exported.body)).toBe(201);
    await h.worker.drain();
    // Work that adds no source or product goes on.
    expect((await ned.api("POST", `${P}/outcomes`, { title: "An outcome past the totals" })).status).toBe(201);
    // Adding is refused, saying what makes room.
    const source = await addSource(ned, "Sample source past the total");
    expect(source.status).toBe(409);
    expect(source.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sources_max", limit: 1, used: before.sources } });
    expect(source.body.error.message).toMatch(/Deleting sources no longer needed makes room/);
    const product = await fay.api("POST", products, { name: "Past the total" });
    expect(product.body.error.details).toMatchObject({ quota: "products_max", limit: 1, used: before.products });
    expect(product.body.error.message).toMatch(/Deleting a product no longer needed makes room/);
    // Restoring and archiving work, and change no count.
    expect((await ned.api("POST", `${P}/sources/restore`, { record_ids: [shelved.body.record_id] })).status).toBe(200);
    expect((await ned.api("POST", `${P}/sources/archive`, { record_ids: [shelved.body.record_id] })).status).toBe(200);
    const restored = await fay.api("POST", `${Q}/restore`, { expected_etag: (await fay.api("GET", Q)).body.etag });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(await holds()).toMatchObject({ products: before.products, sources: before.sources });
    // Deleting works, and comes down by what it takes.
    expect((await deleteSource(fay, shelved.body.record_id)).status).toBe(200);
    expect((await holds()).sources).toBe(before.sources - 1);
    expect((await deleteProduct(fay, Q, "Shelved discovery")).status).toBe(200);
    expect((await holds()).products).toBe(before.products - 1);
    reset();
  });

  it("never stop or count what makes room, and stop archiving and restoring, however they are asked for", async () => {
    tweak({ sources_per_day: 1000 });
    const kept = await addSource(fay, "Sample source archived past the day");
    const shed = await addSource(fay, "Sample source deleted past the day");
    expect((await fay.api("POST", `${P}/sources/archive`, { record_ids: [kept.body.record_id] })).status).toBe(200);
    const made = await fay.api("POST", `${P}/assumptions`, { statement: "Sample assumption flipped past the day" });
    expect(made.body.etag).toBeTruthy();
    const allMine = await used(fay, "writes_per_day");
    tweak({ writes_per_day: allMine });
    const refused = await fay.api("POST", `${P}/outcomes`, { title: "Past the day's writes" });
    expect(refused.body.error.details).toMatchObject({ quota: "writes_per_day" });

    // Deleting goes on, and takes nothing from anyone's day.
    expect((await deleteSource(fay, shed.body.record_id)).status).toBe(200);
    expect(await used(fay, "writes_per_day")).toBe(allMine);

    // Archiving makes no room and is stopped, a call that changes nothing included.
    const noop = await fay.api("POST", `${P}/sources/archive`, { record_ids: [kept.body.record_id] });
    expect(noop.status).toBe(409);
    expect(noop.body.error.details).toMatchObject({ quota: "writes_per_day" });

    // An operation that archives also restores, so a flip cannot write past the day.
    const flip = await fay.api("POST", `${P}/assumptions/${made.body.id}/archive`, { archived: true, expected_etag: made.body.etag });
    expect(flip.status).toBe(409);
    expect(flip.body.error.details).toMatchObject({ quota: "writes_per_day" });
    expect(await used(fay, "writes_per_day")).toBe(allMine);

    // A restore is a write the day's allowance stops, and no total is in play to name.
    const restore = await fay.api("POST", `${P}/sources/restore`, { record_ids: [kept.body.record_id] });
    expect(restore.status).toBe(409);
    expect(restore.body.error.details).toMatchObject({ quota: "writes_per_day" });
    expect(restore.body.error.details.also).toBeUndefined();

    // Switching writing off stops archiving too, and never what makes room.
    tweak({ writes_per_day: 0 });
    expect((await fay.api("POST", `${P}/outcomes`, { title: "While writing is off" })).body.error.code).toBe("plan_restricted");
    const off = await addSource(fay, "Sample source while writing is off");
    expect(off.body.error.code).toBe("plan_restricted");
    expect((await fay.api("POST", `${P}/sources/archive`, { record_ids: [kept.body.record_id] })).body.error.code).toBe("plan_restricted");
    expect((await deleteSource(fay, kept.body.record_id)).status).toBe(200);
    reset();
  });

  it("let one person clear up past the day without using up everyone's", async () => {
    tweak({ sources_per_day: 1000 });
    const first = await addSource(fay, "Sample source one of the clearing up");
    const second = await addSource(fay, "Sample source two of the clearing up");
    const together = await used(fay, "org_writes_per_day");
    tweak({ writes_per_day: await used(fay, "writes_per_day"), org_writes_per_day: together + 1 });
    expect((await deleteSource(fay, first.body.record_id)).status).toBe(200);
    expect((await deleteSource(fay, second.body.record_id)).status).toBe(200);
    expect(await used(fay, "org_writes_per_day")).toBe(together);
    reset();
  });

  it("count storage, refuse a large write past it while small ones and reads go on, and bound an upload by what is left", async () => {
    const stored = (await limitsOf(fay)).holds.storage.total as number;
    tweak({ storage_max_bytes: stored + 5000 });
    const big = await ned.api("POST", `${P}/assumptions`, { statement: "A premise written at length", body: "x".repeat(6000) });
    expect(big.status).toBe(409);
    expect(big.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "storage_max_bytes", limit: stored + 5000 } });
    expect(big.body.error.message).toMatch(/Deleting what is no longer needed makes room, which a product's admins can do; archiving it does not\./);
    expect((await ned.api("POST", `${P}/outcomes`, { title: "A short outcome still fits" })).status).toBe(201);
    expect((await ned.api("GET", `${P}/outcomes`)).status).toBe(200);
    const grant = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "room.md" });
    expect(grant.status).toBe(201);
    expect(grant.body.max_bytes).toBeLessThanOrEqual(5000);
    tweak({ storage_max_bytes: 1 });
    const full = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "full.md" });
    expect(full.status).toBe(409);
    expect(full.body.error.details).toMatchObject({ quota: "storage_max_bytes" });
    reset();
  });

  it("cap what each person is sent a day, counted on every plan", async () => {
    const grant = await ned.api("POST", `${P}/sources/${seeded}/uploads`, { path: "sent.md" });
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "s".repeat(300) })).status).toBe(201);
    const file = `${P}/sources/${seeded}/attachment?path=sent.md`;
    expect((await ned.api("GET", file)).status).toBe(200);
    const sent = (await limitsOf(ned)).limits.find((l: { key: string }) => l.key === "sent_bytes_per_day").used as number;
    expect(sent).toBeGreaterThanOrEqual(300);
    tweak({ sent_bytes_per_day: sent + 100 });
    const refused = await ned.api("GET", file);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sent_bytes_per_day", limit: sent + 100, used: sent } });
    // Fay has her own day.
    expect((await fay.api("GET", file)).status).toBe(200);
    reset();
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
