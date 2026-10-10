/**
 * The Story tree as data: where a page sits and what the panel shows. Agents arrange the tree;
 * the app only reads it.
 */

/** The server's limit on a product's Story pages (story.publish), archived pages included. */
export const MAX_PAGES = 50;

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

export function split(h: Hierarchy): Arrangement {
  const un = new Set(h.unplaced);
  return { placed: h.items.filter((n) => !un.has(n.page_id)), unplaced: h.items.filter((n) => un.has(n.page_id)) };
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
}

export interface VersionItem {
  version: number;
  title: string;
  /** Absent for a reader. */
  citation_count?: number;
  published_at: string;
  published_by: Actor;
}
