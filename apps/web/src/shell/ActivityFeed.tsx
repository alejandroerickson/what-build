import { useInfiniteQuery, type UseInfiniteQueryResult, type InfiniteData } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { api, qs } from "../lib/api.ts";
import { formatDate, formatDateTime, formatTime, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { AgentFace, Avatar, Button, ButtonLink, EmptyState, ErrorCallout, Loading } from "../ui/index.tsx";

export interface ActivityItem {
  activity_id: string;
  occurred_at: string;
  actor: { account_id: string; display_name: string; surface: string | null; client: string | null };
  channel: string | null;
  through_agent: boolean;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_title: string | null;
  summary: string;
}

/** Narrows the one log, of people and agents together, to a kind of item or one item. */
export interface ActivityFilter {
  entityType?: string;
  entityId?: string;
}

const VERBS: Record<string, string> = {
  "source:created": "added the source",
  "source:copied": "copied in",
  "source:copied_out": "copied out",
  "source:updated": "edited",
  "source:reorganized": "refiled",
  "source:file_added": "added an attachment to",
  // Recorded while attachments had roles.
  "source:file_role_changed": "changed an attachment’s role on",
  "source:note_added": "commented on",
  "source:note_updated": "edited a comment on",
  "source:note_archived": "archived a comment on",
  "source:note_restored": "restored a comment on",
  "source:derived": "read an attachment of",
  "source:rederive_requested": "asked to read again an attachment of",
  "source:text_written": "wrote the text of",
  "source:archived": "archived",
  "source:restored": "restored",
  "source:deleted": "deleted",
  "source:moved_in": "moved in",
  "source:moved_out": "moved out",
  "source:agent_note_written": "wrote the summary or notes of",
  "source:lineage_registered": "registered the inputs of",
  "source:moved_to_evidence": "moved into Evidence",
  "outcome:created": "added the outcome",
  "outcome:updated": "edited the outcome",
  "outcome:reordered": "reordered the outcome",
  // Recorded before an outcome was simply current or archived.
  "outcome:achieved": "marked achieved",
  "outcome:active": "reopened the outcome",
  "outcome:archived": "archived the outcome",
  "outcome:restored": "restored the outcome",
  "assumption:created": "recorded the assumption",
  "assumption:reviewed": "reviewed the assumption",
  "assumption:superseded": "superseded the assumption",
  "assumption:archived": "archived the assumption",
  "assumption:restored": "restored the assumption",
  "story_page:published": "published",
  "story_page:updated": "published a new version of",
  "story_page:archived": "archived the page",
  "story_page:restored": "restored the page",
  "story_page:notes_updated": "edited the notes for agents on",
  "mockup:created": "made the mockup",
  "mockup:updated": "published a new version of",
  "mockup:archived": "archived the mockup",
  "mockup:restored": "restored the mockup",
  "story_hierarchy:organized": "rearranged",
  "story_style:created": "set the Story style to",
  "story_style:updated": "changed the Story style to",
  "product:created": "created the product",
  "product:updated": "changed the product",
  "product:archived": "archived the product",
  "product:restored": "restored the product",
  "product:export_requested": "exported",
  "membership:granted": "gave a role to",
  "membership:role_changed": "changed the role of",
  "membership:revoked": "removed a role from",
  "membership:joined": "joined",
  "membership:invited": "invited someone to",
  "membership:invitation_cancelled": "cancelled an invitation",
  "tenant:renamed": "renamed the organization to",
  "tenant:slug_changed": "changed the short name in links of",
};

/** What an entity type is called when the log is filtered to it: "Showing activity on sources". */
export const ENTITY_LABEL: Record<string, string> = {
  source: "sources",
  outcome: "outcomes",
  assumption: "assumptions",
  story_page: "Story pages",
  mockup: "mockups",
  story_hierarchy: "the Story tree",
  story_style: "the Story style",
  product: "the product",
  membership: "people and roles",
};

function linkFor(app: string, i: ActivityItem): string | null {
  if (!i.entity_id && i.entity_type !== "story_hierarchy" && i.entity_type !== "product") return null;
  switch (i.entity_type) {
    case "source":
      return i.action === "deleted" || i.action === "moved_out" ? null : `${app}/evidence/${i.entity_id}`;
    case "assumption":
      return `${app}/exploration/assumptions/${i.entity_id}`;
    case "outcome":
      return `${app}/idea`;
    case "story_page":
      return `${app}/story/${i.entity_id}`;
    case "mockup":
      return `${app}/exploration/mockups/${i.entity_id}`;
    case "story_hierarchy":
    case "story_style":
      return `${app}/story`;
    case "product":
      return `${app}/settings`;
    case "membership":
      return i.action === "invitation_cancelled" ? null : `${app}/settings#people`;
    default:
      return null;
  }
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(iso: string) {
  const day = localDay(iso);
  if (day === localDay(new Date().toISOString())) return "Today";
  if (day === localDay(new Date(Date.now() - 86400_000).toISOString())) return "Yesterday";
  return formatDate(day);
}

/**
 * "via claude-code" for an agent, "in the app" or "through the API" for a person, and "on the
 * server" for what WhatBuild does by itself (reading an attachment, a scheduled job), which has no surface
 * whoever uploaded the file and however they did it.
 */
export function surfaceWords(i: Pick<ActivityItem, "through_agent" | "channel" | "actor">) {
  if (i.through_agent) return `via ${i.actor.client ?? "an agent"}`;
  if (i.channel === "rest") return "through the API";
  if (i.channel === "web") return "in the app";
  return i.actor.account_id === "system" ? "on the server" : "in the app";
}

/** The log for this product, newest first, loaded 50 at a time. */
export function useActivity(filter: ActivityFilter) {
  const { api: base } = useProduct();
  return useInfiniteQuery({
    queryKey: ["activity", base, filter.entityId ?? null, filter.entityType ?? null],
    queryFn: ({ pageParam }) =>
      api<{ items: ActivityItem[]; next_cursor: string | null }>(
        "GET",
        `${base}/activity${qs({ entity_id: filter.entityId, entity_type: filter.entityType, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

/**
 * The day-grouped feed, drawn as rows inside a sheet: who (a face, the name), what they did with a
 * link to it, through which surface, and when. Put it inside a <Sheet>; it brings its own states.
 */
export function ActivityFeed(filter: ActivityFilter & { query?: ReturnType<typeof useActivity> }) {
  const own = useActivity(filter);
  const q = filter.query ?? own;
  const { app } = useProduct();
  const filtered = Boolean(filter.entityId || filter.entityType);
  return (
    <ActivityLog
      query={q}
      linkOf={(i) => linkFor(app, i)}
      empty={
        <EmptyState
          size="inline"
          title={filtered ? "Nothing matches this view yet" : "Nothing has changed yet"}
          action={filtered ? undefined : <ButtonLink to="/connect" size="sm" icon="bot">Connect an agent</ButtonLink>}
        />
      }
    />
  );
}

type ActivityPages = UseInfiniteQueryResult<InfiniteData<{ items: ActivityItem[]; next_cursor: string | null }>>;

/**
 * A day's count of changes. The log loads newest first, so only the oldest day loaded may go on
 * past the changes loaded so far: while older ones wait, it says "37+ changes", claiming no total.
 */
export function dayCount(loaded: number, more: boolean): string {
  if (more) return `${loaded}+ changes`;
  return `${loaded} ${loaded === 1 ? "change" : "changes"}`;
}

/**
 * Any log drawn as the feed: a product's, or an organization's access changes. linkOf says where an
 * entry leads, if anywhere; empty is what shows before anything has happened.
 */
export function ActivityLog({ query: q, linkOf, empty }: { query: ActivityPages; linkOf: (i: ActivityItem) => string | null; empty: ReactNode }) {
  if (q.isPending) return <Loading label="Loading activity…" lines={6} />;
  if (q.isError)
    return (
      <div className="activity-state">
        <ErrorCallout inset title="Activity couldn’t be loaded" error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return <>{empty}</>;
  const groups: { day: string; items: ActivityItem[] }[] = [];
  for (const i of items) {
    const day = dayLabel(i.occurred_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(i);
  }
  return (
    <div className="activity">
      {groups.map((g, gi) => (
        <section key={`${g.day}-${gi}`} className="activity-group" aria-labelledby={`activity-day-${gi}`}>
          <h2 className="activity-day" id={`activity-day-${gi}`}>
            {g.day}
            <span className="activity-day-count num">{dayCount(g.items.length, Boolean(q.hasNextPage) && gi === groups.length - 1)}</span>
          </h2>
          <ol className="activity-list">
            {g.items.map((i) => {
              const verb = VERBS[`${i.entity_type}:${i.action}`] ?? i.action.replace(/_/g, " ");
              const href = linkOf(i);
              // A cancelled invitation names nobody, and someone who joined is the actor: the sentence ends at its verb.
              const title = i.entity_type === "membership" && i.action === "joined" ? null : i.entity_title ?? (i.entity_type === "membership" ? null : ENTITY_LABEL[i.entity_type] ?? i.entity_type.replace(/_/g, " "));
              const today = g.day === "Today";
              return (
                <li key={i.activity_id} className="activity-row">
                  {i.through_agent ? <AgentFace /> : <Avatar name={i.actor.display_name} />}
                  <div className="activity-main">
                    <p className="activity-sentence">
                      <b>{i.actor.display_name}</b> {verb}{title ? <> {href ? <Link to={href}>{title}</Link> : <span>{title}</span>}</> : null}
                    </p>
                    <p className="activity-sub">
                      {surfaceWords(i)}
                      {i.summary ? <> <span className="sep-dot"> {i.summary}</span></> : null}
                    </p>
                  </div>
                  <time className="activity-time num" dateTime={i.occurred_at} title={formatDateTime(i.occurred_at)}>
                    {today ? relativeTime(i.occurred_at) : formatTime(i.occurred_at)}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <div className="activity-foot">
        {q.hasNextPage ? (
          <Button size="sm" onClick={() => void q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading older changes…">
            Show older changes
          </Button>
        ) : (
          <p className="activity-end">The log begins here.</p>
        )}
      </div>
    </div>
  );
}
