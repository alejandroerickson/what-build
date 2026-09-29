import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, citationCheckWords, formatCue, nestQuotes, plural, relativeTime } from "../lib/format.ts";
import { findByTitle } from "../lib/fuzzy.ts";
import { Markdown, passageHref } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { PROVENANCE_LABEL, REVIEW_STATUS, toneFor } from "../lib/status.ts";
import type { CitationView, RegisterEntry, RegisterSummary } from "../lib/types.ts";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, EmptyState, ErrorCallout, FiltersInUse, FormGrid, Glyph, ListRow, Loading, Menu, MenuItem, MenuNote, PageHeader, SelectField, Sheet,
  SheetBody, SheetHeader, StatusBadge, Tag, TextArea, useToast,
} from "../ui/index.tsx";
import { Byline, searchWith, useCopyLink } from "./insights-common.tsx";
import { entryViews, Marked, TitleFind, useEntryList } from "./synthesis-panel.tsx";
import "../styles/screens/synthesis.css";

type Kind = "assumptions" | "decisions";

const TITLE: Record<Kind, string> = { assumptions: "Assumptions", decisions: "Decisions" };
const ONE: Record<Kind, string> = { assumptions: "Assumption", decisions: "Decision" };

function statusOf(status: string) {
  return REVIEW_STATUS[status] ?? { label: status, tone: "neutral" as const };
}

/**
 * The rows in list order, with each superseded entry placed under the listed entry that replaced
 * it (a chain stays in order: each row sits under its own replacement).
 */
function withHistory(items: RegisterSummary[]): { e: RegisterSummary; nested: boolean }[] {
  const listed = new Set(items.map((e) => e.id));
  const children = new Map<string, RegisterSummary[]>();
  const roots: RegisterSummary[] = [];
  for (const e of items) {
    const parent = e.status === "superseded" ? e.superseded_by?.find((id) => id !== e.id && listed.has(id)) : undefined;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), e]);
    else roots.push(e);
  }
  const out: { e: RegisterSummary; nested: boolean }[] = [];
  const seen = new Set<string>();
  const visit = (e: RegisterSummary, nested: boolean) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    out.push({ e, nested });
    for (const c of children.get(e.id) ?? []) visit(c, true);
  };
  for (const e of roots) visit(e, false);
  // Anything a broken chain left unvisited still shows, at the top level.
  for (const e of items) visit(e, false);
  return out;
}

// ---- Register list ------------------------------------------------------------------------------

export function RegisterListPage({ kind }: { kind: Kind }) {
  const { product, api: base, app } = useProduct();
  const [params] = useSearchParams();
  const views = entryViews(kind);
  const view = views.find((v) => v.id === params.get("show")) ?? views[0]!;
  const outcome = params.get("outcome_id") ?? "";
  const find = params.get("q") ?? "";
  const path = `${app}/synthesis/${kind}`;
  usePageTitle(TITLE[kind]);
  const outcomes = useQuery({
    queryKey: ["outcomes", base, ""],
    enabled: Boolean(outcome),
    queryFn: () => api<{ items: { outcome_id: string; title: string }[] }>("GET", `${base}/outcomes`),
  });
  const archived = view.id === "archived";
  const list = useEntryList(kind, archived);
  const inView = (list.data?.items ?? []).filter((e) => (view.test?.(e) ?? true) && (!outcome || e.outcome_ids.includes(outcome)));
  const found = findByTitle(inView, find, (e) => e.statement);
  const ranges = new Map(found.map((f) => [f.item.id, f.ranges]));
  // While searching, the best match leads; otherwise replaced entries sit under their replacements.
  const rows = find.trim() ? found.map((f) => ({ e: f.item, nested: false })) : withHistory(inView);
  const narrowed = Boolean(view.id || outcome || find.trim());
  // "of N" compares with the product's count, which counts the ones "All" lists.
  const count = !list.data ? undefined : narrowed && view.id !== "refuted" && !archived ? `${rows.length} of ${product.counts[kind]}` : rows.length;
  const outcomeTitle = outcomes.data?.items.find((o) => o.outcome_id === outcome)?.title;
  const chips: { label: string; to: string }[] = [];
  if (view.id) chips.push({ label: view.label, to: searchWith(path, params, { show: null }) });
  if (outcome) chips.push({ label: `For ${outcomeTitle ?? "one outcome"}`, to: searchWith(path, params, { outcome_id: null }) });

  return (
    <Sheet labelledBy="register-h">
      <SheetHeader level={1} id="register-h" title={archived ? `Archived ${kind}` : TITLE[kind]} count={count} filter={<TitleFind label="Find by title" />} />
      <FiltersInUse chips={chips} clearTo={searchWith(path, params, { show: null, outcome_id: null })} />
      {list.isPending ? (
        <Loading lines={3} />
      ) : list.isError ? (
        <SheetBody>
          <ErrorCallout error={list.error} onRetry={() => list.refetch()} inset />
        </SheetBody>
      ) : !rows.length ? (
        find.trim() && inView.length ? (
          <EmptyState size="inline" title={`No ${kind} match “${find.trim()}”.`} action={<ButtonLink size="sm" to={searchWith(path, params, { q: null })}>Clear the search</ButtonLink>} />
        ) : archived ? (
          <EmptyState size="inline" title={`No archived ${kind}.`} />
        ) : narrowed ? (
          <EmptyState size="inline" title={`No ${kind} match these filters.`} action={<ButtonLink size="sm" to={path}>Show all {kind}</ButtonLink>} />
        ) : (
          <EmptyState size="inline" title={`No ${kind} yet`} action={<ButtonLink size="sm" to="/connect" icon="bot">Connect an agent</ButtonLink>}>
            Ask your agent to record the few {kind} the team relies on, with citations to the passages behind them. Everything else belongs in an insight.
          </EmptyState>
        )
      ) : (
        <div>
          {rows.map(({ e, nested }) => {
            const s = statusOf(e.status);
            const sources = new Set(e.record_ids).size;
            const replaced = e.status === "superseded";
            return (
              <ListRow
                key={e.id}
                to={`${path}/${e.id}`}
                className={`register-row${replaced ? " register-row-replaced" : ""}${nested ? " register-row-nested" : ""}`}
                lead={nested ? <Glyph name="corner-down-right" size="sm" /> : undefined}
                title={<Marked text={e.statement} ranges={ranges.get(e.id) ?? []} />}
                end={archived ? <StatusBadge tone="neutral">Archived</StatusBadge> : <StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
              >
                {replaced ? (
                  <span className="list-sub register-replaced-by">
                    {nested ? "Replaced by the entry above" : e.superseded_by?.length ? "Replaced by a newer entry" : "Replaced by a correction"}
                  </span>
                ) : null}
                <span className="list-sub">
                  {e.author_type === "agent" ? "Drafted by " : "Recorded by "}
                  {attribution(e.author)} · {relativeTime(e.updated_at)}
                </span>
                <span className="list-sub">
                  {e.citation_count ? (
                    <>
                      <span className="num">{plural(e.citation_count, "cited passage")}</span> from <span className="num">{plural(sources, "source")}</span>
                    </>
                  ) : (
                    "No passages cited yet"
                  )}
                  {" · "}
                  {e.human_review.confidence === "unreviewed" ? "no human confidence yet" : `${e.human_review.confidence} confidence`}
                </span>
              </ListRow>
            );
          })}
          {list.data.more ? <p className="insight-more faint">Showing the first {list.data.items.length} {kind}.</p> : null}
        </div>
      )}
    </Sheet>
  );
}

// ---- One entry ----------------------------------------------------------------------------------

interface CitationCheck {
  index: number;
  record_id: string;
  status: "ok" | "relocated" | "text_changed" | "record_archived" | "record_deleted" | "record_missing";
  relocated?: { seq_start: number; seq_end: number };
  version_drift: boolean;
  derivation_changed?: boolean;
  quote_match?: "normalized";
}
interface CheckResult {
  valid: boolean;
  checked_at: string;
  citations: CitationCheck[];
}

function span(a: number, b: number) {
  return a === b ? `¶${a}` : `¶${a}–${b}`;
}

/** Drift in words; the icon and colour only repeat what the words say. */
function driftWords(c: CitationCheck): string {
  const base =
    c.status === "ok"
      ? "Matches the source"
      : c.status === "relocated"
        ? c.relocated
          ? `Moved to ${span(c.relocated.seq_start, c.relocated.seq_end)}`
          : "Moved in the source"
        : c.status === "text_changed"
          ? "Source text changed; the snapshot is kept"
          : c.status === "record_archived"
            ? "Source archived"
            : c.status === "record_deleted"
              ? "Source deleted; the quote is kept"
              : "Source not found; the quote is kept";
  return citationCheckWords(base, c);
}

function CitationRow({ c, check, checking }: { c: CitationView; check?: CitationCheck; checking: boolean }) {
  const { app } = useProduct();
  const tone = check ? toneFor("citation", check.status) : "neutral";
  const good = check?.status === "ok" && !check.version_drift;
  const at = check?.status === "relocated" && check.relocated ? check.relocated : c;
  return (
    <li className="entry-cite-row">
      <Link className="entry-cite-address num" to={passageHref(app, c.record_id, at.seq_start, at.seq_end)} aria-label={`${span(c.seq_start, c.seq_end)} in ${c.source_title ?? "the source"}`}>
        {span(c.seq_start, c.seq_end)}
      </Link>
      <div className="entry-cite-main">
        <q className="entry-cite-quote">{nestQuotes(c.quote)}</q>
        <span className="entry-cite-sub">
          {check ? (
            <span className={`entry-cite-state ${good ? "text-ok" : tone === "negative" ? "text-bad" : tone === "attention" ? "text-warn" : ""}`}>
              <Glyph name={good ? "circle-check" : "triangle-alert"} size="sm" />
              {driftWords(check)}
            </span>
          ) : checking ? (
            <span className="entry-cite-state">
              <Glyph name="loader" size="sm" className="spin" />
              Checking…
            </span>
          ) : null}
          <span>
            {c.source_title ?? "A source"}
            {c.speakers.length ? ` · ${c.speakers.join(", ")}` : ""}
            {c.start_ms !== null ? ` · ${formatCue(c.start_ms)}` : ""}
          </span>
        </span>
      </div>
    </li>
  );
}

const LINK_WORD: Record<string, [string, string]> = {
  supports: ["Supports", "Supported by"],
  contradicts: ["Contradicts", "Contradicted by"],
  supersedes: ["Supersedes", "Superseded by"],
};

function ReviewForm({ entry, kind, onSaved }: { entry: RegisterEntry; kind: Kind; onSaved: (e: RegisterEntry) => void }) {
  const { api: base } = useProduct();
  const [status, setStatus] = useState<string>(entry.status);
  const [confidence, setConfidence] = useState("");
  const [note, setNote] = useState("");
  const [etag, setEtag] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: () =>
      api<RegisterEntry>("POST", `${base}/${kind}/${entry.id}/review`, {
        expected_etag: etag ?? entry.etag,
        reviewer_type: "human",
        status,
        note,
        ...(confidence ? { confidence } : {}),
      }),
    onSuccess: (r) => {
      onSaved(r);
      setNote("");
      setConfidence("");
      setEtag(null);
      setStatus(r.status);
    },
  });
  const stale = review.error instanceof ApiError && review.error.code === "stale_etag";
  const current = statusOf(entry.status).label;
  return (
    <form
      className="register-review-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        review.mutate();
      }}
    >
      <FormGrid>
        <SelectField label="Status" value={status} onChange={(ev) => setStatus(ev.target.value)} hint="Any review may change the status. A correction is recorded by superseding the entry.">
          <option value={entry.status}>Keep: {current}</option>
          {entry.status !== "confirmed" ? <option value="confirmed">{kind === "decisions" ? "Agree: confirmed" : "Confirm"}</option> : null}
          {entry.status !== "refuted" ? <option value="refuted">Refute</option> : null}
          {entry.status !== "unconfirmed" ? <option value="unconfirmed">Reopen: unconfirmed</option> : null}
        </SelectField>
        <SelectField label="Your confidence" optional value={confidence} onChange={(ev) => setConfidence(ev.target.value)} hint="How usable this is for current work, within its stated scope. Not a vote on truth.">
          <option value="">Not stated</option>
          <option value="low">Low: unresolved concerns limit its use</option>
          <option value="medium">Medium: usable with stated caveats</option>
          <option value="high">High: ready within its scope</option>
        </SelectField>
        <TextArea label="Why" required maxLength={2000} rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} hint="Say what your judgment rests on. Reviews are never edited; a changed mind is a new review." />
      </FormGrid>
      {stale ? (
        <Callout
          tone="attention"
          inset
          title="Someone reviewed this entry since you opened it"
          action={
            <Button
              size="sm"
              onClick={() =>
                void api<RegisterEntry>("GET", `${base}/${kind}/${entry.id}`).then((r) => {
                  setEtag(r.etag);
                  onSaved(r);
                  review.reset();
                })
              }
            >
              Load their review
            </Button>
          }
        >
          Your note is still here. Load their review, check it, then save yours.
        </Callout>
      ) : review.isError ? (
        <ErrorCallout title="The review was not saved" error={review.error} inset />
      ) : null}
      {!entry.frozen ? (
        <p className="small muted register-freeze-note">Saving a review freezes this entry's statement, body and citations; a later correction supersedes it.</p>
      ) : null}
      <div className="register-form-actions">
        <Button type="submit" variant="primary" disabled={!note.trim()} busy={review.isPending} busyLabel="Saving…">
          Save review
        </Button>
      </div>
    </form>
  );
}

export function RegisterEntryPage({ kind }: { kind: Kind }) {
  const { id = "" } = useParams();
  const { api: base, app, canWrite } = useProduct();
  const qc = useQueryClient();
  const copyLink = useCopyLink();
  const q = useQuery({ queryKey: ["entry", base, kind, id], queryFn: () => api<RegisterEntry>("GET", `${base}/${kind}/${id}`) });
  // check_citations is a read (POST only because it takes a body); run it with the entry.
  const check = useQuery({
    queryKey: ["entry-check", base, kind, id, q.data?.etag],
    enabled: Boolean(q.data?.citations.length),
    queryFn: () => api<CheckResult>("POST", `${base}/${kind}/${id}/check-citations`, {}),
  });
  const toast = useToast();
  const setArchived = useMutation({
    mutationFn: ({ archived, etag }: { archived: boolean; etag: string; undo?: boolean }) =>
      api<RegisterEntry>("POST", `${base}/${kind}/${id}/archive`, { archived, expected_etag: etag }),
    onSuccess: (r, { archived, undo }) => {
      qc.setQueryData(["entry", base, kind, id], r);
      void qc.invalidateQueries({ queryKey: ["register", base, kind] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      if (undo) toast(archived ? `${ONE[kind]} archived.` : `${ONE[kind]} restored.`, { action: { label: "Undo", onClick: () => setArchived.mutate({ archived: !archived, etag: r.etag }) } });
    },
    onError: () => void q.refetch(),
  });
  usePageTitle(q.data?.statement);
  const listPath = `${app}/synthesis/${kind}`;
  const crumbsFor = (label: string) => [{ label: TITLE[kind], to: listPath }, { label }];
  if (q.isPending) return <Loading lines={6} variant="lines" />;
  if (q.isError)
    return (
      <>
        <PageHeader crumbs={crumbsFor(ONE[kind])} title={`This ${ONE[kind].toLowerCase()} could not be loaded`} />
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      </>
    );
  const e = q.data;
  const s = statusOf(e.status);
  const archived = Boolean(e.archived_at);
  const canReview = canWrite && !archived && e.status !== "superseded";
  const drift = check.data && !check.data.valid;
  const outLinks = e.links.map((l) => ({ key: `out:${l.id}:${l.type}`, word: LINK_WORD[l.type]?.[0] ?? l.type, kind: l.kind ?? kind.slice(0, -1), id: l.id, statement: l.statement ?? "An entry", status: l.status }));
  const inLinks = e.linked_from.map((l) => ({ key: `in:${l.id}:${l.type}`, word: LINK_WORD[l.type]?.[1] ?? l.type, kind: l.kind, id: l.id, statement: l.statement, status: l.status }));
  const links = [...outLinks, ...inLinks];

  return (
    <>
      <PageHeader
        crumbs={crumbsFor(ONE[kind])}
        title={e.statement}
        meta={
          <>
            <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
            <span className="sep-dot" aria-hidden="true" />
            <span className="insight-written">
              {e.author_type === "agent" ? "Drafted by" : "Recorded by"} <Byline actor={e.author} agent={e.author_type === "agent"} />
              <time dateTime={e.created_at}>· {relativeTime(e.created_at)}</time>
            </span>
            <span className="sep-dot" aria-hidden="true" />
            <span>{PROVENANCE_LABEL[e.provenance_depth] ?? e.provenance_depth}</span>
            {e.frozen ? (
              <>
                <span className="sep-dot" aria-hidden="true" />
                <span title="The wording is frozen after the first review; a correction supersedes the entry.">Wording frozen</span>
              </>
            ) : null}
            {e.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </>
        }
        actions={
          <>
            <Button icon="link" onClick={copyLink}>
              Copy link
            </Button>
            {canWrite && !archived ? (
              <Menu label="More actions" triggerClassName="icon-btn icon-btn-md" trigger={<Glyph name="ellipsis" />} align="end">
                <MenuItem icon="archive" onSelect={() => setArchived.mutate({ archived: true, etag: e.etag, undo: true })}>
                  Archive
                </MenuItem>
                <MenuNote>Archiving takes it out of lists and search. Nothing is erased.</MenuNote>
              </Menu>
            ) : null}
          </>
        }
      />
      {setArchived.isError ? <ErrorCallout error={setArchived.error} onRetry={() => setArchived.reset()} retryLabel="Dismiss" /> : null}
      {e.status === "superseded" ? (
        <Callout tone="info" title="Superseded">
          A corrected entry replaced this one.{" "}
          {e.linked_from
            .filter((l) => l.type === "supersedes")
            .map((l) => (
              <Link key={l.id} to={`${app}/synthesis/${l.kind}s/${l.id}`}>
                Read the correction
              </Link>
            ))}
        </Callout>
      ) : null}
      {archived ? (
        <Callout
          tone="info"
          title={`This ${ONE[kind].toLowerCase()} is archived`}
          action={
            canWrite ? (
              <Button size="sm" icon="archive-restore" busy={setArchived.isPending} onClick={() => setArchived.mutate({ archived: false, etag: e.etag })}>
                Restore
              </Button>
            ) : null
          }
        >
          It stays readable, with its citations and reviews, and can no longer be reviewed.
        </Callout>
      ) : null}
      {e.body ? (
        <Sheet label={ONE[kind]}>
          <div className="insight-prose">
            <Markdown source={e.body} />
          </div>
        </Sheet>
      ) : null}

      <Sheet labelledBy="cites-h">
        <SheetHeader
          id="cites-h"
          title="Cited passages"
          count={e.citations.length}
          end={
            e.citations.length ? (
              <>
                <span className="faint small hide-narrow">Each citation keeps a snapshot of the exact text</span>
                <Button size="sm" icon="circle-check" onClick={() => void check.refetch()} busy={check.isFetching} busyLabel="Checking…">
                  Check again
                </Button>
              </>
            ) : null
          }
        />
        {drift ? (
          <SheetBody>
            <Callout tone="attention" inset>
              Some cited passages have changed since this was written. The quotes below are what was cited.
            </Callout>
          </SheetBody>
        ) : null}
        {check.isError ? (
          <SheetBody>
            <ErrorCallout error={check.error} inset title="The citations could not be checked" onRetry={() => void check.refetch()} />
          </SheetBody>
        ) : null}
        {e.citations.length ? (
          <ol className="entry-cite-list">
            {e.citations.map((c) => (
              <CitationRow key={c.index} c={c} check={check.data?.citations.find((x) => x.index === c.index)} checking={check.isFetching} />
            ))}
          </ol>
        ) : (
          <EmptyState size="inline">No passages cited yet. Ask your agent to cite the passages behind this {ONE[kind].toLowerCase()}.</EmptyState>
        )}
      </Sheet>

      {links.length ? (
        <Sheet labelledBy="links-h">
          <SheetHeader id="links-h" title="Related entries" count={links.length} />
          {links.map((l) => {
            const ls = l.status ? statusOf(l.status) : null;
            return (
              <ListRow key={l.key} to={`${app}/synthesis/${l.kind}s/${l.id}`} lead={l.word} className="register-link-row" title={l.statement} end={ls ? <StatusBadge tone={ls.tone}>{ls.label}</StatusBadge> : undefined} />
            );
          })}
        </Sheet>
      ) : null}

      <Sheet labelledBy="reviews-h">
        <SheetHeader
          id="reviews-h"
          title="Reviews"
          count={e.reviews.length}
          end={
            <span className="faint small">
              {e.human_review.confidence === "unreviewed"
                ? "No human confidence yet"
                : `Human confidence: ${e.human_review.confidence}, ${attribution(e.human_review.reviewer)}`}
            </span>
          }
        />
        {e.reviews.length ? (
          <ol className="entry-review-list">
            {[...e.reviews].reverse().map((r, i) => {
              const rs = statusOf(r.status);
              return (
                <li key={i} className="entry-review-row">
                  <Byline actor={r.reviewer} agent={r.reviewer_type === "agent"} />
                  <div className="entry-review-main">
                    <div className="entry-review-meta">
                      <StatusBadge tone={rs.tone}>{rs.label}</StatusBadge>
                      {r.confidence ? <Tag>{r.confidence} confidence</Tag> : null}
                      <span>{r.reviewer_type === "agent" ? "Agent review" : "Human review"}</span>
                      <time dateTime={r.created_at}>{relativeTime(r.created_at)}</time>
                    </div>
                    <p className="entry-review-note">{r.note}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState size="inline">Not reviewed yet.{canReview ? " Add the first review below." : ""}</EmptyState>
        )}
        {canReview ? (
          <div className="register-review">
            <h3 className="register-review-title">Add your review</h3>
            <ReviewForm
              entry={e}
              kind={kind}
              onSaved={(r) => {
                qc.setQueryData(["entry", base, kind, id], r);
                void qc.invalidateQueries({ queryKey: ["register", base, kind] });
              }}
            />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
