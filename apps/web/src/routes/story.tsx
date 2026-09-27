import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { useTheme } from "../shell/theme.ts";
import { Inspector, InspectorToggle, usePageTitle } from "../shell/slots.tsx";
import { useMediaQuery } from "../ui/media.ts";
import { Button, ButtonLink, Callout, Crumbs, EmptyState, ErrorCallout, Glyph, Loading, Menu, MenuItem, useToast } from "../ui/index.tsx";
import { AddPageDialog, ExportDialog, MoveDialog, NotesDialog, PublishDialog, refreshStory, RenameDialog } from "./story-dialogs.tsx";
import { StoryInspectorBody } from "./story-inspector.tsx";
import { locate, MAX_DEPTH, MAX_PAGES, split, toServer, trail, type Hierarchy, type Move, type PageSummary, type PageView, type VersionItem, type VersionView } from "./story-model.ts";
import { RowMenuItems, StoryTree, useArrange, type StoryActions } from "./story-tree.tsx";
import "../styles/screens/story.css";

type DialogState =
  | { kind: "add"; parent: string | null }
  | { kind: "rename"; page: string }
  | { kind: "move"; page: string }
  | { kind: "export"; preselect?: string }
  | { kind: "notes" }
  | { kind: "publish" };

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The app's resolved theme. The frame asks the server for the page with ?theme=, which marks the
 * page's <html> so the guidance stylesheet follows the app, not only the system (browsers ignore an
 * iframe's color-scheme for a page's prefers-color-scheme). Pages with older stylesheets follow the system.
 */
function useScheme(): "light" | "dark" {
  const [choice] = useTheme();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

/**
 * The page in its sandbox. Until the frame has its document, skeleton lines stand in for the page,
 * so a slow page reads as loading rather than blank.
 */
function StoryFrame({ title, scheme, src }: { title: string; scheme: "light" | "dark"; src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="story-frame-wrap">
      <iframe
        title={title}
        className="story-frame"
        style={{ colorScheme: scheme }}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        src={src}
        onLoad={() => setLoaded(true)}
      />
      {loaded ? null : (
        <div className="story-frame-status">
          <Loading variant="lines" lines={6} label="Loading the page…" />
        </div>
      )}
    </div>
  );
}

export function StoryPage() {
  const { pageId } = useParams();
  const { api: base, app, product, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scheme = useScheme();
  const vParam = params.get("v");
  const asked = vParam && /^\d+$/.test(vParam) ? Number(vParam) : null;
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);

  const h = useQuery({ queryKey: ["story-tree", base], queryFn: () => api<Hierarchy>("GET", `${base}/story/hierarchy`) });
  const pages = useQuery({ queryKey: ["story-pages", base], queryFn: () => api<{ items: PageSummary[] }>("GET", `${base}/story/pages?include_archived=true`) });
  const arrange = useArrange(base, h.data);
  const page = useQuery({
    queryKey: ["story-page", base, pageId],
    enabled: Boolean(pageId),
    retry: (n, e) => !(e instanceof ApiError && e.isNotFound) && n < 2,
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
    retry: (n, e) => !(e instanceof ApiError && e.isNotFound) && n < 2,
    queryFn: () => api<VersionView>("GET", `${base}/story/pages/${pageId}/versions/${asked}?include_html=false`),
  });

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
  const titleOf = (id: string) => all.find((p) => p.page_id === id)?.title ?? locate(arrange.tree.placed, id)?.node.title ?? id;

  const archive = async (id: string) => {
    setBusy(true);
    const before = qc.getQueryData<Hierarchy>(["story-tree", base]);
    try {
      const p = await api<PageView>("GET", `${base}/story/pages/${id}?include_html=false`);
      const r = await api<{ promoted_children: string[] }>("POST", `${base}/story/pages/${id}/archive`, { expected_etag: p.etag });
      refreshStory(qc, base);
      const moved = r.promoted_children.length;
      toast(`Archived “${p.title}”.${moved ? ` Its ${moved === 1 ? "subpage" : `${moved} subpages`} moved up in its place.` : ""}`, { action: { label: "Undo", onClick: () => void undoArchive(id, before) } });
    } catch (e) {
      toast(`“${titleOf(id)}” was not archived. ${message(e)}`, { tone: "negative" });
    } finally {
      setBusy(false);
    }
  };

  const undoArchive = async (id: string, before: Hierarchy | undefined) => {
    try {
      const p = await api<PageView>("GET", `${base}/story/pages/${id}?include_html=false`);
      await api("POST", `${base}/story/pages/${id}/restore`, { expected_etag: p.etag });
      let placed = false;
      if (before) {
        try {
          const now = await api<Hierarchy>("GET", `${base}/story/hierarchy`);
          await api("PUT", `${base}/story/hierarchy`, { items: toServer(split(before).placed), expected_etag: now.etag });
          placed = true;
        } catch {
          placed = false;
        }
      }
      refreshStory(qc, base);
      toast(placed ? `Restored “${p.title}” to its place.` : `Restored “${p.title}”. It is in Unplaced pages.`);
    } catch (e) {
      toast(`The archive was not undone. ${message(e)}`, { tone: "negative" });
    }
  };

  const restore = async (id: string) => {
    setBusy(true);
    try {
      const p = await api<PageView>("GET", `${base}/story/pages/${id}?include_html=false`);
      await api("POST", `${base}/story/pages/${id}/restore`, { expected_etag: p.etag });
      refreshStory(qc, base);
      toast(`Restored “${p.title}”. It is in Unplaced pages until you move it into the navigation.`);
    } catch (e) {
      toast(`“${titleOf(id)}” was not restored. ${message(e)}`, { tone: "negative" });
    } finally {
      setBusy(false);
    }
  };

  const actions: StoryActions = {
    addPage: (parent) => setDialog({ kind: "add", parent }),
    rename: (id) => setDialog({ kind: "rename", page: id }),
    moveTo: (id) => setDialog({ kind: "move", page: id }),
    archive: (id) => void archive(id),
    restore: (id) => void restore(id),
    copyLink: (id) => {
      const url = `${window.location.origin}${app}/story/${id}`;
      navigator.clipboard.writeText(url).then(
        () => toast("Link copied."),
        () => toast(`The link could not be copied. It is ${url}`, { tone: "negative" }),
      );
    },
    exportPdf: (preselect) => setDialog({ kind: "export", ...(preselect ? { preselect } : {}) }),
  };

  const moveWithUndo = (m: Move) => {
    const at = locate(arrange.tree.placed, m.page);
    const back: Move = at ? { page: m.page, parent: at.parent?.page_id ?? null, before: at.siblings[at.index + 1]?.page_id ?? null } : { page: m.page, parent: null, before: null, unplace: true };
    const r = arrange.move(m);
    if (!r.ok) toast(`“${titleOf(m.page)}” was not moved. ${r.reason}`, { tone: "negative" });
    else toast(`Moved “${titleOf(m.page)}”.`, { action: { label: "Undo", onClick: () => arrange.move(back) } });
  };

  const onCreated = async (id: string, parent: string | null) => {
    await qc.refetchQueries({ queryKey: ["story-tree", base] });
    const r = arrange.move({ page: id, parent, before: null });
    refreshStory(qc, base);
    setDialog(null);
    navigate(`${app}/story/${id}`);
    toast(r.ok ? "Added the page. Ask an agent to write it." : `Added the page. It is in Unplaced pages: ${r.reason}`);
  };

  const tree = h.data ? (
    <StoryTree arrange={arrange} archived={archived} current={pageId} totalPages={pages.data ? all.length : 0} actions={actions} />
  ) : null;

  const dialogs = (
    <>
      {dialog?.kind === "add" ? (
        <AddPageDialog parent={dialog.parent} parentTitle={dialog.parent ? titleOf(dialog.parent) : null} pages={all} onClose={() => setDialog(null)} onCreated={onCreated} />
      ) : null}
      {dialog?.kind === "rename" ? <RenameDialog page={dialog.page} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "move" ? <MoveDialog page={dialog.page} tree={arrange.tree} onClose={() => setDialog(null)} onMove={moveWithUndo} /> : null}
      {dialog?.kind === "export" ? <ExportDialog tree={arrange.tree} archived={archived} preselect={dialog.preselect} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "notes" && page.data ? <NotesDialog page={page.data} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "publish" && page.data ? <PublishDialog page={page.data} onClose={() => setDialog(null)} /> : null}
    </>
  );

  if (h.isPending) return <Loading variant="lines" />;
  if (h.isError)
    return (
      <div className="stack">
        <h1 className="visually-hidden">Story</h1>
        <ErrorCallout title="The Story could not be loaded" error={h.error} onRetry={() => h.refetch()} />
      </div>
    );

  if (!pageId) {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(rememberKey);
    } catch {
      remembered = null;
    }
    const known = remembered && h.data.items.some(function has(n): boolean {
      return n.page_id === remembered || n.children.some(has);
    });
    const first = (known ? remembered : null) ?? h.data.items[0]?.page_id;
    if (first) return <Navigate to={`${app}/story/${first}${window.location.search}`} replace />;
    return (
      <div className="story-view">
        {tree}
        <Crumbs label="Page location" currentAsHeading items={[{ label: "Story" }]} />
        <EmptyState title="Your Story starts with what you know" action={<ButtonLink to="/connect" variant="primary" icon="plug">Connect an agent</ButtonLink>}>
          The Story is a set of pages that tell stakeholders where this discovery stands. Agents write it from WhatBuild's guidance: connect one and ask it to draft the first page from your objectives and insights.
          {canWrite ? " You can also add a title page with + in the panel and let an agent fill it in." : ""}
        </EmptyState>
        {dialogs}
      </div>
    );
  }

  const path = trail(arrange.tree.placed, pageId);
  const unplaced = arrange.tree.unplaced.some((n) => n.page_id === pageId);
  const root = arrange.tree.placed[0]?.page_id;
  const title = page.data?.title ?? path?.[path.length - 1]?.title ?? titleOf(pageId);
  const crumbs = [
    { label: "Story", ...(root && root !== pageId ? { to: `${app}/story/${root}` } : {}) },
    ...(path ?? []).slice(0, -1).map((c) => ({ label: c.title, to: `${app}/story/${c.page_id}` })),
    { label: page.isError ? "Page not found" : title },
  ];

  if (page.isError) {
    const gone = page.error instanceof ApiError && page.error.isNotFound;
    return (
      <div className="story-view">
        {tree}
        <Crumbs label="Page location" currentAsHeading items={crumbs} />
        {gone ? (
          <EmptyState title="This page is not in the Story" action={root ? <ButtonLink to={`${app}/story/${root}`}>Open the Story</ButtonLink> : undefined}>
            It was never published here, or its address changed. Pages keep their address for good, even when archived.
          </EmptyState>
        ) : (
          <ErrorCallout title="This Story page could not be loaded" error={page.error} onRetry={() => page.refetch()} />
        )}
        {dialogs}
      </div>
    );
  }

  const p = page.data;
  const shown = p ? (wantsOld ? old.data : p.current) : undefined;
  const isCurrent = !wantsOld;
  const parent = path && path.length > 1 ? path[path.length - 2]! : null;
  const subpages = path ? path[path.length - 1]!.children : [];
  const level = path?.length ?? 1;

  return (
    <div className="story-view">
      {tree}
      <Crumbs label="Page location" currentAsHeading items={crumbs} />
      {!p ? (
        <Loading variant="lines" />
      ) : (
        <>
          <div className="story-meta">
            {shown ? (
              <span>
                Version {shown.version}
                {isCurrent ? " · updated " : ` of ${p.current_version} · published `}
                <time dateTime={shown.published_at} title={shown.published_at}>
                  {relativeTime(shown.published_at)}
                </time>
                {!isCurrent ? (
                  <>
                    {" · "}
                    <Link className="quiet-link" to={`${app}/story/${pageId}`}>
                      Show the current version
                    </Link>
                  </>
                ) : null}
              </span>
            ) : (
              <span>Version {asked}</span>
            )}
            <span className="story-meta-end">
              <InspectorToggle />
            </span>
          </div>
          {p.archived_at ? (
            <Callout
              tone="attention"
              title="This page is archived"
              action={canWrite ? <Button size="sm" icon="archive-restore" busy={busy} busyLabel="Restoring…" onClick={() => void restore(p.page_id)}>Restore</Button> : undefined}
            >
              It is out of the Story's navigation and can't be changed. Its versions stay readable here.
            </Callout>
          ) : null}
          {wantsOld && old.isError ? (
            <Callout tone="attention" title={`This page has no version ${asked}`} action={<ButtonLink size="sm" to={`${app}/story/${pageId}`}>Show the current version</ButtonLink>}>
              It has {p.current_version} {p.current_version === 1 ? "version" : "versions"}.
            </Callout>
          ) : null}
          {shown ? (
            <StoryFrame
              key={`${pageId}:${shown.version}:${scheme}`}
              title={`${shown.title}, shown in a sandbox`}
              scheme={scheme}
              src={`${base}/story/pages/${pageId}/versions/${shown.version}/html?theme=${scheme}`}
            />
          ) : wantsOld && old.isPending ? (
            <Loading variant="lines" />
          ) : null}
          <Inspector
            title={p.title}
            actions={
              <Menu label="Page actions" trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-md" minWidth={220}>
                <RowMenuItems
                  page={p.page_id}
                  canWrite={canWrite}
                  actions={actions}
                  archived={Boolean(p.archived_at)}
                  atLimit={all.length >= MAX_PAGES}
                  depthFull={!unplaced && level >= MAX_DEPTH}
                  extra={
                    canWrite && !p.archived_at ? (
                      <MenuItem icon="upload" onSelect={() => setDialog({ kind: "publish" })}>
                        Publish a new version…
                      </MenuItem>
                    ) : undefined
                  }
                />
              </Menu>
            }
          >
            {shown ? (
              <StoryInspectorBody
                page={p}
                shown={shown}
                versions={versions.data?.items}
                parent={parent}
                placed={Boolean(path)}
                subpages={subpages}
                busy={busy}
                onArchive={() => void archive(p.page_id)}
                onRestore={() => void restore(p.page_id)}
                onEditNotes={() => setDialog({ kind: "notes" })}
              />
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
