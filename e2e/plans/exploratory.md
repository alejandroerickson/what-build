---
title: An open-ended look for anything wrong, on every screen, as each role
organizations: [standard, example]
people: [riley, sam, jordan, guest]
surfaces: [web, mcp]
---

# Exploratory

No script: use the product the way a new team would, and report whatever is broken, confusing,
inconsistent or slow. This plan finds what the other plans did not think to check. Spend about as
long on it as the person asked for; by default, cover every screen once.

## Steps

1. **Web, as Sam.** Work through the product as a new editor would: read the Idea and open each
   card's More info (by mouse and by keyboard; the picture stays in view, the text scrolls within
   its card), drag an outcome to another place and move one back with its number and the arrow
   keys (the order holds after a reload), add a source, look at mockups, add an assumption, read the Story. Use the keyboard alone for
   at least one task.
2. **Web, as Sam.** Try the edges: an empty title, a very long title, text with emoji and
   right-to-left script, a file no parser reads, the back button after a save, two tabs editing
   the same thing.
3. **MCP, as Sam.** Do the same tasks over MCP, following only the tool descriptions, `describe`,
   and the `guide` tool. *Expect:* the guidance is enough to succeed without guessing;
   errors say what to do next.
4. **Web, as Riley and as Jordan.** Repeat a short tour as each, checking that what each sees
   matches their role.
5. **The example organization, as a guest.** Sign in with "As the email above" and an address that
   is not one of the sample people, such as `guest@example.com`. Look at what a guest sees first,
   whether it is clear the example is read-only and where their own work goes, what every write
   control does there, and the way to start an organization of their own.
6. **Everywhere.** At phone width and in the dark theme, revisit the screens you used.

## Look out for

- Anything that contradicts `apps/web/DESIGN.md` or the vocabulary in `okf/spec/01-product.md`
  (for example "delete" where the product archives).
- Copy that is unclear, or an error that does not say what to do.
- Differences between what the web and MCP say about the same thing.
- Anything slower than a second without a visible sign that it is working.
- Behavior that differs between the two organizations where the example's being read-only to
  guests does not explain it.
