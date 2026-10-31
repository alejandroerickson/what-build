import { sql } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, recordActivity } from "../common.ts";
import { json, type Db } from "../db.ts";
import { AppError, conflict, forbidden, invalid, notFound } from "../errors.ts";
import { effectiveRole, membershipsFor, PRODUCT_ROLES, readsOnlyTheStory, readsOnlyTheStoryIn, reportedRole, roleAtLeast, tenantRoleAtLeast } from "../policy.ts";
import { capRole, defineOperation, type OpContext, type ProductRole, type ReportedRole, type TenantRole } from "../registry.ts";
import { checkMembers, type Plan } from "../limits.ts";
import { isInstanceOwner, requireTenantAllowance } from "../tenant-allowance.ts";
import { expectedEtag, slug } from "../schemas.ts";
import { newEtag, newId, oneLine, quotedName, randomToken, sha256Hex, slugify } from "../util.ts";
import { adviseIdeaCard, CARD_HTML_MAX, checkCardSides, checkIdeaCard } from "../idea-card.ts";

async function uniqueSlug(exists: (s: string) => Promise<boolean>, base: string): Promise<string> {
  const root = slugify(base, 40, "product").padEnd(3, "0");
  if (!(await exists(root))) return root;
  for (let i = 2; i < 50; i++) {
    const s = `${root}-${i}`;
    if (!(await exists(s))) return s;
  }
  return `${root}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/**
 * A tenant's slug is unique across every slug any tenant holds or held, so an address written with
 * one never leads into another organization. What changes them takes this lock first, for the
 * transaction, so two changes at once cannot take the same slug.
 */
async function lockTenantSlugs(db: Db): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext('whatbuild.tenant_slugs'))`.execute(db);
}

/** The tenant that holds the slug, or held it before, if any. */
async function slugHolder(db: Db, s: string): Promise<string | null> {
  const r = await db
    .selectFrom("tenants")
    .select("tenant_id")
    .where("slug", "=", s)
    .union(db.selectFrom("tenant_slugs").select("tenant_id").where("slug", "=", s))
    .executeTakeFirst();
  return r?.tenant_id ?? null;
}

export async function uniqueTenantSlug(db: Db, name: string): Promise<string> {
  return uniqueSlug(async (s) => Boolean(await slugHolder(db, s)), name);
}

/** Each tenant's former slugs, oldest first. */
async function formerSlugs(db: Db, tenantIds: string[]): Promise<Map<string, string[]>> {
  const rows = tenantIds.length ? await db.selectFrom("tenant_slugs").select(["tenant_id", "slug"]).where("tenant_id", "in", tenantIds).orderBy("retired_at").execute() : [];
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.tenant_id, [...(out.get(r.tenant_id) ?? []), r.slug]);
  return out;
}

/** The most characters the product concept's back holds. */
const CONCEPT_MAX = 8000;

/** What a product concept is, said once for every operation that writes one. */
const WHAT_A_CONCEPT_IS =
  "The product concept is a card at the head of the Idea screen, with two sides you write together. card_html is the front, which people see first: a picture of the product's promise, to whom, and what changes for them, that someone new to the team takes in at a glance, drawn with the card kit; call outcomes_read(action=\"card_guidance\") before drawing one, and outcomes_read(action=\"card_preview\", kind=\"concept\") to look at it before writing it. " +
  "concept is the back: who the product is for, the problem they have, and how the product solves it, in depth (Markdown, up to 8,000 characters), which agents read first and people open with More info. " +
  "A call that changes one side sends the other too, unchanged if it still agrees; one that sends only one side is refused with card_sides_together.";

/** Advice on the concept's card, when a write touched it. */
function conceptAdvice(row: { concept: string; card_html: string }) {
  const card_advice = adviseIdeaCard({ kind: "concept", front: row.card_html, back: row.concept });
  return card_advice.length ? { card_advice } : {};
}

function productView(p: {
  product_id: string;
  slug: string;
  name: string;
  concept: string;
  card_html: string;
  archived_at: string | null;
  etag: string;
  created_at: string;
  updated_at: string;
}, ctx: OpContext, includeCard = false) {
  return {
    product_id: p.product_id,
    slug: p.slug,
    name: p.name,
    ...(readsOnlyTheStory(ctx.scope.role) ? {} : { concept: p.concept, card_chars: p.card_html.length, ...(includeCard ? { card_html: p.card_html } : {}) }),
    archived_at: p.archived_at,
    etag: p.etag,
    created_at: p.created_at,
    updated_at: p.updated_at,
    path: `${ctx.scope.tenant!.slug}/${ctx.scope.team!.slug}/${p.slug}`,
    tenant: ctx.scope.tenant,
    team: ctx.scope.team,
    your_role: reportedRole(ctx.scope.role, ctx.scope.tenantRole),
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
      .where("product_id", "in", productIds).where("archived_at", "is", null).groupBy("product_id").execute(),
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
 * live pages, which are the pages in its tree.
 */
function stageCounts(c: ProductCounts) {
  return { idea: c.outcomes, evidence: c.sources, exploration: c.mockups + c.assumptions, story: c.story_pages };
}

/** What a role may count: a reader sees only how many Story pages there are, never what the evidence holds. */
function countsFor(role: ReportedRole | null, c: ProductCounts) {
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
    "Start here when you do not know which product to work in. Each item has `path` (tenant/team/product slugs) and `product_id`; pass either as `product` on product-scoped calls. Confirm the product with the person before your first write in a conversation. Archived products are left out unless include_archived is true. Each item's `counts` (one number per kind) and `stage_counts` (their totals per stage) are the ones products_read(action=\"get\") reports. Through an agent, your_role is the person's role capped by the connection's level, which connection_level gives (viewer reads, editor also writes and archives, admin also deletes permanently and manages products and people). Where your_role is reader you may read only the Story: such an item has no concept and counts only story_pages. A tenant's your_role is your role in the organization itself: owner, admin, or member for someone whose roles are on its teams and products only (guest in the example organization). A tenant marked story_only is one where you read only the Story everywhere, so its members are not listed to you. A tenant with `example: true` is the example organization: a worked example that every account reads, as its guest (your_role guest, viewer on every product), and that nobody but its authors changes, so every write there is refused with 403 example_read_only. Read it to learn how a discovery is done; do the person's own work in an organization of theirs. A tenant's plan is one this WhatBuild defines, whose limits everyone in it meets (products_read(action=\"limits\") lists them with what is used today), or unlimited, which sets none. A tenant with read_only is one that went back to the plan new organizations start on while whoever started it already had one there: everyone in it may read, export, delete and take people out, as their roles allow, and every other write is refused (409 organization_read_only) until it moves to another plan; it is kept until kept_until. A tenant's name_etag guards its name and slug, which its owners change in the web app; former_slugs, when present, are slugs it had before, which still reach it.",
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
        "tn.tenant_id", "tn.slug as tenant_slug", "tn.name as tenant_name", "tn.example",
      ])
      .where("p.tenant_id", "in", tenantIds)
      .orderBy("tn.name").orderBy("tm.name").orderBy("p.name")
      .execute();
    const items = rows
      .map((r) => {
        // Through an agent, the role is what its connection lets it do there.
        const held = effectiveRole(memberships, { tenant_id: r.tenant_id, team_id: r.team_id, product_id: r.product_id });
        const role = capRole(held.role, ctx.principal.level);
        return role
          ? {
              product_id: r.product_id,
              path: `${r.tenant_slug}/${r.team_slug}/${r.slug}`,
              name: r.name,
              ...(readsOnlyTheStory(role) ? {} : { concept: r.concept.slice(0, 300) }),
              archived_at: r.archived_at,
              updated_at: r.updated_at,
              tenant: { tenant_id: r.tenant_id, slug: r.tenant_slug, name: r.tenant_name, ...(r.example ? { example: true } : {}) },
              team: { team_id: r.team_id, slug: r.team_slug, name: r.team_name },
              your_role: reportedRole(role, held.tenantRole),
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
    const tenants = await ctx.db
      .selectFrom("tenants")
      .select(["tenant_id", "slug", "name", "name_etag", "example", "plan", "read_only_since", "kept_until"])
      .where("tenant_id", "in", tenantIds)
      .orderBy("name")
      .execute();
    const teams = await ctx.db.selectFrom("teams").select(["team_id", "tenant_id", "slug", "name", "archived_at"]).where("tenant_id", "in", tenantIds).orderBy("name").execute();
    const former = await formerSlugs(ctx.db, tenantIds);
    return {
      ...(ctx.principal.level ? { connection_level: ctx.principal.level } : {}),
      items: items.map((i) => ({ ...i, ...countsFor(i.your_role, counts.get(i.product_id)!) })),
      tenants: tenants.map(({ example, read_only_since, kept_until, ...t }) => {
        // Everyone with a role in the organization is in it: someone whose roles are on its teams and products only is a member, as the Members page says.
        const tr = memberships.find((m) => m.scope_type === "tenant" && m.scope_id === t.tenant_id)?.role ?? "member";
        return {
          ...t,
          // Back on the starting plan while its creator has another there: read, exported, deleted from and left, kept until kept_until, added to by nobody.
          ...(read_only_since ? { read_only: { since: read_only_since, kept_until } } : {}),
          // The example organization: read by everyone, changed by nobody but its members.
          ...(example ? { example: true } : {}),
          // Addresses written before its slug changed still name it.
          ...(former.has(t.tenant_id) ? { former_slugs: former.get(t.tenant_id)! } : {}),
          // Reads only the Story everywhere here, so sees none of the organization's people.
          ...(readsOnlyTheStoryIn(memberships, t.tenant_id) ? { story_only: true } : {}),
          your_role: tr,
          teams: teams
            .filter((tm) => tm.tenant_id === t.tenant_id)
            .map((tm) => {
              const held = effectiveRole(memberships, { tenant_id: t.tenant_id, team_id: tm.team_id });
              return { ...tm, your_role: reportedRole(capRole(held.role, ctx.principal.level), held.tenantRole) };
            })
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
  connection: "admin",
  needsTenantAllowance: true,
  summary: "Create a tenant (an organization) with its first team; you become its owner. Needs an allowance.",
  description:
    "A tenant is the isolation boundary: nothing in it is visible to any other tenant. It starts with one team; create products in that team with products_write(action=\"create\"). Only an instance owner, or an account whose allowance has room, may create one; belonging to a tenant never lets anyone create one. Refused with 403 tenant_allowance otherwise; whoever runs this WhatBuild grants allowances. An organization an instance owner creates is unlimited; one created on an allowance gets the plan this deployment gives new organizations, which may be the free plan, whose limits everyone in it meets (products_read(action=\"limits\")); plan in the answer says which.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(100),
    slug: slug.optional(),
    team_name: z.string().trim().min(1).max(100).default("Product team"),
  }),
  rest: { method: "POST", path: "/tenants" },
  mcp: { tool: "products", action: "create_tenant" },
  async handler(ctx, input) {
    await requireTenantAllowance(ctx.db, ctx.ports.config, ctx.principal);
    // Whoever runs the instance decides what organizations cost it: theirs are unlimited, everyone
    // else's on the plan the deployment names (WHATBUILD_NEW_ORGANIZATION_PLAN), unlimited unless it says free.
    const plan = isInstanceOwner(ctx.ports.config, ctx.principal.email) ? "unlimited" : (ctx.ports.config.newOrganizationPlan ?? "unlimited");
    return createTenantWithTeam(ctx.db, ctx.actor, { ...input, plan });
  },
});

export async function createTenantWithTeam(
  db: Db,
  actor: OpContext["actor"],
  input: { name: string; slug?: string | undefined; team_name: string; plan?: Plan },
) {
  await lockTenantSlugs(db);
  const tenantSlug = input.slug ?? (await uniqueTenantSlug(db, input.name));
  if (input.slug && (await slugHolder(db, input.slug)))
    throw conflict("slug_taken", `The tenant slug "${input.slug}" is taken, by an organization that has it or had it before; choose another.`);
  const tenant_id = newId();
  const team_id = newId();
  const plan: Plan = input.plan ?? "unlimited";
  const name_etag = newEtag();
  await db.insertInto("tenants").values({ tenant_id, slug: tenantSlug, name: input.name, name_etag, plan, created_by: json(actor) }).execute();
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
    tenant: { tenant_id, slug: tenantSlug, name: input.name, name_etag, plan },
    team: { team_id, slug: team.slug, name: team.name },
    your_role: "owner" as TenantRole,
  };
}

export const renameTenant = defineOperation({
  name: "products.rename_tenant",
  scope: "tenant",
  access: "owner",
  mutates: true,
  allowInstanceOwners: true,
  webOnly: "a person does it in the web app: one of its owners under Organization name on its Members page (`/t/<organization>/members`), or an owner of this WhatBuild with Rename on Organizations (`/instance`)",
  summary: "Rename an organization, change its slug, or both (its owners, and the instance's owners, in the web app).",
  description:
    "A person's act in the web app, never an agent's. Pass only what changes, name or slug, with expected_etag: the tenant's name_etag. " +
    "A new slug changes the first part of every product's path (acme/core/onboarding becomes acme-labs/core/onboarding). The old slug keeps working everywhere: products.list lists it in the tenant's former_slugs, calls that name it reach the organization, a connector scoped to it keeps working, and the web app takes an address with it to the new one. " +
    "A slug another organization has, or had before, is refused with 409 slug_taken. Taking back one of its own former slugs is allowed. " +
    "The example organization's owners rename it as any owners do. The change is in the organization's access log, members.activity.",
  input: z.strictObject({
    tenant: z.string().min(1).describe("Tenant slug or id."),
    name: z.string().trim().min(1).max(100).optional(),
    slug: slug.optional().describe("The new slug: 3 to 50 lower-case letters, digits and hyphens."),
    expected_etag: expectedEtag,
  }),
  rest: { method: "PATCH", path: "" },
  mcp: { tool: "products", action: "rename_tenant" },
  async handler(ctx, input) {
    if (input.name === undefined && input.slug === undefined) throw invalid("invalid_input", "Pass name, slug or both: what the organization is to be called. Nothing was changed.");
    const tid = ctx.scope.tenant!.tenant_id;
    if (input.slug !== undefined) await lockTenantSlugs(ctx.db);
    const row = await ctx.db.selectFrom("tenants").select(["slug", "name", "name_etag"]).where("tenant_id", "=", tid).forUpdate().executeTakeFirstOrThrow();
    checkEtag(input.expected_etag, row.name_etag, "organization's name");
    const name = input.name ?? row.name;
    const to = input.slug ?? row.slug;
    const renamed = name !== row.name;
    const moved = to !== row.slug;
    const view = async (etag: string) => ({ tenant_id: tid, slug: to, name, name_etag: etag, former_slugs: (await formerSlugs(ctx.db, [tid])).get(tid) ?? [] });
    if (!renamed && !moved) return view(row.name_etag);
    if (moved) {
      const holder = await slugHolder(ctx.db, to);
      if (holder && holder !== tid)
        throw conflict("slug_taken", `The slug "${to}" is taken, by an organization that has it or had it before, where its old links still lead. Choose another. Nothing was changed.`);
      // Taking back a slug it had before: it is its current one again.
      await ctx.db.deleteFrom("tenant_slugs").where("slug", "=", to).execute();
      await ctx.db.insertInto("tenant_slugs").values({ slug: row.slug, tenant_id: tid, retired_by: json(ctx.actor) }).execute();
    }
    const name_etag = newEtag();
    await ctx.db.updateTable("tenants").set({ name, slug: to, name_etag }).where("tenant_id", "=", tid).execute();
    const said = [renamed ? `Formerly ${row.name}` : "", moved ? `short name in links was ${row.slug}, now ${to}` : ""].filter(Boolean).join("; ");
    await recordActivity(ctx, {
      action: renamed ? "renamed" : "slug_changed",
      entity_type: "tenant",
      entity_id: tid,
      entity_title: name,
      summary: said.charAt(0).toUpperCase() + said.slice(1),
    });
    return { ...(await view(name_etag)), ...(renamed ? { previous_name: row.name } : {}), ...(moved ? { previous_slug: row.slug } : {}) };
  },
});

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
    `A product holds one discovery. Give it a name and, when you know it, its product concept, which heads the Idea screen. ${WHAT_A_CONCEPT_IS} Returns the product with its \`path\`.`,
  input: z.strictObject({
    tenant: z.string().min(1).describe("Tenant slug or id."),
    team: z.string().min(1).describe("Team slug or id."),
    name: z.string().trim().min(1).max(100),
    slug: slug.optional(),
    concept: z.string().max(CONCEPT_MAX).default("").describe("The back of the concept's card, which agents read first: Markdown."),
    card_html: z.string().max(CARD_HTML_MAX).default("").describe("The front of the concept's card, the picture people see first: HTML in the card kit (outcomes_read(action=\"card_guidance\"))."),
  }),
  rest: { method: "POST", path: "/products" },
  mcp: { tool: "products", action: "create" },
  async handler(ctx, input) {
    checkIdeaCard(input.card_html, "The product concept");
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
        card_html: input.card_html, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", product_id).executeTakeFirstOrThrow();
    const scoped = { ...ctx, scope: { ...ctx.scope, product: { product_id, slug: s, name: input.name, archived_at: null } } };
    await recordActivity(scoped, { action: "created", entity_type: "product", entity_id: product_id, entity_title: input.name, summary: "Created the product" });
    return { ...productView(row, ctx), ...conceptAdvice(row) };
  },
});

// ---- Product scope ------------------------------------------------------------------------------

export const getProduct = defineOperation({
  name: "products.get",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "Read a product: its concept, etag, your role, and counts of what it holds.",
  description: "concept is the back of the product concept's card, the text agents read; include_card adds card_html, its front, the picture people see first (card_chars says how long it is, 0 when there is none). Read both before changing either. Use the counts to decide where to look first. They leave out archived items, and assumptions count only current (unconfirmed or confirmed) ones, the ones assumptions_read(action=\"list\") returns by default. counts has one number per kind; stage_counts totals them per stage, as the web app shows them: idea (outcomes), evidence (sources), exploration (mockups and current assumptions) and story (Story pages, of every kind). The etag guards products_write(action=\"update\") and (action=\"update_concept\"). A reader (the Story-only role) gets no concept, and counts of Story pages only.",
  input: z.strictObject({
    include_card: z.boolean().default(false).describe("Include card_html, the front of the concept's card."),
  }),
  rest: { method: "GET", path: "" },
  mcp: { tool: "products", action: "get" },
  async handler(ctx, input) {
    const pid = ctx.scope.product!.product_id;
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).executeTakeFirstOrThrow();
    const counts = (await countProducts(ctx.db, [pid])).get(pid)!;
    // A concept with no front yet, for whoever can draw it.
    const bare = roleAtLeast(ctx.scope.role, "editor") && !row.card_html && row.concept.trim();
    return {
      ...productView(row, ctx, input.include_card),
      ...countsFor(ctx.scope.role, counts),
      ...(bare ? { note: 'The product concept has no front yet, so people see its text and a request for a picture (to draw it: outcomes_read(action="card_guidance"), then products_write(action="update_concept") with concept and card_html).' } : {}),
    };
  },
});

export const updateProduct = defineOperation({
  name: "products.update",
  scope: "product",
  access: "admin",
  mutates: true,
  webOnly: "a person does it in the web app, in the product's Settings (`…/settings`), its name and short name in links",
  summary: "Rename a product or change its slug (product admins, in the web app).",
  description:
    'A person\'s act in the web app, never an agent\'s. Pass only the fields that change, plus expected_etag. The product concept is a card on the Idea screen, written with products.update_concept, which editors may call too, agents among them.',
  input: z.strictObject({
    expected_etag: expectedEtag,
    name: z.string().trim().min(1).max(100).optional(),
    slug: slug.optional(),
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
    const changed = (["name", "slug"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (!changed.length) return productView(row, ctx);
    await ctx.db
      .updateTable("products")
      .set({ name: input.name ?? row.name, slug: input.slug ?? row.slug, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
      .where("product_id", "=", pid)
      .execute();
    await recordActivity(ctx, { action: "updated", entity_type: "product", entity_id: pid, entity_title: input.name ?? row.name, summary: `Changed ${changed.join(", ")}` });
    const next = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).executeTakeFirstOrThrow();
    return productView(next, { ...ctx, scope: { ...ctx.scope } });
  },
});

export const updateConcept = defineOperation({
  name: "products.update_concept",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Write the product concept's card: its front and its back, together (editors and admins).",
  description:
    `Requires expected_etag from your latest products_read(action="get", include_card=true), which returns both sides; read both before changing either. ${WHAT_A_CONCEPT_IS} ` +
    'Look at a new front first with outcomes_read(action="card_preview", kind="concept"). The previous concept and front are kept, and a product export includes them, but no action reads them back yet. A write that touches the card returns card_advice when it misses something the guidance asks.',
  input: z.strictObject({
    expected_etag: expectedEtag,
    concept: z.string().max(CONCEPT_MAX).optional().describe("The back of the concept's card, which agents read first: Markdown. Send card_html with it."),
    card_html: z.string().trim().min(1, "The concept's front cannot be emptied; send a new one.").max(CARD_HTML_MAX).optional().describe("The front of the concept's card, the picture people see first: HTML in the card kit. Send concept with it."),
  }),
  rest: { method: "PATCH", path: "/idea/concept" },
  mcp: { tool: "products", action: "update_concept" },
  async handler(ctx, input) {
    const pid = ctx.scope.product!.product_id;
    const row = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).forUpdate().executeTakeFirstOrThrow();
    checkEtag(input.expected_etag, row.etag, "product");
    checkCardSides({ back: row.concept, front: row.card_html }, { back: input.concept, front: input.card_html }, { what: "The product concept", back: "concept", read: 'products_read(action="get", include_card=true)' });
    checkIdeaCard(input.card_html, "The product concept");
    const changed = (["concept", "card_html"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (!changed.length) return productView(row, ctx);
    await keepRevision(ctx, "product", pid, { concept: row.concept, card_html: row.card_html }, row.updated_at, row.updated_by);
    await ctx.db
      .updateTable("products")
      .set({ concept: input.concept ?? row.concept, card_html: input.card_html ?? row.card_html, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
      .where("product_id", "=", pid)
      .execute();
    const said = { concept: "concept", card_html: "concept's front" } as const;
    await recordActivity(ctx, { action: "updated", entity_type: "product", entity_id: pid, entity_title: row.name, summary: `Changed ${changed.map((k) => said[k]).join(", ")}` });
    const next = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).executeTakeFirstOrThrow();
    return { ...productView(next, { ...ctx, scope: { ...ctx.scope } }), ...conceptAdvice(next) };
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
    if (!tenantRoleAtLeast(tenantRole, needed)) throw forbidden(`Changing organization roles needs an organization ${needed}.`, { needed });
  } else if (!roleAtLeast(eff, "admin")) {
    // A team or product the caller has no role on does not exist for them: 404, without its name.
    if (eff === null && (target.scope_type === "product" || !(await holdsAProductIn(ctx, memberships, target.team_id!)))) throw hiddenScope(target.scope_type);
    throw forbidden(`Managing members of ${target.scope_type} ${target.name} needs admin there; you’re ${eff ?? "not a member"}.`, { role: eff, needed: "admin" });
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

export const listMembers = defineOperation({
  name: "members.list",
  scope: "tenant",
  access: "any",
  needsSomewhere: "viewer",
  mutates: false,
  summary: "List the tenant's members with every grant they hold, and outstanding invitations; or, with product, the people who can reach one product.",
  description:
    "Each member lists grants as {scope_type, scope, role}. Effective access is the highest role that applies. Pass product (a slug with team, or an id) to list only the people with access to that product: each then carries product_access {role, via} — via is product, team or tenant, the grant the role comes from (the broadest one when grants tie) — and grants are limited to the ones that apply to that product. Invitations are limited the same way. Owners and admins of the tenant see everyone. Anyone else sees only the people on the teams and products they read (viewer or above), with only those grants and their tenant role, and the invitations they could cancel (where they are admin); the result then says partial: true, and a product they cannot read answers 404. A guest of the example organization sees none of its people: the result is empty and says guest: true. Someone who reads only the Story everywhere in the tenant (a reader on its teams or products and nothing more) sees none of its people: 403.",
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
      throw forbidden(`You read only the Story in ${ctx.scope.tenant!.name}, so you can’t see its members. Viewer access to one of its teams or products shows them.`, { role: "reader", needed: "viewer" });
    // A guest of the example organization holds no stored grant, so is nobody there, and sees nobody.
    if (ctx.scope.tenantRole === "guest") return { members: [], invitations: [], guest: true };
    const teams = await ctx.db.selectFrom("teams").select(["team_id", "slug", "name"]).where("tenant_id", "=", tid).execute();
    const products = await ctx.db.selectFrom("products").select(["product_id", "slug", "name", "team_id"]).where("tenant_id", "=", tid).execute();
    // Below an owner or admin of the organization, a person sees only the people on what they read.
    const reach = tenantRoleAtLeast(ctx.scope.tenantRole, "admin") ? null : directoryReach(mine, tid, teams, products);
    let target = null;
    if (input.product && reach) {
      target = await resolveGrantTarget(ctx, { team: input.team, product: input.product }).catch(() => null);
      const role = target ? effectiveRole(mine, { tenant_id: tid, team_id: target.team_id, product_id: target.product_id }).role : null;
      if (!target || !role) throw hiddenScope("product");
      if (!roleAtLeast(role, "viewer")) throw forbidden(`You’re a reader on product ${target.name}; members.list needs viewer.`, { role, needed: "viewer" });
    } else if (input.product) target = await resolveGrantTarget(ctx, { team: input.team, product: input.product });
    let people = ctx.db
      .selectFrom("memberships as m")
      .innerJoin("accounts as a", "a.account_id", "m.account_id")
      .select(["m.membership_id", "m.scope_type", "m.scope_id", "m.role", "m.created_at", "a.account_id", "a.display_name", "a.email"])
      .where("m.tenant_id", "=", tid);
    const all = await people.orderBy("a.display_name").execute();
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
      (type === "tenant" && (role === "owner" || role === "admin"));
    type Grant = { membership_id: string; scope_type: string; scope_id: string; scope: unknown; role: string; since: string };
    const byAccount = new Map<string, { account_id: string; display_name: string; email: string; grants: Grant[] }>();
    for (const r of rows) {
      if (!applies(r.scope_type, r.scope_id, r.role)) continue;
      const m = byAccount.get(r.account_id) ?? { account_id: r.account_id, display_name: r.display_name, email: r.email, grants: [] };
      m.grants.push({ membership_id: r.membership_id, scope_type: r.scope_type, scope_id: r.scope_id, scope: label(r.scope_type, r.scope_id), role: r.role, since: r.created_at });
      byAccount.set(r.account_id, m);
    }
    const invitations = await ctx.db
      .selectFrom("invitations")
      .select(["invitation_id", "email", "scope_type", "scope_id", "role", "expires_at", "created_at"])
      .where("tenant_id", "=", tid)
      .where("accepted_at", "is", null)
      .where("expires_at", ">", ctx.now)
      .execute()
      // Below an owner or admin of the organization, only the invitations the caller could cancel.
      .then((all) => (reach ? all.filter((i) => reach.manages(i.scope_type, i.scope_id)) : all));
    const partial = reach ? { partial: true } : {};
    if (!target) {
      return {
        members: [...byAccount.values()],
        invitations: invitations.map((i) => ({ ...i, scope: label(i.scope_type, i.scope_id) })),
        ...partial,
      };
    }
    const breadth: Record<string, number> = { tenant: 3, team: 2, product: 1 };
    const members = [...byAccount.values()].map((m) => {
      let best: { role: string; via: string } | null = null;
      for (const g of m.grants) {
        const role = g.scope_type === "tenant" ? "admin" : g.role;
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
    };
  },
});

type GrantTarget = Awaited<ReturnType<typeof resolveGrantTarget>>;
type Mail = { to: string; subject: string; text: string };
const GRANT_ROLES = ["owner", "admin", "member", "editor", "viewer", "reader"] as const;
/** The most people one members.grant_many call names. */
export const GRANTS_PER_CALL = 100;

/** The roles that apply where a grant lands: the organization's own, or a team's and a product's. */
const rolesAt = (target: GrantTarget): readonly string[] => (target.scope_type === "tenant" ? ["owner", "admin", "member"] : PRODUCT_ROLES);

/**
 * The people in the organization the caller already sees, as members.list shows them: everyone to
 * an owner or admin of it, and otherwise the people on the teams and products they read. Asked of
 * an account, it says whether a role may be given to it at once.
 */
function seenByCaller(ctx: OpContext): (accountId: string) => Promise<boolean> {
  const tid = ctx.scope.tenant!.tenant_id;
  let reach: Promise<ReturnType<typeof directoryReach> | null> | null = null;
  return async (accountId) => {
    const theirs = await ctx.db.selectFrom("memberships").select(["scope_type", "scope_id", "role"]).where("tenant_id", "=", tid).where("account_id", "=", accountId).execute();
    if (!theirs.length) return false;
    if (accountId === ctx.principal.account_id || tenantRoleAtLeast(ctx.scope.tenantRole, "admin")) return true;
    reach ??= (async () => {
      const [mine, teams, products] = await Promise.all([
        membershipsFor(ctx.db, ctx.principal.account_id, tid),
        ctx.db.selectFrom("teams").select("team_id").where("tenant_id", "=", tid).execute(),
        ctx.db.selectFrom("products").select(["product_id", "team_id"]).where("tenant_id", "=", tid).execute(),
      ]);
      return directoryReach(mine, tid, teams, products);
    })();
    const r = await reach;
    return Boolean(r && theirs.some((g) => r.shows(g.scope_type, g.scope_id, g.role)));
  };
}

/**
 * Give one person a role where `target` is, after the caller's standing there was checked. Someone
 * the caller already sees in the organization gets the role at once (replacing the one they hold
 * there). Anyone else gets an invitation by email, whether or not they have an account, so the
 * answer never tells the caller whether an address has an account, here or in another
 * organization, or whose it is; they join when they accept it. The invitation's email is
 * returned, not sent, so a call that grants many sends them once every grant has been made.
 */
async function grantOne(ctx: OpContext, target: GrantTarget, email: string, role: string, seen: (accountId: string) => Promise<boolean>) {
  const tid = ctx.scope.tenant!.tenant_id;
  await checkMembers(ctx.db, ctx.limits ?? null, email, role);
  const found = await ctx.db.selectFrom("accounts").select(["account_id", "display_name"]).where(sql<boolean>`lower(email) = lower(${email})`).where("deleted_at", "is", null).executeTakeFirst();
  const account = found && (await seen(found.account_id)) ? found : null;
  if (!account) {
    const token = randomToken();
    const invitation_id = newId();
    const expires = new Date(Date.parse(ctx.now) + 7 * 86400_000).toISOString();
    await ctx.db
      .insertInto("invitations")
      .values({ invitation_id, tenant_id: tid, scope_type: target.scope_type, scope_id: target.scope_id, email, role, token_hash: sha256Hex(token), expires_at: expires, created_by: json(ctx.actor) })
      .execute();
    const link = `${ctx.ports.config.publicBaseUrl}/invite/${token}`;
    // The inviter's name is theirs to choose: in the email it is one line, quoted and bounded, so it never reads as WhatBuild's own words.
    const who = quotedName(ctx.actor.display_name);
    const where = oneLine(target.name, 100);
    const mail: Mail = {
      to: email,
      subject: `${who} invited you to ${where} on WhatBuild`,
      text:
        `${who} invited you to ${where} on WhatBuild, as ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.\n\n` +
        `Accept the invitation:\n${link}\n\n` +
        `The link works once, within 7 days, when you sign in with this email.\n` +
        `The name in quotation marks is the one the inviter gave WhatBuild.\n`,
    };
    await recordActivity(ctx, { action: "invited", entity_type: "membership", entity_id: invitation_id, entity_title: target.name, summary: `Invited someone as ${role}` });
    // The link is returned to the inviter too, so an invitation works even where no email is sent.
    return { mail, result: { invited: true as const, invitation_id, invite_link: link, expires_at: expires, scope_type: target.scope_type, scope: target.name, role } };
  }
  const existing = await ctx.db.selectFrom("memberships").select(["membership_id", "role"]).where("scope_type", "=", target.scope_type).where("scope_id", "=", target.scope_id).where("account_id", "=", account.account_id).executeTakeFirst();
  const granted = { invited: false as const, account_id: account.account_id, display_name: account.display_name, scope_type: target.scope_type, scope: target.name, role: role as ProductRole | TenantRole };
  // The role they already hold there: nothing to change, and nothing for the access log.
  if (existing?.role === role) return { mail: null, result: { ...granted, unchanged: true as const } };
  if (existing?.role === "owner") {
    // Only an owner changes an owner's role, as only an owner removes one.
    await requireAdminOf(ctx, target, "owner");
    const owners = await ctx.db.selectFrom("memberships").select("membership_id").where("scope_type", "=", "tenant").where("scope_id", "=", tid).where("role", "=", "owner").execute();
    if (owners.length <= 1) throw conflict("last_owner", "An organization keeps at least one owner. Make someone else owner first.");
  }
  if (existing) await ctx.db.updateTable("memberships").set({ role }).where("membership_id", "=", existing.membership_id).execute();
  else
    await ctx.db
      .insertInto("memberships")
      .values({ membership_id: newId(), tenant_id: tid, scope_type: target.scope_type, scope_id: target.scope_id, account_id: account.account_id, role, created_by: json(ctx.actor) })
      .execute();
  await recordActivity(ctx, {
    action: existing ? "role_changed" : "granted",
    entity_type: "membership",
    entity_id: account.account_id,
    entity_title: account.display_name,
    summary: `${existing ? "Changed role to" : "Granted"} ${role} on ${target.scope_type === "tenant" ? "organization" : target.scope_type} ${target.name}`,
  });
  return { mail: null, result: { ...granted, ...(existing ? { previous_role: existing.role } : {}) } };
}

export const grantMember = defineOperation({
  name: "members.grant",
  scope: "tenant",
  access: "any",
  needsSomewhere: "admin",
  mutates: true,
  connection: "admin",
  summary: "Give someone a role on the tenant, a team, or a product; invites by email anyone not already in the organization.",
  description:
    "Admins of the target grant roles there: product admins on their product, team admins on their team, tenant admins on the tenant (owners for owner). Roles: tenant owner|admin|member; team and product admin|editor|viewer|reader. A reader reads only the Story: its pages, their versions and their export, without the evidence, assumptions and mockups behind them. Someone you already see in the organization (everyone, for its owners and admins; otherwise the people on the teams and products you read) gets the role at once: granting again replaces the role at that scope, and granting the role they already hold there changes nothing and says unchanged. Anyone else gets an invitation by email, valid 7 days, whether or not they have an account, and joins when they accept it: the answer never says whether an address has an account. To give many people roles at once, use grant_many.",
  input: grantScope.extend({
    email: z.string().email().max(320),
    role: z.enum(GRANT_ROLES),
  }),
  rest: { method: "POST", path: "/members" },
  mcp: { tool: "members", action: "grant" },
  async handler(ctx, input) {
    const target = await resolveGrantTarget(ctx, input);
    await requireAdminOf(ctx, target, input.role);
    const allowed = rolesAt(target);
    if (!allowed.includes(input.role)) throw invalid("invalid_role", `Role ${input.role} doesn’t apply to ${target.scope_type === "tenant" ? "an organization" : `a ${target.scope_type}`}; use ${allowed.join(", ")}.`);
    const { mail, result } = await grantOne(ctx, target, input.email, input.role, seenByCaller(ctx));
    if (mail) await ctx.ports.mailer?.send(mail);
    return result;
  },
});

export const grantMembers = defineOperation({
  name: "members.grant_many",
  scope: "tenant",
  access: "any",
  needsSomewhere: "admin",
  mutates: true,
  connection: "admin",
  summary: "Give many people roles on the tenant, one team, or one product at once; invites by email anyone not already in the organization.",
  description:
    `Grants as members.grant does, for up to ${GRANTS_PER_CALL} people at one scope (the tenant, a team or a product), each with their own role: people you already see in the organization get the role at once (replacing the one they hold there), and anyone else gets an invitation by email, valid 7 days, whether or not they have an account. It is all or nothing, and counts as one write: a refusal (a role that does not apply to the scope, an address sent twice, a role the caller may not give, the last owner demoted, a plan's total of people reached) changes nothing and names the address it is about. Each result says invited (with invite_link), or the role given, with previous_role when it replaced one, or unchanged when they already held it. Invitations are emailed once every role is given; one that could not be emailed says emailed: false, and its invite_link still works.`,
  input: grantScope.extend({
    people: z
      .array(z.strictObject({ email: z.string().email().max(320), role: z.enum(GRANT_ROLES) }))
      .min(1)
      .max(GRANTS_PER_CALL)
      .describe("Who gets what: each address once, with the role it gets at this scope."),
  }),
  rest: { method: "POST", path: "/members/many" },
  mcp: { tool: "members", action: "grant_many" },
  async handler(ctx, input) {
    const target = await resolveGrantTarget(ctx, input);
    await requireAdminOf(ctx, target, input.people.some((p) => p.role === "owner") ? "owner" : "admin");
    const allowed = rolesAt(target);
    const wrong = input.people.find((p) => !allowed.includes(p.role));
    if (wrong)
      throw invalid("invalid_role", `Role ${wrong.role} (for ${wrong.email}) doesn’t apply to ${target.scope_type === "tenant" ? "an organization" : `a ${target.scope_type}`}; use ${allowed.join(", ")}. Nothing was changed.`, { email: wrong.email });
    const seen = new Set<string>();
    for (const p of input.people) {
      const key = p.email.toLowerCase();
      if (seen.has(key)) throw invalid("invalid_input", `${p.email} is sent twice: send each address once, with the role it gets. Nothing was changed.`, { email: p.email });
      seen.add(key);
    }
    const results: (Awaited<ReturnType<typeof grantOne>>["result"] & { email: string; emailed?: false })[] = [];
    const sees = seenByCaller(ctx);
    const mails: Mail[] = [];
    for (const [i, p] of input.people.entries()) {
      try {
        const { mail, result } = await grantOne(ctx, target, p.email, p.role, sees);
        results.push({ email: p.email, ...result });
        if (mail) mails.push(mail);
      } catch (e) {
        // A refusal is about one address: it says which, and that the others were not given either.
        if (e instanceof AppError && e.code === "quota_exceeded")
          throw new AppError(e.status, e.code, `${e.message.replace(/\.?$/, ".")} ${i ? `Of the ${input.people.length} addresses sent, the plan has room for the first ${i}, and ${p.email} is past it.` : `The plan has no room for ${p.email}.`} Nothing was changed.`, { ...e.details, email: p.email, room_for: i });
        if (e instanceof AppError) throw new AppError(e.status, e.code, `${p.email}: ${e.message} Nothing was changed.`, { ...e.details, email: p.email });
        throw e;
      }
    }
    // The roles are given before any invitation goes out, and an invitation that can't be emailed keeps its link.
    for (const mail of mails) {
      const r = results.find((x) => x.invited && x.email === mail.to)!;
      try {
        await ctx.ports.mailer?.send(mail);
      } catch {
        Object.assign(r, { emailed: false });
      }
    }
    const count = (f: (r: (typeof results)[number]) => boolean) => results.filter(f).length;
    return {
      scope_type: target.scope_type,
      scope: target.name,
      granted: count((r) => !r.invited && !("unchanged" in r) && !("previous_role" in r)),
      changed: count((r) => "previous_role" in r),
      unchanged: count((r) => "unchanged" in r),
      invited: count((r) => r.invited),
      results,
    };
  },
});

export const revokeMember = defineOperation({
  name: "members.revoke",
  scope: "tenant",
  access: "any",
  needsSomewhere: "admin",
  mutates: true,
  allowReadOnlyOrganization: true,
  connection: "admin",
  summary: "Remove someone's role at one scope, or remove them from the tenant entirely. Their past writes and attribution stay.",
  description:
    "Revokes the grant at exactly the scope named. Other grants the person holds (on other teams or products) are untouched; a person whose last grant goes is no longer in the tenant, which left_organization says and the access log records. With whole_tenant, revokes every grant they hold in the tenant at once (needs tenant admin, and owner if they are an owner). A tenant keeps at least one owner.",
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
      if (!grants.length) throw notFound("That person isn’t in this organization.");
      const tenantTarget = await resolveGrantTarget(ctx, {});
      await requireAdminOf(ctx, tenantTarget, grants.some((g) => g.role === "owner") ? "owner" : "admin");
      if (grants.some((g) => g.role === "owner")) {
        const owners = await ctx.db.selectFrom("memberships").select("membership_id").where("scope_type", "=", "tenant").where("scope_id", "=", tid).where("role", "=", "owner").execute();
        if (owners.length <= 1) throw conflict("last_owner", "An organization keeps at least one owner. Make someone else owner first.");
      }
      await ctx.db.deleteFrom("memberships").where("tenant_id", "=", tid).where("account_id", "=", input.account_id).execute();
      const acct = await ctx.db.selectFrom("accounts").select("display_name").where("account_id", "=", input.account_id).executeTakeFirst();
      await recordActivity(ctx, { action: "revoked", entity_type: "membership", entity_id: input.account_id, entity_title: acct?.display_name ?? null, summary: `Removed from ${ctx.scope.tenant!.name} (${grants.length} ${grants.length === 1 ? "role" : "roles"})` });
      return { revoked: true, account_id: input.account_id, scope_type: "tenant" as const, scope: ctx.scope.tenant!.name, removed: grants.length };
    }
    const target = await resolveGrantTarget(ctx, input);
    // Admin of the team or product first, so a non-admin learns nothing of who holds a role there.
    if (target.scope_type !== "tenant") await requireAdminOf(ctx, target, "admin");
    const m = await ctx.db.selectFrom("memberships").select(["membership_id", "role"]).where("scope_type", "=", target.scope_type).where("scope_id", "=", target.scope_id).where("account_id", "=", input.account_id).executeTakeFirst();
    if (!m) throw notFound("That person has no role there.");
    await requireAdminOf(ctx, target, m.role);
    if (m.role === "owner") {
      const owners = await ctx.db.selectFrom("memberships").select("membership_id").where("scope_type", "=", "tenant").where("scope_id", "=", ctx.scope.tenant!.tenant_id).where("role", "=", "owner").execute();
      if (owners.length <= 1) throw conflict("last_owner", "An organization keeps at least one owner. Make someone else owner first.");
    }
    await ctx.db.deleteFrom("memberships").where("membership_id", "=", m.membership_id).execute();
    const acct = await ctx.db.selectFrom("accounts").select("display_name").where("account_id", "=", input.account_id).executeTakeFirst();
    // A person whose last role goes is no longer in the organization, and the access log says so.
    const left = !(await ctx.db.selectFrom("memberships").select("membership_id").where("tenant_id", "=", ctx.scope.tenant!.tenant_id).where("account_id", "=", input.account_id).executeTakeFirst());
    const removed = `${m.role} on ${target.scope_type === "tenant" ? "organization" : target.scope_type} ${target.name}`;
    await recordActivity(ctx, {
      action: "revoked",
      entity_type: "membership",
      entity_id: input.account_id,
      entity_title: acct?.display_name ?? null,
      summary: left ? `Removed from ${ctx.scope.tenant!.name}: ${removed} was their only role` : `Removed ${removed}`,
    });
    return { revoked: true, account_id: input.account_id, scope_type: target.scope_type, scope: target.name, ...(left ? { left_organization: true } : {}) };
  },
});

export const cancelInvitation = defineOperation({
  name: "members.cancel_invitation",
  scope: "tenant",
  access: "any",
  needsSomewhere: "admin",
  mutates: true,
  allowReadOnlyOrganization: true,
  connection: "admin",
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

export const listAccessActivity = defineOperation({
  name: "members.activity",
  scope: "tenant",
  access: "admin",
  mutates: false,
  summary: "Who gave, changed or removed whose access in the organization, or renamed it, and when: newest first (tenant admins).",
  description:
    "The organization's access log: roles given, changed and removed, people removed from the organization, invitations sent, accepted and cancelled, and the organization renamed or given a new slug. A product's activity.list leaves these out, because they belong to the organization, all but someone joining the product through an invitation. Entries name the person and the scope and never an email address. Filters: actor (account id), since (ISO 8601).",
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
      .where((eb) => eb.or([eb("entity_type", "=", "membership"), eb.and([eb("entity_type", "=", "tenant"), eb("action", "in", ["renamed", "slug_changed"])])]));
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
  listProducts, createTenant, renameTenant, createTeam, createProduct, getProduct, updateProduct, updateConcept, archiveProduct, restoreProduct,
  listMembers, grantMember, grantMembers, revokeMember, cancelInvitation, listAccessActivity,
];
