import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { useProduct } from "../lib/session.tsx";
import { PanelContext, PanelSection } from "../shell/slots.tsx";
import { FindField, Glyph, Menu, MenuItem, type GlyphName } from "../ui/index.tsx";
import { count, filterTree, flatten, trail, type Arrangement, type StoryNode } from "./story-model.ts";

export interface ArchivedPage {
  page_id: string;
  title: string;
}

/** Opens Export to PDF with these pages ticked. */
export type ExportPages = (pages: string[]) => void;

// ---- The tree panel: agents arrange the Story; people read and find their way ------------------

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

export function StoryTree({ tree, archived, current, onExport, style, onStyle }: {
  tree: Arrangement;
  archived: ArchivedPage[];
  current: string | undefined;
  onExport: ExportPages;
  /** The Story style's name and how it reads, or null before an agent sets one; undefined while loading. */
  style: { name: string; line: string } | null | undefined;
  onStyle: () => void;
}) {
  const { app, product } = useProduct();
  const [query, setQuery] = useState("");
  const storeKey = `whatbuild.story-collapsed.${product.product_id}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(storeKey));
  const [showArchived, setShowArchived] = useState<boolean | null>(null);
  const archivedOpen = showArchived ?? archived.some((p) => p.page_id === current);
  const rootRef = useRef<HTMLDivElement>(null);
  const filtering = query.trim() !== "";

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

  const openRowMenu = (page: string) => {
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(page)}"] .story-row-more`)?.click();
  };

  /** A page and every page under it, from the whole tree rather than the filtered one. */
  const pagesUnder = (id: string) => {
    const node = trail(tree.pages, id)?.at(-1) ?? tree.mockups.find((n) => n.page_id === id);
    return node ? flatten([node]).map((x) => x.node.page_id) : [id];
  };

  const common = { app, current, query, isOpen, toggle, openRowMenu, onExport, pagesUnder };

  return (
    <PanelContext label="Story pages">
      <div ref={rootRef} className="story-tree-panel">
        <div className="story-tree-top">
          <FindField label="Find a page" className="grow" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} />
        </div>
        <PanelSection title="Story pages" end={<span className="num">{count(tree.pages)}</span>}>
          {pagesShown.length ? (
            <TreeList label="Story pages" nodes={pagesShown} {...common} />
          ) : filtering ? (
            <p className="story-tree-none">No pages match “{query.trim()}”.</p>
          ) : (
            <p className="story-tree-none">No pages yet. An agent writes the first one.</p>
          )}
        </PanelSection>
        {tree.mockups.length ? (
          <PanelSection title="Published mockups" end={<span className="num">{tree.mockups.length}</span>}>
            {mockupsShown.length ? <TreeList label="Published mockups" icon="monitor" nodes={mockupsShown} {...common} /> : <p className="story-tree-none">No published mockups match.</p>}
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
      </div>
    </PanelContext>
  );
}

// ---- One tree (the pages, or the Published mockups) --------------------------------------------

interface ListProps {
  label: string;
  /** The rows' glyph: a page, unless said otherwise. */
  icon?: GlyphName;
  nodes: StoryNode[];
  app: string;
  current: string | undefined;
  query: string;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  openRowMenu: (page: string) => void;
  onExport: ExportPages;
  pagesUnder: (page: string) => string[];
}

function TreeList(props: ListProps) {
  const { label, nodes, isOpen, current } = props;
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
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, id: string) => {
    const i = visible.findIndex((v) => v.node.page_id === id);
    const v = visible[i];
    if (!v || e.altKey || e.ctrlKey || e.metaKey) return;
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
      <Rows {...props} list={nodes} level={1} tabStop={tabStop} onKeyDown={onKeyDown} onFocusItem={setFocusId} />
    </ul>
  );
}

type RowsProps = ListProps & { tabStop: string | null; onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void; onFocusItem: (id: string) => void };

function Rows(props: RowsProps & { list: StoryNode[]; level: number }) {
  const { list, level } = props;
  return (
    <>
      {list.map((n, i) => (
        <Row key={n.page_id} {...props} node={n} level={level} pos={i + 1} size={list.length} />
      ))}
    </>
  );
}

function Row(props: RowsProps & { node: StoryNode; level: number; pos: number; size: number }) {
  const { node, level, pos, size, app, current, query, isOpen, toggle, onExport } = props;
  const groupId = useId();
  const kids = node.children.length > 0;
  const open = kids && isOpen(node.page_id);
  const isCurrent = node.page_id === current;
  const withSubpages = props.pagesUnder(node.page_id);
  return (
    <li role="none" className="story-node">
      <div className="story-row" data-row={node.page_id} data-current={isCurrent || undefined} style={{ "--level": level - 1 } as CSSProperties}>
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
          <Glyph name={props.icon ?? "file-text"} />
          <span className="ellipsis">
            <Highlight text={node.title} query={query} />
          </span>
        </Link>
        <Menu label={`Export “${node.title}”`} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm story-row-more" minWidth={230}>
          <MenuItem icon="download" onSelect={() => onExport([node.page_id])}>
            Export this page to PDF…
          </MenuItem>
          {withSubpages.length > 1 ? (
            <MenuItem icon="download" meta={`${withSubpages.length} pages`} onSelect={() => onExport(withSubpages)}>
              Export with its subpages…
            </MenuItem>
          ) : null}
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
