import { ApiError } from "../lib/api.ts";
import { plural } from "../lib/format.ts";
import { planWord, size, usePlans } from "../lib/limits.ts";
import { useProducts } from "../lib/session.tsx";
import { Callout, ErrorCallout } from "../ui/index.tsx";

/** The totals a plan sets that a person meets in the web app: people, products, sources and storage. */
export type Total = "members_max" | "products_max" | "sources_max" | "storage_max_bytes";
const TOTALS = new Set<string>(["members_max", "products_max", "sources_max", "storage_max_bytes"]);

/** A total reached, from a refusal's `details`: which total, what the plan sets, and, adding people, the address past it. */
export interface TotalReached {
  quota: Total;
  limit: number;
  email?: string;
  /** Adding several people: how many of the addresses before it the plan had room for. */
  roomFor?: number;
}

/**
 * A plan's total refusing something (`409 quota_exceeded` naming a total in `details.quota`), or
 * null for anything else, a day's or a minute's limit included.
 */
export function totalReached(error: unknown): TotalReached | null {
  if (!(error instanceof ApiError) || error.code !== "quota_exceeded") return null;
  const d = error.details ?? {};
  const quota = d["quota"];
  const limit = d["limit"];
  if (typeof quota !== "string" || !TOTALS.has(quota) || typeof limit !== "number") return null;
  return {
    quota: quota as Total,
    limit,
    ...(typeof d["email"] === "string" ? { email: d["email"] } : {}),
    ...(typeof d["room_for"] === "number" ? { roomFor: d["room_for"] } : {}),
  };
}

/** What a total holds, in words: "2 people", "1 product", "50 sources", "200 MB". */
function holds(r: TotalReached): string {
  if (r.quota === "members_max") return plural(r.limit, "person", "people");
  if (r.quota === "products_max") return plural(r.limit, "product");
  if (r.quota === "sources_max") return plural(r.limit, "source");
  return size(r.limit);
}

/** How to make room under a total, in a sentence, and what doesn't count or does. */
function room(r: TotalReached): string {
  if (r.quota === "members_max") {
    const add = r.email ? `To add ${r.email}${r.roomFor ? " too" : ""}` : "To add more people";
    return `${r.roomFor ? "Nothing was saved. " : ""}${add}, cancel an invitation or remove someone. Story readers don’t count.`;
  }
  if (r.quota === "products_max") return "To start another, delete a product no longer needed, in its Settings. Archived ones count.";
  if (r.quota === "sources_max") return "To add more, a product’s admins can delete sources no longer needed. Archived ones count.";
  return "To make room, a product’s admins can delete what’s no longer needed. Archived work counts.";
}

/**
 * A plan's total, reached, in the app's own words: the organization and its plan by name with what
 * the plan holds, how to make room, and the plans side by side in a new tab where the deployment
 * offers plans. The refusal's own message, written for agents, is theirs.
 */
export function LimitReached({ tenant, reached, inset }: { tenant: string; reached: TotalReached; inset?: boolean }) {
  const products = useProducts();
  const plans = usePlans();
  const t = products.data?.tenants.find((x) => x.slug === tenant || x.former_slugs?.includes(tenant));
  const plan = t ? `${planWord(t.plan, plans.data?.plans)} plan` : "plan";
  return (
    <Callout tone="attention" inset={inset} title={`${t?.name ?? "This organization"}’s ${plan} holds ${holds(reached)}`}>
      {room(reached)}
      {plans.data?.plans.length ? (
        <>
          {" "}
          <a href="/plans" target="_blank" rel="noreferrer">
            Compare plans
          </a>
        </>
      ) : null}
    </Callout>
  );
}

/** An error as ErrorCallout says it, except a plan's total reached, which LimitReached says. */
export function RefusalCallout({ tenant, error, inset, title }: { tenant: string; error: unknown; inset?: boolean; title?: string }) {
  const reached = totalReached(error);
  return reached ? <LimitReached tenant={tenant} reached={reached} inset={inset} /> : <ErrorCallout inset={inset} title={title} error={error} />;
}
