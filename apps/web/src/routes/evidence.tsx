import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { actorName, formatDate, plural, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus } from "../lib/status.ts";
import type { RecordSummary, SourceFacets } from "../lib/types.ts";
import { PanelContext, PanelFilter, PanelSection, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, EmptyState, ErrorCallout, FiltersInUse, FindField, Glyph, ListRow, Loading, Menu, MenuRadio, Segmented, Sheet, SheetHeader, StatusBadge, Tag,
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

const FILTER_KEYS = ["tags", "added_by", "added", "date_from", "date_to", "query", "include_archived"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

export function SourceStatus({ status }: { status: string }) {
  const s = derivedStatus(status);
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

function readFilters(params: URLSearchParams): Filters {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Filters;
}

/**
 * When a source was added: a discovery may last only a few months, so the windows are short. The
 * URL keeps the window (`added=7`), not a date, so a shared link means the same thing tomorrow.
 */
const ADDED = [
  { id: "", label: "Any time", chip: "" },
  { id: "1", label: "Past day", chip: "Added in the past day" },
  { id: "7", label: "Past 7 days", chip: "Added in the past 7 days" },
  { id: "30", label: "Past 30 days", chip: "Added in the past 30 days" },
  { id: "60", label: "Past 60 days", chip: "Added in the past 60 days" },
  { id: "90", label: "Past 90 days", chip: "Added in the past 90 days" },
] as const;

/** The moment a window of `days` starts, to the minute. */
function addedSince(days: string): string {
  const n = Number(days);
  if (!ADDED.some((a) => a.id && a.id === days)) return "";
  return new Date(Math.floor(Date.now() / 60_000) * 60_000 - n * 86_400_000).toISOString();
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

type FindIn = "passages" | "titles";

/**
 * The panel's search, over passages or titles. Passages opens Search. Titles narrows the list as
 * you type, keeping the words in the URL (`?query=`, which also matches tags and file names); from
 * a source page, Enter opens the list narrowed. Switching to passages takes the words along and
 * drops the title search from the list.
 */
function SourceFind({ onList }: { onList: boolean }) {
  const { app } = useProduct();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = onList ? (params.get("query") ?? "") : "";
  const [findIn, setFindIn] = useState<FindIn>(query ? "titles" : "passages");
  const [text, setText] = useState(query);
  // What this field last wrote, so a change from elsewhere (a chip, Clear filters, going back)
  // reaches it and its own writes, which land a moment later, do not undo newer typing.
  const wrote = useRef(query);
  const mode = useRef(findIn);
  mode.current = findIn;
  useEffect(() => {
    if (query === wrote.current) return;
    wrote.current = query;
    if (query) setFindIn("titles");
    if (query || mode.current === "titles") setText(query);
  }, [query]);
  const narrow = (words: string) => {
    wrote.current = words;
    const next = new URLSearchParams(params);
    if (words) next.set("query", words);
    else next.delete("query");
    setParams(next, { replace: true });
  };
  const type = (v: string) => {
    setText(v);
    if (findIn === "titles" && onList) narrow(v.trim());
  };
  const choose = (id: string) => {
    const next = id as FindIn;
    setFindIn(next);
    if (onList) narrow(next === "titles" ? text.trim() : "");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const words = text.trim();
    if (!words) return;
    if (findIn === "passages") navigate(`${app}/search?q=${encodeURIComponent(words)}`);
    else if (!onList) navigate(`${app}/evidence?query=${encodeURIComponent(words)}`);
  };
  return (
    <form className="source-panel-find" role="search" onSubmit={submit}>
      <FindField
        label={findIn === "passages" ? "Search passages" : "Search titles"}
        value={text}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            e.stopPropagation();
            type("");
          }
        }}
        enterKeyHint="search"
      />
      <Segmented
        label="Search in"
        equal
        value={findIn}
        onChange={choose}
        items={[
          { id: "passages", label: "Passages" },
          { id: "titles", label: "Titles" },
        ]}
      />
    </form>
  );
}

/**
 * The Evidence panel context: "Search passages", then single-select filters as links: tags, who
 * added the source, when, and whether archived ones are listed. Used on the list (where the links
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
    <PanelContext label="Find and filter sources">
      <SourceFind onList={onList} />
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
        {facets.isSuccess && !tags.length ? <p className="source-panel-note">No tags yet. Tag a source to filter by it here.</p> : null}
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
      <PanelSection title="Added">
        {ADDED.map((a) => (
          <PanelFilter key={a.id || "any"} to={href({ added: a.id })} current={onList && f.added === a.id}>
            {a.label}
          </PanelFilter>
        ))}
      </PanelSection>
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
 * List orders. Three are dates, each named as one: captured (the source's own date, when the
 * evidence happened, and the default), added to WhatBuild, and updated (its details last edited).
 * Choosing the current order again reverses it.
 */
const SORTS = [
  { id: "date", label: "Date captured", first: "desc", desc: "newest first", asc: "oldest first" },
  { id: "added", label: "Date added", first: "desc", desc: "newest first", asc: "oldest first" },
  { id: "updated", label: "Date updated", first: "desc", desc: "newest first", asc: "oldest first" },
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

export function EvidencePage() {
  const { api: base, app, canWrite, product } = useProduct();
  const [params] = useSearchParams();
  const f = readFilters(params);
  const sort: Sort = SORTS.find((s) => s.id === params.get("sort"))?.id ?? "date";
  const first: Order = SORTS.find((s) => s.id === sort)!.first;
  const order: Order = params.get("order") === "asc" || params.get("order") === "desc" ? (params.get("order") as Order) : first;
  usePageTitle("Sources");
  const facets = useSourceFacets(f.include_archived === "1");
  // Worked out once per window, so the list's query stays the same while it is open.
  const since = useMemo(() => addedSince(f.added), [f.added]);
  const { added, ...listed } = f;
  void added;
  const q = useInfiniteQuery({
    queryKey: ["sources", base, listed, since, sort, order],
    queryFn: ({ pageParam }) =>
      api<{ records: RecordSummary[]; next_cursor: string | null }>(
        "GET",
        `${base}/sources${qs({ ...listed, added_since: since, include_archived: f.include_archived === "1" ? "true" : "", sort, order, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const records = q.data?.pages.flatMap((p) => p.records) ?? [];
  // Titles shared by more than one listed source: those rows also name their primary file.
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
  if (f.query) chips.push({ label: `Titles matching “${f.query}”`, to: without(["query"]) });
  if (f.tags) chips.push({ label: `Tagged ${splitTags(f.tags).join(", ")}`, to: without(["tags"]) });
  if (f.added_by) chips.push({ label: `Added by ${facets.data?.added_by.find((p) => p.account_id === f.added_by)?.display_name ?? "one person"}`, to: without(["added_by"]) });
  const window = ADDED.find((a) => a.id && a.id === f.added);
  if (window) chips.push({ label: window.chip, to: without(["added"]) });
  if (f.date_from || f.date_to) chips.push({ label: `Captured ${f.date_from ? formatDate(f.date_from) : "any time"} to ${f.date_to ? formatDate(f.date_to) : "now"}`, to: without(["date_from", "date_to"]) });
  if (f.include_archived === "1") chips.push({ label: "Including archived", to: without(["include_archived"]) });
  // "of N" compares with the product's live sources, so it is left out once archived ones are listed.
  const total = active.length && f.include_archived !== "1" ? ` of ${product.counts.sources}` : "";
  const count = q.isSuccess ? `${records.length}${q.hasNextPage ? "+" : ""}${total}` : undefined;
  return (
    <>
      <EvidenceFilters />
      <Sheet className="sources-sheet">
        <SheetHeader
          level={1}
          title="Sources"
          count={count}
          filter={<SortControl sort={sort} order={order} link={sortLink} />}
          end={canWrite ? <AddSourceButton /> : undefined}
        />
        <FiltersInUse chips={chips} clearTo={without([...FILTER_KEYS])} />
        {q.isPending ? (
          <Loading label="Loading sources…" lines={6} />
        ) : q.isError ? (
          <div className="sheet-body">
            <ErrorCallout inset title="Sources could not be loaded" error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !records.length ? (
          active.length && (product.counts.sources ?? 0) > 0 ? (
            f.query && chips.length === 1 ? (
              <EmptyState size="inline" title={`No source titles match “${f.query}”`} action={<ButtonLink to={without(["query"])}>Clear the search</ButtonLink>}>
                A title search looks in titles, tags and file names. To search what sources say, switch the search to Passages.
              </EmptyState>
            ) : (
              <EmptyState size="inline" title="No sources match these filters" action={<ButtonLink to={`${app}/evidence`}>Clear filters</ButtonLink>} />
            )
          ) : (
            <FirstUse title="No sources yet" ask={`Add these meeting notes to ${product.name} in WhatBuild as a source.`}>
              Meeting transcripts and notes, documents, whiteboard photos: anything the team learns from. WhatBuild parses each one into passages that assumptions, mockups and Story pages can cite.
            </FirstUse>
          )
        ) : (
          <>
            <div className="sources-rows">
              {records.map((r) => {
                const status = r.derived_status === "ready" ? null : derivedStatus(r.derived_status);
                const twin = (titleCount.get(r.title.trim().toLowerCase()) ?? 0) > 1;
                const meta = [r.date ? formatDate(r.date) : sort === "date" ? "No capture date" : null, twin ? (r.primary_file ? r.primary_file.split("/").pop() : "No file yet") : null].filter(Boolean);
                const updated = sort === "updated";
                return (
                  <ListRow
                    key={r.record_id}
                    to={`${app}/evidence/${r.record_id}`}
                    className={r.archived_at ? "source-row is-archived" : "source-row"}
                    title={r.title}
                    sub={
                      r.tags.length || meta.length ? (
                        <span className="source-row-sub">
                          {r.tags.slice(0, 3).map((t) => (
                            <Tag key={t}>{t}</Tag>
                          ))}
                          {r.tags.length > 3 ? <span title={r.tags.slice(3).join(", ")}>+{r.tags.length - 3}</span> : null}
                          {meta.length ? <span>{meta.join(" · ")}</span> : null}
                        </span>
                      ) : undefined
                    }
                    end={
                      <>
                        <span className="source-row-count num">
                          {r.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : plural(r.segment_count, "passage")}
                        </span>
                        <span className="source-row-added">
                          {updated ? `Updated ${relativeTime(r.updated_at)} by ${actorName(r.updated_by)}` : `Added ${relativeTime(r.uploaded_at)} by ${actorName(r.uploaded_by)}`}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </div>
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
