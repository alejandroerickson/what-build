#!/usr/bin/env node
// The scanners the checks use, pinned by version and SHA-256. Each is downloaded once from its
// GitHub release into the user's cache (shared by every checkout and worktree), verified against the
// hash below, and run from there; nobody installs anything. To update one, change its version and
// every hash in the same commit (okf/operations/security-checks.md).
//
//   node scripts/tools.mjs <tool> [args…]   runs a pinned tool, e.g. `node scripts/tools.mjs gitleaks version`

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLS = {
  gitleaks: {
    version: "8.30.1",
    asset: (v, p) => `https://github.com/gitleaks/gitleaks/releases/download/v${v}/gitleaks_${v}_${p}.tar.gz`,
    platforms: {
      "darwin-arm64": ["darwin_arm64", "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"],
      "darwin-x64": ["darwin_x64", "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"],
      "linux-x64": ["linux_x64", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"],
      "linux-arm64": ["linux_arm64", "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"],
    },
    archive: "gitleaks",
  },
  "osv-scanner": {
    version: "2.7.0",
    asset: (v, p) => `https://github.com/google/osv-scanner/releases/download/v${v}/osv-scanner_${p}`,
    platforms: {
      "darwin-arm64": ["darwin_arm64", "d4926ef8da134332543be276dff157e4c170f99ad91fc48e89448a8816bdf70b"],
      "darwin-x64": ["darwin_amd64", "e82c5df7ab0a42dff29a1cd0660711447b56b4c0483ff66ad8634df10fd81a45"],
      "linux-x64": ["linux_amd64", "160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"],
      "linux-arm64": ["linux_arm64", "4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7"],
    },
    archive: null,
  },
  zizmor: {
    version: "1.31.1",
    asset: (v, p) => `https://github.com/zizmorcore/zizmor/releases/download/v${v}/zizmor-${p}.tar.gz`,
    platforms: {
      "darwin-arm64": ["aarch64-apple-darwin", "ad5aa633cd56215b11e6c51d51f90c7e6b22904a75047d1215abbd422f61d698"],
      "darwin-x64": ["x86_64-apple-darwin", "72ae63bb85b67229c06242f04195cb43927e9fab5f43803c6434dc701a517d61"],
      "linux-x64": ["x86_64-unknown-linux-gnu", "d185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99"],
      "linux-arm64": ["aarch64-unknown-linux-gnu", "37eebbd5762a44f262d94875431b14a6d2402991e90a685113ea97b8b41be833"],
    },
    archive: "zizmor",
  },
};

const cacheRoot = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "what-build", "tools");

/** The path of a pinned tool, downloading and verifying it first if this machine lacks it. */
export async function tool(name) {
  const t = TOOLS[name];
  if (!t) throw new Error(`unknown tool ${name}`);
  const key = `${process.platform}-${process.arch}`;
  const target = t.platforms[key];
  if (!target) throw new Error(`${name} is not pinned for ${key}; add it to scripts/tools.mjs`);
  const dir = join(cacheRoot, `${name}-${t.version}-${key}`);
  const bin = join(dir, name);
  if (existsSync(bin)) return bin;

  const [platform, sha256] = target;
  const url = t.asset(t.version, platform);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`downloading ${name} ${t.version}: ${res.status} ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) throw new Error(`${name} ${t.version} from ${url} has SHA-256 ${got}, expected ${sha256}; refusing to run it`);

  mkdirSync(cacheRoot, { recursive: true });
  const tmp = mkdtempSync(join(cacheRoot, `.${name}-`));
  try {
    if (t.archive) {
      writeFileSync(join(tmp, "download.tar.gz"), bytes);
      execFileSync("tar", ["-xzf", join(tmp, "download.tar.gz"), "-C", tmp, t.archive]);
      rmSync(join(tmp, "download.tar.gz"));
      if (t.archive !== name) renameSync(join(tmp, t.archive), join(tmp, name));
    } else {
      writeFileSync(join(tmp, name), bytes);
    }
    chmodSync(join(tmp, name), 0o755);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return bin;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, ...args] = process.argv.slice(2);
  if (!name || !TOOLS[name]) {
    console.error(`usage: node scripts/tools.mjs <${Object.keys(TOOLS).join("|")}> [args…]`);
    process.exit(2);
  }
  const r = spawnSync(await tool(name), args, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
