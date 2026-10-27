---
type: System Concept
title: Agent-driven end-to-end tests on a golden master
description: An agent follows a written test plan through the real web app and the real MCP server, on a local instance reset each time to a golden master made from production's example organization, and reports failures and anomalies.
tags: [development, testing, qa, e2e, agents, mcp, browser]
generated: {by: agent:claude, at: 2026-10-27}
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
| The golden master | The database `golden` in the instance's own embedded Postgres (`.what-build/e2e/pg`, port `54339`) and its files (`.what-build/e2e/golden-blobs`). It is built once and stays as it is until it is built again. `.what-build/e2e/golden.json` says which pull it was built from, when, at which commit and schema, the three organizations' slugs, every product's path, and that the pull checked an instance owner owns what it took (`owned_by_instance_owners`). |
| The instance | `pnpm dev:e2e`: the database `e2e`, made fresh from the golden master each time it starts, with its own files (`.what-build/e2e/blobs`), on `http://localhost:5283` (API `:8797`). It runs beside `pnpm dev`. Mail only prints. |
| Plans | `e2e/plans/*.md`, Markdown steps in the product's vocabulary, each saying who acts, through which door, and what to expect. `e2e/plans/README.md` is the format. |
| The browser driver | `pnpm e2e browser <command>`: a real Chrome kept open by a small daemon between commands, addressed by role, accessible name and label. The daemon listens on 127.0.0.1 and takes a command only with the token it writes to `.what-build/e2e/browser.json`, which only its owner can read, so a web page cannot drive it. |
| The MCP client | `pnpm e2e mcp <command>`: connects as a sample person through the full OAuth flow and calls tools. |
| Runs | `.what-build/e2e/runs/<time>-<plan>/`: `run.json`, `log.jsonl` (every browser and MCP command, its result and any problems), `shots/`, and the agent's `report.md`. |

All of it is under `.what-build/`, which git ignores.

## The golden master

```sh
corepack pnpm e2e golden                  # from the newest pull
corepack pnpm e2e golden 2026-10-10T1621Z # from a named pull
corepack pnpm e2e golden --org <slug>     # keep another organization than the example
```

It is made from a pull of production ([a copy of production](a-copy-of-production.md)): a pull of
the example organization, `pnpm fixture pull`'s default, is all it needs. It refuses a pull taken
before pulls checked who owns each organization, and one taken to move into another deployment
([copying an organization](copying-an-organization.md#which-organizations-may-leave-production)),
so `--org` picks only an organization an instance owner owns. It is restored as the
application's role, and shaped into three organizations
([decision](../decisions/end-to-end-tests-are-plans-an-agent-runs-on-a-golden-master.md)):

- **The example organization:** the organization production names as its example, as it was
  when pulled. Every other organization is removed, with
  the accounts that belonged only to them, and so are sessions, OAuth clients and tokens, sign-in
  links and the public site's interest list.
- **The standard organization** (`<slug>-standard`, named "<name> (standard)"): a copy of the
  example organization's teams, products, content, activity and memberships, under new ids, with every reference to an old id rewritten, in columns and in
  JSON. Its sources' search index is copied with them, so search finds in it what it finds in the
  example organization. A new id keeps the time of the one it replaces, so lists ordered by id, such as activity,
  keep their order in the copy. It is not the example. The files are shared, since blobs never change. After the copy, every
  foreign key is checked.
- **The synthetic organization** (`harbor-labs`, "Harbor Labs", with the product Crewboard): the
  development sample (`seed.ts`), made through the operations as its people would make it, by people
  who belong to it alone: Morgan Reyes owns it, Casey Lindqvist edits its team, Avery Nakamura reads
  Crewboard's Story (`morgan@`, `casey@` and `avery@example.com`). Sam is given a reader's place on
  Crewboard, and nothing more there.

So every plan can run the same products both ways, and a plan can check that one organization's
people see nothing of another's, and that a person's role follows the organization. Each time it is
served, the development sign-in's people are given their roles in the example and the standard
organization: Riley owns each, Sam edits every team, Jordan reads every Story. The synthetic
organization is left as it was built. Its people are guests of the example, as any account that
belongs to no part of it.

The golden master is a copy of production outside production, with every rule of that guide: it
holds only organizations an instance owner owns, beside the synthetic one
([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)), it stays in `.what-build/`, and plans, reports that leave the machine, commits
and issues never name or quote it. `pnpm dev:e2e` says so when it serves one built before pulls
checked owners, `pnpm e2e export` refuses it, and `pnpm attention` names it: build it again from a
new pull.

The golden master is built in the instance's cluster in UTF-8, as every local cluster is
([local development](local-development.md#the-local-postgres)). **A golden master built before
local clusters were UTF-8 must be built again:** its cluster is SQL_ASCII, where text functions
count bytes rather than characters, and `pnpm dev:e2e` says so when it starts. `pnpm e2e golden`
makes the instance's cluster again in UTF-8 when it finds it SQL_ASCII, since it holds only the
golden master and copies of it, and refuses while the instance runs; stop it with `pnpm e2e stop`.

The build migrates what it keeps to the schema of the code it runs from, and the worker does
the jobs those migrations queue, before the standard copy is made, so the copy covers every table
there is, and the search index as those jobs left it. A golden master built before the copy took
the index has none in the standard organization, where search then finds a source by its title
and tags at most: build it again. Once built, the golden master does not change: migrations added to the code later
run on each fresh copy when it is served. Build it again from a newer pull to move it forward, and
stop the instance first. In a git worktree without pulls of its own, pulls are read
from the main checkout's `.what-build/fixtures`.

## Serving

```sh
corepack pnpm dev:e2e
```

An agent runs it in the background with its output in `.what-build/e2e/server.log`, and
`pnpm e2e stop` stops it and the browser: this checkout's, which its process id in
`.what-build/e2e/dev.pid` names, never another checkout's instance. It refuses to start while this
checkout's instance runs. It drops `e2e`, creates it again from `golden` (a Postgres template copy, which takes a moment
even for a large copy), copies the files, applies any migration newer than the golden master, names the example
organization the example, and serves. It offers the plans in `deploy/plans.example.json`, Free
and Pro, and starts new organizations on Free, as local development does. The sample people hold their roles in the example and the standard organization,
so a guest of the example is anyone else: sign in with any other address, such as
`guest@example.com`. Stopping it and starting it again
is how a test goes back to the golden master; it also ends every session and MCP token, which the
tools notice and renew. Jobs a newer migration queues run in the instance's worker once it serves:
after `0030_one_derived_text_per_source`, which reads every attachment again and builds the
search index from nothing, search finds little until the log shows each product's `index_texts`
job done. Building the golden master again does that work once. It refuses to start when another process holds its API or web port, since that server would
answer the tests instead. The ports can be moved with `WHATBUILD_E2E_WEB_PORT`,
`WHATBUILD_E2E_API_PORT` and `WHATBUILD_E2E_PG_PORT`. `pnpm dev:e2e` and `pnpm e2e golden` use only
this checkout's Postgres, in its `.what-build/e2e/pg`: when another checkout's end-to-end Postgres
answers on the port, they refuse, naming that cluster's data directory, and drop or make nothing in
it: give this checkout's another port with `WHATBUILD_E2E_PG_PORT`. `WHATBUILD_E2E_URL` points the
browser and MCP tools elsewhere. `GET /mcp 405` lines in its log are expected: MCP clients probe for a
server-initiated stream, which WhatBuild does not offer.

The same golden master can be served by the release image on a Docker host that stays on, such as
a NAS: `pnpm e2e export` packs it, with the sample people's roles given, for
[the end-to-end instance on a Docker host](end-to-end-on-a-docker-host.md).

## Running a plan

```sh
corepack pnpm e2e plans                 # the plans and their titles
corepack pnpm e2e run smoke             # start a run: makes its folder and records into it
corepack pnpm e2e run                   # which run is recording; a new run replaces it
corepack pnpm e2e browser signin sam    # then browser and mcp commands, as the plan says
corepack pnpm e2e mcp call products_read '{"action":"list"}'
```

The plans:

- `smoke`: every screen opens for each role in the example and the standard organization, and an agent connects and reads.
- `organizations-kept-apart`: the synthetic organization's people see nothing of the standard
  organization through either door, its addresses and ids answering as absent; a scoped endpoint
  stays inside its scope; Sam edits in one organization and only reads the Story in another.
- `evidence-through-both-doors`: a source added over MCP is read, searched, corrected and
  commented on in the web app, and the reverse; a second attachment kept but not searched;
  activity attribution; a stale etag; a guest of the example organization reading and refused
  every write; and the two organizations kept apart.
- `delete-and-agent-levels`: admins delete permanently, editors archive, and an agent is offered
  only what its connection's level and its person allow.
- `deleting-an-account`: a person deletes their own account in the web app, never through an
  agent; what blocks it (owning the instance, being an organization's only owner) says how to clear
  it; afterwards they are signed out everywhere, what they wrote keeps their name, a record is
  mailed, and the address comes back only as a new, empty account.
- `assumptions-and-the-story`: an agent's assumption is reviewed by a person; a Story page
  is published and read by a reader, who is refused everything else.
- `search`: the palette and the Search screen find every kind of thing by plain words, read as the
  specification says; the web and MCP's plain mode agree; what one door writes the other finds; a
  reader has no search.
- `organizations-and-people`: an owner of this WhatBuild lets someone in from the waitlist, moves
  their organization to Pro and back (read-only when they already have a Free one; the instance
  offers the example file's plans, Free and Pro), deletes an
  organization they are not in, and removes accounts, the only owner of an organization included,
  through the web, and checks that no agent, the instance owner's included, is offered any of it.
- `running-an-organization`: an organization's owner starts it on an allowance, fills it to Free's
  people total (an invitation holds a place, a reader of the Story is free), changes and takes
  roles, renames and deletes it; someone it no longer holds asks for, and starts, their own.
- `exploratory`: open-ended, every screen as each role and as a guest of the example, at phone width and
  in the dark theme.

## The browser driver

`pnpm e2e browser help` lists the commands. The first command starts a headless Chrome (the
installed Google Chrome, or `$CHROME`); `pnpm e2e browser start --headed` shows it instead.
`signin` and `signout` leave the app before they clear the browser's cookies and storage, so the
previous person's page sends nothing refused, and nothing the app remembers per browser carries
from one person to the next. `snapshot` prints the page's accessibility tree, the same names `click <role> <name>`,
`fill <label> <value>` and the rest use. `signin <riley|sam|jordan|morgan|casey|avery|email>` uses the development
sign-in. Every command prints the page's address and, on lines starting with `!`, anything that
went wrong in the page since the last command: console errors, uncaught exceptions, failed
requests, 5xx responses, and a 4xx for a script, style, image or font. A 4xx the app's own
requests or a page the server writes were answered with (a 403, 404, 409 or 410 the app shows as a
message) is a line starting with `·`: noted, so a step can see the refusal it expects, and not a
problem. `wait <text>` and `wait-url <part>` wait for the app after a redirect
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
them, but not once the person's account is gone: a call with a token the server refuses (401)
for an address that has no account any more, because it was removed or deleted, stops there with a
non-zero exit and makes no account, so a removed person's agent never seems to work. `connect`
signs the address in anyway, which makes a new account. `tools` prints the tool descriptions an agent sees; `call` prints a tool's result, or its
error result with a non-zero exit (the `error result:` line goes to standard error, so the JSON
can still be piped).

## The report

The skill sets the format: a table of steps, then each finding with its severity (blocker, major,
minor, note), kind (failure, error, disagreement, permission, anomaly), where it happened, what was
expected and seen, and its evidence in the run's folder. The report stays in the run's folder, since
it may quote the golden master. The agent tells the person the result and opens no issue: the
repository's issues are for reports from others
([working in this repository](../process/working-in-this-repository.md#issues)). Wherever a
finding is written down outside the run's folder, it is described in general terms.

## Writing a plan

Follow `e2e/plans/README.md`. Write steps in the product's vocabulary rather than as selectors, so
the plan survives a redesign. Prefer steps that write through one door and read through the other, and steps done in both
organizations and compared. A plan names nothing in the golden master: it says "a product with
sources", and the agent finds one.
