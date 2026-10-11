import { sql } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, recordActivity } from "../common.ts";
import { json, type Db } from "../db.ts";
import { AppError, conflict, forbidden, invalid, notFound } from "../errors.ts";
import { effectiveRole, isSandboxStaff, membershipsFor, PRODUCT_ROLES, readsOnlyTheStory, readsOnlyTheStoryIn, roleAtLeast, tenantRoleAtLeast } from "../policy.ts";
import { defineOperation, type OpContext, type ProductRole, type TenantRole } from "../registry.ts";
import { visitorName } from "../public-sandbox.ts";
import { requireTenantAllowance } from "../tenant-allowance.ts";
import { expectedEtag, slug } from "../schemas.ts";
import { newEtag, newId, oneLine, quotedName, randomToken, sha256Hex, slugify } from "../util.ts";

async function uniqueSlug(exists: (s: string) => Promise<boolean>, base: string): Promise<string> {
  const root = slugify(base, 40, "product").padEnd(3, "0");
  if (!(await exists(root))) return root;
  for (let i = 2; i < 50; i++) {
    const s = `${root}-${i}`;
    if (!(await exists(s))) return s;
  }
  return `${root}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export async function uniqueTenantSlug(db: Db, name: string): Promise<string> {
  return uniqueSlug(async (s) => Boolean(await db.selectFrom("tenants").select("tenant_id").where("slug", "=", s).executeTakeFirst()), name);
}

function productView(p: {
  product_id: string;
  slug: string;
  name: string;
  concept: string;
  archived_at: string | null;
  etag: string;
  created_at: string;
  updated_at: string;
}, ctx: OpContext) {
  return {
    product_id: p.product_id,
    slug: p.slug,
    name: p.name,
    ...(readsOnlyTheStory(ctx.scope.role) ? {} : { concept: p.concept }),
    archived_at: p.archived_at,
    etag: p.etag,
    created_at: p.created_at,
    updated_at: p.updated_at,
    path: `${ctx.scope.tenant!.slug}/${ctx.scope.team!.slug}/${p.slug}`,
    tenant: ctx.scope.tenant,
    team: ctx.scope.team,
    your_role: ctx.scope.role,
  };
}

// ---- Counts -------------------------------------------------------------------------------------

interface ProductCounts {
  sources: number;
  outcomes: number;
  assumptions: number;
  mockups: number;
  story_pages: number;
}

/**
 * What each product holds, as products.get and products.list report it: archived items are left out,
 * and assumptions count only current (unconfirmed or confirmed) ones. Content tables
 * are tenant-isolated, so the caller's transaction must already be scoped to the products' tenant.
 */
async function countProducts(db: Db, productIds: string[]): Promise<Map<string, ProductCounts>> {
  const counts = new Map<string, ProductCounts>(
    productIds.map((id) => [id, { sources: 0, outcomes: 0, assumptions: 0, mockups: 0, story_pages: 0 }]),
  );
  if (!productIds.length) return counts;
  const add = (rows: { product_id: string; n: number | string | bigint }[], key: keyof ProductCounts) => {
    for (const r of rows) {
      const c = counts.get(r.product_id);
      if (c) c[key] = Number(r.n);
    }
  };
  // One transaction is one connection, so these run one after another.
  add(
    await db.selectFrom("records").select(["product_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("product_id", "in", productIds).where("archived_at", "is", null).groupBy("product_id").execute(),
    "sources",
  );
  add(
    await db.selectFrom("outcomes").select(["product_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("product_id", "in", productIds).where("status", "!=", "archived").groupBy("product_id").execute(),
    "outcomes",
  );
  add(
    await db.selectFrom("mockups").select(["product_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("product_id", "in", productIds).where("archived_at", "is", null).groupBy("product_id").execute(),
    "mockups",
  );
  add(
    await db.selectFrom("story_pages").select(["product_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("product_id", "in", productIds).where("archived_at", "is", null).groupBy("product_id").execute(),
    "story_pages",
  );
  add(
    await db.selectFrom("register_entries").select(["product_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("product_id", "in", productIds).where("kind", "=", "assumption").where("archived_at", "is", null).where("status", "in", ["unconfirmed", "confirmed"])
      .groupBy("product_id").execute(),
    "assumptions",
  );
  return counts;
}

/**
 * Each stage's count is every item the stage holds: Idea its outcomes (the concept is one field, not
 * an item), Evidence its sources, Exploration its mockups and current assumptions, and the Story its
 * live pages, which are the pages in its tree and its Published mockups.
 */
function stageCounts(c: ProductCounts) {
  return { idea: c.outcomes, evidence: c.sources, exploration: c.mockups + c.assumptions, story: c.story_pages };
}

/** What a role may count: a reader sees only how many Story pages there are, never what the evidence holds. */
function countsFor(role: ProductRole | null, c: ProductCounts) {
  return readsOnlyTheStory(role)
    ? { counts: { story_pages: c.story_pages }, stage_counts: { story: c.story_pages } }
    : { counts: c, stage_counts: stageCounts(c) };
}

// ---- Account scope ------------------------------------------------------------------------------

export const listProducts = defineOperation({
  name: "products.list",
  scope: "account",
  access: "any",
  mutates: false,
  summary: "List every product you can reach, across your tenants and teams, with your role and counts of what each holds.",
  description:
    "Start here when you do not know which product to work in. Each item has `path` (tenant/team/product slugs) and `product_id`; pass either as `product` on product-scoped calls. Confirm the product with the person before your first write in a conversation. Archived products are left out unless include_archived is true. Each item's `counts` (one number per kind) and `stage_counts` (their totals per stage) are the ones products(action=\"get\") reports. Where your_role is reader you may read only the Story: such an item has no concept and counts only story_pages. A tenant marked story_only is one where you read only the Story everywhere, so its members are not listed to you. A tenant with `sandbox: true` is a public sandbox: what is added there is seen by other visitors and erased at its next reset, so read sandbox(action=\"status\") and tell the person before writing.",
  input: z.strictObject({ include_archived: z.boolean().default(false) }),
  rest: { method: "GET", path: "/me/products" },
  mcp: { tool: "products", action: "list" },
  async handler(ctx, input) {
    const memberships = await membershipsFor(ctx.db, ctx.principal.account_id);
    if (!memberships.length) return { items: [], tenants: [] };
    const tenantIds = [...new Set(memberships.map((m) => m.tenant_id))];
    const rows = await ctx.db
      .selectFrom("products as p")
      .innerJoin("teams as tm", "tm.team_id", "p.team_id")
      .innerJoin("tenants as tn", "tn.tenant_id", "p.tenant_id")
      .select([
        "p.product_id", "p.slug", "p.name", "p.concept", "p.archived_at", "p.updated_at",
        "tm.team_id", "tm.slug as team_slug", "tm.name as team_name",
        "tn.tenant_id", "tn.slug as tenant_slug", "tn.name as tenant_name", "tn.sandbox",
      ])
      .where("p.tenant_id", "in", tenantIds)
      .orderBy("tn.name").orderBy("tm.name").orderBy("p.name")
      .execute();
    const items = rows
      .map((r) => {
        const { role } = effectiveRole(memberships, { tenant_id: r.tenant_id, team_id: r.team_id, product_id: r.product_id });
        return role
          ? {
              product_id: r.product_id,
              path: `${r.tenant_slug}/${r.team_slug}/${r.slug}`,
              name: r.name,
              ...(readsOnlyTheStory(role) ? {} : { concept: r.concept.slice(0, 300) }),
              archived_at: r.archived_at,
              updated_at: r.updated_at,
              tenant: { tenant_id: r.tenant_id, slug: r.tenant_slug, name: r.tenant_name, ...(r.sandbox ? { sandbox: true } : {}) },
              team: { team_id: r.team_id, slug: r.team_slug, name: r.team_name },
              your_role: role,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && (input.include_archived || !x.archived_at));
    // Content tables are tenant-isolated: count each tenant's products inside that tenant's scope.
    const counts = new Map<string, ProductCounts>();
    for (const tenantId of new Set(items.map((i) => i.tenant.tenant_id))) {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(ctx.db);
      const ids = items.filter((i) => i.tenant.tenant_id === tenantId).map((i) => i.product_id);
      for (const [id, c] of await countProducts(ctx.db, ids)) counts.set(id, c);
    }
    await sql`select set_config('app.tenant_id', '', true)`.execute(ctx.db);
    const tenants = await ctx.db.selectFrom("tenants").select(["tenant_id", "slug", "name", "sandbox"]).where("tenant_id", "in", tenantIds).orderBy("name").execute();
    const teams = await ctx.db.selectFrom("teams").select(["team_id", "tenant_id", "slug", "name", "archived_at"]).where("tenant_id", "in", tenantIds).orderBy("name").execute();
    return {
      items: items.map((i) => ({ ...i, ...countsFor(i.your_role, counts.get(i.product_id)!) })),
      tenants: tenants.map(({ sandbox, ...t }) => {
        const tr = memberships.find((m) => m.scope_type === "tenant" && m.scope_id === t.tenant_id)?.role ?? null;
        return {
          ...t,
          // A public sandbox: call sandbox(action="status") for its notice and limits before writing there.
          ...(sandbox ? { sandbox: true } : {}),
          // Reads only the Story everywhere here, so sees none of the organization's people.
          ...(readsOnlyTheStoryIn(memberships, t.tenant_id) ? { story_only: true } : {}),
          your_role: tr,
          teams: teams
            .filter((tm) => tm.tenant_id === t.tenant_id)
            .map((tm) => ({ ...tm, your_role: effectiveRole(memberships, { tenant_id: t.tenant_id, team_id: tm.team_id }).role }))
            .filter((tm) => tm.your_role || items.some((i) => i.team.team_id === tm.team_id)),
        };
      }),
    };
  },
});

export const createTenant = defineOperation({
  name: "products.create_tenant",
  scope: "account",
  access: "any",
  mutates: true,
  summary: "Create a tenant (an organization) with its first team; you become its owner. Needs an allowance.",
  description:
    "A tenant is the isolation boundary: nothing in it is visible to any other tenant. It starts with one team; create products in that team with products(action=\"create\"). Only an instance owner, or an account whose allowance has room, may create one; belonging to a tenant never lets anyone create one. Refused with 403 tenant_allowance otherwise: tell the person to ask whoever runs this WhatBuild.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(100),
    slug: slug.optional(),
    team_name: z.string().trim().min(1).max(100).default("Product team"),
  }),
  rest: { method: "POST", path: "/tenants" },
  mcp: { tool: "products", action: "create_tenant" },
  async handler(ctx, input) {
    await requireTenantAllowance(ctx.db, ctx.ports.config, ctx.principal);
    return createTenantWithTeam(ctx.db, ctx.actor, input);
  },
});

export async function createTenantWithTeam(
  db: Db,
  actor: OpContext["actor"],
  input: { name: string; slug?: string | undefined; team_name: string },
) {
  const tenantSlug = input.slug ?? (await uniqueTenantSlug(db, input.name));
  if (input.slug && (await db.selectFrom("tenants").select("tenant_id").where("slug", "=", input.slug).executeTakeFirst()))
    throw conflict("slug_taken", `The tenant slug "${input.slug}" is taken; choose another.`);
  const tenant_id = newId();
  const team_id = newId();
  await db.insertInto("tenants").values({ tenant_id, slug: tenantSlug, name: input.name, created_by: json(actor) }).execute();
  await db
    .insertInto("teams")
    .values({ team_id, tenant_id, slug: slugify(input.team_name, 40, "team").padEnd(3, "0"), name: input.team_name, created_by: json(actor) })
    .execute();
  await db
    .insertInto("memberships")
    .values({ membership_id: newId(), tenant_id, scope_type: "tenant", scope_id: tenant_id, account_id: actor.account_id, role: "owner", created_by: json(actor) })
    .execute();
  // The activity table is tenant-isolated: scope this transaction to the new tenant for the event.
  await sql`select set_config('app.tenant_id', ${tenant_id}, true)`.execute(db);
  await db
    .insertInto("activity")
    .values({
      activity_id: newId(), tenant_id, team_id: null, product_id: null, actor: json(actor), actor_account_id: actor.account_id,
      channel: actor.surface, action: "created", entity_type: "tenant", entity_id: tenant_id, entity_title: input.name,
      summary: `Created the tenant with team ${input.team_name}`,
    })
    .execute();
  const team = await db.selectFrom("teams").selectAll().where("team_id", "=", team_id).executeTakeFirstOrThrow();
  return {
    tenant: { tenant_id, slug: tenantSlug, name: input.name },
    team: { team_id, slug: team.slug, name: team.name },
    your_role: "owner" as TenantRole,
  };
}

// ---- Team scope ---------------------------------------------------------------------------------

export const createTeam = defineOperation({
  name: "products.create_team",
  scope: "tenant",
  access: "admin",
  mutates: true,
  summary: "Create a team in a tenant (tenant admins).",
  description: "Teams group products and share membership: a team role applies to every product in the team.",
  input: z.strictObject({ tenant: z.string().min(1), name: z.string().trim().min(1).max(100), slug: slug.optional() }),
  rest: { method: "POST", path: "/teams" },
  mcp: { tool: "products", action: "create_team" },
  async handler(ctx, input) {
    const tid = ctx.scope.tenant!.tenant_id;
    const s =
      input.slug ??
      (await uniqueSlug(async (x) => Boolean(await ctx.db.selectFrom("teams").select("team_id").where("tenant_id", "=", tid).where("slug", "=", x).executeTakeFirst()), input.name));
    if (await ctx.db.selectFrom("teams").select("team_id").where("tenant_id", "=", tid).where("slug", "=", s).executeTakeFirst())
      throw conflict("slug_taken", `A team with slug "${s}" exists in this tenant.`);
    const team_id = newId();
    await ctx.db.insertInto("teams").values({ team_id, tenant_id: tid, slug: s, name: input.name, created_by: json(ctx.actor) }).execute();
    await recordActivity(ctx, { action: "created", entity_type: "team", entity_id: team_id, entity_title: input.name, summary: "Created a team" });
    return { team_id, slug: s, name: input.name, path: `${ctx.scope.tenant!.slug}/${s}` };
  },
});

export const createProduct = defineOperation({
  name: "products.create",
  scope: "team",
  access: "admin",
  mutates: true,
  summary: "Create a product: one discovery, with its own outcomes, sources, mockups and Story (team admins).",
  description:
    "A product holds one discovery. Give it a name and its product concept: who it is for, the problem they have, and how the product solves it (Markdown, up to 2,000 characters). The concept heads the Idea screen. Returns the product with its `path`.",
  input: z.strictObject({
    tenant: z.string().min(1).describe("Tenant slug or id."),
    team: z.string().min(1).describe("Team slug or id."),
    name: z.string().trim().min(1).max(100),
    slug: slug.optional(),
    concept: z.string().max(2000).default(""),
  }),
  rest: { method: "POST", path: "/products" },
  mcp: { tool: "products", action: "create" },
  async handler(ctx, input) {
    const teamId = ctx.scope.team!.team_id;
    const exists = async (x: string) =>
      Boolean(await ctx.db.selectFrom("products").select("product_id").where("team_id", "=", teamId).where("slug", "=", x).executeTakeFirst());
    const s = input.slug ?? (await uniqueSlug(exists, input.name));
    if (input.slug && (await exists(input.slug))) throw conflict("slug_taken", `A product with slug "${s}" exists in this team.`);
    const product_id = newId();
    await ctx.db
      .insertInto("products")
      .values({
        product_id, tenant_id: ctx.scope.tenant!.tenant_id, team_id: teamId, slug: s, name: input.name, concept: input.concept,
        etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", product_id).executeTakeFirstOrThrow();
    const scoped = { ...ctx, scope: { ...ctx.scope, product: { product_id, slug: s, name: input.name, archived_at: null } } };
    await recordActivity(scoped, { action: "created", entity_type: "product", entity_id: product_id, entity_title: input.name, summary: "Created the product" });
    return productView(row, ctx);
  },
});

// ---- Product scope ------------------------------------------------------------------------------

export const getProduct = defineOperation({
  name: "products.get",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "Read a product: its concept, etag, your role, and counts of what it holds.",
  description: "Use the counts to decide where to look first. They leave out archived items, and assumptions count only current (unconfirmed or confirmed) ones, the ones assumptions(action=\"list\") returns by default. counts has one number per kind; stage_counts totals them per stage, as the web app shows them: idea (outcomes), evidence (sources), exploration (mockups and current assumptions) and story (Story pages, those in its tree and its Published mockups). The etag guards products(action=\"update\"). A reader (the Story-only role) gets no concept, and counts of Story pages only.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "" },
  mcp: { tool: "products", action: "get" },
  async handler(ctx) {
    const pid = ctx.scope.product!.product_id;
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).executeTakeFirstOrThrow();
    const counts = (await countProducts(ctx.db, [pid])).get(pid)!;
    return { ...productView(row, ctx), ...countsFor(ctx.scope.role, counts) };
  },
});

export const updateProduct = defineOperation({
  name: "products.update",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "Rename a product, change its slug, or rewrite its product concept (product admins).",
  description:
    "Pass only the fields that change, plus expected_etag. The previous product concept is kept as a revision, so an overwrite never loses text.",
  input: z.strictObject({
    expected_etag: expectedEtag,
    name: z.string().trim().min(1).max(100).optional(),
    slug: slug.optional(),
    concept: z.string().max(2000).optional(),
  }),
  rest: { method: "PATCH", path: "" },
  mcp: { tool: "products", action: "update" },
  async handler(ctx, input) {
    const pid = ctx.scope.product!.product_id;
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).forUpdate().executeTakeFirstOrThrow();
    checkEtag(input.expected_etag, row.etag, "product");
    if (input.slug && input.slug !== row.slug) {
      const taken = await ctx.db.selectFrom("products").select("product_id").where("team_id", "=", row.team_id).where("slug", "=", input.slug).executeTakeFirst();
      if (taken) throw conflict("slug_taken", `A product with slug "${input.slug}" exists in this team.`);
    }
    if (input.concept !== undefined && input.concept !== row.concept) {
      await keepRevision(ctx, "product", pid, { concept: row.concept }, row.updated_at, row.updated_by);
    }
    const changed = (["name", "slug", "concept"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (!changed.length) return productView(row, ctx);
    await ctx.db
      .updateTable("products")
      .set({
        name: input.name ?? row.name,
        slug: input.slug ?? row.slug,
        concept: input.concept ?? row.concept,
        etag: newEtag(),
        updated_at: ctx.now,
        updated_by: json(ctx.actor),
      })
      .where("product_id", "=", pid)
      .execute();
    await recordActivity(ctx, { action: "updated", entity_type: "product", entity_id: pid, entity_title: input.name ?? row.name, summary: `Changed ${changed.join(", ")}` });
    const next = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).executeTakeFirstOrThrow();
    return productView(next, { ...ctx, scope: { ...ctx.scope } });
  },
});

export const archiveProduct = defineOperation({
  name: "products.archive",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "Archive a product: hidden from lists and read-only until restored. Erases nothing.",
  description: "Archiving is reversible. While archived, writes return 409 product_archived; reads and export still work.",
  input: z.strictObject({ expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/archive" },
  mcp: { tool: "products", action: "archive" },
  async handler(ctx, input) {
    const pid = ctx.scope.product!.product_id;
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).forUpdate().executeTakeFirstOrThrow();
    checkEtag(input.expected_etag, row.etag, "product");
    await ctx.db.updateTable("products").set({ archived_at: ctx.now, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", pid).execute();
    await recordActivity(ctx, { action: "archived", entity_type: "product", entity_id: pid, entity_title: row.name, summary: "Archived the product" });
    return { product_id: pid, archived_at: ctx.now };
  },
});

export const restoreProduct = defineOperation({
  name: "products.restore",
  scope: "product",
  access: "admin",
  mutates: true,
  allowArchivedProduct: true,
  summary: "Restore an archived product.",
  description: "Returns the product to lists and makes it writable again.",
  input: z.strictObject({ expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/restore" },
  mcp: { tool: "products", action: "restore" },
  async handler(ctx, input) {
    const pid = ctx.scope.product!.product_id;
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).forUpdate().executeTakeFirstOrThrow();
    checkEtag(input.expected_etag, row.etag, "product");
    await ctx.db.updateTable("products").set({ archived_at: null, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", pid).execute();
    await recordActivity(ctx, { action: "restored", entity_type: "product", entity_id: pid, entity_title: row.name, summary: "Restored the product" });
    return { product_id: pid, archived_at: null };
  },
});

// ---- Membership ---------------------------------------------------------------------------------

const grantScope = z.strictObject({
  tenant: z.string().min(1).describe("Tenant slug or id."),
  team: z.string().optional().describe("Team slug or id: grant on this team (every product in it)."),
  product: z.string().optional().describe("Product slug (with team) or id: grant on this product only."),
});

/** The one answer for a team or product that does not exist and for one the caller has no role on, so neither tells them apart. */
const hiddenScope = (type: "team" | "product") => notFound(`No such ${type} is visible to you. It may not exist, or you may not be a member.`);

async function resolveGrantTarget(ctx: OpContext, input: { team?: string | undefined; product?: string | undefined }) {
  const tid = ctx.scope.tenant!.tenant_id;
  if (input.product) {
    let q = ctx.db.selectFrom("products").select(["product_id", "team_id", "name"]).where("tenant_id", "=", tid);
    if (input.team) {
      const team = await ctx.db.selectFrom("teams").select("team_id").where("tenant_id", "=", tid).where(sql<boolean>`(slug = ${input.team} or team_id = ${input.team})`).executeTakeFirst();
      if (!team) throw hiddenScope("product");
      q = q.where("team_id", "=", team.team_id);
    }
    const p = await q.where(sql<boolean>`(slug = ${input.product} or product_id = ${input.product})`).executeTakeFirst();
    if (!p) throw hiddenScope("product");
    return { scope_type: "product" as const, scope_id: p.product_id, team_id: p.team_id, product_id: p.product_id, name: p.name };
  }
  if (input.team) {
    const t = await ctx.db.selectFrom("teams").select(["team_id", "name"]).where("tenant_id", "=", tid).where(sql<boolean>`(slug = ${input.team} or team_id = ${input.team})`).executeTakeFirst();
    if (!t) throw hiddenScope("team");
    return { scope_type: "team" as const, scope_id: t.team_id, team_id: t.team_id, product_id: null, name: t.name };
  }
  return { scope_type: "tenant" as const, scope_id: tid, team_id: null, product_id: null, name: ctx.scope.tenant!.name };
}

async function requireAdminOf(ctx: OpContext, target: Awaited<ReturnType<typeof resolveGrantTarget>>, role: string) {
  const memberships = await membershipsFor(ctx.db, ctx.principal.account_id, ctx.scope.tenant!.tenant_id);
  const { role: eff, tenantRole } = effectiveRole(memberships, {
    tenant_id: ctx.scope.tenant!.tenant_id,
    team_id: target.team_id,
    product_id: target.product_id,
  });
  if (target.scope_type === "tenant") {
    const needed: TenantRole = role === "owner" ? "owner" : "admin";
    if (!tenantRoleAtLeast(tenantRole, needed)) throw forbidden(`Changing tenant roles needs a tenant ${needed}.`, { needed });
  } else if (!roleAtLeast(eff, "admin")) {
    // A team or product the caller has no role on does not exist for them: 404, without its name.
    if (eff === null && (target.scope_type === "product" || !(await holdsAProductIn(ctx, memberships, target.team_id!)))) throw hiddenScope(target.scope_type);
    throw forbidden(`Managing members of ${target.scope_type} ${target.name} needs admin there; you are ${eff ?? "not a member"}.`, { role: eff, needed: "admin" });
  }
}

async function holdsAProductIn(ctx: OpContext, memberships: { scope_type: string; scope_id: string }[], teamId: string): Promise<boolean> {
  const held = memberships.filter((m) => m.scope_type === "product").map((m) => m.scope_id);
  if (!held.length) return false;
  return Boolean(await ctx.db.selectFrom("products").select("product_id").where("team_id", "=", teamId).where("product_id", "in", held).executeTakeFirst());
}

/**
 * What someone who is not an owner or admin of the organization sees of its people: the teams and
 * products they read (viewer or above) and the teams those products are in, whose grants they see,
 * and the teams and products they administer, whose invitations they see.
 */
function directoryReach(
  memberships: Awaited<ReturnType<typeof membershipsFor>>,
  tenantId: string,
  teams: { team_id: string }[],
  products: { product_id: string; team_id: string }[],
) {
  const reads = { teams: new Set<string>(), products: new Set<string>() };
  const administers = { teams: new Set<string>(), products: new Set<string>() };
  for (const p of products) {
    const { role } = effectiveRole(memberships, { tenant_id: tenantId, team_id: p.team_id, product_id: p.product_id });
    if (roleAtLeast(role, "viewer")) (reads.products.add(p.product_id), reads.teams.add(p.team_id));
    if (role === "admin") administers.products.add(p.product_id);
  }
  for (const t of teams) {
    const { role } = effectiveRole(memberships, { tenant_id: tenantId, team_id: t.team_id });
    if (roleAtLeast(role, "viewer")) reads.teams.add(t.team_id);
    if (role === "admin") administers.teams.add(t.team_id);
  }
  return {
    /** A grant the caller may see. An organization role shows only beside one of these, or for an owner or admin, who reach everything. */
    shows: (type: string, sid: string, role: string) =>
      type === "tenant" ? role === "owner" || role === "admin" : type === "team" ? reads.teams.has(sid) : reads.products.has(sid),
    /** Whether the caller can cancel an invitation there. */
    manages: (type: string, sid: string) => (type === "team" ? administers.teams.has(sid) : type === "product" && administers.products.has(sid)),
  };
}

const RANK: Record<string, number> = { reader: 0, viewer: 1, editor: 2, admin: 3 };

/**
 * The name an access event gives the person it is about. In a public sandbox anyone but its staff
 * is known there only by their made-up name, so that is the one written into the log. tenantRole
 * is their organization role as it stands for the event; omitted, it is read now.
 */
async function nameInLog(ctx: OpContext, accountId: string, displayName: string, tenantRole?: string | null): Promise<string> {
  const tenant = ctx.scope.tenant!;
  if (!tenant.sandbox) return displayName;
  const role =
    tenantRole !== undefined
      ? tenantRole
      : ((await ctx.db.selectFrom("memberships").select("role").where("tenant_id", "=", tenant.tenant_id).where("scope_type", "=", "tenant").where("account_id", "=", accountId).executeTakeFirst())?.role ?? null);
  return isSandboxStaff(role as TenantRole | null) ? displayName : visitorName(tenant.tenant_id, accountId);
}

export const listMembers = defineOperation({
  name: "members.list",
  scope: "tenant",
  access: "any",
  mutates: false,
  summary: "List the tenant's members with every grant they hold, and outstanding invitations; or, with product, the people who can reach one product.",
  description:
    "Each member lists grants as {scope_type, scope, role}. Effective access is the highest role that applies. Pass product (a slug with team, or an id) to list only the people with access to that product: each then carries product_access {role, via} — via is product, team or tenant, the grant the role comes from (the broadest one when grants tie) — and grants are limited to the ones that apply to that product. Invitations are limited the same way. Owners and admins of the tenant see everyone. Anyone else sees only the people on the teams and products they read (viewer or above), with only those grants and their tenant role, and the invitations they could cancel (where they are admin); the result then says partial: true, and a product they cannot read answers 404. In a public sandbox, only its owners and admins see people: they get the organization's own members, with visitors as a count (sandbox(action=\"visitors\") lists them), and everyone else gets only themselves. Someone who reads only the Story everywhere in the tenant (a reader on its teams or products and nothing more) sees none of its people: 403.",
  input: z.strictObject({
    tenant: z.string().min(1),
    team: z.string().optional().describe("Team slug or id, to name the product by slug."),
    product: z.string().optional().describe("Product slug (with team) or id: list only the people who can reach this product."),
  }),
  rest: { method: "GET", path: "/members" },
  mcp: { tool: "members", action: "list" },
  async handler(ctx, input) {
    const tid = ctx.scope.tenant!.tenant_id;
    const me = ctx.principal.account_id;
    const mine = await membershipsFor(ctx.db, me, tid);
    if (readsOnlyTheStoryIn(mine, tid))
      throw forbidden(`You read only the Story in ${ctx.scope.tenant!.name}, so its members are not shown to you. Viewer access to one of its teams or products shows them.`, { role: "reader", needed: "viewer" });
    // In a public sandbox nobody but its staff sees another person, and its visitors are counted, not listed.
    const sandbox = Boolean(ctx.scope.tenant!.sandbox);
    const onlySelf = sandbox && !isSandboxStaff(ctx.scope.tenantRole);
    const teams = await ctx.db.selectFrom("teams").select(["team_id", "slug", "name"]).where("tenant_id", "=", tid).execute();
    const products = await ctx.db.selectFrom("products").select(["product_id", "slug", "name", "team_id"]).where("tenant_id", "=", tid).execute();
    // Below an owner or admin of the organization, a person sees only the people on what they read.
    const reach = onlySelf || tenantRoleAtLeast(ctx.scope.tenantRole, "admin") ? null : directoryReach(mine, tid, teams, products);
    let target = null;
    if (input.product && reach) {
      target = await resolveGrantTarget(ctx, { team: input.team, product: input.product }).catch(() => null);
      const role = target ? effectiveRole(mine, { tenant_id: tid, team_id: target.team_id, product_id: target.product_id }).role : null;
      if (!target || !role) throw hiddenScope("product");
      if (!roleAtLeast(role, "viewer")) throw forbidden(`You are a reader on product ${target.name}; members.list needs viewer.`, { role, needed: "viewer" });
    } else if (input.product) target = await resolveGrantTarget(ctx, { team: input.team, product: input.product });
    let people = ctx.db
      .selectFrom("memberships as m")
      .innerJoin("accounts as a", "a.account_id", "m.account_id")
      .select(["m.membership_id", "m.scope_type", "m.scope_id", "m.role", "m.created_at", "a.account_id", "a.display_name", "a.email"])
      .where("m.tenant_id", "=", tid);
    if (onlySelf) people = people.where("m.account_id", "=", ctx.principal.account_id);
    // A visitor is counted, never listed: not by their seat, and not by a role on a team or product either.
    else if (sandbox)
      people = people.where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom("memberships as v").select("v.membership_id").whereRef("v.account_id", "=", "m.account_id").where("v.tenant_id", "=", tid).where("v.scope_type", "=", "tenant").where("v.role", "=", "visitor"))),
      );
    const all = (await people.orderBy("a.display_name").execute()).map((r) => (onlySelf ? { ...r, display_name: ctx.principal.display_name, email: "" } : r));
    // A person shows when one of their grants does (and the caller always sees themselves), with
    // those grants and their organization role; nothing else of theirs.
    const shown = reach ? new Set(all.filter((r) => r.account_id === me || reach.shows(r.scope_type, r.scope_id, r.role)).map((r) => r.account_id)) : null;
    const rows = reach ? all.filter((r) => r.account_id === me || (shown!.has(r.account_id) && (r.scope_type === "tenant" || reach.shows(r.scope_type, r.scope_id, r.role)))) : all;
    const label = (type: string, sid: string) =>
      type === "tenant"
        ? { name: ctx.scope.tenant!.name, slug: ctx.scope.tenant!.slug }
        : type === "team"
          ? teams.find((t) => t.team_id === sid) ?? { name: "(removed team)", slug: "" }
          : products.find((p) => p.product_id === sid) ?? { name: "(removed product)", slug: "" };
    // With a product: only grants that reach it — its own, its team's, and tenant owner or admin.
    const applies = (type: string, sid: string, role: string) =>
      !target ||
      (type === "product" && sid === target.product_id) ||
      (type === "team" && sid === target.team_id) ||
      (type === "tenant" && (role === "owner" || role === "admin" || role === "visitor"));
    type Grant = { membership_id: string; scope_type: string; scope_id: string; scope: unknown; role: string; since: string };
    const byAccount = new Map<string, { account_id: string; display_name: string; email: string; grants: Grant[] }>();
    for (const r of rows) {
      if (!applies(r.scope_type, r.scope_id, r.role)) continue;
      const m = byAccount.get(r.account_id) ?? { account_id: r.account_id, display_name: r.display_name, email: r.email, grants: [] };
      m.grants.push({ membership_id: r.membership_id, scope_type: r.scope_type, scope_id: r.scope_id, scope: label(r.scope_type, r.scope_id), role: r.role, since: r.created_at });
      byAccount.set(r.account_id, m);
    }
    const invitations = onlySelf
      ? []
      : await ctx.db
          .selectFrom("invitations")
          .select(["invitation_id", "email", "scope_type", "scope_id", "role", "expires_at", "created_at"])
          .where("tenant_id", "=", tid)
          .where("accepted_at", "is", null)
          .where("expires_at", ">", ctx.now)
          .execute()
          // Below an owner or admin of the organization, only the invitations the caller could cancel.
          .then((all) => (reach ? all.filter((i) => reach.manages(i.scope_type, i.scope_id)) : all));
    const partial = reach ? { partial: true } : {};
    const visitors = sandbox && !onlySelf
      ? await ctx.db.selectFrom("memberships").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tid).where("scope_type", "=", "tenant").where("role", "=", "visitor").executeTakeFirst()
      : null;
    const inSandbox = sandbox ? { sandbox: { only_you: onlySelf, ...(visitors ? { visitors: Number(visitors.n) } : {}) } } : {};
    if (!target) {
      return {
        members: [...byAccount.values()],
        invitations: invitations.map((i) => ({ ...i, scope: label(i.scope_type, i.scope_id) })),
        ...partial,
        ...inSandbox,
      };
    }
    const breadth: Record<string, number> = { tenant: 3, team: 2, product: 1 };
    const members = [...byAccount.values()].map((m) => {
      let best: { role: string; via: string } | null = null;
      for (const g of m.grants) {
        const role = g.scope_type === "tenant" ? (g.role === "visitor" ? "editor" : "admin") : g.role;
        if (!best || RANK[role]! > RANK[best.role]! || (RANK[role] === RANK[best.role] && breadth[g.scope_type]! > breadth[best.via]!)) best = { role, via: g.scope_type };
      }
      return { ...m, product_access: best! };
    });
    return {
      product: { product_id: target.product_id, name: target.name, team_id: target.team_id, team: teams.find((t) => t.team_id === target.team_id)?.name ?? null },
      members,
      invitations: invitations
        .filter((i) => applies(i.scope_type, i.scope_id, i.role))
        .map((i) => ({ ...i, scope: label(i.scope_type, i.scope_id) })),
      ...partial,
      ...inSandbox,
    };
  },
});

export const grantMember = defineOperation({
  name: "members.grant",
  scope: "tenant",
  access: "any",
  mutates: true,
  summary: "Give someone a role on the tenant, a team, or a product; invites them by email if they have no account.",
  description:
    "Admins of the target grant roles there: product admins on their product, team admins on their team, tenant admins on the tenant (owners for owner). Roles: tenant owner|admin|member; team and product admin|editor|viewer|reader. A reader reads only the Story: its pages, their versions and their export, without the evidence, assumptions and mockups behind them. Granting again replaces the role at that scope. Someone without an account gets an invitation link by email, valid 7 days.",
  input: grantScope.extend({
    email: z.string().email().max(320),
    role: z.enum(["owner", "admin", "member", "editor", "viewer", "reader"]),
  }),
  rest: { method: "POST", path: "/members" },
  mcp: { tool: "members", action: "grant" },
  async handler(ctx, input) {
    const target = await resolveGrantTarget(ctx, input);
    await requireAdminOf(ctx, target, input.role);
    const allowed = target.scope_type === "tenant" ? ["owner", "admin", "member"] : PRODUCT_ROLES;
    if (!allowed.includes(input.role)) throw invalid("invalid_role", `Role ${input.role} does not apply to a ${target.scope_type}; use ${allowed.join(", ")}.`);
    const tid = ctx.scope.tenant!.tenant_id;
    const account = await ctx.db.selectFrom("accounts").select(["account_id", "display_name"]).where(sql<boolean>`lower(email) = lower(${input.email})`).where("deleted_at", "is", null).executeTakeFirst();
    if (!account) {
      const token = randomToken();
      const invitation_id = newId();
      const expires = new Date(Date.parse(ctx.now) + 7 * 86400_000).toISOString();
      await ctx.db
        .insertInto("invitations")
        .values({ invitation_id, tenant_id: tid, scope_type: target.scope_type, scope_id: target.scope_id, email: input.email, role: input.role, token_hash: sha256Hex(token), expires_at: expires, created_by: json(ctx.actor) })
        .execute();
      const link = `${ctx.ports.config.publicBaseUrl}/invite/${token}`;
      // The inviter's name is theirs to choose: in the email it is one line, quoted and bounded, so it never reads as WhatBuild's own words.
      const who = quotedName(ctx.actor.display_name);
      const where = oneLine(target.name, 100);
      await ctx.ports.mailer?.send({
        to: input.email,
        subject: `${who} invited you to ${where} on WhatBuild`,
        text:
          `${who} invited you to ${where} on WhatBuild, as ${/^[aeiou]/.test(input.role) ? "an" : "a"} ${input.role}.\n\n` +
          `Accept the invitation:\n${link}\n\n` +
          `The link works once, within 7 days, when you sign in with this email address.\n` +
          `The name in quotation marks is the one the person who invited you gave WhatBuild.\n`,
      });
      await recordActivity(ctx, { action: "invited", entity_type: "membership", entity_id: invitation_id, entity_title: target.name, summary: `Invited someone as ${input.role}` });
      // The link is returned to the inviter too, so an invitation works even where no email is sent.
      return { invited: true, invitation_id, invite_link: link, expires_at: expires, scope_type: target.scope_type, scope: target.name, role: input.role };
    }
    const existing = await ctx.db.selectFrom("memberships").select(["membership_id", "role"]).where("scope_type", "=", target.scope_type).where("scope_id", "=", target.scope_id).where("account_id", "=", account.account_id).executeTakeFirst();
    if (existing?.role === "owner" && input.role !== "owner") {
      // Only an owner changes an owner's role, as only an owner removes one.
      await requireAdminOf(ctx, target, "owner");
      const owners = await ctx.db.selectFrom("memberships").select("membership_id").where("scope_type", "=", "tenant").where("scope_id", "=", tid).where("role", "=", "owner").execute();
      if (owners.length <= 1) throw conflict("last_owner", "A tenant keeps at least one owner. Make someone else owner first.");
    }
    if (existing) await ctx.db.updateTable("memberships").set({ role: input.role }).where("membership_id", "=", existing.membership_id).execute();
    else
      await ctx.db
        .insertInto("memberships")
        .values({ membership_id: newId(), tenant_id: tid, scope_type: target.scope_type, scope_id: target.scope_id, account_id: account.account_id, role: input.role, created_by: json(ctx.actor) })
        .execute();
    await recordActivity(ctx, {
      action: existing ? "role_changed" : "granted",
      entity_type: "membership",
      entity_id: account.account_id,
      entity_title: await nameInLog(ctx, account.account_id, account.display_name),
      summary: `${existing ? "Changed role to" : "Granted"} ${input.role} on ${target.scope_type === "tenant" ? "organization" : target.scope_type} ${target.name}`,
    });
    return { invited: false, account_id: account.account_id, display_name: account.display_name, scope_type: target.scope_type, scope: target.name, role: input.role as ProductRole | TenantRole };
  },
});

export const revokeMember = defineOperation({
  name: "members.revoke",
  scope: "tenant",
  access: "any",
  mutates: true,
  summary: "Remove someone's role at one scope, or remove them from the tenant entirely. Their past writes and attribution stay.",
  description:
    "Revokes the grant at exactly the scope named. Other grants the person holds (on other teams or products) are untouched; a person whose last grant goes is no longer in the tenant. With whole_tenant, revokes every grant they hold in the tenant at once (needs tenant admin, and owner if they are an owner). A tenant keeps at least one owner.",
  input: grantScope.extend({
    account_id: z.string().min(1),
    whole_tenant: z.boolean().default(false).describe("Remove the person from the tenant: every grant they hold, on the tenant, its teams and its products. Leave team and product out."),
  }),
  rest: { method: "POST", path: "/members/revoke" },
  mcp: { tool: "members", action: "revoke" },
  async handler(ctx, input) {
    const tid = ctx.scope.tenant!.tenant_id;
    if (input.whole_tenant) {
      if (input.team || input.product) throw invalid("invalid_input", "whole_tenant removes every grant; leave team and product out.");
      const grants = await ctx.db.selectFrom("memberships").select(["membership_id", "role", "scope_type"]).where("tenant_id", "=", tid).where("account_id", "=", input.account_id).execute();
      if (!grants.length) throw notFound("That person is not in this tenant.");
      const tenantTarget = await resolveGrantTarget(ctx, {});
      await requireAdminOf(ctx, tenantTarget, grants.some((g) => g.role === "owner") ? "owner" : "admin");
      if (grants.some((g) => g.role === "owner")) {
        const owners = await ctx.db.selectFrom("memberships").select("membership_id").where("scope_type", "=", "tenant").where("scope_id", "=", tid).where("role", "=", "owner").execute();
        if (owners.length <= 1) throw conflict("last_owner", "A tenant keeps at least one owner.");
      }
      await ctx.db.deleteFrom("memberships").where("tenant_id", "=", tid).where("account_id", "=", input.account_id).execute();
      const acct = await ctx.db.selectFrom("accounts").select("display_name").where("account_id", "=", input.account_id).executeTakeFirst();
      const tenantRole = grants.find((g) => g.scope_type === "tenant")?.role ?? null;
      await recordActivity(ctx, { action: "revoked", entity_type: "membership", entity_id: input.account_id, entity_title: acct ? await nameInLog(ctx, input.account_id, acct.display_name, tenantRole) : null, summary: `Removed from ${ctx.scope.tenant!.name} (${grants.length} ${grants.length === 1 ? "role" : "roles"})` });
      return { revoked: true, account_id: input.account_id, scope_type: "tenant" as const, scope: ctx.scope.tenant!.name, removed: grants.length };
    }
    const target = await resolveGrantTarget(ctx, input);
    // Admin of the team or product first, so a non-admin learns nothing of who holds a role there.
    if (target.scope_type !== "tenant") await requireAdminOf(ctx, target, "admin");
    const m = await ctx.db.selectFrom("memberships").select(["membership_id", "role"]).where("scope_type", "=", target.scope_type).where("scope_id", "=", target.scope_id).where("account_id", "=", input.account_id).executeTakeFirst();
    if (!m) throw notFound("That person holds no role at that scope.");
    await requireAdminOf(ctx, target, m.role);
    if (m.role === "owner") {
      const owners = await ctx.db.selectFrom("memberships").select("membership_id").where("scope_type", "=", "tenant").where("scope_id", "=", ctx.scope.tenant!.tenant_id).where("role", "=", "owner").execute();
      if (owners.length <= 1) throw conflict("last_owner", "A tenant keeps at least one owner.");
    }
    await ctx.db.deleteFrom("memberships").where("membership_id", "=", m.membership_id).execute();
    const acct = await ctx.db.selectFrom("accounts").select("display_name").where("account_id", "=", input.account_id).executeTakeFirst();
    // A role removed from the organization itself was their standing until now.
    const title = acct ? await nameInLog(ctx, input.account_id, acct.display_name, target.scope_type === "tenant" ? m.role : undefined) : null;
    await recordActivity(ctx, { action: "revoked", entity_type: "membership", entity_id: input.account_id, entity_title: title, summary: `Removed ${m.role} on ${target.scope_type === "tenant" ? "organization" : target.scope_type} ${target.name}` });
    return { revoked: true, account_id: input.account_id, scope_type: target.scope_type, scope: target.name };
  },
});

export const cancelInvitation = defineOperation({
  name: "members.cancel_invitation",
  scope: "tenant",
  access: "any",
  mutates: true,
  summary: "Cancel an outstanding invitation.",
  description: "The invitation link stops working at once.",
  input: z.strictObject({ tenant: z.string().min(1), invitation_id: z.string().min(1) }),
  rest: { method: "POST", path: "/invitations/cancel" },
  mcp: { tool: "members", action: "cancel_invitation" },
  async handler(ctx, input) {
    const inv = await ctx.db.selectFrom("invitations").selectAll().where("invitation_id", "=", input.invitation_id).where("tenant_id", "=", ctx.scope.tenant!.tenant_id).executeTakeFirst();
    if (!inv || inv.accepted_at) throw notFound("No such outstanding invitation.");
    let teamId: string | null = inv.scope_type === "team" ? inv.scope_id : null;
    if (inv.scope_type === "product") {
      const p = await ctx.db.selectFrom("products").select("team_id").where("product_id", "=", inv.scope_id).executeTakeFirst();
      teamId = p?.team_id ?? null;
    }
    const target = { scope_type: inv.scope_type, scope_id: inv.scope_id, team_id: teamId, product_id: inv.scope_type === "product" ? inv.scope_id : null, name: inv.scope_type as string } as Awaited<ReturnType<typeof resolveGrantTarget>>;
    await requireAdminOf(ctx, target, inv.role);
    await ctx.db.updateTable("invitations").set({ expires_at: ctx.now }).where("invitation_id", "=", inv.invitation_id).execute();
    await recordActivity(ctx, { action: "invitation_cancelled", entity_type: "membership", entity_id: inv.invitation_id, entity_title: null, summary: "Cancelled an invitation" });
    return { cancelled: true };
  },
});

/** The sandbox's events that change who may come in: its invitations, a visitor's removal, and its settings. */
const SANDBOX_ACCESS_ACTIONS = ["invited", "invitation_cancelled", "revoked", "updated"];

export const listAccessActivity = defineOperation({
  name: "members.activity",
  scope: "tenant",
  access: "admin",
  mutates: false,
  summary: "Who gave, changed or removed whose access in the organization, and when: newest first (tenant admins).",
  description:
    "The organization's access log: roles given, changed and removed, people removed from the organization, invitations sent, accepted and cancelled, and in a public sandbox its invitation links, removed visitors and changed settings. A product's activity.list leaves these out, because they belong to the organization. Entries name the person and the scope and never an email address; a sandbox visitor appears under their made-up name. Filters: actor (account id), since (ISO 8601).",
  input: z.strictObject({
    tenant: z.string().min(1),
    actor: z.string().max(100).optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/members/activity" },
  mcp: { tool: "members", action: "activity" },
  async handler(ctx, input) {
    let q = ctx.db
      .selectFrom("activity")
      .selectAll()
      .where("tenant_id", "=", ctx.scope.tenant!.tenant_id)
      .where((eb) => eb.or([eb("entity_type", "=", "membership"), eb.and([eb("entity_type", "=", "sandbox"), eb("action", "in", SANDBOX_ACCESS_ACTIONS)])]));
    if (input.actor) q = q.where("actor_account_id", "=", input.actor);
    if (input.since) q = q.where(sql<boolean>`occurred_at >= ${input.since}::timestamptz`);
    if (input.cursor) q = q.where("activity_id", "<", input.cursor);
    const rows = await q.orderBy("activity_id", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map((r) => ({
      activity_id: r.activity_id,
      occurred_at: r.occurred_at,
      actor: r.actor,
      channel: r.channel,
      through_agent: r.channel === "mcp",
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      entity_title: r.entity_title,
      summary: r.summary,
    }));
    return { items, next_cursor: rows.length > input.limit ? items[items.length - 1]!.activity_id : null };
  },
});

export const productOps = [
  listProducts, createTenant, createTeam, createProduct, getProduct, updateProduct, archiveProduct, restoreProduct,
  listMembers, grantMember, revokeMember, cancelInvitation, listAccessActivity,
];
