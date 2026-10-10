---
name: test-on-a-copy-of-production
description: Pull a private copy of the production deployment's database and files, load it into the local app, and serve it with pending migrations applied. Use it for manual QA, agent-driven end-to-end tests, or trying a release's migrations on real data before production. Use it when asked to test or QA against production data, real data, a production copy, dump or fixture, to try a migration on the deployment's data, or to serve that copy locally.
---

# Test on a copy of production

You are putting the production deployment's data into the local app, so that someone can test
against it. The knowledge, with every command, is in `okf/operations/a-copy-of-production.md`.
Read it before the first command. This file says how to conduct the work.

## What must stay true

- **The copy is real people's data.** It stays in `.what-build/`, on this machine. Never commit
  it, upload it, or paste or quote it into the repository, a commit message, an issue or a pull
  request. That includes names, addresses, organizations, titles and text. In your report to the
  person you may say what you saw. In anything published, describe it in general terms
  ("a product with 35 moved items").
- **Production is read, never written.** The pull reads through the backup role and the files
  bucket. Never use the application's own database secret, and never run anything against the
  deployment's database or bucket that changes them.
- **Leave the synthetic data alone.** The copy is the `fixture` database. Do not drop or reseed
  `whatbuild`.
- **This copy is local.** Never load a pull into the dev deployment; it takes its own copy from
  production, with the `rehearse-on-the-dev-deployment` skill, which also rehearses a release's
  deploy rather than only its code.

## Procedure

1. **Choose the copy.** Pull a fresh one with `pnpm fixture pull` unless the person names an
   existing pull. `ls .what-build/fixtures` lists the pulls.
2. **Load it.** Stop any running `pnpm dev` or `pnpm dev:fixture`, then run `pnpm fixture load`.
   It prints the organizations, products and accounts in the copy, and the last migration it has.
3. **Serve it.** Run `pnpm dev:fixture` in the background with a long time limit, and wait for the
   app to answer on `http://localhost:5273`.
4. **Check the start.** Read the log:
   - there is a `migrated …` line for each new migration;
   - each job they queued finished;
   - nothing failed.

   A migration or job that fails on the copy is a finding to report, not something to repair in
   the database.
5. **Sign in** with one of the sample people:
   - Riley Chen (`riley@example.com`) owns every organization;
   - Sam Okafor (`sam@example.com`) is an editor on every team;
   - Jordan Ellis (`jordan@example.com`) reads only the Stories.

   Prefer them over an account from the copy, so that nothing you do is attributed to a real
   person. In a browser script, use `POST /auth/dev-sign-in` with `{"email": …}` from the page.
6. **Test** what the person asked about. To run the end-to-end test plans on the copy rather than
   test by hand, build the golden master from the pull (`pnpm e2e golden`) and use the
   `run-end-to-end-tests` skill. To start again from the pulled state, stop the server and
   load again.
7. **Report** to the person:
   - which pull you used;
   - what migrated;
   - what you checked, what failed, and what you could not check.

## When the guide is wrong

If a command fails because the guide is out of date, correct
`okf/operations/a-copy-of-production.md` with the `okf-update` skill. Do not record the session
itself in the repository.
