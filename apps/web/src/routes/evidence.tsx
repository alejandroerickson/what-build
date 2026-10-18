import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { attribution, formatDate, formatDateTime, plural, relativeTime } from "../lib/format.ts";
import { markdownText } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus } from "../lib/status.ts";
import type { RecordSummary, SourceFacets } from "../lib/types.ts";
import { PanelContext, PanelFilter, PanelSection, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, EmptyState, ErrorCallout, FiltersInUse, Glyph, Loading, Menu, MenuRadio, Segmented, Sheet, SheetHeader, StatusBadge, Tag,
} from "../ui/index.tsx";
import { FirstUse } from "./first-use.tsx";
import "../styles/screens/evidence.css";

/** The tags in use on the product's sources, most used first, and the people who added sources. */
export function useSourceFacets(includeArchived = false) {
  const { api: base } = useProduct();
  return useQuery({
    queryKey: ["sources", base, "facets", includeArchived],
    queryFn: () => api<SourceFacets>("GET", `${base}/sources/facets${qs({ include_archived: includeArchived ? "true" : "" })}`),
    staleTime: 60_000,
  });
}

/** Split "a, b, a" into ["a", "b"]: tags are typed comma-separated. */
export function splitTags(s: string): string[] {
  return [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
}

/**
 * The product's most used tags that a comma-separated tag field does not hold yet, each a button
 * that adds it, so a team keeps one word for one thing.
 */
export function TagSuggestions({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const facets = useSourceFacets();
  const have = new Set(splitTags(value).map((t) => t.toLowerCase()));
  const offered = (facets.data?.tags ?? []).filter((t) => !have.has(t.tag)).slice(0, 10);
  if (!offered.length) return null;
  return (
    <div className="tag-suggestions" role="group" aria-label="Tags used in this product">
      <span className="tag-suggestions-key">Used here</span>
      {offered.map((t) => (
        <button key={t.tag} type="button" className="tag tag-suggestion" onClick={() => onChange([...splitTags(value), t.tag].join(", "))} aria-label={`Add the tag ${t.tag}`}>
          <Glyph name="plus" size="sm" />
          {t.tag}
        </button>
      ))}
    </div>
  );
}

const FILTER_KEYS = ["tags", "added_by", "date_from", "date_to", "query", "include_archived"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

export function SourceStatus({ status }: { status: string }) {
  const s = derivedStatus(status);
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

function readFilters(params: URLSearchParams): Filters {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Filters;
}

export function AddSourceButton() {
  const { app } = useProduct();
  return (
    <ButtonLink to={`${app}/evidence/new`} icon="plus">
      Add source
    </ButtonLink>
  );
}

/** How many of a list to show before "All N". */
const SHOWN = 8;

/**
 * The Evidence panel context: single-select filters as links: tags, who
 * added the source, and whether archived ones are listed. Used on the list (where the links
 * change the list in place) and on a source page (where they lead back to it).
 */
export function EvidenceFilters() {
  const { app } = useProduct();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const onList = /\/evidence\/?$/.test(pathname);
  const f = onList ? readFilters(params) : readFilters(new URLSearchParams());
  const [allTags, setAllTags] = useState(false);
  const [allPeople, setAllPeople] = useState(false);
  const facets = useSourceFacets(f.include_archived === "1");
  const href = (patch: Partial<Filters>) => {
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = k in patch ? patch[k] : f[k];
      if (v) next.set(k, v);
    }
    // A filter keeps the list's order.
    if (onList && params.get("sort")) next.set("sort", params.get("sort")!);
    if (onList && params.get("order")) next.set("order", params.get("order")!);
    const s = next.toString();
    return `${app}/evidence${s ? `?${s}` : ""}`;
  };
  const active = FILTER_KEYS.some((k) => f[k]);
  const tags = facets.data?.tags ?? [];
  const shownTags = allTags ? tags : tags.slice(0, SHOWN);
  if (f.tags && !shownTags.some((t) => t.tag === f.tags)) shownTags.push({ tag: f.tags, count: tags.find((t) => t.tag === f.tags)?.count ?? 0 });
  const people = facets.data?.added_by ?? [];
  const shownPeople = allPeople ? people : people.slice(0, SHOWN);
  if (f.added_by && !shownPeople.some((p) => p.account_id === f.added_by)) {
    const p = people.find((x) => x.account_id === f.added_by);
    shownPeople.push(p ?? { account_id: f.added_by, display_name: "Someone", count: 0 });
  }
  const total = facets.data?.sources;
  const more = (n: number, open: boolean, toggle: () => void) =>
    n > SHOWN ? (
      <button type="button" className="panel-text-button" onClick={toggle} aria-expanded={open}>
        {open ? "Fewer" : `All ${n}`}
      </button>
    ) : undefined;
  return (
    <PanelContext label="Filter sources">
      {active && onList ? (
        <div className="source-panel-clear">
          <Link to={href(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))} className="panel-text-button" replace>
            Clear filters
          </Link>
        </div>
      ) : null}
      <PanelSection title="Tags" end={more(tags.length, allTags, () => setAllTags(!allTags))}>
        <PanelFilter to={href({ tags: "" })} current={onList && !f.tags} count={total}>
          All tags
        </PanelFilter>
        {shownTags.map((t) => (
          <PanelFilter key={t.tag} to={href({ tags: t.tag })} current={onList && f.tags === t.tag} count={t.count}>
            {t.tag}
          </PanelFilter>
        ))}
        {facets.isSuccess && !tags.length ? <p className="source-panel-note">No tags yet.</p> : null}
      </PanelSection>
      {people.length > 1 || f.added_by ? (
        <PanelSection title="Added by" end={more(people.length, allPeople, () => setAllPeople(!allPeople))}>
          <PanelFilter to={href({ added_by: "" })} current={onList && !f.added_by} count={total}>
            Anyone
          </PanelFilter>
          {shownPeople.map((p) => (
            <PanelFilter key={p.account_id} to={href({ added_by: p.account_id })} current={onList && f.added_by === p.account_id} count={p.count}>
              {p.display_name}
            </PanelFilter>
          ))}
        </PanelSection>
      ) : null}
      <PanelSection title="Archived">
        <PanelFilter to={href({ include_archived: "" })} current={onList && f.include_archived !== "1"}>
          Hide archived
        </PanelFilter>
        <PanelFilter to={href({ include_archived: "1" })} current={onList && f.include_archived === "1"}>
          Include archived
        </PanelFilter>
      </PanelSection>
    </PanelContext>
  );
}

/**
 * List orders. Three are dates: captured (the source's own date, when the evidence happened, and
 * the default), added to WhatBuild, and details updated (its title, date or tags last changed, or
 * it moved here from another product, or was archived or restored; not its text, summary, notes,
 * comments or attachments).
 * Choosing the current order again reverses it.
 */
const SORTS = [
  { id: "date", label: "Date captured", first: "desc", desc: "newest first", asc: "oldest first" },
  { id: "added", label: "Date added", first: "desc", desc: "newest first", asc: "oldest first" },
  { id: "updated", label: "Details updated", first: "desc", desc: "newest first", asc: "oldest first" },
  { id: "title", label: "Title", first: "asc", desc: "Z to A", asc: "A to Z" },
] as const;
type Sort = (typeof SORTS)[number]["id"];
type Order = "asc" | "desc";

/** The direction mark beside the current order: up for ascending, down for descending. */
function OrderMark({ order }: { order: Order }) {
  return <Glyph name="triangle" size="sm" className={`sort-mark${order === "desc" ? " is-desc" : ""}`} />;
}

/**
 * "Sort by" and the orders as a segmented control; on the narrowest screens, the same choices in a
 * menu. Each choice is a link: the current one reverses the direction.
 */
function SortControl({ sort, order, link }: { sort: Sort; order: Order; link: (id: Sort) => string }) {
  const navigate = useNavigate();
  const current = SORTS.find((s) => s.id === sort)!;
  return (
    <div className="sources-sort">
      <span className="sources-sort-key" aria-hidden="true">
        Sort by
      </span>
      <Segmented
        label="Sort sources by"
        className="sources-sort-wide"
        value={sort}
        items={SORTS.map((s) => ({
          id: s.id,
          to: link(s.id),
          label:
            s.id === sort ? (
              <>
                {s.label}
                <OrderMark order={order} />
                <span className="visually-hidden">, {s[order]}</span>
              </>
            ) : (
              s.label
            ),
        }))}
      />
      <Menu
        label={`Sort sources by ${current.label.toLowerCase()}, ${current[order]}`}
        trigger={
          <>
            {current.label}
            <OrderMark order={order} />
          </>
        }
        triggerClassName="menu-trigger sources-sort-narrow"
        align="start"
      >
        {SORTS.map((s) => (
          <MenuRadio key={s.id} checked={s.id === sort} meta={s.id === sort ? <OrderMark order={order} /> : undefined} onSelect={() => navigate(link(s.id))}>
            {s.label}
          </MenuRadio>
        ))}
      </Menu>
    </div>
  );
}

/**
 * The Sources heading's count. With every page loaded it is the rows; while more pages wait, the
 * facets still know the exact number when nothing narrows the list or one tag or one person does,
 * and only otherwise is it "50+". `of` is " of N" when filters narrow the product's live sources.
 */
export function sourcesCount({ loaded, more, filters, facets, of = "" }: { loaded: number; more: boolean; filters: Partial<Filters>; facets: SourceFacets | undefined; of?: string }): string {
  if (!more) return `${loaded}${of}`;
  const narrowing = FILTER_KEYS.filter((k) => k !== "include_archived" && filters[k]);
  const tags = filters.tags ? splitTags(filters.tags) : [];
  const known =
    !narrowing.length ? facets?.sources
    : narrowing.length > 1 ? undefined
    : tags.length === 1 ? facets?.tags.find((t) => t.tag === tags[0]!.toLowerCase())?.count
    : filters.added_by ? facets?.added_by.find((p) => p.account_id === filters.added_by)?.count
    : undefined;
  return known !== undefined ? `${known}${of}` : `${loaded}+${of}`;
}

/** Whether the list shows every source's summary, kept for the person in this browser. */
const SUMMARIES_KEY = "whatbuild.sources.summaries";

function useShowSummaries(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SUMMARIES_KEY) === "shown";
    } catch {
      return false;
    }
  });
  const save = (next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(SUMMARIES_KEY, "shown");
      else localStorage.removeItem(SUMMARIES_KEY);
    } catch {
      // The choice lasts for this visit.
    }
  };
  return [on, save];
}

/**
 * A row's one date: the one the list is ordered by. The date captured by default, and "2 h ago"
 * when the list is ordered by date added or details updated (or by title, which shows when it was
 * added), with who did it in its tooltip.
 */
function rowDate(r: RecordSummary, sort: Sort): { text: string; said: string; title: string; none?: boolean } {
  if (sort === "added" || sort === "title") return { text: relativeTime(r.uploaded_at), said: "Added", title: `Added ${formatDateTime(r.uploaded_at)} by ${attribution(r.uploaded_by)}` };
  if (sort === "updated") return { text: relativeTime(r.updated_at), said: "Details updated", title: `Details updated ${formatDateTime(r.updated_at)} by ${attribution(r.updated_by)}` };
  if (r.date) return { text: formatDate(r.date), said: "Captured", title: "Date captured" };
  return { text: "No date", said: "", title: "No date captured", none: true };
}

/**
 * One source in the list. The title is the link, stretched over the whole row; a row with a
 * summary leads with a toggle that unfolds its first three lines under the tags.
 */
function SourceRow({ r, to, sort, twin, open, onToggle, toggles }: {
  r: RecordSummary;
  to: string;
  sort: Sort;
  twin: boolean;
  open: boolean;
  onToggle: () => void;
  /** Whether any row in the list has a summary, so every row keeps the toggle's column. */
  toggles: boolean;
}) {
  const status = r.derived_status === "ready" ? null : derivedStatus(r.derived_status);
  const twinNote = twin ? (r.text_from ? r.text_from.split("/").pop() : r.attachment_count ? plural(r.attachment_count, "attachment") : "No attachment yet") : null;
  const date = rowDate(r, sort);
  const summaryId = `source-summary-${r.record_id}`;
  return (
    <li className={`list-row source-row${r.archived_at ? " is-archived" : ""}`}>
      {toggles ? (
        r.summary ? (
          <button type="button" className="icon-btn icon-btn-sm source-row-toggle" aria-expanded={open} aria-controls={summaryId} aria-label={`Summary of ${r.title}`} onClick={onToggle}>
            <Glyph name="chevron-right" />
          </button>
        ) : (
          <span className="source-row-toggle" aria-hidden="true" />
        )
      ) : null}
      <span className="list-main">
        <Link to={to} className="list-title source-row-link">
          {r.title}
        </Link>
        {r.tags.length || twinNote ? (
          <span className="list-sub source-row-sub">
            {r.tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            {r.tags.length > 3 ? <span title={r.tags.slice(3).join(", ")}>+{r.tags.length - 3}</span> : null}
            {twinNote ? <span>{twinNote}</span> : null}
          </span>
        ) : null}
        {r.summary ? (
          <span id={summaryId} className="source-row-summary" hidden={!open}>
            {markdownText(r.summary)}
          </span>
        ) : null}
      </span>
      <span className="list-end">
        <span className="source-row-count num">
          {r.archived_at ? (
            <StatusBadge tone="neutral">Archived</StatusBadge>
          ) : status ? (
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          ) : r.attachment_count ? (
            <span className="source-row-attachments" title={plural(r.attachment_count, "attachment")}>
              <Glyph name="paperclip" size="sm" />
              <span aria-hidden="true">{r.attachment_count}</span>
              <span className="visually-hidden">{plural(r.attachment_count, "attachment")}</span>
            </span>
          ) : null}
        </span>
        <span className={`source-row-date num${date.none ? " is-none" : ""}`} title={date.title}>
          {date.said ? <span className="visually-hidden">{date.said} </span> : null}
          {date.text}
        </span>
      </span>
    </li>
  );
}

export function EvidencePage() {
  const { api: base, app, canWrite, product } = useProduct();
  const [params] = useSearchParams();
  const f = readFilters(params);
  const sort: Sort = SORTS.find((s) => s.id === params.get("sort"))?.id ?? "date";
  const first: Order = SORTS.find((s) => s.id === sort)!.first;
  const order: Order = params.get("order") === "asc" || params.get("order") === "desc" ? (params.get("order") as Order) : first;
  usePageTitle("Sources");
  const facets = useSourceFacets(f.include_archived === "1");
  const q = useInfiniteQuery({
    queryKey: ["sources", base, f, sort, order],
    queryFn: ({ pageParam }) =>
      api<{ records: RecordSummary[]; next_cursor: string | null }>(
        "GET",
        `${base}/sources${qs({ ...f, include_archived: f.include_archived === "1" ? "true" : "", include_summary: "true", sort, order, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const records = q.data?.pages.flatMap((p) => p.records) ?? [];
  // Summaries: shown for every row or none, and each row can be turned the other way.
  const [allShown, setAllShown] = useShowSummaries();
  const [turned, setTurned] = useState<ReadonlySet<string>>(new Set());
  const summarized = records.filter((r) => r.summary);
  const isOpen = (id: string) => allShown !== turned.has(id);
  const everyOpen = summarized.length > 0 && summarized.every((r) => isOpen(r.record_id));
  const turn = (id: string) =>
    setTurned((t) => {
      const next = new Set(t);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const showAll = (on: boolean) => {
    setAllShown(on);
    setTurned(new Set());
  };
  // Titles shared by more than one listed source: those rows also name the attachment their text was read from.
  const titleCount = new Map<string, number>();
  for (const r of records) titleCount.set(r.title.trim().toLowerCase(), (titleCount.get(r.title.trim().toLowerCase()) ?? 0) + 1);
  // The current order's link reverses it; another order starts from its usual direction.
  const sortLink = (id: Sort) => {
    const next = new URLSearchParams(params);
    if (id === "date") next.delete("sort");
    else next.set("sort", id);
    const flip = order === "asc" ? "desc" : "asc";
    if (id === sort && flip !== first) next.set("order", flip);
    else next.delete("order");
    const s = next.toString();
    return `${app}/evidence${s ? `?${s}` : ""}`;
  };
  const active = FILTER_KEYS.filter((k) => f[k]);
  const without = (keys: (keyof Filters)[]) => {
    const next = new URLSearchParams(params);
    for (const k of keys) next.delete(k);
    const s = next.toString();
    return `${app}/evidence${s ? `?${s}` : ""}`;
  };
  const chips: { label: string; to: string }[] = [];
  // sources.list matches the words in titles, tags and attachment names, never in what sources say.
  if (f.query) chips.push({ label: `“${f.query}” in titles, tags or attachment names`, to: without(["query"]) });
  if (f.tags) chips.push({ label: `Tagged ${splitTags(f.tags).join(", ")}`, to: without(["tags"]) });
  if (f.added_by) chips.push({ label: `Added by ${facets.data?.added_by.find((p) => p.account_id === f.added_by)?.display_name ?? "one person"}`, to: without(["added_by"]) });
  if (f.date_from || f.date_to) chips.push({ label: `Captured ${f.date_from ? formatDate(f.date_from) : "any time"} to ${f.date_to ? formatDate(f.date_to) : "now"}`, to: without(["date_from", "date_to"]) });
  if (f.include_archived === "1") chips.push({ label: "Including archived", to: without(["include_archived"]) });
  // "of N" compares with the product's live sources, so it is left out once archived ones are listed.
  const total = active.length && f.include_archived !== "1" ? ` of ${product.counts.sources}` : "";
  const count = q.isSuccess ? sourcesCount({ loaded: records.length, more: q.hasNextPage, filters: f, facets: facets.data, of: total }) : undefined;
  return (
    <>
      <EvidenceFilters />
      <Sheet className="sources-sheet">
        <SheetHeader
          level={1}
          title="Sources"
          count={count}
          filter={<SortControl sort={sort} order={order} link={sortLink} />}
          end={
            summarized.length || canWrite ? (
              <>
                {summarized.length ? (
                  <Button variant="quiet" icon={everyOpen ? "fold" : "unfold"} onClick={() => showAll(!everyOpen)}>
                    {everyOpen ? "Hide summaries" : "Show summaries"}
                  </Button>
                ) : null}
                {canWrite ? <AddSourceButton /> : null}
              </>
            ) : undefined
          }
        />
        <FiltersInUse chips={chips} clearTo={without([...FILTER_KEYS])} />
        {q.isPending ? (
          <Loading label="Loading sources…" lines={6} />
        ) : q.isError ? (
          <div className="sheet-body">
            <ErrorCallout inset title="Sources couldn’t be loaded" error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !records.length ? (
          active.length && (product.counts.sources ?? 0) > 0 ? (
            f.query && chips.length === 1 ? (
              <EmptyState size="inline" title={`No titles, tags or attachment names hold “${f.query}”`} action={<ButtonLink to={without(["query"])}>Clear the search</ButtonLink>}>
                Use Search to find what sources say.
              </EmptyState>
            ) : (
              <EmptyState size="inline" title="No sources match these filters" action={<ButtonLink to={`${app}/evidence`}>Clear filters</ButtonLink>} />
            )
          ) : (
            <FirstUse title="No sources yet" ask={`Add these meeting notes to ${product.name} in WhatBuild as a source.`}>
              Anything the team learns from: meeting notes, transcripts, documents, whiteboard photos.
            </FirstUse>
          )
        ) : (
          <>
            <ul className={`sources-rows${summarized.length ? " has-toggles" : ""}`}>
              {records.map((r) => (
                <SourceRow
                  key={r.record_id}
                  r={r}
                  to={`${app}/evidence/${r.record_id}`}
                  sort={sort}
                  twin={(titleCount.get(r.title.trim().toLowerCase()) ?? 0) > 1}
                  open={Boolean(r.summary) && isOpen(r.record_id)}
                  onToggle={() => turn(r.record_id)}
                  toggles={summarized.length > 0}
                />
              ))}
            </ul>
            {q.hasNextPage ? (
              <div className="sources-more">
                <Button size="sm" onClick={() => q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading…">
                  Show more sources
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Sheet>
    </>
  );
}
