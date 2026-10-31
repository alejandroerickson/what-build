import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { attribution, deletedSentence, formatBytes, formatDate, formatDateTime, plural, quotedAtEnd } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { Inspector, usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, Crumbs, Dialog, EmptyState, ErrorCallout, Glyph, Group, KeyValue, Loading, Menu, MenuRadio, OneLine, TextField, useToast } from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import { FirstUse } from "./first-use.tsx";
import { Canvas, pageAddress, usePinnedPrototype, type CanvasPage, type CanvasVersion, type PrototypeAddress } from "./mockup-canvas.tsx";
import { usePageView, type PageView } from "./story-flip.tsx";
import { FocusToggle, useStoryFocus } from "./story-focus.tsx";
import type { Actor } from "./story-model.ts";

/**
 * Mockups: canvases of agent-made HTML pages in Exploration. The panel lists them; one opens as
 * a canvas the width of the window (mockup-canvas.tsx). The inspector holds the version, the
 * selected page's notes and the brief.
 */

export interface MockupSummary {
  mockup_id: string;
  title: string;
  summary: string;
  current_version: number;
  archived_at: string | null;
  etag: string;
  updated_at: string;
  page_count: number;
}

interface MockupPageView extends CanvasPage {
  notes: string;
}

/** A version's prototype: a team's multi-file prototype, served under a short-lived address of its own. */
interface PrototypeInfo extends PrototypeAddress {
  file_count: number;
  bytes: number;
}

interface MockupVersion extends CanvasVersion {
  summary: string;
  brief: string;
  pages: MockupPageView[];
  /** Text files the version carries for collaborators: never used to draw a page. */
  files: MockupFile[];
  prototype?: PrototypeInfo | null;
  published_at: string;
  published_by: Actor;
}

interface MockupFile {
  path: string;
  chars: number;
  content?: string;
}

/** A Story page whose current version shows one of this mockup's pages, or its whole canvas (mockup_page_id null), at the mockup version it was promoted from. */
interface StoryShowing {
  page_id: string;
  title: string;
  etag: string;
  archived_at: string | null;
  mockup_page_id: string | null;
  version: number;
}

interface MockupView extends MockupSummary {
  current: MockupVersion;
  story_pages: StoryShowing[];
}

interface VersionItem {
  version: number;
  page_count: number;
  published_at: string;
}

export function useMockupList() {
  const { api: base } = useProduct();
  return useQuery({ queryKey: ["mockups", base], queryFn: () => api<{ items: MockupSummary[] }>("GET", `${base}/mockups`) });
}

function rememberKey(productId: string) {
  return `whatbuild.mockup.${productId}`;
}

/** Exploration → Mockups with none chosen: the last one opened, or the most recent, or what mockups are. */
export function MockupsIndex() {
  const { app, product } = useProduct();
  const list = useMockupList();
  usePageTitle("Mockups");
  if (list.isPending) return <Loading variant="lines" />;
  if (list.isError) return <ErrorCallout title="Mockups couldn’t be loaded" error={list.error} onRetry={() => list.refetch()} />;
  const items = list.data.items;
  if (items.length) {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(rememberKey(product.product_id));
    } catch {
      remembered = null;
    }
    const pick = items.find((e) => e.mockup_id === remembered) ?? items[0]!;
    return <Navigate to={`${app}/exploration/mockups/${pick.mockup_id}`} replace />;
  }
  return (
    <div className="mockup-view">
      <Crumbs label="Location" currentAsHeading items={[{ label: "Exploration" }, { label: "Mockups" }]} />
      <FirstUse title="No mockups yet" ask={`Read the outcomes and assumptions of ${product.name} in WhatBuild, then mock up a few directions side by side in one mockup, with a brief.`}>
        A mockup is a canvas of pages your agent builds from the evidence: screens, flows or alternatives side by side.
      </FirstUse>
    </div>
  );
}

// ---- The inspector ------------------------------------------------------------------------------

function MockupInspector({ e, shown, versions, onVersion, selected, onSelect, pageView, onShow }: {
  e: MockupView;
  shown: MockupVersion;
  versions: VersionItem[] | undefined;
  onVersion: (n: number) => void;
  selected: string | null;
  onSelect: (pageId: string | null) => void;
  pageView: PageView;
  /** Shows the selected page fitted or filling the width, as 2 and 3 do. */
  onShow: (how: PageView) => void;
}) {
  const { api: base, canDelete } = useProduct();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isCurrent = shown.version === e.current_version;
  const numbered = isCurrent ? `${shown.version}, current` : `${shown.version} of ${e.current_version}`;
  const index = shown.pages.findIndex((p) => p.page_id === selected);
  const page = index >= 0 ? shown.pages[index]! : null;

  const download = async () => {
    setDownloading(true);
    try {
      const g = await api<{ url: string; headers: Record<string, string> }>("POST", `${base}/mockups/${e.mockup_id}/downloads`, { version: shown.version });
      const res = await fetch(g.url, { headers: g.headers });
      if (!res.ok) throw new Error(`The download failed (${res.status}).`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `mockup-v${shown.version}.zip`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The download failed.", { tone: "negative" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="story-inspector xc-inspector">
      <Group title="Version">
        <KeyValue
          items={[
            {
              label: "Version",
              value:
                versions && versions.length > 1 ? (
                  <Menu
                    label={`Version ${numbered}. Choose a version`}
                    triggerClassName="field-button"
                    align="start"
                    minWidth={240}
                    trigger={
                      <>
                        <span className="ellipsis grow num">
                          {shown.version}
                          {isCurrent ? " · current" : ` of ${e.current_version}`}
                        </span>
                        <Glyph name="chevron-down" size="sm" />
                      </>
                    }
                  >
                    {versions.map((v) => (
                      <MenuRadio key={v.version} checked={v.version === shown.version} meta={`${plural(v.page_count, "page")} · ${formatDate(v.published_at)}`} onSelect={() => onVersion(v.version)}>
                        Version {v.version}
                        {v.version === e.current_version ? " · current" : ""}
                      </MenuRadio>
                    ))}
                  </Menu>
                ) : (
                  <span className="num">{shown.version}</span>
                ),
            },
            { label: "By", value: attribution(shown.published_by) },
            { label: "Date", value: <time dateTime={shown.published_at}>{formatDateTime(shown.published_at)}</time> },
            { label: "Pages", value: <span className="num">{shown.pages.length}</span> },
            ...(shown.prototype
              ? [{ label: "Prototype", value: <span className="num">{plural(shown.prototype.file_count, "file")} · {formatBytes(shown.prototype.bytes)}</span> }]
              : []),
          ]}
        />
        <OnTheStory mockup={e} shown={shown} page={null} />
        <Button size="sm" icon="download" className="story-export-button" onClick={download} disabled={downloading}>
          {downloading ? "Preparing…" : `Download version ${shown.version}`}
        </Button>
        {canDelete ? (
          <Button size="sm" variant="quiet" icon="trash" className="story-delete-button" onClick={() => setDeleting(true)}>
            Delete permanently…
          </Button>
        ) : null}
        {deleting ? <DeleteMockup mockup={e} onClose={() => setDeleting(false)} /> : null}
      </Group>

      <Group title="Page">
        <div className="xc-page-pick">
          <Menu
            label={page ? `Page ${index + 1}, ${page.title}. Choose a page` : "Choose a page"}
            triggerClassName="field-button xc-page-trigger"
            align="start"
            minWidth={240}
            trigger={
              <>
                {page ? (
                  <span className="xc-page-name grow">
                    <span className="num faint">{index + 1}{"\u00a0"}</span>
                    <OneLine text={page.title} />
                  </span>
                ) : (
                  <span className="ellipsis grow">
                    <span className="faint">Choose a page</span>
                  </span>
                )}
                <Glyph name="chevron-down" size="sm" />
              </>
            }
          >
            {shown.pages.map((p, i) => (
              <MenuRadio key={p.page_id} checked={p.page_id === selected} meta={`${p.width} × ${p.height}`} onSelect={() => onSelect(p.page_id)}>
                {i + 1}. {p.title}
              </MenuRadio>
            ))}
          </Menu>
          <Button size="sm" icon="scan" onClick={() => onShow("fit")} disabled={!page} aria-pressed={pageView === "fit"} title="Fit to the screen (2)">
            Fit
          </Button>
          <Button size="sm" icon="move-horizontal" onClick={() => onShow("fill")} disabled={!page} aria-pressed={pageView === "fill"} title="Fill the width, to scroll through the page (3)">
            Fill
          </Button>
        </div>
        {page?.entry ? (
          <p className="xc-entry">
            Enters the prototype at <code className="ellipsis" title={page.entry}>{page.entry}</code>
          </p>
        ) : null}
        {page ? <OnTheStory mockup={e} shown={shown} page={page} /> : null}
        {page ? (
          page.notes.trim() ? (
            <Markdown source={page.notes} className="prose story-notes xc-notes" headingShift={3} />
          ) : (
            <EmptyState size="inline">No notes on this page.</EmptyState>
          )
        ) : (
          <p className="xc-hint">Select a page to read its notes.</p>
        )}
      </Group>

      <Group title="Brief">
        {shown.brief.trim() ? (
          <Markdown source={shown.brief} className="prose story-notes xc-brief" headingShift={2} />
        ) : (
          <EmptyState size="inline">This version has no brief.</EmptyState>
        )}
      </Group>

      <Files mockupId={e.mockup_id} shown={shown} />
    </div>
  );
}

/**
 * The files a version carries for collaborators (a DESIGN.md, components, tokens), to pull into
 * their own projects. WhatBuild never draws a page with them, so a file opens as text: Markdown
 * rendered, anything else as source, never as HTML.
 */
function Files({ mockupId, shown }: { mockupId: string; shown: MockupVersion }) {
  const { api: base } = useProduct();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const full = useQuery({
    queryKey: ["mockup-files", base, mockupId, shown.version],
    enabled: open !== null,
    queryFn: () => api<{ files: MockupFile[] }>("GET", `${base}/mockups/${mockupId}/versions/${shown.version}?include_files=true`),
  });
  const file = full.data?.files.find((x) => x.path === open);
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast("Copied."))
      .catch(() => toast("Couldn’t copy. Download the version instead.", { tone: "negative" }));
  return (
    <Group title="Files" count={shown.files.length}>
      {shown.files.length ? (
        <ul className="xc-files">
          {shown.files.map((x) => (
            <li key={x.path}>
              <Glyph name="file-text" size="sm" />
              <button type="button" className="xc-file story-ref-link ellipsis" title={x.path} onClick={() => setOpen(x.path)}>
                {x.path}
              </button>
              <span className="faint num">{plural(x.chars, "character")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="inline">No files on this version.</EmptyState>
      )}
      {open ? (
        <Dialog
          open
          wide
          onClose={() => setOpen(null)}
          title={open}
          footer={
            <>
              <Button onClick={() => setOpen(null)}>Close</Button>
              <Button icon="copy" disabled={file?.content === undefined} onClick={() => copy(file!.content!)}>
                Copy
              </Button>
            </>
          }
        >
          {full.isPending ? (
            <Loading variant="lines" lines={6} label="Loading the file…" />
          ) : full.isError ? (
            <ErrorCallout inset error={full.error} onRetry={() => full.refetch()} />
          ) : file?.content === undefined ? (
            <EmptyState size="inline">This file isn’t on this version any more.</EmptyState>
          ) : /\.(md|markdown)$/i.test(file.path) ? (
            <Markdown source={file.content} className="prose story-notes xc-file-text" headingShift={1} />
          ) : (
            <pre className="xc-file-code">{file.content}</pre>
          )}
        </Dialog>
      ) : null}
    </Group>
  );
}

/**
 * Where the selected page, or the whole canvas (page null), stands in the Story: the Story pages that
 * show it, and the way to put it there or move one to the version shown. A Story page shows either
 * as it is in one version, never a copy, and stays on that version until it is promoted again.
 */
function OnTheStory({ mockup, shown, page }: { mockup: MockupView; shown: MockupVersion; page: CanvasPage | null }) {
  const { app, api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<StoryShowing | "new" | null>(null);
  const named = page?.title ?? mockup.title;
  const [title, setTitle] = useState(named);
  const showing = mockup.story_pages.filter((p) => p.mockup_page_id === (page?.page_id ?? null));
  const promote = useMutation({
    mutationFn: (to: StoryShowing | "new") =>
      api<{ page_id: string; title: string }>("POST", `${base}/story/promote-mockup`, {
        mockup_id: mockup.mockup_id,
        ...(page ? { mockup_page_id: page.page_id } : {}),
        version: shown.version,
        ...(to === "new" ? { title: title.trim() || named } : { page_id: to.page_id, expected_etag: to.etag }),
      }),
    onSuccess: (r) => {
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ["mockup", base, mockup.mockup_id] });
      for (const key of [["story-tree", base], ["story-pages", base], ["story-page", base, r.page_id], ["story-versions", base, r.page_id]]) void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["product"] });
      toast(`“${r.title}” is on the Story. Drag it where it belongs in the tree.`, { action: { label: "Open", onClick: () => navigate(`${app}/story/${r.page_id}`) } });
    },
  });
  if (!showing.length && !canWrite) return null;
  return (
    <div className="xc-story">
      {showing.map((p) => (
        <p key={p.page_id} className="xc-story-line">
          <Glyph name="book-open" size="sm" />
          <span>
            On the Story as <Link to={`${app}/story/${p.page_id}`} className="story-ref-link">{p.title}</Link>
            <span className="faint">, showing version {p.version}{p.archived_at ? " (archived)" : ""}</span>
          </span>
          {canWrite && !p.archived_at && p.version !== shown.version ? (
            <Button size="sm" onClick={() => setAsking(p)}>
              Show version {shown.version}
            </Button>
          ) : null}
        </p>
      ))}
      {canWrite && !showing.length ? (
        <Button size="sm" icon="book-open" onClick={() => { setTitle(named); setAsking("new"); }}>
          {page ? "Promote to Story" : "Promote canvas to Story"}
        </Button>
      ) : null}
      {asking ? (
        <Dialog
          open
          onClose={() => setAsking(null)}
          dismissable={!promote.isPending}
          title={asking === "new" ? (page ? "Promote to Story" : "Promote canvas to Story") : `Show version ${shown.version} on the Story`}
          description={
            asking === "new"
              ? `A new Story page at the end of the tree will show ${page ? `“${page.title}”` : `this whole canvas, ${plural(shown.pages.length, "page")},`} as it is in version ${shown.version}. Whoever reads the Story sees ${page ? "it" : "every page of it"}, but not the brief or the notes. It stays on version ${shown.version} until someone promotes a newer one.`
              : `“${asking.title}” will show ${page ? `“${page.title}”` : "this whole canvas"} as it is in version ${shown.version}. Its earlier versions stay readable.`
          }
          footer={
            <>
              <Button onClick={() => setAsking(null)} disabled={promote.isPending}>
                Cancel
              </Button>
              <Button variant="primary" busy={promote.isPending} busyLabel="Promoting…" onClick={() => promote.mutate(asking)}>
                {asking === "new" ? "Promote" : `Show version ${shown.version}`}
              </Button>
            </>
          }
        >
          {asking === "new" ? <TextField label="Title on the Story" maxLength={200} value={title} onChange={(ev) => setTitle(ev.target.value)} /> : null}
          {promote.isError ? <ErrorCallout inset error={promote.error} /> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

// ---- The screen ---------------------------------------------------------------------------------

export function MockupPage() {
  const { mockupId } = useParams();
  const { api: base, app, product, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const vParam = params.get("v");
  const asked = vParam && /^\d+$/.test(vParam) ? Number(vParam) : null;

  const e = useQuery({
    queryKey: ["mockup", base, mockupId],
    retry: (n, err) => !(err instanceof ApiError && err.isNotFound) && n < 2,
    queryFn: () => api<MockupView>("GET", `${base}/mockups/${mockupId}`),
  });
  const versions = useQuery({
    queryKey: ["mockup-versions", base, mockupId],
    enabled: e.isSuccess,
    queryFn: () => api<{ items: VersionItem[] }>("GET", `${base}/mockups/${mockupId}/versions?limit=100`),
  });
  const wantsOld = asked !== null && e.data !== undefined && asked !== e.data.current_version;
  const old = useQuery({
    queryKey: ["mockup-version", base, mockupId, asked],
    enabled: wantsOld,
    retry: (n, err) => !(err instanceof ApiError && err.isNotFound) && n < 2,
    queryFn: () => api<MockupVersion>("GET", `${base}/mockups/${mockupId}/versions/${asked}`),
  });
  // On a phone too: the board gains the whole screen.
  const focusMode = useStoryFocus(e.isSuccess, { onPhone: true });
  usePageTitle(e.data?.title ?? null);
  // The selected page lives in the URL (?page=), so a link can open a canvas at one page.
  const selected = params.get("page");
  const [showRequest, setShowRequest] = useState(0);
  // Fit (2) or fill (3): how the arrows and the inspector show a page, remembered in this browser.
  const [pageView, setPageView] = usePageView("whatbuild.mockup.page-view", "fit");
  const mockups = useMockupList();
  const select = useCallback(
    (pageId: string | null) => {
      const next = new URLSearchParams(params);
      if (pageId) next.set("page", pageId);
      else next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const shown = wantsOld ? old.data : e.data?.current;
  const pinned = usePinnedPrototype(shown, () => {
    void e.refetch();
    if (wantsOld) void old.refetch();
  });

  useEffect(() => {
    if (!e.isSuccess || !mockupId) return;
    try {
      localStorage.setItem(rememberKey(product.product_id), mockupId);
    } catch {
      // The URL still carries it.
    }
  }, [e.isSuccess, mockupId, product.product_id]);

  const onVersion = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === e.data?.current_version) next.delete("v");
    else next.set("v", String(n));
    setParams(next);
  };

  const crumbs = [{ label: "Exploration" }, { label: "Mockups" }, { label: e.isError ? "Not found" : (e.data?.title ?? "…") }];

  if (e.isPending)
    return (
      <>
        <Loading variant="lines" />
        {/* Kept while the next mockup loads, so the inspector does not slide away and back. */}
        <Inspector title={mockups.data?.items.find((m) => m.mockup_id === mockupId)?.title ?? "Mockup"}>
          <Loading variant="lines" />
        </Inspector>
      </>
    );
  if (e.isError) {
    const gone = e.error instanceof ApiError && e.error.isNotFound;
    const deleted = deletedSentence(e.error);
    return (
      <div className="mockup-view">
        <Crumbs label="Location" currentAsHeading items={crumbs} />
        {deleted ? (
          <EmptyState title="This mockup was deleted" action={<ButtonLink to={`${app}/exploration/mockups`}>Open mockups</ButtonLink>}>
            {deleted}
          </EmptyState>
        ) : gone ? (
          <EmptyState title="This mockup isn’t in this product" action={<ButtonLink to={`${app}/exploration/mockups`}>Open mockups</ButtonLink>}>
            The link may be mistyped, or the mockup belongs to another product.
          </EmptyState>
        ) : (
          <ErrorCallout title="This mockup couldn’t be loaded" error={e.error} onRetry={() => e.refetch()} />
        )}
      </div>
    );
  }

  const x = e.data;
  return (
    <div className="mockup-view" data-focus={focusMode.focus ? "" : undefined}>
      <div className="story-bar">
        <Crumbs label="Location" currentAsHeading items={crumbs} />
        <span className="xc-version num" aria-live="polite">
          {shown ? `Version ${shown.version}${shown.version === x.current_version ? "" : ` of ${x.current_version}`}` : null}
        </span>
        {focusMode.available ? <FocusToggle focus={focusMode.focus} hint={focusMode.hint} onToggle={focusMode.toggle} /> : null}
      </div>
      {x.archived_at ? (
        <Callout tone="attention" title="This mockup is archived">
          {canWrite ? "Your agent can restore it." : null}
        </Callout>
      ) : null}
      {wantsOld && old.data ? (
        <Callout tone="attention" title={`You’re looking at an earlier version: ${old.data.version} of ${x.current_version}`} action={<Button size="sm" onClick={() => onVersion(x.current_version)}>Show the current version</Button>} />
      ) : null}
      {wantsOld && old.isError ? (
        <Callout tone="attention" title={`This mockup has no version ${asked}`} action={<Button size="sm" onClick={() => onVersion(x.current_version)}>Show the current version</Button>} />
      ) : null}
      {shown ? <Canvas
          key={shown.version}
          version={shown}
          pageSrc={(p) => pageAddress(p, shown, pinned, `${base}/mockups/${x.mockup_id}/versions/${shown.version}/pages/${p.page_id}/html`)}
          selected={shown.pages.some((p) => p.page_id === selected) ? selected : null}
          onSelect={select}
          onKey={focusMode.onKey}
          canFocus={focusMode.available}
          pageView={pageView}
          onPageView={setPageView}
          showRequest={showRequest}
        /> : <Loading variant="lines" />}
      <Inspector title={x.title}>{shown ? <MockupInspector
            e={x}
            shown={shown}
            versions={versions.data?.items}
            onVersion={onVersion}
            selected={shown.pages.some((p) => p.page_id === selected) ? selected : null}
            onSelect={(id) => {
              select(id);
              setShowRequest((n) => n + 1);
            }}
            pageView={pageView}
            onShow={(how) => {
              setPageView(how);
              setShowRequest((n) => n + 1);
            }}
          /> : <Loading variant="lines" />}</Inspector>
    </div>
  );
}

/** What deleting a mockup destroys, as mockups.delete_impact reports it. */
interface MockupImpact {
  etag: string;
  version_count: number;
  story_pages_showing: { page_id: string; title: string; archived: boolean }[];
  earlier_story_versions_showing: { page_id: string; title: string; version: number }[];
}

/** What deleting a mockup deletes, as its dialog says it: every version, each with its own pages, notes, files and brief. */
export function mockupImpactWords(title: string, versions: number): string {
  return versions === 1
    ? `This deletes “${title}” with its only version: its pages, notes, files and brief.`
    : `This deletes “${title}” with all ${versions} of its versions: their pages, notes, files and briefs.`;
}

/** Delete a mockup for good. A Story page that shows it holds it: that page goes, or gets HTML of its own, first. */
function DeleteMockup({ mockup, onClose }: { mockup: MockupView; onClose: () => void }) {
  const { app, api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const archive = useMutation({
    mutationFn: () => api("POST", `${base}/mockups/${mockup.mockup_id}/archive`, { expected_etag: mockup.etag }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mockup", base, mockup.mockup_id] });
      void qc.invalidateQueries({ queryKey: ["mockups", base] });
      toast("Mockup archived.");
    },
    onError: () => toast("The mockup couldn’t be archived. Reload and try again.", { tone: "negative" }),
  });
  return (
    <DeleteDialog<MockupImpact>
      title="Delete this mockup permanently?"
      impactPath={`${base}/mockups/${mockup.mockup_id}/delete-impact`}
      deletePath={`${base}/mockups/${mockup.mockup_id}`}
      alternative={mockup.archived_at ? undefined : { label: "Archive instead", onSelect: () => archive.mutate() }}
      allowed={(i) => !i.story_pages_showing.length}
      renderImpact={(i) =>
        i.story_pages_showing.length ? (
          <>
            <p>
              <strong>{i.story_pages_showing.length === 1 ? "A Story page shows" : `${i.story_pages_showing.length} Story pages show`} this mockup.</strong> Delete{" "}
              {i.story_pages_showing.length === 1 ? "that page" : "those pages"} first.
            </p>
            <ul className="delete-impact-list">
              {i.story_pages_showing.map((p) => (
                <li key={p.page_id}>
                  <Link to={`${app}/story/${p.page_id}`}>{p.title}</Link>
                  {p.archived ? <span className="faint"> · archived</span> : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>{mockupImpactWords(mockup.title, i.version_count)}</p>
            {i.earlier_story_versions_showing.length ? (
              <p>
                {i.earlier_story_versions_showing.length === 1 ? "An earlier version of a Story page shows it, and will" : `${i.earlier_story_versions_showing.length} earlier versions of Story pages show it, and will`}{" "}
                show an empty page.
              </p>
            ) : null}
          </>
        )
      }
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["mockups", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        toast(`Deleted ${quotedAtEnd(mockup.title)} The activity log records who, when and why.`);
        navigate(`${app}/exploration/mockups`);
      }}
      onClose={onClose}
    />
  );
}
