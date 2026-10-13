import {
  AppError, completeGrant, conflict, DOWNLOAD_GRANT_HEADER, effectiveRole, forbidden, membershipsFor, mockupBundle, json, lockSandbox, MOCKUP_UPLOAD_PURPOSE, notFound, roleAtLeast, sandboxForAccount, toAppError,
  tooLarge, UPLOAD_GRANT_HEADER, type ActorSnapshot, type Env, type OpContext, type Tx,
} from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { sql } from "kysely";
import type { ServerConfig } from "./config.ts";
import { streamFile } from "./rest.ts";

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
 * The upload relay: agents' bytes arrive on the service's own host, because an agent's sandbox can
 * often reach the service but not the object store. The grant in the header is the only credential
 * here; identity headers and cookies are ignored. The file is attributed to whoever requested the
 * grant, and registered at once, so complete_upload afterwards is an idempotent confirmation.
 */
export function uploadRoutes(env: Env & { config: ServerConfig }) {
  const app = new Hono();
  const fail = (c: Context, e: unknown) => {
    const err = toAppError(e);
    if (err.status === 500) console.error("upload relay:", e);
    return c.json({ error: err.toJSON() }, err.status as 400);
  };

  app.put("/api/v1/uploads/:grant_id", async (c) => {
    try {
      const token = c.req.header(UPLOAD_GRANT_HEADER) ?? "";
      const claims = env.ports.grants.verify(token);
      if (!claims || claims["purpose"] !== "upload" || claims["g"] !== c.req.param("grant_id")) throw new AppError(401, "invalid_grant", "The upload grant is missing, invalid or expired. Request a new one with files(action=\"request_upload\").");
      const tenantId = String(claims["t"]);
      const grant = await inTenant(env, tenantId, (trx) => trx.selectFrom("upload_grants").selectAll().where("grant_id", "=", c.req.param("grant_id")).executeTakeFirst());
      if (!grant) throw notFound("No such upload grant.");
      if (grant.uploaded_at) throw conflict("already_uploaded", `Bytes for ${grant.path} already arrived under this grant. Call files(action="complete_upload") to attach them.`);
      if (Date.parse(grant.expires_at) < Date.now()) throw new AppError(401, "invalid_grant", "The upload grant has expired. Request a new one.");
      // A grant given to a visitor before the public sandbox stopped their writes takes no bytes after.
      const sandbox = await sandboxForAccount(env.db, tenantId, grant.principal.account_id);
      if (sandbox?.visitor && sandbox.settings.visitor_access !== "write")
        throw new AppError(403, sandbox.settings.visitor_access === "closed" ? "sandbox_closed" : "sandbox_read_only", "This public sandbox is not taking visitors' uploads for now. Nothing was stored; try again later with a new grant.");
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
        throw tooLarge(`The file is ${declared} bytes; this upload route takes at most ${max}.${env.ports.blobs.signedUploadUrl ? " Use the grant's `direct` URL for larger files." : ""}`, { limit: max });
      const body = c.req.raw.body;
      if (!body) throw new AppError(400, "empty_body", "Send the file's bytes as the request body.");
      const stored = await env.ports.blobs.putStream(grant.blob_key!, body, { contentType: grant.media_type ?? "application/octet-stream", maxBytes: max });
      const enqueued = { value: false };
      const entry = await inTenant(env, tenantId, async (trx) => {
        await lockSandbox(trx, tenantId, "shared");
        await trx.updateTable("upload_grants").set({ uploaded_at: new Date().toISOString(), size: stored.size, sha256: stored.sha256 }).where("grant_id", "=", grant.grant_id).execute();
        const ctx = await grantContext(env, trx, grant.product_id, grant.principal, enqueued);
        return completeGrant(ctx, grant.grant_id);
      });
      if (enqueued.value) env.ports.notifyJobs?.();
      return c.json({ uploaded: true, size: stored.size, sha256: stored.sha256, file: entry, next: 'Received. Now call files(action="complete_upload") with record_id and path, as the grant said: it confirms the file is attached, returns its search_status and what happens next, and adds any provenance (derived_from, derivation_note, derived_by). Repeating it is harmless.' }, 201);
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
      if (declared !== undefined && Number(declared) > max) throw tooLarge(`The ZIP is ${declared} bytes; a canvas's ZIP is at most ${max}.`, { limit: max });
      const body = c.req.raw.body;
      if (!body) throw new AppError(400, "empty_body", "Send the ZIP's bytes as the request body.");
      const stored = await env.ports.blobs.putStream(upload.blob_key, body, { contentType: "application/zip", maxBytes: max });
      await inTenant(env, tenantId, (trx) => trx.updateTable("mockup_uploads").set({ uploaded_at: new Date().toISOString(), size: stored.size, sha256: stored.sha256 }).where("upload_id", "=", upload.upload_id).execute());
      return c.json({ uploaded: true, upload_id: upload.upload_id, size: stored.size, sha256: stored.sha256, next: 'Received. Now call mockups(action="publish") with upload_id, and mockup_id with expected_etag for a later version. The ZIP is checked then; nothing is published until that call succeeds.' }, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/v1/downloads/:file_version_id", async (c) => {
    try {
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== "download" || claims["fv"] !== c.req.param("file_version_id")) throw new AppError(401, "invalid_grant", "The download grant is missing, invalid or expired. Request a new one with files(action=\"get_download\").");
      const found = await inTenant(env, String(claims["t"]), async (trx) => {
        const v = await trx.selectFrom("file_versions").selectAll().where("file_version_id", "=", c.req.param("file_version_id")).executeTakeFirst();
        if (!v) return null;
        const f = await trx.selectFrom("files").select("path").where("file_id", "=", v.file_id).executeTakeFirst();
        return { v, path: f?.path ?? "file" };
      });
      if (!found) throw notFound("That file no longer exists.");
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
      const bundle = await inTenant(env, String(claims["t"]), (trx) => mockupBundle(trx, c.req.param("version_id")));
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

  app.get("/api/v1/downloads/export/:export_id", async (c) => {
    try {
      const claims = env.ports.grants.verify(c.req.header(DOWNLOAD_GRANT_HEADER) ?? "");
      if (!claims || claims["purpose"] !== "export" || claims["e"] !== c.req.param("export_id")) throw new AppError(401, "invalid_grant", "The download grant is missing, invalid or expired. List exports again for a fresh one.");
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
