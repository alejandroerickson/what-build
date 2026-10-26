import { isImage, isRecording, parserFor, SUPPORTED_EXTENSIONS } from "@whatbuild/parsers";
import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json } from "../db.ts";
import { AppError, conflict, invalid, notFound, rateLimited, tooLarge } from "../errors.ts";
import { extensionForMediaType, extensionOf, mediaTypeFor, validFilePath } from "../media.ts";
import { defineOperation, type OpContext, type Principal } from "../registry.ts";
import { countBytes, limitsForAccount, mayFetchUrl, uploadLimit } from "../limits.ts";
import { id } from "../schemas.ts";
import { newEtag, newId, sha256OfStream } from "../util.ts";
import { attachmentEntries, duplicateWarnings, insertRecord, loadRecord, recordMetadata, recordSummary } from "./sources.ts";

export const UPLOAD_GRANT_HEADER = "X-WhatBuild-Upload-Grant";
export const DOWNLOAD_GRANT_HEADER = "X-WhatBuild-Download-Grant";

/**
 * Who asked for a download grant, which its route checks again before it sends a byte: the account
 * (`a`), and an agent's connection (`f`, its token family), so a grant stops working once its
 * requester may no longer read what it names, or their agent is disconnected.
 */
export function requesterClaims(p: Pick<Principal, "account_id" | "connection">): { a: string; f?: string } {
  return { a: p.account_id, ...(p.connection ? { f: p.connection } : {}) };
}

/** The most attachments one source holds. */
export const MAX_ATTACHMENTS = 50;

/** Said where an attachment is added or listed: what WhatBuild does with it. */
export const ATTACHMENT_RULE =
  "Each attachment's text is read and kept, never searched. A source's derived text, which search reads, is the text of the first of its attachments whose reading finds some text: attachments are read in the order they arrive, so usually the first to arrive in a format WhatBuild reads. It follows that attachment's new versions until someone writes or edits it; derived(action=\"write_text\", from_attachment) takes another's.";

function checkPath(path: string) {
  const problem = validFilePath(path);
  if (problem) throw invalid("invalid_path", `${problem}.`);
}

/**
 * A warning, before any bytes move, when no parser reads a file's format: it is kept, but its text
 * cannot be read, so it cannot become the source's derived text. An image gets its own: no parser
 * reads a picture, so its words come from an agent that can see it. A recording is left out; its
 * result already says it is kept and needs a transcript.
 */
export function unreadableWarnings(path: string, declaredType?: string | null): string[] {
  const mediaType = mediaTypeFor(path, declaredType);
  if (isRecording(path, mediaType) || parserFor(path, mediaType)) return [];
  if (isImage(path, mediaType))
    return [
      `${path} is an image: it will be kept and shown, but WhatBuild reads no words from an image (it performs no OCR), so it cannot become the source's derived text. ` +
        `If you can see it, describe it in the source's summary, and write any words it shows as the source's text with derived(action="write_text") if search should find them.`,
    ];
  const ext = extensionOf(path) || "(no extension)";
  return [
    `No parser reads ${ext} files, so ${path} will be kept and downloadable but its text cannot be read, and it cannot become the source's derived text. ` +
      `If its words matter, add an export in a format WhatBuild reads (${SUPPORTED_EXTENSIONS.join(", ")}) as well.`,
  ];
}

/** Validate that `path` can receive a new attachment or version, before any grant or bytes. */
async function checkTarget(ctx: OpContext, recordId: string, path: string) {
  checkPath(path);
  const existing = await ctx.db.selectFrom("files").select(["path"]).where("record_id", "=", recordId).execute();
  const count = existing.length + (existing.some((f) => f.path === path) ? 0 : 1);
  if (count > MAX_ATTACHMENTS) throw conflict("too_many_attachments", `A source holds at most ${MAX_ATTACHMENTS} attachments.`);
}

export function blobKeyFor(tenant: string, recordId: string, fileVersionId: string) {
  return `t/${tenant}/r/${recordId}/f/${fileVersionId}`;
}

async function issueGrant(
  ctx: OpContext,
  recordId: string,
  input: { path: string; media_type?: string | undefined; size?: number | undefined },
) {
  const cfg = ctx.ports.config;
  // In a free organization an upload meets the plan's limits, through the relay only, where the size is enforced as the bytes arrive.
  const limited = ctx.limits && !ctx.limits.guest ? ctx.limits : null;
  const maxBytes = limited ? await uploadLimit(ctx.db, limited, ctx.principal.account_id, input, cfg.fileMaxBytes) : cfg.fileMaxBytes;
  if (input.size !== undefined && input.size > maxBytes) throw tooLarge(`Files are limited to ${maxBytes} bytes.`, { limit: maxBytes });
  const grant_id = newId();
  const file_version_id = newId();
  const blob_key = blobKeyFor(tenantId(ctx), recordId, file_version_id);
  const expiresAt = new Date(Date.parse(ctx.now) + cfg.grantTtlSeconds * 1000);
  const mediaType = mediaTypeFor(input.path, input.media_type);
  await ctx.db
    .insertInto("upload_grants")
    .values({
      grant_id, tenant_id: tenantId(ctx), product_id: productId(ctx), record_id: recordId, path: input.path,
      media_type: mediaType, max_bytes: maxBytes, principal: json(ctx.actor), expires_at: expiresAt.toISOString(), blob_key,
    })
    .execute();
  const token = ctx.ports.grants.sign({ v: 1, purpose: "upload", g: grant_id, t: tenantId(ctx), exp: Math.floor(expiresAt.getTime() / 1000) });
  let direct: { url: string; method: "PUT"; headers: Record<string, string>; max_bytes: number } | undefined;
  if (ctx.ports.blobs.signedUploadUrl && !limited) {
    const signed = await ctx.ports.blobs.signedUploadUrl(blob_key, mediaType, expiresAt, maxBytes);
    direct = { url: signed.url, method: "PUT", headers: signed.headers, max_bytes: maxBytes };
  }
  return {
    grant_id,
    record_id: recordId,
    path: input.path,
    method: "PUT" as const,
    url: `${cfg.publicBaseUrl}/api/v1/uploads/${grant_id}`,
    headers: { [UPLOAD_GRANT_HEADER]: token, "Content-Type": mediaType },
    max_bytes: Math.min(cfg.relayMaxBytes, maxBytes),
    expires_at: expiresAt.toISOString(),
    ...(direct ? { direct } : {}),
    next:
      "PUT the file's raw bytes to url with exactly these headers (one request, no multipart). A 201 means the attachment is added, and its response says what becomes of its text; no complete_upload is needed. " +
      (direct ? "For a file over max_bytes use `direct` instead: PUT to direct.url with direct.headers, then call attachments(action=\"complete_upload\") with record_id and path to add it. " : "") +
      "Keep the grant header out of reports and logs.",
  };
}

// ---- Upload grants ------------------------------------------------------------------------------

const requestUploadInput = {
  path: z.string().min(1).max(200).describe("The attachment's file name on the source, e.g. interview.vtt. Uploading to a path the source already has adds a new version of that attachment; its earlier versions are kept."),
  media_type: z.string().max(200).optional(),
  size: z.number().int().min(0).optional().describe("The file's size in bytes, when known, so an oversized file is refused before it transfers."),
};

export const requestUpload = defineOperation({
  name: "attachments.request_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Get a short-lived grant to PUT one file's bytes to a source, as an attachment. Never pass file bytes through a tool call.",
  description:
    `Returns {url, method: "PUT", headers, max_bytes, expires_at, warnings}; warnings flag a format no parser reads, and an image, before any bytes move. Send the local file's bytes with your own shell or HTTP tool (curl -T file -H …); a 201 from url means the attachment is added. Only a PUT to a \`direct\` url needs complete_upload afterwards. A grant takes one file, once, and expires: it adds an attachment, or, at a path the source already has, a new version of it, the earlier versions kept. ${ATTACHMENT_RULE} Never encode file content as base64 in a tool argument; if you cannot reach the URL, ask the person to use the web upload instead.`,
  input: z.strictObject({ record_id: id("source"), ...requestUploadInput }),
  rest: { method: "POST", path: "/sources/:record_id/uploads" },
  mcp: { tool: "attachments", action: "request_upload" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id, { live: true });
    await checkTarget(ctx, input.record_id, input.path);
    const grant = await issueGrant(ctx, input.record_id, input);
    return { ...grant, warnings: unreadableWarnings(input.path, input.media_type) };
  },
});

const createUploadInput = z.strictObject({ ...recordMetadata, ...requestUploadInput });

/** Create one source and a grant for its first attachment. */
async function createWithUpload(ctx: OpContext, input: z.output<typeof createUploadInput>) {
  checkPath(input.path);
  const { path, media_type, size, ...meta } = input;
  const warnings = [...(await duplicateWarnings(ctx, meta)), ...unreadableWarnings(path, media_type)];
  const r = await insertRecord(ctx, meta);
  const upload = await issueGrant(ctx, r.record_id, { path, media_type, size });
  return { record: recordSummary(r, { derived_status: "pending", text_chars: 0, attachment_count: 0 }), upload, warnings };
}

export const CREATE_UPLOADS_MAX = 20;

export const createUpload = defineOperation({
  name: "attachments.create_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Create a source and get an upload grant for its first attachment, in one call.",
  description:
    "Takes sources.create's metadata plus the file's path. Returns {record, upload, warnings}; PUT the bytes to upload.url with upload.headers, and a 201 means the attachment is added; its text becomes the source's derived text once it is read. For several sources at once, use create_uploads. Read warnings first: they flag a format no parser reads, an image (whose words you give the source yourself, if you can see it), and an existing source with the same title and date.",
  input: createUploadInput,
  rest: { method: "POST", path: "/sources/with-upload" },
  mcp: { tool: "attachments", action: "create_upload" },
  async handler(ctx, input) {
    return createWithUpload(ctx, input);
  },
});

export const createUploads = defineOperation({
  name: "attachments.create_uploads",
  scope: "product",
  access: "write",
  mutates: true,
  summary: `Create up to ${CREATE_UPLOADS_MAX} sources, each with an upload grant for its first attachment, in one call.`,
  description:
    "Each entry of sources takes what create_upload takes. Returns {items: [{record, upload, warnings}]} in the order given; PUT each file's bytes to its own upload.url with its upload.headers, one request per file, and a 201 means that attachment is added. Every source is created or none is: a refusal names the entry. Check sources(action=\"list\", query=…) for each first, as for create_upload.",
  input: z.strictObject({ sources: z.array(createUploadInput).min(1).max(CREATE_UPLOADS_MAX) }),
  rest: { method: "POST", path: "/sources/with-uploads" },
  mcp: { tool: "attachments", action: "create_uploads" },
  async handler(ctx, input) {
    const items = [];
    for (const [i, entry] of input.sources.entries()) {
      try {
        items.push(await createWithUpload(ctx, entry));
      } catch (e) {
        if (e instanceof AppError) throw new AppError(e.status, e.code, `sources[${i}] (${entry.title}): ${e.message} Nothing was created.`, { ...e.details, index: i });
        throw e;
      }
    }
    return { items };
  },
});

/**
 * Register the bytes behind a grant as an attachment version, and queue it to be read: the stored
 * object's own size, hash and type decide the entry, never the caller's claims. Idempotent: a
 * repeat returns the entry.
 */
export async function completeGrant(ctx: OpContext, grantId: string) {
  const g = await ctx.db.selectFrom("upload_grants").selectAll().where("grant_id", "=", grantId).forUpdate().executeTakeFirstOrThrow();
  const record = await loadRecord(ctx, g.record_id);
  if (!g.completed_at) {
    let size = g.size === null ? null : Number(g.size);
    let sha = g.sha256;
    if (size === null) {
      // A direct-to-store upload: read what actually landed, its size before any of its bytes.
      const stat = await ctx.ports.blobs.stat(g.blob_key!);
      if (!stat)
        throw notFound(`No bytes have arrived for ${g.path} yet. PUT the file to the grant’s url first, then call complete_upload again.`);
      const limit = Number(g.max_bytes);
      if (stat.size > limit) {
        await ctx.ports.blobs.delete(g.blob_key!);
        throw tooLarge(`The file that arrived for ${g.path} is ${stat.size} bytes; this grant takes at most ${limit}. It was discarded and nothing was added.`, { limit });
      }
      size = stat.size;
      // The hash comes from the bytes themselves, read as a stream, never from metadata an uploader could set.
      sha = await sha256OfStream(await ctx.ports.blobs.getStream(g.blob_key!));
      await ctx.db.updateTable("upload_grants").set({ uploaded_at: ctx.now, size, sha256: sha }).where("grant_id", "=", g.grant_id).execute();
    }
    if (record.archived_at) throw conflict("record_archived", `The file for ${g.path} arrived, but source ${record.record_id} was archived meanwhile; restore it, then call complete_upload again. Nothing was added.`);
    const fileVersionId = g.blob_key!.split("/").pop()!;
    let file = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", g.record_id).where("path", "=", g.path).executeTakeFirst();
    if (!file) {
      const file_id = newId();
      await ctx.db.insertInto("files").values({ file_id, tenant_id: g.tenant_id, record_id: g.record_id, path: g.path, current_version_id: null, added_by: json(g.principal) }).execute();
      file = await ctx.db.selectFrom("files").selectAll().where("file_id", "=", file_id).executeTakeFirstOrThrow();
    }
    await ctx.db
      .insertInto("file_versions")
      .values({ file_version_id: fileVersionId, tenant_id: g.tenant_id, record_id: g.record_id, file_id: file.file_id, blob_key: g.blob_key!, size: size!, sha256: sha!, media_type: g.sniffed_type ?? g.media_type ?? mediaTypeFor(g.path), created_by: json(g.principal) })
      .execute();
    await ctx.db.updateTable("files").set({ current_version_id: fileVersionId }).where("file_id", "=", file.file_id).execute();
    await ctx.db.updateTable("upload_grants").set({ completed_at: ctx.now, file_version_id: fileVersionId }).where("grant_id", "=", g.grant_id).execute();
    // Adding an attachment changes the source, so its etag moves on.
    await ctx.db.updateTable("records").set({ etag: newEtag() }).where("record_id", "=", g.record_id).execute();
    await ctx.enqueue("derive", { record_id: g.record_id, file_version_id: fileVersionId });
    // In a free organization the file counts against whoever asked for the grant, whichever way its bytes came.
    const limits = ctx.limits === null ? null : await limitsForAccount(ctx.db, g.tenant_id);
    if (limits) await countBytes(ctx.db, limits, g.principal.account_id, size!);
    await recordActivity(ctx, { action: "file_added", entity_type: "source", entity_id: g.record_id, entity_title: record.title, summary: `Added the attachment ${g.path}` });
  }
  const entries = await attachmentEntries(ctx.db, g.record_id, ctx.ports.config.parseCapBytes);
  const entry = entries.find((e) => e.path === g.path)!;
  const hasText = Boolean(await ctx.db.selectFrom("source_texts").select("record_id").where("record_id", "=", g.record_id).executeTakeFirst());
  const { etag: record_etag } = await ctx.db.selectFrom("records").select("etag").where("record_id", "=", g.record_id).executeTakeFirstOrThrow();
  const source = { hasText, textFrom: entries.find((e) => e.is_text_source && e.path !== g.path)?.path ?? null };
  return { ...entry, record_id: g.record_id, record_etag, note: attachmentNote(entry, source), warnings: [] as string[] };
}

/**
 * What becomes of an attachment's text, in words that match its text status: one being read, one
 * read, or one whose name, type and size settled its status before it was read. `source` is where
 * the source's derived text stands.
 */
export function attachmentNote(
  a: { path: string; media_type: string | null; text: { status: string; status_detail: string | null } },
  source: { hasText: boolean; textFrom: string | null },
): string {
  const { path } = a;
  const { status, status_detail } = a.text;
  const kept = "It is kept with the source and never searched.";
  switch (status) {
    case "pending":
      return `${path} is being read. ${
        source.hasText
          ? "The source already has a derived text, so this one is kept beside it; if it should replace it, take it with derived(action=\"write_text\", from_attachment), passing the derived text's etag as expected_etag."
          : "Once it is read, its text becomes the source's derived text, which search reads."
      } ${kept}`;
    case "ready":
      return `${path} has been read. ${kept}`;
    case "needs_transcript": {
      const recording = `${path} is a recording: it is stored and playable, but WhatBuild never transcribes, so it has no text of its own.`;
      if (source.textFrom) return `${recording} The source's text is taken from ${source.textFrom}. ${kept}`;
      if (source.hasText) return `${recording} The source's text was written or edited. ${kept}`;
      return `${recording} Add its transcript as another attachment. ${kept}`;
    }
    case "unsupported":
      // An image, and a PDF whose pages are pictures, say how an agent gives them their words.
      if (isImage(path, a.media_type)) return `${path} is stored and shown, but ${status_detail}. ${kept}`;
      if (parserFor(path, a.media_type)) return `${path} is stored and downloadable, but ${status_detail}. ${kept}`;
      return `No parser reads ${extensionOf(path) || "(no extension)"} files, so ${path} is stored and downloadable but has no text. Readable formats: ${SUPPORTED_EXTENSIONS.join(", ")}. ${kept}`;
    default:
      return `${path} could not be read: ${status}${status_detail ? ` (${status_detail})` : ""}. It is stored and downloadable. ${kept}`;
  }
}

export const completeUpload = defineOperation({
  name: "attachments.complete_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Add the bytes you PUT under a grant to the source, as an attachment. Idempotent.",
  description:
    "A PUT to a grant's url adds the attachment itself, and this only confirms it. Call it after a PUT to a grant's direct url, which it adds. The stored object's own size, hash and type decide the entry. Its text is then read; note says what becomes of it. Adding an attachment changes the source's etag; record_etag is the new one. 404 means no bytes arrived yet — PUT first. A repeat returns the existing entry.",
  input: z.strictObject({ record_id: id("source"), path: z.string().min(1).max(200) }),
  rest: { method: "POST", path: "/sources/:record_id/uploads/complete" },
  mcp: { tool: "attachments", action: "complete_upload" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    const g = await ctx.db
      .selectFrom("upload_grants")
      .select(["grant_id", "completed_at", "expires_at", "uploaded_at"])
      .where("record_id", "=", input.record_id)
      .where("path", "=", input.path)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!g) throw notFound(`There is no upload grant for ${input.path} on this source. Call attachments(action="request_upload") first.`);
    return completeGrant(ctx, g.grant_id);
  },
});

async function storeDirect(ctx: OpContext, recordId: string, path: string, bytes: Uint8Array, mediaType: string | null) {
  await checkTarget(ctx, recordId, path);
  const grant = await issueGrant(ctx, recordId, { path, media_type: mediaType ?? undefined, size: bytes.byteLength });
  const g = await ctx.db.selectFrom("upload_grants").selectAll().where("grant_id", "=", grant.grant_id).executeTakeFirstOrThrow();
  const stored = await ctx.ports.blobs.put(g.blob_key!, bytes, { contentType: g.media_type ?? "application/octet-stream" });
  await ctx.db.updateTable("upload_grants").set({ uploaded_at: ctx.now, size: stored.size, sha256: stored.sha256 }).where("grant_id", "=", g.grant_id).execute();
  return completeGrant(ctx, g.grant_id);
}

/** The part of a URL after # is never sent, so what was stored is the page without it. */
export function fragmentWarnings(url: string): string[] {
  const hash = new URL(url).hash;
  if (!hash || hash === "#") return [];
  return [
    `The URL's fragment (${hash}) never reaches the server, so the stored file is the page at the URL without it. ` +
      "If the fragment is a single-page app's route (…/#/page), the file is probably the app's empty shell: check its text once it is read, and prefer the document's own address, a PDF export, or an upload.",
  ];
}

/** Fetches one account may have in progress at once, on each instance of the server. */
export const URL_FETCHES_PER_ACCOUNT = 3;
const fetchesInProgress = new Map<string, number>();

/** Run one account's fetch in one of its places, or refuse it with 429 when they are all taken. */
async function inFetchPlace<T>(accountId: string, fetch: () => Promise<T>): Promise<T> {
  const running = fetchesInProgress.get(accountId) ?? 0;
  if (running >= URL_FETCHES_PER_ACCOUNT)
    throw rateLimited(`You have ${running} URL fetches in progress, the most one person may run at once. Wait for one to finish, then try again.`, {
      limit: URL_FETCHES_PER_ACCOUNT,
      per: "fetches in progress",
      retry_after_seconds: 10,
    });
  fetchesInProgress.set(accountId, running + 1);
  try {
    return await fetch();
  } finally {
    const left = (fetchesInProgress.get(accountId) ?? 1) - 1;
    if (left > 0) fetchesInProgress.set(accountId, left);
    else fetchesInProgress.delete(accountId);
  }
}

export const fetchUrl = defineOperation({
  name: "attachments.fetch_url",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Fetch a public HTTPS document into a source as an attachment, server-side (size-capped).",
  description:
    `HTTPS only, public addresses only (an address written in the URL and every address a name resolves to), redirects re-checked, size and time capped, at most ${URL_FETCHES_PER_ACCOUNT} at once per person. The file name comes from the response, or pass path. Use for public material only; nothing is sent with the request. The part of a URL after # never reaches the server, so a single-page app's route (…/#/page) fetches only the app's empty shell; the result's warnings say so whenever the URL has a fragment.`,
  input: z.strictObject({ record_id: id("source"), url: z.url().max(2000), path: z.string().min(1).max(200).optional() }),
  rest: { method: "POST", path: "/sources/:record_id/fetch" },
  mcp: { tool: "attachments", action: "fetch_url" },
  // The download happens here, before the transaction, so a slow server holds no database connection.
  async prepare(ctx, input) {
    await ctx.read((c) => loadRecord(c, input.record_id, { live: true }));
    if (ctx.limits && !ctx.limits.guest) mayFetchUrl(ctx.limits);
    const fetcher = ctx.ports.fetcher;
    if (!fetcher) throw notFound("Fetching URLs isn’t available on this deployment.");
    return inFetchPlace(ctx.principal.account_id, async () => {
      try {
        return await fetcher.fetch(input.url, ctx.ports.config.urlFetchMaxBytes);
      } catch (e) {
        if (e instanceof AppError) throw e;
        // What the network said can name hosts behind the server: the caller gets a plain refusal.
        throw invalid("fetch_failed", "Couldn’t fetch that URL. Check the address, or download the file and upload it with attachments(action=\"request_upload\").");
      }
    });
  },
  async handler(ctx, input, fetched) {
    await loadRecord(ctx, input.record_id, { live: true });
    let path = input.path ?? fetched.fileName;
    if (!extensionOf(path)) path += extensionForMediaType(fetched.mediaType);
    const stored = await storeDirect(ctx, input.record_id, path, fetched.bytes, fetched.mediaType);
    return { ...stored, warnings: [...fragmentWarnings(input.url), ...stored.warnings] };
  },
});

export const getDownload = defineOperation({
  name: "attachments.get_download",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Get a short-lived grant to download one attachment's original bytes.",
  description:
    "Use it to check the text read from an attachment against the original, or to read what reading it dropped. GET url with the headers. Keep the grant header out of reports and logs.",
  input: z.strictObject({ record_id: id("source"), path: z.string().min(1).max(200), file_version_id: id("file version").optional() }),
  rest: { method: "POST", path: "/sources/:record_id/downloads" },
  mcp: { tool: "attachments", action: "get_download" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    const f = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", input.record_id).where("path", "=", input.path).executeTakeFirst();
    if (!f) throw notFound(`No attachment ${input.path} on this source.`);
    const vid = input.file_version_id ?? f.current_version_id;
    const v = vid ? await ctx.db.selectFrom("file_versions").selectAll().where("file_version_id", "=", vid).where("file_id", "=", f.file_id).executeTakeFirst() : undefined;
    if (!v) throw notFound("That file version doesn’t exist.");
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    const token = ctx.ports.grants.sign({ v: 1, purpose: "download", t: tenantId(ctx), fv: v.file_version_id, ...requesterClaims(ctx.principal), exp: Math.floor(expiresAt.getTime() / 1000) });
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

export const attachmentOps = [requestUpload, createUpload, createUploads, completeUpload, fetchUrl, getDownload];
