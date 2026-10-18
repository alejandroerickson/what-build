import {
  AppError, admitRead, execute, MOCKUP_RESPONSE_HEADERS, OPERATIONS, prototypeNotice, printDocument, printResponseHeaders, readsOnlyTheStory, resolveScope, STORY_RESPONSE_HEADERS, toAppError, unauthenticated, withStoryFonts, withStoryFrame, withStoryTheme, houseSpecimen, houseStyle, HOUSE_STYLE_IDS, shownHtml, styleSpecimen,
  type Env, type OperationDef, type Principal, type ScopeRef,
} from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { isOwnOrigin, restPrincipal } from "./auth/identity.ts";
import type { ServerConfig } from "./config.ts";

/** Where each scope's routes live. The addressed tenant, team and product are always in the path. */
export const SCOPE_PREFIX: Record<OperationDef["scope"], string> = {
  product: "/api/v1/p/:tenant/:team/:product",
  team: "/api/v1/teams/:tenant/:team",
  tenant: "/api/v1/tenants/:tenant",
  account: "/api/v1",
};

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

export function storyTheme(theme: string | undefined): "light" | "dark" | undefined {
  if (theme !== undefined && theme !== "light" && theme !== "dark") throw new AppError(422, "invalid_input", "theme must be light or dark.");
  return theme;
}

/**
 * A page as the sandbox serves it: its surface's sandboxing headers (a mockup page's allows forms,
 * whose submissions form-action 'none' still stops), the carried typefaces the page names (never
 * for a mockup, which carries its own look), the theme, and the frame script when the app's frame
 * asks. A Story preview is served by the same function, so it is shown as its version would be.
 */
export function storyHtml(c: Context, stored: string, theme: "light" | "dark" | undefined, frame: boolean, mockup = false) {
  for (const [k, val] of Object.entries(mockup ? MOCKUP_RESPONSE_HEADERS : STORY_RESPONSE_HEADERS)) c.header(k, val);
  const html = mockup ? stored : withStoryFonts(stored);
  return c.body(frame ? withStoryFrame(html, theme) : theme ? withStoryTheme(html, theme) : html);
}

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
        const err = toAppError(e);
        if (err.status === 500) console.error(`${op.name}:`, e);
        return errorResponse(c, err);
      }
    });
  }

  // ---- Bytes: file downloads and Story HTML (the two non-JSON responses) ---------------------

  // A Story page's HTML is a Story read, open to readers; attachments, exports and style specimens are not.
  const scoped = async (c: Context, access: "story" | "read" = "read") => {
    const principal = await principalOf(c);
    const { tenant, team, product } = c.req.param() as Record<string, string>;
    const scope = await resolveScope(env.db, principal, "product", access, { tenant, team, product }, "read");
    await admitRead(env, principal, scope, "attachments.read");
    return scope;
  };

  const inTenant = async <T>(tenantId: string, fn: (trx: Parameters<Parameters<ReturnType<typeof env.db.transaction>["execute"]>[0]>[0]) => Promise<T>) =>
    env.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return fn(trx);
    });

  app.get(`${SCOPE_PREFIX.product}/sources/:record_id/attachment`, async (c) => {
    try {
      const scope = await scoped(c);
      const path = c.req.query("path") ?? "";
      const version = c.req.query("version");
      const found = await inTenant(scope.tenant!.tenant_id, async (trx) => {
        const f = await trx
          .selectFrom("files as f")
          .innerJoin("records as r", "r.record_id", "f.record_id")
          .select(["f.file_id", "f.current_version_id", "f.path"])
          .where("r.product_id", "=", scope.product!.product_id)
          .where("f.record_id", "=", c.req.param("record_id")!)
          .where("f.path", "=", path)
          .executeTakeFirst();
        if (!f) return null;
        return trx.selectFrom("file_versions").selectAll().where("file_id", "=", f.file_id).where("file_version_id", "=", version ?? f.current_version_id ?? "").executeTakeFirst();
      });
      if (!found) throw new AppError(404, "not_found", "No such attachment on this source.");
      return streamFile(c, env, found, path, c.req.query("download") === "1");
    } catch (e) {
      return errorResponse(c, toAppError(e));
    }
  });

  // A source's whole derived text, for the web app to show and edit at once; agents read it in
  // windows with derived.text.
  app.get(`${SCOPE_PREFIX.product}/sources/:record_id/text`, async (c) => {
    try {
      const scope = await scoped(c);
      const text = await inTenant(scope.tenant!.tenant_id, (trx) =>
        trx
          .selectFrom("source_texts as t")
          .innerJoin("records as r", "r.record_id", "t.record_id")
          .select(["t.content", "t.etag"])
          .where("r.product_id", "=", scope.product!.product_id)
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
      return errorResponse(c, toAppError(e));
    }
  });

  app.get(`${SCOPE_PREFIX.product}/exports/:export_id/file`, async (c) => {
    try {
      const scope = await scoped(c);
      const { sendExport } = await import("./uploads.ts");
      return await sendExport(c, env, scope.tenant!.tenant_id, c.req.param("export_id")!, scope.product!.product_id);
    } catch (e) {
      return errorResponse(c, toAppError(e));
    }
  });

  app.get(`${SCOPE_PREFIX.product}/story/pages/:page_id/versions/:version/html`, async (c) => {
    try {
      // ?theme=light|dark: the app's resolved theme, written onto the page's <html> for this
      // response only, so the page follows the app rather than only the system. ?frame=1: the app's
      // frame is showing it, so the frame script goes in too (focus keys, links open in a new tab).
      const scope = await scoped(c, "story");
      const theme = storyTheme(c.req.query("theme"));
      const frame = c.req.query("frame") === "1";
      const v = await inTenant(scope.tenant!.tenant_id, async (trx) => {
        let q = trx
          .selectFrom("story_versions as v")
          .innerJoin("story_pages as p", "p.page_id", "v.page_id")
          .select(["v.html", "v.mockup"])
          .where("v.product_id", "=", scope.product!.product_id)
          .where("p.product_id", "=", scope.product!.product_id)
          .where("v.page_id", "=", c.req.param("page_id")!)
          .where("v.n", "=", Number(c.req.param("version")));
        // A reader is given only live pages, as story.get_page gives them.
        if (readsOnlyTheStory(scope.role)) q = q.where("p.archived_at", "is", null);
        const row = await q.executeTakeFirst();
        return row ? { html: await shownHtml(trx, row), mockup: Boolean(row.mockup) } : null;
      });
      if (!v) throw new AppError(404, "not_found", "No such Story version.");
      // A mockup page carries its own look, so it takes neither the theme nor the carried typefaces,
      // and keeps its own sandbox, which allows forms.
      return storyHtml(c, v.html, v.mockup ? undefined : theme, frame, v.mockup);
    } catch (e) {
      return errorResponse(c, toAppError(e));
    }
  });

  // A mockup page is served as a Story page is, with the same frame script, but in a mockup page's
  // sandbox (forms allowed, form-action 'none') and never with the app's theme, since a mockup
  // carries its own look.
  app.get(`${SCOPE_PREFIX.product}/mockups/:mockup_id/versions/:version/pages/:page_id/html`, async (c) => {
    try {
      const scope = await scoped(c);
      const p = await inTenant(scope.tenant!.tenant_id, (trx) =>
        trx
          .selectFrom("mockup_pages as p")
          .innerJoin("mockup_versions as v", "v.version_id", "p.version_id")
          .select("p.html")
          .where("v.product_id", "=", scope.product!.product_id)
          .where("v.mockup_id", "=", c.req.param("mockup_id")!)
          .where("v.n", "=", Number(c.req.param("version")))
          .where("p.page_id", "=", c.req.param("page_id")!)
          .executeTakeFirst(),
      );
      if (!p) throw new AppError(404, "not_found", "No such mockup page.");
      // A page that enters the prototype has no HTML of its own: its frame opens the entry (prototype_url).
      return storyHtml(c, p.html ?? prototypeNotice(), undefined, c.req.query("frame") === "1", true);
    } catch (e) {
      return errorResponse(c, toAppError(e));
    }
  });

  // Specimens: a sample page in the product's Story style, or in a house style, shown in the app
  // exactly as Story pages are (the same sandbox and headers) so a person can preview a style.
  app.get(`${SCOPE_PREFIX.product}/story/style/specimen`, async (c) => {
    try {
      const scope = await scoped(c);
      const theme = storyTheme(c.req.query("theme"));
      const s = await inTenant(scope.tenant!.tenant_id, (trx) =>
        trx.selectFrom("story_styles").select(["name", "stylesheet", "specimen_html"]).where("product_id", "=", scope.product!.product_id).executeTakeFirst(),
      );
      if (!s) throw new AppError(404, "not_found", "This product has no Story style yet.");
      return storyHtml(c, styleSpecimen(s), theme, c.req.query("frame") === "1");
    } catch (e) {
      return errorResponse(c, toAppError(e));
    }
  });
  app.get(`${SCOPE_PREFIX.product}/story/house-styles/:style/specimen`, async (c) => {
    try {
      await scoped(c);
      const theme = storyTheme(c.req.query("theme"));
      const style = houseStyle(c.req.param("style")!);
      if (!style) throw new AppError(404, "not_found", `No such house style: ${HOUSE_STYLE_IDS.join(", ")}.`);
      return storyHtml(c, houseSpecimen(style), theme, c.req.query("frame") === "1");
    } catch (e) {
      return errorResponse(c, toAppError(e));
    }
  });

  // The Story print view: one composed HTML document, opened top-level in a new tab and printed to
  // PDF by the browser. Its policy runs only the nonce'd print script, in an opaque origin.
  app.get(`${SCOPE_PREFIX.product}/story/print`, async (c) => {
    try {
      const principal = await principalOf(c);
      const { tenant, team, product } = c.req.param() as Record<string, string>;
      const input = coerceQuery(printDocument as OperationDef, c.req.query());
      const { result } = await execute(env, principal, printDocument as OperationDef, input, { tenant, team, product });
      const { html, nonce } = result as { html: string; nonce: string };
      return c.body(html, 200, printResponseHeaders(nonce));
    } catch (e) {
      const err = toAppError(e);
      if (err.status === 500) console.error("story print view:", e);
      return errorResponse(c, err);
    }
  });

  return app;
}

export async function streamFile(
  c: Context,
  env: Env,
  v: { blob_key: string; size: number; media_type: string; sha256: string; file_version_id: string },
  path: string,
  download: boolean,
) {
  const name = path.split("/").pop() ?? "file";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // Uploaded HTML and SVG are never served renderable from the app's origin.
  const risky = /^(text\/html|application\/xhtml|image\/svg)/.test(v.media_type);
  const disposition = download || risky ? "attachment" : "inline";
  const headers: Record<string, string> = {
    "Content-Type": risky ? "application/octet-stream" : v.media_type,
    "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    // Browsers will not render a PDF inside a sandboxed document, and their PDF viewers run no page script.
    "Content-Security-Policy": `${v.media_type === "application/pdf" ? "default-src 'none'; object-src 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    ETag: `"${v.sha256}"`,
    "Accept-Ranges": "bytes",
    // People's material: no cache keeps it, the browser's included.
    "Cache-Control": "private, no-store",
  };
  const range = c.req.header("range");
  const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), v.size - 1) : v.size - 1;
    if (start >= v.size || start > end) return c.body(null, 416, { "Content-Range": `bytes */${v.size}` });
    const body = await env.ports.blobs.getStream(v.blob_key, { start, end });
    return c.body(body, 206, { ...headers, "Content-Range": `bytes ${start}-${end}/${v.size}`, "Content-Length": String(end - start + 1) });
  }
  const body = await env.ports.blobs.getStream(v.blob_key);
  return c.body(body, 200, { ...headers, "Content-Length": String(v.size) });
}
