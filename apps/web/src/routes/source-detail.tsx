import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, formatBytes, formatDate, formatDuration, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus, PROVENANCE_LABEL, REVIEW_STATUS, ROLE_LABEL } from "../lib/status.ts";
import type { FileEntry, RecordFull } from "../lib/types.ts";
import { IconMore } from "../ui/icons.tsx";
import { Badge, Button, Callout, Dialog, EmptyState, ErrorCallout, Loading, Menu, MenuItem, MenuSeparator, PageHeader, SelectField, Tabs, TextArea, TextField, useToast } from "../ui/index.tsx";
import { NoteForm, PassageReader } from "./passages.tsx";
import { uploadFiles } from "./source-new.tsx";
import { useKinds } from "./sources.tsx";

export function SourceDetailPage() {
  const { recordId = "" } = useParams();
  const { api: base, app, canWrite } = useProduct();
  const [params] = useSearchParams();
  const q = useQuery({
    queryKey: ["source", base, recordId],
    queryFn: () => api<RecordFull>("GET", `${base}/sources/${recordId}?detail=full`),
    refetchInterval: (query) => (query.state.data?.derived_status === "pending" ? 2000 : false),
  });
  const [dialog, setDialog] = useState<"edit" | "delete" | "files" | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const archive = useMutation({
    mutationFn: (restore: boolean) => api("POST", `${base}/sources/${restore ? "restore" : "archive"}`, { record_ids: [recordId] }),
    onSuccess: (_, restore) => {
      void qc.invalidateQueries({ queryKey: ["source", base, recordId] });
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      toast(restore ? "Restored. It is back in lists and search." : "Archived. It is out of lists and search, including your agents'. Nothing was erased.", restore ? {} : { action: { label: "Undo", onClick: () => archive.mutate(true) } });
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) {
    const e = q.error as ApiError;
    if (e.status === 410) {
      const t = (e.details?.["tombstone"] ?? {}) as { title?: string; deleted_at?: string; reason?: string; deleted_by?: { display_name: string } };
      return <EmptyState title="This source was deleted">{`${t.title ?? "It"} was deleted permanently by ${t.deleted_by?.display_name ?? "someone"} on ${formatDate(t.deleted_at)}. Reason: ${t.reason ?? "not given"}. Quotes cited from it are kept on their assumptions and decisions.`}</EmptyState>;
    }
    return <ErrorCallout title="This source could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  }
  const r = q.data;
  const status = derivedStatus(r.derived_status);
  const tab = params.get("tab") ?? (params.get("seq") !== null || r.derived_status === "ready" ? "passages" : "files");
  const t = (id: string) => `?tab=${id}`;
  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={[{ label: "Sources", to: `${app}/sources` }, { label: r.title }]}
        title={r.title}
        description={[r.kind_label, r.organization, r.date ? formatDate(r.date) : null].filter(Boolean).join(" · ")}
        actions={
          canWrite ? (
            <>
              {r.archived_at ? (
                <Button onClick={() => archive.mutate(true)} busy={archive.isPending} busyLabel="Restoring…">
                  Restore
                </Button>
              ) : (
                <Button onClick={() => setDialog("edit")}>Edit details</Button>
              )}
              <Menu label="More actions" trigger={<IconMore />}>
                {!r.archived_at ? <MenuItem onSelect={() => setDialog("files")}>Add files</MenuItem> : null}
                {!r.archived_at ? <MenuItem onSelect={() => archive.mutate(false)}>Archive</MenuItem> : null}
                <MenuSeparator />
                <MenuItem tone="danger" onSelect={() => setDialog("delete")}>
                  Delete permanently…
                </MenuItem>
              </Menu>
            </>
          ) : null
        }
      />
      {r.archived_at ? (
        <Callout tone="warning" title="This source is archived">
          Its files and passages stay stored and citable, but lists and search — including your agents' — leave it out until it is restored.
        </Callout>
      ) : null}
      {r.derived_status !== "ready" ? (
        <Callout tone={status.tone === "danger" ? "danger" : status.tone === "warning" ? "warning" : "info"} title={status.label}>
          {status.explain} {r.status_detail ? <span className="muted">({r.status_detail})</span> : null} {status.next ?? ""}
        </Callout>
      ) : null}
      <div className="detail-layout">
        <div className="detail-main">
          <Tabs
            label="Source views"
            current={tab}
            items={[
              ...(r.segment_count ? [{ id: "passages", label: `Passages (${r.segment_count})`, to: t("passages") }] : []),
              { id: "preview", label: "Preview", to: t("preview") },
              { id: "files", label: `Files (${r.file_count})`, to: t("files") },
              { id: "connected", label: "Insights", to: t("connected") },
              { id: "notes", label: `Notes (${r.annotation_count})`, to: t("notes") },
            ]}
          />
          {tab === "passages" ? <PassageReader record={r} /> : null}
          {tab === "preview" ? <FilePreview record={r} /> : null}
          {tab === "files" ? <FilesTab record={r} onAdd={() => setDialog("files")} /> : null}
          {tab === "connected" ? <ConnectedTab recordId={r.record_id} /> : null}
          {tab === "notes" ? <NotesTab record={r} /> : null}
        </div>
        <aside className="detail-aside stack" aria-label="Details">
          <section className="stack-sm">
            <h2 className="aside-h">Passages</h2>
            <dl className="facts">
              <dt>Status</dt>
              <dd>
                <Badge tone={status.tone}>{status.label}</Badge>
              </dd>
              {r.derived_status === "ready" ? (
                <>
                  <dt>Segments</dt>
                  <dd className="num">{r.segment_count}</dd>
                  {r.duration_ms ? (
                    <>
                      <dt>Duration</dt>
                      <dd>{formatDuration(r.duration_ms)}</dd>
                    </>
                  ) : null}
                  <dt>Parsed by</dt>
                  <dd>
                    {r.manifest?.parser} {r.manifest?.parser_version} — no AI
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          <section className="stack-sm">
            <h2 className="aside-h">About</h2>
            <dl className="facts">
              <dt>Kind</dt>
              <dd>{r.kind_label}</dd>
              <dt>Date</dt>
              <dd>{formatDate(r.date)}</dd>
              <dt>Organization</dt>
              <dd>{r.organization ?? "—"}</dd>
              {r.participants.length ? (
                <>
                  <dt>Participants</dt>
                  <dd>{r.participants.join(", ")}</dd>
                </>
              ) : null}
              {r.source_system ? (
                <>
                  <dt>From</dt>
                  <dd>{r.source_system}</dd>
                </>
              ) : null}
              {r.tags.length ? (
                <>
                  <dt>Tags</dt>
                  <dd className="row">{r.tags.map((x) => <Badge key={x}>{x}</Badge>)}</dd>
                </>
              ) : null}
              <dt>Relationship</dt>
              <dd>{PROVENANCE_LABEL[r.provenance_depth] ?? r.provenance_depth}</dd>
              <dt>Filed under</dt>
              <dd>{r.folder_label}</dd>
              <dt>Added</dt>
              <dd>
                {attribution(r.uploaded_by)}, {relativeTime(r.uploaded_at)}
              </dd>
              <dt>Source id</dt>
              <dd>
                <code className="small">{r.record_id}</code>
              </dd>
            </dl>
          </section>
          {r.outline ? (
            <details className="stack-sm" open={r.segment_count > 0}>
              <summary className="aside-h">Outline</summary>
              <Markdown source={r.outline} className="prose small-prose outline" headingShift={3} />
            </details>
          ) : null}
        </aside>
      </div>
      {dialog === "edit" ? <EditDetails record={r} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteSource record={r} onClose={() => setDialog(null)} /> : null}
      {dialog === "files" ? <AddFiles record={r} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function fileUrl(base: string, recordId: string, path: string, download = false) {
  return `${base}/sources/${recordId}/file${qs({ path, download: download ? "1" : "" })}`;
}

function FilesTab({ record, onAdd }: { record: RecordFull; onAdd: () => void }) {
  const { api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const setRole = useMutation({
    mutationFn: ({ path, role }: { path: string; role: string }) => api("POST", `${base}/sources/${record.record_id}/files/role`, { path, role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] }),
    onError: (e) => toast((e as Error).message, { tone: "danger" }),
  });
  return (
    <div className="stack">
      <p className="small muted">{record.search_rule}</p>
      {!record.files.length ? (
        <EmptyState title="No files" action={canWrite && !record.archived_at ? <Button onClick={onAdd}>Add files</Button> : null}>
          This source holds metadata only.
          {record.pending_primary_path ? ` An upload of ${record.pending_primary_path} is in progress.` : ""}
        </EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Role</th>
              <th scope="col">Search</th>
              <th scope="col" className="hide-narrow">Size</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {record.files.map((f) => (
              <tr key={f.path}>
                <td>
                  <span className="row-title">{f.path}</span>
                  {f.derived_from.length ? <div className="small muted">Digest of {f.derived_from.join(" and ")}</div> : null}
                  {f.versions.length > 1 ? <div className="small faint">{f.versions.length} versions</div> : null}
                </td>
                <td>
                  {canWrite && f.role !== "primary" && !record.archived_at ? (
                    <select className="input select" aria-label={`Role of ${f.path}`} value={f.role} onChange={(e) => setRole.mutate({ path: f.path, role: e.target.value })}>
                      <option value="origin">Origin</option>
                      <option value="supplement">Supplement</option>
                      {!record.files.some((x) => x.role === "primary") ? <option value="primary">Make primary</option> : null}
                    </select>
                  ) : (
                    ROLE_LABEL[f.role]
                  )}
                </td>
                <td>
                  <Badge tone={f.searchable ? "success" : "neutral"}>{f.searchable ? "Searched" : f.role === "primary" ? (f.search_status === "pending" ? "Searched once parsed" : "Not searched") : "Kept, not searched"}</Badge>
                </td>
                <td className="hide-narrow num small">{formatBytes(f.size)}</td>
                <td>
                  <a href={fileUrl(base, record.record_id, f.path, true)} className="small">
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canWrite && !record.archived_at && record.files.length ? (
        <div>
          <Button onClick={onAdd}>Add files</Button>
        </div>
      ) : null}
    </div>
  );
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

function FilePreview({ record }: { record: RecordFull }) {
  const { api: base } = useProduct();
  const [path, setPath] = useState(record.files.find((f) => f.role === "primary")?.path ?? record.files[0]?.path ?? "");
  const f = record.files.find((x) => x.path === path);
  const kind = f ? previewKind(f) : "download";
  const tooBig = (f?.size ?? 0) > 4 * 1024 * 1024 && ["html", "markdown", "text"].includes(kind);
  const text = useQuery({
    queryKey: ["file-text", base, record.record_id, path],
    queryFn: async () => (await fetch(fileUrl(base, record.record_id, path))).text(),
    enabled: Boolean(f) && !tooBig && ["html", "markdown", "text"].includes(kind),
  });
  if (!f) return <EmptyState title="No file on this source yet" />;
  const url = fileUrl(base, record.record_id, path);
  return (
    <div className="stack">
      <div className="row-between">
        {record.files.length > 1 ? (
          <SelectField label="Preview file" value={path} onChange={(e) => setPath(e.target.value)}>
            {record.files.map((x) => (
              <option key={x.path} value={x.path}>
                {x.path} ({ROLE_LABEL[x.role]?.toLowerCase()})
              </option>
            ))}
          </SelectField>
        ) : (
          <span className="small muted">
            {f.path} · {f.media_type} · {formatBytes(f.size)}
          </span>
        )}
        <a className="btn btn-secondary btn-sm" href={fileUrl(base, record.record_id, path, true)}>
          Download
        </a>
      </div>
      {tooBig || kind === "download" ? (
        <EmptyState title="No preview for this format" action={<a className="btn btn-secondary btn-md" href={fileUrl(base, record.record_id, path, true)}>Download {formatBytes(f.size)}</a>} />
      ) : kind === "pdf" ? (
        <iframe title={f.path} src={url} className="preview-frame" />
      ) : kind === "audio" ? (
        <audio controls preload="metadata" src={url} style={{ width: "100%" }} />
      ) : kind === "video" ? (
        <video controls preload="metadata" src={url} style={{ width: "100%" }} />
      ) : kind === "image" ? (
        <img src={url} alt={f.path} className="preview-image" />
      ) : text.isPending ? (
        <Loading label="Loading text…" />
      ) : text.isError ? (
        <ErrorCallout title="The file could not be read" error={text.error} onRetry={() => text.refetch()} />
      ) : kind === "markdown" ? (
        <div className="card">
          <Markdown source={text.data ?? ""} />
        </div>
      ) : kind === "html" ? (
        <iframe title={f.path} sandbox="" referrerPolicy="no-referrer" srcDoc={text.data} className="preview-frame" />
      ) : (
        <pre className="preview-text">{text.data}</pre>
      )}
    </div>
  );
}

function ConnectedTab({ recordId }: { recordId: string }) {
  const { api: base, app } = useProduct();
  const q = useQuery({
    queryKey: ["insights-for", base, recordId],
    queryFn: () =>
      api<{
        insights: { insight_id: string; title: string; summary: string; status: string; updated_at: string }[];
        assumptions: { id: string; statement: string; status: string; citations: { seq_start: number; seq_end: number }[] }[];
        decisions: { id: string; statement: string; status: string; citations: { seq_start: number; seq_end: number }[] }[];
      }>("GET", `${base}/sources/${recordId}/insights`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorCallout error={q.error} onRetry={() => q.refetch()} />;
  const { insights, assumptions, decisions } = q.data;
  if (!insights.length && !assumptions.length && !decisions.length)
    return <EmptyState title="Nothing is built on this source yet">Insights that reference it, and assumptions and decisions that cite its passages, appear here.</EmptyState>;
  const entries = (kind: "assumptions" | "decisions", list: typeof assumptions) =>
    list.length ? (
      <section className="stack-sm">
        <h3>{kind === "assumptions" ? "Assumptions citing it" : "Decisions citing it"}</h3>
        <ul className="plain-list">
          {list.map((e) => (
            <li key={e.id} className="stack-sm">
              <Link to={`${app}/insights/${kind}/${e.id}`}>{e.statement}</Link>
              <div className="row small">
                <Badge tone={REVIEW_STATUS[e.status]?.tone}>{REVIEW_STATUS[e.status]?.label}</Badge>
                {e.citations.map((c, i) => (
                  <Link key={i} to={`?tab=passages&seq=${c.seq_start}`}>
                    {c.seq_start === c.seq_end ? `segment ${c.seq_start}` : `segments ${c.seq_start}–${c.seq_end}`}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  return (
    <div className="stack">
      {insights.length ? (
        <section className="stack-sm">
          <h3>Insights referencing it</h3>
          <ul className="plain-list">
            {insights.map((i) => (
              <li key={i.insight_id}>
                <Link to={`${app}/insights/${i.insight_id}`}>{i.title}</Link> <span className="small muted">· updated {relativeTime(i.updated_at)}</span>
                {i.summary ? <p className="small muted">{i.summary}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {entries("assumptions", assumptions)}
      {entries("decisions", decisions)}
    </div>
  );
}

function NotesTab({ record }: { record: RecordFull }) {
  const { canWrite } = useProduct();
  const [writing, setWriting] = useState(false);
  return (
    <div className="stack">
      {canWrite && !record.archived_at ? (
        writing ? (
          <NoteForm recordId={record.record_id} onDone={() => setWriting(false)} />
        ) : (
          <p className="small muted">
            To note an exact passage, select segments in Passages and choose Write a note.{" "}
            <Button size="sm" variant="quiet" onClick={() => setWriting(true)}>
              Write a general note
            </Button>
          </p>
        )
      ) : null}
      {!record.annotations.length ? (
        <EmptyState title="No notes yet" />
      ) : (
        <ul className="plain-list">
          {record.annotations.map((a) => (
            <li key={a.annotation_id} className="note">
              <div className="row small muted">
                <strong className="note-author">{attribution(a.created_by)}</strong>
                <time dateTime={a.created_at}>{relativeTime(a.created_at)}</time>
                {a.seq_start !== null ? <Link to={`?tab=passages&seq=${a.seq_start}`}>{a.seq_start === a.seq_end ? `segment ${a.seq_start}` : `segments ${a.seq_start}–${a.seq_end}`}</Link> : null}
                {a.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
              <Markdown source={a.note} className="prose small-prose" headingShift={3} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditDetails({ record, onClose }: { record: RecordFull; onClose: () => void }) {
  const { api: base } = useProduct();
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
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
      toast(r.changed.length ? `Saved. Filed under ${r.folder_label}; its id, passages and citations are unchanged.` : "Nothing changed.");
      onClose();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit details"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <p className="small muted">Fix mistakes here. The source keeps its id, so every passage address and citation still resolves.</p>
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
      <TextField label="Participants" value={f.participants} onChange={set("participants")} optional />
      <TextField label="Where it came from" value={f.source_system} onChange={set("source_system")} optional />
      <SelectField label="Relationship to the evidence" value={f.provenance_depth} onChange={set("provenance_depth")}>
        {Object.entries(PROVENANCE_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      {save.error instanceof ApiError && save.error.code === "stale_etag" ? (
        <Callout tone="warning" title="Someone changed this source while you were editing">
          Your changes are still here. Close, reopen to load their version, and apply yours again.
        </Callout>
      ) : save.isError ? (
        <ErrorCallout error={save.error} />
      ) : null}
    </Dialog>
  );
}

function DeleteSource({ record, onClose }: { record: RecordFull; onClose: () => void }) {
  const { api: base, app } = useProduct();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const impact = useQuery({
    queryKey: ["delete-impact", base, record.record_id],
    queryFn: () =>
      api<{ etag: string; file_versions: number; bytes: number; derivations: number; annotations: number; citations: { id: string; kind: string; statement: string; count: number }[]; insights_referencing: { id: string; title: string }[] }>(
        "GET",
        `${base}/sources/${record.record_id}/delete-impact`,
      ),
  });
  const archive = useMutation({
    mutationFn: () => api("POST", `${base}/sources/archive`, { record_ids: [record.record_id] }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
      toast("Archived instead. Nothing was erased.");
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => api("DELETE", `${base}/sources/${record.record_id}`, { expected_etag: impact.data!.etag, reason, confirm: "delete permanently" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", base] });
      toast(`Deleted “${record.title}” permanently. The activity log records who, when and why.`);
      navigate(`${app}/sources`);
    },
  });
  const i = impact.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete permanently. This cannot be undone."
      dismissable={!del.isPending}
      footer={
        <>
          <Button onClick={() => archive.mutate()} busy={archive.isPending} busyLabel="Archiving…">
            Archive instead
          </Button>
          <Button variant="danger" disabled={!i || !reason.trim() || typed !== record.title} busy={del.isPending} busyLabel="Deleting…" onClick={() => del.mutate()}>
            Delete permanently
          </Button>
        </>
      }
    >
      {impact.isPending ? (
        <Loading />
      ) : impact.isError ? (
        <ErrorCallout error={impact.error} />
      ) : i ? (
        <div className="stack-sm">
          <p>
            This destroys {i.file_versions} stored file{i.file_versions === 1 ? "" : "s"} ({formatBytes(i.bytes)}), {i.derivations} parse{i.derivations === 1 ? "" : "s"} and {i.annotations} note{i.annotations === 1 ? "" : "s"}.
          </p>
          {i.citations.length ? (
            <p>
              <strong>
                {i.citations.reduce((n, c) => n + c.count, 0)} citation{i.citations.length === 1 ? "" : "s"} in {i.citations.length} {i.citations.length === 1 ? "entry" : "entries"} point at this source
              </strong>{" "}
              and will point at a record of the deletion instead. Their quoted text is kept.
            </p>
          ) : null}
          {i.insights_referencing.length ? <p>{i.insights_referencing.length} insight(s) reference it and will keep a dead reference.</p> : null}
          <p className="small muted">Archiving takes it out of lists and search and erases nothing.</p>
        </div>
      ) : null}
      <TextArea label="Why is it being deleted?" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded with the deletion." />
      <TextField label={`Type the title to confirm: ${record.title}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      {del.isError ? <ErrorCallout error={del.error} /> : null}
    </Dialog>
  );
}

function AddFiles({ record, onClose }: { record: RecordFull; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const hasPrimary = record.files.some((f) => f.role === "primary");
  const [role, setRole] = useState<"primary" | "origin" | "supplement">(hasPrimary ? "supplement" : "primary");
  const [items, setItems] = useState<{ file: File; role: "primary" | "origin" | "supplement"; state: "waiting" | "uploading" | "done" | "failed"; loaded: number; error?: string }[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => setItems((all) => all.map((i) => (i.state === "done" ? i : { ...i, role }))), [role]);
  const run = async () => {
    setRunning(true);
    await uploadFiles(base, record.record_id, items, (i, patch) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x))));
    setRunning(false);
    await qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
    setItems((all) => {
      if (all.every((i) => i.state === "done")) {
        toast("Files added.");
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
      title="Add files to this source"
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
      <fieldset className="stack-sm">
        <legend className="field-label">What are you adding?</legend>
        {!hasPrimary ? (
          <label className="check">
            <input type="radio" name="role" checked={role === "primary"} onChange={() => setRole("primary")} /> The primary file (parsed and searched)
          </label>
        ) : null}
        <label className="check">
          <input type="radio" name="role" checked={role === "origin"} onChange={() => setRole("origin")} /> Origin files (the full originals behind a digest; kept, not searched)
        </label>
        <label className="check">
          <input type="radio" name="role" checked={role === "supplement"} onChange={() => setRole("supplement")} /> Supplements (kept, not searched)
        </label>
      </fieldset>
      {record.pending_primary_path && !hasPrimary ? <Callout tone="info">An upload of {record.pending_primary_path} as the primary is in progress; name your file the same to finish it.</Callout> : null}
      <input type="file" multiple={role !== "primary"} aria-label="Files" onChange={(e) => setItems([...(e.target.files ?? [])].map((file) => ({ file, role, state: "waiting" as const, loaded: 0 })))} />
      <ul className="upload-list">
        {items.map((i) => (
          <li key={i.file.name} className="file-row">
            <span className="grow">
              {i.file.name} <span className="small muted">· {formatBytes(i.file.size)}</span>
              {i.error ? <div className="small" style={{ color: "var(--danger)" }}>{i.error}</div> : null}
            </span>
            <Badge tone={i.state === "done" ? "success" : i.state === "failed" ? "danger" : "neutral"}>{i.state === "uploading" ? `${Math.round((i.loaded / Math.max(1, i.file.size)) * 100)}%` : i.state}</Badge>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

