import { sql } from "kysely";
import { productId, tenantId } from "./common.ts";
import { contentAddress } from "./content-address.ts";
import { DOWNLOAD_GRANT_HEADER, requesterClaims } from "./ops/attachments.ts";
import type { OpContext } from "./registry.ts";

/**
 * An agent's previews: a card's front that `card_preview` checked (`card_previews`) or a Story page
 * that `story.preview` checked (`story_previews`), each held as a row for as long as its grant
 * lasts, for the agent to GET and look at before it writes. A product keeps only its newest.
 */

const KINDS = {
  card: { table: "card_previews", purpose: "card_preview", claim: "cp", route: "/api/v1/downloads/card-preview" },
  story: { table: "story_previews", purpose: "story_preview", claim: "sp", route: "/api/v1/downloads/story-preview" },
} as const;

/**
 * Make room for a product's next preview: drop its expired ones, and all but its `kept - 1` newest.
 * One statement ranks the previews it sees and deletes from among them, so a preview another call
 * commits meanwhile, which agents making several at once do, is never the one dropped. (Reading the
 * newest first and then deleting the rest dropped it.)
 */
export async function makeRoomForPreview(ctx: OpContext, kind: keyof typeof KINDS, kept: number) {
  const table = sql.table(KINDS[kind].table);
  const pid = productId(ctx);
  await sql`
    delete from ${table} where product_id = ${pid} and (expires_at <= ${ctx.now} or preview_id in (
      select preview_id from ${table} where product_id = ${pid} and expires_at > ${ctx.now}
      order by created_at desc, preview_id desc offset ${kept - 1}))`.execute(ctx.db);
}

/**
 * The grant an agent GETs a preview's document with. With a content site, an address there that
 * carries its own grant, so any browser or fetch tool opens it (content-documents.ts), and no
 * headers. Without one, the app's own route, which takes the grant in a header, so that no address
 * on the app's origin shows an agent's HTML to whoever is given it.
 */
export function previewGrant(ctx: OpContext, kind: keyof typeof KINDS, previewId: string, expiresAt: Date) {
  const k = KINDS[kind];
  const requester = requesterClaims(ctx.principal);
  const expires_at = expiresAt.toISOString();
  if (ctx.ports.config.contentBaseUrl) {
    // Its grant lasts from the preview's making to its expiry, as the row does.
    const url = contentAddress(ctx.ports, { purpose: k.purpose, t: tenantId(ctx), p: productId(ctx), [k.claim]: previewId, ...requester }, "preview.html", Date.parse(ctx.now));
    return { preview_id: previewId, method: "GET", url, headers: {} as Record<string, string>, expires_at };
  }
  const token = ctx.ports.grants.sign({ v: 1, purpose: k.purpose, t: tenantId(ctx), [k.claim]: previewId, ...requester, exp: Math.floor(expiresAt.getTime() / 1000) });
  return { preview_id: previewId, method: "GET", url: `${ctx.ports.config.publicBaseUrl}${k.route}/${previewId}`, headers: { [DOWNLOAD_GRANT_HEADER]: token } as Record<string, string>, expires_at };
}

/** How a preview's document is opened, wherever the deployment serves it, as each preview's description says. */
export const PREVIEW_OPENING =
  "GET url with exactly the headers given. On a deployment with a content site, url carries its own grant and headers is empty, so any browser, headless browser or fetch tool opens it as it is; otherwise a headless browser takes the headers as extra HTTP headers (Playwright: new_context(extra_http_headers=headers, viewport=…)).";

/** What each preview says of its credential. */
export const PREVIEW_SECRET = "Until it expires, url and any grant header open the preview: keep them out of reports and logs.";

/** The first words of a preview's next step: how to open this one. */
export function openThePreview(preview: { headers: Record<string, string> }): string {
  return Object.keys(preview.headers).length ? "GET url with these headers" : "Open url, which needs no headers,";
}
