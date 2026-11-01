---
title: An organization's owner starts it, fills it within Free's totals, manages its people, renames it and deletes it
organizations: [synthetic]
people: [riley, morgan, casey, guest]
surfaces: [web, mcp]
---

# Running an organization of one's own

What the owner of a Free organization does with it, start to finish: start it, invite people up to
Free's totals (an invitation holds a place; a reader of the Story is free), change and take away
roles, cancel an invitation, rename it, read its Plan page, and delete it. And what someone invited
into it may do: find the invitation when they sign in, accept or decline it, and start one of their
own, when they are allowed one. It makes its own people and
organizations, and deletes only those. Free is the plan new organizations start on in
`deploy/plans.example.json`, which the end-to-end instance offers.

Use addresses of the run's own at `example.com`, made from the run's folder time, such as
`dana-<run>@example.com`. Below, **Dana** owns the organization and **Eli**, **Fay** and **Gus**
are people she invites.

## Steps

1. **Web, as Riley.** On Organizations, under Who can start organizations, use **Let someone start
   organizations** to give Dana's address an allowance of 1, telling her by email. *Expect:* the
   dialog asks for the address, a number, a note and whether to tell them; Dana is listed with
   "Can have 1 Free organization; has 0" and "no account yet". The server's log prints the email.
2. **Web, as Dana.** Sign in and start an organization with a product. *Expect:* it starts on
   Free; the panel shows it and its product; its Plan page says Free, "1 of 2" people.
3. **Web, as Dana.** On the organization's Members, invite Eli as an editor of its team. *Expect:*
   the invitation is listed as waiting, and the Plan page now says "2 of 2" people: an invitation
   holds a place.
4. **Web, as Dana.** Invite Fay as an editor too. *Expect:* refused: the organization holds all
   the people Free allows, and the message says what makes room (removing someone or cancelling an
   invitation) or that a larger plan would. Nothing is added.
5. **Web, as Dana.** Invite Fay as a reader of the product's Story instead. *Expect:* it works:
   readers of the Story don't count, and the Plan page still says "2 of 2". Then invite Morgan,
   who has an account in the synthetic organization, as a reader too. *Expect:* Morgan's address
   is treated as any other: an invitation waiting under its address, no name, nothing said of an
   account, and Morgan not among the members.
6. **Web, as Eli.** Sign in with Eli's address, without the link. *Expect:* signing in joins
   nothing: Eli is not in the organization, and above the screen (or on `/welcome`) an invitation
   names the organization, the role and Dana, in quotation marks, with Accept and Decline. Accept it.
   *Expect:* a toast names the organization and role, and Eli sees it and edits its product: add a
   source with a short synthetic text written into the run's folder. **As Fay,** open the invitation's
   link and sign in. *Expect:* the page asks, and opening it changed nothing, as Dana's Members page
   shows. Accept. *Expect:* the product opens on its Story and nothing else. Open the link again.
   *Expect:* it says Fay is already in. **As Morgan,** sign in, find the invitation among Morgan's
   own organization's screens, and press Decline. *Expect:* it leaves without a reload, and focus
   stays on the page. **As Dana:** Morgan's address has left Waiting to join, and the access log says
   Someone declined an invitation to the product, with no name or address. Opening its link as
   Morgan says it is no longer open.
7. **Web, as Dana.** Change Eli to a viewer, then Remove from organization (Remove role would keep
   him a member). *Expect:* each change is
   listed in the organization's access log, by Dana; as Eli, after a reload, the product is read
   only, then gone. His source stays, with his name on it.
8. **Web, as Dana.** Invite Gus as an editor, then cancel the invitation before he signs in.
   *Expect:* the Plan page goes back to the people it held before; signing in as Gus finds no
   organization of Dana's and no invitation, and its link says it is no longer open.
9. **Web, as Dana.** Rename the organization on its Members page, changing its short name in links.
   *Expect:* the form says links with the old short name keep leading to it; the panel and the overview show the
   new name; an address with the old short name leads to the new one.
10. **Web, as Dana.** On the overview, open New product. *Expect:* the dialog says the
    organization holds all the products Free allows, archived ones included, that deleting one
    makes room, and that it takes an admin of that product, and Create product stays disabled, even
    with a name typed.
    Cancel. **MCP, as Dana.** `products_read(action="limits")` for her organization. *Expect:* `plan` free,
    `holds` with the people, products, sources and storage the Plan page showed, and every limit
    with its value and what Dana used today. `products_read(action="list")` gives the tenant's new slug
    and the old one under `former_slugs`.
11. **Web, as Eli** (now in no organization). Eli is a guest of the example again: sign in and
    find Ask for your own organization on the overview. Ask. **As Riley,** let Eli start one from
    the Waitlist. **As Eli,** start an organization. *Expect:* Eli owns his own Free organization;
    being invited elsewhere earlier never counted against him.
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
13. **Web, as Dana.** On the organization's Members page, delete it: the dialog lists what goes
    (its team, its product with its sources, and how many people lose their roles), asks why and
    for its name typed. *Expect:* it goes, and Dana's overview offers Start your organization
    again without a reload; as Fay, its Story is gone; as Riley, Organizations no longer lists it
    and Who can start organizations shows Dana with "has 0" again.
14. **Web, as Riley.** Clean up: remove the accounts this run made (People, Remove), including Eli,
    the only owner of his organization, which the dialog names and deletes with him, and the email
    the server's log prints for him names.

## Look out for

- The people total counting a reader of the Story, or not counting a waiting invitation.
- Archiving or restoring that makes room under a total, where only deleting does.
- Anyone in an organization they did not accept: after signing in, after opening a link, or after
  declining. An invitation shown to the wrong account, or one cancelled or expired still offered.
- A decline that names who declined anywhere the inviter reads, or keeps its place in the people total.
- A role change or removal that does not reach an open browser or agent on its next call.
- Anything left behind after a delete: the organization in a panel, a product reachable by its old
  address, a place still counted in its owner's allowance.
