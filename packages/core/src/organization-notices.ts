import type { Db } from "./db.ts";
import type { OpContext } from "./registry.ts";
import { READ_ONLY_ALLOWS } from "./read-only.ts";
import { oneLine, utcDay } from "./util.ts";

/**
 * The mails an organization's owners get when an owner of this instance changes it from outside:
 * it became read-only, or it was deleted. Nobody else in it is mailed; its readers see the change
 * when they next open it. Days are UTC days and say so, as every mail's do.
 */

/** The addresses of an organization's owners, but the one acting. Read before a deletion takes them. */
export async function ownerAddresses(db: Db, tenantId: string, exceptAccountId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("memberships as m")
    .innerJoin("accounts as a", "a.account_id", "m.account_id")
    .select("a.email")
    .where("m.tenant_id", "=", tenantId)
    .where("m.scope_type", "=", "tenant")
    .where("m.role", "=", "owner")
    .where("a.deleted_at", "is", null)
    .where("a.account_id", "<>", exceptAccountId)
    .execute();
  return [...new Set(rows.map((r) => r.email))];
}

/** Send one mail to each owner. A deployment that sends no mail sends none, and a mail that fails never undoes the change: the count says how many went. */
async function mailEach(ctx: Pick<OpContext, "ports">, to: string[], message: { subject: string; text: string }, what: string): Promise<number> {
  const mailer = ctx.ports.mailer;
  if (!mailer || ctx.ports.config.sendsMail === false) return 0;
  let sent = 0;
  for (const address of to) {
    try {
      await mailer.send({ to: address, ...message });
      sent++;
    } catch (e) {
      console.error(`${what}: an owner was not mailed: ${(e as Error).message}`);
    }
  }
  return sent;
}

function runner(ctx: Pick<OpContext, "ports">): string {
  const contact = ctx.ports.config.privacyContact;
  return `whoever runs this WhatBuild${contact ? ` (${contact})` : ""}`;
}

/** An organization an instance owner moved back to the starting plan, which made it read-only. */
export async function tellOwnersReadOnly(
  ctx: Pick<OpContext, "ports" | "now">,
  to: string[],
  org: { name: string; slug: string },
  readOnly: { kept_until: string | null },
  startName: string,
): Promise<number> {
  const base = ctx.ports.config.publicBaseUrl;
  const name = oneLine(org.name, 100);
  return mailEach(
    ctx,
    to,
    {
      subject: `${name} is read-only on WhatBuild`,
      text:
        `${name}, an organization you own on ${new URL(base).host}, is read-only since ${utcDay(ctx.now)} (UTC). ` +
        `It went back to the ${startName} plan while whoever started it already has a ${startName} organization, so nothing new can be added.\n\n` +
        `${READ_ONLY_ALLOWS}${readOnly.kept_until ? ` It is kept until ${utcDay(readOnly.kept_until)} (UTC).` : ""}\n\n` +
        `To work in it again, ask ${runner(ctx)} to move it to another plan.\n\n` +
        `Its plan:\n${base}/t/${org.slug}/plan\n`,
    },
    "read-only organization",
  );
}

/** An organization an instance owner deleted, with everything in it. */
export async function tellOwnersDeleted(ctx: Pick<OpContext, "ports" | "now">, to: string[], org: { name: string }): Promise<number> {
  const base = ctx.ports.config.publicBaseUrl;
  const name = oneLine(org.name, 100);
  return mailEach(
    ctx,
    to,
    {
      subject: `${name} was deleted from WhatBuild`,
      text:
        `${name}, an organization you owned on ${new URL(base).host}, was deleted on ${utcDay(ctx.now)} (UTC) by an owner of this WhatBuild, ` +
        `with everything in it: its teams, products, sources, attachments and Story.\n\n` +
        `Your account stays, with the other organizations you are in.\n\n` +
        `If you didn’t expect this, contact ${runner(ctx)}.\n`,
    },
    "deleted organization",
  );
}
