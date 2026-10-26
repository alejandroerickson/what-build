import {
  actorOf, contentAddress, DOCUMENT_ROUTE, documentDigest, isDocumentPurpose, notFound, printDocumentAt, readsOnlyTheStory, requesterClaims, toAppError,
  type DocumentPurpose, type Env, type OpContext, type Principal, type Scope, type Tx,
} from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { sql } from "kysely";
import { requestedHost } from "./canonical-host.ts";
import type { ServerConfig } from "./config.ts";
import {
  cardFront, FALLBACK_HTML_POLICY, findAttachment, findCard, findMockupPage, findSpecimen, findStoryVersion, htmlView, isHtmlAttachment, isPdf, printView, storyHtml, storyTheme, streamFile,
} from "./documents.ts";
import { logError } from "./telemetry.ts";
import { requesterMayRead } from "./uploads.ts";

/**
 * The app's own route for a document hands it off, with a content site: once the route has made
 * every check it makes, it answers 302 to the document's address on the content site, under a grant
 * for this one document and this requester (content-address.ts), and never sends the document. The
 * request's theme and frame go with it. Every load of the app's address mints a fresh grant, so
 * nothing in the web app keeps or refreshes an address.
 */
export function handOff(
  c: Context,
  env: Env,
  principal: Principal,
  scope: Scope,
  object: { purpose: DocumentPurpose } & Record<string, unknown>,
  name: string,
) {
  const address = new URL(contentAddress(env.ports, { ...object, t: scope.tenant!.tenant_id, p: scope.product!.product_id, ...requesterClaims(principal) }, name));
  for (const k of ["theme", "frame"]) {
    const v = c.req.query(k);
    if (v) address.searchParams.set(k, v);
  }
  return c.body(null, 302, { Location: address.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
}

/**
 * The content site's one route for documents: `GET|HEAD /documents/<grant>/<name>`. The grant is
 * the only authority, as a prototype's is: the route reads no cookie or Authorization header, sets
 * no cookie, never redirects, and answers only on the content host. Before the first byte it checks
 * the grant's signature, expiry and purpose, then that its requester may still read the product
 * (requesterMayRead), so someone removed, lowered to reader or shut out of a public sandbox stops
 * loading at once. It finds the document with the same function as the app's own route, and serves
 * it with the same function and headers, framed by the app's origin alone.
 */
export function contentDocumentRoutes(env: Env & { config: ServerConfig }) {
  const app = new Hono();
  const contentHost = env.config.contentUrl ? new URL(env.config.contentUrl).host.toLowerCase() : null;
  const site = new URL(env.config.publicBaseUrl).origin;

  const say = (c: Context, status: number, text: string) =>
    c.body(text, status as 404, { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": FALLBACK_HTML_POLICY, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });

  const inTenant = <T>(tenantId: string, fn: (trx: Tx) => Promise<T>) =>
    env.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return fn(trx);
    });

  app.get(`${DOCUMENT_ROUTE}/*`, async (c) => {
    if (!contentHost || requestedHost((name) => c.req.header(name)) !== contentHost)
      return say(c, 404, "WhatBuild serves its documents from this deployment's content site, at addresses it gives.");
    const m = /^\/documents\/([A-Za-z0-9_.-]+)\/[^/]*$/.exec(new URL(c.req.url).pathname);
    const claims = m ? env.ports.grants.verify(m[1]!) : null;
    const tenant = claims?.["t"];
    const product = claims?.["p"];
    if (!claims || !isDocumentPurpose(claims["purpose"]) || typeof tenant !== "string" || typeof product !== "string")
      return say(c, 401, "This address has expired. Open it again in WhatBuild.");
    try {
      const { principal, scope } = await requesterMayRead(env, claims, product);
      if (scope.tenant?.tenant_id !== tenant) throw notFound("No such document.");
      const theme = storyTheme(c.req.query("theme"));
      const frame = c.req.query("frame") === "1";
      const str = (k: string) => (typeof claims[k] === "string" ? (claims[k] as string) : null);
      // Changed since the address was issued (a card's front, the Story style), or gone.
      const gone = () => notFound("This document has changed or no longer exists. Open it again in WhatBuild.");
      switch (claims["purpose"]) {
        case "story_page": {
          const v = await inTenant(tenant, (trx) => findStoryVersion(trx, product, { versionId: str("sv") ?? "" }, readsOnlyTheStory(scope.role)));
          if (!v) throw gone();
          return storyHtml(c, v.html, v.mockup ? undefined : theme, frame, v.mockup, site);
        }
        case "mockup_page": {
          const p = await inTenant(tenant, (trx) => findMockupPage(trx, product, { versionId: str("xv") ?? "" }, str("pg") ?? ""));
          if (!p) throw gone();
          return storyHtml(c, p.html, undefined, frame, true, site);
        }
        case "specimen": {
          const house = str("hs");
          const html = await inTenant(tenant, (trx) => findSpecimen(trx, product, house));
          if (!html || (house === null && documentDigest(html) !== claims["d"])) throw gone();
          return storyHtml(c, html, theme, frame, false, site);
        }
        case "card": {
          const card = await inTenant(tenant, (trx) => findCard(trx, product, str("o")));
          if (!card || documentDigest(card.front) !== claims["d"]) throw gone();
          return cardFront(c, card.front, card.title, theme, site);
        }
        case "print": {
          const versions = Array.isArray(claims["vs"]) ? claims["vs"].filter((x): x is string => typeof x === "string") : [];
          if (!versions.length) throw gone();
          const now = new Date().toISOString();
          const { html, nonce } = await inTenant(tenant, (trx) => {
            const ctx: OpContext = {
              principal, actor: actorOf(principal), db: trx, scope, ports: env.ports, now,
              async enqueue() {
                throw new Error("A document is only read.");
              },
            };
            return printDocumentAt(ctx, versions);
          });
          return printView(c, html, nonce, site);
        }
        case "attachment": {
          const found = await inTenant(tenant, (trx) => findAttachment(trx, product, { fileVersionId: str("fv") ?? "" }));
          if (!found) throw gone();
          if (isPdf(found.v.media_type)) return streamFile(c, env, found.v, found.path, false, site);
          if (isHtmlAttachment(found.v.media_type, found.path)) return htmlView(c, env, found.v, site);
          throw gone();
        }
      }
      return say(c, 401, "This address has expired. Open it again in WhatBuild.");
    } catch (e) {
      const err = toAppError(e);
      if (err.status === 500) logError("content site document", e);
      return say(c, err.status, err.message);
    }
  });

  return app;
}
