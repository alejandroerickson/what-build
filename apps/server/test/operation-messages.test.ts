import { OPERATIONS, type OperationDef } from "@whatbuild/core";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toolDefinitions } from "../src/mcp.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// What callers read: refusals that name only what exists, descriptions that say only what is true,
// and English that reads as English.

let h: Harness;
let alice: Browser;
let ed: Browser;
let P: string;

const op = (name: string) => OPERATIONS.find((o) => o.name === name)!;
/** Every description an operation's input schema gives its fields, as one text. */
const fieldTexts = (o: OperationDef) => JSON.stringify(z.toJSONSchema(o.input, { io: "input", unrepresentable: "any" }));

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  ed = await h.signIn("ed@example.com", "Ed Editor");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Words Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "ed@example.com", role: "editor" })).status).toBe(201);
});
afterAll(async () => h?.close());

describe("English", () => {
  it("puts an before a vowel in every summary, description and field of every operation and tool", () => {
    const texts: [string, string][] = [];
    for (const o of OPERATIONS) texts.push([o.name, `${o.summary}\n${o.description}\n${fieldTexts(o)}`]);
    for (const t of toolDefinitions().tools) texts.push([`tool ${t.name}`, t.description]);
    const wrong: string[] = [];
    for (const [where, text] of texts)
      // "a one-line", "an hour" and "an MCP tool" are right, and allowed.
      for (const re of [/\b[Aa] (?!one\b)[AEIOaeio][a-z]/g, /\b[Aa]n [b-df-gj-np-tv-z][a-z]/g]) for (const m of text.matchAll(re)) wrong.push(`${where}: …${text.slice(Math.max(0, m.index! - 20), m.index! + 20)}…`);
    expect(wrong).toEqual([]);
  });

  it("names an id that is not one with its article", async () => {
    const outcome = await alice.api("GET", `${P}/outcomes/not-an-id`);
    expect(outcome.status).toBe(422);
    expect(outcome.body.error.message).toContain("must be an outcome id");
    const assumption = await alice.api("POST", `${P}/assumptions/any/links`, { expected_etag: "x", target_id: "not-an-id", type: "supports" });
    expect(assumption.status).toBe(422);
    expect(assumption.body.error.message).toContain("must be an assumption id");
    const source = await alice.api("GET", `${P}/sources/not-an-id`);
    expect(source.body.error.message).toContain("must be a source id");
  });

  it("tells an editor they are an editor", async () => {
    const product = await ed.api("GET", P);
    const r = await ed.api("PATCH", P, { expected_etag: product.body.etag, name: "Renamed" });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe("You are an editor on product Planner; products.update needs admin. Ask an admin of the product for admin access.");
  });

  it("gives the limits of a mockup page as people read numbers", () => {
    expect(op("mockups.publish").description).toContain("A page holds at most 1,000,000 characters, and a version 8,000,000 in all");
  });
});

describe("refusals that name what exists", () => {
  it("says bytes that already arrived are attached, and how to add another version", async () => {
    const created = await alice.api("POST", `${P}/sources/with-upload`, { title: "Sample notes", tags: ["notes"], path: "notes.md" });
    const put = () => fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: "# Notes\n" });
    expect((await put()).status).toBe(201);
    const again = await put();
    expect(again.status).toBe(409);
    const { error } = (await again.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("already_uploaded");
    expect(error.message).toBe(
      `Bytes for notes.md already arrived under this grant and are attached to source ${created.body.record.record_id}; nothing more is needed. For a new version of notes.md, request another grant with attachments(action="request_upload").`,
    );
  });

  it("points a download without its grant at the operation that gives one", async () => {
    const file = await fetch(`${h.baseUrl}/api/v1/downloads/01J00000000000000000000000`);
    expect(file.status).toBe(401);
    expect(((await file.json()) as { error: { message: string } }).error.message).toMatch(/attachments\(action="get_download"\)\.$/);
    const bundle = await fetch(`${h.baseUrl}/api/v1/downloads/export/01J00000000000000000000000`);
    expect(bundle.status).toBe(401);
    expect(((await bundle.json()) as { error: { message: string } }).error.message).toMatch(/products\(action="exports"\) again for a fresh one\.$/);
  });
});

describe("descriptions that say only what is true", () => {
  it("says an earlier text is kept as a revision only where the operations read revisions back", () => {
    for (const o of OPERATIONS) {
      if (!/kept as a revision/.test(o.description)) continue;
      expect(OPERATIONS.some((x) => x.name === `${o.mcp.tool}.revisions`), o.name).toBe(true);
    }
    for (const name of ["products.update", "assumptions.update", "sources.update_annotation"])
      expect(op(name).description, name).toMatch(/is kept, and a product export includes it, but no action reads it back yet|are kept, and a product export includes them, but no action reads them back yet/);
  });

  it("says a list sent to an update replaces the whole list", () => {
    expect(fieldTexts(op("assumptions.update"))).toMatch(/The whole list of tags, which replaces the current one/);
    expect(fieldTexts(op("assumptions.update"))).toMatch(/The whole list of outcomes it bears on, which replaces the current one/);
    expect(fieldTexts(op("assumptions.update"))).toMatch(/The whole list of its links, which replaces the current one/);
    expect(fieldTexts(op("sources.update_annotation"))).toMatch(/The comment's whole list of tags, which replaces the current one/);
    expect(fieldTexts(op("sources.update_annotation"))).toMatch(/The comment's new text, which replaces it/);
    expect(fieldTexts(op("sources.annotate"))).toMatch(/The comment's text: Markdown/);
  });

  it("describes an assumption as the product's counts and the skill do", () => {
    const list = op("assumptions.list");
    expect(list.summary).not.toMatch(/quotes/);
    expect(list.description).not.toMatch(/and outcomes count/);
    expect(list.description).toContain('the ones products(action="list") and products(action="get") count');
    expect(fieldTexts(op("assumptions.create"))).toMatch(/why the team holds it, in a sentence or two of your own: what it rests on, and what would change it/);
  });

  it("calls a source a source", () => {
    expect(op("sources.create").summary).not.toMatch(/record\)/);
    expect(op("sources.move_to_product").description).toMatch(/^The source keeps its record_id/);
  });

  it("says what the products tool is for, export and usage included", () => {
    const products = toolDefinitions().tools.find((t) => t.name === "products")!;
    expect(products.description).toMatch(/export a whole product as a ZIP/);
    expect(products.description).toMatch(/how it is used/);
  });
});
