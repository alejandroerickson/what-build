import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import type { Insight, InsightSummary, RecordSummary, Refs } from "../lib/types.ts";
import { Badge, Button, ButtonLink, Callout, Dialog, EmptyState, ErrorCallout, Loading, PageHeader, SelectField, TextArea, TextField, useToast } from "../ui/index.tsx";

const STATUS_LABEL = { draft: "Working draft", published: "Published", archived: "Archived" } as const;

export function InsightsPage() {
  const { api: base, app, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const objective = params.get("objective_id") ?? "";
  const status = params.get("status") ?? "";
  const query = params.get("query") ?? "";
  const [text, setText] = useState(query);
  const objectives = useQuery({ queryKey: ["objectives", base, ""], queryFn: () => api<{ items: { objective_id: string; title: string }[] }>("GET", `${base}/objectives`) });
  const q = useInfiniteQuery({
    queryKey: ["insights", base, objective, status, query],
    queryFn: ({ pageParam }) => api<{ items: InsightSummary[]; next_cursor: string | null }>("GET", `${base}/insights${qs({ objective_id: objective, status, query, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.next_cursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const objTitle = objectives.data?.items.find((o) => o.objective_id === objective)?.title;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Insights"
        description="The thinking behind what we know, assume and decide — readable documents that point back to the evidence."
        actions={canWrite ? <ButtonLink to={`${app}/insights/new${objective ? `?objective_id=${objective}` : ""}`} variant="primary">Write an insight</ButtonLink> : null}
      />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          const n = new URLSearchParams(params);
          (text ? n.set("query", text) : n.delete("query"));
          setParams(n);
        }}
      >
        <TextField label="Find an insight" type="search" value={text} onChange={(e) => setText(e.target.value)} />
        <SelectField label="Show" value={status} onChange={(e) => {
          const n = new URLSearchParams(params);
          (e.target.value ? n.set("status", e.target.value) : n.delete("status"));
          setParams(n);
        }}>
          <option value="">Drafts and published</option>
          <option value="published">Published</option>
          <option value="draft">Working drafts</option>
          <option value="archived">Archived</option>
        </SelectField>
      </form>
      {objective ? (
        <Callout tone="info" action={<Button size="sm" onClick={() => setParams({})}>Show all insights</Button>}>
          Showing insights connected to <strong>{objTitle ?? "one objective"}</strong>.
        </Callout>
      ) : null}
      {q.isPending ? (
        <Loading lines={6} />
      ) : q.isError ? (
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      ) : !items.length ? (
        objective || status || query ? (
          <EmptyState title="No insights match this view" action={<Button onClick={() => setParams({})}>Show all insights</Button>} />
        ) : (
          <EmptyState title="No insights yet" action={canWrite ? <ButtonLink to={`${app}/insights/new`} variant="primary">Write an insight</ButtonLink> : null}>
            An insight brings several sources together into one readable argument. Ask your connected agent to draft one from the evidence, or write it yourself.
          </EmptyState>
        )
      ) : (
        <ul className="plain-list insight-list">
          {items.map((i) => (
            <li key={i.insight_id} className="card stack-sm">
              <div className="row-between">
                <Link to={`${app}/insights/${i.insight_id}`} className="row-title">
                  <h3>{i.title}</h3>
                </Link>
                <Badge tone={i.status === "published" ? "success" : "neutral"}>{STATUS_LABEL[i.status]}</Badge>
              </div>
              {i.summary ? <p className="muted">{i.summary}</p> : null}
              <p className="small faint">
                {attribution(i.updated_by)} · {relativeTime(i.updated_at)} · {i.refs.sources.length} source{i.refs.sources.length === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage ? <Button onClick={() => q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading…">More insights</Button> : null}
    </div>
  );
}

function RefList({ label, ids, to, titles }: { label: string; ids: string[]; to: (id: string) => string; titles: Record<string, string | undefined> }) {
  if (!ids.length) return null;
  return (
    <section className="stack-sm">
      <h3 className="aside-h">{label}</h3>
      <ul className="plain-list small">
        {ids.map((id, n) => (
          <li key={id}>
            <Link to={to(id)}>{titles[id] ?? `${label.replace(/s$/, "")} ${n + 1}`}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useTitles(refs: Refs | undefined) {
  const { api: base } = useProduct();
  return useQuery({
    queryKey: ["ref-titles", base, refs],
    enabled: Boolean(refs),
    queryFn: async () => {
      const out: Record<string, string> = {};
      const load = async (ids: string[], path: (id: string) => string, pick: (r: Record<string, string>) => string) => {
        await Promise.all(
          ids.map(async (id) => {
            try {
              out[id] = pick(await api<Record<string, string>>("GET", `${base}/${path(id)}`));
            } catch {
              // A reference that no longer resolves keeps its placeholder.
            }
          }),
        );
      };
      await load(refs!.sources, (id) => `sources/${id}`, (r) => r["title"]!);
      await load(refs!.insights, (id) => `insights/${id}?limit=1`, (r) => r["title"]!);
      await load(refs!.assumptions, (id) => `assumptions/${id}`, (r) => r["statement"]!);
      await load(refs!.decisions, (id) => `decisions/${id}`, (r) => r["statement"]!);
      await load(refs!.objectives, (id) => `objectives/${id}`, (r) => r["title"]!);
      return out;
    },
  });
}

export function InsightPage() {
  const { insightId = "" } = useParams();
  const { api: base, app, canWrite } = useProduct();
  const [history, setHistory] = useState(false);
  const q = useQuery({ queryKey: ["insight", base, insightId], queryFn: () => api<Insight>("GET", `${base}/insights/${insightId}?limit=100000`) });
  const titles = useTitles(q.data?.refs);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorCallout error={q.error} onRetry={() => q.refetch()} />;
  const i = q.data;
  const t = titles.data ?? {};
  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={[{ label: "Insights", to: `${app}/insights` }, { label: i.title }]}
        title={i.title}
        description={
          <span className="row">
            <Badge tone={i.status === "published" ? "success" : "neutral"}>{STATUS_LABEL[i.status]}</Badge>
            <span>
              Revision {i.revision} · {attribution(i.updated_by)}, {relativeTime(i.updated_at)}
            </span>
          </span>
        }
        actions={
          <>
            {i.revision > 1 ? <Button onClick={() => setHistory(true)}>History</Button> : null}
            {canWrite ? <ButtonLink to={`${app}/insights/${i.insight_id}/edit`}>Edit</ButtonLink> : null}
          </>
        }
      />
      <div className="detail-layout">
        <article className="detail-main stack">
          {i.summary ? <p className="lead">{i.summary}</p> : null}
          <Markdown source={i.body} />
        </article>
        <aside className="detail-aside stack" aria-label="Follow the thinking">
          <h2 className="aside-h">Follow the thinking</h2>
          <RefList label="Objectives" ids={i.refs.objectives} to={() => `${app}/objectives`} titles={t} />
          <RefList label="Sources" ids={i.refs.sources} to={(id) => `${app}/sources/${id}`} titles={t} />
          <RefList label="Related insights" ids={i.refs.insights} to={(id) => `${app}/insights/${id}`} titles={t} />
          <RefList label="Assumptions" ids={i.refs.assumptions} to={(id) => `${app}/insights/assumptions/${id}`} titles={t} />
          <RefList label="Decisions" ids={i.refs.decisions} to={(id) => `${app}/insights/decisions/${id}`} titles={t} />
          {!Object.values(i.refs).some((x) => x.length) ? <p className="small muted">No references yet.</p> : null}
        </aside>
      </div>
      {history ? <HistoryDialog tool="insights" id={i.insight_id} etag={i.etag} onClose={() => setHistory(false)} render={(c) => <Markdown source={String(c["body"] ?? "")} />} /> : null}
    </div>
  );
}

/** The same revision control wherever authored text can be overwritten. */
export function HistoryDialog({ tool, id, etag, onClose, render }: { tool: "insights" | "objectives"; id: string; etag: string; onClose: () => void; render: (content: Record<string, unknown>) => React.ReactNode }) {
  const { api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [n, setN] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["revisions", base, tool, id], queryFn: () => api<{ items: { n: number; written_at: string; written_by: never; replaced_at: string; replaced_by: never }[] }>("GET", `${base}/${tool}/${id}/revisions`) });
  const one = useQuery({ queryKey: ["revision", base, tool, id, n], enabled: n !== null, queryFn: () => api<{ content: Record<string, unknown> }>("GET", `${base}/${tool}/${id}/revisions/${n}`) });
  const restore = useMutation({
    mutationFn: () => api("POST", `${base}/${tool}/${id}/revisions/${n}/restore`, { [tool === "insights" ? "insight_id" : "objective_id"]: id, n, expected_etag: etag }),
    onSuccess: () => {
      toast("Restored as a new revision. The text it replaced is kept too.");
      void qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Earlier versions" wide>
      <p className="small muted">Every overwrite keeps the text it replaced. Restoring writes the old text as a new revision; nothing is rewound.</p>
      {list.isPending ? <Loading /> : list.isError ? <ErrorCallout error={list.error} /> : (
        <div className="history">
          <ul className="plain-list">
            {list.data.items.map((r) => (
              <li key={r.n}>
                <button type="button" className={`history-item ${n === r.n ? "active" : ""}`} onClick={() => setN(r.n)}>
                  <strong>Version written by {attribution(r.written_by)}</strong>
                  <span className="small muted">
                    {relativeTime(r.written_at)} · replaced by {attribution(r.replaced_by)} {relativeTime(r.replaced_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="history-view">
            {n === null ? <p className="muted">Choose a version to read it.</p> : one.isPending ? <Loading /> : one.data ? (
              <div className="stack">
                {one.data.content["title"] ? <h3>{String(one.data.content["title"])}</h3> : null}
                {render(one.data.content)}
                {canWrite ? (
                  <Button variant="primary" busy={restore.isPending} busyLabel="Restoring…" onClick={() => restore.mutate()}>
                    Restore this version
                  </Button>
                ) : null}
                {restore.isError ? <ErrorCallout error={restore.error} /> : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SourcePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { api: base } = useProduct();
  const [query, setQuery] = useState("");
  const q = useQuery({ queryKey: ["sources-pick", base, query], queryFn: () => api<{ records: RecordSummary[] }>("GET", `${base}/sources${qs({ query, limit: 100 })}`) });
  return (
    <fieldset className="picker">
      <legend className="field-label">Sources it draws on</legend>
      <input className="input" type="search" placeholder="Filter sources" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter sources" />
      <div className="picker-list">
        {q.data?.records.map((r) => (
          <label key={r.record_id} className="check">
            <input type="checkbox" checked={selected.includes(r.record_id)} onChange={(e) => onChange(e.target.checked ? [...selected, r.record_id] : selected.filter((x) => x !== r.record_id))} />
            {r.title}
          </label>
        ))}
      </div>
      <p className="small muted">{selected.length} selected</p>
    </fieldset>
  );
}

export function InsightEditPage() {
  const { insightId } = useParams();
  const [params] = useSearchParams();
  const { api: base, app } = useProduct();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["insight", base, insightId], enabled: Boolean(insightId), queryFn: () => api<Insight>("GET", `${base}/insights/${insightId}?limit=100000`) });
  const objectives = useQuery({ queryKey: ["objectives", base, ""], queryFn: () => api<{ items: { objective_id: string; title: string }[] }>("GET", `${base}/objectives`) });
  if (insightId && existing.isPending) return <Loading />;
  if (existing.isError) return <ErrorCallout error={existing.error} />;
  return <InsightForm key={insightId ?? "new"} initial={existing.data} objectives={objectives.data?.items ?? []} preselect={{ objective: params.get("objective_id"), source: params.get("source_id") }} onSaved={(id) => {
    void qc.invalidateQueries({ queryKey: ["insights", base] });
    void qc.invalidateQueries({ queryKey: ["insight", base, id] });
    navigate(`${app}/insights/${id}`);
  }} />;
}

function InsightForm({ initial, objectives, preselect, onSaved }: { initial?: Insight; objectives: { objective_id: string; title: string }[]; preselect: { objective: string | null; source: string | null }; onSaved: (id: string) => void }) {
  const { api: base, app } = useProduct();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [status, setStatus] = useState<"draft" | "published" | "archived">(initial?.status ?? "draft");
  const [objs, setObjs] = useState<string[]>(initial?.refs.objectives ?? (preselect.objective ? [preselect.objective] : []));
  const [sources, setSources] = useState<string[]>(initial?.refs.sources ?? (preselect.source ? [preselect.source] : []));
  const [preview, setPreview] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const refs = { objectives: objs, sources };
      if (initial) {
        await api("PATCH", `${base}/insights/${initial.insight_id}`, { expected_etag: initial.etag, title, summary, body, status, refs });
        return initial.insight_id;
      }
      const r = await api<{ insight_id: string }>("POST", `${base}/insights`, { title, summary, body, status: status === "archived" ? "draft" : status, refs });
      return r.insight_id;
    },
    onSuccess: onSaved,
  });
  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader crumbs={[{ label: "Insights", to: `${app}/insights` }, { label: initial ? "Edit" : "New insight" }]} title={initial ? "Edit insight" : "Write an insight"} description="One readable argument across sources. Cite passages in the text — source id and segment numbers — so anyone can check them." />
      <TextField label="Title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea label="Summary" optional hint="One or two sentences shown in lists." maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div className="stack-sm">
        <div className="row-between">
          <span className="field-label">The insight</span>
          <Button size="sm" variant="quiet" aria-expanded={preview} onClick={() => setPreview(!preview)}>
            {preview ? "Edit text" : "Preview formatting"}
          </Button>
        </div>
        {preview ? <div className="card"><Markdown source={body} /></div> : <TextArea label="Markdown" hint="Headings, lists, tables and links. HTML is shown as text." required maxLength={100000} value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: "22rem", fontFamily: "var(--font-mono)" }} />}
      </div>
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
        <option value="draft">Working draft</option>
        <option value="published">Published</option>
        {initial ? <option value="archived">Archived</option> : null}
      </SelectField>
      <fieldset className="picker">
        <legend className="field-label">Objectives it serves</legend>
        {objectives.map((o) => (
          <label key={o.objective_id} className="check">
            <input type="checkbox" checked={objs.includes(o.objective_id)} onChange={(e) => setObjs(e.target.checked ? [...objs, o.objective_id] : objs.filter((x) => x !== o.objective_id))} />
            {o.title}
          </label>
        ))}
      </fieldset>
      <SourcePicker selected={sources} onChange={setSources} />
      {save.error instanceof ApiError && save.error.code === "stale_etag" ? (
        <Callout tone="warning" title="Someone changed this insight while you were editing">
          Your text is still here. Copy what you need, reload the page to see their version, and apply your change again — their text is also kept in History.
        </Callout>
      ) : save.isError ? (
        <ErrorCallout error={save.error} />
      ) : null}
      <div className="row">
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
          {initial ? "Save changes" : "Save insight"}
        </Button>
        <ButtonLink to={initial ? `${app}/insights/${initial.insight_id}` : `${app}/insights`}>Cancel</ButtonLink>
      </div>
    </form>
  );
}
