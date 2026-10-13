import { sql } from "kysely";
import { z } from "zod";
import { checkEtag } from "../common.ts";
import { json, type Db } from "../db.ts";
import { forbidden, invalid, notFound, staleEtag } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag } from "../schemas.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";
import { newEtag, quotedName } from "../util.ts";

/**
 * Allowances to create organizations, kept by the instance's owners. They belong to no
 * organization, so they write no activity event: each row keeps who gave it and who changed it last.
 */

const address = z.string().trim().email().max(320).transform((s) => s.toLowerCase());

function requireInstanceOwner(ctx: OpContext) {
  if (!isInstanceOwner(ctx.ports.config, ctx.principal.email))
    throw forbidden("Only an owner of this WhatBuild instance can let people start organizations.");
}

type AllowanceRow = { email: string; allowed: number; note: string; etag: string; created_at: string; created_by: unknown; updated_at: string; updated_by: unknown };

/** Each row as the instance's owners see it: whose account it is and how much of it is used. */
async function views(db: Db, rows: AllowanceRow[]) {
  if (!rows.length) return [];
  const accounts = await db
    .selectFrom("accounts")
    .select(["account_id", "email", "display_name"])
    .where(sql<string>`lower(email)`, "in", rows.map((r) => r.email))
    .where("deleted_at", "is", null)
    .execute();
  const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a]));
  const ids = accounts.map((a) => a.account_id);
  const counts = ids.length
    ? await db
        .selectFrom("tenants")
        .select([sql<string>`created_by->>'account_id'`.as("account_id"), (eb) => eb.fn.countAll<string>().as("n")])
        .where(sql<string>`created_by->>'account_id'`, "in", ids)
        .groupBy(sql`created_by->>'account_id'`)
        .execute()
    : [];
  const created = new Map(counts.map((c) => [c.account_id, Number(c.n)]));
  return rows.map((r) => {
    const account = byEmail.get(r.email) ?? null;
    const n = account ? (created.get(account.account_id) ?? 0) : 0;
    return {
      email: r.email,
      allowed: r.allowed,
      created: n,
      remaining: Math.max(0, r.allowed - n),
      account: account ? { account_id: account.account_id, display_name: account.display_name } : null,
      note: r.note,
      etag: r.etag,
      created_at: r.created_at,
      created_by: r.created_by,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
    };
  });
}

export const listTenantAllowances = defineOperation({
  name: "products.tenant_allowances",
  scope: "account",
  access: "any",
  mutates: false,
  summary: "Who may create organizations, and how many (instance owners).",
  description:
    "Lists every address an instance owner has given an allowance, with how many organizations it may create, how many its account has created, and what is left. Also returns the instance's owners, who may create any number, and default_allowed, the allowance of every address not listed. Being in an organization never lets anyone create one.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/tenant-allowances" },
  mcp: { tool: "products", action: "tenant_allowances" },
  async handler(ctx) {
    requireInstanceOwner(ctx);
    const rows = await ctx.db.selectFrom("tenant_allowances").selectAll().orderBy("updated_at", "desc").orderBy("email").execute();
    return {
      instance_owners: ctx.ports.config.instanceOwners ?? [],
      default_allowed: ctx.ports.config.defaultTenantAllowance ?? 0,
      items: await views(ctx.db, rows),
    };
  },
});

export const setTenantAllowance = defineOperation({
  name: "products.set_tenant_allowance",
  scope: "account",
  access: "any",
  mutates: true,
  connection: "admin",
  summary: "Let an address create a number of organizations, or change how many (instance owners).",
  description:
    "allowed counts every organization the address's account has created, so 1 with one already created lets it create no more. 0 lets it create none, whatever the default. The address need not have an account yet: while sign-up is limited, an allowance above 0 also lets it sign up. To change an existing allowance pass expected_etag from products(action=\"tenant_allowances\"). With notify (the default), an address whose allowance grows is told by email where to start. Use remove_tenant_allowance to return an address to the default.",
  input: z.strictObject({
    email: address,
    allowed: z.number().int().min(0).max(1000),
    note: z.string().trim().max(200).optional().describe("Why, for the instance's owners. Never shown to the person."),
    expected_etag: expectedEtag.optional().describe("Required when the address already has an allowance."),
    notify: z.boolean().default(true),
  }),
  rest: { method: "PUT", path: "/tenant-allowances" },
  mcp: { tool: "products", action: "set_tenant_allowance" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    if (isInstanceOwner(ctx.ports.config, input.email))
      throw invalid("instance_owner", `${input.email} is an owner of this instance and can already start any number of organizations.`);
    const existing = await ctx.db.selectFrom("tenant_allowances").selectAll().where("email", "=", input.email).forUpdate().executeTakeFirst();
    const actor = json(ctx.actor);
    if (existing) {
      if (!input.expected_etag) throw staleEtag(existing.etag, "allowance");
      checkEtag(input.expected_etag, existing.etag, "allowance");
      await ctx.db
        .updateTable("tenant_allowances")
        .set({ allowed: input.allowed, ...(input.note !== undefined ? { note: input.note } : {}), etag: newEtag(), updated_at: ctx.now, updated_by: actor })
        .where("email", "=", input.email)
        .execute();
    } else {
      await ctx.db
        .insertInto("tenant_allowances")
        .values({ email: input.email, allowed: input.allowed, note: input.note ?? "", etag: newEtag(), created_at: ctx.now, created_by: actor, updated_at: ctx.now, updated_by: actor })
        .execute();
    }
    const row = await ctx.db.selectFrom("tenant_allowances").selectAll().where("email", "=", input.email).executeTakeFirstOrThrow();
    const [view] = await views(ctx.db, [row]);
    const before = existing ? existing.allowed : (ctx.ports.config.defaultTenantAllowance ?? 0);
    let notified = false;
    if (input.notify && input.allowed > before && view!.remaining > 0 && ctx.ports.mailer) {
      const n = input.allowed;
      const who = quotedName(ctx.actor.display_name);
      await ctx.ports.mailer.send({
        to: input.email,
        subject: `${who} let you start ${n === 1 ? "an organization" : "organizations"} on WhatBuild`,
        text:
          `${who} let you start ${n === 1 ? "one organization" : `up to ${n} organizations`} on WhatBuild.\n\n` +
          `Sign in with this email to start one:\n${ctx.ports.config.publicBaseUrl}/welcome\n`,
      });
      notified = true;
    }
    return { ...view!, notified };
  },
});

export const removeTenantAllowance = defineOperation({
  name: "products.remove_tenant_allowance",
  scope: "account",
  access: "any",
  mutates: true,
  connection: "admin",
  summary: "Return an address to the default allowance (instance owners).",
  description:
    "Removes the allowance an instance owner gave the address, so it may create as many organizations as default_allowed, counting those it created. Organizations it already created stay as they are. Pass expected_etag from products(action=\"tenant_allowances\").",
  input: z.strictObject({ email: address, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/tenant-allowances/remove" },
  mcp: { tool: "products", action: "remove_tenant_allowance" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    const existing = await ctx.db.selectFrom("tenant_allowances").select("etag").where("email", "=", input.email).forUpdate().executeTakeFirst();
    if (!existing) throw notFound(`${input.email} has no allowance of its own; it already has the default.`);
    checkEtag(input.expected_etag, existing.etag, "allowance");
    await ctx.db.deleteFrom("tenant_allowances").where("email", "=", input.email).execute();
    return { removed: true, email: input.email, default_allowed: ctx.ports.config.defaultTenantAllowance ?? 0 };
  },
});

export const tenantAllowanceOps = [listTenantAllowances, setTenantAllowance, removeTenantAllowance];
