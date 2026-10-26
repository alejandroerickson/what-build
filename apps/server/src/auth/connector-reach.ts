import { effectiveRole, membershipsFor, type Db, type ScopeRef } from "@whatbuild/core";
import { sql } from "kysely";

/**
 * MCP endpoints and the OAuth resources that name them. `/mcp` reaches everything the account can;
 * `/mcp/t/<tenant>` one organization; `/mcp/t/<tenant>/<team>/<product>` one product. A token is
 * issued for one of them and serves it and the endpoints inside it, never a wider one.
 */

/** The scope an MCP endpoint path names: null for `/mcp`, undefined for a path that is no endpoint. */
export function connectorBound(pathname: string): ScopeRef | null | undefined {
  const parts = pathname.replace(/\/+$/, "").split("/").slice(1);
  if (parts[0] !== "mcp") return undefined;
  if (parts.length === 1) return null;
  if (parts[1] !== "t" || !parts.slice(2).every(Boolean)) return undefined;
  let tenant: string, team: string, product: string;
  try {
    [tenant, team, product] = parts.slice(2).map(decodeURIComponent) as [string, string, string];
  } catch {
    return undefined;
  }
  if (parts.length === 3) return { tenant };
  if (parts.length === 5) return { tenant, team, product };
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

/** Whether a token issued for `resource` may call `endpoint`: the same endpoint, or one inside it. */
export function resourceCovers(resource: string, endpoint: string): boolean {
  const r = split(resource);
  const e = split(endpoint);
  if (!r || !e || r.origin !== e.origin || connectorBound(r.path) === undefined) return false;
  return e.path === r.path || e.path.startsWith(`${r.path}/`);
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
  const path = [bound.tenant, bound.team, bound.product].filter(Boolean).join("/");
  const tenant = await db
    .selectFrom("tenants")
    .select(["tenant_id", "name"])
    .where(sql<boolean>`(slug = ${bound.tenant} or tenant_id = ${bound.tenant})`)
    .executeTakeFirst();
  const memberships = tenant ? await membershipsFor(db, accountId, tenant.tenant_id) : [];
  const tenantName = tenant && memberships.length ? tenant.name : null;
  if (!bound.product) return { kind: "tenant", path, name: tenantName };
  const product = tenantName
    ? await db
        .selectFrom("products as p")
        .innerJoin("teams as tm", "tm.team_id", "p.team_id")
        .select(["p.product_id", "p.name", "p.team_id"])
        .where("p.tenant_id", "=", tenant!.tenant_id)
        .where(sql<boolean>`(tm.slug = ${bound.team} or tm.team_id = ${bound.team})`)
        .where(sql<boolean>`(p.slug = ${bound.product} or p.product_id = ${bound.product})`)
        .executeTakeFirst()
    : undefined;
  const visible = product && effectiveRole(memberships, { tenant_id: tenant!.tenant_id, team_id: product.team_id, product_id: product.product_id }).role;
  return { kind: "product", path, name: visible ? product.name : null, tenant_name: tenantName };
}
