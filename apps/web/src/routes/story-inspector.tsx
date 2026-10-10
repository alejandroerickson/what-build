import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { attribution, citationCheckWords, formatDate, formatDateTime, nestQuotes, relativeTime } from "../lib/format.ts";
import { Markdown, passageHref } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { REVIEW_STATUS, toneFor } from "../lib/status.ts";
import { Button, EmptyState, Glyph, Group, KeyValue, Menu, MenuRadio, StatusBadge } from "../ui/index.tsx";
import type { CitationCheck, MockupShown, PageView, RefKind, ResolvedRef, VersionItem, VersionView } from "./story-model.ts";

const REF_KINDS: { kind: RefKind; label: string }[] = [
  { kind: "outcomes", label: "Outcomes" },
  { kind: "sources", label: "Sources" },
  { kind: "assumptions", label: "Assumptions" },
];

function refLink(app: string, kind: RefKind, id: string): string {
  switch (kind) {
    case "outcomes":
      return `${app}/idea`;
    case "sources":
      return `${app}/evidence/${id}`;
    case "assumptions":
      return `${app}/exploration/assumptions/${id}`;
  }
}

function refStatus(kind: RefKind, r: ResolvedRef): string | null {
  if (r.missing) return "No longer in this product";
  if (r.archived) return "Archived";
  if (kind === "assumptions" && r.status) return REVIEW_STATUS[r.status]?.label ?? r.status;
  if (kind === "outcomes" && r.status === "achieved") return "Achieved";
  return null;
}

/** Drift in words, never colour alone. */
/** A citation check in words, as an assumption, a Story page and a mockup all show it. */
export function driftWords(c: CitationCheck): string {
  const base = {
    ok: "Matches the source",
    relocated: c.relocated ? `Moved to ¶${c.relocated.seq_start}${c.relocated.seq_end !== c.relocated.seq_start ? `–${c.relocated.seq_end}` : ""}` : "Moved in the source",
    text_changed: "Source text changed",
    record_archived: "Source archived",
    record_deleted: "Source deleted",
    record_missing: "Source not found",
  }[c.status];
  return citationCheckWords(base, c);
}

function address(a: number, b: number) {
  return a === b ? `¶${a}` : `¶${a}–${b}`;
}

/** A version that shows a mockup page: which page, of which mockup, at which version, and whether a newer one exists. */
function Shows({ mockup: m }: { mockup: MockupShown }) {
  const { app } = useProduct();
  const newer = m.current_version != null && m.version != null && m.current_version > m.version;
  return (
    <Group title="Shows">
      <p className="story-shows">
        <Link className="story-ref-link" to={`${app}/exploration/mockups/${m.mockup_id}?v=${m.version}&page=${m.page_id}`}>
          {m.page_title ?? m.page_id}
        </Link>
        <span className="faint">
          , from the mockup {m.mockup_title ?? "no longer in this product"}, version {m.version}
          {m.mockup_archived ? " (archived)" : ""}
        </span>
      </p>
      {newer ? (
        <p className="story-about-note">
          The mockup has a newer version, {m.current_version}. This page stays on version {m.version} until someone promotes the newer one from the mockup.
        </p>
      ) : null}
    </Group>
  );
}

export function StoryInspectorBody({ page, shown, versions, onExport }: {
  page: PageView;
  shown: VersionView;
  versions: VersionItem[] | undefined;
  onExport: () => void;
}) {
  const { app, api: base, storyOnly } = useProduct();
  const [params, setParams] = useSearchParams();
  const citations = shown.citations ?? [];
  const checks = useQuery({
    queryKey: ["story-citations", base, page.page_id, shown.version],
    enabled: citations.length > 0,
    queryFn: () => api<{ citations: CitationCheck[] }>("GET", `${base}/story/pages/${page.page_id}/check-citations?version=${shown.version}`),
  });
  const isCurrent = shown.version === page.current_version;
  const pickVersion = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === page.current_version) next.delete("v");
    else next.set("v", String(n));
    setParams(next);
  };
  const refs = shown.resolved_refs;
  const refCount = REF_KINDS.reduce((n, k) => n + (refs?.[k.kind]?.length ?? 0), 0);
  const notes = page.agent_notes;
  const numbered = isCurrent ? String(shown.version) : `${shown.version} of ${page.current_version}`;
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
                    label={`Version ${numbered}. Choose a version to read`}
                    triggerClassName="field-button"
                    align="start"
                    minWidth={220}
                    trigger={
                      <>
                        <span className="ellipsis grow num">{numbered}</span>
                        <Glyph name="chevron-down" size="sm" />
                      </>
                    }
                  >
                    {versions.map((v) => (
                      <MenuRadio key={v.version} checked={v.version === shown.version} meta={formatDate(v.published_at)} onSelect={() => pickVersion(v.version)}>
                        Version {v.version}
                        {v.version === page.current_version ? " · current" : ""}
                      </MenuRadio>
                    ))}
                  </Menu>
                ) : (
                  <span className="num">{numbered}</span>
                ),
            },
          ]}
        />
        <p className="story-about-note">
          {storyOnly ? "Agents write and maintain the Story." : "Agents write and maintain the Story, and a page of a mockup can be promoted to it from the mockup."} You can read any version.
        </p>
        <Button size="sm" icon="download" className="story-export-button" onClick={onExport}>
          Export to PDF…
        </Button>
      </Group>

      {shown.mockup?.mockup_id ? <Shows mockup={shown.mockup} /> : null}

      {/* A reader gets none of what follows: what the page draws on, its cited passages, its notes for agents. */}
      {refs ? (
        <Group title="Draws on" count={refCount}>
          {refCount ? (
            <div className="story-refs">
              {REF_KINDS.filter((k) => refs[k.kind]?.length).map((k) => (
                <div key={k.kind} className="story-ref-kind">
                  <h4 className="story-ref-label">{k.label}</h4>
                  <ul>
                    {refs[k.kind].map((r) => {
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
            <EmptyState size="inline">This version lists nothing it draws on. Agents list outcomes, sources and assumptions when they publish.</EmptyState>
          )}
        </Group>
      ) : null}

      {shown.citations ? (
        <Group title="Cited passages" count={citations.length}>
          {citations.length ? (
            <ol className="story-cites">
              {citations.map((c) => {
                const check = checks.data?.citations.find((x) => x.index === c.index);
                return (
                  <li key={c.index} className="story-cite">
                    <div className="story-cite-head">
                      <Link className="story-cite-source story-ref-link" to={`${app}/evidence/${c.record_id}`}>
                        {c.source_title ?? "Source"}
                      </Link>
                      <Link className="story-cite-address num" to={passageHref(app, c.record_id, c.seq_start, c.seq_end)} aria-label={`Passage ${address(c.seq_start, c.seq_end)} in ${c.source_title ?? "the source"}`}>
                        {address(c.seq_start, c.seq_end)}
                      </Link>
                    </div>
                    <q className="story-cite-quote">{nestQuotes(c.quote)}</q>
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
      ) : null}

      {notes ? (
        <Group title="Notes for agents">
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
            Agents keep notes here as they write and maintain this page: what it&rsquo;s for, sources still to fold in, choices about its structure. They read them before revising it.
          </EmptyState>
        )}
      </Group>
      ) : null}
    </div>
  );
}
