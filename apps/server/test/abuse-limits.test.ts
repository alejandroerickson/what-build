import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { abuseLimitsFrom, DEFAULT_ABUSE_LIMITS, pruneAbuseCounters, type AbuseLimits } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_ADDRESS_HEADER, clientKey, clientOf } from "../src/client-address.ts";
import { loadConfig } from "../src/config.ts";
import { EDGE_KEY_HEADER } from "../src/edge-key.ts";
import { startHarness, type Harness } from "./harness.ts";

const KEY = "an-edge-key-of-at-least-32-random-characters";

/** Limits small enough to reach in a test, the rest as a deployment gets them. */
const limits = (set: Partial<AbuseLimits>): AbuseLimits => ({ ...DEFAULT_ABUSE_LIMITS, ...set });

/** A request as the Cloudflare Worker passes it on: with the edge key, from `from`. */
function edge(h: Harness, from: string | null) {
  return (path: string, body?: unknown, init: RequestInit = {}) =>
    fetch(`${h.baseUrl}${path}`, {
      redirect: "manual",
      method: body === undefined ? "GET" : "POST",
      ...init,
      headers: {
        [EDGE_KEY_HEADER]: KEY,
        ...(from ? { [CLIENT_ADDRESS_HEADER]: from } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json", origin: h.baseUrl }),
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

/** Ask for a sign-in link with the edge key, from `from`; the status and error code. */
async function askLink(h: Harness, from: string | null, email: string, extra: Record<string, unknown> = {}) {
  const res = await edge(h, from)("/auth/email", { email, ...extra });
  const body = (await res.json()) as { error?: { code: string; details?: { abuse_limit?: string } } };
  return { status: res.status, code: body.error?.code ?? null, limit: body.error?.details?.abuse_limit ?? null, retryAfter: res.headers.get("retry-after") };
}

/**
 * Open the sign-in link last mailed to `email` and press Sign in, as the Worker passes it on from
 * `from` (or, with `from` undefined, straight to a service with no edge key); where it sends the browser.
 */
async function followLink(h: Harness, email: string, from?: string): Promise<string> {
  await expect.poll(() => h.mailer.sent.some((m) => m.to === email)).toBe(true);
  const text = [...h.mailer.sent].reverse().find((m) => m.to === email)?.text ?? "";
  const token = /\/auth\/verify\?token=(\S+)/.exec(text)?.[1]!;
  const init = { method: "POST", headers: { origin: h.baseUrl, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) };
  const res = from === undefined ? await fetch(`${h.baseUrl}/auth/verify`, { ...init, redirect: "manual" }) : await edge(h, from)("/auth/verify", undefined, init);
  return res.headers.get("location") ?? String(res.status);
}

describe("the abuse limits' settings", () => {
  it("keep the defaults, change only what a deployment names, and turn one off", () => {
    expect(abuseLimitsFrom(undefined)).toEqual(DEFAULT_ABUSE_LIMITS);
    expect(abuseLimitsFrom("mail_per_hour=50, waitlist_per_address=off")).toEqual({ ...DEFAULT_ABUSE_LIMITS, mail_per_hour: 50, waitlist_per_address: null });
  });

  it("stop the server on a name or a number they do not take, so no typing mistake leaves a limit unset", () => {
    expect(() => abuseLimitsFrom("mail_an_hour=50")).toThrow(/not an abuse limit/);
    for (const bad of ["mail_per_hour=0", "mail_per_hour=-3", "mail_per_hour=1.5", "mail_per_hour=", "mail_per_hour"]) expect(() => abuseLimitsFrom(bad)).toThrow(/whole number/);
    expect(() => loadConfig({ NODE_ENV: "test", WHATBUILD_ABUSE_LIMITS: "sign_ins=5" })).toThrow(/WHATBUILD_ABUSE_LIMITS/);
  });

  it("take the bot check's two keys together, and production never takes Cloudflare's test keys", () => {
    expect(() => loadConfig({ NODE_ENV: "test", WHATBUILD_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" })).toThrow(/go together/);
    expect(() => loadConfig({ NODE_ENV: "test", WHATBUILD_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" })).toThrow(/go together/);
    const test = loadConfig({ NODE_ENV: "test", WHATBUILD_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", WHATBUILD_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" });
    expect(test.turnstileSiteKey).toBe("1x00000000000000000000AA");
    const production = { NODE_ENV: "production", WHATBUILD_GRANT_KEY: "g".repeat(32), DATABASE_URL: "postgres://x" };
    for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"])
      expect(() => loadConfig({ ...production, WHATBUILD_TURNSTILE_SITE_KEY: "0x4AAAAAAAexample", WHATBUILD_TURNSTILE_SECRET_KEY: secret })).toThrow(/test keys/);
    expect(loadConfig({ ...production, WHATBUILD_TURNSTILE_SITE_KEY: "0x4AAAAAAAexample", WHATBUILD_TURNSTILE_SECRET_KEY: "0x4AAAAAAAexample-secret" }).turnstileSecretKey).toBe("0x4AAAAAAAexample-secret");
  });
});

describe("a client's address", () => {
  it("counts an IPv4 address whole and an IPv6 address by its /64, an IPv4 address written as IPv6 as itself", () => {
    expect(clientOf("203.0.113.7")).toBe("203.0.113.7");
    expect(clientOf("2001:db8:1:2::5")).toBe("2001:db8:1:2::/64");
    expect(clientOf("2001:0db8:0001:0002:ffff:0:0:9")).toBe("2001:db8:1:2::/64");
    expect(clientOf("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(clientOf("::1")).toBe("0:0:0:0::/64");
  });

  it("is kept as a keyed hash that names no address, the same for every address in one /64", () => {
    const a = clientKey("2001:db8:1:2::5", "grant key one")!;
    expect(a).toBe(clientKey("2001:db8:1:2:aaaa::1", "grant key one"));
    expect(a).not.toBe(clientKey("2001:db8:1:3::5", "grant key one"));
    expect(a).not.toBe(clientKey("2001:db8:1:2::5", "grant key two"));
    expect(a).not.toContain("2001");
    expect(clientKey(null, "grant key one")).toBeNull();
  });
});

describe("behind the Worker, with the edge key", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({
      edgeKey: KEY,
      // Anyone may make an account, as when sign-up is open.
      signupAllowlist: null,
      instanceOwners: ["vouched@example.com"],
      abuseLimits: limits({ sign_in_links_per_address: 3, new_accounts_per_address: 2, waitlist_per_address: 2, agent_registrations_per_address: 2 }),
    });
  });
  afterAll(async () => h?.close());

  it("limits the sign-in links one client asks for in an hour, whatever addresses it names, and leaves other clients alone", async () => {
    for (const n of [1, 2, 3]) expect((await askLink(h, "203.0.113.10", `stranger${n}@example.com`)).status).toBe(200);
    const refused = await askLink(h, "203.0.113.10", "stranger4@example.com");
    expect(refused).toMatchObject({ status: 429, code: "rate_limited", limit: "sign_in_links_per_address" });
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
    // Every address in the client's /64 is the same client.
    for (const n of [1, 2, 3]) expect((await askLink(h, `2001:db8:5:6::${n}`, `v6-${n}@example.com`)).status).toBe(200);
    expect((await askLink(h, "2001:db8:5:6:ffff::1", "v6-4@example.com")).status).toBe(429);
    expect((await askLink(h, "203.0.113.11", "stranger4@example.com")).status).toBe(200);
    // A refused request is never mailed.
    expect(h.mailer.sent.some((m) => m.to === "v6-4@example.com")).toBe(false);
  });

  it("limits the accounts one client makes in an hour for people nobody let in, never one someone invited or one that exists", async () => {
    const from = "203.0.113.20";
    for (const [i, who] of ["new1@example.com", "new2@example.com", "new3@example.com"].entries()) expect((await askLink(h, `198.51.100.${i + 1}`, who)).status).toBe(200);
    expect(await followLink(h, "new1@example.com", from)).toBe("/");
    expect(await followLink(h, "new2@example.com", from)).toBe("/");
    expect(await followLink(h, "new3@example.com", from)).toBe("/signin?error=too_many_accounts");
    // Another client still makes one.
    expect((await askLink(h, "198.51.100.99", "new3@example.com")).status).toBe(200);
    expect(await followLink(h, "new3@example.com", "203.0.113.21")).toBe("/");
    // An address with an account signs in again from the same client, and so does one someone let in.
    expect((await askLink(h, "198.51.100.98", "new1@example.com")).status).toBe(200);
    expect(await followLink(h, "new1@example.com", from)).toBe("/");
    expect((await askLink(h, "198.51.100.97", "vouched@example.com")).status).toBe(200);
    expect(await followLink(h, "vouched@example.com", from)).toBe("/");
  });

  it("limits a client's requests to join the waitlist, after the hidden field and the bot check", async () => {
    const join = edge(h, "203.0.113.30");
    expect((await join("/api/v1/interest", { email: "w1@example.com" })).status).toBe(200);
    expect((await join("/api/v1/interest", { email: "w2@example.com" })).status).toBe(200);
    const refused = await join("/api/v1/interest", { email: "w3@example.com" });
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { details: { abuse_limit: string; limit: number } } }).error.details).toMatchObject({ abuse_limit: "waitlist_per_address", limit: 2 });
    // A bot that fills in the hidden field is thanked as before, and counts for nothing.
    expect((await join("/api/v1/interest", { email: "bot@example.com", website: "https://spam.example.com" })).status).toBe(200);
    expect((await edge(h, "203.0.113.31")("/api/v1/interest", { email: "w3@example.com" })).status).toBe(200);
    const rows = await h.db.selectFrom("interest").select("email").execute();
    expect(rows.map((r) => r.email).sort()).toEqual(["w1@example.com", "w2@example.com", "w3@example.com"]);
  });

  it("limits the agents one client registers in an hour", async () => {
    const register = (from: string) => edge(h, from)("/oauth/register", { client_name: "flood", redirect_uris: ["http://127.0.0.1:9/cb"] });
    expect((await register("203.0.113.40")).status).toBe(201);
    expect((await register("203.0.113.40")).status).toBe(201);
    const refused = await register("203.0.113.40");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await register("203.0.113.41")).status).toBe(201);
  });

  it("keeps no client's address in the database, only keyed hashes", async () => {
    const rows = await h.db.selectFrom("abuse_counters").select(["name", "subject"]).execute();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.subject).not.toMatch(/203\.0\.113|2001:db8|198\.51/);
  });
});

describe("without the edge key", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ signupAllowlist: null, abuseLimits: limits({ sign_in_links_per_address: 1, mail_per_hour: 4, new_accounts_per_hour: 1 }) });
  });
  afterAll(async () => h?.close());

  const ask = async (email: string, from = "203.0.113.50") => {
    const res = await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", [CLIENT_ADDRESS_HEADER]: from }, body: JSON.stringify({ email }) });
    return { status: res.status, body: (await res.json()) as { error?: { details?: { abuse_limit?: string } } } };
  };

  it("trusts no client address a request names, and counts only the deployment's ceilings", async () => {
    // The per-client limit of 1 would refuse the second; a forged address counts for nothing.
    expect((await ask("one@example.com")).status).toBe(200);
    expect((await ask("two@example.com")).status).toBe(200);
  });

  it("stops sending sign-in links at the deployment's mail for the hour, alike for every address", async () => {
    expect((await ask("three@example.com")).status).toBe(200);
    // Taken by a link that is never sent too, so the answer never says whether an address may sign in.
    expect((await ask("four@example.com")).status).toBe(200);
    const refused = await ask("five@example.com");
    expect(refused.status).toBe(429);
    expect(refused.body.error?.details?.abuse_limit).toBe("mail_per_hour");
  });

  it("makes no more new accounts than the deployment's ceiling for the hour", async () => {
    expect(await followLink(h, "four@example.com")).toBe("/");
    // The ceiling of 1 is used: the next new account waits for the next hour.
    expect(await followLink(h, "three@example.com")).toBe("/signin?error=too_many_accounts");
  });

  it("are pruned by the worker two days after their window began", async () => {
    await sql`insert into abuse_counters (name, subject, starts_at, n) values ('mail_per_hour', '', now() - interval '3 days', 9)`.execute(h.db);
    await pruneAbuseCounters(h.db);
    const old = await h.db.selectFrom("abuse_counters").select("n").where("starts_at", "<", new Date(Date.now() - 2 * 86_400_000).toISOString()).execute();
    expect(old).toEqual([]);
    expect((await h.db.selectFrom("abuse_counters").select("n").execute()).length).toBeGreaterThan(0);
  });
});

describe("invitations", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ abuseLimits: limits({ invitations_per_organization: 3, mail_per_hour: 4 }) });
    h.acceptsInvitations = false;
  });
  afterAll(async () => h?.close());

  it("an organization makes only so many in a day, all or nothing, and a role given at once is not one", async () => {
    const owner = await h.signIn("inviter@example.com", "Ines Inviter");
    const tenant = (await owner.api("POST", "/api/v1/tenants", { name: "Flood Test" })).body.tenant.slug as string;
    const invite = (email: string) => owner.api("POST", `/api/v1/tenants/${tenant}/members`, { email, role: "member" });
    expect((await invite("i1@example.com")).status).toBe(201);
    // Two more would pass the day's three: nothing is made, and the refusal names the address.
    const many = await owner.api("POST", `/api/v1/tenants/${tenant}/members/many`, { people: [{ email: "i2@example.com", role: "member" }, { email: "i3@example.com", role: "member" }, { email: "i4@example.com", role: "member" }] });
    expect(many.status).toBe(429);
    expect(many.body.error.code).toBe("rate_limited");
    expect(many.body.error.message).toContain("i4@example.com");
    expect(many.body.error.message).toContain("Nothing was changed");
    expect(await h.db.selectFrom("invitations").select("email").where("email", "in", ["i2@example.com", "i3@example.com"]).execute()).toEqual([]);
    expect((await invite("i2@example.com")).status).toBe(201);
    expect((await invite("i3@example.com")).status).toBe(201);
    const refused = await invite("i4@example.com");
    expect(refused.status).toBe(429);
    expect(refused.body.error.details).toMatchObject({ abuse_limit: "invitations_per_organization", limit: 3, per: "day" });
    expect(refused.body.error.message).toMatch(/midnight UTC/);
    // Another organization has its own day.
    const other = (await owner.api("POST", "/api/v1/tenants", { name: "Another" })).body.tenant.slug as string;
    expect((await owner.api("POST", `/api/v1/tenants/${other}/members`, { email: "i4@example.com", role: "member" })).status).toBe(201);
    // The limit is shown among the deployment's.
    const l = await owner.api("GET", `/api/v1/tenants/${tenant}/limits`);
    expect(l.body.deployment_limits).toContainEqual({ key: "invitations_per_day", label: "Invitations one organization makes", value: 3, unit: "a day", set_by: "WHATBUILD_ABUSE_LIMITS" });
  });

  it("past the deployment's mail for the hour, an invitation is made with its link and not emailed", async () => {
    const owner = await h.signIn("mailer@example.com", "Mo Mailer");
    const tenant = (await owner.api("POST", "/api/v1/tenants", { name: "Mail Test" })).body.tenant.slug as string;
    // Four invitations above were emailed: the hour's mail is used.
    const before = h.mailer.sent.length;
    const r = await owner.api("POST", `/api/v1/tenants/${tenant}/members`, { email: "late@example.com", role: "member" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ invited: true, emailed: false });
    expect(r.body.invite_link).toMatch(/\/invite\//);
    const many = await owner.api("POST", `/api/v1/tenants/${tenant}/members/many`, { people: [{ email: "later@example.com", role: "member" }] });
    expect(many.body.results[0]).toMatchObject({ invited: true, emailed: false });
    expect(h.mailer.sent.length).toBe(before);
  });
});

/**
 * Cloudflare's siteverify as its documentation describes it, for the server to ask instead: the
 * test secret keys pass, fail, or say the token was spent, whatever the token; any other secret is
 * a deployment's own, whose tokens here say what they were made for ("good:<action>:<host>") and are
 * redeemed once.
 */
function standInSiteverify(): Promise<{ url: string; asked: URLSearchParams[]; close(): Promise<void>; down(on: boolean): void }> {
  const asked: URLSearchParams[] = [];
  const spent = new Set<string>();
  let isDown = false;
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (isDown) return void res.writeHead(502).end();
        const form = new URLSearchParams(raw);
        asked.push(form);
        const secret = form.get("secret") ?? "";
        const token = form.get("response") ?? "";
        const answer = (body: object) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
        if (secret === "1x0000000000000000000000000000000AA") return answer({ success: true, hostname: "example.com", "error-codes": [], metadata: { result_with_testing_key: true } });
        if (secret === "2x0000000000000000000000000000000AA") return answer({ success: false, "error-codes": ["invalid-input-response"] });
        if (secret === "3x0000000000000000000000000000000AA") return answer({ success: false, "error-codes": ["timeout-or-duplicate"] });
        const [kind, action, hostname] = token.split(":");
        if (kind !== "good") return answer({ success: false, "error-codes": ["invalid-input-response"] });
        if (spent.has(token)) return answer({ success: false, "error-codes": ["timeout-or-duplicate"] });
        spent.add(token);
        answer({ success: true, action, hostname, "error-codes": [] });
      });
    });
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/turnstile/v0/siteverify`, asked, close: () => new Promise((r) => server.close(() => r())), down: (on) => (isDown = on) });
    });
  });
}

describe("the bot check", () => {
  let verify: Awaited<ReturnType<typeof standInSiteverify>>;
  beforeAll(async () => {
    verify = await standInSiteverify();
  });
  afterAll(async () => verify?.close());

  const withKeys = (secret: string, extra = {}) =>
    startHarness({ turnstileSiteKey: "1x00000000000000000000AA", turnstileSecretKey: secret, turnstileVerifyUrl: verify.url, googleClientId: "google-client", googleClientSecret: "google-secret", ...extra });
  const post = (h: Harness, path: string, body: object) => fetch(`${h.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const DUMMY = "XXXX.DUMMY.TOKEN.XXXX";

  it("is off without keys: no page carries it and no form asks for a token", async () => {
    const h = await startHarness({ googleClientId: "google-client", googleClientSecret: "google-secret" });
    try {
      expect(((await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { bot_check: unknown }).bot_check).toBeNull();
      expect(((await (await fetch(`${h.baseUrl}/api/v1/plans`)).json()) as { bot_check: unknown }).bot_check).toBeNull();
      expect((await post(h, "/auth/email", { email: "a@example.com" })).status).toBe(200);
      expect((await post(h, "/api/v1/interest", { email: "a@example.com" })).status).toBe(200);
      expect((await fetch(`${h.baseUrl}/auth/google?next=/`, { redirect: "manual" })).headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
    } finally {
      await h.close();
    }
  });

  it("with Cloudflare's always-passing test keys, gives pages the site key and lets a request with a token through", async () => {
    const h = await withKeys("1x0000000000000000000000000000000AA");
    try {
      expect(((await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { bot_check: unknown }).bot_check).toEqual({ site_key: "1x00000000000000000000AA" });
      expect(((await (await fetch(`${h.baseUrl}/api/v1/plans`)).json()) as { bot_check: unknown }).bot_check).toEqual({ site_key: "1x00000000000000000000AA" });
      // Without a token, refused before anything is counted or sent.
      for (const path of ["/auth/email", "/api/v1/interest"]) {
        const res = await post(h, path, { email: "b@example.com" });
        expect([path, res.status]).toEqual([path, 403]);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bot_check_failed");
      }
      expect(h.mailer.sent).toEqual([]);
      expect(await h.db.selectFrom("interest").select("email").execute()).toEqual([]);
      expect((await post(h, "/auth/email", { email: "b@example.com", bot_check: DUMMY })).status).toBe(200);
      expect((await post(h, "/api/v1/interest", { email: "b@example.com", bot_check: DUMMY })).status).toBe(200);
      expect(verify.asked.at(-1)?.get("response")).toBe(DUMMY);
      // Starting Google sign-in without one goes back to the sign-in page, keeping where it was going.
      expect((await fetch(`${h.baseUrl}/auth/google?next=/t/acme`, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=bot_check&next=%2Ft%2Facme");
      expect((await fetch(`${h.baseUrl}/auth/google?next=/&bot_check=${DUMMY}`, { redirect: "manual" })).headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
    } finally {
      await h.close();
    }
  });

  it("with the test keys that always fail or say the token was spent, lets nothing through", async () => {
    for (const secret of ["2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
      const h = await withKeys(secret);
      try {
        expect((await post(h, "/auth/email", { email: "c@example.com", bot_check: DUMMY })).status).toBe(403);
        expect((await post(h, "/api/v1/interest", { email: "c@example.com", bot_check: DUMMY })).status).toBe(403);
        expect((await fetch(`${h.baseUrl}/auth/google?next=/&bot_check=${DUMMY}`, { redirect: "manual" })).headers.get("location")).toMatch(/^\/signin\?error=bot_check/);
      } finally {
        await h.close();
      }
    }
  });

  it("with a deployment's own keys, takes a token only for its own form and host, and only once", async () => {
    const h = await withKeys("a-deployments-own-secret", { siteUrl: "https://site.example.com" });
    try {
      const host = new URL(h.baseUrl).hostname;
      expect((await post(h, "/auth/email", { email: "d@example.com", bot_check: `good:sign_in:${host}` })).status).toBe(200);
      // The same token again, a token for the other form, and one made on another site.
      expect((await post(h, "/auth/email", { email: "d@example.com", bot_check: `good:sign_in:${host}` })).status).toBe(403);
      expect((await post(h, "/auth/email", { email: "d@example.com", bot_check: `good:waitlist:${host}` })).status).toBe(403);
      expect((await post(h, "/auth/email", { email: "d@example.com", bot_check: "good:sign_in:elsewhere.example.net" })).status).toBe(403);
      // The waitlist's form is on the public site.
      expect((await post(h, "/api/v1/interest", { email: "d@example.com", bot_check: "good:waitlist:site.example.com" })).status).toBe(200);
      expect((await post(h, "/api/v1/interest", { email: "e@example.com", bot_check: "good:sign_in:site.example.com" })).status).toBe(403);
      // A token the server never asks about: too long.
      expect((await post(h, "/api/v1/interest", { email: "e@example.com", bot_check: "x".repeat(3000) })).status).toBe(403);
    } finally {
      await h.close();
    }
  });

  it("refuses while Cloudflare cannot be asked, rather than let a script through", async () => {
    const h = await withKeys("1x0000000000000000000000000000000AA");
    verify.down(true);
    try {
      expect((await post(h, "/auth/email", { email: "f@example.com", bot_check: DUMMY })).status).toBe(403);
    } finally {
      verify.down(false);
      await h.close();
    }
  });

  it("passes the client's address to Cloudflare where the service knows it", async () => {
    const h = await withKeys("1x0000000000000000000000000000000AA", { edgeKey: KEY });
    try {
      expect((await edge(h, "203.0.113.60")("/auth/email", { email: "g@example.com", bot_check: DUMMY })).status).toBe(200);
      expect(verify.asked.at(-1)?.get("remoteip")).toBe("203.0.113.60");
    } finally {
      await h.close();
    }
  });
});
