---
type: Process
title: What a deployment must do when it takes a release
description: The changes a release asks of the people who run a deployment (settings, app registrations, behaviour they will notice), kept per release, with the unreleased ones on top until the next release carries them into its notes.
tags: [operations, releases, upgrading, self-hosting, configuration]
generated: {by: agent:claude, at: 2026-10-14}
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

- **Migration `0024_story_previews`.** It adds one table, for the documents `story.preview`
  holds for half an hour. Rehearse on the dev deployment first ([dev-deployment](dev-deployment.md));
  an earlier release also runs on the new schema, which only adds a table.
- **Agents can preview a Story page before publishing it.** Nothing to set. `story(action="preview")`
  takes what `publish` takes, refuses what it would refuse, publishes nothing and returns a grant to
  open the exact page in a browser.
- **The skill is 0.26.0.** It teaches previewing a Story page before publishing it, which writes
  are safe to send again after a lost response, and the HTML rules a mockup page now has of its
  own (forms whose submissions go nowhere, scripts without a budget, a page that scrolls past its
  height, the mockup quota). Nothing to set: connected agents are asked to update it, and to start
  a new session for the new action.

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
