---
type: Decision
title: The privacy page is a short notice written to stay true, in categories rather than mechanics
description: What the privacy page is for, what it must say and must not, and why it names no number a release could change, so that it is right by construction and rarely needs to change.
tags: [decision, privacy, web, data-lifecycle]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# The privacy page is a short notice written to stay true, in categories rather than mechanics

## Context

The first privacy page (v0.24.0) opened with four slogans under bold lead-ins, then listed what is
kept with the retention of each in days and months read from the deployment's settings, and named
the deployment's providers as a `Name: purpose` list. The maintainer read it on 2026-10-26 and found
it weird and over-specific: headings that said nothing on their own, a list where prose was wanted,
and a level of detail that would have to change with every release, which, once people have
accounts, means telling them each time. They asked for the page to be written again from the
basics of a privacy notice: disclose as little as the law and honesty require, say nothing untrue,
and describe the product as little as possible so the notice stays put while the product moves.

## Decision

The privacy page is a notice, not a specification. It is written to these objectives, in this order:

1. **Nothing on it is untrue.** Every claim is a rule elsewhere in `okf/spec/`, listed in the
   table in [§9.1](../spec/09-data-lifecycle.md). A change that would make a claim untrue changes
   the page in the same change; a claim no rule enforces is not made.
2. **It says what the law asks of a notice, and little more.** Who is responsible and how to reach
   them; what is kept, in categories; why, with the ground for each (use of the service, a
   legitimate interest the person may object to, consent); who else handles it, including
   transfers abroad; how long it stays, as criteria; and what the person can do, including a
   complaint to their authority. This covers what the GDPR asks of a notice (Article 13) and the
   openness, access and challenge principles of Canada's PIPEDA; the maintainer runs no compliance
   program beyond that, and the page does not pretend to one.
3. **It describes categories, not mechanics.** "A log of requests that holds no content", not the
   fields of the log; "for a limited time", not 30 days; "the agents you have connected", not token
   families. A number a setting or a release could change never appears, so a release never
   changes the page by accident. The mechanics are documented in `okf/spec/` for anyone who wants
   them, and the Cookies page stays specific about cookies, which the law treats differently.
4. **It is prose in the operator's voice**, in short sections whose headings say what follows
   ("What is kept", "Who else handles it", "How long it stays", "What you can do"), one list where
   the content is a list, and no slogans. It carries the month it last changed in a way that
   matters to a person; wording alone does not move it.
5. **It says who sees what, not how the product works.** That whoever runs the deployment sees each
   organization's name and the names and emails of its people, to write to them and, where a plan
   has a price, to bill it, is said, because a person cannot guess it. A plan's name, what an
   organization holds, a guest's waiting line or a read-only year are product mechanics, covered
   by the categories ("how much you use WhatBuild", "while it exists") and left out.
6. **It discloses what is true of every WhatBuild, and the deployment adds what only it knows**:
   who runs it, where to write, and who else handles the data, the last as a paragraph it writes
   itself (`WHATBUILD_PROVIDERS`), naming its providers or describing them by kind, as it chooses.

It stays in the web app, at `/privacy` on the app's domain, rather than on the public site: the
sign-in page, Settings, Cookies, the account-deletion page and the deletion mail all point there,
every deployment needs one whether or not it has a site, the site's domain already sends `/privacy`
to the app, and the text now changes rarely enough that a release is an acceptable way to change it.

## Consequences

- A change to the product's data handling is a change to a category on the page only when it
  adds a category, removes one, or changes who handles the data or for how long in kind. Most
  releases leave the page alone.
- `privacy` in `GET /api/v1/meta` gives the operator, the contact, the providers paragraph and
  whether analytics is set, and no durations.
- An operator who wants a longer policy, or one under a specific regime, writes it elsewhere and
  points `WHATBUILD_PRIVACY_CONTACT` at it, or at an address; the page links to it as a contact.
- Rejected: moving the page to the public site
  ([decision](the-public-site-is-pages-built-with-the-app.md)). The app would still need a page for
  deployments without a site, every link to it is in the app or its mail, and the text would still
  live in this repository.

## Constrains

- `apps/web/src/routes/privacy.tsx`, `apps/server/src/public-routes.ts` (`privacy`),
  `apps/server/src/config.ts` (`WHATBUILD_OPERATOR`, `WHATBUILD_PRIVACY_CONTACT`,
  `WHATBUILD_PROVIDERS`), `apps/server/test/privacy.test.ts`.
- `LAST_CHANGED` in the page moves only with a change that matters to a person, and the
  [upgrading notes](../operations/upgrading.md) say when it did.

Specified in: [09-data-lifecycle §9.1](../spec/09-data-lifecycle.md), [07-web-app §7.11](../spec/07-web-app.md).
