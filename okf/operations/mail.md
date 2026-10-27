---
type: System Concept
title: Mail - what WhatBuild sends, how each deployment sends it, and sending it through Cloudflare Email Sending
description: The messages the server sends (four while a request waits, and the daily feedback digest), the settings that choose a mailer, which deployments send mail and which never do, setting up Cloudflare Email Sending over SMTP, checking it, rotating its token, changing provider, and what breaks it.
tags: [operations, mail, smtp, cloudflare, invitations, sign-in, cloud-run, azure, runbook]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Mail

An agent sets up, checks and repairs a deployment's mail with the `set-up-mail` skill, which follows
this guide.

## What WhatBuild sends

Plain text, one message at a time. Four are sent while the request that causes it waits:

| Message | Sent when | Code |
|---|---|---|
| A sign-in link | someone asks for one on the sign-in page (`POST /auth/email`), at most five per address an hour | `apps/server/src/auth/routes.ts` |
| An invitation | someone gives a role to an address that has no account | `packages/core/src/ops/products.ts` |
| An allowance notice | an instance owner lets an address start organizations, and asks to tell them | `packages/core/src/ops/tenant-allowances.ts` |
| An account's deletion confirmation | a person deletes their account, or an instance owner removes it: to the address it had, saying who ended it, what was deleted and what is kept, and whom to tell if it was not them (`WHATBUILD_PRIVACY_CONTACT`) | `packages/core/src/ops/accounts.ts` |

Two are sent by the worker, not a request:

| Message | Sent when | Code |
|---|---|---|
| A new agent connection | an agent connects as someone for the first time: a code is exchanged for a connection's first tokens, and the account has had no connection from a client of that name held at the same place; queued with the tokens, sent to the account's address when the worker runs it | `apps/server/src/auth/connection-notice.ts`, `apps/server/src/worker.ts` |
| The feedback digest | the deployment names `WHATBUILD_FEEDBACK_EMAIL`, there is feedback not yet sent, and no digest went out in the last 24 hours; looked at when an instance starts, and at most every ten minutes while its worker is awake (it sleeps a minute after the last request, and wakes at the next) | `packages/core/src/feedback.ts`, `apps/server/src/worker.ts` |

Nothing else sends mail: not the site's interest form. Sign-in links and invitations are
specified in [§3](../spec/03-accounts-teams-and-identity.md), feedback in
[§4.13](../spec/04-data-model.md#413-feedback).

**A message that cannot be sent fails its request.** An invitation or an allowance runs in one
transaction with its message, so a failed send leaves nothing behind and the person sees an
internal error; a failed sign-in link answers `500`. A deployment whose mail is broken therefore
cannot invite anyone new, while one with no mail at all can: the person inviting is shown the link
to pass on, and the sign-in page offers no email link. The one exception is a deletion's record: a
failed send is logged (`account deletion: the confirmation was not mailed`) and the account ends anyway,
since the person asked for it; the answer's `notice_sent` says whether it went.

**A connection's notice that cannot be sent is tried again**, as any job is, a few times with
growing waits; the agent's connection is made either way. With no mailer none is queued, and the
connection still shows under Connect an agent.

**A digest that cannot be sent waits.** Its reports are marked sent in the same transaction as the
message, so a failed send leaves them unsent, the service logs `feedback digest:` with the provider
error, and the next look, ten minutes later, tries again.

## The settings

| Setting | What it does |
|---|---|
| `WHATBUILD_SMTP_URL` | `smtp://` or `smtps://user:password@host:port`, both parts percent-encoded. Always from a secret (`whatbuild-smtp-url`), never a plain value. |
| `WHATBUILD_MAIL_FROM` | The sender, for example `WhatBuild <noreply@example.com>`. Its domain must be one the provider sends for. Unset, it is `WhatBuild <no-reply@localhost>`, which every real provider refuses. |
| `WHATBUILD_FEEDBACK_EMAIL` | One address that gets the daily feedback digest. Optional; unset, or with no mailer, feedback stays in the database, and a deployment that sets it without mail logs a warning when it starts. People can send feedback either way. |
| `WHATBUILD_MAILER` | `smtp`, `acs`, `none`, `console` or `memory`. Unset, it is `smtp` when there is an SMTP URL, otherwise `none` in production and `console` in development. Production takes `smtp`, `acs` or `none`. ACS is an explicit choice. |
| `WHATBUILD_ACS_EMAIL_ENDPOINT` | The HTTPS origin of the ACS Communication Services resource linked to a verified email domain, for example `https://example.communication.azure.com`. Required with `WHATBUILD_MAILER=acs`; this is public configuration. |
| `WHATBUILD_AZURE_CLIENT_ID` | Optional client ID of a user-assigned managed identity attached to the app. With ACS and no value, use the system-assigned identity. No client secret or connection string is used. |

With `none`, sign-in by email link is off (`/api/v1/meta` reports `auth.email_link: false`) and
invitations are links. `console` prints each message in the terminal, and `memory` keeps it for
tests ([§2](../spec/02-architecture.md)).

The settings belong to one deployment: they live in its own project and secret store, never in the
repository or the image. A deployment sends mail only after someone gives it these settings.

| Deployment | Mail |
|---|---|
| A Cloud Run deployment | none until it is given its own: [Cloudflare Email Sending](#cloudflare-email-sending) over SMTP when Cloudflare holds its domain, or any SMTP provider; `setup.sh` takes `SMTP_URL` and `MAIL_FROM` ([Cloud Run](cloud-run.md)) |
| A dev deployment | **None, ever.** It holds a copy of production, so its accounts and invitations are real people's addresses ([dev deployment](dev-deployment.md)). |
| Local development, a copy of production, the end-to-end tests | printed in the terminal (`console`) |
| A self-hosted deployment on Azure | its own relay or Azure Communication Services ([Azure](azure.md#sign-in)) |

Two things can carry mail where it is not meant to go:

- **`setup.sh` uses any `whatbuild-smtp-url` secret in its project.** A second deployment set up
  in the same project sends through the first one's provider and account. Give every deployment a
  project of its own.
- **A token reaches every deployment that holds it.** A Cloudflare token sends as its domain from
  anywhere. Never copy one deployment's into another deployment, a self-hosted one, or the
  repository; a deployment run by another organization uses its own domain and provider.

## Azure Communication Services with managed identity

An Azure-hosted deployment can use the ACS Email API with `WHATBUILD_MAILER=acs` and its own
managed identity. It needs a Communication Services resource linked to a verified email domain,
permission for that identity on that resource, its endpoint, and a permitted sender in
`WHATBUILD_MAIL_FROM`. [Azure](azure.md#mail-with-azure-communication-services) gives the access grant
and settings. No SMTP account, application registration, client secret or email API key is needed.

The adapter (`apps/server/src/adapters/mail-acs.ts`) loads the Azure SDK only when sending. It uses
`ManagedIdentityCredential`, selecting the user-assigned identity by `WHATBUILD_AZURE_CLIENT_ID`
when set. It sends the same plain-text message as SMTP and waits for the send operation to reach
`Succeeded`, with a 60-second bound across submission and polling. An accepted initial request
is not success; failed operations and timeouts reject the send so its caller retains unsent
feedback or fails the sign-in/invitation request. As with SMTP, provider success does not prove
inbox delivery. Check the recipient's inbox and spam folder.

`WHATBUILD_MAIL_FROM` accepts a bare address or a display name followed by one address in angle
brackets. ACS receives the bare address; its sender resource controls the display name. Setting
an ACS endpoint alone never turns mail on. Keep a dev deployment's `WHATBUILD_MAILER=none`.
Say in `WHATBUILD_PROVIDERS` that Microsoft Azure sends the email.

## Cloudflare Email Sending

A Cloud Run deployment whose domain is on Cloudflare (the first way to [put a domain in
front](cloud-run.md#setting-it-up)) can send through
[Cloudflare Email Sending](https://developers.cloudflare.com/email-service/) on the Cloudflare
account that holds the domain's zone
([decision](../decisions/mail-is-set-up-through-cloudflare-email-sending-and-a-dev-deployment-sends-none.md)).

| Thing | Where |
|---|---|
| The sending domain | the deployment's domain, onboarded under Email Service → Email Sending |
| Its DNS records | MX and SPF on `cf-bounce.<domain>`, DKIM on `cf-bounce._domainkey.<domain>`; Cloudflare adds them when the domain is onboarded. A `_dmarc` record with relaxed alignment passes Cloudflare's signed mail as it is. |
| The token | an account-owned API token with only **Email Sending: Edit**. It is the SMTP password, and also reads and changes the sending settings over the API. |
| The secret | `whatbuild-smtp-url` in the deployment's Secret Manager: `smtps://api_token:<token>@smtp.mx.cloudflare.net:465`, read by the runtime identity only |
| The service | `WHATBUILD_SMTP_URL` from that secret; `WHATBUILD_MAIL_FROM=WhatBuild <noreply@<domain>>` |
| The plan | Email Sending needs Workers Paid, which includes 3,000 messages a month, then US$0.35 per 1,000 |

Email Sending only sends: unless something else receives mail for the domain, replies to
`noreply@` bounce. Email Sending is in beta.

Cloudflare receives each recipient's address and every message, so the deployment's privacy page
must say so: in `WHATBUILD_PROVIDERS`, `Cloudflare sends the email.`, or with the Worker and Web
Analytics as well, `Cloudflare serves the public site, counts its visits and sends the email.`
([§9.1](../spec/09-data-lifecycle.md)).

### Checking it

```bash
P=<project> R=<region>          # the maintainer's are GCP_PROJECT and GCP_REGION in .env
curl -s https://<the app's address>/api/v1/meta | python3 -c 'import json,sys; print(json.load(sys.stdin)["auth"])'   # email_link: True
gcloud run services describe whatbuild --project $P --region $R --format=json \
  | python3 -c 'import json,sys; [print(e["name"], e.get("value", "(secret)")) for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]["env"] if "MAIL" in e["name"] or "SMTP" in e["name"]]'
```

Then ask for a sign-in link on the sign-in page with an address the person reads, and have them
confirm it arrived and was not marked as spam. `{"sent": true}` means Cloudflare accepted the
message, not that it was delivered.

### Setting it up

On the Cloudflare account that holds the domain's zone:

1. The account needs the Workers Paid plan. The person subscribes, since it is billing.
2. The person creates an account API token in the Cloudflare dashboard with the one permission
   Email Sending: Edit, and writes it to an ignored `.env` as `CF_EMAIL_API_KEY`. An agent never
   needs a token that can create tokens.
3. Onboard the domain. Cloudflare adds its DNS records in the same step, because it holds the zone:

   ```bash
   Z=<the zone's id>   # GET /zones?name=<domain> with CLOUDFLARE_API_TOKEN
   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$Z/email/sending/subdomains" \
     -H "Authorization: Bearer $CF_EMAIL_API_KEY" -H 'Content-Type: application/json' -d '{"name":"<domain>"}'
   ```

   Sending is refused (`550 5.7.1 Email sending is not enabled for domain`) for about a minute
   after onboarding.
4. Store the SMTP URL and let the service read it, without the token appearing in a command line:

   ```bash
   printf 'smtps://api_token:%s@smtp.mx.cloudflare.net:465' "$CF_EMAIL_API_KEY" \
     | gcloud secrets create whatbuild-smtp-url --project $P --replication-policy automatic --data-file=-
   gcloud secrets add-iam-policy-binding whatbuild-smtp-url --project $P \
     --member serviceAccount:whatbuild-runtime@$P.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
   gcloud run services update whatbuild --project $P --region $R \
     --update-secrets WHATBUILD_SMTP_URL=whatbuild-smtp-url:latest \
     --update-env-vars 'WHATBUILD_MAIL_FROM=WhatBuild <noreply@<domain>>'
   ```

   This makes a revision of the image already running; it moves the deployment to no other release.
   Release deploys (`deploy/cloud-run/cloudbuild.yaml`) keep both settings.
5. Check it (above), and add Cloudflare's mail to the privacy page's providers.

### Rotating the token

Create a new token as in step 2, add it as a new version, make a revision that reads it, check, then
delete the old token in the dashboard:

```bash
printf 'smtps://api_token:%s@smtp.mx.cloudflare.net:465' "$CF_EMAIL_API_KEY" \
  | gcloud secrets versions add whatbuild-smtp-url --project $P --data-file=-
gcloud run services update whatbuild --project $P --region $R --update-secrets WHATBUILD_SMTP_URL=whatbuild-smtp-url:latest
```

A revision reads `latest` when it starts, so without the new revision the service keeps the old
token until its next start.

### Changing provider

Any SMTP provider works without a change to the code. Onboard the domain with it, add its DNS
records, store its SMTP URL as a new version of `whatbuild-smtp-url`, make a revision, check, then
remove Cloudflare's sending records and token, and change the privacy page's providers. A
different provider for this guide to set up is recorded by superseding the decision.

## The feedback digest

People send feedback from **Submit feedback** in the account menu, and agents with
`submit_feedback`; a report names nobody unless its sender shared their address
([decision](../decisions/feedback-names-nobody-and-reaches-the-maintainers-in-a-daily-digest.md)).
A deployment with mail and `WHATBUILD_FEEDBACK_EMAIL` mails what is new to that address once a day:
`WhatBuild feedback: 3 reports from <host>`, each report's kind, door, release and time over its
words, and `Reply to:` where its sender shared an address.

On Cloud Run the address is an ordinary setting on the service, which a release deploy keeps. It
stays out of the repository (in an ignored `.env` as `FEEDBACK_EMAIL`, say):

```bash
gcloud run services update whatbuild --project $P --region $R --update-env-vars "WHATBUILD_FEEDBACK_EMAIL=$FEEDBACK_EMAIL"
```

The service sends once it wakes, when a request arrives.
Remove the setting (`--remove-env-vars WHATBUILD_FEEDBACK_EMAIL`) to stop it; reports then stay in
the database.

Each deployment, self-hosted or not, chooses its own address: `FEEDBACK_EMAIL` for `setup.sh`
([Cloud Run](cloud-run.md)), or `WHATBUILD_FEEDBACK_EMAIL` in the container app's definition
([Azure](azure.md#sign-in)). To pass its people's feedback to WhatBuild's maintainers, it names an
address they give it. It needs working mail first (above); without it, feedback stays in the
deployment's own database, where `select * from feedback where sent_at is null` reads it. A dev
deployment sends no mail, so it sends no digest.

## When mail fails

| Sign | Cause | Fix |
|---|---|---|
| Inviting a new address fails with an internal error; sign-in links answer `500` | the send failed; the service logs the mail-provider error | read it (below), then the rows that follow |
| `535 5.7.8` | the token is wrong, revoked or lacks Email Sending: Edit, or the user name is not `api_token` | rotate the token |
| `550 5.7.1 … not enabled for domain` | the sender's domain is not onboarded under the token's account, or was onboarded a minute ago | onboard it, or wait a minute |
| The sender is `no-reply@localhost` | `WHATBUILD_MAIL_FROM` is unset, most often after re-running `setup.sh` without `MAIL_FROM` | set it again (step 4) |
| No email link on the sign-in page | the deployment has no mailer | configure SMTP (step 4) or ACS (above) |
| ACS refuses a send | the selected managed identity lacks access to the linked Communication Services resource, or the sender is outside its verified domain | check the identity client ID, resource access and permitted sender in the Azure guide |
| No feedback digest arrives | `WHATBUILD_FEEDBACK_EMAIL` unset, the deployment has no mail (it logs a warning when it starts), nothing new since the last digest, or one went out in the last 24 hours | set the address; read `feedback digest:` in the logs |
| The message arrives as spam | DKIM or SPF not passing | check the records under Email Sending, and the message's `Authentication-Results` header |

```bash
gcloud run services logs read whatbuild --project $P --region $R --limit 300 | grep -iE 'EAUTH|EENVELOPE|ECONNECTION|ETIMEDOUT|smtp'
```

**Re-running `setup.sh` on a deployment that sends mail** replaces every setting on the service
with the ones it is given. Pass `MAIL_FROM='WhatBuild <noreply@<domain>>'` with the rest; it finds
the secret by itself.

Cloudflare's dashboard shows each message's outcome under Email Sending. Addresses that bounce go
on its suppression list, and later messages to them are refused.
