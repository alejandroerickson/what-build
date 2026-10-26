/**
 * What deleting an account does, in the words every place that says it uses: the screen where a
 * person deletes their own, the privacy page, and the mail that records it. Pure, so the web app
 * imports it as `@whatbuild/core/account-deletion`.
 */

/** How recently a browser must have signed in to delete its account: a borrowed browser left signed in is not enough. */
export const RECENT_SIGN_IN_MINUTES = 15;

/** The longest any backup in the operations guide keeps a copy of the database (a nightly dump, `okf/operations/backups.md`). */
export const BACKUPS_KEPT_DAYS = 35;

export const ACCOUNT_DELETION = {
  /** What goes, at once. */
  goes: [
    "Your sign-in, and every browser and agent signed in as you.",
    "Your roles in every organization, and the invitations waiting for your address.",
    "Your name and address, and what WhatBuild counts about you: your days of use and the counts held against limits.",
  ],
  /** What stays. */
  stays: "What you wrote in an organization stays with it, under the name you had then, because it is the team’s work.",
  /** How to have that go too. */
  content: "To have it removed as well, delete it before you go, or ask the organization’s admins to.",
  /** When it is final. */
  final: `It is final at once in WhatBuild. Copies in backups go as the backups age out, within ${BACKUPS_KEPT_DAYS} days.`,
  /** What the same address gets later. */
  again: "Your address is forgotten. Signing in with it later starts a new, empty account, and where sign-up is by invitation, someone has to let you in again.",
} as const;
