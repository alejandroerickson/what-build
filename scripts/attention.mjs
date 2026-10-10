#!/usr/bin/env node
// What in this repository is waiting for someone, for an agent to tell the person at the start of
// a session (AGENTS.md): dependency updates and alerts, a red run on main, an accepted vulnerability
// whose time is up, unreleased changes production lacks, git hooks that are off. Each line names
// the skill that handles it. Prints nothing when nothing is waiting.
//
//   pnpm attention

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
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
  "packages/parsers/src/", "pnpm-lock.yaml", "Dockerfile",
];

const lines = [];
const say = (text, skill) => lines.push(`- ${text}${skill ? ` (${skill})` : ""}`);

// Local: the hooks that keep private material out.
async function hooks() {
  const path = await out("git", ["config", "--get", "core.hooksPath"]).catch(() => "");
  if (path !== ".githooks") say("the git hooks are off in this clone: run `corepack pnpm install`, which turns them on");
}

// Local: accepted vulnerabilities whose time is up or nearly up.
function accepted() {
  let text = "";
  try {
    text = readFileSync(".github/osv-scanner.toml", "utf8");
  } catch {
    return;
  }
  for (const block of text.split("[[IgnoredVulns]]").slice(1)) {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const until = /^\s*ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2})/m.exec(block)?.[1];
    if (!id || !until) continue;
    const left = Math.ceil((Date.parse(until) - Date.now()) / 86_400_000);
    if (left <= 30) say(`the accepted vulnerability ${id} ${left < 0 ? "expired" : "expires"} on ${until}: fix it or look at it again`, "triage-security-findings");
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
  if (dependabot?.length) {
    const ids = dependabot.map((a) => `${a.dependency?.package?.name} (${a.security_vulnerability?.severity})`);
    say(`${dependabot.length} open Dependabot alert${dependabot.length === 1 ? "" : "s"}: ${ids.join(", ")}`, "triage-security-findings");
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

await Promise.all([hooks(), github()]);
accepted();

if (lines.length) {
  console.log("Waiting for attention in this repository:");
  console.log(lines.join("\n"));
}
