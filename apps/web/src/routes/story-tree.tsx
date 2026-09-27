import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { PanelContext, PanelSection } from "../shell/slots.tsx";
import { Button, Callout, FindField, Glyph, IconButton, Menu, MenuItem, MenuSeparator, useToast } from "../ui/index.tsx";
import {
  applyMove, count, describePosition, filterTree, flatten, keyboardMove, locate, MAX_DEPTH, MAX_PAGES, positionOf, refusal, split, toServer, trail,
  type Arrangement, type ArrowKey, type Hierarchy, type Move, type MoveResult, type StoryNode,
} from "./story-model.ts";

/** What the tree, the page actions menu and the dialogs can ask the Story screen to do. */
export interface StoryActions {
  addPage: (parent: string | null) => void;
  rename: (page: string) => void;
  moveTo: (page: string) => void;
  archive: (page: string) => void;
  restore: (page: string) => void;
  copyLink: (page: string) => void;
  exportPdf: (preselect?: string) => void;
}

export interface ArchivedPage {
  page_id: string;
  title: string;
}

// ---- Saving arrangements ------------------------------------------------------------------------

class Explained extends Error {}

/**
 * Moves pages and saves the whole tree with story.set_hierarchy and the hierarchy's etag. Moves
 * show at once and are saved in order. On a 409 the tree is read again, the person's pending moves
 * are applied to it again, and the save is retried once; if that fails too, the tree shows the other
 * person's arrangement and `problem` says what happened.
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

  const put = (placed: StoryNode[], etag: string | null) => api<Hierarchy>("PUT", `${base}/story/hierarchy`, { items: toServer(placed), expected_etag: etag });

  const flush = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const batch = queue.current.splice(0);
        const known = qc.getQueryData<Hierarchy>(key);
        let saved: Hierarchy;
        try {
          saved = await put(localRef.current!.placed, known?.etag ?? null);
        } catch (e) {
          if (!(e instanceof ApiError && e.code === "stale_etag")) throw e;
          const fresh = await api<Hierarchy>("GET", `${base}/story/hierarchy`);
          let t = split(fresh);
          for (const m of [...batch, ...queue.current.splice(0)]) {
            const r = applyMove(t, m);
            if (!r.ok) {
              qc.setQueryData(key, fresh);
              throw new Explained(`Someone else rearranged the Story while you were moving pages, and your move no longer fits: ${r.reason} The tree now shows their arrangement.`);
            }
            t = r.tree;
          }
          setTree(t);
          try {
            saved = await put(t.placed, fresh.etag);
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

  const tree = local ?? (h ? split(h) : { placed: [], unplaced: [] });
  return { tree, move, saving: local !== null, problem, clearProblem: () => setProblem(null) };
}

export type Arrange = ReturnType<typeof useArrange>;

// ---- The tree panel -----------------------------------------------------------------------------

type Zone = "before" | "after" | "into" | "end";
interface Drag {
  page: string;
  title: string;
  x: number;
  y: number;
  active: boolean;
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

export function StoryTree({ arrange, archived, current, totalPages, actions }: {
  arrange: Arrange;
  archived: ArchivedPage[];
  current: string | undefined;
  /** Every page the product has, archived ones included (the 50-page limit counts them all). */
  totalPages: number;
  actions: StoryActions;
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
  const atLimit = totalPages >= MAX_PAGES;

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
    const path = trail(tree.placed, current);
    if (!path) return;
    const shut = path.slice(0, -1).filter((n) => collapsed.has(n.page_id));
    if (!shut.length) return;
    const next = new Set(collapsed);
    shut.forEach((n) => next.delete(n.page_id));
    saveCollapsed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, tree.placed]);

  const placedShown = useMemo(() => filterTree(tree.placed, query), [tree.placed, query]);
  const unplacedShown = useMemo(() => filterTree(tree.unplaced, query), [tree.unplaced, query]);
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

  const titleOf = (id: string) => locate(tree.placed, id)?.node.title ?? tree.unplaced.find((n) => n.page_id === id)?.title ?? id;

  /** Applies a move; `undoable` moves (drag, Move to…) get a toast with Undo, keyboard ones are announced. */
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
    else toast(`Moved “${title}” ${where}.`, { action: { label: "Undo", onClick: () => arrange.move(back) } });
  };

  // ---- Pointer dragging: the grip starts it; the row under the pointer takes it -------------------

  const zoneAt = (x: number, y: number, page: string): Drag["over"] => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-target]");
    if (!el || !rootRef.current?.contains(el)) return null;
    if (el.dataset["dropTarget"] === "end") return { page: null, zone: "end", refused: refusal(tree, page, null) };
    const target = el.dataset["page"]!;
    if (el.dataset["dropTarget"] !== "placed") return null;
    const r = el.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    const zone: Zone = f < 0.3 ? "before" : f > 0.7 ? "after" : "into";
    if (target === page) return { page: target, zone, refused: "" };
    const at = locate(tree.placed, target);
    const parent = zone === "into" ? target : (at?.parent?.page_id ?? null);
    return { page: target, zone, refused: refusal(tree, page, parent) };
  };

  const moveFor = (page: string, over: NonNullable<Drag["over"]>): Move | null => {
    if (over.zone === "end") return { page, parent: null, before: null };
    const at = over.page ? locate(tree.placed, over.page) : null;
    if (!at) return null;
    const parent = at.parent?.page_id ?? null;
    if (over.zone === "into") return { page, parent: over.page, before: null };
    if (over.zone === "before") return { page, parent, before: over.page };
    const next = at.siblings.slice(at.index + 1).find((n) => n.page_id !== page);
    return { page, parent, before: next?.page_id ?? null };
  };

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onGripDown = (e: ReactPointerEvent<HTMLElement>, node: StoryNode) => {
    if (e.button !== 0 || !arranging) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ page: node.page_id, title: node.title, x: e.clientX, y: e.clientY, active: false, over: null });
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
    setDragState({ ...d, active: true, over: zoneAt(e.clientX, e.clientY, d.page) });
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
    const m = moveFor(d.page, d.over);
    if (m) commit(m, "pointer");
  };

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
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

  const common = {
    app,
    current,
    query,
    canWrite,
    arranging,
    drag,
    isOpen,
    toggle,
    focusRequest,
    onMoveKey,
    openRowMenu,
    onGripDown,
    onGripMove,
    onGripUp,
    actions,
    atLimit,
  };

  const total = count(tree.placed) + tree.unplaced.length;
  const empty = total === 0;
  return (
    <PanelContext label="Story pages">
      <div ref={rootRef} className={`story-tree-panel${drag?.active ? " is-dragging" : ""}`}>
        <div className="story-tree-top">
          <FindField label="Find a page" className="grow" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} />
          {canWrite ? (
            <IconButton
              label={atLimit ? `Add a page (the Story is at its limit of ${MAX_PAGES} pages)` : "Add a page"}
              icon="plus"
              disabled={atLimit}
              onClick={() => actions.addPage(null)}
            />
          ) : null}
        </div>
        {arrange.problem ? (
          <div role="alert" className="story-tree-problem">
            <Callout tone="attention" inset action={<Button size="sm" variant="quiet" onClick={arrange.clearProblem}>Dismiss</Button>}>
              {arrange.problem}
            </Callout>
          </div>
        ) : null}
        <PanelSection
          title="Story pages"
          end={
            <span className="story-tree-head-end">
              <span className="num">{count(tree.placed)}</span>
              <Menu label="Story page options" trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm" minWidth={200}>
                <MenuItem icon="download" onSelect={() => actions.exportPdf()} disabled={empty}>
                  Export to PDF…
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="chevron-down" onSelect={() => saveCollapsed(new Set())}>
                  Expand all
                </MenuItem>
                <MenuItem icon="chevron-right" onSelect={() => saveCollapsed(new Set(flatten(tree.placed).filter((x) => x.node.children.length).map((x) => x.node.page_id)))}>
                  Collapse all
                </MenuItem>
              </Menu>
            </span>
          }
        >
          {placedShown.length ? (
            <TreeList label="Story pages" nodes={placedShown} kind="placed" {...common} />
          ) : filtering ? (
            <p className="story-tree-none">No pages match “{query.trim()}”.</p>
          ) : empty ? (
            <p className="story-tree-none">No pages yet. {canWrite ? "Add one, or ask an agent to write the first page." : "An agent writes the first page."}</p>
          ) : (
            <p className="story-tree-none">No pages are in the navigation yet.</p>
          )}
          {drag?.active ? (
            <div className="story-drop-end" data-drop-target="end" data-drop={drag.over?.zone === "end" ? (drag.over.refused ? "refused" : "end") : undefined}>
              Move to the end of the top level
            </div>
          ) : null}
        </PanelSection>
        {tree.unplaced.length ? (
          <PanelSection title="Unplaced pages" end={<span className="num">{tree.unplaced.length}</span>}>
            <p className="story-tree-hint">Published, but not in the navigation yet.{arranging ? " Drag one into the tree, or use Move to…" : ""}</p>
            {unplacedShown.length ? <TreeList label="Unplaced pages" nodes={unplacedShown} kind="unplaced" {...common} /> : <p className="story-tree-none">No unplaced pages match.</p>}
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
                    <Menu label={`Actions for “${p.title}”`} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm story-row-more">
                      {canWrite ? (
                        <MenuItem icon="archive-restore" onSelect={() => actions.restore(p.page_id)}>
                          Restore
                        </MenuItem>
                      ) : null}
                      <MenuItem icon="link" onSelect={() => actions.copyLink(p.page_id)}>
                        Copy link
                      </MenuItem>
                    </Menu>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {arranging && total > 1 ? <p className="story-tree-hint">Drag a page by its handle to reorder or nest it. With a page focused, Alt + arrow keys move it; Move to… in its menu does the same.</p> : null}
        {filtering && canWrite ? <p className="story-tree-hint">Clear the filter to arrange pages.</p> : null}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>
    </PanelContext>
  );
}

// ---- One tree (the navigation, or the unplaced pages) ------------------------------------------

interface ListProps {
  label: string;
  nodes: StoryNode[];
  kind: "placed" | "unplaced";
  app: string;
  current: string | undefined;
  query: string;
  canWrite: boolean;
  arranging: boolean;
  drag: Drag | null;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  focusRequest: MutableRefObject<string | null>;
  onMoveKey: (page: string, key: ArrowKey) => void;
  openRowMenu: (page: string) => void;
  onGripDown: (e: ReactPointerEvent<HTMLElement>, node: StoryNode) => void;
  onGripMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onGripUp: () => void;
  actions: StoryActions;
  atLimit: boolean;
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

  // Keep one tab stop: the treeitem, and its "…" button right after it.
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
    const hasKids = v.node.children.length > 0;
    if (e.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      props.onMoveKey(id, e.key as ArrowKey);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
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
      case "F2":
        if (props.canWrite) {
          e.preventDefault();
          props.actions.rename(id);
        }
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
      <Rows {...props} list={nodes} level={1} tabStop={tabStop} onKeyDown={onKeyDown} onFocusItem={setFocusId} />
    </ul>
  );
}

function Rows(props: ListProps & { list: StoryNode[]; level: number; tabStop: string | null; onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void; onFocusItem: (id: string) => void }) {
  const { list, level } = props;
  return (
    <>
      {list.map((n, i) => (
        <Row key={n.page_id} {...props} node={n} level={level} pos={i + 1} size={list.length} />
      ))}
    </>
  );
}

function Row(props: ListProps & { node: StoryNode; level: number; pos: number; size: number; tabStop: string | null; onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void; onFocusItem: (id: string) => void }) {
  const { node, level, pos, size, app, current, query, arranging, drag, isOpen, toggle, kind, actions, canWrite } = props;
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
        data-page={node.page_id}
        data-drop-target={kind}
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
            onPointerDown={(e) => props.onGripDown(e, node)}
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
          tabIndex={props.tabStop === node.page_id ? 0 : -1}
          onFocus={() => props.onFocusItem(node.page_id)}
          onKeyDown={(e) => props.onKeyDown(e, node.page_id)}
        >
          <Glyph name="file-text" />
          <span className="ellipsis">
            <Highlight text={node.title} query={query} />
          </span>
        </Link>
        <Menu label={`Actions for “${node.title}”`} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm story-row-more" minWidth={210}>
          <RowMenuItems page={node.page_id} canWrite={canWrite} actions={actions} atLimit={props.atLimit} depthFull={kind === "placed" && level >= MAX_DEPTH} />
        </Menu>
      </div>
      {open ? (
        <ul role="group" id={groupId} className="story-tree">
          <Rows {...props} list={node.children} level={level + 1} />
        </ul>
      ) : null}
    </li>
  );
}

/** The actions on one page, shared by the tree rows and the inspector's page menu. */
export function RowMenuItems({ page, canWrite, actions, atLimit, depthFull, archived, extra }: {
  page: string;
  canWrite: boolean;
  actions: StoryActions;
  atLimit: boolean;
  depthFull: boolean;
  archived?: boolean;
  extra?: ReactNode;
}) {
  if (archived)
    return (
      <>
        {canWrite ? (
          <MenuItem icon="archive-restore" onSelect={() => actions.restore(page)}>
            Restore
          </MenuItem>
        ) : null}
        <MenuItem icon="link" onSelect={() => actions.copyLink(page)}>
          Copy link
        </MenuItem>
        <MenuItem icon="download" onSelect={() => actions.exportPdf(page)}>
          Export to PDF…
        </MenuItem>
      </>
    );
  return (
    <>
      {canWrite ? (
        <>
          <MenuItem icon="pencil" kbd="F2" onSelect={() => actions.rename(page)}>
            Rename…
          </MenuItem>
          <MenuItem
            icon="corner-down-right"
            disabled={atLimit || depthFull}
            meta={atLimit ? `${MAX_PAGES} max` : depthFull ? `${MAX_DEPTH} levels max` : undefined}
            onSelect={() => actions.addPage(page)}
          >
            Add child page…
          </MenuItem>
          <MenuItem icon="folder-input" onSelect={() => actions.moveTo(page)}>
            Move to…
          </MenuItem>
        </>
      ) : null}
      <MenuItem icon="link" onSelect={() => actions.copyLink(page)}>
        Copy link
      </MenuItem>
      <MenuItem icon="download" onSelect={() => actions.exportPdf(page)}>
        Export to PDF…
      </MenuItem>
      {extra}
      {canWrite ? (
        <>
          <MenuSeparator />
          <MenuItem icon="archive" meta="Reversible" onSelect={() => actions.archive(page)}>
            Archive
          </MenuItem>
        </>
      ) : null}
    </>
  );
}
