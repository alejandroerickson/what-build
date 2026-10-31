import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { houseStyle, OPERATIONS, readsOnlyTheStoryIn } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restPath } from "../src/rest.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday.

00:00:05.000 --> 00:00:09.000
<v Dana>Because that is when the numbers close.
`;

let h: Harness;
let alice: Browser;
let rita: Browser;
let P: string;
let productPath: string;
let tenantSlug: string;
let teamSlug: string;
let recordId: string;

const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${houseStyle("clear")!.stylesheet}</style></head><body><main class="page">${body}</main></body></html>`;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Reader Co" });
  tenantSlug = t.body.tenant.slug;
  teamSlug = t.body.team.slug;
  const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Planner", concept: "A planner for finance teams." });
  productPath = p.body.path;
  P = `/api/v1/p/${productPath}`;
  await alice.api("POST", `${P}/outcomes`, { title: "Close the books faster" });
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Finance lead interview — Example Co, Sep 2026", date: "2026-09-03", path: "call.vtt" });
  recordId = created.body.record.record_id;
  const up = created.body.upload;
  await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt" });
  await h.worker.drain();
  const v1 = await alice.api("POST", `${P}/story/pages/overview/versions`, {
    title: "Overview",
    summary: "Where the discovery stands.",
    html: html("Overview", `<h1>Overview</h1><p>Numbers close on Fridays (source ${recordId}).</p>`),
  });
  const page = await alice.api("GET", `${P}/story/pages/overview?include_html=false`);
  await alice.api("PUT", `${P}/story/pages/overview/notes`, { notes: "Fold in the pricing interviews next.", expected_etag: page.body.agent_notes.etag });
  await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", html: html("Overview", "<h1>Overview</h1><p>Second version.</p>"), expected_etag: v1.body.etag });
  const g = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "planner", email: "rita@example.com", role: "reader" });
  expect(g.status).toBe(201);
});
afterAll(async () => h?.close());

function fill(p: string) {
  const [tenant, team, product] = productPath.split("/");
  return p
    .replace(":tenant", tenant!)
    .replace(":team", team!)
    .replace(":product", product!)
    .replace(/:[a-z_]+/g, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
}

describe("a Story reader", () => {
  it("sees the product in their list with their role, its name and how many Story pages it has, and nothing else it holds", async () => {
    const list = await rita.api("GET", "/api/v1/me/products");
    const item = list.body.items.find((i: { path: string }) => i.path === productPath);
    expect(item).toMatchObject({ name: "Planner", your_role: "reader", counts: { story_pages: 1 } });
    expect(item.counts).toEqual({ story_pages: 1 });
    expect(item).not.toHaveProperty("concept");
    const product = await rita.api("GET", P);
    expect(product.status).toBe(200);
    expect(product.body).toMatchObject({ name: "Planner", your_role: "reader", counts: { story_pages: 1 } });
    expect(product.body.counts).toEqual({ story_pages: 1 });
    expect(product.body).not.toHaveProperty("concept");
  });

  it("reads every live Story page and version, without the notes for agents", async () => {
    const tree = await rita.api("GET", `${P}/story/hierarchy`);
    expect(tree.status).toBe(200);
    expect(tree.body.items).toEqual([]);
    expect(tree.body.unplaced.map((n: { page_id: string }) => n.page_id)).toEqual(["overview"]);
    const pages = await rita.api("GET", `${P}/story/pages?include_archived=true`);
    expect(pages.body.items.map((x: { page_id: string }) => x.page_id)).toEqual(["overview"]);

    const page = await rita.api("GET", `${P}/story/pages/overview`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ page_id: "overview", title: "Overview", current_version: 2 });
    expect(page.body).not.toHaveProperty("agent_notes");
    expect(page.body.current.html).toContain("Second version.");

    const versions = await rita.api("GET", `${P}/story/pages/overview/versions`);
    expect(versions.body.items.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.body.items[1]).toMatchObject({ title: "Overview", published_by: { display_name: "Alice Admin" } });

    const v1 = await rita.api("GET", `${P}/story/pages/overview/versions/1`);
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({ version: 1, summary: "Where the discovery stands.", is_current: false });
    // The page itself is not changed: what its author wrote about the evidence is the reader's to read.
    expect(v1.body.html).toContain(`source ${recordId}`);
    expect(JSON.stringify(v1.body)).not.toContain("Finance lead interview");

    // The team reads the notes for agents too.
    const full = await alice.api("GET", `${P}/story/pages/overview`);
    expect(full.body.agent_notes.content).toBe("Fold in the pricing interviews next.");
  });

  it("opens a page's HTML and exports the Story to print", async () => {
    const page = await rita.api("GET", `${P}/story/pages/overview/versions/1/html?frame=1`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("Numbers close on Fridays");
    const plan = await rita.api("GET", `${P}/story/print-view?page_ids=overview`);
    expect(plan.status).toBe(200);
    expect(plan.body.pages.map((x: { page_id: string }) => x.page_id)).toEqual(["overview"]);
    const doc = await rita.api("GET", `${P}/story/print?page_ids=overview`);
    expect(doc.status).toBe(200);
    expect(doc.body).toContain("Second version.");
  });

  it("is given no archived page, in the lists or by its address, while the team still is", async () => {
    const old = await alice.api("POST", `${P}/story/pages/old-plan/versions`, { title: "Old plan", html: html("Old plan", "<h1>Old plan</h1>") });
    expect((await alice.api("POST", `${P}/story/pages/old-plan/archive`, { expected_etag: old.body.etag })).status).toBe(200);
    const pages = await rita.api("GET", `${P}/story/pages?include_archived=true`);
    expect(pages.body.items.map((x: { page_id: string }) => x.page_id)).toEqual(["overview"]);
    // Nor is a reader told that the team archived anything.
    expect(pages.body).not.toHaveProperty("archived_hidden");
    expect(pages.body).not.toHaveProperty("note");
    expect((await rita.api("GET", `${P}/story/pages`)).body).not.toHaveProperty("archived_hidden");
    for (const path of [`${P}/story/pages/old-plan`, `${P}/story/pages/old-plan/versions`, `${P}/story/pages/old-plan/versions/1`, `${P}/story/pages/old-plan/versions/1/html`, `${P}/story/print-view?page_ids=old-plan`, `${P}/story/print?page_ids=overview,old-plan`]) {
      const r = await rita.api("GET", path);
      expect(r.status, path).toBe(404);
    }
    const team = await alice.api("GET", `${P}/story/pages?include_archived=true`);
    expect(team.body.items.map((x: { page_id: string }) => x.page_id)).toEqual(["old-plan", "overview"]);
    expect((await alice.api("GET", `${P}/story/pages`)).body).toMatchObject({ items: [{ page_id: "overview" }], archived_hidden: 1 });
    expect((await alice.api("GET", `${P}/story/pages/old-plan`)).status).toBe(200);
    expect((await alice.api("GET", `${P}/story/pages/old-plan/versions/1/html`)).status).toBe(200);
  });

  it("is refused, with 403 naming their role, by every other operation on the product", async () => {
    const refused: string[] = [];
    for (const op of OPERATIONS) {
      if (op.scope !== "product" || op.access === "story") continue;
      const r = await rita.api(op.rest.method, fill(restPath(op)), op.rest.method === "GET" ? undefined : {});
      expect(r.status, `${op.name} ${op.rest.method} ${restPath(op)} → ${JSON.stringify(r.body)}`).toBe(403);
      expect(r.body.error.details.role, op.name).toBe("reader");
      refused.push(op.name);
    }
    for (const name of ["sources.list", "derived.text", "derived.write_text", "assumptions.list", "outcomes.list", "activity.list", "products.export", "story.get_style"])
      expect(refused).toContain(name);
    const sources = await rita.api("GET", `${P}/sources`);
    expect(sources.body.error.message).toMatch(/reader.*needs viewer/);
  });

  it("cannot download a source's attachment or derived text, an export or a style specimen", async () => {
    for (const path of [`${P}/sources/${recordId}/attachment?path=call.vtt`, `${P}/sources/${recordId}/text`, `${P}/exports/01ARZ3NDEKTSV4RRFFQ69G5FAV/file`, `${P}/story/house-styles/clear/specimen`]) {
      const r = await rita.api("GET", path);
      expect(r.status, path).toBe(403);
    }
  });

  it("gives their agent the same Story and the same refusals", async () => {
    const token = await h.connectAgent(rita);
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const page = (await client.callTool({ name: "story_read", arguments: { action: "get_page", product: productPath, params: { page_id: "overview", include_html: false } } })) as { isError?: boolean; content: { text: string }[] };
    expect(page.isError).toBeFalsy();
    expect(page.content[0]!.text).toContain("Overview");
    expect(page.content[0]!.text).not.toContain("agent_notes");
    const sources = (await client.callTool({ name: "sources_read", arguments: { action: "list", product: productPath } })) as { isError?: boolean; content: { text: string }[] };
    expect(sources.isError).toBe(true);
    expect(sources.content[0]!.text).toMatch(/reader.*needs viewer/);
    await client.close();
  });

  it("is granted on a team or a product only, and is invited like any other role", async () => {
    const tenantWide = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { email: "rita@example.com", role: "reader" });
    expect(tenantWide.status).toBe(422);
    expect(tenantWide.body.error.code).toBe("invalid_role");
    const inv = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "stakeholder@example.com", role: "reader" });
    expect(inv.body.invited).toBe(true);
    const stakeholder = await h.signIn("stakeholder@example.com");
    const list = await stakeholder.api("GET", "/api/v1/me/products");
    expect(list.body.items.find((i: { path: string }) => i.path === productPath)).toMatchObject({ your_role: "reader" });
    const people = await alice.api("GET", `/api/v1/tenants/${tenantSlug}/members?product=${encodeURIComponent(productPath.split("/")[2]!)}&team=${teamSlug}`);
    const listed = people.body.members.find((m: { email: string }) => m.email === "rita@example.com");
    expect(listed.product_access).toEqual({ role: "reader", via: "product" });
  });

  it("sees none of the organization's people", async () => {
    for (const path of [`/api/v1/tenants/${tenantSlug}/members`, `/api/v1/tenants/${tenantSlug}/members?team=${teamSlug}&product=planner`]) {
      const r = await rita.api("GET", path);
      expect(r.status, path).toBe(403);
      expect(r.body.error.details).toEqual({ role: "reader", needed: "viewer" });
    }
    const list = await rita.api("GET", "/api/v1/me/products");
    expect(list.body.tenants.find((t: { slug: string }) => t.slug === tenantSlug)).toMatchObject({ story_only: true });
  });

  it("reads everything once another grant makes them a viewer, since the highest role applies", async () => {
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "rita@example.com", role: "viewer" });
    expect((await rita.api("GET", `/api/v1/tenants/${tenantSlug}/members`)).status).toBe(200);
    expect((await rita.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === tenantSlug).story_only).toBeUndefined();
    const product = await rita.api("GET", P);
    expect(product.body).toMatchObject({ your_role: "viewer", concept: "A planner for finance teams.", counts: { sources: 1, outcomes: 1, story_pages: 1 } });
    const page = await rita.api("GET", `${P}/story/pages/overview`);
    expect(page.body.agent_notes.content).toBe("Fold in the pricing interviews next.");
    expect((await rita.api("GET", `${P}/sources`)).status).toBe(200);
  });

  it("cannot finish an upload with a grant they were given as an editor", async () => {
    const before = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "planner", email: "eddie@example.com", role: "editor" });
    expect(before.status).toBe(201);
    const eddie = await h.signIn("eddie@example.com", "Eddie Editor");
    const created = await eddie.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Second interview", date: "2026-09-04", path: "call.vtt" });
    expect(created.status).toBe(201);
    const up = created.body.upload;
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "planner", email: "eddie@example.com", role: "reader" });
    const put = await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
    expect(put.status).toBe(403);
    expect(((await put.json()) as { error: { details: { role: string } } }).error.details.role).toBe("reader");
    const source = await alice.api("GET", `${P}/sources/${created.body.record.record_id}?detail=full`);
    expect(source.body.attachments).toEqual([]);
  });
});

describe("reading only the Story in an organization", () => {
  const g = (scope_type: string, role: string, tenant_id = "t1") => ({ tenant_id, scope_type, scope_id: "x", role });
  it("holds for a reader with no higher role there, whatever they hold elsewhere", () => {
    expect(readsOnlyTheStoryIn([g("product", "reader"), g("team", "reader")], "t1")).toBe(true);
    expect(readsOnlyTheStoryIn([g("tenant", "member"), g("product", "reader")], "t1")).toBe(true);
    expect(readsOnlyTheStoryIn([g("product", "reader"), g("product", "editor", "t2")], "t1")).toBe(true);
  });
  it("does not hold for a higher role on any team or product, an organization admin, or someone with no reader role", () => {
    expect(readsOnlyTheStoryIn([g("product", "reader"), g("product", "viewer")], "t1")).toBe(false);
    expect(readsOnlyTheStoryIn([g("tenant", "admin"), g("product", "reader")], "t1")).toBe(false);
    expect(readsOnlyTheStoryIn([g("tenant", "member")], "t1")).toBe(false);
    expect(readsOnlyTheStoryIn([], "t1")).toBe(false);
  });
});
