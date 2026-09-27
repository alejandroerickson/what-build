import { STORY_STYLESHEET, withStoryTheme } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPorts } from "../src/app.ts";
import { seed } from "../src/seed.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday.

00:00:05.000 --> 00:00:09.000
<v Sam>Why Friday?

00:00:09.000 --> 00:00:14.000
<v Dana>Because that is when the numbers close and the pricing review happens.
`;

let h: Harness;
let alice: Browser;
let vic: Browser;
let bob: Browser;
let carol: Browser;
let stranger: Browser;
let P: string;
let productPath: string;
let tenantSlug: string;
let teamSlug: string;
let recordId: string;

const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${STORY_STYLESHEET}</style></head><body><main class="wb-page wb-prose">${body}</main></body></html>`;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  bob = await h.signIn("bob@example.com", "Bob Team");
  carol = await h.signIn("carol@example.com", "Carol Member");
  stranger = await h.signIn("stranger@example.com", "Stranger");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Review Co" });
  tenantSlug = t.body.tenant.slug;
  teamSlug = t.body.team.slug;
  const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Planner" });
  productPath = p.body.path;
  P = `/api/v1/p/${productPath}`;
  await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "planner", email: "vic@example.com", role: "viewer" });
  const created = await alice.api("POST", `${P}/sources/with-upload`, { kind: "interview_transcript", title: "Finance lead interview — Example Co, Sep 2026", date: "2026-09-03", path: "call.vtt", role: "primary" });
  recordId = created.body.record.record_id;
  const up = created.body.upload;
  await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt" });
  await h.worker.drain();
});
afterAll(async () => h?.close());

describe("insight review", () => {
  let id: string;
  let etag: string;

  it("starts unreviewed, and refuses a viewer and a stale etag", async () => {
    const i = await alice.api("POST", `${P}/insights`, { title: "Friday closes the numbers", body: "Numbers close on Fridays." });
    id = i.body.insight_id;
    etag = i.body.etag;
    expect(i.body).toMatchObject({ review_state: "unreviewed", reviewed_revision: null, reviewed_at: null, reviewed_by: null });
    const viewer = await vic.api("POST", `${P}/insights/${id}/review`, { reviewed: true, expected_etag: etag });
    expect(viewer.status).toBe(403);
    const stale = await alice.api("POST", `${P}/insights/${id}/review`, { reviewed: true, expected_etag: "stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    expect(stale.body.error.details.current_etag).toBe(etag);
  });

  it("marks the current revision reviewed, attributed, with a new etag and an activity event", async () => {
    const r = await alice.api("POST", `${P}/insights/${id}/review`, { reviewed: true, expected_etag: etag });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ review_state: "reviewed", reviewed_revision: 1, revision: 1 });
    expect(r.body.reviewed_by.display_name).toBe("Alice Example");
    expect(r.body.reviewed_at).toBeTruthy();
    expect(r.body.etag).not.toBe(etag);
    etag = r.body.etag;
    const g = await alice.api("GET", `${P}/insights/${id}`);
    expect(g.body.review_state).toBe("reviewed");
    const act = await alice.api("GET", `${P}/activity?entity_id=${id}`);
    expect(act.body.items.map((a: { action: string }) => a.action)).toContain("reviewed");
  });

  it("filters lists by review state", async () => {
    const other = await alice.api("POST", `${P}/insights`, { title: "Nobody reviewed this", body: "Yet." });
    const reviewed = await alice.api("GET", `${P}/insights?review_state=reviewed`);
    expect(reviewed.body.items.map((x: { insight_id: string }) => x.insight_id)).toEqual([id]);
    const open = await alice.api("GET", `${P}/insights?review_state=unreviewed,changed`);
    expect(open.body.items.map((x: { insight_id: string }) => x.insight_id)).toEqual([other.body.insight_id]);
    const bad = await alice.api("GET", `${P}/insights?review_state=maybe`);
    expect(bad.status).toBe(422);
  });

  it("shows an edited insight as changed since review until reviewed again, and clears a review", async () => {
    const u = await alice.api("PATCH", `${P}/insights/${id}`, { expected_etag: etag, body: "Numbers close on Fridays, and pricing follows." });
    expect(u.body).toMatchObject({ revision: 2, reviewed_revision: 1, review_state: "changed" });
    const changed = await alice.api("GET", `${P}/insights?review_state=changed`);
    expect(changed.body.items.map((x: { insight_id: string }) => x.insight_id)).toEqual([id]);
    // A status change is not an edit of the text: the review stands.
    const again = await alice.api("POST", `${P}/insights/${id}/review`, { reviewed: true, expected_etag: u.body.etag });
    expect(again.body).toMatchObject({ review_state: "reviewed", reviewed_revision: 2 });
    const pub = await alice.api("PATCH", `${P}/insights/${id}`, { expected_etag: again.body.etag, status: "published" });
    expect(pub.body.review_state).toBe("reviewed");
    const cleared = await alice.api("POST", `${P}/insights/${id}/review`, { reviewed: false, expected_etag: pub.body.etag });
    expect(cleared.body).toMatchObject({ review_state: "unreviewed", reviewed_revision: null, reviewed_by: null });
  });
});

describe("Story citations", () => {
  let pageEtag: string;

  it("publishes a version with cited passages, snapshotted, with source titles and resolved refs", async () => {
    const v1 = await alice.api("POST", `${P}/story/pages/overview/versions`, {
      title: "Overview",
      html: html("Overview", "<h1>Overview</h1><p>Numbers close on Fridays.</p>"),
      refs: { sources: [recordId] },
      citations: [
        { record_id: recordId, seq_start: 2, seq_end: 2, quote: "numbers close" },
        { record_id: recordId, seq_start: 0, seq_end: 1 },
      ],
    });
    expect(v1.status).toBe(201);
    pageEtag = v1.body.etag;
    expect(v1.body.current.citations).toHaveLength(2);
    expect(v1.body.current.citations[0]).toMatchObject({ index: 0, record_id: recordId, seq_start: 2, seq_end: 2, quote: "numbers close", source_title: "Finance lead interview — Example Co, Sep 2026", speakers: ["Dana"] });
    expect(v1.body.current.citations[1].quote).toContain("Why Friday?");
    expect(v1.body.current.resolved_refs.sources).toEqual([{ id: recordId, title: "Finance lead interview — Example Co, Sep 2026", status: null, kind: "interview_transcript", archived: false, missing: false }]);
    const page = await alice.api("GET", `${P}/story/pages/overview`);
    expect(page.body.current.citations).toHaveLength(2);
    const version = await alice.api("GET", `${P}/story/pages/overview/versions/1`);
    expect(version.body.citations[0].source_title).toContain("Finance lead");
    const versions = await alice.api("GET", `${P}/story/pages/overview/versions`);
    expect(versions.body.items[0].citation_count).toBe(2);
  });

  it("refuses a quote that is not in the passage, and more than 20 citations", async () => {
    const bad = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", expected_etag: pageEtag, citations: [{ record_id: recordId, seq_start: 0, seq_end: 0, quote: "not there" }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("quote_not_found");
    const many = Array.from({ length: 21 }, () => ({ record_id: recordId, seq_start: 0, seq_end: 0 }));
    const tooMany = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", expected_etag: pageEtag, citations: many });
    expect(tooMany.status).toBe(422);
  });

  it("checks a version's citations against the sources as they are now, for any reader", async () => {
    const check = await vic.api("GET", `${P}/story/pages/overview/check-citations`);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ page_id: "overview", version: 1, valid: true });
    expect(check.body.citations.map((c: { status: string }) => c.status)).toEqual(["ok", "ok"]);
    const missing = await alice.api("GET", `${P}/story/pages/overview/check-citations?version=9`);
    expect(missing.status).toBe(404);
    // A new version carries only the citations it is given.
    const v2 = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", html: html("Overview", "<p>Short.</p>"), expected_etag: pageEtag });
    pageEtag = v2.body.etag;
    expect(v2.body.current.citations).toEqual([]);
    const old = await alice.api("GET", `${P}/story/pages/overview/check-citations?version=1`);
    expect(old.body.citations).toHaveLength(2);
    await alice.api("POST", `${P}/story/pages/overview/versions`, {
      title: "Overview", html: html("Overview", "<h1>Overview</h1><p>Again.</p>"), expected_etag: pageEtag, citations: [{ record_id: recordId, seq_start: 2, seq_end: 2 }],
    }).then((r) => (pageEtag = r.body.etag));
  });

  it("lists Story pages among what a source is cited in, and in its delete impact", async () => {
    const using = await alice.api("GET", `${P}/sources/${recordId}/insights`);
    expect(using.body.story_pages).toEqual([{ page_id: "overview", title: "Overview", version: 3, referenced: false, citations: [{ seq_start: 2, seq_end: 2 }] }]);
    const impact = await alice.api("GET", `${P}/sources/${recordId}/delete-impact`);
    expect(impact.body.story_pages_citing).toEqual([{ page_id: "overview", title: "Overview", version: 3, count: 1 }]);
    expect(impact.body.story_versions_citing).toEqual([
      { page_id: "overview", title: "Overview", version: 3, count: 1, is_current: true },
      { page_id: "overview", title: "Overview", version: 1, count: 2, is_current: false },
    ]);
    expect(impact.body.after_delete).toMatch(/keep their quoted text .* report record_deleted/);
    expect(impact.body.after_delete).toMatch(/2 Story page versions/);
  });
});

describe("notes for agents", () => {
  it("returns empty notes with their own etag, and refuses a viewer and a stale etag", async () => {
    const page = await alice.api("GET", `${P}/story/pages/overview?include_html=false`);
    expect(page.body.agent_notes).toMatchObject({ content: "", updated_at: null, updated_by: null });
    expect(page.body.agent_notes.etag).toBeTruthy();
    expect(page.body.agent_notes.etag).not.toBe(page.body.etag);
    const viewer = await vic.api("PUT", `${P}/story/pages/overview/notes`, { notes: "x", expected_etag: page.body.agent_notes.etag });
    expect(viewer.status).toBe(403);
    const withPageEtag = await alice.api("PUT", `${P}/story/pages/overview/notes`, { notes: "x", expected_etag: page.body.etag });
    expect(withPageEtag.status).toBe(409);
    expect(withPageEtag.body.error.code).toBe("stale_etag");
    expect(withPageEtag.body.error.details.current_etag).toBe(page.body.agent_notes.etag);
    const tooLong = await alice.api("PUT", `${P}/story/pages/overview/notes`, { notes: "x".repeat(20_001), expected_etag: page.body.agent_notes.etag });
    expect(tooLong.status).toBe(422);
  });

  it("replaces the notes without touching the page etag, and records it", async () => {
    const page = await alice.api("GET", `${P}/story/pages/overview?include_html=false`);
    const w = await alice.api("PUT", `${P}/story/pages/overview/notes`, { notes: "## Purpose\n\nThe overview.", expected_etag: page.body.agent_notes.etag });
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ page_id: "overview", changed: true, agent_notes: { content: "## Purpose\n\nThe overview." } });
    expect(w.body.agent_notes.updated_by.display_name).toBe("Alice Example");
    const after = await vic.api("GET", `${P}/story/pages/overview?include_html=false`);
    expect(after.body.agent_notes.content).toBe("## Purpose\n\nThe overview.");
    expect(after.body.etag).toBe(page.body.etag);
    const replay = await alice.api("PUT", `${P}/story/pages/overview/notes`, { notes: "later", expected_etag: page.body.agent_notes.etag });
    expect(replay.status).toBe(409);
    // Publishing with the page etag still works after the notes changed.
    const v = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", html: html("Overview", "<h1>Overview</h1><p>Again.</p>"), expected_etag: page.body.etag });
    expect(v.status).toBe(201);
    const act = await alice.api("GET", `${P}/activity?entity_id=overview`);
    expect(act.body.items.map((a: { action: string }) => a.action)).toContain("notes_updated");
  });
});

describe("Story page theme", () => {
  it("writes light or dark onto the served page's <html>, and nothing without the param", async () => {
    const plain = await vic.api("GET", `${P}/story/pages/overview/versions/1/html`);
    expect(plain.status).toBe(200);
    expect(plain.body).toContain('<!doctype html><html lang="en">');
    for (const theme of ["light", "dark"]) {
      const r = await vic.api("GET", `${P}/story/pages/overview/versions/1/html?theme=${theme}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toContain("sandbox");
      expect(r.body).toContain(`<!doctype html><html data-wb-theme="${theme}" lang="en">`);
    }
  });

  it("accepts only light and dark", async () => {
    for (const theme of ["system", "", "dark%22%20onload%3D%22x", "DARK"]) {
      const r = await vic.api("GET", `${P}/story/pages/overview/versions/1/html?theme=${theme}`);
      expect(r.status, theme).toBe(422);
    }
    const stranger404 = await stranger.api("GET", `${P}/story/pages/overview/versions/1/html?theme=dark`);
    expect(stranger404.status).toBe(404);
  });

  it("opens an <html> tag after the doctype when a page has none", () => {
    expect(withStoryTheme("<!doctype html>\n<!-- x --><p>Hi</p>", "dark")).toBe('<!doctype html>\n<!-- x --><html data-wb-theme="dark"><p>Hi</p>');
    expect(withStoryTheme("<HTML class=a><body></body></HTML>", "light")).toBe('<html data-wb-theme="light" class=a><body></body></HTML>');
    expect(withStoryTheme("<html><head></head></html>", "dark")).toBe('<html data-wb-theme="dark"><head></head></html>');
  });
});

describe("activity by people or agents", () => {
  it("splits what people did (app and REST) from what agents did (MCP)", async () => {
    const pat = (await alice.api("POST", "/api/v1/me/tokens", { name: "script" })).body.token as string;
    const viaRest = await fetch(`${h.baseUrl}${P}/insights`, { method: "POST", headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Written through the API", body: "Through a script." }) });
    expect(viaRest.status).toBe(201);
    const people = await alice.api("GET", `${P}/activity?by=people&limit=200`);
    expect(people.status).toBe(200);
    const channels = new Set(people.body.items.map((a: { channel: string | null }) => a.channel));
    expect(channels.has("web")).toBe(true);
    expect(channels.has("rest")).toBe(true);
    expect(channels.has("mcp")).toBe(false);
    const agents = await alice.api("GET", `${P}/activity?by=agents`);
    expect(agents.status).toBe(200);
    for (const a of agents.body.items) expect(a.channel).toBe("mcp");
    expect((await alice.api("GET", `${P}/activity?by=robots`)).status).toBe(422);
  });
});

describe("Story print view", () => {
  beforeAll(async () => {
    await alice.api("POST", `${P}/story/pages/detail/versions`, { title: "Detail", html: html("Detail", "<p>Child page.</p><script>document.write('drawn')</script>") });
    await alice.api("POST", `${P}/story/pages/aside/versions`, { title: "An aside", html: html("An aside", "<p>Unplaced.</p>") });
    const tree = await alice.api("GET", `${P}/story/hierarchy`);
    await alice.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: "overview", children: [{ page_id: "detail", children: [] }] }], expected_etag: tree.body.etag });
  });

  it("plans exactly the chosen pages in tree order with outline levels", async () => {
    const plan = await vic.api("GET", `${P}/story/print-view?page_ids=aside,detail,overview`);
    expect(plan.status).toBe(200);
    expect(plan.body.pages.map((p: { page_id: string; level: number; depth: number }) => `${p.page_id}:${p.level}:${p.depth}`)).toEqual(["overview:1:1", "detail:2:2", "aside:1:1"]);
    expect(plan.body.pages[0]).toMatchObject({ title: "Overview", version: 4, archived: false });
    expect(plan.body.path).toBe(`${P}/story/print?page_ids=overview,detail,aside`);
    expect(plan.body.url).toBe(`${h.baseUrl}${P}/story/print?page_ids=overview,detail,aside`);
    const child = await alice.api("GET", `${P}/story/print-view?page_ids=detail`);
    expect(child.body.pages).toEqual([expect.objectContaining({ page_id: "detail", level: 1, depth: 2 })]);
    const unknown = await alice.api("GET", `${P}/story/print-view?page_ids=overview,nope`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.details.missing).toEqual(["nope"]);
    const none = await alice.api("GET", `${P}/story/print-view`);
    expect(none.status).toBe(422);
  });

  it("serves one composed document under a policy that runs only its own print script", async () => {
    const r = await vic.api("GET", `${P}/story/print?page_ids=detail,overview`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const csp = r.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(csp).toContain(`script-src 'nonce-${nonce}';`);
    expect(csp).toContain("sandbox allow-modals allow-scripts;");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    const doc = r.body as string;
    expect([...doc.matchAll(/<script([^>]*)>/g)].map((m) => m[1])).toEqual([` nonce="${nonce}"`]);
    expect(doc).not.toContain("document.write");
    expect(doc).toContain("<h1>Planner</h1>");
    expect(doc.indexOf('id="title-overview"')).toBeLessThan(doc.indexOf('id="title-detail"'));
    expect(doc).toContain('<h2 class="print-heading" id="title-overview">Overview</h2>');
    expect(doc).toContain('<h3 class="print-heading" id="title-detail">Detail</h3>');
    expect(doc.match(/shadowrootmode="open"/g)).toHaveLength(2);
    // The page's leading <h1>Overview</h1> repeats its title and is dropped.
    expect(doc).not.toContain("<h1>Overview</h1>");
    // The Story stylesheet's :root tokens apply to each page's shadow host.
    expect(doc).toContain(":host {");
    expect(doc).not.toMatch(/<template shadowrootmode="open"><style>[^<]*:root/);
    const fresh = await vic.api("GET", `${P}/story/print?page_ids=overview`);
    expect(fresh.headers.get("content-security-policy")).not.toContain(nonce);
  });

  it("hides the product from a non-member", async () => {
    expect((await stranger.api("GET", `${P}/story/print?page_ids=overview`)).status).toBe(404);
    expect((await stranger.api("GET", `${P}/story/print-view?page_ids=overview`)).status).toBe(404);
  });
});

describe("people on one product", () => {
  it("lists everyone who can reach the product, with the role and where it comes from", async () => {
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "bob@example.com", role: "editor" });
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { email: "carol@example.com", role: "member" });
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "planner", email: "bob@example.com", role: "viewer" });
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "planner", email: "invitee@example.com", role: "editor" });
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { email: "tenant-invitee@example.com", role: "member" });
    const r = await vic.api("GET", `/api/v1/tenants/${tenantSlug}/members?team=${teamSlug}&product=planner`);
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({ name: "Planner" });
    const access = Object.fromEntries(r.body.members.map((m: { email: string; product_access: unknown }) => [m.email, m.product_access]));
    expect(access).toEqual({
      "alice@example.com": { role: "admin", via: "tenant" },
      "bob@example.com": { role: "editor", via: "team" },
      "vic@example.com": { role: "viewer", via: "product" },
    });
    const bobGrants = r.body.members.find((m: { email: string }) => m.email === "bob@example.com").grants.map((g: { scope_type: string; role: string }) => `${g.scope_type}:${g.role}`);
    expect(bobGrants.sort()).toEqual(["product:viewer", "team:editor"]);
    expect(r.body.invitations.map((i: { email: string }) => i.email)).toEqual(["invitee@example.com"]);
    const all = await carol.api("GET", `/api/v1/tenants/${tenantSlug}/members`);
    expect(all.body.members.map((m: { email: string }) => m.email)).toContain("carol@example.com");
    expect(all.body.product).toBeUndefined();
    const unknown = await vic.api("GET", `/api/v1/tenants/${tenantSlug}/members?team=${teamSlug}&product=nope`);
    expect(unknown.status).toBe(404);
    void bob;
  });
});

describe("the sample product", () => {
  it("seeds a reviewed, an unreviewed and a changed insight, and Story pages with citations and notes", async () => {
    const ports = createPorts(h.config, h.blobs, h.mailer);
    await seed({ db: h.db, ports }, h.worker, () => {});
    const sam = await h.signIn("sam@example.com", "Sam Okafor");
    const products = await sam.api("GET", "/api/v1/me/products");
    const path = products.body.items.find((p: { name: string }) => p.name === "Crewboard").path;
    const S = `/api/v1/p/${path}`;
    const insights = await sam.api("GET", `${S}/insights`);
    expect(insights.body.items.map((i: { review_state: string }) => i.review_state).sort()).toEqual(["changed", "reviewed", "unreviewed"]);
    const overview = await sam.api("GET", `${S}/story/pages/overview?include_html=false`);
    expect(overview.body.current.citations.length).toBeGreaterThan(0);
    expect(overview.body.current.citations.every((c: { source_title: string | null }) => c.source_title)).toBe(true);
    expect(overview.body.agent_notes.content).toContain("## Purpose");
    const check = await sam.api("GET", `${S}/story/pages/overview/check-citations`);
    expect(check.body.valid).toBe(true);
    const child = await sam.api("GET", `${S}/story/pages/hand-off-test?include_html=false`);
    expect(child.body.agent_notes.content).toContain("## Purpose");
    const plan = await sam.api("GET", `${S}/story/print-view?page_ids=hand-off-test,overview`);
    expect(plan.body.pages.map((p: { page_id: string; level: number }) => `${p.page_id}:${p.level}`)).toEqual(["overview:1", "hand-off-test:2"]);
    const doc = await sam.api("GET", `${S}/story/print?page_ids=hand-off-test,overview`);
    expect(doc.status).toBe(200);
    expect(doc.body).not.toContain("<h1>The hand-off test</h1>");
    // One source carries an agent description, outline and notes, and an origin file kept unsearched.
    const sources = await sam.api("GET", `${S}/sources`);
    const call = sources.body.records.find((r: { title: string }) => r.title.startsWith("Crew lead interview"));
    const source = await sam.api("GET", `${S}/sources/${call.record_id}?detail=full`);
    expect(source.body.agent_notes.map((n: { kind: string }) => n.kind).sort()).toEqual(["notes", "outline", "summary"]);
    const roles = source.body.files.map((f: { role: string; path: string }) => `${f.role}:${f.path}`).sort();
    expect(roles).toEqual(["origin:recorder-export.txt", "primary:interview.vtt"]);
  });
});
