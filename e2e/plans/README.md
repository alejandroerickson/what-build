# End-to-end test plans

Each file here is a plan an agent follows against the end-to-end instance: it drives the web app
with `pnpm e2e browser` and the MCP server with `pnpm e2e mcp`, as a person and their agent would,
and reports what failed and anything else that looked wrong. The procedure is the
`run-end-to-end-tests` skill; the system is described in
[`okf/operations/end-to-end-tests.md`](../../okf/operations/end-to-end-tests.md).

## What a plan runs on

The golden master is built from a private copy of production. It holds two organizations with the
same products:

- **the sandbox organization**, the deployment's public sandbox, with its settings, limits,
  baseline and invitations;
- **the standard organization**, a copy of the same content that is not a sandbox.

`pnpm e2e run <plan>` prints their slugs and every product's path. The same three people are in
both: Riley owns each organization, Sam edits every team, and Jordan reads every product's Story.

The content is real people's data. A plan never names or quotes it: it says "a product with
sources", "a passage you can see", "the archived product", and the agent finds one in the run. Text
a plan uploads is synthetic and written by the agent into the run's folder.

## Writing a plan

A plan says what to do and what should happen, in the product's vocabulary, not which element to
click. The agent finds the way through the interface, so a plan keeps working when a screen is
redesigned, and the agent's trouble finding the way is itself a finding.

```markdown
---
title: One line saying what the plan covers
organizations: [standard, sandbox]  # where it runs
people: [sam, jordan]               # who it signs in as, on the web and over MCP
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
- Say who acts, through which door and in which organization. A step that writes through one door
  and reads through the other is the most valuable kind; so is doing the same thing in both
  organizations and comparing.
- Expectations are things a person could check: what a screen shows, what a call returns, what
  the activity log says, who something is attributed to.
