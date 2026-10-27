---
type: Process
title: What a deployment must do when it takes a release
description: The changes a release asks of the people who run a deployment (settings, app registrations, behaviour they will notice), kept per release, with the unreleased ones on top until the next release carries them into its notes.
tags: [operations, releases, upgrading, self-hosting, configuration]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# Upgrading

A release's notes say which migrations it adds; the release workflow writes that part. What else a
deployment must do, or will notice, is kept here, because nobody remembers it at release time:

- **A change that asks something of a deployment** (a new or changed setting, a step in an
  identity provider, a behaviour people will notice, a minimum Node version) gets a line under
  **Unreleased** in the same pull request. Say what to do, who it concerns, and what happens if
  they do not.
- **When a release is published** (the `make-a-release` skill, [releasing](releasing.md)), the
  Unreleased lines go into its notes and move here under the release's version. The person
  publishing is told them before they say yes; whoever runs a deployment reads them before
  upgrading.

## Unreleased

- **The privacy page moves to the public site.** It concerns every deployment. The notice is now a
  page of the public site, at `/privacy` on the site's domain, or at `/site/privacy/` on the app's
  origin for a deployment without a site. The app has no privacy screen and nothing at `/privacy`
  any more; it links to the page, in a new tab, at `privacy_url` from `GET /api/v1/meta`. Its text
  is unchanged. `privacy` leaves `GET /api/v1/meta` and is in `GET /api/v1/plans`, which the site's
  pages are written from ([decision](../decisions/the-privacy-page-is-a-page-of-the-public-site.md)).
  Behind Cloudflare, deploy the Worker from this release right after the image: until it is, the
  site's `/privacy` goes to the app, which has nothing there. `/site/` and `/site/plans/` on the
  app's origin now show the site's pages with the deployment's plans written in, where they showed
  the app. No migration.
- **Copies outside production hold only organizations an instance owner owns.** It concerns
  whoever copies a deployment's organizations to test on or to a dev deployment, and asks nothing
  of a running deployment; no migration. `pnpm fixture pull` refuses an organization that has an
  owner who is not among the deployment's instance owners, and `--all` takes only those every
  owner of which is one. To read who they are it needs the Cloud Run service's region
  (`GCP_REGION`) or, for another deployment, `WHATBUILD_FIXTURE_INSTANCE_OWNERS`. Pulls, golden
  masters and their exports made before are refused (`pnpm fixture load`, `pnpm e2e golden`,
  `pnpm e2e export`, the Docker host's `load`): delete them and pull again; a Docker host needs
  the new `whatbuild-e2e.sh` before it loads a new export. Moving an organization into another
  production deployment of its own takes `--for-another-deployment`
  ([copying an organization](copying-an-organization.md#which-organizations-may-leave-production)).
  The restore drill now uses a scratch database and bucket in production's own accounts, never the
  dev deployment ([backups](backups.md#the-restore-drill)).
- **`pnpm dataset` builds the non-production dataset**: a pull beside synthetic organizations with
  many members, pending invitations, products and sources, which the local copy, the golden master
  and the dev deployment load as a pull. It asks nothing of a deployment. The dev deployment's
  refresh now loads one, with its files copied into dev's bucket
  ([the non-production dataset](the-non-production-dataset.md)).

## v0.27.0

- **An organization's owners are told when an instance owner makes it read-only or deletes it.**
  It concerns a deployment that sends mail, and asks nothing of it: moving an organization to the
  starting plan, where that makes it read-only, now mails each of its owners (but the instance
  owner who moved it) what still works there and the day it is kept until; deleting one from
  Organizations mails its owners that it was deleted. A deployment that sends no mail sends
  neither. Mails now give their days as UTC days and say so ([Mail](mail.md)). No migration.
- **The tools change for read-only organizations, roles and refusals** (`tools_version` 0.44.0). It
  asks nothing of a deployment, but a connected client sees the change only in a new session. A
  refusal names the call the agent made, `sources_delete(action="delete")`, not the operation;
  `products_read(action="list")` gives `member` as a tenant's `your_role` for someone whose roles
  are on its teams and products, where it gave `null`; `members_write(action="revoke")` answers
  `left_organization` when the person's last role went, which the access log now records; and
  `products_write(action="set_plan")` answers `owners_notified`. In the web app a read-only
  organization offers no write the server would refuse, and its Members page no new role; a team
  or product role has **Change**.
- **Agents no longer run the instance** (`tools_version` 0.45.0). It concerns the instance's owners
  and their agents, and asks nothing of a deployment. An instance owner's MCP connection, at any
  level, is no longer offered `organizations`, `accounts`, `tenant_allowances`, `guests` or `usage`
  in `products_read`, nor `set_plan`, `set_plan_limits`, `set_guests`, `set_tenant_allowance` or
  `remove_tenant_allowance` in `products_write`
  ([decision](../decisions/running-the-instance-is-done-in-the-web-app-never-by-an-agent.md)).
  They are done in the web app, on Organizations (`/instance`) and People (`/people`), and
  through REST as before. A connected agent loses them in its next session; until then a call to
  one, or to any web-only action (deleting an organization or an account), is refused
  `403 web_only`, saying where a person does it, where it used to be `422 unknown_action`. A
  billing service that moves organizations with `PATCH /api/v1/organizations/plan` is unaffected.
  No agent renames an organization or a product any more: `rename_tenant` and `update` leave
  `products_write` too, for its owners on the organization's Members page, its admins in the
  product's Settings, and an instance owner with Rename on Organizations.
  The usage report (`pnpm usage`) is how the server's counts are read. No migration.

## v0.26.0

- **The privacy page is written again, as a short notice.** It concerns every deployment, and
  asks one thing of a deployment that set `WHATBUILD_PROVIDERS`. The page now says what is kept, why,
  who else handles it, how long it stays and what a person can do, in categories and prose, with
  no durations ([decision](../decisions/the-privacy-page-is-a-short-notice-written-to-stay-true.md));
  `privacy` in `GET /api/v1/meta` loses `session_days`, `agent_access_days` and
  `usage_people_months`. `WHATBUILD_PROVIDERS` is now a paragraph the page shows as written, in
  place of the `Name: what it does; …` list, so a deployment can name its providers or describe
  them by kind. A value in the old form still shows, as one line of names and colons: rewrite it as
  sentences ([Cloud Run](cloud-run.md), the Azure template). The page's "Last changed" reads October
  2026. It still says that whoever runs the deployment sees each organization's name and the names
  and emails of its people, as v0.25.0 made it say, but no longer names an organization's plan. No
  migration.

## v0.25.1

- **v0.25.0 published no image.** Its build left out `deploy/plans.example.json`, which the image
  carries as `/app/plans.example.json`, and failed. Take this release instead, doing what v0.25.0's
  lines below ask. No migration beyond v0.25.0's.

## v0.25.0

- **The deployment defines its plans, and limits belong to them.** It concerns every deployment,
  and asks one thing of a deployment that offers plans: **give it `WHATBUILD_PLANS` before it takes
  this release.** The plans, their names, every limit and each one's price come from the
  deployment's configuration, a JSON file in the form of `deploy/plans.example.json` (or the JSON
  itself), kept with the deployment's own settings; on Cloud Run, `PLANS_FILE` in `setup.sh`
  stores it as the secret `whatbuild-plans` ([Cloud Run](cloud-run.md)). A
  `WHATBUILD_NEW_ORGANIZATION_PLAN` that names a plan the file does not define stops the service
  from starting, so set both together. Organizations already on `free` keep meeting limits only if
  the file defines a plan with the id `free`; on any plan it does not define they meet none until
  an instance owner moves them, and `/instance` marks them. The migration drops the limits an
  instance owner had changed for one organization, so check the organizations listed with changed
  limits before upgrading and move any that needs more to another plan afterwards, on `/instance`.
  The release runs three migrations. `products.set_limits` is gone; `products.set_plan` (`PATCH
  /api/v1/organizations/plan`) moves an organization to another plan, and a plan the deployment
  does not define is refused (`422 unknown_plan`). A self-hosted deployment, which sets neither
  setting, needs nothing: every organization stays unlimited, and the app now says nothing of
  plans or billing there.
- **Plans set totals.** A plan's limits now include what an organization holds: people (readers of
  the Story don't count; an invitation holds a place), products and sources not archived, and
  storage; and what each person is sent a day (an export is always sent). The example file's Free
  plan is a starting point. An organization already past a total keeps everything and adds no more
  of it until enough is archived or deleted; its people see this on its Plan page.
- **Plans' limits and prices can be changed on `/instance`.** Optional: an instance owner changes
  each plan's price, as people read it, and its limits, for every organization on it, over what the
  file sets. Nothing takes payment. Deploy the Cloudflare Worker again so it serves the public
  site's new plans page (`/plans` on the site's domain); it asks the service for the plans at most
  once an hour.
- **Guests.** It concerns a deployment with an example organization. An account in no organization,
  with no allowance, is now a guest account, held to the guests' settings on `/instance`: 25 in at
  once, 50 new a day, 2 hours each a day, 50 calls a minute and 10 MB of downloads a day, with a
  waiting page past them; people in an organization never wait. Anyone may sign up as a guest only
  once an instance owner turns on **Anyone can sign up as a guest**; until then sign-up stays as it
  was. The public site then leads with exploring the example.
- **One organization each on the starting plan.** It concerns a deployment whose new organizations
  start on a plan it defines. An allowance now counts only the organizations someone started that
  are on that plan and not read-only, so moving one to another plan frees its owner's place. The
  counts under **Who can start organizations** on `/instance` change to match.
- **An organization moved back to the starting plan may become read-only.** It concerns the same
  deployments, and nothing changes until an instance owner moves an organization. When its creator
  already has one on that plan, it is read-only for a year instead: its people read, export and
  delete, and add nothing until it moves to another plan. Nothing erases it when the year is up;
  an instance owner deletes it by hand.
- **Instance owners delete any organization, and remove its only owner.** It asks nothing of a
  deployment. On `/instance`, every organization but the example has **Delete**. On People,
  removing an account that is the only owner of organizations now deletes them too, after a
  warning that lists what each holds; before, it was refused.
- **The waitlist is on `/instance`.** It asks nothing of a deployment. The people who asked on the
  public site's form, and guests who ask in the app, are listed under **Waitlist**; **Let them start
  one** gives an allowance of 1 and emails them.
- **Whoever runs the deployment is named as seeing organizations.** It asks nothing of a
  deployment. Where the deployment offers plans, the new-organization form, an organization's Plan
  page and the privacy page now say
  that an organization's name and plan, and the name and email of everyone in it, are visible to
  whoever runs the deployment, to write to its people and, where a plan has a price, to bill the
  organization.
- **The tools change for plans, guests and read-only organizations** (`tools_version` 0.43.0). It
  asks nothing of a deployment, but a connected client sees the change only in a new session.
  `products_write(action="set_limits")` is gone; instance owners have `set_plan`, `set_plan_limits`
  and `set_guests` in `products_write` and `guests` in `products_read`, and every agent may read a
  tenant's `read_only` and is refused writes there with `409 organization_read_only`. An agent
  still never ends an account or deletes an organization: those stay in the web app.

## v0.24.0

- **People can delete their own account.** It concerns every deployment and asks one thing of it.
  Settings has a Delete account section, which needs a sign-in from the last 15 minutes and the
  address typed. It and an instance owner's removal on People now also delete what was kept about
  the person (their agent tokens, counts against limits and feedback, counted days of use, their
  name on the account, and their address on interest requests and feedback), and mail the address a
  confirmation that names `WHATBUILD_PRIVACY_CONTACT` as whom to tell if it was not them: set it, or the
  confirmation says only "whoever runs this WhatBuild". Nothing tells the person how long backups
  keep them; [erasure](erasure.md) says how an operator keeps backups, Neon `pre-migrate-…`
  branches and copies of production from outlasting 35 days. No migration.
- **The MCP tools are split, and the skill is retired.** It concerns every deployment and asks
  nothing of one, but every connected agent notices. Each kind of object now has a `_read`, a
  `_write` and, where it can be deleted for good, a `_delete` tool (`sources_read`,
  `sources_write`, `sources_delete`, …), 28 tools where there were 13, each with a title and a
  read-only or destructive hint, so a client such as Claude may ask before each write. The
  `whatbuild` skill, `get_skill`, `/whatbuild-skill.md`, `/whatbuild-skill.zip` and the Connect
  page's skill download are gone: the `guide` tool serves the same knowledge from the server, and
  answers give `tools_version` (0.42.0) where they gave `skill_version`. A client that connected
  before the upgrade keeps the old tool list until a new session; its calls to old tool names are
  refused with the new names. A skill people installed by hand is obsolete and can be removed. No
  migration.

## v0.23.2

- **Nothing to change.** The privacy page now names the counts held against an organization's
  limits, which it left out: what each person changes, adds, exports and uploads there each day
  and, where the plan limits them, their calls each minute. A day's counts are deleted after three
  days, a minute's after an hour.

## v0.23.1

- **A kind named in a search comes first everywhere.** It concerns every deployment and asks
  nothing of one. A search such as "mockups crew" now lists the mockups first in the search palette
  and in MCP's `search` plain mode, as the Search screen already did, rather than only nudging their
  score; a result's `score` no longer counts the hint, so the first results may score lower than
  the ones after them. On a phone, the palette's lines start a few words before the word they
  matched, so it shows. The skill is now at version 0.40.0; agents fetch it again as the server's
  instructions tell them.
- **A day's use is counted on every plan.** It concerns every deployment and asks nothing of one.
  Writes, sources added, exports and attached files are counted in an organization on the
  unlimited plan too, though nobody there is refused, so an organization an instance owner moves
  to the free plan during a day meets what that day already used instead of starting from zero.
  `products.limits` gives `used` on every plan, the instance owners' list of organizations gives
  every organization's use today, and an unlimited organization's Plan and limits page says its use
  is counted. What was done before the upgrade was not counted: an unlimited organization moved to
  the free plan on that day starts from what was done after it.
- **A small correction to a source's derived text is logged as an edit, through either door.** It
  concerns every deployment and asks nothing of one. Activity said "Rewrote the derived text" for
  every whole text sent, as the web app's editor sends it, and "Edited the derived text" for every
  set of exact edits an agent sent. The server now compares the words before and after: a write
  that removes and adds more than half of the two texts' words, or more than 2,000, rewrote the
  text, and any other edited it. Entries already in Activity keep their wording, and Activity's
  line for any of them now reads "changed the text of" a source, where it read "wrote the text of".
- **The unscoped agent connector offers only what the person's roles reach, too.** It concerns
  every deployment and asks nothing of one. On `/mcp`, someone who may not start an organization
  (no instance owner, no allowance with room) is offered what their highest role in any
  organization they are in reaches: a guest of the example organization no write, someone who
  reads only the Story the Story alone, and nobody `create_tenant`. Someone who may start an
  organization is offered everything their connection's level allows, as before. A call to
  anything else is refused as before, with what it needs. A connected client sees the shorter
  list in a new session.
- **A guest of the example organization reads `your_role: "guest"`** there, in `products.list`
  (its products and teams), `products.get` and an MCP answer's `scope`, over REST and MCP, where
  it read `viewer`. What a guest may do is unchanged. A script that read `viewer` there to tell a
  guest's read access reads `guest` too.
- **Refusing a guest's write in the example organization says where their own work goes**: an
  organization they are in, one they may create, or, when they may create none, to ask whoever
  runs this WhatBuild. It no longer tells everyone to create an organization.
- **A tool's description speaks only of the actions the connection is offered**: an Edit
  connection's `members` no longer mentions granting, revoking or inviting. The skill is now at
  version 0.40.0; agents fetch it again as the server's instructions tell them.

## v0.23.0

- **An agent is offered only what its person could do.** It concerns every deployment and asks
  nothing of one. The MCP tool list offers the instance owners' actions (`usage`, `organizations`,
  `set_limits`, `accounts` and the allowances to start organizations) only to an owner named in
  `WHATBUILD_INSTANCE_OWNERS`, and a connector scoped to an organization or a product offers only
  what the person's roles inside it reach: a reader there sees the Story alone. A call to anything
  else is refused as before. A connected client sees the change in a new session. The skill is now
  at version 0.39.0; agents fetch it again as the server's instructions tell them.

## v0.22.0

- **An organization's owners, and the instance's owners, rename it and change its slug.** It
  concerns every deployment, and asks nothing of one but this: if you change the slug of the
  organization `WHATBUILD_EXAMPLE_TENANT` names, set the variable to the new slug. Until then the
  server still finds the example by the old one, so no guest loses it, and warns at start-up.
  Addresses with an old slug keep working everywhere: links and bookmarks in the app, REST, and
  connected agents and their tokens. Migration `0036` adds a column and a table, and changes no row.

## v0.21.0

- **With a content site, every page and inline file is served from it.** It concerns deployments
  that set `WHATBUILD_CONTENT_URL`. From this release the content site serves, besides prototypes,
  every Story page, mockup page, Idea card, style specimen and print view, agents' previews, and a
  PDF or an uploaded HTML page shown in the app; the app's own addresses for them check the session
  and hand the browser there (`302`) under an address that lasts the grant lifetime. A proxy in
  front that routes by path must pass `/documents/` and `/api/v1/downloads/story-preview/` and
  `…/card-preview/` on the content site's host, as it passes `/prototypes/`. Behind Cloudflare,
  Email Address Obfuscation, Rocket Loader and Web Analytics' automatic beacon must be off on the
  content site's zone, since they rewrite HTML and would put scripts in pages that the pages'
  policy then blocks. A tab opened before the release keeps working; a tab opened before the
  setting was first turned on frames none of these until it is reloaded, so ask people to reload
  after turning it on. Turning it off stops addresses already given (`404`) until the app is
  reloaded. A deployment without a content site serves everything as before.
- **An uploaded HTML page is previewed from a route of its own, and the app allows no inline
  style.** It concerns every deployment, and asks nothing of it but one thing below. The preview
  of an HTML attachment is now framed from `…/sources/<id>/attachment/view` in a sandbox that runs
  no script, rather than made inside the app's page, so the app's policy drops
  `style-src 'unsafe-inline'`, and the weekly ZAP scan now fails on rule 10055. Behind the
  Cloudflare Worker, deploy it again (`deploy/cloudflare/worker.js`), so the public site's page
  carries the same policy. Sign-in's own pages allow their one stylesheet by its hash.
- **Only a signed-in request wakes the worker.** It concerns every deployment that runs `serve`
  with its worker, and asks nothing of it. A request to the API, MCP or sign-in wakes a sleeping
  worker only when it comes with a good session or access token, and only once it has been served.
  A scanner's or a stranger's requests no longer start the worker's minute of polling the job
  queue, so they cannot keep a database that suspends when idle awake. Uploads and other commits
  that queue work wake it as before.
- **Behind Cloudflare, the service can refuse whoever goes around the Worker.** It concerns Cloud
  Run deployments behind the Cloudflare Worker, and asks nothing until they choose it. With
  `WHATBUILD_EDGE_KEY` set, the service refuses (`403`) every request but `/health` that does not
  carry that key in `X-WhatBuild-Edge-Key`, and the Worker adds it, from
  its secret `EDGE_KEY`, to every request it passes on. To turn it on: make the secret
  `whatbuild-edge-key` and put it on the Worker, deploy the Worker from this release, and only then
  give it to the service (`--update-secrets WHATBUILD_EDGE_KEY=whatbuild-edge-key:latest`), as
  [Cloud Run](cloud-run.md) shows under "Behind Cloudflare, nobody goes around it". In the other
  order, every request is refused until the Worker has it. After that, the `run.app` address answers
  only `/health`. Without the setting, nothing changes. The same section describes the zone's
  rate-limiting rule. Re-running `setup.sh` also adds the log exclusion `whatbuild-refused-requests`,
  which drops Cloud Run's own log line for a `403` or `429`, so a flood of refused requests writes
  no logs to pay for.
- **Cloud Run: three alerts for a flood.** It concerns Cloud Run deployments, and asks one step of
  them: re-run `PROJECT_ID=<project> node deploy/cloud-run/alerts.mjs` ([Alerts](cloud-run.md#alerts)).
  It adds `whatbuild: a flood of requests` (more than 3,000 in five minutes), `whatbuild: data sent
  out` (more than 1 GB to the internet in an hour) and `whatbuild: logs written` (more than 100 MB
  in an hour), the costs that have no ceiling. Without the step, a flood mails nothing until a
  budget notices, hours later.
- **Cloud Run: a kill switch at a spending cap, if wanted.** It concerns Cloud Run deployments,
  and asks nothing unless they want one. `deploy/cloud-run/kill-switch.sh` (`PROJECT_ID`, `CAP` in
  the billing account's currency, `SERVICES`) makes a budget of that amount on the billing account
  and a small private service that, when the month's spending reaches it or a flood runs away, takes
  the public off the invoker role of each service named: closed to the internet (`403`), with its
  data kept, until it is opened again ([A hard limit on the bill](cloud-run.md#a-hard-limit-on-the-bill)).
  Re-running `setup.sh` opens a closed service.

## v0.20.0

- **The public sandbox is gone; a deployment may name an example organization instead.** It
  concerns a deployment that set `WHATBUILD_SANDBOX_TENANT`. The setting is no longer read (the
  server warns at start-up while it is set without the new one), and migration `0034` drops the
  sandbox's invitation links, baselines and settings and every visitor's seat. Before taking this
  release, reset the sandbox to its baseline (`sandbox(action="reset")`, or Reset to this one on
  its page) so that what the organization holds afterwards is its staff's content, not what
  visitors added; the reset is not offered after it. Then, on the maintainer's public deployment
  only, set `WHATBUILD_EXAMPLE_TENANT` to the same slug: every signed-in account reads that
  organization and only its members change it. A self-hosted deployment leaves it unset and has no
  example. Without it there is no example organization, and the former sandbox is an ordinary
  organization of its owners and admins. The sandbox's invitation links (`/join/<code>`) now open
  the app; nothing they promised is kept.
- **Delete the sandbox's reset job.** It concerns a Cloud Run deployment whose `setup.sh` ran with
  `SANDBOX_TENANT`: the route the job calls, `POST /api/v1/sandbox/reset-if-due`, is gone, and the
  job fails every day until it is deleted:
  `gcloud scheduler jobs delete whatbuild-sandbox-reset --location <its region>`.
- **Organizations have a plan, and new ones may start on the free plan.** It concerns every
  deployment. Every organization that exists before migration `0034` is unlimited, and so is every
  one an instance owner creates. One someone else creates gets the plan in
  `WHATBUILD_NEW_ORGANIZATION_PLAN`, unlimited unless it says `free`; on the free plan everyone in
  the organization meets daily limits (by default 500 writes, 25 sources, 5 exports and 100 MB of
  uploads for each person; 2,000 writes and 250 MB for the whole organization; 120 calls and 30
  writes a minute; files of at most 10 MB, documents only), which only instance owners change, on
  `/instance` or with `products(action="set_limits")`. A deployment open to the public sets
  `WHATBUILD_NEW_ORGANIZATION_PLAN=free` before or with this release
  ([cloud-run.md](cloud-run.md)); a self-hosted deployment leaves it out. Changing it changes only
  organizations created afterwards.
- **A person can hide the example organization from the panel.** Migration `0035` adds
  `accounts.hide_example`; nothing to do. The overview and Settings show it again.
- **The instance's owners see every account and may remove one.** It concerns every deployment and
  asks nothing of it. **People** (`/people`, in the panel and the account menu for an owner of the
  instance) lists every account with its organizations and when it was last seen; Remove, in the web
  app only, signs the account out everywhere, takes its roles, cancels its invitations and
  allowance, and forgets its address. `products(action="accounts")` lists them for an instance
  owner's agent; removing is never offered to an agent.
- **The MCP tool list changes.** The `sandbox` tool is gone (13 tools), and `products` gains
  `limits`, `organizations`, `set_limits` and `accounts`. A connected client sees the change in a new session.
  `products.usage` takes `example` in place of `sandbox`, and `pnpm usage` takes `--example`. The
  skill is now at version 0.38.0; agents fetch it again as the server's instructions tell them.

## v0.19.0

- **An agent reaches a public sandbox only through the sandbox's own connector.** It concerns
  anyone, staff included, whose agent works in a deployment's public sandbox through the unscoped
  connector (`/mcp`), and asks nothing of the deployment. From this release every such call is
  refused with `403 sandbox_needs_its_own_connector`, which changes nothing and names the address
  to add instead, `/mcp/t/<sandbox>`; the sandbox's page, Connect an agent and the page behind an
  invitation give it too. Through `/mcp`, `products(action="list")` no longer lists the sandbox's
  products and teams, only its name and that address, under `public_sandboxes`. Upload grants an
  agent was given through `/mcp` before the release keep working until they expire; download grants
  given before the release stop at once, since every download grant now names its requester. The
  skill is now at version 0.37.0; agents fetch it again as the server's instructions tell them.
- **People are emailed when a new agent connects as them.** It concerns every deployment that
  sends mail, and asks nothing of it. From this release the worker sends one message for each new
  agent connection, to the account's address: what connected, where it is held, what it reaches,
  and how to disconnect it or sign out everywhere. A refresh sends nothing, and neither does an
  agent of the same name connecting again from the same place. A deployment without mail sends
  nothing, and the consent page now warns before a first connection at a web address the person
  has never connected an agent at.

## v0.18.1

- **A request's log line names its request.** v0.18.0 put `request_id` on an unexpected error's
  line but not on the request's own line, so a search for `jsonPayload.request_id` found only the
  error. Both carry it now. Nothing to do.

## v0.18.0

- **An unexpected error is one log line, and every response names its request.** It concerns
  anyone who reads or filters a deployment's log. In production an unexpected error is now one
  JSON line with `"severity": "ERROR"`, its label and stack in `message`, and the request's
  `request_id`, where it was several lines of plain text; each request's log line carries
  `request_id` too, and each response carries it in `X-Request-Id`. A filter on the old text
  finds it in `jsonPayload.message`. Nothing to do.
- **Traces, for a deployment that wants them.** Nothing changes unless a deployment sets
  OpenTelemetry's settings: `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` for a
  service that takes a key ([Traces](cloud-run.md#traces)). On Cloud Run, send them to a project
  of their own, never the service's: a project with trace storage also keeps Cloud Run's own
  request spans, with every address whole. A deployment whose traces project, grant and BigQuery
  link are in place sets its two variables once this release serves, `T` being the traces project:

  ```bash
  gcloud run services update whatbuild --project $P --region $R --update-env-vars \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.googleapis.com,OTEL_RESOURCE_ATTRIBUTES=gcp.project_id=$T
  ```

  Then check that its spans arrive: the guide's first query, a few minutes after a request.
- **Cloud Run: alerts.** A Cloud Run deployment set up before this release has none. Make them once
  with `PROJECT_ID=<project> node deploy/cloud-run/alerts.mjs` ([Alerts](cloud-run.md#alerts)).

## v0.17.2

- **The worker sleeps between requests, so the database can too.** It concerns every deployment
  that runs `serve` with its worker, and asks nothing of it. A minute after the last request to the
  API, MCP or sign-in, or the last job, the worker stops polling the job queue, and nothing else
  queries the database until the next such request, a commit that queues work, or a retry falling
  due. A database that suspends when idle, as Neon's does after five minutes, then sleeps while
  the instance stays up. A job an instance left when it stopped is still taken once its lock is
  ten minutes old if an instance is up then, and otherwise at the next request. A public sandbox's scheduled reset runs at the first request after its hour, or when
  a scheduler calls `POST /api/v1/sandbox/reset-if-due` (Cloud Run's `setup.sh` creates one), but
  no longer at a minute's tick while an instance is up. A deployment that runs `worker` on its own
  keeps polling.
- **Behind Cloudflare, deploy the Worker again** (`deploy/cloudflare/`, as
  [Cloud Run](cloud-run.md) says). It now answers 404 itself for paths the app never serves, which
  scanners ask for (`/.env`, `/.git/config`, `/xmlrpc.php` and the like), so they no longer wake
  the service and its database. Until it is deployed, those paths reach the service as before.

## v0.17.1

- **The Cloud Build configuration moved to `deploy/cloud-run/cloudbuild.yaml`.** It concerns a
  Cloud Run deployment whose trigger runs the build (`deploy-release`, as [Cloud Run](cloud-run.md)
  names it). Before publishing this release, point the trigger at the new path. A trigger still naming
  `cloudbuild.yaml` fails at once on this release's tag and deploys nothing, and the release
  running now keeps serving:

  A trigger on a GitHub connection refuses
  `gcloud builds triggers update github … --build-config` with `INVALID_ARGUMENT`. Rewrite its
  definition instead, which keeps every other setting, and check that only `filename` changed:

  ```bash
  gcloud builds triggers describe deploy-release --project $P --region $R --format=yaml > before.yaml
  sed 's#^filename: cloudbuild.yaml$#filename: deploy/cloud-run/cloudbuild.yaml#' before.yaml > after.yaml
  gcloud builds triggers import --project $P --region $R --source after.yaml
  gcloud builds triggers describe deploy-release --project $P --region $R --format=yaml | diff before.yaml -
  ```

  `--format='value(filename)'` on the same `describe` says which path a trigger runs now.

  A deploy by hand passes `--config deploy/cloud-run/cloudbuild.yaml` ([Cloud Run](cloud-run.md)).
  Going back by running an earlier image ([recovering](recovering-from-a-bad-release.md)) needs
  nothing; rebuilding an earlier tag needs that tag's own path, `cloudbuild.yaml`.
- **The Dockerfile moved to `deploy/Dockerfile`.** Whoever builds the image themselves passes
  `-f deploy/Dockerfile`, with the repository's root still the build context
  (`docker build -f deploy/Dockerfile .`, or `az acr build … -f deploy/Dockerfile` as the
  [Azure guide](azure.md) does). A deployment that pulls the released image has nothing to do.

## v0.17.0

- **Migration `0032_idea_cards`.** It adds an empty `card_html` to every product and outcome, the
  front of its card. Nothing is dropped and no text changes, and an earlier release runs on the new
  schema (the columns have a default), so going back needs no restore; fronts drawn in between are
  kept and shown again on going forward. Rehearse on the dev deployment first, as for every release
  that migrates ([dev-deployment](dev-deployment.md)).
- **Migration `0033_card_previews`.** It adds one table, for the fronts `outcomes.card_preview`
  checks, each held until its grant expires. Nothing else changes, and an earlier release runs on
  the new schema, so going back needs no restore.
- **People will notice that Idea changed, and no longer edits.** The product concept and each
  outcome is a card: a picture, which agents draw, under the card's title, and the text agents
  read, which More info opens above the picture. The New outcome button, editing an outcome or the
  concept on Idea, and the concept field in product Settings are gone; agents write both sides.
  Outcomes are put in order by dragging them (or with the keyboard), and Earlier versions is no
  longer in an outcome's menu; agents still read and restore them.
  Until an agent draws a picture, each card opens on its text, with a request to copy for an
  agent, so every product reads as before. Tell the teams on a deployment, and ask each team's agent to draw
  its cards ([decision](../decisions/idea-cards-have-a-front-for-people-and-a-back-for-agents.md)).
- **Agents and integrations must send both sides of a card, and write the concept with its own
  action.** `products(action="update")` no longer takes `concept`: the concept's card is written
  with `products(action="update_concept")` (`PATCH P/idea/concept`), which editors may call as
  well as admins; `products.update` renames a product and changes its slug. An
  `outcomes(action="update")` or `products(action="update_concept")` that changes an outcome's
  `description` or the `concept` without
  sending `card_html`, once the card has a front, is refused (`422 card_sides_together`), and so is
  one that changes `card_html` alone. `outcomes(action="list")` now gives `card_chars` in place of
  the front. A new action, `outcomes(action="card_guidance")`, teaches how to draw a card, and
  `outcomes(action="card_preview")` gives an agent a front as the Idea screen will show it, its
  height limit marked, before writing it. A write
  that touches a card may return `card_advice`, and `outcomes(action="list")` and
  `products(action="get")` say in `note` which cards have no front yet.
- **The skill is 0.36.0.** Connected agents are asked to update their installed skill. It teaches
  the two sides of a card, the card kit, to preview a front before writing it, and to read
  `card_advice`. An agent whose client connected before the upgrade lacks `card_guidance`,
  `card_preview` and `update_concept` until it starts a new session.
- **Agents see an upgrade in the next answer.** Every product-scoped MCP result's `scope`, and
  `products(action="list")`, now gives `skill_version`, the skill version the server runs. An
  agent connected before the upgrade sees there that its tool list is older and asks the person
  for a new session, rather than taking an action its list lacks for one the server refuses.
  Nothing to do; an integration that compares `scope` whole sees one more field.

## v0.16.0

- **Migration `0031_summaries_and_notes_have_etags`.** It gives every source's summary and notes
  (`agent_notes`) an etag of its own, live and in saved sandbox baselines. Nothing is dropped and
  no text changes, and an earlier release runs on the new schema (the column has a default), so
  going back needs no restore. The earlier release's `derived(action="write_note")` replaces a
  summary or notes without changing its etag, though: after going back and forward again, an etag
  read before going back can still match a summary or notes changed in between, and a write with it
  goes through. Rehearse on the dev deployment first, as for every release that migrates
  ([dev-deployment](dev-deployment.md)).
- **A version being replaced takes no jobs once a later version's migrations have run.** Nothing to
  set. A release's migrations run while the version before it still serves; from then on that
  version's worker waits, and its log says the database has migrations it does not carry, so the
  work a migration queues is done by the version it was queued for. It protects the upgrades that
  start from this release or a later one, because the version being replaced must already do it:
  taking this release, v0.15.0 goes on taking jobs while `0031` runs, as before, and `0031` queues
  none. From this release on, going back past a later release's migration means restoring the
  database, even where that release's notes say the earlier code runs on its schema: on the later
  schema, the earlier version's worker waits ([recovering](recovering-from-a-bad-release.md)).
- **Agents and integrations must send an etag they could leave out before.** Once a source has a
  summary, notes or a derived text, `derived(action="write_note")` and
  `derived(action="write_text")` refuse a write or a clearing without its current etag
  (`409 stale_etag`, with `current_etag`); a first write still takes none. `read_note`,
  `write_note` and `sources(action="get", detail="full")` (in `agent_notes`) give the etags of the
  summary and the notes, and `derived(action="text")` and `text.etag` the text's. An integration
  that rewrote these without reading first is refused until it reads, then passes the etag.
  People will notice that saving a summary, notes or text someone else changed meanwhile shows
  their version, and saves over it only when asked. The other way round, an etag sent where there
  is nothing to match is refused (`409 stale_etag`, `current_etag: null`) where it was ignored:
  for the first `story(action="set_style")`, for `products(action="set_tenant_allowance")` on an
  address without an allowance, and by `mockups(action="publish")` without `mockup_id`, which
  refused it without saying so in `details`; leave it out until the object exists.
- **Nothing is read again by itself, except in a public sandbox; existing plain-text, workbook and
  PDF attachments read better once read again.** A `.txt` now keeps its lines and list markers,
  joining only hard-wrapped prose, sets a list under a line that ends in a colon apart from it, so
  the list reads as a list whatever number it starts at, and ends a quoted message before the reply
  under it; an `.xlsx` reads values as the sheet shows them (`+14.0%`, not `0.14`), reads and marks
  hidden sheets, columns and rows and a value other than zero that its format shows as nothing (a
  zero shown as nothing stays a blank), and says when a formula was saved without its value; a
  `.pdf` reads a table as a table, a label beside its value (`Samples: 79`), a heading set larger
  than its page's text as a Markdown heading of its own rather than the first words of the
  paragraph under it, and a running header or footer once, where it first appears, leaving its
  page numbers out, which `facts.headers_and_footers` in `derived(action="manifest")` lists
  (plain-text parser 8, XLSX 6, PDF 5). A reading made earlier keeps its layout until its attachment is read again, with
  `derived(action="rederive")` or Read it again in the web app, or by a public sandbox's reset
  (below); a source whose text still follows that attachment then takes the new text, and a text
  someone wrote or edited is left alone. Left unread, those sources read and are found as before.
  Nothing else needs reading again: a scan recorded as failed reads `unsupported`, a recording that
  asked for "a transcript as a new source" asks for another attachment, and an image says how an
  agent gives it its words, in sandbox baselines too.
- **A public sandbox's reset reads again what its baseline read with an older parser.** Nothing to
  set. At each reset, an attachment whose saved reading was made by another parser or an earlier
  version of the one that reads it now, or found unsupported when no parser read its format, where
  one does now, is read again by this version's parsers, recording nothing in the activity log, and
  a text still taken from it follows. A baseline saved before this release holds such readings for
  its plain-text, Markdown, CSV, TSV, WebVTT, SubRip, workbook and PDF attachments (plain-text
  parser 8, Markdown 5, CSV 4, WebVTT and SubRip 3, XLSX 6, PDF 5), and one saved before v0.14.0
  for most of its attachments, so each reset reads them again, a minute or two of work, until the
  baseline is saved again. To save it without what visitors add meanwhile, set `visitor_access` to
  `read`, reset, let the readings finish (the log has a `job … derive …` line for each), save the
  baseline, then set `visitor_access` back as it was. A sandbox source whose only readable
  attachment was unsupported when the baseline was saved, such as a `.csv` one, gets its text. A
  reading that failed, found the file too large, or found a recording or only pictures (an image,
  or a PDF whose pages are pictures, even one an earlier release recorded as failed) is never read
  again.
- **Nothing to change; a text file that holds a null character is read.** A text, Markdown, CSV,
  TSV, WebVTT or SubRip attachment with a null character (U+0000) in it, which a Postgres text
  value cannot hold, could not have its reading saved when the source was to take its text, and
  stayed `pending` ("Reading") for good. Readings now leave the character out and count it in
  `facts.null_characters_dropped` (Markdown parser 5, CSV 4, WebVTT and SubRip 3; plain text is 8
  above). Such an attachment is read once it is read again with `derived(action="rederive")`.
- **Nothing to change; people and agents will notice a reading that kept failing says so.** A
  reading whose five attempts each failed with an error, rather than by stopping the server, was
  given up with nothing recorded, so its attachment read "Reading" (`pending`) for good, as one
  holding a null character did (above). Such a reading is now recorded as `failed` ("Couldn't be
  read"), saying that the file could not be read and that reading it again may help, and Read it
  again in the web app, or `derived(action="rederive")`, tries once more. An attachment an earlier
  release left `pending` so, whatever the error, waits to be read again as the one above does; the
  worker's log has a `job … derive failed (attempt 5, giving up)` line for each.
- **Nothing to change; people will notice attachments say what they are at once.** Recordings,
  images and formats no parser reads show their status the moment they arrive instead of
  "Reading". An image, or a PDF whose pages are pictures (PDF parser 5), is "Not read as text"
  rather than a failure, with no "Read it again". `sources(action="get")` warns of attachment text
  the source's derived text does not use, and search's `coverage` counts sources of pictures
  apart from those that could not be read.
- **Nothing to change; agents and people will notice search answering more exactly.** Exact
  (substring) search returns a hit for every place the words occur, each with its own offsets and
  snippet, so `limit` counts places and `next_cursor` may carry on inside a piece of text; a
  cursor from an earlier release still works. A query is no longer trimmed: its spaces count in an
  exact search, a space at the end of a plain search says its last word is finished, and a query
  of only spaces is refused (`422`). `%`, `_` and `\` in a search, or in the `query` of the
  source, assumption, outcome and sandbox-visitor lists, match themselves instead of any text.
  Plain search, the web app's too, reads an id or a number such as `CB26-20734` as one word,
  finds the number after a hyphen, and never corrects it into a neighbouring one; one with a letter
  in it is found as its words side by side too (`q3-planning` in "Q3 planning"). Over MCP it takes
  `limit` (60 results unless asked). Search answers `search_scope`, the only place its own
  scope shows over MCP. With `scope: "all"`, assumptions come on the first page only, so the
  pages after it no longer repeat them, and a search of assumptions alone refuses a cursor
  (`422 invalid_cursor`). Ranked search finds a bare number where a hyphen joins it to the rest of
  an id (`20734` in `CB26-20734`). Plain search's excerpts, in the palette and the Search screen
  too, are centred on where the most of the words are (a quoted phrase on the phrase), start and
  end at whole words, and mark their words in a text with an ellipsis or a ligature in it, where
  they were left unmarked; an assumption's body and the product concept show as words, without
  their Markdown, as a source's text does, and every excerpt, a mockup's notes and a source's text
  too, drops italics and code markers, shows a link as its text, without its address, and shows
  an escaped character (`\[`, `\*`) without its backslash. A source's result carries `match_count`, how many times
  its text says the words as its Find in the text counts them, and that is the "N matches" the
  palette and the Search screen show, so it agrees with the find's "… of N" (it counted places
  before, which `hit_count` still does).
- **Nothing to change; agents will write the Story differently. The Story guidance is 5.0.0.**
  The Story is the team's own communication (what to build, the pitch, the plan), and neither the
  guidance nor the skill sets a rule about how a page quotes, paraphrases, attributes or links;
  the checks that a page is true to its sources stay. `story(action="guidance")` adds
  `links_note`, `list_pages` reports `archived_hidden`, `set_hierarchy` says to publish or restore
  a page it refuses, and a style based on a retired house style carries a `note` in `get_style`
  and the guidance.
- **A tally in a house style now shows every mark at any width.** A product keeps the stylesheet
  it adopted, so its pages get the fix only once an agent adopts the house style again
  (`story(action="set_style")` with `house_style`) and publishes each page with `restyle: true`;
  until then a tally in a narrow column or on a phone may not show every mark. A team that adapted
  its stylesheet can copy the new `.tally` rule.
- **Nothing to change; agents and scripts will notice some answers.** `mockups(action="publish")`
  answers with the mockup's ids, version, etag, `page_ids`, `url` and warnings instead of the
  whole canvas: read the canvas with `mockups(action="get")`. `activity(action="list",
  by="people")` leaves out what WhatBuild does by itself, such as reading an attachment, and
  `entity_type` refuses `team`, `tenant` and `feedback` (`422`). In a public sandbox,
  `attachments(action="create_uploads")` takes each of its sources from a visitor's
  `sources_per_day`. `assumptions(action="supersede")` takes `reviewer_type`. The activity log no
  longer quotes a comment's archive reason, and reads older entries without it. A product
  export's `README.txt` lists every kind of file the bundle holds, and `assumptions.json` no
  longer carries the database's search vector.
- **Nothing to change; agents and people will notice clearer refusals.** A null character
  (U+0000) in a request, its address, query, form or JSON fields and an MCP call's input alike, is
  refused with `422 invalid_input` naming the field, before anything reads it, where it answered
  500 (a source's attachment and text, an export, Story and mockup pages and sign-in included). An unexpected error says how
  to report it where it was met: Submit feedback in the web app's account menu, `submit_feedback`
  for an agent. A grouped tool called without `action` says it is missing and lists the tool's
  actions, and an unknown action lists them too: only those the connection is offered, as its tool
  list shows them, where an unknown action listed every one, a permanent delete to an Edit
  connection included, and an unknown tool lists the tools the connection is offered, without
  `submit_feedback` where its person turned it off; a standalone tool called with `describe`, `action` or `params` says its fields are its
  arguments; and a list sent as one value says what the list takes (`status` takes a list, such as
  `["confirmed"]`). On a connection whose person turned feedback off, `submit_feedback` is
  refused with `403 feedback_off` whatever is sent, a call with invalid input included. An
  archived source is read-only, as archiving always promised: correcting its title, date or tags
  (`sources(action="update")`) and editing, archiving, restoring or deleting one of its comments
  are refused with `409 record_archived`, as adding a comment was, and the refusal says how to
  restore the source; the web app offered none of them there but an admin's delete of a comment,
  which it now leaves out too. In a public sandbox, someone its staff gave a role, who meets its
  limits but is no visitor, is no longer told a limit is for visitors: a refusal says what is off
  "except for its owners and admins" and counts "each person but its owners and admins", and a
  visitor is told as before.
- **Nothing to change; agents will notice `product` naming an organization.** Over MCP, an
  organization's or a team's action, such as `sandbox(action="status")`, called with `product`
  and no `tenant` acts on the organization (and team) that product is in, where it was refused
  with "`tenant` is required"; called with neither, it says to pass `params.tenant` and where to
  read it. `members(action="list")`, `grant` and `revoke`, which take a product of their own in
  `params`, still need `params.tenant`.
- **Nothing to change; people will notice they can archive a comment in the web app.** An editor
  archives a comment from its menu, saying why if they like, and restores it from the archived
  comments a source's Comments list on request; a comment's delete dialog offers Archive
  instead, as a live product's does too, and every delete dialog has Cancel. A screen reader names
  each comment's menu by the comment's first words too, and by which of them it is where two start
  alike, so two by one person at the same time are told apart. A search hit opens
  a source's text at its own match, from the palette too when the source's title holds the words;
  a day in Activity whose older changes are not loaded yet counts "37+ changes"; search marks
  stand out in the dark theme; an attachment an agent added says which agent, as the source's
  Details do; and a source's date updated is called Details updated, which its text, summary and
  notes never changed.
- **The skill is 0.33.0.** Connected agents are asked to update their installed skill. It tells
  them which etag a source's summary, notes and text take, and to send none before a first write,
  how search matches and pages, how a source's text is chosen and laid out, what an image or a
  scan needs, how to restore what was archived and that an archived source is read-only, that a
  standalone tool takes its fields as its arguments, and, with the server's instructions, which
  installed copy to follow when there are several. Nothing needs a new session: the new fields go through actions every client already
  lists. An agent that keeps the older skill is refused when it writes a summary, notes or text
  without its etag, and the refusal says where to read it.

## v0.15.0

- **Nothing to change; people will notice Evidence reads differently.** A source's page shows its
  summary whole, then its images in the viewer, then its text folded to its first lines (a click
  near the bottom unfolds it). The Sources list shows one date per row, the one it is ordered by,
  and each row can unfold its summary; Show summaries unfolds them all.
- **The skill is 0.32.0.** It tells agents the summary is the part of a source people read, to be
  written succinct and high in signal, and that `sources(action="list", include_summary=true)`
  returns the summaries. Connected agents are asked to update it; the new `include_summary`
  works without a new session.

## v0.14.2

- **Nothing to change.** A page left open while the deployment takes a release now loads that
  release at its next screen, or as soon as it fails, instead of failing on answers it cannot
  read ("Cannot destructure property … as it is undefined"). It works from pages opened on this
  release; one opened earlier needs reloading by hand once. Images built without
  `WHATBUILD_COMMIT` (which Cloud Build, the Release workflow and the Azure guide all pass) never
  reload.

## v0.14.1

- **Nothing to change.** Dependencies move to Vite 8, marked 18 and `@google-cloud/storage` 8,
  which needs Node 22 or later, as WhatBuild already does.

## v0.14.0

- **Migration `0029_simplify_source_details`.** It drops `participants`, `source_system` and
  `provenance_depth` from `records`, `provenance_depth` from `register_entries`, and `seq_start`,
  `seq_end` and `anchor` from `annotations`, deletes every agent outline (`agent_notes` of kind
  `outline`), and does the same to saved sandbox baselines. The values are deleted, not moved
  anywhere; comments keep their text. Rehearse on the dev deployment first
  ([dev-deployment](dev-deployment.md)). An earlier release cannot add a source, an assumption or
  a comment on the new schema, so going back past this one means restoring the database
  ([recovering](recovering-from-a-bad-release.md)).
- **A source's page is simpler.** Nothing to set. People see a source's tags and its three dates,
  and no participants, origin or provenance; a summary under the title that editors can write and
  edit; Notes, Comments and Attachments sections, where Files was; comments on the whole source,
  not on passages; and no outline.
- **Agents can no longer send participants, a source system, provenance or a comment range.** A
  call that does is refused with `422` and a hint. `derived(action="outline")` is gone, and
  `write_note` and `read_note` take `summary` or `notes`. **The skill is 0.30.0**: it tells
  agents the summary is written for people and what belongs in notes. Connected agents are asked
  to update it, and need a new session for the shorter list of `derived` actions.
- **Migration `0030_one_derived_text_per_source`.** It gives each source one derived text: the
  passages of its primary file's current parse become one Markdown document, recorded as that
  file's text, and the passages saved in sandbox baselines become saved texts the same way. It then
  drops `segments`, `records.current_derivation_id`, `derivations.segment_count`, and a file's role
  and provenance (`role`, `derived_from`, `derivation_note`, `derived_by`, and when its role
  changed) from `files` and `upload_grants`, in saved baselines too. It queues the worker to read
  every attachment again, recording nothing in the activity log, so a text still taken from its
  attachment is soon laid out as the parsers now lay it out (speakers and times in the text, tables
  whole), and a source that had no passages takes the text of the first of its attachments that
  can be read, a former origin or supplement file among them; and to build the search index of
  every product (`index_texts`). The index starts empty, so search finds little until those jobs
  are done. Rehearse on the dev deployment first and watch the jobs finish
  ([dev-deployment](dev-deployment.md)). It drops a table and columns, so going back past it means
  restoring the database ([recovering](recovering-from-a-bad-release.md)).
- **If v0.13.0 was still running when `0030` ran,** its worker may have taken some of the readings
  the migration queued and skipped them: it looked for a file's role, which the migration had
  dropped. Its log has a `job … derive <source id>: skipped` line for each. Those attachments keep
  their earlier reading, a text taken from their passages keeps the migration's layout, and a
  source that had no passages has no text. Read them again from the source's Attachments (**Read it
  again**) or with `derived(action="rederive")`. From the release after v0.15.0, a public
  sandbox's reset reads them again by itself.
- **A source's words are one text, and its files are attachments.** Nothing to set. People see a
  source's words as one document under **Text**, where Passages and Original were, which editors
  can edit or take from another attachment; **Attachments** lists every file with how its text was
  read, with no primary, origin or supplement and no "Searched" label; adding a source has one
  drop zone for attachments; and search finds words in a source's title, tags, summary, text,
  notes and comments, says where, and never in an attachment. An old link to a passage opens the
  source's text. A product export is format version 2: each source's text as `text.md`, its
  attachments under `attachments/`. In Google Analytics, `search_result_open` gives a source hit's
  field (`text`, `summary`, `notes` or `comment`) where it gave `passage`.
- **Agents read and write a source's derived text.** The `files` tool is `attachments`, without
  `set_role` or `add_note`; `read_passage` is gone (118 operations, 14 MCP tools);
  `derived(action="write_text")` writes a source's text, whole, by edits or from an attachment;
  `search` takes `scope: "sources"`, and its hits give the `field` they are in and code-point
  offsets to read around with `derived(action="text")`. A call that sends an attachment a role or
  provenance is refused (`422`) with a hint. **The skill is 0.31.0, and the Story guidance
  4.0.1.** Connected agents are asked to update the skill, and need a new session: a client
  connected before the upgrade keeps `files` and `read_passage` in its tool list, and they answer
  `unknown_tool`. Usage counts name the new operations from the upgrade on; earlier days keep
  `files.*` and `read_passage`.

## v0.13.0

- **Migration `0027_drop_dimensions`.** It drops the `dimensions` columns of `records` and
  `register_entries`, and the field in saved sandbox baselines: every customer, product area and
  lifecycle stage a source or assumption held is deleted, not moved anywhere. Rehearse on the dev
  deployment first ([dev-deployment](dev-deployment.md)). An earlier release cannot add a source
  or an assumption on the new schema, so going back past this one means restoring the database
  ([recovering](recovering-from-a-bad-release.md)).
- **Agents can no longer send dimensions.** Nothing to set. A call that sends `dimensions`, or
  filters `sources(action="list")` or `search` by `customer`, `product_area` or
  `lifecycle_stage`, is refused with `422` and a hint to use tags. The web app never showed them.
- **ACS mail with managed identity.** Optional: an Azure-hosted deployment can use the ACS Email
  API by selecting `WHATBUILD_MAILER=acs`, setting `WHATBUILD_ACS_EMAIL_ENDPOINT` and a verified
  `WHATBUILD_MAIL_FROM`, and granting its managed identity access to the linked Communication
  Services resource. For a user-assigned identity set `WHATBUILD_AZURE_CLIENT_ID`. No SMTP
  identity or mail secret is needed. Existing mailer defaults are unchanged; see
  [Azure](azure.md#mail-with-azure-communication-services).
- **Migration `0028_citations_refs_and_lineage_retired`.** It removes citations and the graph
  around them. Each assumption's citations, and those of a decision still waiting to move into
  Evidence, go to the end of its body under **Passages cited**, one line per quote with its
  source's title, and those entries get a new etag; Story page and mockup versions lose their
  citations and references, sources their related sources, and views their lineage; kept
  revisions and saved sandbox baselines are rewritten the same way. It drops columns and a table,
  so an earlier release does not run on the new schema, and going back past it means restoring
  the database ([recovering from a bad release](recovering-from-a-bad-release.md)). Rehearse on
  the dev deployment first ([dev-deployment](dev-deployment.md)).
- **Citations, references, lineage and related sources are gone.** Nothing to set. Assumptions,
  Story pages and mockups no longer cite passages or list what they draw on; a source's page no
  longer shows Cited in or Built from, and a passage no longer shows Cited by. `check_citations`,
  `sources.used_by` and the `lineage` tool are gone (121 operations, 15 MCP tools); a call that
  sends `citations`, `refs` or `related_records` is refused (`422`), and a source moves to another
  product whatever mentions it.
- **The skill is 0.29.0, and the Story guidance 4.0.0.** Agents explain in their own words and
  quote a person only where their words matter, without passage links. Connected agents are asked
  to update the skill. A client connected before the upgrade keeps the old tool list, with
  `lineage` and `check_citations`, until its person starts a new session.

## v0.12.0

- **Migration `0026_feedback_digest`.** It adds columns to `feedback` (where a report came from,
  an address its sender shared, when it was mailed) and makes its `submitted_by` nullable, adds a
  table of daily counts per person, and adds `oauth_tokens.feedback`, true by default. Rehearse on
  the dev deployment first ([dev-deployment](dev-deployment.md)); an earlier release runs on the
  new schema, except that one inserting feedback would leave `submitted_by` filled as before.
- **Feedback can arrive by email.** Optional: set `WHATBUILD_FEEDBACK_EMAIL` to an address, on a
  deployment that sends mail, and it gets a digest of new feedback at most once a day
  ([mail](mail.md#the-feedback-digest)). Without it nothing changes: feedback stays in the database.
- **People send feedback from the app.** Nothing to set. **Submit feedback** in the account menu
  says what is sent, and reports name nobody unless the sender shares an address. A person and
  their agents send at most 10 a day (`429 rate_limited`).
- **Each agent connection can be kept from sending feedback.** Nothing to set: connections keep
  `submit_feedback`, and a person turns it off under Connect an agent.
- **The skill is 0.28.0.** It says feedback names nobody, its daily limit, and that a missing
  `submit_feedback` was turned off by the person, not left out of an old tool list. Connected
  agents are asked to update it.

## v0.11.1

- **Nothing to change.** A canvas ZIP that unpacks past 96 MB is refused with a message that says so.
- **From v0.10.0 or earlier**, also take v0.11.0's notes below: it adds migrations
  `0024_story_previews` and `0025_mockup_prototypes`, and moves pages opened on another name for
  the deployment to `WHATBUILD_PUBLIC_URL`.

## v0.11.0

- **Migration `0024_story_previews`.** It adds one table, for the documents `story.preview`
  holds for half an hour. Rehearse on the dev deployment first ([dev-deployment](dev-deployment.md));
  an earlier release also runs on the new schema, which only adds a table.
- **Migration `0025_mockup_prototypes`.** It adds one table, for a mockup version's prototype
  files, and two nullable columns to `mockup_pages`, whose `html` becomes nullable with a check
  that a page has HTML or an entry. Rehearse on the dev deployment first
  ([dev-deployment](dev-deployment.md)); an earlier release reading a version that has an entry
  page would fail on its null HTML, so going back after a prototype is published means restoring
  the database ([recovering from a bad release](recovering-from-a-bad-release.md)).
- **Agents can preview a Story page before publishing it.** Nothing to set. `story(action="preview")`
  takes what `publish` takes, refuses what it would refuse, publishes nothing and returns a grant to
  open the exact page in a browser.
- **Mockups carry a team's prototype as it is.** Nothing to set: prototypes are served from the
  app's own origin under `/prototypes/`, and a canvas holds up to 48 pages. A deployment that wants
  them on a site of their own sets `WHATBUILD_CONTENT_URL` to an origin on another registrable
  domain (never a subdomain of the app's), points that host at the service, and nothing else
  changes; `WHATBUILD_PROTOTYPE_GRANT_HOURS` (8) sets how long a prototype's address lasts. A proxy
  in front that routes by path must pass `/prototypes/` to the service.
- **People arrange, archive and delete Story pages in the app again.** Nothing to set. Editors
  drag pages in the Story's tree (or use Alt and the arrow keys) and archive or restore them from
  a page's menu; admins delete them there too. Mockups gain Fill (`3`) beside Fit (`2`), on the
  canvas and on a published mockup in the Story.
- **A page opened on another name for the deployment moves to `WHATBUILD_PUBLIC_URL`.** People who
  open the app on Cloud Run's `run.app` address, Container Apps' default host or an earlier domain
  still pointed at it land on the same page at the public URL, signed in; probes, agents, `/api`,
  `/mcp` and OAuth are answered where they ask, as before. Nothing to do behind the Cloudflare
  Worker, a Cloud Run domain mapping, Container Apps' own custom domains, or with no custom
  domain. A deployment behind a proxy that sends the service's own host name as `Host` and no
  `X-Forwarded-Host` sets `WHATBUILD_REDIRECT_TO_PUBLIC_URL=0` before taking the release, or its
  pages redirect to themselves. Connected agents are told the public URL to write links with.
- **The skill is 0.27.0.** It teaches previewing a Story page before publishing it; that people
  now arrange, archive and delete Story pages in the app, so an agent reads the hierarchy again
  before setting it and keeps the arrangement they chose; which writes are safe to send again
  after a lost response; the HTML rules a mockup page now has of its own (forms whose submissions
  go nowhere, scripts without a budget, a page that scrolls past its height, the mockup quota);
  and uploading a team's prototype as it is (relative addresses, no network, stateless, and the
  warnings publish gives). Nothing to set: connected agents are asked to update it, and to start a
  new session for the new action.

## v0.10.0

- **Migration `0023_outcomes_current_or_archived`.** An outcome is current or archived: archived
  outcomes keep their archive as `archived_at`, achieved ones become current, and the `status`
  column goes, in saved sandbox baselines too. Rehearse on the dev deployment first
  ([dev-deployment](dev-deployment.md)); going back to an earlier release means restoring the
  database ([recovering from a bad release](recovering-from-a-bad-release.md)).
- **Outcomes lose their status, and agents read them as the compass.** Nothing to set. People see
  Hide archived and Include archived on Idea where Active, Achieved and Archived were, and no
  assumption chips under an outcome. Agents archive and restore with `outcomes(action="archive")`
  and `restore`, list archived ones with `include_archived`, and get no `counts` on an outcome; a
  `status` sent to `outcomes` is refused, and so is an outcome whose text holds a record id
  (`outcome_cites_a_record`). The skill is 0.25.0: connected agents are asked to update it, and
  to start a new session for the new actions.

## v0.9.0

- **Azure operators:** review every skipped release and run the live Microsoft sign-in
  [preflight](azure.md#upgrade-and-sign-in-preflight) before approving deployment. After it, test
  a fresh browser sign-in at the public/custom URL; report that separately from health checks.

- **Azure operators:** before migrations, verify PostgreSQL backup retention and the restore
  window and record recovery details as described in [the Azure guide](azure.md#deploying-a-new-version).
  Deployment pipelines need read access to the database server and its configured name.

- **Migrations `0020_connection_levels`, `0021_tombstones_per_product` and `0022_mockup_uploads`.**
  The first adds a level to every agent connection; the second re-keys tombstones by product; the
  third adds one table, for mockup canvases uploaded as a ZIP. Rehearse on the dev
  deployment first ([dev-deployment](dev-deployment.md)); going back to an earlier release means
  restoring the database ([recovering from a bad release](recovering-from-a-bad-release.md)),
  though an earlier release also runs on the new schema.
- **Every agent already connected becomes Edit.** It keeps reading, writing and archiving, but
  can no longer delete a source, manage people, or create, archive or change products. Tell the
  admins whose agents do those: they raise the agent to Admin under Connect an agent, or connect it
  again and choose Admin. New connections ask the person which level they want.
- **Editors can no longer delete sources permanently; admins can, and can now also delete
  comments, assumptions, outcomes, Story pages, mockups and whole products.** Nothing to set. An
  editor who deleted sources asks an admin, or archives.
- **An organization's owner can delete the organization**, from its Members page in the web app.
  Nothing to set. It is immediate and can't be undone; a public sandbox can't be deleted.
- **Transcripts read speaker labels with an aside, and timed labels on a line of their own.**
  Nothing to set. `Dana (14:02 UTC): words` is now a turn by Dana, and in plain text and Markdown a
  transcript whose turns start with `**Dana** (14:02 UTC):` or `[14:02] Dana:` alone on a line gives
  each paragraph below it Dana as its speaker. Sources already parsed keep their passages until
  they are parsed again (`derived.rederive`); an agent that rederives one should check the
  citations that rest on it afterwards.
- **`check_citations` reports `valid` when every quote holds in a source's newer file**, and says
  whether a source was parsed again since a snapshot (`rederived`). Nothing to set. A newer file
  not yet parsed still makes it `false`, with `unverified_note`.
- **`files.create_uploads` creates up to 20 sources with a grant each in one call**, and a PUT to
  a grant's own URL now says the file is attached, with no `complete_upload` to follow. Nothing to
  set; `complete_upload` still works, and is still needed after a PUT to a `direct` URL.
- **Citations follow their quote after a source is parsed again.** Nothing to set. A citation's
  link in the app opens where its quote is now, the passages marked as cited move with it, and
  `sources.used_by` gives each citation's current range (`moved_from`, `quote_not_found`). Stored
  citations are not changed.
- **The Story's PDF shows dates in the reader's time zone.** Nothing to set. The print view's dates
  were UTC.
- **The Story's house styles are ten new ones**, listed from the quietest to the loudest: Clear,
  Large, Report, Tonal, Wide, Pastel, Wayfinding, Isotype, Blocks and Riso. Nothing to set.
  Broadsheet, Tufte, Swiss grid and Briefing deck are gone: a product that adopted one keeps its
  copy, and its published pages keep their look, until an agent adopts another style and
  republishes them with `restyle`. The styles name eleven typefaces the image now carries (about
  420 KB), which the server embeds when it shows or prints a page that names one.
- **The skill is now 0.24.0.** Connected agents see the new delete actions, the levels, mockups'
  `request_upload` (upload a canvas as a ZIP instead of sending page HTML) and `files.create_uploads`
  after starting a new session. It also tells them:
  - to give the person times in their own time zone;
  - to keep a page of what waits on the person in the Story;
  - to upload a digest of a session whose findings the team will need;
  - to publish a canvas whole rather than over several versions.
  - which house styles there are and what each is best for, the typefaces WhatBuild carries, and
    the Story vocabulary's new blocks: a timeline that marks where the team is, a flow, a diagram,
    a mockup snippet with numbered pins, a wall of quotations and a tally.

## v0.8.4

- **Shorter interface text throughout the app, the public site and the sign-in emails.** Nothing
  to set. The sign-in page ends with one line on the free preview, linking to Privacy, which now
  opens with the data statement.
- **Behind Cloudflare, deploy the Worker again with this release, and with every release after
  it.** The public site's page is served from the Worker's own build, not the image: until it is
  deployed again, the site keeps the page of the release it was deployed with
  ([releasing](releasing.md)).
- **From v0.7.0 or earlier**, also take v0.8.0's notes below: it adds migration `0019_usage` and
  a log exclusion for Cloud Run.

## v0.8.3

- **Nothing to change.**
- **From v0.7.0 or earlier**, also take v0.8.0's notes below: it adds migration `0019_usage` and
  a log exclusion for Cloud Run.

## v0.8.2

- **The public site's form takes a request from a visitor who has answered the cookie question.**
  Nothing to set. Before, once a visitor had accepted or declined analytics, the form was refused
  with `403 forbidden_origin` ("Cross-origin writes are refused.").
- **From v0.7.0 or earlier**, also take v0.8.0's notes below: it adds migration `0019_usage` and
  a log exclusion for Cloud Run.

## v0.8.1

- **`read_passage` reads a search hit by its `seq`.** Nothing to set. Its refusals now say that
  `start` and `end` count segments, not characters. The skill is now 0.22.0; connected agents see
  the field after starting a new session.
- **From v0.7.0 or earlier**, also take v0.8.0's notes below: it adds migration `0019_usage` and
  a log exclusion for Cloud Run.

## v0.8.0

- **The server counts how it is used.** Migration `0019_usage` adds two tables: counts of calls per
  day, operation, door, agent client and outcome, and each day a person used a part of WhatBuild,
  under a pseudonym derived from `WHATBUILD_GRANT_KEY`. Nothing to set. Rotating the grant key
  starts the pseudonyms afresh, so everyone then shows as new. The instance's owners
  (`WHATBUILD_INSTANCE_OWNERS`) read the report with `products(action="usage")`,
  `GET /api/v1/usage` or `pnpm usage`, and are left out of it unless they ask; a deployment that
  names no owners has nobody who can read it. `/cookies` gains a paragraph saying so. The skill
  is now 0.21.0; connected agents see the action after starting a new session.
- **Cloud Run: drop the platform's log lines that carry a search's words or a link's token.** Cloud
  Run logs every request with its whole address. A deployment set up before this release adds the
  exclusion `deploy/cloud-run/setup.sh` now creates, once:
  `gcloud logging sinks update _Default --project $P --add-exclusion='name=whatbuild-request-addresses,filter=log_id("run.googleapis.com/requests") AND resource.labels.service_name="whatbuild" AND (httpRequest.requestUrl:"?" OR httpRequest.requestUrl:"/invite/" OR httpRequest.requestUrl:"/join/")'`.
  Without it, those addresses stay in the platform's log for its retention (30 days by default).
- **A privacy page.** `/privacy` says what is kept, why, for how long, who handles it and whom to
  ask, linked from sign-in, Settings, Cookies and the site's footer. Set `WHATBUILD_OPERATOR`,
  `WHATBUILD_PRIVACY_CONTACT` and `WHATBUILD_PROVIDERS` ([Cloud Run](cloud-run.md), the Azure
  template); without them the page says the deployment has not named who runs it, how to reach
  them, or its providers.
- **Request logs name organizations, teams and products only by kind**
  (`/api/v1/p/:org/:team/:product/…`, `/mcp/t/:org/…`, `/t/:org/…`). A log query or alert that
  matched a slug in the path stops matching.
- **Google Analytics changes its event names.** A change in the app is named by the operation the
  server ran (`files_fetch_url`, `sources_annotate`), no longer by words from its address
  (`sources_create`, `sources_annotations_create`), so reports across the upgrade see both. Search
  sends `search_open`, `search_result_open`, `search_all_results`, `search_recent_use` and
  `search_close`, and redirects are no longer page views. The instance's owners, and visits on any
  address but the deployment's own (Cloud Run's run.app address), are no longer measured. A
  deployment that uses Google Analytics turns site search off in enhanced measurement and adds the
  event-scoped custom dimensions `kind`, `from`, `via`, `found` and `rank`
  ([analytics](analytics.md)).

## v0.7.0

- **Owners and admins see who changed access.** Members has a new section, Access changes, listing
  roles given, changed and removed, invitations sent, accepted and cancelled, and in a public
  sandbox its invitation links, removed visitors and changed settings. Agents read the same log
  with `members(action="activity")`; connected agents see the new action after starting a new
  session. Events from before the upgrade are included. The skill is now 0.19.0.
- **In a public sandbox, access events name a visitor by their made-up name.** Events recorded
  before the upgrade keep the name they were written with. A change to the sandbox's settings is
  named as its control panel names it, with the new value ("what visitors may do (read only)");
  changes recorded before the upgrade keep the setting's internal name.
- **One search for the whole product.** People search everything in a product from the panel's
  Search field, ⌘K or `/`, as they type, and the Search screen lists results under Idea, Evidence,
  Exploration and Story. Evidence's panel no longer has its own passages-or-titles search; links to
  `/search` with the old `mode` or `scope` open the new screen with the same words. Agents get
  `search`'s new `plain` mode; the skill is now 0.20.0. Nothing to configure.

## v0.6.0

- **Story readers** are given only the Story's live pages: `story.list_pages` leaves archived
  pages out for a reader even with `include_archived`, and `story.get_page`, `list_versions`,
  `get_version`, a version's HTML and the print view answer a reader `404` for an archived page.
  The team still reads them. A reader no longer sees the Story's Archived pages group.
- **Connected agents keep the tool list they connected with.** The MCP endpoint keeps no session,
  so it cannot tell a client that a release added tools or actions. After a release that adds
  any, people whose agents were already connected start a new session (in Claude Code, a new
  conversation or a restart) to see them; authorizing again is not enough. The skill, now 0.18.0,
  tells agents this, and `unknown_tool` and `unknown_action` say it and name the server's version.
- **Input refusals** (`422 invalid_input`) name the unrecognized fields first, with the likely
  intended field, then what is missing ("`notes` is required"), in place of the validation
  library's wording. A script that matched the old text ("unknown field(s)", "Invalid input")
  needs the new. `story.write_notes` also accepts `content` for `notes`.

## v0.5.0

- **Insights and decisions** are retired into Evidence. Migration 0015 queues a job per product
  that moves each insight and decision into a Markdown source with the same id; the worker must
  run to finish it, and until it has, a product's insights and decisions are not in Evidence. Their operations and MCP tools are gone,
  so an agent or script that calls them is refused; old app links open the moved source.
- **Sources** are described by a title and tags. Migration 0017 turns each source's kind and
  organization into tags and drops both, and rewrites saved sandbox baselines the same way. A call
  that still sends `kind`, `organization` or `folder` gets a `422` with a hint to use tags, and
  `sources.kinds` is replaced by `sources.facets`.
- **The skill** is at 0.17.0. Connected agents that installed an earlier one are told to update it
  by the server's instructions; until they do, they may still send kinds or call retired tools.
- **`assumptions.list`** without `status` returns only current assumptions (unconfirmed and
  confirmed), matching the counts, with `not_current_hidden` for the refuted and superseded ones
  it left out. A script or agent that relied on the old default to see every status passes
  `status` (all four) instead.
- **Stage counts** are additive: beside Idea, Evidence, Exploration and Story the app shows every
  item the stage holds, so Exploration counts mockups and current assumptions together.
  `products.get` and `products.list` return these totals as `stage_counts`, beside the per-kind
  `counts`, which are unchanged.
- **The web app** answers "who is signed in" from `GET /auth/session`, which says `signed_in:
  false` with a `200` instead of a `401`, so a signed-out visitor's browser logs no error.
  `GET /api/v1/me` still refuses without a session. Signing out, or a session ending, also clears
  the last product, Story positions, focus choice and other per-person display state kept in the
  browser.
- **`story.get_hierarchy`** returns pages not yet placed only in `unplaced`, now a list of
  `{page_id, title, description}`, and no longer also at the end of `items`; `set_hierarchy`
  accepts `items` as `get_hierarchy` returns them. A script that read `unplaced` as a list of ids,
  or that relied on sending `items` back to place every page, places those pages itself.
- **The public sandbox:** `sandbox.status` gives `you.role` as `member` (not `visitor`) to someone
  its staff gave a role, who is still treated as a visitor is, and its notice says who sees what
  each person adds; an agent or script that read `role` as only `visitor` or `staff` meets the
  third value. `members.list` no longer lists a visitor whom staff also gave a role on a team or
  product. The limits table labels the two limits on all visitors together `Writes` and
  `Uploads`, counted over "All visitors together, each day".
- **The public sandbox:** an action whose daily allowance is 0 (exports by default, or any of
  `writes_per_day`, `sources_per_day`, `bytes_per_day` and the two limits on all visitors together
  set to 0) is refused with `403 sandbox_restricted`, saying it is off for visitors, instead of
  `409 quota_exceeded` with a time it starts again. An agent or script that waited for
  `resets_at` on such a refusal stops instead. `sandbox.status` gives a member who reads only the
  Story `you.story_only: true`, `appears_as: null` and a notice that says they read the Story and
  write nothing.
- **Activity:** a parse event's summary reads "Parsed notes.md into 5 passages", without the
  parser's name and version it used to end with, and `activity.list` reads earlier ones the same
  way. A script that read the parser from the summary reads it from the derivation's manifest
  (`derived.manifest`) instead.
- **`members.list`** answers `403` to someone who reads only the Story in an organization (a
  reader everywhere they hold a role there), and the app hides Members from them.
- **Microsoft sign-in** accepts an address only when Microsoft marks its domain verified (the
  `xms_edov` claim) or the domain is listed in `WHATBUILD_MICROSOFT_DOMAINS`. A deployment with
  Microsoft sign-in adds the claim to its app registration, or sets the variable, before taking
  this release; otherwise every Microsoft sign-in is refused. The command is in
  [Azure](azure.md), "Sign-in".
- **`NODE_ENV`**: only `development` and `test` give development behaviour (one-click sign-in, a
  public grant key). A server started with any other value, or none, is production and needs
  `WHATBUILD_GRANT_KEY`, a mailer of `smtp` or `none`, and a database role without `BYPASSRLS`.
  The image sets `NODE_ENV=production`, so a deployment of the image changes nothing.
- **`WHATBUILD_MAILER`** must be `smtp` or `none` in production; an unknown value stops the server
  at start-up.
- **Parsing** runs in a thread per file, held to `WHATBUILD_PARSE_MEMORY_MB` (384) and
  `WHATBUILD_PARSE_TIMEOUT_SECONDS` (120); the defaults suit a 1 GiB instance. A deployment with
  more memory may raise the first ([Cloud Run](cloud-run.md), [Azure](azure.md)). Files that
  exceed a limit are recorded as failed, with the limit named.
- **Sign-in links** open a page with a **Sign in** button; the link is used when it is pressed, so
  mail scanners no longer use it up.
- **Sessions** move to the `__Host-wb_session` cookie over HTTPS as they are used; nobody is
  signed out. An agent's consent form that is open while the release deploys is refused once and
  is started again from the agent.
- **The public site's headers** live in the Cloudflare Worker too (`deploy/cloudflare/worker.js`):
  deploy the Worker when this release reaches production ([Cloud Run](cloud-run.md)), so the site
  sends the same headers as the app.
- **Node 22.18 or later** for anyone running the server outside the image (the image runs 24).
- **Responses** now carry `Cross-Origin-Embedder-Policy: credentialless`,
  `Cross-Origin-Resource-Policy: same-origin` and a `Permissions-Policy`, so another site can no
  longer load WhatBuild's files or images directly. `/mcp` takes bodies up to 5 MB.
- **Agent registrations** (`/oauth/register`) are limited for the whole deployment; request
  bodies under `/auth` and `/oauth` are limited to 64 KB.
