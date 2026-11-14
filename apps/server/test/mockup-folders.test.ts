import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Mockups are arranged by hand: each in one folder or in none, folders one level deep, and the
// folders, the mockups in each and the mockups in none in the order they were given.

let h: Harness;
let alice: Browser;
let vic: Browser;
let rita: Browser;
let P: string;

const page = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1></body></html>`;

async function product(name: string) {
  const t = await alice.api("POST", "/api/v1/tenants", { name: `${name} Co` });
  const p = await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/products`, { name, concept: "A planner for finance teams." });
  return { base: `/api/v1/p/${p.body.path}`, tenant: t.body.tenant.slug as string, path: p.body.path as string };
}

async function mockup(base: string, title: string, extra: Record<string, unknown> = {}) {
  const r = await alice.api("POST", `${base}/mockups`, { title, pages: [{ page_id: "one", title: "One", html: page(title) }], ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { mockup_id: string; etag: string };
}

async function folder(base: string, name: string) {
  const r = await alice.api("POST", `${base}/mockup-folders`, { name });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { folder_id: string; name: string; etag: string; mockup_count: number };
}

/** The list as people see it: the titles in no folder, then each folder's name with its titles. */
async function arranged(base: string, who: Browser = alice) {
  const r = await who.api("GET", `${base}/mockups`);
  expect(r.status).toBe(200);
  const items = r.body.items as { title: string; folder_id: string | null }[];
  const folders = r.body.folders as { folder_id: string; name: string }[];
  return [items.filter((m) => m.folder_id === null).map((m) => m.title), ...folders.map((f) => [f.name, ...items.filter((m) => m.folder_id === f.folder_id).map((m) => m.title)])];
}

const move = (base: string, id: string, body: Record<string, unknown>, who: Browser = alice) => who.api("POST", `${base}/mockups/${id}/move`, body);

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const made = await product("Planner");
  P = made.base;
  for (const [email, role] of [["vic@example.com", "viewer"], ["rita@example.com", "reader"]])
    expect((await alice.api("POST", `/api/v1/tenants/${made.tenant}/members`, { product: "planner", email, role })).status).toBe(201);
});
afterAll(async () => h?.close());

describe("mockups in no folder", () => {
  it("lists a new mockup first, and keeps that order when an older one gets a new version", async () => {
    const a = await mockup(P, "Alpha");
    await mockup(P, "Beta");
    await mockup(P, "Gamma");
    expect(await arranged(P)).toEqual([["Gamma", "Beta", "Alpha"]]);
    expect((await alice.api("GET", `${P}/mockups`)).body.folders).toEqual([]);
    expect((await alice.api("POST", `${P}/mockups`, { mockup_id: a.mockup_id, expected_etag: a.etag, title: "Alpha" })).status).toBe(201);
    expect(await arranged(P)).toEqual([["Gamma", "Beta", "Alpha"]]);
  });

  it("moves a mockup in front of another, or to the end, and changes neither its etag nor when it was last changed", async () => {
    const list = (await alice.api("GET", `${P}/mockups`)).body.items as { mockup_id: string; title: string; etag: string; updated_at: string }[];
    const [gamma, beta, alpha] = list as [typeof list[0], typeof list[0], typeof list[0]];
    const r = await move(P, alpha.mockup_id, { before_mockup_id: gamma.mockup_id });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ mockup_id: alpha.mockup_id, title: "Alpha", moved: true, folder: null, order: [alpha.mockup_id, gamma.mockup_id, beta.mockup_id] });
    expect(await arranged(P)).toEqual([["Alpha", "Gamma", "Beta"]]);
    // Without a mockup to go in front of, it goes last.
    expect((await move(P, alpha.mockup_id, {})).body.order).toEqual([gamma.mockup_id, beta.mockup_id, alpha.mockup_id]);
    const after = (await alice.api("GET", `${P}/mockups/${alpha.mockup_id}`)).body;
    expect(after.etag).toBe(alpha.etag);
    expect(after.updated_at).toBe(alpha.updated_at);
    expect(after.folder).toBeNull();
  });

  it("says a move that changes nothing moved nothing, and records nothing for it", async () => {
    const list = (await alice.api("GET", `${P}/mockups`)).body.items as { mockup_id: string }[];
    const count = async () => (await alice.api("GET", `${P}/activity?entity_type=mockup&limit=100`)).body.items.filter((i: { action: string }) => i.action === "moved").length;
    const before = await count();
    const r = await move(P, list[0]!.mockup_id, { before_mockup_id: list[1]!.mockup_id });
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(false);
    expect(await count()).toBe(before);
  });

  it("refuses a move in front of itself, or in front of a mockup that is somewhere else", async () => {
    const list = (await alice.api("GET", `${P}/mockups`)).body.items as { mockup_id: string }[];
    const self = await move(P, list[0]!.mockup_id, { before_mockup_id: list[0]!.mockup_id });
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe("invalid_move");
    expect(self.body.error.message).toContain("names the mockup being moved");
    const f = await folder(P, "Elsewhere");
    const other = await move(P, list[0]!.mockup_id, { folder_id: f.folder_id, before_mockup_id: list[1]!.mockup_id });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("invalid_move");
    expect(other.body.error.message).toContain("is not in the folder Elsewhere");
    expect((await alice.api("POST", `${P}/mockup-folders/${f.folder_id}/remove`, {})).status).toBe(200);
  });
});

describe("folders", () => {
  let base: string;
  let ids: Record<string, string>;
  let drafts: { folder_id: string; etag: string };
  let checkout: { folder_id: string; etag: string };

  beforeAll(async () => {
    base = (await product("Folders")).base;
    ids = {};
    for (const title of ["One", "Two", "Three", "Four"]) ids[title] = (await mockup(base, title)).mockup_id;
  });

  it("makes a folder after the others, empty, with its name trimmed", async () => {
    drafts = await folder(base, "  Drafts ");
    expect(drafts).toMatchObject({ name: "Drafts", mockup_count: 0, etag: expect.any(String) });
    checkout = await folder(base, "Checkout");
    expect(await arranged(base)).toEqual([["Four", "Three", "Two", "One"], ["Drafts"], ["Checkout"]]);
  });

  it("refuses a second folder of a name, whatever its capitals, and names the one that has it", async () => {
    const r = await alice.api("POST", `${base}/mockup-folders`, { name: "drafts" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("folder_name_taken");
    expect(r.body.error.details).toEqual({ folder_id: drafts.folder_id, name: "Drafts" });
  });

  it("puts a mockup in a folder, last there, and the list gives the folder's own after those in none", async () => {
    const r = await move(base, ids["One"]!, { folder_id: checkout.folder_id });
    expect(r.body).toEqual({ mockup_id: ids["One"], title: "One", moved: true, folder: { folder_id: checkout.folder_id, name: "Checkout" }, order: [ids["One"]] });
    expect((await move(base, ids["Three"]!, { folder_id: checkout.folder_id })).body.order).toEqual([ids["One"], ids["Three"]]);
    expect((await move(base, ids["Two"]!, { folder_id: checkout.folder_id, before_mockup_id: ids["Three"] })).body.order).toEqual([ids["One"], ids["Two"], ids["Three"]]);
    expect(await arranged(base)).toEqual([["Four"], ["Drafts"], ["Checkout", "One", "Two", "Three"]]);
    const list = (await alice.api("GET", `${base}/mockups`)).body;
    expect(list.folders.map((f: { name: string; mockup_count: number }) => [f.name, f.mockup_count])).toEqual([["Drafts", 0], ["Checkout", 3]]);
    expect((await alice.api("GET", `${base}/mockups/${ids["Two"]}`)).body.folder).toEqual({ folder_id: checkout.folder_id, name: "Checkout" });
  });

  it("reorders a mockup inside its folder without naming the folder", async () => {
    expect((await move(base, ids["Three"]!, { before_mockup_id: ids["One"] })).body.order).toEqual([ids["Three"], ids["One"], ids["Two"]]);
    expect(await arranged(base)).toEqual([["Four"], ["Drafts"], ["Checkout", "Three", "One", "Two"]]);
  });

  it("takes a mockup out of its folder with folder_id null", async () => {
    const r = await move(base, ids["One"]!, { folder_id: null, before_mockup_id: ids["Four"] });
    expect(r.body.folder).toBeNull();
    expect(await arranged(base)).toEqual([["One", "Four"], ["Drafts"], ["Checkout", "Three", "Two"]]);
  });

  it("puts a new mockup first in the folder it names, and refuses a folder for a later version", async () => {
    const made = await mockup(base, "Five", { folder_id: checkout.folder_id });
    expect(await arranged(base)).toEqual([["One", "Four"], ["Drafts"], ["Checkout", "Five", "Three", "Two"]]);
    const again = await alice.api("POST", `${base}/mockups`, { mockup_id: made.mockup_id, expected_etag: made.etag, folder_id: drafts.folder_id });
    expect(again.status).toBe(422);
    expect(again.body.error.message).toContain('mockups_write(action="move")');
    const nowhere = await alice.api("POST", `${base}/mockups`, { title: "Six", folder_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", pages: [{ page_id: "one", title: "One", html: page("Six") }] });
    expect(nowhere.status).toBe(404);
    expect(await arranged(base)).toEqual([["One", "Four"], ["Drafts"], ["Checkout", "Five", "Three", "Two"]]);
  });

  it("gives a folder another place among the folders", async () => {
    const r = await alice.api("POST", `${base}/mockup-folders/${checkout.folder_id}/move`, { before_folder_id: drafts.folder_id });
    expect(r.status).toBe(200);
    expect(r.body.folders.map((f: { name: string }) => f.name)).toEqual(["Checkout", "Drafts"]);
    expect((await alice.api("POST", `${base}/mockup-folders/${checkout.folder_id}/move`, {})).body.folders.map((f: { name: string }) => f.name)).toEqual(["Drafts", "Checkout"]);
    const self = await alice.api("POST", `${base}/mockup-folders/${checkout.folder_id}/move`, { before_folder_id: checkout.folder_id });
    expect(self.status).toBe(422);
    expect((await alice.api("POST", `${base}/mockup-folders/${checkout.folder_id}/move`, { before_folder_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).status).toBe(404);
  });

  it("renames a folder with its etag, refuses a stale one, and refuses another folder's name", async () => {
    const stale = await alice.api("PATCH", `${base}/mockup-folders/${checkout.folder_id}`, { name: "Payment", expected_etag: "stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    expect(stale.body.error.details.current_etag).toBe(checkout.etag);
    const taken = await alice.api("PATCH", `${base}/mockup-folders/${checkout.folder_id}`, { name: "DRAFTS", expected_etag: checkout.etag });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("folder_name_taken");
    const r = await alice.api("PATCH", `${base}/mockup-folders/${checkout.folder_id}`, { name: "Payment", expected_etag: checkout.etag });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ folder_id: checkout.folder_id, name: "Payment", mockup_count: 3 });
    expect(r.body.etag).not.toBe(checkout.etag);
    // Its own name in other capitals is a rename, not a clash.
    const recased = await alice.api("PATCH", `${base}/mockup-folders/${checkout.folder_id}`, { name: "payment", expected_etag: r.body.etag });
    expect(recased.status).toBe(200);
    checkout = recased.body;
  });

  it("keeps an archived mockup in its folder, refuses to move it, and brings it back where it was", async () => {
    const three = (await alice.api("GET", `${base}/mockups/${ids["Three"]}`)).body;
    const archived = await alice.api("POST", `${base}/mockups/${ids["Three"]}/archive`, { expected_etag: three.etag });
    expect(archived.status).toBe(200);
    expect(await arranged(base)).toEqual([["One", "Four"], ["Drafts"], ["payment", "Five", "Two"]]);
    expect((await alice.api("GET", `${base}/mockups`)).body.folders[1].mockup_count).toBe(2);
    const refused = await move(base, ids["Three"]!, { folder_id: null });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("mockup_archived");
    expect((await alice.api("POST", `${base}/mockups/${ids["Three"]}/restore`, { expected_etag: archived.body.etag })).status).toBe(200);
    expect(await arranged(base)).toEqual([["One", "Four"], ["Drafts"], ["payment", "Five", "Three", "Two"]]);
  });

  it("removes a folder and leaves its mockups, after those in no folder, in the order they had", async () => {
    const r = await alice.api("POST", `${base}/mockup-folders/${checkout.folder_id}/remove`, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ removed: true, folder_id: checkout.folder_id, name: "payment" });
    expect(r.body.mockups_unfiled).toHaveLength(3);
    expect(await arranged(base)).toEqual([["One", "Four", "Five", "Three", "Two"], ["Drafts"]]);
    expect((await alice.api("GET", `${base}/mockups/${ids["Two"]}`)).body.folder).toBeNull();
    expect((await alice.api("POST", `${base}/mockup-folders/${checkout.folder_id}/remove`, {})).status).toBe(404);
    expect((await move(base, ids["Two"]!, { folder_id: checkout.folder_id })).status).toBe(404);
  });

  it("records each change in the activity log, as changes to mockups", async () => {
    const log = (await alice.api("GET", `${base}/activity?entity_type=mockup&limit=100`)).body.items as { action: string; entity_title: string; summary: string }[];
    const said = log.map((i) => `${i.action}: ${i.entity_title}: ${i.summary}`);
    expect(said).toContain("folder_created: Drafts: Made the folder");
    expect(said).toContain("moved: One: Moved the mockup into the folder Checkout");
    expect(said).toContain("moved: Three: Moved the mockup among those in the folder Checkout");
    expect(said).toContain("moved: One: Moved the mockup out of its folder");
    expect(said).toContain("folder_moved: Checkout: Moved the folder in front of Drafts");
    expect(said).toContain("folder_moved: Checkout: Moved the folder after the others");
    expect(said).toContain("folder_renamed: Payment: Renamed the folder, which was Checkout");
    expect(said).toContain("folder_removed: payment: Removed the folder; its 3 mockups are in no folder now");
  });

  it("holds as many folders as the team makes", async () => {
    const many = (await product("Many")).base;
    for (let i = 1; i <= 25; i++) await folder(many, `Folder ${i}`);
    const list = (await alice.api("GET", `${many}/mockups`)).body;
    expect(list.folders).toHaveLength(25);
    expect(list.folders.map((f: { name: string }) => f.name).slice(0, 3)).toEqual(["Folder 1", "Folder 2", "Folder 3"]);
  });
});

describe("who may arrange", () => {
  it("lets a viewer read the arrangement and change none of it, and gives a reader nothing", async () => {
    const f = await folder(P, "Shared");
    const list = (await vic.api("GET", `${P}/mockups`)).body;
    expect(list.folders.map((x: { name: string }) => x.name)).toEqual(["Shared"]);
    const id = list.items[0].mockup_id as string;
    for (const r of [
      await vic.api("POST", `${P}/mockup-folders`, { name: "Mine" }),
      await vic.api("PATCH", `${P}/mockup-folders/${f.folder_id}`, { name: "Mine", expected_etag: f.etag }),
      await vic.api("POST", `${P}/mockup-folders/${f.folder_id}/move`, {}),
      await vic.api("POST", `${P}/mockup-folders/${f.folder_id}/remove`, {}),
      await move(P, id, { folder_id: f.folder_id }, vic),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.error.message).toContain("needs editor");
    }
    expect((await rita.api("GET", `${P}/mockups`)).status).toBe(403);
    expect((await move(P, id, { folder_id: f.folder_id }, rita)).status).toBe(403);
  });
});

describe("an agent", () => {
  it("arranges mockups through mockups_write, and reads the arrangement through mockups_read", async () => {
    const made = await product("Agent");
    const one = await mockup(made.base, "One");
    const two = await mockup(made.base, "Two");
    const token = await h.connectAgent(alice, "Arranging agent");
    const client = new Client({ name: "arranging-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const call = async (name: string, action: string, params: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: { action, params, product: made.path } })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError, r.content[0]!.text).toBeFalsy();
      return JSON.parse(r.content[0]!.text);
    };
    const tools = (await client.listTools()).tools;
    const write = tools.find((t) => t.name === "mockups_write")!;
    expect(write.description).toContain("Arrange mockups in folders");
    for (const action of ["create_folder", "rename_folder", "move_folder", "remove_folder", "move"]) expect(JSON.stringify(write.inputSchema), action).toContain(`"${action}"`);
    expect(tools.find((t) => t.name === "mockups_delete")!.description).not.toContain("folder");
    const f = await call("mockups_write", "create_folder", { name: "Onboarding" });
    await call("mockups_write", "move", { mockup_id: one.mockup_id, folder_id: f.folder_id });
    const moved = await call("mockups_write", "move", { mockup_id: two.mockup_id, folder_id: f.folder_id, before_mockup_id: one.mockup_id });
    expect(moved.order).toEqual([two.mockup_id, one.mockup_id]);
    const list = await call("mockups_read", "list", {});
    expect(list.items.map((m: { title: string; folder_id: string }) => [m.title, m.folder_id])).toEqual([["Two", f.folder_id], ["One", f.folder_id]]);
    expect(list.folders).toMatchObject([{ folder_id: f.folder_id, name: "Onboarding", mockup_count: 2 }]);
    await client.close();
  });
});

describe("the migration to arranged mockups", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0045_mockup_folders.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    const saved = async (tenant: string, productId: string, id: string, changed: string) => {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      await client.query(
        `insert into mockups (mockup_id, tenant_id, product_id, title, current_version_id, version_count, etag, created_by, updated_at, updated_by) values ($1, $2, $3, $1, 'v', 1, 'e', $4, $5, $4)`,
        [id, tenant, productId, actor, changed],
      );
      await client.query("commit");
    };
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1), ('T2', 'other', 'Other', $1)`, [actor]);
    for (const [tenant, id] of [["T1", "P1"], ["T1", "P2"], ["T2", "P3"]]) {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      await client.query(`insert into products (product_id, tenant_id, slug, name, etag, created_by, updated_by) values ($1, $2, lower($1), $1, 'e', $3, $3)`, [id, tenant, actor]);
      await client.query("commit");
    }
    await saved("T1", "P1", "OLD", "2026-09-01T00:00:00Z");
    await saved("T1", "P1", "NEW", "2026-09-03T00:00:00Z");
    await saved("T1", "P1", "MID", "2026-09-02T00:00:00Z");
    await saved("T1", "P2", "ONLY", "2026-09-02T00:00:00Z");
    await saved("T2", "P3", "THEIRS-OLD", "2026-08-01T00:00:00Z");
    await saved("T2", "P3", "THEIRS-NEW", "2026-08-02T00:00:00Z");
    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));
  }, 120_000);
  afterAll(async () => client?.end());

  it("leaves every mockup in no folder, in the order the list showed them: most recently changed first", async () => {
    const order = async (tenant: string, productId: string) => {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      const r = await client.query("select mockup_id, folder_id from mockups where product_id = $1 order by position", [productId]);
      await client.query("commit");
      expect(r.rows.every((row) => row.folder_id === null)).toBe(true);
      return r.rows.map((row) => row.mockup_id);
    };
    expect(await order("T1", "P1")).toEqual(["NEW", "MID", "OLD"]);
    expect(await order("T1", "P2")).toEqual(["ONLY"]);
    expect(await order("T2", "P3")).toEqual(["THEIRS-NEW", "THEIRS-OLD"]);
  });
});
