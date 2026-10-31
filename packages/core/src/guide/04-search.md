# Search

The three search modes, what each reads and matches, the shape of a hit, and what an empty result does not prove.

## What search reads

`search` reads what sources say: each source's title, tags, summary, derived text, notes and
comments, never its attachments; and assumptions' statements and bodies. `plain` mode also reads
outcomes, mockups, Story pages and the product concept. Of a mockup page or a Story page it reads
the words a reader sees, an SVG's text among them, never its scripts, styles or markup, up to the
first 200,000 characters of words a page holds. Search is lexical: no mode matches meaning, and
**an empty result does not show that the evidence is absent**.

## Modes

- **Exact** (the default) matches the query as sent, ignoring only case: its spaces, `%` and `_`
  count.
- **`ranked`** takes `"phrases"`, `prefix*`, AND, OR, NOT and parentheses. A number in it finds the
  id it ends (`20734` finds `CB26-20734`).
- **`plain`** searches the whole product the way a person types into the app's search box: sources
  with the best places they say the words, assumptions, outcomes, mockups, Story pages and the
  product concept. It forgives endings and word order, corrects a word that matches nothing
  (`corrections` says so; `strict: true` turns it off), and names `missing` words when nothing holds
  them all. A word naming a kind beside other words (`mockups crew`) is not searched for: that kind
  comes first, and `kind_hint` says so. An id or a number (`CB26-20734`, `2026-05-01`) is one word,
  matched as written and never corrected, and one with a letter in it also as its words side by side
  (`q3-planning` finds "Q3 planning"). The last word matches as a prefix unless the query ends with a
  space. `limit` caps the results (60 by default).

Exact and ranked search take filters; `plain` finds where something is across the product.

## What an answer says

- `coverage` (exact and ranked) says what was examined, and counts by reason the sources with no
  derived text yet (`sources_read(action="list")` gives each source's `derived_status`).
- `search_scope` says whether sources, assumptions or both were searched. `scope`, as in every
  answer, says where the call ran.

## When a search does not finish

A search has 5 seconds, then `503 search_timed_out`; when the server is running as many as it can, it
may answer `503 search_busy`. Neither says anything about the words, and nothing was changed: try
more specific words, or try again in a moment.

## Hits

A hit names its source (`record_id`), the `field` it is in (`title`, `tags`, `summary`, `text`,
`notes`, or `comment` with the comment's `annotation_id`) and where: `char_start` and `char_end` are
code-point offsets into that field.

- In exact search every place the words occur is a hit of its own, and `limit` counts hits: pass
  `next_cursor` back as `cursor` for the rest.
- With `scope: "all"`, assumptions come on the first page only; later pages hold source hits.
- `derived_read(action="text", offset=…)` reads around a hit in the text.
- Each text is matched in pieces of about 1,500 characters, so AND, OR and NOT combine terms within
  one piece: terms that sit far apart in a text may not match together.
