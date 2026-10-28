import { plansFrom } from "./plans-config.ts";
import { fileURLToPath } from "node:url";

/** The plans the synthetic organizations are sized against: the example's, which local development offers. Read when first needed. */
let sizing: ReturnType<typeof plansFrom> | null = null;
const sizingPlans = () => (sizing ??= plansFrom(fileURLToPath(new URL("../../../deploy/plans.example.json", import.meta.url))));

/**
 * `pnpm people`: a hundred synthetic people (or as many as asked) on a development instance, to try
 * sign-up, admission, invitations and the instance owner's screens at the size a deployment reaches
 * (okf/operations/local-development.md, "Many people"). The same count gives the same people,
 * organizations and invitations every time, and running it again adds only what is missing.
 *
 *   pnpm people [--count 100] [--url http://localhost:5273] [--owner riley@example.com]
 *
 * It works through the running instance as its people would: each signs in through development
 * sign-in, the instance owner gives allowances, owners start their organizations and invite, and the
 * waitlist is asked through the public site's form. So attribution, activity, plans and limits are
 * what they would be, and it needs nothing but the instance's address: the end-to-end instance and a
 * Docker host's, through its tunnel, take it as `pnpm dev` does. It refuses an address that is not
 * this machine's, and a server without development sign-in, which no deployment has.
 */

export type Kind = "waitlist" | "allowed" | "invited" | "signed-in" | "owner" | "member";

export interface PlannedOrganization {
  name: string;
  slug: string;
  domain: string;
  /** Who starts it, on an allowance of one. */
  owner: string;
  /** The smallest plan that holds its people, invitations included: what the instance owner moves it to. */
  plan: string;
}

export interface PlannedPerson {
  email: string;
  name: string;
  kind: Kind;
  /** Organizations they are in, or (invited) the one inviting them, with the role. */
  organizations: { slug: string; role: "owner" | "admin" | "member" }[];
  /** An allowance the instance owner gives the address, if any. */
  allowance?: number;
  /** What a person on the waitlist wrote in the form. */
  interest?: { organization: string; note: string };
}

export interface Plan {
  count: number;
  organizations: PlannedOrganization[];
  people: PlannedPerson[];
  /** What `WHATBUILD_SIGNUP_ALLOWLIST` lets in besides them: one organization's whole domain. */
  allowlist: string;
}

export const DEFAULT_COUNT = 100;
export const MAX_COUNT = 1000;

const FIRST = [
  "Ada", "Bram", "Celia", "Dario", "Esme", "Femi", "Greta", "Hugo", "Ines", "Joaquin",
  "Kira", "Luca", "Maren", "Nico", "Odile", "Pavel", "Quinn", "Rosa", "Soren", "Talia",
  "Umar", "Vera", "Wren", "Xavi", "Yara", "Zane", "Amara", "Bastian", "Cleo", "Desmond",
  "Elif", "Farah", "Gideon", "Hana", "Ivo", "Juno", "Kofi", "Leona", "Mateo", "Nadia",
];
const LAST = [
  "Abara", "Brennan", "Castillo", "Dimitrov", "Eriksen", "Fontaine", "Garza", "Halloran", "Ishikawa", "Jovanovic",
  "Kowalski", "Lindqvist", "Moreau", "Nakamura", "Okonkwo", "Petrov", "Quigley", "Rasmussen", "Salazar", "Takahashi",
  "Ulrich", "Varga", "Whitfield", "Xu", "Yilmaz", "Zielinski", "Achebe", "Bergstrom", "Cardenas", "Delacroix",
  "Esposito", "Faulkner", "Gallagher", "Haddad", "Ivanova", "Jaramillo", "Kaminski", "Lemaire", "Mbeki", "Novak",
];

/** The organizations people start, biggest first; each has a domain of its own, as a company does. */
const ORGANIZATIONS = [
  ["Northwind Outfitters", "northwind"], ["Bluefin Analytics", "bluefin"], ["Copperleaf Studio", "copperleaf"],
  ["Larkspur Freight", "larkspur"], ["Quill & Pine", "quillandpine"], ["Tidewater Co-op", "tidewater"],
  ["Brightmoss", "brightmoss"], ["Saltbox Labs", "saltbox"], ["Juniper Row", "juniperrow"],
  ["Halcyon Bikes", "halcyon"], ["Marigold Kitchens", "marigold"], ["Fernhill Archive", "fernhill"],
] as const;

/** Where the waitlist works, and what it wrote. */
const WAITLIST_PLACES = ["Ostrava Robotics", "Pellucid Health", "Kestrel Media", "Arbor Schools", "Driftwood Games", "Lumen Legal", "Cobalt Retail", "Sorrel Farms"];
const WAITLIST_NOTES = [
  "We run discovery for three product teams and lose track of the interviews.",
  "Looking for somewhere our agents can keep research between sessions.",
  "Saw the launch post. We'd try it with one team first.",
  "",
  "Our PMs write assumptions in a spreadsheet nobody reads. Interested.",
  "Would like to see how the Story works for stakeholders.",
];

/** Person `i`'s name: unique for every i below FIRST × LAST, and the same for the same i every time. */
function nameOf(i: number): [string, string] {
  // 13 and 7 share no factor with 40, so each first name meets a different surname every round.
  return [FIRST[i % FIRST.length]!, LAST[(13 * i + 11 + 7 * Math.floor(i / FIRST.length)) % LAST.length]!];
}

function emailOf([first, last]: [string, string], domain: string) {
  return `${first}.${last}@${domain}`.toLowerCase();
}

/**
 * Who the `count` people are: on the waitlist, given an allowance but not yet signed in, invited but
 * not yet signed in, signed in in no organization, owners of the organizations they started, and
 * members of one organization or several (some at example.com, as freelancers are, in two or three).
 * Organizations come in different sizes, biggest first. Pure: the same count gives the same plan.
 */
export function planPeople(count: number = DEFAULT_COUNT): Plan {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`--count is a whole number from 1 to ${MAX_COUNT}.`);
  const orgCount = Math.min(ORGANIZATIONS.length, Math.max(1, Math.round(count / 12)));
  const owners = Math.min(orgCount, count);
  const waitlist = Math.floor(count * 0.18);
  const allowed = Math.floor(count * 0.06);
  const invited = Math.floor(count * 0.12);
  const signedIn = Math.floor(count * 0.1);
  const members = Math.max(0, count - owners - waitlist - allowed - invited - signedIn);

  let i = 0;
  const next = () => nameOf(i++);
  const people: PlannedPerson[] = [];
  const organizations: PlannedOrganization[] = [];
  for (let k = 0; k < owners; k++) {
    const [orgName, word] = ORGANIZATIONS[k]!;
    const domain = `${word}.example`;
    const name = next();
    const slug = orgName.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const email = emailOf(name, domain);
    organizations.push({ name: orgName, slug, domain, owner: email, plan: sizingPlans()[0]?.id ?? "unlimited" });
    people.push({ email, name: name.join(" "), kind: "owner", organizations: [{ slug, role: "owner" }], allowance: 1 });
  }

  // Members by organization, in shares 1, 1/2, 1/3…: one big organization, a few middling, the rest small.
  const weights = organizations.map((_, k) => 1 / (k + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const cumulative = weights.map((_, k) => weights.slice(0, k + 1).reduce((a, b) => a + b, 0) / total);
  const firstOf = new Set<string>();
  for (let m = 0; m < members; m++) {
    const k = cumulative.findIndex((c) => (m + 0.5) / members < c);
    const org = organizations[k === -1 ? organizations.length - 1 : k]!;
    const freelance = m % 5 === 4 && organizations.length > 1;
    const name = next();
    const email = emailOf(name, freelance ? "example.com" : org.domain);
    // The first member of each organization is an admin, as is one in seven; the big one has a second owner.
    const role = !firstOf.has(org.slug) ? (org === organizations[0] && members > 1 ? "owner" : "admin") : m % 7 === 0 ? "admin" : "member";
    firstOf.add(org.slug);
    const orgs: PlannedPerson["organizations"] = [{ slug: org.slug, role }];
    if (freelance) {
      orgs.push({ slug: organizations[(organizations.indexOf(org) + 1) % organizations.length]!.slug, role: "member" });
      if (m % 15 === 14 && organizations.length > 2) orgs.push({ slug: organizations[(organizations.indexOf(org) + 2) % organizations.length]!.slug, role: "member" });
    }
    people.push({ email, name: name.join(" "), kind: "member", organizations: orgs });
  }
  for (let n = 0; n < invited; n++) {
    const org = organizations[n % organizations.length]!;
    const name = next();
    people.push({ email: emailOf(name, n % 4 === 3 ? "example.com" : org.domain), name: name.join(" "), kind: "invited", organizations: [{ slug: org.slug, role: "member" }] });
  }
  for (let n = 0; n < signedIn; n++) {
    const name = next();
    // One in three may start an organization and has not yet.
    people.push({ email: emailOf(name, "example.com"), name: name.join(" "), kind: "signed-in", organizations: [], ...(n % 3 === 0 ? { allowance: 1 } : {}) });
  }
  for (let n = 0; n < allowed; n++) {
    const name = next();
    people.push({ email: emailOf(name, "example.com"), name: name.join(" "), kind: "allowed", organizations: [], allowance: n % 4 === 3 ? 2 : 1 });
  }
  for (let n = 0; n < waitlist; n++) {
    const name = next();
    const place = WAITLIST_PLACES[n % WAITLIST_PLACES.length]!;
    const domain = `${place.split(" ")[0]!.toLowerCase()}.example`;
    people.push({ email: emailOf(name, domain), name: name.join(" "), kind: "waitlist", organizations: [], interest: { organization: place, note: WAITLIST_NOTES[n % WAITLIST_NOTES.length]! } });
  }
  for (const org of organizations) {
    const n = people.filter((p) => p.organizations.some((o) => o.slug === org.slug)).length;
    const fits = (max: number | null) => max === null || n <= max;
    org.plan = sizingPlans().find((p) => fits(p.limits.members_max))?.id ?? "unlimited";
  }
  return { count, organizations, people, allowlist: `@${organizations[0]!.domain}` };
}

// ---- Putting them on an instance ----------------------------------------------------------------

export interface AddPeopleOptions {
  /** The instance's address, as a browser opens it. */
  url: string;
  count?: number;
  /** An instance owner, who gives the allowances. */
  owner?: string;
  log?: (line: string) => void;
  /** How a wait for a limit is spent; tests pass one that does not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface AddPeopleResult {
  plan: Plan;
  /** What this run did. A second run of the same count adds nothing, and asks the waitlist's form again, which changes nothing. */
  added: { waitlist: number; allowances: number; organizations: number; grants: number; invitations: number };
}

type Answer = { status: number; body: any };

class Client {
  private cookies = new Map<string, string>();
  constructor(
    private readonly url: string,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly log: (line: string) => void,
  ) {}

  /** A call as `as` (signed in through development sign-in), or signed out; a limit's refusal is waited out. */
  async call(as: string | null, method: string, path: string, body?: unknown): Promise<Answer> {
    for (let attempt = 0; ; attempt++) {
      const cookie = as ? this.cookies.get(as) : undefined;
      const res = await fetch(`${this.url}${path}`, {
        method,
        headers: { origin: this.url, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: kept as text, for the message below.
      }
      if (res.status === 429 && attempt < 5) {
        const seconds = Number(res.headers.get("retry-after") ?? parsed?.error?.details?.retry_after_seconds ?? 60);
        this.log(`  waiting ${seconds}s: ${parsed?.error?.message ?? "a limit"}`);
        await this.sleep((seconds + 1) * 1000);
        continue;
      }
      return { status: res.status, body: parsed };
    }
  }

  async signIn(email: string, display_name?: string) {
    if (this.cookies.has(email)) return;
    const res = await fetch(`${this.url}/auth/dev-sign-in`, { method: "POST", headers: { origin: this.url, "content-type": "application/json" }, body: JSON.stringify({ email, display_name }) });
    if (!res.ok) throw new Error(`Development sign-in as ${email} answered ${res.status}: ${await res.text()}`);
    // The session cookie, by either of its names (__Host-wb_session over HTTPS), never an old name being cleared.
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /^(?:__Host-)?wb_session=./.test(c));
    if (!cookie) throw new Error(`Development sign-in as ${email} set no session.`);
    this.cookies.set(email, cookie);
  }
}

function must(a: Answer, what: string): any {
  if (a.status >= 400) throw new Error(`${what} answered ${a.status}: ${a.body?.error?.message ?? JSON.stringify(a.body)}`);
  return a.body;
}

/** Whether `url` is this machine: a tunnel's end or a local instance, never a deployment. */
function local(url: string) {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Put the plan for `count` on the instance at `url`, adding only what it does not have yet. */
export async function addPeople(opts: AddPeopleOptions): Promise<AddPeopleResult> {
  const url = opts.url.replace(/\/+$/, "");
  const owner = (opts.owner ?? "riley@example.com").toLowerCase();
  const log = opts.log ?? (() => {});
  const plan = planPeople(opts.count ?? DEFAULT_COUNT);
  if (!local(url)) throw new Error(`${url} is not on this machine. Synthetic people go only on a local instance or a tunnel's end, never on a deployment.`);
  const client = new Client(url, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), log);
  const methods = must(await client.call(null, "GET", "/auth/methods"), `${url}/auth/methods`);
  if (!methods.dev) throw new Error(`${url} has no development sign-in, so it is not a development instance.`);
  const added = { waitlist: 0, allowances: 0, organizations: 0, grants: 0, invitations: 0 };

  await client.signIn(owner);
  const allowances = await client.call(owner, "GET", "/api/v1/tenant-allowances");
  if (allowances.status === 403) throw new Error(`${owner} is not an owner of this instance. Pass --owner with an address in its WHATBUILD_INSTANCE_OWNERS.`);
  const have = new Map<string, number>((must(allowances, "Listing allowances").items ?? []).map((a: { email: string; allowed: number }) => [a.email.toLowerCase(), a.allowed]));

  // The waitlist, through the public site's form, as people ask.
  for (const p of plan.people.filter((p) => p.interest)) {
    must(await client.call(null, "POST", "/api/v1/interest", { email: p.email, name: p.name, organization: p.interest!.organization, note: p.interest!.note }), `The interest form for ${p.email}`);
    added.waitlist++;
  }

  // Allowances, from the instance owner, without the notice each would mail.
  for (const p of plan.people.filter((p) => p.allowance !== undefined)) {
    if (have.has(p.email)) continue;
    must(await client.call(owner, "PUT", "/api/v1/tenant-allowances", { email: p.email, allowed: p.allowance, note: "Synthetic person (pnpm people)", notify: false }), `The allowance for ${p.email}`);
    added.allowances++;
  }

  // Everyone with an account signs in once, which makes it.
  for (const p of plan.people.filter((p) => p.kind === "owner" || p.kind === "member" || p.kind === "signed-in")) await client.signIn(p.email, p.name);

  // Each owner starts their organization on their allowance, the instance owner moves it to the plan
  // that holds its people, and its owner lets them in and invites the rest.
  for (const org of plan.organizations) {
    const mine = must(await client.call(org.owner, "GET", "/api/v1/me/products"), `Listing ${org.owner}'s organizations`);
    if (!(mine.tenants ?? []).some((t: { slug: string }) => t.slug === org.slug)) {
      must(await client.call(org.owner, "POST", "/api/v1/tenants", { name: org.name, slug: org.slug }), `Starting ${org.name}`);
      added.organizations++;
    }
    const listedOrgs = must(await client.call(owner, "GET", "/api/v1/organizations"), "Listing organizations");
    const now = (listedOrgs.items ?? []).find((o: { slug: string }) => o.slug === org.slug) as { plan: string; etag: string | null } | undefined;
    if (now && now.plan !== org.plan)
      must(await client.call(owner, "PATCH", "/api/v1/organizations/plan", { tenant: org.slug, plan: org.plan, ...(now.etag ? { expected_etag: now.etag } : {}) }), `Moving ${org.name} to the ${org.plan} plan`);
    const listed = must(await client.call(org.owner, "GET", `/api/v1/tenants/${org.slug}/members`), `Listing ${org.name}'s members`);
    const roleOf = new Map<string, string>();
    for (const m of listed.members ?? []) for (const g of m.grants ?? []) if (g.scope_type === "tenant") roleOf.set(m.email.toLowerCase(), g.role);
    const waiting = new Set<string>((listed.invitations ?? []).map((i: { email: string }) => i.email.toLowerCase()));
    for (const p of plan.people) {
      const here = p.organizations.find((o) => o.slug === org.slug);
      if (!here || p.email === org.owner) continue;
      if (p.kind === "invited" ? waiting.has(p.email) : roleOf.get(p.email) === here.role) continue;
      const given = must(await client.call(org.owner, "POST", `/api/v1/tenants/${org.slug}/members`, { email: p.email, role: here.role }), `Adding ${p.email} to ${org.name}`);
      // Someone not yet in the organization is invited whether or not they have an account; one who has one accepts, as from the email.
      if (p.kind !== "invited" && given.invited)
        must(await client.call(p.email, "POST", "/api/v1/invitations/accept", { token: String(given.invite_link).split("/invite/")[1] }), `${p.email} accepting ${org.name}'s invitation`);
      if (p.kind === "invited") added.invitations++;
      else added.grants++;
    }
  }
  return { plan, added };
}

// ---- The command ----------------------------------------------------------------------------------

const KIND_LABEL: Record<Kind, string> = {
  owner: "Started an organization",
  member: "In organizations",
  "signed-in": "Signed in, in no organization",
  invited: "Invited, not signed in yet",
  allowed: "May start an organization, not signed in yet",
  waitlist: "On the waitlist",
};

/** The people to sign in as, by what they are, for the person at the browser. */
export function describePlan(plan: Plan): string {
  const names = new Map(plan.organizations.map((o) => [o.slug, o.name]));
  const lines: string[] = [];
  for (const kind of Object.keys(KIND_LABEL) as Kind[]) {
    const of = plan.people.filter((p) => p.kind === kind);
    if (!of.length) continue;
    lines.push("", `${KIND_LABEL[kind]} (${of.length})`);
    for (const p of of) {
      const where = p.organizations.map((o) => `${o.role === "member" ? "" : `${o.role} of `}${names.get(o.slug)}`).join(", ");
      const extra = [where, p.allowance !== undefined && kind !== "owner" ? `allowance ${p.allowance}` : "", p.interest ? p.interest.organization : ""].filter(Boolean).join("; ");
      lines.push(`  ${p.email.padEnd(40)} ${p.name.padEnd(22)} ${extra}`);
    }
  }
  return lines.join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const url = arg("url") ?? "http://localhost:5273";
  const count = arg("count") === undefined ? DEFAULT_COUNT : Number(arg("count"));
  const owner = arg("owner");
  console.log(`Adding ${count} synthetic people to ${url}…`);
  const { plan, added } = await addPeople({ url, count, ...(owner ? { owner } : {}), log: console.log });
  console.log(describePlan(plan));
  console.log(`
Added ${added.waitlist} to the waitlist (asked again when already there), ${added.allowances} allowances, ${added.organizations} organizations, ${added.grants} roles and ${added.invitations} invitations; the rest was there already.
Sign in as any of them with development sign-in: type the address, then "As the email above".
To try admission as a stranger would, run the instance with WHATBUILD_SIGNUP_ALLOWLIST=${plan.allowlist}, as pnpm dev:people does:
then an address at ${plan.allowlist.slice(1)}, an invited one or one with an allowance gets a sign-in link, and any other is refused.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
