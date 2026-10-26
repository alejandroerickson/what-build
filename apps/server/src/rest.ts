import {
  AppError, admitRead, documentDigest, execute, HOUSE_STYLE_IDS, OPERATIONS, printDocument, printSelection, readsOnlyTheStory, resolveScope, toAppError, unauthenticated,
  type Env, type OperationDef, type Principal, type Scope, type ScopeRef, type Tx,
} from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { isOwnOrigin, restPrincipal } from "./auth/identity.ts";
import type { ServerConfig } from "./config.ts";
import { handOff } from "./content-documents.ts";
import {
  cardFront, findAttachment, findCard, findMockupPage, findSpecimen, findStoryVersion, htmlView, isHtmlAttachment, isPdf, printView, storyHtml, storyTheme, streamFile,
} from "./documents.ts";
import { logError } from "./telemetry.ts";

/** Where each scope's routes live. The addressed tenant, team and product are always in the path. */
export const SCOPE_PREFIX: Record<OperationDef["scope"], string> = {
  product: "/api/v1/p/:tenant/:team/:product",
  team: "/api/v1/teams/:tenant/:team",
  tenant: "/api/v1/tenants/:tenant",
  account: "/api/v1",
};

/** Who calls REST: it answers the web app's session only, so an unexpected error says how a person reports it. */
const WEB = { surface: "web" } as const;

/** The response header that names the operation a REST call ran. */
export const OPERATION_HEADER = "X-WhatBuild-Operation";

/** Operations that create something answer 201. */
const CREATES = /\.(create\w*|publish|promote_mockup|request_upload|fetch_url|annotate|export)$|^members\.grant$/;

export function restPath(op: OperationDef): string {
  return `${SCOPE_PREFIX[op.scope]}${op.rest.path}`;
}

/** The base type of a zod schema field, looking through optional, nullable and default wrappers. */
function baseType(schema: z.ZodType): string {
  let s = schema as unknown as { def: { type: string; innerType?: z.ZodType } };
  for (let i = 0; i < 10 && ["optional", "nullable", "default", "prefault"].includes(s.def.type); i++) s = s.def.innerType as never;
  return s.def.type;
}

/** Query strings are text: coerce each field to the type its schema expects. */
export function coerceQuery(op: OperationDef, query: Record<string, string>): Record<string, unknown> {
  const shape = (op.input as unknown as { shape?: Record<string, z.ZodType> }).shape ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === "") continue;
    const field = shape[k];
    const t = field ? baseType(field) : "string";
    if (t === "number") out[k] = Number(v);
    else if (t === "boolean") out[k] = v === "true" || v === "1";
    else if (t === "array") out[k] = v.split(",").map((x) => x.trim()).filter(Boolean);
    else out[k] = v;
  }
  return out;
}

function errorResponse(c: Context, e: AppError) {
  if (e.status === 401) c.header("WWW-Authenticate", 'Bearer realm="whatbuild"');
  const retry = e.status === 429 ? e.details?.["retry_after_seconds"] : undefined;
  if (typeof retry === "number") c.header("Retry-After", String(Math.max(1, Math.ceil(retry))));
  return c.json({ error: e.toJSON() }, e.status as 400);
}

/** The last part of an attachment's path, which names it in an address. */
const nameOf = (path: string) => path.split("/").pop() || "attachment";

/** Cookie-authenticated writes must come from our own origin. SameSite=Lax does most of this; this closes the rest. */
function checkOrigin(c: Context, config: ServerConfig, principal: Principal) {
  if (principal.auth_kind !== "session" || ["GET", "HEAD"].includes(c.req.method)) return;
  if (!isOwnOrigin(config, c.req.header("origin"))) throw new AppError(403, "forbidden_origin", "Cross-origin writes are refused.");
}

export function restRoutes(env: Env & { config: ServerConfig }) {
  const app = new Hono();

  const principalOf = async (c: Context) => {
    const p = await restPrincipal(c, env.db, env.config);
    if (!p) throw unauthenticated();
    checkOrigin(c, env.config, p);
    return p;
  };

  for (const op of OPERATIONS) {
    const method = op.rest.method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete";
    app[method](restPath(op), async (c) => {
      try {
        // Identity first: an unauthenticated call with a bad body is a 401, not a 422.
        const principal = await principalOf(c);
        const params = c.req.param() as Record<string, string>;
        const { tenant, team, product, ...pathParams } = params;
        let input: Record<string, unknown>;
        if (op.rest.method === "GET") input = coerceQuery(op, c.req.query());
        else if (op.rest.method === "DELETE" && !c.req.header("content-type")) input = coerceQuery(op, c.req.query());
        else {
          const body = await c.req.json().catch(() => {
            throw new AppError(422, "invalid_json", "The request body must be a JSON object.");
          });
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(422, "invalid_json", "The request body must be a JSON object.");
          input = body as Record<string, unknown>;
        }
        for (const [k, v] of Object.entries(pathParams)) input[k] = coerceQuery(op, { [k]: v })[k];
        if (op.scope === "team" || op.scope === "tenant") {
          if (tenant) input["tenant"] = tenant;
          if (team && op.scope === "team") input["team"] = team;
        }
        const ifMatch = c.req.header("if-match");
        const shape = (op.input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
        if (ifMatch && "expected_etag" in shape && input["expected_etag"] === undefined) input["expected_etag"] = ifMatch;
        const ref: ScopeRef = op.scope === "product" ? { tenant, team, product } : {};
        const { result } = await execute(env, principal, op, input, ref);
        const etag = (result as { etag?: unknown } | null)?.etag;
        if (typeof etag === "string") c.header("ETag", `"${etag}"`);
        // Which operation ran, so the web app counts a change by its name rather than by its address.
        c.header(OPERATION_HEADER, op.name);
        return c.json(result as object, op.rest.method === "POST" && CREATES.test(op.name) ? 201 : 200);
      } catch (e) {
        const err = toAppError(e, WEB);
        if (err.status === 500) logError(op.name, e);
        return errorResponse(c, err);
      }
    });
  }

  // ---- Bytes: file downloads and the documents the app shows (the non-JSON responses) ---------
  //
  // With a content site, a route that would answer with a document of people's HTML or a PDF to
  // show inline makes every check it makes, then hands the browser to the content site
  // (content-documents.ts) instead of sending it. The rest are served here as always.

  // A Story page's HTML is a Story read, open to readers; attachments, exports and style specimens are not.
  const scoped = async (c: Context, access: "story" | "read" = "read") => {
    const principal = await principalOf(c);
    const { tenant, team, product } = c.req.param() as Record<string, string>;
    const scope = await resolveScope(env.db, principal, "product", access, { tenant, team, product }, "read");
    await admitRead(env, principal, scope, "attachments.read");
    return { principal, scope, productId: scope.product!.product_id };
  };
  const site = env.config.contentUrl;

  const inTenant = async <T>(scope: Scope, fn: (trx: Tx) => Promise<T>) =>
    env.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${scope.tenant!.tenant_id}, true)`.execute(trx);
      return fn(trx);
    });

  app.get(`${SCOPE_PREFIX.product}/sources/:record_id/attachment`, async (c) => {
    try {
      const { principal, scope, productId } = await scoped(c);
      const path = c.req.query("path") ?? "";
      const download = c.req.query("download") === "1";
      const found = await inTenant(scope, (trx) => findAttachment(trx, productId, { recordId: c.req.param("record_id")!, path, version: c.req.query("version") }));
      if (!found) throw new AppError(404, "not_found", "No such attachment on this source.");
      // A PDF shown inline is a document; images, audio and video stay subresources of the app's pages.
      if (site && !download && isPdf(found.v.media_type)) return handOff(c, env, principal, scope, { purpose: "attachment", fv: found.v.file_version_id }, nameOf(path));
      return streamFile(c, env, found.v, path, download);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  // An uploaded HTML page, as its preview shows it: in a sandbox that runs no script (htmlView).
  app.get(`${SCOPE_PREFIX.product}/sources/:record_id/attachment/view`, async (c) => {
    try {
      const { principal, scope, productId } = await scoped(c);
      const path = c.req.query("path") ?? "";
      const found = await inTenant(scope, (trx) => findAttachment(trx, productId, { recordId: c.req.param("record_id")!, path, version: c.req.query("version") }));
      if (!found) throw new AppError(404, "not_found", "No such attachment on this source.");
      if (!isHtmlAttachment(found.v.media_type, path)) throw new AppError(415, "not_html", "Only an HTML attachment is shown here. Download any other to open it.");
      if (site) return handOff(c, env, principal, scope, { purpose: "attachment", fv: found.v.file_version_id }, nameOf(path));
      return await htmlView(c, env, found.v);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  // A source's whole derived text, for the web app to show and edit at once; agents read it in
  // windows with derived.text.
  app.get(`${SCOPE_PREFIX.product}/sources/:record_id/text`, async (c) => {
    try {
      const { scope, productId } = await scoped(c);
      const text = await inTenant(scope, (trx) =>
        trx
          .selectFrom("source_texts as t")
          .innerJoin("records as r", "r.record_id", "t.record_id")
          .select(["t.content", "t.etag"])
          .where("r.product_id", "=", productId)
          .where("t.record_id", "=", c.req.param("record_id")!)
          .executeTakeFirst(),
      );
      if (!text) throw new AppError(404, "not_found", "This source has no derived text.");
      return c.body(text.content, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${text.etag}"`,
        "Cache-Control": "private, no-store",
      });
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  app.get(`${SCOPE_PREFIX.product}/exports/:export_id/file`, async (c) => {
    try {
      const { scope, productId } = await scoped(c);
      const { sendExport } = await import("./uploads.ts");
      return await sendExport(c, env, scope.tenant!.tenant_id, c.req.param("export_id")!, productId);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  app.get(`${SCOPE_PREFIX.product}/story/pages/:page_id/versions/:version/html`, async (c) => {
    try {
      // ?theme=light|dark: the app's resolved theme, written onto the page's <html> for this
      // response only, so the page follows the app rather than only the system. ?frame=1: the app's
      // frame is showing it, so the frame script goes in too (focus keys, links open in a new tab).
      const { principal, scope, productId } = await scoped(c, "story");
      const theme = storyTheme(c.req.query("theme"));
      const frame = c.req.query("frame") === "1";
      const v = await inTenant(scope, (trx) =>
        findStoryVersion(trx, productId, { pageId: c.req.param("page_id")!, n: Number(c.req.param("version")) }, readsOnlyTheStory(scope.role)),
      );
      if (!v) throw new AppError(404, "not_found", "No such Story version.");
      if (site) return handOff(c, env, principal, scope, { purpose: "story_page", sv: v.version_id }, "page.html");
      // A mockup page carries its own look, so it takes neither the theme nor the carried typefaces,
      // and keeps its own sandbox, which allows forms.
      return storyHtml(c, v.html, v.mockup ? undefined : theme, frame, v.mockup);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  // A mockup page is served as a Story page is, with the same frame script, but in a mockup page's
  // sandbox (forms allowed, form-action 'none') and never with the app's theme, since a mockup
  // carries its own look.
  app.get(`${SCOPE_PREFIX.product}/mockups/:mockup_id/versions/:version/pages/:page_id/html`, async (c) => {
    try {
      const { principal, scope, productId } = await scoped(c);
      const pageId = c.req.param("page_id")!;
      const p = await inTenant(scope, (trx) => findMockupPage(trx, productId, { mockupId: c.req.param("mockup_id")!, n: Number(c.req.param("version")) }, pageId));
      if (!p) throw new AppError(404, "not_found", "No such mockup page.");
      if (site) return handOff(c, env, principal, scope, { purpose: "mockup_page", xv: p.version_id, pg: pageId }, "page.html");
      return storyHtml(c, p.html, undefined, c.req.query("frame") === "1", true);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  // An Idea card's front, the product concept's or an outcome's, as the app's frame shows it
  // (cardFront). Its grant carries the front's digest, since a front changes in place.
  const card = async (c: Context, outcomeId: string | null) => {
    const { principal, scope, productId } = await scoped(c);
    const theme = storyTheme(c.req.query("theme"));
    const found = await inTenant(scope, (trx) => findCard(trx, productId, outcomeId));
    if (!found) throw new AppError(404, "not_found", outcomeId ? "This outcome has no front yet." : "The product concept has no front yet.");
    if (site) return handOff(c, env, principal, scope, { purpose: "card", ...(outcomeId ? { o: outcomeId } : {}), d: documentDigest(found.front) }, "card.html");
    return cardFront(c, found.front, found.title, theme);
  };
  app.get(`${SCOPE_PREFIX.product}/idea/concept/card`, async (c) => {
    try {
      return await card(c, null);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });
  app.get(`${SCOPE_PREFIX.product}/outcomes/:outcome_id/card`, async (c) => {
    try {
      return await card(c, c.req.param("outcome_id")!);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  // Specimens: a sample page in the product's Story style, or in a house style, shown in the app
  // exactly as Story pages are (the same sandbox and headers) so a person can preview a style. The
  // product's style changes in place, so its grant carries the specimen's digest.
  const specimen = async (c: Context, houseId: string | null) => {
    const { principal, scope, productId } = await scoped(c);
    const theme = storyTheme(c.req.query("theme"));
    const html = await inTenant(scope, (trx) => findSpecimen(trx, productId, houseId));
    if (!html) throw new AppError(404, "not_found", houseId ? `No such house style: ${HOUSE_STYLE_IDS.join(", ")}.` : "This product has no Story style yet.");
    if (site) return handOff(c, env, principal, scope, { purpose: "specimen", ...(houseId ? { hs: houseId } : { d: documentDigest(html) }) }, "specimen.html");
    return storyHtml(c, html, theme, c.req.query("frame") === "1");
  };
  app.get(`${SCOPE_PREFIX.product}/story/style/specimen`, async (c) => {
    try {
      return await specimen(c, null);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });
  app.get(`${SCOPE_PREFIX.product}/story/house-styles/:style/specimen`, async (c) => {
    try {
      return await specimen(c, c.req.param("style")!);
    } catch (e) {
      return errorResponse(c, toAppError(e, WEB));
    }
  });

  // The Story print view: one composed HTML document, opened top-level in a new tab and printed to
  // PDF by the browser. Its policy runs only the nonce'd print script, in an opaque origin. With a
  // content site, the print view's own checks choose the versions, and its grant names them.
  app.get(`${SCOPE_PREFIX.product}/story/print`, async (c) => {
    try {
      const principal = await principalOf(c);
      const { tenant, team, product } = c.req.param() as Record<string, string>;
      const input = coerceQuery(printDocument as OperationDef, c.req.query());
      if (site) {
        const { result, scope } = await execute(env, principal, printSelection as OperationDef, input, { tenant, team, product });
        return handOff(c, env, principal, scope, { purpose: "print", vs: (result as { versions: string[] }).versions }, "story.html");
      }
      const { result } = await execute(env, principal, printDocument as OperationDef, input, { tenant, team, product });
      const { html, nonce } = result as { html: string; nonce: string };
      return printView(c, html, nonce);
    } catch (e) {
      const err = toAppError(e, WEB);
      if (err.status === 500) logError("story print view", e);
      return errorResponse(c, err);
    }
  });

  return app;
}
