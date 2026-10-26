---
title: A person deletes their own account after reading what goes and what stays; what blocks it says how to clear it, and what they wrote keeps their name
organizations: [standard, example]
people: [riley, sam, guest]
surfaces: [web, mcp]
---

# Deleting your own account

Deleting an account is a person's act in the web app, never an agent's. The page says what goes
and what stays before anything can be confirmed, names whatever stands in the way with a way out
of each, and asks for the address typed exactly. Afterwards the person is signed out everywhere,
their roles are gone with a record in each organization, what they wrote keeps their name, and a
record goes to their address. The plan deletes only an account it makes in the run: the
**leaver**, at an address of the run's own, such as `leaver-<the run's time>@example.com`.

## Steps

1. **MCP, as Sam and as Riley, each at `--level admin`.** List the tools, then call
   `products(action="delete_account", email: "<their address>", confirm: "delete permanently")`.
   *Expect:* `products` offers neither `delete_account` nor `delete_account_impact`; the call
   answers `unknown_action`; `products(action="list")` still works for both.
2. **Web, as Riley.** From Settings, open Delete your account. *Expect:* the link sits in Settings'
   foot beside Privacy, not beside Sign out everywhere. The page says what goes at once and what
   stays before anything else, with Riley's browsers, organizations and roles, and that backups
   age out within 35 days. Below it, **You own this WhatBuild**, and, for each organization Riley
   alone owns, the organization's name with Make someone else owner (and Delete it, but not for
   the example organization). There is no address field and no Delete my account. Leave by the
   Settings link; nothing changed.
3. **Web, as Riley.** Let the leaver's address start one organization (People or Organizations),
   and in the standard organization's Members give it the editor role on a team. *Expect:* an
   invitation waiting, with its link shown.
4. **Web, as the leaver.** Sign in with the leaver's address. Add a source to a product of the
   standard organization, with a synthetic text from the run's folder carrying a phrase of its
   own. Start an organization of their own, with a made-up name. Then **MCP, as the leaver**:
   connect and call `products(action="list")`. *Expect:* both organizations listed.
5. **Web, as the leaver.** Open Delete your account. *Expect:* what goes names both organizations
   with the leaver's role in each, the browsers and the one agent signed in. **You're the only
   owner of** their organization, with Make someone else owner and Delete it, and no address field.
   Follow Delete it. *Expect:* that organization's Members, scrolled to Delete this organization.
   Delete it, then go back to Delete your account. *Expect:* nothing blocks it now: the address
   field, Keep my account, and Delete my account, which stays disabled.
6. **Web, as the leaver, only if the page says Sign in again to continue** (the leaver signed in
   more than 15 minutes ago). Press Email me a sign-in link, take the link from the instance's
   log (`.what-build/e2e/server.log`) and open it. *Expect:* back on Delete your account, with the
   address field; the hint says until when this sign-in may delete.
7. **Web, as the leaver.** Type another address and leave the field. *Expect:* it says that isn't
   their address, and Delete my account stays disabled. Type their own address in other letter
   case, and press Delete my account. *Expect:* **Your account is deleted**, signed out, repeating
   what went and what stays, and saying a record went to the address. Opening the app goes to
   sign-in. The instance's log shows the record mailed to the address: from a browser signed in as
   them, what went, what stays, the 35 days, and whom to tell if it wasn't them.
8. **MCP, as the leaver, on the connection from step 4.** Call `products(action="list")`.
   *Expect:* refused as signed out; the connection is gone.
9. **Web, as Riley.** The standard organization's Members, then a search for the leaver's phrase,
   then People. *Expect:* the leaver holds no role, and Access changes records that they left the organization by deleting their account, under their name.
   The source they added is found and still attributed to their name. People does not list their
   address.
10. **Web, the leaver's address again.** Sign in with it. *Expect:* a new, empty account: no role in
    the standard organization, no organization of its own, the example organization as a guest.
    (The development sign-in lets any address in; a deployment where sign-up is limited asks for
    it to be let in again.)
11. **Web, signed out, then as Sam.** Open Privacy. *Expect:* under What you can do, Delete your
    account says what goes and what stays in the same words as the page, and its link opens the
    page for Sam, who reaches the address field and leaves by Keep my account. At phone width and
    in the dark theme, the page reads in order, Keep my account before Delete my account.

## Look out for

- Anything that says deleting an account removes what the person wrote, or that it can be undone.
- Delete my account reachable while something blocks it, or before the address is typed exactly.
- Different words for the same terms on the page, the deleted page, Privacy and the record mail.
- A refused delete that leaves the person unsure whether their account went.
- Anything of Riley's, Sam's or the standard organization's changed, other than the leaver's role
  there.
