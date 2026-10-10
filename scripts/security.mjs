#!/usr/bin/env node
// Known vulnerabilities in the dependencies, and weaknesses in the GitHub Actions workflows, found
// with the pinned scanners in scripts/tools.mjs (okf/operations/security-checks.md). Exits 1 if
// either finds something.
//
//   node scripts/security.mjs             both
//   node scripts/security.mjs deps        osv-scanner over pnpm-lock.yaml, against the OSV database
//   node scripts/security.mjs workflows   zizmor over .github/ (online audits when GH_TOKEN is set)

import { spawnSync } from "node:child_process";
import { tool } from "./tools.mjs";

const which = process.argv[2] ?? "all";
let failed = false;

function run(label, bin, args, env = {}) {
  console.log(`\n== ${label}`);
  const r = spawnSync(bin, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) failed = true;
}

if (which === "all" || which === "deps") {
  run("Dependencies (osv-scanner)", await tool("osv-scanner"), [
    "scan", "source", "--lockfile", "pnpm-lock.yaml", "--config", ".github/osv-scanner.toml",
  ]);
}

if (which === "all" || which === "workflows") {
  const online = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  run(`Workflows (zizmor${online ? "" : ", offline: set GH_TOKEN for the online audits"})`, await tool("zizmor"), [
    ...(online ? [] : ["--offline"]), ".github",
  ]);
}

if (!["all", "deps", "workflows"].includes(which)) {
  console.error("usage: security.mjs [deps|workflows]");
  process.exit(2);
}

if (failed) {
  console.error("\nsecurity: findings above. Upgrade, fix, or accept with a reason and an expiry (okf/operations/security-checks.md).");
  process.exit(1);
}
