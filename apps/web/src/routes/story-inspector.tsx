import { Link, useSearchParams } from "react-router";
import { attribution, formatDate, formatDateTime, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { Button, EmptyState, Glyph, Group, KeyValue, Menu, MenuRadio } from "../ui/index.tsx";
import type { PageActions } from "./story-actions.tsx";
import type { MockupShown, PageView, VersionItem, VersionView } from "./story-model.ts";

/** A version that shows a mockup page or its whole canvas: which, of which mockup, at which version, and whether a newer one exists. */
function Shows({ mockup: m }: { mockup: MockupShown }) {
  const { app } = useProduct();
  const newer = m.current_version != null && m.version != null && m.current_version > m.version;
  return (
    <Group title="Shows">
      <p className="story-shows">
        <Link className="story-ref-link" to={`${app}/exploration/mockups/${m.mockup_id}?v=${m.version}${m.canvas ? "" : `&page=${m.page_id}`}`}>
          {m.canvas ? "The whole canvas" : (m.page_title ?? m.page_id)}
        </Link>
        <span className="faint">
          {m.canvas ? " of" : ", from"} the mockup {m.mockup_title ?? "no longer in this product"}, version {m.version}
          {m.mockup_archived ? " (archived)" : ""}
        </span>
      </p>
      {newer ? (
        <p className="story-about-note">
          The mockup has a newer version, {m.current_version}. Promote it from the mockup to show it here.
        </p>
      ) : null}
    </Group>
  );
}

export function StoryInspectorBody({ page, shown, versions, onExport, actions }: {
  page: PageView;
  shown: VersionView;
  versions: VersionItem[] | undefined;
  onExport: () => void;
  actions: PageActions;
}) {
  const { canWrite, canDelete } = useProduct();
  const [params, setParams] = useSearchParams();
  const isCurrent = shown.version === page.current_version;
  const pickVersion = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === page.current_version) next.delete("v");
    else next.set("v", String(n));
    setParams(next);
  };
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
        <div className="story-about-actions">
          <Button size="sm" icon="download" onClick={onExport}>
            Export to PDF…
          </Button>
          {canWrite ? (
            page.archived_at ? (
              <Button size="sm" variant="quiet" icon="archive-restore" onClick={() => actions.restore(page)}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="quiet" icon="archive" onClick={() => actions.archive(page)}>
                Archive
              </Button>
            )
          ) : null}
          {canDelete ? (
            <Button size="sm" variant="quiet" icon="trash" onClick={() => actions.remove(page)}>
              Delete permanently…
            </Button>
          ) : null}
        </div>
      </Group>

      {shown.mockup?.mockup_id ? <Shows mockup={shown.mockup} /> : null}

      {/* A reader is sent no notes for agents, so the group is left out for them. */}
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
          <EmptyState size="inline">No notes yet.</EmptyState>
        )}
      </Group>
      ) : null}
    </div>
  );
}
