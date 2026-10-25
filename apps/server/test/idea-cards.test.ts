import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let rita: Browser;
let eddie: Browser;
let P: string;

const FRONT = `<p class="wb-pitch">Crews get their <em>Friday</em> back.</p>
<ol class="wb-flow"><li data-icon="clipboard-list"><b>Jobs</b>carried forward</li><li data-icon="send" class="is-new"><b>Week</b>sent</li></ol>`;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  eddie = await h.signIn("eddie@example.com", "Eddie Editor");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Card Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Carded", concept: "A product with cards." });
  P = `/api/v1/p/${p.body.path}`;
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "carded", email: "rita@example.com", role: "reader" })).status).toBe(201);
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "carded", email: "eddie@example.com", role: "editor" })).status).toBe(201);
});
afterAll(async () => h?.close());

describe("an outcome's card", () => {
  it("keeps a front and a back; a list gives the front's length, get gives the front", async () => {
    const made = await alice.api("POST", `${P}/outcomes`, { title: "Plan the week in minutes", description: "**Success** is planning in under half an hour.", card_html: FRONT });
    expect(made.status).toBe(201);
    expect(made.body.card_html).toBe(FRONT);
    expect(made.body.note).toBeUndefined();
    expect(made.body).not.toHaveProperty("card_advice");
    const listed = (await alice.api("GET", `${P}/outcomes`)).body.items.find((o: { outcome_id: string }) => o.outcome_id === made.body.outcome_id);
    expect(listed.card_chars).toBe(FRONT.length);
    expect(listed).not.toHaveProperty("card_html");
    expect((await alice.api("GET", `${P}/outcomes/${made.body.outcome_id}`)).body.card_html).toBe(FRONT);
  });

  it("may be made without a front, and says so", async () => {
    const bare = await alice.api("POST", `${P}/outcomes`, { title: "Send each crew its week" });
    expect(bare.status).toBe(201);
    expect(bare.body.card_html).toBe("");
    expect(bare.body.note).toContain("no front yet");
  });

  it("refuses a front that breaks the rules, every problem at once", async () => {
    const bad = await alice.api("POST", `${P}/outcomes`, {
      title: "Broken",
      card_html: `<!doctype html><p onclick="go()">Hi</p><script>alert(1)</script><a href="https://example.com">x</a><i class="wb-icon" data-icon="unicorn"></i><img src="https://example.com/x.png">`,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_card");
    const problems: string[] = bad.body.error.details.problems;
    expect(problems.some((p) => p.includes("only the markup inside the card"))).toBe(true);
    expect(problems.some((p) => p.includes('"unicorn"'))).toBe(true);
    expect(problems.some((p) => p.includes("<script>"))).toBe(true);
    expect(problems.some((p) => p.includes("<a>"))).toBe(true);
    expect(problems.some((p) => p.includes("external resource"))).toBe(true);
    expect(problems.some((p) => p.includes("event handlers"))).toBe(true);
  });

  it("changes both sides together: one side alone is refused, both pass, and the earlier version keeps both", async () => {
    const o = (await alice.api("POST", `${P}/outcomes`, { title: "Fit a late job in", description: "Placed in minutes.", card_html: FRONT })).body;
    const backOnly = await alice.api("PATCH", `${P}/outcomes/${o.outcome_id}`, { expected_etag: o.etag, description: "Placed in minutes, from a phone." });
    expect(backOnly.status).toBe(422);
    expect(backOnly.body.error.code).toBe("card_sides_together");
    expect(backOnly.body.error.details.missing).toBe("card_html");
    const frontOnly = await alice.api("PATCH", `${P}/outcomes/${o.outcome_id}`, { expected_etag: o.etag, card_html: `${FRONT}<p class="wb-note">From a phone.</p>` });
    expect(frontOnly.status).toBe(422);
    expect(frontOnly.body.error.details.missing).toBe("description");
    // The front sent unchanged with a new back passes; so does a rename alone, or a move.
    const both = await alice.api("PATCH", `${P}/outcomes/${o.outcome_id}`, { expected_etag: o.etag, description: "Placed in minutes, from a phone.", card_html: FRONT });
    expect(both.status).toBe(200);
    const renamed = await alice.api("PATCH", `${P}/outcomes/${o.outcome_id}`, { expected_etag: both.body.etag, title: "Fit a late job into the week" });
    expect(renamed.status).toBe(200);
    // An earlier version brings back both of its sides.
    const changed = await alice.api("PATCH", `${P}/outcomes/${o.outcome_id}`, { expected_etag: renamed.body.etag, description: "Rewritten.", card_html: "<p class=\"wb-pitch\">Rewritten.</p>" });
    expect(changed.status).toBe(200);
    const revisions = (await alice.api("GET", `${P}/outcomes/${o.outcome_id}/revisions`)).body.items as { n: number }[];
    const newest = Math.max(...revisions.map((r) => r.n));
    expect((await alice.api("GET", `${P}/outcomes/${o.outcome_id}/revisions/${newest}`)).body.content.card_html).toBe(FRONT);
    const restored = await alice.api("POST", `${P}/outcomes/${o.outcome_id}/revisions/${newest}/restore`, { outcome_id: o.outcome_id, n: newest, expected_etag: changed.body.etag });
    expect(restored.status).toBe(200);
    expect(restored.body.card_html).toBe(FRONT);
    expect(restored.body.description).toBe("Placed in minutes, from a phone.");
  });

  it("lets the back of a card with no front change alone", async () => {
    const bare = (await alice.api("POST", `${P}/outcomes`, { title: "Know who is on call" })).body;
    const r = await alice.api("PATCH", `${P}/outcomes/${bare.outcome_id}`, { expected_etag: bare.etag, description: "Everyone knows." });
    expect(r.status).toBe(200);
    expect(r.body.note).toContain("no front yet");
  });

  it("serves the front in its sandbox, with the kit, the pictograms it names, the theme and only WhatBuild's script", async () => {
    const o = (await alice.api("POST", `${P}/outcomes`, { title: "Shown", card_html: FRONT })).body;
    const res = await alice.api("GET", `${P}/outcomes/${o.outcome_id}/card?theme=dark`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts;");
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const html = res.body as string;
    expect(html).toContain('data-wb-theme="dark"');
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain('[data-icon="clipboard-list"]{--wb-icon:url(');
    expect(html).not.toContain('[data-icon="truck"]');
    expect(html).toContain(FRONT);
    expect((await alice.api("GET", `${P}/outcomes/${o.outcome_id}/card?theme=sepia`)).status).toBe(422);
    // A reader reads only the Story.
    expect((await rita.api("GET", `${P}/outcomes/${o.outcome_id}/card`)).status).toBe(403);
    const bare = (await alice.api("POST", `${P}/outcomes`, { title: "Unshown" })).body;
    expect((await alice.api("GET", `${P}/outcomes/${bare.outcome_id}/card`)).status).toBe(404);
  });

  it("is explained by card_guidance: how to choose a part, the kit, its pictograms, the room a front has and a check", async () => {
    const g = (await alice.api("GET", `${P}/idea/card-guidance`)).body;
    expect(g.guidance).toContain("How to draw a card");
    expect(g.guidance).toContain("Choose the main part");
    expect(g.guidance).toContain("Writing the back");
    expect(g.guidance).toContain("card_advice");
    expect(g.guidance).toContain("wb-flow");
    expect(g.icons).toContain("clipboard-list");
    expect(g.frames.outcome.max_height).toBeGreaterThan(0);
    expect(g.frames.outcome.min_width).toBeLessThan(g.frames.outcome.width);
  });

  it("advises on a written card what the guidance asks and it misses, without refusing it", async () => {
    const wordy = `<p class="wb-lede">Know who is on call tonight.</p><p style="color:#c00">${"Every crew member knows who answers a late call. ".repeat(8)}</p><div data-hue="teal"></div><div data-hue="amber"></div>`;
    const made = await alice.api("POST", `${P}/outcomes`, { title: "Know who is on call tonight", card_html: wordy });
    expect(made.status).toBe(201);
    const advice: string[] = made.body.card_advice;
    expect(advice.some((a) => a.includes("words"))).toBe(true);
    expect(advice.some((a) => a.includes("repeats the outcome's title"))).toBe(true);
    expect(advice.some((a) => a.includes("2 hues"))).toBe(true);
    expect(advice.some((a) => a.includes("fixed colours"))).toBe(true);
    expect(advice.some((a) => a.includes("back is empty"))).toBe(true);
    // Fixed, the advice goes; a move alone carries none.
    const fixed = await alice.api("PATCH", `${P}/outcomes/${made.body.outcome_id}`, { expected_etag: made.body.etag, description: "By 5 pm, everyone knows.", card_html: FRONT });
    expect(fixed.status).toBe(200);
    expect(fixed.body).not.toHaveProperty("card_advice");
    const moved = await alice.api("PATCH", `${P}/outcomes/${made.body.outcome_id}`, { expected_etag: fixed.body.etag, position: 99 });
    expect(moved.body).not.toHaveProperty("card_advice");
  });

  it("notes, in a list for someone who can draw them, the outcomes with no front", async () => {
    const listed = (await alice.api("GET", `${P}/outcomes`)).body;
    const bare = listed.items.filter((o: { card_chars: number }) => !o.card_chars).length;
    expect(bare).toBeGreaterThan(0);
    expect(listed.note).toContain(`${bare} of these outcomes have no front yet`);
  });
});

describe("the product concept's card", () => {
  it("keeps both sides, gives the front only when asked, and changes them together, for an editor too", async () => {
    const before = (await alice.api("GET", P)).body;
    expect(before.card_chars).toBe(0);
    expect(before).not.toHaveProperty("card_html");
    expect(before.note).toContain("no front yet");
    // Renaming stays with admins; the card is written on its own, by an editor as well.
    expect((await alice.api("PATCH", P, { expected_etag: before.etag, concept: "Through the old door." })).status).toBe(422);
    // The back of a card with no front may change alone.
    const backOnly = await eddie.api("PATCH", `${P}/idea/concept`, { expected_etag: before.etag, concept: "A product with two-sided cards." });
    expect(backOnly.status).toBe(200);
    const drawn = await eddie.api("PATCH", `${P}/idea/concept`, { expected_etag: backOnly.body.etag, concept: "A product with two-sided cards, for crews.", card_html: FRONT });
    expect(drawn.status).toBe(200);
    expect(drawn.body.card_chars).toBe(FRONT.length);
    // A concept's front leads with a pitch, and this one does.
    expect(drawn.body).not.toHaveProperty("card_advice");
    expect((await alice.api("GET", `${P}?include_card=true`)).body.card_html).toBe(FRONT);
    const alone = await eddie.api("PATCH", `${P}/idea/concept`, { expected_etag: drawn.body.etag, concept: "Changed alone." });
    expect(alone.status).toBe(422);
    expect(alone.body.error.code).toBe("card_sides_together");
    expect((await eddie.api("PATCH", P, { expected_etag: drawn.body.etag, name: "Renamed by an editor" })).status).toBe(403);
    const card = await alice.api("GET", `${P}/idea/concept/card?theme=light`);
    expect(card.status).toBe(200);
    expect(card.body).toContain(FRONT);
    expect(card.body).toContain("<title>Carded: product concept</title>");
    expect(card.body).not.toContain("data-limit=");
    // A reader gets no concept and no card, and cannot write one.
    const theirs = (await rita.api("GET", `${P}?include_card=true`)).body;
    expect(theirs).not.toHaveProperty("concept");
    expect(theirs).not.toHaveProperty("card_html");
    expect((await rita.api("GET", `${P}/idea/concept/card`)).status).toBe(403);
    expect((await rita.api("PATCH", `${P}/idea/concept`, { expected_etag: drawn.body.etag, concept: "Mine." })).status).toBe(403);
  });
});

describe("an agent connected at Edit", () => {
  it("is offered the concept's card and the preview, not the rename, and writes the concept", async () => {
    const token = await h.connectAgent(eddie, "edit-agent", undefined, "editor");
    const client = new Client({ name: "edit-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const { tools } = await client.listTools();
    const actions = (name: string) => (tools.find((t) => t.name === name)?.inputSchema.properties?.["action"] as { enum: string[] }).enum;
    expect(actions("products")).toContain("update_concept");
    expect(actions("products")).not.toContain("update");
    expect(actions("outcomes")).toContain("card_preview");
    const product = P.replace("/api/v1/p/", "");
    const call = async (name: string, action: string, params: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name, arguments: { action, product, params } })).content as { text: string }[])[0]!.text);
    const read = await call("products", "get", { include_card: true });
    const written = await call("products", "update_concept", { expected_etag: read.etag, concept: "Written by an agent at Edit.", card_html: FRONT });
    expect(written.card_chars).toBe(FRONT.length);
    expect((await alice.api("GET", P)).body.concept).toBe("Written by an agent at Edit.");
    await client.close();
  });
});

describe("a card's preview", () => {
  it("checks a front as a write would, writes nothing, and gives a grant to the front as the Idea screen shows it, its height line marked", async () => {
    const outcomesBefore = (await alice.api("GET", `${P}/outcomes`)).body.items.length;
    const bad = await eddie.api("POST", `${P}/idea/card-preview`, { card_html: "<script>alert(1)</script>" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_card");
    const r = await eddie.api("POST", `${P}/idea/card-preview`, { card_html: FRONT, title: "Plan the week", back: "" });
    expect(r.status).toBe(200);
    expect(r.body.written).toBe(false);
    expect(r.body.frame.max_height).toBeGreaterThan(0);
    expect(r.body.card_advice.some((a: string) => a.includes("back is empty"))).toBe(true);
    expect((await alice.api("GET", `${P}/outcomes`)).body.items.length).toBe(outcomesBefore);
    const { url, headers } = r.body.preview;
    expect(url).toBe(`${h.baseUrl}/api/v1/downloads/card-preview/${r.body.preview.preview_id}`);
    const doc = await fetch(`${url}?theme=dark`, { headers });
    expect(doc.status).toBe(200);
    const csp = doc.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts;");
    const html = await doc.text();
    expect(html).toContain(FRONT);
    expect(html).toContain('data-wb-theme="dark"');
    expect(html).toContain(`data-limit="${r.body.frame.max_height}"`);
    // Without the grant, or with another preview's, nothing.
    expect((await fetch(url)).status).toBe(401);
    const concept = await eddie.api("POST", `${P}/idea/card-preview`, { kind: "concept", card_html: "<p class=\"wb-lede\">No pitch here.</p>" });
    expect(concept.body.card_advice.some((a: string) => a.includes("wb-pitch"))).toBe(true);
    expect((await fetch(concept.body.preview.url, { headers: r.body.preview.headers })).status).toBe(401);
    // A reader writes no cards, so previews none.
    expect((await rita.api("POST", `${P}/idea/card-preview`, { card_html: FRONT })).status).toBe(403);
  });
});
