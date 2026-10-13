---
type: Decision
title: Archive is the reversible default; delete is permanent, guarded, and an admin's
description: Everything archivable can also be deleted, by an admin, after a preview; an organization by its owner, in the web app only.
tags: [decision, lifecycle, safety, roles]
generated: {by: agent:claude, at: 2026-10-12}
status: stable
---

# Archive is the reversible default; delete is permanent, guarded, and an admin's

## Context

Evidence is cited long after it is added, so losing it silently breaks conclusions. People also
upload the wrong thing and are entitled to have it gone, and sooner or later want to clear out
whole products and organizations. Delete first shipped for sources alone, to editors. The
maintainer chose on 2026-10-12 to give it to admins, for everything that can be archived, and to
let an organization's owner delete the organization.

## Decision

- Archiving hides an object from lists and search and makes it read-only; it keeps everything and
  can be restored. Editors archive.
- Deleting is permanent at once and is an admin's: sources, comments, assumptions, outcomes, Story
  pages, mockups and whole products. Editors no longer delete sources.
- Every delete needs an explicit call after its preview, the object's etag, a reason and the exact
  words `delete permanently`, and leaves a tombstone. A product or organization is also named.
- Deleting an organization is its owner's, in the web app only, never through an agent; a public
  sandbox can't be deleted.
- Rejected: a grace period for an organization, until undelete exists; a separate delete
  permission beside the roles.
- The interface never calls archiving deleting.

## Consequences

- Citations to archived sources report `source archived`; to deleted ones `record_deleted`, with
  their quotes kept.
- An agent deletes only for an admin who connected it at Admin
  ([decision](an-agent-connection-has-a-level-the-person-chooses.md)).
- Nothing deleted can be put back from the product until undelete is built.

## Constrains

- Destructive operations require their guard (`packages/core/src/deletion.ts`); keep the
  vocabulary exact.

Specified in: [09-data-lifecycle](../spec/09-data-lifecycle.md).
