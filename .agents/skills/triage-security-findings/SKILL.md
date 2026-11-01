---
name: triage-security-findings
description: Find and fix known vulnerabilities and security weaknesses in WhatBuild with the repository's own scanners (osv-scanner for dependencies, zizmor for GitHub Actions, OWASP ZAP for the running app, CodeQL once public) and Dependabot. Use when asked to check dependencies or security, when `pnpm security` or the Security or CodeQL workflow fails, when Dependabot opens an alert or a pull request, when adding or upgrading a dependency, when updating a pinned scanner, and before a release.
---

# Triage security findings

You are finding known vulnerabilities and weaknesses, and fixing them. The knowledge, with every
command, is in `okf/operations/security-checks.md`; what the app defends and where is in
`okf/system/security.md`. Read the guide before the first command. This file is how to conduct the
work.

## What must stay true

- **Fix before accepting.** Upgrade a dependency or fix a workflow. Accept a finding only when no
  fix exists or WhatBuild cannot reach the vulnerable code, with a reason and an expiry, as the
  guide says.
- **A vulnerability WhatBuild reaches, or one being exploited, does not wait a week.** Fix it the
  day it is found, with the exception the guide gives for a release younger than a week. Only one
  WhatBuild cannot reach waits for its fix to age.
- **An acceptance is its own follow-up.** Its reason says what fixes the finding and when: for a
  fix waiting to be a week old, its version and the first whole day it is. `pnpm attention` says
  nothing of it until that day, then prints the reason: offer that fix, not a new triage. A finding
  already accepted is in hand before then, so do not raise it or triage it again. If you also
  schedule the fix with your own tools, look first for a schedule someone already made for it.
- **Never weaken a check silently.** A rule turned off, an ignore added or a scanner skipped is
  said plainly in the commit message and in your report.
- **An unfixed weakness is never described in the repository.** Not in `okf/`, not in a commit
  message, issue or pull request, until it is fixed. Report it to the person instead.
- **A major upgrade is a change like any other**: read its changelog for breaking changes, then
  `pnpm typecheck`, `pnpm test` and `pnpm build`.

## Procedure

1. **See what is waiting:** `pnpm attention` lists Dependabot's pull requests, its alerts that
   are not accepted, failed runs on `main`, and accepted vulnerabilities that are due, with their
   reasons. **Run the scanners:** `pnpm security`. With `GH_TOKEN=$(gh auth token)` zizmor adds its online
   audits. For the running app, run the Security workflow's ZAP job (`gh workflow run security.yml`)
   and read its summary.
   A ZAP run that fails on rule 10116 (ZAP is out of date) means ZAP published a newer version:
   pin it by tag and digest in `security.yml`, as the guide's "Updating the scanners" shows.
2. **For each finding**, say what it is, whether WhatBuild reaches it (which package uses it, and
   for what), and the fix: the version that fixes it, or the workflow change.
3. **Fix** as the guide's "When a scanner finds a vulnerability" says, one package or workflow at a
   time, running the checks after each.
4. **Run `pnpm security` again** until it is clean or every remaining finding is accepted with a
   reason and an expiry.
5. **Report** what you upgraded or changed, what you accepted and until when, and anything that
   needs the person's decision.
