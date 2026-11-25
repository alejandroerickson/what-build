---
title: Each mockup and Story page keeps its newest versions, as many as the plan says, and the mockup versions a Story page shows
organizations: [synthetic]
people: [casey, morgan, avery, riley]
surfaces: [web, mcp]
---

# The versions a mockup and a Story page keep

Each mockup and each Story page keeps only its newest versions, as many as the organization's plan
says (`mockup_versions_max`, `story_page_versions_max`), and a mockup also keeps every version a
Story page version shows. Publishing past the number deletes the oldest, refusing nothing; a
deleted version's number is never used again, and reading it says it was deleted. This plan
publishes past both numbers through MCP and checks what each door then shows, what the activity log
records and what delete dialogs count, and that a plan keeping fewer trims at the next version.

It runs in the synthetic organization's Crewboard, whose content is made up. Casey (editor) publishes
over MCP and in the web app, Morgan (owner) opens the delete dialogs, Avery reads the Story, and
Riley owns this WhatBuild. Pages it publishes are a line of synthetic HTML each, such as
`<h1>Version 7</h1>`, written into the run's folder. Below, **M** is the mockup step 2 makes and **P**
the Story page that shows it. Free keeps 5 of each and Pro 10 in `deploy/plans.example.json`, which the
end-to-end instance offers; the unlimited plan keeps 10.

## Steps

1. **MCP, as Casey, in the synthetic organization.** `products_read(action="limits")` for Crewboard.
   *Expect:* `plan` names the organization's plan; among `limits`, `mockup_versions_max` and
   `story_page_versions_max`, each a whole number of at least 1 (10 on Pro or unlimited, 5 on Free).
   Write down the plan, and call the two numbers **N** and **S**; every number below follows from
   them. If the plan is Free, step 9 has nothing to show: leave it out and say so.
2. **MCP, then web, as Casey.** Create M with `mockups_write(action="publish")`: a title, a brief and
   one page. *Expect:* `current_version` 1. In the web app, open M in Exploration and use **Promote
   canvas to Story** from its inspector. *Expect:* a new Story page, P, showing M's canvas as it is in
   version 1; M's inspector names P and version 1.
3. **MCP, as Casey.** Publish M's next versions, one at a time, changing the page's heading each time,
   up to version N + 1. *Expect:* no answer has `versions_deleted`: M then holds N + 1 versions, but
   version 1 is the one P shows. Publish version N + 2. *Expect:* `versions_deleted: [2]` and
   `versions_kept: N`. Publish version N + 3. *Expect:* `versions_deleted: [3]`, `versions_kept: N`,
   and `current_version` N + 3: numbers go on from the newest. `mockups_read(action="list_versions")`.
   *Expect:* `versions_kept` N, and the versions N + 3 down to 4, then 1: N + 1 of them, with 2 and 3
   missing.
4. **MCP, as Casey.** `mockups_read(action="get_version")` for M's version 2. *Expect:* `410
   version_deleted`, its message saying the organization's plan keeps each mockup's newest versions,
   and those a Story page shows, and naming the versions it keeps ("It keeps versions 1 and 4 to
   N + 3"); its details `version: 2` and `versions_kept` listing 1 and 4 to N + 3. Version 1 reads.
   Version N + 8 answers `404`, with the same `versions_kept`. Publish M with `from_version: 2`.
   *Expect:* `410 version_deleted`, and `current_version` stays N + 3.
   **Web, as Casey.** Open M's address with `?v=2`. *Expect:* a notice "Version 2 was deleted", saying
   the organization's plan keeps only each mockup's newest versions and those a Story page shows,
   with **Show the current version**; nothing on the screen keeps loading: the canvas is empty, and
   the inspector shows the current version, N + 3. With `?v=` N + 8: "This mockup has no version
   N + 8", and again nothing keeps loading. Press Show the current version. *Expect:* version N + 3
   draws, and the address loses `?v=`. In the inspector's Version list, versions 2 and 3 are not
   offered, and 1 is.
5. **MCP, as Casey.** `activity_read(action="list")` with `entity_type: "mockup"` and M's id.
   *Expect:* two `versions_deleted` entries by Casey through MCP, newest first: "Deleted version 3:
   the organization's plan keeps each mockup's newest N, and those a Story page shows", then the same
   for version 2, each after the publish that made it. **Web, as Casey.** Open the product's
   Activity. *Expect:* each says Casey deleted earlier versions of M, with the same sentence.
6. **Web, as Casey.** M's inspector. *Expect:* it says "Keeps the newest N versions, and any a Story
   page shows." **Web, as Morgan.** From M's menu, choose Delete permanently. *Expect:* the dialog
   says a Story page shows this mockup and to delete that page first, linking P; no reason is
   asked, and Delete permanently stays disabled. Close it. **MCP, as Morgan.**
   `mockups_read(action="delete_impact")` for M. *Expect:* `version_count` N + 1, the versions M holds
   rather than its newest number; `story_pages_showing` names P; `after_delete` says a Story page
   shows it, to delete that page or publish it with HTML of its own first. Delete nothing.
7. **MCP, as Casey.** Publish P's next versions with `story_write(action="publish")`, each a `body`
   of its own, up to version S. *Expect:* none has `versions_deleted`. Then show M's current version
   on P: `story_write(action="promote_mockup")` with M, P's `page_id` and its etag. *Expect:* P's
   version S + 1, with `versions_deleted: [1]` and `versions_kept: S`. M's `list_versions` no
   longer has version 1, which only P's deleted first version showed: N + 3 down to 4, N of them.
   Publish P once more with a body of its own. *Expect:* version S + 2, `versions_deleted: [2]`.
   `story_read(action="list_versions")` for P. *Expect:* `versions_kept` S, and S + 2 down to 3.
   `story_read(action="get_version")` for version 1. *Expect:* `410 version_deleted`, with
   `versions_kept` listing 3 to S + 2. `activity_read(action="list")`. *Expect:* P has two
   `versions_deleted` entries ("Deleted version 1: the organization's plan keeps each Story page's
   newest S", and the same for 2), and M one more: "Deleted version 1: the organization's plan keeps
   each mockup's newest N", with no clause about the Story.
   **Web, as Casey.** Open P with `?v=1`. *Expect:* "Version 1 was deleted", saying the
   organization's plan keeps only each Story page's newest versions, with Show the current version;
   no page is drawn and nothing keeps loading, and the inspector shows the current version's About.
   With `?v=` S + 9: "This page has no version S + 9" and "Its newest is version S + 2." Without
   `?v=`, P's About says "Keeps the newest S versions." **Web, as Avery.** Open P. *Expect:* its
   About says nothing of the versions kept.
8. **Web, as Morgan.** From M's menu, choose Delete permanently. *Expect:* now that no current Story
   page shows it, the dialog says it deletes M "with all N of its versions" (the versions it holds,
   not N + 3), and that an earlier version of a Story page shows it, and will show an empty page.
   Cancel. From P's menu in the Story, choose Delete permanently. *Expect:* it deletes P "with all S
   of its versions and its notes". Cancel. **MCP, as Morgan.** `mockups_read(action="delete_impact")`
   for M and `story_read(action="delete_page_impact")` for P. *Expect:* M's `version_count` N,
   `story_pages_showing` empty, `earlier_story_versions_showing` naming P's version S + 1, and
   `after_delete` "Every version (N) goes, …" with the sentence about the earlier Story page version;
   P's `version_count` S and `after_delete` beginning "Every version of the page (S) goes". Delete
   nothing: M and P go with the instance when it is next served.
9. **Web, as Riley.** In Instance admin → Organizations, open Change plan for the synthetic
   organization and move it to Free. **MCP, as Casey.** `products_read(action="limits")`. *Expect:*
   `plan` free, `mockup_versions_max` 5 and `story_page_versions_max` 5. Nothing has changed yet:
   M's `list_versions` still lists N versions, with `versions_kept` 5. Publish M's next version.
   *Expect:* `versions_deleted` lists every version but the newest 5 and those a Story page shows
   (P's version S + 1 shows N + 3, which is among the newest), oldest first, with `versions_kept: 5`;
   `list_versions` then lists N + 4 down to N, five of them. Publish P with a body of its own.
   *Expect:* `versions_deleted` lists P's versions 3 to S - 2, `versions_kept: 5`. The activity log
   says each mockup's newest 5 and each Story page's newest 5. **Web, as Casey.** M's inspector says
   "Keeps the newest 5 versions, and any a Story page shows."
10. **Web, as Riley.** In Instance admin → Plans, Edit Free. Type 0 in Versions of a mockup, then in
    Versions of a Story page. *Expect:* Save stays disabled for each. Tick that row's No limit and
    untick it. *Expect:* the field comes back as 1, the least it takes. Cancel, and check that Free
    still says 5 of each. Then, in Organizations, move the synthetic organization back to the plan
    step 1 read.

## Look out for

- A version past the number that is neither deleted nor named in `versions_deleted`, or a version a
  Story page shows that is deleted while that Story version stands.
- A number used twice: a new version taking a deleted one's number.
- A screen left loading after the version asked for failed to load, on the mockup or the Story.
- A delete dialog, or `delete_impact`, that counts the newest number rather than the versions held.
- The versions kept shown to a Story reader, or a trim recorded without the plan's number.
