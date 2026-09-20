# 7. Web application

This section specifies behavior and information architecture. Visual design, the design system,
and component choices come later and are out of scope.

## 7.1 Principles

- The UI uses only registry operations through the `Client` interface
  ([§2.5](02-architecture.md)). If the UI needs something, it becomes an operation, and agents get
  it too.
- **State that matters lives in the URL**: project, screen, filters, search query, selected page,
  passage position. Reload and share always work.
- A static SPA: it must run from any static host and inside the browser profile with no server.
- Every write path handles `409 stale_etag` explicitly: show what changed, keep the person's
  unsaved text, offer reload-and-reapply. Never discard input; never overwrite silently.
- Works on narrow screens. Meets WCAG 2.2 AA. Fully keyboard-operable.
- Agents are teammates: attribution in the UI shows who wrote something **and through which
  surface** (for example "Sam · via claude-desktop").

## 7.2 The project switch

A workspace holds several discoveries; a person must always know which one they are in, and move
between them without losing their place.

Requirements (placement and appearance are a design-phase decision):

1. The current project's name is visible on every project-scoped screen.
2. The switch is reachable from every screen in one interaction, lists active projects (most
   recently used first), and can create a project and open the full project list.
3. **Switching keeps the screen**: from Sources in project A to Sources in project B. Sub-view
   state that cannot transfer (a record id, filters on tags) is dropped.
4. The project is in the URL path (`/p/<slug>/…`). Opening a link to another project simply works
   and that project becomes the remembered one.
5. The last-used project is remembered per browser. `/` opens it; with none remembered (or it is
   archived), `/` shows the project list.
6. Archived projects appear only in the full list, behind a filter, read-only with a restore
   action.
7. Project-scoped and workspace-level chrome must be visually distinct enough that Connect and
   Settings are not mistaken for belonging to one project.

Candidate placements to evaluate in design: a leading element in the top bar, ahead of the four
destinations; the header of a side rail; a command-palette entry in addition to either.

## 7.3 Routes

```
/                               project list, or redirect to the remembered project
/projects                       full list: create, import bundle, import sample, archived filter
/connect                        agent onboarding (§6.8)
/settings                       display name, storage status, export, about/profile info

/p/:project                     → /p/:project/objectives
/p/:project/objectives
/p/:project/sources                         browse (filters in the query string)
/p/:project/sources/new                     kind-first upload
/p/:project/sources/search                  search (same filters + q)
/p/:project/sources/:record                 record page: overview · passages · insights · files
/p/:project/sources/:record/passages?seq=…|t=…
/p/:project/insights                        insight documents
/p/:project/insights/:insight               read / edit
/p/:project/insights/assumptions[/:id]
/p/:project/insights/decisions[/:id]
/p/:project/story[/:page][?v=n]
/p/:project/settings                        name, slug, idea, export, archive
```

## 7.4 Objectives

The landing screen. The project's idea at the top; objectives as aligned cards in a centered
content band that adapts to narrow screens. Create, edit inline, reorder, change status. Each card
shows how many insights, assumptions, and decisions point at it, linking into Insights filtered by
that objective. Archived objectives are behind a toggle. An empty project presents this screen as
the first step of the loop: write the idea, then the first objective, then add a source.

## 7.5 Sources

- **Upload, kind-first.** Step 1 asks what the material *is* (kinds grouped as in
  [§4.4](04-data-model.md), in plain language). Step 2 asks for title, the **event date** (with
  help text distinguishing it from today), and optional metadata relevant to that kind. Step 3
  takes files and assigns roles with sensible defaults (a transcript beside a recording becomes
  primary). The person never sees or chooses a folder. Multi-file drag-and-drop is supported;
  progress and derivation status are shown until `ready` or a terminal status with a plain-language
  explanation and next step (`needs_transcript` → "add a transcript").
- **Browse.** Filters held in the URL: folder, kind, organization, date range, tags, title
  substring, archived. Sort by date or added time. Paged.
- **Record page.** Metadata (editable, including kind — "reorganize" — without any mention of
  paths); the derived outline as navigation; file entries with role, version history, preview for
  browser-supported formats, download for the rest; archive and restore.
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

## 7.6 Insights

- **Insight documents:** list with status, summary, and reference counts; a reader with rendered
  Markdown; an editor with preview and a reference picker for objectives, sources, insights,
  assumptions, decisions; explicit publish and unpublish.
- **Registers:** two lists, filterable by review status, objective, tag, and cited source. An
  entry page shows the statement, body, citations with their **snapshot text** and live
  `check_citations` status, links grouped by type, and the full review history. Actions: review
  (status + required note, optional confidence), link, supersede (opens a prefilled new entry).
  Frozen fields ([§4.8](04-data-model.md)) are shown as such, with "supersede" as the path to
  change them.

## 7.7 Story

- **Reader first.** A collapsible hierarchy beside the rendered page. Opens the last page this
  browser read in this project, otherwise the first root page. Pages render only in the sandboxed
  frame ([§4.10](04-data-model.md)); the frame resizes to content.
- Version selector per page with who published and the change note.
- **Arrange:** drag pages within the hierarchy, place unplaced pages, remove from the hierarchy —
  saved against the hierarchy's ETag.
- Authoring HTML is primarily an agent task. The UI offers "publish new version" by paste or file
  for people who want it, with validation errors shown precisely. No WYSIWYG editor.
- An empty Story explains how to ask a connected agent to draft it, and links to Connect.

## 7.8 Profile-specific UI

- **Browser profile:** a persistent, unobtrusive indicator that data lives in this browser, with
  storage-persistence state and one-click export; a reminder to export after significant work;
  relay status on Connect, and a visible indicator while an agent is connected.
- **Signed-in profiles:** sign-in, workspace switch (cloud), members and invitations.
- Capabilities missing in a profile are explained where they would appear, not hidden without
  trace.
