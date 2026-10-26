---
name: set-up-mail
description: Set up, check, repair or change the mail a WhatBuild deployment sends (sign-in links, invitations, allowance notices), on Cloudflare Email Sending, any SMTP provider, or the ACS Email API with managed identity. Use when asked to set up email, SMTP or a sender address, when invitations or sign-in links are not arriving, land in spam or fail with an internal error, when email sign-in is missing from the sign-in page, when rotating or replacing the mail token, when changing mail provider, or when giving a new deployment mail.
---

# Set up mail

You are working on the mail a WhatBuild deployment sends. What it sends, every setting, which
deployments send mail, setting up Cloudflare Email Sending and every command are in
`okf/operations/mail.md`. Read it before the first command. This file says how to do the work.

## What must stay true

- **The dev deployment never sends mail.** It holds a copy of production, so its addresses are
  real people's. Refuse to give it mail settings, and never copy production's to it.
- **Each deployment uses its own mail credentials or managed identity.** A Cloudflare token sends
  as its domain from anywhere. Never copy one deployment's to another deployment, a self-hosted
  one, the repository, a commit or a message. Another organization's deployment uses its own domain and provider.
- **Tokens never pass through a command line or the conversation.** The person writes a new token
  to an ignored `.env`; you pipe it into Secret Manager (`--data-file=-`) and print nothing of it.
  Never ask for a token that can create tokens.
- **Production changes only when the person says so.** A `gcloud run services update` makes a new
  revision of the running image; say that before you run it.
- **Real mail goes only to addresses the person reads.** Test with their own address, never with
  an address from the database.

## Procedure

1. **Find the deployment and its values.** For the maintainer's, read `.env` at the root of their
   clone (`GCP_PROJECT`, `GCP_REGION`, `CLOUDFLARE_ACCOUNT_ID`, and `CF_EMAIL_API_KEY` when a
   new token is on hand). For another deployment, its own `.env` or vault.
2. **Check before changing.** Run the commands under Checking it: what `/api/v1/meta` reports, which
   mail settings the service has, and, when something fails, the mail-provider errors in the
   service's log.
   Match a failure to the table under When mail fails.
3. **Do the one thing the task needs**, with the guide's commands: set up from nothing, rotate the
   token, set the sender again, or change provider. For ACS, follow the Azure guide to grant its existing
   managed identity access and set the public endpoint and sender; no SMTP credential is needed.
   The person does what needs their account: billing, and creating a token in the provider's
   dashboard.
4. **Test it.** Send one message to the person's own address, through the deployment itself (ask
   for a sign-in link). `{"sent": true}` means the provider accepted it; ask the person to confirm
   it arrived and was not marked as spam.
5. **Keep the privacy page true.** A deployment that sends mail through a provider names it in
   `WHATBUILD_PROVIDERS`. Tell the person when it does not.
6. **Report** what changed (secret version, revision, settings), what the test showed, and anything
   left for the person.

## When the guide is wrong

If a command fails because `okf/operations/mail.md` is out of date, or the provider has changed how
it works, correct the guide with the `okf-update` skill. A different provider for the guide to set
up is a new decision: supersede
`okf/decisions/mail-is-set-up-through-cloudflare-email-sending-and-a-dev-deployment-sends-none.md`
with the `okf-decision` skill. Do not record the session itself in the repository.
