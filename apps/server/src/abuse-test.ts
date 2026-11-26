import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createTcpServer, type AddressInfo, type Server } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ABUSE_LIMITS, abuseLimitsFrom } from "@whatbuild/core";
import pg from "pg";
import { namedBy } from "./client-address.ts";
import { startLocalPg } from "./testing/pg.ts";

/**
 * `pnpm abuse-test`: what a script can make a WhatBuild do before anyone lets it in, tried against a
 * local instance of this checkout and nothing else (okf/operations/abuse-test.md). It starts a
 * Postgres of its own, a fresh database, a mail catcher and the server, with sign-up open to
 * anyone, the edge key, and Cloudflare's always-passing Turnstile test keys, so the limits are met
 * as a script that got past the bot check would meet them. Then it floods: requests without a bot
 * check token, sign-in links from one client address and from many, sign-ups, the waitlist, agent
 * registrations, invitations, and the deployment's mail for the hour, while a second organization
 * works as usual. It reports what got through, what was stopped and by what, the mail that left,
 * and the second organization's answers and times; then stops everything and drops the database.
 *
 *   pnpm abuse-test                 the abuse limits' defaults
 *   WHATBUILD_ABUSE_LIMITS=… pnpm abuse-test     other numbers, as a deployment would set them
 *   pnpm abuse-test --keep          leave the database, to look at it afterwards
 */

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const PG_PORT = Number(process.env["WHATBUILD_ABUSE_PG_PORT"] ?? 54341);
const EDGE_KEY = "abuse-test-edge-key-of-at-least-32-characters";
/** Cloudflare's documented test keys: the widget always passes, and siteverify accepts any token. */
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const KEEP = process.argv.includes("--keep");
const CONCURRENCY = 10;
const limits = abuseLimitsFrom(process.env["WHATBUILD_ABUSE_LIMITS"]);

// ---- A mail catcher: just enough SMTP for the server's mailer, keeping what each message says ---

interface Caught {
  to: string[];
  subject: string;
  text: string;
}

/** Quoted-printable or base64, as a mailer may encode a body. */
function decodeBody(headers: string, body: string): string {
  if (/content-transfer-encoding:\s*base64/i.test(headers)) return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers))
    return Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
  return body;
}

function mailCatcher(): Promise<{ port: number; caught: Caught[]; close(): void }> {
  const caught: Caught[] = [];
  const server: Server = createTcpServer((socket) => {
    let buffer = "";
    let inData = false;
    let message = "";
    let to: string[] = [];
    socket.write("220 abuse-test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let i = buffer.indexOf("\r\n"); i >= 0; i = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            const split = message.indexOf("\r\n\r\n");
            const headers = message.slice(0, split);
            const subject = /^subject:\s*(.*)$/im.exec(headers)?.[1] ?? "";
            caught.push({ to, subject, text: decodeBody(headers, message.slice(split + 4)) });
            message = "";
            to = [];
            socket.write("250 OK\r\n");
          } else message += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") socket.write("250-abuse-test\r\n250 8BITMIME\r\n");
        else if (verb === "RCPT") {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else socket.write("250 OK\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ port: (server.address() as AddressInfo).port, caught, close: () => server.close() })));
}

// ---- The instance ---------------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((done) => {
    const s = createTcpServer();
    s.listen(0, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => done(port));
    });
  });
}

function runServer(command: "migrate" | "serve", env: Record<string, string>): ChildProcess {
  return spawn(resolve(root, "apps/server/node_modules/.bin/tsx"), ["src/main.ts", command], { cwd: resolve(root, "apps/server"), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
}

// ---- Requests -------------------------------------------------------------------------------------

let base = "";
let origin = "";

interface Answer {
  status: number;
  code: string | null;
  limit: string | null;
  body: any;
  location: string | null;
  ms: number;
}

/** A request as the Cloudflare Worker passes it on: with the edge key, from `from` (a client address), with a session where one is given. */
async function call(method: string, path: string, opts: { from?: string; body?: unknown; form?: URLSearchParams; cookie?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = { "X-WhatBuild-Edge-Key": EDGE_KEY, origin };
  if (opts.from) Object.assign(headers, namedBy(EDGE_KEY, opts.from));
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.form) headers["content-type"] = "application/x-www-form-urlencoded";
  const started = performance.now();
  const res = await fetch(`${base}${path}`, { method, headers, redirect: "manual", body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  const text = await res.text();
  const ms = performance.now() - started;
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* a page or a redirect */
  }
  const error = body && typeof body === "object" ? body.error : null;
  const code = typeof error === "string" ? error : (error?.code ?? null);
  // What stopped it: an abuse limit by name, a plan's total by name, or a plan's limit a minute.
  const d = error?.details ?? {};
  const limit = d.abuse_limit ?? d.quota ?? (d.per === "minute" ? `${d.limit} a minute (the plan's)` : null);
  return { status: res.status, code, limit, body, location: res.headers.get("location"), ms };
}

/** Run `n` requests, `CONCURRENCY` at a time. */
async function flood<T>(n: number, one: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, n) }, async () => {
      for (let i = next++; i < n; i = next++) out[i] = await one(i);
    }),
  );
  return out;
}

/** A client address of its own for request `i` of a flood, from the ranges kept for tests (RFC 2544, 198.18.0.0/15). */
const clientOf = (block: number, i: number) => `198.${18 + (block >> 8)}.${block & 255}.${i % 250}`.replace(/\.(\d+)$/, (_, last: string) => `.${Number(last) + 1}`);
/** One distinct address for each `i`, across blocks. */
const manyClients = (block: number) => (i: number) => clientOf(block + Math.floor(i / 250), i);

async function devSignIn(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev-sign-in`, { method: "POST", headers: { "X-WhatBuild-Edge-Key": EDGE_KEY, origin, "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /wb_session=./.test(c));
  if (!cookie) throw new Error(`development sign-in failed for ${email}: ${res.status}`);
  return cookie;
}

// ---- What each phase found ------------------------------------------------------------------------

interface Row {
  phase: string;
  attempts: number;
  through: number;
  stopped: Record<string, number>;
  mails: number;
  note?: string;
}
const rows: Row[] = [];

/** What went past a limit, which makes the run fail. */
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (!ok) failures.push(what);
}

/** What the answers were, by what stopped each: a status and the limit or code that says why. */
function tally(phase: string, answers: Answer[], mails: number, ok: (a: Answer) => boolean, note?: string): Row {
  const stopped: Record<string, number> = {};
  for (const a of answers.filter((x) => !ok(x))) {
    const why = `${a.status} ${a.limit ?? a.code ?? (a.location ? a.location.replace(/^.*error=/, "") : "?")}`;
    stopped[why] = (stopped[why] ?? 0) + 1;
  }
  const row = { phase, attempts: answers.length, through: answers.filter(ok).length, stopped, mails, ...(note ? { note } : {}) };
  rows.push(row);
  console.log(`  ${phase}: ${row.through} of ${row.attempts} got through; stopped: ${Object.entries(stopped).map(([k, v]) => `${v} × ${k}`).join(", ") || "none"}; ${mails} mails sent`);
  return row;
}

// ---- The second organization, working as usual throughout -----------------------------------------

interface Bystander {
  phase: string;
  times: number[];
  failures: string[];
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function main() {
  console.log(`Starting a Postgres of its own (in .what-build/abuse-pg, port ${PG_PORT})…`);
  const local = await startLocalPg(resolve(root, ".what-build/abuse-pg"), PG_PORT, { disposable: true, portVariable: "WHATBUILD_ABUSE_PG_PORT" });
  const database = `abuse_${Date.now()}`;
  const databaseUrl = await local.createDatabase(database);
  const admin = new pg.Client({ connectionString: local.adminUrl.replace(/\/postgres$/, `/${database}`) });
  const mail = await mailCatcher();
  const port = await freePort();
  base = `http://localhost:${port}`;
  origin = base;
  const env: Record<string, string> = {
    NODE_ENV: "development",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    WHATBUILD_PUBLIC_URL: base,
    WHATBUILD_EDGE_KEY: EDGE_KEY,
    WHATBUILD_TURNSTILE_SITE_KEY: TEST_SITE_KEY,
    WHATBUILD_TURNSTILE_SECRET_KEY: TEST_SECRET_KEY,
    WHATBUILD_SMTP_URL: `smtp://127.0.0.1:${mail.port}`,
    WHATBUILD_MAIL_FROM: "WhatBuild <no-reply@example.com>",
    WHATBUILD_BLOB_DIR: resolve(root, ".what-build/abuse-blobs"),
    WHATBUILD_PLANS: resolve(root, "deploy/plans.example.json"),
    WHATBUILD_NEW_ORGANIZATION_PLAN: "free",
    WHATBUILD_TENANT_ALLOWANCE: "1",
    WHATBUILD_INSTANCE_OWNERS: "owner@example.com",
    WHATBUILD_LIVE_UPDATES: "0",
    ...(process.env["WHATBUILD_ABUSE_LIMITS"] ? { WHATBUILD_ABUSE_LIMITS: process.env["WHATBUILD_ABUSE_LIMITS"] } : {}),
  };
  // Sign-up is open to anyone: no WHATBUILD_SIGNUP_ALLOWLIST, the case the limits are for.
  delete process.env["WHATBUILD_SIGNUP_ALLOWLIST"];
  const children: ChildProcess[] = [];
  const log: string[] = [];
  const stop = async () => {
    for (const c of children) c.kill("SIGTERM");
    mail.close();
    await admin.end().catch(() => {});
    if (!KEEP) {
      const drop = new pg.Client({ connectionString: local.adminUrl });
      await drop.connect();
      await drop.query(`drop database if exists "${database}" with (force)`).catch(() => {});
      await drop.end();
    }
    await local.stop();
  };
  try {
    const migrating = runServer("migrate", env);
    const migrated = await new Promise<number>((done) => migrating.on("exit", (code) => done(code ?? 1)));
    if (migrated !== 0) throw new Error("the migrations did not run");
    const server = runServer("serve", env);
    children.push(server);
    for (const s of [server.stdout, server.stderr]) s?.on("data", (b: Buffer) => log.push(...b.toString("utf8").split("\n").filter(Boolean)));
    for (let i = 0; ; i++) {
      const up = await fetch(`${base}/health`).then((r) => r.ok, () => false);
      if (up) break;
      if (i > 120) throw new Error(`the server did not start:\n${log.slice(-20).join("\n")}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    await admin.connect();
    const methods = (await call("GET", "/auth/methods")).body as { bot_check?: { site_key: string } | null; dev: boolean; email_link: boolean };
    if (!methods.bot_check || !methods.dev || !methods.email_link) throw new Error(`the instance is not set up for the test: ${JSON.stringify(methods)}`);
    console.log(`WhatBuild on ${base}, with the bot check (Cloudflare's test keys) and the edge key; mail caught on port ${mail.port}.`);
    console.log(`Abuse limits: ${Object.entries(limits).map(([k, v]) => `${k}=${v ?? "off"}`).join(", ")}\n`);
    const mailsSince = (n: number) => mail.caught.length - n;
    const count = async (sql: string) => Number((await admin.query(sql)).rows[0].n);

    // The second organization: someone working in their own product all along, reading every half
    // second and writing every few, as the floods run.
    const bystanderCookie = await devSignIn("bystander@example.com");
    const t = await call("POST", "/api/v1/tenants", { cookie: bystanderCookie, body: { name: "Bystander Co" } });
    const tenant = t.body.tenant.slug as string;
    const productPath = (await call("POST", `/api/v1/tenants/${tenant}/products`, { cookie: bystanderCookie, body: { name: "Bystander product" } })).body.path as string;
    // Paced under its own plan's calls a minute, so only what others do could slow or stop it.
    const bystander: Bystander[] = [];
    let current: Bystander = { phase: "before the floods (15 seconds)", times: [], failures: [] };
    bystander.push(current);
    let running = true;
    const work = (async () => {
      for (let i = 0; running; i++) {
        const a = i % 6 === 5 ? await call("POST", `/api/v1/p/${productPath}/outcomes`, { cookie: bystanderCookie, body: { title: `Outcome ${i}` } }) : await call("GET", `/api/v1/p/${productPath}`, { cookie: bystanderCookie });
        current.times.push(a.ms);
        if (a.status >= 300) current.failures.push(`${a.status} ${a.limit ?? a.code ?? ""}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    await new Promise((r) => setTimeout(r, 15_000));
    const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      current = { phase: name, times: [], failures: [] };
      bystander.push(current);
      return fn();
    };

    // 1. No bot check token: refused before anything is counted, stored or sent.
    await phase("no token", async () => {
      const m = mail.caught.length;
      const links = await flood(50, (i) => call("POST", "/auth/email", { from: manyClients(1)(i), body: { email: `notoken${i}@example.com` } }));
      const waitlist = await flood(50, (i) => call("POST", "/api/v1/interest", { from: manyClients(2)(i), body: { email: `notoken${i}@example.com` } }));
      tally("Sign-in links without a bot check token", links, 0, (a) => a.status === 200);
      tally("Waitlist without a bot check token", waitlist, 0, (a) => a.status === 200);
      rows.at(-1)!.mails = mailsSince(m);
    });

    // 2. Sign-in links for strangers' addresses from one client, then a first look at the many.
    await phase("sign-in links, one client", async () => {
      const m = mail.caught.length;
      const answers = await flood(100, (i) => call("POST", "/auth/email", { from: "198.18.10.1", body: { email: `stranger${i}@example.com`, bot_check: TOKEN } }));
      await new Promise((r) => setTimeout(r, 1000));
      tally("Sign-in links for 100 addresses, from one client", answers, mailsSince(m), (a) => a.status === 200);
    });

    // 3. Sign-ups: links asked for from anywhere, each followed (the account made) from one client.
    const signUp = async (email: string, askFrom: string, followFrom: string): Promise<Answer> => {
      const asked = await call("POST", "/auth/email", { from: askFrom, body: { email, bot_check: TOKEN } });
      if (asked.status !== 200) return asked;
      let text = "";
      for (let i = 0; i < 100 && !text; i++) {
        text = [...mail.caught].reverse().find((c) => c.to.includes(email))?.text ?? "";
        if (!text) await new Promise((r) => setTimeout(r, 50));
      }
      const token = /\/auth\/verify\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
      if (!token) return { ...asked, status: 599, code: "no_mail" };
      return call("POST", "/auth/verify", { from: followFrom, form: new URLSearchParams({ token }) });
    };
    const madeAccount = (a: Answer) => a.status === 303 && a.location === "/";
    await phase("sign-ups, one client", async () => {
      const m = mail.caught.length;
      const before = await count("select count(*) as n from accounts");
      const answers = await flood(30, (i) => signUp(`signup-one-${i}@example.com`, manyClients(20)(i), "198.18.11.1"));
      const made = (await count("select count(*) as n from accounts")) - before;
      tally("Sign-ups of 30 new addresses, from one client", answers, mailsSince(m), madeAccount, `${made} accounts made`);
    });
    await phase("sign-ups, many clients", async () => {
      const m = mail.caught.length;
      const before = await count("select count(*) as n from accounts");
      const answers = await flood(150, (i) => signUp(`signup-many-${i}@example.com`, manyClients(30)(i), manyClients(40)(i)));
      const made = (await count("select count(*) as n from accounts")) - before;
      tally("Sign-ups of 150 new addresses, each from its own client", answers, mailsSince(m), madeAccount, `${made} accounts made`);
    });

    // 4. The waitlist, from one client and from many, and a bot that fills in the hidden field.
    await phase("waitlist", async () => {
      const before = await count("select count(*) as n from interest");
      const one = await flood(30, (i) => call("POST", "/api/v1/interest", { from: "198.18.12.1", body: { email: `wait-one-${i}@example.com`, bot_check: TOKEN } }));
      tally("Waitlist, 30 addresses from one client", one, 0, (a) => a.status === 200);
      const trap = await flood(20, (i) => call("POST", "/api/v1/interest", { from: manyClients(50)(i), body: { email: `trap-${i}@example.com`, website: "https://spam.example.com", bot_check: TOKEN } }));
      const many = await flood(300, (i) => call("POST", "/api/v1/interest", { from: manyClients(60)(i), body: { email: `wait-many-${i}@example.com`, bot_check: TOKEN } }));
      const stored = (await count("select count(*) as n from interest")) - before;
      const trapped = await count("select count(*) as n from interest where email like 'trap-%'");
      tally("Waitlist, 300 addresses each from its own client", many, 0, (a) => a.status === 200, `${stored} entries stored in all; the hidden field's 20 were thanked and ${trapped} stored`);
      void trap;
    });

    // 5. Agent registrations: from one client, from many /64s of one IPv6 /48, and from many
    // clients past the number kept waiting, after which an agent registering still connects.
    await phase("agent registrations", async () => {
      const register = (from: string, name = "flood") => call("POST", "/oauth/register", { from, body: { client_name: name, redirect_uris: ["http://127.0.0.1:9/cb"] } });
      const waiting = () => count("select count(*) as n from oauth_clients c where not exists (select 1 from oauth_tokens t where t.client_id = c.client_id) and not exists (select 1 from oauth_codes o where o.client_id = c.client_id)");
      tally("Agent registrations, 40 from one client", await flood(40, () => register("198.18.13.1")), 0, (a) => a.status === 201);
      tally("Agent registrations, 100 from 100 /64s of one IPv6 /48", await flood(100, (i) => register(`2001:db8:a5:${(i + 1).toString(16)}::1`)), 0, (a) => a.status === 201);
      const most = limits.agent_registrations_waiting;
      const n = (most ?? 1000) + 250;
      const answers = await flood(n, (i) => register(manyClients(70)(i)));
      const real = await register("198.18.13.200", "an agent registering during the flood");
      const authorize = real.status === 201 ? await call("GET", `/oauth/authorize?client_id=${real.body.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9/cb")}&response_type=code&code_challenge=x&code_challenge_method=S256`) : null;
      tally(`Agent registrations, ${n} each from its own client`, answers, 0, (a) => a.status === 201, `${await waiting()} kept waiting (the number is ${most ?? "off"}); an agent registering after them: ${real.status}, and its sign-in ${authorize?.status === 302 ? "opens" : "fails"}`);
      check(most === null || (await waiting()) <= most, `more agent registrations kept waiting than ${most}`);
      check(authorize?.status === 302, "an agent registering during the flood could not go on to sign its person in");
    });

    // 6. Invitations: from an organization on the plan new organizations start on, and from one on
    // any plan (an instance owner's, which no plan limits).
    await phase("invitations", async () => {
      const attacker = await devSignIn("attacker@example.com");
      const org = (await call("POST", "/api/v1/tenants", { cookie: attacker, body: { name: "Flood Co" } })).body.tenant.slug as string;
      let m = mail.caught.length;
      const people = Array.from({ length: 100 }, (_, i) => ({ email: `invited-${i}@example.com`, role: "member" }));
      const all = await call("POST", `/api/v1/tenants/${org}/members/many`, { cookie: attacker, body: { people } });
      tally("Invitations to 100 addresses in one call, from a new organization", [all], mailsSince(m), (a) => a.status === 201, all.status === 201 ? undefined : "all or nothing: none made");
      // Inviting and cancelling, again and again, to mail one stranger after another.
      m = mail.caught.length;
      const churn: Answer[] = [];
      const until = Date.now() + 65_000;
      for (let i = 0; Date.now() < until; i++) {
        const a = await call("POST", `/api/v1/tenants/${org}/members`, { cookie: attacker, body: { email: `churn-${i}@example.com`, role: "member" } });
        churn.push(a);
        // A cancel the plan's limits a minute refuse is tried again, as a script would, until it goes.
        if (a.status === 201)
          while (Date.now() < until && (await call("POST", `/api/v1/tenants/${org}/invitations/cancel`, { cookie: attacker, body: { invitation_id: a.body.invitation_id } })).status !== 200) await new Promise((r) => setTimeout(r, 2000));
        else await new Promise((r) => setTimeout(r, 2000));
      }
      tally("Invite and cancel for 65 seconds, from a new organization", churn, mailsSince(m), (a) => a.status === 201);
      const owner = await devSignIn("owner@example.com");
      const own = (await call("POST", "/api/v1/tenants", { cookie: owner, body: { name: "Owner Flood Test" } })).body.tenant.slug as string;
      m = mail.caught.length;
      const batch = (from: number, n: number) => call("POST", `/api/v1/tenants/${own}/members/many`, { cookie: owner, body: { people: Array.from({ length: n }, (_, i) => ({ email: `owner-invited-${from + i}@example.com`, role: "member" })) } });
      const answers = [await batch(0, 100), await batch(100, 50), ...(await flood(10, (i) => call("POST", `/api/v1/tenants/${own}/members`, { cookie: owner, body: { email: `owner-single-${i}@example.com`, role: "member" } })))];
      const made = await count(`select count(*) as n from invitations i join tenants t on t.tenant_id = i.tenant_id where t.slug = '${own}'`);
      await new Promise((r) => setTimeout(r, 1000));
      tally("Invitations from an organization on any plan: 100, then 50, then 10 one at a time", answers, mailsSince(m), (a) => a.status === 201, `${made} invitations made`);
    });

    // 7. The deployment's mail for the hour: sign-in links for strangers from many clients, until it is used.
    await phase("mail for the hour", async () => {
      const m = mail.caught.length;
      const answers = await flood(600, (i) => call("POST", "/auth/email", { from: manyClients(80)(i), body: { email: `ceiling-${i}@example.com`, bot_check: TOKEN } }));
      await new Promise((r) => setTimeout(r, 2000));
      tally("Sign-in links for 600 addresses, each from its own client", answers, mailsSince(m), (a) => a.status === 200);
      // What a person meets then: their own sign-in link, and an invitation from the second organization.
      const person = await call("POST", "/auth/email", { from: "198.18.14.1", body: { email: "bystander@example.com", bot_check: TOKEN } });
      const before = mail.caught.length;
      const invited = await call("POST", `/api/v1/tenants/${tenant}/members`, { cookie: bystanderCookie, body: { email: "colleague@example.com", role: "member" } });
      tally("After it: the second organization's person asks for a sign-in link, then invites a colleague", [person, invited], mailsSince(before), (a) => a.status === 200 || a.status === 201, `invitation: ${invited.status}, emailed ${invited.body?.emailed === false ? "no" : "yes"}; link: ${person.status} ${person.limit ?? ""}`);
    });

    running = false;
    await work;
    const totalMail = mail.caught.length;
    const ceilings = log.filter((l) => l.includes("abuse_ceiling_reached")).map((l) => /"limit":"(\w+)"/.exec(l)?.[1]).filter(Boolean);
    const during = bystander.slice(1);
    const all = during.flatMap((b) => b.times);
    bystander.push({ phase: "during all the floods", times: all, failures: during.flatMap((b) => b.failures) });
    const report = {
      at: new Date().toISOString(),
      limits,
      defaults: JSON.stringify(limits) === JSON.stringify(DEFAULT_ABUSE_LIMITS),
      rows,
      mails_sent: totalMail,
      ceilings_logged: ceilings,
      bystander: bystander.map((b) => ({ phase: b.phase, requests: b.times.length, p50_ms: Math.round(percentile(b.times, 50)), p95_ms: Math.round(percentile(b.times, 95)), max_ms: Math.round(Math.max(0, ...b.times)), failures: b.failures })),
    };
    console.log(`\n${totalMail} mails left the instance in all. Ceilings that filled, as logged: ${ceilings.join(", ") || "none"}.`);
    console.log("\nThe second organization, working all along:");
    for (const b of report.bystander) console.log(`  ${b.phase}: ${b.requests} requests, p50 ${b.p50_ms} ms, p95 ${b.p95_ms} ms, max ${b.max_ms} ms, ${b.failures.length ? `failures: ${b.failures.join(", ")}` : "no failures"}`);
    const dir = resolve(root, ".what-build/abuse-test");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${report.at.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nThe report: ${file}`);
    check(limits.mail_per_hour === null || totalMail <= limits.mail_per_hour, `${totalMail} mails left the instance, past mail_per_hour (${limits.mail_per_hour})`);
    check(during.every((b) => !b.failures.length), "the second organization had requests refused");
    if (failures.length) throw new Error(`The abuse test found limits passed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  } finally {
    await stop();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
