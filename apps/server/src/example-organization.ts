import { tenantNamed, type Db } from "@whatbuild/core";

/**
 * Make the tenant the deployment names the example organization, and no other. Run at start-up:
 * the deployment's configuration is what decides, and the database holds it so that policy can read
 * it. Taking the name away takes every guest's access: a guest's grant exists only while the flag is
 * set. A slug the example had before its current one still names it, with a warning to name it by
 * the current one, so changing its slug never takes the example away from its guests.
 */
export async function syncExampleTenant(db: Db, slug: string | null, log: (m: string) => void = console.log): Promise<string | null> {
  const tenant = slug ? await db.selectFrom("tenants").select(["tenant_id", "slug", "example"]).where("tenant_id", "=", tenantNamed(slug)).executeTakeFirst() : undefined;
  await db.updateTable("tenants").set({ example: false }).where("example", "=", true).where("tenant_id", "!=", tenant?.tenant_id ?? "").execute();
  if (!slug) return null;
  if (!tenant) {
    log(`warning: WHATBUILD_EXAMPLE_TENANT names "${slug}", and no organization has that slug. There is no example organization until one does and the service restarts.`);
    return null;
  }
  if (tenant.slug !== slug && tenant.tenant_id !== slug)
    log(`warning: WHATBUILD_EXAMPLE_TENANT names "${slug}", a slug the example organization had before its current one, "${tenant.slug}". Set it to "${tenant.slug}"; until then the old slug still names it.`);
  if (!tenant.example) {
    await db.updateTable("tenants").set({ example: true }).where("tenant_id", "=", tenant.tenant_id).execute();
    log(`Organization "${tenant.slug}" is the example organization.`);
  }
  return tenant.tenant_id;
}
