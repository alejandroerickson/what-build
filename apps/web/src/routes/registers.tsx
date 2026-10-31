import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, deletedSentence, plural, quotedAtEnd, relativeTime } from "../lib/format.ts";
import { findByTitle } from "../lib/fuzzy.ts";
import { Markdown } from "../lib/markdown.tsx";
import { cannotWriteReason, useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS } from "../lib/status.ts";
import type { RegisterEntry, RegisterSummary } from "../lib/types.ts";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, ChoiceRow, EmptyState, ErrorCallout, FiltersInUse, FormGrid, Glyph, ListRow, Loading, Menu, MenuItem, MenuNote, MenuSeparator, PageHeader, SelectField, Sheet,
  SheetBody, SheetHeader, StatusBadge, Tag, TextArea, useToast,
} from "../ui/index.tsx";
import { DeleteDialog, listed } from "./delete-dialog.tsx";
import { Byline, searchWith, useCopyLink } from "./exploration-common.tsx";
import { FirstUse } from "./first-use.tsx";
import { entryViews, Marked, TitleFind, useEntryList } from "./exploration-panel.tsx";
import "../styles/screens/exploration.css";

/** The register a product keeps. */
type Kind = "assumptions";

const TITLE: Record<Kind, string> = { assumptions: "Assumptions" };
const ONE: Record<Kind, string> = { assumptions: "Assumption" };

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

/** What the register holds, said once for its empty list and its form. */
const MEANING: Record<Kind, string> = {
  assumptions: "An assumption is something the team treats as true before the evidence settles it.",
};

export function RegisterListPage({ kind }: { kind: Kind }) {
  const { product, api: base, app, canWrite } = useProduct();
  const [params] = useSearchParams();
  const views = entryViews(kind);
  const view = views.find((v) => v.id === params.get("show")) ?? views[0]!;
  const outcome = params.get("outcome_id") ?? "";
  const find = params.get("q") ?? "";
  const path = `${app}/exploration/${kind}`;
  usePageTitle(TITLE[kind]);
  const outcomes = useQuery({
    queryKey: ["outcomes", base, false],
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
  const count = !list.data ? undefined : narrowed && view.id !== "refuted" && !archived && list.data.items.length ? `${rows.length} of ${product.counts[kind]}` : rows.length;
  const outcomeTitle = outcomes.data?.items.find((o) => o.outcome_id === outcome)?.title;
  const chips: { label: string; to: string }[] = [];
  if (view.id) chips.push({ label: view.label, to: searchWith(path, params, { show: null }) });
  if (outcome) chips.push({ label: `For ${outcomeTitle ?? "one outcome"}`, to: searchWith(path, params, { outcome_id: null }) });

  return (
    <Sheet labelledBy="register-h">
      <SheetHeader
        level={1}
        id="register-h"
        title={archived ? `Archived ${kind}` : TITLE[kind]}
        count={count}
        filter={<TitleFind label="Find by title" />}
        end={
          canWrite ? (
            <ButtonLink to={`${path}/new${outcome ? `?outcome_id=${outcome}` : ""}`} icon="plus">
              New {ONE[kind].toLowerCase()}
            </ButtonLink>
          ) : undefined
        }
      />
      <FiltersInUse chips={chips} clearTo={searchWith(path, params, { show: null, outcome_id: null })} />
      {list.isPending ? (
        <Loading lines={3} />
      ) : list.isError ? (
        <SheetBody>
          <ErrorCallout error={list.error} onRetry={() => list.refetch()} inset />
        </SheetBody>
      ) : !rows.length ? (
        find.trim() && inView.length ? (
          <EmptyState size="inline" title={`No ${kind} match “${find.trim()}”`} action={<ButtonLink size="sm" to={searchWith(path, params, { q: null })}>Clear the search</ButtonLink>} />
        ) : archived ? (
          <EmptyState size="inline" title={`No archived ${kind}`} />
        ) : !list.data.items.length ? (
          <FirstUse
            title={`No ${kind} yet`}
            ask={`List the assumptions ${product.name} depends on and record the riskiest in WhatBuild, with what each one rests on.`}
          >
            {MEANING[kind]}
          </FirstUse>
        ) : narrowed ? (
          <EmptyState size="inline" title={`No ${kind} match these filters`} action={<ButtonLink size="sm" to={path}>Show all {kind}</ButtonLink>} />
        ) : (
          <EmptyState
            size="inline"
            title={`No current ${kind}`}
            action={<ButtonLink size="sm" to={searchWith(path, params, { show: "refuted" })}>Show refuted or replaced</ButtonLink>}
          />
        )
      ) : (
        <div>
          {rows.map(({ e, nested }) => {
            const s = statusOf(e.status);
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
                  {attribution(e.author)} · <time dateTime={e.created_at}>{relativeTime(e.created_at)}</time>
                  {relativeTime(e.updated_at) !== relativeTime(e.created_at) ? (
                    <>
                      {" · updated "}
                      <time dateTime={e.updated_at}>{relativeTime(e.updated_at)}</time>
                    </>
                  ) : null}
                </span>
                <span className="list-sub">
                  {e.human_review.confidence === "unreviewed" ? "No human confidence yet" : `${e.human_review.confidence[0]!.toUpperCase()}${e.human_review.confidence.slice(1)} confidence`}
                </span>
              </ListRow>
            );
          })}
          {list.data.more ? <p className="entry-more faint">Showing the first {list.data.items.length} {kind}.</p> : null}
        </div>
      )}
    </Sheet>
  );
}

// ---- One entry ----------------------------------------------------------------------------------

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
        <SelectField label="Status" value={status} onChange={(ev) => setStatus(ev.target.value)}>
          <option value={entry.status}>Keep: {current}</option>
          {entry.status !== "confirmed" ? <option value="confirmed">Confirm</option> : null}
          {entry.status !== "refuted" ? <option value="refuted">Refute</option> : null}
          {entry.status !== "unconfirmed" ? <option value="unconfirmed">Reopen: unconfirmed</option> : null}
        </SelectField>
        <SelectField label="Your confidence" optional value={confidence} onChange={(ev) => setConfidence(ev.target.value)}>
          <option value="">Not stated</option>
          <option value="low">Low: unresolved concerns limit its use</option>
          <option value="medium">Medium: usable with stated caveats</option>
          <option value="high">High: ready within its scope</option>
        </SelectField>
        <TextArea label="Why" required maxLength={2000} rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
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
          Your note is still here. Load their review, then save yours.
        </Callout>
      ) : review.isError ? (
        <ErrorCallout title="Your review couldn’t be saved" error={review.error} inset />
      ) : null}
      <p className="small muted register-freeze-note">{entry.frozen ? "Reviews can’t be edited." : "Saving freezes the wording. Reviews can’t be edited."}</p>
      <div className="register-form-actions">
        <Button type="submit" variant="primary" disabled={!note.trim()} busy={review.isPending} busyLabel="Saving…">
          Save review
        </Button>
      </div>
    </form>
  );
}

/** What deleting an assumption destroys, as assumptions.delete_impact reports it. */
interface EntryImpact {
  etag: string;
  review_count: number;
  linked_from: { id: string; statement: string; type: string }[];
}

/**
 * What deleting an assumption deletes, as the other delete dialogs say it: the assumption, its
 * reviews, and the links to it from other assumptions, which go with it.
 */
export function entryImpactWords(one: string, i: Pick<EntryImpact, "review_count" | "linked_from">): string {
  return `This deletes ${listed([
    `the ${one}`,
    i.review_count > 0 && `its ${plural(i.review_count, "review")}`,
    i.linked_from.length > 0 && `the links to it from ${plural(i.linked_from.length, "other assumption")}`,
  ])}.`;
}

export function RegisterEntryPage({ kind }: { kind: Kind }) {
  const { id = "" } = useParams();
  const { api: base, app, canWrite, canDelete } = useProduct();
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const copyLink = useCopyLink();
  const q = useQuery({ queryKey: ["entry", base, kind, id], queryFn: () => api<RegisterEntry>("GET", `${base}/${kind}/${id}`) });
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
  const listPath = `${app}/exploration/${kind}`;
  const crumbsFor = (label: string) => [{ label: TITLE[kind], to: listPath }, { label }];
  if (q.isPending) return <Loading lines={6} variant="lines" />;
  const deleted = deletedSentence(q.error);
  if (deleted)
    return (
      <>
        <PageHeader crumbs={crumbsFor(`Deleted ${ONE[kind].toLowerCase()}`)} title={`This ${ONE[kind].toLowerCase()} was deleted`} />
        <EmptyState action={<ButtonLink to={listPath}>Back to {TITLE[kind]}</ButtonLink>}>{deleted}</EmptyState>
      </>
    );
  if (q.isError)
    return (
      <>
        <PageHeader crumbs={crumbsFor(ONE[kind])} title={`This ${ONE[kind].toLowerCase()} couldn’t be loaded`} />
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      </>
    );
  const e = q.data;
  const s = statusOf(e.status);
  const archived = Boolean(e.archived_at);
  const canReview = canWrite && !archived && e.status !== "superseded";
  const outLinks = e.links.map((l) => ({ key: `out:${l.id}:${l.type}`, word: LINK_WORD[l.type]?.[0] ?? l.type, kind: l.kind ?? kind.slice(0, -1), id: l.id, statement: l.statement ?? "An entry", status: l.status }));
  const inLinks = e.linked_from.map((l) => ({ key: `in:${l.id}:${l.type}`, word: LINK_WORD[l.type]?.[1] ?? l.type, kind: l.kind, id: l.id, statement: l.statement, status: l.status }));
  const links = [...outLinks, ...inLinks];
  const corrections = e.linked_from.filter((l) => l.type === "supersedes");

  return (
    <>
      <PageHeader
        crumbs={crumbsFor(ONE[kind])}
        title={e.statement}
        meta={
          <>
            <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
            <span className="sep-dot" aria-hidden="true" />
            <span className="entry-written">
              {e.author_type === "agent" ? "Drafted by" : "Recorded by"} <Byline actor={e.author} agent={e.author_type === "agent"} />{" "}
              <time dateTime={e.created_at}>· {relativeTime(e.created_at)}</time>
            </span>
            {e.frozen ? (
              <>
                <span className="sep-dot" aria-hidden="true" />
                <span title="Frozen at the first review. To correct it, ask your agent to supersede it.">Wording frozen</span>
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
            {(canWrite && !archived) || canDelete ? (
              <Menu label="More actions" triggerClassName="icon-btn icon-btn-md" trigger={<Glyph name="ellipsis" />} align="end">
                {canWrite && !archived && !e.frozen ? (
                  <MenuItem icon="pencil" onSelect={() => navigate(`${listPath}/${e.id}/edit`)}>
                    Edit
                  </MenuItem>
                ) : null}
                {canWrite && !archived ? (
                  <>
                    <MenuItem icon="archive" onSelect={() => setArchived.mutate({ archived: true, etag: e.etag, undo: true })}>
                      Archive
                    </MenuItem>
                    <MenuNote>Archiving takes it out of lists and search. Nothing is erased.</MenuNote>
                  </>
                ) : null}
                {canDelete ? (
                  <>
                    {/* Only what an editor can do sits above it: an archived one's menu holds Delete alone. */}
                    {canWrite && !archived ? <MenuSeparator /> : null}
                    <MenuItem icon="trash" tone="danger" onSelect={() => setDeleting(true)}>
                      Delete permanently…
                    </MenuItem>
                  </>
                ) : null}
              </Menu>
            ) : null}
          </>
        }
      />
      {setArchived.isError ? <ErrorCallout error={setArchived.error} onRetry={() => setArchived.reset()} retryLabel="Dismiss" /> : null}
      {deleting ? (
        <DeleteDialog<EntryImpact>
          title={`Delete this ${ONE[kind].toLowerCase()} permanently?`}
          impactPath={`${base}/${kind}/${e.id}/delete-impact`}
          deletePath={`${base}/${kind}/${e.id}`}
          alternative={archived || !canWrite ? undefined : { label: "Archive instead", onSelect: () => setArchived.mutate({ archived: true, etag: e.etag, undo: true }) }}
          renderImpact={(i) => <p>{entryImpactWords(ONE[kind].toLowerCase(), i)}</p>}
          onDeleted={() => {
            void qc.invalidateQueries({ queryKey: ["register", base, kind] });
            void qc.invalidateQueries({ queryKey: ["product"] });
            toast(`Deleted ${quotedAtEnd(e.statement)} The activity log records who, when and why.`);
            navigate(listPath);
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
      {e.status === "superseded" ? (
        <Callout tone="info" title="Replaced by a correction">
          {corrections.length
            ? corrections.map((l) => (
                <Link key={l.id} to={`${app}/exploration/${l.kind}s/${l.id}`}>
                  Read the correction
                </Link>
              ))
            : null}
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
          It can’t be reviewed until it’s restored.
        </Callout>
      ) : null}
      {e.body ? (
        <Sheet label={ONE[kind]}>
          <div className="entry-prose">
            <Markdown source={e.body} />
          </div>
        </Sheet>
      ) : null}

      {links.length ? (
        <Sheet labelledBy="links-h">
          <SheetHeader id="links-h" title="Related entries" count={links.length} />
          {links.map((l) => {
            const ls = l.status ? statusOf(l.status) : null;
            return (
              <ListRow key={l.key} to={`${app}/exploration/${l.kind}s/${l.id}`} lead={l.word} className="register-link-row" title={l.statement} end={ls ? <StatusBadge tone={ls.tone}>{ls.label}</StatusBadge> : undefined} />
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
          <EmptyState size="inline">Not reviewed yet.</EmptyState>
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

// ---- New or edit --------------------------------------------------------------------------------

const WHY_HINT: Record<Kind, string> = {
  assumptions: "What it rests on. Markdown.",
};

/**
 * A new entry, or an edit to one nobody has reviewed yet. A person writes the statement, why, and
 * the outcomes it bears on, until the first review freezes the wording.
 */
export function EntryEditPage({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const ctx = useProduct();
  const { api: base, app, canWrite } = ctx;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["entry", base, kind, id], enabled: Boolean(id), queryFn: () => api<RegisterEntry>("GET", `${base}/${kind}/${id}`) });
  const outcomes = useQuery({ queryKey: ["outcomes", base, false], queryFn: () => api<{ items: { outcome_id: string; title: string }[] }>("GET", `${base}/outcomes`) });
  const heading = id ? `Edit ${ONE[kind].toLowerCase()}` : `New ${ONE[kind].toLowerCase()}`;
  usePageTitle(heading);
  const listPath = `${app}/exploration/${kind}`;
  const crumbs = [{ label: TITLE[kind], to: listPath }, ...(existing.data ? [{ label: existing.data.statement, to: `${listPath}/${existing.data.id}` }] : []), { label: id ? "Edit" : heading }];
  if (!canWrite)
    return (
      <>
        <PageHeader crumbs={crumbs} title={heading} />
        <Callout tone="info" title={`You can’t record ${kind} here`}>
          {cannotWriteReason(ctx)}
        </Callout>
      </>
    );
  if (id && existing.isPending) return <Loading lines={6} variant="lines" />;
  if (existing.isError)
    return (
      <>
        <PageHeader crumbs={crumbs} title={heading} />
        <ErrorCallout error={existing.error} onRetry={() => existing.refetch()} />
      </>
    );
  if (existing.data?.frozen)
    return (
      <>
        <PageHeader crumbs={crumbs} title={heading} />
        <Callout tone="info" title="The wording froze at the first review" action={<ButtonLink size="sm" to={`${listPath}/${existing.data.id}`}>Back to the entry</ButtonLink>}>
          To correct it, ask your agent to supersede it with a corrected entry.
        </Callout>
      </>
    );
  return (
    <EntryForm
      key={id ?? "new"}
      kind={kind}
      crumbs={crumbs}
      heading={heading}
      initial={existing.data}
      outcomes={outcomes.data?.items ?? []}
      preselect={params.get("outcome_id")}
      onSaved={(saved) => {
        void qc.invalidateQueries({ queryKey: ["register", base, kind] });
        void qc.invalidateQueries({ queryKey: ["entry", base, kind, saved] });
        void qc.invalidateQueries({ queryKey: ["outcomes", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        navigate(`${listPath}/${saved}`);
      }}
    />
  );
}

function EntryForm({ kind, crumbs, heading, initial, outcomes, preselect, onSaved }: {
  kind: Kind;
  crumbs: { label: string; to?: string }[];
  heading: string;
  initial?: RegisterEntry;
  outcomes: { outcome_id: string; title: string }[];
  preselect: string | null;
  onSaved: (id: string) => void;
}) {
  const { api: base, app } = useProduct();
  const [statement, setStatement] = useState(initial?.statement ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [objs, setObjs] = useState<string[]>(initial?.outcome_ids ?? (preselect ? [preselect] : []));
  // After a 409 the newer version is loaded here; saving again writes over it (theirs stays in history).
  const [theirs, setTheirs] = useState<RegisterEntry | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (initial) {
        await api("PATCH", `${base}/${kind}/${initial.id}`, { expected_etag: theirs?.etag ?? initial.etag, statement, body, outcome_ids: objs });
        return initial.id;
      }
      const r = await api<RegisterEntry>("POST", `${base}/${kind}`, { statement, body, outcome_ids: objs });
      return r.id;
    },
    onSuccess: onSaved,
    onError: async (e) => {
      if (initial && e instanceof ApiError && e.code === "stale_etag") setTheirs(await api<RegisterEntry>("GET", `${base}/${kind}/${initial.id}`).catch(() => null));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  const frozenNow = theirs?.frozen;
  const one = ONE[kind].toLowerCase();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader crumbs={crumbs} title={heading} description={MEANING[kind]} />
      <Sheet label={ONE[kind]} className="entry-form">
        <FormGrid>
          <TextArea
            label="Statement"
            required
            maxLength={1000}
            rows={2}
            className="entry-statement"
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            autoFocus={!initial}
            hint={`The ${one} in one sentence.`}
          />
          <TextArea label="Why" optional maxLength={10_000} rows={6} value={body} onChange={(e) => setBody(e.target.value)} hint={WHY_HINT[kind]} />
          <div className="field" role="group" aria-labelledby="entry-outcomes">
            <span className="field-label" id="entry-outcomes">
              Outcomes it bears on
            </span>
            <div className="field-control entry-choices">
              {outcomes.length ? (
                outcomes.map((o) => (
                  <ChoiceRow
                    key={o.outcome_id}
                    label={o.title}
                    checked={objs.includes(o.outcome_id)}
                    onChange={(e) => setObjs(e.target.checked ? [...objs, o.outcome_id] : objs.filter((x) => x !== o.outcome_id))}
                  />
                ))
              ) : (
                <p className="faint entry-choice-empty">
                  No outcomes yet. <Link to={`${app}/idea`}>Add them on Idea</Link>.
                </p>
              )}
            </div>
          </div>
        </FormGrid>
        {stale ? (
          <div className="entry-form-notice">
            <Callout tone="attention" inset title={frozenNow ? "Someone reviewed this entry while you were editing" : "Someone changed this entry while you were editing"}>
              {frozenNow
                ? "Its wording is now frozen, so your change can’t be saved. Copy your text, and ask your agent to supersede the entry with it."
                : theirs
                  ? <>Their version: <strong>{theirs.statement}</strong>. Your text is still here. Saving again replaces theirs, which is kept as an earlier version.</>
                  : "Your text is still here. Copy what you need, reload to see their version, and apply your change again."}
            </Callout>
          </div>
        ) : save.isError ? (
          <div className="entry-form-notice">
            <ErrorCallout error={save.error} inset />
          </div>
        ) : null}
        <div className="entry-form-actions">
          <Button type="submit" variant="primary" disabled={!statement.trim() || Boolean(frozenNow)} busy={save.isPending} busyLabel="Saving…">
            {stale && theirs ? "Save mine over theirs" : initial ? "Save changes" : `Save ${one}`}
          </Button>
          <ButtonLink to={initial ? `${app}/exploration/${kind}/${initial.id}` : `${app}/exploration/${kind}`}>Cancel</ButtonLink>
        </div>
      </Sheet>
    </form>
  );
}
