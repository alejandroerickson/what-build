---
type: Process
title: Keeping private material out of the repository and finding known vulnerabilities
description: The checks that keep secrets and private material out of what is published and find known vulnerabilities, where each runs, what to do about a finding, how to audit everything GitHub holds, and how to make the repository public.
tags: [operations, security, public, privacy, dependencies, ci, agents]
generated: {by: agent:claude, at: 2026-11-01}
status: stable
---

# Security checks

Two kinds of check, both run from this repository with pinned tools, with nothing to install or
host ([decision](../decisions/privacy-and-security-checks-live-in-the-repository.md)):

- **Nothing private is published.** `scripts/check-publishable.mjs` refuses secrets, paths from
  someone's machine, personal email addresses (in text, or as a commit's author), talk about a
  session or a link to one, an account of the work in the first person, and files where the
  repository keeps none. It checks commits, and the text GitHub holds beside them.
- **Known vulnerabilities are found.** `pnpm security` (osv-scanner for the dependencies, zizmor
  for the GitHub Actions workflows), Dependabot, an OWASP ZAP scan of the running app, and CodeQL
  once the repository is public.

What the app itself defends against, and where, is in the [threat model](../system/security.md).

## Where each check runs

| Check | Runs | Effect |
|---|---|---|
| `check-publishable --staged` | the `pre-commit` hook: the files, and the address the commit will carry | refuses the commit |
| `check-publishable --message` | the `commit-msg` hook | refuses the commit |
| `check-publishable --revs` | the `pre-push` hook, over the commits the remote lacks; the hook also refuses any ref but a branch or a tag | refuses the push |
| the same, job **Nothing private** in `ci.yml` | every pull request's commits, and every push to `main` | a red check |
| `check-publishable --text`, workflow `pull-request-text.yml` | a pull request's title and description, when it is opened and whenever either is edited | a red check |
| `check-publishable --all` | weekly in `security.yml`; the `audit-for-leaks` skill | a red run |
| `check-publishable --github` | weekly in `security.yml` with `--since 8d`: the past week's pull request and issue text, comments, reviews, release notes, Actions logs and artifacts; all of it in the `audit-for-leaks` skill | a red run |
| `pnpm security` | `security.yml` on every pull request, push to `main` and weekly; anyone, any time | a red check |
| OWASP ZAP baseline | `security.yml` weekly, on demand, and on a pull request labelled `zap` | a red run, a report |
| Tenant isolation and row-level security | `pnpm test`: every operation from another organization, and every table's policy ([§3.6](../spec/03-accounts-teams-and-identity.md)) | a red CI |
| CodeQL | `codeql.yml` on pull requests, pushes and weekly, once the repository is public | alerts in the Security tab |
| Dependabot | alerts and a security update as an advisory appears; grouped version updates weekly, for releases at least seven days old | pull requests |
| `pnpm attention` | at the start of every agent session (`AGENTS.md`): Dependabot's pull requests, its alerts but those accepted in `.github/osv-scanner.toml`, code and secret scanning alerts, the last run of each workflow on `main`, accepted vulnerabilities once they are due (the last three days of the acceptance) with their reasons, unreleased changes to security-sensitive code, hooks that are off, and pulls, golden masters, exports and a dev copy that may hold an organization no instance owner owns ([copying an organization](copying-an-organization.md#which-organizations-may-leave-production)) | tells the person |

`pnpm install` installs the hooks: its `prepare` script points `core.hooksPath` at
`scripts/githooks/`. It sets that for the worktree it runs in (git's `extensions.worktreeConfig`),
because the worktrees of a clone share the rest of its configuration: a worktree on a branch from
before the hooks moved, which keeps them in `.githooks/`, sets the shared value and keeps its own
hooks, and neither turns the other's off. The hooks need only Node. `scripts/tools.mjs` downloads
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
| `local-path` | an absolute path into a home directory, on macOS, Linux or Windows, other than those of GitHub's runners and Dependabot's, which their logs name |
| `email` | an address outside the synthetic domains (`example.com`, `.example`, `.test`), `what-build.com`, GitHub's no-reply addresses and Google service accounts; a `%s` local part, a placeholder in a URL a command builds from a secret, is not an address |
| `identity` | such an address as a commit's author or committer, and as the address a commit being made will carry (`git config user.email`, or `GIT_AUTHOR_EMAIL` and the like) |
| `session-talk` | phrases that report a request made in a session, addressed to the agent or naming the user |
| `session-link` | a link to an agent's session or to a chat: a `claude.ai/code/…` session, a `Claude-Session:` trailer, a shared chat. Some tools add these to commits and pull requests by themselves |
| `narration` | in commit messages and the text beside the code only: an account of the work in the first person (*I* or *we* checked, tried, found…), a session as the work's context (*the next session*, *this agent session*), or the conversation (*as discussed*, *you asked*) |
| `top-level` | a top-level file or directory not in `TOP_LEVEL` |
| `agent-local` | anything in `.claude/` but the link to the skills and `CLAUDE.md`, the link to `AGENTS.md` |
| `stray-document` | a document (`.md`, `.txt`, `.log`…) outside `okf/`, `.agents/skills/`, `.github/` (where `SECURITY.md` and `CONTRIBUTING.md` are), `AGENTS.md`, a `README.md`, the web app's `PRODUCT.md` and `DESIGN.md`, the product skill, the end-to-end test plans in `e2e/plans/` and test folders |
| `never-commit` | `.env` files, `_private/`, `.what-build/`, keys, certificates, database files and dumps, wherever they are |
| `media` | images, PDFs, office documents, recordings and archives outside `apps/web/public/` and `.github/assets/` (the README's pictures); these are how real data slips in |
| `large-file` | a file over 1 MB other than `pnpm-lock.yaml` and the README's animated tour, `.github/assets/whatbuild.gif` |

Content and secret rules hold for every commit ever published. The placement rules (`top-level`,
`agent-local`, `stray-document`) hold for commits made under the check, which are those whose tree
holds the script: earlier history kept documents in other places. The entries the root gave up for
folders on 2026-10-24 (`SECURITY.md`, `CLAUDE.md`, `DESIGN.md`, `PRODUCT.md`, `.impeccable/`,
`Dockerfile`, `cloudbuild.yaml`, `.githooks/`) are allowed at the root in commits made before
2026-10-26 (`MOVED_FROM_TOP_LEVEL`). `identity`, `session-link` and
`narration` hold for what was published from 2026-10-24, the day they were added. What came
before was audited by hand that day, and what it found stays: a personal address as the author of
commits up to 2026-10-01, one session link, and first-person lines in two pull requests. None of
it is a secret, and rewriting history would change every commit since. In CI the matched text is
never printed, so a log does not repeat a leak; run the same command locally to see it.

## When a check blocks

- **Fix the content.** Notes, logs, handoffs and scratch files go in `_private/` at the root of
  the checkout, which is ignored. Addresses use `example.com` or a `.example` domain. Paths are
  relative to the repository. A commit message describes the change, not the conversation
  ([what goes in one](../process/working-in-this-repository.md#commit-messages-and-pull-request-descriptions)).
- **`identity`**: set `git config user.email` to the no-reply address GitHub shows under
  Settings → Emails, then `git commit --amend --reset-author --no-edit` for a commit already made.
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
   pnpm resolves no release younger than a week (`minimumReleaseAge` in `pnpm-workspace.yaml`),
   as Dependabot's routine updates wait; take the newest version that fixes the advisory and is
   old enough.

   **A vulnerability WhatBuild reaches, or one being exploited, does not wait.** Fix it the day it
   is found, even with a release younger than a week: read what changed in that release, name its
   exact version in `minimumReleaseAgeExclude` there (`package@version`), with a comment, and take
   the entry out once it has aged. Only a vulnerability WhatBuild cannot reach waits for its fix
   to be a week old, accepted as step 2 says.

   The image takes the packages the server leaves out of its bundle
   (`packages/server-external`), and everything beneath them, from `pnpm-lock.yaml`, with
   `pnpm deploy --prod --ignore-scripts` in `deploy/Dockerfile`, so the file these scans read holds
   the tree that ships, and no package runs an install script. That install, like
   `--frozen-lockfile`, resolves nothing and does not ask `minimumReleaseAge` again: the wait holds
   where an upgrade resolves a release into the lockfile, and nothing in CI checks an entry's age
   afterwards. An entry made some other way, such as a security update or a hand edit, reaches the
   image once it is merged, so whoever reviews a lockfile change judges it. To raise one of those
   packages, raise it in `packages/server-external` and where the code imports it, or
   `pnpm update -r <package>`: `apps/server/build.mjs` fails if the two resolve to different
   versions.
2. **Accept it only if no fix exists or WhatBuild cannot reach it**: an `[[IgnoredVulns]]` entry
   in `.github/osv-scanner.toml` with its `reason` and an `ignoreUntil` no more than 90 days away.
   The reason says why, and what fixes it and when: for a fix that waits to be a week old, its
   version and the first whole day (UTC) it is a week old, with `ignoreUntil` three days after
   that day. While the acceptance lasts, `pnpm attention` leaves Dependabot's alert for it out and
   says nothing of it until its last three days, when it prints the reason. So a session raises
   the finding on the day it can be fixed, and not before, and those three days pass before
   `pnpm security` goes red on it. An acceptance with no fix to wait for comes up the same way,
   three days before it ends, to be looked at again.
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
6. **A CodeQL alert** is fixed in the code when it is right, with a test that holds the fix; the
   alert closes on the next analysis of `main`. One that is wrong, or that is in a test or in a
   local tool doing what it is for, is dismissed in the Security tab or with
   `gh api -X PATCH repos/<owner>/<repo>/code-scanning/alerts/<n> -f state=dismissed -f dismissed_reason=<false positive|used in tests|won't fix> -f dismissed_comment=<why>`.
   The comment says why in terms of the code: what the value is, and where it goes.

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

Then the text GitHub holds beside the code, and what workflows printed and kept: pull request and
issue titles, descriptions, comments and reviews, release notes, every Actions log, and every
artifact that has not expired. A build record (an artifact named `*.dockerbuild`) holds the event
that started its build, the pusher's address with it. `--github` downloads all of it into a
temporary folder, checks it with the same rules and gitleaks, and deletes the folder; it takes a
few minutes for a few hundred runs:

```sh
node scripts/check-publishable.mjs --github
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

   And two Actions settings: a pull request from anyone outside the repository waits for approval
   before its workflows run, not only a first one; and every action must be pinned to a commit,
   which zizmor already holds the workflows to:

   ```sh
   gh api -X PUT repos/<owner>/what-build/actions/permissions/fork-pr-contributor-approval \
     -f approval_policy=all_external_contributors
   gh api -X PUT repos/<owner>/what-build/actions/permissions \
     -F enabled=true -f allowed_actions=all -F sha_pinning_required=true
   ```

   A deploy key that let another repository's workflow clone this one while it was private is no
   longer needed: change that workflow to clone over HTTPS with no credentials, then delete the
   key (`gh repo deploy-key list`, `gh repo deploy-key delete <id>`).

5. CodeQL starts by itself on the next push to `main`; its results appear in the Security tab.
6. Make the container image public as well: it is built from an allow-list of source
   (`.dockerignore`) and holds nothing the repository does not, and a public image lets others run
   a release without credentials. GitHub has no API for a package's visibility, so ask the person
   to open `https://github.com/users/<owner>/packages/container/what-build/settings`, choose
   **Change visibility**, then **Public**, and wait. Confirm it without credentials: a pull token
   comes back only for a public image,
   `curl -s "https://ghcr.io/token?scope=repository:<owner>/what-build:pull"`.
7. Check: the Security tab offers **Report a vulnerability**, shows [`SECURITY.md`](../../.github/SECURITY.md),
   and lists secret scanning, push protection, Dependabot and code scanning as on.
