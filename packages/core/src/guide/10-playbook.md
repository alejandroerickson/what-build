# The Playbook

Each product's Playbook: the knowledge its people's agents keep together, how to read and write it, its versions and conflicts, links, messages and housekeeping.

## What it is

Every product has a **Playbook**, a bundle in the Open Knowledge Format (OKF): Markdown files with YAML
frontmatter, and the text files of kits. The product's Idea, Evidence, Exploration and Story hold
its material. The Playbook holds what the team has learned about working on it, written by the agents of
everyone who works on it: what is current, lessons from the corrections people make, the kits agents
build pages with, what each person is working on, and how the team uses the Playbook itself.

WhatBuild is meant to be used through it by everyone who works on the product; someone who only reads
its Story does not reach it. Read it before working on a product, and write to it as you
work: when a person corrects you, when you write something you will write again, when the work
changes direction, when you finish. Each agent then starts where the last one stopped, and nobody
teaches the same thing twice. The more the team's agents work through it, the better every agent's
work fits the team. It is the team's: its files say how this team works, and they change when the
team does.

People don't see the Playbook in the web app. A product's admins turn it off and on in its Settings,
under Playbook. Off, every call to it is refused with `409 playbook_off`, nothing points agents at it, and
nothing in it is lost: `products_read(action="get")` gives `playbook` as `enabled: false` with a `how`
saying so and who turns it on.

## Where to start

- `products_read(action="get")` gives `playbook`: `read_first` (the files that apply to every kind of
  work, with their titles and descriptions), `by_area` (the paths that apply to idea, evidence,
  exploration and story), how many files it has, and `messages_waiting`.
- The answers an agent gets when it starts work on a part list the files for it under `playbook`:
  `story_read(action="guidance")` for the Story, `outcomes_read(action="card_guidance")` for the
  Idea, `derived_read(action="card_guidance")` for Evidence, and `mockups_read(action="list")` for
  Exploration.
- `playbook_read(action="index")` lists every file with its path, type, title, description,
  `applies_to`, status, size, sha256, revision and etag, and gives `index_md`, OKF's `index.md` for a
  folder (`prefix`), and `okf_version`, the version of the Open Knowledge Format the Playbook's files
  follow.
- Every answer in a product says how many messages wait for your person there, as
  `scope.playbook_messages_waiting`, when any do.

## The starter

A product's Playbook begins as a copy of **WhatBuild's starter**: `using-this-playbook.md`, which says how the
team uses it, `how-to/` (lessons, kits, housekeeping, people and messages) and `product/` (what is
current, and a map into the evidence, both empty). Until the product's first write the Playbook serves the
starter as it ships with this version, at revision 0, each file marked `from_starter`. The first write
of any file copies the whole starter in, keeping its etags, and the files are the team's from then
on: change any of them. `playbook_read(action="starter")` gives WhatBuild's current starter beside the
product's copy, saying which files differ.

## Files

A path is relative to the bundle: `lessons/canvas-titles.md`, `kits/canvas/build.mjs`. Its parts are
letters, digits, dots, hyphens and underscores, each starting with a letter or digit, at
most 8 parts and 240 characters, ending in `.md` or a kit's text file (`.js`, `.mjs`, `.cjs`, `.ts`,
`.mts`, `.json`, `.css`, `.html`, `.svg`, `.txt`, `.py`, `.sh`, `.yaml`, `.yml`, `.toml`, `.csv`). A
leading `/` is taken off, so a link within the bundle (`/lessons/x.md`) names its file.
`index.md` and `log.md` are WhatBuild's at every level and are never written (`422
playbook_reserved_path`). Two paths that differ only in capitals are one path, since most machines'
folders could not hold both: writing or moving to one while the other is there is refused with
`409 playbook_path_taken`.

A Markdown file starts with frontmatter that names its `type` (`422 playbook_frontmatter_missing`,
`422 playbook_type_missing`). WhatBuild reads these keys and leaves the rest as written:

| Key | What it does |
|---|---|
| `type` | Required: what kind of file it is (Lesson, Kit, Guide, Person, any word). |
| `title`, `description` | How the index and the answers that point agents at it show it. A write warns when either is missing. |
| `applies_to` | `idea`, `evidence`, `exploration`, `story` or `all`: where WhatBuild lists it to agents. |
| `tags` | A list, for search and the reader. |
| `status` | `draft`, `stable` or `deprecated`. |
| `stale_after` | A date or time after which it is counted stale until someone moves it on. |

A file holds at most 256 KiB (`422 playbook_file_too_large`). A product's Playbook holds as many files
and bytes as its organization's plan allows, removed files not counted: 2,000 files and 32 MiB unless
the plan says otherwise (`422 playbook_full`, whose details give `max`). Its text, every kept revision included, counts
toward the storage the organization's plan keeps. WhatBuild stores a kit's files and never runs them:
read a kit's code before running any of it, as you would code from any teammate.

## The team's, and each person's

The people who work on a product share its Playbook, but they don't all work alike: one makes canvases
to test an idea with customers, another to argue a price with the board. So a file is the team's,
which holds for everyone, or some people's, which holds only when you work for one of them. The
starter's convention is a `people` key in the frontmatter, naming each person by their page under
`people/` (`people: [ana-souza]`); a file with none is the team's. WhatBuild leaves `people` as
written and lists every file to every agent working in the part it applies to, so check it before
following a file:

- When you work for a person, follow the team's files and that person's. Read other people's to
  learn how they work, and use them for your person only if your person wants that.
- When your person's file and a team file disagree, follow your person's for their own work, and
  tell them.
- Each person's page says which kits and lessons they use, and what for: together the pages map
  who uses what. Two purposes are two kits, each named for its purpose, rather than one kit with a
  switch for each person. Before changing a kit or a lesson others use, read who uses it, and write
  to them first if what it makes for them would change.
- A correction in someone's own words ("I like…") is theirs; one about everyone ("we always…") is
  the team's. When unsure, write it as theirs and ask.

## Reading

| Action of `playbook_read` | Gives |
|---|---|
| `index` | Every file, without its text, and `index_md`; `prefix` for one folder. |
| `read` | One file's text, etag, revision, size and sha256, and each `whatbuild:` link in it with what it names now. With `revision`, that revision's text. |
| `read_files` | Every file under a `prefix` with its text, size, sha256 and etag, up to 1 MiB an answer, `next_cursor` for more: to work on a kit on your own machine. |
| `get_download` | A short-lived grant to GET a folder (`prefix`), or the whole bundle, as a ZIP: each file at its path, and `_manifest.json` with each one's etag, revision, size and sha256. |
| `search` | The files whose text holds every word of `query`, with a few lines around them: up to three passages a file, each the line holding a word with the nearest line before and after it that isn't blank, blank lines between left out, line breaks kept. A word found only in the frontmatter shows frontmatter. |
| `history` | A file's revisions, newest first; without a path, the bundle's recent changes and `log_md`. |
| `backlinks` | The files that link to a source, mockup, outcome or Story page. |
| `housekeeping` | What might be tidied (below). |
| `starter` | WhatBuild's starter beside the product's copy. |
| `messages` | Your person's messages (below). |

## Writing, versions and conflicts

| Action of `playbook_write` | Does |
|---|---|
| `write` | Writes a file: a new one, or the next revision of the one there. |
| `move` | Moves or renames a file, keeping its history. |
| `remove` | Removes a file. Its history stays. |
| `restore` | Brings back a revision of a file, a removed one too, as its next revision. |
| `apply` | Up to 200 writes, moves and removals at once: all of it, or none. With `upload_id`, a write step without `content` takes its file from an uploaded ZIP. |
| `request_upload` | A short-lived grant to PUT a ZIP of files for `apply` to read. |

Every change keeps a revision, with who made it, through which agent, and `message` when given, a
sentence saying why. The most recent 100 of each file are kept.

A change to a file that is there takes the etag of your last read as `expected_etag`. When someone
wrote it in between, or the etag is missing, it is refused with `409 stale_etag`, whose details give
`current_content`, `current_etag`, the revision and who wrote it: merge your change into their text,
and write again. A new file takes no etag, and one sent for a path that holds nothing is refused
with `current_etag: null`. `apply` checks every etag before writing anything, and refuses the whole
change with `409 playbook_stale`, listing every stale file with its current text, so they are merged at
once. A path appears in one of its steps only.

To work on files on your own machine (a kit, or many files at once): `get_download` a folder and
unzip it, or `read_files` them and write them into a folder of their own, keeping the etags; change
them, and send the changes back in one `apply`. To keep their text out of the call, zip the folder as
it is (files at their Playbook paths; when everything sits inside one folder, the paths are read from
inside it if that finds more of the steps' files; `_manifest.json` may stay),
PUT it under `request_upload`'s grant, and pass `upload_id` to `apply` with write steps that leave
`content` out. A step whose file the ZIP lacks refuses the whole change, naming each one, and the
upload can be tried again; a successful `apply` reads an upload once. Files are UTF-8 text, kept byte
for byte (a leading byte-order mark too), and hold no null character. Every answer that gives a file's metadata gives `size`, its text's bytes as UTF-8, and
`sha256`, the hex SHA-256 of those bytes, so you can check that your copy, or what you sent,
arrived whole. Moving onto a path that holds a file is refused with `409 playbook_path_taken`.

`playbook_delete(action="purge")` deletes a file and every revision of it for good: an admin's call, with
the file's etag, a reason and `confirm` set to `"delete permanently"`. Removing is almost always what
is wanted. Afterwards reading the path, its history, restoring or purging it answers `410
playbook_file_deleted`, with the file's tombstone. A path a file was moved away from answers `404`
whose details give `moved_to`, the path the file has now, where its history is.

## Links

A `whatbuild:` link names an object of the product without a host, so it holds on every copy of it:
`whatbuild:sources/<record_id>`, `whatbuild:mockups/<mockup_id>` (with `@<version>` and
`#<page_id>` when they matter), `whatbuild:outcomes/<outcome_id>`, `whatbuild:story/<page_id>`
(with `@<version>`) and `whatbuild:product`, the product concept. Between files, link as OKF does,
from the bundle's root: `[the lesson](/lessons/canvas-titles.md)`.

- `read` gives each link with its object's title and `status`: `live`, `archived`, or `missing`
  when the product has nothing with that id.
- A write warns of links that name nothing, or something archived, and of `whatbuild:` text that
  is no link it reads.
- Archiving a source, a mockup, an outcome or a Story page that a file links to answers
  `playbook_cited_by` with those files, and `playbook_read(action="backlinks")` lists them at any time.

## Messages

A message goes from your person's agents to another person's, about this product.
`playbook_write(action="send_message", params={to, text})` sends one: `to` is an `account_id` from
`members_read(action="list", params={tenant, product})` of a viewer, editor or admin of the
product (someone who reads only its Story reaches no Playbook), not your own; `text` is at most 4,000 characters. `playbook_read(action="messages")` lists your person's, unread
first (`box: "sent"` for theirs to others), and `playbook_write(action="mark_read")` marks them read,
which anyone who reads the product may do through an Edit connection (a Read only one is offered no
write tool). A message lasts 60 days, read or not, and a product's
export leaves messages out. What everyone should know goes in a file instead.

## Housekeeping

`playbook_read(action="housekeeping")` gives candidates, not verdicts: WhatBuild knows what changed and
what the Playbook links to, not what people read.

- `stale`: files past their `stale_after`.
- `drafts`: files whose status is draft, unchanged for 30 days.
- `broken_links`: files linking to something archived or missing.
- `not_linked`: the product's sources, mockups, outcomes and Story pages that are not archived, have
  not changed in 30 days, and that no file links to, the oldest first.

What agents do with them is the team's call, in the Playbook's own `how-to/housekeeping.md`. The starter
says: in the Playbook, act without asking, since every removal can be restored; in the product, archive
what is clearly done with and tell your person, and leave deleting to people.

## Who may do what

Viewers read the Playbook and their messages, and mark them read through an Edit connection. Editors write, move, remove, restore and
send messages. Admins also purge. A Story reader reaches none of it. Every change is in the product's
activity log, under the Playbook. A product's export holds its files and every revision.
