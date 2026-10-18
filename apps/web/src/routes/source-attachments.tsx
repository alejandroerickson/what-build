import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, qs } from "../lib/api.ts";
import { actorName, fileTypeName, formatBytes, plural, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { ATTACHMENT_TEXT, pictureKind } from "../lib/status.ts";
import type { Attachment, RecordFull } from "../lib/types.ts";
import { Button, Dialog, EmptyState, ErrorCallout, Glyph, Loading, Menu, MenuItem, Sheet, SheetHeader, StatusBadge, useToast, type GlyphName } from "../ui/index.tsx";
import { ImageViewer } from "./image-viewer.tsx";
import { uploadFiles, type UploadItem } from "./source-new.tsx";
import { UseAttachmentText } from "./source-text.tsx";

/** An attachment's bytes, through the app's own route; `download` asks the browser to save it. */
export function attachmentUrl(base: string, recordId: string, path: string, download = false) {
  return `${base}/sources/${recordId}/attachment${qs({ path, download: download ? "1" : "" })}`;
}

type PreviewKind = "html" | "markdown" | "pdf" | "audio" | "video" | "image" | "text" | "download";

export function previewKind(a: Attachment): PreviewKind {
  const t = a.media_type ?? "";
  const ext = a.path.toLowerCase().split(".").pop() ?? "";
  if (t === "text/html" || ["html", "htm"].includes(ext)) return "html";
  if (t === "text/markdown" || ["md", "markdown"].includes(ext)) return "markdown";
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/") && t !== "image/svg+xml") return "image";
  if (t.startsWith("text/") || ["txt", "vtt", "srt", "csv", "tsv", "json", "log"].includes(ext) || t === "application/json" || t === "application/x-subrip") return "text";
  return "download";
}

function glyphOf(a: Attachment): GlyphName {
  const t = a.media_type ?? "";
  return /^(audio|video)\//.test(t) ? "file-audio" : t.startsWith("image/") ? "image" : "file-text";
}

/** A recording's length as a clock: "2:27", or "1:02:05" past an hour. */
function clockLength(ms: number) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * How an attachment's text was read, in a few words: "Text read · 12,345 characters", "Recording,
 * 12:03 · no text", "Image · no text", "Scan · no text" for a PDF whose pages are pictures.
 */
function textWords(a: Attachment): string {
  const t = a.text;
  if (t.status === "ready") return `Text read · ${t.chars.toLocaleString("en-GB")} characters`;
  if (t.status === "needs_transcript") return t.duration_ms ? `Recording, ${clockLength(t.duration_ms)} · no text` : "Recording · no text";
  const picture = pictureKind(a);
  if (picture) return picture === "image" ? "Image · no text" : "Scan · no text";
  return ATTACHMENT_TEXT[t.status]?.label ?? t.status;
}

/**
 * A source's attachments: its files, each kept with every version, its text read and kept, never
 * searched. One of them is the source's text, until someone edits it.
 */
export function AttachmentsView({ record, onAdd }: { record: RecordFull; onAdd?: (() => void) | undefined }) {
  const { api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [using, setUsing] = useState<Attachment | null>(null);
  const writable = canWrite && !record.archived_at;
  const reread = useMutation({
    mutationFn: (path: string) => api("POST", `${base}/sources/${record.record_id}/rederive`, { path }),
    onSuccess: (_, path) => {
      void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
      toast(`${path} will be read again.`);
    },
    onError: (e) => toast((e as Error).message, { tone: "negative" }),
  });
  return (
    <Sheet labelledBy="attachments-h">
      <SheetHeader
        id="attachments-h"
        title="Attachments"
        count={record.attachments.length}
        end={
          onAdd ? (
            <Button size="sm" icon="upload" onClick={onAdd}>
              Add attachments
            </Button>
          ) : undefined
        }
      />
      {!record.attachments.length ? (
        <EmptyState size="inline" title="No attachments yet" action={onAdd ? <Button size="sm" onClick={onAdd}>Add attachments</Button> : undefined}>
          {record.pending_upload_path ? `An upload of ${record.pending_upload_path} is in progress. ` : ""}
          Each attachment&rsquo;s text is read and kept with the source. Attachments are never searched.
        </EmptyState>
      ) : (
        <>
          <p className="source-files-note">Each attachment&rsquo;s text is read and kept with the source; the source&rsquo;s text is taken from one of them. Attachments are never searched.</p>
          <ul className="source-files">
            {record.attachments.map((a) => {
              const kind = previewKind(a);
              const tone = ATTACHMENT_TEXT[a.text.status]?.tone ?? "neutral";
              // Pictures read no words, however often they are read: the badge says so, and the source's Text what to do.
              const picture = pictureKind(a);
              return (
                <li key={a.path} className="source-file">
                  <Glyph name={glyphOf(a)} />
                  <span className="source-file-main">
                    {kind !== "download" ? (
                      <button type="button" className="quiet-link ellipsis source-file-name" title={`Show ${a.path}`} onClick={() => setPreview(a.path)}>
                        {a.path}
                      </button>
                    ) : (
                      <b className="ellipsis" title={a.path}>
                        {a.path}
                      </b>
                    )}
                    <span className="source-file-sub">
                      <StatusBadge tone={tone}>{textWords(a)}</StatusBadge>
                      {a.is_text_source ? <span className="source-file-text-source">The source&rsquo;s text</span> : null}
                      <span>
                        <span title={a.media_type ?? undefined}>{fileTypeName(a.media_type, a.path)}</span> · {formatBytes(a.size)}
                        {a.versions.length > 1 ? ` · ${plural(a.versions.length, "version")}` : ""}
                        {` · added ${relativeTime(a.added_at)} by ${actorName(a.added_by)}`}
                      </span>
                    </span>
                    {a.text.status_detail && a.text.status !== "ready" && !picture ? <span className="source-file-detail faint">{a.text.status_detail}</span> : null}
                  </span>
                  <span className="source-file-actions">
                    <a href={attachmentUrl(base, record.record_id, a.path, true)} className="icon-btn icon-btn-md" aria-label={`Download ${a.path}`} title={`Download ${a.path}`}>
                      <Glyph name="download" />
                    </a>
                    {writable || kind !== "download" ? (
                      <Menu label={`Actions for ${a.path}`} triggerClassName="icon-btn icon-btn-md" trigger={<Glyph name="ellipsis" />} align="end">
                        {kind !== "download" ? (
                          <MenuItem icon="maximize" onSelect={() => setPreview(a.path)}>
                            Show it
                          </MenuItem>
                        ) : null}
                        {writable && a.text.status === "ready" && !a.is_text_source ? (
                          <MenuItem icon="file-text" onSelect={() => setUsing(a)}>
                            Use its text…
                          </MenuItem>
                        ) : null}
                        {writable && a.text.status !== "pending" && !picture ? (
                          <MenuItem icon="rotate-ccw" detail="Its text is read again" onSelect={() => reread.mutate(a.path)}>
                            Read it again
                          </MenuItem>
                        ) : null}
                      </Menu>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {preview ? <AttachmentPreview record={record} path={preview} onSelect={setPreview} onClose={() => setPreview(null)} /> : null}
      {using ? <UseAttachmentText record={record} attachment={using} onClose={() => setUsing(null)} /> : null}
    </Sheet>
  );
}

/**
 * A source's images on its page, under the summary: the first is the first thing people see, and
 * the others are a step away in the same viewer.
 */
export function SourceImages({ record }: { record: RecordFull }) {
  const { api: base } = useProduct();
  const [current, setCurrent] = useState<string | null>(null);
  const images = record.attachments.filter((a) => previewKind(a) === "image");
  if (!images.length) return null;
  const shown = images.find((a) => a.path === current) ?? images[0]!;
  return (
    <section className="source-images" aria-label={images.length > 1 ? `${images.length} images` : "Image"}>
      <ImageViewer
        inline
        images={images.map((x) => ({ path: x.path, url: attachmentUrl(base, record.record_id, x.path) }))}
        current={shown.path}
        onSelect={setCurrent}
        downloadUrl={attachmentUrl(base, record.record_id, shown.path, true)}
      />
    </section>
  );
}

/** One attachment as it was uploaded: a PDF, an image, a recording or a text, shown in a dialog. */
function AttachmentPreview({ record, path, onSelect, onClose }: { record: RecordFull; path: string; onSelect: (path: string) => void; onClose: () => void }) {
  const { api: base } = useProduct();
  const a = record.attachments.find((x) => x.path === path)!;
  const kind = previewKind(a);
  const tooBig = (a.size ?? 0) > 4 * 1024 * 1024 && ["html", "markdown", "text"].includes(kind);
  const text = useQuery({
    queryKey: ["attachment-text", base, record.record_id, a.path, a.file_version_id],
    queryFn: async () => {
      const res = await fetch(attachmentUrl(base, record.record_id, a.path));
      if (!res.ok) throw new Error("The attachment couldn’t be read.");
      return res.text();
    },
    enabled: !tooBig && ["html", "markdown", "text"].includes(kind),
  });
  const url = attachmentUrl(base, record.record_id, a.path);
  const length = (kind === "audio" || kind === "video") && a.text.duration_ms ? a.text.duration_ms : null;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={a.path}
      description={`${fileTypeName(a.media_type, a.path)} · ${formatBytes(a.size)}${length ? ` · ${clockLength(length)} long` : ""}`}
      footer={
        <>
          <a className="btn btn-secondary" href={attachmentUrl(base, record.record_id, a.path, true)}>
            <Glyph name="download" />
            Download
          </a>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="source-preview">
        {tooBig || kind === "download" ? (
          <EmptyState size="inline" title="No preview for this format">
            Download it to open it.
          </EmptyState>
        ) : kind === "pdf" ? (
          <iframe title={a.path} src={url} className="source-preview-frame" />
        ) : kind === "audio" ? (
          <audio controls preload="metadata" src={url} className="source-preview-media" />
        ) : kind === "video" ? (
          <video controls preload="metadata" src={url} className="source-preview-media" />
        ) : kind === "image" ? (
          <ImageViewer
            images={record.attachments.filter((x) => previewKind(x) === "image").map((x) => ({ path: x.path, url: attachmentUrl(base, record.record_id, x.path) }))}
            current={a.path}
            onSelect={onSelect}
            downloadUrl={attachmentUrl(base, record.record_id, a.path, true)}
          />
        ) : text.isPending ? (
          <Loading label="Loading the attachment…" variant="lines" lines={5} />
        ) : text.isError ? (
          <ErrorCallout inset title="The attachment couldn’t be read" error={text.error} onRetry={() => text.refetch()} />
        ) : kind === "markdown" ? (
          <Markdown source={text.data ?? ""} className="prose source-preview-prose" />
        ) : kind === "html" ? (
          <iframe title={a.path} sandbox="" referrerPolicy="no-referrer" srcDoc={text.data} className="source-preview-frame" />
        ) : (
          <pre className="source-preview-text">{text.data}</pre>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Add attachments to a source, uploaded one after another in the order given: each is read when it
 * arrives, and, if the source has no text, the first whose reading finds text becomes it.
 */
export function AddAttachments({ record, onClose }: { record: RecordFull; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const allDone = await uploadFiles(base, record.record_id, items, (i, patch) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x))));
    setRunning(false);
    await qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
    if (allDone) {
      toast(items.length === 1 ? "Attachment added." : "Attachments added.");
      onClose();
    }
  };
  const failed = items.filter((i) => i.state === "failed").length;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!running}
      title="Add attachments"
      description={
        record.text
          ? "Each attachment’s text is read and kept with the source. The source keeps its text; you can switch it to an attachment’s later."
          : "Each attachment’s text is read and kept with the source. They’re read in the order listed, and the first in which WhatBuild finds text becomes the source’s text."
      }
      footer={
        <>
          <Button onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!items.length} busy={running} busyLabel="Uploading…" onClick={() => void run()}>
            {failed ? "Retry failed files" : "Upload"}
          </Button>
        </>
      }
    >
      <input
        type="file"
        className="source-file-input"
        multiple
        aria-label="Attachments to add"
        onChange={(e) => setItems([...(e.target.files ?? [])].map((file) => ({ file, state: "waiting" as const, loaded: 0 })))}
      />
      {items.length ? (
        <ul className="source-uploads" aria-live="polite">
          {items.map((i) => (
            <li key={i.file.name}>
              <span className="grow">
                {i.file.name} <span className="faint">· {formatBytes(i.file.size)}</span>
                {i.error ? <span className="field-error">{i.error}</span> : null}
              </span>
              <StatusBadge tone={i.state === "done" ? "positive" : i.state === "failed" ? "negative" : i.state === "uploading" ? "progress" : "neutral"}>
                {i.state === "uploading" ? `${Math.round((i.loaded / Math.max(1, i.file.size)) * 100)}%` : i.state === "done" ? "Uploaded" : i.state === "failed" ? "Failed" : "Ready"}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}
