#!/usr/bin/env node
// What in this repository is waiting for someone, for an agent to tell the person at the start of
// a session (AGENTS.md): dependency updates and alerts, a red run on main, an accepted vulnerability
// whose time is up, unreleased changes production lacks, git hooks that are off, copies outside
// production that may hold an organization no instance owner owns (pulls, golden masters and their
// exports from before pulls checked owners, and a dev copy taken before then), and production's
// database on pace to use up its month's compute hours on Neon.
// Each line names the skill that handles it, if one does. Prints nothing when nothing is waiting.
//
//   pnpm attention

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const out = async (cmd, args) => (await run(cmd, args, { maxBuffer: 1 << 26 })).stdout.trim();
const json = async (cmd, args) => JSON.parse((await out(cmd, args)) || "null");
const days = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const ago = (iso) => (days(iso) === 0 ? "today" : days(iso) === 1 ? "yesterday" : `${days(iso)} days ago`);

/** Code whose change matters to security: a release that holds one should not wait. */
const SENSITIVE = [
  "apps/server/src/auth/", "apps/server/src/app.ts", "apps/server/src/rest.ts", "apps/server/src/mcp.ts",
  "apps/server/src/uploads.ts", "apps/server/src/public-routes.ts", "apps/server/src/adapters/",
  "apps/server/src/parse-process.ts", "apps/server/src/parse-child.ts", "apps/server/src/parse-worker.ts", "apps/server/src/config.ts", "packages/core/src/policy.ts",
  "packages/core/src/execute.ts", "packages/core/src/connector-scope.ts", "packages/core/src/story-html.ts",
  "packages/parsers/src/", "pnpm-lock.yaml", "deploy/Dockerfile",
];

const lines = [];
const say = (text, skill) => lines.push(`- ${text}${skill ? ` (${skill})` : ""}`);

// Local: the hooks that keep private material out.
async function hooks() {
  const path = await out("git", ["config", "--get", "core.hooksPath"]).catch(() => "");
  // A clone that has not run `pnpm install` since the hooks moved from .githooks/ points at nothing.
  if (path !== "scripts/githooks") say("the git hooks are off in this clone: run `corepack pnpm install`, which turns them on");
}

// The vulnerabilities accepted in .github/osv-scanner.toml: each one's id, the day its acceptance
// ends and the days left until then, and its reason, which says what fixes it and when.
function acceptances() {
  let text = "";
  try {
    text = readFileSync(".github/osv-scanner.toml", "utf8");
  } catch {
    return [];
  }
  return text.split("[[IgnoredVulns]]").slice(1).flatMap((block) => {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const until = /^\s*ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2})/m.exec(block)?.[1];
    const reason = /^\s*reason\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(block)?.[1] ?? "";
    return id && until ? [{ id, until, reason, left: Math.ceil((Date.parse(until) - Date.now()) / 86_400_000) }] : [];
  });
}

// How many days before an acceptance ends it is reported. Until then it is in hand, and silent: a
// session cannot act on it, so saying it would only be noise. An acceptance that waits for a fix to
// be a week old ends this many days after the fix's day, so its line first prints on that day.
const DUE_WITHIN_DAYS = 3;

// Local: accepted vulnerabilities that are due, one line for those accepted together (the same day
// and reason). The reason says what fixes the finding.
function accepted() {
  const groups = new Map();
  for (const a of acceptances().filter((a) => a.left <= DUE_WITHIN_DAYS)) {
    const key = `${a.until}\n${a.reason}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  for (const group of groups.values()) {
    const { until, reason, left } = group[0];
    const one = group.length === 1;
    const ids = one ? group[0].id : `${group.slice(0, -1).map((a) => a.id).join(", ")} and ${group.at(-1).id}`;
    const what = `the accepted vulnerabilit${one ? "y" : "ies"} ${ids}`;
    say(
      left > 0
        ? `${what} ${one ? "is" : "are"} due: the acceptance ends on ${until}, in ${left} day${left === 1 ? "" : "s"}${reason ? `. Accepted because: ${reason}` : ""}`
        : `${what} expired on ${until}: fix ${one ? "it" : "them"} or look at ${one ? "it" : "them"} again${reason ? `. Accepted because: ${reason}` : ""}`,
      "triage-security-findings",
    );
  }
}

// The day pulls began to check who owns each organization: a copy taken before it may hold one no
// instance owner owns (okf/decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md).
const OWNERS_CHECKED_SINCE = "2026-10-27T00:00:00Z";

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const plural = (names, one, many) => (names.length === 1 ? one : many);

// The main checkout: pulls and .env live there, shared by every worktree of the clone.
async function mainCheckout() {
  const common = await out("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => "");
  return common ? dirname(common) : ".";
}

// The deployment's values in the main checkout's .env: each setting's value, or "" when it or the
// file is missing.
async function settings() {
  let env = "";
  try {
    env = readFileSync(join(await mainCheckout(), ".env"), "utf8");
  } catch {}
  return (key) => new RegExp(`^${key}=["']?([^"'\n]*)`, "m").exec(env)?.[1]?.trim() ?? "";
}

// Local: copies outside production that may hold an organization no instance owner owns
// (okf/operations/copying-an-organization.md). Pulls and .env live in the main checkout; each
// checkout has its own golden master.
async function copies() {
  const top = await mainCheckout();
  const pulls = resolve(process.env.WHATBUILD_FIXTURE_DIR ?? join(top, ".what-build/fixtures"));
  const unchecked = (existsSync(pulls) ? readdirSync(pulls) : []).filter((d) => {
    const r = readJson(join(pulls, d, "pulled.json"));
    return r && !(r.owned_by_instance_owners === true && !r.for_another_deployment && Array.isArray(r.organizations));
  });
  if (unchecked.length)
    say(
      `${plural(unchecked, "a pull", `${unchecked.length} pulls`)} in .what-build/fixtures (${unchecked.join(", ")}) may hold an organization no instance owner owns: taken before pulls checked owners, or to move into another deployment. No copy outside production loads ${plural(unchecked, "it", "them")}: delete ${plural(unchecked, "it", "them")} (\`rm -r .what-build/fixtures/<name>\`) and pull again`,
      "test-on-a-copy-of-production",
    );
  const golden = [...new Set([resolve(".what-build/e2e"), join(top, ".what-build/e2e")])].flatMap((dir) => [
    join(dir, "golden.json"),
    ...(existsSync(join(dir, "export")) ? readdirSync(join(dir, "export")).map((d) => join(dir, "export", d, "golden.json")) : []),
  ]);
  const old = golden.filter((f) => {
    const r = readJson(f);
    return r && r.owned_by_instance_owners !== true;
  });
  if (old.length)
    say(
      `${plural(old, "a golden master or export", `${old.length} golden masters or exports`)} (${old.map((f) => dirname(f).replace(`${top}/`, "")).join(", ")}) ${plural(old, "was", "were")} built before pulls checked who owns each organization: build the golden master again (\`pnpm fixture pull\`, \`pnpm e2e golden\`), delete old exports, and load a new one on the Docker host`,
      "run-end-to-end-tests",
    );
  const value = await settings();
  if (value("NEON_DEV_PROJECT")) {
    const named = value("NEON_DEV_COPY_ORGANIZATIONS");
    const taken = Date.parse(value("NEON_DEV_COPY_TAKEN"));
    if (!named || named === "all" || !(taken >= Date.parse(OWNERS_CHECKED_SINCE)))
      say(
        "the dev deployment's copy of production was taken before pulls checked who owns each organization, or holds every organization, so it may hold one no instance owner owns: refresh it with only the instance owners' organizations",
        "rehearse-on-the-dev-deployment",
      );
  }
}

// The compute hours (CU-hours) a Neon project has each month on Neon's Free plan, which suspends
// its compute once they are used, until the month ends. `NEON_CU_HOURS` in .env sets another.
const NEON_FREE_CU_HOURS = 100;
const DAY = 86_400_000;
const day = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * What to say about a Neon project's compute hours this billing period, or null while they are in
 * hand: said once the period's pace so far uses them up before it ends (read from a day or more of
 * it), or 80% of them are used. `seconds` is Neon's `compute_time_seconds` (CU-seconds), `start` and
 * `end` the period's bounds and `now` the time, in milliseconds.
 */
export function neonHours({ seconds, allowance, start, end, now = Date.now() }) {
  if (!(allowance > 0) || !(seconds >= 0) || !(start < now && now < end)) return null;
  const used = seconds / 3600;
  const elapsed = now - start;
  const perDay = (used / elapsed) * DAY;
  const runsOut = perDay > 0 ? start + (allowance / perDay) * DAY : Infinity;
  const near = used >= 0.8 * allowance;
  const short = runsOut < end && (elapsed >= DAY || near);
  if (!near && !short) return null;
  const has = `production's database has used ${used.toFixed(1)} of its ${allowance} Neon compute hours (CU-hours) this month`;
  const suspends = "Neon suspends it, and WhatBuild with it";
  if (used >= allowance) return `${has}, so ${suspends}, until ${day(end)}: pay for a Neon plan now`;
  const pace = `${perDay.toFixed(1)} a day`;
  if (short)
    return `${has}, ${pace}: at that pace they run out on ${day(runsOut)} and ${suspends}, until ${day(end)}. Pay for a Neon plan before ${day(runsOut)}`;
  return `${has}, ${pace}, which lasts until they renew on ${day(end)} with little to spare; if they run out first, ${suspends}. Pay for a Neon plan if the pace rises`;
}

// Production's database on Neon: its compute hours this month, from Neon's API
// (`GET /projects/{id}`). The key is the one the build's restore points use, from Secret Manager,
// or NEON_API_KEY. Silent when a setting is missing or Neon does not answer within a few seconds:
// a session's start stays fast.
async function neon() {
  const value = await settings();
  const project = value("NEON_PROJECT");
  const allowance = Number(value("NEON_CU_HOURS") || NEON_FREE_CU_HOURS);
  if (!project || !(allowance > 0)) return;
  const signal = AbortSignal.timeout(6000);
  try {
    const key =
      process.env.NEON_API_KEY ||
      (value("GCP_PROJECT") &&
        (await run("gcloud", ["secrets", "versions", "access", "latest", "--secret", "whatbuild-neon-api-key", "--project", value("GCP_PROJECT")], { signal })).stdout.trim());
    if (!key) return;
    const response = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
    });
    if (!response.ok) return;
    const p = (await response.json())?.project ?? {};
    // A period Neon does not give (its zero time, year 1) is the calendar month, as on the Free plan.
    const now = Date.now();
    const given = (iso) => (Date.parse(iso) > Date.parse("2000-01-01") ? Date.parse(iso) : NaN);
    const month = new Date(now);
    const start = given(p.consumption_period_start) || Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1);
    const end = given(p.consumption_period_end) || Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1);
    const line = neonHours({ seconds: Number(p.compute_time_seconds), allowance, start, end, now });
    if (line) say(line);
  } catch {}
}

const RUN_FIELDS = "workflowName,displayTitle,event,conclusion,status,createdAt,url";

/** How a line names the event that started a run, when a workflow has runs of more than one. */
const EVENTS = { schedule: (n) => `scheduled ${n} run`, push: (n) => `${n} run for a push`, workflow_dispatch: (n) => `${n} run started by hand` };

/**
 * The workflows whose latest finished run on main did not pass, as lines to print. A workflow's runs
 * are told apart by the event that started them: a push run of Security skips the jobs only its
 * weekly schedule runs, so its passing says nothing of the scheduled run's failure. Of Dependabot's
 * runs, only its regular update of each ecosystem counts: an update for one package answers an
 * alert, which is reported with the alerts.
 */
export function failedRuns(runs) {
  const seen = new Set();
  const finished = runs
    .filter((r) => r.status === "completed" && !seen.has(r.url) && seen.add(r.url))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const events = new Map();
  for (const r of finished) events.set(r.workflowName, (events.get(r.workflowName) ?? new Set()).add(r.event));
  const latest = new Map();
  for (const r of finished) {
    const dependabot = r.workflowName === "Dependabot Updates";
    if (dependabot && / for /.test(r.displayTitle)) continue;
    const key = dependabot ? r.displayTitle.replace(/ - Update #\d+$/, "") : `${r.workflowName}\n${r.event}`;
    if (latest.has(key)) continue;
    const name = dependabot ? `Dependabot update (${key})` : r.workflowName;
    const several = !dependabot && events.get(r.workflowName).size > 1;
    latest.set(key, { ...r, name, run: several ? (EVENTS[r.event] ?? ((n) => `${n} run for ${r.event}`))(name) : `${name} run` });
  }
  return [...latest.values()]
    .filter((r) => r.conclusion !== "success" && r.conclusion !== "skipped")
    .map((r) => ({
      text: `the last ${r.run} on main ${r.conclusion === "failure" ? "failed" : `ended ${r.conclusion}`} ${ago(r.createdAt)}: ${r.url}`,
      skill: r.name === "CI" ? "" : "triage-security-findings",
    }));
}

async function github() {
  try {
    await run("gh", ["auth", "status"]);
  } catch {
    say("`gh` is not signed in, so GitHub was not checked");
    return;
  }
  const repo = await out("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const api = (path) => json("gh", ["api", path]).catch(() => null);

  const [prs, dependabot, codeScanning, secrets, runs, scheduled] = await Promise.all([
    json("gh", ["pr", "list", "-R", repo, "--author", "app/dependabot", "--json", "number,title,createdAt"]).catch(() => []),
    api(`repos/${repo}/dependabot/alerts?state=open&per_page=100`),
    api(`repos/${repo}/code-scanning/alerts?state=open&per_page=100`),
    api(`repos/${repo}/secret-scanning/alerts?state=open&per_page=100`),
    // The weekly scheduled runs are listed apart, so that a busy week's pushes do not crowd them out.
    ...[[], ["--event", "schedule"]].map((only) =>
      json("gh", ["run", "list", "-R", repo, "--branch", "main", ...only, "--limit", "60", "--json", RUN_FIELDS]).catch(() => []),
    ),
  ]);

  for (const p of prs ?? []) say(`Dependabot's pull request #${p.number}, ${p.title}, opened ${ago(p.createdAt)}`, "triage-security-findings");
  // An alert whose advisory is accepted in .github/osv-scanner.toml has been looked at; it stays open
  // on GitHub until the fix reaches main, and accepted() reports it when it is due.
  const settled = new Set(acceptances().filter((a) => a.left > 0).map((a) => a.id));
  const advisories = (a) => [a.security_advisory?.ghsa_id, ...(a.security_advisory?.identifiers ?? []).map((i) => i.value)];
  const alerts = (dependabot ?? []).filter((a) => !advisories(a).some((id) => settled.has(id)));
  if (alerts.length) {
    const ids = alerts.map((a) => `${a.dependency?.package?.name} (${a.security_vulnerability?.severity})`);
    say(`${alerts.length} open Dependabot alert${alerts.length === 1 ? "" : "s"}: ${ids.join(", ")}`, "triage-security-findings");
  }
  if (codeScanning?.length) say(`${codeScanning.length} open code scanning alert${codeScanning.length === 1 ? "" : "s"} (CodeQL)`, "triage-security-findings");
  if (secrets?.length) say(`${secrets.length} open secret scanning alert${secrets.length === 1 ? "" : "s"}: rotate first`, "audit-for-leaks");

  for (const r of failedRuns([...(runs ?? []), ...(scheduled ?? [])])) say(r.text, r.skill);

  // What production lacks: it runs releases only.
  await out("git", ["fetch", "--quiet", "--tags", "origin", "main"]).catch(() => {});
  const tag = await out("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "origin/main"]).catch(() => "");
  if (tag) {
    const count = Number(await out("git", ["rev-list", "--count", `${tag}..origin/main`]).catch(() => "0"));
    const released = await out("git", ["log", "-1", "--format=%cI", tag]).catch(() => "");
    if (count > 0) {
      const changed = (await out("git", ["diff", "--name-only", tag, "origin/main"]).catch(() => "")).split("\n");
      const sensitive = changed.some((f) => SENSITIVE.some((s) => f === s || f.startsWith(s)));
      if (sensitive || (released && days(released) >= 14))
        say(
          `main is ${count} commit${count === 1 ? "" : "s"} ahead of ${tag}${released ? `, released ${ago(released)}` : ""}${sensitive ? ", including changes to security-sensitive code that production does not have yet" : ""}; production runs releases only`,
          "make-a-release",
        );
    }
  }
}

// Run as a script, not when a test imports neonHours or failedRuns.
const main = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (main) {
  await Promise.all([hooks(), github(), copies(), neon()]);
  accepted();

  if (lines.length) {
    console.log("Waiting for attention in this repository:");
    console.log(lines.join("\n"));
  }
}
