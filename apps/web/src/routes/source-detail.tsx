import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, isObjectId, qs } from "../lib/api.ts";
import { actorName, attribution, formatBytes, formatDate, plural, quotedAtEnd, relativeTime, viaSurface } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import type { Actor, RecordFull } from "../lib/types.ts";
import { Inspector, ShellContext, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuItem,
  MenuSeparator, PageHeader, Segmented, Sheet, SheetHeader, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import "../styles/screens/evidence.css";
import { AddAttachments, AttachmentsView, SourceImages } from "./source-attachments.tsx";
import { CommentsView } from "./source-comments.tsx";
import { ChangedMeanwhile, TextView, type Theirs } from "./source-text.tsx";
import { EvidenceFilters, splitTags, TagSuggestions } from "./evidence.tsx";

type View = "text" | "notes" | "comments" | "attachments";
const VIEWS: View[] = ["text", "notes", "comments", "attachments"];
/** Sections a link may still name from before a source's words were one text. */
const OLD_VIEWS: Record<string, View> = { passages: "text", original: "attachments", files: "attachments" };
type AgentNoteKind = "summary" | "notes";
type SourceRecord = RecordFull & { agent_notes?: { kind: AgentNoteKind; etag: string; updated_at: string; updated_by: Actor }[] };
interface AgentNote {
  note_kind: AgentNoteKind;
  content: string;
  /** The one a write over it names. */
  etag: string;
  updated_at: string;
  updated_by: Actor;
}

/** Old `?tab=` links keep working: each maps to a section, and "connected" opens the inspector. */
const TAB_TO_VIEW: Record<string, View | null> = { passages: "text", preview: "attachments", files: "attachments", notes: "notes", connected: null };

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
    // While an attachment is being read, look again: its text may become the source's.
    refetchInterval: (query) => (query.state.data?.derived_status === "pending" || query.state.data?.attachments.some((a) => a.text.status === "pending") ? 2000 : false),
  });
  const noteKinds = (q.data?.agent_notes ?? []).map((n) => n.kind);
  const notes = useQueries({
    queries: (["summary", "notes"] as const).map((kind) => ({
      queryKey: ["source-agent-note", base, recordId, kind, q.data?.agent_notes?.find((n) => n.kind === kind)?.etag ?? ""],
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
  const asked = params.get("view") ?? "";
  const view: View = (VIEWS as string[]).includes(asked) ? (asked as View) : (OLD_VIEWS[asked] ?? "text");
  const writable = canWrite && !r.archived_at;
  return (
    <>
      <EvidenceFilters />
      <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: r.title }]} title={r.title} actions={<SourceActions record={r} onDialog={setDialog} />} />
      <SourceDescription record={r} note={summary?.data ?? null} loading={Boolean(summary?.isPending && noteKinds.includes("summary"))} />
      {r.archived_at ? (
        <div className="source-notices">
          <Callout tone="attention" title={`Archived ${relativeTime(r.archived_at)}`} action={canWrite ? <RestoreButton record={r} /> : undefined}>
            Read-only, and left out of lists and search, including your agents&rsquo;, until it&rsquo;s restored.
          </Callout>
        </div>
      ) : null}
      <SourceImages record={r} />
      <div className="source-sections">
        <Segmented
          label="Source sections"
          value={view}
          items={[
            { id: "text", label: "Text", to: "?view=text" },
            { id: "notes", label: "Notes", to: "?view=notes" },
            { id: "comments", label: "Comments", count: r.annotation_count || undefined, to: "?view=comments" },
            { id: "attachments", label: "Attachments", count: r.attachments.length || undefined, to: "?view=attachments" },
          ]}
        />
      </div>
      {view === "text" ? <TextView key={r.record_id} record={r} onAddAttachments={writable ? () => setDialog("attachments") : undefined} /> : null}
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

/**
 * The summary under the title, whole: what the source is and what it tells the team, the part of
 * a source people read. Editors can write or change it here; without one, others see nothing.
 */
function SourceDescription({ record, note, loading }: { record: SourceRecord; note: AgentNote | null; loading: boolean }) {
  const { canWrite } = useProduct();
  const [editing, setEditing] = useState(false);
  const writable = canWrite && !record.archived_at;
  return (
    <>
      {loading ? (
        <Loading variant="lines" lines={2} label="Loading the summary…" />
      ) : !note ? (
        writable ? (
          <div className="source-description source-description-empty">
            <Button size="sm" variant="quiet" icon="plus" onClick={() => setEditing(true)}>
              Add a summary
            </Button>
          </div>
        ) : null
      ) : (
        <div className="source-description">
          <div className="source-summary">
            <Markdown source={note.content} className="prose" headingShift={3} />
          </div>
          <div className="source-summary-foot">
            <span>
              Summary by {attribution(note.updated_by)}, {relativeTime(note.updated_at)}
            </span>
            {writable ? (
              <button type="button" className="quiet-link source-summary-edit" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : null}
          </div>
        </div>
      )}
      {/* In one place whatever the summary behind it shows, so a reload while it is open keeps what the person typed. */}
      {editing ? <NoteDialog record={record} kind="summary" note={note} onClose={() => setEditing(false)} /> : null}
    </>
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

/**
 * Write a source's summary or notes. Saving it empty removes it. Saving names the etag of what the
 * dialog opened (none for the first), so a change someone made meanwhile is never overwritten unseen.
 */
function NoteDialog({ record, kind, note, onClose }: { record: SourceRecord; kind: AgentNoteKind; note: AgentNote | null; onClose: () => void }) {
  const { base, key } = useSourceKey();
  const qc = useQueryClient();
  const toast = useToast();
  const words = NOTE_WORDS[kind];
  // What the dialog opened: the person edits from it, whatever the page behind it loads meanwhile.
  const [start] = useState(() => ({ content: note?.content ?? "", etag: note?.etag ?? null }));
  const [content, setContent] = useState(start.content);
  const [etag, setEtag] = useState(start.etag);
  const [theirs, setTheirs] = useState<Theirs | null>(null);
  const loadTheirs = async () => {
    setTheirs({ state: "loading" });
    // The page behind the dialog shows theirs too, once it reloads.
    void qc.invalidateQueries({ queryKey: key });
    try {
      const now = await api<AgentNote>("GET", `${base}/sources/${record.record_id}/agent-notes/${kind}`);
      setEtag(now.etag);
      setTheirs({ state: "changed", content: now.content });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setEtag(null);
        setTheirs({ state: "removed" });
      } else setTheirs({ state: "unknown" });
    }
  };
  const save = useMutation({
    mutationFn: () => api("PUT", `${base}/sources/${record.record_id}/agent-notes/${kind}`, { content, ...(etag ? { expected_etag: etag } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["source-agent-note", base, record.record_id, kind] });
      toast(content.trim() ? words.saved : words.cleared);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "stale_etag") void loadTheirs();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={start.content ? `Edit the ${words.title.toLowerCase()}` : `Write the ${words.title.toLowerCase()}`}
      dismissable={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            busyLabel="Saving…"
            disabled={(!theirs && content === start.content) || theirs?.state === "loading"}
            onClick={() => save.mutate()}
          >
            {theirs?.state === "changed" ? "Save mine over theirs" : "Save"}
          </Button>
        </>
      }
    >
      <TextArea label={words.label} hint={words.hint} rows={kind === "summary" ? 6 : 14} maxLength={100_000} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
      {theirs ? <ChangedMeanwhile noun={words.title.toLowerCase()} theirs={theirs} onLoad={() => void loadTheirs()} rows={kind === "summary" ? 4 : 8} /> : null}
      {save.isError && !stale ? <ErrorCallout inset error={save.error} /> : null}
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
        {viaSurface(by)}
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
              // Its details (title, date captured, tags), its move here from another product or its
              // archiving: the text, summary, notes, comments and attachments say when they were
              // written, and leave this alone.
              {
                label: "Details updated",
                value: r.updated_at !== r.uploaded_at ? <When at={r.updated_at} by={r.updated_by} /> : <span className="faint">Not changed since it was added</span>,
              },
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
      {editing ? <NoteDialog record={record} kind="notes" note={note} onClose={() => setEditing(false)} /> : null}
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

/** What archiving would do instead, said in a live source's delete dialog; an archived one is already out of lists and search. */
const ARCHIVING_INSTEAD = "Archiving takes it out of lists and search and erases nothing.";

/**
 * What deleting a source deletes, as its dialog says it: its attachments' stored versions, its
 * text, summary and notes, and its comments, leaving out a count of none.
 */
export function sourceImpactWords(i: { file_versions: number; bytes: number; annotations: number }): string {
  const attachments = i.file_versions > 0 ? `its attachments (${plural(i.file_versions, "stored version")}, ${formatBytes(i.bytes)}), ` : "";
  const comments = i.annotations > 0 ? `, and ${plural(i.annotations, "comment")}` : "";
  return `This deletes ${attachments}its text, summary and notes${comments}.`;
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
      toast(`Deleted ${quotedAtEnd(record.title)} The activity log records who, when and why.`);
      navigate(`${app}/evidence`);
    },
  });
  const i = impact.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete this source permanently?"
      description={record.archived_at ? "This can’t be undone." : `This can’t be undone. ${ARCHIVING_INSTEAD}`}
      dismissable={!del.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          {/* Already archived, it has nothing to offer instead. */}
          {record.archived_at ? null : (
            <Button
              onClick={() => {
                archive.mutate(false);
                onClose();
              }}
              disabled={del.isPending}
            >
              Archive instead
            </Button>
          )}
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
          <p>{sourceImpactWords(i)}</p>
          <p>Links to it from Story pages, mockups and notes will open a record of the deletion instead.</p>
        </div>
      ) : null}
      <TextArea label="Why is it being deleted?" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded with the deletion." />
      <TextField label={`Type the title to confirm: ${record.title}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      {del.isError ? <ErrorCallout inset error={del.error} /> : null}
    </Dialog>
  );
}
