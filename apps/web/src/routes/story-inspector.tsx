import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { attribution, formatDate, formatDateTime, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS, toneFor } from "../lib/status.ts";
import { Button, EmptyState, Glyph, Group, KeyValue, Menu, MenuRadio, StatusBadge } from "../ui/index.tsx";
import type { CitationCheck, PageView, RefKind, ResolvedRef, StoryNode, VersionItem, VersionView } from "./story-model.ts";

const REF_KINDS: { kind: RefKind; label: string }[] = [
  { kind: "objectives", label: "Objectives" },
  { kind: "sources", label: "Sources" },
  { kind: "insights", label: "Insights" },
  { kind: "assumptions", label: "Assumptions" },
  { kind: "decisions", label: "Decisions" },
];

function refLink(app: string, kind: RefKind, id: string): string {
  switch (kind) {
    case "objectives":
      return `${app}/objectives`;
    case "sources":
      return `${app}/evidence/${id}`;
    case "insights":
      return `${app}/synthesis/insights/${id}`;
    case "assumptions":
      return `${app}/synthesis/assumptions/${id}`;
    case "decisions":
      return `${app}/synthesis/decisions/${id}`;
  }
}

function refStatus(kind: RefKind, r: ResolvedRef): string | null {
  if (r.missing) return "No longer in this product";
  if (r.archived) return "Archived";
  if ((kind === "assumptions" || kind === "decisions") && r.status) return REVIEW_STATUS[r.status]?.label ?? r.status;
  if (kind === "insights" && r.status === "draft") return "Draft";
  if (kind === "objectives" && r.status === "achieved") return "Achieved";
  return null;
}

/** Drift in words, never colour alone. */
function driftWords(c: CitationCheck): string {
  const base = {
    ok: "Matches the source",
    relocated: c.relocated ? `Moved to ¶${c.relocated.seq_start}${c.relocated.seq_end !== c.relocated.seq_start ? `–${c.relocated.seq_end}` : ""}` : "Moved in the source",
    text_changed: "Source text changed",
    record_archived: "Source archived",
    record_deleted: "Source deleted",
    record_missing: "Source not found",
  }[c.status];
  return c.version_drift ? `${base} · newer file version` : base;
}

function address(a: number, b: number) {
  return a === b ? `¶${a}` : `¶${a}–${b}`;
}

export function StoryInspectorBody({ page, shown, versions, parent, placed, subpages, onArchive, onRestore, onEditNotes, busy }: {
  page: PageView;
  shown: VersionView;
  versions: VersionItem[] | undefined;
  parent: StoryNode | null;
  placed: boolean;
  subpages: StoryNode[];
  onArchive: () => void;
  onRestore: () => void;
  onEditNotes: () => void;
  busy: boolean;
}) {
  const { app, api: base, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const checks = useQuery({
    queryKey: ["story-citations", base, page.page_id, shown.version],
    enabled: shown.citations.length > 0,
    queryFn: () => api<{ citations: CitationCheck[] }>("GET", `${base}/story/pages/${page.page_id}/check-citations?version=${shown.version}`),
  });
  const isCurrent = shown.version === page.current_version;
  const pickVersion = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === page.current_version) next.delete("v");
    else next.set("v", String(n));
    setParams(next);
  };
  const refCount = REF_KINDS.reduce((n, k) => n + (shown.resolved_refs[k.kind]?.length ?? 0), 0);
  const notes = page.agent_notes;
  return (
    <div className="story-inspector">
      <Group title="About">
        <KeyValue
          items={[
            { label: "By", value: attribution(shown.published_by) },
            { label: "Date", value: <time dateTime={shown.published_at}>{formatDateTime(shown.published_at)}</time> },
            {
              label: "Version",
              value:
                versions && versions.length > 1 ? (
                  <Menu
                    label={`Version shown: ${shown.version}${isCurrent ? ", current" : ""}. Choose another version`}
                    triggerClassName="field-button"
                    align="start"
                    minWidth={240}
                    trigger={
                      <>
                        <span className="ellipsis grow">
                          Version {shown.version}
                          {isCurrent ? " · current" : ` of ${page.current_version}`}
                        </span>
                        <Glyph name="chevron-down" size="sm" />
                      </>
                    }
                  >
                    {versions.map((v) => (
                      <MenuRadio key={v.version} checked={v.version === shown.version} meta={formatDate(v.published_at)} onSelect={() => pickVersion(v.version)}>
                        <span className="story-version-item">
                          <span>
                            Version {v.version}
                            {v.version === page.current_version ? " · current" : ""}
                          </span>
                          {v.note ? <span className="story-version-note">{v.note}</span> : null}
                        </span>
                      </MenuRadio>
                    ))}
                  </Menu>
                ) : (
                  `Version ${shown.version}`
                ),
            },
            { label: "Change", value: shown.note ? <span className="story-change-note">{shown.note}</span> : null },
            {
              label: "Parent",
              value: page.archived_at ? null : parent ? <Link className="story-ref-link" to={`${app}/story/${parent.page_id}`}>{parent.title}</Link> : placed ? "Top level" : "Not in the navigation yet",
            },
            {
              label: "Subpages",
              value: subpages.length ? (
                <ul className="story-subpages">
                  {subpages.map((s) => (
                    <li key={s.page_id}>
                      <Link className="story-ref-link" to={`${app}/story/${s.page_id}`}>
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : page.archived_at ? null : (
                <span className="faint">None</span>
              ),
            },
          ]}
        />
        <div className="story-about-end">
          <Link className="quiet-link" to={`${app}/activity?entity_type=story_page&entity_id=${page.page_id}`}>
            <Glyph name="activity" size="sm" /> Activity on this page
          </Link>
          {canWrite ? (
            page.archived_at ? (
              <Button size="sm" icon="archive-restore" busy={busy} busyLabel="Restoring…" onClick={onRestore}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="quiet" icon="archive" busy={busy} busyLabel="Archiving…" onClick={onArchive}>
                Archive
              </Button>
            )
          ) : null}
        </div>
      </Group>

      <Group title="Draws on" count={refCount}>
        {refCount ? (
          <div className="story-refs">
            {REF_KINDS.filter((k) => shown.resolved_refs[k.kind]?.length).map((k) => (
              <div key={k.kind} className="story-ref-kind">
                <h4 className="story-ref-label">{k.label}</h4>
                <ul>
                  {shown.resolved_refs[k.kind].map((r) => {
                    const status = refStatus(k.kind, r);
                    return (
                      <li key={r.id}>
                        {r.missing ? <span className="faint">{r.id}</span> : <Link className="story-ref-link" to={refLink(app, k.kind, r.id)}>{r.title ?? r.id}</Link>}
                        {status ? <span className="story-ref-status"> · {status}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState size="inline">This version lists nothing it draws on. Agents list objectives, sources, insights, assumptions and decisions when they publish.</EmptyState>
        )}
      </Group>

      <Group title="Cited passages" count={shown.citations.length}>
        {shown.citations.length ? (
          <ol className="story-cites">
            {shown.citations.map((c) => {
              const check = checks.data?.citations.find((x) => x.index === c.index);
              return (
                <li key={c.index} className="story-cite">
                  <div className="story-cite-head">
                    <Link className="story-cite-source story-ref-link" to={`${app}/evidence/${c.record_id}`}>
                      {c.source_title ?? "Source"}
                    </Link>
                    <Link className="story-cite-address num" to={`${app}/evidence/${c.record_id}?seq=${c.seq_start}`} aria-label={`Passage ${address(c.seq_start, c.seq_end)} in ${c.source_title ?? "the source"}`}>
                      {address(c.seq_start, c.seq_end)}
                    </Link>
                  </div>
                  <q className="story-cite-quote">{c.quote}</q>
                  <div className="story-cite-status">
                    {check ? (
                      <StatusBadge tone={check.version_drift && check.status === "ok" ? "attention" : toneFor("citation", check.status)}>{driftWords(check)}</StatusBadge>
                    ) : checks.isError ? (
                      <span className="faint">Could not check against the source</span>
                    ) : (
                      <span className="faint">Checking against the source…</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState size="inline">No passages cited on this version. Agents cite the exact passages a page rests on when they publish it.</EmptyState>
        )}
      </Group>

      <Group
        title="Notes for agents"
        action={
          canWrite ? (
            <Button size="sm" variant="quiet" icon="pencil" onClick={onEditNotes}>
              Edit
            </Button>
          ) : undefined
        }
      >
        {notes.content ? (
          <>
            <Markdown source={notes.content} className="prose story-notes" headingShift={3} />
            {notes.updated_at ? (
              <p className="story-notes-meta">
                Updated by {attribution(notes.updated_by)}, <time dateTime={notes.updated_at}>{relativeTime(notes.updated_at)}</time>
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState size="inline">
            Agents keep notes here while they write and maintain this page: what it is for, sources still to fold in, decisions about its structure. They read them before revising it.
          </EmptyState>
        )}
      </Group>
    </div>
  );
}
