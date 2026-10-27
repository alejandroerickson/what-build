import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import { planName, UNLIMITED } from "./plans.ts";
import type { CoreConfig } from "./ports.ts";

/**
 * Who may create an organization (a tenant), and how many. An instance owner, named by the
 * deployment, may create any number. Everyone else may have as many as the allowance an instance
 * owner gave their address, or the deployment's default when none was given, counted against the
 * organizations they created that are still on the plan new organizations start on: on a
 * deployment that starts them on Free, one Free organization each, and one moved to Pro, or made
 * read-only, no longer counts. Being in an organization never lets anyone create one.
 */
export interface TenantAllowance {
  instance_owner: boolean;
  /** null: no limit (an instance owner). */
  allowed: number | null;
  /** Organizations this account created that still count: those on the plan new organizations start on, not read-only. */
  created: number;
  /** null: no limit. */
  remaining: number | null;
  /** Where `allowed` comes from. */
  source: "instance_owner" | "given" | "default";
}

/** What deciding who may start an organization reads of the deployment's configuration. */
export type AllowanceConfig = Pick<CoreConfig, "instanceOwners" | "defaultTenantAllowance" | "newOrganizationPlan">;

export function isInstanceOwner(config: Pick<CoreConfig, "instanceOwners">, email: string): boolean {
  return (config.instanceOwners ?? []).includes(email.trim().toLowerCase());
}

/** The organizations an account created that count against its allowance: on `plan`, and not read-only. */
export async function tenantsCreatedBy(db: Db, accountId: string, plan: string): Promise<number> {
  const row = await db
    .selectFrom("tenants")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where(sql<boolean>`created_by->>'account_id' = ${accountId}`)
    .where("plan", "=", plan)
    .where("read_only_since", "is", null)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function tenantAllowanceOf(db: Db, config: AllowanceConfig, account: { account_id: string; email: string }): Promise<TenantAllowance> {
  const created = await tenantsCreatedBy(db, account.account_id, config.newOrganizationPlan ?? UNLIMITED);
  if (isInstanceOwner(config, account.email)) return { instance_owner: true, allowed: null, created, remaining: null, source: "instance_owner" };
  const given = await db.selectFrom("tenant_allowances").select("allowed").where("email", "=", account.email.trim().toLowerCase()).executeTakeFirst();
  const allowed = given ? given.allowed : (config.defaultTenantAllowance ?? 0);
  return { instance_owner: false, allowed, created, remaining: Math.max(0, allowed - created), source: given ? "given" : "default" };
}

/**
 * Refuses an account that may not create another organization. Holds a lock on the account until
 * the transaction ends, so two creations at once cannot both take the last place.
 */
export async function requireTenantAllowance(db: Db, config: AllowanceConfig, account: { account_id: string; email: string }): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`tenant_allowance:${account.account_id}`}, 0))`.execute(db);
  const a = await tenantAllowanceOf(db, config, account);
  if (a.remaining === null || a.remaining > 0) return;
  const details = { allowed: a.allowed, created: a.created };
  if (!a.allowed)
    throw new AppError(
      403,
      "tenant_allowance",
      "This account may not start an organization. Belonging to one does not let anyone create one: the people who run this WhatBuild decide who may, and how many. Ask them, or ask someone to invite you to their organization.",
      details,
    );
  const plan = config.newOrganizationPlan ?? UNLIMITED;
  const kind = plan === UNLIMITED ? "" : `${planName(plan)} `;
  const has = a.created === 1 ? `a ${kind}organization` : `${a.created} ${kind}organizations`;
  const upgrade = plan === UNLIMITED ? "" : ` to move ${a.created === 1 ? "it" : "one"} to another plan, which frees its place, or`;
  throw new AppError(
    403,
    "tenant_allowance",
    `This account already has ${has}, all it may have. Ask the people who run this WhatBuild${upgrade} to let you have more.`,
    details,
  );
}
