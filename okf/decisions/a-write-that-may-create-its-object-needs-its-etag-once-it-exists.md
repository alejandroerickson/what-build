---
type: Decision
title: A write that may create what it writes takes no etag the first time, and the current etag once it exists
description: A source's summary, notes and derived text, a Story page's versions and notes, the Story's style and hierarchy, a mockup's versions and an organization allowance are written without an etag only while there is none, so two writers never overwrite each other unseen.
tags: [decision, concurrency, etags, sources, story, mockups, mcp, api]
generated: {by: agent:claude, at: 2026-10-18}
status: stable
---

# A write that may create what it writes takes no etag the first time, and the current etag once it exists

## Context

Every update names the current etag ([§4.1](../spec/04-data-model.md)), but some writes create
what they write when there is none yet: a source's summary, notes and derived text, a Story page's
next version and its notes, the Story's style and hierarchy, a mockup's next version, an allowance
to create organizations. Before the object exists there is no etag to read. The Story's writes,
mockups and allowances already took the etag once their object existed; a source's summary and
notes took none, and its derived text took one only if sent, so a person and an agent editing the
same one overwrote each other without knowing, and nothing keeps their earlier words. The
maintainer chose on 2026-10-18 that they follow the same rule.

## Decision

- The first write takes no etag. Once the object exists, a write without one, or with a stale one,
  is `409 stale_etag` with `details.current_etag`, and its message says which etag to pass and
  where to read it. Clearing or removing is a write like any other.
- A missing etag there is `409`, not the `422` of an update without one: the same call was right
  while there was nothing, and what changed is the object, not the call.
- Where an object's etag sits beside another's (a source's summary, notes and derived text beside
  the source's; a Story page's notes beside the page's), sending the wrong one is recognised and
  named.
- An etag sent while there is nothing to match, before the first write or once a source's
  summary, notes or derived text was removed, is refused the same way, with
  `current_etag: null`, saying to leave it out for the first write: a caller holding an etag of
  something that is not there has read something else, and is told so rather than written past.
- Rejected: an optional etag, which overwrites silently; an etag always required, with a token for
  "none", which makes an agent read a `404` before every first write.

## Consequences

- Two writers of one summary, notes or text never overwrite each other unseen. The web app shows
  the person the other version, and saves over it only when they ask.
- An agent or integration that rewrote a summary, notes or text without an etag must read it first.

## Constrains

- Every operation that may create what it writes follows the rule, and so does any new one:
  `derived.write_note` and `derived.write_text` (`packages/core/src/ops/derived.ts`),
  `story.publish`, `story.promote_mockup`, `story.write_notes`, `story.set_style`,
  `story.set_hierarchy`, `mockups.publish` and `products.set_tenant_allowance`.
- What such a write fills carries an etag that changes on every write: `agent_notes.etag`
  (migration `0031_summaries_and_notes_have_etags.sql`) and `source_texts.etag` for a source.

Specified in: [04-data-model §4.1 and §4.6](../spec/04-data-model.md), [05-derived-layer §5.4](../spec/05-derived-layer.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app](../spec/07-web-app.md).
