import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { Loading } from "../ui/index.tsx";
import { api } from "./api.ts";

export interface Me {
  account_id: string;
  email: string;
  display_name: string;
  /** The account was made on an invitation to the public sandbox alone. */
  sandbox_only?: boolean;
  /** How many organizations this account may still create; null means no limit (an owner of this instance). */
  tenant_allowance: { instance_owner: boolean; allowed: number | null; created: number; remaining: number | null; source: "instance_owner" | "given" | "default" };
}

/** `reader` reads only the Story: the server sends it no concept, and counts of Story pages only. */
export type ProductRole = "reader" | "viewer" | "editor" | "admin";

/** Where a product opens for this role: a reader has only the Story. */
export function productHome(role: ProductRole): "story" | "idea" {
  return role === "reader" ? "story" : "idea";
}

export interface ProductSummary {
  product_id: string;
  path: string;
  name: string;
  concept?: string;
  archived_at: string | null;
  updated_at: string;
  tenant: { tenant_id: string; slug: string; name: string; sandbox?: boolean };
  team: { team_id: string; slug: string; name: string };
  your_role: ProductRole;
  counts: Product["counts"];
}

export interface ProductsResponse {
  items: ProductSummary[];
  /** `sandbox` marks a public sandbox; `your_role` is then "visitor" for everyone but its owners and admins. */
  tenants: { tenant_id: string; slug: string; name: string; sandbox?: boolean; your_role: string | null; teams: { team_id: string; slug: string; name: string; your_role: string | null }[] }[];
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("GET", "/api/v1/me"), retry: false, staleTime: 60_000 });
}

export function useProducts(includeArchived = false) {
  return useQuery({ queryKey: ["products", includeArchived], queryFn: () => api<ProductsResponse>("GET", `/api/v1/me/products${includeArchived ? "?include_archived=true" : ""}`) });
}

export function useSignOut() {
  const qc = useQueryClient();
  /** `next` brings the person back after signing in again, e.g. to the invitation they were opening. */
  return async (next?: string) => {
    await api("POST", "/auth/sign-out").catch(() => undefined);
    qc.clear();
    window.location.assign(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  };
}

/** Renders children only once the session is known; anyone signed out goes to sign-in and comes back. */
export function RequireSession({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isPending) return <div className="center-page"><Loading label="Checking your sign-in…" /></div>;
  if (me.isError) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

// ---- The addressed product ---------------------------------------------------------------------

export interface Product {
  product_id: string;
  slug: string;
  name: string;
  /** Absent for a reader. */
  concept?: string;
  archived_at: string | null;
  etag: string;
  path: string;
  tenant: { tenant_id: string; slug: string; name: string; sandbox?: boolean };
  team: { team_id: string; slug: string; name: string };
  your_role: ProductRole;
  /** A reader gets story_pages only. */
  counts: { story_pages: number } & Partial<Record<"sources" | "outcomes" | "insights" | "assumptions" | "decisions" | "mockups", number>>;
}

interface ProductCtx {
  product: Product;
  /** REST base for this product's operations. */
  api: string;
  /** Web base for this product's screens. */
  app: string;
  canWrite: boolean;
  isAdmin: boolean;
  /** A reader: the Story is all there is of the product for them. */
  storyOnly: boolean;
}

const ProductContext = createContext<ProductCtx | null>(null);

export function useProductParams() {
  const { tenant = "", team = "", product = "" } = useParams();
  return { tenant, team, product, path: `${tenant}/${team}/${product}` };
}

export function ProductProvider({ children, fallback }: { children: (ctx: ProductCtx) => ReactNode; fallback: (error: unknown) => ReactNode }) {
  const { path } = useProductParams();
  const q = useQuery({ queryKey: ["product", path], queryFn: () => api<Product>("GET", `/api/v1/p/${path}`) });
  if (q.isPending) return <div className="center-page"><Loading /></div>;
  if (q.isError) return <>{fallback(q.error)}</>;
  const ctx: ProductCtx = {
    product: q.data,
    api: `/api/v1/p/${path}`,
    app: `/t/${path}`,
    canWrite: (q.data.your_role === "editor" || q.data.your_role === "admin") && !q.data.archived_at,
    isAdmin: q.data.your_role === "admin",
    storyOnly: q.data.your_role === "reader",
  };
  try {
    localStorage.setItem("whatbuild.last-product", path);
  } catch {
    // Storage may be blocked; the URL still carries the product.
  }
  return <ProductContext.Provider value={ctx}>{children(ctx)}</ProductContext.Provider>;
}

export function useProduct(): ProductCtx {
  const ctx = useContext(ProductContext);
  if (!ctx) throw new Error("useProduct outside a product");
  return ctx;
}

export function lastProduct(): string | null {
  try {
    return localStorage.getItem("whatbuild.last-product");
  } catch {
    return null;
  }
}
