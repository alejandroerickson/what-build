import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, formatCue, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { PROVENANCE_LABEL, REVIEW_STATUS } from "../lib/status.ts";
import type { RegisterEntry, RegisterSummary } from "../lib/types.ts";
import { Badge, Button, Callout, EmptyState, ErrorCallout, Loading, PageHeader, SelectField, TextArea } from "../ui/index.tsx";

type Kind = "assumptions" | "decisions";

const MEANING: Record<Kind, string> = {
  assumptions: "What we are treating as true while the evidence is incomplete. Agents record them with citations; people review them here.",
  decisions: "The choices we agree to act on, and the evidence behind them. Recording one does not mean the team agreed.",
};

const SHOW: Record<string, { label: string; status: string[] }> = {
  current: { label: "Current (awaiting or agreed)", status: ["unconfirmed", "confirmed"] },
  unconfirmed: { label: "Awaiting agreement", status: ["unconfirmed"] },
  confirmed: { label: "Agreed", status: ["confirmed"] },
  all: { label: "All, including history", status: [] },
};

function ConfidenceText({ h }: { h: RegisterEntry["human_review"] }) {
  return <span>{h.confidence === "unreviewed" ? "No human confidence yet" : `Human confidence: ${h.confidence}`}</span>;
}

export function RegisterListPage({ kind }: { kind: Kind }) {
  const { api: base, app } = useProduct();
  const [params, setParams] = useSearchParams();
  const show = params.get("show") ?? "current";
  const objective = params.get("objective_id") ?? "";
  const q = useInfiniteQuery({
    queryKey: ["register", base, kind, show, objective],
    queryFn: ({ pageParam }) => api<{ items: RegisterSummary[]; next_cursor: string | null }>("GET", `${base}/${kind}${qs({ status: SHOW[show]?.status, objective_id: objective, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.next_cursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const title = kind === "assumptions" ? "Assumptions" : "Decisions";
  return (
    <div className="stack-lg">
      <PageHeader title={title} description={MEANING[kind]} />
      <div className="row-between">
        <SelectField label="Show" value={show} onChange={(e) => setParams(e.target.value === "current" ? {} : { show: e.target.value })}>
          {Object.entries(SHOW).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </SelectField>
        {objective ? (
          <Button size="sm" onClick={() => setParams({})}>
            Clear objective filter
          </Button>
        ) : null}
      </div>
      {q.isPending ? (
        <Loading lines={6} />
      ) : q.isError ? (
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      ) : !items.length ? (
        <EmptyState title={`No ${kind} in this view`}>
          Agents record {kind} with citations when the team relies on a specific {kind === "assumptions" ? "premise" : "choice"}. Keep this list to the few that matter; everything else belongs in an insight.
        </EmptyState>
      ) : (
        <ul className="plain-list entry-list">
          {items.map((e) => {
            const s = REVIEW_STATUS[e.status]!;
            return (
              <li key={e.id} className="card stack-sm">
                <Link to={`${app}/insights/${kind}/${e.id}`} className="row-title">
                  <h3>{e.statement}</h3>
                </Link>
                <div className="row small">
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <ConfidenceText h={e.human_review} />
                  <span className="faint">
                    · {e.citation_count} citation{e.citation_count === 1 ? "" : "s"} · {e.author_type === "agent" ? "recorded by an agent" : "recorded by a person"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {q.hasNextPage ? <Button onClick={() => q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading…">More {kind}</Button> : null}
    </div>
  );
}

interface CheckResult {
  valid: boolean;
  citations: { index: number; status: string; relocated?: { seq_start: number; seq_end: number }; version_drift: boolean }[];
}

const CHECK_LABEL: Record<string, string> = {
  ok: "Still says this",
  relocated: "Text found at a different passage",
  text_changed: "The source no longer says this",
  record_archived: "Source is archived",
  record_deleted: "Source was deleted; the quote is kept",
  record_missing: "Source is missing",
};

export function RegisterEntryPage({ kind }: { kind: Kind }) {
  const { id = "" } = useParams();
  const { api: base, app, canWrite } = useProduct();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["entry", base, kind, id], queryFn: () => api<RegisterEntry>("GET", `${base}/${kind}/${id}`) });
  const check = useMutation({ mutationFn: () => api<CheckResult>("POST", `${base}/${kind}/${id}/check-citations`, {}) });
  const [confidence, setConfidence] = useState("");
  const [note, setNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const review = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<RegisterEntry>("POST", `${base}/${kind}/${id}/review`, { expected_etag: q.data!.etag, reviewer_type: "human", ...body }),
    onSuccess: (r) => {
      qc.setQueryData(["entry", base, kind, id], r);
      void qc.invalidateQueries({ queryKey: ["register", base, kind] });
      setNote("");
      setStatusNote("");
      setConfidence("");
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorCallout error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data;
  const s = REVIEW_STATUS[e.status]!;
  const label = kind === "assumptions" ? "Assumption" : "Decision";
  const reviewError = review.error instanceof ApiError && review.error.code === "stale_etag";
  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={[{ label: kind === "assumptions" ? "Assumptions" : "Decisions", to: `${app}/insights/${kind}` }, { label }]}
        title={e.statement}
        description={
          <span className="row">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span>
              {label} · {PROVENANCE_LABEL[e.provenance_depth]} · recorded by {attribution(e.author)} {e.author_type === "agent" ? "(agent-authored)" : ""}
            </span>
          </span>
        }
      />
      {e.status === "superseded" ? (
        <Callout tone="warning" title="Superseded">
          A corrected entry replaced this one.{" "}
          {e.linked_from.filter((l) => l.type === "supersedes").map((l) => (
            <Link key={l.id} to={`${app}/insights/${l.kind}s/${l.id}`}>
              Read the correction
            </Link>
          ))}
        </Callout>
      ) : null}
      <div className="detail-layout">
        <div className="detail-main stack-lg">
          {e.body ? <Markdown source={e.body} /> : null}
          <section className="stack" aria-labelledby="cites-h">
            <div className="row-between">
              <h2 id="cites-h">The evidence</h2>
              <Button size="sm" onClick={() => check.mutate()} busy={check.isPending} busyLabel="Checking…">
                Check citations
              </Button>
            </div>
            {check.data ? (
              <Callout tone={check.data.valid ? "success" : "warning"}>
                {check.data.valid ? "Every cited passage still says what was quoted." : "Some cited passages have changed since this was written. The quotes below are what was agreed to."}
              </Callout>
            ) : null}
            <ol className="plain-list citations">
              {e.citations.map((c) => {
                const r = check.data?.citations.find((x) => x.index === c.index);
                return (
                  <li key={c.index} className="citation">
                    <blockquote>{c.quote}</blockquote>
                    <div className="row small">
                      <span>
                        {c.speakers.join(", ")}
                        {c.speakers.length ? " · " : ""}
                        {c.source_title ?? "A source"} · {c.seq_start === c.seq_end ? `segment ${c.seq_start}` : `segments ${c.seq_start}–${c.seq_end}`}
                        {c.start_ms !== null ? ` · ${formatCue(c.start_ms)}` : ""}
                      </span>
                      <Link to={`${app}/sources/${c.record_id}?tab=passages&seq=${c.seq_start}`}>Read in context</Link>
                      {r ? (
                        <Badge tone={r.status === "ok" && !r.version_drift ? "success" : "warning"}>
                          {CHECK_LABEL[r.status] ?? r.status}
                          {r.version_drift ? " · newer file version" : ""}
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          {e.links.length || e.linked_from.length ? (
            <section className="stack-sm" aria-labelledby="links-h">
              <h2 id="links-h">Related entries</h2>
              <ul className="plain-list">
                {e.links.map((l) => (
                  <li key={`${l.id}:${l.type}`}>
                    <span className="muted">{l.type === "supports" ? "Supports" : l.type === "contradicts" ? "Contradicts" : "Supersedes"}: </span>
                    <Link to={`${app}/insights/${l.kind ?? "assumption"}s/${l.id}`}>{l.statement ?? l.id}</Link>
                  </li>
                ))}
                {e.linked_from.map((l) => (
                  <li key={`in:${l.id}:${l.type}`}>
                    <span className="muted">{l.type === "supports" ? "Supported by" : l.type === "contradicts" ? "Contradicted by" : "Superseded by"}: </span>
                    <Link to={`${app}/insights/${l.kind}s/${l.id}`}>{l.statement}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="stack" aria-labelledby="hist-h">
            <h2 id="hist-h">Reviews</h2>
            {!e.reviews.length ? <p className="muted">Not reviewed yet.</p> : null}
            <ol className="plain-list">
              {e.reviews.map((r, i) => (
                <li key={i} className="note">
                  <div className="row small">
                    <strong>{attribution(r.reviewer)}</strong>
                    <Badge tone={REVIEW_STATUS[r.status]?.tone}>{REVIEW_STATUS[r.status]?.label}</Badge>
                    {r.confidence ? <Badge tone="accent">confidence {r.confidence}</Badge> : null}
                    <span className="faint">{r.reviewer_type === "agent" ? "agent review" : "human review"}</span>
                    <time className="faint" dateTime={r.created_at}>
                      {relativeTime(r.created_at)}
                    </time>
                  </div>
                  <p>{r.note}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="detail-aside stack" aria-label="Review">
          {canWrite && e.status !== "superseded" ? (
            <>
              <form
                className="stack-sm"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  review.mutate({ status: e.status, confidence, note });
                }}
              >
                <h2 className="aside-h">Your confidence</h2>
                <p className="small muted">How usable is this for current work, within its stated scope? This is not a vote on truth, and it does not change the status.</p>
                <SelectField label="Confidence" required value={confidence} onChange={(ev) => setConfidence(ev.target.value)}>
                  <option value="">Choose…</option>
                  <option value="low">Low — unresolved concerns limit its use</option>
                  <option value="medium">Medium — usable with stated caveats</option>
                  <option value="high">High — ready within its scope</option>
                </SelectField>
                <TextArea label="Why" required maxLength={2000} value={note} onChange={(ev) => setNote(ev.target.value)} />
                <Button type="submit" disabled={!confidence || !note.trim()} busy={review.isPending} busyLabel="Saving…">
                  Save review
                </Button>
              </form>
              <details className="stack-sm">
                <summary className="aside-h">Change the status</summary>
                <TextArea label="Note" required maxLength={2000} value={statusNote} onChange={(ev) => setStatusNote(ev.target.value)} hint="Say what the agreement or refutation rests on." />
                <div className="row">
                  {e.status !== "confirmed" ? <Button size="sm" disabled={!statusNote.trim()} onClick={() => review.mutate({ status: "confirmed", note: statusNote })}>Confirm</Button> : null}
                  {e.status !== "refuted" ? <Button size="sm" disabled={!statusNote.trim()} onClick={() => review.mutate({ status: "refuted", note: statusNote })}>Refute</Button> : null}
                  {e.status !== "unconfirmed" ? <Button size="sm" disabled={!statusNote.trim()} onClick={() => review.mutate({ status: "unconfirmed", note: statusNote })}>Reopen</Button> : null}
                </div>
              </details>
              {reviewError ? (
                <Callout tone="warning" title="The review was not saved" action={<Button size="sm" onClick={() => void q.refetch()}>Reload</Button>}>
                  Someone reviewed this entry since you opened it. Your note is still here.
                </Callout>
              ) : review.isError ? (
                <ErrorCallout title="The review was not saved" error={review.error} />
              ) : null}
            </>
          ) : null}
          <dl className="facts">
            <dt>Human confidence</dt>
            <dd>
              {e.human_review.confidence === "unreviewed" ? "None recorded" : `${e.human_review.confidence}, by ${attribution(e.human_review.reviewer)}`}
            </dd>
            <dt>Recorded</dt>
            <dd>
              {attribution(e.author)}, {relativeTime(e.created_at)}
            </dd>
            {e.frozen ? (
              <>
                <dt>Wording</dt>
                <dd>Frozen after the first review; corrections supersede it.</dd>
              </>
            ) : null}
          </dl>
        </aside>
      </div>
    </div>
  );
}
