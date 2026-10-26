import { createHash } from "node:crypto";
import type { Ports } from "./ports.ts";

/**
 * Where a deployment with a content site (WHATBUILD_CONTENT_URL) serves the documents of people's
 * and agents' HTML and the uploaded files the app shows inline: Story pages, mockup pages, Idea card
 * fronts, a style's specimen, the print view, a PDF and an uploaded HTML file. The app's own route
 * for each checks the session as it always did, then hands the browser to an address on the content
 * site under a short-lived grant (apps/server/src/content-documents.ts), so a browser bug that
 * escapes a document's sandbox lands on another site than the person's session and the app's API.
 */

/** The first part of every document address on a content site. */
export const DOCUMENT_ROUTE = "/documents";

/**
 * What a document grant is for, one purpose per kind, so a grant for one kind is never taken by
 * another's lookup. Each names its object as it was when the grant was issued:
 *
 * - `story_page`: `sv`, a Story page's version.
 * - `mockup_page`: `xv`, a mockup's version, and `pg`, its page.
 * - `specimen`: `hs`, a house style, or `d`, the digest of the product's style's specimen.
 * - `card`: `o`, an outcome (absent for the product concept), and `d`, the digest of its front.
 * - `print`: `vs`, the Story page versions the print view shows.
 * - `attachment`: `fv`, an attachment's file version: a PDF shown inline, or an HTML file in its
 *   preview's sandbox, and nothing else.
 */
export const DOCUMENT_PURPOSES = ["story_page", "mockup_page", "specimen", "card", "print", "attachment"] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

export function isDocumentPurpose(purpose: unknown): purpose is DocumentPurpose {
  return (DOCUMENT_PURPOSES as readonly unknown[]).includes(purpose);
}

/**
 * A short digest of a document that changes in place (a card's front, a style's specimen), which its
 * grant carries: an address issued before a change finds nothing after it.
 */
export function documentDigest(document: string): string {
  return createHash("sha256").update(document).digest("base64url").slice(0, 22);
}

/**
 * The address of one document on the content site, for a frame or a tab to open now: a grant for
 * its purpose, tenant `t`, product `p`, object and requester (`a`, and `f` for an agent's
 * connection), which lasts the deployment's grant lifetime from now. `name` is a readable last part
 * (an attachment's name, `page.html`), which the route ignores.
 */
export function contentAddress(
  ports: Pick<Ports, "grants" | "config">,
  claims: { purpose: DocumentPurpose; t: string; p: string; a: string; f?: string } & Record<string, unknown>,
  name: string,
  nowMs = Date.now(),
): string {
  const site = ports.config.contentBaseUrl;
  if (!site) throw new Error("This deployment has no content site.");
  const { purpose, t, p, a, f, ...object } = claims;
  const exp = Math.floor(nowMs / 1000) + ports.config.grantTtlSeconds;
  const token = ports.grants.sign({ v: 1, purpose, t, p, ...object, a, ...(f ? { f } : {}), exp });
  return `${site}${DOCUMENT_ROUTE}/${token}/${encodeURIComponent(name)}`;
}
