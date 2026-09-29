import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { useTheme } from "../shell/theme.ts";
import { Inspector, usePageTitle } from "../shell/slots.tsx";
import { useMediaQuery } from "../ui/media.ts";
import { ButtonLink, Callout, Crumbs, EmptyState, ErrorCallout, Loading } from "../ui/index.tsx";
import { ExportDialog } from "./story-export.tsx";
import { StoryInspectorBody } from "./story-inspector.tsx";
import { split, trail, type Hierarchy, type PageSummary, type PageView, type VersionItem, type VersionView } from "./story-model.ts";
import { StoryTree } from "./story-tree.tsx";
import "../styles/screens/story.css";

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
  const { api: base, app, product } = useProduct();
  const [params] = useSearchParams();
  const scheme = useScheme();
  const vParam = params.get("v");
  const asked = vParam && /^\d+$/.test(vParam) ? Number(vParam) : null;
  /** The pages Export to PDF opens with, while it is open. */
  const [exporting, setExporting] = useState<string[] | null>(null);

  const h = useQuery({ queryKey: ["story-tree", base], queryFn: () => api<Hierarchy>("GET", `${base}/story/hierarchy`) });
  const pages = useQuery({ queryKey: ["story-pages", base], queryFn: () => api<{ items: PageSummary[] }>("GET", `${base}/story/pages?include_archived=true`) });
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
  const arrangement = h.data ? split(h.data) : { placed: [], unplaced: [] };
  const titleOf = (id: string) => all.find((p) => p.page_id === id)?.title ?? id;

  const tree = h.data ? <StoryTree tree={arrangement} archived={archived} current={pageId} onExport={setExporting} /> : null;

  const dialogs = exporting ? <ExportDialog tree={arrangement} archived={archived} preselect={exporting} onClose={() => setExporting(null)} /> : null;

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
          The Story is a set of pages that tell stakeholders where this discovery stands. Agents write and arrange it from WhatBuild's guidance: connect one and ask it to draft the first page from your outcomes and insights.
        </EmptyState>
        {dialogs}
      </div>
    );
  }

  const path = trail(arrangement.placed, pageId);
  const root = arrangement.placed[0]?.page_id;
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

  return (
    <div className="story-view">
      {tree}
      <Crumbs label="Page location" currentAsHeading items={crumbs} />
      {!p ? (
        <Loading variant="lines" />
      ) : (
        <>
          {p.archived_at ? (
            <Callout tone="attention" title="This page is archived">
              An agent took it out of the Story's navigation. Its versions stay readable here.
            </Callout>
          ) : null}
          {wantsOld && old.data ? (
            <Callout
              tone="attention"
              title={`You are reading an earlier version: ${old.data.version} of ${p.current_version}`}
              action={<ButtonLink size="sm" to={`${app}/story/${pageId}`}>Show the current version</ButtonLink>}
            />
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
          <Inspector title={p.title}>
            {shown ? (
              <StoryInspectorBody page={p} shown={shown} versions={versions.data?.items} onExport={() => setExporting([p.page_id])} />
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
