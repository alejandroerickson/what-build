import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { track } from "../lib/analytics.ts";
import { byArea, FIND_AREAS, hitHref, hitMeta, kindOf, Marked, matchedCount, resultHref, resultMeta, useDebounced, useFind, useRecentSearches, type FindResponse, type FindResult } from "../lib/find.tsx";
import { useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS } from "../lib/status.ts";
import { understood } from "../shell/find-palette.tsx";
import { PanelContext, PanelFilter, PanelSection, usePageTitle } from "../shell/slots.tsx";
import { EmptyState, ErrorCallout, FindField, Glyph, Loading, Sheet, SheetHeader, StatusBadge } from "../ui/index.tsx";
import { shortcutLabel } from "../ui/media.ts";
import "../styles/screens/search.css";

/**
 * Search: everything in the product that holds the words, as you type, under the area it belongs to
 * (Idea, Evidence, Exploration, Story). A source shows once, with its best passages under it. The
 * panel narrows to one area.
 */
export function SearchPage() {
  const { api: base, app, product } = useProduct();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const area = FIND_AREAS.find((a) => a.id === params.get("show"));
  const show = area?.id ?? "";
  const recordId = params.get("record_id") ?? "";
  const strict = params.get("strict") === "1";
  const [text, setText] = useState(q);
  const typed = useDebounced(text, 120);
  // What this field last wrote to the URL, so going back (a change from elsewhere) reaches the field.
  const wrote = useRef(q);
  useEffect(() => {
    const words = typed.trim();
    if (words === q.trim()) return;
    wrote.current = words;
    const next = new URLSearchParams(params);
    if (words) next.set("q", words);
    else next.delete("q");
    next.delete("strict");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  useEffect(() => {
    if (q === wrote.current) return;
    wrote.current = q;
    setText(q);
  }, [q]);
  usePageTitle(q ? `Search: ${q}` : "Search");
  const { remember } = useRecentSearches(product.path);
  // Opening a result makes these words a recent search, in the palette too.
  const followed = (e: MouseEvent) => {
    const a = (e.target as Element).closest<HTMLElement>("a[href]");
    if (!a) return;
    remember(q);
    // Counted by what was followed and how far down, never the words.
    if (a.dataset["kind"]) track({ name: "search_result_open", kind: a.dataset["kind"], from: "screen", ...(a.dataset["rank"] ? { rank: Number(a.dataset["rank"]) } : {}) });
  };
  const res = useFind(base, q, { recordId, strict });
  const d = q.trim() ? res.data : undefined;
  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    return `?${next.toString()}`;
  };
  const all = d?.results ?? [];
  const areas = byArea(all, d?.kind_hint ?? null);
  const shown = areas.filter((a) => a.results.length && (!area || a.id === area.id));
  const busy = res.isFetching || typed !== text;
  const source = recordId ? all[0] : undefined;

  return (
    <>
      <Sheet className="find-sheet">
        <SheetHeader level={1} title="Search" />
        <div className="find-bar" role="search">
          <FindField
            label={recordId ? "Search this source" : `Search ${product.name}`}
            className="find-big"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && text) {
                e.preventDefault();
                e.stopPropagation();
                setText("");
              }
            }}
            autoFocus
            enterKeyHint="search"
            spellCheck={false}
          />
          {busy && q ? <Glyph name="loader" className="spin find-busy" /> : null}
        </div>
        {d ? <Understood d={d} retry={link({ strict: "1" })} /> : null}
        {recordId ? (
          <p className="find-in">
            <Glyph name="library" size="sm" />
            <span className="ellipsis">
              In <Link to={`${app}/evidence/${recordId}`} className="quiet-link">{source?.title ?? "one source"}</Link>
            </span>
            <Link to={link({ record_id: "" })} className="quiet-link">
              Search everything
            </Link>
          </p>
        ) : null}
      </Sheet>

      {!recordId ? <SearchFilters areas={areas} total={all.length} show={show} link={link} /> : null}

      {!q.trim() ? (
        <EmptyState title={`Search everything in ${product.name}`}>
          Press {shortcutLabel("K")} on any screen to search without leaving it.
        </EmptyState>
      ) : res.isError ? (
        <ErrorCallout title="Search didn’t finish" error={res.error} onRetry={() => res.refetch()} />
      ) : !d ? (
        <Sheet>
          <Loading label="Searching…" lines={6} />
        </Sheet>
      ) : !shown.length ? (
        <Sheet>
          <EmptyState size="inline" title={`Nothing ${area ? `in ${area.label} ` : ""}matches “${q.trim()}”`}>
            Try another word, or fewer words.
          </EmptyState>
        </Sheet>
      ) : recordId && source ? (
        <div className="find-results" onClickCapture={followed}>
          <Sheet labelledBy="find-hits-h">
            <SheetHeader id="find-hits-h" title="Passages" count={source.hit_count} />
            <Hits r={source} app={app} all />
          </Sheet>
        </div>
      ) : (
        <div className="find-results" aria-busy={busy || undefined} onClickCapture={followed}>
          {shown.map((a) => (
            <Sheet key={a.id} labelledBy={`find-${a.id}-h`}>
              <SheetHeader id={`find-${a.id}-h`} title={a.label} count={a.results.length} />
              <ResultList results={a.results} app={app} q={q} />
            </Sheet>
          ))}
        </div>
      )}
    </>
  );
}

function Understood({ d, retry }: { d: FindResponse; retry: string }) {
  const note = understood(d);
  const matched = matchedCount(d);
  const cut = matched > d.results.length;
  if (!note && !d.ignored.length && !cut) return null;
  return (
    <p className="find-understood" aria-live="polite">
      {note}
      {cut ? (
        <span>
          {note ? " " : ""}Showing the best {d.results.length} of {matched}. Add a word to narrow them.
        </span>
      ) : null}
      {d.corrections.length ? (
        <>
          {" "}
          <Link to={retry} className="quiet-link" replace>
            Search for {d.corrections.map((c) => c.from).join(", ")} instead
          </Link>
        </>
      ) : null}
      {d.ignored.length ? <span className="faint"> Left out: {d.ignored.join(", ")}.</span> : null}
    </p>
  );
}

/** The panel: narrow to one area. An area with nothing matching is left out. */
function SearchFilters({ areas, total, show, link }: { areas: { id: string; label: string; results: FindResult[] }[]; total: number; show: string; link: (p: Record<string, string>) => string }) {
  return (
    <PanelContext label="Search">
      <PanelSection title="Show">
        <PanelFilter to={link({ show: "" })} current={!show} count={total}>
          Everything
        </PanelFilter>
        {FIND_AREAS.map((a) => {
          const n = areas.find((x) => x.id === a.id)?.results.length;
          return n || show === a.id ? (
            <PanelFilter key={a.id} to={link({ show: a.id })} current={show === a.id} count={n}>
              {a.label}
            </PanelFilter>
          ) : null;
        })}
      </PanelSection>
    </PanelContext>
  );
}

function ResultList({ results, app, q }: { results: FindResult[]; app: string; q: string }) {
  return (
    <ol className="find-list">
      {results.map((r, i) => (
        <li key={`${r.kind}:${r.id}`} className="find-item">
          <Link to={resultHref(app, r)} className="find-head" data-kind={r.kind} data-rank={i + 1}>
            <Glyph name={kindOf(r.kind).glyph} />
            <span className="find-main">
              <span className="find-title">
                <Marked text={r.title} marks={r.title_marks} />
              </span>
              <span className="find-meta">
                {resultMeta(r)}
                {r.missing.length ? <span className="find-missing"> · Missing: {r.missing.map((m, i) => <s key={i}>{(i ? ", " : "") + m}</s>)}</span> : null}
              </span>
              {r.snippet ? (
                <span className="find-snippet">
                  <Marked text={r.snippet} marks={r.snippet_marks} />
                </span>
              ) : null}
            </span>
            {r.kind === "assumption" && r.meta.status ? <StatusBadge tone={REVIEW_STATUS[r.meta.status]?.tone}>{REVIEW_STATUS[r.meta.status]?.label ?? r.meta.status}</StatusBadge> : null}
          </Link>
          {r.hits?.length ? <Hits r={r} app={app} more={`?q=${encodeURIComponent(q)}&record_id=${r.id}`} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** A source's matching passages: the best three, or all of them on the screen for one source. */
function Hits({ r, app, more, all }: { r: FindResult; app: string; more?: string; all?: boolean }) {
  const hits = r.hits ?? [];
  const rest = (r.hit_count ?? 0) - hits.length;
  return (
    <ul className={`find-hits${all ? " find-hits-all" : ""}`}>
      {hits.map((h) => (
        <li key={h.seq}>
          <Link to={hitHref(app, r.id, h)} className="find-hit" data-kind="passage">
            <span className="find-hit-meta num">{hitMeta(h)}</span>
            <span className="find-hit-text">
              <Marked text={h.text} marks={h.marks} />
            </span>
          </Link>
        </li>
      ))}
      {rest > 0 && more ? (
        <li>
          <Link to={more} className="find-more">
            <Glyph name="corner-down-right" size="sm" />
            {rest} more {rest === 1 ? "passage" : "passages"} in this source
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

