import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError, forbidden, invalid, notFound } from "./errors.ts";
import type { Plan } from "./limits.ts";
import type { OpAccess, OperationDef, OpScope, Principal, ProductRole, ReportedRole, Scope, TenantRole } from "./registry.ts";
import { refuseNullCharacters, withArticle } from "./schemas.ts";
import { tenantAllowanceOf, type AllowanceConfig } from "./tenant-allowance.ts";
import { ULID_PATTERN } from "./util.ts";

/**
 * The one policy module both front doors go through. Roles are given at three places:
 *
 * | Place         | Roles                                 | Grants                                                       |
 * |---------------|---------------------------------------|--------------------------------------------------------------|
 * | Tenant        | owner, admin, creator, member, guest  | owner/admin: admin of every product; creator: creates products |
 * | All products  | admin, editor, viewer, reader         | that role on every product in the tenant, later ones too     |
 * | Product       | admin, editor, viewer, reader         | that product only                                            |
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
const TENANT_RANK: Record<TenantRole, number> = { guest: 0, member: 1, creator: 2, admin: 3, owner: 4 };

export const PRODUCT_ROLES: ProductRole[] = ["reader", "viewer", "editor", "admin"];
export const TENANT_ROLES: TenantRole[] = ["member", "creator", "admin", "owner"];

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
 * Whether someone reads only the Story wherever they are in an organization: a reader on all its
 * products or on some of them, with no higher role there and no organization role but member or
 * product creator. Such a person sees none of the organization's people.
 */
export function readsOnlyTheStoryIn(memberships: MembershipRow[], tenantId: string): boolean {
  const here = memberships.filter((m) => m.tenant_id === tenantId);
  if (here.some((m) => m.scope_type === "tenant" && m.role !== "member" && m.role !== "creator")) return false;
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

/** The content role a grant gives where it applies: an organization's owner or admin is an admin there, a guest a viewer, a product creator or a member nothing. */
function grantedRole(m: MembershipRow): ProductRole | null {
  if (m.scope_type !== "tenant") return m.role as ProductRole;
  return m.role === "owner" || m.role === "admin" ? "admin" : m.role === "guest" ? "viewer" : null;
}

/**
 * The roles someone holds where a call lands: on the organization, and on a product of it, or,
 * with no product, on all its products. The organization's own role and the role on all products
 * apply to every product; a product's applies to that product only.
 */
export function effectiveRole(
  memberships: MembershipRow[],
  ids: { tenant_id: string; product_id?: string | null },
): { role: ProductRole | null; tenantRole: TenantRole | null } {
  let role: ProductRole | null = null;
  let tenantRole: TenantRole | null = null;
  for (const m of memberships) {
    if (m.scope_type === "tenant" && m.scope_id === ids.tenant_id) {
      tenantRole = m.role as TenantRole;
      role = maxRole(role, grantedRole(m));
    } else if (m.scope_type === "all_products" && m.scope_id === ids.tenant_id) {
      role = maxRole(role, m.role as ProductRole);
    } else if (m.scope_type === "product" && ids.product_id && m.scope_id === ids.product_id) {
      role = maxRole(role, m.role as ProductRole);
    }
  }
  return { role, tenantRole };
}

/**
 * Someone's roles inside a connector's scope, which decide what its tool list offers: `role` where
 * a product's operation lands, and `tenantRole` on the organization. Scoped to a product, they are
 * the roles there; scoped to an organization, the highest anywhere in it (`highestRolesIn`).
 * Uncapped by the connection's level, which its own filter applies.
 */
export interface Standing {
  role: ProductRole | null;
  tenantRole: TenantRole | null;
}

/** The highest roles someone holds in an organization, from its grants there, as `effectiveRole` reads each. */
export function highestRolesIn(memberships: MembershipRow[], tenantId: string): Standing {
  const standing: Standing = { role: null, tenantRole: null };
  for (const m of memberships) {
    if (m.tenant_id !== tenantId) continue;
    if (m.scope_type === "tenant") standing.tenantRole = m.role as TenantRole;
    standing.role = maxRole(standing.role, grantedRole(m));
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
  if (op.scope === "tenant") {
    if (op.access === "admin" || op.access === "creator") return tenantRoleAtLeast(tenantRole, op.access);
    return !op.needsSomewhere || roleAtLeast(standing.role, op.needsSomewhere);
  }
  const role = standing.role;
  if (!role || op.access === "creator") return false;
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
 * Someone who may create none and is on the waitlist already (a row in `interest` with their
 * address) is told so instead, and not to ask again.
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
    ? `Do your own work in an organization you are in: products_read(action="list") lists them, as the panel of the WhatBuild web app does.`
    : (await tenantAllowanceOf(db, config, account)).remaining !== 0
      ? `To do your own work, create an organization of your own: products_write(action="create_tenant"), or New organization in the WhatBuild web app.`
      : (await onTheWaitlist(db, account.email))
        ? `You may not start an organization, and you are on the waitlist for one of your own: organizations open a few at a time. Meanwhile, someone who uses WhatBuild can invite you to theirs. Do not call products_write(action="create_tenant"), which would be refused.`
        : `You may not start an organization: for one of your own, ask whoever runs this WhatBuild, or ask someone to invite you to theirs. Do not call products_write(action="create_tenant"), which would be refused.`;
  return new AppError(
    403,
    "example_read_only",
    `${tenantName} is the example organization: everyone can read it, and nobody but its authors changes it, so ${what} was refused and nothing was changed. ${own}`,
  );
}

/** Whether someone with this address has asked for an organization: the waitlist, matched by lower-cased address. */
async function onTheWaitlist(db: Db, email: string): Promise<boolean> {
  const asked = await db.selectFrom("interest").select("interest_id").where(sql<string>`lower(email)`, "=", email.toLowerCase()).limit(1).executeTakeFirst();
  return asked !== undefined;
}

/**
 * The id of the tenant a caller names: by its id, its slug, or a slug it had before
 * (`tenant_slugs`), so an address written before its slug changed still reaches it. Nobody else
 * holds a slug it had, and its current slug outranks one another tenant held before.
 */
export function tenantNamed(ref: string) {
  return sql<string>`(select n.tenant_id from (select tenant_id, 0 as rank from tenants where slug = ${ref} or tenant_id = ${ref} union all select tenant_id, 1 from tenant_slugs where slug = ${ref}) n order by n.rank limit 1)`;
}

/** How a caller names a product: its id, or `tenant/product` slugs. */
export interface ScopeRef {
  tenant?: string;
  product?: string;
  /**
   * The middle part of a product's address written when products were in teams
   * (`tenant/team/product`), which still reaches the product (`findProduct`).
   */
  formerTeam?: string;
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

/** Parse "tenant/product", a bare product id, or "tenant/team/product" as addresses were written when products were in teams. */
export function parseProductRef(ref: string): ScopeRef {
  const trimmed = trimSlashes(ref.trim());
  if (ULID_PATTERN.test(trimmed)) return { product: trimmed };
  const parts = trimmed.split("/");
  if (parts.length === 2 && parts.every(Boolean)) return { tenant: parts[0]!, product: parts[1]! };
  if (parts.length === 3 && parts.every(Boolean)) return { tenant: parts[0]!, formerTeam: parts[1]!, product: parts[2]! };
  throw invalid(
    "invalid_product",
    `"${ref}" is not a product reference. Pass a product id, or its path, "tenant/product", as products_read(action="list") shows it.`,
  );
}

type ProductRow = { product_id: string; slug: string; name: string; archived_at: string | null; tenant_id: string };
const PRODUCT_COLUMNS = ["p.product_id", "p.slug", "p.name", "p.archived_at", "p.tenant_id"] as const;

/**
 * The product an address names: by its id alone, or by the tenant's id or slug (or a former one)
 * and its own slug or id, which must then be one of that tenant's. An address written when products were in teams (`formerTeam`) reaches the product
 * the migration that removed teams recorded for it, where it had to change the product's slug
 * (`team_addresses`), and otherwise the product of that slug: the team's part names nothing now.
 */
export async function findProduct(db: Db, ref: ScopeRef): Promise<ProductRow | undefined> {
  const product = ref.product!;
  if (!ref.tenant) {
    if (!ULID_PATTERN.test(product)) throw invalid("invalid_product", "Name the product by its path, tenant/product, or by its id.");
    return db.selectFrom("products as p").select(PRODUCT_COLUMNS).where("p.product_id", "=", product).executeTakeFirst();
  }
  if (ref.formerTeam !== undefined) {
    const moved = await db
      .selectFrom("team_addresses as ta")
      .innerJoin("products as p", "p.product_id", "ta.product_id")
      .select(PRODUCT_COLUMNS)
      .where("ta.tenant_id", "=", tenantNamed(ref.tenant))
      .where("ta.team_slug", "=", ref.formerTeam)
      .where("ta.product_slug", "=", product)
      .executeTakeFirst();
    if (moved) return moved;
  }
  return db
    .selectFrom("products as p")
    .select(PRODUCT_COLUMNS)
    .where("p.tenant_id", "=", tenantNamed(ref.tenant))
    .where(sql<boolean>`(p.slug = ${product} or p.product_id = ${product})`)
    .executeTakeFirst();
}

/**
 * Resolve and authorize the scope of a call. Returns 404 for anything the caller cannot see
 * (including everything in other tenants) and 403 only when they can see it but lack the role.
 * With `asInstanceOwner`, which `execute` sets only for an owner of this WhatBuild calling, in the
 * web app, a tenant operation that allows them, the caller acts as one of the tenant's owners,
 * member or not.
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
  const empty: Scope = { tenant: null, product: null, role: null, tenantRole: null };
  if (opScope === "account") return empty;
  // A null character names nothing, and Postgres reads no text that holds one: refused before any lookup.
  refuseNullCharacters({ tenant: ref.tenant, product: ref.formerTeam !== undefined ? `${ref.formerTeam}/${ref.product ?? ""}` : ref.product });

  // A tenant is an organization wherever a person may read the answer, as in the web app.
  const hidden = () => notFound(`No such ${opScope === "tenant" ? "organization" : opScope} is visible to you. It may not exist, or you may not be a member.`);

  let tenant: { tenant_id: string; slug: string; name: string; status: string; example: boolean; plan: string; read_only_since: string | null; kept_until: string | null } | undefined;
  let product: ProductRow | undefined;

  if (opScope === "product") {
    if (!ref.product) throw invalid("product_required", "This call needs a product.");
    product = await findProduct(db, ref);
    if (!product) throw hidden();
    tenant = await db.selectFrom("tenants").select(["tenant_id", "slug", "name", "status", "example", "plan", "read_only_since", "kept_until"]).where("tenant_id", "=", product.tenant_id).executeTakeFirst();
  } else {
    if (!ref.tenant) throw invalid("tenant_required", "This call needs a tenant.");
    tenant = await db
      .selectFrom("tenants")
      .select(["tenant_id", "slug", "name", "status", "example", "plan", "read_only_since", "kept_until"])
      .where("tenant_id", "=", tenantNamed(ref.tenant))
      .executeTakeFirst();
  }
  if (!tenant) throw hidden();
  const tenantRef = {
    tenant_id: tenant.tenant_id, slug: tenant.slug, name: tenant.name, plan: tenant.plan as Plan,
    ...(tenant.example ? { example: true } : {}),
    ...(tenant.read_only_since ? { read_only: { since: tenant.read_only_since, kept_until: tenant.kept_until } } : {}),
  };
  // The instance's owners see every organization already (products.organizations).
  if (asInstanceOwner && opScope === "tenant") return { tenant: tenantRef, product: null, role: null, tenantRole: "owner" };

  const memberships = await membershipsFor(db, principal.account_id, tenant.tenant_id);
  if (!memberships.length) throw hidden();
  const { role, tenantRole } = effectiveRole(memberships, { tenant_id: tenant.tenant_id, product_id: product?.product_id ?? null });

  const scope: Scope = {
    tenant: tenantRef,
    product: product
      ? { product_id: product.product_id, slug: product.slug, name: product.name, archived_at: product.archived_at }
      : null,
    role,
    tenantRole,
  };

  if (opScope === "product") {
    // Visibility: any role on the product. Without one, it does not exist for the caller.
    if (!role) throw hidden();
    if (access === "story" || access === "read" || access === "write" || access === "admin") {
      const needed = ACCESS_ROLE[access];
      if (!roleAtLeast(role, needed) && tenantRole === "guest") throw await exampleReadOnly(db, allowances, principal, tenant.name, opName);
      if (!roleAtLeast(role, needed)) {
        throw forbidden(
          `You are ${withArticle(role)} on product ${product!.name}; ${opName} needs ${needed}. Ask an admin of the product for ${needed} access.`,
          { role, needed },
        );
      }
    } else if (access === "owner" && !tenantRoleAtLeast(tenantRole, "owner")) {
      throw forbidden(`Only an owner of ${tenant.name} can do this.`, { role: tenantRole, needed: "owner" });
    }
  } else if (opScope === "tenant") {
    if ((access === "owner" || access === "admin" || access === "creator") && tenantRole === "guest") throw await exampleReadOnly(db, allowances, principal, tenant.name, opName);
    if (access === "owner" && !tenantRoleAtLeast(tenantRole, "owner"))
      throw forbidden(`Only an owner of ${tenant.name} can do this.`, { role: tenantRole, needed: "owner" });
    if (access === "admin" && !tenantRoleAtLeast(tenantRole, "admin"))
      throw forbidden(`This needs an owner or admin of ${tenant.name}.`, { role: tenantRole, needed: "admin" });
    if (access === "creator" && !tenantRoleAtLeast(tenantRole, "creator"))
      throw forbidden(`Creating a product in ${tenant.name} needs a product creator, admin or owner of it. Ask one of its owners or admins to make you a product creator.`, { role: tenantRole, needed: "creator" });
  }
  return scope;
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
