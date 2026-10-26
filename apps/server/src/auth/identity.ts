import { endSignIns, json, newId, randomToken, sha256Hex, type ConnectionLevel, type Db, type Principal } from "@whatbuild/core";
import { sql } from "kysely";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ServerConfig } from "../config.ts";
import { resourceCovers } from "./connector-reach.ts";

/**
 * The session cookie. Over HTTPS it is `__Host-wb_session`: Secure, Path=/ and no Domain, which a
 * browser accepts only from this host, so no other host under the same parent domain (the public
 * site's, say) can set one. Over plain HTTP, in local development, it is `wb_session`.
 */
export const HOST_SESSION_COOKIE = "__Host-wb_session";
/** The cookie's name over HTTP, and, over HTTPS, its old name, still taken for a session issued under it. */
export const SESSION_COOKIE = "wb_session";
export const ACCESS_PREFIX = "wbat_";
export const REFRESH_PREFIX = "wbrt_";

export const sessionCookieName = (secure: boolean) => (secure ? HOST_SESSION_COOKIE : SESSION_COOKIE);

/**
 * Whether a Cookie header carries any of WhatBuild's cookies, prefixed or not, but the analytics
 * choice (`wb_cookies`): the page sets that one on the parent domain, so the public site sends it
 * too, and it grants nothing.
 */
export const carriesOurCookie = (cookieHeader: string | undefined) => /(?:^|;)\s*(?:__Host-)?wb_(?!cookies=)/.test(cookieHeader ?? "");

/**
 * Whether a request's Origin is the app's own (or, outside production, a localhost port). A request
 * without one is not a browser's cross-origin request: browsers send Origin on every cross-origin
 * POST, and `null` where they hide it.
 */
export function isOwnOrigin(config: ServerConfig, origin: string | undefined): boolean {
  return !origin || origin === config.publicBaseUrl || (config.env !== "production" && /^http:\/\/localhost:\d+$/.test(origin));
}

/** Set the session cookie for `seconds`. Over HTTPS the old name is cleared at the same time. */
export function setSessionCookie(c: Context, token: string, secure: boolean, seconds: number) {
  setCookie(c, sessionCookieName(secure), token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: Math.max(0, Math.floor(seconds)) });
  if (secure) deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Clear the session cookie under every name it may have. */
export function clearSessionCookies(c: Context, secure: boolean) {
  if (secure) deleteCookie(c, HOST_SESSION_COOKIE, { path: "/", secure: true });
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Every session token a request carries, under either name. */
export function sessionTokens(c: Context, secure: boolean): string[] {
  return [...new Set([secure ? getCookie(c, HOST_SESSION_COOKIE) : undefined, getCookie(c, SESSION_COOKIE)].filter((t): t is string => Boolean(t)))];
}

/**
 * The account of the session a browser request carries. Over HTTPS that is the one under
 * `__Host-wb_session`; without it, a session issued before the cookie took its prefix is still taken
 * under `wb_session` until it expires, and is moved to the new name on the way out. A session
 * issued since is never taken under the old name, which another host could have set.
 */
export async function sessionAccount(c: Context, db: Db, secure: boolean): Promise<AccountRow | null> {
  const current = getCookie(c, sessionCookieName(secure));
  if (current) return accountBySession(db, current);
  const old = secure ? getCookie(c, SESSION_COOKIE) : undefined;
  if (!old) return null;
  const a = await accountBySession(db, old, { legacyCookie: true });
  if (a) setSessionCookie(c, old, secure, (Date.parse(a.expires_at) - Date.now()) / 1000);
  return a;
}

export interface AccountRow {
  account_id: string;
  email: string;
  display_name: string;
}

function principalFor(a: AccountRow, auth_kind: Principal["auth_kind"], surface: Principal["surface"], client: string | null): Principal {
  return { account_id: a.account_id, email: a.email, display_name: a.display_name, auth_kind, surface, client };
}

/** The account behind a session token; with `legacyCookie`, only for a session issued under the cookie's old name. */
async function accountBySession(db: Db, token: string, opts: { legacyCookie?: boolean } = {}): Promise<(AccountRow & { expires_at: string }) | null> {
  const hash = sha256Hex(token);
  const row = await db
    .selectFrom("sessions as s")
    .innerJoin("accounts as a", "a.account_id", "s.account_id")
    .select(["a.account_id", "a.email", "a.display_name", "s.last_seen_at", "s.expires_at"])
    .where("s.session_hash", "=", hash)
    .where("s.expires_at", ">", new Date().toISOString())
    .where("a.deleted_at", "is", null)
    .$if(Boolean(opts.legacyCookie), (q) => q.where("s.legacy_cookie", "=", true))
    .executeTakeFirst();
  if (!row) return null;
  // Touch at most once a minute so reads do not become writes.
  if (Date.now() - Date.parse(row.last_seen_at) > 60_000) await db.updateTable("sessions").set({ last_seen_at: new Date().toISOString() }).where("session_hash", "=", hash).execute();
  return row;
}

/** The account behind an access token, when the token was issued for `endpoint` or an endpoint containing it. */
export async function accountByAccessToken(db: Db, token: string, endpoint: string): Promise<(AccountRow & { client_name: string; level: ConnectionLevel; feedback: boolean; family_id: string }) | null> {
  const row = await db
    .selectFrom("oauth_tokens as t")
    .innerJoin("accounts as a", "a.account_id", "t.account_id")
    .innerJoin("oauth_clients as c", "c.client_id", "t.client_id")
    .select(["a.account_id", "a.email", "a.display_name", "t.resource", "t.token_hash", "t.last_used_at", "t.level", "t.feedback", "t.family_id", "c.client_name"])
    .where("t.token_hash", "=", sha256Hex(token))
    .where("t.kind", "=", "access")
    .where("t.revoked_at", "is", null)
    .where("t.expires_at", ">", new Date().toISOString())
    .where("a.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row || !resourceCovers(row.resource, endpoint)) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000)
    await db.updateTable("oauth_tokens").set({ last_used_at: new Date().toISOString() }).where("token_hash", "=", row.token_hash).execute();
  return row;
}

/** The requests whose session or access token was good. */
const signedIn = new WeakSet<Request>();

/**
 * Whether the request came with a good session or access token. Only such a request wakes the
 * service's worker (app.ts), so a stranger's requests cannot keep the database awake.
 */
export const wasSignedIn = (c: Context) => signedIn.has(c.req.raw);

/** The caller of a REST request: a browser session. Agents use MCP, never REST. */
export async function restPrincipal(c: Context, db: Db, config: ServerConfig): Promise<Principal | null> {
  if (c.req.header("authorization")?.startsWith("Bearer ")) return null;
  const a = await sessionAccount(c, db, config.publicBaseUrl.startsWith("https://"));
  if (!a) return null;
  signedIn.add(c.req.raw);
  return principalFor(a, "session", "web", null);
}

/** The caller of an MCP request: an OAuth access token issued for this endpoint, or for one that contains it. */
export async function mcpPrincipal(c: Context, db: Db, endpoint: string): Promise<Principal | null> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const a = await accountByAccessToken(db, token, endpoint);
  if (!a) return null;
  signedIn.add(c.req.raw);
  return { ...principalFor(a, "oauth", "mcp", a.client_name.slice(0, 64)), level: a.level, connection: a.family_id, ...(a.feedback ? {} : { feedback: false }) };
}

/** End everything an account is signed in with, in a transaction of its own (`endSignIns`). */
export async function endEverything(db: Db, accountId: string, keepSessionHashes: string[] = []): Promise<{ sessions: number; connections: number }> {
  return db.transaction().execute((trx) => endSignIns(trx, accountId, keepSessionHashes));
}

export async function createSession(db: Db, accountId: string, days: number, userAgent: string | undefined): Promise<string> {
  const token = randomToken();
  await db
    .insertInto("sessions")
    .values({ session_hash: sha256Hex(token), account_id: accountId, expires_at: new Date(Date.now() + days * 86400_000).toISOString(), user_agent: userAgent?.slice(0, 300) ?? null, legacy_cookie: false })
    .execute();
  return token;
}

export async function findOrCreateAccount(db: Db, email: string, displayName?: string): Promise<{ account: AccountRow; created: boolean }> {
  const existing = await db
    .selectFrom("accounts")
    .select(["account_id", "email", "display_name"])
    .where(sql<boolean>`lower(email) = lower(${email})`)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (existing) {
    await db.updateTable("accounts").set({ email_verified_at: new Date().toISOString() }).where("account_id", "=", existing.account_id).where("email_verified_at", "is", null).execute();
    return { account: existing, created: false };
  }
  const local = email.split("@")[0] ?? "Someone";
  const name = (displayName?.trim() || local.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())).slice(0, 100);
  const account = { account_id: newId(), email, display_name: name };
  await db.insertInto("accounts").values({ ...account, email_verified_at: new Date().toISOString() }).execute();
  return { account, created: true };
}

/** Accept every outstanding invitation addressed to this email: the verified address is the proof. */
export async function acceptInvitationsForEmail(db: Db, account: AccountRow): Promise<number> {
  const invites = await db
    .selectFrom("invitations")
    .selectAll()
    .where(sql<boolean>`lower(email) = lower(${account.email})`)
    .where("accepted_at", "is", null)
    .where("expires_at", ">", new Date().toISOString())
    .execute();
  for (const inv of invites) await acceptInvitation(db, inv.invitation_id, account);
  return invites.length;
}

export async function acceptInvitation(db: Db, invitationId: string, account: AccountRow) {
  const inv = await db.selectFrom("invitations").selectAll().where("invitation_id", "=", invitationId).executeTakeFirstOrThrow();
  const actor = { account_id: account.account_id, display_name: account.display_name, surface: "web" as const, client: null };
  const existing = await db.selectFrom("memberships").select(["membership_id", "role"]).where("scope_type", "=", inv.scope_type).where("scope_id", "=", inv.scope_id).where("account_id", "=", account.account_id).executeTakeFirst();
  if (!existing)
    await db
      .insertInto("memberships")
      .values({ membership_id: newId(), tenant_id: inv.tenant_id, scope_type: inv.scope_type, scope_id: inv.scope_id, account_id: account.account_id, role: inv.role, created_by: json(inv.created_by) })
      .execute();
  await db.updateTable("invitations").set({ accepted_at: new Date().toISOString(), accepted_by: account.account_id }).where("invitation_id", "=", inv.invitation_id).execute();
  await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${inv.tenant_id}, true)`.execute(trx);
    const name = account.display_name;
    await trx
      .insertInto("activity")
      .values({
        activity_id: newId(), tenant_id: inv.tenant_id, team_id: inv.scope_type === "team" ? inv.scope_id : null, product_id: inv.scope_type === "product" ? inv.scope_id : null,
        actor: json({ ...actor, display_name: name }), actor_account_id: account.account_id, channel: "web", action: "joined", entity_type: "membership", entity_id: account.account_id,
        entity_title: name, summary: `Accepted an invitation as ${inv.role}`,
      })
      .execute();
  });
  return inv;
}
