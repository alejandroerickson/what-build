import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, isObjectId, qs } from "../lib/api.ts";
import { actorName, attribution, fileTypeName, formatBytes, formatDate, passageText, plural, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus, derivedStatusDetail, PROVENANCE_LABEL, REVIEW_STATUS, ROLE_LABEL } from "../lib/status.ts";
import type { Actor, FileEntry, RecordFull } from "../lib/types.ts";
import { Inspector, ShellContext, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, ChoiceRow, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuItem,
  MenuSeparator, PageHeader, Segmented, SelectField, Sheet, SheetHeader, StatusBadge, Tag, TextArea, TextField, useToast, type GlyphName,
} from "../ui/index.tsx";
import "../styles/screens/evidence.css";
import { address, Comment, CommentForm, PassageReader } from "./passages.tsx";
import { uploadFiles } from "./source-new.tsx";
import { EvidenceFilters, splitTags, TagSuggestions } from "./evidence.tsx";
import { ImageViewer } from "./image-viewer.tsx";

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
  assumptions: { id: string; statement: string; status: string; citations: { seq_start: number; seq_end: number }[] }[];
  related: { record_id: string; title: string; tags: string[] }[];
  story_pages?: { page_id: string; title: string; version: number; referenced: boolean; citations: { seq_start: number; seq_end: number }[] }[];
  mockups?: { mockup_id: string; title: string; version: number; referenced: boolean; citations: { seq_start: number; seq_end: number }[] }[];
}

/** Old `?tab=` links keep working: each maps to a section, and "connected" opens the inspector. */
const TAB_TO_VIEW: Record<string, View | null> = { passages: "passages", preview: "original", files: "files", notes: "notes", connected: null };

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
  // "connected" (the old tab of what cites it) opens the inspector, where Cited in now lives. The shell closes
  // overlays when a route mounts, so open it on the next tick, once the source has loaded.
  const loaded = q.isSuccess;
  useEffect(() => {
    if (!loaded || !openInspector.current || !slots) return;
    openInspector.current = false;
    const t = setTimeout(() => slots.setInspectorOpen(true), 0);
    return () => clearTimeout(t);
  }, [loaded, slots]);
  const [dialog, setDialog] = useState<"edit" | "delete" | "files" | null>(null);
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
            {`${t.title ?? "It"} was deleted by ${t.deleted_by?.display_name ?? "someone"} on ${formatDate(t.deleted_at)}. Reason: ${t.reason ?? "not given"}. Quotes cited from it are kept.`}
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
  const requested = params.get("view") as View | null;
  const fallback: View = parsed ? "passages" : r.files.length ? "original" : "files";
  const view: View = requested && ["passages", "original", "notes", "files"].includes(requested) && (requested !== "passages" || parsed) ? requested : fallback;
  const writable = canWrite && !r.archived_at;
  const agentNoteCount = (outline?.data ? 1 : 0) + (agentNotes?.data ? 1 : 0);
  return (
    <>
      <EvidenceFilters />
      <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: r.title }]} title={r.title} actions={<SourceActions record={r} onDialog={setDialog} />} />
      <SourceDescription note={summary?.data ?? null} loading={Boolean(summary?.isPending && noteKinds.includes("summary"))} />
      {r.has_lineage ? <StaleViewNotice recordId={r.record_id} /> : null}
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

/** The description: the agent's summary of the source, clamped to four lines. Nothing when there is none. */
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
  if (!note) return null;
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

type LineageStatus = "current" | "changed" | "archived" | "deleted" | "missing";
interface LineageInputCheck {
  kind: "record" | "assumption";
  id: string;
  status: LineageStatus;
  changed_parts?: string[] | null;
  last_changed_at?: string | null;
}
interface LineageCheck {
  registered_at: string;
  registered_by: Actor;
  query_spec: { description?: string } | null;
  stale: boolean;
  input_checks: LineageInputCheck[];
}

function useLineage(recordId: string) {
  const { api: base } = useProduct();
  return useQuery({
    queryKey: ["lineage", base, recordId],
    queryFn: () => api<LineageCheck>("GET", `${base}/sources/${recordId}/lineage`),
    retry: false,
  });
}

const INPUT_NOUN = { record: ["source", "sources"], assumption: ["assumption", "assumptions"] } as const;

/** "12 sources and 5 assumptions": what a view was built from, by kind. */
function describeInputs(checks: LineageInputCheck[]) {
  const parts = (["record", "assumption"] as const)
    .map((k) => [k, checks.filter((c) => c.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => plural(n, INPUT_NOUN[k][0], INPUT_NOUN[k][1]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "no inputs");
}

/**
 * A view whose inputs changed since it was built says so above its sections, since reading it as
 * current would mislead. Which inputs changed, and how, is in the inspector's Built from group.
 */
function StaleViewNotice({ recordId }: { recordId: string }) {
  const q = useLineage(recordId);
  const slots = useContext(ShellContext);
  if (!q.data?.stale) return null;
  const l = q.data;
  const moved = l.input_checks.filter((c) => c.status !== "current").length;
  const seeWhat = () => {
    slots?.setInspectorOpen(true);
    requestAnimationFrame(() => document.getElementById("built-from")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  return (
    <div className="source-notices">
      <Callout
        tone="attention"
        title="This view may be out of date"
        action={
          <Button size="sm" onClick={seeWhat}>
            See what changed
          </Button>
        }
      >
        Built on {formatDate(l.registered_at)} from {describeInputs(l.input_checks)}; {moved === 1 ? "1 has" : `${moved} have`} changed since. Ask your agent to rebuild it.
      </Callout>
    </div>
  );
}

const PART_WORDS: Record<string, string> = {
  title: "title",
  date: "date",
  primary_version: "primary file",
  derivation: "passages",
  archived: "archived",
  statement: "statement",
  body: "body",
  citations: "citations",
  status: "status",
  review_count: "reviews",
};

/** What happened to one input since the view was built, in words. */
function inputChange(c: LineageInputCheck) {
  if (c.status === "archived") return "Archived";
  if (c.status === "deleted") return "Deleted";
  if (c.status === "missing") return "No longer found";
  const parts = (c.changed_parts ?? []).filter((p) => p !== "archived").map((p) => PART_WORDS[p] ?? p);
  const what = parts.length ? `Changed: ${parts.join(", ")}` : "Changed";
  return c.last_changed_at ? `${what}, ${formatDate(c.last_changed_at)}` : what;
}

/** The inspector's account of a view's lineage: what it was built from, when, and what has moved since. */
function BuiltFrom({ recordId }: { recordId: string }) {
  const { api: base, app } = useProduct();
  const q = useLineage(recordId);
  const moved = (q.data?.input_checks ?? []).filter((c) => c.status !== "current");
  const names = useQueries({
    queries: moved.map((c) => ({
      queryKey: ["lineage-input", base, c.kind, c.id],
      queryFn: async () => {
        if (c.kind === "record") return (await api<{ title: string }>("GET", `${base}/sources/${c.id}`)).title;
        return (await api<{ statement: string }>("GET", `${base}/${c.kind}s/${c.id}`)).statement;
      },
      enabled: c.status !== "deleted" && c.status !== "missing",
      retry: false,
      staleTime: 60_000,
    })),
  });
  if (!q.data) return null;
  const l = q.data;
  const link = (c: LineageInputCheck) => (c.kind === "record" ? `${app}/evidence/${c.id}` : `${app}/exploration/${c.kind}s/${c.id}`);
  return (
    <div id="built-from">
      <Group title="Built from" count={l.input_checks.length}>
        <p className="source-built">
          <StatusBadge tone={l.stale ? "attention" : "positive"}>{l.stale ? `${moved.length} changed since` : "Up to date"}</StatusBadge>
        </p>
        <p className="source-inspector-note">
          Built by {attribution(l.registered_by)} on {formatDate(l.registered_at)} from {describeInputs(l.input_checks)}.
        </p>
        {l.query_spec?.description ? <p className="source-inspector-note source-built-how">{l.query_spec.description}</p> : null}
        {moved.length ? (
          <ul className="source-cited">
            {moved.map((c, i) => {
              const name = names[i]?.data;
              const gone = c.status === "deleted" || c.status === "missing";
              const glyph: GlyphName = c.kind === "record" ? "file-text" : "scale";
              const label = name ?? `${INPUT_NOUN[c.kind][0][0]!.toUpperCase()}${INPUT_NOUN[c.kind][0].slice(1)} ${c.id}`;
              return (
                <li key={`${c.kind}:${c.id}`}>
                  <Glyph name={glyph} size="sm" />
                  <span className="source-cited-main">
                    {gone ? (
                      <span className="ellipsis" title={label}>
                        {label}
                      </span>
                    ) : (
                      <Link to={link(c)} className="ellipsis" title={label}>
                        {label}
                      </Link>
                    )}
                    <span className="faint">{inputChange(c)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Group>
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

function SourceActions({ record: r, onDialog }: { record: SourceRecord; onDialog: (d: "edit" | "delete" | "files") => void }) {
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
  const { api: base, app, canWrite } = useProduct();
  const archive = useArchive(r);
  const cited = useQuery({
    queryKey: ["used-by", base, r.record_id],
    queryFn: () => api<CitedIn>("GET", `${base}/sources/${r.record_id}/used-by`),
  });
  const versions = r.files.reduce((n, f) => n + Math.max(1, f.versions.length), 0);
  const c = cited.data;
  const citedCount = c ? c.assumptions.length + c.related.length + (c.story_pages?.length ?? 0) + (c.mockups?.length ?? 0) : undefined;
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
              { label: "Participants", value: r.participants.length ? r.participants.join(", ") : null },
              { label: "Provenance", value: r.provenance_depth !== "unknown" ? PROVENANCE_LABEL[r.provenance_depth] : null },
              { label: "Came from", value: r.source_system },
            ]}
          />
        </Group>
        {r.has_lineage ? <BuiltFrom recordId={r.record_id} /> : null}
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
            <EmptyState size="inline">No files yet.</EmptyState>
          )}
          {versions > r.files.length ? <p className="source-inspector-note">{plural(versions, "stored version")} in all.</p> : null}
        </Group>
        <Group title="Cited in" count={citedCount}>
          {cited.isPending ? (
            <Loading variant="lines" lines={2} label="Loading where it’s cited…" />
          ) : cited.isError ? (
            <ErrorCallout inset error={cited.error} onRetry={() => cited.refetch()} />
          ) : !citedCount ? (
            <EmptyState size="inline">Not cited yet.</EmptyState>
          ) : (
            <ul className="source-cited">
              {c!.assumptions.map((e) => (
                <li key={e.id}>
                  <Glyph name="scale" size="sm" />
                  <span className="source-cited-main">
                    <Link to={`${app}/exploration/assumptions/${e.id}`} className="ellipsis" title={e.statement}>
                      {e.statement}
                    </Link>
                    <span className="faint">
                      Assumption, {REVIEW_STATUS[e.status]?.label.toLowerCase() ?? e.status}
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
              {(c!.mockups ?? []).map((m) => (
                <li key={m.mockup_id}>
                  <Glyph name="monitor" size="sm" />
                  <span className="source-cited-main">
                    <Link to={`${app}/exploration/mockups/${m.mockup_id}`} className="ellipsis" title={m.title}>
                      {m.title}
                    </Link>
                    <span className="faint">
                      <span title={`Version ${m.version}, the mockup’s current version`}>Mockup, current version</span>
                      {m.citations.length ? "" : " · lists it"}
                      {m.citations.map((x, i) => (
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
              {c!.related.map((x) => (
                <li key={x.record_id}>
                  <Glyph name="file-text" size="sm" />
                  <span className="source-cited-main">
                    <Link to={`${app}/evidence/${x.record_id}`} className="ellipsis" title={x.title}>
                      {x.title}
                    </Link>
                    <span className="faint">{x.tags.length ? `${x.tags.slice(0, 2).join(", ")} · ` : ""}Lists it as related</span>
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
                      <span title={`Version ${p.version}, the page’s current version`}>Story page, current version</span>
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
      {outline || notes || showFileOutline ? (
        <Sheet labelledBy="agent-notes-h">
          <SheetHeader id="agent-notes-h" title={outline || showFileOutline ? (notes ? "Outline and notes" : "Outline") : "Notes"} />
          {outline ? <AgentNoteBlock title="Outline" note={outline} /> : null}
          {showFileOutline ? (
            <section className="source-agent-note">
              <h3>From the file&rsquo;s headings</h3>
              <FileOutline outline={fileOutline!} />
            </section>
          ) : null}
          {notes ? <AgentNoteBlock title="Notes" note={notes} /> : null}
        </Sheet>
      ) : null}
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
          <EmptyState size="inline" title="No comments yet">
            {writable ? "Select passages in Passages and choose Comment." : null}
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
    <Sheet labelledBy="files-h">
      <SheetHeader
        id="files-h"
        title="Files"
        count={record.files.length}
        end={
          onAdd ? (
            <Button size="sm" icon="upload" onClick={onAdd}>
              Add files
            </Button>
          ) : undefined
        }
      />
      {!record.files.length ? (
        <EmptyState size="inline" title="No files yet" action={onAdd ? <Button size="sm" onClick={onAdd}>Add files</Button> : undefined}>
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
    participants: record.participants.join(", "),
    source_system: record.source_system ?? "",
    provenance_depth: record.provenance_depth,
  });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      api<{ changed: string[] }>("PATCH", `${base}/sources/${record.record_id}`, {
        expected_etag: record.etag,
        title: f.title,
        date: f.date || null,
        tags: splitTags(f.tags),
        participants: list(f.participants),
        source_system: f.source_system || null,
        provenance_depth: f.provenance_depth,
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

interface StoryVersionCiting {
  page_id: string;
  title: string;
  version: number;
  count: number;
  is_current: boolean;
}

/** Story versions that cite a source, grouped by page in the order the server lists them. */
function byStoryPage(versions: StoryVersionCiting[]): { page_id: string; title: string; versions: StoryVersionCiting[] }[] {
  const pages = new Map<string, { page_id: string; title: string; versions: StoryVersionCiting[] }>();
  for (const v of versions) {
    const p = pages.get(v.page_id) ?? { page_id: v.page_id, title: v.title, versions: [] };
    p.versions.push(v);
    pages.set(v.page_id, p);
  }
  return [...pages.values()];
}

/** "Current version and 2 earlier", "Current version" or "2 earlier versions, not the current one". */
function storyVersionWords(versions: StoryVersionCiting[]): string {
  const current = versions.some((v) => v.is_current);
  const earlier = versions.filter((v) => !v.is_current).length;
  if (current) return earlier ? `Current version and ${earlier} earlier` : "Current version";
  return `${plural(earlier, "earlier version")}, not the current one`;
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
        citations: { id: string; statement: string; count: number }[];
        related_sources: { record_id: string; title: string }[];
        story_pages_citing?: { page_id: string; title: string; version: number; count: number }[];
        story_versions_citing?: StoryVersionCiting[];
        mockup_versions_citing?: { mockup_id: string; title: string; version: number; count: number; is_current: boolean }[];
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
  const pages = i?.story_pages_citing ?? [];
  const versions = i?.story_versions_citing ?? [];
  const storyPages = byStoryPage(versions);
  const mockupVersions = i?.mockup_versions_citing ?? [];
  const mockups = new Set(mockupVersions.map((v) => v.mockup_id)).size;
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
          {i.citations.length ? (
            <p>
              <strong>
                {plural(i.citations.reduce((n, c) => n + c.count, 0), "citation")} in {plural(i.citations.length, "assumption")}
              </strong>{" "}
              will point at a record of the deletion. Their quotes are kept.
            </p>
          ) : null}
          {storyPages.length ? (
            <>
              <p>
                <strong>
                  {plural(versions.length, "Story version")} on {plural(storyPages.length, "page")} cite it
                </strong>
                {versions.some((v) => !v.is_current) ? ", earlier versions included" : ""}. Their quotes are kept, and each will say the source
                was deleted.
              </p>
              <ul className="source-impact-list">
                {storyPages.map((p) => (
                  <li key={p.page_id}>
                    {p.title} <span className="faint">· {storyVersionWords(p.versions)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : pages.length ? (
            <p>{plural(pages.length, "Story page")} cite it; their quotes are kept.</p>
          ) : null}
          {mockups ? (
            <p>
              <strong>
                {plural(mockupVersions.length, "mockup version")} of {plural(mockups, "mockup")} cite it
              </strong>
              {mockupVersions.some((v) => !v.is_current) ? ", earlier versions included" : ""}. Their quotes are kept, and each will say the source was
              deleted.
            </p>
          ) : null}
          {i.related_sources.length ? <p>{plural(i.related_sources.length, "other source")} list it as related, and those links will stop opening.</p> : null}
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
    const allDone = await uploadFiles(base, record.record_id, items, (i, patch) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x))));
    setRunning(false);
    await qc.invalidateQueries({ queryKey: key });
    if (allDone) {
      toast(items.length === 1 ? "File added." : "Files added.");
      onClose();
    }
  };
  const failed = items.filter((i) => i.state === "failed").length;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!running}
      title="Add files"
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
