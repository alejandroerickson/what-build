import { isRecording, parserFor, SUPPORTED_EXTENSIONS } from "@whatbuild/parsers";
import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json } from "../db.ts";
import { AppError, conflict, invalid, notFound, tooLarge } from "../errors.ts";
import { kindInfo, SEARCH_RULE } from "../kinds.ts";
import { extensionForMediaType, extensionOf, mediaTypeFor, NOTE_EXTENSIONS, validFilePath } from "../media.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { fileRole, id, kind } from "../schemas.ts";
import { newEtag, newId, sha256Hex } from "../util.ts";
import { derivedStatuses, duplicateWarnings, fileEntries, insertRecord, loadRecord, NO_PRIMARY_WARNING, recordMetadata, recordSummary } from "./sources.ts";

export const UPLOAD_GRANT_HEADER = "X-WhatBuild-Upload-Grant";
export const DOWNLOAD_GRANT_HEADER = "X-WhatBuild-Download-Grant";

export const NOTE_MAX_BYTES = 2048;
export const NOTE_MAX_LINES = 20;

const provenance = {
  derived_from: z.array(z.string().min(1).max(200)).max(20).optional().describe("Paths of files on this record that this file narrows (a digest's originals)."),
  derivation_note: z.string().max(2000).optional().describe("How this file was produced: what was kept, what was left out."),
  derived_by: z.enum(["agent", "human"]).optional(),
};

function checkPath(path: string) {
  const problem = validFilePath(path);
  if (problem) throw invalid("invalid_path", `${problem}.`);
}

/**
 * A warning, before any bytes move, when a primary's format has no parser: the primary role is
 * permanent, so the mistake is cheapest to catch at the grant. A recording is left out; its
 * result already says it is kept unparsed and needs a transcript source.
 */
export function unparsedPrimaryWarnings(path: string, role: string, declaredType?: string | null): string[] {
  if (role !== "primary") return [];
  const mediaType = mediaTypeFor(path, declaredType);
  if (isRecording(path, mediaType) || parserFor(path, mediaType)) return [];
  const ext = extensionOf(path) || "(no extension)";
  return [
    `No parser reads ${ext} files, so this primary would be stored but never parsed or searched, and a source's primary cannot be replaced by another file. ` +
      `To make it searchable, upload a PDF export (or another parsed format: ${SUPPORTED_EXTENSIONS.join(", ")}) as the primary instead, and add ${path} to the same source with role origin.`,
  ];
}

/** Validate that `path` can receive a new file or version with `role`, before any grant or bytes. */
async function checkTarget(ctx: OpContext, recordId: string, path: string, role: string) {
  checkPath(path);
  const existing = await ctx.db.selectFrom("files").select(["path", "role"]).where("record_id", "=", recordId).execute();
  const same = existing.find((f) => f.path === path);
  if (same && same.role !== role)
    throw conflict("role_mismatch", `${path} is already a ${same.role} file on this source; upload a new version with role ${same.role}, or use another path.`);
  if (role === "primary" && !same) {
    const primary = existing.find((f) => f.role === "primary");
    if (primary) throw conflict("primary_taken", `This source's primary file is ${primary.path}. Upload a new version to that path, or create a new source.`);
    const reserved = await ctx.db
      .selectFrom("upload_grants")
      .select("path")
      .where("record_id", "=", recordId)
      .where("role", "=", "primary")
      .where("completed_at", "is", null)
      .where("expires_at", ">", ctx.now)
      .where("path", "!=", path)
      .executeTakeFirst();
    if (reserved) throw conflict("primary_reserved", `An upload of ${reserved.path} as primary is in progress; reuse that path or wait for its grant to expire.`);
  }
  const count = existing.length + (same ? 0 : 1);
  if (count > 50) throw conflict("too_many_files", "A source holds at most 50 files.");
}

export function blobKeyFor(tenant: string, recordId: string, fileVersionId: string) {
  return `t/${tenant}/r/${recordId}/f/${fileVersionId}`;
}

async function issueGrant(
  ctx: OpContext,
  recordId: string,
  input: { path: string; role: "primary" | "origin" | "supplement"; media_type?: string | undefined; size?: number | undefined; derived_from?: string[] | undefined; derivation_note?: string | undefined; derived_by?: string | undefined },
) {
  const cfg = ctx.ports.config;
  if (input.size !== undefined && input.size > cfg.fileMaxBytes) throw tooLarge(`Files are limited to ${cfg.fileMaxBytes} bytes.`, { limit: cfg.fileMaxBytes });
  const grant_id = newId();
  const file_version_id = newId();
  const blob_key = blobKeyFor(tenantId(ctx), recordId, file_version_id);
  const expiresAt = new Date(Date.parse(ctx.now) + cfg.grantTtlSeconds * 1000);
  const mediaType = mediaTypeFor(input.path, input.media_type);
  await ctx.db
    .insertInto("upload_grants")
    .values({
      grant_id, tenant_id: tenantId(ctx), product_id: productId(ctx), record_id: recordId, path: input.path, role: input.role,
      media_type: mediaType, max_bytes: cfg.fileMaxBytes, derived_from: input.derived_from ?? [], derivation_note: input.derivation_note ?? null,
      derived_by: input.derived_by ?? null, principal: json(ctx.actor), expires_at: expiresAt.toISOString(), blob_key,
    })
    .execute();
  const token = ctx.ports.grants.sign({ v: 1, purpose: "upload", g: grant_id, t: tenantId(ctx), exp: Math.floor(expiresAt.getTime() / 1000) });
  let direct: { url: string; method: "PUT"; headers: Record<string, string>; max_bytes: number } | undefined;
  if (ctx.ports.blobs.signedUploadUrl) {
    const signed = await ctx.ports.blobs.signedUploadUrl(blob_key, mediaType, expiresAt);
    direct = { url: signed.url, method: "PUT", headers: signed.headers, max_bytes: cfg.fileMaxBytes };
  }
  return {
    grant_id,
    record_id: recordId,
    path: input.path,
    role: input.role,
    method: "PUT" as const,
    url: `${cfg.publicBaseUrl}/api/v1/uploads/${grant_id}`,
    headers: { [UPLOAD_GRANT_HEADER]: token, "Content-Type": mediaType },
    max_bytes: Math.min(cfg.relayMaxBytes, cfg.fileMaxBytes),
    expires_at: expiresAt.toISOString(),
    ...(direct ? { direct } : {}),
    next:
      "PUT the file's raw bytes to url with exactly these headers (one request, no multipart), then call files(action=\"complete_upload\") with record_id and path. " +
      (direct ? "For a file over max_bytes use `direct` instead: PUT to direct.url with direct.headers, then complete the same way. " : "") +
      "Keep the grant header out of reports and logs.",
  };
}

// ---- Upload grants ------------------------------------------------------------------------------

const requestUploadInput = {
  path: z.string().min(1).max(200).describe("Record-relative file name, e.g. interview.vtt. Uploading to an existing path adds a version."),
  role: fileRole.default("primary").describe("primary is parsed and searched; origin and supplement are kept, never searched."),
  media_type: z.string().max(200).optional(),
  size: z.number().int().min(0).optional().describe("The file's size in bytes, when known, so an oversized file is refused before it transfers."),
  ...provenance,
};

export const requestUpload = defineOperation({
  name: "files.request_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Get a short-lived grant to PUT one file's bytes to a source. Never pass file bytes through a tool call.",
  description:
    `Returns {url, method: "PUT", headers, max_bytes, expires_at, warnings}; warnings flag a primary no parser reads, before any bytes move. Send the local file's bytes with your own shell or HTTP tool (curl -T file -H …), then call complete_upload. Grants are single-file, create-only, and expire. ${SEARCH_RULE} Never encode file content as base64 in a tool argument; if you cannot reach the URL, ask the person to use the web upload instead.`,
  input: z.strictObject({ record_id: id("source"), ...requestUploadInput }),
  rest: { method: "POST", path: "/sources/:record_id/uploads" },
  mcp: { tool: "files", action: "request_upload" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id, { live: true });
    await checkTarget(ctx, input.record_id, input.path, input.role);
    const grant = await issueGrant(ctx, input.record_id, input);
    return { ...grant, warnings: unparsedPrimaryWarnings(input.path, input.role, input.media_type) };
  },
});

export const createUpload = defineOperation({
  name: "files.create_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Create a source and get an upload grant for its first file, in one call.",
  description:
    "Takes sources.create's metadata plus the file's path and role. Returns {record, upload, warnings}; PUT the bytes to upload.url with upload.headers, then call complete_upload. Read warnings first: they flag a primary no parser reads, and an existing source with the same title, kind and date. Prefer a digest to a bulk upload for long or mostly off-topic documents, and keep the original as an origin file.",
  input: z.strictObject({ kind, ...recordMetadata, ...requestUploadInput }),
  rest: { method: "POST", path: "/sources/with-upload" },
  mcp: { tool: "files", action: "create_upload" },
  async handler(ctx, input) {
    checkPath(input.path);
    const { path, role, media_type, size, derived_from, derivation_note, derived_by, ...meta } = input;
    const warnings = [...(await duplicateWarnings(ctx, meta)), ...unparsedPrimaryWarnings(path, role, media_type)];
    const r = await insertRecord(ctx, meta);
    const upload = await issueGrant(ctx, r.record_id, { path, role, media_type, size, derived_from, derivation_note, derived_by });
    return { record: recordSummary(r, { derived_status: "pending", segment_count: 0, file_count: 0 }), upload, warnings };
  },
});

/**
 * Register the bytes behind a grant as a file version: the stored object's own size, hash and
 * type decide the entry, never the caller's claims. Idempotent: a repeat returns the entry.
 */
export async function completeGrant(ctx: OpContext, grantId: string, provenanceOverride?: { derived_from?: string[] | undefined; derivation_note?: string | undefined; derived_by?: string | undefined }) {
  const g = await ctx.db.selectFrom("upload_grants").selectAll().where("grant_id", "=", grantId).forUpdate().executeTakeFirstOrThrow();
  const record = await loadRecord(ctx, g.record_id);
  if (!g.completed_at) {
    let size = g.size === null ? null : Number(g.size);
    let sha = g.sha256;
    if (size === null) {
      // A direct-to-store upload: read what actually landed.
      const stat = await ctx.ports.blobs.stat(g.blob_key!);
      if (!stat)
        throw notFound(`No bytes have arrived for ${g.path} yet. PUT the file to the grant's url first, then call complete_upload again.`);
      size = stat.size;
      sha = stat.sha256 ?? sha256Hex(await ctx.ports.blobs.get(g.blob_key!));
      await ctx.db.updateTable("upload_grants").set({ uploaded_at: ctx.now, size, sha256: sha }).where("grant_id", "=", g.grant_id).execute();
    }
    if (record.archived_at) throw conflict("record_archived", `The file for ${g.path} arrived, but source ${record.record_id} was archived meanwhile; restore it, then call complete_upload again. Nothing was attached.`);
    const fileVersionId = g.blob_key!.split("/").pop()!;
    let file = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", g.record_id).where("path", "=", g.path).executeTakeFirst();
    const prov = { derived_from: provenanceOverride?.derived_from ?? g.derived_from, derivation_note: provenanceOverride?.derivation_note ?? g.derivation_note, derived_by: provenanceOverride?.derived_by ?? g.derived_by };
    if (!file) {
      if (g.role === "primary") {
        const other = await ctx.db.selectFrom("files").select("path").where("record_id", "=", g.record_id).where("role", "=", "primary").executeTakeFirst();
        if (other) throw conflict("primary_taken", `The file ${g.path} arrived but is not attached: this source's primary is already ${other.path}. Create a new source for it, then upload again.`);
      }
      const file_id = newId();
      await ctx.db
        .insertInto("files")
        .values({ file_id, tenant_id: g.tenant_id, record_id: g.record_id, path: g.path, role: g.role, current_version_id: null, derived_from: prov.derived_from ?? [], derivation_note: prov.derivation_note ?? null, derived_by: prov.derived_by ?? null, added_by: json(g.principal) })
        .execute();
      file = await ctx.db.selectFrom("files").selectAll().where("file_id", "=", file_id).executeTakeFirstOrThrow();
    }
    await ctx.db
      .insertInto("file_versions")
      .values({ file_version_id: fileVersionId, tenant_id: g.tenant_id, record_id: g.record_id, file_id: file.file_id, blob_key: g.blob_key!, size: size!, sha256: sha!, media_type: g.sniffed_type ?? g.media_type ?? mediaTypeFor(g.path), created_by: json(g.principal) })
      .execute();
    await ctx.db
      .updateTable("files")
      .set({ current_version_id: fileVersionId, derived_from: prov.derived_from ?? file.derived_from, derivation_note: prov.derivation_note ?? file.derivation_note, derived_by: prov.derived_by ?? file.derived_by })
      .where("file_id", "=", file.file_id)
      .execute();
    await ctx.db.updateTable("upload_grants").set({ completed_at: ctx.now, file_version_id: fileVersionId }).where("grant_id", "=", g.grant_id).execute();
    // Adding a file changes the source, so its etag moves on.
    await ctx.db.updateTable("records").set({ etag: newEtag() }).where("record_id", "=", g.record_id).execute();
    if (g.role === "primary") await ctx.enqueue("derive", { record_id: g.record_id, file_version_id: fileVersionId });
    await recordActivity(ctx, { action: "file_added", entity_type: "source", entity_id: g.record_id, entity_title: record.title, summary: `Added ${g.role} file ${g.path}` });
  } else if (provenanceOverride && Object.values(provenanceOverride).some((v) => v !== undefined)) {
    await ctx.db
      .updateTable("files")
      .set({
        ...(provenanceOverride.derived_from ? { derived_from: provenanceOverride.derived_from } : {}),
        ...(provenanceOverride.derivation_note ? { derivation_note: provenanceOverride.derivation_note } : {}),
        ...(provenanceOverride.derived_by ? { derived_by: provenanceOverride.derived_by } : {}),
      })
      .where("record_id", "=", g.record_id)
      .where("path", "=", g.path)
      .execute();
  }
  const status = (await derivedStatuses(ctx, [g.record_id])).get(g.record_id)!;
  const entries = await fileEntries(ctx, g.record_id, status.derived_status);
  const entry = entries.find((e) => e.path === g.path)!;
  // Before the worker has run, the outcome for a recording or an unreadable format is already known.
  let outcome = status.derived_status;
  let detail = status.status_detail;
  if (entry.role === "primary" && outcome === "pending") {
    if (isRecording(g.path, entry.media_type)) outcome = "needs_transcript";
    else if (!parserFor(g.path, entry.media_type)) [outcome, detail] = ["unsupported", `no parser reads ${extensionOf(g.path) || "(no extension)"} files`];
  }
  const warnings = entry.role !== "primary" && status.derived_status === "awaiting_file" ? [NO_PRIMARY_WARNING] : [];
  const { etag: record_etag } = await ctx.db.selectFrom("records").select("etag").where("record_id", "=", g.record_id).executeTakeFirstOrThrow();
  return { ...entry, record_id: g.record_id, record_etag, note: fileNote(entry.role, outcome, detail), warnings };
}

/** What will happen to a file, in words that match its search_status. */
export function fileNote(role: string, derivedStatus: string, statusDetail: string | null): string {
  if (role !== "primary") return "This file is stored in full and downloadable; it is not searched.";
  const detail = statusDetail ? ` (${statusDetail})` : "";
  switch (derivedStatus) {
    case "ready":
      return "This file is the primary: its passages are ready to search and read.";
    case "pending":
    case "awaiting_file":
      return "This file is the primary: it is being parsed, and becomes searchable when the source's derived_status is ready. Check sources(action=\"get\").";
    case "needs_transcript":
      return "This file is the primary and a recording: it is stored and playable, but WhatBuild never transcribes, so it will not be parsed or searched. Add its transcript as a separate source, and link the two with related_records on each.";
    case "unsupported":
      return `This file is the primary, but no parser reads its format, so it is stored and downloadable and will not be parsed or searched${detail}. Parsed formats: ${SUPPORTED_EXTENSIONS.join(", ")}. To make it searchable, create a new source whose primary is an export in one of those formats, and keep this file as its origin.`;
    default:
      return `This file is the primary, but it could not be parsed: its derived_status is ${derivedStatus}${detail}. It is stored and downloadable, and will not be searched.`;
  }
}

export const completeUpload = defineOperation({
  name: "files.complete_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Attach the bytes you PUT under a grant to the source. Idempotent.",
  description:
    "Call after the PUT succeeds. The stored object's own size, hash and type decide the entry. A primary starts parsing; check sources.get(detail=\"brief\") for derived_status. Adding a file changes the source's etag; record_etag is the new one. warnings says when the source still has no primary, so nothing on it is searched. 404 means no bytes arrived yet — PUT first. A repeat returns the existing entry; provenance fields given on a repeat are added. Tell the person which file is searched.",
  input: z.strictObject({ record_id: id("source"), path: z.string().min(1).max(200), ...provenance }),
  rest: { method: "POST", path: "/sources/:record_id/uploads/complete" },
  mcp: { tool: "files", action: "complete_upload" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    const g = await ctx.db
      .selectFrom("upload_grants")
      .select(["grant_id", "completed_at", "expires_at", "uploaded_at"])
      .where("record_id", "=", input.record_id)
      .where("path", "=", input.path)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!g) throw notFound(`There is no upload grant for ${input.path} on this source. Call files(action="request_upload") first.`);
    return completeGrant(ctx, g.grant_id, { derived_from: input.derived_from, derivation_note: input.derivation_note, derived_by: input.derived_by });
  },
});

async function storeDirect(ctx: OpContext, recordId: string, path: string, role: "primary" | "origin" | "supplement", bytes: Uint8Array, mediaType: string | null, prov: { derived_from?: string[] | undefined; derivation_note?: string | undefined; derived_by?: string | undefined } = {}) {
  await checkTarget(ctx, recordId, path, role);
  const grant = await issueGrant(ctx, recordId, { path, role, media_type: mediaType ?? undefined, size: bytes.byteLength, ...prov });
  const g = await ctx.db.selectFrom("upload_grants").selectAll().where("grant_id", "=", grant.grant_id).executeTakeFirstOrThrow();
  const stored = await ctx.ports.blobs.put(g.blob_key!, bytes, { contentType: g.media_type ?? "application/octet-stream" });
  await ctx.db.updateTable("upload_grants").set({ uploaded_at: ctx.now, size: stored.size, sha256: stored.sha256 }).where("grant_id", "=", g.grant_id).execute();
  return completeGrant(ctx, g.grant_id);
}

export const addNote = defineOperation({
  name: "files.add_note",
  scope: "product",
  access: "write",
  mutates: true,
  summary: `Add a short plain-text note as a file (at most ${NOTE_MAX_BYTES} bytes and ${NOTE_MAX_LINES} lines).`,
  description:
    `For a short authored note only. Anything longer goes through request_upload. The path needs a text extension (${NOTE_EXTENSIONS.join(" ")}).`,
  input: z.strictObject({
    record_id: id("source"),
    path: z.string().min(1).max(200),
    text: z.string().min(1).describe(`Short plain-text note: at most ${NOTE_MAX_BYTES} UTF-8 bytes and ${NOTE_MAX_LINES} lines.`),
    role: fileRole.default("primary"),
  }),
  rest: { method: "POST", path: "/sources/:record_id/notes" },
  mcp: { tool: "files", action: "add_note" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id, { live: true });
    if (!NOTE_EXTENSIONS.includes(extensionOf(input.path))) throw invalid("invalid_path", `A note's path needs a text extension: ${NOTE_EXTENSIONS.join(" ")}.`);
    const bytes = new TextEncoder().encode(input.text);
    if (bytes.byteLength > NOTE_MAX_BYTES || input.text.split("\n").length > NOTE_MAX_LINES)
      throw invalid("note_too_long", `A note is at most ${NOTE_MAX_BYTES} bytes and ${NOTE_MAX_LINES} lines. Use files(action="request_upload") for anything longer.`);
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)) throw invalid("invalid_note", "A note is plain text: no control characters other than tab and line breaks.");
    return storeDirect(ctx, input.record_id, input.path, input.role, bytes, null);
  },
});

/** The part of a URL after # is never sent, so what was stored is the page without it. */
export function fragmentWarnings(url: string): string[] {
  const hash = new URL(url).hash;
  if (!hash || hash === "#") return [];
  return [
    `The URL's fragment (${hash}) never reaches the server, so the stored file is the page at the URL without it. ` +
      "If the fragment is a single-page app's route (…/#/page), the file is probably the app's empty shell: check segment_count once it is parsed, and prefer the document's own address, a PDF export, or an upload.",
  ];
}

export const fetchUrl = defineOperation({
  name: "files.fetch_url",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Fetch a public HTTPS document into a source, server-side (size-capped).",
  description:
    "HTTPS only, public addresses only, redirects re-checked, size and time capped. The file name comes from the response, or pass path. Use for public material only; nothing is sent with the request. The part of a URL after # never reaches the server, so a single-page app's route (…/#/page) fetches only the app's empty shell; the result's warnings say so whenever the URL has a fragment.",
  input: z.strictObject({ record_id: id("source"), url: z.url().max(2000), path: z.string().min(1).max(200).optional(), role: fileRole.default("primary"), ...provenance }),
  rest: { method: "POST", path: "/sources/:record_id/fetch" },
  mcp: { tool: "files", action: "fetch_url" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id, { live: true });
    if (!ctx.ports.fetcher) throw notFound("Fetching URLs is not available on this deployment.");
    let fetched;
    try {
      fetched = await ctx.ports.fetcher.fetch(input.url, ctx.ports.config.urlFetchMaxBytes);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw invalid("fetch_failed", `Could not fetch ${input.url}: ${(e as Error).message}`);
    }
    let path = input.path ?? fetched.fileName;
    if (!extensionOf(path)) path += extensionForMediaType(fetched.mediaType);
    const stored = await storeDirect(ctx, input.record_id, path, input.role, fetched.bytes, fetched.mediaType, input);
    return { ...stored, warnings: [...fragmentWarnings(input.url), ...stored.warnings] };
  },
});

export const setRole = defineOperation({
  name: "files.set_role",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Move a non-primary file between origin and supplement, or make a file primary when the source has none.",
  description:
    "No bytes move. The primary's role cannot change: to use a different file as the primary, create a new source. Making a file primary starts parsing it.",
  input: z.strictObject({ record_id: id("source"), path: z.string().min(1).max(200), role: fileRole }),
  rest: { method: "POST", path: "/sources/:record_id/files/role" },
  mcp: { tool: "files", action: "set_role" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { live: true });
    const f = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", r.record_id).where("path", "=", input.path).executeTakeFirst();
    if (!f) throw notFound(`No file ${input.path} on this source.`);
    if (f.role === input.role) return (await fileEntries(ctx, r.record_id, (await derivedStatuses(ctx, [r.record_id])).get(r.record_id)!.derived_status)).find((e) => e.path === input.path);
    if (f.role === "primary") throw conflict("primary_fixed", "The primary file's role cannot change. Create a new source with the right primary instead.");
    if (input.role === "primary") {
      const other = await ctx.db.selectFrom("files").select("path").where("record_id", "=", r.record_id).where("role", "=", "primary").executeTakeFirst();
      if (other) throw conflict("primary_taken", `This source's primary is ${other.path}.`);
    }
    await ctx.db.updateTable("files").set({ role: input.role, role_changed_at: ctx.now, role_changed_by: json(ctx.actor) }).where("file_id", "=", f.file_id).execute();
    await ctx.db.updateTable("records").set({ etag: newEtag() }).where("record_id", "=", r.record_id).execute();
    if (input.role === "primary" && f.current_version_id) await ctx.enqueue("derive", { record_id: r.record_id, file_version_id: f.current_version_id });
    await recordActivity(ctx, { action: "file_role_changed", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: `Changed ${f.path} from ${f.role} to ${input.role}` });
    const status = (await derivedStatuses(ctx, [r.record_id])).get(r.record_id)!;
    return (await fileEntries(ctx, r.record_id, status.derived_status)).find((e) => e.path === input.path);
  },
});

export const getDownload = defineOperation({
  name: "files.get_download",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Get a short-lived grant to download one file's original bytes.",
  description:
    "Use it to check a parse against the original, or to read what extraction dropped. GET url with the headers. Keep the grant header out of reports and logs.",
  input: z.strictObject({ record_id: id("source"), path: z.string().min(1).max(200), file_version_id: id("file version").optional() }),
  rest: { method: "POST", path: "/sources/:record_id/downloads" },
  mcp: { tool: "files", action: "get_download" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    const f = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", input.record_id).where("path", "=", input.path).executeTakeFirst();
    if (!f) throw notFound(`No file ${input.path} on this source.`);
    const vid = input.file_version_id ?? f.current_version_id;
    const v = vid ? await ctx.db.selectFrom("file_versions").selectAll().where("file_version_id", "=", vid).where("file_id", "=", f.file_id).executeTakeFirst() : undefined;
    if (!v) throw notFound("That file version does not exist.");
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    const token = ctx.ports.grants.sign({ v: 1, purpose: "download", t: tenantId(ctx), fv: v.file_version_id, exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      path: f.path,
      file_version_id: v.file_version_id,
      method: "GET",
      url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/${v.file_version_id}`,
      headers: { [DOWNLOAD_GRANT_HEADER]: token },
      expires_at: expiresAt.toISOString(),
      media_type: v.media_type,
      size: Number(v.size),
      sha256: v.sha256,
    };
  },
});

export const fileOps = [requestUpload, createUpload, completeUpload, addNote, fetchUrl, setRole, getDownload];

// Re-exported for the kinds of records intake flows ask about.
export { kindInfo };
