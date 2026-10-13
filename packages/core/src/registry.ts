import type { z } from "zod";
import type { ActorSnapshot, Tx } from "./db.ts";
import type { Ports } from "./ports.ts";
import type { SandboxContext } from "./public-sandbox.ts";

/** `reader` reads only the Story: its pages, their versions and their export. */
export type ProductRole = "reader" | "viewer" | "editor" | "admin";
/** `visitor` exists only in a public sandbox: an editor of every product there, and nothing more. */
export type TenantRole = "visitor" | "member" | "admin" | "owner";
/**
 * What an agent's connection may do, chosen by the person when they connect it: the most it does,
 * whatever their own role. `viewer` reads, `editor` also writes and archives, `admin` also deletes
 * permanently and manages products and people. It never adds to the person's own role.
 */
export type ConnectionLevel = "viewer" | "editor" | "admin";

/** The authenticated caller. No input field can set or alter it. */
export interface Principal {
  account_id: string;
  email: string;
  display_name: string;
  auth_kind: "session" | "oauth" | "upload_grant" | "system" | "dev";
  surface: "web" | "rest" | "mcp" | null;
  client: string | null;
  /** The account was created on a sandbox invitation alone, so the sandbox's limits follow it everywhere. */
  sandbox_only?: boolean;
  /** An agent's connection level; absent for a person in the web app, who acts with their own role. */
  level?: ConnectionLevel;
}

export interface TenantRef {
  tenant_id: string;
  slug: string;
  name: string;
  /** The organization is a public sandbox. */
  sandbox?: boolean;
}
export interface TeamRef {
  team_id: string;
  slug: string;
  name: string;
}
export interface ProductRef {
  product_id: string;
  slug: string;
  name: string;
  archived_at: string | null;
}

/** Where a call lands and what the caller may do there. Resolved before any handler runs. */
export interface Scope {
  tenant: TenantRef | null;
  team: TeamRef | null;
  product: ProductRef | null;
  /** The effective content role at the addressed team or product (tenant admins are admins everywhere). */
  role: ProductRole | null;
  tenantRole: TenantRole | null;
}

export interface OpContext {
  principal: Principal;
  actor: ActorSnapshot;
  /** A transaction already scoped to the addressed tenant (row-level security is set on it). */
  db: Tx;
  scope: Scope;
  ports: Ports;
  /**
   * The public sandbox the call is in, with the caller's place in it; null anywhere else. Absent
   * when the caller did not come through `execute` (the upload relay), which then looks it up.
   */
  sandbox?: SandboxContext | null;
  /** Request time, ISO 8601 UTC. */
  now: string;
  /** Queue background work in this transaction; the worker wakes after commit. */
  enqueue(kind: string, payload: Record<string, unknown>): Promise<void>;
}

/** What an operation's `prepare` step has: the authorized call, and no database connection of its own. */
export interface PrepareContext {
  principal: Principal;
  scope: Scope;
  ports: Ports;
  sandbox: SandboxContext | null;
  now: string;
  /** Run checks in a short read-only transaction of their own, scoped to the tenant as the handler's is. */
  read<T>(fn: (ctx: OpContext) => Promise<T>): Promise<T>;
}

export type OpScope = "product" | "team" | "tenant" | "account";
/** `story`: a Story read, open to readers; `read`: everything else a viewer may read. */
export type OpAccess = "story" | "read" | "write" | "admin" | "owner" | "any";

export interface OperationDef<I extends z.ZodType = z.ZodType, O = unknown, P = unknown> {
  /** `<group>.<action>`. The MCP tool and action default to the two halves. */
  name: string;
  scope: OpScope;
  access: OpAccess;
  /** Whether the operation changes stored state (it then writes an activity event). */
  mutates: boolean;
  /** One line, shown in the tool's action list. */
  summary: string;
  /** Guidance returned by `describe`: when to use it, what it returns, pitfalls. */
  description: string;
  input: I;
  rest: { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; path: string };
  /** The MCP tool and action. A tool with no action is a standalone tool. */
  mcp: { tool: string; action?: string };
  /** Writes allowed while the product is archived (restore, and deleting the product). */
  allowArchivedProduct?: boolean;
  /**
   * The connection level an agent needs to call it, when its access alone does not say: by default
   * `admin` and `owner` need admin, `write` and any other write need editor, and reads need viewer.
   */
  connection?: ConnectionLevel;
  /** Offered only to a person in the web app, never to an agent: closing an organization. */
  webOnly?: boolean;
  /**
   * Runs alone in a public sandbox: it waits for every call in progress there, and holds new ones
   * until it commits. For saving a baseline and resetting to one.
   */
  exclusive?: boolean;
  /**
   * Slow work that must hold no database connection, such as a download. It runs once the call is
   * authorized and its input valid, outside any transaction, and what it returns reaches the
   * handler as `prepared`.
   */
  prepare?: (ctx: PrepareContext, input: z.output<I>) => Promise<P>;
  handler: (ctx: OpContext, input: z.output<I>, ...prepared: undefined extends P ? [prepared?: P] : [prepared: P]) => Promise<O>;
}

const LEVEL_RANK: Record<ConnectionLevel, number> = { viewer: 0, editor: 1, admin: 2 };

/** A connection level as the person chose it. */
export const LEVEL_NAMES: Record<ConnectionLevel, string> = { viewer: "Read only", editor: "Edit", admin: "Admin" };

/** The connection level an operation needs. */
export function connectionNeeds(op: Pick<OperationDef, "access" | "mutates" | "connection">): ConnectionLevel {
  if (op.connection) return op.connection;
  if (op.access === "admin" || op.access === "owner") return "admin";
  if (op.access === "write" || (op.access === "any" && op.mutates)) return "editor";
  return "viewer";
}

/** Whether a connection at `level` may call the operation. A person in the web app has no level and may call anything their role allows. */
export function levelAllows(level: ConnectionLevel | undefined, op: Pick<OperationDef, "access" | "mutates" | "connection" | "webOnly">): boolean {
  if (!level) return true;
  if (op.webOnly) return false;
  return LEVEL_RANK[level] >= LEVEL_RANK[connectionNeeds(op)];
}

/** The lower of a role and a connection level: what an agent may do where the person holds `role`. */
export function capRole(role: ProductRole | null, level: ConnectionLevel | undefined): ProductRole | null {
  if (!level || !role || role === "reader") return role;
  const rank: Record<ProductRole, number> = { reader: -1, viewer: 0, editor: 1, admin: 2 };
  return rank[role] <= LEVEL_RANK[level] ? role : level;
}

export function defineOperation<I extends z.ZodType, O, P = undefined>(def: OperationDef<I, O, P>): OperationDef<I, O, P> {
  return def;
}

