import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { attribution, formatDateTime, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { Button, ButtonLink, Callout, Dialog, EmptyState, ErrorCallout, Loading, SelectField, TextArea, TextField, useToast } from "../ui/index.tsx";

interface Node {
  page_id: string;
  title: string;
  description: string;
  children: Node[];
}
interface Hierarchy {
  etag: string | null;
  items: Node[];
  unplaced: string[];
}
interface PageView {
  page_id: string;
  title: string;
  summary: string;
  current_version: number;
  archived_at: string | null;
  etag: string;
  current: { version: number; title: string; note: string; published_at: string; published_by: never };
}

function trail(nodes: Node[], id: string, path: Node[] = []): Node[] | null {
  for (const n of nodes) {
    if (n.page_id === id) return [...path, n];
    const t = trail(n.children, id, [...path, n]);
    if (t) return t;
  }
  return null;
}

function Tree({ nodes, current, app }: { nodes: Node[]; current: string; app: string }) {
  return (
    <ul className="story-tree">
      {nodes.map((n) => (
        <li key={n.page_id}>
          <Link to={`${app}/story/${n.page_id}`} aria-current={n.page_id === current ? "page" : undefined} className="story-link">
            {n.title}
          </Link>
          {n.children.length ? <Tree nodes={n.children} current={current} app={app} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function StoryPage() {
  const { pageId } = useParams();
  const { api: base, app, product, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const version = params.get("v");
  const [publishing, setPublishing] = useState(false);
  const h = useQuery({ queryKey: ["story-tree", base], queryFn: () => api<Hierarchy>("GET", `${base}/story/hierarchy`) });
  const page = useQuery({ queryKey: ["story-page", base, pageId], enabled: Boolean(pageId), queryFn: () => api<PageView>("GET", `${base}/story/pages/${pageId}?include_html=false`) });
  const versions = useQuery({
    queryKey: ["story-versions", base, pageId],
    enabled: Boolean(pageId),
    queryFn: () => api<{ items: { version: number; title: string; note: string; published_at: string; published_by: never }[] }>("GET", `${base}/story/pages/${pageId}/versions?limit=100`),
  });
  const key = `whatbuild.story.${product.product_id}`;
  useEffect(() => {
    if (!pageId) return;
    try {
      localStorage.setItem(key, pageId);
    } catch {
      // The URL still carries the page.
    }
  }, [pageId, key]);
  if (h.isPending) return <Loading />;
  if (h.isError) return <ErrorCallout title="The Story could not be loaded" error={h.error} onRetry={() => h.refetch()} />;
  if (!pageId) {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(key);
    } catch {
      remembered = null;
    }
    const first = (remembered && trail(h.data.items, remembered) ? remembered : null) ?? h.data.items[0]?.page_id;
    if (first) return <Navigate to={`${app}/story/${first}`} replace />;
    return (
      <div className="stack-lg">
        <h1>Story</h1>
        <EmptyState title="Your Story starts with what you know" action={<ButtonLink to="/connect" variant="primary">Connect an agent</ButtonLink>}>
          The Story is a set of pages that tell stakeholders where this discovery stands. Agents write it, following WhatBuild's guidance: ask a connected agent to draft the first page from your objectives and insights.
        </EmptyState>
      </div>
    );
  }
  const shown = version ? Number(version) : page.data?.current_version;
  const crumbs = trail(h.data.items, pageId) ?? [];
  return (
    <div className="story">
      <nav className="story-nav" aria-label="Story pages">
        <h2 className="aside-h">Story</h2>
        <Tree nodes={h.data.items} current={pageId} app={app} />
      </nav>
      <div className="story-main stack">
        <div className="row-between">
          <nav aria-label="Page trail" className="crumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={c.page_id}>{i === crumbs.length - 1 ? <span aria-current="page">{c.title.length > 48 ? `${c.title.slice(0, 47)}…` : c.title}</span> : <Link to={`${app}/story/${c.page_id}`}>{c.title}</Link>}</li>
              ))}
            </ol>
          </nav>
          <div className="row">
            {versions.data && versions.data.items.length > 1 ? (
              <SelectField label="Version" value={version ?? ""} onChange={(e) => setParams(e.target.value ? { v: e.target.value } : {})}>
                <option value="">Current version</option>
                {versions.data.items.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version} · {formatDateTime(v.published_at)}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {canWrite ? <Button size="sm" onClick={() => setPublishing(true)}>Publish a version</Button> : null}
          </div>
        </div>
        {page.isError ? <ErrorCallout title="This Story page is not available" error={page.error} /> : null}
        {page.data ? (
          <>
            {page.data.archived_at ? <Callout tone="warning">This page is archived: it is hidden from the Story's navigation. An agent can restore it.</Callout> : null}
            {version ? (
              <Callout tone="info" action={<Button size="sm" onClick={() => setParams({})}>Return to the current version</Button>}>
                You are reading version {version}{versions.data?.items.find((v) => String(v.version) === version)?.note ? `: ${versions.data.items.find((v) => String(v.version) === version)!.note}` : ""}.
              </Callout>
            ) : null}
            <p className="small muted">
              Version {shown} · published by {attribution((versions.data?.items.find((v) => v.version === shown) ?? page.data.current).published_by)} · <time dateTime={page.data.current.published_at}>{relativeTime((versions.data?.items.find((v) => v.version === shown) ?? page.data.current).published_at)}</time>
            </p>
            <iframe
              key={`${pageId}:${shown}`}
              title={page.data.title}
              className="story-frame"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              src={`${base}/story/pages/${pageId}/versions/${shown}/html`}
            />
          </>
        ) : page.isPending ? (
          <Loading />
        ) : null}
      </div>
      {publishing && page.data ? <PublishDialog page={page.data} onClose={() => setPublishing(false)} /> : null}
    </div>
  );
}

function PublishDialog({ page, onClose }: { page: PageView; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(page.title);
  const [html, setHtml] = useState("");
  const [note, setNote] = useState("");
  const publish = useMutation({
    mutationFn: () => api("POST", `${base}/story/pages/${page.page_id}/versions`, { title, summary: page.summary, html, note, expected_etag: page.etag }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["story-page", base, page.page_id] });
      void qc.invalidateQueries({ queryKey: ["story-versions", base, page.page_id] });
      void qc.invalidateQueries({ queryKey: ["story-tree", base] });
      toast("Published a new version.");
      onClose();
    },
  });
  const problems = (publish.error as { details?: { problems?: string[] } } | null)?.details?.problems;
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`Publish a new version of “${page.title}”`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!html.trim() || !title.trim()} busy={publish.isPending} busyLabel="Publishing…" onClick={() => publish.mutate()}>
            Publish
          </Button>
        </>
      }
    >
      <p className="small muted">Story pages are usually written by an agent from the service's guidance. Paste a complete, self-contained HTML document: inline styles, no external resources, no forms or frames.</p>
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <TextArea label="HTML" value={html} onChange={(e) => setHtml(e.target.value)} style={{ minHeight: "16rem", fontFamily: "var(--font-mono)" }} />
      <input
        type="file"
        accept=".html,.htm,text/html"
        aria-label="Or choose an HTML file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(setHtml);
        }}
      />
      <TextField label="What changed" optional maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {problems?.length ? (
        <Callout tone="danger" title="The page was not published">
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      ) : publish.isError ? (
        <ErrorCallout error={publish.error} />
      ) : null}
    </Dialog>
  );
}
