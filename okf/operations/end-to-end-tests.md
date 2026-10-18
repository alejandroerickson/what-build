---
type: System Concept
title: Agent-driven end-to-end tests on a golden master
description: An agent follows a written test plan through the real web app and the real MCP server, on a local instance reset each time to a golden master made from production's public sandbox, and reports failures and anomalies.
tags: [development, testing, qa, e2e, agents, mcp, browser]
generated: {by: agent:claude, at: 2026-10-18}
status: draft
---

# Agent-driven end-to-end tests

An agent is the tester. It reads a plan in `e2e/plans/`, signs in as the sample people, drives the
web app in a real browser, calls the MCP server as a connected agent, and checks what the plan
expects. It reports what failed, and also what merely looked wrong: errors in the page, the web and
MCP disagreeing, a role reaching too far, unclear copy, a broken layout
([decision](../decisions/end-to-end-tests-are-plans-an-agent-runs-on-a-golden-master.md)). The
skill `run-end-to-end-tests` conducts a run; asking any agent in the repository to "run the
end-to-end tests" is enough.

The instance, its Postgres, the browser driver and the MCP client all run from the repository,
with Google Chrome installed. Building the golden master needs a pull of production
([a copy of production](a-copy-of-production.md)); running plans needs nothing more.

## The pieces

| Piece | What it is |
|---|---|
| The golden master | The database `golden` in the instance's own embedded Postgres (`.what-build/e2e/pg`, port `54339`) and its files (`.what-build/e2e/golden-blobs`). It is built once and stays as it is until it is built again. `.what-build/e2e/golden.json` says which pull it was built from, when, at which commit and schema, the two organizations' slugs and every product's path. |
| The instance | `pnpm dev:e2e`: the database `e2e`, made fresh from the golden master each time it starts, with its own files (`.what-build/e2e/blobs`), on `http://localhost:5283` (API `:8797`). It runs beside `pnpm dev`. Mail only prints. |
| Plans | `e2e/plans/*.md`, Markdown steps in the product's vocabulary, each saying who acts, through which door, and what to expect. `e2e/plans/README.md` is the format. |
| The browser driver | `pnpm e2e browser <command>`: a real Chrome kept open by a small daemon between commands, addressed by role, accessible name and label. |
| The MCP client | `pnpm e2e mcp <command>`: connects as a sample person through the full OAuth flow and calls tools. |
| Runs | `.what-build/e2e/runs/<time>-<plan>/`: `run.json`, `log.jsonl` (every browser and MCP command, its result and any problems), `shots/`, and the agent's `report.md`. |

All of it is under `.what-build/`, which git ignores.

## The golden master

```sh
corepack pnpm e2e golden                  # from the newest pull
corepack pnpm e2e golden 2026-10-10T1621Z # from a named pull
corepack pnpm e2e golden --org <slug>     # keep another organization than the public sandbox
```

It is made from a pull of production ([a copy of production](a-copy-of-production.md)): a pull of
the public sandbox, `pnpm fixture pull`'s default, is all it needs. It is restored as the
application's role, and shaped into two organizations
([decision](../decisions/end-to-end-tests-are-plans-an-agent-runs-on-a-golden-master.md)):

- **The sandbox organization:** the organization production names as its public sandbox, as it was
  when pulled, with its settings, baseline and invitations. Every other organization is removed, with
  the accounts that belonged only to them, and so are sessions, OAuth clients and tokens, sign-in
  links and the public site's interest list.
- **The standard organization** (`<slug>-standard`, named "<name> (standard)"): a copy of the
  sandbox organization's teams, products, content, activity and the memberships of everyone but
  its visitors, under new ids, with every reference to an old id rewritten, in columns and in
  JSON. A new id keeps the time of the one it replaces, so lists ordered by id, such as activity,
  keep their order in the copy. It is not a sandbox. The files are shared, since blobs never change. After the copy, every
  foreign key is checked.

So every plan can run the same products both ways. No sandbox visitor is copied into the
standard organization: not an account an invitation made, and not anyone holding a visitor's seat,
whose seat and every role on a team or product stay in the sandbox alone. Each time it is served,
the development sign-in's people are given their roles in both: Riley owns each organization, Sam edits every team, Jordan reads every Story.

The golden master is real people's data, with every rule of that guide: it stays in `.what-build/`,
and plans, reports that leave the machine, commits and issues never name or quote it.

The golden master is built in the instance's cluster in UTF-8, as every local cluster is
([local development](local-development.md#the-local-postgres)). **A golden master built before
local clusters were UTF-8 must be built again:** its cluster is SQL_ASCII, where text functions
count bytes rather than characters, and `pnpm dev:e2e` says so when it starts. `pnpm e2e golden`
makes the instance's cluster again in UTF-8 when it finds it SQL_ASCII, since it holds only the
golden master and copies of it, and refuses while the instance runs; stop it with `pnpm e2e stop`.

The build migrates what it keeps to the schema of the code it runs from, and the worker does
the jobs those migrations queue, before the standard copy is made, so the copy covers every table
there is. Once built, the golden master does not change: migrations added to the code later
run on each fresh copy when it is served. Build it again from a newer pull to move it forward, and
stop the instance first. In a git worktree without pulls of its own, pulls are read
from the main checkout's `.what-build/fixtures`.

## Serving

```sh
corepack pnpm dev:e2e
```

An agent runs it in the background with its output in `.what-build/e2e/server.log`, and
`pnpm e2e stop` stops it and the browser. It drops `e2e`, creates it again from `golden` (a Postgres template copy, which takes a moment
even for a large copy), copies the files, applies any migration newer than the golden master, names the sandbox organization the public
sandbox, and serves. It also marks the sandbox as reset just now, so that its daily reset does not
put the baseline back over the golden master's content when the instance starts; a run that lasts
past the reset hour in the sandbox's settings would see it happen. Stopping it and starting it again
is how a test goes back to the golden master; it also ends every session and MCP token, which the
tools notice and renew. Jobs a newer migration queues run in the instance's worker once it serves:
after `0030_one_derived_text_per_source`, which reads every attachment again and builds the
search index from nothing, search finds little until the log shows each product's `index_texts`
job done. Building the golden master again does that work once. It refuses to start when another process holds its API or web port, since that server would
answer the tests instead. The ports can be moved with `WHATBUILD_E2E_WEB_PORT`,
`WHATBUILD_E2E_API_PORT` and `WHATBUILD_E2E_PG_PORT`; `WHATBUILD_E2E_URL` points the browser and
MCP tools elsewhere. `GET /mcp 405` lines in its log are expected: MCP clients probe for a
server-initiated stream, which WhatBuild does not offer.

## Running a plan

```sh
corepack pnpm e2e plans                 # the plans and their titles
corepack pnpm e2e run smoke             # start a run: makes its folder and records into it
corepack pnpm e2e run                   # which run is recording; a new run replaces it
corepack pnpm e2e browser signin sam    # then browser and mcp commands, as the plan says
corepack pnpm e2e mcp call products '{"action":"list"}'
```

The plans:

- `smoke`: every screen opens for each role in both organizations, and an agent connects and reads.
- `evidence-through-both-doors`: a source added over MCP is read, searched, corrected and
  commented on in the web app, and the reverse; a second attachment kept but not searched;
  activity attribution; a stale etag; then the same in the sandbox, its limits, and the two
  organizations kept apart.
- `assumptions-and-the-story`: an agent's assumption is reviewed by a person; a Story page
  is published and read by a reader, who is refused everything else.
- `search`: the palette and the Search screen find every kind of thing by plain words, read as the
  specification says; the web and MCP's plain mode agree; what one door writes the other finds; a
  reader has no search.
- `exploratory`: open-ended, every screen as each role and as a sandbox visitor, at phone width and
  in the dark theme.

## The browser driver

`pnpm e2e browser help` lists the commands. The first command starts a headless Chrome (the
installed Google Chrome, or `$CHROME`); `pnpm e2e browser start --headed` shows it instead.
`signin` and `signout` clear the browser's storage, so nothing the app remembers per browser
carries from one person to the next. `snapshot` prints the page's accessibility tree, the same names `click <role> <name>`,
`fill <label> <value>` and the rest use. `signin <riley|sam|jordan|email>` uses the development
sign-in. Every command prints the page's address and, on lines starting with `!`, anything that
went wrong in the page since the last command: console errors, uncaught exceptions, failed
requests and 5xx responses. `wait <text>` and `wait-url <part>` wait for the app after a redirect
or a load. `screenshot` saves into the current run; the app scrolls its own panes, so `--full`
adds only what the document itself scrolls. `stop` closes it; its log is
`.what-build/e2e/browser.log`.

An agent whose harness has its own browser tools may use them on the same address instead; the
driver is for any agent that has a shell.

## The MCP client

`pnpm e2e mcp help` lists the commands. `--as` picks the person (`sam` by default),
`--endpoint` a scoped endpoint such as `/mcp/t/harbor-labs`, and `--level` the connection's level
(`viewer`, `editor`, the default as on the consent page, or `admin`; an agent deletes only at
`admin`). The first call connects: it registers a client, signs the person in, posts Allow with
the level on the consent page, and exchanges the code with PKCE,
the same requests a person's MCP client and browser make, so the OAuth server is tested on every
run. Tokens are kept in `.what-build/e2e/mcp/` and made again when they expire or a reset forgets
them. `tools` prints the tool descriptions an agent sees; `call` prints a tool's result, or its
error result with a non-zero exit (the `error result:` line goes to standard error, so the JSON
can still be piped).

## The report

The skill sets the format: a table of steps, then each finding with its severity (blocker, major,
minor, note), kind (failure, error, disagreement, permission, anomaly), where it happened, what was
expected and seen, and its evidence in the run's folder. The report stays in the run's folder, since
it may quote the golden master. The agent tells the person the result, and may open an issue for a
finding when they agree, describing it in general terms.

## Writing a plan

Follow `e2e/plans/README.md`. Write steps in the product's vocabulary rather than as selectors, so
the plan survives a redesign. Prefer steps that write through one door and read through the other, and steps done in both
organizations and compared. A plan names nothing in the golden master: it says "a product with
sources", and the agent finds one.
