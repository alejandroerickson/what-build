import { sql } from "kysely";
import type { Db } from "./db.ts";

/**
 * End everything an account is signed in with, in the caller's transaction: every browser session
 * but the ones kept, every agent connection, and every upload grant not yet used, so nothing more is
 * stored under one. Download grants die with the connection that asked for them. "Sign out
 * everywhere" calls it, and so does removing an account. It writes nothing into any organization:
 * the account is the person's own.
 */
export async function endSignIns(trx: Db, accountId: string, keepSessionHashes: string[] = []): Promise<{ sessions: number; connections: number }> {
  const now = new Date().toISOString();
  let ending = trx.deleteFrom("sessions").where("account_id", "=", accountId);
  if (keepSessionHashes.length) ending = ending.where("session_hash", "not in", keepSessionHashes);
  const sessions = Number((await ending.executeTakeFirst()).numDeletedRows);
  const revoked = await trx.updateTable("oauth_tokens").set({ revoked_at: now }).where("account_id", "=", accountId).where("revoked_at", "is", null).returning(["family_id", "expires_at"]).execute();
  // A connection counts while one of its tokens was still good; its expired ones are revoked too.
  const connections = new Set(revoked.filter((t) => Date.parse(t.expires_at) > Date.parse(now)).map((t) => t.family_id)).size;
  // Upload grants are tenant rows, so each of the account's organizations is visited in turn. A
  // grant in one it has left stores nothing already: the relay checks its requester's role.
  const tenants = await trx.selectFrom("memberships").select("tenant_id").distinct().where("account_id", "=", accountId).execute();
  for (const { tenant_id } of tenants) {
    await sql`select set_config('app.tenant_id', ${tenant_id}, true)`.execute(trx);
    for (const table of ["upload_grants", "mockup_uploads"] as const)
      await trx.updateTable(table).set({ expires_at: now }).where(sql<string>`principal->>'account_id'`, "=", accountId).where("uploaded_at", "is", null).where("expires_at", ">", now).execute();
  }
  if (tenants.length) await sql`select set_config('app.tenant_id', '', true)`.execute(trx);
  return { sessions, connections };
}
