---
name: azure-self-host
description: Create, check, update or remove a self-hosted WhatBuild deployment on Azure with the Azure CLI (Container Apps, Azure Database for PostgreSQL, Key Vault, a file share, and a Microsoft Entra app registration for sign-in with work accounts). Use when asked to host, deploy or self-host WhatBuild on Azure, to deploy a new version there, to set up or repair Microsoft sign-in for it, or to work out why an Azure deployment is failing. Not for the Cloud Run deployment.
---

# Self-host WhatBuild on Azure

You create and operate the deployment yourself, with `az`, on the person's signed-in CLI. There
is no setup script. The knowledge is in `okf/operations/azure.md`: the resources and their
settings, every command, sign-in, the variations, cost and removal. Read it in full before the
first command. This file is how to conduct the work.

## What must stay untouched

- **The Cloud Run deployment.** Never edit or run `deploy/cloud-run/`, `cloudbuild.yaml`,
  `deploy/cloudflare/`, or `.env` (it holds another deployment's values). Never run `gcloud`.
  Azure's values go in `.env.azure`.
- **The application.** Hosting needs no change to `apps/` or `packages/`. If something seems to
  need one, stop and say so. What the server lacks is already specified: an Azure Blob adapter
  (`okf/spec/02-architecture.md` §2.4).
- **The repository.** It is public. Subscription, tenant and client IDs, resource names, addresses
  and anything about the organization stay in `.env.azure` (gitignored) and in your own notes.
  Never commit them, and never write them into `okf/` or `deploy/azure/`.
- **Everything else in the subscription.** Work only inside the resource group for this
  deployment and on the one app registration. Never change or delete a resource you did not
  create in this work without the person saying so by name.

## Procedure

1. **Find where things stand.** Is there a `.env.azure`? If so, load it and check each resource it
   names (`az … show`) before creating anything: you may be continuing or repairing, not
   starting. Run `az account list -o table` to see which directories and subscriptions are signed
   in.
2. **Settle the questions** under "Before anything is created" in the guide. Ask the person in
   one round, offering the default for each. Do not guess a subscription, a directory, a region,
   who may sign up, or whether policy forbids public endpoints or storage keys. Learn what you can
   yourself first: `az policy assignment list` on the subscription shows whether region, tag,
   network or key policies exist.
3. **Say what you will create before you create it**: the resource table from the guide with the
   real names, the region, the rough monthly cost, and what sign-in will work on this build.
   Creating billable resources, role assignments and an app registration is the point at which
   to get a clear yes. Deleting anything needs its own yes, with the name.
4. **Write `.env.azure`**, then create in the guide's order. Each step depends on the one before:
   providers and group; registry and identity; vault and secrets; Postgres and its role; share
   and environment; image; migration job; app; checks.
5. **Sign-in.** Make the app registration in the identity directory, with the optional ID-token
   claims `email` and `xms_edov`, store its secret in the vault, and turn on the
   `WHATBUILD_MICROSOFT_*` settings, with the directory's own verified domains in
   `WHATBUILD_MICROSOFT_DOMAINS`. With neither the claim nor a listed domain, WhatBuild refuses
   every address the directory sends. Find the directory by what it holds (the people who will sign in),
   not by its name: `GET /organization` in Microsoft Graph names it and its verified domains, and
   `GET /users` shows who is in it. Set up email links too if the person wants them.
6. **Prove it works**: `/health`, `/api/v1/meta`, a sign-in, an upload that parses, and the file in
   the share. A deployment nobody has signed in to is not done; say which of these you could not
   do yourself and need the person for.
7. **Leave things tidy.** Remove the temporary firewall rule. Delete rendered files and exported
   source outside the clone. Put the CLI's active account back to what it was. Report what exists,
   by name, what it costs, what is not finished, and the dates on which secrets expire.

## How to work

- **Name the subscription on every command.** The CLI's default account is shared with every
  other terminal on the machine. `az ad` commands take no subscription: set the active account to
  the identity directory just before them, and confirm with `az account show` which directory you
  are in.
- **Never show a secret.** Generate it and store it in the vault in one command; read it back into
  a variable when a later step needs it. No `echo`, no file in the clone, no value in `.env.azure`
  or in your reply. `az keyvault secret set` and `az ad app credential reset` print values unless
  you send their output elsewhere.
- **Your shell may not persist** between commands. Load `.env.azure` and redefine `put` at the top
  of each one, and write every new name or ID into `.env.azure` as soon as it exists.
- **Check, then create.** Run a step twice and nothing should change. On a second run of the
  database step, the role exists: set its password instead of creating it.
- **When a command fails, read the error before retrying.**
  - *An unrecognized flag*: the CLI version differs from the guide. Read `az <command> --help`.
  - *`AuthorizationFailed` or `Forbidden` right after a role assignment*: it is still applying.
    Wait a minute or two; do not grant more.
  - *`RequestDisallowedByPolicy`*: the organization forbids what you asked for. Report the policy
    named in the error and what it wants (a region, a tag, private networking). Do not look for a
    way around it.
  - *A name is taken*: registry, vault, server and storage names are global. Change the suffix
    in `.env.azure`; a vault deleted in the last 90 days holds its name until purged.
  - *The region will not create the server*: some subscriptions cannot create PostgreSQL servers
    in some regions. Offer another region for everything, since the parts should sit together.
- **Wait for long steps, do not poll blindly.** The Postgres server and the environment each take
  several minutes; the commands return when they are done.
- **If the guide is wrong**, because a command has changed or a step is missing, fix
  `okf/operations/azure.md` in the same piece of work and send it back (below).

## Sending corrections back

The guide is a draft until deployments have been made with it, so expect to correct it. A
correction is a change to a public repository, made from a machine that belongs to an
organization, which is where care is needed.

- Correct `okf/operations/azure.md`, `deploy/azure/` or this skill so they state what works. Write
  what is true now, not an account of what went wrong (the `okf-update` skill; then
  `python3 okf/tools/validate_okf.py`).
- **Check who the commit will say made it** before committing: `git config user.name` and
  `git config user.email`. An organization's name or address must not enter the history. Set the
  committer's GitHub no-reply address for this clone only
  (`git config user.email <id>+<login>@users.noreply.github.com`), or give the person the diff to
  commit elsewhere.
- **Check what the diff carries.** Search it for the real subscription and directory IDs, the
  suffix, the resource names, the domain and the organization's name; none may appear. Examples
  use `example.com` and zeros.
- Put it on a branch, push over HTTPS, and open a pull request to `main`. Do not merge it from the
  operator's machine unless the person asks.

## Later tasks

- **A new version**: "Deploying a new version" in the guide. First read `upgrading.md` at the
  target ref for every release after the running version, and complete each applicable action.
  Run the guide’s Microsoft sign-in preflight against the live app registration and current
  public/custom URL before dispatching or approving a deploy. A failed or unreadable check
  blocks proceeding. Build the commit, verify the actual
  database backup retention and restore window, and record the pre-migration UTC time, server,
  backup metadata and previous/target images in the private deployment record before starting
  the migration job. Stop if recovery cannot be verified or recorded. Distinguish verified
  automatic backups from a fresh backup and a tested restore. Then run the job and see it
  succeed, move the app, and check `server_version`. Complete a fresh browser sign-in and open
  a product. If the operator must finish it, report sign-in as awaiting verification; health
  and version checks never prove login works.
- **A new version broke it**: the `recover-a-deployment` skill.
- **A setting**: `az containerapp update --set-env-vars`; a secret is a new version in the vault.
- **Microsoft sign-in on a deployment made without it**: add the secret reference and the
  `WHATBUILD_MICROSOFT_*` settings, and check `/api/v1/meta` reports `microsoft: true`.
- **Microsoft sign-in is refused** ("WhatBuild couldn't confirm your email with Microsoft", or
  "That Microsoft sign-in came from another directory", with a reference such as `K7Q2-M9XD`):
  find the app's log line with that reference (`"event":"microsoft_sign_in_refused"`). Its
  `check`, booleans and `fix` say what is wrong; the guide's "When Microsoft sign-in is refused"
  maps each to its fix. Most often `"xms_edov_claim":false`: the app registration lacks the
  optional claim `xms_edov`, and the guide's Sign-in section has the command that adds it. Never
  list a domain in `WHATBUILD_MICROSOFT_DOMAINS` just to make the refusal go away.
- **Removal**: only when asked, after an export, with the resource group's name confirmed.
