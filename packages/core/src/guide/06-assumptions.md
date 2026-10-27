# Assumptions

The assumption register: what an entry holds, reviews and what they freeze, superseding, links, and listing.

## Entries

An **assumption** is a premise the team treats as true while evidence is incomplete. Creating one
does not record agreement: a new entry starts `unconfirmed`.

- `statement` is the premise; `body` (Markdown) says why the team holds it. An entry may rest on no
  evidence yet. An older entry's body may end with **Passages cited**, quotes kept from when entries
  cited passages.
- `outcome_ids` links the entry to the outcomes it bears on; `tags` label it. Both, and `links`,
  replace the whole list when sent to `assumptions_write(action="update")`.
- `assumptions_write(action="link")` and `unlink` add or remove one typed link to another entry
  (`supports`, `contradicts` or `supersedes`), with the entry's etag.

## Who exercised judgment

`author_type` (on an entry) and `reviewer_type` (on a review) record whether a human or an agent made
the judgment. Over MCP both default to `agent`; `human` records a judgment the person made
themselves, relayed by the agent. `confidence` (low, medium, high) is a human's view of whether the
entry is suitable for current work, not of whether it is true. It is accepted only with
`reviewer_type: "human"` (otherwise `confidence_requires_human`).

## Reviews

`assumptions_write(action="review")` records an attributed review: a status (`unconfirmed`,
`confirmed`, `refuted` or `superseded`), a required note, and optionally a human's confidence. Any
review may move the status anywhere; a review with the current status records confidence alone.
Reviews are never edited: a changed mind is a new review.

**Any review freezes the statement and body for good**, by a person or an agent, whatever the status,
even one that keeps it `unconfirmed`. Edits (`update`, `edits` included) are made before the first
review. After it, `assumptions_write(action="supersede")` corrects an entry: it records a new entry
that supersedes the old one, and takes `reviewer_type` (and `author_type` for the new entry) as
`review` does.

## Listing

`assumptions_read(action="list")` returns the current entries (unconfirmed and confirmed), the ones a
product's counts count, newest first. `not_current_hidden` says how many refuted or superseded entries
it left out; `status` lists those too. It also filters by `outcome_id`, `tag`, `human_confidence` and
`query`, and leaves archived entries out unless `include_archived`. Each item says whether it is
`frozen`, which entries supersede it (`superseded_by`), and how many links it has out and in;
`assumptions_read(action="get")` returns the body, the links and the reviews.
