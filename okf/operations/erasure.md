---
type: System Concept
title: Erasure is what an operator does beyond the product when someone asks to be removed - ending their account for them, passing on content requests, taking them out of copies and backups sooner, and ending their account again after a restore.
description: For the operator and the agent working for them; who can delete an account and how, where a deleted person still is (backups, restore points, copies of production, the mail provider) and for how long, taking them out sooner, and what a restore brings back.
tags: [operations, privacy, erasure, accounts, backups, runbook]
generated: {by: agent:claude, at: 2026-10-26}
status: draft
---

# Erasure

This is the erasure runbook ([§9.6](../spec/09-data-lifecycle.md#96-operator-runbooks)). The
product deletes an account at once ([§9.5](../spec/09-data-lifecycle.md#delete-an-account)); this
guide covers what it does not automate. Act on a request only once it is known to come from the
person: a mail from the account's address, or a reply to one sent there.

## Deleting the account

- **They can sign in:** point them to Settings, then Delete your account. It tells them what goes,
  what stays and what blocks it, in the words the privacy page uses.
- **They cannot** (no access to the address's mailbox, Google or Microsoft account any more, or they
  ask you to do it): an instance owner removes the account on People, which does the same thing and
  mails the address a record.
- **Refused as the only owner of an organization:** the organization needs another owner, which its
  people agree among themselves, or to be deleted by its owner. You do neither on their behalf.

## Their content

What they wrote belongs to each organization, under the name they had
([§3.9](../spec/03-accounts-teams-and-identity.md#39-attribution)). A request to delete it goes to
that organization's owners or admins, who delete it in the product. Do not delete an
organization's content on one member's word.

## Where a deleted person still is, and for how long

| Where | What it holds | Until |
|---|---|---|
| Database backups ([backups](backups.md#what-is-kept)) | the account as it was: name, address, roles | they age out: 35 days at most for a nightly dump, seven backups on Cloud SQL, 14 days on Azure, hours on Neon's free plan |
| Neon's `pre-migrate-…` branches | the same, as of each deploy | three newer deploys replace them, however long that takes |
| Copies of production: the dev deployment, local copies, the golden master ([copying an organization](copying-an-organization.md)) | the accounts of the organizations copied | the copy is refreshed or deleted |
| The mail provider's logs | the address, on what was sent to it | the provider's own retention ([mail](mail.md)) |

Request logs keep no address, and the counts of use are deleted with the account.

The product promises the backup window (`BACKUPS_KEPT_DAYS`, 35 days). On Neon, delete a
`pre-migrate-…` branch older than that once the release it guarded has run well, so the promise
holds where releases are rare. Refresh or delete each copy of production that holds the person
within the same window.

## Sooner than that

Only when the request needs it, since each step takes away a way back:

- **Nightly dumps:** delete every dump made before the deletion, as a role that may delete from the
  bucket. The backup identity cannot.
- **Cloud SQL:** delete each backup made before it (`gcloud sql backups delete`). Point-in-time
  recovery cannot be pruned; it ages out.
- **Neon:** delete the `pre-migrate-…` branches made before it. The project's history ages out.
- **Azure:** point-in-time recovery cannot be pruned; it ages out in 14 days.

Record what was deleted and when, outside the repository, with the deployment's other notes.

## After a restore

A restore from a backup made before a deletion brings the account back, name, address and roles.
Before restoring, list the accounts ended since the backup was taken:

```sql
select account_id, deleted_at from accounts where deleted_at > '<the backup''s time>';
```

After restoring, an instance owner removes each of them again on People, and checks that none can
sign in. [Recovering from a bad release](recovering-from-a-bad-release.md) and the restore in
[backups](backups.md) both point here.
