# 7. Web application

This section specifies behavior and information architecture. Visual design, the design system,
and component choices come later and are out of scope.

## 7.1 Principles

- The UI uses only registry operations through the `Client` interface
  ([§2.5](02-architecture.md)). If the UI needs something, it becomes an operation, and agents get
  it too.
- **State that matters lives in the URL**: team, project, screen, filters, search query, selected
  page, passage position. Reload and share always work.
- Every write path handles `409 stale_etag` explicitly: show what changed, keep the person's
  unsaved text, offer reload-and-reapply. Never discard input; never overwrite silently. This is
  no longer a theoretical concern — a teammate or their agent may be editing the same object.
- `409 quota_exceeded` is shown as a fact with a number and a next step, never as a failure of the
  person: "This team has used 1.0 GB of 1.0 GB. Archive a project, or export and remove material."
- Works on narrow screens. Meets WCAG 2.2 AA. Fully keyboard-operable.
- Agents are teammates: attribution in the UI shows who wrote something **and through which
  surface** (for example "Sam · via claude-desktop").

## 7.2 Team and project switching

An account may belong to several teams, and a team holds several discoveries. A person must always
know where they are, and move without losing their place.

Requirements (placement and appearance are a design-phase decision):

1. The current team and project are visible on every project-scoped screen.
2. The project switch is reachable from every screen in one interaction, lists active projects
   (most recently used first), and can create a project and open the full project list.
3. **Switching project keeps the screen**: from Library in project A to Library in project B.
   Sub-view state that cannot transfer (a record id, filters on tags) is dropped.
4. Both are in the URL path (`/t/<team>/p/<project>/…`). Opening a link to another team or project
   simply works, and that pair becomes the remembered one.
5. The last-used team and project are remembered per browser. `/` opens them; with none remembered
   (or the project archived), `/` shows the project list for the last-used team.
6. Archived projects appear only in the full list, behind a filter, read-only with a restore
   action.
7. The team switch is a distinct, rarer control than the project switch, and must not be
   mistakable for it.
8. Project-scoped and team-level chrome must be visually distinct enough that Connect, Members and
   Settings are not mistaken for belonging to one project.

## 7.3 Routes

As built (draft 0.3):

```
/signin  /welcome  /invite/:token             sign-in, first run, accepting an invitation
/                                             the last product this browser used, else the first, else first run
/products                                     every product you can reach, by organization and team; new product
/t/:tenant/members                            people and roles in an organization
/connect                                      connect an agent: MCP URL, the skill, tokens
/account                                      display name, tokens, connected agents

/t/:tenant/:team/:product                     → …/objectives
  /objectives                                 the idea, objectives with counts
  /sources            ?folder&kind&organization&date_from&date_to&query&include_archived
  /sources/new                                kind-first intake
  /sources/:record    ?tab=passages|preview|files|connected|notes &seq=N
  /search             ?q&mode&scope
  /insights           ?objective_id&status&query
  /insights/new  /insights/:id  /insights/:id/edit
  /insights/assumptions[/:id]  /insights/decisions[/:id]
  /story[/:page]      ?v=N
  /activity
  /settings                                   name, slug, archive
```

## 7.4 Sign-up, and the first ten minutes

1. Email address → verification link (in development, printed to the terminal).
2. Name the team. A slug is proposed and shown as it will appear in URLs.
3. Create the first project — name and idea — **or** copy the sample project in one click.
4. Invite colleagues by email or a single-use link. Skippable.
5. A card pointing at **Connect**: paste one endpoint into Claude Desktop or Claude Code, install
   the skill.

The data statement ([§9.1](09-data-lifecycle.md)) is shown at step 1, in full, not behind a link,
and is linked from team settings thereafter.

**Before sign-up**, the public sample project is readable at `/sample` with no account: a
synthetic discovery, fully derived, with real passages, citations, a filled register and a
published Story. It is the product's shop window. It is read-only; every write control is absent, not disabled, except one "copy this into my own team"
call to action.

## 7.5 Objectives

The landing screen. The project's idea at the top; objectives as aligned cards in a centered
content band that adapts to narrow screens. Create, edit inline, reorder, change status. Each card
shows how many insights, assumptions, and decisions point at it, linking into Insights filtered by
that objective. Archived objectives are behind a toggle. An empty project presents this screen as
the first step of the loop: write the idea, then the first objective, then add material.

## 7.6 Library

- **Upload, kind-first.** Step 1 asks what the material *is* (kinds grouped as in
  [§4.4](04-data-model.md), in plain language). Step 2 asks for title, the **event date** (with
  help text distinguishing it from today), and optional metadata relevant to that kind. Step 3
  takes files and assigns roles with sensible defaults (a transcript beside a recording becomes
  primary). The person never sees or chooses a folder. Multi-file drag-and-drop is supported;
  progress and derivation status are shown until `ready` or a terminal status with a
  plain-language explanation and next step (`needs_transcript` → "add a transcript"). Remaining
  storage is shown before the upload starts, not after it fails.
- **Browse.** Filters held in the URL: folder, kind, organization, date range, tags, title
  substring, archived. Sort by date or added time. Paged.
- **Record page.** Metadata (editable, including kind — "reorganize" — without any mention of
  paths); the derived outline as navigation; file entries with role, version history, preview for
  browser-supported formats, download for the rest; archive, restore, and delete (§7.10).
- **Passage reader.** Paged segments with speaker and cue time; jump to a timestamp or segment
  number; the URL tracks position; where a playable recording exists, a cue seeks the player.
  Selecting a range offers: annotate, copy a citation reference, start an assumption or decision
  cited to it.
- **Annotations** are shown beside their passages and listed per record.
- **Insights tab** per record: insights referencing it, and assumptions and decisions citing it,
  each citation linking to its exact passage.
- **Search.** Same filters plus free-text passage search; results are passages in context with
  speaker and time, linking into the reader at that position. The UI states what was searched
  ([§8.4](08-search.md)).

## 7.7 Insights

- **Insight documents:** list with status, summary, and reference counts; a reader with rendered
  Markdown; an editor with preview and a reference picker for objectives, records, insights,
  assumptions, decisions; explicit publish and unpublish.
- **Revision history** ([§4.1](04-data-model.md)): a list of revisions with author, surface and
  time; a read-only view of any revision; a diff against the current text; and a restore that
  writes the old content as a new revision. The entry point is visible on the reader, because the
  most likely reason to look is that an agent rewrote something. The same control appears wherever
  authored text can be overwritten — insights, unreviewed register entries, objectives, the project
  idea, annotations — and looks and behaves identically in each place.
- **Registers:** two lists, filterable by review status, objective, tag, and cited record. An
  entry page shows the statement, body, citations with their **snapshot text** and live
  `check_citations` status, links grouped by type, and the full review history. Actions: review
  (status + required note, optional confidence), link, supersede (opens a prefilled new entry).
  Frozen fields ([§4.8](04-data-model.md)) are shown as such, with "supersede" as the path to
  change them.

## 7.8 Story

- **Reader first.** A collapsible hierarchy beside the rendered page. Opens the last page this
  browser read in this project, otherwise the first root page. Pages render only in the sandboxed
  frame ([§4.11](04-data-model.md)); the frame resizes to content.
- Version selector per page with who published and the change note.
- **Arrange:** drag pages within the hierarchy, place unplaced pages, remove from the hierarchy —
  saved against the hierarchy's ETag.
- Authoring HTML is primarily an agent task. The UI offers "publish new version" by paste or file
  for people who want it, with validation errors shown precisely. No WYSIWYG editor.
- An empty Story explains how to ask a connected agent to draft it, and links to Connect.

## 7.9 Activity

An **Activity drawer**, reachable from every project screen, not a fifth destination. It lists
events newest first ([§4.10](04-data-model.md)), filtered by default to what the current screen is
showing — the open record, the open register entry, the whole project on Objectives. Each entry
reads as a sentence with the actor, the surface, and a link to the object: "Sam, via
claude-desktop, confirmed an assumption — 14:02". Filters: actor, object type, since.

This is how a person answers "what did my colleague's agent just do to my project" without reading
a diff. It is also the first place to look when a `409` surprises someone.

## 7.10 Archiving and deleting

One pattern, used identically wherever an object can be removed
([§9.5](09-data-lifecycle.md)).

1. The visible control is **Archive**. It is a plain, ordinary action with no confirmation beyond
   an undo toast, because it is reversible. Its tooltip says what archiving does: takes this out of
   your views and out of what an agent can search, keeps everything.
2. **Delete** sits inside the same menu, below a separator, styled as destructive, never
   pre-selected and never the primary button of any dialog.
3. Choosing it opens a dialog that leads with **"Delete permanently. This cannot be undone."** and
   shows the `delete_impact` result as plain sentences before any control: *4 files (218 MB), 2
   derivations, 1 annotation, 3 revisions. **2 citations in the decision register point at this
   record** and will be left pointing at a tombstone — their quoted text will be kept.*
4. The dialog asks for a reason, and requires the person to type the object's title to enable the
   button. Archive is offered again, in the dialog, as the secondary action.
5. Afterwards, a toast states what was deleted and links to the activity entry. Nothing is
   silently gone.

Copy rules: the word is **delete**, never "remove", "dismiss", "clear" or "hide". "Archive" is
never described as deleting. A list row showing an archived object says *Archived*, not
*Deleted*.

## 7.11 Team screens

- **Members.** Who is in the team, who is the owner, outstanding invitations with their expiry,
  invite by email or link, remove a member (with a confirmation naming what stays: their writes and
  their attribution).
- **Connect.** [§6.8](06-operations-and-adapters.md). Endpoint, OAuth or token, the skill, agent
  status, and the plain statement about where an agent sends your passages.
- **Settings.** Team name and slug; **usage against every limit** with the numbers from
  [§9.2](09-data-lifecycle.md) shown as fractions, not bars alone; the data statement; export; and
  a danger zone holding only owner-gated actions (transfer ownership, close the team), each behind
  a typed confirmation that names the team.
- **Account.** Display name, email, password, active sessions and personal access tokens with
  last-used times and a revoke control, and delete account.
