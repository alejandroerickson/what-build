import { OPERATIONS } from "@whatbuild/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLE_LAYOUT } from "../../../packages/core/src/ops/export.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A product's export: who may ask for one, and a bundle that says what each of its files holds.

let h: Harness;
let alice: Browser;
let vic: Browser;
let rita: Browser;
let P: string;
let files: Record<string, Uint8Array>;

const page = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1></body></html>`;

/** A layout path as a pattern: <path> may have folders, v<n> is a version, any other <…> one name. */
const pattern = (path: string) =>
  new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/v<n>/g, "v\\d+").replace(/<path>/g, ".+").replace(/<[a-z_]+>/g, "[^/]+")}$`);

async function exportAs(b: Browser) {
  const started = await b.api("POST", `${P}/exports`, {});
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  await h.worker.drain();
  const ready = (await b.api("GET", `${P}/exports`)).body.items.find((x: { export_id: string }) => x.export_id === started.body.export_id);
  expect(ready.status).toBe("ready");
  const res = await fetch(ready.download.url, { headers: ready.download.headers });
  expect(res.status).toBe(200);
  return unzipSync(new Uint8Array(await res.arrayBuffer()));
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Bundle Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Crew board", concept: "Plan the week." });
  P = `/api/v1/p/${p.body.path}`;
  for (const [email, role] of [["vic@example.com", "viewer"], ["rita@example.com", "reader"]])
    expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "crew-board", email, role })).status).toBe(201);

  // Something of every kind a bundle holds, and an earlier text of each kind that keeps one.
  const product = await alice.api("GET", P);
  expect((await alice.api("PATCH", `${P}/idea/concept`, { expected_etag: product.body.etag, concept: "Plan the week in ten minutes." })).status).toBe(200);
  const o = await alice.api("POST", `${P}/outcomes`, { title: "Plan the week" });
  expect((await alice.api("PATCH", `${P}/outcomes/${o.body.outcome_id}`, { expected_etag: o.body.etag, title: "Plan the week in ten minutes" })).status).toBe(200);
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: "Sample crew call", tags: ["call"], path: "call.md" });
  const recordId = created.body.record.record_id as string;
  expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: "# Call\n\nCrews text the office.\n" })).status).toBe(201);
  await h.worker.drain();
  const c = await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "Texts first." });
  expect((await alice.api("PATCH", `/api/v1/p/${p.body.path}/annotations/${c.body.annotation_id}`, { expected_etag: c.body.etag, note: "Texts come first." })).status).toBe(200);
  expect((await alice.api("PUT", `${P}/sources/${recordId}/agent-notes/summary`, { content: "Crews text before they call." })).status).toBe(200);
  const a = await alice.api("POST", `${P}/assumptions`, { statement: "Crews read texts before calls.", body: "The call says so." });
  const edited = await alice.api("PATCH", `${P}/assumptions/${a.body.id}`, { expected_etag: a.body.etag, body: "The call says so, once." });
  expect((await alice.api("POST", `${P}/assumptions/${a.body.id}/review`, { expected_etag: edited.body.etag, status: "confirmed", note: "Heard it twice." })).status).toBe(200);
  expect((await alice.api("PUT", `${P}/story/style`, { house_style: "clear" })).status).toBe(200);
  expect((await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", body: '<main class="page"><h1>Overview</h1></main>' })).status).toBe(201);
  expect((await alice.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: "overview", children: [] }] })).status).toBe(200);
  // A mockup with a page of its own, a page that enters its prototype, and a file for collaborators.
  const g = await alice.api("POST", `${P}/mockups/uploads`, {});
  const zip = zipSync({
    "manifest.json": strToU8(JSON.stringify({ title: "Board", pages: [{ page_id: "board", title: "Board" }, { page_id: "app", title: "App", entry: "index.html" }] })),
    "brief.md": strToU8("# Board\n\nDoes a crew read its day at a glance?"),
    "pages/board.html": strToU8(page("Board")),
    "pages/board.notes.md": strToU8("Dense."),
    "files/DESIGN.md": strToU8("# Board"),
    "prototype/index.html": strToU8(page("App")),
  });
  expect((await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: zip })).status).toBe(201);
  expect((await alice.api("POST", `${P}/mockups`, { upload_id: g.body.upload_id })).status).toBe(201);

  files = await exportAs(alice);
});
afterAll(async () => h?.close());

describe("who may export", () => {
  it("lets a viewer export, and refuses a reader, who reads only the Story", async () => {
    expect(Object.keys(await exportAs(vic))).toContain("bundle.json");
    const refused = await rita.api("POST", `${P}/exports`, {});
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/^You are a reader on product Crew board; products\.export needs viewer\./);
    expect((await rita.api("GET", `${P}/exports`)).status).toBe(403);
  });

  it("says so in its description, and never that any role may", () => {
    const op = OPERATIONS.find((o) => o.name === "products.export")!;
    expect(op.description).toMatch(/A viewer, editor or admin may export/);
    expect(op.description).toMatch(/A reader, who reads only the Story, is refused \(403\)/);
    expect(op.description).toMatch(/exports_per_day, which is 0 unless its staff raise it/);
    expect(op.description).not.toMatch(/Any role/);
    expect(op.summary).not.toMatch(/\bparse\b/);
  });
});

describe("the bundle", () => {
  it("holds only files its layout names, and something of every kind it names", () => {
    const names = Object.keys(files);
    const unnamed = names.filter((n) => !BUNDLE_LAYOUT.some((f) => pattern(f.path).test(n)));
    expect(unnamed).toEqual([]);
    const missing = BUNDLE_LAYOUT.filter((f) => !names.some((n) => pattern(f.path).test(n))).map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it("lists every kind of file in README.txt and in bundle.json's layout", () => {
    const readme = strFromU8(files["README.txt"]!);
    expect(readme).toMatch(/^WhatBuild product bundle: Crew board \(Bundle Co \/ /);
    for (const f of BUNDLE_LAYOUT) {
      expect(readme).toContain(`${f.path}\n    ${f.holds}\n`);
    }
    const bundle = JSON.parse(strFromU8(files["bundle.json"]!));
    expect(bundle).toMatchObject({ format: "whatbuild-product-bundle", format_version: 2 });
    expect(bundle.layout.split(" · ")).toEqual(BUNDLE_LAYOUT.map((f) => f.path));
  });

  it("holds each assumption with its reviews, without the search vector the database keeps", () => {
    const assumptions = JSON.parse(strFromU8(files["assumptions.json"]!));
    expect(assumptions).toHaveLength(1);
    expect(assumptions[0]).not.toHaveProperty("tsv");
    expect(assumptions[0]).toMatchObject({ statement: "Crews read texts before calls.", body: "The call says so, once.", status: "confirmed", reviews: [expect.objectContaining({ status: "confirmed", note: "Heard it twice." })] });
    expect(JSON.stringify(assumptions)).not.toMatch(/'crews':|'texts':/);
  });

  it("holds the earlier texts of the product concept, an outcome, a comment and an assumption", () => {
    const revisions = JSON.parse(strFromU8(files["revisions.json"]!)) as { object_type: string; content: Record<string, string> }[];
    expect(revisions.map((r) => r.object_type).sort()).toEqual(["annotation", "assumption", "outcome", "product"]);
    // The concept's card, both sides: it had no front yet.
    expect(revisions.find((r) => r.object_type === "product")!.content).toEqual({ concept: "Plan the week.", card_html: "" });
    expect(revisions.find((r) => r.object_type === "annotation")!.content).toEqual({ note: "Texts first." });
  });
});
