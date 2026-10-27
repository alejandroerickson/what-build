# Organizations, plans and export

Exporting a product, starting an organization, plans with their limits and totals, read-only organizations, and the actions only an instance's owners have.

## Export

`products_write(action="export")` builds a ZIP of the whole product: sources with their attachments,
texts, summaries, notes and comments, outcomes, assumptions, reviews, earlier texts, mockups, Story
versions, tombstones and activity. `products_read(action="exports")` gives a download grant once it
is ready. The bundle's `README.txt` says what each file holds.

A viewer, editor or admin can export at any time, an archived product too; a reader, who reads only
the Story, cannot (`403`). Nobody exports the example organization. On a plan that limits exports,
each person exports as many times a day as it allows. An export is counted against what a person is
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
place; products and sources not archived; and storage, every version: files, which are attachments,
the text read from each attachment, kept as a file of its own, and prototypes, and text written in
WhatBuild). What each
person is sent a day (attachments, mockup downloads, exports) is capped too.
`products_read(action="limits", params={"tenant": "…"})`, or with `product` set to a product in it,
lists every limit with its value (null for none) and what is used of it: today's for a daily one, a
day being a UTC day; what the organization holds for a total, also in `holds`. It compares the plans
offered in `plans`, empty where there are none. A guest of the example organization meets only the
guests' limits on calls a minute and downloads a day.

- Reading, searching, archiving, deleting and export are never stopped by a limit.
- Archiving makes room under people, products and sources; only deleting frees storage.
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
| `409 quota_exceeded` | A day's allowance is used up, or a total the plan sets is reached: `details` has `quota`, `limit`, `used` and, for a day's, `resets_at`. The message says what makes room. |
| `413 too_large` | One field, file or batch is over its size: `details` has `limit`. |
| `403 plan_restricted` | The plan does not allow this at all (a limit of 0, fetching from a URL switched off, a file the parsers do not read, uploading a mockup canvas as a ZIP). The message names the alternative where there is one. |
| `409 organization_read_only` | The organization is read-only: `details` has `read_only_since` and `kept_until`. |

Only whoever runs this WhatBuild moves an organization to another plan or changes a plan's limits.

## Instance owners' actions

An owner of this WhatBuild instance is offered actions nobody else is (anyone else who calls one gets
`403 forbidden`):

- `products_read(action="usage")`: how the instance is used (calls, features, agent clients,
  failures, people coming back), as totals that name nobody. Only on the unscoped connection (`/mcp`);
  a scoped connector refuses it.
- `products_read(action="accounts")`: every account, with the organizations each is in, when it was
  last seen, and the organizations it is the only owner of.
- `products_read(action="organizations")`: every organization's plan, what it holds and whether it is
  read-only, with the plans the deployment defines and `starting_plan_is_read_only` where moving it
  to the starting plan would make it read-only.
- `products_write(action="set_plan")` moves an organization to a plan the deployment defines, or
  `unlimited` (any other is refused with `422 unknown_plan`); `products_write(action="set_plan_limits")`
  changes a plan's limits and price, for every organization on it.
- `products_read(action="guests")` and `products_write(action="set_guests")`: how guests come into
  the example organization.
- `products_read(action="tenant_allowances")`, `products_write(action="set_tenant_allowance")` and
  `remove_tenant_allowance`: the allowances to start organizations, and the waitlist.

Ending an account and deleting an organization are never tools: an instance owner removes an account
on People in the web app, and deletes an organization on Organizations; a person deletes their own
account in its Settings, and an organization's owners delete it on its Members page.
