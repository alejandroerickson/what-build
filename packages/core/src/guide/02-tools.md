# How the tools work

How tools are named and called, paging, ids, etags, refusals, retries, missing tools, activity and feedback.

## Read, write and delete tools

Each kind of object has up to three tools, named after it:

- `<kind>_read` changes nothing: lists, reads, impacts, previews, download grants.
- `<kind>_write` creates, changes, archives and restores.
- `<kind>_delete` deletes permanently, and only that.

The kinds are `products`, `members`, `sources`, `attachments`, `derived`, `outcomes`, `assumptions`,
`mockups`, `story` and `activity`. Each of these tools takes `action`, `params` (the action's fields),
`product`, and `describe`. Called with an action, `describe: true` and no params, it returns that
action's exact schema and guidance without running it:

    assumptions_write(action="create", describe=true)
    assumptions_write(action="create", product="acme/core/onboarding", params={"statement": "…"})

`search`, `guide` and `submit_feedback` stand alone: their fields are their arguments, with no
`action`, `params` or `describe`.

An action that acts on an organization or a team (such as `products_read(action="limits")`) takes
`tenant`, and `team`, in params. Naming any product in it with `product` stands for its organization
and team, unless the action takes a product of its own in params. On a scoped connector they default
to the connector's own.

## Paging, ids and times

- A list that pages answers `next_cursor`: pass it back as `cursor` (sources, comments, outcomes,
  assumptions, search, activity). A Story page's or a mockup's versions page by number: pass
  `next_before` back as `before`. Other lists come in one answer.
- An outcome's id is `outcome_id`, an assumption's `id`; each also accepts the other form.
- `story_write(action="write_notes")` takes the notes as `notes`, and also as `content`, the name
  `get_page` returns them under.
- Times in results are UTC (ISO 8601).

## Etags

Changing something that exists takes the `etag` of your last read of it as `expected_etag`. A stale
one is refused with `409 stale_etag` and the `current_etag`.

- A source has four: its own (for `sources_write(action="update")` and `move_to_product`), and one
  each on its derived text, its summary and its notes.
- A write that may create what it writes (a source's summary, notes or text, a Story page's first
  version, the first Story style or hierarchy, a new mockup, an allowance) takes none the first time,
  and refuses one sent then (`409 stale_etag` with `current_etag: null`).
- `tags` sent to `sources_write(action="update")`, `update_annotation` or
  `assumptions_write(action="update")` replaces the whole list, as do an assumption's `outcome_ids`
  and `links`.

## Refusals

A refusal begins with its status code and says what a correct call looks like. Unknown actions and
fields are refused (`422`). An action called in another of its kind's tools (`create` in
`sources_read`) is refused with `422 wrong_tool`, which names the tool it is in. `422 invalid_input` names first the fields it did not recognize (with the
one probably meant), then the missing ones, and ends with "Nothing was changed". A refused call
changed nothing, whatever the refusal.

## Retrying after a lost response

A call that ends without an answer (a transport error, a timeout, a dropped connection) may or may
not have landed.

- A write that passes `expected_etag` can be sent again as it is: if the first landed, the retry is
  refused with `409 stale_etag`, and reading the item shows the change. The same holds for writes
  that take no etag the first time and refuse a second call without one: a source's first summary or
  notes (`derived_write(action="write_note")`) and first derived text (`write_text`), a page's first
  `story_write(action="publish")`, `promote_mockup` with a new `page_id`, `write_notes` on empty
  notes, the first `set_hierarchy` and `set_style`, and `mockups_write(action="publish")` from an
  `upload_id`, since an upload publishes once (`409 upload_used`).
- A write without an etag may make a second object when sent again: creating an outcome, an
  assumption or a source (`sources_write(action="create")`, `attachments_write(action="create_upload")`,
  `create_uploads`), a comment (`annotate`), a copy of a source (`copy_to_product`), a mockup
  (`publish` without `mockup_id` or `upload_id`), a Story page from a mockup (`promote_mockup`
  without `page_id`), and a product, team or organization without a `slug`. The item's list and
  `activity_read(action="list")` show what landed.
- Reads change nothing and can always be repeated, `story_read(action="preview")` and
  `outcomes_read(action="card_preview")` included.

## When a tool or action is missing

A connection is offered only what it may do: what its level allows, and what the person's roles
reach (on a scoped connector, their role inside it; on the unscoped one, their highest role in any
organization they are in, unless they may start an organization of their own). A tool's description
speaks only of the actions it offers. A call to something the connection is not offered is refused
with what it needs (a `403`), never as unknown. What a person does only in the web app (running this
WhatBuild, deleting an organization or an account) is offered to no connection: a call to it is
refused with `403 web_only`, saying where it is.

The server keeps no session, so a client keeps the tool list it got when it connected, and
authorizing again does not refresh it. Every product-scoped answer gives the version the server runs
now as `tools_version` in its `scope`, and `products_read(action="list")` gives it too. When it is
newer than the version the server's instructions named, or a call is answered `unknown_tool` or
`unknown_action`, the client holds an older tool list: a new session (in Claude Code, a new
conversation or a restart) brings the current one. An action missing only from a tool's description
may still work: `describe: true` says.

## Recent changes

`activity_read(action="list")` lists what changed in a product, who changed it, and whether an agent
did it. `by: "people"` is what people did in the app, `by: "agents"` what agents did; WhatBuild's own
work, such as reading an attachment, is in neither. `entity_id` narrows it to one item's history. An
entry names a change, not the item's current state. Changes to roles and invitations belong to the
organization: its owners and admins read them with `members_read(action="activity")`.

## Feedback

`submit_feedback` sends a report about the tools (an issue, a confusing description, an improvement,
a feature request) to the developer of WhatBuild, without the person's name or address. It cannot be
read back and has no reply channel. It should hold no names, secrets or source text. A person and
their agents send at most 10 a day, counted by the UTC day; past that it answers `429 rate_limited`
with when it starts again. The person may turn it off for a connection: it is then missing from the
tool list on purpose, and the server's instructions say so.
