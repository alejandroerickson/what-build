import { sql } from "kysely";
import { z } from "zod";
import { endSignIns } from "../accounts.ts";
import { json } from "../db.ts";
import { checkConfirmation, DELETE_CONFIRMATION } from "../deletion.ts";
import { conflict, forbidden, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { id } from "../schemas.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";
import { newId } from "../util.ts";

/**
 * Every account on the instance, for its owners, and removing one. An account belongs to no
 * organization, so listing and removing write no activity event of their own; removing someone from
 * an organization is recorded in that organization's access log, as any removal is.
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
    "Ends every browser session and agent connection the account holds, takes every role it holds in every organization (each organization's access log records it), cancels the invitations sent to its address, removes the address's allowance to start organizations, and forgets the address. Its name stays on what it wrote. An instance owner's account cannot be removed (409 instance_owner), nor one that is the only owner of an organization until someone else owns it or it is deleted (409 last_owner). The address may sign up again only if it is let in again.",
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
    const account = await ctx.db
      .selectFrom("accounts")
      .select(["account_id", "display_name", "email"])
      .where("account_id", "=", input.account_id)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!account) throw notFound("No such account on this instance. It may have been removed already.");
    if (input.email.toLowerCase() !== account.email.toLowerCase())
      throw invalid("typed_email", `Type the account's address exactly to remove it. Nothing was changed.`);
    if (isInstanceOwner(ctx.ports.config, account.email))
      throw conflict("instance_owner", `${account.display_name} owns this instance, as WHATBUILD_INSTANCE_OWNERS says where the service is deployed, so the account can't be removed here. Nothing was changed.`);
    const owned = await ctx.db
      .selectFrom("memberships as m")
      .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
      .select(["t.tenant_id", "t.name", "t.slug"])
      .where("m.account_id", "=", account.account_id)
      .where("m.scope_type", "=", "tenant")
      .where("m.role", "=", "owner")
      .execute();
    const alone = [];
    for (const o of owned) {
      const others = await ctx.db
        .selectFrom("memberships")
        .select("membership_id")
        .where("tenant_id", "=", o.tenant_id)
        .where("scope_type", "=", "tenant")
        .where("role", "=", "owner")
        .where("account_id", "!=", account.account_id)
        .executeTakeFirst();
      if (!others) alone.push(o);
    }
    if (alone.length)
      throw conflict(
        "last_owner",
        `${account.display_name} is the only owner of ${alone.map((o) => o.name).join(", ")}. Make someone else owner there, or delete ${alone.length === 1 ? "it" : "them"}, before removing the account. Nothing was changed.`,
        { organizations: alone.map((o) => ({ slug: o.slug, name: o.name })) },
      );

    const ended = await endSignIns(ctx.db, account.account_id);
    // Each organization the account leaves records it in its access log, as removing someone there would.
    const tenants = await ctx.db
      .selectFrom("memberships as m")
      .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
      .select(["t.tenant_id", "t.name", (eb) => eb.fn.countAll<string>().as("n")])
      .where("m.account_id", "=", account.account_id)
      .groupBy(["t.tenant_id", "t.name"])
      .execute();
    for (const t of tenants) {
      await sql`select set_config('app.tenant_id', ${t.tenant_id}, true)`.execute(ctx.db);
      await ctx.db
        .insertInto("activity")
        .values({
          activity_id: newId(), tenant_id: t.tenant_id, team_id: null, product_id: null, actor: json(ctx.actor), actor_account_id: ctx.actor.account_id,
          channel: ctx.actor.surface, action: "revoked", entity_type: "membership", entity_id: account.account_id, entity_title: account.display_name,
          summary: `Removed from ${t.name} (${Number(t.n)} ${Number(t.n) === 1 ? "role" : "roles"}) with the account, by an owner of this instance`,
        })
        .execute();
    }
    if (tenants.length) await sql`select set_config('app.tenant_id', '', true)`.execute(ctx.db);
    await ctx.db.deleteFrom("memberships").where("account_id", "=", account.account_id).execute();
    const invitations = await ctx.db.deleteFrom("invitations").where(sql<boolean>`lower(email) = lower(${account.email})`).where("accepted_at", "is", null).executeTakeFirst();
    const allowance = await ctx.db.deleteFrom("tenant_allowances").where("email", "=", account.email.toLowerCase()).executeTakeFirst();
    await ctx.db.deleteFrom("email_tokens").where(sql<boolean>`lower(email) = lower(${account.email})`).execute();
    await ctx.db.updateTable("accounts").set({ deleted_at: ctx.now, email: removedAddress(account.account_id) }).where("account_id", "=", account.account_id).execute();
    return {
      removed: true,
      account_id: account.account_id,
      display_name: account.display_name,
      organizations_left: tenants.length,
      sessions_ended: ended.sessions,
      agents_disconnected: ended.connections,
      invitations_cancelled: Number(invitations.numDeletedRows),
      allowance_removed: Number(allowance.numDeletedRows) > 0,
    };
  },
});

export const accountOps = [listAccounts, removeAccount];
