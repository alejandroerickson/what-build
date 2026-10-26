import type { z } from "zod";
import type { ActorSnapshot, Tx } from "./db.ts";
import type { Ports } from "./ports.ts";
import type { LimitContext, Plan } from "./limits.ts";

/** `reader` reads only the Story: its pages, their versions and their export. */
export type ProductRole = "reader" | "viewer" | "editor" | "admin";
/**
 * `guest` exists only in the example organization: a viewer of every product there, which every
 * account without a grant there holds. It is never stored, and it writes nothing.
 */
export type TenantRole = "guest" | "member" | "admin" | "owner";
/**
 * A role on a product or a team as answers report it (`your_role`): a guest of the example
 * organization is `guest` there, though everything it may do is decided as a viewer's.
 */
export type ReportedRole = ProductRole | "guest";
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
  /** An agent's connection level; absent for a person in the web app, who acts with their own role. */
  level?: ConnectionLevel;
  /** An agent's connection (its OAuth token family); absent for a person in the web app. */
  connection?: string;
  /** False when the person turned off submit_feedback for this agent's connection. */
  feedback?: boolean;
}

export interface TenantRef {
  tenant_id: string;
  slug: string;
  name: string;
  /** The organization is the example organization every account reads. */
  example?: boolean;
  /** The organization's plan, which decides whether anyone in it meets limits. */
  plan?: Plan;
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
   * The limits the call meets; null where it meets none. Absent when the caller did not come
   * through `execute` (the upload relay).
   */
  limits?: LimitContext | null;
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
  limits: LimitContext | null;
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
   * A tenant operation an owner of this WhatBuild instance may call in any organization, as one of
   * its owners, whether or not they belong to it: renaming an organization.
   */
  allowInstanceOwners?: boolean;
  /**
   * Only an owner of this WhatBuild instance may call it, which its handler checks: the
   * allowances to start organizations, every organization's plan, every account, the usage. An
   * agent's tool list leaves it out for anyone else, whose call its handler refuses.
   */
  instanceOwnersOnly?: boolean;
  /**
   * For an organization's operation anyone in it may call (`access: "any"`) whose handler checks a
   * role where the call points: the least role it needs, which the caller must hold somewhere in
   * the organization. Seeing its people needs viewer, managing them admin. A connector scoped to
   * the organization lists it only to someone who holds that role there.
   */
  needsSomewhere?: ProductRole;
  /**
   * Starting an organization: only an instance owner, or an account whose allowance has room, may
   * call it, which its handler checks. The unscoped connector's tool list leaves it out for anyone
   * else, whose call its handler refuses.
   */
  needsTenantAllowance?: boolean;
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

