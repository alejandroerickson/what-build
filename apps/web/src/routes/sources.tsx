import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus } from "../lib/status.ts";
import type { KindsResponse, RecordSummary } from "../lib/types.ts";
import { Badge, Button, ButtonLink, EmptyState, ErrorCallout, Loading, PageHeader, SelectField, TextField } from "../ui/index.tsx";

export function useKinds() {
  return useQuery({ queryKey: ["kinds"], queryFn: () => api<KindsResponse>("GET", "/api/v1/kinds"), staleTime: Infinity });
}

const FOLDERS = [
  { value: "", label: "All" },
  { value: "interviews", label: "Interviews" },
  { value: "sales-calls", label: "Sales calls" },
  { value: "research", label: "Research" },
  { value: "documents", label: "Documents" },
  { value: "design", label: "Design" },
  { value: "misc", label: "Other" },
];

const FILTER_KEYS = ["folder", "kind", "organization", "date_from", "date_to", "tags", "query", "include_archived"] as const;

export function StatusBadge({ status }: { status: string }) {
  const s = derivedStatus(status);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SourcesPage() {
  const { api: base, app, canWrite } = useProduct();
  const kinds = useKinds();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const [query, setQuery] = useState(filters.query);
  useEffect(() => setQuery(filters.query), [filters.query]);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const q = useInfiniteQuery({
    queryKey: ["sources", base, filters],
    queryFn: ({ pageParam }) =>
      api<{ records: RecordSummary[]; next_cursor: string | null }>(
        "GET",
        `${base}/sources${qs({ ...filters, include_archived: filters.include_archived === "1" ? "true" : "", tags: filters.tags, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const records = q.data?.pages.flatMap((p) => p.records) ?? [];
  const active = FILTER_KEYS.filter((k) => filters[k]).length;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Sources"
        description="The evidence. Find a source, read its passages, and add your observations."
        actions={canWrite ? <ButtonLink to={`${app}/sources/new`} variant="primary">Add a source</ButtonLink> : null}
      />
      <div className="stack" role="search" aria-label="Filter sources">
        <div className="segmented" role="group" aria-label="Folder">
          {FOLDERS.map((f) => (
            <button key={f.value} type="button" className="segment" aria-pressed={filters.folder === f.value} onClick={() => set("folder", f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            set("query", query.trim());
          }}
        >
          <TextField label="Titles, people, tags, file names" type="search" value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => set("query", query.trim())} />
          <SelectField label="Kind" value={filters.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="">Any kind</option>
            {kinds.data?.groups.map((g) => (
              <optgroup key={g.group} label={g.label}>
                {kinds.data.kinds.filter((k) => k.group === g.group).map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectField>
          <TextField label="Organization" defaultValue={filters.organization} key={`org-${filters.organization}`} onBlur={(e) => set("organization", e.target.value.trim())} />
          <TextField label="From" type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />
          <TextField label="To" type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={filters.include_archived === "1"} onChange={(e) => set("include_archived", e.target.checked ? "1" : "")} /> Show archived
          </label>
        </form>
        {active ? (
          <div className="row small">
            <span className="muted">{active === 1 ? "1 filter" : `${active} filters`} applied.</span>
            <Button size="sm" variant="quiet" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>
      {q.isPending ? (
        <Loading label="Loading sources…" lines={6} />
      ) : q.isError ? (
        <ErrorCallout title="Sources could not be loaded" error={q.error} onRetry={() => q.refetch()} />
      ) : !records.length ? (
        active ? (
          <EmptyState title="No sources match these filters" action={<Button onClick={() => setParams({})}>Clear filters</Button>} />
        ) : (
          <EmptyState title="No sources yet" action={canWrite ? <ButtonLink to={`${app}/sources/new`} variant="primary">Add a source</ButtonLink> : null}>
            Interviews, sales calls, research exports, documents and decks. WhatBuild asks what each one is and files it for you — or connect an agent to do the uploading.
          </EmptyState>
        )
      ) : (
        <>
          <table className="table table-rows">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col" className="hide-narrow">Kind</th>
                <th scope="col" className="hide-narrow">Date</th>
                <th scope="col">Status</th>
                <th scope="col" className="hide-narrow">Added</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.record_id} onClick={(e) => (e.target as HTMLElement).tagName !== "A" && navigate(`${app}/sources/${r.record_id}`)}>
                  <td>
                    <Link to={`${app}/sources/${r.record_id}`} className="row-title">
                      {r.title}
                    </Link>
                    <div className="small muted">
                      {[r.organization, r.file_count > 1 ? `${r.file_count} files` : null].filter(Boolean).join(" · ")}
                      {r.archived_at ? (
                        <>
                          {" "}
                          <Badge>Archived</Badge>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="hide-narrow small">{kinds.data?.kinds.find((k) => k.kind === r.kind)?.short ?? r.kind_label}</td>
                  <td className="hide-narrow small num">{formatDate(r.date)}</td>
                  <td>
                    <StatusBadge status={r.derived_status} />
                  </td>
                  <td className="hide-narrow small muted">
                    {relativeTime(r.uploaded_at)} · {r.uploaded_by.display_name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-between small muted">
            <span>{records.length} {records.length === 1 ? "source" : "sources"}{q.hasNextPage ? " so far" : ""}</span>
            {q.hasNextPage ? (
              <Button onClick={() => q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading…">
                Load more
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
