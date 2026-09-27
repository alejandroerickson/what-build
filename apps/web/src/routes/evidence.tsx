import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { actorName, formatDate, plural, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus } from "../lib/status.ts";
import type { KindsResponse, RecordSummary } from "../lib/types.ts";
import { PanelContext, PanelSection, usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, EmptyState, ErrorCallout, FindField, Glyph, ListRow, Loading, Menu, MenuGroup, MenuItem, MenuNote, MenuSeparator, Sheet,
  SheetHeader, StatusBadge, type GlyphName,
} from "../ui/index.tsx";
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

/** Date presets for the event date (when the interview happened, not when it was added). */
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
      triggerClassName="btn btn-primary btn-md"
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

/** One single-select filter value in the panel: a real link that sets a URL parameter. */
function FilterLink({ to, current, children, depth = 0 }: { to: string; current: boolean; children: ReactNode; depth?: 0 | 1 }) {
  return (
    <Link to={to} className={`source-filter${depth ? " source-filter-sub" : ""}`} aria-current={current ? "true" : undefined} replace>
      <span className="source-filter-label">{children}</span>
      {current ? <Glyph name="check" size="sm" /> : null}
    </Link>
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
        <FilterLink to={href({ folder: "", kind: "" })} current={onList && !f.folder && !f.kind}>
          All kinds
        </FilterLink>
        {kinds.data?.groups.map((g) => {
          const folder = folderForGroup(g.group);
          const open = openFolder === folder;
          return (
            <div key={g.group}>
              <FilterLink to={href({ folder, kind: "" })} current={onList && f.folder === folder && !f.kind}>
                {g.label}
              </FilterLink>
              {open && onList
                ? kinds.data.kinds
                    .filter((k) => k.group === g.group)
                    .map((k) => (
                      <FilterLink key={k.kind} depth={1} to={href({ folder, kind: k.kind })} current={f.kind === k.kind}>
                        {k.label}
                      </FilterLink>
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
          <FilterLink to={href({ organization: "" })} current={onList && !f.organization}>
            Any organization
          </FilterLink>
          {shownOrgs.map((o) => (
            <FilterLink key={o} to={href({ organization: o })} current={onList && f.organization.toLowerCase() === o.toLowerCase()}>
              {o}
            </FilterLink>
          ))}
        </PanelSection>
      ) : null}
      <PanelSection title="Date">
        {presets.map((p) => (
          <FilterLink key={p.id} to={href({ date_from: p.from, date_to: p.to })} current={onList && datePreset?.id === p.id}>
            {p.label}
          </FilterLink>
        ))}
        {onList && !datePreset ? (
          <FilterLink to={href({})} current>
            {f.date_from ? formatDate(f.date_from) : "Any time"} to {f.date_to ? formatDate(f.date_to) : "now"}
          </FilterLink>
        ) : null}
      </PanelSection>
      <PanelSection title="Archived">
        <FilterLink to={href({ include_archived: "" })} current={onList && f.include_archived !== "1"}>
          Leave out archived
        </FilterLink>
        <FilterLink to={href({ include_archived: "1" })} current={onList && f.include_archived === "1"}>
          Include archived
        </FilterLink>
      </PanelSection>
    </PanelContext>
  );
}

export function EvidencePage() {
  const { api: base, app, canWrite, product } = useProduct();
  const kinds = useKinds();
  const [params] = useSearchParams();
  const f = readFilters(params);
  usePageTitle("Evidence");
  const q = useInfiniteQuery({
    queryKey: ["sources", base, f],
    queryFn: ({ pageParam }) =>
      api<{ records: RecordSummary[]; next_cursor: string | null }>(
        "GET",
        `${base}/sources${qs({ ...f, include_archived: f.include_archived === "1" ? "true" : "", cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const records = q.data?.pages.flatMap((p) => p.records) ?? [];
  const active = FILTER_KEYS.filter((k) => f[k]);
  const kindLabel = (k: string) => kinds.data?.kinds.find((x) => x.kind === k)?.label ?? k;
  const groupLabel = (folder: string) => kinds.data?.groups.find((g) => folderForGroup(g.group) === folder)?.label ?? folder;
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
  if (f.date_from || f.date_to) chips.push({ label: `${f.date_from ? formatDate(f.date_from) : "Any time"} to ${f.date_to ? formatDate(f.date_to) : "now"}`, to: clear(["date_from", "date_to"]) });
  if (f.tags) chips.push({ label: `Tagged ${f.tags}`, to: clear(["tags"]) });
  if (f.query) chips.push({ label: `Matching “${f.query}”`, to: clear(["query"]) });
  if (f.include_archived === "1") chips.push({ label: "Including archived", to: clear(["include_archived"]) });
  const total = product.counts.sources;
  const count = q.isSuccess ? (active.length ? `${records.length}${q.hasNextPage ? "+" : ""} of ${total}` : `${records.length}${q.hasNextPage ? "+" : ""}`) : undefined;
  return (
    <>
      <EvidenceFilters />
      <Sheet className="sources-sheet">
        <SheetHeader level={1} title="Evidence" count={count} end={canWrite ? <AddSourceMenu /> : undefined} />
        {chips.length ? (
          <div className="sources-active" aria-label="Filters in use">
            {chips.map((c) => (
              <Link key={c.label} to={c.to} className="chip sources-active-chip" replace aria-label={`Remove filter: ${c.label}`}>
                <span className="ellipsis">{c.label}</span>
                <Glyph name="x" size="sm" />
              </Link>
            ))}
            <Link to={`${app}/evidence`} className="quiet-link" replace>
              Clear filters
            </Link>
          </div>
        ) : null}
        {q.isPending ? (
          <Loading label="Loading sources…" lines={6} />
        ) : q.isError ? (
          <div className="sheet-body">
            <ErrorCallout inset title="Evidence could not be loaded" error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !records.length ? (
          active.length ? (
            <EmptyState size="inline" title="No sources match these filters." action={<ButtonLink to={`${app}/evidence`}>Clear filters</ButtonLink>} />
          ) : (
            <EmptyState
              size="inline"
              title="No sources yet."
              action={
                <div className="row">
                  {canWrite ? <AddSourceMenu /> : null}
                  <ButtonLink to="/connect">Connect an agent</ButtonLink>
                </div>
              }
            >
              Interviews, sales calls, research exports and documents. Add one here and WhatBuild files it and parses it into passages, or ask your agent to add them.
            </EmptyState>
          )
        ) : (
          <>
            <div className="sources-rows">
              {records.map((r) => {
                const status = r.derived_status === "ready" ? null : derivedStatus(r.derived_status);
                return (
                  <ListRow
                    key={r.record_id}
                    to={`${app}/evidence/${r.record_id}`}
                    className="source-row"
                    title={r.title}
                    sub={[kinds.data?.kinds.find((k) => k.kind === r.kind)?.short ?? r.kind_label, r.organization, r.date ? formatDate(r.date) : null].filter(Boolean).join(" · ")}
                    end={
                      <>
                        <span className="source-row-count num">
                          {r.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : plural(r.segment_count, "passage")}
                        </span>
                        <span className="source-row-added">
                          {actorName(r.uploaded_by)}, {relativeTime(r.uploaded_at)}
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
