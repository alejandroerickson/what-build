import { sql } from "kysely";
import { z } from "zod";
import { ACCOUNT_DELETION, RECENT_SIGN_IN_MINUTES } from "../account-deletion.ts";
import { endSignIns } from "../accounts.ts";
import { json } from "../db.ts";
import { checkConfirmation, DELETE_CONFIRMATION } from "../deletion.ts";
import { AppError, conflict, forbidden, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { id } from "../schemas.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";
import { forgetPerson } from "../usage.ts";
import { newId } from "../util.ts";

/**
 * Every account on the instance, for its owners, and removing one; and a person deleting their own.
 * Both ways of ending an account do the same thing. An account belongs to no organization, so
 * listing and removing write no activity event of their own; leaving an organization is recorded in
 * that organization's access log, as any removal is.
 */

function requireInstanceOwner(ctx: OpContext) {
  if (!isInstanceOwner(ctx.ports.config, ctx.principal.email))
    throw forbidden("Only an owner of this WhatBuild instance can see every account or remove one.");
}

/** The address a removed account keeps: no one's, so the person's own is forgotten and free to sign up again if let in. */
const removedAddress = (accountId: string) => `removed+${accountId.toLowerCase()}@removed.invalid`;

export const listAccounts = defineOperation({
  name: "products.accounts",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  mutates: false,
  summary: "Every account on this instance, with the organizations each is in and when it was last seen (instance owners).",
  description:
    "For the instance's owners: each account's name, address, when it was made and last seen (its newest browser session or agent connection), how many browser sessions and agent connections it holds now, whether it owns the instance, the allowance its address has to start organizations, and every organization it holds a role in, with its role on the organization (null when its roles are on teams or products only) and how many team and product roles it holds there. query keeps the accounts whose name or address contains it. Names no product and holds none of an organization's content. Remove an account in the web app, on People.",
  input: z.strictObject({ query: z.string().trim().max(200).optional() }),
  rest: { method: "GET", path: "/accounts" },
  mcp: { tool: "products", action: "accounts" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    let q = ctx.db.selectFrom("accounts").select(["account_id", "display_name", "email", "created_at"]).where("deleted_at", "is", null);
    if (input.query) {
      const like = `%${input.query.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      q = q.where((eb) => eb.or([eb(sql<string>`lower(display_name)`, "like", like), eb(sql<string>`lower(email)`, "like", like)]));
    }
    const accounts = await q.orderBy("created_at", "desc").limit(1000).execute();
    const ids = accounts.map((a) => a.account_id);
    if (!ids.length) return { instance_owners: ctx.ports.config.instanceOwners ?? [], items: [] };
    const now = ctx.now;
    const sessions = await ctx.db
      .selectFrom("sessions")
      .select(["account_id", (eb) => eb.fn.countAll<string>().as("n"), (eb) => eb.fn.max("last_seen_at").as("seen")])
      .where("account_id", "in", ids)
      .where("expires_at", ">", now)
      .groupBy("account_id")
      .execute();
    const agents = await ctx.db
      .selectFrom("oauth_tokens")
      .select(["account_id", (eb) => eb.fn.count<string>("family_id").distinct().as("n"), (eb) => eb.fn.max(sql<string>`coalesce(last_used_at, created_at)`).as("seen")])
      .where("account_id", "in", ids)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", now)
      .groupBy("account_id")
      .execute();
    const grants = await ctx.db
      .selectFrom("memberships as m")
      .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
      .select(["m.account_id", "m.scope_type", "m.role", "t.tenant_id", "t.slug", "t.name", "t.example"])
      .where("m.account_id", "in", ids)
      .execute();
    const allowances = await ctx.db.selectFrom("tenant_allowances").select(["email", "allowed"]).where(sql<string>`email`, "in", accounts.map((a) => a.email.toLowerCase())).execute();
    const created = await ctx.db
      .selectFrom("tenants")
      .select([sql<string>`created_by->>'account_id'`.as("account_id"), (eb) => eb.fn.countAll<string>().as("n")])
      .where(sql<string>`created_by->>'account_id'`, "in", ids)
      .groupBy(sql`created_by->>'account_id'`)
      .execute();
    const latest = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    const items = accounts.map((a) => {
      const s = sessions.find((x) => x.account_id === a.account_id);
      const g = agents.find((x) => x.account_id === a.account_id);
      const orgs = new Map<string, { slug: string; name: string; role: string | null; roles: number; example?: true }>();
      for (const m of grants.filter((x) => x.account_id === a.account_id)) {
        const o = orgs.get(m.tenant_id) ?? { slug: m.slug, name: m.name, role: null, roles: 0, ...(m.example ? { example: true as const } : {}) };
        if (m.scope_type === "tenant") o.role = m.role;
        else o.roles += 1;
        orgs.set(m.tenant_id, o);
      }
      const allowance = allowances.find((x) => x.email === a.email.toLowerCase());
      return {
        account_id: a.account_id,
        display_name: a.display_name,
        email: a.email,
        created_at: a.created_at,
        last_seen_at: latest(s?.seen as string | null | undefined, g?.seen as string | null | undefined),
        sessions: Number(s?.n ?? 0),
        agents: Number(g?.n ?? 0),
        instance_owner: isInstanceOwner(ctx.ports.config, a.email),
        you: a.account_id === ctx.principal.account_id,
        allowance: allowance ? { allowed: allowance.allowed, created: Number(created.find((c) => c.account_id === a.account_id)?.n ?? 0) } : null,
        organizations: [...orgs.values()].sort((x, y) => x.name.localeCompare(y.name)),
      };
    });
    return { instance_owners: ctx.ports.config.instanceOwners ?? [], items };
  },
});

// ---- Ending an account: an instance owner's removal and a person's own deletion ------------------

interface Ending {
  account_id: string;
  display_name: string;
  email: string;
}

/** The organizations an account is the only owner of: it can't end until someone else owns each, or each is deleted. */
async function ownedAlone(ctx: OpContext, accountId: string): Promise<{ tenant_id: string; slug: string; name: string }[]> {
  return ctx.db
    .selectFrom("memberships as m")
    .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
    .select(["t.tenant_id", "t.slug", "t.name"])
    .where("m.account_id", "=", accountId)
    .where("m.scope_type", "=", "tenant")
    .where("m.role", "=", "owner")
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("memberships as o")
            .select("o.membership_id")
            .whereRef("o.tenant_id", "=", "m.tenant_id")
            .where("o.scope_type", "=", "tenant")
            .where("o.role", "=", "owner")
            .where("o.account_id", "!=", accountId),
        ),
      ),
    )
    .orderBy("t.name")
    .execute();
}

/** The account to end, locked, when it still exists. */
async function lockAccount(ctx: OpContext, accountId: string): Promise<Ending | undefined> {
  return ctx.db.selectFrom("accounts").select(["account_id", "display_name", "email"]).where("account_id", "=", accountId).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
}

/** The two refusals both ways share, in the words of whoever is asking. */
async function refuseBlocked(ctx: OpContext, account: Ending, self: boolean): Promise<void> {
  const who = self ? "You" : account.display_name;
  if (isInstanceOwner(ctx.ports.config, account.email))
    throw conflict(
      "instance_owner",
      `${self ? "You own" : `${account.display_name} owns`} this instance, as WHATBUILD_INSTANCE_OWNERS says where the service is deployed, so the account can't be ${self ? "deleted" : "removed"} here. ${self ? "Whoever deploys it can take your address off that list first. " : ""}Nothing was changed.`,
    );
  const alone = await ownedAlone(ctx, account.account_id);
  if (alone.length)
    throw conflict(
      "last_owner",
      `${who} ${self ? "are" : "is"} the only owner of ${alone.map((o) => o.name).join(", ")}. Make someone else owner there, or delete ${alone.length === 1 ? "it" : "them"}, before ${self ? "deleting your account" : "removing the account"}. Nothing was changed.`,
      { organizations: alone.map((o) => ({ slug: o.slug, name: o.name })) },
    );
}

/**
 * End an account, in the caller's transaction: sign it out everywhere, take every role it holds
 * (each organization's access log records it), cancel what would let its address in, delete what is
 * kept about the person (their tokens, the counts held against limits and against feedback, their
 * counted days of use, their name), and forget the address everywhere it is kept. The row stays,
 * nameless, so the id is never taken again; what they wrote keeps the name copied onto it (§3.9).
 */
async function endAccount(ctx: OpContext, account: Ending, self: boolean) {
  const db = ctx.db;
  const id = account.account_id;
  const address = account.email.toLowerCase();
  const ended = await endSignIns(db, id);
  const tenants = await db
    .selectFrom("memberships as m")
    .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
    .select(["t.tenant_id", "t.name", (eb) => eb.fn.countAll<string>().as("n")])
    .where("m.account_id", "=", id)
    .groupBy(["t.tenant_id", "t.name"])
    .execute();
  for (const t of tenants) {
    const roles = `${Number(t.n)} ${Number(t.n) === 1 ? "role" : "roles"}`;
    await sql`select set_config('app.tenant_id', ${t.tenant_id}, true)`.execute(db);
    await db
      .insertInto("activity")
      .values({
        activity_id: newId(), tenant_id: t.tenant_id, team_id: null, product_id: null, actor: json(ctx.actor), actor_account_id: ctx.actor.account_id,
        channel: ctx.actor.surface, action: "revoked", entity_type: "membership", entity_id: id, entity_title: account.display_name,
        summary: self ? `Left ${t.name} (${roles}) by deleting their account` : `Removed from ${t.name} (${roles}) with the account, by an owner of this instance`,
      })
      .execute();
  }
  if (tenants.length) await sql`select set_config('app.tenant_id', '', true)`.execute(db);
  await db.deleteFrom("memberships").where("account_id", "=", id).execute();
  const invitations = await db.deleteFrom("invitations").where(sql<boolean>`lower(email) = ${address}`).where("accepted_at", "is", null).executeTakeFirst();
  const allowance = await db.deleteFrom("tenant_allowances").where("email", "=", address).executeTakeFirst();
  await db.deleteFrom("email_tokens").where(sql<boolean>`lower(email) = ${address}`).execute();
  // What is kept about the person, beyond the sign-ins just ended.
  await db.deleteFrom("oauth_tokens").where("account_id", "=", id).execute();
  await db.deleteFrom("oauth_codes").where("account_id", "=", id).execute();
  await db.deleteFrom("limit_counters").where("account_id", "=", id).execute();
  await db.deleteFrom("feedback_counts").where("account_id", "=", id).execute();
  const days = await forgetPerson(db, ctx.ports.config.usageKey, id);
  // The address, wherever else it is kept: a request to hear when WhatBuild opens, and a reply address shared with feedback.
  await db.deleteFrom("interest").where(sql<boolean>`lower(email) = ${address}`).execute();
  await db.updateTable("feedback").set({ reply_to: null }).where(sql<boolean>`lower(reply_to) = ${address}`).execute();
  await db.updateTable("feedback").set({ submitted_by: null }).where(sql<string>`submitted_by->>'account_id'`, "=", id).execute();
  await db.updateTable("accounts").set({ deleted_at: ctx.now, email: removedAddress(id), display_name: "", email_verified_at: null, hide_example: false }).where("account_id", "=", id).execute();
  return {
    account_id: id,
    display_name: account.display_name,
    organizations_left: tenants.length,
    sessions_ended: ended.sessions,
    agents_disconnected: ended.connections,
    invitations_cancelled: Number(invitations.numDeletedRows),
    allowance_removed: Number(allowance.numDeletedRows) > 0,
    days_of_use_forgotten: days,
  };
}

/**
 * The mail that records it, to the address the account had: a record for the person, and an alarm
 * for one who didn't do it. A deployment that sends no mail sends none, and a mail that fails never
 * keeps the account: the result says whether it went.
 */
async function sendRecord(ctx: OpContext, account: Ending, self: boolean): Promise<boolean> {
  const mailer = ctx.ports.mailer;
  if (!mailer || ctx.ports.config.sendsMail === false) return false;
  const contact = ctx.ports.config.privacyContact;
  const runner = `whoever runs this WhatBuild${contact ? `, at ${contact}` : ""}`;
  const t = ACCOUNT_DELETION;
  try {
    await mailer.send({
      to: account.email,
      subject: "Your WhatBuild account is deleted",
      text:
        `The WhatBuild account for ${account.email} at ${ctx.ports.config.publicBaseUrl} was deleted on ${ctx.now.slice(0, 10)}, ${self ? "from a browser signed in as you" : "by an owner of this WhatBuild"}.\n\n` +
        `What went:\n${t.goes.map((g) => `- ${g}`).join("\n")}\n\n` +
        `What stays: ${t.stays} ${t.content}\n\n` +
        `${t.final}\n\n${t.again}\n\n` +
        (self ? `If you didn't delete it, someone used a browser signed in as you: tell ${runner}.\n` : `If you didn't expect this, ask ${runner}.\n`),
    });
    return true;
  } catch (e) {
    console.error(`account deletion: the record was not mailed: ${(e as Error).message}`);
    return false;
  }
}

export const removeAccount = defineOperation({
  name: "products.remove_account",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  mutates: true,
  connection: "admin",
  webOnly: true,
  summary: "REMOVE PERMANENTLY — cannot be undone. Remove an account from this instance (instance owners, in the web app).",
  description:
    `An instance owner's act in the web app, never an agent's. Needs the account's address typed exactly as email, and confirm set to exactly "${DELETE_CONFIRMATION}". ` +
    "Does what a person deleting their own account does: ends every browser session and agent connection the account holds, takes every role it holds in every organization (each organization's access log records it), cancels the invitations sent to its address, removes the address's allowance to start organizations, deletes what is kept about the person (their counted days of use, the counts held against limits, their name on the account), forgets the address, and mails it a record. Its name stays on what it wrote. An instance owner's account cannot be removed (409 instance_owner), nor one that is the only owner of an organization until someone else owns it or it is deleted (409 last_owner). The address may sign up again only if it is let in again.",
  input: z.strictObject({
    account_id: id("account"),
    email: z.string().trim().max(320).describe("The account's address, typed by the person to confirm."),
    confirm: z.string().describe(`Must be exactly "${DELETE_CONFIRMATION}".`),
  }),
  rest: { method: "POST", path: "/accounts/remove" },
  mcp: { tool: "products", action: "remove_account" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    checkConfirmation(input.confirm, "leave the account as it is");
    const account = await lockAccount(ctx, input.account_id);
    if (!account) throw notFound("No such account on this instance. It may have been removed already.");
    if (input.email.toLowerCase() !== account.email.toLowerCase())
      throw invalid("typed_email", `Type the account's address exactly to remove it. Nothing was changed.`);
    await refuseBlocked(ctx, account, false);
    const ended = await endAccount(ctx, account, false);
    return { removed: true, ...ended, notice_sent: await sendRecord(ctx, account, false) };
  },
});

/** When this browser signed in, and whether that was recent enough to delete its account. */
function signedInRecently(ctx: OpContext): { signed_in_at: string | null; recent_until: string | null } {
  const at = ctx.principal.signed_in_at ?? null;
  const until = at ? new Date(Date.parse(at) + RECENT_SIGN_IN_MINUTES * 60_000).toISOString() : null;
  return { signed_in_at: at, recent_until: until && Date.parse(until) > Date.parse(ctx.now) ? until : null };
}

export const accountDeleteImpact = defineOperation({
  name: "products.delete_account_impact",
  scope: "account",
  access: "any",
  mutates: false,
  webOnly: true,
  summary: "Preview what deleting your own account would do, and what stops it (in the web app).",
  description:
    "Read-only. What the web app shows a person before they delete their own account: their address, the organizations they hold roles in and the ones they are the only owner of (each blocks it until someone else owns it or it is deleted), whether they own the instance (which blocks it), how many browser sessions and agent connections end, the invitations and allowance their address loses, and until when this browser's sign-in is recent enough to delete (null: sign in again first).",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/me/delete-impact" },
  mcp: { tool: "products", action: "delete_account_impact" },
  async handler(ctx) {
    const id = ctx.principal.account_id;
    const account = await ctx.db.selectFrom("accounts").select(["email", "display_name", "created_at"]).where("account_id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!account) throw notFound("This account was deleted.");
    const grants = await ctx.db
      .selectFrom("memberships as m")
      .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
      .select(["m.scope_type", "m.role", "t.tenant_id", "t.slug", "t.name", "t.example"])
      .where("m.account_id", "=", id)
      .execute();
    const alone = new Set((await ownedAlone(ctx, id)).map((o) => o.tenant_id));
    const orgs = new Map<string, { slug: string; name: string; role: string | null; roles: number; only_owner: boolean; example?: true }>();
    for (const g of grants) {
      const o = orgs.get(g.tenant_id) ?? { slug: g.slug, name: g.name, role: null, roles: 0, only_owner: alone.has(g.tenant_id), ...(g.example ? { example: true as const } : {}) };
      if (g.scope_type === "tenant") o.role = g.role;
      else o.roles += 1;
      orgs.set(g.tenant_id, o);
    }
    const address = account.email.toLowerCase();
    const sessions = await ctx.db.selectFrom("sessions").select((eb) => eb.fn.countAll<string>().as("n")).where("account_id", "=", id).where("expires_at", ">", ctx.now).executeTakeFirst();
    const agents = await ctx.db
      .selectFrom("oauth_tokens")
      .select((eb) => eb.fn.count<string>("family_id").distinct().as("n"))
      .where("account_id", "=", id)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", ctx.now)
      .executeTakeFirst();
    const invitations = await ctx.db
      .selectFrom("invitations")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where(sql<boolean>`lower(email) = ${address}`)
      .where("accepted_at", "is", null)
      .where("expires_at", ">", ctx.now)
      .executeTakeFirst();
    const allowance = await ctx.db.selectFrom("tenant_allowances").select("allowed").where("email", "=", address).executeTakeFirst();
    const organizations = [...orgs.values()].sort((x, y) => x.name.localeCompare(y.name));
    return {
      email: account.email,
      display_name: account.display_name,
      created_at: account.created_at,
      instance_owner: isInstanceOwner(ctx.ports.config, account.email),
      organizations,
      only_owner_of: organizations.filter((o) => o.only_owner).map((o) => ({ slug: o.slug, name: o.name })),
      sessions: Number(sessions?.n ?? 0),
      agents: Number(agents?.n ?? 0),
      invitations: Number(invitations?.n ?? 0),
      allowance: Boolean(allowance),
      ...signedInRecently(ctx),
      recent_sign_in_minutes: RECENT_SIGN_IN_MINUTES,
      record_mailed: ctx.ports.config.sendsMail !== false && Boolean(ctx.ports.mailer),
    };
  },
});

export const deleteAccount = defineOperation({
  name: "products.delete_account",
  scope: "account",
  access: "any",
  mutates: true,
  connection: "admin",
  webOnly: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Delete your own account (in the web app).",
  description:
    `A person's own act in the web app, never an agent's. Needs a browser that signed in within the last ${RECENT_SIGN_IN_MINUTES} minutes (403 sign_in_again otherwise), the account's address typed exactly as email, and confirm set to exactly "${DELETE_CONFIRMATION}". ` +
    "Does what an instance owner's removal does: ends every browser session and agent connection, this one too, takes every role in every organization (each organization's access log records it), cancels the invitations to the address and its allowance, deletes the person's counted days of use, the counts held against limits and their name on the account, forgets the address, and mails it a record. What they wrote stays with each organization under the name they had. Refused to an owner of the instance (409 instance_owner) and to the only owner of an organization until someone else owns it or it is deleted (409 last_owner, naming each).",
  input: z.strictObject({
    email: z.string().trim().max(320).describe("The account's address, typed by the person to confirm."),
    confirm: z.string().describe(`Must be exactly "${DELETE_CONFIRMATION}".`),
  }),
  rest: { method: "POST", path: "/me/delete" },
  mcp: { tool: "products", action: "delete_account" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, "keep your account");
    const account = await lockAccount(ctx, ctx.principal.account_id);
    if (!account) throw notFound("This account was deleted already.");
    if (input.email.toLowerCase() !== account.email.toLowerCase())
      throw invalid("typed_email", `Type your address, ${account.email}, exactly to delete your account. Nothing was changed.`);
    await refuseBlocked(ctx, account, true);
    const recent = signedInRecently(ctx);
    if (!recent.recent_until)
      throw new AppError(
        403,
        "sign_in_again",
        `To delete your account, sign in again first: this browser signed in more than ${RECENT_SIGN_IN_MINUTES} minutes ago, and it may not be you using it. Nothing was changed.`,
        { signed_in_at: recent.signed_in_at, minutes: RECENT_SIGN_IN_MINUTES },
      );
    const ended = await endAccount(ctx, account, true);
    return { deleted: true, ...ended, notice_sent: await sendRecord(ctx, account, true) };
  },
});

export const accountOps = [listAccounts, removeAccount, accountDeleteImpact, deleteAccount];
