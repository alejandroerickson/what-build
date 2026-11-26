# End-to-end test plans

Each file here is a plan an agent follows against the end-to-end instance: it drives the web app
with `pnpm e2e browser` and the MCP server with `pnpm e2e mcp`, as a person and their agent would,
and reports what failed and anything else that looked wrong. The procedure is the
`run-end-to-end-tests` skill; the system is described in
[`okf/operations/end-to-end-tests.md`](../../okf/operations/end-to-end-tests.md).

## What a plan runs on

The golden master is built from a private copy of production, and one organization made up for
the tests. It holds three organizations:

- **the example organization**, the one the deployment names as its example, which every account
  reads;
- **the standard organization**, a copy of the example's content that is not the example;
- **the synthetic organization** (Harbor Labs, with the product Crewboard), the development sample,
  whose content is made up and whose people belong to it alone.

`pnpm e2e run <plan>` prints their slugs and every product's path. The same three people are in
the example and the standard organization: Riley owns each, Sam edits all products, and Jordan reads
every product's Story. Because they are members of the example, they work there as anywhere. The
synthetic organization has its own: Morgan owns it, Casey edits all its products and Avery reads its Story.
None of them is a member of the other two, so each is a guest of the example and has nothing to do
with the standard organization. Sam reads its Story, and nothing more there: one person with a
different role in each organization. **A guest** of the example is
anyone else: sign in with any address that is not one of theirs, such as `guest@example.com`
(`pnpm e2e browser signin guest@example.com`, `pnpm e2e mcp --as guest@example.com …`; after the
instance was served again, run `pnpm e2e mcp connect --as guest@example.com` first, since a guest's
saved connection names an account the fresh copy no longer has). A guest
reads every product of the example and is refused every write with `403 example_read_only`, and
holds no organization of their own.

**The tutorials.** Whoever can edit a product, and a guest of the example, is offered the web
app's tutorial at 1024 pixels wide or wider: on the first screen with a product's panel
(often the overview, right after signing in), a welcome over a darkened screen, once in the
example and once more on the first product of their own; after it, each of
a product's pages starts a short tutorial of its own the first time it is opened. None of the people
above has been shown any in a fresh copy, nor has any new account. Unless the plan is about the
tutorials ([`the-tutorial.md`](the-tutorial.md)), press **Turn off tutorials** on the welcome and
go on: the welcome is expected, not a finding, and off, no page's tutorial interrupts the plan. A
welcome closed any other way (Not now, Esc) is not offered there again, and each page's own
tutorial then starts the first time that page is opened, over the screen; it is expected too, and
**Turn off tutorials** in its foot turns them all off.

A plan never names or quotes the content, which is a copy of production: it says "a product with
sources", "a word you can see in a source's text", "the archived product", and the agent finds one
in the run. Text a plan uploads is synthetic and written by the agent into the run's folder.

## Writing a plan

A plan says what to do and what should happen, in the product's vocabulary, not which element to
click. The agent finds the way through the interface, so a plan keeps working when a screen is
redesigned, and the agent's trouble finding the way is itself a finding.

```markdown
---
title: One line saying what the plan covers
organizations: [standard, example]  # where it runs: standard, example, synthetic
people: [sam, jordan, guest]        # riley, sam, jordan, morgan, casey, avery, guest
surfaces: [web, mcp]
---

# The title

Why the plan exists, in two or three sentences.

## Steps

1. **Web, as Sam, in the standard organization.** What to do. *Expect:* what should be true afterwards.
2. **MCP, as Sam.** …

## Look out for

What is easy to get wrong here, and worth a closer look.
```

- Number the steps; the report refers to them.
- Say who acts, through which door and in which organization (standard, example or synthetic). A step that writes through one door
  and reads through the other is the most valuable kind; so is doing the same thing in both
  organizations and comparing.
- Expectations are things a person could check: what a screen shows, what a call returns, what
  the activity log says, who something is attributed to.
