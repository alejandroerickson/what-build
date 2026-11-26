import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { READ_ONLY_ALLOWS } from "@whatbuild/core/read-only";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { Loading } from "../ui/index.tsx";
import { api, ApiError, isMinuteRefusal } from "./api.ts";
import type { ReadOnly } from "./limits.ts";
import { forgetPersonalState } from "./local-state.ts";

export interface Me {
  account_id: string;
  email: string;
  display_name: string;
  /**
   * How many organizations this account may still start; null means no limit (an owner of this
   * instance). `created` counts the ones it started that are on the plan new organizations start on
   * and not read-only.
   */
  tenant_allowance: { instance_owner: boolean; allowed: number | null; created: number; remaining: number | null; source: "instance_owner" | "given" | "default" };
  /** The plan an organization this account starts gets. */
  new_organization_plan: string;
  /** In no organization, with no allowance: they come into the example organization as a guest, while there is room. */
  guest?: boolean;
  /** The person hid the example organization from the panel; the overview still shows it. */
  hide_example: boolean;
  /** When they asked for an organization of their own: they are on the waitlist. */
  asked_for_organization_at?: string | null;
  /** The web app's tutorials: which the person has been shown, and whether they turned them off. */
  tutorial?: TutorialState;
}

/** The web app's tutorials: the welcome, then one for each of a product's four pages. */
export type TutorialPart = "welcome" | "idea" | "evidence" | "exploration" | "story";

/** The web app's tutorials, as the account keeps them (`PATCH /api/v1/me`), so they follow the person between browsers. */
export interface TutorialState {
  /** The tutorials the person has been shown, which start by themselves no more. */
  seen: TutorialPart[];
  /** The person turned tutorials off: none starts by itself. */
  off: boolean;
}

/** What `PATCH /api/v1/me` takes: tutorials to add to those seen, and tutorials off or on. */
export interface TutorialPatch {
  seen?: TutorialPart[];
  off?: boolean;
}

/**
 * `viewer` reads everything in the product and changes nothing. `story_reader`, a Story reader,
 * reads only the Story's live pages: the server sends it no concept, and counts of Story pages only.
 * `guest` is anyone the example organization gave no role, who reads there as a viewer.
 */
export type ProductRole = "story_reader" | "viewer" | "editor" | "admin" | "guest";

/** Where a product opens for this role: a Story reader has only the Story. */
export function productHome(role: ProductRole): "story" | "idea" {
  return role === "story_reader" ? "story" : "idea";
}

export interface ProductSummary {
  product_id: string;
  path: string;
  name: string;
  concept?: string;
  archived_at: string | null;
  updated_at: string;
  tenant: { tenant_id: string; slug: string; name: string; example?: boolean };
  /** Paths it had before (`tenant/team/product`, from when products were in teams) that still reach it: rare. */
  former_paths?: string[];
  your_role: ProductRole;
  counts: Product["counts"];
  stage_counts: Product["stage_counts"];
}

export interface ProductsResponse {
  items: ProductSummary[];
  /**
   * `example` marks the example organization, where `your_role` is "guest" for everyone it gave no
   * role. story_only: the person reads only the Story everywhere in the organization, so its members
   * are not shown to them. `plan` is free, pro or unlimited. `name_etag` guards the name and slug, which
   * owners change; `former_slugs` are slugs it had before, which addresses may still name it by.
   * `your_role` is the person's role in the organization itself (owner, admin, creator, member, or
   * guest in the example organization); `all_products`, the role they hold on every product in it,
   * products made later included.
   */
  tenants: {
    tenant_id: string;
    slug: string;
    name: string;
    name_etag: string;
    former_slugs?: string[];
    example?: boolean;
    plan: string;
    read_only?: ReadOnly;
    story_only?: boolean;
    your_role: OrganizationRole | null;
    all_products?: Exclude<ProductRole, "guest">;
  }[];
}

/** A role in an organization itself: `creator` is a product creator, who creates products and is admin of each one they create. */
export type OrganizationRole = "owner" | "admin" | "creator" | "member" | "guest";

/** Who may add and change what a product holds: its editors and admins, while it is not archived and its organization is not read-only. */
export function canWriteIn(product: { your_role: string; archived_at: string | null }, readOnly: unknown): boolean {
  return (product.your_role === "editor" || product.your_role === "admin") && !product.archived_at && !readOnly;
}

/** Who may create a product in an organization: its owners, admins and product creators. */
export function mayCreateProducts(t: { your_role: string | null }): boolean {
  return t.your_role === "owner" || t.your_role === "admin" || t.your_role === "creator";
}

/**
 * Who is signed in. `/auth/session` answers a signed-out visitor with `signed_in: false` rather than
 * a 401, so the browser logs no error for what is normal on the sign-in page; the query still fails
 * then, as before, for the screens that send such a visitor to sign in. A visitor without a session
 * is also where one person's display state stops: it is cleared before anyone signs in.
 */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const s = await api<({ signed_in: true } & Me) | { signed_in: false }>("GET", "/auth/session");
      if (!s.signed_in) {
        forgetPersonalState();
        throw new ApiError(401, "unauthenticated", "Nobody is signed in.");
      }
      const { signed_in: _, ...me } = s;
      return me as Me;
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useProducts(includeArchived = false) {
  return useQuery({ queryKey: ["products", includeArchived], queryFn: () => api<ProductsResponse>("GET", `/api/v1/me/products${includeArchived ? "?include_archived=true" : ""}`) });
}

/**
 * An address that names an organization by a slug it had before leads to its current one, the rest
 * of the address kept, as soon as the person's organizations are known. The server answers the old
 * slug too, so the screen works meanwhile, and someone who cannot see the organization learns nothing.
 */
export function CurrentTenantAddress({ children }: { children: ReactNode }) {
  const { tenant = "" } = useParams();
  const products = useProducts();
  const location = useLocation();
  const prefix = `/t/${tenant}`;
  const moved = products.data?.tenants.find((t) => t.slug !== tenant && t.former_slugs?.includes(tenant));
  if (moved && location.pathname.startsWith(prefix))
    return <Navigate replace to={`/t/${moved.slug}${location.pathname.slice(prefix.length)}${location.search}${location.hash}`} />;
  return <>{children}</>;
}

/** Hide the example organization from the panel, or show it again: the account's own choice. */
export function useHideExample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hide: boolean) => api<Me>("PATCH", "/api/v1/me", { hide_example: hide }),
    onSuccess: (me) => qc.setQueryData(["me"], (old: Me | undefined) => (old ? { ...old, hide_example: me.hide_example } : old)),
  });
}

/**
 * Keep on the account which tutorials the person has been shown, and whether they turned tutorials
 * off. What the app shows changes at once; the request follows, and a failure leaves the screen as it
 * is, since the tutorials are only a convenience.
 */
export function useSaveTutorial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: TutorialPatch) => api<Me>("PATCH", "/api/v1/me", { tutorial: patch }),
    onMutate: (patch) =>
      qc.setQueryData(["me"], (old: Me | undefined) => {
        if (!old) return old;
        const was = old.tutorial ?? { seen: [], off: false };
        return { ...old, tutorial: { seen: [...new Set([...was.seen, ...(patch.seen ?? [])])], off: patch.off ?? was.off } };
      }),
  });
}

/** Ask for an organization of one's own: join the waitlist the instance's owners read. */
export function useAskForOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Me>("POST", "/api/v1/me/ask-for-organization", {}),
    // Asking may give one of the day's places at once, so the allowance changes too.
    onSuccess: (me) => qc.setQueryData(["me"], (old: Me | undefined) => (old ? { ...old, tenant_allowance: me.tenant_allowance, guest: me.guest, asked_for_organization_at: me.asked_for_organization_at } : old)),
  });
}

/** The organizations in the order the app lists them: the person's own first, the example organization last. */
export function ownFirst<T extends { example?: boolean }>(tenants: T[]): T[] {
  return [...tenants].sort((a, b) => Number(Boolean(a.example)) - Number(Boolean(b.example)));
}

export function useSignOut() {
  const qc = useQueryClient();
  /** `next` brings the person back after signing in again, e.g. to the invitation they were opening. */
  return async (next?: string) => {
    await api("POST", "/auth/sign-out").catch(() => undefined);
    forgetPersonalState();
    qc.clear();
    window.location.assign(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  };
}

/**
 * A link from one of the public site's landing pages carries `?landing=<its path>` through sign-in,
 * and `&button=` for the button pressed (`explore` or `start`). Once signed in, they are told to the
 * server (which keeps them on an account in its first day, to compare the landing pages) and taken
 * off the address.
 */
function useCameFrom(signedIn: boolean) {
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!signedIn) return;
    const params = new URLSearchParams(loc.search);
    const page = params.get("landing");
    if (!page) return;
    const button = params.get("button");
    params.delete("landing");
    params.delete("button");
    void api("POST", "/api/v1/me/came-from", { page, ...(button === "explore" || button === "start" ? { button } : {}) }).catch(() => undefined);
    const rest = params.toString();
    navigate(`${loc.pathname}${rest ? `?${rest}` : ""}${loc.hash}`, { replace: true });
  }, [signedIn, loc.pathname, loc.search, loc.hash, navigate]);
}

/** Renders children only once the session is known; anyone signed out goes to sign-in and comes back. */
export function RequireSession({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  useCameFrom(Boolean(me.data));
  if (me.isPending) return <div className="center-page"><Loading label="Checking your sign-in…" /></div>;
  if (me.isError) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

// ---- The addressed product ---------------------------------------------------------------------

export interface Product {
  product_id: string;
  slug: string;
  name: string;
  /** The back of the product concept's card, the text agents read. Absent for a Story reader. */
  concept?: string;
  /** How long the concept card's front is, 0 when it has none. Absent for a Story reader. */
  card_chars?: number;
  /** Whether the product's Playbook is on. Absent for a Story reader. */
  playbook_enabled?: boolean;
  /** The Playbook as the product's answer gives it: absent for a Story reader; started false while it serves WhatBuild's starter. */
  playbook?: { enabled: boolean; started?: boolean; files?: number };
  archived_at: string | null;
  etag: string;
  path: string;
  tenant: { tenant_id: string; slug: string; name: string; example?: boolean; plan?: string; read_only?: ReadOnly };
  your_role: ProductRole;
  /** A Story reader gets story_pages only. */
  counts: { story_pages: number } & Partial<Record<"sources" | "outcomes" | "mockups", number>>;
  /** Each stage's total of every item it holds, as the panel and the overview show it; a Story reader gets story only. */
  stage_counts: { story: number } & Partial<Record<"idea" | "evidence" | "exploration", number>>;
}

interface ProductCtx {
  product: Product;
  /** REST base for this product's operations. */
  api: string;
  /** Web base for this product's screens. */
  app: string;
  canWrite: boolean;
  /** May give a web page its first picture: anyone who reads the sources, but not a guest of the example organization, who changes nothing there. */
  canGivePicture: boolean;
  /** The organization is read-only: nothing new can be added, whatever the role, but reading, exporting, deleting and taking people out still work. */
  readOnlyOrganization: boolean;
  isAdmin: boolean;
  /** An admin, in a product that isn't archived: may delete permanently. */
  canDelete: boolean;
  /** A Story reader: the Story is all there is of the product for them. */
  storyOnly: boolean;
}

const ProductContext = createContext<ProductCtx | null>(null);

/**
 * The product's screens as someone who can edit it sees them, for drawing fixed content (the
 * tutorial's examples) through the components that draw real content. What it shows is inert, so it
 * gives no one more than they have: deleting stays an admin's and is not drawn.
 */
export function AsEditor({ children }: { children: ReactNode }) {
  const ctx = useContext(ProductContext);
  if (!ctx) return <>{children}</>;
  return <ProductContext.Provider value={{ ...ctx, canWrite: true, canGivePicture: false, canDelete: false, isAdmin: false, storyOnly: false }}>{children}</ProductContext.Provider>;
}

export function useProductParams() {
  const { tenant = "", product = "" } = useParams();
  return { tenant, product, path: `${tenant}/${product}` };
}

/**
 * Where a product's address from before teams were removed (`tenant/<middle>/product`) leads now:
 * to the product that lists it among its former paths, where removing teams changed its slug, or
 * else to the same address without its middle part, which never named anything else. Null when it
 * is no such address but a screen the app doesn't have in a product the person has
 * (`tenant/<product>/<no such screen>`), and the person has no product at the shorter path.
 */
export function currentProductPath(items: Pick<ProductSummary, "path" | "former_paths">[] | undefined, tenant: string, middle: string, product: string): string | null {
  const old = `${tenant}/${middle}/${product}`;
  const moved = items?.find((p) => p.former_paths?.includes(old));
  if (moved) return moved.path;
  const shorter = `${tenant}/${product}`;
  if (items && !items.some((p) => p.path === shorter) && items.some((p) => p.path === `${tenant}/${middle}`)) return null;
  return shorter;
}

/**
 * Loads the product the address names, or the one `path` names (Settings, opened over a screen that
 * is not the product's own), and gives its screens what they need of it.
 */
export function ProductProvider({ children, fallback, path: given }: { children: (ctx: ProductCtx) => ReactNode; fallback: (error: unknown, retry: () => void) => ReactNode; path?: string }) {
  const params = useProductParams();
  const path = given ?? params.path;
  const q = useQuery({ queryKey: ["product", path], queryFn: () => api<Product>("GET", `/api/v1/p/${path}`) });
  if (q.isPending) return <div className="center-page"><Loading /></div>;
  // A re-check refused for the minute's calls says nothing of the person's access, so the product the
  // app holds stays; everything in it is read with the same check, and refused the same. Any other
  // failure stands, a 403 or a 404 above all: someone whose access was removed does not keep it.
  const product = q.data;
  if (!product || (q.isError && !isMinuteRefusal(q.error))) return <>{fallback(q.error, () => void q.refetch())}</>;
  const ctx: ProductCtx = {
    product,
    api: `/api/v1/p/${path}`,
    app: `/t/${path}`,
    canWrite: canWriteIn(product, product.tenant.read_only),
    canGivePicture: (product.your_role === "viewer" || product.your_role === "editor" || product.your_role === "admin") && !product.archived_at && !product.tenant.read_only,
    readOnlyOrganization: Boolean(product.tenant.read_only),
    isAdmin: product.your_role === "admin",
    canDelete: product.your_role === "admin" && !product.archived_at,
    storyOnly: product.your_role === "story_reader",
  };
  if (!given) rememberProduct(product);
  return <ProductContext.Provider value={ctx}>{children(ctx)}</ProductContext.Provider>;
}

/** Why someone can't add or change anything in this product, for a screen that would otherwise invite it. */
export function cannotWriteReason(ctx: Pick<ProductCtx, "product" | "readOnlyOrganization">): string {
  if (ctx.readOnlyOrganization) return `${ctx.product.tenant.name} is read-only, so nothing new can be added to it until it moves to another plan. ${READ_ONLY_ALLOWS}`;
  if (ctx.product.archived_at) return "This product is archived. An admin can restore it in Settings.";
  if (ctx.product.your_role === "guest") return "This is the demo, to read: nothing in it can be added or changed.";
  return "You’re a viewer here. An admin of this product can make you an editor.";
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

/** The product the person last opened in an organization, which switching to that organization opens again. */
export function lastProductIn(tenantId: string): string | null {
  try {
    return localStorage.getItem(`whatbuild.last-product.${tenantId}`);
  } catch {
    return null;
  }
}

/** Keeps the product just opened as the last one, everywhere and in its organization. */
function rememberProduct(product: Pick<Product, "path" | "tenant">) {
  try {
    localStorage.setItem("whatbuild.last-product", product.path);
    localStorage.setItem(`whatbuild.last-product.${product.tenant.tenant_id}`, product.path);
  } catch {
    // Storage may be blocked; the URL still carries the product.
  }
}
