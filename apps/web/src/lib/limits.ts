import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { formatBytes } from "./format.ts";

export type Plan = "free" | "unlimited";

export interface Limit {
  key: string;
  group: "frequency" | "size" | "switch";
  label: string;
  unit: string;
  per: string;
  refusal: string;
  help: string;
}

export interface LimitValue extends Limit {
  value: number | boolean;
  /** The free plan's value. */
  free_plan: number | boolean;
  /** What the caller, or everyone together, used today, for a daily limit they meet. */
  used?: number;
}

export interface DeploymentLimit {
  label: string;
  value: number;
  unit: string;
  set_by: string | null;
}

/** An organization's plan and limits, as one of its people sees them: `products.limits`. */
export interface OrganizationLimits {
  organization: { slug: string; name: string; example?: true };
  plan: Plan;
  plan_name: string;
  /** "calls_per_minute_only": a guest of the example organization. */
  you_meet_them: boolean | "calls_per_minute_only";
  limits: LimitValue[];
  allowances_restart_at: string;
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

/** Every organization on the instance, for its owners: `products.organizations`. */
export interface InstanceOrganization {
  slug: string;
  name: string;
  plan: Plan;
  example?: true;
  people: number;
  created_at: string;
  created_by: { display_name: string };
  changed_limits: Record<string, number | boolean>;
  etag: string | null;
  limits_updated_at: string | null;
  limits_updated_by: { display_name: string } | null;
  today: { people_writing: number; writes: number; sources: number; exports: number; bytes: number };
}

export interface InstanceOrganizations {
  plans: Plan[];
  /** The plan an organization someone other than an instance owner starts gets on this deployment. */
  new_organization_plan: Plan;
  free_limits: Record<string, number | boolean>;
  limits: Limit[];
  items: InstanceOrganization[];
}

export const PLAN_WORDS: Record<Plan, string> = { free: "Free", unlimited: "Unlimited" };

/** A limit's value as a person reads it: bytes as a size, a switch as on or off, 0 as off, anything else with its thousands marked. */
export function amount(value: number | boolean, unit: string): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === 0) return "Off";
  return unit === "bytes" ? formatBytes(value) : value.toLocaleString("en-US");
}
