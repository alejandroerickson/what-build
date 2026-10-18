import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FEEDBACK_PER_DAY, OPERATIONS, sendFeedbackDigest } from "@whatbuild/core";
import { feedbackDay } from "../../../packages/core/src/feedback.ts";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPorts } from "../src/app.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Feedback names nobody: a report keeps its kind, its words, the release and the door it came
// through, and the person's address only when they share it for a reply. One person, with their
// agents, sends at most ten a day. The people who run the deployment get a digest, at most one a
// day, at the address it names. An agent's connection is offered submit_feedback unless the person
// turns it off, and only the person turns it back on.

const DIGEST_TO = "maintainers@example.com";

let h: Harness;
let ines: Browser;
let omar: Browser;
let ports: ReturnType<typeof createPorts>;

function result(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

async function connect(token: string) {
  const client = new Client({ name: "feedback-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

/** The whole OAuth connection, keeping the refresh token too. */
async function connectWithRefresh(browser: Browser, clientName: string) {
  const redirect = "http://127.0.0.1:9999/callback";
  const reg = (await (await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: clientName, redirect_uris: [redirect] }) })).json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const page = await fetch(`${h.baseUrl}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`, { headers: { cookie: browser.cookie } });
  const html = await page.text();
  const consent = (page.headers.get("set-cookie") ?? "").split(";")[0]!;
  const fields = Object.fromEntries([...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
  const decide = await fetch(`${h.baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: `${browser.cookie}; ${consent}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, decision: "allow", level: "editor" }),
  });
  const code = new URL(decide.headers.get("location")!).searchParams.get("code")!;
  const tokens = (await (
    await fetch(`${h.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier }),
    })
  ).json()) as { access_token: string; refresh_token: string };
  const refresh = async () =>
    (await (
      await fetch(`${h.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.client_id }),
      })
    ).json()) as { access_token: string };
  return { access: tokens.access_token, refresh };
}

const toolNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);
const agentNamed = async (b: Browser, name: string) => (await b.api("GET", "/api/v1/me/agents")).body.items.find((a: { client_name: string }) => a.client_name === name);

beforeAll(async () => {
  h = await startHarness({ feedbackEmail: DIGEST_TO });
  ports = createPorts(h.config, h.blobs, h.mailer);
  ines = await h.signIn("ines@feedback.example", "Ines Feedback");
  omar = await h.signIn("omar@feedback.example", "Omar Feedback");
});
afterAll(async () => h?.close());
beforeEach(async () => {
  await sql`delete from feedback`.execute(h.db);
  await sql`delete from feedback_counts`.execute(h.db);
  h.mailer.sent.length = 0;
});

describe("a report", () => {
  it("from the web app keeps its kind, words, release and screen, and names nobody", async () => {
    const sent = await ines.api("POST", "/api/v1/feedback", { category: "issue", message: "The upload stalls near the end.", screen: "Evidence" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.note).toContain("without your name or address");
    const row = await h.db.selectFrom("feedback").selectAll().where("feedback_id", "=", sent.body.feedback_id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ category: "issue", message: "The upload stalls near the end.", screen: "Evidence", surface: "web", client: null, reply_to: null, submitted_by: null, sent_at: null });
    expect(row.server_version).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("Ines");
  });

  it("carries the person's address only when they share it for a reply", async () => {
    const sent = await ines.api("POST", "/api/v1/feedback", { category: "improvement", message: "Let me sort sources by date.", reply: true });
    expect(sent.body.note).toContain("with your address");
    const row = await h.db.selectFrom("feedback").select(["reply_to", "submitted_by"]).where("feedback_id", "=", sent.body.feedback_id).executeTakeFirstOrThrow();
    expect(row).toEqual({ reply_to: "ines@feedback.example", submitted_by: null });
  });

  it("from an agent keeps its family and tool, never its client's own name, and cannot share an address", async () => {
    const client = await connect(await h.connectAgent(ines, "Claude Code (Ines's laptop)", "/mcp", "viewer"));
    const ok = result(await client.callTool({ name: "submit_feedback", arguments: { category: "confusion", message: "The tags description misled me.", tool: "sources" } }));
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const row = await h.db.selectFrom("feedback").selectAll().where("feedback_id", "=", ok.json.feedback_id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ surface: "mcp", client: "Claude Code", tool: "sources", reply_to: null, submitted_by: null });
    const reply = result(await client.callTool({ name: "submit_feedback", arguments: { category: "other", message: "Answer me.", reply: true } }));
    expect(reply.status).toBe(422);
    await client.close();
  });

  it("refuses a kind it doesn't know", async () => {
    expect((await ines.api("POST", "/api/v1/feedback", { category: "praise", message: "Lovely." })).status).toBe(422);
  });
});

describe("the daily limit", () => {
  it(`takes ${FEEDBACK_PER_DAY} a day from one person and their agents together, and counts nobody else's`, async () => {
    const client = await connect(await h.connectAgent(ines, "Limit agent", "/mcp", "editor"));
    for (let i = 0; i < FEEDBACK_PER_DAY - 1; i++) expect((await ines.api("POST", "/api/v1/feedback", { category: "other", message: `Note ${i}` })).status).toBe(200);
    expect(result(await client.callTool({ name: "submit_feedback", arguments: { category: "other", message: "The tenth." } })).status).toBe(200);
    const over = await ines.api("POST", "/api/v1/feedback", { category: "other", message: "One too many." });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("rate_limited");
    // A day is the UTC day, and the refusal says when the next one begins; its details stay as they were.
    const until = new RegExp(`^You have sent ${FEEDBACK_PER_DAY} pieces of feedback this UTC day, the most a day takes\\. You can send more from (\\S+), midnight UTC\\.$`).exec(over.body.error.message)?.[1];
    expect(until, over.body.error.message).toBeDefined();
    expect(until).toMatch(/T00:00:00\.000Z$/);
    expect(Date.parse(until!) - Date.now()).toBeGreaterThan(0);
    expect(Date.parse(until!) - Date.now()).toBeLessThanOrEqual(86400_000);
    expect(over.body.error.details).toEqual({ limit: FEEDBACK_PER_DAY });
    const agentOver = result(await client.callTool({ name: "submit_feedback", arguments: { category: "other", message: "Also too many." } }));
    expect(agentOver.status).toBe(429);
    expect((await omar.api("POST", "/api/v1/feedback", { category: "other", message: "Mine still counts." })).status).toBe(200);
    expect(Number((await sql<{ n: string }>`select count(*) as n from feedback`.execute(h.db)).rows[0]!.n)).toBe(FEEDBACK_PER_DAY + 1);
    // The count says how many, never which.
    const counts = await h.db.selectFrom("feedback_counts").selectAll().where("account_id", "is not", null).execute();
    expect(Object.keys(counts[0]!).sort()).toEqual(["account_id", "day", "sent"]);
    await client.close();
  });

  it("counts by the UTC day, whatever the hour where the person is, and says so", () => {
    expect(feedbackDay(new Date("2026-12-31T23:59:59.999Z"))).toEqual({ day: "2026-12-31", resets_at: "2027-01-01T00:00:00.000Z" });
    expect(feedbackDay(new Date("2027-01-01T00:00:00.000Z"))).toEqual({ day: "2027-01-01", resets_at: "2027-01-02T00:00:00.000Z" });
    // Eight in the evening on 18 October in California is already the 19th in UTC.
    expect(feedbackDay(new Date("2026-10-18T20:00:00-07:00")).day).toBe("2026-10-19");
    const description = OPERATIONS.find((o) => o.name === "submit_feedback")!.description;
    expect(description).toContain(`may send ${FEEDBACK_PER_DAY} a day, counted by the UTC day`);
    expect(description).toContain("the message says when it starts again (midnight UTC)");
  });

  it("forgets a day once it is over", async () => {
    await ines.api("POST", "/api/v1/feedback", { category: "other", message: "Yesterday's." });
    await sql`update feedback_counts set day = day - 1`.execute(h.db);
    const { pruneFeedbackCounts } = await import("@whatbuild/core");
    await pruneFeedbackCounts(h.db);
    expect(await h.db.selectFrom("feedback_counts").selectAll().execute()).toEqual([]);
  });
});

describe("an agent connection's feedback switch", () => {
  it("is on unless the person turns it off; off, the tool is neither listed nor answered, and the agent is told why", async () => {
    const token = await h.connectAgent(ines, "Switched agent", "/mcp", "editor");
    const agent = await agentNamed(ines, "Switched agent");
    expect(agent.feedback).toBe(true);
    let client = await connect(token);
    expect(await toolNames(client)).toContain("submit_feedback");
    await client.close();

    const off = await ines.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { feedback: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toEqual({ family_id: agent.family_id, feedback: false });
    expect((await agentNamed(ines, "Switched agent")).level).toBe("editor");

    client = await connect(token);
    expect(await toolNames(client)).not.toContain("submit_feedback");
    expect(client.getInstructions()).toContain("turned off submit_feedback");
    const refused = result(await client.callTool({ name: "submit_feedback", arguments: { category: "other", message: "Let me in." } }));
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("feedback_off");
    await client.close();
    expect(await h.db.selectFrom("feedback").selectAll().execute()).toEqual([]);
  });

  it("is the person's alone, and a refreshed connection keeps it", async () => {
    const conn = await connectWithRefresh(ines, "Refreshing agent");
    const agent = await agentNamed(ines, "Refreshing agent");
    // The agent's own token reaches no account route, so it cannot turn feedback back on.
    const self = await fetch(`${h.baseUrl}/api/v1/me/agents/${agent.family_id}`, { method: "PATCH", headers: { authorization: `Bearer ${conn.access}`, "content-type": "application/json" }, body: JSON.stringify({ feedback: true }) });
    expect(self.status).toBe(401);
    expect((await omar.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { feedback: false })).status).toBe(404);
    expect((await ines.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, {})).status).toBe(422);
    expect((await ines.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { feedback: "no" })).status).toBe(422);

    await ines.api("PATCH", `/api/v1/me/agents/${agent.family_id}`, { feedback: false });
    const refreshed = await conn.refresh();
    const client = await connect(refreshed.access_token);
    expect(await toolNames(client)).not.toContain("submit_feedback");
    await client.close();
    expect((await agentNamed(ines, "Refreshing agent")).feedback).toBe(false);
  });
});

describe("the digest", () => {
  it("sends what nobody has seen to the deployment's address, names nobody who didn't ask, and marks it sent", async () => {
    await ines.api("POST", "/api/v1/feedback", { category: "issue", message: "Search misses quoted phrases.\nTry \"crew lead\".", screen: "Search" });
    await omar.api("POST", "/api/v1/feedback", { category: "feature_request", message: "Export the Story to slides.", reply: true });
    const client = await connect(await h.connectAgent(ines, "Cursor", "/mcp", "viewer"));
    await client.callTool({ name: "submit_feedback", arguments: { category: "confusion", message: "describe=true was unclear.", tool: "mockups", details: "I expected the schema." } });
    await client.close();

    await h.worker.drain();
    expect(h.mailer.sent).toHaveLength(1);
    const mail = h.mailer.sent[0]!;
    expect(mail.to).toBe(DIGEST_TO);
    expect(mail.subject).toBe(`WhatBuild feedback: 3 reports from ${new URL(h.baseUrl).host}`);
    expect(mail.text).toContain("1. Bug, from the web app, on Search. Release ");
    expect(mail.text).toContain("   Search misses quoted phrases.\n   Try \"crew lead\".");
    expect(mail.text).toContain("Feature request, from the web app.");
    expect(mail.text).toContain("Reply to: omar@feedback.example");
    expect(mail.text).toContain("Confusing, from an agent (Cursor), about mockups.");
    expect(mail.text).toContain("   Details:\n   I expected the schema.");
    expect(mail.text).not.toContain("ines@feedback.example");
    expect(mail.text).not.toMatch(/Ines|Omar/);
    const unsent = await h.db.selectFrom("feedback").select("feedback_id").where("sent_at", "is", null).execute();
    expect(unsent).toEqual([]);
  });

  it("goes at most once a day, and the next carries only what came since", async () => {
    await ines.api("POST", "/api/v1/feedback", { category: "other", message: "First." });
    expect(await sendFeedbackDigest(h.db, ports)).toBe(1);
    await ines.api("POST", "/api/v1/feedback", { category: "other", message: "Second." });
    expect(await sendFeedbackDigest(h.db, ports)).toBeNull();
    expect(h.mailer.sent).toHaveLength(1);

    await sql`update feedback set sent_at = sent_at - interval '25 hours' where sent_at is not null`.execute(h.db);
    expect(await sendFeedbackDigest(h.db, ports)).toBe(1);
    expect(h.mailer.sent).toHaveLength(2);
    expect(h.mailer.sent[1]!.text).toContain("Second.");
    expect(h.mailer.sent[1]!.text).not.toContain("First.");
    // Nothing new, nothing sent.
    await sql`update feedback set sent_at = sent_at - interval '25 hours'`.execute(h.db);
    expect(await sendFeedbackDigest(h.db, ports)).toBe(0);
    expect(h.mailer.sent).toHaveLength(2);
  });

  it("leaves the reports unsent when the message fails, and sends nothing without an address", async () => {
    await ines.api("POST", "/api/v1/feedback", { category: "other", message: "Kept for later." });
    const failing = { ...ports, mailer: { send: async () => Promise.reject(new Error("535 5.7.8 authentication failed")) } };
    await expect(sendFeedbackDigest(h.db, failing)).rejects.toThrow("535");
    expect(await h.db.selectFrom("feedback").select("sent_at").execute()).toEqual([{ sent_at: null }]);
    expect(await sendFeedbackDigest(h.db, { ...ports, config: { ...ports.config, feedbackEmail: null } })).toBeNull();
    expect(await h.db.selectFrom("feedback").select("sent_at").execute()).toEqual([{ sent_at: null }]);
  });
});
