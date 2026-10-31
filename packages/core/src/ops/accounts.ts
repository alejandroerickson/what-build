import { sql } from "kysely";
import { z } from "zod";
import { ACCOUNT_DELETION, RECENT_SIGN_IN_MINUTES } from "../account-deletion.ts";
import { endSignIns } from "../accounts.ts";
import { json } from "../db.ts";
import { checkConfirmation, DELETE_CONFIRMATION } from "../deletion.ts";
import { AppError, conflict, forbidden, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { id, wordList } from "../schemas.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";
import { forgetPerson } from "../usage.ts";
import { newId, utcDay } from "../util.ts";
import { destroyOrganization, refuseExample } from "./deletes.ts";

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
  webOnly: "a person does it in the web app, on People (`/people`)",
  mutates: false,
  summary: "Every account on this instance, with the organizations each is in and when it was last seen (instance owners).",
  description:
    "For the instance's owners: each account's name, address, when it was made and last seen (its newest browser session or agent connection), how many browser sessions and agent connections it holds now, whether it owns the instance, the allowance its address has to start organizations, and every organization it holds a role in, with its role on the organization (null when its roles are on teams or products only), how many team and product roles it holds there, and only_owner when nobody else owns it, so removing the account would delete it. query keeps the accounts whose name or address contains it. Names no product and holds none of an organization's content. Remove an account in the web app, on People.",
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
    // How many owners each organization has, so an account that is the only one is marked.
    const tenantIds = [...new Set(grants.map((g) => g.tenant_id))];
    const owners = tenantIds.length
      ? await ctx.db
          .selectFrom("memberships")
          .select(["tenant_id", (eb) => eb.fn.countAll<string>().as("n")])
          .where("tenant_id", "in", tenantIds)
          .where("scope_type", "=", "tenant")
          .where("role", "=", "owner")
          .groupBy("tenant_id")
          .execute()
      : [];
    const allowances = await ctx.db.selectFrom("tenant_allowances").select(["email", "allowed"]).where(sql<string>`email`, "in", accounts.map((a) => a.email.toLowerCase())).execute();
    // An allowance counts the organizations started that are on the plan new ones start on and not read-only (tenant-allowance.ts).
    const created = await ctx.db
      .selectFrom("tenants")
      .select([sql<string>`created_by->>'account_id'`.as("account_id"), (eb) => eb.fn.countAll<string>().as("n")])
      .where(sql<string>`created_by->>'account_id'`, "in", ids)
      .where("plan", "=", ctx.ports.config.newOrganizationPlan ?? "unlimited")
      .where("read_only_since", "is", null)
      .groupBy(sql`created_by->>'account_id'`)
      .execute();
    const latest = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    const items = accounts.map((a) => {
      const s = sessions.find((x) => x.account_id === a.account_id);
      const g = agents.find((x) => x.account_id === a.account_id);
      const orgs = new Map<string, { slug: string; name: string; role: string | null; roles: number; example?: true; only_owner?: true }>();
      for (const m of grants.filter((x) => x.account_id === a.account_id)) {
        const o = orgs.get(m.tenant_id) ?? { slug: m.slug, name: m.name, role: null, roles: 0, ...(m.example ? { example: true as const } : {}) };
        if (m.scope_type === "tenant") o.role = m.role;
        else o.roles += 1;
        if (m.scope_type === "tenant" && m.role === "owner" && Number(owners.find((x) => x.tenant_id === m.tenant_id)?.n ?? 0) === 1) o.only_owner = true;
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
/**
 * Refuse ending an account that owns this WhatBuild, or that is the only owner of an organization.
 * An instance owner removing someone may take those organizations with the account instead, once
 * `named` lists each of them by slug; they are returned, to be deleted.
 */
async function refuseBlocked(ctx: OpContext, account: Ending, self: boolean, named: string[] = []): Promise<{ tenant_id: string; slug: string; name: string }[]> {
  if (isInstanceOwner(ctx.ports.config, account.email))
    throw conflict(
      "instance_owner",
      self
        ? "Owners of this WhatBuild can’t delete their accounts. Remove your email address from WHATBUILD_INSTANCE_OWNERS first. Nothing was changed."
        : `${account.display_name} owns this WhatBuild (WHATBUILD_INSTANCE_OWNERS), so their account can’t be removed. Nothing was changed.`,
    );
  const alone = await ownedAlone(ctx, account.account_id);
  const listed = new Set(named.map((s) => s.toLowerCase()));
  const agreed = !self && alone.length === listed.size && alone.every((o) => listed.has(o.slug.toLowerCase()));
  const them = alone.length === 1 ? "it" : "them";
  if (alone.length && !agreed)
    throw conflict(
      "last_owner",
      self
        ? `You’re the only owner of ${alone.map((o) => o.name).join(", ")}. Make someone else owner, or delete ${them}, then try again. Nothing was changed.`
        : `${account.display_name} is the only owner of ${alone.map((o) => o.name).join(", ")}. Removing the account deletes ${them} too, with everything in ${them}: name ${alone.length === 1 ? "its slug" : "their slugs"} in delete_organizations to go ahead, or make someone else an owner there first. Nothing was changed.`,
      { organizations: alone.map((o) => ({ slug: o.slug, name: o.name })) },
    );
  if (!alone.length && listed.size)
    throw invalid("invalid_input", `${account.display_name} is the only owner of no organization, so delete_organizations must be left out. Nothing was changed.`);
  return alone;
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
        channel: ctx.actor.surface, action: self ? "account_deleted" : "account_removed", entity_type: "membership", entity_id: id, entity_title: account.display_name,
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
 * The confirmation, to the address the account had: a record for the person, and an alarm for one
 * who didn't do it. A deployment that sends no mail sends none, and a mail that fails never
 * keeps the account: the result says whether it went.
 */
async function sendRecord(ctx: OpContext, account: Ending, self: boolean, organizationsDeleted: { name: string }[] = []): Promise<boolean> {
  const mailer = ctx.ports.mailer;
  if (!mailer || ctx.ports.config.sendsMail === false) return false;
  const contact = ctx.ports.config.privacyContact;
  const runner = `whoever runs this WhatBuild${contact ? ` (${contact})` : ""}`;
  const t = ACCOUNT_DELETION;
  try {
    await mailer.send({
      to: account.email,
      subject: "Your WhatBuild account has been deleted",
      text:
        `Your WhatBuild account ${account.email} on ${ctx.ports.config.publicBaseUrl} was deleted on ${utcDay(ctx.now)} (UTC)${self ? "." : " by an owner of this WhatBuild."}\n\n` +
        `${t.did.map((g) => `- ${g}`).join("\n")}\n` +
        (organizationsDeleted.length
          ? `- ${wordList(organizationsDeleted.map((o) => o.name))} ${organizationsDeleted.length === 1 ? "was" : "were"} deleted too, with everything in ${organizationsDeleted.length === 1 ? "it" : "them"}: you were ${organizationsDeleted.length === 1 ? "its" : "their"} only owner.\n\n` +
            `Anything you added to any other organization stays there, with your name on it. To remove it, ask that organization’s admins.\n\n`
          : `\n${t.stays} To remove it, ask the organization’s admins.\n\n`) +
        `${t.again}\n\n` +
        (self ? `If this wasn’t you, someone used a browser signed in to your account. Contact ${runner} right away.\n` : `If you didn’t expect this, contact ${runner}.\n`),
    });
    return true;
  } catch (e) {
    console.error(`account deletion: the confirmation was not mailed: ${(e as Error).message}`);
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
  webOnly: "a person does it in the web app, on People (`/people`), Remove on the account",
  summary: "REMOVE PERMANENTLY — cannot be undone. Remove an account from this instance (instance owners, in the web app).",
  description:
    `An instance owner's act in the web app, never an agent's. Needs the account's address typed exactly as email, and confirm set to exactly "${DELETE_CONFIRMATION}". ` +
    "Does what a person deleting their own account does: ends every browser session and agent connection the account holds, takes every role it holds in every organization (each organization's access log records it), cancels the invitations sent to its address, removes the address's allowance to start organizations, deletes what is kept about the person (their counted days of use, the counts held against limits, their name on the account), forgets the address, and emails it a confirmation. Its name stays on what it wrote. An instance owner's account cannot be removed (409 instance_owner). " +
    "The organizations the account is the only owner of are deleted with it, everything in them and everyone's roles there, once delete_organizations names exactly those organizations by slug: products.accounts marks them only_owner, and the web app shows what each holds before asking. Without that, removing it is refused (409 last_owner, listing them in details.organizations). The example organization is never deleted this way (409 example_organization): make someone else an owner of it first. The address may sign up again only if it is let in again.",
  input: z.strictObject({
    account_id: id("account"),
    email: z.string().trim().max(320).describe("The account's address, typed by the person to confirm."),
    confirm: z.string().describe(`Must be exactly "${DELETE_CONFIRMATION}".`),
    delete_organizations: z
      .array(z.string().trim().min(1).max(200))
      .max(200)
      .optional()
      .describe("The slugs of every organization the account is the only owner of, which are deleted with it. Required, and exact, when there are any."),
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
    const going = await refuseBlocked(ctx, account, false, input.delete_organizations);
    // The organizations only this account owns go first, with everything in them.
    const organizationsDeleted: { slug: string; name: string }[] = [];
    for (const o of going) {
      const t = await ctx.db.selectFrom("tenants").select(["tenant_id", "name", "example"]).where("tenant_id", "=", o.tenant_id).forUpdate().executeTakeFirstOrThrow();
      refuseExample(t);
      await sql`select set_config('app.tenant_id', ${o.tenant_id}, true)`.execute(ctx.db);
      await destroyOrganization(ctx, o.tenant_id);
      organizationsDeleted.push({ slug: o.slug, name: o.name });
    }
    if (going.length) await sql`select set_config('app.tenant_id', '', true)`.execute(ctx.db);
    const ended = await endAccount(ctx, account, false);
    return { removed: true, ...ended, organizations_deleted: organizationsDeleted, notice_sent: await sendRecord(ctx, account, false, organizationsDeleted) };
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
  webOnly: "a person does it in the web app, in their own Settings (`/settings`), Delete account",
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
  webOnly: "a person does it in the web app, in their own Settings (`/settings`), Delete account",
  summary: "DELETE PERMANENTLY — cannot be undone. Delete your own account (in the web app).",
  description:
    `A person's own act in the web app, never an agent's. Needs a browser that signed in within the last ${RECENT_SIGN_IN_MINUTES} minutes (403 sign_in_again otherwise), the account's address typed exactly as email, and confirm set to exactly "${DELETE_CONFIRMATION}". ` +
    "Does what an instance owner's removal does: ends every browser session and agent connection, this one too, takes every role in every organization (each organization's access log records it), cancels the invitations to the address and its allowance, deletes the person's counted days of use, the counts held against limits and their name on the account, forgets the address, and emails it a confirmation. What they wrote stays with each organization under the name they had. Refused to an owner of the instance (409 instance_owner) and to the only owner of an organization until someone else owns it or it is deleted (409 last_owner, naming each).",
  input: z.strictObject({
    email: z.string().trim().max(320).describe("The account's address, typed by the person to confirm."),
    confirm: z.string().describe(`Must be exactly "${DELETE_CONFIRMATION}".`),
  }),
  rest: { method: "POST", path: "/me/delete" },
  mcp: { tool: "products", action: "delete_account" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, "keep your account");
    const account = await lockAccount(ctx, ctx.principal.account_id);
    if (!account) throw notFound("This account has already been deleted.");
    if (input.email.toLowerCase() !== account.email.toLowerCase()) throw invalid("typed_email", "That doesn’t match your email address. Nothing was changed.");
    await refuseBlocked(ctx, account, true);
    const recent = signedInRecently(ctx);
    if (!recent.recent_until)
      throw new AppError(
        403,
        "sign_in_again",
        `Sign in again to delete your account: your last sign-in was more than ${RECENT_SIGN_IN_MINUTES} minutes ago. Nothing was changed.`,
        { signed_in_at: recent.signed_in_at, minutes: RECENT_SIGN_IN_MINUTES },
      );
    const ended = await endAccount(ctx, account, true);
    return { deleted: true, ...ended, notice_sent: await sendRecord(ctx, account, true) };
  },
});

export const accountOps = [listAccounts, removeAccount, accountDeleteImpact, deleteAccount];
