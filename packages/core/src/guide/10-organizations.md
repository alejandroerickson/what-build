# Organizations, plans and export

Exporting a product, starting an organization, plans and limits and their refusals, and the actions only an instance's owners have.

## Export

`products_write(action="export")` builds a ZIP of the whole product: sources with their attachments,
texts, summaries, notes and comments, outcomes, assumptions, reviews, earlier texts, mockups, Story
versions, tombstones and activity. `products_read(action="exports")` gives a download grant once it
is ready. The bundle's `README.txt` says what each file holds.

A viewer, editor or admin can export at any time, an archived product too; a reader, who reads only
the Story, cannot (`403`). Nobody exports the example organization. On the free plan each person's
exports a day are limited.

## Starting an organization

`products_write(action="create_tenant")` starts an organization. It needs an allowance from whoever
runs this WhatBuild; belonging to an organization never gives one, and the action is offered only when
the person has room in one. Without it the call is refused with `403 tenant_allowance`. The answer's
`plan` says whether the new organization is on the free plan or unlimited.

## Plans and limits

An organization is on the `free` or the `unlimited` plan; `products_read(action="list")` gives each
tenant's `plan`. On the free plan everyone in the organization, its owners included, meets limits on
how often and how much, and an agent's calls count as its person's.
`products_read(action="limits", params={"tenant": "…"})`, or with `product` set to a product in it,
lists every limit with its value and, for the daily ones, what the person and everyone together have
used today; a day is a UTC day. A guest of the example organization meets only the limit on calls a
minute. Reading and searching are never stopped by a day's allowance.

| Refusal | What it means |
|---|---|
| `429 rate_limited` | Too many calls, or writes, in this minute. `retry_after_seconds` says when calls are accepted again. |
| `409 quota_exceeded` | A day's allowance of that kind of write is used up: `details` has `quota`, `limit`, `used` and `resets_at`. Reads still work. |
| `413 too_large` | One field, file or batch is over its size: `details` has `limit`. |
| `403 plan_restricted` | The plan does not allow this at all (a limit of 0, fetching from a URL switched off, a file the parsers do not read, uploading a mockup canvas as a ZIP). The message names the alternative where there is one. |

Only whoever runs this WhatBuild changes a plan or a limit.

## Instance owners' actions

An owner of this WhatBuild instance is offered actions nobody else is (anyone else who calls one gets
`403 forbidden`):

- `products_read(action="usage")`: how the instance is used (calls, features, agent clients,
  failures, people coming back), as totals that name nobody. Only on the unscoped connection (`/mcp`);
  a scoped connector refuses it.
- `products_read(action="accounts")`: every account, with the organizations each is in and when it was
  last seen.
- `products_read(action="organizations")` and `products_write(action="set_limits")`: every
  organization's plan and limits, and changing them.
- `products_read(action="tenant_allowances")`, `products_write(action="set_tenant_allowance")` and
  `remove_tenant_allowance`: the allowances to start organizations.

Ending an account is never a tool: an instance owner removes one on People in the web app, and a
person deletes their own in its Settings.
