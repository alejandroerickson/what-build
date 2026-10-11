---
type: Process
title: Keeping private material out of the repository and finding known vulnerabilities
description: The checks that keep secrets and private material out of what is published and find known vulnerabilities, where each runs, what to do about a finding, how to audit everything GitHub holds, and how to make the repository public.
tags: [operations, security, public, privacy, dependencies, ci, agents]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
---

# Security checks

Two kinds of check, both run from this repository with pinned tools, with nothing to install or
host ([decision](../decisions/privacy-and-security-checks-live-in-the-repository.md)):

- **Nothing private is published.** `scripts/check-publishable.mjs` refuses secrets, paths from
  someone's machine, personal email addresses, talk about a session, and files where the
  repository keeps none.
- **Known vulnerabilities are found.** `pnpm security` (osv-scanner for the dependencies, zizmor
  for the GitHub Actions workflows), Dependabot, an OWASP ZAP scan of the running app, and CodeQL
  once the repository is public.

What the app itself defends against, and where, is in the [threat model](../system/security.md).

## Where each check runs

| Check | Runs | Effect |
|---|---|---|
| `check-publishable --staged` | the `pre-commit` hook | refuses the commit |
| `check-publishable --message` | the `commit-msg` hook | refuses the commit |
| `check-publishable --revs` | the `pre-push` hook, over the commits the remote lacks; the hook also refuses any ref but a branch or a tag | refuses the push |
| the same, job **Nothing private** in `ci.yml` | every pull request (its commits, title and description) and push to `main` | a red check |
| `check-publishable --all` | weekly in `security.yml`; the `audit-for-leaks` skill | a red run |
| `pnpm security` | `security.yml` on every pull request, push to `main` and weekly; anyone, any time | a red check |
| OWASP ZAP baseline | `security.yml` weekly, on demand, and on a pull request labelled `zap` | a red run, a report |
| Tenant isolation and row-level security | `pnpm test`: every operation from another organization, and every table's policy ([§3.6](../spec/03-accounts-teams-and-identity.md)) | a red CI |
| CodeQL | `codeql.yml` on pull requests, pushes and weekly, once the repository is public | alerts in the Security tab |
| Dependabot | alerts and a security update as an advisory appears; grouped version updates weekly, for releases at least seven days old | pull requests |
| `pnpm attention` | at the start of every agent session (`AGENTS.md`): Dependabot's pull requests and alerts, code and secret scanning alerts, the last run of each workflow on `main`, accepted vulnerabilities within 30 days of expiry, unreleased changes to security-sensitive code, hooks that are off | tells the person |

`pnpm install` installs the hooks: its `prepare` script points `core.hooksPath` at `.githooks/`,
which covers every worktree of the clone. The hooks need only Node. `scripts/tools.mjs` downloads
each scanner once, checks it against the SHA-256 pinned there, and keeps it in
`~/.cache/what-build/tools/` (or under `$XDG_CACHE_HOME`). If gitleaks cannot be fetched, a commit
goes ahead with a warning; the push and CI check it again.

No check is required to merge. `main` also takes direct pushes, which a required check would
refuse, and a new advisory for a dependency nobody changed should not stop unrelated work. The
hooks stop a leak before it leaves the machine; CI shows what got past them.

## What the publishable check refuses

| Rule | Refuses |
|---|---|
| `secret` | anything gitleaks's default rules find, less what `.github/gitleaks.toml` allows |
| `local-path` | an absolute path into a home directory, on macOS, Linux or Windows |
| `email` | an address outside the synthetic domains (`example.com`, `.example`, `.test`), `what-build.com`, GitHub's no-reply addresses and Google service accounts; a `%s` local part, a placeholder in a URL a command builds from a secret, is not an address |
| `session-talk` | phrases that report a request made in a session, addressed to the agent or naming the user |
| `top-level` | a top-level file or directory not in `TOP_LEVEL` |
| `agent-local` | anything in `.claude/` but the link to the skills |
| `stray-document` | a document (`.md`, `.txt`, `.log`…) outside `okf/`, `.agents/skills/`, `.github/`, the root records (`AGENTS.md`, `README.md`, `SECURITY.md`…), a `README.md`, the product skill, the end-to-end test plans in `e2e/plans/` and test folders |
| `never-commit` | `.env` files, `_private/`, `.what-build/`, keys, certificates, database files and dumps, wherever they are |
| `media` | images, PDFs, office documents, recordings and archives outside `apps/web/public/`; these are how real data slips in |
| `large-file` | a file over 1 MB other than `pnpm-lock.yaml` |

Content and secret rules hold for every commit ever published. The placement rules (`top-level`,
`agent-local`, `stray-document`) hold for commits made under the check, which are those whose tree
holds the script: earlier history kept documents in other places. In CI the matched text is never
printed, so a log does not repeat a leak; run the same command locally to see it.

## When a check blocks

- **Fix the content.** Notes, logs, handoffs and scratch files go in `_private/` at the root of
  the checkout, which is ignored. Addresses use `example.com` or a `.example` domain. Paths are
  relative to the repository. A commit message describes the change, not the conversation.
- **Something new should be published**, such as a new top-level file: add it to the lists at the
  top of `scripts/check-publishable.mjs` in the same commit, and say why in its message.
- **A false positive**: narrow the rule in the script, or allow a gitleaks finding in
  `.github/gitleaks.toml` with a comment, in the same commit.
- **Never `git commit --no-verify`.** The push and CI check the same commits again.

## When a scanner finds a vulnerability

```sh
pnpm security             # both scanners
pnpm security deps        # osv-scanner over pnpm-lock.yaml
pnpm security workflows   # zizmor over .github/; GH_TOKEN=$(gh auth token) adds its online audits
```

1. **Upgrade.** A direct dependency: raise it in its `package.json` and `pnpm install`. A
   transitive one: `pnpm update -r <package>`, or a `pnpm.overrides` entry in the root
   `package.json` when its parent pins it. Then `pnpm typecheck`, `pnpm test` and `pnpm build`.
   pnpm installs no release younger than a week (`minimumReleaseAge` in `pnpm-workspace.yaml`),
   as Dependabot waits; take the newest version that fixes the advisory and is old enough. A fix
   that cannot wait goes in `minimumReleaseAgeExclude` there, with a comment, and comes out once
   it has aged.
2. **Accept it only if no fix exists or WhatBuild cannot reach it**: an `[[IgnoredVulns]]` entry
   in `.github/osv-scanner.toml` with its `reason` and an `ignoreUntil` no more than 90 days away.
3. **A workflow finding** (zizmor): fix the workflow. Actions are pinned to a commit with the
   version in a comment; checkouts set `persist-credentials: false`; permissions are granted per
   job and no wider than the job needs. Ignore a finding only with a
   `# zizmor: ignore[<audit>]` comment that says why.
4. **The ZAP report** is the run's summary and its `zap-report` artifact. Fix a warning in the
   server's headers where WhatBuild should, add a server test that holds it
   (`apps/server/test/response-headers.test.ts`), and make the rule `FAIL` in
   `.github/zap-rules.tsv` so it stays fixed. A rule that should not fail the scan is `WARN`,
   `INFO` or `IGNORE` there, with the reason on its line. The file holds rules by number, and one
   number can cover several findings (10055 is every check of a page's `Content-Security-Policy`),
   so a rule is `FAIL` only when the app passes all of them. "ZAP is Out of Date" (10116) is
   `FAIL`: when ZAP publishes a release, the next weekly scan fails until the image is pinned to
   it.
5. **Dependabot** pull requests run the same CI. A grouped update that breaks something is split by
   closing it and updating the culprit alone.

Never weaken a check to make it pass without saying so in the commit.

## Updating the scanners

Each is pinned in `scripts/tools.mjs` by version and one SHA-256 per platform. Take the hashes
from the release's checksums file, or from GitHub's digest of each asset:

```sh
gh api repos/<owner>/<repo>/releases/tags/<tag> --jq '.assets[] | "\(.name) \(.digest)"'
```

Change the version and all four hashes in one commit, then run `pnpm security` and
`pnpm check:publishable --all`. Dependabot updates the actions.

The ZAP image is pinned by tag and digest in `security.yml`. The tag is the version of the latest
release of [zaproxy/zaproxy](https://github.com/zaproxy/zaproxy/releases), without its `v`; the
digest is that of its multi-platform index, from the registry with an anonymous token:

```sh
tag=2.17.0
token=$(curl -s "https://ghcr.io/token?scope=repository:zaproxy/zaproxy:pull" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
curl -sI -H "Authorization: Bearer $token" -H "Accept: application/vnd.oci.image.index.v1+json" \
  "https://ghcr.io/v2/zaproxy/zaproxy/manifests/$tag" | grep -i docker-content-digest
```

Then `node scripts/security.mjs workflows`, and run the scan on a pull request labelled `zap`.

## Auditing everything GitHub holds

The `audit-for-leaks` skill conducts this. A mirror clone holds every branch, tag and pull request
ref, including commits a force-push left behind in a pull request:

```sh
mirror=$(mktemp -d)/what-build.git
git clone --mirror https://github.com/<owner>/what-build.git "$mirror"
node scripts/check-publishable.mjs --all --repo "$mirror"
```

Then the text GitHub holds beside the code: pull request titles, descriptions and comments, review
comments, issues, release notes, and every Actions log. Collect it into one folder outside the
repository, and scan it with gitleaks and a search for home-directory paths (other than the
CI runner's own) and real addresses:

```sh
out=$(mktemp -d); r=<owner>/what-build
gh pr list -R $r --state all --limit 1000 --json number,title,body,comments > "$out/prs.json"
gh api --paginate repos/$r/pulls/comments > "$out/review-comments.json"
gh issue list -R $r --state all --limit 1000 --json number,title,body,comments > "$out/issues.json"
for t in $(gh release list -R $r --limit 100 --json tagName --jq '.[].tagName'); do gh release view -R $r "$t" --json body --jq .body; done > "$out/releases.txt"
for id in $(gh run list -R $r --limit 1000 --json databaseId --jq '.[].databaseId'); do gh run view -R $r "$id" --log; done > "$out/actions.log"
node scripts/tools.mjs gitleaks dir --redact --no-banner "$out"
```

## If something private was published

1. **A secret: revoke or rotate it first**, where it was issued. Removing it from history does not
   unpublish it: clones, forks, caches and pull request refs keep it.
2. Remove it from the tree in a new commit.
3. If it must leave history too: rewrite with `git filter-repo` on a fresh clone, push with the
   `main` ruleset bypassed, move release tags that pointed into the rewritten history, and ask
   GitHub Support to drop cached views and the pull request refs that still hold it.

## Making the repository public

1. **Release first.** The public history shows what each fix fixed, so production must already run
   it: if `pnpm attention` reports changes production lacks, make a release with the
   `make-a-release` skill and see it deployed.
2. Audit everything GitHub holds, fresh, as above. Settle every finding.
3. Make it public:
   `gh repo edit <owner>/what-build --visibility public --accept-visibility-change-consequences`.
4. Turn on what GitHub offers public repositories, which the private repository could not have:

   ```sh
   gh api -X PATCH repos/<owner>/what-build \
     -F 'security_and_analysis[secret_scanning][status]=enabled' \
     -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
   gh api -X PUT repos/<owner>/what-build/private-vulnerability-reporting
   ```

5. CodeQL starts by itself on the next push to `main`; its results appear in the Security tab.
6. Make the container image public as well: it is built from an allow-list of source
   (`.dockerignore`) and holds nothing the repository does not, and a public image lets others run
   a release without credentials. GitHub has no API for a package's visibility, so ask the person
   to open `https://github.com/users/<owner>/packages/container/what-build/settings`, choose
   **Change visibility**, then **Public**, and wait. Confirm it without credentials: a pull token
   comes back only for a public image,
   `curl -s "https://ghcr.io/token?scope=repository:<owner>/what-build:pull"`.
7. Check: the Security tab offers **Report a vulnerability**, shows [`SECURITY.md`](../../SECURITY.md),
   and lists secret scanning, push protection, Dependabot and code scanning as on.
