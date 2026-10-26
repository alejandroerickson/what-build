import { createHash } from "node:crypto";
import { DOWNLOAD_GRANT_HEADER, MOCKUP_RESPONSE_HEADERS, PREVIEWS_KEPT, STORY_RESPONSE_HEADERS } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { asServed, startHarness, type Browser, type Harness } from "./harness.ts";

// story.preview: the same call as story.publish, checked as publish checks it, with nothing
// published, and a grant to GET the document publish would then store.

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let tenantId: string;
let teamPath: string;

const body = '<main class="page"><header class="opening"><h1>Crews plan on Fridays</h1><p class="lead">Why the week starts late.</p></header><section><h2>What we saw</h2><p>Text.</p></section></main>';

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Rows of the Story, its activity and the previews, for this organization. */
async function counts() {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    const n = async (table: "story_pages" | "story_versions" | "activity" | "story_previews") => Number((await trx.selectFrom(table).select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow()).n);
    return { pages: await n("story_pages"), versions: await n("story_versions"), activity: await n("activity"), previews: await n("story_previews") };
  });
}

/** GET a preview's document under its grant, as an agent's browser does. */
async function open(preview: { url: string; headers: Record<string, string> }, query = "") {
  const res = await fetch(`${preview.url}${query}`, { headers: preview.headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Preview Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  tenantId = t.body.tenant.tenant_id;
  teamPath = `${t.body.tenant.slug}/${t.body.team.slug}`;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "vic@example.com", role: "viewer" });
  // A house style names a typeface the server carries, so showing a page embeds it.
  expect((await alice.api("PUT", `${P}/story/style`, { house_style: "clear" })).status).toBe(200);
});
afterAll(async () => h?.close());

describe("previewing a page's first version", () => {
  let previewed: any;

  it("checks the call as publish would, and creates nothing", async () => {
    const before = await counts();
    const r = await alice.api("POST", `${P}/story/pages/friday/preview`, { title: "Friday planning", summary: "Why the week starts late.", body });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    previewed = r.body;
    expect(r.body).toMatchObject({ page_id: "friday", new_page: true, based_on_version: null, carried_forward: [], title: "Friday planning", published: false });
    // On the content site when there is one, as every page is.
    expect(r.body.preview).toMatchObject({ method: "GET", url: `${h.config.contentUrl ?? h.baseUrl}/api/v1/downloads/story-preview/${r.body.preview.preview_id}` });
    expect(Object.keys(r.body.preview.headers)).toEqual([DOWNLOAD_GRANT_HEADER]);
    expect(Date.parse(r.body.preview.expires_at)).toBeGreaterThan(Date.now());
    expect(r.headers.get("etag")).toBeNull();
    // No page, no version, no activity: only the preview's own document, held for its grant.
    expect(await counts()).toEqual({ ...before, previews: before.previews + 1 });
    expect((await alice.api("GET", `${P}/story/pages/friday`)).status).toBe(404);
    expect((await alice.api("GET", `${P}/story/pages`)).body.items).toEqual([]);
  });

  it("serves the document under its grant exactly as a published page is served", async () => {
    const doc = await open(previewed.preview);
    expect(doc.status).toBe(200);
    for (const [k, v] of Object.entries(asServed(h, STORY_RESPONSE_HEADERS))) expect(doc.headers.get(k), k).toBe(v);
    expect(doc.text).toContain(`<body>\n${body}\n</body>`);
    expect(doc.text).toContain("<title>Friday planning</title>");
    // The carried typeface is embedded as it is when a published page is shown.
    expect(doc.text).toContain("@font-face");
    const dark = await open(previewed.preview, "?theme=dark");
    expect(dark.text).toContain('data-wb-theme="dark"');
    expect((await open(previewed.preview, "?theme=sepia")).status).toBe(422);
  });

  it("is what publish then stores, byte for byte", async () => {
    const pub = await alice.api("POST", `${P}/story/pages/friday/versions`, { title: "Friday planning", summary: "Why the week starts late.", body });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect(pub.body.current.html_sha256).toBe(previewed.html_sha256);
    const stored = (await alice.api("GET", `${P}/story/pages/friday`)).body.current;
    expect(sha(stored.html)).toBe(previewed.html_sha256);
    expect(stored.html.length).toBe(previewed.html_chars);
    for (const query of ["", "?theme=light", "?theme=dark"]) {
      const shown = await vic.api("GET", `${P}/story/pages/friday/versions/1/html${query}`);
      expect((await open(previewed.preview, query)).text, query).toBe(shown.body);
    }
  });
});

describe("previewing a later version", () => {
  it("carries forward what the call omits, and leaves the page and its etag as they were", async () => {
    const page = (await alice.api("GET", `${P}/story/pages/friday`)).body;
    const before = await counts();
    const edit = { patch_html: [{ find: "<p>Text.</p>", replace: "<p>Crews text the office before nine.</p>" }], expected_etag: page.etag };
    const r = await alice.api("POST", `${P}/story/pages/friday/preview`, edit);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ new_page: false, based_on_version: 1, carried_forward: ["title", "summary"] });
    expect((await open(r.body.preview)).text).toContain("Crews text the office before nine.");
    const after = (await alice.api("GET", `${P}/story/pages/friday`)).body;
    expect(after.etag).toBe(page.etag);
    expect(after.current_version).toBe(1);
    expect(await counts()).toEqual({ ...before, previews: before.previews + 1 });
    // The same call publishes it, with the same document.
    const pub = await alice.api("POST", `${P}/story/pages/friday/versions`, edit);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect(pub.body.current.html_sha256).toBe(r.body.html_sha256);
  });

  it("refuses with publish's own errors, and stores nothing then", async () => {
    const etag = (await alice.api("GET", `${P}/story/pages/friday`)).body.etag;
    const before = await counts();
    const external = await alice.api("POST", `${P}/story/pages/friday/preview`, { body: '<main class="page"><img src="https://example.com/a.png" alt=""></main>', expected_etag: etag });
    expect(external.status).toBe(422);
    expect(external.body.error.code).toBe("invalid_html");
    expect(external.body.error.message).toMatch(/^The page would not be published: /);
    expect(external.body.error.details.problems.length).toBeGreaterThan(0);
    const unetagged = await alice.api("POST", `${P}/story/pages/friday/preview`, { body });
    expect(unetagged.status).toBe(409);
    expect(unetagged.body.error.code).toBe("stale_etag");
    const stale = await alice.api("POST", `${P}/story/pages/friday/preview`, { body, expected_etag: "0".repeat(16) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    expect((await alice.api("POST", `${P}/story/pages/friday/preview`, { from_version: 9, expected_etag: etag })).status).toBe(404);
    expect((await alice.api("POST", `${P}/story/pages/friday/preview`, { body, restyle: true, expected_etag: etag })).status).toBe(422);
    const patch = await alice.api("POST", `${P}/story/pages/friday/preview`, { patch_html: [{ find: "not on the page", replace: "x" }], expected_etag: etag });
    expect(patch.status).toBe(422);
    expect(patch.body.error.code).toBe("invalid_patch");
    expect((await alice.api("POST", `${P}/story/pages/newcomer/preview`, { body })).body.error.message).toContain("needs a title");
    expect(await counts()).toEqual(before);
  });

  it("is refused to a viewer, and in an archived product", async () => {
    const viewer = await vic.api("POST", `${P}/story/pages/friday/preview`, { title: "Mine", body });
    expect(viewer.status).toBe(403);
    const other = await alice.api("POST", `/api/v1/teams/${teamPath}/products`, { name: "Shelved" });
    const Q = `/api/v1/p/${other.body.path}`;
    expect((await alice.api("POST", `${Q}/archive`, { expected_etag: other.body.etag })).status).toBe(200);
    const archived = await alice.api("POST", `${Q}/story/pages/overview/preview`, { title: "Shelved", body });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe("product_archived");
  });
});

describe("a write sent again after its answer was lost", () => {
  it("is refused with stale_etag once a page's first version or a promoted page has landed", async () => {
    const first = { title: "Retried", body };
    expect((await alice.api("POST", `${P}/story/pages/retried/versions`, first)).status).toBe(201);
    const again = await alice.api("POST", `${P}/story/pages/retried/versions`, first);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("stale_etag");
    const page = '<!doctype html><html lang="en"><head><title>Plan</title></head><body><p>Plan</p></body></html>';
    const m = await alice.api("POST", `${P}/mockups`, { title: "Week view", brief: "Which screen tells crews the plan.", pages: [{ page_id: "plan", title: "Plan screen", html: page }] });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const promote = { mockup_id: m.body.mockup_id, mockup_page_id: "plan", page_id: "week-view" };
    const promoted = await alice.api("POST", `${P}/story/promote-mockup`, promote);
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    expect(promoted.body.page_id).toBe("week-view");
    const twice = await alice.api("POST", `${P}/story/promote-mockup`, promote);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("stale_etag");
    // Previewing a later version of a page that shows a mockup page shows that page.
    const kept = await alice.api("POST", `${P}/story/pages/week-view/preview`, { title: "Week view, renamed", expected_etag: promoted.body.etag });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body.shows_mockup).toMatchObject({ mockup_id: m.body.mockup_id, page_id: "plan", version: 1 });
    const shown = await open(kept.body.preview);
    expect(shown.text).toBe(page);
    // In a mockup page's own sandbox, as the Story's route shows it.
    expect(shown.headers.get("content-security-policy")).toBe(asServed(h, MOCKUP_RESPONSE_HEADERS)["Content-Security-Policy"]);
  });
});

describe("the preview's grant", () => {
  let first: any;

  it("opens only its own preview, and only with the header", async () => {
    first = (await alice.api("POST", `${P}/story/pages/grant-check/preview`, { title: "Grant check", body })).body;
    const second = (await alice.api("POST", `${P}/story/pages/grant-check/preview`, { title: "Grant check, again", body })).body;
    expect((await fetch(first.preview.url)).status).toBe(401);
    expect((await fetch(first.preview.url, { headers: second.preview.headers })).status).toBe(401);
    expect((await fetch(first.preview.url, { headers: { [DOWNLOAD_GRANT_HEADER]: `${first.preview.headers[DOWNLOAD_GRANT_HEADER]}x` } })).status).toBe(401);
    // A session is not a grant.
    expect((await fetch(first.preview.url, { headers: { cookie: alice.cookie } })).status).toBe(401);
    expect((await open(second.preview)).text).toContain("<title>Grant check, again</title>");
  });

  it("keeps a product's newest previews, and the worker drops expired ones", async () => {
    for (let i = 0; i < PREVIEWS_KEPT; i++) expect((await alice.api("POST", `${P}/story/pages/many/preview`, { title: `Draft ${i}`, body })).status).toBe(200);
    expect((await counts()).previews).toBe(PREVIEWS_KEPT);
    const gone = await open(first.preview);
    expect(gone.status).toBe(404);
    expect(gone.text).toContain("Preview again");
    // An expired preview is not served, and the worker's housekeeping removes it.
    const last = (await alice.api("POST", `${P}/story/pages/late/preview`, { title: "Late", body })).body;
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      await trx.updateTable("story_previews").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).execute();
    });
    expect((await open(last.preview)).status).toBe(404);
    (h.worker as unknown as { lastPrune: number }).lastPrune = 0;
    await h.worker.drain();
    expect((await counts()).previews).toBe(0);
  });
});

describe("on the free plan, and in the example organization", () => {
  let S: string;
  let slug: string;
  let freeId: string;
  let olive: Browser;

  beforeAll(async () => {
    olive = await h.signIn("olive@example.com", "Olive Owner");
    const t = await olive.api("POST", "/api/v1/tenants", { name: "Sample Free" });
    freeId = t.body.tenant.tenant_id;
    slug = t.body.tenant.slug;
    const p = await olive.api("POST", `/api/v1/teams/${slug}/${t.body.team.slug}/products`, { name: "Showcase" });
    S = `/api/v1/p/${p.body.path}`;
    await h.db.updateTable("tenants").set({ plan: "free" }).where("tenant_id", "=", freeId).execute();
  });

  const writesToday = async (accountId: string) => {
    const r = await h.db.selectFrom("limit_counters").select("n").where("tenant_id", "=", freeId).where("account_id", "=", accountId).where("bucket", "=", "day").where("counter", "=", "writes").executeTakeFirst();
    return Number(r?.n ?? 0);
  };

  it("previews whenever publish would be allowed, as a call and not a write", async () => {
    const me = (await olive.api("GET", "/api/v1/me")).body.account_id as string;
    const before = await writesToday(me);
    const r = await olive.api("POST", `${S}/story/pages/visit/preview`, { title: "A visit", body });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await open(r.body.preview)).status).toBe(200);
    expect(await writesToday(me)).toBe(before);

    // With writing switched off on the plan, a preview is refused where publish is.
    await h.db.updateTable("tenants").set({ limits: JSON.stringify({ writes_per_day: 0 }) }).where("tenant_id", "=", freeId).execute();
    try {
      const paused = await olive.api("POST", `${S}/story/pages/visit/preview`, { title: "A visit", body });
      expect(paused.status).toBe(403);
      expect(paused.body.error).toMatchObject({ code: "plan_restricted", details: { setting: "writes_per_day" } });
      expect((await olive.api("POST", `${S}/story/pages/visit/versions`, { title: "A visit", body })).body.error.code).toBe("plan_restricted");
    } finally {
      await h.db.updateTable("tenants").set({ limits: "{}" }).where("tenant_id", "=", freeId).execute();
    }
  });

  it("refuses a guest's preview in the example organization, as it refuses their publish", async () => {
    expect(await syncExampleTenant(h.db, slug, () => {})).toBe(freeId);
    try {
      const guest = await h.signIn("gus@example.com", "Gus Guest");
      const r = await guest.api("POST", `${S}/story/pages/visit/preview`, { title: "A visit", body });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("example_read_only");
      expect((await guest.api("POST", `${S}/story/pages/visit/versions`, { title: "A visit", body })).body.error.code).toBe("example_read_only");
    } finally {
      await syncExampleTenant(h.db, null, () => {});
    }
  });
});
