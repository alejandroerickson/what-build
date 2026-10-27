---
name: run-end-to-end-tests
description: Run WhatBuild's agent-driven end-to-end tests. You follow a test plan from e2e/plans/ against an instance reset to a fixed golden master (production's example organization, a copy of it that is not the example, and a synthetic organization), served locally from the checkout or by a release's image on a Docker host, drive the web app in a real browser and call the MCP server as an agent, then report failures and anything else that looks wrong. Use when asked to run the end-to-end, e2e, acceptance or smoke tests, to run or write a test plan, to QA or exploratory-test the app with the browser and MCP, to check a change end to end before merging or releasing, to test a release (on the Docker host or NAS), or to build or rebuild the golden master.
---

# Run the end-to-end tests

You are the tester. A plan in `e2e/plans/` says what a person and their agent do and what should
happen. You do it through the real web app and the real MCP server, compare what happens with
what the plan expects, and report. The system, with every command, is described in
`okf/operations/end-to-end-tests.md`. Read it before the first run.

## What must stay true

- **Each run starts from the golden master.** Never repair the instance's database by hand. To
  start again, stop `pnpm dev:e2e` and start it again.
- **Work only on an end-to-end instance**: the local one at `http://localhost:5283`, or the Docker
  host's through its tunnel ([below](#testing-a-release-on-the-docker-host)). Never point the
  browser or the MCP client at `pnpm dev`, the dev deployment or production.
- **Report; do not fix.** Note every finding with its evidence and carry on with the plan. Change
  code only if the person asked you to fix what you find, and then after the report.
- **Nothing from the golden master is published.** It comes from a pull of production, and the
  rules of the `test-on-a-copy-of-production` skill apply: nothing from it leaves `.what-build/`; your report
  stays in the run's folder and your answer to the person; a plan, commit, issue or pull request
  names and quotes none of it.
- **Everything you create is synthetic.** Write files you upload into the run's folder.

## Procedure

1. **Choose the plans.** Use the plans the person named. `pnpm e2e plans` lists them; with no
   plan named, run `smoke`.
2. **Check the golden master.** `cat .what-build/e2e/golden.json`. If there is none, or the person
   asked for a fresh one or for newer data, build it with `pnpm e2e golden` from the newest pull
   (`ls .what-build/fixtures`, or the main checkout's in a worktree). With no pull to build
   it from, take one with `pnpm fixture pull`, without asking, following the
   `test-on-a-copy-of-production` skill; it takes the example organization, which is all the golden
   master keeps. Stop the instance (`pnpm e2e stop`) before building.
3. **Serve.** Run `pnpm dev:e2e > .what-build/e2e/server.log 2>&1` in the background with a long
   time limit, and wait until `curl -sf http://localhost:5283/health` answers. It runs beside
   `pnpm dev`. A failed migration or job, or a 5xx, in `server.log` is a finding; `GET /mcp 405`
   lines are not (MCP clients probe for a stream the server does not offer).
4. **Start the run.** `pnpm e2e run <plan>` prints the run's folder, the slugs of the example and
   standard organizations and every product's path; `pnpm e2e run` prints the folder again. Every
   browser and MCP command from now on is logged there, and screenshots go into it.
5. **Follow the plan, step by step.**
   - Web: `pnpm e2e browser signin sam` (which clears the browser's storage, so nothing carries
     from the last person), then `snapshot` to see the page as a screen reader does,
     and `click`, `fill`, `open`, `wait` and so on by role, name and label
     (`pnpm e2e browser help`). Take a `screenshot` at every expectation that you check and at
     every finding. If your harness gives you its own browser tools, you may use them instead, on
     the same address.
   - Wait for the app, not for time: `wait <text>` or `wait-url <part>` after anything that
     redirects or loads.
   - In zsh a variable holding a command (`B="corepack pnpm e2e browser"; $B …`) does not split;
     use a shell function or write the command out.
   - MCP: `pnpm e2e mcp call <tool> '<json>' --as sam` (`pnpm e2e mcp help`). A tool with
     actions takes its fields in `params`. Learn the tools the way any agent does: `tools`, `describe: true`, and `guide`. Use `curl` to PUT upload
     bytes to a grant's URL with its headers.
   - Where a plan says "a product with sources" or "words you can see in a source's text", pick one in the run and
     say in the report which (by its path), so the run can be repeated.
   - Check each expectation exactly. Find your way through the interface yourself: the plan names
     things in the product's words, not as selectors. Trouble finding the way is a finding.
   - After each step, look at what the commands printed: lines starting with `!` are problems the
     page reported (console errors, exceptions, failed requests, 5xx responses, a 4xx for a script,
     style, image or font). Every one of them is a finding, even if the step passed. Lines starting
     with `·` are refusals the app was answered with (a 403, 404, 409 or 410 it shows as a
     message): not findings in themselves, but one the step did not expect, or one the page shows
     no message for, is.
6. **Between plans,** stop the instance (`pnpm e2e stop`) and serve again, so that each plan
   starts from the golden master, then start the next run.
7. **Write the report** to `report.md` in the run's folder (format below). If your harness does
   not let you write it, give it in full as your answer instead. Then `pnpm e2e stop`, unless the
   person wants to look around.
8. **Tell the person** the result of each plan, each finding in one or two lines with its
   severity, and where the report and screenshots are. Open no issue in this repository for a
   finding: its issues are for reports from others (`AGENTS.md`). When the person asks for the
   findings to be recorded, record them where their own instructions keep their work, one for each
   finding that is not already there. Wherever a finding is written down outside the run's folder,
   describe it in general terms, quoting nothing from the golden master.

## Testing a release, on the Docker host

`pnpm dev:e2e` serves the checkout's code. A release, as deployments run it, is tested on the
instance a Docker host serves with the release's image
(`okf/operations/end-to-end-on-a-docker-host.md`). Use it when the person asks to test a release,
or on the Docker host or the NAS. Where it is comes from `.env` in the maintainer's clone (in a
worktree, the main checkout's): `E2E_HOST` (the SSH host), `E2E_HOST_DIR` (the folder holding
`whatbuild-e2e.sh`), `E2E_HOST_PORT` (the app's port on the host) and `E2E_TUNNEL_PORT` (the
tunnel's local end). If they are not there, there is no Docker host: say so, and offer a local run
of the checkout instead.

The procedure above changes only here. On the host, run the script as
`ssh $E2E_HOST "sudo -n $E2E_HOST_DIR/whatbuild-e2e.sh <command>"`, and nothing else.

- **Instead of steps 2 and 3:**
  1. Open the tunnel, unless `curl -sf http://localhost:$E2E_TUNNEL_PORT/health` already answers:
     `ssh -f -N -L $E2E_TUNNEL_PORT:127.0.0.1:$E2E_HOST_PORT $E2E_HOST`.
  2. Run `status`. It says the release served, the golden master's organizations and products,
     and the containers.
  3. If the release to test is not the one served (the person's, or the newest:
     `gh release list --limit 1`), run `update <tag>`. It pulls the image, runs the release's
     migrations on a fresh copy of the golden master, and serves it. A migration that fails there
     is a blocker. Otherwise run `reset`.
  4. The golden master is the host's, which `status` describes. The checkout's own, if it has one,
     plays no part, so read the organizations' slugs and the products from `status`, not from what
     `pnpm e2e run` prints.
- **Every `pnpm e2e` command** carries `WHATBUILD_E2E_URL=http://localhost:$E2E_TUNNEL_PORT`.
- **Between plans,** run `reset` instead of stopping and serving. Run it once more at the end,
  since a run leaves behind what it created.
- **The server log** is `logs 2000`, read from the last reset's time on. The updater's lines come
  after it. A 5xx or a failed job there is a finding.
- **The report** names the release served in place of the checkout's commit.
- **If the host does not answer as expected,** report it to the person instead of repairing it:
  the tunnel refused, `sudo` asking for a password, or the image not pulled. Setting the host up
  and repairing it need root there, which only the maintainer has.

## What counts as a finding

- **Failure:** an expectation in the plan did not hold.
- **Error:** anything `!` reported, a server error in the `pnpm dev:e2e` log, or a job that failed.
- **Disagreement:** the web and MCP say different things about the same object (titles, counts,
  status, attribution), or the example and the standard organization behave differently where the example's being
  read-only to guests does not explain it.
- **Permission:** someone saw or did something their role should not allow, or was refused
  something it should allow.
- **Anomaly:** anything else wrong or doubtful: confusing copy, a wrong word for the product's
  vocabulary, a layout that breaks at phone width or in the dark theme, something slow without a
  sign of progress, guidance in a tool or the guide that led you astray.

Rate each one: **blocker** (the task cannot be done), **major** (done wrongly, or data or
permissions wrong), **minor** (works, but wrong or confusing), **note** (worth a look).

## The report

```markdown
# <plan title>: <passed | N findings>

Run <folder name>, plan e2e/plans/<file>, golden master from the pull <name>, built <date> at <commit>,
code at <git rev-parse --short HEAD> (<clean | with uncommitted changes>).

| Step | Result | Notes |
|---|---|---|
| 1 | pass | |
| 2 | fail | F1 |

## Findings

### F1 (major, failure): <one line>
- Where: step 2, web as Sam, <address>
- Did: <the commands, briefly>
- Expected: <from the plan>
- Saw: <what happened, with the exact message>
- Evidence: shots/<file>.png, log.jsonl lines <n>
- Reproduces: <yes, every time | once in N tries | not tried>

## Not checked
<steps you could not do, and why>
```
