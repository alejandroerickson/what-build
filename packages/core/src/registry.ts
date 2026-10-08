import type { z } from "zod";
import type { ActorSnapshot, Tx } from "./db.ts";
import type { Ports } from "./ports.ts";
import type { SandboxContext } from "./public-sandbox.ts";

/** `reader` reads only the Story: its pages, their versions and their export. */
export type ProductRole = "reader" | "viewer" | "editor" | "admin";
/** `visitor` exists only in a public sandbox: an editor of every product there, and nothing more. */
export type TenantRole = "visitor" | "member" | "admin" | "owner";

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

export type OpScope = "product" | "team" | "tenant" | "account";
/** `story`: a Story read, open to readers; `read`: everything else a viewer may read. */
export type OpAccess = "story" | "read" | "write" | "admin" | "owner" | "any";

export interface OperationDef<I extends z.ZodType = z.ZodType, O = unknown> {
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
  /** Writes allowed while the product is archived (only restore). */
  allowArchivedProduct?: boolean;
  /**
   * Runs alone in a public sandbox: it waits for every call in progress there, and holds new ones
   * until it commits. For saving a baseline and resetting to one.
   */
  exclusive?: boolean;
  handler: (ctx: OpContext, input: z.output<I>) => Promise<O>;
}

export function defineOperation<I extends z.ZodType, O>(def: OperationDef<I, O>): OperationDef<I, O> {
  return def;
}

