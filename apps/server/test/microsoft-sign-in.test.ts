import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { startHarness, type Harness } from "./harness.ts";

const TENANT = "11111111-2222-4333-8444-555555555555";
const OTHER_TENANT = "99999999-8888-4777-8666-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

let h: Harness;
let plain: Harness;
/** The claims the stubbed token endpoint puts in the next ID token. */
let claims: Record<string, unknown> = {};
let tokenRequests: URLSearchParams[] = [];
/** The lines the server logged with console.warn, parsed. */
let warnings: Record<string, unknown>[] = [];

const realFetch = globalThis.fetch;

/** An unsigned ID token: the server reads claims as issued, since it has them straight from the token endpoint. */
function idToken(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(payload)}.`;
}

function work(email: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { aud: CLIENT_ID, iss: ISSUER, tid: TENANT, email, name: "Work Person", ...extra };
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    try {
      warnings.push(JSON.parse(String(args[0])) as Record<string, unknown>);
    } catch {
      warnings.push({ unstructured: args.map(String).join(" ") });
    }
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://login.microsoftonline.com/")) {
      if (url !== `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) return new Response("wrong endpoint", { status: 400 });
      const form = new URLSearchParams(String(init?.body ?? ""));
      tokenRequests.push(form);
      if (form.get("code") === "refused") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return Response.json({ id_token: idToken(claims), token_type: "Bearer" });
    }
    return realFetch(input, init);
  });
  h = await startHarness({
    microsoftTenant: TENANT,
    microsoftClientId: CLIENT_ID,
    microsoftClientSecret: "test-secret",
    microsoftDomains: ["work.example"],
    signupAllowlist: ["@work.example"],
  });
  plain = await startHarness();
});

afterAll(async () => {
  await h.close();
  await plain.close();
  vi.restoreAllMocks();
});

/** Start at /auth/microsoft, then come back to the callback as the directory would. */
async function signInWithMicrosoft(next: string, opts: { code?: string; state?: string; dropCookie?: boolean } = {}) {
  const start = await fetch(`${h.baseUrl}/auth/microsoft?next=${encodeURIComponent(next)}`, { redirect: "manual" });
  const authorize = new URL(start.headers.get("location")!);
  const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0]!;
  const state = opts.state ?? authorize.searchParams.get("state")!;
  const callback = await fetch(`${h.baseUrl}/auth/microsoft/callback?code=${opts.code ?? "good"}&state=${encodeURIComponent(state)}`, {
    redirect: "manual",
    headers: opts.dropCookie ? {} : { cookie },
  });
  const session = callback.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /^(?:__Host-)?wb_session=./.test(c));
  return { start, authorize, startCookie: start.headers.get("set-cookie") ?? "", location: callback.headers.get("location"), session };
}

describe("Microsoft sign-in", () => {
  it("sends the person to the configured directory with PKCE, a state and a cookie scoped to the flow", async () => {
    const { start, authorize, startCookie } = await signInWithMicrosoft("/somewhere");
    expect(start.status).toBe(302);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(authorize.searchParams.get("scope")).toBe("openid email profile");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${h.baseUrl}/auth/microsoft/callback`);
    expect(startCookie).toMatch(/wb_oidc=/);
    expect(startCookie).toMatch(/Path=\/auth\/microsoft/i);
    expect(startCookie).toMatch(/HttpOnly/i);
  });

  it("creates the account, leaves its invitations waiting, starts a session and returns to next", async () => {
    const owner = await h.signIn("owner@work.example", "Owner");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Work" });
    await owner.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, email: "invited@outside.example", role: "viewer" });

    // Outside the listed domains, so taken on the directory's word that it verified the domain.
    claims = work("Invited@Outside.example", { name: "Invited Person", xms_edov: true });
    tokenRequests = [];
    const r = await signInWithMicrosoft("/after");
    expect(r.location).toBe("/after");
    expect(r.session).toBeTruthy();
    expect(tokenRequests[0]!.get("client_secret")).toBe("test-secret");
    expect(tokenRequests[0]!.get("code_verifier")).toBeTruthy();

    const me = (await (await fetch(`${h.baseUrl}/api/v1/me`, { headers: { cookie: r.session! } })).json()) as { account_id: string; email: string; display_name: string };
    expect(me.email.toLowerCase()).toBe("invited@outside.example");
    expect(me.display_name).toBe("Invited Person");
    const invitation = await h.db.selectFrom("invitations").select(["accepted_at", "accepted_by"]).where("email", "=", "invited@outside.example").executeTakeFirstOrThrow();
    expect(invitation).toEqual({ accepted_at: null, accepted_by: null });
    const waiting = (await (await fetch(`${h.baseUrl}/api/v1/me/invitations`, { headers: { cookie: r.session! } })).json()) as { items: { role: string }[] };
    expect(waiting.items.map((i) => i.role)).toEqual(["viewer"]);
  });

  /** The address of the account a sign-in with the current claims reaches, or the place it was refused to. */
  async function signedInAs(): Promise<string> {
    const r = await signInWithMicrosoft("/");
    if (!r.session) return withoutReference(r.location!);
    return ((await (await fetch(`${h.baseUrl}/api/v1/me`, { headers: { cookie: r.session } })).json()) as { email: string }).email.toLowerCase();
  }

  /** A refusal's place without its reference, once the reference has its form. */
  function withoutReference(location: string): string {
    const u = new URL(location, "http://whatbuild.example");
    const ref = u.searchParams.get("ref");
    if (ref !== null) expect(ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    u.searchParams.delete("ref");
    return `${u.pathname}${u.search}`;
  }

  it("refuses an address whose domain the directory has not verified, outside the listed domains", async () => {
    // A directory's administrators can give one of its people any email attribute, someone else's address included.
    for (const edov of [false, "false", 0, undefined]) {
      claims = work("victim@outside.example", { xms_edov: edov, preferred_username: "member@contoso-directory.example" });
      expect(await signedInAs(), String(edov)).toBe("/signin?error=microsoft_no_verified_email");
    }
  });

  it("takes an address in a domain WHATBUILD_MICROSOFT_DOMAINS lists, without the directory's word", async () => {
    claims = work("Listed.Person@WORK.example");
    expect(await signedInAs()).toBe("listed.person@work.example");
  });

  it("falls back to the user principal name only in a listed domain", async () => {
    claims = work("victim@outside.example", { xms_edov: false, preferred_username: "member@work.example" });
    expect(await signedInAs()).toBe("member@work.example");
    claims = work("", { email: undefined, preferred_username: "upn@work.example" });
    expect(await signedInAs()).toBe("upn@work.example");
    claims = work("", { email: undefined, preferred_username: "upn@outside.example" });
    expect(await signedInAs()).toBe("/signin?error=microsoft_no_verified_email");
  });

  it.each([
    ["another client", { aud: "00000000-0000-4000-8000-000000000000" }, "/signin?error=microsoft_wrong_directory"],
    ["another directory", { tid: OTHER_TENANT }, "/signin?error=microsoft_wrong_directory"],
    ["another issuer", { iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }, "/signin?error=microsoft_wrong_directory"],
    ["another directory, with no address either", { tid: OTHER_TENANT, email: undefined }, "/signin?error=microsoft_wrong_directory"],
    ["no address", { email: undefined, preferred_username: "not-an-address" }, "/signin?error=microsoft_no_verified_email"],
  ])("refuses a token from %s", async (_what, change, refusal) => {
    claims = { ...work("someone@work.example"), ...change };
    const r = await signInWithMicrosoft("/");
    expect(withoutReference(r.location!)).toBe(refusal);
    expect(r.session).toBeUndefined();
  });

  describe("the log line a refusal leaves for whoever runs the deployment", () => {
    const PERSONAL = ["Secret Person", "person.secret", "upn.secret", "outside.example", "@"];

    /** Sign in with these claims; the one line logged, and the reference the sign-in page was given. */
    async function refusal(payload: Record<string, unknown>) {
      claims = { name: "Secret Person", ...payload };
      warnings = [];
      const r = await signInWithMicrosoft("/");
      expect(r.session).toBeUndefined();
      expect(warnings).toHaveLength(1);
      const line = warnings[0]!;
      expect(line).toMatchObject({ event: "microsoft_sign_in_refused", severity: "WARNING", guide: "okf/operations/azure.md#when-microsoft-sign-in-is-refused" });
      expect(line.reference).toBe(new URL(r.location!, h.baseUrl).searchParams.get("ref"));
      // Claim names and booleans only: never the token, an address, a name or a claim's value.
      const text = JSON.stringify(line);
      for (const s of [...PERSONAL, idToken(claims), String(claims.aud), String(claims.tid), String(claims.iss)]) expect(text, s).not.toContain(s);
      return { line, location: withoutReference(r.location!) };
    }

    it("names which of aud, tid and iss did not match, and the settings to check", async () => {
      const { line, location } = await refusal(work("person.secret@outside.example", { aud: "00000000-0000-4000-8000-000000000000", iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`, xms_edov: true }));
      expect(location).toBe("/signin?error=microsoft_wrong_directory");
      expect(line).toMatchObject({ check: "directory", mismatched: ["aud", "iss"] });
      expect(line.fix).toMatch(/WHATBUILD_MICROSOFT_TENANT/);
      expect(line.fix).toMatch(/WHATBUILD_MICROSOFT_CLIENT_ID/);
    });

    it("says the token has no xms_edov claim, and how to add it", async () => {
      const { line, location } = await refusal(work("person.secret@outside.example", { preferred_username: "upn.secret@outside.example" }));
      expect(location).toBe("/signin?error=microsoft_no_verified_email");
      expect(line).toMatchObject({
        check: "email",
        email_claim: true,
        xms_edov_claim: false,
        xms_edov_true: false,
        email_domain_listed: false,
        upn_claim: true,
        upn_domain_listed: false,
        domains_listed: 1,
      });
      expect(line.fix).toMatch(/no xms_edov claim/);
      expect(line.fix).toMatch(/optional ID-token claim xms_edov/);
      expect(line.fix).toMatch(/WHATBUILD_MICROSOFT_DOMAINS/);
    });

    it("says Entra called the domain unverified, without telling the operator to trust it", async () => {
      const { line } = await refusal(work("person.secret@outside.example", { xms_edov: false }));
      expect(line).toMatchObject({ check: "email", email_claim: true, xms_edov_claim: true, xms_edov_true: false, upn_claim: false });
      expect(line.fix).toMatch(/not verified/);
      expect(line.fix).toMatch(/unless the directory is the authority for that domain/);
    });

    it("says the token carries no email address", async () => {
      const { line } = await refusal(work("", { email: undefined, preferred_username: "upn.secret@outside.example" }));
      expect(line).toMatchObject({ check: "email", email_claim: false, xms_edov_claim: false, upn_claim: true, upn_domain_listed: false });
      expect(line.fix).toMatch(/no email address/);
      expect(line.fix).toMatch(/optional ID-token claims email and xms_edov/);
    });

    it("gives every refusal a reference of its own", async () => {
      const a = await refusal(work("person.secret@outside.example"));
      const b = await refusal(work("person.secret@outside.example"));
      expect(a.line.reference).not.toBe(b.line.reference);
    });

    it("logs nothing for a sign-in that is accepted", async () => {
      claims = work("logged.nothing@work.example");
      warnings = [];
      expect((await signInWithMicrosoft("/")).session).toBeTruthy();
      expect(warnings).toEqual([]);
    });
  });

  it("fails without the cookie, with the wrong state, or when the token request fails", async () => {
    claims = work("someone@work.example");
    expect((await signInWithMicrosoft("/", { state: "wrong" })).location).toBe("/signin?error=microsoft_failed");
    expect((await signInWithMicrosoft("/", { dropCookie: true })).location).toBe("/signin?error=microsoft_failed");
    expect((await signInWithMicrosoft("/", { code: "refused" })).location).toBe("/signin?error=microsoft_failed");
  });

  it("refuses an address outside the allowlist in invite-only mode", async () => {
    claims = work("stranger@elsewhere.example", { xms_edov: true });
    const r = await signInWithMicrosoft("/");
    expect(r.location).toBe("/signin?error=invite_only");
    expect(r.session).toBeUndefined();
  });

  it("never redirects off the site", async () => {
    claims = work("redirect@work.example");
    expect((await signInWithMicrosoft("//evil.example/x")).location).toBe("/");
  });

  it("is reported by both endpoints", async () => {
    const get = async (base: string, path: string) => (await (await fetch(`${base}${path}`)).json()) as { microsoft?: boolean; auth?: { microsoft: boolean } };
    expect((await get(h.baseUrl, "/auth/methods")).microsoft).toBe(true);
    expect((await get(h.baseUrl, "/api/v1/meta")).auth?.microsoft).toBe(true);
    expect((await get(plain.baseUrl, "/auth/methods")).microsoft).toBe(false);
    expect((await get(plain.baseUrl, "/api/v1/meta")).auth?.microsoft).toBe(false);
  });

  it("answers 404 where it is not configured", async () => {
    expect((await fetch(`${plain.baseUrl}/auth/microsoft`, { redirect: "manual" })).status).toBe(404);
    expect((await fetch(`${plain.baseUrl}/auth/microsoft/callback?code=x&state=y`, { redirect: "manual" })).status).toBe(404);
  });

  it("refuses to start with a directory that is not a GUID", () => {
    for (const tenant of ["common", "organizations", "consumers", "example.com", "not-a-guid"]) {
      expect(() => loadConfig({ NODE_ENV: "test", WHATBUILD_MICROSOFT_TENANT: tenant })).toThrow(/GUID/);
    }
    expect(loadConfig({ NODE_ENV: "test", WHATBUILD_MICROSOFT_TENANT: TENANT.toUpperCase() }).microsoftTenant).toBe(TENANT);
  });

  it("reads the listed domains, and refuses to start on one that is not a domain", () => {
    expect(loadConfig({ NODE_ENV: "test" }).microsoftDomains).toEqual([]);
    expect(loadConfig({ NODE_ENV: "test", WHATBUILD_MICROSOFT_DOMAINS: " Work.Example, @sub.work.example ," }).microsoftDomains).toEqual(["work.example", "sub.work.example"]);
    for (const domains of ["*.work.example", "work", "work.example/x", "someone@work.example", "work..example"])
      expect(() => loadConfig({ NODE_ENV: "test", WHATBUILD_MICROSOFT_DOMAINS: domains }), domains).toThrow(/WHATBUILD_MICROSOFT_DOMAINS/);
  });
});
