import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { actorName, attribution, formatBytes, formatDate, passageText, plural, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus, derivedStatusDetail, PROVENANCE_LABEL, REVIEW_STATUS, ROLE_LABEL } from "../lib/status.ts";
import type { Actor, FileEntry, RecordFull } from "../lib/types.ts";
import { Inspector, InspectorToggle, ShellContext, usePageTitle } from "../shell/slots.tsx";
import {
  AgentFace, Avatar, Button, ButtonLink, Callout, ChoiceRow, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuItem,
  MenuSeparator, PageHeader, Segmented, SelectField, Sheet, SheetHeader, StatusBadge, Tag, TextArea, TextField, useToast, type GlyphName,
} from "../ui/index.tsx";
import "../styles/screens/evidence.css";
import { address, Comment, CommentForm, PassageReader } from "./passages.tsx";
import { uploadFiles } from "./source-new.tsx";
import { EvidenceFilters, useKinds } from "./evidence.tsx";

type View = "passages" | "original" | "notes" | "files";
type AgentNoteKind = "summary" | "outline" | "notes";
type SourceRecord = RecordFull & { agent_notes?: { kind: AgentNoteKind; updated_at: string; updated_by: Actor }[] };
interface AgentNote {
  note_kind: AgentNoteKind;
  content: string;
  updated_at: string;
  updated_by: Actor;
}
interface CitedIn {
  insights: { insight_id: string; title: string; summary: string; status: string; updated_at: string }[];
  assumptions: { id: string; statement: string; status: string; citations: { seq_start: number; seq_end: number }[] }[];
  decisions: { id: string; statement: string; status: string; citations: { seq_start: number; seq_end: number }[] }[];
  story_pages?: { page_id: string; title: string; version: number; referenced: boolean; citations: { seq_start: number; seq_end: number }[] }[];
}

/** Old `?tab=` links keep working: each maps to a section, and "connected" opens the inspector. */
const TAB_TO_VIEW: Record<string, View | null> = { passages: "passages", preview: "original", files: "files", notes: "notes", connected: null };

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
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<SourceRecord>("GET", `${base}/sources/${recordId}?detail=full`),
    refetchInterval: (query) => (query.state.data?.derived_status === "pending" ? 2000 : false),
  });
  const noteKinds = (q.data?.agent_notes ?? []).map((n) => n.kind);
  const notes = useQueries({
    queries: (["summary", "outline", "notes"] as const).map((kind) => ({
      queryKey: ["source-agent-note", base, recordId, kind, q.data?.agent_notes?.find((n) => n.kind === kind)?.updated_at ?? ""],
      queryFn: () => api<AgentNote>("GET", `${base}/sources/${recordId}/agent-notes/${kind}`),
      enabled: noteKinds.includes(kind),
      staleTime: 60_000,
    })),
  });
  const [summary, outline, agentNotes] = notes;
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
  // "connected" (the old Insights tab) opens the inspector, where Cited in now lives. The shell closes
  // overlays when a route mounts, so open it on the next tick, once the source has loaded.
  const loaded = q.isSuccess;
  useEffect(() => {
    if (!loaded || !openInspector.current || !slots) return;
    openInspector.current = false;
    const t = setTimeout(() => slots.setInspectorOpen(true), 0);
    return () => clearTimeout(t);
  }, [loaded, slots]);
  const [dialog, setDialog] = useState<"edit" | "delete" | "files" | null>(null);
  usePageTitle(q.data?.title ?? "Source");
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
            {`${t.title ?? "It"} was deleted permanently by ${t.deleted_by?.display_name ?? "someone"} on ${formatDate(t.deleted_at)}. Reason: ${t.reason ?? "not given"}. Quotes cited from it are kept on their assumptions and decisions.`}
          </EmptyState>
        </>
      );
    }
    return (
      <>
        <EvidenceFilters />
        <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: "Source" }]} title={e.status === 404 ? "Source not found" : "This source could not be loaded"} />
        {e.status === 404 ? (
          <EmptyState action={<ButtonLink to={`${app}/evidence`}>Back to Evidence</ButtonLink>}>It does not exist in this product, or you cannot see it.</EmptyState>
        ) : (
          <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
        )}
      </>
    );
  }
  const r = q.data;
  const status = derivedStatus(r.derived_status);
  const statusDetail = derivedStatusDetail(r.derived_status, r.status_detail);
  const parsed = r.segment_count > 0;
  const requested = params.get("view") as View | null;
  const fallback: View = parsed ? "passages" : r.files.length ? "original" : "files";
  const view: View = requested && ["passages", "original", "notes", "files"].includes(requested) && (requested !== "passages" || parsed) ? requested : fallback;
  const writable = canWrite && !r.archived_at;
  const agentNoteCount = (outline?.data ? 1 : 0) + (agentNotes?.data ? 1 : 0);
  return (
    <>
      <EvidenceFilters />
      <PageHeader
        crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: r.title }]}
        title={r.title}
        meta={<SourceMeta record={r} />}
        actions={
          <>
            <InspectorToggle />
            <SourceActions record={r} onDialog={setDialog} />
          </>
        }
      />
      <SourceDescription note={summary?.data ?? null} loading={Boolean(summary?.isPending && noteKinds.includes("summary"))} />
      {r.has_lineage ? <ViewLineage recordId={r.record_id} /> : null}
      {r.archived_at || r.derived_status !== "ready" ? (
        <div className="source-notices">
      {r.archived_at ? (
        <Callout tone="attention" title={`Archived ${relativeTime(r.archived_at)}`} action={canWrite ? <RestoreButton record={r} /> : undefined}>
          Read-only. Its files and passages stay stored and citable, but lists and search, including your agents', leave it out until it is restored.
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
            { id: "notes", label: "Notes", count: r.annotation_count + agentNoteCount || undefined, to: "?view=notes" },
            { id: "files", label: "Files", count: r.files.length, to: "?view=files" },
          ]}
        />
      </div>
      {view === "passages" ? <PassageReader record={r} /> : null}
      {view === "original" ? <OriginalView record={r} /> : null}
      {view === "notes" ? <NotesView record={r} outline={outline?.data ?? null} notes={agentNotes?.data ?? null} fileOutline={r.outline} /> : null}
      {view === "files" ? <FilesView record={r} onAdd={writable ? () => setDialog("files") : undefined} /> : null}
      <SourceInspector record={r} />
      {dialog === "edit" ? <EditDetails record={r} onReload={() => void q.refetch()} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteSource record={r} onClose={() => setDialog(null)} /> : null}
      {dialog === "files" ? <AddFiles record={r} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function surfaceLabel(actor: Actor) {
  if (actor.surface === "mcp") return actor.client || "an agent";
  if (actor.surface === "rest") return "the API";
  return "the web";
}

function SourceMeta({ record: r }: { record: SourceRecord }) {
  return (
    <span className="source-meta">
      <span>{r.kind_label}</span>
      {r.date ? <span className="num">{formatDate(r.date)}</span> : null}
      {r.organization ? <span>{r.organization}</span> : null}
      <span className="source-meta-added">
        Added by {actorName(r.uploaded_by)} · via {surfaceLabel(r.uploaded_by)}, {formatDate(r.uploaded_at)}
      </span>
    </span>
  );
}

/** The description: the agent's summary of the source, clamped to four lines. */
function SourceDescription({ note, loading }: { note: AgentNote | null; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [note, open]);
  if (loading) return <Loading variant="lines" lines={2} label="Loading the description…" />;
  if (!note)
    return (
      <p className="source-description source-description-empty">
        No description yet. <Link to="/connect">Ask your agent</Link> to summarize this source.
      </p>
    );
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
      </div>
    </div>
  );
}

interface LineageCheck {
  registered_at: string;
  registered_by: Actor;
  stale: boolean;
  input_checks: { kind: string; id: string; status: "current" | "changed" | "archived" | "deleted" | "missing" }[];
}

/**
 * A view built from other sources and register entries: how many inputs it was built from, and how
 * many have changed since. Nothing is rebuilt automatically, so a stale view says so plainly.
 */
function ViewLineage({ recordId }: { recordId: string }) {
  const { api: base } = useProduct();
  const q = useQuery({
    queryKey: ["lineage", base, recordId],
    queryFn: () => api<LineageCheck>("GET", `${base}/sources/${recordId}/lineage`),
    retry: false,
  });
  if (!q.data) return null;
  const l = q.data;
  const n = l.input_checks.length;
  const moved = l.input_checks.filter((c) => c.status !== "current");
  const built = `Built from ${plural(n, "input")}`;
  if (!l.stale)
    return (
      <p className="source-lineage">
        <StatusBadge tone="positive">Up to date</StatusBadge>
        <span>
          {built} on {formatDate(l.registered_at)} · none changed since
        </span>
      </p>
    );
  const counts = (["changed", "archived", "deleted", "missing"] as const)
    .map((s) => [s, moved.filter((c) => c.status === s).length] as const)
    .filter(([, k]) => k > 0)
    .map(([s, k]) => `${k} ${s}`);
  return (
    <div className="source-notices">
      <Callout tone="attention" title={`${built} · ${moved.length} changed since`}>
        Built on {formatDate(l.registered_at)} by {attribution(l.registered_by)}. Since then: {counts.join(", ")}. Nothing is rebuilt automatically; read it as of that date, or ask your agent to
        rebuild it.
      </Callout>
    </div>
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
        restore ? "Restored. It is back in lists and search." : "Archived. It is out of lists and search, including your agents'. Nothing was erased.",
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

function SourceActions({ record: r, onDialog }: { record: SourceRecord; onDialog: (d: "edit" | "delete" | "files") => void }) {
  const { canWrite } = useProduct();
  const toast = useToast();
  const archive = useArchive(r);
  return (
    <Menu label="Source actions" trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-md">
      {canWrite && !r.archived_at ? (
        <>
          <MenuItem icon="pencil" onSelect={() => onDialog("edit")}>
            Edit details
          </MenuItem>
          <MenuItem icon="upload" onSelect={() => onDialog("files")}>
            Add files
          </MenuItem>
        </>
      ) : null}
      <MenuItem
        icon="link"
        onSelect={() =>
          void navigator.clipboard
            .writeText(`${location.origin}${location.pathname}`)
            .then(() => toast("Link copied."))
            .catch(() => toast("Couldn't copy the link.", { tone: "negative" }))
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
          <MenuItem icon="trash" tone="danger" onSelect={() => onDialog("delete")}>
            Delete permanently…
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}

// ---- Inspector ----------------------------------------------------------------------------------

function fileGlyph(f: FileEntry): GlyphName {
  return /^(audio|video)\//.test(f.media_type ?? "") ? "file-audio" : "file-text";
}

/** "Searched", "Kept, not searched" or the primary's parsing state, in words. */
function searchWords(f: FileEntry) {
  if (f.searchable) return "Searched";
  if (f.role !== "primary") return "Kept, not searched";
  return f.search_status === "pending" ? "Searched once parsed" : "Not searched";
}

function SourceInspector({ record: r }: { record: SourceRecord }) {
  const { api: base, app, canWrite } = useProduct();
  const archive = useArchive(r);
  const cited = useQuery({
    queryKey: ["insights-for", base, r.record_id],
    queryFn: () => api<CitedIn>("GET", `${base}/sources/${r.record_id}/insights`),
  });
  const primary = r.files.find((f) => f.role === "primary");
  const versions = r.files.reduce((n, f) => n + Math.max(1, f.versions.length), 0);
  const c = cited.data;
  const citedCount = c ? c.insights.length + c.assumptions.length + c.decisions.length + (c.story_pages?.length ?? 0) : undefined;
  return (
    <Inspector title={r.title}>
      <div className="source-inspector">
        <Group title="Details">
          <KeyValue
            items={[
              { label: "Kind", value: r.kind_label },
              { label: "Date", value: r.date ? formatDate(r.date) : "No date" },
              { label: "Organization", value: r.organization },
              { label: "Participants", value: r.participants.length ? r.participants.join(", ") : null },
              { label: "Tags", value: r.tags.length ? <span className="chips source-tags">{r.tags.map((t) => <Tag key={t}>{t}</Tag>)}</span> : null },
              { label: "From", value: r.source_system },
              { label: "Evidence", value: r.provenance_depth !== "unknown" ? PROVENANCE_LABEL[r.provenance_depth] : null },
              {
                label: "Filed in",
                value: (
                  <Link to={`${app}/evidence?folder=${encodeURIComponent(r.folder)}`} className="quiet-link" title={`Every source filed in ${r.folder_label}`}>
                    {r.folder_label}
                  </Link>
                ),
              },
              {
                label: "Added by",
                value: (
                  <span className="source-face">
                    {r.uploaded_by.surface === "mcp" ? <AgentFace /> : <Avatar name={r.uploaded_by.display_name} />}
                    <span>
                      {actorName(r.uploaded_by)}
                      <small>via {surfaceLabel(r.uploaded_by)}</small>
                    </span>
                  </span>
                ),
              },
              { label: "Added", value: <span className="num">{formatDate(r.uploaded_at)}</span> },
              {
                label: "Updated",
                value: r.updated_at !== r.uploaded_at ? `${relativeTime(r.updated_at)} by ${actorName(r.updated_by)}` : null,
              },
            ]}
          />
        </Group>
        <Group title="Files" count={r.files.length} action={<Link to="?view=files" className="quiet-link">All files</Link>}>
          {r.files.length ? (
            <ul className="source-file-summary">
              {r.files.map((f) => (
                <li key={f.path}>
                  <Glyph name={fileGlyph(f)} />
                  <span>
                    <b className="ellipsis" title={f.path}>
                      {f.path}
                    </b>
                    <span className={f.searchable ? "text-ok" : "faint"}>
                      {ROLE_LABEL[f.role]} · {searchWords(f)}
                      {f.role === "primary" && f.searchable ? ` · ${plural(r.segment_count, "passage")}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState size="inline">No files yet. {primary ? "" : "The primary file is what gets parsed and searched."}</EmptyState>
          )}
          {r.files.length ? (
            <p className="source-inspector-note">
              {plural(r.files.length, "file")}
              {versions > r.files.length ? `, ${plural(versions, "stored version")}` : ""}. Only the primary file is searched.
            </p>
          ) : null}
        </Group>
        <Group title="Cited in" count={citedCount}>
          {cited.isPending ? (
            <Loading variant="lines" lines={2} label="Loading where it is cited…" />
          ) : cited.isError ? (
            <ErrorCallout inset error={cited.error} onRetry={() => cited.refetch()} />
          ) : !citedCount ? (
            <EmptyState size="inline">Not cited yet. Insights, assumptions, decisions and Story pages that use it appear here.</EmptyState>
          ) : (
            <ul className="source-cited">
              {c!.insights.map((i) => (
                <li key={i.insight_id}>
                  <Glyph name="lightbulb" size="sm" />
                  <Link to={`${app}/synthesis/insights/${i.insight_id}`} className="ellipsis" title={i.title}>
                    {i.title}
                  </Link>
                </li>
              ))}
              {[...c!.assumptions.map((e) => ({ ...e, k: "assumptions" as const })), ...c!.decisions.map((e) => ({ ...e, k: "decisions" as const }))].map((e) => (
                <li key={e.id}>
                  <Glyph name={e.k === "assumptions" ? "scale" : "signpost"} size="sm" />
                  <span className="source-cited-main">
                    <Link to={`${app}/synthesis/${e.k}/${e.id}`} className="ellipsis" title={e.statement}>
                      {e.statement}
                    </Link>
                    <span className="faint">
                      {e.k === "assumptions" ? "Assumption" : "Decision"}, {REVIEW_STATUS[e.status]?.label.toLowerCase() ?? e.status}
                      {e.citations.map((x, i) => (
                        <span key={i}>
                          {" · "}
                          <Link to={`?view=passages&seq=${x.seq_start}${x.seq_end !== x.seq_start ? `&to=${x.seq_end}` : ""}`} className="quiet-link num">
                            {address(x.seq_start, x.seq_end)}
                          </Link>
                        </span>
                      ))}
                    </span>
                  </span>
                </li>
              ))}
              {(c!.story_pages ?? []).map((p) => (
                <li key={p.page_id}>
                  <Glyph name="book-open" size="sm" />
                  <span className="source-cited-main">
                    <Link to={`${app}/story/${p.page_id}`} className="ellipsis" title={p.title}>
                      {p.title}
                    </Link>
                    <span className="faint">
                      Story page, version {p.version}
                      {p.citations.length ? "" : " · lists it"}
                      {p.citations.map((x, i) => (
                        <span key={i}>
                          {" · "}
                          <Link to={`?view=passages&seq=${x.seq_start}${x.seq_end !== x.seq_start ? `&to=${x.seq_end}` : ""}`} className="quiet-link num">
                            {address(x.seq_start, x.seq_end)}
                          </Link>
                        </span>
                      ))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
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
              {r.archived_at ? "Out of lists and search. Nothing was erased." : "Takes it out of lists and search, including your agents'. Nothing is erased; restore it any time."}
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

/** The origin file (or the primary, when there is no origin), shown as it was uploaded. */
function OriginalView({ record }: { record: SourceRecord }) {
  const { api: base } = useProduct();
  const initial = record.files.find((f) => f.role === "origin") ?? record.files.find((f) => f.role === "primary") ?? record.files[0];
  const [path, setPath] = useState(initial?.path ?? "");
  const f = record.files.find((x) => x.path === path) ?? initial;
  const kind = f ? previewKind(f) : "download";
  const tooBig = (f?.size ?? 0) > 4 * 1024 * 1024 && ["html", "markdown", "text"].includes(kind);
  const text = useQuery({
    queryKey: ["file-text", base, record.record_id, f?.path],
    queryFn: async () => {
      const res = await fetch(fileUrl(base, record.record_id, f!.path));
      if (!res.ok) throw new Error("The file could not be read.");
      return res.text();
    },
    enabled: Boolean(f) && !tooBig && ["html", "markdown", "text"].includes(kind),
  });
  if (!f)
    return (
      <Sheet>
        <SheetHeader title="Original" />
        <EmptyState size="inline" title="No file on this source yet.">
          Add the file from the menu, or ask your agent to upload it.
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
          : `${f.path} is kept with the source for download and checking; search never reads it.`}{" "}
        <span className="faint">
          {f.media_type ?? "Unknown type"} · {formatBytes(f.size)}
          {length ? ` · ${clockLength(length)} long` : ""}
        </span>
      </p>
      <div className="source-original-body">
        {tooBig || kind === "download" ? (
          <EmptyState size="inline" title="No preview for this format." action={<a className="btn btn-secondary btn-sm" href={fileUrl(base, record.record_id, f.path, true)}>Download {formatBytes(f.size)}</a>} />
        ) : kind === "pdf" ? (
          <iframe title={f.path} src={url} className="source-preview-frame" />
        ) : kind === "audio" ? (
          <audio controls preload="metadata" src={url} className="source-preview-media" />
        ) : kind === "video" ? (
          <video controls preload="metadata" src={url} className="source-preview-media" />
        ) : kind === "image" ? (
          <img src={url} alt={f.path} className="source-preview-image" />
        ) : text.isPending ? (
          <Loading label="Loading the file…" variant="lines" lines={5} />
        ) : text.isError ? (
          <ErrorCallout inset title="The file could not be read" error={text.error} onRetry={() => text.refetch()} />
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

function NotesView({ record, outline, notes, fileOutline }: { record: SourceRecord; outline: AgentNote | null; notes: AgentNote | null; fileOutline: string | null }) {
  const { canWrite } = useProduct();
  const [writing, setWriting] = useState(false);
  const writable = canWrite && !record.archived_at;
  // A timed transcript's outline lists every speaker turn, which the passage list already shows with
  // its speaker and time; agents still read it, but it is left out here.
  const timed = /^- \d{2}:\d{2}:\d{2}\.\d{3} to |^- \(no cues\)/m.test(fileOutline ?? "");
  const showFileOutline = Boolean(fileOutline && !outline && !timed && !/\(no headings\)/.test(fileOutline));
  return (
    <>
      <Sheet labelledBy="agent-notes-h">
        <SheetHeader id="agent-notes-h" title="From agents" />
        {!outline && !notes && !showFileOutline ? (
          <EmptyState size="inline" title="No outline or notes yet." action={<ButtonLink size="sm" to="/connect">Connect an agent</ButtonLink>}>
            Ask your agent to write an outline and notes for this source, so the next agent need not work them out again.
          </EmptyState>
        ) : (
          <>
            {outline ? <AgentNoteBlock title="Outline" note={outline} /> : null}
            {showFileOutline ? (
              <section className="source-agent-note">
                <h3>Outline from the file's headings</h3>
                <FileOutline outline={fileOutline!} />
              </section>
            ) : null}
            {notes ? <AgentNoteBlock title="Notes" note={notes} /> : null}
          </>
        )}
      </Sheet>
      <Sheet labelledBy="comments-h">
        <SheetHeader
          id="comments-h"
          title="Comments"
          count={record.annotations.length}
          end={
            writable && !writing ? (
              <Button size="sm" icon="pencil" onClick={() => setWriting(true)}>
                Comment on the source
              </Button>
            ) : undefined
          }
        />
        {writing ? (
          <div className="sheet-body">
            <CommentForm recordId={record.record_id} onDone={() => setWriting(false)} />
          </div>
        ) : null}
        {!record.annotations.length ? (
          <EmptyState size="inline" title="No comments yet.">
            {writable ? "Select passages in Passages and choose Comment, or comment on the whole source." : "Comments people write on passages appear here."}
          </EmptyState>
        ) : (
          <ul className="source-comments">
            {record.annotations.map((a) => (
              <li key={a.annotation_id}>
                <Comment annotation={a} showAddress linkAddress />
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}

/**
 * The parser's outline of a document's headings ("  - Scope (segment 12)" per line), each heading
 * linked to its passage. An outline in any other shape is shown as written.
 */
function FileOutline({ outline }: { outline: string }) {
  const lines = outline.split("\n").filter((l) => l.trim());
  const entries = lines.map((l) => /^( *)- (.*) \(segment (\d+)\)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null);
  if (!entries.length || entries.length !== lines.length) return <Markdown source={outline} className="prose source-outline" headingShift={3} />;
  return (
    <ol className="source-outline source-outline-list">
      {entries.map(([, indent, text, seq]) => (
        <li key={seq} style={{ paddingLeft: `calc(${Math.floor(indent!.length / 2)} * var(--s-4))` }}>
          <Link to={`?view=passages&seq=${seq}`} className="source-outline-link">
            <span className="ellipsis">{passageText(text!, 1)}</span>
            <span className="num faint">¶{seq}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function AgentNoteBlock({ title, note }: { title: string; note: AgentNote }) {
  return (
    <section className="source-agent-note">
      <h3>
        {title}
        <span className="faint">
          {attribution(note.updated_by)}, {relativeTime(note.updated_at)}
        </span>
      </h3>
      <Markdown source={note.content} className="prose" headingShift={3} />
    </section>
  );
}

function FilesView({ record, onAdd }: { record: SourceRecord; onAdd?: () => void }) {
  const { base, key } = useSourceKey();
  const { canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const setRole = useMutation({
    mutationFn: ({ path, role }: { path: string; role: string }) => api("POST", `${base}/sources/${record.record_id}/files/role`, { path, role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast((e as Error).message, { tone: "negative" }),
  });
  const hasPrimary = record.files.some((x) => x.role === "primary");
  return (
    <Sheet labelledBy="files-h">
      <SheetHeader
        id="files-h"
        title="Files"
        count={record.files.length}
        end={
          onAdd ? (
            <Button size="sm" icon="upload" onClick={onAdd}>
              Add file
            </Button>
          ) : undefined
        }
      />
      <p className="source-original-line">{record.search_rule}</p>
      {!record.files.length ? (
        <EmptyState size="inline" title="No files yet." action={onAdd ? <Button size="sm" onClick={onAdd}>Add file</Button> : undefined}>
          This source holds metadata only.
          {record.pending_primary_path ? ` An upload of ${record.pending_primary_path} is in progress.` : ""}
        </EmptyState>
      ) : (
        <ul className="source-files">
          {record.files.map((f) => (
            <li key={f.path} className="source-file">
              <Glyph name={fileGlyph(f)} />
              <span className="source-file-main">
                <b className="ellipsis" title={f.path}>
                  {f.path}
                </b>
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
              <span className="source-file-role">
                {canWrite && f.role !== "primary" && !record.archived_at ? (
                  <span className="select-wrap">
                    <select className="input select" aria-label={`Role of ${f.path}`} value={f.role} disabled={setRole.isPending} onChange={(e) => setRole.mutate({ path: f.path, role: e.target.value })}>
                      <option value="origin">Origin</option>
                      <option value="supplement">Supplement</option>
                      {!hasPrimary ? <option value="primary">Make primary</option> : null}
                    </select>
                    <Glyph name="chevron-down" size="sm" />
                  </span>
                ) : (
                  <span className="muted">{ROLE_LABEL[f.role]}</span>
                )}
              </span>
              <a href={fileUrl(base, record.record_id, f.path, true)} className="icon-btn icon-btn-md" aria-label={`Download ${f.path}`} title={`Download ${f.path}`}>
                <Glyph name="download" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---- Dialogs ------------------------------------------------------------------------------------

function EditDetails({ record, onClose, onReload }: { record: SourceRecord; onClose: () => void; onReload: () => void }) {
  const { base, key } = useSourceKey();
  const kinds = useKinds();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    kind: record.kind,
    title: record.title,
    date: record.date ?? "",
    organization: record.organization ?? "",
    tags: record.tags.join(", "),
    participants: record.participants.join(", "),
    source_system: record.source_system ?? "",
    provenance_depth: record.provenance_depth,
  });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      api<{ changed: string[]; folder_label: string }>("PATCH", `${base}/sources/${record.record_id}`, {
        expected_etag: record.etag,
        kind: f.kind,
        title: f.title,
        date: f.date || null,
        organization: f.organization || null,
        tags: list(f.tags),
        participants: list(f.participants),
        source_system: f.source_system || null,
        provenance_depth: f.provenance_depth,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      toast(res.changed.length ? `Saved. Filed under ${res.folder_label}; its id, passages and citations are unchanged.` : "Nothing changed.");
      onClose();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit details"
      description="Fix mistakes here. The source keeps its id, so every passage address and citation still resolves."
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
      <SelectField label="Kind" value={f.kind} onChange={set("kind")}>
        {kinds.data?.kinds.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Title" value={f.title} onChange={set("title")} required maxLength={300} />
      <TextField label="Date" type="date" value={f.date} onChange={set("date")} optional />
      <TextField label="Organization" value={f.organization} onChange={set("organization")} optional />
      <TextField label="Tags" value={f.tags} onChange={set("tags")} optional hint="Comma-separated." />
      <TextField label="Participants" value={f.participants} onChange={set("participants")} optional hint="Comma-separated." />
      <TextField label="Where it came from" value={f.source_system} onChange={set("source_system")} optional />
      <SelectField label="Relationship to the evidence" value={f.provenance_depth} onChange={set("provenance_depth")}>
        {Object.entries(PROVENANCE_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
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
        citations: { id: string; kind: string; statement: string; count: number }[];
        insights_referencing: { id: string; title: string }[];
        story_pages_citing?: { page_id: string; title: string; version: number; count: number }[];
      }>("GET", `${base}/sources/${record.record_id}/delete-impact`),
  });
  const del = useMutation({
    mutationFn: () => api("DELETE", `${base}/sources/${record.record_id}`, { expected_etag: impact.data!.etag, reason, confirm: "delete permanently" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      toast(`Deleted “${record.title}” permanently. The activity log records who, when and why.`);
      navigate(`${app}/evidence`);
    },
  });
  const i = impact.data;
  const pages = i?.story_pages_citing ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete permanently"
      description="This cannot be undone. Archiving takes it out of lists and search and erases nothing."
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
            This destroys {plural(i.file_versions, "stored file")} ({formatBytes(i.bytes)}), {plural(i.derivations, "parse")} and {plural(i.annotations, "comment")}.
          </p>
          {i.citations.length ? (
            <p>
              <strong>
                {plural(i.citations.reduce((n, c) => n + c.count, 0), "citation")} in {plural(i.citations.length, "entry", "entries")} point at this source
              </strong>{" "}
              and will point at a record of the deletion instead. Their quoted text is kept.
            </p>
          ) : null}
          {pages.length ? <p>{plural(pages.length, "Story page")} cite it; their quotes are kept.</p> : null}
          {i.insights_referencing.length ? <p>{plural(i.insights_referencing.length, "insight")} reference it and will keep a dead reference.</p> : null}
        </div>
      ) : null}
      <TextArea label="Why is it being deleted?" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded with the deletion." />
      <TextField label={`Type the title to confirm: ${record.title}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      {del.isError ? <ErrorCallout inset error={del.error} /> : null}
    </Dialog>
  );
}

type Role = "primary" | "origin" | "supplement";

function AddFiles({ record, onClose }: { record: SourceRecord; onClose: () => void }) {
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
    await uploadFiles(base, record.record_id, items, (i, patch) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x))));
    setRunning(false);
    await qc.invalidateQueries({ queryKey: key });
    setItems((all) => {
      if (all.every((i) => i.state === "done")) {
        toast(all.length === 1 ? "File added." : "Files added.");
        onClose();
      }
      return all;
    });
  };
  const failed = items.filter((i) => i.state === "failed").length;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!running}
      title="Add files"
      description="Only the primary file is parsed into passages and searched. Everything else is kept with the source."
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
        <ChoiceRow type="radio" variant="boxed" name="role" checked={role === "origin"} onChange={() => setRole("origin")} label="Origin files" hint="The full originals behind a digest. Kept, not searched." />
        <ChoiceRow type="radio" variant="boxed" name="role" checked={role === "supplement"} onChange={() => setRole("supplement")} label="Supplements" hint="Slides, an appendix, a screenshot. Kept, not searched." />
      </fieldset>
      {record.pending_primary_path && !hasPrimary ? (
        <Callout inset tone="info">
          An upload of {record.pending_primary_path} as the primary is in progress; name your file the same to finish it.
        </Callout>
      ) : null}
      <input type="file" className="source-file-input" multiple={role !== "primary"} aria-label="Files to add" onChange={(e) => setItems([...(e.target.files ?? [])].map((file) => ({ file, role, state: "waiting" as const, loaded: 0 })))} />
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
