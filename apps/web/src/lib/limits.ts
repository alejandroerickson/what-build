import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { formatBytes, formatDate } from "./format.ts";

/** A plan's id, as the deployment defines it, or "unlimited", the plan with no limits. */
export type Plan = string;

export interface Limit {
  key: string;
  group: "frequency" | "size" | "total" | "switch";
  label: string;
  unit: string;
  per: string;
  refusal: string;
  help: string;
}

/** A limit's value: a number, a switch, or null for no limit. */
export type Amount = number | boolean | null;

export interface LimitValue extends Limit {
  /** What the organization's plan sets; null for no limit, and on the unlimited plan. */
  value: Amount;
  /** What is used of it: today's for a daily limit, counted on every plan; what the organization holds for a total. */
  used?: number;
}

/** What an organization holds against its plan's totals. */
export interface Holdings {
  members: number;
  /** Invitations not yet accepted, each holding a place among the people. */
  invited: number;
  products: number;
  sources: number;
  storage: { files: number; text: number; total: number };
}

/** Whether any plan has a price: only then does the app speak of billing. */
export const anyPriced = (plans: readonly { price: string | null }[] | undefined) => Boolean(plans?.some((p) => p.price));

/** A plan this WhatBuild offers, as its deployment defines it, with every limit it sets and its price, if any. */
export interface PlanEntry {
  id: Plan;
  name: string;
  about: string;
  price: string | null;
  limits: Record<string, Amount>;
}

export interface DeploymentLimit {
  key: string;
  label: string;
  value: number;
  unit: string;
  set_by: string | null;
}

/**
 * An organization that went back to the plan organizations start on while whoever started it already
 * had one there: read and exported, added to by nobody, kept until kept_until.
 */
export interface ReadOnly {
  since: string;
  kept_until: string | null;
}

/**
 * "Kept until 26 Oct 2027 · 365 days left": how long a read-only organization stays. The day is
 * kept_until's in UTC, the day the server's refusals give too, whatever the reader's zone; the day
 * it became read-only is written in UTC beside it, so the two are a year apart.
 */
export function keptLine(r: ReadOnly, now = Date.now()): string {
  if (!r.kept_until) return "Kept for now";
  const days = Math.max(0, Math.ceil((Date.parse(r.kept_until) - now) / 86_400_000));
  return `Kept until ${formatDate(r.kept_until.slice(0, 10))} · ${days === 1 ? "1 day" : `${days} days`} left`;
}

/** An organization's plan and limits, as one of its people sees them: `products.limits`. */
export interface OrganizationLimits {
  organization: { slug: string; name: string; example?: true };
  plan: Plan;
  plan_name: string;
  plan_about: string;
  /** On a plan the deployment no longer defines: no limit applies until it moves. */
  undefined_plan?: true;
  read_only?: ReadOnly;
  /** "calls_per_minute_only": a guest of the example organization. */
  you_meet_them: boolean | "calls_per_minute_only";
  /** Absent for a guest of the example organization. */
  holds?: Holdings;
  limits: LimitValue[];
  allowances_restart_at: string;
  plans: PlanEntry[];
  deployment_limits: DeploymentLimit[];
}

export function useOrganizationLimits(tenant: string, on = true) {
  return useQuery({
    queryKey: ["limits", tenant],
    queryFn: () => api<OrganizationLimits>("GET", `/api/v1/tenants/${tenant}/limits`),
    enabled: on && Boolean(tenant),
    staleTime: 30_000,
  });
}

/** The plans this WhatBuild offers, for anyone: `GET /api/v1/plans`. None on a deployment that offers no plans. */
export interface PlansCatalogue {
  plans: PlanEntry[];
  /** The plan organizations start on: one of plans, or "unlimited". */
  starting_plan: Plan;
  /** Whether the deployment has an example organization, which guests read. */
  example?: boolean;
  limits: Limit[];
  /** The largest file this deployment takes on any plan. */
  file_max_bytes: number;
  /** Whom to write to about a plan, if the deployment names someone. */
  contact: string | null;
  /** Whether anyone may sign up as a guest, and whether guests are let in at all. */
  guests?: { self_serve: boolean; open: boolean };
}

export function usePlans() {
  return useQuery({ queryKey: ["plans"], queryFn: () => api<PlansCatalogue>("GET", "/api/v1/plans"), staleTime: 300_000 });
}

/** Every organization on the instance, for its owners: `products.organizations`. */
export interface InstanceOrganization {
  slug: string;
  name: string;
  /** Guards the name and slug: `products.rename_tenant`. */
  name_etag: string;
  /** Slugs it had before, which addresses may still name it by. */
  former_slugs?: string[];
  plan: Plan;
  read_only?: ReadOnly;
  /** Moving it to the starting plan would make it read-only: whoever started it already has an organization there. */
  starting_plan_is_read_only?: true;
  /** On a plan the deployment no longer defines: no limit applies until it moves. */
  undefined_plan?: true;
  example?: true;
  created_at: string;
  created_by: { display_name: string };
  holds: Holdings;
  /** Guards the plan: `products.set_plan`. */
  etag: string | null;
  plan_changed_at: string | null;
  plan_changed_by: { display_name: string } | null;
  today: { people_writing: number; writes: number; sources: number; exports: number; bytes: number };
}

export interface InstanceOrganizations {
  plans: PlanEntry[];
  /** Each plan's limits before an instance owner changed them. */
  plan_defaults: Record<string, Record<string, Amount>>;
  /** Who changed each plan last, its etag (guarding `products.set_plan_limits`) and the limits changed from its defaults. */
  plan_records: Record<string, { etag: string | null; updated_at: string | null; updated_by: { display_name: string } | null; changed: Record<string, Amount> }>;
  plan_names: Record<Plan, string>;
  /** The plan an organization someone other than an instance owner starts gets on this deployment. */
  new_organization_plan: Plan;
  limits: Limit[];
  items: InstanceOrganization[];
}

/** A plan's name as the deployment gives it: from a list of names, "Unlimited", or its id. */
export function planWord(plan: Plan, names?: Record<string, string> | { id: string; name: string }[]): string {
  if (plan === "unlimited") return "Unlimited";
  const named = Array.isArray(names) ? names.find((p) => p.id === plan)?.name : names?.[plan];
  return named ?? plan;
}

/** Whether this WhatBuild offers plans at all; undefined while that is being read. A self-hosted deployment offers none. */
export function usePlansOffered(): boolean | undefined {
  const q = usePlans();
  return q.data ? q.data.plans.length > 0 : undefined;
}

/** A size as a person reads it: 10 MB, not 10.0 MB, and nothing as 0 MB. */
export const size = (n: number) => (n === 0 ? "0 MB" : formatBytes(n).replace(/\.0+ /, " "));

/** A limit's value as a person reads it: bytes as a size, a switch as on or off, null as no limit, 0 as off. */
export function amount(value: Amount, unit: string): string {
  if (value === null) return "No limit";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === 0) return "Off";
  return unit === "bytes" ? size(value) : value.toLocaleString("en-US");
}

/** How full a total or allowance is, for its mark and word: nearly full from 80%. */
export function fullness(used: number, limit: Amount): "ok" | "near" | "full" | "none" {
  if (typeof limit !== "number") return "none";
  if (used >= limit) return "full";
  return used >= limit * 0.8 ? "near" : "ok";
}

/** What a plan sets for the totals, in words: "2 people, 1 product, 50 sources, 200 MB". */
export function totalsInWords(p: PlanEntry | undefined): string {
  if (!p) return "no limits on anything";
  const n = (k: string, one: string, many: string) => {
    const v = p.limits[k];
    return v === null || v === undefined ? `any number of ${many}` : typeof v === "number" ? `${v.toLocaleString("en-US")} ${v === 1 ? one : many}` : "";
  };
  const storage = p.limits["storage_max_bytes"];
  return `${n("members_max", "person", "people")}, ${n("products_max", "product", "products")}, ${n("sources_max", "source", "sources")}, ${typeof storage === "number" ? `${size(storage)} of storage` : "any storage"}`;
}
