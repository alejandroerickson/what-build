import type { Db } from "@whatbuild/core";

/**
 * Make the tenant the deployment names the example organization, and no other. Run at start-up:
 * the deployment's configuration is what decides, and the database holds it so that policy can read
 * it. Taking the name away takes every guest's access: a guest's grant exists only while the flag is
 * set.
 */
export async function syncExampleTenant(db: Db, slug: string | null, log: (m: string) => void = console.log): Promise<string | null> {
  await db.updateTable("tenants").set({ example: false }).where("example", "=", true).where("slug", "!=", slug ?? "").execute();
  if (!slug) return null;
  const tenant = await db.selectFrom("tenants").select(["tenant_id", "example"]).where("slug", "=", slug).executeTakeFirst();
  if (!tenant) {
    log(`warning: WHATBUILD_EXAMPLE_TENANT names "${slug}", and no organization has that slug. There is no example organization until one does and the service restarts.`);
    return null;
  }
  if (!tenant.example) {
    await db.updateTable("tenants").set({ example: true }).where("tenant_id", "=", tenant.tenant_id).execute();
    log(`Organization "${slug}" is the example organization.`);
  }
  return tenant.tenant_id;
}
