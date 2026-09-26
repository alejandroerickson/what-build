import { json, newId, randomToken, sha256Hex, type Db, type Principal } from "@whatbuild/core";
import { sql } from "kysely";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_COOKIE = "wb_session";
export const PAT_PREFIX = "wbpat_";
export const ACCESS_PREFIX = "wbat_";
export const REFRESH_PREFIX = "wbrt_";

export interface AccountRow {
  account_id: string;
  email: string;
  display_name: string;
}

function principalFor(a: AccountRow, auth_kind: Principal["auth_kind"], surface: Principal["surface"], client: string | null): Principal {
  return { account_id: a.account_id, email: a.email, display_name: a.display_name, auth_kind, surface, client };
}

export async function accountBySession(db: Db, token: string): Promise<AccountRow | null> {
  const hash = sha256Hex(token);
  const row = await db
    .selectFrom("sessions as s")
    .innerJoin("accounts as a", "a.account_id", "s.account_id")
    .select(["a.account_id", "a.email", "a.display_name", "s.last_seen_at"])
    .where("s.session_hash", "=", hash)
    .where("s.expires_at", ">", new Date().toISOString())
    .where("a.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) return null;
  // Touch at most once a minute so reads do not become writes.
  if (Date.now() - Date.parse(row.last_seen_at) > 60_000) await db.updateTable("sessions").set({ last_seen_at: new Date().toISOString() }).where("session_hash", "=", hash).execute();
  return row;
}

export async function accountByPat(db: Db, token: string): Promise<AccountRow | null> {
  const row = await db
    .selectFrom("personal_access_tokens as t")
    .innerJoin("accounts as a", "a.account_id", "t.account_id")
    .select(["a.account_id", "a.email", "a.display_name", "t.token_id", "t.last_used_at"])
    .where("t.token_hash", "=", sha256Hex(token))
    .where("t.revoked_at", "is", null)
    .where("a.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000)
    await db.updateTable("personal_access_tokens").set({ last_used_at: new Date().toISOString() }).where("token_id", "=", row.token_id).execute();
  return row;
}

export async function accountByAccessToken(db: Db, token: string, resourcePrefix: string): Promise<(AccountRow & { client_name: string }) | null> {
  const row = await db
    .selectFrom("oauth_tokens as t")
    .innerJoin("accounts as a", "a.account_id", "t.account_id")
    .innerJoin("oauth_clients as c", "c.client_id", "t.client_id")
    .select(["a.account_id", "a.email", "a.display_name", "t.resource", "t.token_hash", "t.last_used_at", "c.client_name"])
    .where("t.token_hash", "=", sha256Hex(token))
    .where("t.kind", "=", "access")
    .where("t.revoked_at", "is", null)
    .where("t.expires_at", ">", new Date().toISOString())
    .where("a.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row || !row.resource.startsWith(resourcePrefix)) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000)
    await db.updateTable("oauth_tokens").set({ last_used_at: new Date().toISOString() }).where("token_hash", "=", row.token_hash).execute();
  return row;
}

function clientFromUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  return ua.split(/[\s/]/)[0]?.slice(0, 64) || null;
}

/** The caller of a REST request: a browser session, or a personal access token. */
export async function restPrincipal(c: Context, db: Db): Promise<Principal | null> {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token.startsWith(PAT_PREFIX)) {
      const a = await accountByPat(db, token);
      return a ? principalFor(a, "pat", "rest", clientFromUserAgent(c.req.header("user-agent"))) : null;
    }
    return null;
  }
  const session = getCookie(c, SESSION_COOKIE);
  if (session) {
    const a = await accountBySession(db, session);
    return a ? principalFor(a, "session", "web", null) : null;
  }
  return null;
}

/** The caller of an MCP request: an OAuth access token issued for this server, or a personal access token. */
export async function mcpPrincipal(c: Context, db: Db, resourcePrefix: string): Promise<Principal | null> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (token.startsWith(PAT_PREFIX)) {
    const a = await accountByPat(db, token);
    return a ? principalFor(a, "pat", "mcp", clientFromUserAgent(c.req.header("user-agent"))) : null;
  }
  const a = await accountByAccessToken(db, token, resourcePrefix);
  return a ? principalFor(a, "oauth", "mcp", a.client_name.slice(0, 64)) : null;
}

export async function createSession(db: Db, accountId: string, days: number, userAgent: string | undefined): Promise<string> {
  const token = randomToken();
  await db
    .insertInto("sessions")
    .values({ session_hash: sha256Hex(token), account_id: accountId, expires_at: new Date(Date.now() + days * 86400_000).toISOString(), user_agent: userAgent?.slice(0, 300) ?? null })
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
    await trx
      .insertInto("activity")
      .values({
        activity_id: newId(), tenant_id: inv.tenant_id, team_id: inv.scope_type === "team" ? inv.scope_id : null, product_id: inv.scope_type === "product" ? inv.scope_id : null,
        actor: json(actor), actor_account_id: account.account_id, channel: "web", action: "joined", entity_type: "membership", entity_id: account.account_id,
        entity_title: account.display_name, summary: `Accepted an invitation as ${inv.role}`,
      })
      .execute();
  });
  return inv;
}
