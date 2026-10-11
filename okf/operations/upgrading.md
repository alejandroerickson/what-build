---
type: Process
title: What a deployment must do when it takes a release
description: The changes a release asks of the people who run a deployment (settings, app registrations, behaviour they will notice), kept per release, with the unreleased ones on top until the next release carries them into its notes.
tags: [operations, releases, upgrading, self-hosting, configuration]
generated: {by: agent:claude, at: 2026-10-10}
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

- **Owners and admins see who changed access.** Members has a new section, Access changes, listing
  roles given, changed and removed, invitations sent, accepted and cancelled, and in a public
  sandbox its invitation links, removed visitors and changed settings. Agents read the same log
  with `members(action="activity")`; connected agents see the new action after starting a new
  session. Events from before the upgrade are included. The skill is now 0.19.0.
- **In a public sandbox, access events name a visitor by their made-up name.** Events recorded
  before the upgrade keep the name they were written with.

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
