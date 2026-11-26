import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abuseLimitsFrom, DEFAULT_ABUSE_LIMITS, listenToAbuseLog, pruneAbuseCounters, type AbuseLimits } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CLIENT_ADDRESS_HEADER, CLIENT_SEAL_HEADER, clientKeys, clientOf, ipv6BlockOf, namedBy } from "../src/client-address.ts";
import { loadConfig } from "../src/config.ts";
import { EDGE_KEY_HEADER } from "../src/edge-key.ts";
import { startHarness, type Harness } from "./harness.ts";

const KEY = "an-edge-key-of-at-least-32-random-characters";

/** Limits small enough to reach in a test, the rest as a deployment gets them. */
const limits = (set: Partial<AbuseLimits>): AbuseLimits => ({ ...DEFAULT_ABUSE_LIMITS, ...set });

/**
 * The windows start at the top of each hour (and each UTC day), so a test that fills one over
 * several requests would find it empty again if the hour turned halfway: each group of them starts
 * with a minute left in the hour at least, waiting for the next when there is less.
 */
async function roomInTheHour(): Promise<void> {
  const left = 3_600_000 - (Date.now() % 3_600_000);
  if (left < 60_000) await new Promise((r) => setTimeout(r, left + 500));
}
/** How long `roomInTheHour` may take, as a hook's timeout. */
const AT_MOST_A_MINUTE = 75_000;

/** A request as the Cloudflare Worker passes it on: with the edge key, from `from`. */
function edge(h: Harness, from: string | null) {
  return (path: string, body?: unknown, init: RequestInit = {}) =>
    fetch(`${h.baseUrl}${path}`, {
      redirect: "manual",
      method: body === undefined ? "GET" : "POST",
      ...init,
      headers: {
        [EDGE_KEY_HEADER]: KEY,
        ...(from ? namedBy(KEY, from) : {}),
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
    for (const bad of ["mail_per_hour=0", "mail_per_hour=-3", "mail_per_hour=1.5", "mail_per_hour=", "mail_per_hour", "mail_per_hour=50=junk", "mail_per_hour=2147483648"])
      expect(() => abuseLimitsFrom(bad), bad).toThrow(/whole number/);
    expect(abuseLimitsFrom("mail_per_hour=2147483647").mail_per_hour).toBe(2147483647);
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
    // A test site key's widget hands out a dummy token a real secret key refuses: nobody new could sign in.
    for (const site of ["1x00000000000000000000AA", "2x00000000000000000000AB", "1x00000000000000000000BB", "3x00000000000000000000FF"])
      expect(() => loadConfig({ ...production, WHATBUILD_TURNSTILE_SITE_KEY: site, WHATBUILD_TURNSTILE_SECRET_KEY: "0x4AAAAAAAexample-secret" }), site).toThrow(/test keys/);
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

  it("counts an IPv6 address by its /48 too, and an IPv4 address by nothing more", () => {
    expect(ipv6BlockOf("2001:db8:1:2::5")).toBe("2001:db8:1::/48");
    expect(ipv6BlockOf("2001:db8:1:ffff:1::5")).toBe("2001:db8:1::/48");
    expect(ipv6BlockOf("203.0.113.7")).toBeNull();
    expect(ipv6BlockOf("::ffff:198.51.100.4")).toBeNull();
  });

  it("is kept as keyed hashes that name no address, the same for every address in one /64, and for every /64 in one /48", () => {
    const a = clientKeys("2001:db8:1:2::5", "grant key one")!;
    expect(a).toEqual(clientKeys("2001:db8:1:2:aaaa::1", "grant key one"));
    const sibling = clientKeys("2001:db8:1:3::5", "grant key one")!;
    expect(sibling.address).not.toBe(a.address);
    expect(sibling.ipv6_48).toBe(a.ipv6_48);
    expect(clientKeys("2001:db8:2:2::5", "grant key one")!.ipv6_48).not.toBe(a.ipv6_48);
    expect(clientKeys("2001:db8:1:2::5", "grant key two")!.address).not.toBe(a.address);
    expect(a.address).not.toContain("2001");
    expect(clientKeys("203.0.113.7", "grant key one")!.ipv6_48).toBeNull();
    expect(clientKeys(null, "grant key one")).toBeNull();
  });
});

describe("behind the Worker, with the edge key", () => {
  let h: Harness;
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
  beforeAll(async () => {
    h = await startHarness({
      edgeKey: KEY,
      // Anyone may make an account, as when sign-up is open.
      signupAllowlist: null,
      instanceOwners: ["vouched@example.com"],
      abuseLimits: limits({ sign_in_links_per_address: 3, sign_in_links_per_ipv6_48: 5, new_accounts_per_address: 2, waitlist_per_address: 2, agent_registrations_per_address: 2, agent_registrations_per_ipv6_48: 3 }),
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
    // Refused for its network, which trying from another lifts, unlike the deployment's ceiling.
    expect(await followLink(h, "new3@example.com", from)).toBe("/signin?error=too_many_accounts_from_network");
    // The link is given back: pressed again from another client, it makes the account.
    expect(await followLink(h, "new3@example.com", "203.0.113.21")).toBe("/");
    // An address with an account signs in again from the same client, and so does one someone let in.
    expect((await askLink(h, "198.51.100.98", "new1@example.com")).status).toBe(200);
    expect(await followLink(h, "new1@example.com", from)).toBe("/");
    expect((await askLink(h, "198.51.100.97", "vouched@example.com")).status).toBe(200);
    expect(await followLink(h, "vouched@example.com", from)).toBe("/");
    // A stranger from that client is still refused.
    expect((await askLink(h, "198.51.100.95", "new4@example.com")).status).toBe(200);
    expect(await followLink(h, "new4@example.com", from)).toBe("/signin?error=too_many_accounts_from_network");
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

  it("counts the /64s of one IPv6 /48 together too, so one person's range is not thousands of clients", async () => {
    // Five links a /48: two from each of two /64s, then one from a third, then that /48 is used.
    for (const [i, net] of ["1", "1", "2", "2", "3"].entries()) expect((await askLink(h, `2001:db8:77:${net}::1`, `range-${i}@example.com`)).status).toBe(200);
    expect(await askLink(h, "2001:db8:77:3::2", "range-5@example.com")).toMatchObject({ status: 429, limit: "sign_in_links_per_ipv6_48" });
    // A /64 of it never used before is refused all the same, and the refusal takes nothing from it.
    expect(await askLink(h, "2001:db8:77:ab:cd::9", "range-6@example.com")).toMatchObject({ status: 429, limit: "sign_in_links_per_ipv6_48" });
    const fresh = clientKeys("2001:db8:77:ab::1", h.config.grantKey)!.address;
    expect(await h.db.selectFrom("abuse_counters").select("n").where("subject", "=", fresh).execute()).toEqual([]);
    // Another /48, and an IPv4 address, are their own.
    expect((await askLink(h, "2001:db8:78:1::1", "range-7@example.com")).status).toBe(200);
    expect((await askLink(h, "203.0.113.77", "range-8@example.com")).status).toBe(200);
  });

  it("takes nothing from an address's own count for a registration its /48 refused", async () => {
    const register = (from: string) => edge(h, from)("/oauth/register", { client_name: "range", redirect_uris: ["http://127.0.0.1:9/cb"] });
    expect((await register("2001:db8:99:1::1")).status).toBe(201);
    expect((await register("2001:db8:99:1::2")).status).toBe(201);
    expect((await register("2001:db8:99:2::1")).status).toBe(201);
    // The /48's three are used: refused, and the /64 keeps the one it had.
    const refused = await register("2001:db8:99:2::1");
    expect(refused.status).toBe(429);
    const mine = clientKeys("2001:db8:99:2::1", h.config.grantKey)!.address;
    expect((await h.db.selectFrom("abuse_counters").select("n").where("name", "=", "agent_registrations_per_address").where("subject", "=", mine).execute()).map((r) => r.n)).toEqual([1]);
  });

  it("lets no more through than a limit when a client's requests arrive together", async () => {
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => askLink(h, "203.0.113.250", `burst-${i}@example.com`)));
    expect(burst.filter((r) => r.status === 200)).toHaveLength(3);
    expect(burst.filter((r) => r.status === 429).every((r) => r.limit === "sign_in_links_per_address")).toBe(true);
    // Agent registrations from one client too, under the advisory lock and the conditional count alike.
    const registered = await Promise.all(Array.from({ length: 10 }, () => edge(h, "203.0.113.251")("/oauth/register", { client_name: "burst", redirect_uris: ["http://127.0.0.1:9/cb"] })));
    expect(registered.map((r) => r.status).sort()).toEqual([201, 201, ...Array(8).fill(429)]);
  });

  it("keeps no client's address in the database, only keyed hashes", async () => {
    const rows = await h.db.selectFrom("abuse_counters").select(["name", "subject"]).execute();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.subject).not.toMatch(/203\.0\.113|2001:db8|198\.51/);
  });
});

describe("behind a Cloudflare Worker older than the service", () => {
  let h: Harness;
  const errors: string[] = [];
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
  beforeAll(async () => {
    h = await startHarness({ edgeKey: KEY, signupAllowlist: null, abuseLimits: limits({ sign_in_links_per_address: 1 }) });
  });
  afterAll(async () => h?.close());
  afterEach(() => vi.restoreAllMocks());

  it("trusts no address it did not seal, says once that the limits per client are off, and counts only the ceilings", async () => {
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(String(line)));
    // An old Worker sends the edge key and passes on whatever a client made up, with no seal or a guessed one.
    const made = (address: string, seal?: string) =>
      edge(h, null)("/auth/email", { email: `x${address}@example.com` }, { headers: { [CLIENT_ADDRESS_HEADER]: address, ...(seal ? { [CLIENT_SEAL_HEADER]: seal } : {}) } });
    for (const address of ["203.0.113.90", "203.0.113.90", "203.0.113.90"]) expect((await made(address)).status).toBe(200);
    expect((await made("203.0.113.91", namedBy("another key of at least thirty-two characters", "203.0.113.91")[CLIENT_SEAL_HEADER])).status).toBe(200);
    expect((await edge(h, null)("/auth/email", { email: "nobody-named@example.com" })).status).toBe(200);
    const said = errors.filter((l) => l.includes("client_address_missing"));
    expect(said).toHaveLength(1);
    expect(JSON.parse(said[0]!)).toMatchObject({ severity: "ERROR", event: "client_address_missing", path: "/auth/email" });
    expect(said[0]).not.toContain("203.0.113");
    expect(await h.db.selectFrom("abuse_counters").select("name").where("name", "=", "sign_in_links_per_address").execute()).toEqual([]);
    // The Worker of this release seals it, and the limit counts again.
    expect((await askLink(h, "203.0.113.92", "sealed-1@example.com")).status).toBe(200);
    expect((await askLink(h, "203.0.113.92", "sealed-2@example.com")).status).toBe(429);
  });
});

describe("agent registrations waiting for a first connection", () => {
  let h: Harness;
  beforeAll(async () => {
    // No edge key: the number kept waiting is the deployment's, whoever registers.
    h = await startHarness({ abuseLimits: limits({ agent_registrations_waiting: 5 }) });
  });
  afterAll(async () => h?.close());

  const register = (name: string) => fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: ["https://agent.example/cb"] }) });
  const waitingNow = async () =>
    (
      await sql<{ client_id: string; client_name: string }>`select client_id, client_name from oauth_clients c where not exists (select 1 from oauth_tokens t where t.client_id = c.client_id) and not exists (select 1 from oauth_codes o where o.client_id = c.client_id) order by created_at`.execute(h.db)
    ).rows;

  const heard: Record<string, unknown>[] = [];
  let deaf = () => {};
  beforeAll(() => {
    deaf = listenToAbuseLog((line) => heard.push(line));
  });
  afterAll(() => deaf());

  it("are kept to the deployment's number: past it the oldest is forgotten, never one that connected, and nobody is refused", async () => {
    const real = (await (await register("Connected agent")).json()) as { client_id: string };
    await h.signIn("agent-owner@example.com");
    const accountId = (await h.db.selectFrom("accounts").select("account_id").where("email", "=", "agent-owner@example.com").executeTakeFirstOrThrow()).account_id;
    await h.db
      .insertInto("oauth_tokens")
      .values({ token_hash: "real-token", kind: "access", client_id: real.client_id, account_id: accountId, resource: `${h.baseUrl}/mcp`, scope: "whatbuild", family_id: "real", expires_at: new Date(Date.now() + 3600_000).toISOString() })
      .execute();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await register(`flood ${i}`)).status);
    expect(statuses).toEqual(Array(12).fill(201));
    expect((await waitingNow()).map((r) => r.client_name)).toEqual(["flood 7", "flood 8", "flood 9", "flood 10", "flood 11"]);
    expect(await h.db.selectFrom("oauth_clients").select("client_id").where("client_id", "=", real.client_id).execute()).toHaveLength(1);
  });

  it("stay at that number under a burst, each registration answered", async () => {
    const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => register(`burst ${i}`)));
    expect(answers.map((r) => r.status)).toEqual(Array(40).fill(201));
    expect(await waitingNow()).toHaveLength(5);
  });

  it("say once an hour, for the alert, that registrations under an hour old are being forgotten", async () => {
    expect(heard.filter((l) => l["event"] === "abuse_ceiling_reached")).toEqual([expect.objectContaining({ limit: "agent_registrations_waiting", value: 5 })]);
  });

  it("let an agent that registers during a flood go on to sign its person in", async () => {
    const mine = (await (await register("A real agent")).json()) as { client_id: string };
    const res = await fetch(`${h.baseUrl}/oauth/authorize?client_id=${mine.client_id}&redirect_uri=${encodeURIComponent("https://agent.example/cb")}&response_type=code&code_challenge=x&code_challenge_method=S256`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/signin\?next=/);
  });
});

describe("a sign-in link for an address that may not sign in", () => {
  let h: Harness;
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
  beforeAll(async () => {
    h = await startHarness({ edgeKey: KEY, signupAllowlist: ["team-a@example.com", "team-b@example.com", "team-c@example.com", "team-d@example.com"], abuseLimits: limits({ sign_in_links_per_address: 2, mail_per_hour: 3 }) });
  });
  afterAll(async () => h?.close());

  it("is counted against the client as one that is mailed, so the client's limit never says who may sign in", async () => {
    expect((await askLink(h, "203.0.113.120", "team-a@example.com")).status).toBe(200);
    expect((await askLink(h, "203.0.113.120", "unlisted-1@example.com")).status).toBe(200);
    // The second was never mailed, and still took the client's second link.
    expect(await askLink(h, "203.0.113.120", "unlisted-2@example.com")).toMatchObject({ status: 429, limit: "sign_in_links_per_address" });
    expect(await askLink(h, "203.0.113.120", "team-b@example.com")).toMatchObject({ status: 429, limit: "sign_in_links_per_address" });
  });

  it("is never counted against the hour's mail, which counts what is mailed, and once that is used every address is refused alike", async () => {
    // Links nobody mails, from many clients, take nothing from the hour's three.
    for (const n of [3, 4, 5, 6]) expect((await askLink(h, `203.0.113.${120 + n}`, `unlisted-${n}@example.com`)).status).toBe(200);
    expect((await askLink(h, "203.0.113.130", "team-b@example.com")).status).toBe(200);
    expect((await askLink(h, "203.0.113.131", "team-c@example.com")).status).toBe(200);
    // The hour's mail is used (a@, b@, c@): an address that would be mailed and one that would not get the same refusal.
    expect(await askLink(h, "203.0.113.132", "team-d@example.com")).toMatchObject({ status: 429, limit: "mail_per_hour" });
    expect(await askLink(h, "203.0.113.133", "unlisted-7@example.com")).toMatchObject({ status: 429, limit: "mail_per_hour" });
    await expect.poll(() => h.mailer.sent.length).toBe(3);
    expect(h.mailer.sent.map((m) => m.to).sort()).toEqual(["team-a@example.com", "team-b@example.com", "team-c@example.com"]);
  });
});

describe("without the edge key", () => {
  let h: Harness;
  const heard: Record<string, unknown>[] = [];
  let deaf = () => {};
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
  beforeAll(async () => {
    h = await startHarness({ signupAllowlist: null, abuseLimits: limits({ sign_in_links_per_address: 1, mail_per_hour: 4, new_accounts_per_hour: 1 }) });
    deaf = listenToAbuseLog((line) => heard.push(line));
  });
  afterAll(async () => {
    deaf();
    await h?.close();
  });

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
    // Sign-up is open here, so every link is mailed; one that is never sent is counted alike too
    // ("a sign-in link for an address that may not sign in", below).
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

  it("logs each ceiling once, as it fills, for the alert, naming no address", async () => {
    const filled = heard.filter((l) => l["event"] === "abuse_ceiling_reached");
    expect(filled.map((l) => [l["limit"], l["value"], l["window"]])).toEqual([
      ["mail_per_hour", 4, "hour"],
      ["new_accounts_per_hour", 1, "hour"],
    ]);
    for (const l of filled) expect(JSON.stringify(l)).not.toMatch(/@|203\.0\.113/);
  });

  it("are pruned by the worker two days after their window began", async () => {
    await sql`insert into abuse_counters (name, subject, starts_at, n) values ('mail_per_hour', '', now() - interval '3 days', 9)`.execute(h.db);
    await pruneAbuseCounters(h.db);
    const old = await h.db.selectFrom("abuse_counters").select("n").where("starts_at", "<", new Date(Date.now() - 2 * 86_400_000).toISOString()).execute();
    expect(old).toEqual([]);
    expect((await h.db.selectFrom("abuse_counters").select("n").execute()).length).toBeGreaterThan(0);
  });
});

describe("new accounts for people nobody let in, whichever way they sign in", () => {
  let h: Harness;
  /** The claims the stand-in for Google's token endpoint puts in the next ID token. */
  let claims: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  const idToken = (payload: Record<string, unknown>) => `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.`;
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
  beforeAll(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: idToken(claims) });
      return realFetch(input, init);
    });
    h = await startHarness({ signupAllowlist: null, googleClientId: "google-client", googleClientSecret: "google-secret", abuseLimits: limits({ new_accounts_per_hour: 2 }) });
  });
  afterAll(async () => {
    await h?.close();
    vi.restoreAllMocks();
  });

  /** Sign in with Google as `email`, as its consent screen would send the browser back; where it ends. */
  const withGoogle = async (email: string) => {
    claims = { aud: "google-client", email, email_verified: true, name: "Someone" };
    const start = await fetch(`${h.baseUrl}/auth/google?next=/`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0]!;
    return (await fetch(`${h.baseUrl}/auth/google/callback?code=c&state=${state}`, { redirect: "manual", headers: { cookie } })).headers.get("location");
  };

  it("are counted alike from Google and a sign-in link, and never for an address with an invitation waiting", async () => {
    expect(await withGoogle("g-new-1@example.com")).toBe("/");
    expect((await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "link-new@example.com" }) })).status).toBe(200);
    expect(await followLink(h, "link-new@example.com")).toBe("/");
    // The hour's two are made.
    expect(await withGoogle("g-new-2@example.com")).toBe("/signin?error=too_many_accounts");
    expect(await withGoogle("g-new-1@example.com")).toBe("/");
    const inviter = await h.signIn("inviter-g@example.com", "Ingrid Inviter");
    const org = (await inviter.api("POST", "/api/v1/tenants", { name: "Google Invites" })).body.tenant.slug as string;
    expect((await inviter.api("POST", `/api/v1/tenants/${org}/members`, { email: "g-invited@example.com", role: "member" })).status).toBe(201);
    expect(await withGoogle("g-invited@example.com")).toBe("/");
  });
});

describe("a deployment's ceiling under a burst", () => {
  let h: Harness;
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
  beforeAll(async () => {
    h = await startHarness({ abuseLimits: limits({ waitlist_per_hour: 5 }) });
  });
  afterAll(async () => h?.close());

  it("lets exactly its number through when requests from everywhere arrive together", async () => {
    const answers = await Promise.all(
      Array.from({ length: 30 }, (_, i) => fetch(`${h.baseUrl}/api/v1/interest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `together-${i}@example.com` }) })),
    );
    expect(answers.map((r) => r.status).sort()).toEqual([...Array(5).fill(200), ...Array(25).fill(429)]);
    expect(await h.db.selectFrom("interest").select("email").execute()).toHaveLength(5);
    expect((await h.db.selectFrom("abuse_counters").select("n").where("name", "=", "waitlist_per_hour").execute()).map((r) => r.n)).toEqual([5]);
  });
});

describe("invitations", () => {
  let h: Harness;
  beforeAll(roomInTheHour, AT_MOST_A_MINUTE);
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
    // It says how many the organization can still make today: the two before i4.
    expect(many.body.error.details).toMatchObject({ abuse_limit: "invitations_per_organization", room_for: 2, email: "i4@example.com" });
    expect(many.body.error.message).toContain("can make 2 more invitations today");
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
    expect(l.body.deployment_limits).toContainEqual({ key: "invitations_per_organization", label: "Invitations one organization makes", value: 3, unit: "a day", set_by: "WHATBUILD_ABUSE_LIMITS" });
  });

  it("a role given at once, to someone already in the organization, is not one", async () => {
    const owner = await h.signIn("roles@example.com", "Rae Roles");
    const tenant = (await owner.api("POST", "/api/v1/tenants", { name: "Roles Test" })).body.tenant.slug as string;
    const members = `/api/v1/tenants/${tenant}/members`;
    // Someone brought in by the organization's first invitation, accepted.
    await h.signIn("member@example.com", "Mel Member");
    h.acceptsInvitations = true;
    try {
      expect((await owner.api("POST", members, { email: "member@example.com", role: "member" })).status).toBe(201);
    } finally {
      h.acceptsInvitations = false;
    }
    expect((await owner.api("POST", members, { email: "r2@example.com", role: "member" })).status).toBe(201);
    expect((await owner.api("POST", members, { email: "r3@example.com", role: "member" })).status).toBe(201);
    expect((await owner.api("POST", members, { email: "r4@example.com", role: "member" })).status).toBe(429);
    // The day's three are made; roles for the one already in it still go, alone and in a batch.
    const one = await owner.api("POST", members, { email: "member@example.com", role: "admin" });
    expect(one.status, JSON.stringify(one.body)).toBeLessThan(300);
    expect(one.body.invited).toBeFalsy();
    const many = await owner.api("POST", `${members}/many`, { people: [{ email: "member@example.com", role: "creator" }] });
    expect(many.status, JSON.stringify(many.body)).toBeLessThan(300);
    expect(many.body.results[0].invited).toBeFalsy();
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

describe("invitation mail", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ signupAllowlist: null });
    h.acceptsInvitations = false;
  });
  afterAll(async () => h?.close());

  it("goes out after the call commits, so no sign-in link waits for an organization's invitations to reach a slow mail server", async () => {
    const owner = await h.signIn("slow@example.com", "Sam Slow");
    const tenant = (await owner.api("POST", "/api/v1/tenants", { name: "Slow Mail" })).body.tenant.slug as string;
    const send = h.mailer.send.bind(h.mailer);
    let sending!: () => void;
    const started = new Promise<void>((r) => (sending = r));
    // Each invitation takes the mail server a second and a half; sign-in links go as fast as ever.
    h.mailer.send = async (m) => {
      if (m.subject.includes("invited you")) {
        sending();
        await new Promise((r) => setTimeout(r, 1500));
      }
      return send(m);
    };
    try {
      const people = ["slow-1@example.com", "slow-2@example.com", "slow-3@example.com"];
      const many = owner.api("POST", `/api/v1/tenants/${tenant}/members/many`, { people: people.map((email) => ({ email, role: "member" })) });
      await started;
      // Made and committed while their mail is on its way.
      expect(await h.db.selectFrom("invitations").select("email").where("email", "in", people).execute()).toHaveLength(3);
      // More sign-in links at once than the harness has connections, and an organization's limits read.
      const t0 = performance.now();
      const links = await Promise.all(
        Array.from({ length: 8 }, (_, i) => fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `waiting-${i}@example.com` }) })),
      );
      expect(links.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect((await owner.api("GET", `/api/v1/tenants/${tenant}/limits`)).status).toBe(200);
      // Holding the hour's mail while three invitations went out would have kept them for over three seconds.
      expect(performance.now() - t0).toBeLessThan(2000);
      const answer = await many;
      expect(answer.status).toBe(201);
      expect(answer.body.results.map((r: { invited: boolean; emailed?: false }) => [r.invited, r.emailed])).toEqual([
        [true, undefined],
        [true, undefined],
        [true, undefined],
      ]);
      expect(h.mailer.sent.filter((m) => m.subject.includes("invited you")).map((m) => m.to)).toEqual(people);
    } finally {
      h.mailer.send = send;
    }
  });

  it("an invitation whose email could not be sent is made, and says emailed: false", async () => {
    const owner = await h.signIn("broken@example.com", "Bo Broken");
    const tenant = (await owner.api("POST", "/api/v1/tenants", { name: "Broken Mail" })).body.tenant.slug as string;
    const send = h.mailer.send.bind(h.mailer);
    h.mailer.send = async () => Promise.reject(new Error("421 try again later"));
    try {
      const r = await owner.api("POST", `/api/v1/tenants/${tenant}/members`, { email: "unsent@example.com", role: "member" });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ invited: true, emailed: false });
      expect(await h.db.selectFrom("invitations").select("email").where("email", "=", "unsent@example.com").execute()).toHaveLength(1);
    } finally {
      h.mailer.send = send;
    }
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
        if (secret === "a-secret-cloudflare-does-not-know") return answer({ success: false, "error-codes": ["invalid-input-secret"] });
        // "lax:" tokens are redeemed as Cloudflare's network may redeem one used twice close together: not yet.
        if (kind !== "good" && kind !== "lax") return answer({ success: false, "error-codes": ["invalid-input-response"] });
        if (kind === "good" && spent.has(token)) return answer({ success: false, "error-codes": ["timeout-or-duplicate"] });
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

  /** A web build of the app's shell and the site's front page, to read the headers they are served with. */
  const dist = (() => {
    const d = mkdtempSync(join(tmpdir(), "wb-bot-check-"));
    mkdirSync(join(d, "site"));
    writeFileSync(join(d, "index.html"), "<!doctype html><title>WhatBuild</title>");
    writeFileSync(join(d, "site", "index.html"), "<!doctype html><title>The site</title>");
    return d;
  })();
  const providers = { googleClientId: "google-client", googleClientSecret: "google-secret", microsoftTenant: "00000000-0000-4000-8000-000000000001", microsoftClientId: "microsoft-client", microsoftClientSecret: "microsoft-secret", webDist: dist };
  const withKeys = (secret: string, extra = {}) => startHarness({ turnstileSiteKey: "1x00000000000000000000AA", turnstileSecretKey: secret, turnstileVerifyUrl: verify.url, ...providers, ...extra });
  /** The script-src and frame-src a page at `path` is served with. */
  const policy = async (h: Harness, path: string) => {
    const csp = (await fetch(`${h.baseUrl}${path}`)).headers.get("content-security-policy") ?? "";
    return csp.split("; ").filter((d) => /^(script|frame)-src /.test(d));
  };
  const post = (h: Harness, path: string, body: object) => fetch(`${h.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const DUMMY = "XXXX.DUMMY.TOKEN.XXXX";

  it("is off without keys: no page carries it and no form asks for a token", async () => {
    const h = await startHarness(providers);
    try {
      expect(((await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { bot_check: unknown }).bot_check).toBeNull();
      expect(((await (await fetch(`${h.baseUrl}/api/v1/plans`)).json()) as { bot_check: unknown }).bot_check).toBeNull();
      expect((await post(h, "/auth/email", { email: "a@example.com" })).status).toBe(200);
      expect((await post(h, "/api/v1/interest", { email: "a@example.com" })).status).toBe(200);
      expect((await fetch(`${h.baseUrl}/auth/google?next=/`, { redirect: "manual" })).headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect((await fetch(`${h.baseUrl}/auth/microsoft?next=/`, { redirect: "manual" })).headers.get("location")).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
      // Neither the app's pages nor the site's let Cloudflare's script in.
      for (const path of ["/", "/t/acme", "/site/"]) for (const d of await policy(h, path)) expect([path, d]).not.toEqual([path, expect.stringContaining("challenges.cloudflare.com")]);
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
      // No client address is known without the edge key, so none is sent to Cloudflare.
      expect(verify.asked.at(-1)?.has("remoteip")).toBe(false);
      expect((await post(h, "/api/v1/interest", { email: "b@example.com", bot_check: DUMMY })).status).toBe(200);
      expect(verify.asked.at(-1)?.get("response")).toBe(DUMMY);
      // Starting Google sign-in without one goes back to the sign-in page, keeping where it was going.
      expect((await fetch(`${h.baseUrl}/auth/google?next=/t/acme`, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=bot_check&next=%2Ft%2Facme");
      expect((await fetch(`${h.baseUrl}/auth/google?next=/&bot_check=${DUMMY}`, { redirect: "manual" })).headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
      // Microsoft's alike.
      expect((await fetch(`${h.baseUrl}/auth/microsoft?next=/t/acme`, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=bot_check&next=%2Ft%2Facme");
      expect((await fetch(`${h.baseUrl}/auth/microsoft?next=/&bot_check=${DUMMY}`, { redirect: "manual" })).headers.get("location")).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
      // Every page of the app, a single-page app, and the site's pages let the widget's script and frame in.
      for (const path of ["/", "/t/acme", "/site/"])
        expect([path, await policy(h, path)]).toEqual([path, [expect.stringMatching(/^script-src 'self'.* https:\/\/challenges\.cloudflare\.com/), expect.stringMatching(/^frame-src 'self'.* https:\/\/challenges\.cloudflare\.com/)]]);
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
        expect((await fetch(`${h.baseUrl}/auth/microsoft?next=/&bot_check=${DUMMY}`, { redirect: "manual" })).headers.get("location")).toMatch(/^\/signin\?error=bot_check/);
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

  it("takes a token once even while Cloudflare would take it again, a burst of one token included", async () => {
    const h = await withKeys("a-deployments-own-secret");
    try {
      const host = new URL(h.baseUrl).hostname;
      expect((await post(h, "/auth/email", { email: "h@example.com", bot_check: `lax:sign_in:${host}` })).status).toBe(200);
      expect((await post(h, "/auth/email", { email: "h@example.com", bot_check: `lax:sign_in:${host}` })).status).toBe(403);
      const burst = await Promise.all(Array.from({ length: 6 }, () => post(h, "/api/v1/interest", { email: "i@example.com", bot_check: `lax:waitlist:${host}` })));
      expect(burst.map((r) => r.status).sort()).toEqual([200, 403, 403, 403, 403, 403]);
    } finally {
      await h.close();
    }
  });

  describe("says why it refused, never the token", () => {
    const lines: { level: "warn" | "error"; line: Record<string, unknown>; raw: string }[] = [];
    const watch = () => {
      lines.length = 0;
      for (const level of ["warn", "error"] as const)
        vi.spyOn(console, level).mockImplementation((raw: string) => {
          try {
            lines.push({ level, line: JSON.parse(String(raw)) as Record<string, unknown>, raw: String(raw) });
          } catch {
            /* not a line of the server's */
          }
        });
    };
    const said = (event: string) => lines.filter((l) => l.line["event"] === event);
    afterEach(() => vi.restoreAllMocks());

    it("as an error, once an hour, when it refuses everyone: Cloudflare unreachable, a good token for another host or form, a secret Cloudflare refuses", async () => {
      const h = await withKeys("a-deployments-own-secret");
      watch();
      try {
        for (let i = 0; i < 2; i++) expect((await post(h, "/auth/email", { email: "j@example.com", bot_check: `good:sign_in:elsewhere.example.net:${i}` })).status).toBe(403);
        for (let i = 0; i < 2; i++) expect((await post(h, "/auth/email", { email: "j@example.com", bot_check: `good:waitlist:${new URL(h.baseUrl).hostname}:${i}` })).status).toBe(403);
        verify.down(true);
        for (let i = 0; i < 2; i++) expect((await post(h, "/auth/email", { email: "j@example.com", bot_check: "good:sign_in:any" })).status).toBe(403);
        verify.down(false);
        expect((await post(h, "/auth/email", { email: "j@example.com" })).status).toBe(403);
        const host = said("bot_check_refused").filter((l) => l.line["reason"] === "wrong_host");
        expect(host.map((l) => [l.level, l.line["severity"]])).toEqual([
          ["error", "ERROR"],
          ["warn", "WARNING"],
        ]);
        expect(host[0]!.line).toMatchObject({ token_hostname: "elsewhere.example.net", action: "sign_in" });
        expect(said("bot_check_refused").filter((l) => l.line["reason"] === "wrong_action").map((l) => l.level)).toEqual(["error", "warn"]);
        expect(said("bot_check_unavailable").map((l) => l.level)).toEqual(["error", "warn"]);
        expect(said("bot_check_refused").filter((l) => l.line["reason"] === "no_token").map((l) => l.level)).toEqual(["warn"]);
        for (const l of lines) expect(l.raw).not.toMatch(/good:/);
      } finally {
        await h.close();
      }
      const wrong = await withKeys("a-secret-cloudflare-does-not-know");
      watch();
      try {
        expect((await post(wrong, "/auth/email", { email: "k@example.com", bot_check: "good:sign_in:x" })).status).toBe(403);
        expect(said("bot_check_refused").map((l) => [l.level, l.line["reason"], l.line["error_codes"]])).toEqual([["error", "wrong_secret", ["invalid-input-secret"]]]);
      } finally {
        await wrong.close();
      }
    });

    it("as an error, once, when every token Cloudflare was asked about in an hour was refused", async () => {
      const h = await withKeys("a-deployments-own-secret");
      watch();
      try {
        for (let i = 0; i < 25; i++) expect((await post(h, "/api/v1/interest", { email: `m${i}@example.com`, bot_check: `made-up-${i}` })).status).toBe(403);
        expect(said("bot_check_refused").every((l) => l.level === "warn" && l.line["reason"] === "rejected")).toBe(true);
        expect(said("bot_check_refused_all").map((l) => [l.level, l.line["checked"]])).toEqual([["error", 20]]);
      } finally {
        await h.close();
      }
    });
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
