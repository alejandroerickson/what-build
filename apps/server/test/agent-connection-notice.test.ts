import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectionNotice } from "../src/auth/connection-notice.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A new agent connection emails its person; an agent connecting again, or refreshing, does not. The
// consent page warns before a first connection at a web address the person has never used.

let h: Harness;
let kim: Browser;

const SUBJECT = "A new agent is connected to your WhatBuild account";
const notices = () => h.mailer.sent.filter((m) => m.subject === SUBJECT);
const queued = async () => Number((await sql<{ n: string }>`select count(*) as n from jobs where kind = 'agent_connected'`.execute(h.db)).rows[0]!.n);

async function consentPage(browser: Browser, name: string, redirect: string): Promise<string> {
  const reg = (await (
    await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }) })
  ).json()) as { client_id: string };
  const page = await fetch(`${h.baseUrl}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=x&code_challenge_method=S256`, {
    headers: { cookie: browser.cookie },
  });
  return page.text();
}

/** Refresh a connection's tokens, as a client does every hour; answers the rotated refresh token. */
async function refresh(t: { refresh_token: string; client_id: string }) {
  const r = await fetch(`${h.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id }),
  });
  expect(r.status).toBe(200);
  return { ...t, refresh_token: ((await r.json()) as { refresh_token: string }).refresh_token };
}

beforeAll(async () => {
  h = await startHarness();
  kim = await h.signIn("kim@notice.example", "Kim Notice");
  const t = await kim.api("POST", "/api/v1/tenants", { name: "Notice Co" });
  expect(t.status).toBe(201);
});
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.worker.drain();
  h.mailer.sent.length = 0;
});

describe("a new agent connection", () => {
  it("emails the person once, naming the agent, where it is held, what it reaches and may do, and how to end it", async () => {
    const before = await queued();
    await h.connectAgentTokens(kim, "Desk Agent", "/mcp", "editor");
    expect(await queued()).toBe(before + 1);
    await h.worker.drain();
    expect(notices()).toHaveLength(1);
    const mail = notices()[0]!;
    expect(mail.to).toBe("kim@notice.example");
    expect(mail.text).toContain("“Desk Agent”, the name it gave itself, which WhatBuild hasn’t verified");
    expect(mail.text).toContain("Held by:   an app on your computer");
    expect(mail.text).toContain("Reaches:   Every product you can open");
    expect(mail.text).toContain("May:       Edit");
    expect(mail.text).toMatch(/When: {6}\d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    expect(mail.text).toContain(`${h.baseUrl}/connect`);
    expect(mail.text).toContain(`${h.baseUrl}/settings`);
  });

  it("names a web host, and an organization's reach, in the consent page's words", () => {
    const { text } = connectionNotice({
      clientName: "Web Agent",
      held: "agents.example.com",
      reach: { kind: "tenant", path: "notice-co", name: "Notice Co" },
      level: "viewer",
      at: "2026-10-25T20:15:42.000Z",
      base: "https://app.example.com",
    });
    expect(text).toContain("Held by:   agents.example.com");
    expect(text).toContain("Reaches:   The organization Notice Co, and nothing outside it");
    expect(text).toContain("May:       Read only");
    expect(text).toContain("When:      2026-10-25 20:15 UTC");
  });

  it("sends nothing when the agent refreshes its tokens", async () => {
    const t = await h.connectAgentTokens(kim, "Refreshing Agent");
    await h.worker.drain();
    h.mailer.sent.length = 0;
    const before = await queued();
    await refresh(await refresh(t));
    expect(await queued()).toBe(before);
    await h.worker.drain();
    expect(notices()).toEqual([]);
  });

  it("sends nothing when the same agent connects again, even after it was disconnected, and sends for a new one", async () => {
    await h.connectAgentTokens(kim, "Laptop Agent");
    await h.worker.drain();
    expect(notices()).toHaveLength(1);
    // A client that registers again under the same name, held at the same place, is the same agent connecting again.
    await h.connectAgentTokens(kim, "Laptop Agent", `/mcp/t/${(await kim.api("GET", "/api/v1/me/products")).body.tenants[0].slug}`);
    for (const a of (await kim.api("GET", "/api/v1/me/agents")).body.items as { family_id: string; client_name: string }[])
      if (a.client_name === "Laptop Agent") await kim.api("DELETE", `/api/v1/me/agents/${a.family_id}`);
    await h.connectAgentTokens(kim, "Laptop Agent");
    await h.worker.drain();
    expect(notices()).toHaveLength(1);
    // Another name, or the same name held somewhere else, is new.
    await h.connectAgentTokens(kim, "Phone Agent");
    await h.connectAgentTokens(kim, "Laptop Agent", "/mcp", "editor", "https://laptop-agent.example.com/callback");
    await h.worker.drain();
    expect(notices().map((m) => /“([^”]+)”/.exec(m.text)![1])).toEqual(["Laptop Agent", "Phone Agent", "Laptop Agent"]);
    expect(notices()[2]!.text).toContain("Held by:   laptop-agent.example.com");
  });

  it("never fails the token exchange when the mailer fails, and is sent when it works again", async () => {
    const send = h.mailer.send.bind(h.mailer);
    h.mailer.send = async () => {
      throw new Error("the mail provider is down");
    };
    try {
      const t = await h.connectAgentTokens(kim, "Patient Agent");
      expect(t.access_token).toBeTruthy();
      await h.worker.drain();
    } finally {
      h.mailer.send = send;
    }
    const job = (await sql<{ attempts: number; done_at: string | null; error: string | null }>`select attempts, done_at, error from jobs where kind = 'agent_connected' order by job_id desc limit 1`.execute(h.db)).rows[0]!;
    expect(job).toMatchObject({ attempts: 1, done_at: null, error: expect.stringContaining("the mail provider is down") });
    await sql`update jobs set run_after = now() where kind = 'agent_connected' and done_at is null`.execute(h.db);
    await h.worker.drain();
    expect(notices().map((m) => /“([^”]+)”/.exec(m.text)![1])).toEqual(["Patient Agent"]);
  });
});

describe("the consent page", () => {
  it("warns before a first connection at a web address, puts Deny first, and says nothing once the address has been used", async () => {
    const first = await consentPage(kim, "Web Agent", "https://first-time.example.com/callback");
    expect(first).toContain("You have never connected an agent at first-time.example.com before.");
    expect(first.indexOf('value="deny"')).toBeLessThan(first.indexOf('value="allow"'));
    expect(first).not.toMatch(/value="allow" class="primary"/);
    await h.connectAgentTokens(kim, "Web Agent", "/mcp", "editor", "https://first-time.example.com/callback");
    // Any client held there since, whatever it calls itself.
    const again = await consentPage(kim, "Another Web Agent", "https://first-time.example.com/other-callback");
    expect(again).not.toContain("You have never connected an agent");
    expect(again).toMatch(/value="allow" class="primary"/);
    // Someone else has never used it.
    const lee = await h.signIn("lee@notice.example", "Lee Notice");
    expect(await consentPage(lee, "Web Agent", "https://first-time.example.com/callback")).toContain("You have never connected an agent at first-time.example.com before.");
  });

  it("keeps its usual wording for an app on this computer", async () => {
    for (const redirect of ["http://127.0.0.1:7777/callback", "com.example.agent:/callback"]) {
      const page = await consentPage(kim, "Local Agent", redirect);
      expect(page, redirect).not.toContain("You have never connected an agent");
      expect(page, redirect).toContain("an app on this computer");
    }
  });
});

describe("a deployment with no mailer", () => {
  it("queues no notice, and the connection still works", async () => {
    const quiet = await startHarness({ mailer: "none" });
    try {
      const sam = await quiet.signIn("sam@notice.example", "Sam Quiet");
      const token = await quiet.connectAgent(sam, "Quiet Agent");
      expect(token).toBeTruthy();
      expect(Number((await sql<{ n: string }>`select count(*) as n from jobs where kind = 'agent_connected'`.execute(quiet.db)).rows[0]!.n)).toBe(0);
      expect(((await sam.api("GET", "/api/v1/me/agents")).body.items as unknown[]).length).toBe(1);
    } finally {
      await quiet.close();
    }
  });
});
