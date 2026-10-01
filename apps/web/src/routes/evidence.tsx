import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { actorName, formatDate, plural, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus } from "../lib/status.ts";
import type { KindsResponse, RecordSummary } from "../lib/types.ts";
import { PanelContext, PanelFilter, PanelSection, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, EmptyState, ErrorCallout, FiltersInUse, FindField, Glyph, ListRow, Loading, Menu, MenuGroup, MenuItem, MenuNote, MenuRadio, MenuSeparator, Segmented, Sheet,
  SheetHeader, StatusBadge, type GlyphName,
} from "../ui/index.tsx";
import { FirstUse } from "./first-use.tsx";
import "../styles/screens/evidence.css";

export function useKinds() {
  return useQuery({ queryKey: ["kinds"], queryFn: () => api<KindsResponse>("GET", "/api/v1/kinds"), staleTime: Infinity });
}

/** A kind group's folder, as sources.list's `folder` filter takes it. */
export function folderForGroup(group: string) {
  return group === "other" ? "misc" : group;
}

const FILTER_KEYS = ["folder", "kind", "organization", "date_from", "date_to", "tags", "query", "include_archived"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

export function SourceStatus({ status }: { status: string }) {
  const s = derivedStatus(status);
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

function readFilters(params: URLSearchParams): Filters {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Filters;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Date presets for the date captured (when the interview happened, not when it was added). */
function datePresets(now = new Date()) {
  const y = now.getFullYear();
  const back = (days: number) => iso(new Date(now.getTime() - days * 86400000));
  return [
    { id: "any", label: "Any date", from: "", to: "" },
    { id: "30", label: "Past 30 days", from: back(30), to: "" },
    { id: "90", label: "Past 90 days", from: back(90), to: "" },
    { id: "year", label: String(y), from: `${y}-01-01`, to: `${y}-12-31` },
    { id: "last", label: String(y - 1), from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

/** Kind-first "Add source": the common kinds, then the full wizard for everything else. */
const ADD_KINDS: { kind: string; icon: GlyphName }[] = [
  { kind: "interview_transcript", icon: "file-text" },
  { kind: "interview_recording", icon: "mic" },
  { kind: "interviewer_notes", icon: "pencil" },
  { kind: "sales_call_transcript", icon: "file-text" },
  { kind: "sales_call_recording", icon: "mic" },
  { kind: "user_research_export", icon: "users" },
];

export function AddSourceMenu() {
  const { app } = useProduct();
  const kinds = useKinds();
  return (
    <Menu
      trigger={
        <>
          <Glyph name="plus" />
          Add source
        </>
      }
      triggerClassName="btn btn-secondary btn-md"
      align="end"
      minWidth={260}
    >
      <MenuGroup label="What are you adding?">
        {ADD_KINDS.map((k) => (
          <MenuItem key={k.kind} icon={k.icon} to={`${app}/evidence/new?kind=${k.kind}`}>
            {kinds.data?.kinds.find((x) => x.kind === k.kind)?.label ?? k.kind.replace(/_/g, " ")}
          </MenuItem>
        ))}
        <MenuItem icon="folder-input" to={`${app}/evidence/new`}>
          A document, deck or something else…
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuNote>WhatBuild files it for you. Only the primary file is parsed into passages and searched.</MenuNote>
    </Menu>
  );
}

/**
 * The Evidence panel context: "Search passages", then single-select filters as links. Used on the
 * list (where the links change the list in place) and on a source page (where they lead back to it).
 */
export function EvidenceFilters() {
  const { api: base, app } = useProduct();
  const kinds = useKinds();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const onList = /\/evidence\/?$/.test(pathname);
  const f = onList ? readFilters(params) : readFilters(new URLSearchParams());
  const [text, setText] = useState("");
  const [allOrgs, setAllOrgs] = useState(false);
  // The organizations present in this product, for the Organization links. There is no facet
  // operation, so read one page of summaries (metadata only) and collect the names.
  const orgs = useQuery({
    queryKey: ["sources", base, "organizations", f.include_archived],
    queryFn: () => api<{ records: RecordSummary[] }>("GET", `${base}/sources${qs({ limit: 200, include_archived: f.include_archived === "1" ? "true" : "" })}`),
    staleTime: 60_000,
    select: (d) => [...new Set(d.records.map((r) => r.organization).filter((o): o is string => Boolean(o)))].sort((a, b) => a.localeCompare(b)),
  });
  const href = (patch: Partial<Filters>) => {
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = k in patch ? patch[k] : f[k];
      if (v) next.set(k, v);
    }
    // A filter keeps the list's order.
    if (onList && params.get("sort")) next.set("sort", params.get("sort")!);
    const s = next.toString();
    return `${app}/evidence${s ? `?${s}` : ""}`;
  };
  const active = FILTER_KEYS.some((k) => f[k]);
  const kindInfo = kinds.data?.kinds.find((k) => k.kind === f.kind);
  const openFolder = kindInfo ? folderForGroup(kindInfo.group) : f.folder;
  const presets = datePresets();
  const datePreset = presets.find((p) => p.from === f.date_from && p.to === f.date_to);
  const orgList = orgs.data ?? [];
  const shownOrgs = allOrgs ? orgList : orgList.slice(0, 8);
  if (f.organization && !shownOrgs.some((o) => o.toLowerCase() === f.organization.toLowerCase())) shownOrgs.push(f.organization);
  const search = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) navigate(`${app}/search?q=${encodeURIComponent(text.trim())}`);
  };
  return (
    <PanelContext label="Find and filter sources">
      <form className="source-panel-find" role="search" onSubmit={search}>
        <FindField label="Search passages" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
      </form>
      <PanelSection
        title="Kind"
        end={
          active && onList ? (
            <Link to={`${app}/evidence`} className="panel-text-button" replace>
              Clear filters
            </Link>
          ) : undefined
        }
      >
        <PanelFilter to={href({ folder: "", kind: "" })} current={onList && !f.folder && !f.kind}>
          All kinds
        </PanelFilter>
        {kinds.data?.groups.map((g) => {
          const folder = folderForGroup(g.group);
          const open = openFolder === folder;
          return (
            <div key={g.group}>
              <PanelFilter to={href({ folder, kind: "" })} current={onList && f.folder === folder && !f.kind}>
                {g.label}
              </PanelFilter>
              {open && onList
                ? kinds.data.kinds
                    .filter((k) => k.group === g.group)
                    .map((k) => (
                      <PanelFilter key={k.kind} sub to={href({ folder, kind: k.kind })} current={f.kind === k.kind}>
                        {k.label}
                      </PanelFilter>
                    ))
                : null}
            </div>
          );
        })}
      </PanelSection>
      {orgList.length || f.organization ? (
        <PanelSection
          title="Organization"
          end={
            orgList.length > 8 ? (
              <button type="button" className="panel-text-button" onClick={() => setAllOrgs(!allOrgs)} aria-expanded={allOrgs}>
                {allOrgs ? "Fewer" : `All ${orgList.length}`}
              </button>
            ) : undefined
          }
        >
          <PanelFilter to={href({ organization: "" })} current={onList && !f.organization}>
            Any organization
          </PanelFilter>
          {shownOrgs.map((o) => (
            <PanelFilter key={o} to={href({ organization: o })} current={onList && f.organization.toLowerCase() === o.toLowerCase()}>
              {o}
            </PanelFilter>
          ))}
        </PanelSection>
      ) : null}
      <PanelSection title="Date captured">
        {presets.map((p) => (
          <PanelFilter key={p.id} to={href({ date_from: p.from, date_to: p.to })} current={onList && datePreset?.id === p.id}>
            {p.label}
          </PanelFilter>
        ))}
        {onList && !datePreset ? (
          <PanelFilter to={href({})} current>
            {f.date_from ? formatDate(f.date_from) : "Any time"} to {f.date_to ? formatDate(f.date_to) : "now"}
          </PanelFilter>
        ) : null}
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
  const kinds = useKinds();
  const [params] = useSearchParams();
  const f = readFilters(params);
  const sort: Sort = SORTS.find((s) => s.id === params.get("sort"))?.id ?? "date";
  const first: Order = SORTS.find((s) => s.id === sort)!.first;
  const order: Order = params.get("order") === "asc" || params.get("order") === "desc" ? (params.get("order") as Order) : first;
  usePageTitle("Sources");
  const q = useInfiniteQuery({
    queryKey: ["sources", base, f, sort, order],
    queryFn: ({ pageParam }) =>
      api<{ records: RecordSummary[]; next_cursor: string | null }>(
        "GET",
        `${base}/sources${qs({ ...f, include_archived: f.include_archived === "1" ? "true" : "", sort, order, cursor: pageParam, limit: 50 })}`,
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
  const kindLabel = (k: string) => kinds.data?.kinds.find((x) => x.kind === k)?.label ?? k;
  // A folder filter names its kind group; one below it ("interviews/2026", from a source's "Filed
  // in") reads as the group and the rest of the path: "Interviews › 2026".
  const groupLabel = (folder: string) => {
    const [root, ...rest] = folder.split("/").filter(Boolean);
    const label = kinds.data?.groups.find((g) => folderForGroup(g.group) === root)?.label ?? root ?? folder;
    return [label, ...rest].join(" › ");
  };
  const clear = (keys: (keyof Filters)[]) => {
    const next = new URLSearchParams(params);
    for (const k of keys) next.delete(k);
    const s = next.toString();
    return `${app}/evidence${s ? `?${s}` : ""}`;
  };
  const chips: { label: string; to: string }[] = [];
  if (f.kind) chips.push({ label: kindLabel(f.kind), to: clear(["kind"]) });
  else if (f.folder) chips.push({ label: groupLabel(f.folder), to: clear(["folder"]) });
  if (f.organization) chips.push({ label: f.organization, to: clear(["organization"]) });
  if (f.date_from || f.date_to) chips.push({ label: `Captured ${f.date_from ? formatDate(f.date_from) : "any time"} to ${f.date_to ? formatDate(f.date_to) : "now"}`, to: clear(["date_from", "date_to"]) });
  if (f.tags) chips.push({ label: `Tagged ${f.tags}`, to: clear(["tags"]) });
  if (f.query) chips.push({ label: `Matching “${f.query}”`, to: clear(["query"]) });
  if (f.include_archived === "1") chips.push({ label: "Including archived", to: clear(["include_archived"]) });
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
          end={canWrite ? <AddSourceMenu /> : undefined}
        />
        <FiltersInUse chips={chips} clearTo={`${app}/evidence`} />
        {q.isPending ? (
          <Loading label="Loading sources…" lines={6} />
        ) : q.isError ? (
          <div className="sheet-body">
            <ErrorCallout inset title="Sources could not be loaded" error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !records.length ? (
          active.length && product.counts.sources > 0 ? (
            <EmptyState size="inline" title="No sources match these filters" action={<ButtonLink to={`${app}/evidence`}>Clear filters</ButtonLink>} />
          ) : (
            <FirstUse title="No sources yet" ask={`Add these interview notes to ${product.name} in WhatBuild as sources.`}>
              Interviews, sales calls, research exports and documents. WhatBuild parses each one into passages that insights, assumptions and decisions can cite.
            </FirstUse>
          )
        ) : (
          <>
            <div className="sources-rows">
              {records.map((r) => {
                const status = r.derived_status === "ready" ? null : derivedStatus(r.derived_status);
                const twin = (titleCount.get(r.title.trim().toLowerCase()) ?? 0) > 1;
                return (
                  <ListRow
                    key={r.record_id}
                    to={`${app}/evidence/${r.record_id}`}
                    className={r.archived_at ? "source-row is-archived" : "source-row"}
                    title={r.title}
                    sub={[
                      kinds.data?.kinds.find((k) => k.kind === r.kind)?.short ?? r.kind_label,
                      r.organization,
                      r.date ? formatDate(r.date) : sort === "date" ? "No capture date" : null,
                      twin ? (r.primary_file ? r.primary_file.split("/").pop() : "No file yet") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    end={
                      <>
                        <span className="source-row-count num">
                          {r.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : plural(r.segment_count, "passage")}
                        </span>
                        <span className="source-row-added">
                          Updated {relativeTime(r.updated_at)} by {actorName(r.updated_by)}
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
