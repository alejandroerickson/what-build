/**
 * The Story tree as data: where a page sits, and what the tree looks like after a person moves one.
 * Pure functions, so the tree panel, the Move to… dialog and the retry after a 409 all share them.
 */

/** The server's limits (story.set_hierarchy and story.publish). */
export const MAX_PAGES = 50;
export const MAX_DEPTH = 6;

export interface StoryNode {
  page_id: string;
  title: string;
  description: string;
  children: StoryNode[];
}

/** story.get_hierarchy: `items` also lists the unplaced pages at the top level; `unplaced` names them. */
export interface Hierarchy {
  etag: string | null;
  items: StoryNode[];
  unplaced: string[];
}

/** The tree split the way the panel shows it: the navigation, then the pages not yet placed. */
export interface Arrangement {
  placed: StoryNode[];
  unplaced: StoryNode[];
}

/**
 * A move, said in page ids so it can be applied again to a newer tree after a conflict:
 * put `page` under `parent` (null = top level) just before `before` (null = at the end).
 * `unplace` takes the page out of the navigation instead (only Undo does that).
 */
export interface Move {
  page: string;
  parent: string | null;
  before: string | null;
  unplace?: boolean;
}

export type MoveResult = { ok: true; tree: Arrangement } | { ok: false; reason: string };

export function split(h: Hierarchy): Arrangement {
  const un = new Set(h.unplaced);
  return { placed: h.items.filter((n) => !un.has(n.page_id)), unplaced: h.items.filter((n) => un.has(n.page_id)) };
}

/** The tree as story.set_hierarchy takes it. */
export function toServer(nodes: StoryNode[]): { page_id: string; children: ReturnType<typeof toServer> }[] {
  return nodes.map((n) => ({ page_id: n.page_id, children: toServer(n.children) }));
}

export interface Located {
  node: StoryNode;
  parent: StoryNode | null;
  siblings: StoryNode[];
  index: number;
  /** 1 for a top-level page. */
  level: number;
}

export function locate(nodes: StoryNode[], id: string, parent: StoryNode | null = null, level = 1): Located | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.page_id === id) return { node: n, parent, siblings: nodes, index: i, level };
    const hit = locate(n.children, id, n, level + 1);
    if (hit) return hit;
  }
  return null;
}

/** Levels in a subtree: 1 for a page without children. */
export function height(n: StoryNode): number {
  return 1 + Math.max(0, ...n.children.map(height));
}

export function contains(n: StoryNode, id: string): boolean {
  return n.page_id === id || n.children.some((c) => contains(c, id));
}

export function count(nodes: StoryNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + count(n.children), 0);
}

/** Depth-first order, the order the Story reads (and prints) in. */
export function flatten(nodes: StoryNode[], level = 1): { node: StoryNode; level: number }[] {
  return nodes.flatMap((n) => [{ node: n, level }, ...flatten(n.children, level + 1)]);
}

/** The pages from the top down to `id`, or null when it is not in the tree. */
export function trail(nodes: StoryNode[], id: string, path: StoryNode[] = []): StoryNode[] | null {
  for (const n of nodes) {
    if (n.page_id === id) return [...path, n];
    const t = trail(n.children, id, [...path, n]);
    if (t) return t;
  }
  return null;
}

function without(nodes: StoryNode[], id: string, promote: boolean): StoryNode[] {
  return nodes.flatMap((n) => {
    if (n.page_id === id) return promote ? without(n.children, id, promote) : [];
    return [{ ...n, children: without(n.children, id, promote) }];
  });
}

function insert(nodes: StoryNode[], parent: string | null, before: string | null, node: StoryNode): StoryNode[] {
  const place = (list: StoryNode[]) => {
    const i = before ? list.findIndex((n) => n.page_id === before) : -1;
    return i < 0 ? [...list, node] : [...list.slice(0, i), node, ...list.slice(i)];
  };
  if (parent === null) return place(nodes);
  return nodes.map((n) => (n.page_id === parent ? { ...n, children: place(n.children) } : { ...n, children: insert(n.children, parent, before, node) }));
}

/** Why a page can't go under `parent`, in words, or null when it can. */
export function refusal(tree: Arrangement, page: string, parent: string | null): string | null {
  const placed = locate(tree.placed, page);
  const node = placed?.node ?? tree.unplaced.find((n) => n.page_id === page);
  if (!node) return "That page is no longer in the Story.";
  if (parent === null) return height(node) > MAX_DEPTH ? `The Story is at most ${MAX_DEPTH} levels deep.` : null;
  if (contains(node, parent)) return "A page can't go inside itself or one of its own subpages.";
  const target = locate(tree.placed, parent);
  if (!target) return "The page you chose is no longer in the navigation.";
  if (target.level + height(node) > MAX_DEPTH) return `The Story is at most ${MAX_DEPTH} levels deep, and this would make it deeper.`;
  return null;
}

export function applyMove(tree: Arrangement, move: Move): MoveResult {
  const placed = locate(tree.placed, move.page);
  const loose = tree.unplaced.find((n) => n.page_id === move.page);
  const node = placed?.node ?? loose;
  if (!node) return { ok: false, reason: "That page is no longer in the Story." };
  if (move.unplace) {
    if (!placed) return { ok: true, tree };
    return { ok: true, tree: { placed: without(tree.placed, move.page, true), unplaced: [...tree.unplaced, { ...node, children: [] }] } };
  }
  const why = refusal(tree, move.page, move.parent);
  if (why) return { ok: false, reason: why };
  const rest = placed ? without(tree.placed, move.page, false) : tree.placed;
  // "Just before itself" means staying put: the page that follows it now.
  const before = move.before === move.page ? (placed?.siblings[placed.index + 1]?.page_id ?? null) : move.before;
  return {
    ok: true,
    tree: {
      placed: insert(rest, move.parent, before, node),
      unplaced: tree.unplaced.filter((n) => n.page_id !== move.page),
    },
  };
}

/** Where a page is now, as the move that would put it back there. */
export function positionOf(tree: Arrangement, page: string): Move {
  const at = locate(tree.placed, page);
  if (!at) return { page, parent: null, before: null, unplace: true };
  return { page, parent: at.parent?.page_id ?? null, before: at.siblings[at.index + 1]?.page_id ?? null };
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * Alt+arrow on a page: ↑/↓ swap it with its neighbour, → nests it under the page above, ← moves it out
 * to follow its parent. On an unplaced page, ↑, → and ← place it at the end of the top level.
 */
export function keyboardMove(tree: Arrangement, page: string, key: ArrowKey): Move | { reason: string } {
  const at = locate(tree.placed, page);
  if (!at) {
    if (key === "ArrowDown") return { reason: "Alt + ↑ places this page at the end of the navigation." };
    return { page, parent: null, before: null };
  }
  const parent = at.parent?.page_id ?? null;
  const prev = at.siblings[at.index - 1];
  const next = at.siblings[at.index + 1];
  switch (key) {
    case "ArrowUp":
      return prev ? { page, parent, before: prev.page_id } : { reason: "It is already first at this level." };
    case "ArrowDown":
      return next ? { page, parent, before: at.siblings[at.index + 2]?.page_id ?? null } : { reason: "It is already last at this level." };
    case "ArrowRight":
      return prev ? { page, parent: prev.page_id, before: null } : { reason: "There is no page above it at this level to nest it under." };
    case "ArrowLeft": {
      if (!at.parent) return { reason: "It is already at the top level." };
      const up = locate(tree.placed, at.parent.page_id)!;
      return { page, parent: up.parent?.page_id ?? null, before: up.siblings[up.index + 1]?.page_id ?? null };
    }
  }
}

/** Where a moved page ended up, in words: "under “Overview”, 2 of 3". */
export function describePosition(tree: Arrangement, page: string): string {
  const at = locate(tree.placed, page);
  if (!at) return "in Unplaced pages";
  const where = at.parent ? `under “${at.parent.title}”` : "at the top level";
  return `${where}, ${at.index + 1} of ${at.siblings.length}`;
}

/**
 * The tree narrowed to pages whose title matches `query` (case-insensitive), keeping their
 * ancestors so each match stays in context.
 */
export function filterTree(nodes: StoryNode[], query: string): StoryNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.flatMap((n) => {
    const kids = filterTree(n.children, q);
    return n.title.toLowerCase().includes(q) || kids.length ? [{ ...n, children: kids }] : [];
  });
}

/** A page address from a title: lower-case letters, digits and hyphens, at most 80 characters. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

// ---- Shapes the Story screen reads -------------------------------------------------------------

export interface Actor {
  account_id: string;
  display_name: string;
  surface: "web" | "rest" | "mcp" | null;
  client: string | null;
}

export type RefKind = "objectives" | "sources" | "insights" | "assumptions" | "decisions";
export type Refs = Partial<Record<RefKind, string[]>>;

export interface ResolvedRef {
  id: string;
  title: string | null;
  status: string | null;
  kind?: string;
  archived: boolean;
  missing: boolean;
}

export interface CitationView {
  index: number;
  record_id: string;
  source_title: string | null;
  seq_start: number;
  seq_end: number;
  quote: string;
}

export interface CitationCheck {
  index: number;
  record_id: string;
  status: "ok" | "relocated" | "text_changed" | "record_archived" | "record_deleted" | "record_missing";
  relocated?: { seq_start: number; seq_end: number };
  version_drift: boolean;
}

export interface VersionView {
  version: number;
  page_id: string;
  title: string;
  summary: string;
  note: string;
  refs: Refs;
  resolved_refs: Record<RefKind, ResolvedRef[]>;
  citations: CitationView[];
  published_at: string;
  published_by: Actor;
  html?: string;
}

export interface AgentNotes {
  content: string;
  etag: string;
  updated_at: string | null;
  updated_by: Actor | null;
}

export interface PageView {
  page_id: string;
  title: string;
  summary: string;
  current_version: number;
  archived_at: string | null;
  etag: string;
  updated_at: string;
  agent_notes: AgentNotes;
  current: VersionView;
}

export interface PageSummary {
  page_id: string;
  title: string;
  archived_at: string | null;
}

export interface VersionItem {
  version: number;
  title: string;
  note: string;
  citation_count: number;
  published_at: string;
  published_by: Actor;
}
