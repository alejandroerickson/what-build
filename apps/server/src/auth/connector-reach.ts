import { effectiveRole, findProduct, membershipsFor, tenantNamed, type Db, type ScopeRef } from "@whatbuild/core";

/**
 * MCP endpoints and the OAuth resources that name them. `/mcp` reaches everything the account can;
 * `/mcp/t/<tenant>` one organization; `/mcp/t/<tenant>/<product>` one product, which
 * `/mcp/t/<tenant>/<team>/<product>` also names, as its address was written when products were in
 * teams. A token is issued for one of them and serves it and the endpoints inside it, never a wider
 * one; a product's endpoint has none inside it.
 */

/** The scope an MCP endpoint path names: null for `/mcp`, undefined for a path that is no endpoint. */
export function connectorBound(pathname: string): ScopeRef | null | undefined {
  const parts = pathname.replace(/\/+$/, "").split("/").slice(1);
  if (parts[0] !== "mcp") return undefined;
  if (parts.length === 1) return null;
  if (parts[1] !== "t" || !parts.slice(2).every(Boolean)) return undefined;
  let names: string[];
  try {
    names = parts.slice(2).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  if (names.length === 1) return { tenant: names[0]! };
  if (names.length === 2) return { tenant: names[0]!, product: names[1]! };
  if (names.length === 3) return { tenant: names[0]!, formerTeam: names[1]!, product: names[2]! };
  return undefined;
}

function split(url: string): { origin: string; path: string } | null {
  try {
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/**
 * Whether a token issued for `resource` may call `endpoint`: the same endpoint, or one inside it.
 * A product's endpoint has none inside it: `/mcp/t/acme/crew/x` is another product's address.
 */
export function resourceCovers(resource: string, endpoint: string): boolean {
  const r = split(resource);
  const e = split(endpoint);
  const bound = r ? connectorBound(r.path) : undefined;
  if (!r || !e || r.origin !== e.origin || bound === undefined) return false;
  if (e.path === r.path) return true;
  return !bound?.product && e.path.startsWith(`${r.path}/`);
}

export type ConnectorReach =
  | { kind: "all" }
  | { kind: "tenant"; path: string; name: string | null }
  | { kind: "product"; path: string; name: string | null; tenant_name: string | null };

/**
 * What a connection's resource reaches, in words a person recognizes: names where this account can
 * see the organization or product, and the address's own path where it cannot.
 */
export async function connectorReach(db: Db, accountId: string, resource: string): Promise<ConnectorReach> {
  const bound = connectorBound(split(resource)?.path ?? "");
  if (!bound) return { kind: "all" };
  const path = [bound.tenant, bound.formerTeam, bound.product].filter(Boolean).join("/");
  const tenant = await db
    .selectFrom("tenants")
    .select(["tenant_id", "name"])
    .where("tenant_id", "=", tenantNamed(bound.tenant ?? ""))
    .executeTakeFirst();
  const memberships = tenant ? await membershipsFor(db, accountId, tenant.tenant_id) : [];
  const tenantName = tenant && memberships.length ? tenant.name : null;
  if (!bound.product) return { kind: "tenant", path, name: tenantName };
  const found = tenantName ? await findProduct(db, bound) : undefined;
  const product = found?.tenant_id === tenant!.tenant_id ? found : undefined;
  const visible = product && effectiveRole(memberships, { tenant_id: tenant!.tenant_id, product_id: product.product_id }).role;
  return { kind: "product", path, name: visible ? product.name : null, tenant_name: tenantName };
}
