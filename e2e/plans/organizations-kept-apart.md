---
title: People of one organization see nothing of another, and one person's role follows the organization
organizations: [synthetic, standard, example]
people: [morgan, casey, avery, sam]
surfaces: [web, mcp]
---

# Organizations kept apart

Every organization's people share one database, and what keeps them apart is the server's
checks and Postgres's row-level security ([spec §3.6](../../okf/spec/03-accounts-teams-and-identity.md)).
The server's tests call every operation across organizations; this plan does what a person and their
agent would actually try, through the web app and MCP, with people who belong to one organization
only, and with Sam, who edits in two organizations and only reads the Story in the third.

Something a person has no role on is absent to them: `404 not_found`, never `403`, so nothing says
it exists. The example organization is the exception everyone reads.

## Steps

1. **Web, as Morgan (owner of the synthetic organization).** Sign in. *Expect:* the overview lists
   the synthetic organization with its one product, and the example organization as a worked
   example, Read only; the standard organization is nowhere: not on the overview, the account menu
   or the organization switcher. Note the address of a source in Crewboard for later steps.
2. **Web, as Morgan.** Open the synthetic organization's members page. *Expect:* Morgan, Casey,
   Avery and Sam are listed with their roles (Sam a reader of Crewboard's Story), and nobody from
   the other organizations.
3. **Web, as Morgan.** Open, by its address, a product of the standard organization (its path is in
   `pnpm e2e run`'s output), then one of its sources by its address, taken from a session as Sam.
   *Expect:* a not-found screen, the same as for an address that never existed, with no title,
   name or count from the standard organization on the way.
4. **Web, as Casey (editor).** Sign in, open Crewboard, and search from the panel for a word you can
   see in one of the standard organization's sources (take it as Sam first). *Expect:* search finds
   nothing from another organization; search for a word from a Crewboard source finds it.
5. **MCP, as Casey.** `products(action="list")`. *Expect:* Crewboard with `your_role` editor, and the
   example organization's products with `your_role` guest; nothing from the standard organization. Then call
   `sources` `get`, `derived` `text` and `search` with the standard organization's product path and
   with a source id from it. *Expect:* each answers `404 not_found`, with none of its data.
6. **MCP, as Casey, at the standard organization's endpoint** (`--endpoint /mcp/t/<standard slug>`).
   *Expect:* the connection is refused, or every call answers as for something absent; never a list
   of its products.
7. **MCP, as Casey, with a scoped endpoint** (`--endpoint /mcp/t/harbor-labs/<team>/crewboard`).
   Call `products(action="list")`, then `sources` `list` for a product in the example organization.
   *Expect:* the list holds Crewboard alone; the example's product is refused with
   `403 outside_connector_scope`, even though Casey may read it elsewhere.
8. **Web and MCP, as Casey.** Write in Crewboard: add a source over MCP (synthetic text from the
   run's folder), and comment on it on the web. *Expect:* both work and are attributed to Casey.
   Then try the same writes in the example organization. *Expect:* refused with
   `403 example_read_only`, which over MCP tells Casey to do their own work in an organization they
   are in, not to create one.
9. **Web and MCP, as Avery (reader).** Sign in, and open Crewboard's Evidence by its address; over
   MCP, list Crewboard's sources. *Expect:* the web takes Avery to the Story, which reads; MCP
   refuses the sources clearly (not an empty list). Avery sees nothing of the standard organization.
10. **Web, as Sam.** Sign in. *Expect:* the overview shows the example and the standard organization
    with every product, and the synthetic organization with Crewboard, where Sam reaches only the
    Story; opening Crewboard's Evidence by its address takes Sam to its Story. In the standard
    organization, Sam still edits: add a comment to a source, then archive it.
11. **MCP, as Sam.** `products(action="list")`. *Expect:* `your_role` editor in the example and the
    standard organization, reader for Crewboard. Over the same connection, list sources in a
    standard product (works) and in Crewboard (refused, as a reader's).
12. **Web, as Morgan.** Open the synthetic organization's activity, then Crewboard's. *Expect:* Casey's
    source and comment from step 8 are there; nothing from Sam's step 10 in the standard
    organization is.

## Look out for

- A name, title or count from one organization in another's screens, search results, toasts, page
  titles or error messages.
- `403` where the plan expects `404`, which says the thing exists.
- Sam's role in one organization leaking into another: editing in Crewboard, or reading only the
  Story in the standard organization.
- The overview's tiles and the organization switcher disagreeing about which organizations a person
  has.
