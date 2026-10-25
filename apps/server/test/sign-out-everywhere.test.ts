import { OPERATIONS } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Sign out everywhere ends every browser session and disconnects every agent at once, and only a
// person in the web app can do it.

let h: Harness;
let owner: Browser;
let path: string;

const EMAIL = "pat@everywhere.example";

async function mcpStatus(token: string) {
  const r = await fetch(`${h.baseUrl}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  return r.status;
}

async function refresh(t: { refresh_token: string; client_id: string }) {
  const r = await fetch(`${h.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id }),
  });
  return { status: r.status, body: (await r.json()) as { error?: string } };
}

const signedIn = async (b: Browser) => (await b.api("GET", "/api/v1/me")).status;

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signIn(EMAIL, "Pat Everywhere");
  const t = await owner.api("POST", "/api/v1/tenants", { name: "Everywhere Co" });
  path = (await owner.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Atlas" })).body.path;
});
afterAll(async () => h?.close());

describe("sign out everywhere", () => {
  it("ends every session and disconnects every agent, so every old cookie and token fails", async () => {
    const browsers = [await h.signIn(EMAIL), await h.signIn(EMAIL), await h.signIn(EMAIL)];
    const agents = [await h.connectAgentTokens(browsers[0]!, "First agent"), await h.connectAgentTokens(browsers[1]!, "Second agent")];
    for (const b of browsers) expect(await signedIn(b)).toBe(200);
    for (const a of agents) expect(await mcpStatus(a.access_token)).toBe(200);
    // Someone else's session and agent are not touched.
    const other = await h.signIn("sam@everywhere.example", "Sam Other");
    const theirs = await h.connectAgent(other, "Sam's agent");

    const r = await browsers[0]!.api("POST", "/api/v1/me/sign-out-everywhere", {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ connections: 2, kept_this_session: false });
    expect(r.body.sessions).toBeGreaterThanOrEqual(4);
    expect(r.headers.getSetCookie().join(";")).toMatch(/wb_session=;/);

    for (const b of [...browsers, owner]) expect(await signedIn(b)).toBe(401);
    for (const a of agents) {
      expect(await mcpStatus(a.access_token)).toBe(401);
      expect((await refresh(a)).body.error).toBe("invalid_grant");
    }
    expect(await signedIn(other)).toBe(200);
    expect(await mcpStatus(theirs)).toBe(200);
    expect(((await other.api("GET", "/api/v1/me/agents")).body.items as unknown[]).length).toBe(1);
    owner = await h.signIn(EMAIL);
  });

  it("keeps the session that asks, and only it, when told to", async () => {
    const here = await h.signIn(EMAIL);
    const elsewhere = await h.signIn(EMAIL);
    const agent = await h.connectAgent(elsewhere, "Elsewhere agent");
    const r = await here.api("POST", "/api/v1/me/sign-out-everywhere", { keep_this_session: true });
    expect(r.body).toMatchObject({ connections: 1, kept_this_session: true });
    expect(r.headers.getSetCookie().join(";")).not.toMatch(/wb_session=;/);
    expect(await signedIn(here)).toBe(200);
    expect(await signedIn(elsewhere)).toBe(401);
    expect(await signedIn(owner)).toBe(401);
    expect(await mcpStatus(agent)).toBe(401);
    expect(((await here.api("GET", "/api/v1/me/agents")).body.items as unknown[]).length).toBe(0);
    owner = here;
  });

  it("stores nothing more under an upload grant given before", async () => {
    const P = `/api/v1/p/${path}`;
    const source = await owner.api("POST", `${P}/sources`, { title: "Notes", date: "2026-10-01", tags: ["notes"] });
    expect(source.status, JSON.stringify(source.body)).toBe(201);
    const grant = await owner.api("POST", `${P}/sources/${source.body.record_id}/uploads`, { path: "notes.md" });
    expect(grant.status, JSON.stringify(grant.body)).toBe(201);
    expect((await owner.api("POST", "/api/v1/me/sign-out-everywhere", { keep_this_session: true })).status).toBe(200);
    const put = await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "too late" });
    expect(put.status).toBe(401);
    expect(((await put.json()) as { error: { code: string } }).error.code).toBe("invalid_grant");
  });

  it("is refused to an agent's token, to another site, and to nobody, and no operation reaches it", async () => {
    const token = await h.connectAgent(owner, "Would-be agent");
    const bearer = await fetch(`${h.baseUrl}/api/v1/me/sign-out-everywhere`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    expect(bearer.status).toBe(401);
    const crossSite = await owner.api("POST", "/api/v1/me/sign-out-everywhere", {}, { origin: "https://elsewhere.example" });
    expect(crossSite.status).toBe(403);
    const nobody = await fetch(`${h.baseUrl}/api/v1/me/sign-out-everywhere`, { method: "POST", headers: { origin: h.baseUrl, "content-type": "application/json" }, body: "{}" });
    expect(nobody.status).toBe(401);
    expect(await signedIn(owner)).toBe(200);
    expect(await mcpStatus(token)).toBe(200);
    expect(OPERATIONS.map((o) => o.name).filter((n) => /sign.?out|everywhere|end_?sessions/i.test(n))).toEqual([]);
  });
});
