#!/usr/bin/env node
// What in this repository is waiting for someone, for an agent to tell the person at the start of
// a session (AGENTS.md): dependency updates and alerts, a red run on main, an accepted vulnerability
// whose time is up, unreleased changes production lacks, git hooks that are off, and copies outside
// production that may hold an organization no instance owner owns: pulls, golden masters and their
// exports from before pulls checked owners, and a dev copy taken before then.
// Each line names the skill that handles it. Prints nothing when nothing is waiting.
//
//   pnpm attention

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  "apps/server/src/parse-thread.ts", "apps/server/src/config.ts", "packages/core/src/policy.ts",
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

// Local: accepted vulnerabilities whose time is up or nearly up, one line for those accepted together
// (the same day and reason). The reason shows that the finding is in hand, and when it can be fixed.
function accepted() {
  const groups = new Map();
  for (const a of acceptances().filter((a) => a.left <= 30)) {
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
        ? `${what} expire${one ? "s" : ""} on ${until}, in ${left} day${left === 1 ? "" : "s"}${reason ? `. Accepted because: ${reason}` : ""}`
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

// Local: copies outside production that may hold an organization no instance owner owns
// (okf/operations/copying-an-organization.md). Pulls and .env live in the main checkout; each
// checkout has its own golden master.
async function copies() {
  const common = await out("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => "");
  const top = common ? dirname(common) : ".";
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
  let env = "";
  try {
    env = readFileSync(join(top, ".env"), "utf8");
  } catch {
    return;
  }
  const value = (key) => new RegExp(`^${key}=["']?([^"'\n]*)`, "m").exec(env)?.[1]?.trim() ?? "";
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

async function github() {
  try {
    await run("gh", ["auth", "status"]);
  } catch {
    say("`gh` is not signed in, so GitHub was not checked");
    return;
  }
  const repo = await out("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const api = (path) => json("gh", ["api", path]).catch(() => null);

  const [prs, dependabot, codeScanning, secrets, runs] = await Promise.all([
    json("gh", ["pr", "list", "-R", repo, "--author", "app/dependabot", "--json", "number,title,createdAt"]).catch(() => []),
    api(`repos/${repo}/dependabot/alerts?state=open&per_page=100`),
    api(`repos/${repo}/code-scanning/alerts?state=open&per_page=100`),
    api(`repos/${repo}/secret-scanning/alerts?state=open&per_page=100`),
    json("gh", ["run", "list", "-R", repo, "--branch", "main", "--limit", "60", "--json", "workflowName,displayTitle,conclusion,status,createdAt,url"]).catch(() => []),
  ]);

  for (const p of prs ?? []) say(`Dependabot's pull request #${p.number}, ${p.title}, opened ${ago(p.createdAt)}`, "triage-security-findings");
  // An alert whose advisory is accepted in .github/osv-scanner.toml has been looked at; it stays open
  // on GitHub until the fix reaches main, and accepted() reports it again when its time is nearly up.
  const settled = new Set(acceptances().filter((a) => a.left > 0).map((a) => a.id));
  const advisories = (a) => [a.security_advisory?.ghsa_id, ...(a.security_advisory?.identifiers ?? []).map((i) => i.value)];
  const alerts = (dependabot ?? []).filter((a) => !advisories(a).some((id) => settled.has(id)));
  if (alerts.length) {
    const ids = alerts.map((a) => `${a.dependency?.package?.name} (${a.security_vulnerability?.severity})`);
    say(`${alerts.length} open Dependabot alert${alerts.length === 1 ? "" : "s"}: ${ids.join(", ")}`, "triage-security-findings");
  }
  if (codeScanning?.length) say(`${codeScanning.length} open code scanning alert${codeScanning.length === 1 ? "" : "s"} (CodeQL)`, "triage-security-findings");
  if (secrets?.length) say(`${secrets.length} open secret scanning alert${secrets.length === 1 ? "" : "s"}: rotate first`, "audit-for-leaks");

  // The latest finished run of each workflow on main. Of Dependabot's runs, only its regular update of
  // each ecosystem counts: an update for one package answers an alert, which is reported above.
  const latest = new Map();
  for (const r of runs ?? []) {
    if (r.status !== "completed") continue;
    const dependabot = r.workflowName === "Dependabot Updates";
    if (dependabot && / for /.test(r.displayTitle)) continue;
    const key = dependabot ? r.displayTitle.replace(/ - Update #\d+$/, "") : r.workflowName;
    if (!latest.has(key)) latest.set(key, { ...r, workflowName: dependabot ? `Dependabot update (${key})` : r.workflowName });
  }
  for (const r of latest.values()) {
    const name = r.workflowName;
    if (r.conclusion === "success" || r.conclusion === "skipped") continue;
    const skill = name === "CI" ? "" : "triage-security-findings";
    say(`the last ${name} run on main ${r.conclusion === "failure" ? "failed" : `ended ${r.conclusion}`} ${ago(r.createdAt)}: ${r.url}`, skill);
  }

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

await Promise.all([hooks(), github(), copies()]);
accepted();

if (lines.length) {
  console.log("Waiting for attention in this repository:");
  console.log(lines.join("\n"));
}
