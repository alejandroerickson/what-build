import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { PanelContext, PanelSection } from "../shell/slots.tsx";
import { Button, Callout, FindField, Glyph, Menu, MenuItem, MenuSeparator, useToast, type GlyphName } from "../ui/index.tsx";
import type { PageActions, PageRef } from "./story-actions.tsx";
import {
  applyMove, count, describePosition, filterTree, flatten, keyboardMove, locate, positionOf, refusal, split, toServer, trail,
  type Arrangement, type ArrowKey, type Hierarchy, type Move, type MoveResult, type StoryNode,
} from "./story-model.ts";

/** Opens Export to PDF with these pages ticked. */
export type ExportPages = (pages: string[]) => void;

// ---- Saving arrangements ------------------------------------------------------------------------

class Explained extends Error {}

/**
 * Moves pages and saves the whole arrangement with story.set_hierarchy and the hierarchy's etag.
 * Moves show at once and are saved in order. On a 409 the tree is read again, the person's pending
 * moves are applied to it again, and the save is retried once; if that fails too, the tree shows the
 * other arrangement and `problem` says what happened. Saving places every page shown in the tree,
 * so a page no agent had placed stays where the person sees it.
 */
export function useArrange(base: string, h: Hierarchy | undefined) {
  const qc = useQueryClient();
  const key = useMemo(() => ["story-tree", base], [base]);
  const [local, setLocal] = useState<Arrangement | null>(null);
  const localRef = useRef<Arrangement | null>(null);
  const queue = useRef<Move[]>([]);
  const busy = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);

  const setTree = (t: Arrangement | null) => {
    localRef.current = t;
    setLocal(t);
  };

  const put = (t: Arrangement, etag: string | null) => api<Hierarchy>("PUT", `${base}/story/hierarchy`, { ...toServer(t), expected_etag: etag });

  const flush = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const batch = queue.current.splice(0);
        const known = qc.getQueryData<Hierarchy>(key);
        let saved: Hierarchy;
        try {
          saved = await put(localRef.current!, known?.etag ?? null);
        } catch (e) {
          if (!(e instanceof ApiError && e.code === "stale_etag")) throw e;
          const fresh = await api<Hierarchy>("GET", `${base}/story/hierarchy`);
          let t = split(fresh);
          for (const m of [...batch, ...queue.current.splice(0)]) {
            const r = applyMove(t, m);
            if (!r.ok) {
              qc.setQueryData(key, fresh);
              throw new Explained(`The Story changed while you were moving pages, and your move no longer fits: ${r.reason} The tree now shows the Story as it is.`);
            }
            t = r.tree;
          }
          setTree(t);
          try {
            saved = await put(t, fresh.etag);
          } catch {
            throw new Explained("Someone else is rearranging the Story at the same time, and your move could not be saved. The tree now shows their arrangement; try the move again.");
          }
        }
        qc.setQueryData(key, saved);
      }
      setTree(null);
    } catch (e) {
      queue.current = [];
      setTree(null);
      void qc.invalidateQueries({ queryKey: key });
      setProblem(e instanceof Explained ? e.message : `Your move was not saved. ${e instanceof Error ? e.message : ""}`.trim());
    } finally {
      busy.current = false;
    }
  };

  const move = (m: Move): MoveResult => {
    const known = qc.getQueryData<Hierarchy>(key);
    const cur = localRef.current ?? (known ? split(known) : null);
    if (!cur) return { ok: false, reason: "The Story is still loading." };
    const r = applyMove(cur, m);
    if (!r.ok) return r;
    setProblem(null);
    setTree(r.tree);
    queue.current.push(m);
    void flush();
    return r;
  };

  const tree = useMemo(() => local ?? (h ? split(h) : { pages: [], mockups: [] }), [local, h]);
  return { tree, move, problem, clearProblem: () => setProblem(null) };
}

export type Arrange = ReturnType<typeof useArrange>;

// ---- The tree panel -----------------------------------------------------------------------------

/** The two lists a page can be dragged within: the page tree, and the flat Published mockups. */
type ListKind = "pages" | "mockups";
type Zone = "before" | "after" | "into" | "end";
interface Drag {
  page: string;
  title: string;
  list: ListKind;
  x: number;
  y: number;
  active: boolean;
  /** Where it would land; refused is why it can't, or "" for a drop on itself, which does nothing. */
  over: { page: string | null; zone: Zone; refused: string | null } | null;
}

function readCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function StoryTree({ arrange, archived, refOf, current, onExport, actions, style, onStyle }: {
  arrange: Arrange;
  archived: PageRef[];
  /** A page as its actions need it, from the product's list of pages. */
  refOf: (page: string) => PageRef | undefined;
  current: string | undefined;
  onExport: ExportPages;
  actions: PageActions;
  /** The Story style's name and how it reads, or null before an agent sets one; undefined while loading. */
  style: { name: string; line: string } | null | undefined;
  onStyle: () => void;
}) {
  const { app, product, canWrite } = useProduct();
  const toast = useToast();
  const { tree } = arrange;
  const [query, setQuery] = useState("");
  const storeKey = `whatbuild.story-collapsed.${product.product_id}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(storeKey));
  const [announcement, setAnnouncement] = useState("");
  const [showArchived, setShowArchived] = useState<boolean | null>(null);
  const archivedOpen = showArchived ?? archived.some((p) => p.page_id === current);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const focusRequest = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const filtering = query.trim() !== "";
  const arranging = canWrite && !filtering;

  const saveCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify([...next]));
    } catch {
      // Only a convenience; the tree still works.
    }
  };

  // The current page's ancestors are always open.
  useEffect(() => {
    if (!current) return;
    const path = trail(tree.pages, current);
    if (!path) return;
    const shut = path.slice(0, -1).filter((n) => collapsed.has(n.page_id));
    if (!shut.length) return;
    const next = new Set(collapsed);
    shut.forEach((n) => next.delete(n.page_id));
    saveCollapsed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, tree.pages]);

  const pagesShown = useMemo(() => filterTree(tree.pages, query), [tree.pages, query]);
  const mockupsShown = useMemo(() => filterTree(tree.mockups, query), [tree.mockups, query]);
  const isOpen = useCallback((id: string) => filtering || !collapsed.has(id), [filtering, collapsed]);

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveCollapsed(next);
  };

  const announce = (text: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  };

  const titleOf = (id: string) => locate(tree.pages, id)?.node.title ?? tree.mockups.find((n) => n.page_id === id)?.title ?? id;

  /** Applies a move; a drag gets a toast with Undo, a keyboard move is announced. */
  const commit = (m: Move, how: "keyboard" | "pointer") => {
    const back = positionOf(tree, m.page);
    const r = arrange.move(m);
    const title = titleOf(m.page);
    if (!r.ok) {
      if (how === "keyboard") announce(`“${title}” was not moved. ${r.reason}`);
      else toast(`“${title}” was not moved. ${r.reason}`, { tone: "negative" });
      return;
    }
    const where = describePosition(r.tree, m.page);
    if (m.parent) {
      const next = new Set(collapsed);
      if (next.delete(m.parent)) saveCollapsed(next);
    }
    focusRequest.current = m.page;
    if (how === "keyboard") announce(`Moved “${title}” ${where}.`);
    else toast(`Moved “${title}” ${where}.`, back ? { action: { label: "Undo", onClick: () => arrange.move(back) } } : undefined);
  };

  // ---- Pointer dragging: the grip starts it; the row under the pointer takes it -------------------

  const zoneAt = (x: number, y: number, d: Drag): Drag["over"] => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-target]");
    if (!el || !rootRef.current?.contains(el)) return null;
    if (el.dataset["dropTarget"] === "end") return d.list === "pages" ? { page: null, zone: "end", refused: refusal(tree, d.page, null) } : null;
    if (el.dataset["dropTarget"] !== d.list) return null;
    const target = el.dataset["row"]!;
    const r = el.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    // Published mockups have no levels: a drop goes before or after one, never into it.
    const zone: Zone = d.list === "mockups" ? (f < 0.5 ? "before" : "after") : f < 0.3 ? "before" : f > 0.7 ? "after" : "into";
    if (target === d.page) return { page: target, zone, refused: "" };
    if (d.list === "mockups") return { page: target, zone, refused: null };
    const at = locate(tree.pages, target);
    const parent = zone === "into" ? target : (at?.parent?.page_id ?? null);
    return { page: target, zone, refused: refusal(tree, d.page, parent) };
  };

  const moveFor = (d: Drag, over: NonNullable<Drag["over"]>): Move | null => {
    if (over.zone === "end") return { page: d.page, parent: null, before: null };
    if (!over.page) return null;
    if (d.list === "mockups") {
      const i = tree.mockups.findIndex((m) => m.page_id === over.page);
      const next = tree.mockups.slice(i + 1).find((m) => m.page_id !== d.page);
      return { page: d.page, parent: null, before: over.zone === "before" ? over.page : (next?.page_id ?? null) };
    }
    const at = locate(tree.pages, over.page);
    if (!at) return null;
    const parent = at.parent?.page_id ?? null;
    if (over.zone === "into") return { page: d.page, parent: over.page, before: null };
    if (over.zone === "before") return { page: d.page, parent, before: over.page };
    const next = at.siblings.slice(at.index + 1).find((n) => n.page_id !== d.page);
    return { page: d.page, parent, before: next?.page_id ?? null };
  };

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onGripDown = (e: ReactPointerEvent<HTMLElement>, node: StoryNode, list: ListKind) => {
    if (e.button !== 0 || !arranging) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ page: node.page_id, title: node.title, list, x: e.clientX, y: e.clientY, active: false, over: null });
  };
  const onGripMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const active = d.active || Math.abs(e.clientY - d.y) > 4 || Math.abs(e.clientX - d.x) > 4;
    if (!active) return;
    const scroller = rootRef.current?.closest<HTMLElement>(".panel-context-body");
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (e.clientY < r.top + 24) scroller.scrollBy(0, -8);
      else if (e.clientY > r.bottom - 24) scroller.scrollBy(0, 8);
    }
    setDragState({ ...d, active: true, over: zoneAt(e.clientX, e.clientY, d) });
  };
  const onGripUp = () => {
    const d = dragRef.current;
    setDragState(null);
    if (!d?.active || !d.over) return;
    if (d.over.refused) {
      toast(`“${d.title}” was not moved. ${d.over.refused}`, { tone: "negative" });
      return;
    }
    if (d.over.refused === "") return;
    const m = moveFor(d, d.over);
    if (m) commit(m, "pointer");
  };

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDragState(null);
        announce("Move cancelled.");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  // ---- Keyboard ------------------------------------------------------------------------------------

  const onMoveKey = (page: string, key: ArrowKey) => {
    if (!canWrite) return;
    if (filtering) {
      announce("Clear the filter to move pages.");
      return;
    }
    const m = keyboardMove(tree, page, key);
    if ("reason" in m) announce(m.reason);
    else commit(m, "keyboard");
  };

  const openRowMenu = (page: string) => {
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(page)}"] .story-row-more`)?.click();
  };

  /** A page and every page under it, from the whole tree rather than the filtered one. */
  const pagesUnder = (id: string) => {
    const node = trail(tree.pages, id)?.at(-1) ?? tree.mockups.find((n) => n.page_id === id);
    return node ? flatten([node]).map((x) => x.node.page_id) : [id];
  };

  const common = { app, current, query, arranging, drag, isOpen, toggle, focusRequest, onMoveKey, openRowMenu, onGripDown, onGripMove, onGripUp, onExport, pagesUnder, refOf, actions };
  const total = count(tree.pages) + tree.mockups.length;

  return (
    <PanelContext label="Story pages">
      <div ref={rootRef} className={`story-tree-panel${drag?.active ? " is-dragging" : ""}`}>
        <div className="story-tree-top">
          <FindField label="Find a page" className="grow" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} />
        </div>
        {arrange.problem ? (
          <div role="alert" className="story-tree-problem">
            <Callout tone="attention" inset action={<Button size="sm" variant="quiet" onClick={arrange.clearProblem}>Dismiss</Button>}>
              {arrange.problem}
            </Callout>
          </div>
        ) : null}
        <PanelSection title="Story pages" end={<span className="num">{count(tree.pages)}</span>}>
          {pagesShown.length ? (
            <TreeList label="Story pages" list="pages" nodes={pagesShown} {...common} />
          ) : filtering ? (
            <p className="story-tree-none">No pages match “{query.trim()}”.</p>
          ) : (
            <p className="story-tree-none">No pages yet.</p>
          )}
          {drag?.active && drag.list === "pages" ? (
            <div className="story-drop-end" data-drop-target="end" data-drop={drag.over?.zone === "end" ? (drag.over.refused ? "refused" : "end") : undefined}>
              Move to the end of the top level
            </div>
          ) : null}
        </PanelSection>
        {tree.mockups.length ? (
          <PanelSection title="Published mockups" end={<span className="num">{tree.mockups.length}</span>}>
            {mockupsShown.length ? <TreeList label="Published mockups" list="mockups" icon="monitor" nodes={mockupsShown} {...common} /> : <p className="story-tree-none">No published mockups match.</p>}
          </PanelSection>
        ) : null}
        {archived.length ? (
          <div className="story-archived">
            <button type="button" className="story-archived-toggle" aria-expanded={archivedOpen} onClick={() => setShowArchived(!archivedOpen)}>
              <Glyph name="chevron-right" size="sm" />
              <span>Archived pages</span>
              <span className="num">{archived.length}</span>
            </button>
            {archivedOpen ? (
              <ul className="story-archived-list">
                {archived.map((p) => (
                  <li key={p.page_id} className="story-row story-row-plain" data-current={p.page_id === current || undefined} data-row={p.page_id}>
                    <Link className="story-link" to={`${app}/story/${p.page_id}`} aria-current={p.page_id === current ? "page" : undefined}>
                      <Glyph name="archive" />
                      <span className="ellipsis">{p.title}</span>
                    </Link>
                    <PageMenu page={p} archived onExport={onExport} actions={actions} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {style !== undefined ? (
          <PanelSection title="Story style">
            <button type="button" className="story-style-row" onClick={onStyle}>
              <Glyph name="palette" />
              <span className="story-style-text">
                <span className="ellipsis">{style ? style.name : "None yet"}</span>
                <span className="story-style-sub ellipsis">{style ? style.line : "Preview house styles"}</span>
              </span>
              <Glyph name="chevron-right" size="sm" />
            </button>
          </PanelSection>
        ) : null}
        {arranging && total > 1 ? <p className="story-tree-hint">Drag a page by its handle to reorder or nest it. With a page focused, Alt + arrow keys move it.</p> : null}
        {filtering && canWrite ? <p className="story-tree-hint">Clear the filter to arrange pages.</p> : null}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>
    </PanelContext>
  );
}

/** A page's "…" menu: export it, and, for a role that may, archive, restore or delete it. */
function PageMenu({ page, archived, subpages, onExport, actions }: {
  page: PageRef | { page_id: string; title: string };
  archived?: boolean;
  /** The page and every page under it, when there are any under it. */
  subpages?: string[];
  onExport: ExportPages;
  actions: PageActions;
}) {
  const { canWrite, canDelete } = useProduct();
  // A row whose page the product's list hasn't caught up with yet offers only export.
  const ref = "etag" in page ? page : null;
  return (
    <Menu label={`Actions for “${page.title}”`} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm story-row-more" minWidth={230}>
      {archived && canWrite && ref ? (
        <MenuItem icon="archive-restore" onSelect={() => actions.restore(ref)}>
          Restore
        </MenuItem>
      ) : null}
      <MenuItem icon="download" onSelect={() => onExport([page.page_id])}>
        Export this page to PDF…
      </MenuItem>
      {subpages && subpages.length > 1 ? (
        <MenuItem icon="download" meta={`${subpages.length} pages`} onSelect={() => onExport(subpages)}>
          Export with its subpages…
        </MenuItem>
      ) : null}
      {ref && ((!archived && canWrite) || canDelete) ? <MenuSeparator /> : null}
      {ref && !archived && canWrite ? (
        <MenuItem icon="archive" meta="Reversible" onSelect={() => actions.archive(ref)}>
          Archive
        </MenuItem>
      ) : null}
      {ref && canDelete ? (
        <MenuItem icon="trash" tone="danger" onSelect={() => actions.remove(ref)}>
          Delete permanently…
        </MenuItem>
      ) : null}
    </Menu>
  );
}

// ---- One tree (the pages, or the Published mockups) --------------------------------------------

interface ListProps {
  label: string;
  list: ListKind;
  /** The rows' glyph: a page, unless said otherwise. */
  icon?: GlyphName;
  nodes: StoryNode[];
  app: string;
  current: string | undefined;
  query: string;
  arranging: boolean;
  drag: Drag | null;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  focusRequest: MutableRefObject<string | null>;
  onMoveKey: (page: string, key: ArrowKey) => void;
  openRowMenu: (page: string) => void;
  onGripDown: (e: ReactPointerEvent<HTMLElement>, node: StoryNode, list: ListKind) => void;
  onGripMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onGripUp: () => void;
  onExport: ExportPages;
  pagesUnder: (page: string) => string[];
  refOf: (page: string) => PageRef | undefined;
  actions: PageActions;
}

function TreeList(props: ListProps) {
  const { label, nodes, isOpen, current, focusRequest } = props;
  const ref = useRef<HTMLUListElement>(null);
  const visible = useMemo(() => {
    const out: { node: StoryNode; parent: string | null }[] = [];
    const walk = (list: StoryNode[], parent: string | null) => {
      for (const n of list) {
        out.push({ node: n, parent });
        if (n.children.length && isOpen(n.page_id)) walk(n.children, n.page_id);
      }
    };
    walk(nodes, null);
    return out;
  }, [nodes, isOpen]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabStop = (focusId && visible.some((v) => v.node.page_id === focusId) ? focusId : null) ?? (current && visible.some((v) => v.node.page_id === current) ? current : null) ?? visible[0]?.node.page_id ?? null;

  const focusItem = (id: string) => {
    setFocusId(id);
    ref.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] [role="treeitem"]`)?.focus();
  };

  // Keep one tab stop: the treeitem, and its "…" button right after it. A page just moved keeps focus.
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>(".story-row-more").forEach((b) => {
      b.tabIndex = b.closest<HTMLElement>("[data-row]")?.dataset["row"] === tabStop ? 0 : -1;
    });
    const want = focusRequest.current;
    if (want && visible.some((v) => v.node.page_id === want)) {
      focusRequest.current = null;
      focusItem(want);
    }
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, id: string) => {
    const i = visible.findIndex((v) => v.node.page_id === id);
    const v = visible[i];
    if (!v) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      props.onMoveKey(id, e.key);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const hasKids = v.node.children.length > 0;
    const go = (n: number) => {
      e.preventDefault();
      const t = visible[Math.max(0, Math.min(visible.length - 1, n))];
      if (t) focusItem(t.node.page_id);
    };
    switch (e.key) {
      case "ArrowDown":
        return go(i + 1);
      case "ArrowUp":
        return go(i - 1);
      case "Home":
        return go(0);
      case "End":
        return go(visible.length - 1);
      case "ArrowRight":
        e.preventDefault();
        if (hasKids && !isOpen(id)) props.toggle(id);
        else if (hasKids) go(i + 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (hasKids && isOpen(id)) props.toggle(id);
        else if (v.parent) focusItem(v.parent);
        return;
      case "ContextMenu":
        e.preventDefault();
        props.openRowMenu(id);
        return;
      case "F10":
        if (e.shiftKey) {
          e.preventDefault();
          props.openRowMenu(id);
        }
        return;
    }
  };

  return (
    <ul ref={ref} role="tree" aria-label={label} className="story-tree">
      <Rows {...props} level={1} tabStop={tabStop} onKeyDown={onKeyDown} onFocusItem={setFocusId} />
    </ul>
  );
}

type RowsProps = ListProps & { tabStop: string | null; onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void; onFocusItem: (id: string) => void };

function Rows(props: RowsProps & { level: number }) {
  const { nodes, level } = props;
  return (
    <>
      {nodes.map((n, i) => (
        <Row key={n.page_id} {...props} node={n} level={level} pos={i + 1} size={nodes.length} />
      ))}
    </>
  );
}

function Row(props: RowsProps & { node: StoryNode; level: number; pos: number; size: number }) {
  const { node, level, pos, size, app, current, query, arranging, drag, isOpen, toggle, list } = props;
  const groupId = useId();
  const kids = node.children.length > 0;
  const open = kids && isOpen(node.page_id);
  const isCurrent = node.page_id === current;
  const dropping = drag?.active && drag.over?.page === node.page_id && drag.over.refused !== "" ? (drag.over.refused ? "refused" : drag.over.zone) : undefined;
  return (
    <li role="none" className="story-node">
      <div
        className="story-row"
        data-row={node.page_id}
        data-drop-target={list}
        data-current={isCurrent || undefined}
        data-dragging={drag?.active && drag.page === node.page_id ? "" : undefined}
        data-drop={dropping}
        style={{ "--level": level - 1 } as CSSProperties}
      >
        {arranging ? (
          <span
            className="story-grip"
            aria-hidden="true"
            title="Drag to move"
            onPointerDown={(e) => props.onGripDown(e, node, list)}
            onPointerMove={props.onGripMove}
            onPointerUp={props.onGripUp}
            onPointerCancel={props.onGripUp}
          >
            <Glyph name="grip" size="sm" />
          </span>
        ) : (
          <span className="story-grip-space" aria-hidden="true" />
        )}
        <span className="story-indent" aria-hidden="true" />
        <span className={`story-caret${kids ? "" : " is-leaf"}`} aria-hidden="true" data-open={open || undefined} onClick={() => kids && toggle(node.page_id)}>
          <Glyph name="chevron-right" size="sm" />
        </span>
        <Link
          to={`${app}/story/${node.page_id}`}
          role="treeitem"
          className="story-link"
          aria-label={node.title}
          aria-level={level}
          aria-setsize={size}
          aria-posinset={pos}
          aria-expanded={kids ? open : undefined}
          aria-owns={open ? groupId : undefined}
          aria-current={isCurrent ? "page" : undefined}
          aria-keyshortcuts={arranging ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight" : undefined}
          tabIndex={props.tabStop === node.page_id ? 0 : -1}
          onFocus={() => props.onFocusItem(node.page_id)}
          onKeyDown={(e) => props.onKeyDown(e, node.page_id)}
        >
          <Glyph name={props.icon ?? "file-text"} />
          <span className="ellipsis">
            <Highlight text={node.title} query={query} />
          </span>
        </Link>
        <PageMenu page={props.refOf(node.page_id) ?? node} subpages={props.pagesUnder(node.page_id)} onExport={props.onExport} actions={props.actions} />
      </div>
      {open ? (
        <ul role="group" id={groupId} className="story-tree">
          <Rows {...props} nodes={node.children} level={level + 1} />
        </ul>
      ) : null}
    </li>
  );
}
