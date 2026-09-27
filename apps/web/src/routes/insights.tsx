import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, plural, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS, toneFor } from "../lib/status.ts";
import type { Insight, InsightSummary, RecordSummary, Refs } from "../lib/types.ts";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, ChoiceRow, EmptyState, ErrorCallout, FindField, FormGrid, Glyph, ListRow, Loading, Menu, MenuItem, MenuRadio, MenuSeparator,
  PageHeader, Segmented, SelectField, Sheet, SheetBody, SheetHeader, StatusBadge, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { Byline, HistoryDialog, ReviewBadge, searchWith, STATUS_WORD, useCopyLink } from "./insights-common.tsx";
import "../styles/screens/synthesis.css";

export { HistoryDialog } from "./insights-common.tsx";



/** The Segmented filter: All, Unreviewed (includes changed since review), Reviewed. */
const REVIEW_FILTER: Record<string, string[] | undefined> = { "": undefined, unreviewed: ["unreviewed", "changed"], reviewed: ["reviewed"] };

const STATUS_FILTER = [
  { id: "", label: "Drafts and published" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Working drafts" },
  { id: "archived", label: "Archived" },
];

// ---- Insights list ------------------------------------------------------------------------------

export function InsightsPage() {
  const { product, api: base, app, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const review = params.get("review") ?? "";
  const reviewStates = REVIEW_FILTER[review];
  const objective = params.get("objective_id") ?? "";
  const status = params.get("status") ?? "";
  const query = params.get("query") ?? "";
  const [text, setText] = useState(query);
  const objectives = useQuery({
    queryKey: ["objectives", base, ""],
    enabled: Boolean(objective),
    queryFn: () => api<{ items: { objective_id: string; title: string }[] }>("GET", `${base}/objectives`),
  });
  const q = useInfiniteQuery({
    queryKey: ["insights", base, review, objective, status, query],
    queryFn: ({ pageParam }) =>
      api<{ items: InsightSummary[]; next_cursor: string | null }>("GET", `${base}/insights${qs({ review_state: reviewStates, objective_id: objective, status, query, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.next_cursor ?? undefined,
  });
  // How many wait for a person, in the same view (ignoring the review filter itself).
  const waiting = useQuery({
    queryKey: ["insights", base, "count-unreviewed", objective, status, query],
    queryFn: () =>
      api<{ items: unknown[]; next_cursor: string | null }>("GET", `${base}/insights${qs({ review_state: REVIEW_FILTER["unreviewed"], objective_id: objective, status, query, limit: 100 })}`),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(review || objective || status || query);
  const count = !q.data ? undefined : !filtered ? product.counts.insights : q.hasNextPage ? `${items.length}+` : items.length;
  const waitingCount = waiting.data ? `${waiting.data.items.length}${waiting.data.next_cursor ? "+" : ""}` : undefined;
  const objTitle = objectives.data?.items.find((o) => o.objective_id === objective)?.title;
  const statusLabel = STATUS_FILTER.find((s) => s.id === status)?.label ?? STATUS_FILTER[0]!.label;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = new URLSearchParams(params);
    if (text.trim()) n.set("query", text.trim());
    else n.delete("query");
    setParams(n);
  };
  const setStatus = (id: string) => {
    const n = new URLSearchParams(params);
    if (id) n.set("status", id);
    else n.delete("status");
    setParams(n);
  };

  return (
    <Sheet labelledBy="insights-h" className="insights-sheet">
      <SheetHeader
        level={1}
        id="insights-h"
        title="Insights"
        count={count}
        filter={
          <Segmented
            label="Review"
            value={review}
            items={[
              { id: "", label: "All", to: searchWith(`${app}/synthesis/insights`, params, { review: null }) },
              { id: "unreviewed", label: "Unreviewed", count: waitingCount, to: searchWith(`${app}/synthesis/insights`, params, { review: "unreviewed" }) },
              { id: "reviewed", label: "Reviewed", to: searchWith(`${app}/synthesis/insights`, params, { review: "reviewed" }) },
            ]}
          />
        }
        end={
          <>
            <nav className="insights-quick" aria-label="Registers">
              <Link className="quiet-link" to={`${app}/synthesis/assumptions`}>
                Assumptions <span className="num faint">{product.counts.assumptions}</span>
              </Link>
              <Link className="quiet-link" to={`${app}/synthesis/decisions`}>
                Decisions <span className="num faint">{product.counts.decisions}</span>
              </Link>
            </nav>
            {canWrite ? (
              <ButtonLink to={`${app}/synthesis/insights/new${objective ? `?objective_id=${objective}` : ""}`} icon="plus">
                New insight
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="insights-tools">
        <form role="search" className="insights-find" onSubmit={submit}>
          <FindField
            label="Find an insight"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // Clearing the field (or its cancel button) clears the search.
              if (!e.target.value && query) {
                const n = new URLSearchParams(params);
                n.delete("query");
                setParams(n);
              }
            }}
          />
        </form>
        <Menu
          label="Show insights by status"
          triggerClassName="field-button insights-status"
          align="start"
          trigger={
            <>
              <span>{statusLabel}</span>
              <Glyph name="chevron-down" size="sm" />
            </>
          }
        >
          {STATUS_FILTER.map((s) => (
            <MenuRadio key={s.id} checked={s.id === status} onSelect={() => setStatus(s.id)}>
              {s.label}
            </MenuRadio>
          ))}
        </Menu>
        {objective ? (
          <p className="insights-scope">
            <span className="ellipsis">
              For <strong>{objTitle ?? "one objective"}</strong>
            </span>
            <Link className="quiet-link" to={searchWith(`${app}/synthesis/insights`, params, { objective_id: null })}>
              Show all objectives
            </Link>
          </p>
        ) : null}
      </div>
      {q.isPending ? (
        <Loading lines={4} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout error={q.error} onRetry={() => q.refetch()} inset />
        </SheetBody>
      ) : !items.length ? (
        filtered ? (
          <EmptyState
            size="inline"
            title={review === "unreviewed" && !objective && !status && !query ? "Every insight has been reviewed." : "No insights match this view."}
            action={<ButtonLink size="sm" to={`${app}/synthesis/insights`}>Show all insights</ButtonLink>}
          />
        ) : (
          <EmptyState
            size="inline"
            title="No insights yet"
            action={
              <>
                <ButtonLink size="sm" to="/connect" icon="plug">
                  Connect an agent
                </ButtonLink>
                {canWrite ? (
                  <ButtonLink size="sm" to={`${app}/synthesis/insights/new`}>
                    Write one yourself
                  </ButtonLink>
                ) : null}
              </>
            }
          >
            An insight brings several sources together into one readable argument. Ask your agent to draft one from the evidence, then review it here.
          </EmptyState>
        )
      ) : (
        <div className="insight-rows">
          {items.map((i) => (
            <ListRow
              key={i.insight_id}
              to={`${app}/synthesis/insights/${i.insight_id}`}
              className="insight-row"
              title={i.title}
              end={<ReviewBadge state={i.review_state} />}
            >
              {i.summary ? <span className="list-sub insight-row-summary">{i.summary}</span> : null}
              <span className="list-sub">
                {i.status !== "published" ? <>{STATUS_WORD[i.status]} · </> : null}
                {attribution(i.updated_by)} · {relativeTime(i.updated_at)} · <span className="num">{plural(i.refs.sources.length, "source")}</span>
                {i.refs.objectives.length ? <> · <span className="num">{plural(i.refs.objectives.length, "objective")}</span></> : null}
              </span>
            </ListRow>
          ))}
          {q.hasNextPage ? (
            <div className="insight-more">
              <Button size="sm" onClick={() => q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading…">
                More insights
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

// ---- One insight --------------------------------------------------------------------------------

type Ref = Record<string, string | null>;

/**
 * Each reference's title, and a word for its state where the reader should know it (archived,
 * achieved, a register entry's status, gone), as the Story inspector marks them.
 */
function useTitles(refs: Refs | undefined) {
  const { api: base } = useProduct();
  return useQuery({
    queryKey: ["ref-titles", base, refs],
    enabled: Boolean(refs),
    queryFn: async () => {
      const titles: Record<string, string> = {};
      const marks: Record<string, string> = {};
      const load = async (ids: string[], path: (id: string) => string, title: (r: Ref) => string | null, mark: (r: Ref) => string | null) => {
        await Promise.all(
          ids.map(async (id) => {
            try {
              const r = await api<Ref>("GET", `${base}/${path(id)}`);
              titles[id] = title(r) ?? id;
              const m = r["archived_at"] || r["status"] === "archived" ? "Archived" : mark(r);
              if (m) marks[id] = m;
            } catch (e) {
              // A reference that no longer resolves keeps its placeholder.
              if (e instanceof ApiError && (e.isNotFound || e.status === 410)) marks[id] = "No longer in this product";
            }
          }),
        );
      };
      const entryStatus = (r: Ref) => (r["status"] ? (REVIEW_STATUS[r["status"]]?.label ?? r["status"]) : null);
      await Promise.all([
        load(refs!.sources, (id) => `sources/${id}`, (r) => r["title"]!, () => null),
        load(refs!.insights, (id) => `insights/${id}?limit=1`, (r) => r["title"]!, (r) => (r["status"] === "draft" ? "Draft" : null)),
        load(refs!.assumptions, (id) => `assumptions/${id}`, (r) => r["statement"]!, entryStatus),
        load(refs!.decisions, (id) => `decisions/${id}`, (r) => r["statement"]!, entryStatus),
        load(refs!.objectives, (id) => `objectives/${id}`, (r) => r["title"]!, (r) => (r["status"] === "achieved" ? "Achieved" : null)),
      ]);
      return { titles, marks };
    },
  });
}

const REF_ROWS: { key: keyof Refs; label: string; missing: string; to: (app: string, id: string) => string }[] = [
  { key: "objectives", label: "Objectives", missing: "An objective", to: (app, id) => `${app}/synthesis/insights?objective_id=${id}` },
  { key: "sources", label: "Sources", missing: "A source", to: (app, id) => `${app}/evidence/${id}` },
  { key: "insights", label: "Related insights", missing: "An insight", to: (app, id) => `${app}/synthesis/insights/${id}` },
  { key: "assumptions", label: "Assumptions", missing: "An assumption", to: (app, id) => `${app}/synthesis/assumptions/${id}` },
  { key: "decisions", label: "Decisions", missing: "A decision", to: (app, id) => `${app}/synthesis/decisions/${id}` },
];

function ReviewLine({ i }: { i: Insight }) {
  const { api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const undo = useMutation({
    mutationFn: () => api<InsightSummary>("POST", `${base}/insights/${i.insight_id}/review`, { reviewed: false, expected_etag: i.etag }),
    onSuccess: (r) => {
      qc.setQueryData<Insight>(["insight", base, i.insight_id], (old) => (old ? { ...old, ...r } : old));
      void qc.invalidateQueries({ queryKey: ["insights", base] });
      toast("The review mark is cleared.");
    },
    onError: () => void qc.invalidateQueries({ queryKey: ["insight", base, i.insight_id] }),
  });
  return (
    <span className="insight-review">
      <ReviewBadge state={i.review_state} />
      {i.review_state !== "unreviewed" && i.reviewed_by ? (
        <span>
          {i.review_state === "changed" ? `Reviewed revision ${i.reviewed_revision} by ` : "by "}
          {attribution(i.reviewed_by)}, <time dateTime={i.reviewed_at ?? undefined}>{relativeTime(i.reviewed_at)}</time>
        </span>
      ) : null}
      {i.review_state === "reviewed" && canWrite ? (
        <button type="button" className="insight-undo" onClick={() => undo.mutate()} disabled={undo.isPending} aria-label="Undo the review mark">
          {undo.isPending ? "Undoing…" : "Undo"}
        </button>
      ) : null}
      {undo.isError ? <span className="text-bad">{undo.error instanceof ApiError && undo.error.code === "stale_etag" ? "It changed; reloaded. Try again." : "Couldn't undo."}</span> : null}
    </span>
  );
}

export function InsightPage() {
  const { insightId = "" } = useParams();
  const { api: base, app, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const copyLink = useCopyLink();
  const [history, setHistory] = useState(false);
  const q = useQuery({ queryKey: ["insight", base, insightId], queryFn: () => api<Insight>("GET", `${base}/insights/${insightId}?limit=100000`) });
  const titles = useTitles(q.data?.refs);
  usePageTitle(q.data?.title);
  const merge = (r: InsightSummary) => {
    qc.setQueryData<Insight>(["insight", base, insightId], (old) => (old ? { ...old, ...r } : old));
    void qc.invalidateQueries({ queryKey: ["insights", base] });
  };
  const markReviewed = useMutation({
    mutationFn: () => api<InsightSummary>("POST", `${base}/insights/${insightId}/review`, { reviewed: true, expected_etag: q.data!.etag }),
    onSuccess: (r) => {
      merge(r);
      toast("Marked reviewed.");
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ status, etag }: { status: InsightSummary["status"]; etag: string; undo?: InsightSummary["status"] }) =>
      api<InsightSummary>("PATCH", `${base}/insights/${insightId}`, { expected_etag: etag, status }),
    onSuccess: (r, { undo }) => {
      merge(r);
      void qc.invalidateQueries({ queryKey: ["product"] });
      if (undo) toast(r.status === "archived" ? "Insight archived." : "Insight restored.", { action: { label: "Undo", onClick: () => setStatus.mutate({ status: undo, etag: r.etag }) } });
    },
    onError: () => void q.refetch(),
  });

  if (q.isPending) return <Loading lines={6} variant="lines" />;
  if (q.isError)
    return (
      <>
        <PageHeader crumbs={[{ label: "Insights", to: `${app}/synthesis/insights` }, { label: "Not found" }]} title="This insight could not be loaded" />
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      </>
    );
  const i = q.data;
  const t = titles.data?.titles ?? {};
  const marks = titles.data?.marks ?? {};
  const archived = i.status === "archived";
  const connected = REF_ROWS.filter((r) => i.refs[r.key].length);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Insights", to: `${app}/synthesis/insights` }, { label: i.title }]}
        title={i.title}
        meta={
          <>
            <ReviewLine i={i} />
            <span className="sep-dot" aria-hidden="true" />
            {i.revision > 1 ? (
              <span className="insight-written">
                Revision <span className="num">{i.revision}</span> by {attribution(i.updated_by)}, <time dateTime={i.updated_at}>{relativeTime(i.updated_at)}</time>
              </span>
            ) : (
              <span className="insight-written">
                Written by <Byline actor={i.created_by} />, <time dateTime={i.created_at}>{relativeTime(i.created_at)}</time>
              </span>
            )}
            {i.status !== "published" ? (
              <>
                <span className="sep-dot" aria-hidden="true" />
                <StatusBadge tone={toneFor("insight", i.status)}>{STATUS_WORD[i.status]}</StatusBadge>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {canWrite && !archived && i.review_state !== "reviewed" ? (
              <Button variant="primary" icon="check" busy={markReviewed.isPending} busyLabel="Marking…" onClick={() => markReviewed.mutate()}>
                Mark reviewed
              </Button>
            ) : null}
            {canWrite && !archived ? (
              <ButtonLink to={`${app}/synthesis/insights/${i.insight_id}/edit`} icon="pencil">
                Edit
              </ButtonLink>
            ) : null}
            <Menu label="More actions" triggerClassName="icon-btn icon-btn-md" trigger={<Glyph name="ellipsis" />} align="end">
              <MenuItem icon="link" onSelect={copyLink}>
                Copy link
              </MenuItem>
              <MenuItem icon="clock" onSelect={() => setHistory(true)} disabled={i.revision < 2} meta={i.revision < 2 ? "none yet" : undefined}>
                Earlier versions
              </MenuItem>
              {canWrite && !archived ? (
                <>
                  <MenuSeparator />
                  <MenuItem icon="archive" onSelect={() => setStatus.mutate({ status: "archived", etag: i.etag, undo: i.status })}>
                    Archive
                  </MenuItem>
                </>
              ) : null}
            </Menu>
          </>
        }
      />
      {markReviewed.isError ? (
        <ErrorCallout error={markReviewed.error} title="Not marked reviewed" onRetry={() => void q.refetch().then(() => markReviewed.reset())} />
      ) : null}
      {setStatus.isError ? <ErrorCallout error={setStatus.error} onRetry={() => setStatus.reset()} retryLabel="Dismiss" /> : null}
      {archived ? (
        <Callout
          tone="info"
          title="This insight is archived"
          action={canWrite ? <Button size="sm" icon="archive-restore" busy={setStatus.isPending} onClick={() => setStatus.mutate({ status: "draft", etag: i.etag })}>Restore as a draft</Button> : null}
        >
          It stays readable and linkable, and is left out of lists and search.
        </Callout>
      ) : null}
      <Sheet label="Insight" className="insight-body">
        <div className="insight-prose">
          {i.summary ? <p className="insight-summary">{i.summary}</p> : null}
          {i.body ? <Markdown source={i.body} evidence={{ app, titles: t }} /> : <p className="faint">No text yet.</p>}
          {i.truncated ? <p className="faint">The rest of this insight is too long to show here.</p> : null}
        </div>
      </Sheet>
      <Sheet labelledBy="connected-h">
        <SheetHeader
          id="connected-h"
          title="Connected"
          end={
            <nav className="insights-quick" aria-label="Registers">
              <Link className="quiet-link" to={`${app}/synthesis/assumptions`}>
                All assumptions
              </Link>
              <Link className="quiet-link" to={`${app}/synthesis/decisions`}>
                All decisions
              </Link>
            </nav>
          }
        />
        {connected.length ? (
          <dl className="insight-refs">
            {connected.map((r) => (
              <div key={r.key} className="insight-refs-row">
                <dt>{r.label}</dt>
                <dd>
                  <ul>
                    {i.refs[r.key].map((id) => (
                      <li key={id}>
                        <Link to={r.to(app, id)}>{t[id] ?? (titles.isPending ? "Loading…" : r.missing)}</Link>
                        {marks[id] ? <span className="insight-ref-mark">{marks[id]}</span> : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <EmptyState size="inline">
            Not linked to objectives, sources or entries yet.{canWrite && !archived ? " Edit the insight to link them, or ask your agent to add references." : ""}
          </EmptyState>
        )}
      </Sheet>
      {history ? (
        <HistoryDialog tool="insights" id={i.insight_id} etag={i.etag} onClose={() => setHistory(false)} render={(c) => <Markdown source={String(c["body"] ?? "")} evidence={{ app, titles: t }} />} />
      ) : null}
    </>
  );
}

// ---- Insight editor -----------------------------------------------------------------------------

function SourcePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { api: base } = useProduct();
  const [query, setQuery] = useState("");
  const q = useQuery({ queryKey: ["sources-pick", base, query], queryFn: () => api<{ records: RecordSummary[] }>("GET", `${base}/sources${qs({ query, limit: 100 })}`) });
  const records = q.data?.records ?? [];
  return (
    <div className="field" role="group" aria-labelledby="pick-sources">
      <span className="field-label" id="pick-sources">
        Sources it draws on
      </span>
      <div className="field-control insight-choices">
        <FindField label="Filter sources" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="insight-choice-list">
          {q.isPending ? (
            <Loading variant="lines" lines={3} />
          ) : q.isError ? (
            <ErrorCallout error={q.error} inset onRetry={() => q.refetch()} />
          ) : !records.length ? (
            <p className="faint insight-choice-empty">{query ? "No sources match." : "No sources yet."}</p>
          ) : (
            records.map((r) => (
              <ChoiceRow
                key={r.record_id}
                label={r.title}
                hint={r.kind_label}
                checked={selected.includes(r.record_id)}
                onChange={(e) => onChange(e.target.checked ? [...selected, r.record_id] : selected.filter((x) => x !== r.record_id))}
              />
            ))
          )}
        </div>
        <div className="field-hint" aria-live="polite">
          {plural(selected.length, "source")} selected
        </div>
      </div>
    </div>
  );
}

export function InsightEditPage() {
  const { insightId } = useParams();
  const [params] = useSearchParams();
  const { api: base, app, canWrite } = useProduct();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["insight", base, insightId], enabled: Boolean(insightId), queryFn: () => api<Insight>("GET", `${base}/insights/${insightId}?limit=100000`) });
  const objectives = useQuery({ queryKey: ["objectives", base, ""], queryFn: () => api<{ items: { objective_id: string; title: string }[] }>("GET", `${base}/objectives`) });
  usePageTitle(insightId ? "Edit insight" : "New insight");
  const crumbs = [{ label: "Insights", to: `${app}/synthesis/insights` }, ...(existing.data ? [{ label: existing.data.title, to: `${app}/synthesis/insights/${existing.data.insight_id}` }] : []), { label: insightId ? "Edit" : "New insight" }];
  if (!canWrite)
    return (
      <>
        <PageHeader crumbs={crumbs} title={insightId ? "Edit insight" : "New insight"} />
        <Callout tone="info" title="You can read insights here, but not write them">
          Your role in this product is viewer, or the product is archived. An admin of the product can change your role.
        </Callout>
      </>
    );
  if (insightId && existing.isPending) return <Loading lines={6} variant="lines" />;
  if (existing.isError)
    return (
      <>
        <PageHeader crumbs={crumbs} title="Edit insight" />
        <ErrorCallout error={existing.error} onRetry={() => existing.refetch()} />
      </>
    );
  return (
    <InsightForm
      key={insightId ?? "new"}
      crumbs={crumbs}
      initial={existing.data}
      objectives={objectives.data?.items ?? []}
      preselect={{ objective: params.get("objective_id"), source: params.get("source_id") }}
      onSaved={(id) => {
        void qc.invalidateQueries({ queryKey: ["insights", base] });
        void qc.invalidateQueries({ queryKey: ["insight", base, id] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        navigate(`${app}/synthesis/insights/${id}`);
      }}
    />
  );
}

function InsightForm({ crumbs, initial, objectives, preselect, onSaved }: {
  crumbs: { label: string; to?: string }[];
  initial?: Insight;
  objectives: { objective_id: string; title: string }[];
  preselect: { objective: string | null; source: string | null };
  onSaved: (id: string) => void;
}) {
  const { api: base, app } = useProduct();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [status, setStatus] = useState<InsightSummary["status"]>(initial?.status ?? "draft");
  const [objs, setObjs] = useState<string[]>(initial?.refs.objectives ?? (preselect.objective ? [preselect.objective] : []));
  const [sources, setSources] = useState<string[]>(initial?.refs.sources ?? (preselect.source ? [preselect.source] : []));
  const [preview, setPreview] = useState(false);
  // After a 409 the newer version is loaded here; saving again writes over it (theirs stays in history).
  const [theirs, setTheirs] = useState<Insight | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const refs = { objectives: objs, sources };
      if (initial) {
        await api("PATCH", `${base}/insights/${initial.insight_id}`, { expected_etag: theirs?.etag ?? initial.etag, title, summary, body, status, refs });
        return initial.insight_id;
      }
      const r = await api<{ insight_id: string }>("POST", `${base}/insights`, { title, summary, body, status: status === "archived" ? "draft" : status, refs });
      return r.insight_id;
    },
    onSuccess: onSaved,
    onError: async (e) => {
      if (initial && e instanceof ApiError && e.code === "stale_etag")
        setTheirs(await api<Insight>("GET", `${base}/insights/${initial.insight_id}?limit=1`).catch(() => null));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  const cancelTo = initial ? `${app}/synthesis/insights/${initial.insight_id}` : `${app}/synthesis/insights`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader
        crumbs={crumbs}
        title={initial ? "Edit insight" : "New insight"}
        description="One readable argument across sources. Cite passages in the text (source and ¶ numbers) so anyone can check them."
      />
      <Sheet label="Insight" className="insight-form">
        <FormGrid>
          <TextField label="Title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!initial} />
          <TextArea label="Summary" optional hint="One or two sentences, shown in lists." maxLength={1000} rows={2} className="insight-summary-input" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="field" role="group" aria-labelledby="insight-text-label">
            <span className="field-label" id="insight-text-label">
              Text
            </span>
            <div className="field-control">
              <Segmented
                label="Text view"
                value={preview ? "preview" : "write"}
                onChange={(v) => setPreview(v === "preview")}
                items={[
                  { id: "write", label: "Write" },
                  { id: "preview", label: "Preview" },
                ]}
              />
              {preview ? (
                <div className="insight-preview">{body.trim() ? <Markdown source={body} /> : <p className="faint">Nothing to preview yet.</p>}</div>
              ) : (
                <textarea
                  className="input textarea insight-textarea"
                  aria-labelledby="insight-text-label"
                  aria-describedby="insight-text-hint"
                  required
                  maxLength={100000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              )}
              <div className="field-hint" id="insight-text-hint">
                Markdown: headings, lists, tables and links. HTML is shown as text.
              </div>
            </div>
          </div>
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} hint="A working draft is visible to the team but not yet something to rely on.">
            <option value="draft">Working draft</option>
            <option value="published">Published</option>
            {initial ? <option value="archived">Archived</option> : null}
          </SelectField>
          <div className="field" role="group" aria-labelledby="pick-objectives">
            <span className="field-label" id="pick-objectives">
              Objectives it serves
            </span>
            <div className="field-control insight-choices">
              {objectives.length ? (
                objectives.map((o) => (
                  <ChoiceRow
                    key={o.objective_id}
                    label={o.title}
                    checked={objs.includes(o.objective_id)}
                    onChange={(e) => setObjs(e.target.checked ? [...objs, o.objective_id] : objs.filter((x) => x !== o.objective_id))}
                  />
                ))
              ) : (
                <p className="faint insight-choice-empty">
                  No objectives yet. <Link to={`${app}/objectives`}>Add them on Objectives</Link>.
                </p>
              )}
            </div>
          </div>
          <SourcePicker selected={sources} onChange={setSources} />
        </FormGrid>
        {stale ? (
          <div className="insight-form-notice">
            <Callout tone="attention" inset title="Someone saved a newer version while you were editing">
              {theirs ? (
                <>
                  Revision {theirs.revision}, by {attribution(theirs.updated_by)} {relativeTime(theirs.updated_at)}:{" "}
                  <a href={`${app}/synthesis/insights/${theirs.insight_id}`} target="_blank" rel="noreferrer">
                    read it in a new tab
                  </a>
                  . Your text is still here. Saving again replaces theirs; their text is kept in Earlier versions.
                </>
              ) : (
                "Your text is still here. Copy what you need, reload to see their version, and apply your change again."
              )}
            </Callout>
          </div>
        ) : save.isError ? (
          <div className="insight-form-notice">
            <ErrorCallout error={save.error} inset />
          </div>
        ) : null}
        <div className="insight-form-actions">
          <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
            {stale && theirs ? "Save mine over theirs" : initial ? "Save changes" : "Save insight"}
          </Button>
          <ButtonLink to={cancelTo}>Cancel</ButtonLink>
        </div>
      </Sheet>
    </form>
  );
}
