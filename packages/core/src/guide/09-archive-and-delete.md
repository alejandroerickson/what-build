# Archive and delete

Archiving and restoring each kind of object, what an archived source refuses, and the guards on a permanent delete.

## Archive

Archiving is reversible: it takes a source, comment, assumption, outcome, mockup or Story page out of
lists and out of search, and erases nothing. Each comes back the same way it went:

| Object | Archive | Restore |
|---|---|---|
| source | `sources_write(action="archive")`, by `record_ids` | `sources_write(action="restore")`, by `record_ids` |
| comment | `sources_write(action="update_annotation")` with `archived: true` (and an optional `archive_reason`) | `update_annotation` with `archived: false` |
| assumption | `assumptions_write(action="archive", archived: true)` | `assumptions_write(action="archive", archived: false)` |
| outcome | `outcomes_write(action="archive")` | `outcomes_write(action="restore")` |
| mockup | `mockups_write(action="archive")` | `mockups_write(action="restore")` |
| Story page | `story_write(action="archive_page")` | `story_write(action="restore_page")` |
| product | `products_write(action="archive")` | `products_write(action="restore")` |

An archived source is read-only: any change to its title, date, tags, text, summary, notes,
attachments or comments is refused with `409 record_archived` until it is restored.

## Permanent delete

A permanent delete cannot be undone. It needs the admin role and an Admin connection, so the `_delete`
tools are offered only then. Each delete has an impact read that changes nothing and says exactly what
would be destroyed (attachments and their versions, page or mockup versions, comments, reviews,
links):

| Object | Impact | Delete |
|---|---|---|
| source | `sources_read(action="delete_impact")` | `sources_delete(action="delete")` |
| assumption | `assumptions_read(action="delete_impact")` | `assumptions_delete(action="delete")` |
| outcome | `outcomes_read(action="delete_impact")` | `outcomes_delete(action="delete")` |
| mockup | `mockups_read(action="delete_impact")` | `mockups_delete(action="delete")` |
| Story page | `story_read(action="delete_page_impact")` | `story_delete(action="delete_page")` |
| product | `products_read(action="delete_impact")` | `products_delete(action="delete")` |
| comment | none: `sources_read(action="list_annotations")` shows it | `sources_delete(action="delete_annotation")` |

The server refuses a delete without its three guards:

- the impact's `etag` (a comment's own) as `expected_etag`: a stale one is refused, so a delete
  destroys only what its impact showed;
- a `reason`, in the person's words, recorded on the tombstone;
- `confirm` set to exactly `"delete permanently"` (otherwise `confirmation_required`).

A whole product also takes its `name`, typed exactly. A mockup cannot be deleted while a Story page
shows it. An export (`products_export(action="export")`) keeps a copy of a product first.

A deleted object leaves a tombstone: reading it answers `410` with who deleted it, when and why.
Deleting an organization is its owner's act in the web app, and no tool offers it.
