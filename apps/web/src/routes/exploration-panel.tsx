import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import type { InsightSummary, RegisterSummary } from "../lib/types.ts";
import { PanelContext, PanelFilter, PanelSection } from "../shell/slots.tsx";
import { FindField } from "../ui/index.tsx";
import { useMockupList } from "./mockups.tsx";
import { searchWith } from "./insights-common.tsx";

/**
 * Exploration holds the mockups, then three lists side by side: insights, assumptions and
 * decisions. The panel names all three lists, each with one set of filters (its review state),
 * and every list's header has only a title search. A product holds dozens of each, not
 * thousands, so each list loads whole, once, and the panel's counts, the filters and the search
 * all work on what is loaded.
 */
export type ExplorationKind = "insights" | "assumptions" | "decisions";

/** At most this many pages of 100 are loaded; past that the list says it shows only the first. */
const MAX_PAGES = 20;

async function everyPage<T>(page: (cursor: string | undefined) => Promise<{ items: T[]; next_cursor: string | null }>) {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < MAX_PAGES; n++) {
    const p = await page(cursor);
    items.push(...p.items);
    cursor = p.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return { items, more: Boolean(cursor) };
}

/** Every insight that is not archived, or every archived one. */
export function useInsightList(archived = false) {
  const { api: base } = useProduct();
  return useQuery({
    queryKey: ["insights", base, "every", archived],
    queryFn: () =>
      everyPage((cursor) =>
        api<{ items: InsightSummary[]; next_cursor: string | null }>("GET", `${base}/insights${qs({ status: archived ? "archived" : "", limit: 100, cursor })}`),
      ),
  });
}

/** Every assumption or decision that is not archived, in any status, or every archived one. */
export function useEntryList(kind: "assumptions" | "decisions", archived = false) {
  const { api: base } = useProduct();
  return useQuery({
    queryKey: ["register", base, kind, "every", archived],
    queryFn: async () => {
      const all = await everyPage((cursor) =>
        api<{ items: RegisterSummary[]; next_cursor: string | null }>(
          "GET",
          `${base}/${kind}${qs({ status: ["unconfirmed", "confirmed", "refuted", "superseded"], include_archived: archived ? "true" : "", limit: 100, cursor })}`,
        ),
      );
      // The list operation adds archived entries to the rest; keep only them.
      return archived ? { ...all, items: all.items.filter((e) => e.archived_at) } : all;
    },
  });
}

interface View<T> {
  id: string;
  label: string;
  /** Rows the view lists. Archived ones are a list of their own, so that view has none. */
  test?: (item: T) => boolean;
}

/** The one filter on insights: whether a person has reviewed the current revision. */
export const INSIGHT_VIEWS: View<InsightSummary>[] = [
  { id: "", label: "All insights", test: () => true },
  // Changed since review waits for a person too.
  { id: "unreviewed", label: "Unreviewed", test: (i) => i.review_state !== "reviewed" },
  { id: "reviewed", label: "Reviewed", test: (i) => i.review_state === "reviewed" },
  { id: "archived", label: "Archived" },
];

/**
 * The one filter on assumptions and decisions: their status, in the words the rows' status chips
 * use. "All" is the ones the team works with, as every count of them in the app is; refuted and
 * replaced ones are kept apart, and archived ones are a list of their own.
 */
export function entryViews(kind: "assumptions" | "decisions"): View<RegisterSummary>[] {
  return [
    { id: "", label: `All ${kind}`, test: (e) => e.status === "unconfirmed" || e.status === "confirmed" },
    { id: "unconfirmed", label: "Unconfirmed", test: (e) => e.status === "unconfirmed" },
    { id: "confirmed", label: "Confirmed", test: (e) => e.status === "confirmed" },
    { id: "refuted", label: "Refuted or replaced", test: (e) => e.status === "refuted" || e.status === "superseded" },
    { id: "archived", label: "Archived" },
  ];
}

/** Which list and view the URL shows. On an item page there is no list, and no view is current. */
function useWhere() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const m = /\/exploration\/(insights|assumptions|decisions)\/?$/.exec(pathname);
  return { list: (m?.[1] ?? null) as ExplorationKind | null, show: params.get("show") ?? "", outcome: m ? (params.get("outcome_id") ?? "") : "", params };
}

function Section<T>({ kind, title, views, items, archived }: {
  kind: ExplorationKind;
  title: ReactNode;
  views: View<T>[];
  items: T[] | undefined;
  archived?: number;
}) {
  const { app } = useProduct();
  const { list, show, outcome, params } = useWhere();
  const path = `${app}/exploration/${kind}`;
  const here = list === kind;
  // Another view of the same list keeps its search and outcome; another list keeps only the outcome.
  const to = (id: string) => (here ? searchWith(path, params, { show: id }) : searchWith(path, new URLSearchParams(), { show: id, outcome_id: outcome }));
  return (
    <PanelSection title={title}>
      {views.map((v) => (
        <PanelFilter
          key={v.id}
          to={to(v.id)}
          current={here && show === v.id}
          replace={here}
          count={v.test ? items?.filter(v.test).length : archived}
        >
          {v.label}
        </PanelFilter>
      ))}
    </PanelSection>
  );
}

/** The mockups, flat, most recently changed first: each opens its canvas. */
function MockupsSection() {
  const { app } = useProduct();
  const { pathname } = useLocation();
  // The panel sits above the screen's route, so it reads the open mockup from the path.
  const mockupId = /\/exploration\/mockups\/([^/]+)/.exec(pathname)?.[1];
  const list = useMockupList();
  const items = list.data?.items;
  const onIndex = /\/exploration\/mockups\/?$/.test(pathname);
  return (
    <PanelSection title="Mockups">
      {items?.length ? (
        items.map((e) => (
          <PanelFilter key={e.mockup_id} to={`${app}/exploration/mockups/${e.mockup_id}`} current={e.mockup_id === mockupId} replace={false}>
            {e.title}
          </PanelFilter>
        ))
      ) : (
        <PanelFilter to={`${app}/exploration/mockups`} current={onIndex} replace={false}>
          {list.isPending ? "Loading…" : "None yet"}
        </PanelFilter>
      )}
    </PanelSection>
  );
}

/** The Exploration panel context: mockups, then insights, assumptions and decisions, each with its filters and counts. */
export function ExplorationPanel() {
  const { outcome } = useWhere();
  const insights = useInsightList();
  const archived = useInsightList(true);
  const assumptions = useEntryList("assumptions");
  const archivedAssumptions = useEntryList("assumptions", true);
  const decisions = useEntryList("decisions");
  const archivedDecisions = useEntryList("decisions", true);
  // With an outcome in view, the counts are for that outcome, as the lists are.
  const forInsight = (i: InsightSummary) => !outcome || i.refs.outcomes.includes(outcome);
  const forEntry = (e: RegisterSummary) => !outcome || e.outcome_ids.includes(outcome);
  return (
    <PanelContext label="Mockups, insights, assumptions and decisions">
      <MockupsSection />
      <Section kind="insights" title="Insights" views={INSIGHT_VIEWS} items={insights.data?.items.filter(forInsight)} archived={archived.data?.items.filter(forInsight).length} />
      <Section kind="assumptions" title="Assumptions" views={entryViews("assumptions")} items={assumptions.data?.items.filter(forEntry)} archived={archivedAssumptions.data?.items.filter(forEntry).length} />
      <Section kind="decisions" title="Decisions" views={entryViews("decisions")} items={decisions.data?.items.filter(forEntry)} archived={archivedDecisions.data?.items.filter(forEntry).length} />
    </PanelContext>
  );
}

/** Every Exploration screen: the panel, and the screen. */
export function ExplorationSection() {
  return (
    <>
      <ExplorationPanel />
      <Outlet />
    </>
  );
}

/** A title with the stretches a search matched marked. */
export function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={s}>{text.slice(s, e)}</mark>);
    at = e;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * The title search in a Exploration list's header. It narrows the list as you type and keeps the
 * words in the URL (`?q=`), so a narrowed list can be shared and survives going back.
 */
export function TitleFind({ label }: { label: string }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  // What this field last wrote, so a change from elsewhere (Clear filters, going back) reaches it
  // and its own writes, which land a moment later, do not undo newer typing.
  const wrote = useRef(q);
  useEffect(() => {
    if (q !== wrote.current) {
      wrote.current = q;
      setText(q);
    }
  }, [q]);
  return (
    <form role="search" className="exploration-find" onSubmit={(e) => e.preventDefault()}>
      <FindField
        label={label}
        value={text}
        enterKeyHint="search"
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          wrote.current = v.trim();
          const next = new URLSearchParams(params);
          if (v.trim()) next.set("q", v.trim());
          else next.delete("q");
          setParams(next, { replace: true });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            e.stopPropagation();
            setText("");
            wrote.current = "";
            const next = new URLSearchParams(params);
            next.delete("q");
            setParams(next, { replace: true });
          }
        }}
      />
    </form>
  );
}
