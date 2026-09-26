import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { formatCue } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS } from "../lib/status.ts";
import { Badge, Button, Callout, EmptyState, ErrorCallout, Loading, PageHeader, SelectField, TextField } from "../ui/index.tsx";

interface SearchResult {
  records?: Record<string, { title: string; kind_label: string; folder_label: string; archived_at: string | null }>;
  hits?: { record_id: string; seq: number; start_ms: number | null; speaker: string | null; snippet: string; score?: number }[];
  next_cursor?: string | null;
  coverage?: { statement: string; records_considered: number };
  assumptions?: { id: string; statement: string; status: string; citation_count: number }[];
  decisions?: { id: string; statement: string; status: string; citation_count: number }[];
  insights?: { id: string; title: string; summary: string; status: string }[];
}

/** Highlight the query's words in a snippet, client-side; offsets refer to the source, not the snippet. */
function highlight(text: string, query: string): ReactNode {
  const words = [...new Set(query.replace(/["()*]/g, " ").split(/\s+/).filter((w) => w && !/^(AND|OR|NOT)$/.test(w)))].sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function SearchPage() {
  const { api: base, app } = useProduct();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const mode = params.get("mode") ?? "substring";
  const scope = params.get("scope") ?? "passages";
  const [text, setText] = useState(q);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  useEffect(() => {
    setText(q);
    setCursor(undefined);
  }, [q, mode, scope]);
  const res = useQuery({
    queryKey: ["search", base, q, mode, scope, cursor],
    queryFn: () => api<SearchResult>("GET", `${base}/search${qs({ query: q, mode, scope, cursor, limit: 50 })}`),
    enabled: Boolean(q),
  });
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };
  const d = res.data;
  return (
    <div className="stack-lg">
      <PageHeader title="Search" description="Find a passage across every source, then open it where it sits. Search matches words, not meaning." />
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text.trim() });
        }}
      >
        <div className="grow">
          <TextField label="Words or a phrase" type="search" placeholder='e.g. pricing objection, or "every Friday"' value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <SelectField label="Search" value={scope} onChange={(e) => set({ scope: e.target.value === "passages" ? "" : e.target.value })}>
          <option value="passages">Passages</option>
          <option value="registers">Assumptions and decisions</option>
          <option value="insights">Insights</option>
          <option value="all">Everything</option>
        </SelectField>
        <SelectField label="Matching" value={mode} onChange={(e) => set({ mode: e.target.value === "substring" ? "" : e.target.value })}>
          <option value="substring">Exact text</option>
          <option value="ranked">Ranked query</option>
        </SelectField>
        <Button type="submit" variant="primary" style={{ alignSelf: "end" }}>
          Search
        </Button>
      </form>
      {mode === "ranked" ? <p className="small muted">Ranked queries take words, "quoted phrases", prefix*, AND, OR, NOT and parentheses.</p> : null}
      {!q ? (
        <EmptyState title="Search the evidence">Only each source's primary file is searched; originals and supplements are kept but never searched. An empty result does not prove the evidence is absent.</EmptyState>
      ) : res.isPending ? (
        <Loading label="Searching…" lines={6} />
      ) : res.isError ? (
        <ErrorCallout title="Search did not finish" error={res.error} onRetry={() => res.refetch()} />
      ) : d ? (
        <div className="stack-lg" aria-live="polite">
          {d.coverage ? <Callout tone="info">{d.coverage.statement}</Callout> : null}
          {d.hits ? (
            <section className="stack" aria-labelledby="hits-h">
              <h2 id="hits-h">
                Passages <span className="muted small">· {d.hits.length}{d.next_cursor ? "+" : ""} matches</span>
              </h2>
              {!d.hits.length ? (
                <EmptyState title="No passages match">{mode === "ranked" ? "Try fewer terms or a broader query." : "Try fewer words, or a ranked query."}</EmptyState>
              ) : (
                <ol className="hits">
                  {d.hits.map((h) => {
                    const r = d.records?.[h.record_id];
                    return (
                      <li key={`${h.record_id}:${h.seq}`} className="hit">
                        <Link to={`${app}/sources/${h.record_id}?tab=passages&seq=${h.seq}`} className="hit-link">
                          <span className="row small">
                            <strong>{r?.title}</strong>
                            <Badge>{r?.kind_label}</Badge>
                            {h.speaker ? <span>{h.speaker}</span> : null}
                            <span className="faint num">{h.start_ms !== null ? formatCue(h.start_ms) : `segment ${h.seq}`}</span>
                          </span>
                          <span className="hit-snippet">{highlight(h.snippet, q)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
              {d.next_cursor ? <Button onClick={() => setCursor(d.next_cursor!)}>Next matches</Button> : null}
            </section>
          ) : null}
          {d.assumptions || d.decisions ? (
            <section className="stack" aria-labelledby="reg-h">
              <h2 id="reg-h">Assumptions and decisions</h2>
              {![...(d.assumptions ?? []), ...(d.decisions ?? [])].length ? <p className="muted">None match.</p> : null}
              <ul className="plain-list">
                {[...(d.assumptions ?? []).map((a) => ({ ...a, k: "assumptions" })), ...(d.decisions ?? []).map((a) => ({ ...a, k: "decisions" }))].map((e) => (
                  <li key={e.id} className="row">
                    <Badge>{e.k === "assumptions" ? "Assumption" : "Decision"}</Badge>
                    <Link to={`${app}/insights/${e.k}/${e.id}`}>{highlight(e.statement, q)}</Link>
                    <Badge tone={REVIEW_STATUS[e.status]?.tone}>{REVIEW_STATUS[e.status]?.label}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {d.insights ? (
            <section className="stack" aria-labelledby="ins-h">
              <h2 id="ins-h">Insights</h2>
              {!d.insights.length ? <p className="muted">None match.</p> : null}
              <ul className="plain-list">
                {d.insights.map((i) => (
                  <li key={i.id}>
                    <Link to={`${app}/insights/${i.id}`}>{i.title}</Link>
                    {i.summary ? <p className="small muted">{i.summary}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
