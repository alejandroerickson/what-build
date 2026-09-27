import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties } from "react";
import { api, ApiError } from "../lib/api.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { Button, Callout, ChoiceRow, Dialog, ErrorCallout, Loading, SelectField, TextArea, TextField, useToast } from "../ui/index.tsx";
import {
  flatten, locate, MAX_PAGES, refusal, SLUG_PATTERN, slugify,
  type Arrangement, type Move, type PageSummary, type PageView, type StoryNode,
} from "./story-model.ts";

/** Everything the Story screen caches for a product, refreshed after any change to a page. */
export function refreshStory(qc: QueryClient, base: string) {
  void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("story-") && q.queryKey[1] === base });
  void qc.invalidateQueries({ queryKey: ["product"] });
}

// ---- Add a page ----------------------------------------------------------------------------------

export function AddPageDialog({ parent, parentTitle, pages, onClose, onCreated }: {
  parent: string | null;
  parentTitle: string | null;
  pages: PageSummary[];
  onClose: () => void;
  onCreated: (page: string, parent: string | null) => Promise<void>;
}) {
  const { api: base } = useProduct();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [tried, setTried] = useState(false);
  const address = slugEdited ? slug : slugify(title);
  const taken = pages.some((p) => p.page_id === address);
  const slugError = !address ? "Give the page an address." : !SLUG_PATTERN.test(address) ? "Use lower-case letters, digits and hyphens, starting with a letter or digit." : taken ? "Another page already uses this address." : null;
  const create = useMutation({
    mutationFn: async () => {
      await api("POST", `${base}/story/pages/${address}/versions`, { title: title.trim(), note: "Added as a title page." });
      await onCreated(address, parent);
    },
  });
  const full = pages.length >= MAX_PAGES;
  const conflict = create.error instanceof ApiError && create.error.code === "stale_etag";
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!create.isPending}
      title={parent ? "Add a child page" : "Add a page"}
      description={
        parent
          ? `It goes under “${parentTitle ?? parent}”, after its other subpages.`
          : "It goes at the end of the Story's top level."
      }
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            busyLabel="Adding…"
            disabled={full}
            onClick={() => {
              setTried(true);
              if (title.trim() && !slugError) create.mutate();
            }}
          >
            Add page
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (title.trim() && !slugError && !full) create.mutate();
        }}
      >
        <TextField label="Title" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} error={tried && !title.trim() ? "Give the page a title." : null} />
        <TextField
          label="Address"
          value={address}
          maxLength={80}
          spellCheck={false}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
          hint={<>The end of the page's link, …/story/{address || "address"}. It can't be changed later.</>}
          error={(tried || slugEdited) && slugError ? slugError : conflict ? "Another page already uses this address." : null}
        />
        <p className="small muted">WhatBuild publishes a title page. Ask an agent to write the page itself.</p>
        {full ? <Callout tone="attention">The Story is at its limit of {MAX_PAGES} pages, archived pages included.</Callout> : null}
        {create.isError && !conflict ? <ErrorCallout error={create.error} /> : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---- Rename: a republish ----------------------------------------------------------------------

export function RenameDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const full = useQuery({ queryKey: ["story-page-html", base, page], queryFn: () => api<PageView>("GET", `${base}/story/pages/${page}`), staleTime: 0 });
  const [title, setTitle] = useState<string | null>(null);
  const value = title ?? full.data?.title ?? "";
  const rename = useMutation({
    mutationFn: () => {
      const p = full.data!;
      const v = p.current;
      const refs = Object.fromEntries(Object.entries(v.resolved_refs).map(([k, list]) => [k, list.filter((r) => !r.missing).map((r) => r.id)]));
      return api<PageView>("POST", `${base}/story/pages/${page}/versions`, {
        title: value.trim(),
        summary: v.summary,
        html: v.html,
        note: `Renamed from “${p.title}”.`,
        refs,
        citations: v.citations.map((c) => ({ record_id: c.record_id, seq_start: c.seq_start, seq_end: c.seq_end, quote: c.quote })),
        expected_etag: p.etag,
      });
    },
    onSuccess: (r) => {
      refreshStory(qc, base);
      toast(`Renamed. The page is now at version ${r.current_version}.`);
      onClose();
    },
  });
  const p = full.data;
  const same = p ? value.trim() === p.title : true;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!rename.isPending}
      title="Rename page"
      description={p ? `Renaming publishes version ${p.current_version + 1} with the new title. The page's content, references and citations carry over unchanged.` : "Renaming publishes a new version with the new title."}
      footer={
        <>
          <Button onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={rename.isPending} busyLabel="Publishing…" disabled={!p || same || !value.trim() || Boolean(p?.archived_at)} onClick={() => rename.mutate()}>
            Rename and publish
          </Button>
        </>
      }
    >
      {full.isError ? <ErrorCallout error={full.error} onRetry={() => full.refetch()} /> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (p && !same && value.trim()) rename.mutate();
        }}
      >
        {p ? <TextField label="Title" value={value} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} /> : full.isPending ? <Loading variant="lines" lines={1} /> : null}
        <button type="submit" hidden />
      </form>
      {p?.archived_at ? <Callout tone="attention">This page is archived. Restore it before renaming.</Callout> : null}
      {rename.isError ? (
        <ErrorCallout
          error={rename.error}
          title={rename.error instanceof ApiError && rename.error.code === "invalid_citation" ? "A cited passage no longer matches its source" : undefined}
          onRetry={rename.error instanceof ApiError && rename.error.code === "stale_etag" ? () => void full.refetch().then(() => rename.reset()) : undefined}
        />
      ) : null}
    </Dialog>
  );
}

// ---- Move to… (the single-pointer alternative to dragging) ---------------------------------------

export function MoveDialog({ page, tree, onClose, onMove }: { page: string; tree: Arrangement; onClose: () => void; onMove: (m: Move) => void }) {
  const at = locate(tree.placed, page);
  const node = at?.node ?? tree.unplaced.find((n) => n.page_id === page);
  const [parent, setParent] = useState<string | null>(at ? (at.parent?.page_id ?? null) : null);
  const siblings = (parent ? (locate(tree.placed, parent)?.node.children ?? []) : tree.placed).filter((n) => n.page_id !== page);
  const positions = [
    { label: siblings.length ? "At the start" : "As the only page here", before: siblings[0]?.page_id ?? "" },
    ...siblings.map((s, i) => ({ label: `After “${s.title}”`, before: siblings[i + 1]?.page_id ?? "" })),
  ];
  const samePlace = at && (at.parent?.page_id ?? null) === parent;
  const [before, setBefore] = useState<string | null>(null);
  const chosen = before ?? (samePlace ? (at.siblings[at.index + 1]?.page_id ?? "") : "");
  const options = flatten(tree.placed).filter((x) => !node || !locate([node], x.node.page_id));
  const why = refusal(tree, page, parent);
  const noChange = Boolean(samePlace && chosen === (at.siblings[at.index + 1]?.page_id ?? ""));
  if (!node) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Move “${node.title}”`}
      description="Choose where it goes in the navigation. Its subpages move with it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={Boolean(why) || noChange}
            onClick={() => {
              onMove({ page, parent, before: chosen || null });
              onClose();
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <fieldset className="story-move-list">
        <legend className="field-label">Put it under</legend>
        <ChoiceRow type="radio" name="story-move-parent" label="The top level" checked={parent === null} onChange={() => (setParent(null), setBefore(null))} />
        {options.map(({ node: n, level }) => {
          const no = refusal(tree, page, n.page_id);
          return (
            <div key={n.page_id} className="story-choice-indent" style={{ "--level": level } as CSSProperties}>
              <ChoiceRow
                type="radio"
                name="story-move-parent"
                label={n.title}
                hint={no ? "Too deep: the Story has at most 6 levels" : undefined}
                disabled={Boolean(no)}
                checked={parent === n.page_id}
                onChange={() => (setParent(n.page_id), setBefore(null))}
              />
            </div>
          );
        })}
      </fieldset>
      <SelectField label="Position" value={chosen} onChange={(e) => setBefore(e.target.value)}>
        {positions.map((p) => (
          <option key={`${p.label}:${p.before}`} value={p.before}>
            {p.label}
          </option>
        ))}
      </SelectField>
      {why ? <Callout tone="attention">{why}</Callout> : null}
    </Dialog>
  );
}

// ---- Export to PDF ------------------------------------------------------------------------------

export function ExportDialog({ tree, archived, preselect, onClose }: { tree: Arrangement; archived: PageSummary[]; preselect?: string; onClose: () => void }) {
  const { api: base } = useProduct();
  const groups = useMemo(() => {
    const out: { label: string | null; rows: { node: Pick<StoryNode, "page_id" | "title">; level: number }[] }[] = [];
    const placed = flatten(tree.placed);
    if (placed.length) out.push({ label: null, rows: placed });
    if (tree.unplaced.length) out.push({ label: "Unplaced pages", rows: tree.unplaced.map((n) => ({ node: n, level: 1 })) });
    if (archived.length) out.push({ label: "Archived pages", rows: archived.map((n) => ({ node: n, level: 1 })) });
    return out;
  }, [tree, archived]);
  const all = groups.flatMap((g) => g.rows.map((r) => r.node.page_id));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect && all.includes(preselect) ? [preselect] : []));
  const ids = all.filter((id) => picked.has(id)).slice(0, MAX_PAGES);
  const href = ids.length ? `${base}/story/print?page_ids=${ids.map(encodeURIComponent).join(",")}` : undefined;
  const flip = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Export to PDF"
      description="Pick the pages to include. They print in the Story's order, each under its own heading."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {href ? (
            <a className="btn btn-primary btn-md" href={href} target="_blank" rel="noopener" onClick={() => setTimeout(onClose, 0)}>
              Open print view
            </a>
          ) : (
            <a className="btn btn-primary btn-md story-link-disabled" role="link" aria-disabled="true">
              Open print view
            </a>
          )}
        </>
      }
    >
      <div className="story-export-bar">
        <span className="small muted" aria-live="polite">
          {ids.length} of {all.length} {all.length === 1 ? "page" : "pages"} selected
        </span>
        <span className="row">
          <Button size="sm" variant="quiet" onClick={() => setPicked(new Set(all))}>
            Select all
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </span>
      </div>
      <div className="story-export-list">
        {groups.map((g) => (
          <fieldset key={g.label ?? "tree"} className="story-export-group">
            <legend className={g.label ? "story-export-legend" : "visually-hidden"}>{g.label ?? "Story pages"}</legend>
            {g.rows.map(({ node, level }) => (
              <div key={node.page_id} className="story-choice-indent" style={{ "--level": level - 1 } as CSSProperties}>
                <ChoiceRow label={node.title} checked={picked.has(node.page_id)} onChange={(e) => flip(node.page_id, e.target.checked)} />
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <p className="small muted">Opens a print view in a new tab. Choose Save as PDF in the print dialog. Content drawn by a page's scripts is left out.</p>
    </Dialog>
  );
}

// ---- Notes for agents ---------------------------------------------------------------------------

export function NotesDialog({ page, onClose }: { page: PageView; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(page.agent_notes.content);
  const [etag, setEtag] = useState(page.agent_notes.etag);
  const [theirs, setTheirs] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ changed: boolean }>("PUT", `${base}/story/pages/${page.page_id}/notes`, { notes: text, expected_etag: etag }),
    onSuccess: (r) => {
      refreshStory(qc, base);
      toast(r.changed ? "Saved the notes for agents." : "Nothing changed.");
      onClose();
    },
  });
  const loadTheirs = async () => {
    const fresh = await api<PageView>("GET", `${base}/story/pages/${page.page_id}?include_html=false`);
    setEtag(fresh.agent_notes.etag);
    setTheirs(fresh.agent_notes.content);
    save.reset();
  };
  const over = text.length > 20000;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      dismissable={!save.isPending}
      title="Notes for agents"
      description="Agents read these before revising the page and update them after publishing: what the page is for, sources still to fold in, decisions about its structure. Markdown works."
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={over} onClick={() => save.mutate()}>
            Save notes
          </Button>
        </>
      }
    >
      <TextArea
        label="Notes"
        className="story-notes-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint={`${text.length.toLocaleString()} of 20,000 characters`}
        error={over ? "The notes are longer than 20,000 characters." : null}
      />
      {save.isError ? <ErrorCallout error={save.error} onRetry={() => void loadTheirs()} /> : null}
      {theirs !== null ? (
        <details className="story-notes-theirs" open>
          <summary>Their version (your text above is unchanged; saving replaces theirs)</summary>
          {theirs ? <Markdown source={theirs} className="prose story-notes" /> : <p className="small muted">They cleared the notes.</p>}
        </details>
      ) : null}
    </Dialog>
  );
}

// ---- Publish a version by hand -----------------------------------------------------------------

export function PublishDialog({ page, onClose }: { page: PageView; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(page.title);
  const [html, setHtml] = useState("");
  const [note, setNote] = useState("");
  const publish = useMutation({
    mutationFn: () => api("POST", `${base}/story/pages/${page.page_id}/versions`, { title, summary: page.summary, html, note, expected_etag: page.etag }),
    onSuccess: () => {
      refreshStory(qc, base);
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
      dismissable={!publish.isPending}
      title={`Publish a new version of “${page.title}”`}
      description="Story pages are usually written by an agent from WhatBuild's guidance. Paste one self-contained HTML document: inline styles, no external resources, no forms or frames. References and citations are not carried over."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!html.trim() || !title.trim()} busy={publish.isPending} busyLabel="Publishing…" onClick={() => publish.mutate()}>
            Publish
          </Button>
        </>
      }
    >
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <TextArea label="HTML" className="story-html-input" value={html} onChange={(e) => setHtml(e.target.value)} />
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
        <Callout tone="negative" title="The page was not published">
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
