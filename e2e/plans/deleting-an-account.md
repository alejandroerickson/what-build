---
title: A person deletes their own account after reading what goes and what stays; what blocks it says how to clear it, and what they wrote keeps their name
organizations: [standard, example]
people: [riley, sam, guest]
surfaces: [web, mcp]
---

# Deleting your own account

Deleting an account is a person's act in the web app, never an agent's, in the Delete account
section of Settings. Opened, it says what deleting will do before anything can be confirmed, names
whatever stands in the way with a way out of each, and asks for the address typed exactly.
Afterwards the person is signed out everywhere, their roles are gone with a record in each
organization, what they wrote keeps their name, and a confirmation goes to their address. The plan
deletes only an account it makes in the run: the **leaver**, at an address of the run's own, such
as `leaver-<the run's time>@example.com`.

## Steps

1. **MCP, as Sam and as Riley, each at `--level admin`.** List the tools, then call
   `products_delete(action="delete_account", email: "<their address>", confirm: "delete permanently")`.
   *Expect:* no `products_` tool offers `delete_account` or `delete_account_impact`; the call
   answers `403 web_only`, saying where a person does it and that nothing was changed;
   `products_read(action="list")` still works for both.
2. **Web, as Riley.** Open Settings. *Expect:* Delete account is its own section, closed: one line
   and a Delete account… button, which reads as opening the section rather than deleting. Open it.
   *Expect:* what deleting will do, in the future tense, naming the organizations Riley would lose,
   and what stays; nothing about backups. Below it, **You own this WhatBuild**, and, for each
   organization Riley alone owns, its name with Make someone else owner (and Delete organization,
   but not for the example organization). There is no address field and no Delete account button.
   Cancel closes the section; nothing changed.
3. **Web, as Riley.** Let the leaver's address start one organization (People or Organizations),
   and in the standard organization's Members give it the editor role on a team. *Expect:* an
   invitation waiting, with its link shown.
4. **Web, as the leaver.** Sign in with the leaver's address. Add a source to a product of the
   standard organization, with a synthetic text from the run's folder carrying a phrase of its
   own. Start an organization of their own, with a made-up name. Then **MCP, as the leaver**:
   connect and call `products_read(action="list")`. *Expect:* both organizations listed.
5. **Web, as the leaver.** In Settings, open Delete account. *Expect:* it names both organizations
   as the ones they would lose. **You're the only owner of** their organization, with Make someone
   else owner and Delete organization, and no address field. Follow Delete organization.
   *Expect:* that organization's Members, scrolled to Delete this organization. Delete it, then go
   back to Settings and open Delete account. *Expect:* nothing blocks it now: the address field,
   Cancel, and Delete account, which stays disabled.
6. **Web, as the leaver, only if the section says Sign in again to continue** (the leaver signed in
   more than 15 minutes ago). Press Email me a sign-in link, take the link from the instance's
   log (`.what-build/e2e/server.log`) and open it. *Expect:* back on Settings with Delete account
   open, now with the address field.
7. **Web, as the leaver.** Type another address and leave the field. *Expect:* it says the address
   doesn't match, and Delete account stays disabled. Type their own address in other letter case,
   and press Delete account. *Expect:* **Your account has been deleted**, signed out, saying what
   stays and that a confirmation was emailed. Opening the app goes to sign-in. The instance's log
   shows the confirmation mailed to the address: what was deleted, what stays, and whom to contact
   if it wasn't them; nothing about backups.
8. **MCP, as the leaver, on the connection from step 4.** Call `products_read(action="list")`.
   *Expect:* refused as signed out; the connection is gone. The client stops at the 401, saying the
   address has no account here any more, and makes none.
9. **Web, as Riley.** The standard organization's Members, then a search for the leaver's phrase,
   then People. *Expect:* the leaver holds no role, and Access changes records that they left the
   organization by deleting their account, under their name. The source they added is found and
   still attributed to their name. People does not list their address.
10. **Web, the leaver's address again.** Sign in with it. *Expect:* a new, empty account: no role in
    the standard organization, no organization of its own, the example organization as a guest.
    (The development sign-in lets any address in; a deployment where sign-up is limited asks for
    it to be let in again.)
11. **Web, signed out, then as Sam.** Open Privacy from the sign-in page. *Expect:* it opens in a
    new tab on the public site's page (`/site/privacy/` here), and under What you can do, Delete your
    account links to Settings, where Delete account is open for Sam; he reaches the address field
    and leaves by Cancel. At phone width and in the dark theme, the section reads in order, Cancel
    before Delete account.

## Look out for

- Anything that says deleting an account removes what the person wrote, that it can be undone, or
  that it has already happened before the person confirms.
- Delete account reachable while something blocks it, or before the address is typed exactly.
- A refused delete that leaves the person unsure whether their account went.
- Anything of Riley's, Sam's or the standard organization's changed, other than the leaver's role
  there.
