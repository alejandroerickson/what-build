import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { formatCue, formatDate } from "../lib/format.ts";
import { citationLabels, citations, citedSourceIds, type EvidenceContext } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { useSourceTitles } from "../lib/source-titles.ts";
import { REVIEW_STATUS } from "../lib/status.ts";
import type { RecordFull } from "../lib/types.ts";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, EmptyState, ErrorCallout, FindField, Glyph, Loading, Segmented, Sheet, SheetHeader, StatusBadge } from "../ui/index.tsx";
import "../styles/screens/evidence.css";

interface SearchResult {
  records?: Record<string, { title: string; date: string | null; tags: string[]; archived_at: string | null }>;
  hits?: { record_id: string; seq: number; start_ms: number | null; speaker: string | null; snippet: string; score?: number }[];
  next_cursor?: string | null;
  coverage?: { statement: string; records_considered: number };
  assumptions?: { id: string; statement: string; status: string; citation_count: number }[];
}

/**
 * Highlight what matched in a snippet, client-side; offsets refer to the source, not the snippet.
 * Exact text matched the whole query as one phrase, so only the phrase is marked; a ranked query
 * matched its words, so each word is.
 */
function highlight(text: string, query: string, exact: boolean): ReactNode {
  const words = exact
    ? [query.trim()].filter(Boolean)
    : [...new Set(query.replace(/["()*]/g, " ").split(/\s+/).filter((w) => w && !/^(AND|OR|NOT)$/.test(w)))].sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** A snippet with its bare citations as "Title ¶N" tokens (not links: the whole hit is one) and the match marked. */
function snippet(text: string, query: string, exact: boolean, ev: EvidenceContext): ReactNode {
  const parts = citations(text, "s", ev, false);
  if (typeof parts === "string") return highlight(parts, query, exact);
  return (parts as ReactNode[]).map((p, i) => (typeof p === "string" ? <Fragment key={i}>{highlight(p, query, exact)}</Fragment> : p));
}

const SCOPES = [
  { id: "passages", label: "Passages" },
  { id: "assumptions", label: "Assumptions" },
  { id: "all", label: "Everything" },
];

export function SearchPage() {
  const { api: base, app } = useProduct();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const mode = params.get("mode") === "ranked" ? "ranked" : "substring";
  const scope = SCOPES.some((s) => s.id === params.get("scope")) ? params.get("scope")! : "passages";
  const recordId = params.get("record_id") ?? "";
  const [text, setText] = useState(q);
  const [cursors, setCursors] = useState<string[]>([]);
  usePageTitle(q ? `Search: ${q}` : "Search");
  useEffect(() => {
    setText(q);
    setCursors([]);
  }, [q, mode, scope, recordId]);
  const cursor = cursors[cursors.length - 1];
  const res = useQuery({
    queryKey: ["search", base, q, mode, scope, recordId, cursor],
    queryFn: () => api<SearchResult>("GET", `${base}/search${qs({ query: q, mode, scope, record_id: recordId, cursor, limit: 50 })}`),
    enabled: Boolean(q),
    placeholderData: (prev) => prev,
  });
  const source = useQuery({
    queryKey: ["source-brief", base, recordId],
    queryFn: () => api<Pick<RecordFull, "record_id" | "title">>("GET", `${base}/sources/${recordId}`),
    enabled: Boolean(recordId),
    staleTime: 60_000,
  });
  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    const s = next.toString();
    return `?${s}`;
  };
  const d = res.data;
  const busy = res.isFetching && !res.isPending;
  const exact = mode === "substring";
  // Hits from a view or a digest cite other sources; show those as "Title ¶N", never a raw id.
  const citedIds = [...new Set((d?.hits ?? []).flatMap((h) => citedSourceIds(h.snippet)))];
  const fetched = useSourceTitles(base, citedIds.filter((id) => !d?.records?.[id]));
  const titles = Object.fromEntries(citedIds.map((id) => [id, d?.records?.[id]?.title ?? fetched[id]]));
  const evidence: EvidenceContext = { app, titles, labels: citationLabels(citedIds, titles) };
  return (
    <>
      <Sheet className="search-sheet">
        <SheetHeader level={1} title="Search" end={<span className="faint small">Matches words, not meaning.</span>} />
        <form
          className="search-bar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const next = new URLSearchParams(params);
            if (text.trim()) next.set("q", text.trim());
            else next.delete("q");
            setParams(next);
          }}
        >
          <FindField label={recordId ? "Search this source" : "Search passages"} value={text} onChange={(e) => setText(e.target.value)} placeholder={recordId ? "Search this source" : 'Words or a phrase, e.g. "gate code"'} autoFocus={!q} enterKeyHint="search" />
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>
        <div className="search-options">
          <Segmented label="What to search" value={scope} items={SCOPES.map((s) => ({ id: s.id, label: s.label, to: link({ scope: s.id === "passages" ? "" : s.id }) }))} />
          <Segmented
            label="Matching"
            value={mode}
            items={[
              { id: "substring", label: "Exact text", to: link({ mode: "" }) },
              { id: "ranked", label: "Ranked", to: link({ mode: "ranked" }) },
            ]}
          />
          {recordId ? (
            <span className="search-in">
              <Glyph name="library" size="sm" />
              <span className="ellipsis">
                In{" "}
                <Link to={`${app}/evidence/${recordId}`} className="quiet-link">
                  {source.data?.title ?? "one source"}
                </Link>
              </span>
              <Link to={link({ record_id: "" })} className="quiet-link">
                Search all sources
              </Link>
            </span>
          ) : null}
        </div>
        {mode === "ranked" ? <p className="search-help">Ranked queries take words, "quoted phrases", prefix*, AND, OR, NOT and parentheses.</p> : null}
      </Sheet>

      {!q ? (
        <EmptyState title="Search the evidence">Search covers each source&rsquo;s primary file, not its origin or supplement files. No results doesn&rsquo;t prove the evidence is absent.</EmptyState>
      ) : res.isPending ? (
        <Sheet>
          <Loading label="Searching…" lines={6} />
        </Sheet>
      ) : res.isError ? (
        <ErrorCallout title="Search didn’t finish" error={res.error} onRetry={() => res.refetch()} />
      ) : d ? (
        <div className="search-results" aria-live="polite" aria-busy={busy || undefined}>
          {d.coverage ? (
            <p className="search-coverage">
              <Glyph name="info" size="sm" />
              {d.coverage.statement}
            </p>
          ) : null}
          {d.hits ? (
            <Sheet labelledBy="hits-h">
              <SheetHeader id="hits-h" title="Passages" count={`${d.hits.length}${d.next_cursor ? "+" : ""}`} />
              {!d.hits.length ? (
                <EmptyState size="inline" title="No passages match">
                  {mode === "ranked" ? "Try fewer terms or a broader query." : "Try fewer words, or a ranked query."}
                </EmptyState>
              ) : (
                <ol className="search-hits">
                  {d.hits.map((h) => {
                    const r = d.records?.[h.record_id];
                    return (
                      <li key={`${h.record_id}:${h.seq}`} className="hit">
                        <Link to={`${app}/evidence/${h.record_id}?view=passages&seq=${h.seq}`} className="hit-link">
                          <span className="hit-addr num">¶{h.seq}</span>
                          <span className="hit-main">
                            <span className="hit-source">
                              <b className="ellipsis">{r?.title ?? "Source"}</b>
                              <span className="faint">
                                {[r?.date ? formatDate(r.date) : null, h.speaker, h.start_ms !== null ? formatCue(h.start_ms) : null].filter(Boolean).join(" · ")}
                                {r?.archived_at ? " · archived" : ""}
                              </span>
                            </span>
                            <span className="hit-snippet">{snippet(h.snippet, q, exact, evidence)}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
              {d.next_cursor || cursors.length ? (
                <div className="search-pager">
                  <Button size="sm" icon="chevron-left" disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>
                    Previous
                  </Button>
                  <Button size="sm" disabled={!d.next_cursor} busy={busy} busyLabel="Loading…" onClick={() => setCursors([...cursors, d.next_cursor!])}>
                    Next matches
                  </Button>
                </div>
              ) : null}
            </Sheet>
          ) : null}
          {d.assumptions ? (
            <Sheet labelledBy="reg-h">
              <SheetHeader id="reg-h" title="Assumptions" count={d.assumptions.length} />
              {!d.assumptions.length ? (
                <EmptyState size="inline">None match.</EmptyState>
              ) : (
                <ul className="search-entries">
                  {d.assumptions.map((e) => (
                    <li key={e.id}>
                      <Link to={`${app}/exploration/assumptions/${e.id}`} className="search-entry">
                        <Glyph name="scale" />
                        <span className="search-entry-main">
                          <span className="search-entry-title">{highlight(e.statement, q, exact)}</span>
                          <span className="faint">
                            Assumption · {e.citation_count} {e.citation_count === 1 ? "citation" : "citations"}
                          </span>
                        </span>
                        <StatusBadge tone={REVIEW_STATUS[e.status]?.tone}>{REVIEW_STATUS[e.status]?.label ?? e.status}</StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Sheet>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
