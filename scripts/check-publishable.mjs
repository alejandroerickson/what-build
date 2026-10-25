#!/usr/bin/env node
// Checks that what is about to be published holds nothing private: no secrets, no paths from
// someone's machine, no personal email addresses (in text or as a commit's author), no talk about
// a session or link to one, and no file where the repository does not keep files
// (okf/operations/security-checks.md).
//
//   node scripts/check-publishable.mjs --staged          the commit being made (the pre-commit hook)
//   node scripts/check-publishable.mjs --message <file>  a commit message (the commit-msg hook)
//   node scripts/check-publishable.mjs --text <file>     text published beside the code: a pull request's title and description
//   node scripts/check-publishable.mjs --revs <revs…>    commits, as `git log` takes them: a push, a pull request
//   node scripts/check-publishable.mjs --all [--repo <dir>]
//                                                         the tracked tree and every commit on a ref that
//                                                         can be published, here or in a mirror clone
//   node scripts/check-publishable.mjs --github [--since <date> | <n>d]
//                                                         what GitHub holds beside the code: pull request and
//                                                         issue text, comments, reviews, release notes,
//                                                         Actions logs and artifacts; all of it, or since then
//
// A finding exits 1. In CI the matched text is not printed, so a log never repeats a leak.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

/** Whether an address is a person's, rather than a synthetic one, a no-reply sender or a service's. */
function personal(address) {
  const [local, domain = ""] = address.split("@");
  return !EMAIL_ADDRESS_OK.has(address.toLowerCase()) && !EMAIL_LOCAL_OK.test(local) && !EMAIL_DOMAIN_OK.some((re) => re.test(domain));
}

/** The home directories of GitHub's runners and Dependabot's, which their logs name: no one's machine. */
const RUNNER_HOME = /^(?:\/home\/(?:runner|dependabot)|\/Users\/runner|[A-Za-z]:\\Users\\runneradmin)$/;

/**
 * Rules added after history was published hold for what is published from the day they were
 * added. What came before was audited by hand that day and left as it is.
 */
const ADDED_2026_10_24 = Date.parse("2026-10-24T00:00:00Z");

/**
 * An account of the work in the first person, a session spoken of as the work's context, or the
 * conversation referred to. "Session" alone is the app's own word (signing in), so it needs a
 * qualifier unless it is a later one.
 */
const NARRATION = new RegExp(
  [
    String.raw`(?:I|I've|I'd|I'm|I'll|we|we've)\s+(?:also\s+|then\s+|first\s+|just\s+|now\s+)?(?:checked|tried|ran|found|looked|confirmed|verified|tested|noticed|investigated|fixed|changed|kept|left|chose|decided|went|asked|think|believe|wanted|wrote|updated|removed|added|made|used|saw|could(?:n't| not)|did(?:n't| not)|have|had|was|am|will|would|need|needed|discussed|agreed|talked)`,
    String.raw`(?:the next|a later|a future|this|that|another|an earlier|a previous|the previous) (?:agent|chat|coding|Claude) session|(?:the next|a later|a future) session`,
    String.raw`as (?:you |we )?(?:asked|requested|discussed|agreed)|per (?:our|your) (?:discussion|conversation|chat)|in (?:this|our|the) (?:conversation|chat)|you (?:asked|wanted|said)`,
  ].map((p) => `\\b(?:${p})\\b`).join("|"),
  "i",
);

const CONTENT = [
  {
    rule: "local-path",
    why: "an absolute path from someone's machine",
    find: (line) => {
      for (const m of line.matchAll(/(?:^|[\s"'`(=:,/])((?:\/Users|\/home)\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[^\\\s"'`]+)/g))
        if (!RUNNER_HOME.test(m[1])) return m[1];
    },
  },
  {
    rule: "email",
    why: "an email address that is not a synthetic one (use example.com or a .example domain)",
    find: (line) => {
      // JSON escapes the brackets around an address (\u003c…\u003e); they are not part of it.
      for (const m of line.replace(/\\u[0-9a-f]{4}/gi, " ").matchAll(EMAIL)) if (personal(m[0])) return m[0];
    },
  },
  {
    rule: "session-talk",
    why: "talk about a session or a request; describe the change, not the conversation",
    find: (line) =>
      line.match(/\b(as (you|the user|the maintainer) (asked|requested)|per (your|the user's) request|the user (asked|said|requested)|you asked me)\b/i)?.[0],
  },
  {
    rule: "session-link",
    why: "a link to an agent's session or a chat, which some tools add to commits and pull requests by themselves",
    since: ADDED_2026_10_24,
    find: (line) => line.match(/\b(?:claude\.ai\/(?:code\/session|chat\/|share\/)|chatgpt\.com\/(?:c|share)\/)\S*|^\s*Claude-Session:.*/i)?.[0],
  },
  {
    // Commit messages and text beside the code only: a file may quote a person (sample interviews).
    rule: "narration",
    why: "an account of the work or the session; say what the change does and what was checked, not who did what",
    messages: true,
    since: ADDED_2026_10_24,
    find: (line) => line.match(NARRATION)?.[0],
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

/** A line of a file, or of a message when `path` is empty, published at `when` (a commit's time, a comment's). */
function checkLine(path, lineNo, text, where, when = Date.now()) {
  if (SKIP_CONTENT.has(path)) return;
  for (const c of CONTENT) {
    if ((c.messages && path) || when < (c.since ?? 0)) continue;
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
    let when;
    let file = null;
    let lineNo = 0;
    rl.on("line", (l) => {
      if (l.startsWith("\u0000commit ")) {
        const [sha, time] = l.slice(8).split(" ");
        commit = sha.slice(0, 12);
        when = Number(time) * 1000;
        file = null;
        onCommit(commit);
      } else if (l.startsWith("+++ ")) {
        file = l === "+++ /dev/null" ? null : l.slice(6);
      } else if (l.startsWith("@@ ")) {
        lineNo = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
      } else if (file && l.startsWith("+")) {
        onLine(commit, file, lineNo++, l.slice(1), when);
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

const LOG_PATCH = ["log", "-p", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--format=%x00commit %H %ct"];

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

/** Text published beside the code, every line of it. */
function checkText(text, where, when) {
  text.split("\n").forEach((l, i) => checkLine("", i + 1, l, where, when));
}

/** A commit message, less the lines git drops (those starting with #). */
function checkMessage(text, where, when) {
  checkText(text.split("\n").map((l) => (l.startsWith("#") ? "" : l)).join("\n"), where, when);
}

// ---- Who commits -------------------------------------------------------------------------------

const IDENTITY = "a personal address as a commit's author or committer; set git's user.email to GitHub's no-reply address (github.com/settings/emails)";

/** The author and committer of each commit made since the rule was added. */
function checkIdentities(revList) {
  for (const line of git("log", "--format=%H %ct %ae %ce", ...revList).split("\n").filter(Boolean)) {
    const [sha, time, author, committer] = line.split(" ");
    if (Number(time) * 1000 < ADDED_2026_10_24) continue;
    if (author && personal(author)) report(`${sha.slice(0, 12)} author: `, "identity", IDENTITY, author);
    if (committer && personal(committer)) report(`${sha.slice(0, 12)} committer: `, "identity", IDENTITY, committer);
  }
}

/** The addresses the commit being made will carry, from git's configuration or GIT_AUTHOR_EMAIL and the like. */
function checkOwnIdentity() {
  for (const [who, variable] of [["author", "GIT_AUTHOR_IDENT"], ["committer", "GIT_COMMITTER_IDENT"]]) {
    let ident;
    try {
      ident = git("var", variable);
    } catch {
      continue; // no identity at all: git refuses the commit itself
    }
    const email = /<([^>]*)>/.exec(ident)?.[1];
    if (email && personal(email)) report(`the commit's ${who}: `, "identity", IDENTITY, email);
  }
}

/** Every commit in `revList`: its new files, author and committer, added lines, message and secrets. */
async function checkCommits(revList) {
  checkNewFiles(revList);
  checkIdentities(revList);
  await addedLines([...LOG_PATCH, ...revList], (c, file, n, text, when) => checkLine(file, n, text, `${c} `, when));
  for (const block of git("log", "--format=%x00%H%x1f%ct%x1f%B", ...revList).split("\u0000").filter(Boolean)) {
    const [sha, time, body] = block.split("\u001f");
    checkMessage(body, `${sha.slice(0, 12)} commit message, `, Number(time) * 1000);
  }
  await gitleaks(["git", "--log-opts", revList.join(" "), "."]);
}

// ---- What GitHub holds beside the code ---------------------------------------------------------

/** Each element of a paginated GitHub list; `items` picks the array out of a response that wraps it. */
function ghList(path, items = ".[]") {
  const out = execFileSync("gh", ["api", "--paginate", path, "--jq", `${items} | tojson`], { encoding: "utf8", maxBuffer: 1 << 30 });
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** A run's logs or an artifact, unpacked into `dir`; false when GitHub no longer has it, or not yet. */
function fetchArchive(path, dir) {
  let body;
  try {
    body = execFileSync("gh", ["api", path], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return false;
  }
  mkdirSync(dir, { recursive: true });
  const file = `${dir}.archive`;
  writeFileSync(file, body);
  // Logs and most artifacts come zipped; a build record comes as a gzipped tar. A run whose jobs
  // were all skipped logged nothing and comes as an empty zip, which unzip refuses to open.
  const emptyZip = body.length === 22 && body.readUInt32LE(0) === 0x06054b50;
  if (body[0] === 0x50 && body[1] === 0x4b) {
    if (!emptyZip) execFileSync("unzip", ["-q", "-o", file, "-d", dir]);
  } else if (body[0] === 0x1f && body[1] === 0x8b) execFileSync("tar", ["-xzf", file, "-C", dir]);
  else renameSync(file, join(dir, "content"));
  rmSync(file, { force: true });
  return true;
}

function* filesIn(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* filesIn(path);
    else if (e.isFile()) yield path;
  }
}

/** Every text file under `dir`, named relative to `root`. */
function checkFiles(dir, root, when) {
  for (const path of filesIn(dir)) {
    const bytes = readFileSync(path);
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const name = relative(root, path);
    bytes.toString("utf8").split("\n").forEach((l, i) => checkLine(name, i + 1, l, "", when));
  }
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
  checkOwnIdentity();
  await gitleaks(["git", "--pre-commit", "--staged", "."], { optional: true });
}

async function message(file) {
  const text = readFileSync(file, "utf8").split(/^# -+ >8 -+$/m)[0];
  checkMessage(text, "commit message, ");
  await gitleaks(["stdin"], { optional: true, input: text });
}

async function text(file) {
  const content = readFileSync(file, "utf8");
  checkText(content, "text, ");
  await gitleaks(["stdin"], { input: content });
}

async function revs(list) {
  if (git("rev-list", "--count", ...list).trim() === "0") return;
  await checkCommits(list);
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
  await checkCommits(PUBLISHABLE);
}

/**
 * The text GitHub holds beside the code, and what workflows printed and kept, written or changed
 * since `since` (all of it when 0): pull requests, issues, their comments and reviews, every
 * release's notes, Actions logs and artifacts. Dependabot's text is left out: it quotes its
 * dependencies' release notes, addresses and all.
 */
async function github(since) {
  const r = "repos/{owner}/{repo}";
  const after = since ? new Date(since).toISOString() : "";
  const changed = after ? `&since=${after}` : "";
  const byPeople = (x) => x.user?.login !== "dependabot[bot]";
  const root = mkdtempSync(join(tmpdir(), "check-publishable-"));
  try {
    mkdirSync(join(root, "text"));
    const item = (name, body, where, at) => {
      writeFileSync(join(root, "text", name), body);
      checkText(body, where, Date.parse(at));
    };
    for (const i of ghList(`${r}/issues?state=all&per_page=100${changed}`).filter(byPeople)) {
      const kind = i.pull_request ? "pull request" : "issue";
      item(`${kind.replace(" ", "-")}-${i.number}.txt`, `${i.title}\n\n${i.body ?? ""}`, `${kind} #${i.number}, `, i.created_at);
      if (i.pull_request)
        for (const v of ghList(`${r}/pulls/${i.number}/reviews?per_page=100`).filter((v) => v.body && byPeople(v)))
          item(`review-${v.id}.txt`, v.body, `review ${v.html_url}, `, v.submitted_at);
    }
    for (const c of [...ghList(`${r}/issues/comments?per_page=100${changed}`), ...ghList(`${r}/pulls/comments?per_page=100${changed}`)].filter(byPeople))
      item(`comment-${c.id}.txt`, c.body ?? "", `comment ${c.html_url}, `, c.created_at);
    for (const rel of ghList(`${r}/releases?per_page=100`))
      item(`release-${rel.id}.txt`, `${rel.name ?? ""}\n\n${rel.body ?? ""}`, `release ${rel.tag_name}, `, rel.created_at);

    const created = after ? `&created=${encodeURIComponent(`>=${after.slice(0, 10)}`)}` : "";
    for (const run of ghList(`${r}/actions/runs?per_page=100${created}`, ".workflow_runs[]")) {
      const dir = join(root, `run-${run.id}`);
      if (fetchArchive(`${r}/actions/runs/${run.id}/logs`, dir)) checkFiles(dir, root, Date.parse(run.created_at));
    }
    for (const a of ghList(`${r}/actions/artifacts?per_page=100`, ".artifacts[]").filter((a) => !a.expired && a.created_at >= after)) {
      const dir = join(root, `artifact-${a.id}`);
      if (fetchArchive(`${r}/actions/artifacts/${a.id}/zip`, dir)) checkFiles(dir, root, Date.parse(a.created_at));
    }
    await gitleaks(["dir", root]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- Main --------------------------------------------------------------------------------------

const USAGE = "usage: check-publishable.mjs --staged | --message <file> | --text <file> | --revs <revs…> | --all [--repo <dir>] | --github [--since <date> | <n>d]";

const argv = process.argv.slice(2);
const repoAt = argv.indexOf("--repo");
if (repoAt >= 0) [, repo] = argv.splice(repoAt, 2);
let since = 0;
const sinceAt = argv.indexOf("--since");
if (sinceAt >= 0) {
  const [, value = ""] = argv.splice(sinceAt, 2);
  since = /^\d+d$/.test(value) ? Date.now() - Number.parseInt(value, 10) * 86_400_000 : Date.parse(value);
  if (Number.isNaN(since)) {
    console.error(USAGE);
    process.exit(2);
  }
}
const [mode, ...rest] = argv;

if (mode === "--staged") await staged();
else if (mode === "--message" && rest[0]) await message(rest[0]);
else if (mode === "--text" && rest[0]) await text(rest[0]);
else if (mode === "--revs" && rest.length) await revs(rest);
else if (mode === "--all") await all();
else if (mode === "--github") await github(since);
else {
  console.error(USAGE);
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
