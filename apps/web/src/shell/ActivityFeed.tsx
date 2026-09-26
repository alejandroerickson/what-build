import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, qs } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { IconAgent } from "../ui/icons.tsx";
import { Button, EmptyState, ErrorCallout, Loading } from "../ui/index.tsx";

interface ActivityItem {
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

const VERBS: Record<string, string> = {
  "source:created": "added the source",
  "source:copied": "copied in the source",
  "source:updated": "edited the details of",
  "source:reorganized": "refiled",
  "source:file_added": "added a file to",
  "source:file_role_changed": "changed a file role on",
  "source:note_added": "added a note to",
  "source:note_updated": "edited a note on",
  "source:derived": "finished parsing",
  "source:archived": "archived",
  "source:restored": "restored",
  "source:deleted": "deleted",
  "source:moved_in": "moved in",
  "source:moved_out": "moved out",
  "source:agent_note_written": "wrote agent notes for",
  "source:lineage_registered": "registered the inputs of",
  "objective:created": "added the objective",
  "objective:updated": "edited the objective",
  "objective:achieved": "marked achieved",
  "objective:archived": "archived the objective",
  "insight:created": "wrote",
  "insight:updated": "revised",
  "insight:published": "published",
  "insight:unpublished": "unpublished",
  "insight:archived": "archived",
  "assumption:created": "recorded the assumption",
  "assumption:reviewed": "reviewed the assumption",
  "assumption:superseded": "superseded the assumption",
  "decision:created": "recorded the decision",
  "decision:reviewed": "reviewed the decision",
  "decision:superseded": "superseded the decision",
  "story_page:published": "published",
  "story_page:updated": "published a new version of",
  "story_page:archived": "archived the page",
  "story_hierarchy:organized": "rearranged",
  "product:created": "created the product",
  "product:updated": "changed the product",
  "membership:granted": "gave a role to",
  "membership:revoked": "removed a role from",
  "membership:joined": "joined as",
};

function linkFor(app: string, i: ActivityItem): string | null {
  if (!i.entity_id && i.entity_type !== "story_hierarchy") return null;
  switch (i.entity_type) {
    case "source":
      return i.action === "deleted" || i.action === "moved_out" ? null : `${app}/sources/${i.entity_id}`;
    case "insight":
      return `${app}/insights/${i.entity_id}`;
    case "assumption":
      return `${app}/insights/assumptions/${i.entity_id}`;
    case "decision":
      return `${app}/insights/decisions/${i.entity_id}`;
    case "objective":
      return `${app}/objectives`;
    case "story_page":
      return `${app}/story/${i.entity_id}`;
    case "story_hierarchy":
      return `${app}/story`;
    default:
      return null;
  }
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}

export function ActivityFeed({ entityId, entityType, compact }: { entityId?: string; entityType?: string; compact?: boolean }) {
  const { api: base, app } = useProduct();
  const q = useInfiniteQuery({
    queryKey: ["activity", base, entityId, entityType],
    queryFn: ({ pageParam }) => api<{ items: ActivityItem[]; next_cursor: string | null }>("GET", `${base}/activity${qs({ entity_id: entityId, entity_type: entityType, cursor: pageParam, limit: 50 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  if (q.isPending) return <Loading label="Loading activity…" lines={5} />;
  if (q.isError) return <ErrorCallout title="Activity could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return <EmptyState title="Nothing has changed yet">Adding a source, writing an insight, reviewing an entry or publishing the Story — in the app or through a connected agent — shows up here.</EmptyState>;
  const groups: { day: string; items: ActivityItem[] }[] = [];
  for (const i of items) {
    const day = dayLabel(i.occurred_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(i);
  }
  return (
    <div className="activity">
      {groups.map((g) => (
        <section key={g.day} aria-label={g.day}>
          <h3 className="activity-day">
            {g.day} <span className="faint small">· {g.items.length} {g.items.length === 1 ? "change" : "changes"}</span>
          </h3>
          <ul className="activity-list">
            {g.items.map((i) => {
              const verb = VERBS[`${i.entity_type}:${i.action}`] ?? i.action.replace(/_/g, " ");
              const href = linkFor(app, i);
              const title = i.entity_title ?? i.entity_type.replace("_", " ");
              return (
                <li key={i.activity_id} className="activity-item">
                  <div>
                    <strong>{i.actor.display_name}</strong> {verb}{" "}
                    {href ? <Link to={href}>{title}</Link> : <span>{title}</span>}
                  </div>
                  <div className="small muted row">
                    {i.through_agent ? (
                      <span className="row" title={i.actor.client ? `through ${i.actor.client}` : "through an agent"}>
                        <IconAgent width={14} height={14} /> Through {i.actor.client ?? "an agent"}
                      </span>
                    ) : null}
                    {!compact ? <span>{i.summary}</span> : null}
                    <time dateTime={i.occurred_at} title={new Date(i.occurred_at).toLocaleString()}>
                      {relativeTime(i.occurred_at)}
                    </time>
                  </div>
                  {compact ? <div className="small faint">{i.summary}</div> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.hasNextPage ? (
        <Button onClick={() => q.fetchNextPage()} busy={q.isFetchingNextPage} busyLabel="Loading older changes…">
          Show older changes
        </Button>
      ) : (
        <p className="small faint">The log begins here.</p>
      )}
    </div>
  );
}
