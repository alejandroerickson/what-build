import { AppError } from "./errors.ts";
import { highestRolesIn, membershipsFor, resolveScope, type ScopeRef, type Standing } from "./policy.ts";
import type { Db } from "./db.ts";
import type { OperationDef, Principal, Scope } from "./registry.ts";

/**
 * What a scoped MCP connector may reach: one organization, or one product in it. A scoped connector
 * is a fence, not a default: every call outside it is refused, whatever the caller's roles
 * elsewhere, and the person connects another connector (or the unscoped one) to work there.
 */
export interface ConnectorScope {
  tenant: { tenant_id: string; slug: string; name: string };
  product: { product_id: string; path: string; name: string } | null;
  /** The person's roles inside it, which decide what its tool list offers. */
  standing: Standing;
}

/** Account-level operations a scoped connector still answers: they reach no organization's content. */
const ACCOUNT_OPS_ALLOWED = new Set(["products.list", "guide", "submit_feedback"]);
/** Organization-level operations a product connector still answers: the caller's own standing there. */
const TENANT_OPS_FOR_PRODUCT = new Set(["products.limits"]);
/** Product operations that reach a second product, which a product connector never can. */
const CROSS_PRODUCT_OPS = new Set(["sources.move_to_product", "sources.copy_to_product"]);

/** The connector's own name for itself in messages: `organization Acme (acme)` or `product Crewboard (acme/core/crewboard)`. */
export function describeConnectorScope(c: ConnectorScope): string {
  return c.product ? `product ${c.product.name} (${c.product.path})` : `organization ${c.tenant.name} (${c.tenant.slug})`;
}

export function outsideConnectorScope(c: ConnectorScope, what: string): AppError {
  return new AppError(
    403,
    "outside_connector_scope",
    `This connector is scoped to ${describeConnectorScope(c)}, and ${what} is outside it. Nothing was changed. ` +
      "To work there, the person adds a connector scoped to it, or the unscoped one, in their agent.",
    { connector_scope: c.product ? { product: c.product.path } : { tenant: c.tenant.slug } },
  );
}

/**
 * Resolve the organization or product an endpoint is bound to, for this caller. Answers 404 when
 * they cannot see it, as any call addressed there would.
 */
export async function resolveConnectorScope(db: Db, principal: Principal, bound: ScopeRef): Promise<ConnectorScope> {
  const product = Boolean(bound.product);
  const scope = await resolveScope(db, principal, product ? "product" : "tenant", "any", bound, "connect").catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) {
      const path = [bound.tenant, bound.team, bound.product].filter(Boolean).join("/");
      throw new AppError(404, "not_found", `This connector is scoped to ${product ? "product" : "organization"} ${path}, which you cannot reach. It may have been renamed, or you may have left it. Copy its address again from Connect an agent.`);
    }
    throw e;
  });
  // A product connector offers no team's operation, so only the product's role and the organization's count.
  const standing = product
    ? { role: scope.role, teamRole: null, tenantRole: scope.tenantRole }
    : highestRolesIn(await membershipsFor(db, principal.account_id, scope.tenant!.tenant_id), scope.tenant!.tenant_id);
  return {
    tenant: { tenant_id: scope.tenant!.tenant_id, slug: scope.tenant!.slug, name: scope.tenant!.name },
    product: scope.product ? { product_id: scope.product.product_id, path: `${scope.tenant!.slug}/${scope.team!.slug}/${scope.product.slug}`, name: scope.product.name } : null,
    standing,
  };
}

/** Whether the connector answers the operation anywhere inside it: what `checkConnectorScope` always refuses is never offered. */
export function connectorOffers(c: ConnectorScope, op: Pick<OperationDef, "name" | "scope">): boolean {
  if (op.scope === "account") return ACCOUNT_OPS_ALLOWED.has(op.name);
  if (!c.product) return true;
  if (op.scope !== "product") return TENANT_OPS_FOR_PRODUCT.has(op.name);
  return !CROSS_PRODUCT_OPS.has(op.name);
}

/** Refuse a call whose resolved scope lies outside the connector's. Runs after authorization, before the handler. */
export function checkConnectorScope(c: ConnectorScope, op: OperationDef, scope: Scope): void {
  if (op.scope === "account") {
    if (!ACCOUNT_OPS_ALLOWED.has(op.name)) throw outsideConnectorScope(c, `${op.name}, which acts outside any one organization,`);
    return;
  }
  const tenant = scope.tenant!;
  if (tenant.tenant_id !== c.tenant.tenant_id) throw outsideConnectorScope(c, `organization ${tenant.name} (${tenant.slug})`);
  if (!c.product) return;
  if (op.scope !== "product") {
    if (TENANT_OPS_FOR_PRODUCT.has(op.name)) return;
    throw outsideConnectorScope(c, `${op.name}, which acts on the whole ${op.scope === "team" ? "team" : "organization"},`);
  }
  if (scope.product!.product_id !== c.product.product_id) throw outsideConnectorScope(c, `product ${scope.product!.name}`);
  if (CROSS_PRODUCT_OPS.has(op.name)) throw outsideConnectorScope(c, "another product");
}

/** `products.list` as a scoped connector sees it: only what lies inside. */
export function narrowProductList<T extends { items: { product_id: string; tenant: { tenant_id: string }; team: { team_id: string } }[]; tenants: { tenant_id: string; teams: { team_id: string }[] }[] }>(
  c: ConnectorScope,
  list: T,
): T {
  const items = list.items.filter((i) => i.tenant.tenant_id === c.tenant.tenant_id && (!c.product || i.product_id === c.product.product_id));
  const teams = new Set(items.map((i) => i.team.team_id));
  const tenants = list.tenants
    .filter((t) => t.tenant_id === c.tenant.tenant_id)
    .map((t) => (c.product ? { ...t, teams: t.teams.filter((tm) => teams.has(tm.team_id)) } : t));
  return { ...list, items, tenants };
}
