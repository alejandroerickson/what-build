---
name: run-end-to-end-tests
description: Run WhatBuild's agent-driven end-to-end tests. You follow a test plan from e2e/plans/ against a local instance reset to a fixed golden master (production's public sandbox organization and a non-sandbox copy of it), drive the web app in a real browser and call the MCP server as an agent, then report failures and anything else that looks wrong. Use when asked to run the end-to-end, e2e, acceptance or smoke tests, to run or write a test plan, to QA or exploratory-test the app with the browser and MCP, to check a change end to end before merging or releasing, or to build or rebuild the golden master.
---

# Run the end-to-end tests

You are the tester. A plan in `e2e/plans/` says what a person and their agent do and what should
happen. You do it through the real web app and the real MCP server, compare what happens with
what the plan expects, and report. The system, with every command, is described in
`okf/operations/end-to-end-tests.md`. Read it before the first run.

## What must stay true

- **Each run starts from the golden master.** Never repair the instance's database by hand. To
  start again, stop `pnpm dev:e2e` and start it again.
- **Work only on the end-to-end instance**, at `http://localhost:5283`. Never point the browser or
  the MCP client at `pnpm dev`, the dev deployment or production.
- **Report; do not fix.** Note every finding with its evidence and carry on with the plan. Change
  code only if the person asked you to fix what you find, and then after the report.
- **The golden master is real people's data**, from a pull of production. The rules of the
  `test-on-a-copy-of-production` skill apply: nothing from it leaves `.what-build/`; your report
  stays in the run's folder and your answer to the person; a plan, commit, issue or pull request
  names and quotes none of it.
- **Everything you create is synthetic.** Write files you upload into the run's folder.

## Procedure

1. **Choose the plans.** Use the plans the person named. `pnpm e2e plans` lists them; with no
   plan named, run `smoke`.
2. **Check the golden master.** `cat .what-build/e2e/golden.json`. If there is none, or the person
   asked for a fresh one or for newer data, build it with `pnpm e2e golden` from the newest pull
   (`ls .what-build/fixtures`, or the main checkout's in a worktree). To take a new pull, use
   `pnpm fixture pull` only when the person asks for one, following the
   `test-on-a-copy-of-production` skill; it takes the public sandbox, which is all the golden
   master keeps. Stop the instance (`pnpm e2e stop`) before building.
3. **Serve.** Run `pnpm dev:e2e > .what-build/e2e/server.log 2>&1` in the background with a long
   time limit, and wait until `curl -sf http://localhost:5283/health` answers. It runs beside
   `pnpm dev`. A failed migration or job, or a 5xx, in `server.log` is a finding; `GET /mcp 405`
   lines are not (MCP clients probe for a stream the server does not offer).
4. **Start the run.** `pnpm e2e run <plan>` prints the run's folder, the slugs of the sandbox and
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
   - MCP: `pnpm e2e mcp call <tool> '<json>' --as sam` (`pnpm e2e mcp help`). A grouped tool's
     fields go in `params`. Learn the tools the way any agent does: `tools`, `describe: true`, and `get_skill`. Use `curl` to PUT upload
     bytes to a grant's URL with its headers.
   - Where a plan says "a product with sources" or "a passage you can see", pick one in the run and
     say in the report which (by its path), so the run can be repeated.
   - Check each expectation exactly. Find your way through the interface yourself: the plan names
     things in the product's words, not as selectors. Trouble finding the way is a finding.
   - After each step, look at what the commands printed: lines starting with `!` are problems the
     page reported (console errors, exceptions, failed requests, 5xx responses). Every one of them
     is a finding, even if the step passed.
6. **Between plans,** stop the instance (`pnpm e2e stop`) and serve again, so that each plan
   starts from the golden master, then start the next run.
7. **Write the report** to `report.md` in the run's folder (format below). If your harness does
   not let you write it, give it in full as your answer instead. Then `pnpm e2e stop`, unless the
   person wants to look around.
8. **Tell the person** the result of each plan, each finding in one or two lines with its
   severity, and where the report and screenshots are. Offer to open issues for findings; open
   them only when they agree, and describe each in general terms, quoting nothing from the golden
   master (the repository and its issues are public).

## What counts as a finding

- **Failure:** an expectation in the plan did not hold.
- **Error:** anything `!` reported, a server error in the `pnpm dev:e2e` log, or a job that failed.
- **Disagreement:** the web and MCP say different things about the same object (titles, counts,
  status, attribution), or the two organizations behave differently where the sandbox's settings
  do not explain it.
- **Permission:** someone saw or did something their role should not allow, or was refused
  something it should allow.
- **Anomaly:** anything else wrong or doubtful: confusing copy, a wrong word for the product's
  vocabulary, a layout that breaks at phone width or in the dark theme, something slow without a
  sign of progress, guidance in a tool or the skill that led you astray.

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
