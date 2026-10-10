import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { houseStyle, withStoryTheme } from "@whatbuild/core";
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
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${houseStyle("tufte")!.stylesheet}</style></head><body><main class="page">${body}</main></body></html>`;

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
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Finance lead interview — Example Co, Sep 2026", date: "2026-09-03", path: "call.vtt", role: "primary" });
  recordId = created.body.record.record_id;
  const up = created.body.upload;
  await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt" });
  await h.worker.drain();
});
afterAll(async () => h?.close());

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
    expect(v1.body.current.resolved_refs.sources).toEqual([{ id: recordId, title: "Finance lead interview — Example Co, Sep 2026", status: null, archived: false, missing: false }]);
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
    // Empty lists clear a later version's citations and refs.
    const v2 = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", html: html("Overview", "<p>Short.</p>"), refs: {}, citations: [], expected_etag: pageEtag });
    pageEtag = v2.body.etag;
    expect(v2.body.current.citations).toEqual([]);
    expect(v2.body.current.refs.sources).toEqual([]);
    const old = await alice.api("GET", `${P}/story/pages/overview/check-citations?version=1`);
    expect(old.body.citations).toHaveLength(2);
    await alice.api("POST", `${P}/story/pages/overview/versions`, {
      title: "Overview", html: html("Overview", "<h1>Overview</h1><p>Again.</p>"), expected_etag: pageEtag, citations: [{ record_id: recordId, seq_start: 2, seq_end: 2 }],
    }).then((r) => (pageEtag = r.body.etag));
  });

  it("lists Story pages among what a source is cited in, and in its delete impact", async () => {
    const using = await alice.api("GET", `${P}/sources/${recordId}/used-by`);
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

describe("publishing a later version", () => {
  it("keeps what a later version omits, and restores an earlier version with from_version", async () => {
    const V = `${P}/story/pages/plan/versions`;
    const v1 = await alice.api("POST", V, {
      title: "Plan",
      summary: "What we learn next.",
      html: html("Plan", "<h1>Plan</h1><p>First.</p>"),
      refs: { sources: [recordId] },
      citations: [{ record_id: recordId, seq_start: 2, seq_end: 2, quote: "numbers close" }],
    });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ based_on_version: null, carried_forward: [] });
    expect(v1.body.current.html_sha256).toMatch(/^[0-9a-f]{64}$/);
    const v2 = await alice.api("POST", V, { html: html("Plan", "<h1>Plan</h1><p>Second.</p>"), expected_etag: v1.body.etag });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ title: "Plan", summary: "What we learn next.", based_on_version: 1, carried_forward: ["title", "summary", "refs", "citations"] });
    expect(v2.body.current.refs.sources).toEqual([recordId]);
    expect(v2.body.current.citations).toEqual(v1.body.current.citations);
    expect(v2.body.current.html_sha256).not.toBe(v1.body.current.html_sha256);
    const v3 = await alice.api("POST", V, { from_version: 1, expected_etag: v2.body.etag });
    expect(v3.status).toBe(201);
    expect(v3.body).toMatchObject({ based_on_version: 1, carried_forward: ["title", "summary", "html", "refs", "citations"] });
    expect(v3.body.current).toMatchObject({ version: 3, html_sha256: v1.body.current.html_sha256 });
    expect(v3.body.current.citations).toEqual(v1.body.current.citations);
    const list = await alice.api("GET", V);
    expect(list.body.items.map((i: { html_sha256: string }) => i.html_sha256)).toEqual([v1.body.current.html_sha256, v2.body.current.html_sha256, v1.body.current.html_sha256]);
    const act = await alice.api("GET", `${P}/activity?entity_id=plan`);
    expect(act.body.items.map((a: { summary: string }) => a.summary)).toContain("Published version 3 from version 1");
    expect(v3.body.current).not.toHaveProperty("note");
    // A change note is no longer part of publishing: an unknown field is refused.
    expect((await alice.api("POST", V, { note: "Retitled", expected_etag: v3.body.etag })).status).toBe(422);
    // An unknown base version, a stale etag and a first version without a title are refused.
    expect((await alice.api("POST", V, { from_version: 9, expected_etag: v3.body.etag })).status).toBe(404);
    expect((await alice.api("POST", V, { from_version: 1, expected_etag: v2.body.etag })).status).toBe(409);
    expect((await alice.api("POST", `${P}/story/pages/unborn/versions`, { from_version: 1 })).status).toBe(404);
    const untitled = await alice.api("POST", `${P}/story/pages/unborn/versions`, { html: html("x", "<h1>x</h1>") });
    expect(untitled.status).toBe(422);
    expect((await vic.api("POST", V, { from_version: 2, expected_etag: v3.body.etag })).status).toBe(403);
  });

  it("edits a later version's HTML by exact find and replace, or publishes nothing", async () => {
    const V = `${P}/story/pages/plan/versions`;
    const cur = await alice.api("GET", `${P}/story/pages/plan`);
    const patched = await alice.api("POST", V, { patch_html: [{ find: "<p>First.</p>", replace: "<p>First, corrected.</p>" }], expected_etag: cur.body.etag });
    expect(patched.status).toBe(201);
    expect(patched.body.carried_forward).toEqual(["title", "summary", "refs", "citations"]);
    const after = await alice.api("GET", `${P}/story/pages/plan`);
    expect(after.body.current.html).toBe(cur.body.current.html.replace("<p>First.</p>", "<p>First, corrected.</p>"));
    const missing = await alice.api("POST", V, { patch_html: [{ find: "<p>Nowhere.</p>", replace: "" }, { find: "Plan", replace: "Plan" }], expected_etag: after.body.etag });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("invalid_patch");
    expect(missing.body.error.details.problems).toHaveLength(2);
    const both = await alice.api("POST", V, { html: html("Plan", "<h1>Plan</h1>"), patch_html: [{ find: "Plan", replace: "Plan" }], expected_etag: after.body.etag });
    expect(both.status).toBe(422);
    expect((await alice.api("GET", V)).body.items[0].version).toBe(4);
  });

  it("regenerates a generated title page when only its title changes", async () => {
    const v1 = await alice.api("POST", `${P}/story/pages/cover/versions`, { title: "Cover", summary: "Where the discovery stands." });
    const v2 = await alice.api("POST", `${P}/story/pages/cover/versions`, { title: "Cover page", expected_etag: v1.body.etag });
    expect(v2.status).toBe(201);
    const page = await alice.api("GET", `${P}/story/pages/cover`);
    expect(page.body.current.html).toContain("<h1>Cover page</h1>");
    expect(page.body.current.html).toContain("Where the discovery stands.");
  });

  it("returns the notes etag from publish, and takes write_notes without an etag only while the notes are empty", async () => {
    const v1 = await alice.api("POST", `${P}/story/pages/memo/versions`, { title: "Memo", html: html("Memo", "<h1>Memo</h1>") });
    const page = await alice.api("GET", `${P}/story/pages/memo?include_html=false`);
    expect(v1.body.agent_notes_etag).toBe(page.body.agent_notes.etag);
    expect(page.body.current.html_sha256).toBe(v1.body.current.html_sha256);
    const first = await alice.api("PUT", `${P}/story/pages/memo/notes`, { notes: "## Purpose\n\nA memo." });
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    const again = await alice.api("PUT", `${P}/story/pages/memo/notes`, { notes: "Overwrite." });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: first.body.agent_notes.etag } });
    const pageEtag = await alice.api("PUT", `${P}/story/pages/memo/notes`, { notes: "Overwrite.", expected_etag: v1.body.etag });
    expect(pageEtag.status).toBe(409);
    expect(pageEtag.body.error.message).toContain("page etag");
    const ok = await alice.api("PUT", `${P}/story/pages/memo/notes`, { notes: "Overwrite.", expected_etag: first.body.agent_notes.etag });
    expect(ok.status).toBe(200);
    expect((await vic.api("PUT", `${P}/story/pages/memo/notes`, { notes: "x" })).status).toBe(403);
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
  it("splits what people did (the app) from what agents did (MCP)", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice)}` } } }));
    const viaMcp = await client.callTool({ name: "assumptions", arguments: { action: "create", product: productPath, params: { statement: "Written by an agent" } } });
    expect(viaMcp.isError).toBeFalsy();
    await client.close();
    const people = await alice.api("GET", `${P}/activity?by=people&limit=200`);
    expect(people.status).toBe(200);
    const channels = new Set(people.body.items.map((a: { channel: string | null }) => a.channel));
    expect(channels.has("web")).toBe(true);
    expect(channels.has("mcp")).toBe(false);
    const agents = await alice.api("GET", `${P}/activity?by=agents`);
    expect(agents.status).toBe(200);
    expect(agents.body.items.some((a: { entity_title: string }) => a.entity_title === "Written by an agent")).toBe(true);
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
    // Invitations are shown to whoever could cancel them: the product's admins, not its viewers.
    expect(r.body.invitations).toEqual([]);
    const forAdmin = await alice.api("GET", `/api/v1/tenants/${tenantSlug}/members?team=${teamSlug}&product=planner`);
    expect(forAdmin.body.invitations.map((i: { email: string }) => i.email)).toEqual(["invitee@example.com"]);
    const all = await carol.api("GET", `/api/v1/tenants/${tenantSlug}/members`);
    expect(all.body.members.map((m: { email: string }) => m.email)).toContain("carol@example.com");
    expect(all.body.product).toBeUndefined();
    const unknown = await vic.api("GET", `/api/v1/tenants/${tenantSlug}/members?team=${teamSlug}&product=nope`);
    expect(unknown.status).toBe(404);
    void bob;
  });
});

describe("the sample product", () => {
  it("seeds sources, an assumption, a mockup and Story pages with citations and notes", async () => {
    const ports = createPorts(h.config, h.blobs, h.mailer);
    await seed({ db: h.db, ports }, h.worker, () => {});
    const sam = await h.signIn("sam@example.com", "Sam Okafor");
    const products = await sam.api("GET", "/api/v1/me/products");
    const path = products.body.items.find((p: { name: string }) => p.name === "Crewboard").path;
    const S = `/api/v1/p/${path}`;
    expect((await sam.api("GET", `${S}/assumptions`)).body.items).toHaveLength(1);
    expect((await sam.api("GET", `${S}/mockups`)).body.items).toHaveLength(1);
    const tree = await sam.api("GET", `${S}/story/hierarchy`);
    expect(tree.body.mockups.map((m: { page_id: string }) => m.page_id)).toEqual(["jobs-board", "day-planner", "crew-message"]);
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
