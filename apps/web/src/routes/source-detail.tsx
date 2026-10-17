import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, isObjectId, qs } from "../lib/api.ts";
import { actorName, attribution, fileTypeName, formatBytes, formatDate, plural, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus, derivedStatusDetail, ROLE_LABEL } from "../lib/status.ts";
import type { Actor, FileEntry, RecordFull } from "../lib/types.ts";
import { Inspector, ShellContext, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, ChoiceRow, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuItem,
  MenuSeparator, PageHeader, Segmented, SelectField, Sheet, SheetHeader, StatusBadge, Tag, TextArea, TextField, useToast, type GlyphName,
} from "../ui/index.tsx";
import "../styles/screens/evidence.css";
import { PassageReader } from "./passages.tsx";
import { CommentsView } from "./source-comments.tsx";
import { uploadFiles } from "./source-new.tsx";
import { EvidenceFilters, splitTags, TagSuggestions } from "./evidence.tsx";
import { ImageViewer } from "./image-viewer.tsx";

type View = "passages" | "original" | "notes" | "comments" | "attachments";
const VIEWS: View[] = ["passages", "original", "notes", "comments", "attachments"];
type AgentNoteKind = "summary" | "notes";
type SourceRecord = RecordFull & { agent_notes?: { kind: AgentNoteKind; updated_at: string; updated_by: Actor }[] };
interface AgentNote {
  note_kind: AgentNoteKind;
  content: string;
  updated_at: string;
  updated_by: Actor;
}

/** Old `?tab=` links keep working: each maps to a section, and "connected" opens the inspector. */
const TAB_TO_VIEW: Record<string, View | null> = { passages: "passages", preview: "original", files: "attachments", notes: "notes", connected: null };

function SourceNotFound({ app }: { app: string }) {
  return (
    <>
      <EvidenceFilters />
      <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: "Source" }]} title="Source not found" />
      <EmptyState action={<ButtonLink to={`${app}/evidence`}>Back to Evidence</ButtonLink>}>It doesn’t exist in this product, or you don’t have access to it.</EmptyState>
    </>
  );
}

function useSourceKey() {
  const { recordId = "" } = useParams();
  const { api: base } = useProduct();
  return { recordId, base, key: ["source", base, recordId] as const };
}

export function SourceDetailPage() {
  const { recordId, base, key } = useSourceKey();
  const { app, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const slots = useContext(ShellContext);
  // An address that cannot hold a source id names no source, so the server is not asked; it would
  // refuse the malformed id. A well-formed id is asked about, and a missing source's 404 is the
  // honest answer, which the browser logs (§7.1).
  const wellFormed = isObjectId(recordId);
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<SourceRecord>("GET", `${base}/sources/${recordId}?detail=full`),
    enabled: wellFormed,
    refetchInterval: (query) => (query.state.data?.derived_status === "pending" ? 2000 : false),
  });
  const noteKinds = (q.data?.agent_notes ?? []).map((n) => n.kind);
  const notes = useQueries({
    queries: (["summary", "notes"] as const).map((kind) => ({
      queryKey: ["source-agent-note", base, recordId, kind, q.data?.agent_notes?.find((n) => n.kind === kind)?.updated_at ?? ""],
      queryFn: () => api<AgentNote>("GET", `${base}/sources/${recordId}/agent-notes/${kind}`),
      enabled: noteKinds.includes(kind),
      staleTime: 60_000,
    })),
  });
  const [summary, agentNotes] = notes;
  const tab = params.get("tab");
  const openInspector = useRef(false);
  useEffect(() => {
    if (tab === null) return;
    const next = new URLSearchParams(params);
    next.delete("tab");
    const v = TAB_TO_VIEW[tab];
    if (v) next.set("view", v);
    if (tab === "connected") openInspector.current = true;
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // "connected" (an old tab) opens the inspector, where the source's details live. The shell closes
  // overlays when a route mounts, so open it on the next tick, once the source has loaded.
  const loaded = q.isSuccess;
  useEffect(() => {
    if (!loaded || !openInspector.current || !slots) return;
    openInspector.current = false;
    const t = setTimeout(() => slots.setInspectorOpen(true), 0);
    return () => clearTimeout(t);
  }, [loaded, slots]);
  const [dialog, setDialog] = useState<"edit" | "delete" | "attachments" | null>(null);
  usePageTitle(q.data?.title ?? (wellFormed ? "Source" : "Source not found"));
  if (!wellFormed) return <SourceNotFound app={app} />;
  if (q.isPending)
    return (
      <>
        <EvidenceFilters />
        <Loading label="Loading the source…" lines={6} />
      </>
    );
  if (q.isError) {
    const e = q.error as ApiError;
    if (e.status === 410) {
      const t = (e.details?.["tombstone"] ?? {}) as { title?: string; deleted_at?: string; reason?: string; deleted_by?: { display_name: string } };
      return (
        <>
          <EvidenceFilters />
          <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: "Deleted source" }]} title="This source was deleted" />
          <EmptyState action={<ButtonLink to={`${app}/evidence`}>Back to Evidence</ButtonLink>}>
            {`${t.title ?? "It"} was deleted by ${t.deleted_by?.display_name ?? "someone"} on ${formatDate(t.deleted_at)}. Reason: ${t.reason ?? "not given"}.`}
          </EmptyState>
        </>
      );
    }
    if (e.status === 404) return <SourceNotFound app={app} />;
    return (
      <>
        <EvidenceFilters />
        <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: "Source" }]} title="This source couldn’t be loaded" />
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      </>
    );
  }
  const r = q.data;
  const status = derivedStatus(r.derived_status);
  const statusDetail = derivedStatusDetail(r.derived_status, r.status_detail);
  const parsed = r.segment_count > 0;
  // `?view=files` was the attachments' address before they were called attachments.
  const requested = (params.get("view") === "files" ? "attachments" : params.get("view")) as View | null;
  const fallback: View = parsed ? "passages" : r.files.length ? "original" : "attachments";
  const view: View = requested && VIEWS.includes(requested) && (requested !== "passages" || parsed) ? requested : fallback;
  const writable = canWrite && !r.archived_at;
  return (
    <>
      <EvidenceFilters />
      <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: r.title }]} title={r.title} actions={<SourceActions record={r} onDialog={setDialog} />} />
      <SourceDescription record={r} note={summary?.data ?? null} loading={Boolean(summary?.isPending && noteKinds.includes("summary"))} />
      {r.archived_at || r.derived_status !== "ready" ? (
        <div className="source-notices">
      {r.archived_at ? (
        <Callout tone="attention" title={`Archived ${relativeTime(r.archived_at)}`} action={canWrite ? <RestoreButton record={r} /> : undefined}>
          Read-only, and left out of lists and search, including your agents&rsquo;, until it&rsquo;s restored.
        </Callout>
      ) : null}
      {r.derived_status !== "ready" ? (
        <Callout tone={status.tone === "negative" ? "negative" : status.tone === "attention" ? "attention" : "info"} title={status.label}>
          {status.explain} {statusDetail ? <span className="muted">({statusDetail})</span> : null} {status.next ?? ""}
        </Callout>
      ) : null}
        </div>
      ) : null}
      <div className="source-sections">
        <Segmented
          label="Source sections"
          value={view}
          items={[
            ...(parsed ? [{ id: "passages", label: "Passages", count: r.segment_count, to: "?view=passages" }] : []),
            { id: "original", label: "Original", to: "?view=original" },
            { id: "notes", label: "Notes", to: "?view=notes" },
            { id: "comments", label: "Comments", count: r.annotation_count || undefined, to: "?view=comments" },
            { id: "attachments", label: "Attachments", count: r.files.length, to: "?view=attachments" },
          ]}
        />
      </div>
      {view === "passages" ? <PassageReader record={r} /> : null}
      {view === "original" ? <OriginalView record={r} /> : null}
      {view === "notes" ? <NotesView record={r} note={agentNotes?.data ?? null} loading={Boolean(agentNotes?.isPending && noteKinds.includes("notes"))} /> : null}
      {view === "comments" ? <CommentsView record={r} /> : null}
      {view === "attachments" ? <AttachmentsView record={r} onAdd={writable ? () => setDialog("attachments") : undefined} /> : null}
      <SourceInspector record={r} />
      {dialog === "edit" ? <EditDetails record={r} onReload={() => void q.refetch()} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteSource record={r} onClose={() => setDialog(null)} /> : null}
      {dialog === "attachments" ? <AddAttachments record={r} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function surfaceLabel(actor: Actor) {
  if (actor.surface === "mcp") return actor.client || "an agent";
  if (actor.surface === "rest") return "the API";
  return "the web";
}

/**
 * The summary under the title: what the source is and says, for people, clamped to four lines.
 * Editors can write or change it here; without one, others see nothing.
 */
function SourceDescription({ record, note, loading }: { record: SourceRecord; note: AgentNote | null; loading: boolean }) {
  const { canWrite } = useProduct();
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const writable = canWrite && !record.archived_at;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [note, open]);
  if (loading) return <Loading variant="lines" lines={2} label="Loading the summary…" />;
  const editor = editing ? <NoteDialog record={record} kind="summary" current={note?.content ?? ""} onClose={() => setEditing(false)} /> : null;
  if (!note)
    return writable ? (
      <div className="source-description source-description-empty">
        <Button size="sm" variant="quiet" icon="plus" onClick={() => setEditing(true)}>
          Add a summary
        </Button>
        {editor}
      </div>
    ) : null;
  return (
    <div className="source-description">
      <div ref={ref} id="source-summary" className={`source-summary${open ? "" : " source-summary-clamped"}`}>
        <Markdown source={note.content} className="prose" headingShift={3} />
      </div>
      <div className="source-summary-foot">
        {overflows || open ? (
          <button type="button" className="quiet-link source-summary-toggle" aria-expanded={open} aria-controls="source-summary" onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show all"}
          </button>
        ) : null}
        <span>
          Summary by {attribution(note.updated_by)}, {relativeTime(note.updated_at)}
        </span>
        {writable ? (
          <button type="button" className="quiet-link source-summary-edit" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      {editor}
    </div>
  );
}

const NOTE_WORDS: Record<AgentNoteKind, { title: string; label: string; hint: string; saved: string; cleared: string }> = {
  summary: {
    title: "Summary",
    label: "Summary",
    hint: "A few short sentences for the people who read this source: what it is, and what it tells the team. Markdown.",
    saved: "Summary saved.",
    cleared: "Summary removed.",
  },
  notes: {
    title: "Notes",
    label: "Notes",
    hint: "Anything worth keeping about this source that isn’t in its words. Your agents read and write these too. Markdown.",
    saved: "Notes saved.",
    cleared: "Notes removed.",
  },
};

/** Write a source's summary or notes. Saving it empty removes it. */
function NoteDialog({ record, kind, current, onClose }: { record: SourceRecord; kind: AgentNoteKind; current: string; onClose: () => void }) {
  const { base, key } = useSourceKey();
  const qc = useQueryClient();
  const toast = useToast();
  const words = NOTE_WORDS[kind];
  const [content, setContent] = useState(current);
  const save = useMutation({
    mutationFn: () => api("PUT", `${base}/sources/${record.record_id}/agent-notes/${kind}`, { content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["source-agent-note", base, record.record_id, kind] });
      toast(content.trim() ? words.saved : words.cleared);
      onClose();
    },
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={current ? `Edit the ${words.title.toLowerCase()}` : `Write the ${words.title.toLowerCase()}`}
      dismissable={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={content === current} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <TextArea label={words.label} hint={words.hint} rows={kind === "summary" ? 6 : 14} maxLength={100_000} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
      {save.isError ? <ErrorCallout inset error={save.error} /> : null}
    </Dialog>
  );
}

function useArchive(record: SourceRecord) {
  const { base, key } = useSourceKey();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (restore: boolean) => api("POST", `${base}/sources/${restore ? "restore" : "archive"}`, { record_ids: [record.record_id] }),
    onSuccess: (_, restore) => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      toast(
        restore ? "Restored." : "Archived. It’s out of lists and search, including your agents’.",
        restore ? {} : { action: { label: "Undo", onClick: () => m.mutate(true) } },
      );
    },
    onError: (e) => toast((e as Error).message, { tone: "negative" }),
  });
  return m;
}

function RestoreButton({ record }: { record: SourceRecord }) {
  const archive = useArchive(record);
  return (
    <Button size="sm" icon="archive-restore" onClick={() => archive.mutate(true)} busy={archive.isPending} busyLabel="Restoring…">
      Restore
    </Button>
  );
}

function SourceActions({ record: r, onDialog }: { record: SourceRecord; onDialog: (d: "edit" | "delete" | "attachments") => void }) {
  const { canWrite, canDelete } = useProduct();
  const toast = useToast();
  const archive = useArchive(r);
  return (
    <Menu label="Source actions" trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-md">
      {canWrite && !r.archived_at ? (
        <>
          <MenuItem icon="pencil" onSelect={() => onDialog("edit")}>
            Edit details
          </MenuItem>
          <MenuItem icon="upload" onSelect={() => onDialog("attachments")}>
            Add attachments
          </MenuItem>
        </>
      ) : null}
      <MenuItem
        icon="link"
        onSelect={() =>
          void navigator.clipboard
            .writeText(`${location.origin}${location.pathname}`)
            .then(() => toast("Link copied."))
            .catch(() => toast("Couldn’t copy the link.", { tone: "negative" }))
        }
      >
        Copy link
      </MenuItem>
      {canWrite ? (
        <>
          <MenuSeparator />
          {r.archived_at ? (
            <MenuItem icon="archive-restore" onSelect={() => archive.mutate(true)}>
              Restore
            </MenuItem>
          ) : (
            <MenuItem icon="archive" meta="Reversible" onSelect={() => archive.mutate(false)}>
              Archive
            </MenuItem>
          )}
          {canDelete ? (
            <MenuItem icon="trash" tone="danger" onSelect={() => onDialog("delete")}>
              Delete permanently…
            </MenuItem>
          ) : null}
        </>
      ) : null}
    </Menu>
  );
}

// ---- Inspector ----------------------------------------------------------------------------------

function fileGlyph(f: FileEntry): GlyphName {
  const t = f.media_type ?? "";
  return /^(audio|video)\//.test(t) ? "file-audio" : t.startsWith("image/") ? "image" : "file-text";
}

/** "Searched", "Kept, not searched" or the primary's parsing state, in words. */
function searchWords(f: FileEntry) {
  if (f.searchable) return "Searched";
  if (f.role !== "primary") return "Kept, not searched";
  return f.search_status === "pending" ? "Searched once parsed" : "Not searched";
}

/**
 * A date, then who did it and through which surface: "27 Sept 2026 / by Sam via Claude". With
 * `byTo`, the person links there (the sources they added).
 */
function When({ at, by, byTo }: { at: string; by: Actor | null | undefined; byTo?: string }) {
  return (
    <span className="source-when">
      <span className="num">{formatDate(at)}</span>
      <small>
        by{" "}
        {byTo && by ? (
          <Link to={byTo} className="quiet-link" title={`Every source ${actorName(by)} added`}>
            {actorName(by)}
          </Link>
        ) : (
          actorName(by)
        )}
        {by?.surface && by.surface !== "web" ? ` via ${surfaceLabel(by)}` : ""}
      </small>
    </span>
  );
}

function SourceInspector({ record: r }: { record: SourceRecord }) {
  const { app, canWrite } = useProduct();
  const archive = useArchive(r);
  return (
    <Inspector title="Details">
      <div className="source-inspector">
        <Group title="About">
          <KeyValue
            items={[
              {
                label: "Tags",
                value: r.tags.length ? (
                  <span className="chips source-tags">
                    {r.tags.map((t) => (
                      <Link key={t} to={`${app}/evidence?tags=${encodeURIComponent(t)}`} className="tag tag-link" title={`Every source tagged ${t}`}>
                        {t}
                      </Link>
                    ))}
                  </span>
                ) : (
                  <span className="faint">None</span>
                ),
              },
              { label: "Date captured", value: r.date ? <span className="num" title="When the meeting happened, or the document is dated">{formatDate(r.date)}</span> : "No date" },
              { label: "Date added", value: <When at={r.uploaded_at} by={r.uploaded_by} byTo={`${app}/evidence?added_by=${encodeURIComponent(r.uploaded_by.account_id)}`} /> },
              { label: "Date updated", value: r.updated_at !== r.uploaded_at ? <When at={r.updated_at} by={r.updated_by} /> : <span className="faint">Not since it was added</span> },
            ]}
          />
        </Group>
        <Group title="Activity">
          <Link to={`${app}/activity?entity_type=source&entity_id=${r.record_id}`} className="source-inspector-link">
            <Glyph name="activity" size="sm" />
            Activity on this source
          </Link>
        </Group>
        {canWrite ? (
          <Group title={r.archived_at ? "Archived" : "Archive"}>
            <p className="source-inspector-note">
              {r.archived_at ? "Out of lists and search." : "Takes it out of lists and search, including your agents’. You can restore it any time."}
            </p>
            <Button
              size="sm"
              wide
              icon={r.archived_at ? "archive-restore" : "archive"}
              onClick={() => archive.mutate(Boolean(r.archived_at))}
              busy={archive.isPending}
              busyLabel={r.archived_at ? "Restoring…" : "Archiving…"}
            >
              {r.archived_at ? "Restore" : "Archive"}
            </Button>
          </Group>
        ) : null}
      </div>
    </Inspector>
  );
}

// ---- Sections -----------------------------------------------------------------------------------

function fileUrl(base: string, recordId: string, path: string, download = false) {
  return `${base}/sources/${recordId}/file${qs({ path, download: download ? "1" : "" })}`;
}

function previewKind(f: FileEntry): "html" | "markdown" | "pdf" | "audio" | "video" | "image" | "text" | "download" {
  const t = f.media_type ?? "";
  const ext = f.path.toLowerCase().split(".").pop() ?? "";
  if (t === "text/html" || ["html", "htm"].includes(ext)) return "html";
  if (t === "text/markdown" || ["md", "markdown"].includes(ext)) return "markdown";
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/") && t !== "image/svg+xml") return "image";
  if (t.startsWith("text/") || ["txt", "vtt", "srt", "csv", "tsv", "json", "log"].includes(ext) || t === "application/json" || t === "application/x-subrip") return "text";
  return "download";
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
 * The origin file (or the primary, when there is no origin), shown as it was uploaded. The file
 * shown is held in the URL as `?file=`, so a link can open any of them.
 */
function OriginalView({ record }: { record: SourceRecord }) {
  const { api: base } = useProduct();
  const [params, setParams] = useSearchParams();
  const initial = record.files.find((f) => f.role === "origin") ?? record.files.find((f) => f.role === "primary") ?? record.files[0];
  const path = params.get("file") ?? initial?.path ?? "";
  const setPath = (next: string) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set("file", next);
        return out;
      },
      { replace: true },
    );
  const f = record.files.find((x) => x.path === path) ?? initial;
  const kind = f ? previewKind(f) : "download";
  const tooBig = (f?.size ?? 0) > 4 * 1024 * 1024 && ["html", "markdown", "text"].includes(kind);
  const text = useQuery({
    queryKey: ["file-text", base, record.record_id, f?.path],
    queryFn: async () => {
      const res = await fetch(fileUrl(base, record.record_id, f!.path));
      if (!res.ok) throw new Error("The file couldn’t be read.");
      return res.text();
    },
    enabled: Boolean(f) && !tooBig && ["html", "markdown", "text"].includes(kind),
  });
  if (!f)
    return (
      <Sheet>
        <SheetHeader title="Original" />
        <EmptyState size="inline" title="No file on this source yet">
          Add one from the menu, or ask your agent to upload it.
        </EmptyState>
      </Sheet>
    );
  const url = fileUrl(base, record.record_id, f.path);
  // A recording's length, read from the file when it was parsed, so a reader can tell whether a
  // transcript covers all of it.
  const length = (kind === "audio" || kind === "video") && f.role === "primary" ? (record.duration_ms ?? record.manifest?.duration_ms ?? null) : null;
  return (
    <Sheet className="source-original">
      <SheetHeader
        title="Original"
        filter={
          record.files.length > 1 ? (
            <SelectField label={<span className="visually-hidden">File to show</span>} value={f.path} onChange={(e) => setPath(e.target.value)}>
              {record.files.map((x) => (
                <option key={x.path} value={x.path}>
                  {x.path} ({ROLE_LABEL[x.role]?.toLowerCase()})
                </option>
              ))}
            </SelectField>
          ) : undefined
        }
        end={
          <a className="btn btn-secondary btn-sm" href={fileUrl(base, record.record_id, f.path, true)}>
            <Glyph name="download" />
            Download
          </a>
        }
      />
      <p className="source-original-line">
        <span className={f.searchable ? "text-ok" : undefined}>{searchWords(f)}.</span>{" "}
        {f.role === "primary"
          ? `${f.path} is the primary file${f.searchable ? `, parsed into ${plural(record.segment_count, "passage")}` : ""}.`
          : `${f.path} is ${f.role === "origin" ? "the origin file" : "a supplement"}.`}{" "}
        <span className="faint">
          <span title={f.media_type ?? undefined}>{fileTypeName(f.media_type, f.path)}</span> · {formatBytes(f.size)}
          {length ? ` · ${clockLength(length)} long` : ""}
        </span>
      </p>
      <div className="source-original-body">
        {tooBig || kind === "download" ? (
          <EmptyState size="inline" title="No preview for this format" action={<a className="btn btn-secondary btn-sm" href={fileUrl(base, record.record_id, f.path, true)}>Download {formatBytes(f.size)}</a>} />
        ) : kind === "pdf" ? (
          <iframe title={f.path} src={url} className="source-preview-frame" />
        ) : kind === "audio" ? (
          <audio controls preload="metadata" src={url} className="source-preview-media" />
        ) : kind === "video" ? (
          <video controls preload="metadata" src={url} className="source-preview-media" />
        ) : kind === "image" ? (
          <ImageViewer
            images={record.files.filter((x) => previewKind(x) === "image").map((x) => ({ path: x.path, url: fileUrl(base, record.record_id, x.path) }))}
            current={f.path}
            onSelect={setPath}
            downloadUrl={fileUrl(base, record.record_id, f.path, true)}
          />
        ) : text.isPending ? (
          <Loading label="Loading the file…" variant="lines" lines={5} />
        ) : text.isError ? (
          <ErrorCallout inset title="The file couldn’t be read" error={text.error} onRetry={() => text.refetch()} />
        ) : kind === "markdown" ? (
          <Markdown source={text.data ?? ""} className="prose source-preview-prose" />
        ) : kind === "html" ? (
          <iframe title={f.path} sandbox="" referrerPolicy="no-referrer" srcDoc={text.data} className="source-preview-frame" />
        ) : (
          <pre className="source-preview-text">{text.data}</pre>
        )}
      </div>
    </Sheet>
  );
}

/** The source's notes: one freeform Markdown document that agents and people both keep. */
function NotesView({ record, note, loading }: { record: SourceRecord; note: AgentNote | null; loading: boolean }) {
  const { canWrite } = useProduct();
  const [editing, setEditing] = useState(false);
  const writable = canWrite && !record.archived_at;
  return (
    <Sheet labelledBy="notes-h">
      <SheetHeader
        id="notes-h"
        title="Notes"
        end={
          writable && note ? (
            <Button size="sm" icon="pencil" onClick={() => setEditing(true)}>
              Edit notes
            </Button>
          ) : undefined
        }
      />
      {loading ? (
        <Loading variant="lines" lines={4} label="Loading the notes…" />
      ) : note ? (
        <section className="source-notes">
          <Markdown source={note.content} className="prose" headingShift={2} />
          <p className="source-notes-by">
            Written by {attribution(note.updated_by)}, {relativeTime(note.updated_at)}
          </p>
        </section>
      ) : (
        <EmptyState size="inline" title="No notes yet" action={writable ? <Button size="sm" onClick={() => setEditing(true)}>Write notes</Button> : undefined}>
          Notes keep what&rsquo;s worth knowing about this source that isn&rsquo;t in its words. Your agents keep them too.
        </EmptyState>
      )}
      {editing ? <NoteDialog record={record} kind="notes" current={note?.content ?? ""} onClose={() => setEditing(false)} /> : null}
    </Sheet>
  );
}

function AttachmentsView({ record, onAdd }: { record: SourceRecord; onAdd?: () => void }) {
  const { base, key } = useSourceKey();
  const { canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  // A role change is asked for in the row menu and confirmed in a dialog that says what it does.
  const [change, setChange] = useState<{ path: string; role: Role } | null>(null);
  const setRole = useMutation({
    mutationFn: ({ path, role }: { path: string; role: Role }) => api("POST", `${base}/sources/${record.record_id}/files/role`, { path, role }),
    onSuccess: (_, { path, role }) => {
      void qc.invalidateQueries({ queryKey: key });
      setChange(null);
      toast(`${path} is now ${role === "primary" ? "the primary file" : role === "origin" ? "an origin file" : "a supplement"}.`);
    },
  });
  const hasPrimary = record.files.some((x) => x.role === "primary");
  const writable = canWrite && !record.archived_at;
  return (
    <Sheet labelledBy="attachments-h">
      <SheetHeader
        id="attachments-h"
        title="Attachments"
        count={record.files.length}
        end={
          onAdd ? (
            <Button size="sm" icon="upload" onClick={onAdd}>
              Add attachments
            </Button>
          ) : undefined
        }
      />
      {!record.files.length ? (
        <EmptyState size="inline" title="No attachments yet" action={onAdd ? <Button size="sm" onClick={onAdd}>Add attachments</Button> : undefined}>
          {record.pending_primary_path ? `An upload of ${record.pending_primary_path} is in progress.` : null}
        </EmptyState>
      ) : (
        <ul className={`source-files${writable && record.files.some((x) => x.role !== "primary") ? " source-files-with-menus" : ""}`}>
          {record.files.map((f) => (
            <li key={f.path} className="source-file">
              <Glyph name={fileGlyph(f)} />
              <span className="source-file-main">
                {previewKind(f) !== "download" ? (
                  <Link to={`?view=original&file=${encodeURIComponent(f.path)}`} className="ellipsis source-file-name" title={`Show ${f.path}`}>
                    {f.path}
                  </Link>
                ) : (
                  <b className="ellipsis" title={f.path}>
                    {f.path}
                  </b>
                )}
                <span className="source-file-sub">
                  <StatusBadge tone={f.searchable ? "positive" : "neutral"}>{searchWords(f)}</StatusBadge>
                  <span>
                    {formatBytes(f.size)}
                    {f.versions.length > 1 ? ` · ${plural(f.versions.length, "version")}` : ""}
                    {f.derived_from.length ? ` · digest of ${f.derived_from.join(" and ")}` : ""}
                    {` · added ${relativeTime(f.added_at)} by ${actorName(f.added_by)}`}
                  </span>
                </span>
              </span>
              <span className="source-file-role muted">{ROLE_LABEL[f.role]}</span>
              <span className="source-file-actions">
                <a href={fileUrl(base, record.record_id, f.path, true)} className="icon-btn icon-btn-md" aria-label={`Download ${f.path}`} title={`Download ${f.path}`}>
                  <Glyph name="download" />
                </a>
                {writable && f.role !== "primary" ? (
                  <Menu label={`Actions for ${f.path}`} triggerClassName="icon-btn icon-btn-md" trigger={<Glyph name="ellipsis" />} align="end">
                    {f.role !== "origin" ? (
                      <MenuItem icon="file-text" onSelect={() => setChange({ path: f.path, role: "origin" })}>
                        Make it an origin file…
                      </MenuItem>
                    ) : null}
                    {f.role !== "supplement" ? (
                      <MenuItem icon="file-text" onSelect={() => setChange({ path: f.path, role: "supplement" })}>
                        Make it a supplement…
                      </MenuItem>
                    ) : null}
                    {!hasPrimary ? (
                      <MenuItem icon="search" onSelect={() => setChange({ path: f.path, role: "primary" })}>
                        Make it the primary file…
                      </MenuItem>
                    ) : null}
                  </Menu>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {change ? (
        <Dialog
          open
          onClose={() => {
            setChange(null);
            setRole.reset();
          }}
          dismissable={!setRole.isPending}
          title={change.role === "primary" ? "Make this the primary file?" : `Make this ${change.role === "origin" ? "an origin file" : "a supplement"}?`}
          footer={
            <>
              <Button
                onClick={() => {
                  setChange(null);
                  setRole.reset();
                }}
                disabled={setRole.isPending}
              >
                Cancel
              </Button>
              <Button variant="primary" busy={setRole.isPending} busyLabel="Saving…" onClick={() => setRole.mutate(change)}>
                {change.role === "primary" ? "Make it primary" : `Make it ${change.role === "origin" ? "an origin file" : "a supplement"}`}
              </Button>
            </>
          }
        >
          <p>
            <b>{change.path}</b>{" "}
            {change.role === "primary"
              ? "will be parsed into passages and searched. You can’t change the primary file afterwards."
              : change.role === "origin"
                ? "will be kept as the original behind the primary file."
                : "will be kept as supporting material."}
          </p>
          {setRole.isError ? <ErrorCallout inset error={setRole.error} title="The role couldn’t be changed" /> : null}
        </Dialog>
      ) : null}
    </Sheet>
  );
}

// ---- Dialogs ------------------------------------------------------------------------------------

function EditDetails({ record, onClose, onReload }: { record: SourceRecord; onClose: () => void; onReload: () => void }) {
  const { base, key } = useSourceKey();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    title: record.title,
    date: record.date ?? "",
    tags: record.tags.join(", "),
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ changed: string[] }>("PATCH", `${base}/sources/${record.record_id}`, {
        expected_etag: record.etag,
        title: f.title,
        date: f.date || null,
        tags: splitTags(f.tags),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      toast(res.changed.length ? "Saved." : "Nothing changed.");
      onClose();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit details"
      dismissable={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!f.title.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <TextField label="Title" value={f.title} onChange={set("title")} required maxLength={300} />
      <TextField label="Date captured" type="date" hint="When the meeting happened, or the document is dated." value={f.date} onChange={set("date")} optional />
      <TextField label="Tags" value={f.tags} onChange={set("tags")} optional hint="Comma-separated." />
      <TagSuggestions value={f.tags} onChange={(tags) => setF({ ...f, tags })} />
      {save.isError ? (
        <ErrorCallout
          inset
          error={save.error}
          onRetry={
            save.error instanceof ApiError && save.error.code === "stale_etag"
              ? () => {
                  onReload();
                  save.reset();
                }
              : undefined
          }
        />
      ) : null}
    </Dialog>
  );
}

function DeleteSource({ record, onClose }: { record: SourceRecord; onClose: () => void }) {
  const { api: base, app } = useProduct();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const archive = useArchive(record);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const impact = useQuery({
    queryKey: ["delete-impact", base, record.record_id],
    queryFn: () =>
      api<{
        etag: string;
        file_versions: number;
        bytes: number;
        derivations: number;
        annotations: number;
      }>("GET", `${base}/sources/${record.record_id}/delete-impact`),
  });
  const del = useMutation({
    mutationFn: () => api("DELETE", `${base}/sources/${record.record_id}`, { expected_etag: impact.data!.etag, reason, confirm: "delete permanently" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      toast(`Deleted “${record.title}”. The activity log records who, when and why.`);
      navigate(`${app}/evidence`);
    },
  });
  const i = impact.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete permanently"
      description="This can’t be undone. Archiving takes it out of lists and search and erases nothing."
      dismissable={!del.isPending}
      footer={
        <>
          <Button
            onClick={() => {
              archive.mutate(false);
              onClose();
            }}
            disabled={Boolean(record.archived_at) || del.isPending}
          >
            Archive instead
          </Button>
          <Button variant="danger" disabled={!i || !reason.trim() || typed !== record.title} busy={del.isPending} busyLabel="Deleting…" onClick={() => del.mutate()}>
            Delete permanently
          </Button>
        </>
      }
    >
      {impact.isPending ? (
        <Loading variant="lines" lines={3} label="Checking what would be lost…" />
      ) : impact.isError ? (
        <ErrorCallout inset error={impact.error} onRetry={() => impact.refetch()} />
      ) : i ? (
        <div className="stack-sm source-impact">
          <p>
            This deletes {plural(i.file_versions, "stored file")} ({formatBytes(i.bytes)}) and {plural(i.annotations, "comment")}.
          </p>
          <p>Links to it from Story pages, mockups and notes will open a record of the deletion instead.</p>
        </div>
      ) : null}
      <TextArea label="Why is it being deleted?" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded with the deletion." />
      <TextField label={`Type the title to confirm: ${record.title}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      {del.isError ? <ErrorCallout inset error={del.error} /> : null}
    </Dialog>
  );
}

type Role = "primary" | "origin" | "supplement";

function AddAttachments({ record, onClose }: { record: SourceRecord; onClose: () => void }) {
  const { base, key } = useSourceKey();
  const qc = useQueryClient();
  const toast = useToast();
  const hasPrimary = record.files.some((f) => f.role === "primary");
  const [role, setRole] = useState<Role>(hasPrimary ? "origin" : "primary");
  const [items, setItems] = useState<{ file: File; role: Role; state: "waiting" | "uploading" | "done" | "failed"; loaded: number; error?: string }[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => setItems((all) => all.map((i) => (i.state === "done" ? i : { ...i, role }))), [role]);
  const run = async () => {
    setRunning(true);
    const allDone = await uploadFiles(base, record.record_id, items, (i, patch) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x))));
    setRunning(false);
    await qc.invalidateQueries({ queryKey: key });
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
      <fieldset className="source-role-choice">
        <legend className="field-label">What are you adding?</legend>
        {!hasPrimary ? (
          <ChoiceRow type="radio" variant="boxed" name="role" checked={role === "primary"} onChange={() => setRole("primary")} label="The primary file" hint="Parsed into passages and searched." />
        ) : null}
        <ChoiceRow type="radio" variant="boxed" name="role" checked={role === "origin"} onChange={() => setRole("origin")} label="Origin files" hint="The originals behind a digest. Not searched." />
        <ChoiceRow type="radio" variant="boxed" name="role" checked={role === "supplement"} onChange={() => setRole("supplement")} label="Supplements" hint="Supporting material, such as slides. Not searched." />
      </fieldset>
      {record.pending_primary_path && !hasPrimary ? (
        <Callout inset tone="info">
          An upload of {record.pending_primary_path} as the primary file is in progress. Choose a file with the same name to finish it.
        </Callout>
      ) : null}
      <input type="file" className="source-file-input" multiple={role !== "primary"} aria-label="Attachments to add" onChange={(e) => setItems([...(e.target.files ?? [])].map((file) => ({ file, role, state: "waiting" as const, loaded: 0 })))} />
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
