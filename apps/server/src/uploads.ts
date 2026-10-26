import {
  admitRead, AppError, capRole, CARD_FRAMES, CARD_PREVIEW_PURPOSE, completeGrant, conflict, DOWNLOAD_GRANT_HEADER, effectiveRole, forbidden, isDocumentPurpose, levelAllows, membershipsFor, mockupBundle, json, MOCKUP_UPLOAD_PURPOSE, notFound,
  OPERATIONS, resolveScope, roleAtLeast, STORY_PREVIEW_PURPOSE, toAppError, tooLarge, UPLOAD_GRANT_HEADER, type ActorSnapshot, type ConnectionLevel, type Env, type OpContext, type Principal, type Scope, type Tx,
} from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { sql } from "kysely";
import type { ServerConfig } from "./config.ts";
import { requestedHost } from "./canonical-host.ts";
import { cardFront, storyHtml, storyTheme, streamFile } from "./documents.ts";

/** A count of bytes as people read it: 10,485,760. */
const bytes = (n: number) => n.toLocaleString("en-US");

async function inTenant<T>(env: Env, tenantId: string, fn: (trx: Tx) => Promise<T>): Promise<T> {
  return env.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** Build an operation context for work done on a grant's authority: attributed to whoever requested the grant. */
async function grantContext(env: Env, trx: Tx, productId: string, actor: ActorSnapshot, enqueued: { value: boolean }): Promise<OpContext> {
  const p = await trx.selectFrom("products").select(["product_id", "slug", "name", "archived_at", "team_id", "tenant_id"]).where("product_id", "=", productId).executeTakeFirstOrThrow();
  const team = await trx.selectFrom("teams").select(["team_id", "slug", "name"]).where("team_id", "=", p.team_id).executeTakeFirstOrThrow();
  const tenant = await trx.selectFrom("tenants").select(["tenant_id", "slug", "name"]).where("tenant_id", "=", p.tenant_id).executeTakeFirstOrThrow();
  return {
    principal: { account_id: actor.account_id, email: "", display_name: actor.display_name, auth_kind: "upload_grant", surface: actor.surface, client: actor.client },
    actor,
    db: trx,
    scope: { tenant, team, product: { product_id: p.product_id, slug: p.slug, name: p.name, archived_at: p.archived_at }, role: "editor", tenantRole: null },
    ports: env.ports,
    now: new Date().toISOString(),
    async enqueue(kind, payload) {
      await trx.insertInto("jobs").values({ tenant_id: tenant.tenant_id, kind, payload: json(payload) }).execute();
      enqueued.value = true;
    },
  };
}

/**
 * A request body for a blob store, which stops reading at the grant's limit. What the sender still
 * sends is then read and dropped, so their connection can take their next request: the Node
 * adapter drains an unread body itself, but not one a reader has begun, and resets the connection
 * half a second after the response instead, under a client that may already be sending on it.
 */
function relayed(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream({
    async pull(c) {
      const { done, value } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
    cancel() {
      // Not awaited: the refusal goes out at once, and the adapter's own limits on draining still apply.
      void (async () => {
        while (!(await reader.read()).done);
      })().catch(() => {});
    },
  });
}

/**
 * The operation each kind of grant to read comes from, or, for a document on the content site
 * (content-address.ts), the operation that needs what the app's own route for it needs: its
 * requester must still be allowed that. A card is outcomes.get, never products.get, which a reader
 * may call and the card's own route refuses.
 */
const ISSUED_BY: Record<string, string> = {
  download: "attachments.get_download",
  mockup: "mockups.get_download",
  [STORY_PREVIEW_PURPOSE]: "story.preview",
  [CARD_PREVIEW_PURPOSE]: "outcomes.card_preview",
  export: "products.exports",
  story_page: "story.get_version",
  print: "story.get_version",
  mockup_page: "mockups.get_version",
  specimen: "story.get_style",
  card: "outcomes.get",
  attachment: "attachments.get_download",
};

const noLongerReads = () => forbidden("Whoever requested this grant can no longer read this product. Nothing was sent.");

/**
 * Checked before a download grant, or a document's address on the content site, sends a byte, as
 * the upload relay checks before it stores one: whoever requested the grant may still do, on the
 * product it reads, what the operation that gave it needed. Their account still exists; their role
 * there, capped by their connection's level, still allows it; and an agent's connection is still
 * connected. A download counts as a call against the limits they meet there (their organization's
 * plan, or a guest's in the example organization); a document does not, since the app's own route
 * counted it when it handed the document off.
 * Returns them, and the product as they reach it now, whose role decides what a reader is given.
 */
export async function requesterMayRead(env: Env, claims: Record<string, unknown>, productId: string): Promise<{ principal: Principal; scope: Scope }> {
  const op = OPERATIONS.find((o) => o.name === ISSUED_BY[String(claims["purpose"])])!;
  if (typeof claims["a"] !== "string") throw new AppError(401, "invalid_grant", "The grant is invalid or expired. Request a new one.");
  const account = await env.db
    .selectFrom("accounts")
    .select(["account_id", "email", "display_name"])
    .where("account_id", "=", claims["a"])
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!account) throw noLongerReads();
  let level: ConnectionLevel | undefined;
  if (typeof claims["f"] === "string") {
    const live = await env.db
      .selectFrom("oauth_tokens")
      .select("level")
      .where("family_id", "=", claims["f"])
      .where("account_id", "=", account.account_id)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date().toISOString())
      .executeTakeFirst();
    if (!live) throw forbidden("The agent connection that requested this grant is disconnected. Nothing was sent.");
    level = live.level;
  }
  if (!levelAllows(level, op)) throw noLongerReads();
  const principal: Principal = {
    account_id: account.account_id, email: account.email, display_name: account.display_name, auth_kind: "upload_grant", surface: level ? "mcp" : "web", client: null,
    ...(level ? { level } : {}),
  };
  const resolved = await resolveScope(env.db, principal, "product", op.access, { product: productId }, op.name).catch((e: unknown) => {
    throw e instanceof AppError && (e.status === 403 || e.status === 404) ? noLongerReads() : e;
  });
  if (!isDocumentPurpose(claims["purpose"])) await admitRead(env, principal, resolved, op.name);
  return { principal, scope: level ? { ...resolved, role: capRole(resolved.role, level) } : resolved };
}

/**
 * The upload relay: agents' bytes arrive on the service's own host, because an agent's sandbox can
 * often reach the service but not the object store. The grant in the header is the only credential
 * here; identity headers and cookies are ignored. The file is attributed to whoever requested the
 * grant, and registered at once, so complete_upload afterwards is an idempotent confirmation.
 */
export function uploadRoutes(env: Env & { config: ServerConfig }) {
  const app = new Hono();
  // With a content site, agents' previews are served there, as every document of people's HTML is.
  const contentHost = env.config.contentUrl ? new URL(env.config.contentUrl).host.toLowerCase() : null;
  const site = contentHost ? new URL(env.config.publicBaseUrl).origin : null;
  const previewsElsewhere = (c: Context) => contentHost !== null && requestedHost((name) => c.req.header(name)) !== contentHost;
  const fail = (c: Context, e: unknown) => {
    const err = toAppError(e);
    if (err.status === 500) console.error("upload relay:", e);
    return c.json({ error: err.toJSON() }, err.status as 400);
  };

  app.put("/api/v1/uploads/:grant_id", async (c) => {
    try {
      const token = c.req.header(UPLOAD_GRANT_HEADER) ?? "";
      const claims = env.ports.grants.verify(token);
      if (!claims || claims["purpose"] !== "upload" || claims["g"] !== c.req.param("grant_id")) throw new AppError(401, "invalid_grant", "The upload grant is missing, invalid or expired. Request a new one with attachments(action=\"request_upload\").");
      const tenantId = String(claims["t"]);
      const grant = await inTenant(env, tenantId, (trx) => trx.selectFrom("upload_grants").selectAll().where("grant_id", "=", c.req.param("grant_id")).executeTakeFirst());
      if (!grant) throw notFound("No such upload grant.");
      // Bytes that reach the relay are attached in the same step, so a grant that took them is used up.
      if (grant.uploaded_at)
        throw conflict(
          "already_uploaded",
          grant.completed_at
            ? `Bytes for ${grant.path} already arrived under this grant and are attached to source ${grant.record_id}; nothing more is needed. For a new version of ${grant.path}, request another grant with attachments(action="request_upload").`
            : `Bytes for ${grant.path} already arrived under this grant. Call attachments(action="complete_upload") with record_id ${grant.record_id} and path ${grant.path} to attach them.`,
        );
      if (Date.parse(grant.expires_at) < Date.now()) throw new AppError(401, "invalid_grant", "The upload grant has expired. Request a new one.");
      // A grant carries its requester's authority only while they may still write here: someone made a reader or viewer, or removed, since it was given stores nothing.
      const role = await inTenant(env, tenantId, async (trx) => {
        const product = await trx.selectFrom("products").select("team_id").where("product_id", "=", grant.product_id).executeTakeFirst();
        return effectiveRole(await membershipsFor(trx, grant.principal.account_id, tenantId), { tenant_id: tenantId, team_id: product?.team_id ?? null, product_id: grant.product_id }).role;
      });
      if (!roleAtLeast(role, "editor")) throw forbidden("Whoever requested this upload grant can no longer write to this product. Nothing was stored.", { role, needed: "editor" });
      const max = Math.min(Number(grant.max_bytes), env.config.relayMaxBytes);
      const declared = c.req.header("content-length");
      if (declared !== undefined && (!/^\d+$/.test(declared))) throw new AppError(400, "invalid_length", "Content-Length is not a number.");
      if (declared !== undefined && Number(declared) > max)
        throw tooLarge(`The file is ${bytes(Number(declared))} bytes; this upload route takes at most ${bytes(max)}.${env.ports.blobs.signedUploadUrl ? " Use the grant's `direct` URL for larger files." : ""}`, { limit: max });
      const body = c.req.raw.body;
      if (!body) throw new AppError(400, "empty_body", "Send the file's bytes as the request body.");
      const stored = await env.ports.blobs.putStream(grant.blob_key!, relayed(body), { contentType: grant.media_type ?? "application/octet-stream", maxBytes: max });
      const enqueued = { value: false };
      const entry = await inTenant(env, tenantId, async (trx) => {
        await trx.updateTable("upload_grants").set({ uploaded_at: new Date().toISOString(), size: stored.size, sha256: stored.sha256 }).where("grant_id", "=", grant.grant_id).execute();
        const ctx = await grantContext(env, trx, grant.product_id, grant.principal, enqueued);
        return completeGrant(ctx, grant.grant_id);
      });
      if (enqueued.value) env.ports.notifyJobs?.();
      return c.json({ uploaded: true, size: stored.size, sha256: stored.sha256, attachment: entry, next: "Added: attachment.note says what becomes of its text. No complete_upload is needed." }, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  // A canvas's ZIP for mockups.publish. Stored as it arrives, read only when publish names it.
  app.put("/api/v1/uploads/mockup/:upload_id", async (c) => {
    try {
      const claims = env.ports.grants.verify(c.req.header(UPLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== MOCKUP_UPLOAD_PURPOSE || claims["u"] !== c.req.param("upload_id"))
        throw new AppError(401, "invalid_grant", "The upload grant is missing, invalid or expired. Request a new one with mockups(action=\"request_upload\").");
      const tenantId = String(claims["t"]);
      const upload = await inTenant(env, tenantId, (trx) => trx.selectFrom("mockup_uploads").selectAll().where("upload_id", "=", c.req.param("upload_id")).executeTakeFirst());
      if (!upload) throw notFound("No such upload grant.");
      if (upload.uploaded_at) throw conflict("already_uploaded", "A ZIP already arrived under this grant. Publish it with upload_id, or request a new upload.");
      if (Date.parse(upload.expires_at) < Date.now()) throw new AppError(401, "invalid_grant", "The upload grant has expired. Request a new one.");
      const role = await inTenant(env, tenantId, async (trx) => {
        const product = await trx.selectFrom("products").select("team_id").where("product_id", "=", upload.product_id).executeTakeFirst();
        return effectiveRole(await membershipsFor(trx, upload.principal.account_id, tenantId), { tenant_id: tenantId, team_id: product?.team_id ?? null, product_id: upload.product_id }).role;
      });
      if (!roleAtLeast(role, "editor")) throw forbidden("Whoever requested this upload grant can no longer write to this product. Nothing was stored.", { role, needed: "editor" });
      const max = Math.min(Number(upload.max_bytes), env.config.relayMaxBytes);
      const declared = c.req.header("content-length");
      if (declared !== undefined && !/^\d+$/.test(declared)) throw new AppError(400, "invalid_length", "Content-Length is not a number.");
      if (declared !== undefined && Number(declared) > max) throw tooLarge(`The ZIP is ${bytes(Number(declared))} bytes; a canvas's ZIP is at most ${bytes(max)}.`, { limit: max });
      const body = c.req.raw.body;
      if (!body) throw new AppError(400, "empty_body", "Send the ZIP's bytes as the request body.");
      const stored = await env.ports.blobs.putStream(upload.blob_key, relayed(body), { contentType: "application/zip", maxBytes: max });
      await inTenant(env, tenantId, (trx) => trx.updateTable("mockup_uploads").set({ uploaded_at: new Date().toISOString(), size: stored.size, sha256: stored.sha256 }).where("upload_id", "=", upload.upload_id).execute());
      return c.json({ uploaded: true, upload_id: upload.upload_id, size: stored.size, sha256: stored.sha256, next: 'Received. Now call mockups(action="publish") with upload_id, and mockup_id with expected_etag for a later version. The ZIP is checked then; nothing is published until that call succeeds.' }, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/v1/downloads/:file_version_id", async (c) => {
    try {
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== "download" || claims["fv"] !== c.req.param("file_version_id")) throw new AppError(401, "invalid_grant", "The download grant is missing, invalid or expired. Request a new one with attachments(action=\"get_download\").");
      const found = await inTenant(env, String(claims["t"]), async (trx) => {
        const v = await trx.selectFrom("file_versions").selectAll().where("file_version_id", "=", c.req.param("file_version_id")).executeTakeFirst();
        if (!v) return null;
        const f = await trx.selectFrom("files").select("path").where("file_id", "=", v.file_id).executeTakeFirst();
        const r = await trx.selectFrom("records").select("product_id").where("record_id", "=", v.record_id).executeTakeFirst();
        return r ? { v, path: f?.path ?? "file", product_id: r.product_id } : null;
      });
      if (!found) throw notFound("That file no longer exists.");
      await requesterMayRead(env, claims, found.product_id);
      return streamFile(c, env, found.v, found.path, true);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/v1/downloads/mockup/:version_id", async (c) => {
    try {
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== "mockup" || claims["xv"] !== c.req.param("version_id"))
        throw new AppError(401, "invalid_grant", "The download grant is missing, invalid or expired. Request a new one with mockups(action=\"get_download\").");
      const version = await inTenant(env, String(claims["t"]), (trx) => trx.selectFrom("mockup_versions").select("product_id").where("version_id", "=", c.req.param("version_id")).executeTakeFirst());
      if (!version) throw notFound("That mockup version no longer exists.");
      await requesterMayRead(env, claims, version.product_id);
      const bundle = await inTenant(env, String(claims["t"]), (trx) => mockupBundle(trx, c.req.param("version_id"), env.ports.blobs));
      if (!bundle) throw notFound("That mockup version no longer exists.");
      return c.body(bundle.bytes as unknown as ArrayBuffer, 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${bundle.name}"`,
        "Content-Length": String(bundle.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
    } catch (e) {
      return fail(c, e);
    }
  });

  // The document story.preview checked: what publish would store, served exactly as a published
  // version is (the same sandbox, typefaces and ?theme), for an agent to look at before publishing.
  app.get("/api/v1/downloads/story-preview/:preview_id", async (c) => {
    try {
      if (previewsElsewhere(c)) throw notFound(`This deployment serves previews from its content site, ${env.config.contentUrl}: GET the url the preview gave.`);
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== STORY_PREVIEW_PURPOSE || claims["sp"] !== c.req.param("preview_id"))
        throw new AppError(401, "invalid_grant", "The preview grant is missing, invalid or expired. Preview again with story(action=\"preview\").");
      const theme = storyTheme(c.req.query("theme"));
      const p = await inTenant(env, String(claims["t"]), (trx) =>
        trx.selectFrom("story_previews").select(["product_id", "html", "shows_mockup", "expires_at"]).where("preview_id", "=", c.req.param("preview_id")).executeTakeFirst(),
      );
      if (!p || Date.parse(p.expires_at) < Date.now()) throw notFound("That preview has expired or was replaced by newer ones. Preview again with story(action=\"preview\").");
      await requesterMayRead(env, claims, p.product_id);
      // A Story page in the Story's sandbox (page-sandbox.ts). A mockup page carries its own look, so
      // it takes neither the theme nor the carried typefaces, and keeps a mockup page's sandbox.
      return storyHtml(c, p.html, p.shows_mockup ? undefined : theme, false, p.shows_mockup, site);
    } catch (e) {
      return fail(c, e);
    }
  });

  // The front outcomes.card_preview checked, in the document the Idea screen shows it in (the same
  // sandbox, kit and ?theme), with a line where a desktop stops showing it, for an agent to look at
  // before writing it.
  app.get("/api/v1/downloads/card-preview/:preview_id", async (c) => {
    try {
      if (previewsElsewhere(c)) throw notFound(`This deployment serves previews from its content site, ${env.config.contentUrl}: GET the url the preview gave.`);
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== CARD_PREVIEW_PURPOSE || claims["cp"] !== c.req.param("preview_id"))
        throw new AppError(401, "invalid_grant", "The preview grant is missing, invalid or expired. Preview again with outcomes(action=\"card_preview\").");
      const theme = storyTheme(c.req.query("theme"));
      const p = await inTenant(env, String(claims["t"]), (trx) =>
        trx.selectFrom("card_previews").select(["product_id", "kind", "title", "card_html", "expires_at"]).where("preview_id", "=", c.req.param("preview_id")).executeTakeFirst(),
      );
      if (!p || Date.parse(p.expires_at) < Date.now()) throw notFound("That preview has expired or was replaced by newer ones. Preview again with outcomes(action=\"card_preview\").");
      await requesterMayRead(env, claims, p.product_id);
      return cardFront(c, p.card_html, p.title, theme, site, CARD_FRAMES[p.kind].max_height);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/v1/downloads/export/:export_id", async (c) => {
    try {
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== "export" || claims["e"] !== c.req.param("export_id")) throw new AppError(401, "invalid_grant", "The download grant is missing, invalid or expired. Call products(action=\"exports\") again for a fresh one.");
      const ex = await inTenant(env, String(claims["t"]), (trx) => trx.selectFrom("exports").select("product_id").where("export_id", "=", c.req.param("export_id")).executeTakeFirst());
      if (!ex) throw notFound("That export is not ready or no longer exists.");
      await requesterMayRead(env, claims, ex.product_id);
      return await sendExport(c, env, String(claims["t"]), c.req.param("export_id"));
    } catch (e) {
      return fail(c, e);
    }
  });

  return app;
}

export async function sendExport(c: Context, env: Env, tenantId: string, exportId: string, productId?: string) {
  const ex = await inTenant(env, tenantId, async (trx) => {
    let q = trx.selectFrom("exports as e").innerJoin("products as p", "p.product_id", "e.product_id").select(["e.blob_key", "e.size", "e.status", "e.created_at", "p.slug"]).where("e.export_id", "=", exportId);
    if (productId) q = q.where("e.product_id", "=", productId);
    return q.executeTakeFirst();
  });
  if (!ex || ex.status !== "ready" || !ex.blob_key) throw notFound("That export is not ready or no longer exists.");
  const name = `${ex.slug}-export-${ex.created_at.slice(0, 10)}.zip`;
  const body = await env.ports.blobs.getStream(ex.blob_key);
  return c.body(body, 200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Content-Length": String(ex.size),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}
