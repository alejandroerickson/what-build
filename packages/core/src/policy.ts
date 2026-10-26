import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError, forbidden, invalid, notFound } from "./errors.ts";
import type { Plan } from "./limits.ts";
import type { OpAccess, OperationDef, OpScope, Principal, ProductRole, ReportedRole, Scope, TenantRole } from "./registry.ts";
import { refuseNullCharacters, withArticle } from "./schemas.ts";
import { tenantAllowanceOf, type AllowanceConfig } from "./tenant-allowance.ts";
import { ULID_PATTERN } from "./util.ts";

/**
 * The one policy module both front doors go through. Roles exist at three levels:
 *
 * | Level   | Roles                         | Grants                                                     |
 * |---------|-------------------------------|------------------------------------------------------------|
 * | Tenant  | owner, admin, member, guest   | owner/admin: admin of every team and product in the tenant |
 * | Team    | admin, editor, viewer, reader | the same role on every product in the team                 |
 * | Product | admin, editor, viewer, reader | that product only                                          |
 *
 * The effective role is the highest that applies; a product grant can raise access but never
 * lower an inherited one. A caller with no role on a product cannot see it at all: 404, never 403.
 * A caller who can see it but lacks the role gets 403 naming the role they have and the one needed.
 * A `reader` reaches only the operations whose access is `story`: the Story, never the evidence.
 *
 * In the example organization, every account with no grant there is a `guest`: a viewer of every
 * product, a grant `membershipsFor` makes and nobody stores. A guest writes nothing (`execute`).
 */

const RANK: Record<ProductRole, number> = { reader: 0, viewer: 1, editor: 2, admin: 3 };
const TENANT_RANK: Record<TenantRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export const PRODUCT_ROLES: ProductRole[] = ["reader", "viewer", "editor", "admin"];
export const TENANT_ROLES: TenantRole[] = ["member", "admin", "owner"];

export function maxRole(a: ProductRole | null, b: ProductRole | null): ProductRole | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export function roleAtLeast(role: ProductRole | null, needed: ProductRole): boolean {
  return role !== null && RANK[role] >= RANK[needed];
}

/** A reader sees the Story without the notes agents keep about its pages, and nothing of the evidence behind it. */
export function readsOnlyTheStory(role: ReportedRole | null): boolean {
  return role === "reader";
}

/**
 * Whether someone reads only the Story wherever they are in an organization: a reader on its teams
 * or products, with no higher role there and no organization role but member. Such a person sees
 * none of the organization's people.
 */
export function readsOnlyTheStoryIn(memberships: MembershipRow[], tenantId: string): boolean {
  const here = memberships.filter((m) => m.tenant_id === tenantId);
  if (here.some((m) => m.scope_type === "tenant" && m.role !== "member")) return false;
  const roles = here.filter((m) => m.scope_type !== "tenant").map((m) => m.role);
  return roles.length > 0 && roles.every((r) => r === "reader");
}

/**
 * The role an answer reports as `your_role` where someone holds `role`: a guest of the example
 * organization is `guest`, a viewer in everything it may do, as the organization's own role says.
 */
export function reportedRole(role: ProductRole | null, tenantRole: TenantRole | null): ReportedRole | null {
  return role && tenantRole === "guest" ? "guest" : role;
}

export function tenantRoleAtLeast(role: TenantRole | null, needed: TenantRole): boolean {
  return role !== null && TENANT_RANK[role] >= TENANT_RANK[needed];
}

interface MembershipRow {
  tenant_id: string;
  scope_type: string;
  scope_id: string;
  role: string;
}

/** A guest's grant: every account holds it in the example organization unless it holds another there. */
function guestGrant(tenantId: string): MembershipRow {
  return { tenant_id: tenantId, scope_type: "tenant", scope_id: tenantId, role: "guest" };
}

/** The content role a grant gives where it applies: an organization's owner or admin is an admin there, a guest a viewer, a member nothing. */
function grantedRole(m: MembershipRow): ProductRole | null {
  if (m.scope_type !== "tenant") return m.role as ProductRole;
  return m.role === "owner" || m.role === "admin" ? "admin" : m.role === "guest" ? "viewer" : null;
}

export function effectiveRole(
  memberships: MembershipRow[],
  ids: { tenant_id: string; team_id?: string | null; product_id?: string | null },
): { role: ProductRole | null; tenantRole: TenantRole | null } {
  let role: ProductRole | null = null;
  let tenantRole: TenantRole | null = null;
  for (const m of memberships) {
    if (m.scope_type === "tenant" && m.scope_id === ids.tenant_id) {
      tenantRole = m.role as TenantRole;
      role = maxRole(role, grantedRole(m));
    } else if (m.scope_type === "team" && ids.team_id && m.scope_id === ids.team_id) {
      role = maxRole(role, m.role as ProductRole);
    } else if (m.scope_type === "product" && ids.product_id && m.scope_id === ids.product_id) {
      role = maxRole(role, m.role as ProductRole);
    }
  }
  return { role, tenantRole };
}

/**
 * Someone's roles inside a connector's scope, which decide what its tool list offers: `role` where
 * a product's operation lands, `teamRole` where a team's does, and `tenantRole` on the organization.
 * Scoped to a product, they are the roles there; scoped to an organization, the highest anywhere
 * in it (`highestRolesIn`). Uncapped by the connection's level, which its own filter applies.
 */
export interface Standing {
  role: ProductRole | null;
  teamRole: ProductRole | null;
  tenantRole: TenantRole | null;
}

/**
 * The highest roles someone holds in an organization, from its grants there: on any of its
 * products, and on any of its teams, which a product's grant does not reach. The organization's
 * own grant counts for both, as `effectiveRole` reads it.
 */
export function highestRolesIn(memberships: MembershipRow[], tenantId: string): Standing {
  const standing: Standing = { role: null, teamRole: null, tenantRole: null };
  for (const m of memberships) {
    if (m.tenant_id !== tenantId) continue;
    if (m.scope_type === "tenant") standing.tenantRole = m.role as TenantRole;
    standing.role = maxRole(standing.role, grantedRole(m));
    if (m.scope_type !== "product") standing.teamRole = maxRole(standing.teamRole, grantedRole(m));
  }
  return standing;
}

/**
 * Whether someone of this standing may call an operation, as `resolveScope` and `execute` decide
 * and as an organization's operation declares in `needsSomewhere`: a guest writes nothing, a
 * reader reads only the Story, and an organization's owner and admin actions need that role on
 * it. Anything else a handler checks is not read, so such a call may be offered and then refused.
 */
export function roleReaches(op: Pick<OperationDef, "scope" | "access" | "mutates" | "needsSomewhere">, standing: Standing): boolean {
  const { tenantRole } = standing;
  if (op.scope === "account") return true;
  if (op.mutates && tenantRole === "guest") return false;
  if (op.access === "owner") return tenantRoleAtLeast(tenantRole, "owner");
  if (op.scope === "tenant") return op.access === "admin" ? tenantRoleAtLeast(tenantRole, "admin") : !op.needsSomewhere || roleAtLeast(standing.role, op.needsSomewhere);
  // A product's grant reaches its team only to list the team's products.
  const role = op.scope === "team" && op.access !== "read" ? standing.teamRole : standing.role;
  if (!role) return false;
  return op.access === "any" || roleAtLeast(role, ACCESS_ROLE[op.access]);
}

/** The highest roles someone holds in each organization they are in, the example's guest grant among them. */
export function standingsIn(memberships: MembershipRow[]): Standing[] {
  return [...new Set(memberships.map((m) => m.tenant_id))].map((t) => highestRolesIn(memberships, t));
}

/**
 * Whether someone who may start no organization may call an operation somewhere, as the unscoped
 * connector offers it: what their highest roles in any one organization they are in reach, so a
 * guest of the example organization, who writes nothing there, is offered no write for it. Of the
 * account's own operations, starting an organization is the one such a person may not call.
 */
export function reachesAnywhere(op: Pick<OperationDef, "scope" | "access" | "mutates" | "needsSomewhere" | "needsTenantAllowance">, standings: Standing[]): boolean {
  if (op.scope === "account") return !op.needsTenantAllowance;
  return standings.some((s) => roleReaches(op, s));
}

/**
 * The grants an account holds, with a guest's grant in the example organization when it holds none
 * there. The guest grant is made here and nowhere else, and only while the deployment names the
 * example: taking the setting away takes every guest's access with it.
 */
export async function membershipsFor(db: Db, accountId: string, tenantId?: string): Promise<MembershipRow[]> {
  let q = db.selectFrom("memberships as m").select(["m.scope_type", "m.scope_id", "m.role", "m.tenant_id"]).where("m.account_id", "=", accountId);
  if (tenantId) q = q.where("m.tenant_id", "=", tenantId);
  const held: MembershipRow[] = await q.execute();
  let example = db.selectFrom("tenants").select("tenant_id").where("example", "=", true);
  if (tenantId) example = example.where("tenant_id", "=", tenantId);
  const ex = await example.executeTakeFirst();
  if (ex && !held.some((m) => m.tenant_id === ex.tenant_id)) held.push(guestGrant(ex.tenant_id));
  return held;
}

/** Whether a scope is the example organization seen as its guest. */
export function isGuest(scope: Pick<Scope, "tenantRole">): boolean {
  return scope.tenantRole === "guest";
}

/**
 * The refusal of anything a guest of the example organization tries to change. It says where the
 * person's own work goes, as the web app's notice does: an organization they are in; one they may
 * create, as an instance owner or with room in their allowance; or, when they may create none,
 * whoever runs this WhatBuild, so that their agent does not set out to create one and be refused.
 */
export async function exampleReadOnly(db: Db, config: AllowanceConfig, account: Pick<Principal, "account_id" | "email">, tenantName: string, what: string): Promise<AppError> {
  const elsewhere = await db
    .selectFrom("memberships as m")
    .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
    .select("m.tenant_id")
    .where("m.account_id", "=", account.account_id)
    .where("t.example", "=", false)
    .limit(1)
    .executeTakeFirst();
  const own = elsewhere
    ? `Do your own work in an organization you are in: products(action="list") lists them, as the panel of the WhatBuild web app does.`
    : (await tenantAllowanceOf(db, config, account)).remaining !== 0
      ? `To do your own work, create an organization of your own: products(action="create_tenant"), or New organization in the WhatBuild web app.`
      : `This account may not start an organization: for one of your own, ask whoever runs this WhatBuild, or ask someone to invite you to theirs. Do not call products(action="create_tenant"), which would be refused.`;
  return new AppError(
    403,
    "example_read_only",
    `${tenantName} is the example organization: everyone can read it, and nobody but its authors changes it, so ${what} was refused and nothing was changed. ${own}`,
  );
}

/**
 * The id of the tenant a caller names: by its id, its slug, or a slug it had before
 * (`tenant_slugs`), so an address written before its slug changed still reaches it. Nobody else
 * holds a slug it had, and its current slug outranks one another tenant held before.
 */
export function tenantNamed(ref: string) {
  return sql<string>`(select n.tenant_id from (select tenant_id, 0 as rank from tenants where slug = ${ref} or tenant_id = ${ref} union all select tenant_id, 1 from tenant_slugs where slug = ${ref}) n order by n.rank limit 1)`;
}

/** How a caller names a product: its id, or `tenant/team/product` slugs. */
export interface ScopeRef {
  tenant?: string;
  team?: string;
  product?: string;
}

const ACCESS_ROLE: Record<"story" | "read" | "write" | "admin", ProductRole> = { story: "reader", read: "viewer", write: "editor", admin: "admin" };

/** The text without slashes at either end. A loop, since /\/+$/ takes quadratic time on a long run of them. */
function trimSlashes(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === "/") a++;
  while (b > a && s[b - 1] === "/") b--;
  return s.slice(a, b);
}

/** Parse "tenant/team/product" or a bare product id. */
export function parseProductRef(ref: string): ScopeRef {
  const trimmed = trimSlashes(ref.trim());
  if (ULID_PATTERN.test(trimmed)) return { product: trimmed };
  const parts = trimmed.split("/");
  if (parts.length === 3 && parts.every(Boolean)) return { tenant: parts[0]!, team: parts[1]!, product: parts[2]! };
  throw invalid(
    "invalid_product",
    `"${ref}" is not a product reference. Pass a product id, or "tenant/team/product" slugs as products(action="list") shows them.`,
  );
}

/**
 * Resolve and authorize the scope of a call. Returns 404 for anything the caller cannot see
 * (including everything in other tenants) and 403 only when they can see it but lack the role.
 * With `asInstanceOwner`, which `execute` sets only for an owner of this WhatBuild calling a tenant
 * operation that allows them, the caller acts as one of the tenant's owners, member or not.
 * `allowances` lets the refusal of a guest of the example organization say whether they may start
 * an organization of their own.
 */
export async function resolveScope(
  db: Db,
  principal: Principal,
  opScope: OpScope,
  access: OpAccess,
  ref: ScopeRef,
  opName: string,
  { asInstanceOwner = false, allowances = {} }: { asInstanceOwner?: boolean; allowances?: AllowanceConfig } = {},
): Promise<Scope> {
  const empty: Scope = { tenant: null, team: null, product: null, role: null, tenantRole: null };
  if (opScope === "account") return empty;
  // A null character names nothing, and Postgres reads no text that holds one: refused before any lookup.
  refuseNullCharacters({ tenant: ref.tenant, team: ref.team, product: ref.product });

  // A tenant is an organization wherever a person may read the answer, as in the web app.
  const hidden = () => notFound(`No such ${opScope === "tenant" ? "organization" : opScope} is visible to you. It may not exist, or you may not be a member.`);

  let tenant: { tenant_id: string; slug: string; name: string; status: string; example: boolean; plan: string } | undefined;
  let team: { team_id: string; slug: string; name: string; tenant_id: string } | undefined;
  let product:
    | { product_id: string; slug: string; name: string; archived_at: string | null; team_id: string; tenant_id: string }
    | undefined;

  if (opScope === "product") {
    if (!ref.product) throw invalid("product_required", "This call needs a product.");
    if (ULID_PATTERN.test(ref.product) && !ref.team) {
      product = await db
        .selectFrom("products")
        .select(["product_id", "slug", "name", "archived_at", "team_id", "tenant_id"])
        .where("product_id", "=", ref.product)
        .executeTakeFirst();
    } else {
      if (!ref.tenant || !ref.team) throw invalid("invalid_product", "Name the product as tenant/team/product, or by its id.");
      product = await db
        .selectFrom("products as p")
        .innerJoin("teams as tm", "tm.team_id", "p.team_id")
        .innerJoin("tenants as tn", "tn.tenant_id", "p.tenant_id")
        .select(["p.product_id", "p.slug", "p.name", "p.archived_at", "p.team_id", "p.tenant_id"])
        .where("tn.tenant_id", "=", tenantNamed(ref.tenant))
        .where(sql<boolean>`(tm.slug = ${ref.team} or tm.team_id = ${ref.team})`)
        .where(sql<boolean>`(p.slug = ${ref.product} or p.product_id = ${ref.product})`)
        .executeTakeFirst();
    }
    if (!product) throw hidden();
    team = await db.selectFrom("teams").select(["team_id", "slug", "name", "tenant_id"]).where("team_id", "=", product.team_id).executeTakeFirst();
    tenant = await db.selectFrom("tenants").select(["tenant_id", "slug", "name", "status", "example", "plan"]).where("tenant_id", "=", product.tenant_id).executeTakeFirst();
  } else if (opScope === "team") {
    if (!ref.tenant || !ref.team) throw invalid("team_required", "This call needs a team, as tenant/team.");
    team = await db
      .selectFrom("teams as tm")
      .innerJoin("tenants as tn", "tn.tenant_id", "tm.tenant_id")
      .select(["tm.team_id", "tm.slug", "tm.name", "tm.tenant_id"])
      .where("tn.tenant_id", "=", tenantNamed(ref.tenant))
      .where(sql<boolean>`(tm.slug = ${ref.team} or tm.team_id = ${ref.team})`)
      .executeTakeFirst();
    if (!team) throw hidden();
    tenant = await db.selectFrom("tenants").select(["tenant_id", "slug", "name", "status", "example", "plan"]).where("tenant_id", "=", team.tenant_id).executeTakeFirst();
  } else {
    if (!ref.tenant) throw invalid("tenant_required", "This call needs a tenant.");
    tenant = await db
      .selectFrom("tenants")
      .select(["tenant_id", "slug", "name", "status", "example", "plan"])
      .where("tenant_id", "=", tenantNamed(ref.tenant))
      .executeTakeFirst();
  }
  if (!tenant) throw hidden();
  const tenantRef = { tenant_id: tenant.tenant_id, slug: tenant.slug, name: tenant.name, plan: tenant.plan as Plan, ...(tenant.example ? { example: true } : {}) };
  // The instance's owners see every organization already (products.organizations).
  if (asInstanceOwner && opScope === "tenant") return { tenant: tenantRef, team: null, product: null, role: null, tenantRole: "owner" };

  const memberships = await membershipsFor(db, principal.account_id, tenant.tenant_id);
  if (!memberships.length) throw hidden();
  const { role, tenantRole } = effectiveRole(memberships, { tenant_id: tenant.tenant_id, team_id: team?.team_id ?? null, product_id: product?.product_id ?? null });

  const scope: Scope = {
    tenant: tenantRef,
    team: team ? { team_id: team.team_id, slug: team.slug, name: team.name } : null,
    product: product
      ? { product_id: product.product_id, slug: product.slug, name: product.name, archived_at: product.archived_at }
      : null,
    role,
    tenantRole,
  };

  if (opScope === "product" || opScope === "team") {
    // Visibility: any role on the product (or team). A team member who has no product role sees
    // team-level listings only; product content stays hidden.
    if (!role) {
      if (opScope === "team" && memberships.some((m) => m.scope_type === "product")) {
        // Product-only members may list the team's products they can see.
        if (access === "read") return scope;
      }
      throw hidden();
    }
    if (access === "story" || access === "read" || access === "write" || access === "admin") {
      const needed = ACCESS_ROLE[access];
      if (!roleAtLeast(role, needed) && tenantRole === "guest") throw await exampleReadOnly(db, allowances, principal, tenant.name, opName);
      if (!roleAtLeast(role, needed)) {
        const what = opScope === "product" ? `product ${product!.name}` : `team ${team!.name}`;
        throw forbidden(
          `You are ${withArticle(role)} on ${what}; ${opName} needs ${needed}. Ask an admin of the ${opScope} for ${needed} access.`,
          { role, needed },
        );
      }
    } else if (access === "owner" && !tenantRoleAtLeast(tenantRole, "owner")) {
      throw forbidden(`Only an owner of ${tenant.name} can do this.`, { role: tenantRole, needed: "owner" });
    }
  } else if (opScope === "tenant") {
    if ((access === "owner" || access === "admin") && tenantRole === "guest") throw await exampleReadOnly(db, allowances, principal, tenant.name, opName);
    if (access === "owner" && !tenantRoleAtLeast(tenantRole, "owner"))
      throw forbidden(`Only an owner of ${tenant.name} can do this.`, { role: tenantRole, needed: "owner" });
    if (access === "admin" && !tenantRoleAtLeast(tenantRole, "admin"))
      throw forbidden(`This needs an owner or admin of ${tenant.name}.`, { role: tenantRole, needed: "admin" });
  }
  return scope;
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
