---
type: Guide
title: Keeping the Playbook and the product tidy
description: How agents keep this Playbook short and true without asking, and how they propose archiving what the product no longer needs.
applies_to: [all]
tags: [playbook, housekeeping, curation]
status: stable
generated: {by: whatbuild/starter, at: 2026-11-20}
---

# Housekeeping

There are two kinds, with different rules. In this Playbook, agents act. In the product's material,
agents archive and people delete.

`playbook_read(action="housekeeping")` gives the candidates for both: files past their `stale_after`,
drafts nobody has touched, files whose links lead to something archived or gone, and the product's
sources, mockups, outcomes and Story pages that have not changed in a while and that no file links
to. They are candidates, not verdicts: WhatBuild does not know what people have read, only what they
changed and what the Playbook links to.

## In this Playbook: keep a tight ship

This is where agents have the most freedom. A long, stale Playbook is read by nobody, so keep it short
and true without asking first:

- Rewrite [`product/now.md`](/product/now.md) when it is out of date, and keep it to a screen.
- Merge files that say the same thing; remove files that are no longer true.
- Mend or remove links to what was archived or deleted.
- Check a file past its `stale_after`: move the day on if it still holds, change it, or remove it.
- Finish or remove drafts.
- Keep each kit's `README.md` true to its files and to who uses it, and remove kits nobody uses.
- Keep `people` true: take a person out of it when their page no longer names the file, and a file
  that names nobody who still works on the product is a candidate to remove.
- Reason over the lessons ([how](/how-to/lessons.md)).

Every removal keeps the file's history, and `playbook_write(action="restore")` brings it back, so a
mistake costs little. Give each change a `message` saying why. Tell your person in a sentence or
two what you tidied when you are done; they need not approve it first.

## In the product: archive, tell, and let people delete

Material that was finished, superseded or never used makes the product harder to read: a sources
list with three versions of one interview, a mockup nobody will open again, a Story page for a
decision long since made.

- **Archive** what is clearly done with: a source superseded by a newer one, a mockup whose idea
  was dropped, an outcome the team gave up. Archiving is undone by restoring, and archived things
  leave the lists people read.
- **Tell your person** what you archived and why, with links, in a sentence each. When you are
  unsure, propose it instead, and archive only once they agree.
- **Never delete.** Deleting is for good, and it is a person's call: they delete in the web app, or
  ask their agent to, with an admin connection, once they have seen what goes.
- **When people say no**, write it down (a line in [`product/now.md`](/product/now.md), or a
  lesson), so no agent proposes it again.

## When

At the end of a piece of work, tidy what it touched. When `playbook_read(action="housekeeping")` lists
anything, take a few minutes on it. When you write a lesson, read the ones beside it.

If the team wants this done differently, change this file: it is what every agent here follows.
