import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

/** What a public sandbox is for the person looking at it: `sandbox.status`. */
export interface SandboxStatus {
  public_sandbox: true;
  organization: { slug: string; name: string };
  notice: string;
  visitor_access: "write" | "read" | "closed";
  agents_allowed: boolean;
  resets: SandboxResets;
  /** staff: an owner or admin. visitor: came in by an invitation link. member: given a role by its staff, and treated as a visitor is. */
  /** story_only: a member who reads only the Story there, writes nothing, and so has no appears_as. */
  you: { role: "visitor" | "member" | "staff"; appears_as: string | null; story_only?: boolean; can: string };
  allowances: { key: string; label: string; per: string; limit: number | boolean; unit: string; used?: number; refusal: string }[];
  allowances_restart_at: string;
}

export interface SandboxResets {
  enabled: boolean;
  time: string;
  timezone: string;
  /** Null when resets are off, or no baseline has been saved to reset to. */
  next_at: string | null;
  last_at: string | null;
}

export function useSandboxStatus(tenant: string, on = true) {
  return useQuery({
    queryKey: ["sandbox", tenant, "status"],
    queryFn: () => api<SandboxStatus>("GET", `/api/v1/tenants/${tenant}/sandbox`),
    enabled: on && Boolean(tenant),
    staleTime: 60_000,
  });
}

/** "every day at 02:00, America/Los_Angeles time", with the zone in words a person reads. */
export function resetWords(r: Pick<SandboxResets, "time" | "timezone">): string {
  return `every day at ${r.time}, ${r.timezone.replace(/_/g, " ")} time`;
}
