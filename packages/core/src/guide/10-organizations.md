# Organizations, plans and export

Exporting a product, starting an organization, plans with their limits and totals, read-only organizations, and running this WhatBuild, which is done in the web app.

## Export

`products_export(action="export")` builds a ZIP of the whole product and changes nothing in it:
sources with their attachments, texts, summaries, notes and comments, outcomes, assumptions, reviews,
earlier texts, mockups, Story versions, tombstones and activity. `products_read(action="exports")` gives a download grant once it
is ready. The bundle's `README.txt` says what each file holds.

A viewer, editor or admin can export at any time, an archived product too; a reader, who reads only
the Story, cannot (`403`). A guest of the example organization exports nothing; its members do. On a
plan that limits exports, each person exports as many times a day as it allows. An export is counted against what a person is
sent a day, and always sent.

## Starting an organization

`products_write(action="create_tenant")` starts an organization. It needs an allowance from whoever
runs this WhatBuild; belonging to an organization never gives one, and the action is offered only when
the person has room in one. Without it the call is refused with `403 tenant_allowance`, whose
message says whom to ask; in the web app, **Ask for your own organization** puts a person on the
waitlist the instance's owners read. Where new organizations start on a plan the deployment
defines, each person has one organization on it, and moving that one to another plan frees its
place. The answer's `plan` says which plan the new organization is on.

## Plans and limits

An organization is on one plan of its own: one the deployment defines, or `unlimited`, which sets
no limit. `products_read(action="list")` gives each tenant's `plan`. The plans, their names, limits
and prices are each deployment's own, and a deployment may define none, so that every organization
there is unlimited. Limits belong to the plan, never to one organization.

On a plan with limits everyone in the organization, its owners included, meets them, and an agent's
calls count as its person's: limits on how often and how much each day, and totals on what the
organization holds (people who do more than read the Story, an invitation not yet accepted holding a
place; products and sources, archived or not; and storage, every version: files, which are attachments,
the text read from each attachment, kept as a file of its own, and prototypes, and text written in
WhatBuild). What each
person is sent a day (attachments, mockup downloads, exports) is capped too.
`products_read(action="limits", params={"tenant": "…"})`, or with `product` set to a product in it,
lists every limit with its value (null for none) and what is used of it: today's for a daily one, a
day being a UTC day; what the organization holds for a total, also in `holds`. It compares the plans
offered in `plans`, empty where there are none. A guest of the example organization meets only the
guests' limits on calls a minute and downloads a day.

- A total never stops reading, searching, archiving, restoring, deleting or export.
- A day's writes never stop reading, searching, export, deleting, removing someone or cancelling an
  invitation, and those last three are not counted as writes. They do stop archiving and restoring.
  Calls and writes a minute pace them all.
- Archiving makes no room: what is archived still counts. Deleting makes room under products, sources
  and storage, and needs a product's admin and a connection at Admin; an editor can't, and the
  refusal says who can. Removing someone or cancelling an invitation makes room under people.
- Restoring adds nothing to a total, so no total refuses it. It is a write, so the day's writes do.
  A source in an archived product is deleted by restoring the product first, or by deleting the
  product whole.
- An organization past a total keeps everything and stays writable: only adding more of that kind is
  refused.
- A reader of the Story does not count among the people, so one can be invited when the people
  total is reached.

### Read-only organizations

An organization moved back to the plan new organizations start on, while whoever started it already
has all the organizations there they may have, is **read-only**: `products_read(action="list")`
marks its tenant `read_only`, with `since` and `kept_until`, the day it is kept until. Reading,
searching, export, deleting and taking people out work there as usual, as each person's roles
allow; every other write is refused with `409 organization_read_only`, changing nothing, until an
instance owner moves it to another plan. Its owners are mailed when it becomes read-only.

| Refusal | What it means |
|---|---|
| `429 rate_limited` | Too many calls, or writes, in this minute. `retry_after_seconds` says when calls are accepted again. |
| `409 quota_exceeded` | A day's allowance is used up, or a total the plan sets is reached: `details` has `quota`, `limit`, `used` and, for a day's, `resets_at`. A call past both is refused for the total, which waiting does not lift, with the day's in `also`. The message says what makes room. |
| `413 too_large` | One field, file or batch is over its size: `details` has `limit`. |
| `403 plan_restricted` | The plan does not allow this at all (a limit of 0, fetching from a URL switched off, a file the parsers do not read, uploading a mockup canvas as a ZIP). The message names the alternative where there is one. |
| `409 organization_read_only` | The organization is read-only: `details` has `read_only_since` and `kept_until`. |

Only whoever runs this WhatBuild moves an organization to another plan or changes a plan's limits.

## Running this WhatBuild

Whoever runs this WhatBuild (an owner of the instance) does it in the web app, never through an
agent. No connection is offered these actions, an instance owner's included, and a call to one is
refused with `403 web_only`, saying where a person does it, not as an action from an older tool
list. Tell the person where to go:

- On Organizations (`/instance`): every organization, its plan and what it holds; moving one to
  another plan (Change plan); a plan's limits and price (Plans); how guests come into the example
  organization (Guests); who may start organizations, and the waitlist.
- On People (`/people`): every account, and removing one.
- How the instance is used is read with the usage report whoever runs it keeps (`pnpm usage`).

Renaming and deleting are also done only in the web app. An organization's owners rename it under
Organization name on its Members page, and a product's admins rename it in its Settings; an instance
owner renames any organization on Organizations. A person deletes their own account in their
Settings, an organization's owners delete it on its Members page, and an instance owner deletes any
organization on Organizations. A renamed organization keeps answering to the slugs it had before.
