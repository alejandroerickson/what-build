import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError, forbidden, invalid, notFound } from "./errors.ts";
import type { OpAccess, OpScope, Principal, ProductRole, Scope, TenantRole } from "./registry.ts";
import { ULID_PATTERN } from "./util.ts";

/**
 * The one policy module both front doors go through. Roles exist at three levels:
 *
 * | Level   | Roles                         | Grants                                                     |
 * |---------|-------------------------------|------------------------------------------------------------|
 * | Tenant  | owner, admin, member, visitor | owner/admin: admin of every team and product in the tenant |
 * | Team    | admin, editor, viewer, reader | the same role on every product in the team                 |
 * | Product | admin, editor, viewer, reader | that product only                                          |
 *
 * The effective role is the highest that applies; a product grant can raise access but never
 * lower an inherited one. A caller with no role on a product cannot see it at all: 404, never 403.
 * A caller who can see it but lacks the role gets 403 naming the role they have and the one needed.
 * A `reader` reaches only the operations whose access is `story`: the Story, never the evidence.
 *
 * In a public sandbox only the tenant's owners and admins administer. A `visitor` is an editor of
 * every product there, and anyone else's role stops at editor.
 */

const RANK: Record<ProductRole, number> = { reader: 0, viewer: 1, editor: 2, admin: 3 };
const TENANT_RANK: Record<TenantRole, number> = { visitor: 0, member: 1, admin: 2, owner: 3 };

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

/** A reader sees the Story without what it draws on: no references, cited passages or notes for agents. */
export function readsOnlyTheStory(role: ProductRole | null): boolean {
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

export function tenantRoleAtLeast(role: TenantRole | null, needed: TenantRole): boolean {
  return role !== null && TENANT_RANK[role] >= TENANT_RANK[needed];
}

interface MembershipRow {
  tenant_id: string;
  scope_type: string;
  scope_id: string;
  role: string;
  /** Whether the grant's tenant is a public sandbox, as `membershipsFor` reports it. */
  sandbox?: boolean;
}

/** In a public sandbox, the people who run it: the tenant's owners and admins. Everyone else is a visitor. */
export function isSandboxStaff(tenantRole: TenantRole | null): boolean {
  return tenantRole === "owner" || tenantRole === "admin";
}

export function effectiveRole(
  memberships: MembershipRow[],
  ids: { tenant_id: string; team_id?: string | null; product_id?: string | null },
  /** Whether the tenant is a public sandbox, where nobody but its staff administers. The grants say so themselves. */
  sandbox = memberships.some((m) => m.tenant_id === ids.tenant_id && m.sandbox),
): { role: ProductRole | null; tenantRole: TenantRole | null } {
  let role: ProductRole | null = null;
  let tenantRole: TenantRole | null = null;
  for (const m of memberships) {
    if (m.scope_type === "tenant" && m.scope_id === ids.tenant_id) {
      tenantRole = m.role as TenantRole;
      if (m.role === "owner" || m.role === "admin") role = maxRole(role, "admin");
      else if (m.role === "visitor" && sandbox) role = maxRole(role, "editor");
    } else if (m.scope_type === "team" && ids.team_id && m.scope_id === ids.team_id) {
      role = maxRole(role, m.role as ProductRole);
    } else if (m.scope_type === "product" && ids.product_id && m.scope_id === ids.product_id) {
      role = maxRole(role, m.role as ProductRole);
    }
  }
  if (sandbox && role === "admin" && !isSandboxStaff(tenantRole)) role = "editor";
  return { role, tenantRole };
}

/**
 * The grants an account holds. A visitor's grant counts only while its tenant is a public sandbox,
 * so closing the sandbox takes every visitor's access with it.
 */
export async function membershipsFor(db: Db, accountId: string, tenantId?: string): Promise<(MembershipRow & { sandbox: boolean })[]> {
  let q = db
    .selectFrom("memberships as m")
    .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
    .select(["m.scope_type", "m.scope_id", "m.role", "m.tenant_id", "t.sandbox"])
    .where("m.account_id", "=", accountId)
    .where((eb) => eb.or([eb("m.role", "!=", "visitor"), eb("t.sandbox", "=", true)]));
  if (tenantId) q = q.where("m.tenant_id", "=", tenantId);
  return q.execute();
}

/** How a caller names a product: its id, or `tenant/team/product` slugs. */
export interface ScopeRef {
  tenant?: string;
  team?: string;
  product?: string;
}

const ACCESS_ROLE: Record<"story" | "read" | "write" | "admin", ProductRole> = { story: "reader", read: "viewer", write: "editor", admin: "admin" };

/** Parse "tenant/team/product" or a bare product id. */
export function parseProductRef(ref: string): ScopeRef {
  const trimmed = ref.trim().replace(/^\/+|\/+$/g, "");
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
 */
export async function resolveScope(
  db: Db,
  principal: Principal,
  opScope: OpScope,
  access: OpAccess,
  ref: ScopeRef,
  opName: string,
): Promise<Scope> {
  const empty: Scope = { tenant: null, team: null, product: null, role: null, tenantRole: null };
  if (opScope === "account") return empty;

  const hidden = () => notFound(`No such ${opScope} is visible to you. It may not exist, or you may not be a member.`);

  let tenant: { tenant_id: string; slug: string; name: string; status: string; sandbox: boolean } | undefined;
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
        .where(sql<boolean>`(tn.slug = ${ref.tenant} or tn.tenant_id = ${ref.tenant})`)
        .where(sql<boolean>`(tm.slug = ${ref.team} or tm.team_id = ${ref.team})`)
        .where(sql<boolean>`(p.slug = ${ref.product} or p.product_id = ${ref.product})`)
        .executeTakeFirst();
    }
    if (!product) throw hidden();
    team = await db.selectFrom("teams").select(["team_id", "slug", "name", "tenant_id"]).where("team_id", "=", product.team_id).executeTakeFirst();
    tenant = await db.selectFrom("tenants").select(["tenant_id", "slug", "name", "status", "sandbox"]).where("tenant_id", "=", product.tenant_id).executeTakeFirst();
  } else if (opScope === "team") {
    if (!ref.tenant || !ref.team) throw invalid("team_required", "This call needs a team, as tenant/team.");
    team = await db
      .selectFrom("teams as tm")
      .innerJoin("tenants as tn", "tn.tenant_id", "tm.tenant_id")
      .select(["tm.team_id", "tm.slug", "tm.name", "tm.tenant_id"])
      .where(sql<boolean>`(tn.slug = ${ref.tenant} or tn.tenant_id = ${ref.tenant})`)
      .where(sql<boolean>`(tm.slug = ${ref.team} or tm.team_id = ${ref.team})`)
      .executeTakeFirst();
    if (!team) throw hidden();
    tenant = await db.selectFrom("tenants").select(["tenant_id", "slug", "name", "status", "sandbox"]).where("tenant_id", "=", team.tenant_id).executeTakeFirst();
  } else {
    if (!ref.tenant) throw invalid("tenant_required", "This call needs a tenant.");
    tenant = await db
      .selectFrom("tenants")
      .select(["tenant_id", "slug", "name", "status", "sandbox"])
      .where(sql<boolean>`(slug = ${ref.tenant} or tenant_id = ${ref.tenant})`)
      .executeTakeFirst();
  }
  if (!tenant) throw hidden();

  const memberships = await membershipsFor(db, principal.account_id, tenant.tenant_id);
  if (!memberships.length) throw hidden();
  const { role, tenantRole } = effectiveRole(
    memberships,
    { tenant_id: tenant.tenant_id, team_id: team?.team_id ?? null, product_id: product?.product_id ?? null },
    tenant.sandbox,
  );

  const scope: Scope = {
    tenant: { tenant_id: tenant.tenant_id, slug: tenant.slug, name: tenant.name, ...(tenant.sandbox ? { sandbox: true } : {}) },
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
      if (!roleAtLeast(role, needed)) {
        const what = opScope === "product" ? `product ${product!.name}` : `team ${team!.name}`;
        throw forbidden(
          `You are a ${role} on ${what}; ${opName} needs ${needed}. Ask an admin of the ${opScope} for ${needed} access.`,
          { role, needed },
        );
      }
    } else if (access === "owner" && !tenantRoleAtLeast(tenantRole, "owner")) {
      throw forbidden(`Only an owner of ${tenant.name} can do this.`, { role: tenantRole, needed: "owner" });
    }
  } else if (opScope === "tenant") {
    if (access === "owner" && !tenantRoleAtLeast(tenantRole, "owner"))
      throw forbidden(`Only an owner of ${tenant.name} can do this.`, { role: tenantRole, needed: "owner" });
    if (access === "admin" && !tenantRoleAtLeast(tenantRole, "admin"))
      throw forbidden(`This needs a tenant admin of ${tenant.name}.`, { role: tenantRole, needed: "admin" });
  }
  return scope;
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
