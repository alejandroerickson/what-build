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
  /** The places taken when it was refused (`details.used`): people with a role, and invitations open. */
  used?: number;
  /** Adding people in several calls: how many of the first addresses earlier calls had saved, which left the list. */
  saved?: number;
}

/**
 * What the screen that added people knows of the organization, so a refusal of people offers only
 * what can be done: the places those of the addresses before the refused one took (null when the
 * screen can't tell), whether there is an invitation open to cancel, and whether there is someone
 * the person adding can remove to free a place.
 */
export interface PeopleContext {
  tookBefore: number | null;
  invitations: boolean;
  others: boolean;
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
    ...(typeof d["used"] === "number" ? { used: d["used"] } : {}),
    ...(typeof d["saved"] === "number" && d["saved"] > 0 ? { saved: d["saved"] } : {}),
  };
}

/** What a total holds, in words: "2 people", "1 product", "50 sources", "200 MB". */
function holds(r: TotalReached): string {
  if (r.quota === "members_max") return plural(r.limit, "person", "people");
  if (r.quota === "products_max") return plural(r.limit, "product");
  if (r.quota === "sources_max") return plural(r.limit, "source");
  return size(r.limit);
}

/** A list in words: "a", "a or b", "a, b or c". */
const either = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/**
 * What earlier calls of a long list (100 addresses a call) saved before a later one was refused: the
 * people editor takes those addresses off its list, so what it still lists is what was not saved.
 * When the later call got no answer (`known` false), it may have saved, so nothing is said of the rest.
 */
export const savedBefore = (n: number, known = true) => `The first ${n} addresses are saved and off the list${known ? ", and none after them" : ""}.`;

/**
 * People past the plan's total: what was saved, how many places are left, and only the ways to make
 * room that exist. Without what the screen knows, it offers only adding fewer people, where some fit.
 * `roomFor` counts from the first address still listed: any that earlier calls saved are off the list.
 */
export function peopleRoom(r: TotalReached, people?: PeopleContext): string {
  const fresh = r.roomFor ?? 0;
  // The places free before the refused call: the ones its earlier addresses took, since none is left at the refused one.
  const left = !fresh ? 0 : people?.tookBefore != null && r.used !== undefined ? Math.max(0, r.limit - r.used) + people.tookBefore : null;
  const places =
    left === null
      ? r.saved
        ? `There’s room for only the first ${fresh === 1 ? "address" : `${fresh} addresses`} still listed.`
        : `There’s room for the first ${fresh === 1 ? "address" : `${fresh} addresses`} only.`
      : left === 0
        ? `No places are left${r.email && !fresh ? ` for ${r.email}` : ""}.`
        : `There’s room for ${plural(left, "more person", "more people")}.`;
  const ways = either([left !== 0 ? "add fewer people" : "", people?.invitations ? "cancel an invitation" : "", people?.others ? "remove someone" : ""].filter(Boolean));
  const next = ways ? ` ${ways.replace(/^./, (c) => c.toUpperCase())}.` : "";
  const saved = r.saved ? `${savedBefore(r.saved)} ` : r.roomFor ? "Nothing was saved. " : "";
  return `${saved}${places}${next} Story readers don’t count.`;
}

/** How to make room under a total, in a sentence, and what doesn't count or does. */
function room(r: TotalReached, people?: PeopleContext): string {
  if (r.quota === "members_max") return peopleRoom(r, people);
  if (r.quota === "products_max") return "To start another, delete a product no longer needed, in its Settings. Archived ones count.";
  if (r.quota === "sources_max") return "To add more, a product’s admins can delete sources no longer needed. Archived ones count.";
  return "To make room, a product’s admins can delete what’s no longer needed. Archived work counts.";
}

/**
 * A plan's total, reached, in the app's own words: the organization and its plan by name with what
 * the plan holds, how to make room, and the plans side by side in a new tab where the deployment
 * offers plans. The refusal's own message, written for agents, is theirs.
 */
export function LimitReached({ tenant, reached, inset, people }: { tenant: string; reached: TotalReached; inset?: boolean; people?: PeopleContext }) {
  const products = useProducts();
  const plans = usePlans();
  const t = products.data?.tenants.find((x) => x.slug === tenant || x.former_slugs?.includes(tenant));
  const plan = t ? `${planWord(t.plan, plans.data?.plans)} plan` : "plan";
  return (
    <Callout tone="attention" inset={inset} title={`${t?.name ?? "This organization"}’s ${plan} holds ${holds(reached)}`}>
      {room(reached, people)}
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
export function RefusalCallout({ tenant, error, inset, title, people }: { tenant: string; error: unknown; inset?: boolean; title?: string; people?: (reached: TotalReached) => PeopleContext }) {
  const reached = totalReached(error);
  return reached ? <LimitReached tenant={tenant} reached={reached} inset={inset} people={reached.quota === "members_max" ? people?.(reached) : undefined} /> : <ErrorCallout inset={inset} title={title} error={error} />;
}
