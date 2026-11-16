import { useCallback, useMemo, useState, type ReactNode } from "react";
import { attribution } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { AsEditor, useProduct } from "../lib/session.tsx";
import { Inspector, PanelContext, PanelFilter, PanelSection, usePageTitle } from "../shell/slots.tsx";
import { Crumbs, Glyph, Menu, MenuItem, Sheet, SheetHeader } from "../ui/index.tsx";
import { AddSourceButton, SortControl, SourceRow } from "../routes/evidence.tsx";
import { IdeaCard } from "../routes/idea.tsx";
import { Canvas, type CanvasPage } from "../routes/mockup-canvas.tsx";
import { MockupTree } from "../routes/mockup-tree.tsx";
import { MockupInspector, type MockupVersion, type MockupView } from "../routes/mockups.tsx";
import { SourcePreview } from "../routes/source-preview.tsx";
import type { PageView as PageFit } from "../routes/story-flip.tsx";
import { FocusToggle } from "../routes/story-focus.tsx";
import { StoryInspectorBody } from "../routes/story-inspector.tsx";
import { flatten, type Hierarchy, type PageView, type VersionView } from "../routes/story-model.ts";
import { StoryTree, useArrange } from "../routes/story-tree.tsx";
import { TUTORIAL, TUTORIAL_ACTOR } from "./content/index.ts";
import { ConceptPicture, OutcomePicture } from "./fronts.tsx";
import { TutorialBadge } from "./parts.tsx";
import { useTutorial } from "./provider.tsx";
import "./tutorial.css";

/*
 * Each page while the tutorial runs: its tutorial content drawn through the components that draw a
 * product's own (the Idea cards, the list of sources and its preview, the canvas and its inspector, the
 * Story's tree, page and inspector), in place of the product's own content, which comes back when it
 * closes. Drawn as someone who can edit sees it (AsEditor), for a guest too, and inert: the tutorial's
 * layer keeps every control out of reach but the ones it lets people try. Nothing here asks the server
 * for anything.
 */

const nothing = () => undefined;

/** A tutorial screen's marks: which page it is, its examples fading, and how far the tutorial has got pressing what a stop opens. */
function useScreen(name: string) {
  const t = useTutorial();
  return { "data-tut-screen": name, "data-leaving": t?.leaving ? "" : undefined, "data-reveal": t?.reveal ?? undefined };
}

export function TutorialIdea() {
  const t = useTutorial();
  const { app } = useProduct();
  const { concept, outcomes } = TUTORIAL.idea;
  usePageTitle("Idea");
  return (
    <AsEditor>
      <div className="idea tut-screen" {...useScreen("idea")}>
        <h1 className="visually-hidden">Idea</h1>
        <IdeaCard
          kind="concept"
          dataTut="concept"
          title={concept.title}
          heading={(hid) => (
            <>
              <h2 className="idea-card-title" id={hid}>
                {concept.title}
              </h2>
              <TutorialBadge />
            </>
          )}
          front={null}
          picture={<ConceptPicture front={concept.front} />}
          ask=""
          back={<Markdown source={concept.text} className="prose idea-card-prose" headingShift={2} />}
          open={t?.opens === "more-info"}
        />
        <PanelContext label="Filter outcomes">
          <PanelSection title="Archived">
            <PanelFilter to={`${app}/idea`} current>
              Hide archived
            </PanelFilter>
            <PanelFilter to={`${app}/idea?include_archived=1`} current={false}>
              Include archived
            </PanelFilter>
          </PanelSection>
        </PanelContext>
        <section className="idea-outcomes" aria-labelledby="tutorial-outcomes">
          <h2 className="idea-section-title" id="tutorial-outcomes">
            Outcomes
            <span className="idea-section-count num">{outcomes.length}</span>
          </h2>
          <ol className="idea-grid">
            {outcomes.map((o, i) => (
              <li key={o.id} className="idea-grid-item">
                <IdeaCard
                  kind="outcome"
                  dataTut={i === 0 ? "outcome" : undefined}
                  title={o.title}
                  lead={
                    <span className="idea-card-index num" aria-hidden="true">
                      {i + 1}
                    </span>
                  }
                  heading={(hid) => (
                    <>
                      <h3 className="idea-card-title" id={hid}>
                        <span className="visually-hidden">Outcome {i + 1}: </span>
                        {o.title}
                      </h3>
                      <TutorialBadge />
                    </>
                  )}
                  front={null}
                  picture={<OutcomePicture front={o.front} />}
                  ask=""
                  back={<Markdown source={o.text} className="prose idea-card-prose" headingShift={3} />}
                  meta={<>Updated by {attribution(TUTORIAL_ACTOR)}</>}
                  open={false}
                  tools={
                    <Menu label={`Actions for ${o.title}`} triggerClassName="icon-btn icon-btn-sm" trigger={<Glyph name="ellipsis" />} align="end">
                      <MenuItem icon="archive" onSelect={nothing}>
                        Archive
                      </MenuItem>
                    </Menu>
                  }
                />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </AsEditor>
  );
}

export function TutorialEvidence() {
  const t = useTutorial();
  const { app } = useProduct();
  const { sources, preview } = TUTORIAL.evidence;
  const open = t?.opens === "preview";
  // At the preview's stop the source is selected: pressed, then its preview opens beside the list.
  const selecting = t?.current?.opens === "preview";
  const shown = sources.find((s) => s.record_id === preview.source) ?? sources[0]!;
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sources) for (const tag of s.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts];
  }, [sources]);
  usePageTitle("Sources");
  const list = (
    <Sheet className="sources-sheet">
      <SheetHeader level={1} title="Sources" count={String(sources.length)} filter={<SortControl sort="date" order="desc" link={() => `${app}/evidence`} />} end={open ? undefined : <AddSourceButton />} />
      <div className={open ? "sources-split-list" : undefined}>
        <ul className="sources-rows" aria-label="Sources">
          {sources.map((r) => (
            <SourceRow key={r.record_id} r={r} to={`${app}/evidence`} sort="date" twin={false} selected={selecting && r.record_id === shown.record_id} compact={open} onOpen={nothing} mark={<TutorialBadge />} />
          ))}
        </ul>
      </div>
      {open ? (
        <p className="sources-keys" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Sources
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> Pages
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </p>
      ) : null}
    </Sheet>
  );
  return (
    <AsEditor>
      <div className="tut-screen tut-evidence" {...useScreen("evidence")}>
        <PanelContext label="Filter sources">
          <PanelSection title="Tags">
            <PanelFilter to={`${app}/evidence`} current count={sources.length}>
              All tags
            </PanelFilter>
            {tags.map(([tag, n]) => (
              <PanelFilter key={tag} to={`${app}/evidence?tags=${encodeURIComponent(tag)}`} current={false} count={n}>
                {tag}
              </PanelFilter>
            ))}
          </PanelSection>
          <PanelSection title="Archived">
            <PanelFilter to={`${app}/evidence`} current>
              Hide archived
            </PanelFilter>
            <PanelFilter to={`${app}/evidence?include_archived=1`} current={false}>
              Include archived
            </PanelFilter>
          </PanelSection>
        </PanelContext>
        {open ? (
          <div className="sources-split">
            {list}
            <SourcePreview s={shown} page={preview.page} onPage={nothing} onClose={nothing} to={`${app}/evidence`} phone={false} />
          </div>
        ) : (
          list
        )}
      </div>
    </AsEditor>
  );
}

/** The example canvas as Exploration's screens give it, a version of three pages, and as the panel lists it. */
function useExampleMockup(): { view: MockupView; version: MockupVersion } {
  return useMemo(() => {
    const { mockup, pages } = TUTORIAL.exploration;
    const version: MockupVersion = {
      version: mockup.version,
      title: mockup.title,
      columns: mockup.columns,
      pages: pages.map(({ draw: _, ...p }) => p),
      summary: mockup.summary,
      brief: mockup.brief,
      files: [],
      prototype: null,
      clickable: { viewable: true },
      published_at: mockup.publishedAt,
      published_by: TUTORIAL_ACTOR,
    };
    const view: MockupView = {
      mockup_id: mockup.id,
      title: mockup.title,
      summary: mockup.summary,
      folder_id: null,
      current_version: mockup.version,
      archived_at: null,
      etag: "tutorial",
      updated_at: mockup.publishedAt,
      page_count: pages.length,
      folder: null,
      current: version,
      story_pages: [],
    };
    return { view, version };
  }, []);
}

/** Exploration's panel while the tutorial runs: the example canvas, in the panel's own list of mockups. */
export function TutorialExplorationPanel() {
  const { view } = useExampleMockup();
  const shown = useMemo(() => ({ list: { items: [view], folders: [] }, current: view.mockup_id, mark: <TutorialBadge /> }), [view]);
  return (
    <PanelContext label="Mockups">
      <MockupTree shown={shown} />
    </PanelContext>
  );
}

export function TutorialExploration() {
  const t = useTutorial();
  const { view, version } = useExampleMockup();
  const [selected, setSelected] = useState<string | null>(null);
  const [pageView, setPageView] = useState<PageFit>("fit");
  const clickable = Boolean(t?.prototype);
  const first = version.pages[0]?.page_id ?? null;
  const shownPage = selected ?? (clickable ? first : null);
  const drawPage = useCallback((p: CanvasPage) => TUTORIAL.exploration.pages.find((x) => x.page_id === p.page_id)?.draw() ?? null, []);
  const pageSrc = useCallback(() => "", []);
  const hitKey = t?.hitKey;
  usePageTitle(view.title);
  return (
    <AsEditor>
      <div className="mockup-view tut-screen" {...useScreen("exploration")} data-focus={t?.focus ? "" : undefined}>
        <div className="story-bar">
          <Crumbs label="Location" currentAsHeading items={[{ label: "Exploration" }, { label: "Mockups" }, { label: view.title }]} />
          <span className="xc-version num">Version {version.version}</span>
          {/* At the canvas stop, Focus and Show panels work as F does; the tutorial's own Focus, never the person's choice. */}
          <FocusToggle focus={Boolean(t?.focus)} hint={false} onToggle={() => t?.toggleFocus()} />
        </div>
        <Canvas
          key={t?.canvasKey ?? 0}
          version={version}
          pageSrc={pageSrc}
          drawPage={drawPage}
          onUse={hitKey}
          rememberMode={false}
          selected={shownPage}
          onSelect={setSelected}
          onKey={(k) => (k === "f" ? t?.toggleFocus() : undefined)}
          canFocus={t?.current?.id === "canvas"}
          pageView={pageView}
          onPageView={setPageView}
          clickable={clickable}
          onFollow={setSelected}
        />
        <Inspector title={view.title}>
          <MockupInspector
            e={view}
            shown={version}
            versions={undefined}
            onVersion={nothing}
            selected={shownPage}
            clickable={clickable}
            onView={(on) => {
              t?.setPrototype(on);
              if (on && !selected) setSelected(first);
            }}
          />
        </Inspector>
      </div>
    </AsEditor>
  );
}

export function TutorialStory() {
  const { api: base } = useProduct();
  const { tree, page: p, style, draw } = TUTORIAL.story;
  const hierarchy = useMemo<Hierarchy>(() => ({ etag: null, items: tree, unplaced: [] }), [tree]);
  const arrange = useArrange(base, hierarchy);
  const refs = useMemo(() => new Map(flatten(tree).map(({ node }) => [node.page_id, { page_id: node.page_id, title: node.title, etag: "tutorial", archived_at: null }])), [tree]);
  const shown: VersionView = { version: p.version, page_id: p.id, title: p.title, summary: p.summary, published_at: p.publishedAt, published_by: TUTORIAL_ACTOR };
  const page: PageView = {
    page_id: p.id,
    title: p.title,
    summary: p.summary,
    current_version: p.version,
    archived_at: null,
    etag: "tutorial",
    updated_at: p.publishedAt,
    agent_notes: { content: p.notes, etag: "tutorial", updated_at: null, updated_by: null },
    current: shown,
  };
  const actions = { archive: nothing, restore: nothing, remove: nothing };
  usePageTitle(p.title);
  return (
    <AsEditor>
      <div className="story-view tut-screen" {...useScreen("story")}>
        <StoryTree
          arrange={arrange}
          archived={[]}
          refOf={(id) => refs.get(id)}
          current={p.id}
          onExport={nothing}
          actions={actions}
          style={style}
          onStyle={nothing}
          markOf={(id) => (refs.has(id) && id === p.id ? <TutorialBadge /> : null)}
        />
        <div className="story-bar">
          <Crumbs label="Page location" currentAsHeading items={[{ label: "Story" }, { label: p.title }]} />
          <FocusToggle focus={false} hint={false} onToggle={nothing} />
        </div>
        <div className="story-frame-wrap">
          <div className="story-frame tut-story-frame">{draw()}</div>
        </div>
        <Inspector title={p.title}>
          <StoryInspectorBody page={page} shown={shown} versions={undefined} onExport={nothing} actions={actions} />
        </Inspector>
      </div>
    </AsEditor>
  );
}


/** A page's own screen, or its tutorial content while the tutorial shows its examples. */
export function WhileTutorial({ tutorial, children }: { tutorial: ReactNode; children: ReactNode }) {
  return <>{useTutorial()?.showing ? tutorial : children}</>;
}
