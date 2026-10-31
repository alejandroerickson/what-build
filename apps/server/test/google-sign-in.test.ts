import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startHarness, type Harness } from "./harness.ts";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

let h: Harness;
/** The claims the stubbed token endpoint puts in the next ID token. */
let claims: Record<string, unknown> = {};

const realFetch = globalThis.fetch;

function idToken(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(payload)}.`;
}

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: idToken(claims) });
    return realFetch(input, init);
  });
  h = await startHarness({ googleClientId: CLIENT_ID, googleClientSecret: "test-secret" });
});

afterAll(async () => {
  await h.close();
  vi.restoreAllMocks();
});

async function signInWithGoogle(next: string) {
  const start = await fetch(`${h.baseUrl}/auth/google?next=${encodeURIComponent(next)}`, { redirect: "manual" });
  const authorize = new URL(start.headers.get("location")!);
  const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0]!;
  const callback = await fetch(`${h.baseUrl}/auth/google/callback?code=c&state=${authorize.searchParams.get("state")}`, { redirect: "manual", headers: { cookie } });
  return { authorize, location: callback.headers.get("location"), setCookie: callback.headers.get("set-cookie") ?? "" };
}

describe("Google sign-in", () => {
  it("signs in a verified address and returns to next", async () => {
    claims = { aud: CLIENT_ID, email: "g@example.com", email_verified: true, name: "G Person" };
    const r = await signInWithGoogle("/after");
    expect(`${r.authorize.origin}${r.authorize.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(r.authorize.searchParams.get("redirect_uri")).toBe(`${h.baseUrl}/auth/google/callback`);
    expect(r.location).toBe("/after");
    expect(r.setCookie).toMatch(/wb_session=[^;]+/);
  });

  it("leaves an invitation to the address waiting: signing in accepts nothing", async () => {
    const owner = await h.signIn("owner@example.com", "Owner");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Work" });
    await owner.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, email: "g-invited@example.com", role: "viewer" });
    claims = { aud: CLIENT_ID, email: "G-Invited@example.com", email_verified: true, name: "Invited Person" };
    const r = await signInWithGoogle("/");
    const session = /((?:__Host-)?wb_session=[^;]+)/.exec(r.setCookie)![1]!;
    const invitation = await h.db.selectFrom("invitations").select(["accepted_at", "accepted_by"]).where("email", "=", "g-invited@example.com").executeTakeFirstOrThrow();
    expect(invitation).toEqual({ accepted_at: null, accepted_by: null });
    const waiting = (await (await fetch(`${h.baseUrl}/api/v1/me/invitations`, { headers: { cookie: session } })).json()) as { items: { role: string }[] };
    expect(waiting.items.map((i) => i.role)).toEqual(["viewer"]);
  });

  it("refuses an unverified address or another client's token", async () => {
    claims = { aud: CLIENT_ID, email: "g2@example.com", email_verified: false };
    expect((await signInWithGoogle("/")).location).toBe("/signin?error=google_unverified");
    claims = { aud: "another-client", email: "g2@example.com", email_verified: true };
    expect((await signInWithGoogle("/")).location).toBe("/signin?error=google_unverified");
  });

  it("reports Google on and Microsoft off", async () => {
    const methods = (await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { google: boolean; microsoft: boolean };
    expect(methods).toMatchObject({ google: true, microsoft: false });
  });
});
