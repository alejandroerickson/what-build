/**
 * The Story tree as data: where a page sits, what the panel shows, and what the tree looks like after
 * a person moves one. Pure functions, so dragging, the keyboard and the retry after a 409 share them.
 */

/** The server's limits (story.publish counts archived pages too, and story.set_hierarchy). */
export const MAX_PAGES = 50;
export const MAX_DEPTH = 6;

export interface StoryNode {
  page_id: string;
  title: string;
  description: string;
  children: StoryNode[];
}

/**
 * story.get_hierarchy: `items` is the tree as saved, `unplaced` the pages not yet placed, and
 * `mockups` the Published mockups, the pages showing a mockup page, in order.
 */
export interface Hierarchy {
  etag: string | null;
  items: StoryNode[];
  unplaced: Omit<StoryNode, "children">[];
  mockups: Omit<StoryNode, "children">[];
}

/** The Story the way the panel shows it: the page tree with the pages not yet placed at its end, then the Published mockups. */
export interface Arrangement {
  pages: StoryNode[];
  mockups: StoryNode[];
}

export function split(h: Hierarchy): Arrangement {
  const leaf = (m: Omit<StoryNode, "children">): StoryNode => ({ ...m, children: [] });
  return { pages: [...h.items, ...h.unplaced.map(leaf)], mockups: h.mockups.map(leaf) };
}

/** Where a page stands among the Published mockups, and the ones either side, or null when it is not one. */
export function mockupStop(a: Arrangement, id: string): { index: number; count: number; prev: StoryNode | null; next: StoryNode | null } | null {
  const index = a.mockups.findIndex((m) => m.page_id === id);
  if (index < 0) return null;
  return { index, count: a.mockups.length, prev: a.mockups[index - 1] ?? null, next: a.mockups[index + 1] ?? null };
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

// ---- Moving pages ------------------------------------------------------------------------------

/**
 * A move, said in page ids so it can be applied again to a newer tree after a conflict: put `page`
 * under `parent` (null = top level) just before `before` (null = at the end). A published mockup
 * moves only among the Published mockups, which have no levels, so its parent is always null.
 */
export interface Move {
  page: string;
  parent: string | null;
  before: string | null;
}

export type MoveResult = { ok: true; tree: Arrangement } | { ok: false; reason: string };

/** The arrangement as story.set_hierarchy takes it: the tree, which places every page shown in it, and the mockups' order. */
export function toServer(a: Arrangement): { items: ServerNode[]; mockups: string[] } {
  const bare = (nodes: StoryNode[]): ServerNode[] => nodes.map((n) => ({ page_id: n.page_id, children: bare(n.children) }));
  return { items: bare(a.pages), mockups: a.mockups.map((m) => m.page_id) };
}

interface ServerNode {
  page_id: string;
  children: ServerNode[];
}

function without(nodes: StoryNode[], id: string): StoryNode[] {
  return nodes.flatMap((n) => (n.page_id === id ? [] : [{ ...n, children: without(n.children, id) }]));
}

function placeIn(list: StoryNode[], before: string | null, node: StoryNode): StoryNode[] {
  const i = before ? list.findIndex((n) => n.page_id === before) : -1;
  return i < 0 ? [...list, node] : [...list.slice(0, i), node, ...list.slice(i)];
}

function insert(nodes: StoryNode[], parent: string | null, before: string | null, node: StoryNode): StoryNode[] {
  if (parent === null) return placeIn(nodes, before, node);
  return nodes.map((n) => (n.page_id === parent ? { ...n, children: placeIn(n.children, before, node) } : { ...n, children: insert(n.children, parent, before, node) }));
}

const isMockup = (a: Arrangement, id: string) => a.mockups.some((m) => m.page_id === id);

/** Why a page can't go under `parent`, in words, or null when it can. */
export function refusal(tree: Arrangement, page: string, parent: string | null): string | null {
  if (isMockup(tree, page)) return parent === null ? null : "A published mockup stays among the Published mockups.";
  const at = locate(tree.pages, page);
  if (!at) return "That page is no longer in the Story.";
  if (parent === null) return null;
  if (contains(at.node, parent)) return "A page can’t go inside itself or one of its own subpages.";
  const target = locate(tree.pages, parent);
  if (!target) return "The page you chose is no longer in the Story.";
  if (target.level + height(at.node) > MAX_DEPTH) return `The Story is at most ${MAX_DEPTH} levels deep, and this would make it deeper.`;
  return null;
}

export function applyMove(tree: Arrangement, move: Move): MoveResult {
  const mockup = tree.mockups.find((m) => m.page_id === move.page);
  if (mockup) {
    if (move.parent !== null) return { ok: false, reason: "A published mockup stays among the Published mockups." };
    const i = tree.mockups.indexOf(mockup);
    // "Just before itself" means staying put: before the mockup that follows it now.
    const before = move.before === move.page ? (tree.mockups[i + 1]?.page_id ?? null) : move.before;
    return { ok: true, tree: { pages: tree.pages, mockups: placeIn(tree.mockups.filter((m) => m !== mockup), before, mockup) } };
  }
  const at = locate(tree.pages, move.page);
  if (!at) return { ok: false, reason: "That page is no longer in the Story." };
  const why = refusal(tree, move.page, move.parent);
  if (why) return { ok: false, reason: why };
  const before = move.before === move.page ? (at.siblings[at.index + 1]?.page_id ?? null) : move.before;
  return { ok: true, tree: { pages: insert(without(tree.pages, move.page), move.parent, before, at.node), mockups: tree.mockups } };
}

/** Where a page is now, as the move that would put it back there; null when it is not in the Story. */
export function positionOf(tree: Arrangement, page: string): Move | null {
  const i = tree.mockups.findIndex((m) => m.page_id === page);
  if (i >= 0) return { page, parent: null, before: tree.mockups[i + 1]?.page_id ?? null };
  const at = locate(tree.pages, page);
  if (!at) return null;
  return { page, parent: at.parent?.page_id ?? null, before: at.siblings[at.index + 1]?.page_id ?? null };
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * Alt+arrow on a page: ↑/↓ swap it with its neighbour, → nests it under the page above, ← moves it
 * out to follow its parent. Published mockups only go up and down.
 */
export function keyboardMove(tree: Arrangement, page: string, key: ArrowKey): Move | { reason: string } {
  const m = tree.mockups.findIndex((x) => x.page_id === page);
  const at = m >= 0 ? { parent: null, siblings: tree.mockups, index: m } : locate(tree.pages, page);
  if (!at) return { reason: "That page is no longer in the Story." };
  const parent = at.parent?.page_id ?? null;
  const prev = at.siblings[at.index - 1];
  const next = at.siblings[at.index + 1];
  switch (key) {
    case "ArrowUp":
      return prev ? { page, parent, before: prev.page_id } : { reason: "It is already first at this level." };
    case "ArrowDown":
      return next ? { page, parent, before: at.siblings[at.index + 2]?.page_id ?? null } : { reason: "It is already last at this level." };
    case "ArrowRight":
      if (m >= 0) return { reason: "Published mockups have no levels." };
      return prev ? { page, parent: prev.page_id, before: null } : { reason: "There is no page above it at this level to nest it under." };
    case "ArrowLeft": {
      if (m >= 0) return { reason: "Published mockups have no levels." };
      if (!at.parent) return { reason: "It is already at the top level." };
      const up = locate(tree.pages, at.parent.page_id)!;
      return { page, parent: up.parent?.page_id ?? null, before: up.siblings[up.index + 1]?.page_id ?? null };
    }
  }
}

/** Where a moved page ended up, in words: "under “Overview”, 2 of 3". */
export function describePosition(tree: Arrangement, page: string): string {
  const m = tree.mockups.findIndex((x) => x.page_id === page);
  if (m >= 0) return `among the Published mockups, ${m + 1} of ${tree.mockups.length}`;
  const at = locate(tree.pages, page);
  if (!at) return "out of the Story";
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

// ---- Shapes the Story screen reads -------------------------------------------------------------

export interface Actor {
  account_id: string;
  display_name: string;
  surface: "web" | "rest" | "mcp" | null;
  client: string | null;
}

export type RefKind = "outcomes" | "sources" | "assumptions";
export type Refs = Partial<Record<RefKind, string[]>>;

export interface ResolvedRef {
  id: string;
  title: string | null;
  status: string | null;
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
  derivation_changed?: boolean;
  quote_match?: "normalized";
}

export interface VersionView {
  version: number;
  page_id: string;
  title: string;
  summary: string;
  /** What the version draws on: absent for a reader, who reads the page without it. */
  refs?: Refs;
  resolved_refs?: Record<RefKind, ResolvedRef[]>;
  citations?: CitationView[];
  /** Set when the version shows one page of a mockup: its size, and for the team which mockup and version. */
  mockup?: MockupShown;
  published_at: string;
  published_by: Actor;
  html?: string;
}

export interface MockupShown {
  width: number;
  height: number;
  /** For an entry into the mockup version's prototype: the entry, the frame's address and the sandbox it takes. */
  entry?: string;
  prototype_url?: string;
  prototype_sandbox?: string;
  prototype_expires_at?: string;
  mockup_id?: string;
  mockup_title?: string | null;
  version?: number;
  page_id?: string;
  page_title?: string | null;
  current_version?: number | null;
  mockup_archived?: boolean;
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
  /** Absent for a reader. */
  agent_notes?: AgentNotes;
  current: VersionView;
}

export interface PageSummary {
  page_id: string;
  title: string;
  archived_at: string | null;
  etag: string;
}

export interface VersionItem {
  version: number;
  title: string;
  /** Absent for a reader. */
  citation_count?: number;
  published_at: string;
  published_by: Actor;
}
