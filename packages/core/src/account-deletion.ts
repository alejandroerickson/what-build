/**
 * What deleting an account does, as Settings says it before and the confirmation mail and the
 * signed-out page say it after. Pure, so the web app imports it as `@whatbuild/core/account-deletion`.
 */

/** How recently a browser must have signed in to delete its account: a borrowed browser left signed in is not enough. */
export const RECENT_SIGN_IN_MINUTES = 15;

export const ACCOUNT_DELETION = {
  /** What deleting will do, said before it is done. */
  will: [
    "You’ll be signed out everywhere, and your agents will be disconnected.",
    "You’ll lose access to every organization, and pending invitations will be cancelled.",
    "Your email address and usage data will be deleted.",
  ],
  /** What deleting did, said after. */
  did: [
    "You’ve been signed out everywhere, and your agents have been disconnected.",
    "You no longer have access to any organization, and pending invitations were cancelled.",
    "Your email address and usage data have been deleted.",
  ],
  /** What stays. */
  stays: "Anything you added to an organization stays there, with your name on it.",
  /** How to have that go too, before deleting. */
  content: "To remove it, delete it first or ask the organization’s admins.",
  /** What the same address gets later. */
  again: "You can sign up again with the same email address, but you’ll start with an empty account and may need a new invitation.",
} as const;
