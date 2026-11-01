import { useQuery } from "@tanstack/react-query";
import { MOCKUP_PAGE_SANDBOX, STORY_PAGE_SANDBOX } from "@whatbuild/core/page-sandbox";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { usePutBacks, useRefusedFrame } from "../lib/minute.ts";
import { useProduct } from "../lib/session.tsx";
import { useScheme } from "../shell/theme.ts";
import { Inspector, usePageTitle } from "../shell/slots.tsx";
import { deletedSentence } from "../lib/format.ts";
import { Button, ButtonLink, Callout, Crumbs, EmptyState, ErrorCallout, FrameStopped, Loading, Sheet } from "../ui/index.tsx";
import { FirstUse } from "./first-use.tsx";
import { Canvas, pageAddress, usePinnedPrototype } from "./mockup-canvas.tsx";
import { DeletePage, useArchiveActions, type PageActions, type PageRef } from "./story-actions.tsx";
import { ExportDialog } from "./story-export.tsx";
import { StoryInspectorBody } from "./story-inspector.tsx";
import { arrangement, flatten, mockupStop, trail, type CanvasShown, type Hierarchy, type PageSummary, type PageView, type VersionItem, type VersionView } from "./story-model.ts";
import { MockupFlip, PAGE_VIEW_KEYS, PageViewToggle, useFlipKeys, usePageView, usePageViewKeys, type FlipKey, type PageView as MockupPageView } from "./story-flip.tsx";
import { FocusToggle, useStoryFocus, type StoryKey } from "./story-focus.tsx";
import { StyleDialog, styleLine, useStoryStyle } from "./story-style.tsx";
import { StoryTree, useArrange } from "./story-tree.tsx";
import "../styles/screens/story.css";

// The frame asks the server for the page with ?theme= (useScheme), which marks the page's <html> so
// the guidance stylesheet follows the app, not only the system. Pages with older stylesheets follow the system.

/**
 * The page in its sandbox. Until the frame has its document, skeleton lines stand in for the page,
 * so a slow page reads as loading rather than blank.
 *
 * The frame asks for the page with ?frame=1, which adds a small script inside the sandbox: it passes
 * F and Esc on (keys pressed in a frame never reach the app), hands a link to another page of this
 * Story to the app, and opens every other link in a new tab. A page that still manages to load
 * another address in its place (a script, a refresh) is put back, and the reader is told, so the
 * app never shows someone else's page inside its own frame. A page refused for the minute's calls
 * gets a short document that says so and tells the app, and comes back the same way, as a new frame
 * whose first load is its first (useRefusedFrame). Each new frame is a call, so a page put back again
 * and again stops being shown (usePutBacks).
 *
 * storyBase is the address this Story's pages live under. The frame is told it once its document
 * has loaded; all it ever sends back is a page's slug, which is checked again here. home is the
 * product's own address, so a link the page holds into the product on another deployment (written
 * there, and copied here) opens here instead.
 */
const PAGE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FRAME_KEYS: readonly unknown[] = ["f", "Escape", "ArrowLeft", "ArrowRight", "2", "3"] satisfies StoryKey[];

export function StoryFrame({
  title,
  scheme,
  src,
  onKey,
  storyBase,
  home,
  onPage,
  size,
  prototype,
  view = "fill",
}: {
  title: string;
  scheme: "light" | "dark";
  src: string;
  onKey?: (key: StoryKey) => void;
  storyBase?: string;
  home?: string;
  onPage?: (pageId: string) => void;
  /** A mockup page's own size: the frame keeps it, scaled down to the room there is, never up, in a mockup page's sandbox. */
  size?: { width: number; height: number };
  /**
   * Set when the page is an entry into a mockup's prototype: src is the entry's own address, and
   * the frame takes the sandbox the server names. The prototype's documents move inside the frame,
   * each saying it has loaded; a load that does not say so within a moment is put back.
   */
  prototype?: { sandbox: string } | null;
  /** For a mockup page: scaled to the room's width (fill), or to its width and height (fit). */
  view?: MockupPageView;
}) {
  const [loaded, setLoaded] = useState(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const fitted = Boolean(size) && view === "fit";
  useLayoutEffect(() => {
    if (!size || !wrap.current) return;
    const el = wrap.current;
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);
  const scale = size && room.width ? Math.min(1, room.width / size.width, fitted && room.height ? room.height / size.height : 1) : 1;
  const [reloads, setReloads] = useState(0);
  const [replaced, setReplaced] = useState(false);
  const loads = useRef(0);
  const ready = useRef(false);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // The sandboxed page has an opaque origin, so the message cannot be addressed to one.
  const hello = () => {
    if (storyBase && onPage) frame.current?.contentWindow?.postMessage({ whatbuild: "story-base", base: storyBase }, "*");
    if (home) frame.current?.contentWindow?.postMessage({ whatbuild: "app-home", home }, "*");
  };
  const helloRef = useRef(hello);
  helloRef.current = hello;
  const newFrame = () => {
    ready.current = false;
    loads.current = 0;
    setLoaded(false);
    setReloads((n) => n + 1);
  };
  const mayPutBack = usePutBacks();
  const [givenUp, setGivenUp] = useState(false);
  const putBack = () => {
    setReplaced(true);
    if (mayPutBack()) newFrame();
    else setGivenUp(true);
  };
  const refusal = useRefusedFrame(frame, newFrame, !prototype);
  useEffect(() => () => {
    if (waiting.current) clearTimeout(waiting.current);
  }, []);

  useEffect(() => {
    if (!onKey && !onPage && !prototype) return;
    const handle = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; key?: unknown; page?: unknown } | null;
      if (data?.whatbuild === "frame-ready" && prototype) {
        if (waiting.current) {
          clearTimeout(waiting.current);
          waiting.current = null;
          helloRef.current();
        } else ready.current = true;
        return;
      }
      if (data?.whatbuild === "story-key" && FRAME_KEYS.includes(data.key)) onKey?.(data.key as StoryKey);
      if (data?.whatbuild === "story-page" && typeof data.page === "string" && PAGE_SLUG.test(data.page)) onPage?.(data.page);
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onKey, onPage, prototype]);

  const page = (
    <iframe
      key={reloads}
      ref={frame}
      title={title}
      className={size ? "story-frame-mockup" : "story-frame"}
      style={size ? { width: size.width, height: size.height, transform: `scale(${scale})` } : { colorScheme: scheme }}
      sandbox={prototype?.sandbox ?? (size ? MOCKUP_PAGE_SANDBOX : STORY_PAGE_SANDBOX)}
      referrerPolicy="no-referrer"
      src={prototype ? src : `${src}${src.includes("?") ? "&" : "?"}frame=1`}
      onLoad={() => {
        if (prototype) {
          setLoaded(true);
          if (ready.current) {
            ready.current = false;
            hello();
          } else waiting.current = setTimeout(() => {
            waiting.current = null;
            putBack();
          }, 1500);
          return;
        }
        loads.current += 1;
        if (loads.current > 1) {
          putBack();
          return;
        }
        setLoaded(true);
        hello();
      }}
    />
  );

  if (givenUp)
    return (
      <div className="story-frame-wrap story-frame-stopped">
        <Callout tone="attention" inset title="This page keeps trying to open another address in its place">
          WhatBuild stopped showing it.
        </Callout>
      </div>
    );

  if (refusal.stopped)
    return (
      <div className="story-frame-wrap story-frame-stopped">
        <FrameStopped what="This page" refusal={refusal} />
      </div>
    );

  return (
    <div className="story-frame-wrap" ref={wrap} data-fit={fitted ? "" : undefined}>
      {replaced ? (
        <Callout tone="attention" title="This page tried to open another address in its place">
          WhatBuild put the page back.
        </Callout>
      ) : null}
      {size ? (
        <div className="story-mockup" style={{ width: size.width * scale, height: size.height * scale }}>
          {page}
        </div>
      ) : (
        page
      )}
      {loaded ? null : (
        <div className="story-frame-status">
          <Loading variant="lines" lines={6} label="Loading the page…" />
        </div>
      )}
    </div>
  );
}

/**
 * A Story page that shows a whole canvas: the mockup's board, for whoever reads the Story, with the
 * page chosen in the URL as on the mockup's own screen (?page=). Its pages come from the Story page's
 * own route, which a reader may use, and it holds only the mockup's pages, with no brief or notes.
 */
function StoryCanvas({ base, pageId, shown, mockup, onKey, canFocus, reread }: {
  base: string;
  pageId: string;
  shown: VersionView;
  mockup: CanvasShown;
  onKey: (key: "f" | "Escape") => void;
  canFocus: boolean;
  reread: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [pageView, setPageView] = usePageView("whatbuild.mockup.page-view", "fit");
  const { pages } = mockup;
  const version = useMemo(
    () => ({ version: shown.version, title: shown.title, columns: mockup.columns, pages, prototype: mockup.prototype ?? null }),
    [shown.version, shown.title, mockup.columns, pages, mockup.prototype],
  );
  const pinned = usePinnedPrototype(version, reread);
  const asked = params.get("page");
  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set("page", id);
      else next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  if (!pages.length) return <EmptyState title="This canvas is gone">Its mockup was deleted after this version was published.</EmptyState>;
  return (
    <Canvas
      version={version}
      pageSrc={(p) => pageAddress(p, version, pinned, `${base}/story/pages/${pageId}/versions/${shown.version}/pages/${p.page_id}/html`)}
      selected={pages.some((p) => p.page_id === asked) ? asked : null}
      onSelect={select}
      onKey={onKey}
      canFocus={canFocus}
      pageView={pageView}
      onPageView={setPageView}
      showRequest={0}
    />
  );
}

export function StoryPage() {
  const { pageId } = useParams();
  const { api: base, app, product, storyOnly, canWrite } = useProduct();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scheme = useScheme();
  const vParam = params.get("v");
  const asked = vParam && /^\d+$/.test(vParam) ? Number(vParam) : null;
  /** The pages Export to PDF opens with, while it is open. */
  const [exporting, setExporting] = useState<string[] | null>(null);
  const [styling, setStyling] = useState(false);
  const style = useStoryStyle();

  const h = useQuery({ queryKey: ["story-tree", base], queryFn: () => api<Hierarchy>("GET", `${base}/story/hierarchy`) });
  const arrange = useArrange(base, h.data);
  const pages = useQuery({ queryKey: ["story-pages", base], queryFn: () => api<{ items: PageSummary[] }>("GET", `${base}/story/pages?include_archived=true`) });
  const page = useQuery({
    queryKey: ["story-page", base, pageId],
    enabled: Boolean(pageId),
    queryFn: () => api<PageView>("GET", `${base}/story/pages/${pageId}?include_html=false`),
  });
  const versions = useQuery({
    queryKey: ["story-versions", base, pageId],
    enabled: Boolean(pageId) && page.isSuccess,
    queryFn: () => api<{ items: VersionItem[] }>("GET", `${base}/story/pages/${pageId}/versions?limit=100`),
  });
  const wantsOld = asked !== null && page.data !== undefined && asked !== page.data.current_version;
  const old = useQuery({
    queryKey: ["story-version", base, pageId, asked],
    enabled: wantsOld,
    queryFn: () => api<VersionView>("GET", `${base}/story/pages/${pageId}/versions/${asked}?include_html=false`),
  });

  const shown = page.data ? (wantsOld ? old.data : page.data.current) : undefined;
  const onCanvas = Boolean(shown?.mockup?.canvas);
  // A canvas gains the whole screen, on a phone too, as it does on the mockup's own screen.
  const focusMode = useStoryFocus(page.isSuccess, { onPhone: onCanvas });

  const rememberKey = `whatbuild.story.${product.product_id}`;
  useEffect(() => {
    if (!pageId || !page.isSuccess) return;
    try {
      localStorage.setItem(rememberKey, pageId);
    } catch {
      // The URL still carries the page.
    }
  }, [pageId, page.isSuccess, rememberKey]);

  usePageTitle(page.data?.title ?? (pageId ? null : "Story"));

  const all = pages.data?.items ?? [];
  const archived = all.filter((p) => p.archived_at);
  const pageTree = arrange.tree;
  const titleOf = (id: string) => all.find((p) => p.page_id === id)?.title ?? id;
  const refOf = (id: string): PageRef | undefined => all.find((p) => p.page_id === id);

  // Arranging, archiving and deleting pages by hand; agents do the same through MCP.
  const [deleting, setDeleting] = useState<PageRef | null>(null);
  const { archive, restore } = useArchiveActions(pageTree);
  const actions: PageActions = { archive, restore, remove: setDeleting };

  // On a mockup page, the arrows and the control beside the crumbs flip to the mockup pages either side.
  const stop = pageId && !onCanvas ? mockupStop(pageTree, pageId) : null;
  const prevId = stop?.prev?.page_id;
  const nextId = stop?.next?.page_id;
  const flip = useCallback(
    (key: FlipKey) => {
      const to = key === "ArrowLeft" ? prevId : nextId;
      if (to) navigate(`${app}/story/${to}`);
    },
    [prevId, nextId, app, navigate],
  );
  useFlipKeys(stop ? flip : null);
  // Fit (2) or fill (3) a mockup page; the choice holds as the arrows flip to the next one.
  const [mockupView, setMockupView] = usePageView("whatbuild.story.mockup-view", "fill");
  usePageViewKeys(stop ? setMockupView : null);
  const onFrameKey = (key: StoryKey) => {
    if (key === "ArrowLeft" || key === "ArrowRight") stop && flip(key);
    else if (key === "2" || key === "3") stop && setMockupView(PAGE_VIEW_KEYS[key]!);
    else focusMode.onKey(key);
  };

  const styleRow = style.data ? (style.data.style ? { name: style.data.style.name, line: styleLine(style.data.style) } : null) : undefined;
  const tree = h.data ? (
    <StoryTree arrange={arrange} archived={archived} refOf={refOf} current={pageId} onExport={setExporting} actions={actions} style={styleRow} onStyle={() => setStyling(true)} />
  ) : null;

  const dialogs = (
    <>
      {exporting ? <ExportDialog tree={pageTree} archived={archived} preselect={exporting} onClose={() => setExporting(null)} /> : null}
      {styling && style.data ? <StyleDialog view={style.data} scheme={scheme} onClose={() => setStyling(false)} /> : null}
      {deleting ? (
        <DeletePage
          page={deleting}
          onArchive={archive}
          onDeleted={() => deleting.page_id === pageId && navigate(`${app}/story`)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );

  if (h.isPending) return <Loading variant="lines" />;
  if (h.isError)
    return (
      <div className="stack">
        <h1 className="visually-hidden">Story</h1>
        <ErrorCallout title="The Story couldn’t be loaded" error={h.error} onRetry={() => h.refetch()} />
      </div>
    );

  if (!pageId) {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(rememberKey);
    } catch {
      remembered = null;
    }
    const everyPage = arrangement(h.data);
    const known = remembered && flatten(everyPage).some((r) => r.node.page_id === remembered);
    const first = (known ? remembered : null) ?? everyPage[0]?.page_id;
    if (first) return <Navigate to={`${app}/story/${first}${window.location.search}`} replace />;
    return (
      <div className="story-view">
        {tree}
        <Crumbs label="Page location" currentAsHeading items={[{ label: "Story" }]} />
        <Sheet label="Story">
          {storyOnly ? (
            <EmptyState title="No Story pages yet">
              Pages appear here once the product&rsquo;s team publishes them.
            </EmptyState>
          ) : (
            <FirstUse title="No Story pages yet" ask={`Draft the first Story page for ${product.name} in WhatBuild from its outcomes and evidence.`}>
              The Story tells stakeholders where this discovery stands.
              {style.data ? (
                <p className="story-first-style">
                  <Button size="sm" variant="quiet" icon="palette" onClick={() => setStyling(true)}>
                    Preview Story styles
                  </Button>
                </p>
              ) : null}
            </FirstUse>
          )}
        </Sheet>
        {dialogs}
      </div>
    );
  }

  const path = trail(pageTree, pageId);
  const root = pageTree[0]?.page_id;
  const title = page.data?.title ?? path?.[path.length - 1]?.title ?? titleOf(pageId);
  const crumbs = [
    { label: "Story", ...(root && root !== pageId ? { to: `${app}/story/${root}` } : {}) },
    ...(path ?? []).slice(0, -1).map((c) => ({ label: c.title, to: `${app}/story/${c.page_id}` })),
    { label: page.isError ? (deletedSentence(page.error) ? "Deleted page" : "Page not found") : title },
  ];

  if (page.isError) {
    const gone = page.error instanceof ApiError && page.error.isNotFound;
    const deleted = deletedSentence(page.error);
    return (
      <div className="story-view">
        {tree}
        <Crumbs label="Page location" currentAsHeading items={crumbs} />
        {deleted ? (
          <EmptyState title="This page was deleted" action={root ? <ButtonLink to={`${app}/story/${root}`}>Open the Story</ButtonLink> : undefined}>
            {deleted}
          </EmptyState>
        ) : gone ? (
          <EmptyState title="This page isn’t in the Story" action={root ? <ButtonLink to={`${app}/story/${root}`}>Open the Story</ButtonLink> : undefined}>
            The link may be mistyped, or the page was never published here.
          </EmptyState>
        ) : (
          <ErrorCallout title="This Story page couldn’t be loaded" error={page.error} onRetry={() => page.refetch()} />
        )}
        {dialogs}
      </div>
    );
  }

  const p = page.data;
  const shownMockup = shown?.mockup;
  const onePage = shownMockup && !shownMockup.canvas ? shownMockup : undefined;

  return (
    <div className={onCanvas ? "story-view mockup-view" : "story-view"} data-focus={onCanvas && focusMode.focus ? "" : undefined}>
      {tree}
      <div className="story-bar">
        <Crumbs label="Page location" currentAsHeading items={crumbs} />
        {stop ? <PageViewToggle view={mockupView} onView={setMockupView} /> : null}
        {stop ? <MockupFlip {...stop} onFlip={flip} /> : null}
        {focusMode.available ? <FocusToggle focus={focusMode.focus} hint={focusMode.hint} onToggle={focusMode.toggle} /> : null}
      </div>
      {!p ? (
        <>
          <Loading variant="lines" />
          {/* Kept while the next page loads, so the inspector does not slide away and back. */}
          <Inspector title={title}>
            <Loading variant="lines" />
          </Inspector>
        </>
      ) : (
        <>
          {p.archived_at ? (
            <Callout
              tone="attention"
              title="This page is archived"
              action={canWrite ? <Button size="sm" icon="archive-restore" onClick={() => restore(p)}>Restore</Button> : undefined}
            />
          ) : null}
          {wantsOld && old.data ? (
            <Callout
              tone="attention"
              title={`You’re reading an earlier version: ${old.data.version} of ${p.current_version}`}
              action={<ButtonLink size="sm" to={`${app}/story/${pageId}`}>Show the current version</ButtonLink>}
            />
          ) : null}
          {wantsOld && old.isError ? (
            <Callout tone="attention" title={`This page has no version ${asked}`} action={<ButtonLink size="sm" to={`${app}/story/${pageId}`}>Show the current version</ButtonLink>}>
              It has {p.current_version} {p.current_version === 1 ? "version" : "versions"}.
            </Callout>
          ) : null}
          {shown?.mockup?.canvas ? (
            <StoryCanvas
              key={`${pageId}:${shown.version}`}
              base={base}
              pageId={pageId}
              shown={shown}
              mockup={shown.mockup}
              onKey={focusMode.onKey}
              canFocus={focusMode.available}
              reread={() => {
                void page.refetch();
                if (wantsOld) void old.refetch();
              }}
            />
          ) : shown ? (
            <StoryFrame
              key={`${pageId}:${shown.version}:${scheme}`}
              title={shown.title}
              scheme={scheme}
              src={onePage?.prototype_url ?? `${base}/story/pages/${pageId}/versions/${shown.version}/html${onePage ? "" : `?theme=${scheme}`}`}
              size={onePage ? { width: onePage.width, height: onePage.height } : undefined}
              prototype={onePage?.prototype_url && onePage.prototype_sandbox ? { sandbox: onePage.prototype_sandbox } : null}
              view={mockupView}
              onKey={onFrameKey}
              storyBase={`${window.location.origin}${app}/story/`}
              home={`${window.location.origin}${app}`}
              onPage={(id) => navigate(`${app}/story/${id}`)}
            />
          ) : wantsOld && old.isPending ? (
            <Loading variant="lines" />
          ) : null}
          <Inspector title={p.title}>
            {shown ? (
              <StoryInspectorBody page={p} shown={shown} versions={versions.data?.items} onExport={() => setExporting([p.page_id])} actions={actions} />
            ) : (
              <Loading variant="lines" />
            )}
          </Inspector>
        </>
      )}
      {dialogs}
    </div>
  );
}
