---
title: An owner of this WhatBuild lets people in, moves organizations between plans, deletes organizations and removes people
organizations: [synthetic, example]
people: [riley, morgan, guest]
surfaces: [web, mcp]
---

# Running the instance: organizations and people

Riley owns this WhatBuild. This plan follows everything an instance owner does to organizations
and people, from someone asking for an organization to their account being removed: the waitlist,
allowances, one Free organization each, moving an organization to Pro and back (read-only when its
owner already has a Free one), deleting any organization, and removing any account, the only owner
of an organization included. All of it is done in the web app: an agent, Riley's included, is
offered none of it. It makes its own people and organizations, and deletes only those.
Free and Pro are the plans in `deploy/plans.example.json`, which the end-to-end instance offers,
starting new organizations on Free; the rules are the same for any deployment's plans.

Use addresses of the run's own at `example.com`, made from the run's folder time, such as
`ana-<run>@example.com`, so nothing here meets an earlier run's people. Below, **Ana**, **Ben**
and **Cleo** are three such addresses, signed in with `pnpm e2e browser signin <address>` and
`pnpm e2e mcp --as <address>`.

## Steps

1. **Web, as Ana, a new address.** Sign in. *Expect:* the overview lists the example organization,
   and a sheet, Your own organization, says organizations open a few at a time and offers **Ask
   for your own organization**; there is no Start your organization. Press it. *Expect:* the button
   gives way to "On the waitlist since <today>" and that an email will say when Ana can start one;
   a reload keeps it. The example's banner offers no button to ask again.
2. **Web, as Riley.** Open Organizations (`/instance`) from the account menu. *Expect:* sheets for
   Organizations, Plans, Guests, Who can start organizations and Waitlist. The Waitlist lists Ana
   with her address, when she asked and "signed up". Press **Let them start one** for Ana.
   *Expect:* a toast says Ana can start an organization; Ana leaves the Waitlist and appears under
   Who can start organizations: "Can have 1 Free organization; has 0", with "1 left". The server's
   log prints the email Ana is sent, with a link to `/welcome`.
3. **Web, as Ana.** Reload the overview, start an organization from Start your organization with a
   name of the run's own and a first product. *Expect:* the form says the organization starts on
   the Free plan and that its name and plan, and the name and email of everyone in it, are visible
   to whoever runs this WhatBuild. The product opens. Its Plan page (account menu) says Free, with
   what it holds: 1 of 2 people, 1 of 1 products, and storage.
4. **MCP, as Ana, on an Admin connection** (`--level admin`: starting an organization needs one).
   *Expect:* `create_tenant` is not among her tools, since she may not start another. Call
   `products_write(action="create_tenant")` with another name anyway. *Expect:* `403 tenant_allowance`,
   saying the account already has a Free organization, all it may have, and that the people who run
   this WhatBuild can move it to another plan, which frees its place. Nothing is made.
5. **Web, as Riley.** On Organizations, find Ana's organization: Free, "1 person", started by Ana.
   Open **Change plan**, choose Pro and press **Move to Pro**. *Expect:* the dialog offers Free, Pro
   (with its price if one is set) and Unlimited, the current one marked; the toast says it is on
   Pro, and the row's badge says Pro. Under Who can start organizations, without a reload, Ana "has
   0" again, with "1 left".
6. **Web, as Ana.** Start a second organization. *Expect:* it is allowed and starts on Free; the
   first one's Plan page says Pro.
7. **Web, as Riley.** Open Change plan for Ana's first organization (now Pro) and choose Free.
   *Expect:* before moving it, a note says it will be read-only: Ana already has a Free
   organization, with no room for another, everyone in it can still read, export and delete what it
   holds, and take people out, it is kept for a year and its owners are told by email, and another
   plan makes it writable again. Press **Move to Free**. *Expect:* the toast says it is read-only,
   gives the date it is kept until, a year from today, and that its owner was told by email; the
   row shows Read-only beside Free and "Kept until <date> · 365 days left". Ana's mail (the
   terminal, locally) says it is read-only, what can still be done, and the day it is kept until,
   marked UTC.
8. **Web, as Ana, in the read-only organization.** Open its product. *Expect:* a notice above every
   screen says the organization is read-only, that it went back to the plan new organizations
   start on while whoever started it already has one there, so nothing new can be added, that
   everyone can still read, export and delete what it holds, and take people out, as their roles
   allow (the same sentence on its Plan page), and until when it is kept, with **See plan**. Its
   Plan page shows Free with Read-only, and a note headed "Kept until <date> · 365 days left".
   Look for a way to add a source, an outcome or a note. *Expect:* none is offered, and the empty
   states ask nobody to add one; opening `…/evidence/new` directly says the organization is
   read-only instead of showing the form. Its Members page says it is read-only, with no Give
   access and no change of role, while removing a role and cancelling an invitation are still
   offered. Start an export from the product's Settings. *Expect:* it is made and downloads, and
   its Plan page's Today counts the export without a reload.
9. **MCP, as Ana.** `products_read(action="list")`. *Expect:* the read-only organization's tenant has
   `read_only` with `since` and `kept_until`. Create a source in its product. *Expect:*
   `409 organization_read_only`, with `read_only_since` and `kept_until` in its details, the
   same date in its message as the web gave, and the same sentence of what still works, changing
   nothing. Reading its sources works.
10. **Web, as Riley.** Move it back to Pro. *Expect:* Read-only is gone from its row; as Ana, the
    notice is gone after a reload and adding a source works.
11. **Web, as Riley.** Find Ana's second organization (Free, not read-only) on Organizations and
    press **Delete**. *Expect:* the dialog says everything in it goes at once (its team and product)
    and that one person loses their roles there, asks why, and asks for its name to be typed;
    Delete permanently stays disabled until the name matches. Delete it. *Expect:* a toast, and the
    row is gone, and Who can start organizations shows Ana with "has 0" without a reload: its place
    is free. As Ana, the organization is gone from the overview and the panel.
12. **Web, as Riley.** Look at the example organization's row. *Expect:* Rename and Change plan,
    but no Delete. The names of organizations Riley is not in, such as the synthetic one, link
    nowhere. Open Change plan for the synthetic organization and choose Free. *Expect:* no note that
    it will be read-only: Morgan, who started it, has no Free organization, and everyone has a place
    for one even without an allowance to start one. Cancel.
13. **Web, as Ana, in her remaining organization (Pro).** Invite Ben by address as an editor of its
    team. Then **web, as Ben,** sign in: the organization and its product are there.
14. **Web, as Riley.** Open People (account menu). *Expect:* every account, Ana as owner of her
    organization and Ben with a role in it; Riley marked You and Owns this WhatBuild, with no
    Remove. Press **Remove** on Ben. *Expect:* the dialog says what happens (signed out
    everywhere, his role taken with a record in the organization's access log, his invitations and
    address gone, his name kept on what he wrote), with no organization to delete, and asks for his
    address typed. Remove him. *Expect:* he leaves the list; as Ana, the organization's members no
    longer list him, and its access log records his removal by an owner of this instance.
15. **Web, as Riley.** On People, press **Remove** on Ana. *Expect:* a note says her organization is
    deleted too, since she is its only owner, and lists what it holds (its product by name, its
    sources); the button says "Remove account and delete <her organization>". Cancel instead.
16. **Web, as Ana.** Invite Cleo to the organization as an owner; **as Cleo,** sign in, so it has
    two owners. **Web, as Riley,** press Remove on Ana. *Expect:* no organization is deleted this
    time: the dialog says only that she loses her roles. Remove her. *Expect:* as Cleo, the
    organization and its product are still there, and its access log records Ana's removal.
17. **Web, as Riley.** Remove Cleo, now the organization's only owner. *Expect:* the dialog names
    the organization as deleted too, with what it holds, and, since she is in no other
    organization, nothing about anything she added staying. Type her address and confirm. *Expect:* the toast says the account
    is removed and the organization deleted; the organization is gone from Organizations, and Cleo
    from People. The email the server's log prints for her names the organization as deleted with
    her account. Signing in again as Cleo's address finds no
    organization of hers: she is a guest of the example.
18. **MCP, as Riley.** List the tools. *Expect:* none of the instance owners' actions
    (`organizations`, `set_plan`, `set_plan_limits`, `guests`, `set_guests`, `tenant_allowances`,
    `set_tenant_allowance`, `remove_tenant_allowance`, `accounts`, `usage`), nor `remove_account`,
    `delete_tenant` or `delete_tenant_impact`, and no tool's description speaks of running this
    WhatBuild. Call `products_read(action="organizations")` and
    `products_write(action="set_plan")` (the synthetic organization, `pro`) anyway. *Expect:* each
    answers `403 web_only`, saying a person does it in the web app and where (Organizations,
    `/instance`; Change plan on the organization's row), and that it is not a tool list from
    another version; nothing asks for a new session, and the organization's plan is unchanged on
    the web. `products_write(action="rename_tenant")` on the synthetic organization, which Riley is
    not in, with its `name_etag` from Organizations, answers `404`, and its name is unchanged:
    Riley renames it only on the web.
19. **MCP and web, as Morgan.** Morgan owns the synthetic organization and runs nothing else. List
    the tools. *Expect:* none of the actions in step 18; `products_read(action="accounts")` called
    anyway answers `403 web_only` too, naming People. On the web, Organizations and People say only
    this WhatBuild's owners see them; the synthetic organization's Members page (account menu)
    offers Morgan, as its owner, to delete it, and Riley's Organizations page offers it too.

## Look out for

- Any screen where an instance owner's action reaches into an organization's content: the
  instance's pages list organizations and people, never products or sources, except what a delete
  says it will destroy.
- Counts that disagree between Organizations, Who can start organizations, People and the
  organization's own Plan page, above all "has N" after a move to Pro, a deletion or a removal.
- A refusal (read-only, one Free organization, last owner) whose message does not say what to do
  next, or one that changed something.
- Dates: "Kept until" the same on the banner, the Plan page, Organizations, the toast and every
  refusal, web and MCP.
