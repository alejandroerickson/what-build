#!/usr/bin/env node
// Checks that what is about to be published holds nothing private: no secrets, no paths from
// someone's machine, no personal email addresses, no talk about a session, and no file where the
// repository does not keep files (okf/operations/security-checks.md).
//
//   node scripts/check-publishable.mjs --staged          the commit being made (the pre-commit hook)
//   node scripts/check-publishable.mjs --message <file>  a commit message (the commit-msg hook)
//   node scripts/check-publishable.mjs --revs <revs…>    commits, as `git log` takes them: a push, a pull request
//   node scripts/check-publishable.mjs --all [--repo <dir>]
//                                                         the tracked tree and every commit on a ref that
//                                                         can be published, here or in a mirror clone
//
// A finding exits 1. In CI the matched text is not printed, so a log never repeats a leak.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { tool } from "./tools.mjs";

const SELF = "scripts/check-publishable.mjs";
const CI = Boolean(process.env.CI);

// ---- Where files may be ------------------------------------------------------------------------

/** Every top-level entry the repository keeps. A new one is added here, in the same commit. */
const TOP_LEVEL = new Set([
  ".agents", ".claude", ".dockerignore", ".gcloudignore", ".githooks", ".github", ".gitignore",
  ".impeccable", ".nvmrc", "AGENTS.md", "CLAUDE.md", "DESIGN.md", "Dockerfile", "LICENSE",
  "PRODUCT.md", "README.md", "SECURITY.md", "apps", "cloudbuild.yaml", "deploy", "e2e", "okf",
  "package.json", "packages", "pnpm-lock.yaml", "pnpm-workspace.yaml", "scripts",
  "tsconfig.base.json", "vitest.config.ts",
]);

/** `.claude/` holds only the link to the skills; local settings stay ignored. */
const CLAUDE_DIR = new Set([".claude/skills"]);

/** Documents live in okf/ and the few places the public-repository decision names. */
const DOC_PLACES = [
  /^okf\//,
  /^\.agents\/skills\//,
  /^(AGENTS|CLAUDE|DESIGN|PRODUCT|README|SECURITY)\.md$/,
  /(^|\/)README\.md$/,
  /^packages\/core\/src\/skill\/SKILL\.md$/,
  /^\.github\//,
  /^e2e\/plans\/[\w-]+\.md$/,
];
const DOC_EXT = /\.(md|markdown|mdx|txt|log|rst|org)$/i;
const TEST_DIR = /(^|\/)(test|tests|__fixtures__)\//;

/** Never committed, wherever they are: local data, credentials, dumps. */
const NEVER = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, "an environment file"],
  [/^_private\//, "private working material"],
  [/(^|\/)\.what-build\//, "local data"],
  [/\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, "a key or certificate"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, "an SSH key"],
  [/\.(sqlite3?|db|dump|bak)$/i, "a database file"],
  [/\.(sql|csv|json|ndjson)\.(gz|zst|bz2)$/i, "a data export"],
];

/** Images, documents, recordings and archives only in the web app's public assets. */
const MEDIA = /\.(png|jpe?g|gif|webp|avif|heic|bmp|tiff?|pdf|mp3|mp4|m4a|mov|webm|wav|zip|tar|tgz|gz|7z|docx?|xlsx?|pptx?|numbers|pages)$/i;
const MEDIA_PLACES = [/^apps\/web\/public\//];

const MAX_BYTES = 1_000_000;
const BIG_OK = new Set(["pnpm-lock.yaml"]);

// ---- What text may not say ---------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
/** Local parts that are no one's: no-reply senders, git, and a printf placeholder in a URL built from a secret. */
const EMAIL_LOCAL_OK = /^(no-?reply|git|%s)$/i;
/** Addresses that belong to services, not people: Dependabot signs its commits with GitHub's. */
const EMAIL_ADDRESS_OK = new Set(["support@github.com"]);
const EMAIL_DOMAIN_OK = [
  /^example\.(com|net|org)$/i, /\.(example|test|invalid|localhost)$/i, /^example$/i,
  /^what-build\.com$/i, /(^|\.)users\.noreply\.github\.com$/i, /\.gserviceaccount\.com$/i,
  /^\d+x\.[a-z]+$/i, // an image at a pixel density, such as icon@2x.png
];

const CONTENT = [
  {
    rule: "local-path",
    why: "an absolute path from someone's machine",
    find: (line) => line.match(/(?:^|[\s"'`(=:,/])((?:\/Users|\/home)\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[^\\\s"'`]+)/)?.[1],
  },
  {
    rule: "email",
    why: "an email address that is not a synthetic one (use example.com or a .example domain)",
    find: (line) => {
      for (const m of line.matchAll(EMAIL)) {
        const [local] = m[0].split("@");
        if (EMAIL_ADDRESS_OK.has(m[0].toLowerCase())) continue;
        if (!EMAIL_LOCAL_OK.test(local) && !EMAIL_DOMAIN_OK.some((re) => re.test(m[1]))) return m[0];
      }
    },
  },
  {
    rule: "session-talk",
    why: "talk about a session or a request; describe the change, not the conversation",
    find: (line) =>
      line.match(/\b(as (you|the user|the maintainer) (asked|requested)|per (your|the user's) request|the user (asked|said|requested)|you asked me)\b/i)?.[0],
  },
];

const SKIP_CONTENT = new Set([SELF, "pnpm-lock.yaml"]);

// ---- Findings ----------------------------------------------------------------------------------

const findings = [];
function report(where, rule, why, match) {
  findings.push({ where, rule, why, match });
}

function checkPath(path, where) {
  const top = path.split("/")[0];
  if (!TOP_LEVEL.has(top)) report(where, "top-level", `a new top-level entry \`${top}\`; the repository keeps a fixed set (TOP_LEVEL in ${SELF})`);
  if (top === ".claude" && ![...CLAUDE_DIR].some((p) => path === p || path.startsWith(`${p}/`)))
    report(where, "agent-local", "a file in .claude/ besides the skills link; local agent settings stay out of the repository");
  if (DOC_EXT.test(path) && !DOC_PLACES.some((re) => re.test(path)) && !TEST_DIR.test(path))
    report(where, "stray-document", "a document outside okf/ and the places the public-repository decision allows; notes go in _private/");
  checkNever(path, where);
}

function checkNever(path, where) {
  for (const [re, what] of NEVER) if (re.test(path)) report(where, "never-commit", `${what}, which is never committed`);
  if (MEDIA.test(path) && !MEDIA_PLACES.some((re) => re.test(path)))
    report(where, "media", "an image, document, recording or archive outside apps/web/public/; these can carry real data");
}

function checkLine(path, lineNo, text, where) {
  if (SKIP_CONTENT.has(path)) return;
  for (const c of CONTENT) {
    const m = c.find(text);
    if (m) report(`${where}${path ? `${path}:${lineNo}` : `line ${lineNo}`}: `, c.rule, c.why, m);
  }
}

// ---- Git ---------------------------------------------------------------------------------------

let repo = ".";
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });

/** Streams `git log -p` (or `diff`) output, calling back for each added line with its file and line number. */
function addedLines(args, onLine, onCommit = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let commit = "";
    let file = null;
    let lineNo = 0;
    rl.on("line", (l) => {
      if (l.startsWith("\u0000commit ")) {
        commit = l.slice(8, 20);
        file = null;
        onCommit(commit);
      } else if (l.startsWith("+++ ")) {
        file = l === "+++ /dev/null" ? null : l.slice(6);
      } else if (l.startsWith("@@ ")) {
        lineNo = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
      } else if (file && l.startsWith("+")) {
        onLine(commit, file, lineNo++, l.slice(1));
      } else if (file && !l.startsWith("-") && !l.startsWith("\\")) {
        lineNo++;
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} exited ${code}`))));
  });
}

/** The refs that can be published: branches, tags, remote branches, and GitHub's pull request refs in a mirror. Local tool refs are left out. */
const PUBLISHABLE = ["--branches", "--tags", "--remotes", "--glob=refs/pull/*"];

const LOG_PATCH = ["log", "-p", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--format=%x00commit %H"];

/** New files in each commit (added, copied, renamed to), with their sizes. */
function newFiles(revs) {
  const out = git("log", "--no-renames", "--diff-filter=AC", "--name-only", "--format=%x00%H", ...revs);
  const files = [];
  for (const block of out.split("\u0000").filter(Boolean)) {
    const [sha, ...paths] = block.split("\n").filter(Boolean);
    for (const p of paths) files.push({ sha, path: p });
  }
  return files;
}

/**
 * The commits made under these rules: those whose tree holds this script. Where files may be
 * applies to them; earlier history kept files elsewhere (docs/ before okf/, for example).
 */
function underRules(shas) {
  if (!shas.length) return new Set();
  const out = execFileSync("git", ["-C", repo, "cat-file", "--batch-check=%(objecttype)"], {
    input: `${shas.map((s) => `${s}:${SELF}`).join("\n")}\n`,
    encoding: "utf8",
  }).split("\n");
  return new Set(shas.filter((_, i) => out[i] === "blob"));
}

function checkNewFiles(revList) {
  const files = newFiles(revList);
  const ruled = underRules([...new Set(files.map((f) => f.sha))]);
  const sizes = blobSizes(files.map((f) => `${f.sha}:${f.path}`));
  files.forEach(({ sha, path }, i) => {
    const where = `${sha.slice(0, 12)} ${path}: `;
    if (ruled.has(sha)) checkPath(path, where);
    else checkNever(path, where);
    if (!BIG_OK.has(path) && sizes[i] > MAX_BYTES) report(where, "large-file", "a file over 1 MB; large files are usually data");
  });
}

/** Sizes of `<rev>:<path>` objects, 0 for one that is missing, in one `git cat-file`. */
function blobSizes(specs) {
  if (!specs.length) return [];
  const out = execFileSync("git", ["-C", repo, "cat-file", "--batch-check=%(objectsize)"], {
    input: `${specs.join("\n")}\n`,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  }).split("\n");
  return specs.map((_, i) => Number(out[i]) || 0);
}

function checkMessage(text, where) {
  text.split("\n").forEach((l, i) => {
    if (!l.startsWith("#")) checkLine("", i + 1, l, where);
  });
}

// ---- gitleaks ----------------------------------------------------------------------------------

async function gitleaks(args, { optional = false, input } = {}) {
  let bin;
  try {
    bin = await tool("gitleaks");
  } catch (e) {
    if (optional) {
      console.warn(`check-publishable: gitleaks is unavailable (${e.message}); secrets are checked again before the push and in CI.`);
      return;
    }
    throw e;
  }
  const config = fileURLToPath(new URL("../.github/gitleaks.toml", import.meta.url));
  const LEAKS = 3;
  const r = spawnSync(bin, [...args, "--config", config, "--exit-code", String(LEAKS), "--redact", "--no-banner", "--verbose", "--log-level", "warn"], {
    cwd: repo === "." ? process.cwd() : repo,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (r.status === LEAKS) {
    process.stdout.write(r.stdout);
    report("", "secret", "a secret (gitleaks; its findings are above, redacted)");
  } else if (r.status !== 0) {
    throw new Error(`gitleaks failed: ${r.stderr || r.stdout}`);
  }
}

// ---- Modes -------------------------------------------------------------------------------------

async function staged() {
  const status = git("diff", "--cached", "--name-status", "--no-renames", "--diff-filter=AC");
  for (const line of status.split("\n").filter(Boolean)) {
    const path = line.split("\t")[1];
    checkPath(path, `${path}: `);
    if (!BIG_OK.has(path) && blobSizes([`:${path}`])[0] > MAX_BYTES) report(`${path}: `, "large-file", "a file over 1 MB; large files are usually data");
  }
  await addedLines(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--no-renames"], (_c, file, n, text) => checkLine(file, n, text, ""));
  await gitleaks(["git", "--pre-commit", "--staged", "."], { optional: true });
}

async function message(file) {
  const text = readFileSync(file, "utf8").split(/^# -+ >8 -+$/m)[0];
  checkMessage(text, "commit message, ");
  await gitleaks(["stdin"], { optional: true, input: text });
}

async function revs(list) {
  if (git("rev-list", "--count", ...list).trim() === "0") return;
  checkNewFiles(list);
  await addedLines([...LOG_PATCH, ...list], (c, file, n, text) => checkLine(file, n, text, `${c} `));
  for (const block of git("log", "--format=%x00%H%x1f%B", ...list).split("\u0000").filter(Boolean)) {
    const [sha, body] = block.split("\u001f");
    checkMessage(body, `${sha.slice(0, 12)} commit message, `);
  }
  await gitleaks(["git", "--log-opts", list.join(" "), "."]);
}

async function all() {
  const bare = git("rev-parse", "--is-bare-repository").trim() === "true";
  if (!bare) {
    for (const path of git("ls-files").split("\n").filter(Boolean)) {
      checkPath(path, `${path}: `);
      if (SKIP_CONTENT.has(path)) continue;
      let text;
      try {
        text = readFileSync(`${repo}/${path}`);
      } catch {
        continue;
      }
      if (text.subarray(0, 8000).includes(0)) continue;
      text.toString("utf8").split("\n").forEach((l, i) => checkLine(path, i + 1, l, ""));
    }
  }
  // History: everything ever committed on a ref that can be published.
  checkNewFiles(PUBLISHABLE);
  await addedLines([...LOG_PATCH, ...PUBLISHABLE], (c, file, n, text) => checkLine(file, n, text, `${c} `));
  for (const block of git("log", ...PUBLISHABLE, "--format=%x00%H%x1f%B").split("\u0000").filter(Boolean)) {
    const [sha, body] = block.split("\u001f");
    checkMessage(body, `${sha.slice(0, 12)} commit message, `);
  }
  await gitleaks(["git", "--log-opts", PUBLISHABLE.join(" "), "."]);
}

// ---- Main --------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const repoAt = argv.indexOf("--repo");
if (repoAt >= 0) [, repo] = argv.splice(repoAt, 2);
const [mode, ...rest] = argv;

if (mode === "--staged") await staged();
else if (mode === "--message" && rest[0]) await message(rest[0]);
else if (mode === "--revs" && rest.length) await revs(rest);
else if (mode === "--all") await all();
else {
  console.error("usage: check-publishable.mjs --staged | --message <file> | --revs <revs…> | --all [--repo <dir>]");
  process.exit(2);
}

// A history that repeats a finding in many commits reports it once per place and rule.
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.where}|${f.rule}|${f.match ?? ""}`;
  return seen.has(k) ? false : seen.add(k);
});

if (unique.length) {
  console.error(`\ncheck-publishable: ${unique.length} finding${unique.length === 1 ? "" : "s"}; this repository is public.\n`);
  for (const f of unique) console.error(`  ${f.where}${f.rule}: ${f.why}${f.match && !CI ? `\n      ${f.match}` : ""}`);
  console.error(`
Fix the content: move private notes to _private/ (ignored), use example.com addresses and
relative paths, and describe the change rather than the conversation. A false positive is fixed
in the rules of ${SELF} in the same commit. Never bypass the check with --no-verify.
`);
  process.exit(1);
}
