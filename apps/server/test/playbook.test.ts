import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPlaybookZip } from "@whatbuild/core";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Each product's Playbook: the starter served until the first write copies it in, files written with
// etags and kept as revisions, several at once, whatbuild: links and what cites an object, messages
// between people's agents, housekeeping, and the product's admins turning it off.

let h: Harness;
let alice: Browser; // admin
let erin: Browser; // editor
let vic: Browser; // viewer
let rita: Browser; // Story reader
let tenant: string;
let P: string;
let path: string;
let ids: Record<string, string> = {};

const md = (title: string, body = "Text.", extra = "") => `---\ntype: Lesson\ntitle: ${title}\ndescription: What ${title} says.\n${extra}---\n\n${body}\n`;

async function write(who: Browser, file: string, content: string, expected_etag?: string, message?: string) {
  return who.api("PUT", `${P}/playbook/file`, { path: file, content, ...(expected_etag ? { expected_etag } : {}), ...(message ? { message } : {}) });
}
const read = (who: Browser, file: string, revision?: number) => who.api("GET", `${P}/playbook/file?path=${encodeURIComponent(file)}${revision ? `&revision=${revision}` : ""}`);

async function agent(who: Browser, level: "viewer" | "editor" | "admin" = "admin") {
  const token = await h.connectAgent(who, "Playbook agent", "/mcp", level);
  const client = new Client({ name: "playbook-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const call = async (name: string, action: string, params: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: { action, params, product: path } })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]!.text;
    return r.isError ? { error: true, status: Number(text.slice(0, 3)), text } : { error: false, status: 200, body: JSON.parse(text), text };
  };
  return { client, call };
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  erin = await h.signIn("erin@example.com", "Erin Editor");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Crew Co" });
  tenant = t.body.tenant.slug;
  const p = await alice.api("POST", `/api/v1/tenants/${tenant}/products`, { name: "Crewboard", concept: "Weekly planning for field crews." });
  path = p.body.path;
  P = `/api/v1/p/${path}`;
  for (const [email, role] of [["erin@example.com", "editor"], ["vic@example.com", "viewer"], ["rita@example.com", "story_reader"]])
    expect((await alice.api("POST", `/api/v1/tenants/${tenant}/members`, { product: p.body.product_id, email, role })).status).toBe(201);
  for (const who of [erin, vic]) ids[who.email] = (await who.api("GET", "/api/v1/me")).body.account_id;
});
afterAll(async () => h?.close());

describe("the starter", () => {
  it("is served until the first write, at revision 0, and the product's answer says what to read first", async () => {
    const index = await vic.api("GET", `${P}/playbook`);
    expect(index.status, JSON.stringify(index.body)).toBe(200);
    expect(index.body.okf_version).toBe("0.2");
    expect(index.body.started).toBe(false);
    const paths = index.body.files.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["using-this-playbook.md", "how-to/lessons.md", "how-to/kits.md", "how-to/housekeeping.md", "how-to/people-and-messages.md", "product/now.md", "product/evidence-map.md"]));
    expect(index.body.files[0]).toMatchObject({ revision: 0, from_starter: true });
    expect(index.body.index_md).toContain("[How this product's agents work together through its Playbook](/using-this-playbook.md)");
    expect(index.body.index_md).toContain("* [how-to](/how-to/) - 4 files");
    const guide = await vic.api("GET", `${P}/playbook/file?path=using-this-playbook.md`);
    expect(guide.body.content).toContain("WhatBuild is meant to be used through it.");
    expect(guide.body.etag).toMatch(/^starter-/);
    const product = (await vic.api("GET", P)).body;
    expect(product.playbook_enabled).toBe(true);
    expect(product.playbook).toMatchObject({ enabled: true, started: false, messages_waiting: 0 });
    expect(product.playbook.read_first.map((f: { path: string }) => f.path)).toContain("using-this-playbook.md");
    expect(product.playbook.by_area.evidence).toContain("product/evidence-map.md");
    // Search and history work on the starter too.
    expect((await vic.api("GET", `${P}/playbook/search?query=kit`)).body.files.map((f: { path: string }) => f.path)).toContain("how-to/kits.md");
    expect((await vic.api("GET", `${P}/playbook/history`)).body).toMatchObject({ started: false, revisions: [] });
  });

  it("is copied in, with the etags it served, by the first write of any file", async () => {
    const served = (await read(erin, "product/now.md")).body.etag as string;
    const r = await write(erin, "lessons/canvas-titles.md", md("Canvas titles say the decision"), undefined, "Ana corrected the pricing canvas.");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ path: "lessons/canvas-titles.md", revision: 1, changed: true, created: true, type: "Lesson", title: "Canvas titles say the decision" });
    const index = (await erin.api("GET", `${P}/playbook`)).body;
    expect(index.started).toBe(true);
    const now = index.files.find((f: { path: string }) => f.path === "product/now.md");
    expect(now).toMatchObject({ revision: 1, etag: served, updated_by: { display_name: "WhatBuild" } });
    expect(now.from_starter).toBeUndefined();
    // A write against what the starter served still matches.
    const changed = await write(erin, "product/now.md", md("What the team is working on now", "Settling per-seat pricing."), served);
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.revision).toBe(2);
    const starter = (await erin.api("GET", `${P}/playbook/starter?path=product/now.md`)).body;
    expect(starter.files[0].in_product).toMatchObject({ same: false });
  });
});

describe("files", () => {
  it("takes the etag of the last read once a file exists, and refuses with the text to merge with", async () => {
    const first = (await read(erin, "lessons/canvas-titles.md")).body;
    const blind = await write(alice, "lessons/canvas-titles.md", md("Canvas titles", "Overwritten."));
    expect(blind.status).toBe(409);
    expect(blind.body.error.code).toBe("stale_etag");
    expect(blind.body.error.details).toMatchObject({ current_etag: first.etag, current_revision: 1 });
    expect(blind.body.error.details.current_content).toBe(first.content);
    const next = await write(alice, "lessons/canvas-titles.md", md("Canvas titles say the decision", "Title each page with its decision."), first.etag);
    expect(next.status).toBe(200);
    const stale = await write(erin, "lessons/canvas-titles.md", md("Canvas titles", "Mine."), first.etag);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.current_content).toContain("Title each page with its decision.");
    // An etag for a path that holds nothing matches nothing.
    const ghost = await write(erin, "lessons/new.md", md("New"), first.etag);
    expect(ghost.status).toBe(409);
    expect(ghost.body.error.details.current_etag).toBeNull();
    // The same text again changes nothing.
    const same = await write(alice, "lessons/canvas-titles.md", md("Canvas titles say the decision", "Title each page with its decision."), next.body.etag);
    expect(same.body).toMatchObject({ changed: false, revision: 2, etag: next.body.etag });
  });

  it("requires frontmatter that names a type in Markdown, warns of what helps finding it, and takes a kit's files as they are", async () => {
    const none = await write(erin, "lessons/plain.md", "# Just text\n");
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("playbook_frontmatter_missing");
    const untyped = await write(erin, "lessons/plain.md", "---\ntitle: No type\n---\nText\n");
    expect(untyped.body.error.code).toBe("playbook_type_missing");
    // The format is named, not only its initials.
    expect(untyped.body.error.message).toContain("The Open Knowledge Format (OKF) requires one");
    const bare = await write(erin, "lessons/bare.md", "---\ntype: Lesson\napplies_to: [exploration, canvases]\nstale_after: soon\n---\nText\n");
    expect(bare.status).toBe(200);
    expect(bare.body.warnings.join(" ")).toMatch(/no title.*no description.*canvases.*stale_after/s);
    expect(bare.body.applies_to).toEqual(["exploration"]);
    const kit = await write(erin, "kits/canvas/zip.mjs", "export const zip = () => 1;\n");
    expect(kit.status).toBe(200);
    expect(kit.body.type).toBeNull();
  });

  it("refuses paths that break the rules, and the names WhatBuild writes itself", async () => {
    for (const bad of ["../etc/passwd.md", "lessons/a b.md", "lessons/.hidden.md", "lessons/no-extension", "lessons/picture.png", ""]) {
      const r = await write(erin, bad, md("Bad"));
      expect([422].includes(r.status), `${bad}: ${JSON.stringify(r.body)}`).toBe(true);
    }
    expect((await write(erin, "lessons/index.md", md("Index"))).body.error.code).toBe("playbook_reserved_path");
    expect((await write(erin, "log.md", md("Log"))).body.error.code).toBe("playbook_reserved_path");
    expect((await write(erin, "Lessons/INDEX.md", md("Index"))).body.error.code).toBe("playbook_reserved_path");
    // Two paths that differ only in capitals are one.
    const twin = await write(erin, "lessons/Canvas-Titles.md", md("Twin"));
    expect(twin.status).toBe(409);
    expect(twin.body.error).toMatchObject({ code: "playbook_path_taken", details: { path: "lessons/canvas-titles.md" } });
    // A link's leading slash names the same file.
    expect((await read(erin, "/lessons/canvas-titles.md")).body.path).toBe("lessons/canvas-titles.md");
  });

  it("keeps every revision, reads any of them, and restores one as the next", async () => {
    const hist = (await vic.api("GET", `${P}/playbook/history?path=lessons/canvas-titles.md`)).body;
    expect(hist.revisions.map((r: { revision: number; change: string }) => [r.revision, r.change])).toEqual([[2, "written"], [1, "written"]]);
    expect(hist.revisions[1]).toMatchObject({ message: "Ana corrected the pricing canvas.", created_by: { display_name: "Erin Editor" } });
    const old = (await read(vic, "lessons/canvas-titles.md", 1)).body;
    expect(old.content).toContain("Text.");
    const now = (await read(erin, "lessons/canvas-titles.md")).body;
    const back = await erin.api("POST", `${P}/playbook/file/restore`, { path: "lessons/canvas-titles.md", revision: 1, expected_etag: now.etag });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({ revision: 3, restored_revision: 1 });
    expect((await read(erin, "lessons/canvas-titles.md")).body.content).toBe(old.content);
    const log = (await vic.api("GET", `${P}/playbook/history`)).body;
    expect(log.log_md).toContain("**Restoration**: [lessons/canvas-titles.md](/lessons/canvas-titles.md), revision 3");
  });

  it("removes a file keeping its history, and restores it", async () => {
    const f = (await read(erin, "lessons/bare.md")).body;
    expect((await erin.api("POST", `${P}/playbook/file/remove`, { path: "lessons/bare.md" })).status).toBe(422);
    const gone = await erin.api("POST", `${P}/playbook/file/remove`, { path: "lessons/bare.md", expected_etag: f.etag, message: "Merged into canvas-titles." });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ removed: true, revision: 2 });
    expect((await erin.api("GET", `${P}/playbook`)).body.files.map((x: { path: string }) => x.path)).not.toContain("lessons/bare.md");
    const missing = await read(erin, "lessons/bare.md");
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toContain("was removed");
    const back = await erin.api("POST", `${P}/playbook/file/restore`, { path: "lessons/bare.md", revision: 1 });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.revision).toBe(3);
    const nothing = await erin.api("POST", `${P}/playbook/file/restore`, { path: "lessons/bare.md", revision: 2, expected_etag: back.body.etag });
    expect(nothing.body.error.code).toBe("playbook_nothing_to_restore");
  });

  it("moves a file with its history, and never onto another", async () => {
    const f = (await read(erin, "lessons/bare.md")).body;
    const taken = await erin.api("POST", `${P}/playbook/file/move`, { path: "lessons/bare.md", to: "lessons/canvas-titles.md", expected_etag: f.etag });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("playbook_path_taken");
    const moved = await erin.api("POST", `${P}/playbook/file/move`, { path: "lessons/bare.md", to: "lessons/archive/bare.md", expected_etag: f.etag });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ path: "lessons/archive/bare.md", revision: 4, moved_from: "lessons/bare.md" });
    const hist = (await erin.api("GET", `${P}/playbook/history?path=lessons/archive/bare.md`)).body;
    expect(hist.revisions.map((r: { change: string }) => r.change)).toEqual(["moved", "restored", "removed", "written"]);
    // The path it left held it, so what answers there says where it went, and changes nothing.
    for (const r of [await read(vic, "lessons/bare.md"), await vic.api("GET", `${P}/playbook/history?path=lessons/bare.md`), await read(vic, "lessons/bare.md", 1)]) {
      expect(r.status, JSON.stringify(r.body)).toBe(404);
      expect(r.body.error.details).toMatchObject({ path: "lessons/bare.md", moved_to: "lessons/archive/bare.md" });
      expect(r.body.error.message).toContain("was moved, and is at lessons/archive/bare.md now");
      expect(r.body.error.message).not.toMatch(/has had none/);
    }
    const back = await erin.api("POST", `${P}/playbook/file/restore`, { path: "lessons/bare.md", revision: 1 });
    expect(back.status).toBe(404);
    expect(back.body.error.details.moved_to).toBe("lessons/archive/bare.md");
    expect(back.body.error.message).toMatch(/Nothing was changed\.$/);
    expect((await read(vic, "lessons/archive/bare.md")).body.revision).toBe(4);
    // A path that never held a file says only that it holds none.
    const never = await vic.api("GET", `${P}/playbook/history?path=lessons/never.md`);
    expect(never.status).toBe(404);
    expect(never.body.error.message).not.toMatch(/has had none|moved/);
  });

  it("applies several changes at once, or none, listing every stale file", async () => {
    const a = (await read(erin, "lessons/canvas-titles.md")).body;
    const b = (await read(erin, "lessons/archive/bare.md")).body;
    const before = (await erin.api("GET", `${P}/playbook`)).body.files.length;
    const stale = await erin.api("POST", `${P}/playbook/apply`, {
      changes: [
        { action: "write", path: "kits/canvas/README.md", content: md("Canvas kit") },
        { action: "write", path: a.path, content: md("Changed"), expected_etag: "stale-etag" },
        { action: "remove", path: b.path },
      ],
    });
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(stale.body.error.code).toBe("playbook_stale");
    expect(stale.body.error.details.files.map((f: { path: string }) => f.path)).toEqual([a.path, b.path]);
    expect(stale.body.error.details.files[0].current_content).toBe(a.content);
    expect((await erin.api("GET", `${P}/playbook`)).body.files.length).toBe(before);
    const twice = await erin.api("POST", `${P}/playbook/apply`, { changes: [{ action: "write", path: "x/a.md", content: md("A") }, { action: "move", path: b.path, to: "x/a.md", expected_etag: b.etag }] });
    expect(twice.body.error.code).toBe("playbook_same_path_twice");
    const done = await erin.api("POST", `${P}/playbook/apply`, {
      changes: [
        { action: "write", path: "kits/canvas/README.md", content: md("Canvas kit") },
        { action: "write", path: a.path, content: md("Canvas titles say the decision", "Merged with bare."), expected_etag: a.etag },
        { action: "remove", path: b.path, expected_etag: b.etag },
      ],
      message: "Tidied the lessons.",
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.applied).toBe(3);
    // A kit's files come back with their etags, to work on elsewhere.
    const kit = (await vic.api("GET", `${P}/playbook/files?prefix=kits/canvas/`)).body;
    expect(kit.files.map((f: { path: string }) => f.path)).toEqual(["kits/canvas/README.md", "kits/canvas/zip.mjs"]);
    expect(kit.files[1]).toMatchObject({ content: "export const zip = () => 1;\n" });
  });
});

describe("links to what the product holds", () => {
  it("says what each link names now, which files cite an object, and when what they cite is archived", async () => {
    const src = (await erin.api("POST", `${P}/sources`, { title: "Dispatcher interviews" })).body;
    const r = await write(erin, "product/evidence-map.md", md("Which sources answer which questions", `whatbuild:sources/${src.record_id} answers weekend cover. whatbuild:mockups/01ZZZZZZZZZZZZZZZZZZZZZZZZ is gone. whatbuild:thing/1.`), (await read(erin, "product/evidence-map.md")).body.etag);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.links).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "sources", id: src.record_id, title: "Dispatcher interviews", status: "live" }), expect.objectContaining({ kind: "mockups", status: "missing" })]));
    expect(r.body.warnings.join(" ")).toMatch(/whatbuild:thing\/1 is not a link/);
    const cites = (await vic.api("GET", `${P}/playbook/backlinks?uri=${encodeURIComponent(`whatbuild:sources/${src.record_id}`)}`)).body;
    expect(cites).toMatchObject({ title: "Dispatcher interviews", status: "live", files: [{ path: "product/evidence-map.md" }] });
    const archived = await erin.api("POST", `${P}/sources/archive`, { record_ids: [src.record_id] });
    expect(archived.body.archived[0].playbook_cited_by).toEqual([{ path: "product/evidence-map.md", title: "Which sources answer which questions" }]);
    expect((await read(vic, "product/evidence-map.md")).body.links.find((l: { kind: string }) => l.kind === "sources").status).toBe("archived");
    const tidy = (await vic.api("GET", `${P}/playbook/housekeeping`)).body;
    expect(tidy.broken_links.find((b: { path: string }) => b.path === "product/evidence-map.md").links.map((l: { status: string }) => l.status).sort()).toEqual(["archived", "missing"]);
    expect(tidy.not_linked).toMatchObject({ sources: { count: 0 }, mockups: { count: 0 } });
  });

  it("names stale files in housekeeping", async () => {
    const r = await write(erin, "people/erin-editor.md", md("Erin Editor", "Working on pricing.", "stale_after: 2020-01-01\n"));
    expect(r.body.stale).toBe(true);
    expect((await vic.api("GET", `${P}/playbook/housekeeping`)).body.stale.map((s: { path: string }) => s.path)).toContain("people/erin-editor.md");
  });
});

describe("messages between people's agents", () => {
  it("reach the person's agents, who see how many wait in every answer, and mark them read", async () => {
    const sent = await erin.api("POST", `${P}/playbook/messages`, { to: ids["vic@example.com"], text: "I'm rebuilding the pricing canvas today: please don't publish over it." });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.to).toEqual({ account_id: ids["vic@example.com"], display_name: "Vic Viewer" });
    // A viewer's person, through an Edit connection: a Read only one is offered no write tool, so marks nothing.
    const vicAgent = await agent(vic, "editor");
    const any = await vicAgent.call("outcomes_read", "list");
    expect(any.body.scope.playbook_messages_waiting).toBe(1);
    const inbox = await vicAgent.call("playbook_read", "messages");
    expect(inbox.body.messages).toEqual([expect.objectContaining({ from: expect.objectContaining({ display_name: "Erin Editor" }), text: expect.stringContaining("pricing canvas"), read_at: null })]);
    // A viewer marks their own messages read, and writes nothing else.
    const marked = await vicAgent.call("playbook_write", "mark_read", { all: true });
    expect(marked.body).toMatchObject({ marked: 1, messages_waiting: 0 });
    expect((await vicAgent.call("outcomes_read", "list")).body.scope.playbook_messages_waiting).toBeUndefined();
    const refused = await vicAgent.call("playbook_write", "write", { path: "lessons/v.md", content: md("V") });
    expect(refused.status).toBe(403);
    await vicAgent.client.close();
    const outbox = (await erin.api("GET", `${P}/playbook/messages?box=sent`)).body;
    expect(outbox.messages[0].read_at).not.toBeNull();
  });

  it("goes only to someone who reads the product, never to oneself, and only from an editor", async () => {
    const stranger = await h.signIn("sam@example.com", "Sam Stranger");
    const id = (await stranger.api("GET", "/api/v1/me")).body.account_id;
    expect((await erin.api("POST", `${P}/playbook/messages`, { to: id, text: "Hello" })).status).toBe(404);
    expect((await erin.api("POST", `${P}/playbook/messages`, { to: ids["erin@example.com"], text: "Hello" })).body.error.code).toBe("playbook_message_to_self");
    expect((await vic.api("POST", `${P}/playbook/messages`, { to: ids["erin@example.com"], text: "Hello" })).status).toBe(403);
  });
});

describe("pointing agents at it", () => {
  it("lists the files for each part in the answers that start work there", async () => {
    await write(erin, "lessons/story-tone.md", md("Story pages speak to the board", "Plain words.", "applies_to: [story]\n"));
    const story = (await vic.api("GET", `${P}/story/guidance?section=writing`)).body;
    expect(story.playbook.files.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(["lessons/story-tone.md", "using-this-playbook.md"]));
    expect(story.playbook.files.map((f: { path: string }) => f.path)).not.toContain("lessons/canvas-titles.md");
    const a = await agent(erin, "editor");
    const mockups = await a.call("mockups_read", "list");
    expect(mockups.body.playbook.files.map((f: { path: string }) => f.path)).toContain("how-to/kits.md");
    const tools = (await a.client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["playbook_read", "playbook_write"]));
    expect(tools).not.toContain("playbook_delete");
    await a.client.close();
  });
});

describe("who may do what", () => {
  it("lets viewers read, editors write, admins purge, and keeps Story readers out", async () => {
    expect((await vic.api("GET", `${P}/playbook`)).status).toBe(200);
    expect((await write(vic, "lessons/v.md", md("V"))).status).toBe(403);
    expect((await rita.api("GET", `${P}/playbook`)).status).toBe(403);
    const f = (await read(erin, "lessons/story-tone.md")).body;
    const guards = { path: f.path, expected_etag: f.etag, reason: "It named a client.", confirm: "delete permanently" };
    expect((await erin.api("DELETE", `${P}/playbook/file`, guards)).status).toBe(403);
    expect((await alice.api("DELETE", `${P}/playbook/file`, { ...guards, confirm: "yes" })).body.error.code).toBe("confirmation_required");
    const purged = await alice.api("DELETE", `${P}/playbook/file`, guards);
    expect(purged.status, JSON.stringify(purged.body)).toBe(200);
    expect(purged.body).toMatchObject({ purged: true, revisions_deleted: 1 });
    const gone = await read(vic, "lessons/story-tone.md");
    expect(gone.status, JSON.stringify(gone.body)).toBe(410);
    expect(gone.body.error.code).toBe("playbook_file_deleted");
    expect(gone.body.error.details.tombstone).toMatchObject({ object_type: "playbook_file", object_id: "lessons/story-tone.md", reason: "It named a client." });
    // Its history, a restore and another purge say the same as a read: it was deleted, not never there.
    for (const r of [
      await vic.api("GET", `${P}/playbook/history?path=lessons/story-tone.md`),
      await read(vic, "lessons/story-tone.md", 1),
      await erin.api("POST", `${P}/playbook/file/restore`, { path: "lessons/story-tone.md", revision: 1 }),
      await alice.api("DELETE", `${P}/playbook/file`, guards),
    ]) {
      expect(r.status, JSON.stringify(r.body)).toBe(410);
      expect(r.body.error.code).toBe("playbook_file_deleted");
      expect(r.body.error.details.tombstone).toMatchObject({ object_id: "lessons/story-tone.md" });
    }
  });
});

describe("turning it off", () => {
  it("is a product admin's act in the web app; off, nothing reads or writes it, and on again it is as it was", async () => {
    const files = (await vic.api("GET", `${P}/playbook`)).body.files.length;
    expect((await erin.api("PUT", `${P}/playbook/enabled`, { enabled: false })).status).toBe(403);
    const a = await agent(alice);
    const asAgent = await a.call("products_write", "set_playbook", { enabled: false });
    expect(asAgent.status).toBe(403);
    expect(asAgent.text).toContain("web_only");
    const off = await alice.api("PUT", `${P}/playbook/enabled`, { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ playbook_enabled: false });
    const refused = await vic.api("GET", `${P}/playbook`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("playbook_off");
    expect((await write(erin, "lessons/x.md", md("X"))).body.error.code).toBe("playbook_off");
    expect((await vic.api("GET", P)).body.playbook).toEqual({ enabled: false });
    expect((await vic.api("GET", `${P}/story/guidance?section=writing`)).body.playbook).toBeUndefined();
    expect((await a.call("mockups_read", "list")).body.playbook).toBeUndefined();
    const activity = (await alice.api("GET", `${P}/activity?limit=5`)).body.items.map((i: { action: string }) => i.action);
    expect(activity).toContain("playbook_turned_off");
    expect((await alice.api("PUT", `${P}/playbook/enabled`, { enabled: true })).status).toBe(200);
    expect((await vic.api("GET", `${P}/playbook`)).body.files.length).toBe(files);
    await a.client.close();
  });
});

describe("edges", () => {
  it("names a moved file's current path at every path it left, and says whichever of a move and a purge came last", async () => {
    let f = (await write(erin, "trail/one.md", md("Trail"))).body;
    f = (await erin.api("POST", `${P}/playbook/file/move`, { path: f.path, to: "trail/two.md", expected_etag: f.etag })).body;
    f = (await erin.api("POST", `${P}/playbook/file/move`, { path: f.path, to: "trail/three.md", expected_etag: f.etag })).body;
    for (const at of ["trail/one.md", "trail/two.md"]) {
      const r = await read(vic, at);
      expect(r.status).toBe(404);
      expect(r.body.error.details).toMatchObject({ path: at, moved_to: "trail/three.md" });
    }
    expect((await erin.api("POST", `${P}/playbook/file/remove`, { path: "trail/three.md", expected_etag: f.etag })).status).toBe(200);
    const removed = await vic.api("GET", `${P}/playbook/history?path=trail/one.md`);
    expect(removed.body.error.details).toMatchObject({ moved_to: "trail/three.md", removed: true });
    expect(removed.body.error.message).toContain("where it was removed on");
    // A file moved away, then another written at the path and purged: the purge is what the path says.
    const a = (await write(erin, "trail/a.md", md("A"))).body;
    expect((await erin.api("POST", `${P}/playbook/file/move`, { path: a.path, to: "trail/b.md", expected_etag: a.etag })).status).toBe(200);
    const again = (await write(erin, "trail/a.md", md("A again"))).body;
    expect((await alice.api("DELETE", `${P}/playbook/file`, { path: "trail/a.md", expected_etag: again.etag, reason: "Not to be kept.", confirm: "delete permanently" })).status).toBe(200);
    expect((await vic.api("GET", `${P}/playbook/history?path=trail/a.md`)).status).toBe(410);
    // And a file there after the purge, moved away since: the move is.
    const third = (await write(erin, "trail/a.md", md("A third"))).body;
    expect((await erin.api("POST", `${P}/playbook/file/move`, { path: third.path, to: "trail/c.md", expected_etag: third.etag })).status).toBe(200);
    const moved = await vic.api("GET", `${P}/playbook/history?path=trail/a.md`);
    expect(moved.status).toBe(404);
    expect(moved.body.error.details.moved_to).toBe("trail/c.md");
  });

  it("gives search's snippets as the lines around each word, frontmatter only when the word is there alone", async () => {
    const long = `Intro ${"filler ".repeat(40)}the zebrafinch sings ${"after ".repeat(40)}end.`;
    const content = `---\ntype: Lesson\ntitle: Snippet lines\ndescription: Kept apart.\ntags: [quokka, walrus]\n---\n\nFirst line names the walrus.\nSecond line.\n\nThird line, after a blank.\n\n${long}\nLast line.\n`;
    expect((await write(erin, "lessons/snippets.md", content)).status).toBe(200);
    const search = async (q: string) => ((await vic.api("GET", `${P}/playbook/search?query=${encodeURIComponent(q)}`)).body.files as { path: string; snippets: string[] }[]).find((f) => f.path === "lessons/snippets.md")!.snippets;
    // The first line of the body: no frontmatter before it, and the next line on its own line.
    expect(await search("walrus")).toEqual(["First line names the walrus.\nSecond line."]);
    // The nearest lines that are not blank, either side.
    expect(await search("third")).toEqual(["Second line.\nThird line, after a blank.\n" + long.slice(0, 160).trim() + "…"]);
    // A long line is cut around the word, with … where it was cut.
    const [cut] = await search("zebrafinch");
    const lines = cut!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Third line, after a blank.");
    expect(lines[1]).toMatch(/^….*the zebrafinch sings.*…$/);
    expect(lines[1]!.length).toBeLessThanOrEqual(162);
    expect(lines[2]).toBe("Last line.");
    // A word only in the frontmatter shows the frontmatter, never its --- lines.
    expect(await search("quokka")).toEqual(["description: Kept apart.\ntags: [quokka, walrus]"]);
    // One passage for words it already shows, and the body's place for a word in both (walrus is in the tags too).
    expect(await search("walrus second")).toEqual(["First line names the walrus.\nSecond line."]);
    // Passages that would repeat a line ("Second line.") are joined into one.
    expect(await search("walrus third")).toEqual(["First line names the walrus.\nSecond line.\nThird line, after a blank.\n" + long.slice(0, 160).trim() + "…"]);
    expect(await search("snippet")).toEqual(["type: Lesson\ntitle: Snippet lines\ndescription: Kept apart."]);
  });

  it("points agents nowhere while it is off, archiving included", async () => {
    const src = (await erin.api("POST", `${P}/sources`, { title: "Ride-along notes" })).body;
    expect((await write(erin, "lessons/ride-along.md", md("Ride-along", `whatbuild:sources/${src.record_id} shows the night shift.`))).status).toBe(200);
    expect((await alice.api("PUT", `${P}/playbook/enabled`, { enabled: false })).status).toBe(200);
    const archived = await erin.api("POST", `${P}/sources/archive`, { record_ids: [src.record_id] });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body.archived[0]).not.toHaveProperty("playbook_cited_by");
    expect((await alice.api("PUT", `${P}/playbook/enabled`, { enabled: true })).status).toBe(200);
    expect((await erin.api("POST", `${P}/sources/restore`, { record_ids: [src.record_id] })).status).toBe(200);
    expect((await erin.api("POST", `${P}/sources/archive`, { record_ids: [src.record_id] })).body.archived[0].playbook_cited_by).toEqual([{ path: "lessons/ride-along.md", title: "Ride-along" }]);
  });

  it("restores a removed file only where no file differing from it in capitals stands", async () => {
    expect((await write(erin, "lessons/Notes.md", md("Notes"))).status).toBe(200);
    const n = (await read(erin, "lessons/Notes.md")).body;
    expect((await erin.api("POST", `${P}/playbook/file/remove`, { path: n.path, expected_etag: n.etag })).status).toBe(200);
    expect((await write(erin, "lessons/notes.md", md("notes"))).status).toBe(200);
    const r = await erin.api("POST", `${P}/playbook/file/restore`, { path: "lessons/Notes.md", revision: 1 });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toMatchObject({ code: "playbook_path_taken", details: { path: "lessons/notes.md" } });
    expect((await read(erin, "lessons/Notes.md")).status).toBe(404);
  });

  it("asks a .MD file for frontmatter, as a .md one", async () => {
    const r = await write(erin, "lessons/plain.MD", "No frontmatter here.\n");
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error.code).toBe("playbook_frontmatter_missing");
  });

  it("takes a link's form written out, as the starter shows it, for no link and no warning", async () => {
    const r = await write(erin, "lessons/forms.md", md("Forms", "Link a canvas as whatbuild:mockups/<mockup_id>@4#pricing, and an outcome as `whatbuild:outcomes/<outcome_id>`."));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.links).toEqual([]);
    expect(r.body.warnings).toBeUndefined();
    // Every file of the starter, written back as it is, warns of nothing.
    for (const f of (await vic.api("GET", `${P}/playbook/starter`)).body.files as { path: string; content: string }[]) {
      const there = (await read(erin, f.path)).body;
      const again = await write(erin, f.path, `${f.content}\n`, there.etag);
      expect(again.body.warnings, f.path).toBeUndefined();
    }
  });

  it("reads a folder's files as index lists them, never a folder whose name starts the same", async () => {
    expect((await write(erin, "kits/canvas-old/README.md", md("Old canvas kit"))).status).toBe(200);
    const kit = (await vic.api("GET", `${P}/playbook/files?prefix=kits/canvas`)).body;
    expect(kit.files.map((f: { path: string }) => f.path)).toEqual(["kits/canvas/README.md", "kits/canvas/zip.mjs"]);
  });

  it("gives each file's sha256 beside its size wherever its metadata is, the same whether the text is read or not", async () => {
    const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    // Text beyond ASCII, so the hash is of its UTF-8 bytes.
    const text = md("Hashes say a copy arrived whole", "Ünïcode — and “quotes”.");
    const w = (await write(erin, "lessons/hashes.md", text)).body;
    expect(w).toMatchObject({ size: Buffer.byteLength(text, "utf8"), sha256: sha(text) });
    const index = (await vic.api("GET", `${P}/playbook?prefix=lessons`)).body.files.find((f: { path: string }) => f.path === "lessons/hashes.md");
    expect(index).toMatchObject({ size: w.size, sha256: sha(text) });
    expect((await read(vic, "lessons/hashes.md")).body.sha256).toBe(sha(text));
    const files = (await vic.api("GET", `${P}/playbook/files?prefix=lessons`)).body.files;
    expect(files.find((f: { path: string }) => f.path === "lessons/hashes.md").sha256).toBe(sha(text));
    const next = md("Hashes say a copy arrived whole", "Changed.");
    const { call } = await agent(erin, "editor");
    const applied = (await call("playbook_write", "apply", { changes: [{ action: "write", path: "lessons/hashes.md", content: next, expected_etag: w.etag }] })).body;
    expect(applied.results[0]).toMatchObject({ sha256: sha(next), size: Buffer.byteLength(next, "utf8") });
    const history = (await vic.api("GET", `${P}/playbook/history?path=lessons/hashes.md`)).body.revisions;
    expect(history.map((r: { sha256: string }) => r.sha256)).toEqual([sha(next), sha(text)]);
    expect((await read(vic, "lessons/hashes.md", 1)).body).toMatchObject({ sha256: sha(text), size: w.size });
    // The starter's files give theirs too, before anything is written.
    const fresh = await alice.api("POST", `/api/v1/tenants/${tenant}/products`, { name: "Hash Fresh", concept: "Nothing written yet." });
    const starter = (await alice.api("GET", `/api/v1/p/${fresh.body.path}/playbook/file?path=using-this-playbook.md`)).body;
    expect(starter.sha256).toBe(sha(starter.content));
  });

  it("names each file an apply changed in the activity log", async () => {
    const one = (await read(erin, "kits/canvas-old/README.md")).body;
    const r = await erin.api("POST", `${P}/playbook/apply`, {
      changes: [
        { action: "write", path: "kits/canvas-old/notes.md", content: md("Old notes") },
        { action: "move", path: one.path, to: "kits/archive/README.md", expected_etag: one.etag },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = (await alice.api("GET", `${P}/activity?entity_type=playbook&limit=5`)).body.items as { action: string; entity_title: string; summary: string }[];
    expect(items.slice(0, 2).map((i) => [i.action, i.entity_title]).sort()).toEqual([
      ["playbook_file_created", "kits/canvas-old/notes.md"],
      ["playbook_file_moved", "kits/archive/README.md"],
    ]);
    expect(items[0]!.summary).toContain("one of 2 changes made at once");
  });

  it("counts its text, every revision kept, toward what the organization holds", async () => {
    const holds = async () => (await alice.api("GET", `/api/v1/tenants/${tenant}/limits`)).body.holds.storage.text as number;
    const before = await holds();
    // Text that does not compress, since storage counts bytes as the database keeps them.
    const big = md("A long lesson", randomBytes(12_000).toString("hex"));
    expect((await write(erin, "lessons/long.md", big)).status).toBe(200);
    const after = await holds();
    expect(after - before).toBeGreaterThan(20_000 * 2 * 0.9); // the file and its revision
    const f = (await read(erin, "lessons/long.md")).body;
    expect((await erin.api("POST", `${P}/playbook/file/remove`, { path: f.path, expected_etag: f.etag })).status).toBe(200);
    // Removing keeps the revision, so it stays counted; only a purge frees it.
    expect(await holds()).toBeGreaterThan(before + 20_000 * 0.9);
  });

  it("lets a person clear their messages in an archived product, where nothing else is written", async () => {
    expect((await erin.api("POST", `${P}/playbook/messages`, { to: ids["vic@example.com"], text: "Archiving this for now." })).status).toBe(201);
    const etag = (await alice.api("GET", P)).body.etag as string;
    expect((await alice.api("POST", `${P}/archive`, { expected_etag: etag })).status).toBe(200);
    expect((await erin.api("POST", `${P}/playbook/messages`, { to: ids["vic@example.com"], text: "Again." })).status).toBe(409);
    const marked = await vic.api("POST", `${P}/playbook/messages/read`, { all: true });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body).toMatchObject({ marked: 1, messages_waiting: 0 });
    const again = (await alice.api("GET", P)).body.etag as string;
    expect((await alice.api("POST", `${P}/restore`, { expected_etag: again })).status).toBe(200);
  });
});

describe("files to and from an agent's machine", () => {
  const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  /** A ZIP PUT under a Playbook upload grant, as an agent sends a folder from disk. */
  async function upload(who: Browser, entries: Record<string, string | Uint8Array>) {
    const g = await who.api("POST", `${P}/playbook/uploads`, {});
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
    const put = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: zip });
    expect(put.status).toBe(201);
    return { uploadId: g.body.upload_id as string, zip };
  }
  const apply = (who: Browser, body: Record<string, unknown>) => who.api("POST", `${P}/playbook/apply`, body);
  const readme = md("Canvas kit", "Build a canvas from the team's tokens.", "applies_to: [exploration]\n");
  const build = "// Builds the canvas.\nexport const pages = ['board', 'phone'];\n";

  it("writes the files an upload holds at the paths its steps name, inside one folder or not, once", async () => {
    const { uploadId, zip } = await upload(erin, {
      "canvas-kit/kits/zipped/README.md": readme,
      "canvas-kit/kits/zipped/build.mjs": build,
      "canvas-kit/_manifest.json": "{}",
      "__MACOSX/canvas-kit/._README.md": "litter",
    });
    const { call, client } = await agent(erin, "editor");
    const r = await call("playbook_write", "apply", { upload_id: uploadId, message: "The canvas kit from disk.", changes: [{ action: "write", path: "kits/zipped/README.md" }, { action: "write", path: "kits/zipped/build.mjs" }] });
    expect(r.status, r.text).toBe(200);
    expect(r.body.applied).toBe(2);
    expect(r.body.results.map((x: { path: string; sha256: string; size: number }) => [x.path, x.sha256, x.size])).toEqual([
      ["kits/zipped/README.md", sha(readme), Buffer.byteLength(readme)],
      ["kits/zipped/build.mjs", sha(build), Buffer.byteLength(build)],
    ]);
    expect(r.body.upload).toEqual({ upload_id: uploadId, size: zip.length, sha256: sha(zip) });
    expect((await read(vic, "kits/zipped/build.mjs")).body.content).toBe(build);
    // An upload is read once.
    const again = await call("playbook_write", "apply", { upload_id: uploadId, changes: [{ action: "write", path: "kits/zipped/README.md", expected_etag: r.body.results[0].etag }] });
    expect(again.status, again.text).toBe(409);
    expect(again.text).toContain("upload_used");
    await client.close();
  });

  it("refuses the whole change when a step's file is missing, keeping the upload for another try", async () => {
    const { uploadId } = await upload(erin, { "kits/partial/README.md": readme });
    const missing = await apply(erin, { upload_id: uploadId, changes: [{ action: "write", path: "kits/partial/README.md" }, { action: "write", path: "kits/partial/build.mjs" }] });
    expect(missing.status, JSON.stringify(missing.body)).toBe(422);
    expect(missing.body.error).toMatchObject({ code: "playbook_upload_missing", details: { paths: ["kits/partial/build.mjs"] } });
    expect((await read(vic, "kits/partial/README.md")).status).toBe(404);
    // A step may carry its own text beside the upload's.
    const mixed = await apply(erin, { upload_id: uploadId, changes: [{ action: "write", path: "kits/partial/README.md" }, { action: "write", path: "kits/partial/build.mjs", content: build }] });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(200);
    expect((await read(vic, "kits/partial/README.md")).body.content).toBe(readme);
    // Without an upload, a write step needs its content.
    const bare = await apply(erin, { changes: [{ action: "write", path: "kits/partial/other.mjs" }] });
    expect(bare.status).toBe(422);
    expect(bare.body.error.message).toContain("kits/partial/other.mjs has no content");
  });

  it("takes text only, and an upload of its own kind only", async () => {
    const binary = await upload(erin, { "kits/bin/face.txt": new Uint8Array([0xff, 0xfe, 0x00, 0xd8]) });
    const refused = await apply(erin, { upload_id: binary.uploadId, changes: [{ action: "write", path: "kits/bin/face.txt" }] });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toContain("kits/bin/face.txt is not UTF-8 text");
    // A canvas's upload is not a Playbook's, nor the other way round.
    const canvas = await erin.api("POST", `${P}/mockups/uploads`, {});
    expect((await apply(erin, { upload_id: canvas.body.upload_id, changes: [{ action: "write", path: "kits/bin/a.txt" }] })).status).toBe(404);
    const mine = await upload(erin, { "kits/bin/a.txt": "a" });
    const asCanvas = await alice.api("POST", `${P}/mockups`, { title: "Not a canvas", upload_id: mine.uploadId });
    expect(asCanvas.status).toBe(404);
    // A grant for one kind PUTs nothing under the other's address.
    const g = await erin.api("POST", `${P}/playbook/uploads`, {});
    const wrong = await fetch(g.body.url.replace("/uploads/playbook/", "/uploads/mockup/"), { method: "PUT", headers: g.body.headers, body: zipSync({ "a.txt": strToU8("a") }) });
    expect(wrong.status).toBe(401);
    // Writing takes an editor.
    expect((await vic.api("POST", `${P}/playbook/uploads`, {})).status).toBe(403);
  });

  it("keeps a file's bytes as zipped, a byte-order mark too, and refuses a null character", async () => {
    const bom = `\uFEFF${md("Saved on Windows")}`;
    const kept = await upload(erin, { "lessons/bom.md": bom, "kits/bin/utf16.txt": "h\u0000i\u0000" });
    const nul = await apply(erin, { upload_id: kept.uploadId, changes: [{ action: "write", path: "lessons/bom.md" }, { action: "write", path: "kits/bin/utf16.txt" }] });
    expect(nul.status, JSON.stringify(nul.body)).toBe(422);
    expect(nul.body.error.message).toContain("kits/bin/utf16.txt holds a null character");
    const ok = await apply(erin, { upload_id: kept.uploadId, changes: [{ action: "write", path: "lessons/bom.md" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.results[0].sha256).toBe(sha(strToU8(bom)));
    expect((await read(vic, "lessons/bom.md")).body.content).toBe(bom);
  });

  it("reads a whole archive one way: from its top, or from inside the one folder around it", () => {
    const zip = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
    // Files at the top beside a folder: a step's path is found at the top or not at all.
    expect([...readPlaybookZip(zip({ "kits/notes.md": "in kits", "other.md": "other" }), ["notes.md"])]).toEqual([]);
    // A folder around everything whose name is also a Playbook folder's: read from inside it, every path alike.
    const wrapped = readPlaybookZip(zip({ "kits/a.md": "the top's a", "kits/kits/a.md": "kits' a" }), ["a.md", "kits/a.md"]);
    expect(Object.fromEntries(wrapped)).toEqual({ "a.md": "the top's a", "kits/a.md": "kits' a" });
    // Files that are all in one Playbook folder, zipped from the top: read from the top.
    expect(Object.fromEntries(readPlaybookZip(zip({ "kits/a.md": "a", "kits/b.md": "b" }), ["kits/a.md", "kits/b.md"]))).toEqual({ "kits/a.md": "a", "kits/b.md": "b" });
  });

  it("refuses a download of a folder no Playbook path could sit under", async () => {
    const odd = await vic.api("POST", `${P}/playbook/downloads`, { prefix: "notas/日本" });
    expect(odd.status, JSON.stringify(odd.body)).toBe(422);
    expect(odd.body.error.code).toBe("invalid_playbook_path");
  });

  it("downloads a folder with its etags, and the same folder uploads again as it is", async () => {
    const g = await vic.api("POST", `${P}/playbook/downloads`, { prefix: "kits/zipped" });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    expect(g.body).toMatchObject({ prefix: "kits/zipped/", method: "GET", media_type: "application/zip" });
    const res = await fetch(g.body.url, { headers: g.body.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename=".+-playbook-kits-zipped\.zip"/);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["_manifest.json", "kits/zipped/README.md", "kits/zipped/build.mjs"]);
    expect(strFromU8(files["kits/zipped/build.mjs"]!)).toBe(build);
    const manifest = JSON.parse(strFromU8(files["_manifest.json"]!));
    const index = (await vic.api("GET", `${P}/playbook?prefix=kits/zipped`)).body.files;
    expect(manifest).toMatchObject({ format: "whatbuild-playbook", prefix: "kits/zipped/", started: true });
    expect(manifest.files).toEqual(index.map((f: { path: string; etag: string; revision: number; size: number; sha256: string }) => ({ path: f.path, etag: f.etag, revision: f.revision, size: f.size, sha256: f.sha256 })));
    // Changed on disk, zipped as it came, manifest and all, and applied with the manifest's etags.
    const changed = build.replace("'phone'", "'phone', 'tablet'");
    const { uploadId } = await upload(erin, { ...files, "kits/zipped/build.mjs": changed });
    const etag = manifest.files.find((f: { path: string }) => f.path === "kits/zipped/build.mjs").etag;
    const back = await apply(erin, { upload_id: uploadId, changes: [{ action: "write", path: "kits/zipped/build.mjs", expected_etag: etag }] });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.results[0]).toMatchObject({ revision: 2, sha256: sha(changed) });
    // A Story reader gets no grant, and none works once the Playbook is off.
    expect((await rita.api("POST", `${P}/playbook/downloads`, {})).status).toBe(403);
    const later = await vic.api("POST", `${P}/playbook/downloads`, {});
    expect((await alice.api("PUT", `${P}/playbook/enabled`, { enabled: false })).status).toBe(200);
    expect((await vic.api("POST", `${P}/playbook/downloads`, {})).body.error.code).toBe("playbook_off");
    expect((await fetch(later.body.url, { headers: later.body.headers })).status).toBe(409);
    expect((await alice.api("PUT", `${P}/playbook/enabled`, { enabled: true })).status).toBe(200);
  });

  it("downloads the starter before anything is written, with the etags a write takes", async () => {
    const fresh = await alice.api("POST", `/api/v1/tenants/${tenant}/products`, { name: "Zip Fresh", concept: "Nothing written yet." });
    const g = await alice.api("POST", `/api/v1/p/${fresh.body.path}/playbook/downloads`, {});
    const files = unzipSync(new Uint8Array(await (await fetch(g.body.url, { headers: g.body.headers })).arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["_manifest.json"]!));
    expect(manifest.started).toBe(false);
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain("using-this-playbook.md");
    expect(manifest.files.every((f: { etag: string; revision: number }) => f.etag.startsWith("starter-") && f.revision === 0)).toBe(true);
  });
});

describe("activity", () => {
  it("records each change under the Playbook", async () => {
    const items = (await alice.api("GET", `${P}/activity?entity_type=playbook&limit=100`)).body.items as { action: string; entity_title: string; summary: string }[];
    expect(items.map((i) => i.action), JSON.stringify(items.map((i) => i.action))).toEqual(expect.arrayContaining(["playbook_file_created", "playbook_file_written", "playbook_file_removed", "playbook_file_moved", "playbook_file_restored", "playbook_message_sent", "playbook_file_purged"]));
  });
});
