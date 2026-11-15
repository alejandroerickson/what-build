import type { OpContext } from "./registry.ts";
import { randomToken, sha256Hex } from "./util.ts";

/**
 * The link in a mail that brings someone in: the one that lets an address start an organization,
 * and an invitation's. Both are sent to the address in question, so their link can carry the
 * sign-in, and the person meets one page with one button rather than a second mail.
 *
 * Each mail has a link of its own, single use, for 7 days, kept as sign-in links are (in
 * `email_tokens`, by its hash, never readable back), under a purpose of its own so the ordinary
 * sign-in link's route never takes it. Opening it changes nothing; pressing its page's button, from
 * this origin only, uses it up and signs in, and only an address that has no account yet: for one
 * that has, it leads to Sign in and on to where it points (`apps/server/src/auth/routes.ts`). The
 * link an inviter is given (`/invite/<token>`) is never this one, and signs nobody in.
 */
export const ENTRY_LINK_PATH = "/auth/start";

/** How long an entry link works: an invitation's own time. */
export const ENTRY_LINK_DAYS = 7;

/** What an entry link was sent for: an allowance from an instance owner, one from the waitlist, or an invitation. */
export type EntryLinkPurpose = "allowance" | "allowance_waitlist" | "invitation";
export const ENTRY_LINK_PURPOSES: readonly EntryLinkPurpose[] = ["allowance", "allowance_waitlist", "invitation"];

/** The app's page for one invitation, by its id: where an invitation's entry link leads. */
export function invitationPath(invitationId: string): string {
  return `/invitations/${invitationId}`;
}

/** The invitation an entry link leads to, from where it leads; null for any other place. */
export function invitationOfPath(path: string | null): string | null {
  return /^\/invitations\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(path ?? "")?.[1] ?? null;
}

/**
 * Make an entry link for `email`, leading to `to` (`/welcome`, or an invitation's page) once used,
 * and working until `expires` (ISO) or for ENTRY_LINK_DAYS. The whole link, to put in the mail.
 */
export async function makeEntryLink(ctx: Pick<OpContext, "db" | "now" | "ports">, email: string, purpose: EntryLinkPurpose, to: string, expires?: string): Promise<string> {
  const token = randomToken();
  await ctx.db
    .insertInto("email_tokens")
    .values({ token_hash: sha256Hex(token), email, purpose, redirect: to, expires_at: expires ?? new Date(Date.parse(ctx.now) + ENTRY_LINK_DAYS * 86400_000).toISOString() })
    .execute();
  return `${ctx.ports.config.publicBaseUrl}${ENTRY_LINK_PATH}?token=${token}`;
}
