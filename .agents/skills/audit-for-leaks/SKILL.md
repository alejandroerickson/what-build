---
name: audit-for-leaks
description: Check everything WhatBuild's GitHub repository holds (every branch, tag and pull request ref, pull request and issue text, release notes, Actions logs and artifacts) for secrets and private material, deal with anything found, and make the repository public. Use when asked to audit, scan or check the repository or its history for secrets, leaks, personal details or private material; when something private may have been committed or pushed; before making the repository public; and when asked to make it public.
---

# Audit for leaks

You are checking what the repository publishes, or will publish, for anything that should not be
there: secrets, paths and names from someone's machine, personal details, notes about a session,
real people's data. The knowledge, with every command, is in `okf/operations/security-checks.md`.
Read it before the first command. This file is how to conduct the work.

## What must stay true

- **Work outside the repository.** Mirror clones, downloaded logs and reports go in a fresh
  temporary folder, never in the checkout, and are deleted when you are done.
- **Never repeat a leak.** Report a finding by place (commit, file, line, rule), never by quoting
  it, in your reply, a commit, an issue or a pull request. Run gitleaks with `--redact`.
- **A secret is rotated before anything else.** Tell the person which credential it is and where it
  was issued; removing it from history does not unpublish it.
- **Rewriting history, force-pushing and changing the repository's visibility are the person's
  calls.** Say what each would do, then wait for their yes.

## Procedure

1. **The working tree and local history:** `pnpm check:publishable --all`.
2. **Everything GitHub holds:** a mirror clone, checked with `--all --repo`, then
   `node scripts/check-publishable.mjs --github` for the pull request, issue, review and release
   text, every Actions log and every artifact, as the guide's "Auditing everything GitHub holds"
   shows.
3. **Read what no pattern catches.** Skim new files and commit messages since the last audit for
   names of private projects, clients or employers, first-person notes about work done, and quoted
   material from a copy of production. These are judgement, not rules.
4. **Report** each finding by place and kind, what it exposes, and what you recommend: a rule fixed
   in `scripts/check-publishable.mjs` if the check should have caught it, then the remedy from the
   guide's "If something private was published".

## Making the repository public

Follow "Making the repository public" in the guide, in order. Release first if `pnpm attention`
says production lacks changes. Run the full audit and report it; change the visibility only after
the person, having read the audit, says to. Then turn on secret scanning, push protection and
private vulnerability reporting, ask the person to make the image public (the guide gives the
link; GitHub has no API for it) and confirm it, and check the Security tab.
