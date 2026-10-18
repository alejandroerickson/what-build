---
type: Process
title: What a deployment must do when it takes a release
description: The changes a release asks of the people who run a deployment (settings, app registrations, behaviour they will notice), kept per release, with the unreleased ones on top until the next release carries them into its notes.
tags: [operations, releases, upgrading, self-hosting, configuration]
generated: {by: agent:claude, at: 2026-10-18}
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

- **Migration `0031_summaries_and_notes_have_etags`.** It gives every source's summary and notes
  (`agent_notes`) an etag of its own, live and in saved sandbox baselines. Nothing is dropped and
  no text changes, and an earlier release runs on the new schema (the column has a default), so
  going back needs no restore. The earlier release's `derived(action="write_note")` replaces a
  summary or notes without changing its etag, though: after going back and forward again, an etag
  read before going back can still match a summary or notes changed in between, and a write with it
  goes through. Rehearse on the dev deployment first, as for every release that migrates
  ([dev-deployment](dev-deployment.md)).
- **Agents and integrations must send an etag they could leave out before.** Once a source has a
  summary, notes or a derived text, `derived(action="write_note")` and
  `derived(action="write_text")` refuse a write or a clearing without its current etag
  (`409 stale_etag`, with `current_etag`); a first write still takes none. `read_note`,
  `write_note` and `sources(action="get", detail="full")` (in `agent_notes`) give the etags of the
  summary and the notes, and `derived(action="text")` and `text.etag` the text's. An integration
  that rewrote these without reading first is refused until it reads, then passes the etag.
  People will notice that saving a summary, notes or text someone else changed meanwhile shows
  their version, and saves over it only when asked.
- **Nothing runs by itself; existing plain-text and workbook attachments read better once read
  again.** A `.txt` now keeps its lines and list markers, joining only hard-wrapped prose, and ends
  a quoted message before the reply under it; an `.xlsx` reads values as the sheet shows them
  (`+14.0%`, not `0.14`), reads and marks hidden sheets, columns and rows and a value other than
  zero that its format shows as nothing (a zero shown as nothing stays a blank), and says when a
  formula was saved without its value (plain-text parser 8, XLSX 6). A reading made earlier keeps
  its layout until its attachment is read again, with `derived(action="rederive")` or Read it again
  in the web app; a source whose text still follows that attachment then takes the new text, and a
  text someone wrote or edited is left alone. Left unread, those sources read and are found as
  before. Nothing else needs reading again: a scan recorded as failed reads `unsupported`, a
  recording that asked for "a transcript as a new source" asks for another attachment, and an image
  says how an agent gives it its words, in sandbox baselines too.
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
  scope shows over MCP.
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
- **Nothing to change; people will notice they can archive a comment in the web app.** An editor
  archives a comment from its menu, saying why if they like, and restores it from the archived
  comments a source's Comments list on request; a comment's delete dialog offers Archive
  instead, and every delete dialog has Cancel.
- **The skill is 0.33.0.** Connected agents are asked to update their installed skill. It tells
  them which etag a source's summary, notes and text take, how search matches and pages, how a
  source's text is chosen and laid out, what an image or a scan needs, how to restore what was
  archived, and, with the server's instructions, which installed copy to follow when there are
  several. Nothing needs a new session: the new fields go through actions every client already
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
  ([mail](mail.md#the-feedback-digest)). Production sets it to the maintainer's address from
  `.env`. Without it nothing changes: feedback stays in the database.
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
