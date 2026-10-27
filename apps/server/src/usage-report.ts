import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATIONS, usageReport, type UsageOptions } from "@whatbuild/core";
import { createDb } from "./database.ts";

/**
 * How a deployment is used, from every source it has, for a person or an agent to read
 * (okf/operations/analytics.md):
 *
 *   pnpm usage [--days 28] [--include-owners] [--example include|exclude|only] [--json]
 *
 * - The server's own counts (products.usage): every call through the web app and agents, and
 *   people coming back. From WHATBUILD_USAGE_DATABASE_URL, or with GCP_PROJECT, the Cloud Run
 *   deployment's read-only backup role.
 * - Google Analytics, for people who accepted analytics: with GA_PROPERTY, and GA_SERVICE_ACCOUNT
 *   (impersonated with the gcloud sign-in) or GA_ACCESS_TOKEN.
 * - Cloudflare Web Analytics, every visit to the public site: with CF_ANALYTICS_API_TOKEN (Account
 *   Analytics read), CLOUDFLARE_ACCOUNT_ID, and CF_ANALYTICS_SITE_TAG or CF_ANALYTICS_TOKEN.
 *
 * Settings come from the environment, then from .env at the root of the checkout (or of the main
 * checkout, from a git worktree). A source without its settings is skipped and says what it needs.
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function dotEnvFile(): string | null {
  const own = resolve(root, ".env");
  if (existsSync(own)) return own;
  try {
    const main = resolve(root, run("git", ["-C", root, "rev-parse", "--git-common-dir"]), "..", ".env");
    return existsSync(main) ? main : null;
  } catch {
    return null;
  }
}
const dotEnv = new Map<string, string>();
const file = dotEnvFile();
if (file)
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) dotEnv.set(m[1]!, m[2]!.trim().replace(/^["']|["']$/g, ""));
  }
const setting = (name: string) => process.env[name] || dotEnv.get(name) || undefined;

function args() {
  const a = process.argv.slice(2);
  const value = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const days = Number(value("--days") ?? 28);
  const example = (value("--example") ?? "include") as UsageOptions["example"];
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error("--days takes a whole number from 1 to 400.");
  if (!["include", "exclude", "only"].includes(example)) throw new Error("--example takes include, exclude or only.");
  return { days, include_owners: a.includes("--include-owners"), example, json: a.includes("--json") };
}

type Section<T> = { ok: true; data: T } | { ok: false; skipped: string };
const skipped = (why: string) => ({ ok: false as const, skipped: why });

// ---- The server's own counts ------------------------------------------------------------------

async function server(opts: UsageOptions): Promise<Section<Awaited<ReturnType<typeof usageReport>>>> {
  const project = setting("GCP_PROJECT");
  let url = setting("WHATBUILD_USAGE_DATABASE_URL");
  if (!url && project) url = run("gcloud", ["secrets", "versions", "access", "latest", "--secret=whatbuild-backup-database-url", `--project=${project}`]);
  if (!url) return skipped("Set WHATBUILD_USAGE_DATABASE_URL to the deployment's database (a read-only role will do), or GCP_PROJECT for the Cloud Run deployment.");
  // libpq's sslrootcert=system (trust the system's certificates) is a file name to node-postgres, which trusts Node's own.
  const { db, pool } = createDb(url.replace(/([?&])sslrootcert=system(&|$)/, (_, before: string, after: string) => (after ? before : "")), 2);
  try {
    return { ok: true, data: await usageReport(db, OPERATIONS, opts) };
  } catch (e) {
    if (/relation "usage_\w+" does not exist/.test((e as Error).message)) return skipped("This deployment does not count usage yet: it runs a release from before migration 0019_usage.");
    throw e;
  } finally {
    await pool.end();
  }
}

// ---- Google Analytics ---------------------------------------------------------------------------

async function gaToken(): Promise<string | null> {
  const given = setting("GA_ACCESS_TOKEN");
  if (given) return given;
  const account = setting("GA_SERVICE_ACCOUNT");
  if (!account) return null;
  // Google refuses the analytics scopes to gcloud's own sign-in, so the person's sign-in borrows a service account's.
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`, {
    method: "POST",
    headers: { authorization: `Bearer ${run("gcloud", ["auth", "print-access-token"])}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/analytics.readonly"] }),
  });
  const body = (await res.json()) as { accessToken?: string; error?: { message: string } };
  if (!body.accessToken) throw new Error(`Google refused a token for ${account}: ${body.error?.message ?? res.status}`);
  return body.accessToken;
}

type GaRow = Record<string, string | number>;

async function googleAnalytics(days: number): Promise<Section<Record<string, GaRow[] | string>>> {
  const property = setting("GA_PROPERTY");
  if (!property) return skipped("Set GA_PROPERTY (properties/<number>) and GA_SERVICE_ACCOUNT, or GA_ACCESS_TOKEN, to read Google Analytics.");
  const token = await gaToken();
  if (!token) return skipped("Set GA_SERVICE_ACCOUNT (impersonated with your gcloud sign-in) or GA_ACCESS_TOKEN to read Google Analytics.");
  const dateRanges = [{ startDate: `${days - 1}daysAgo`, endDate: "today" }];
  const report = async (dimensions: string[], metrics: string[], extra: Record<string, unknown> = {}): Promise<GaRow[] | string> => {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ dateRanges, dimensions: dimensions.map((name) => ({ name })), metrics: metrics.map((name) => ({ name })), limit: 50, ...extra }),
    });
    const body = (await res.json()) as { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; error?: { message: string } };
    if (body.error) return `not read: ${body.error.message}`;
    return (body.rows ?? []).map((r) => Object.fromEntries([...dimensions.map((d, i) => [d, r.dimensionValues[i]!.value]), ...metrics.map((m, i) => [m, Number(r.metricValues[i]!.value)])]));
  };
  const byViews = { orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }] };
  const byCount = { orderBys: [{ metric: { metricName: "eventCount" }, desc: true }] };
  const [hosts, returning, weeks, screens, actions, sources, countries, devices, search] = await Promise.all([
    report(["hostName"], ["activeUsers", "newUsers", "sessions", "screenPageViews"]),
    report(["hostName", "newVsReturning"], ["activeUsers"]),
    report(["isoYearIsoWeek"], ["activeUsers", "newUsers"], { orderBys: [{ dimension: { dimensionName: "isoYearIsoWeek" } }] }),
    report(["hostName", "pagePath"], ["screenPageViews", "activeUsers"], byViews),
    report(["eventName"], ["eventCount", "totalUsers"], byCount),
    report(["hostName", "sessionSource", "sessionMedium"], ["sessions", "activeUsers"], { orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
    report(["country"], ["activeUsers"], { limit: 15, orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }] }),
    report(["deviceCategory"], ["activeUsers"]),
    // Needs the event-scoped custom dimensions the analytics guide lists; without them it says so.
    report(["eventName", "customEvent:kind", "customEvent:from"], ["eventCount"], { ...byCount, dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "BEGINS_WITH", value: "search_" } } } }),
  ]);
  return { ok: true, data: { hosts, returning, weeks, screens, actions, sources, countries, devices, search } };
}

// ---- Cloudflare Web Analytics -------------------------------------------------------------------

async function cloudflare(days: number): Promise<Section<Record<string, unknown>>> {
  const token = setting("CF_ANALYTICS_API_TOKEN");
  const account = setting("CLOUDFLARE_ACCOUNT_ID");
  if (!token || !account) return skipped("Set CF_ANALYTICS_API_TOKEN (an account token with Account Analytics read) and CLOUDFLARE_ACCOUNT_ID to read Cloudflare Web Analytics.");
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    return (await res.json()) as Record<string, unknown>;
  };
  // Cloudflare answers for up to 31 days at a time.
  const span = Math.min(days, 31);
  const until = new Date();
  const since = new Date(until.getTime() - span * 86400_000);
  const graphql = async (query: string, variables: Record<string, unknown>) =>
    (await api("/graphql", { method: "POST", body: JSON.stringify({ query, variables }) })) as { data?: { viewer: { accounts: Record<string, unknown>[] } }; errors?: { message: string }[] };
  let siteTag = setting("CF_ANALYTICS_SITE_TAG");
  if (!siteTag) {
    // The site's tag is not the token its beacon carries. Listing sites needs more than Account
    // Analytics: Read, so the tag is looked for there first, then among the sites with visits.
    const listed = (await api(`/accounts/${account}/rum/site_info/list?per_page=100`)) as { result?: { site_tag: string; site_token: string }[] };
    siteTag = listed.result?.find((s) => s.site_token === setting("CF_ANALYTICS_TOKEN"))?.site_tag;
    if (!siteTag) {
      const sites = await graphql(
        `query ($account: String!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
          sites: rumPageloadEventsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }) { count dimensions { siteTag } } } } }`,
        { account, since: since.toISOString(), until: until.toISOString() },
      );
      const tags = ((sites.data?.viewer.accounts[0]?.["sites"] ?? []) as { dimensions: { siteTag: string } }[]).map((g) => g.dimensions.siteTag);
      if (tags.length === 1) siteTag = tags[0];
      else return skipped(`${tags.length ? `The account has ${tags.length} sites with visits` : "No site has visits in the period"}: set CF_ANALYTICS_SITE_TAG (the site's tag, in its address in the Web Analytics dashboard).`);
    }
  }
  const group = (name: string, dims: string, order: string, limit: number) =>
    `${name}: rumPageloadEventsAdaptiveGroups(limit: ${limit}, filter: $filter, orderBy: [${order}]) { count sum { visits } dimensions { ${dims} } }`;
  const query = `query ($account: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
    viewer { accounts(filter: { accountTag: $account }) {
      total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: $filter) { count sum { visits } }
      ${group("by_day", "date", "date_ASC", 40)}
      ${group("referrers", "refererHost", "sum_visits_DESC", 15)}
      ${group("countries", "countryName", "sum_visits_DESC", 15)}
      ${group("devices", "deviceType", "sum_visits_DESC", 5)}
      ${group("paths", "requestPath", "count_DESC", 15)}
    } }
  }`;
  const variables = { account, filter: { siteTag, datetime_geq: since.toISOString(), datetime_lt: until.toISOString() } };
  const body = await graphql(query, variables);
  if (body.errors?.length) return skipped(`Cloudflare did not answer: ${body.errors.map((e) => e.message).join("; ")}`);
  // Cloudflare samples page loads, so small counts come in steps.
  return { ok: true, data: { span_days: span, ...(body.data?.viewer.accounts[0] ?? {}) } };
}

// ---- Output -------------------------------------------------------------------------------------

function table(rows: Record<string, unknown>[], limit = 25): string {
  if (!rows.length) return "  (none)\n";
  const cols = Object.keys(rows[0]!);
  const line = (vals: unknown[]) => `  ${vals.map((v) => String(v)).join("  |  ")}\n`;
  return line(cols) + rows.slice(0, limit).map((r) => line(cols.map((c) => r[c]))).join("") + (rows.length > limit ? `  … ${rows.length - limit} more\n` : "");
}

function text(out: { server: Section<Awaited<ReturnType<typeof usageReport>>>; google_analytics: Section<Record<string, GaRow[] | string>>; cloudflare: Section<Record<string, unknown>> }): string {
  let s = "";
  const head = (t: string) => (s += `\n## ${t}\n\n`);
  head("The server's counts: everyone, web app and agents");
  if (!out.server.ok) s += `  Skipped: ${out.server.skipped}\n`;
  else {
    const r = out.server.data;
    s += `  ${r.from} to ${r.to} (${r.days} days); owners ${r.owners}; example organization ${r.example}; counting since ${r.counting_since.calls ?? "nothing yet"}\n`;
    s += `  People: ${r.people.active} active (${r.people.web} web, ${r.people.agents} through agents), ${r.people.new} new, ${r.people.returning} returning\n`;
    s += `  Days active: ${Object.entries(r.people.days_active).map(([k, v]) => `${k}: ${v}`).join(", ")}\n`;
    s += `  Calls: ${r.calls.total} (${r.calls.web} web, ${r.calls.agents} agents, ${r.calls.failed} failed)\n\nWeeks\n${table(r.people.weeks)}\nCohorts (people first seen that week, then back in each week after)\n`;
    s += table(r.people.cohorts.map((c) => ({ week: c.week, people: c.people, weeks_after: c.weeks_after.join(" ") })));
    s += `\nFeatures\n${table(r.features)}\nOperations\n${table(r.operations, 40)}\nAgent clients\n${table(r.clients)}\nFailures\n${table(r.failures)}\n`;
    s += `Not called (${r.not_called.length}): ${r.not_called.join(", ")}\n`;
  }
  head("Google Analytics: people who accepted analytics, web app and site");
  if (!out.google_analytics.ok) s += `  Skipped: ${out.google_analytics.skipped}\n`;
  else for (const [k, v] of Object.entries(out.google_analytics.data)) s += `${k}\n${typeof v === "string" ? `  ${v}\n` : table(v)}\n`;
  head("Cloudflare Web Analytics: every visit to the public site");
  if (!out.cloudflare.ok) s += `  Skipped: ${out.cloudflare.skipped}\n`;
  else
    for (const [k, v] of Object.entries(out.cloudflare.data))
      s += Array.isArray(v) ? `${k}\n${table(v.map((g: { count: number; sum: { visits: number }; dimensions?: Record<string, unknown> }) => ({ ...(g.dimensions ?? {}), visits: g.sum.visits, page_views: g.count })))}\n` : `${k}: ${String(v)}\n`;
  return s;
}

async function main() {
  const { json, ...opts } = args();
  const settle = async <T>(p: Promise<Section<T>>): Promise<Section<T>> => p.catch((e: Error) => skipped(e.message));
  const out = { server: await settle(server(opts)), google_analytics: await settle(googleAnalytics(opts.days)), cloudflare: await settle(cloudflare(opts.days)) };
  process.stdout.write(json ? `${JSON.stringify(out, null, 2)}\n` : `# How WhatBuild is used${text(out)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
