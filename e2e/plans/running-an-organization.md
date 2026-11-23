---
title: An organization's owner starts it, fills it within Free's totals, manages its people, renames it and deletes it
organizations: [synthetic]
people: [riley, morgan, casey, guest]
surfaces: [web, mcp]
---

# Running an organization of one's own

What the owner of a Free organization does with it, start to finish: start it, invite people up to
Free's totals (an invitation holds a place; a Story reader is free), change and take away
roles, cancel an invitation, rename it, read its Plan, and delete it, all in Settings. And what someone invited
into it may do: find the invitation when they sign in, accept or decline it, and start one of their
own, when they are allowed one. It makes its own people and
organizations, and deletes only those. Free is the plan new organizations start on in
`deploy/plans.example.json`, which the end-to-end instance offers.

Use addresses of the run's own at `example.com`, made from the run's folder time, such as
`dana-<run>@example.com`. Below, **Dana** owns the organization and **Eli**, **Fay** and **Gus**
are people she invites.

## Steps

1. **Web, as Riley.** In Instance admin (account menu) → Starting organizations, under Who can start
   organizations, use **Let someone start organizations** to give Dana's address an allowance of 1, telling her by email. *Expect:* the
   dialog asks for the address, a number, a note and whether to tell them; Dana is listed with
   "Can have 1 Free organization; has 0" and "no account yet". The server's log prints the email.
2. **Web, as Dana.** Sign in and start an organization with a product. *Expect:* it starts on
   Free, and the product opens on Idea under **Connect your agent**, since Dana has no agent
   connected: "Not connected yet" at its right, a choice of Claude, Claude Code or Another agent,
   and four numbered steps for the one chosen. Nothing closes it; leave it and go on from the panel.
   The panel shows the organization and its product, its seat saying only "No agent connected",
   with Connect an agent;
   Settings (the panel's Settings row) lists the product's General, People, Playbook and Export, the
   organization's General, People, Plan and Access changes, and Account and Agents; its Plan says
   Free, "1 of 2" people.
3. **Web, as Dana.** In Settings → the organization's People, press **Add people**, choose all
   products under Where (the title says "Add people to all products"), and invite Eli as an
   editor. *Expect:* the invitation is listed as waiting, and Plan now says "2 of 2" people: an invitation
   holds a place. The server's log prints the email: its subject and first line name Dana and the
   organization as plain names, with no quotation marks, the first line with Dana's own address in
   parentheses after her name; a sentence on what WhatBuild is follows (with "There’s more at <the
   site>." only where the deployment has a public site), then "Accept or decline, signing in as
   <Eli's address>:", the link, and "The link works for 7 days."
4. **Web, as Dana.** Invite Fay as an editor too. *Expect:* refused, in the app's own words: "<org>’s
   Free plan holds 2 people", then "No places are left for <Fay's address>. Cancel an invitation.
   Story readers don’t count." (Eli's invitation is open, and nobody but Dana has a role to remove) and a Compare plans link that opens the plans in a new tab. No role
   name in code form, and nothing about whoever runs WhatBuild. Nothing is added.
5. **Web, as Dana.** Invite Fay as a Story reader of the product instead. *Expect:* it works:
   Story readers don't count, and Plan still says "2 of 2". Then invite Morgan,
   who has an account in the synthetic organization, as a Story reader too. *Expect:* Morgan's address
   is treated as any other: an invitation waiting under its address, no name, nothing said of an
   account, and Morgan not among the members.
6. **Web, as Eli.** Sign in with Eli's address, without the link. *Expect:* signing in joins
   nothing: Eli is not in the organization, and above the screen (or on `/welcome`) an invitation
   asks "Join <org>?" and says "Dana (<Dana's address>) invited you as an editor.", with no quotation
   marks, with Accept and Decline. Accept it.
   *Expect:* a toast says "You’re in <org>, as an editor.", and Eli sees it and edits its product: add a
   source with a short synthetic text written into the run's folder. **As Fay,** open the invitation's
   link and sign in. *Expect:* the page asks, and opening it changed nothing, as Dana's People in
   Settings shows. Accept. *Expect:* the overview opens, listing the product with its Story alone;
   the panel beside it shows that product: Story, the No agent connected card (Fay has connected
   none), then Settings. Open the link again. *Expect:* it says Fay is already in. Open
   `/t/<org>/plan`. *Expect:* Settings opens over the Story at Account, listing only Account and
   Agents: nothing of the organization (no People, no Plan) or of the product, and the browser's
   console shows no refused request. **As Morgan,** sign in, find the invitation among Morgan's
   own organization's screens, and press Decline. *Expect:* it leaves without a reload, and focus
   stays on the page. **As Dana:** Morgan's address has left Waiting to join, and the access log says
   Someone declined an invitation to the product, with no name or address. Opening its link as
   Morgan says "This invitation can’t be used" and "This invitation expired, was cancelled or was
   declined. Ask whoever invited you for a new link."
7. **Web, as Dana.** Change Eli to a viewer, then Remove from organization (Remove role would keep
   him a member). *Expect:* each change is
   listed in Settings → the organization's Access changes, by Dana; as Eli, after a reload, the product is read
   only, then gone. His source stays, with his name on it.
8. **Web, as Dana.** Invite Gus as an editor, then cancel the invitation before he signs in.
   *Expect:* Plan goes back to the people it held before; signing in as Gus finds no
   organization of Dana's and no invitation, and its link says "This invitation can’t be used" and
   "This invitation expired, was cancelled or was declined. Ask whoever invited you for a new link."
9. **Web, as Dana.** Rename the organization in Settings → the organization's General, changing its
   short name in links. *Expect:* the form says links with the old short name keep leading to it;
   the product switch and the overview show the new name; an address with the old short name leads
   to the new one.
10. **Web, as Dana.** On the overview, open New product. *Expect:* the dialog says "<org>’s Free
    plan holds 1 product", that deleting one no longer needed makes room and archived ones count,
    with a Compare plans link, and Create product stays disabled, even with a name typed.
    Cancel. **MCP, as Dana.** `products_read(action="limits")` for her organization. *Expect:* `plan` free,
    `holds` with the people, products, sources and storage Plan showed, and every limit
    with its value and what Dana used today. `products_read(action="list")` gives the tenant's new slug
    and the old one under `former_slugs`.
11. **Web, as Eli** (now in no organization). Eli is a guest of the example again: sign in and
    find Start your own organization on the overview, and press it. **As Riley,** let Eli start one from
    the Waitlist under Starting organizations. **As Eli,** start an organization with a product.
    *Expect:* Eli owns his own Free organization, and its product opens on Idea under Connect your
    agent, as Dana's did in step 2 (Eli has no agent connected yet); being invited elsewhere earlier
    never counted against him.
    **MCP, as Eli, at the admin level.** Add a source to his product, archive it, and read
    `products_read(action="limits")`. *Expect:* `holds.sources` still counts it. Archive the product
    and try to create a second (`products_write(action="create")`). *Expect:* `409 quota_exceeded`
    with `quota` `products_max`, saying archived ones are included and that deleting makes room, and
    `holds.products` is unchanged. Restore the product. *Expect:* it is not refused. Delete it
    (`products_read(action="delete_impact")`, then `products_delete(action="delete")`) and create
    another. *Expect:* it is created.
12. **Web, as Morgan.** Morgan owns the synthetic organization and has no allowance. *Expect:* no
    way to start a second organization on the web; over MCP, `products_write(action="create_tenant")` is
    not offered, or is refused with `403 tenant_allowance` saying who decides.
13. **Web, as Dana.** In Settings → the organization's General, delete it: the dialog lists what goes
    (its product with its sources, and how many people lose their roles), asks why and
    for its name typed. *Expect:* it goes, and Dana's overview offers Start your own organization
    again without a reload; as Fay, its Story is gone; as Riley, Instance admin's Organizations no
    longer lists it and Starting organizations shows Dana with "has 0" again.
14. **Web, as Riley.** Clean up: remove the accounts this run made (Instance admin → People, Remove), including Eli,
    the only owner of his organization, which the dialog names and deletes with him, and the email
    the server's log prints for him names.

## Look out for

- The people total counting a Story reader, or not counting a waiting invitation.
- Archiving or restoring that makes room under a total, where only deleting does.
- Anyone in an organization they did not accept: after signing in, after opening a link, or after
  declining. An invitation shown to the wrong account, or one cancelled or expired still offered.
- A decline that names who declined anywhere the inviter reads, or keeps its place in the people total.
- A role change or removal that does not reach an open browser or agent on its next call.
- Anything left behind after a delete: the organization in the product switch, a product reachable by its old
  address, a place still counted in its owner's allowance.
