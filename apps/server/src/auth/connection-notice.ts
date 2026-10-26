import { json, LEVEL_NAMES, type ConnectionLevel, type Db, type Ports } from "@whatbuild/core";
import { connectorReach, type ConnectorReach } from "./connector-reach.ts";

/**
 * The email a person gets when an agent connects as them for the first time, and the consent
 * page's warning before one connects at a web address they have never connected an agent at. Any
 * client may register under any name, so what the person can check is where a connection is held:
 * only the holder of its redirect URI receives it.
 */

/** The job the worker sends the email from, so a failing mailer never fails a token exchange. */
export const CONNECTION_NOTICE_JOB = "agent_connected";

/** Where a connection is held: the `https` host its redirect URI names, or null for an app on the person's computer. */
export function heldAt(redirect: string): string | null {
  const u = new URL(redirect);
  return u.protocol === "https:" ? u.host : null;
}

/** The account's connections other than `exceptFamily`: the name each client gave, and where it is held. */
async function connections(db: Db, accountId: string, exceptFamily?: string) {
  let q = db
    .selectFrom("oauth_tokens as t")
    .innerJoin("oauth_clients as c", "c.client_id", "t.client_id")
    .select(["c.client_name", "c.redirect_uris"])
    .distinct()
    .where("t.account_id", "=", accountId);
  if (exceptFamily) q = q.where("t.family_id", "<>", exceptFamily);
  return (await q.execute()).map((r) => ({ name: r.client_name, places: r.redirect_uris.map(heldAt) }));
}

/** Whether this account has handed a connection to `host` before, under any client's name. */
export async function connectedAtBefore(db: Db, accountId: string, host: string): Promise<boolean> {
  return (await connections(db, accountId)).some((c) => c.places.includes(host));
}

/**
 * Whether a connection just made is an agent connecting again: the account had another connection,
 * live or ended, from a client of the same name held at the same place. A refresh makes no
 * connection, so it is never asked about.
 */
export async function isReconnection(db: Db, accountId: string, family: string, clientName: string, redirect: string): Promise<boolean> {
  const place = heldAt(redirect);
  return (await connections(db, accountId, family)).some((c) => c.name === clientName && c.places.includes(place));
}

export interface ConnectionNoticeJob {
  account_id: string;
  client_name: string;
  redirect_uri: string;
  resource: string;
  level: ConnectionLevel;
  at: string;
}

/** Queue the email for a connection just made, in the transaction that made it, unless it is an agent connecting again. */
export async function queueConnectionNotice(trx: Db, family: string, job: ConnectionNoticeJob): Promise<boolean> {
  if (await isReconnection(trx, job.account_id, family, job.client_name, job.redirect_uri)) return false;
  await trx.insertInto("jobs").values({ tenant_id: "", kind: CONNECTION_NOTICE_JOB, payload: json({ ...job }) }).execute();
  return true;
}

/** What a connection reaches, in the consent page's words, as plain text. */
function reachWords(r: ConnectorReach): string {
  if (r.kind === "all") return "Every product you can open";
  if (r.kind === "tenant") return `The organization ${r.name ?? r.path}, and nothing outside it`;
  return `The product ${r.name ?? r.path}${r.name && r.tenant_name ? ` in ${r.tenant_name}` : ""}, and nothing outside it`;
}

/** The email's subject and plain text. It names the agent, where it is held, what it reaches and may do, and how to end it. */
export function connectionNotice(p: { clientName: string; held: string | null; reach: ConnectorReach; level: ConnectionLevel; at: string; base: string }): { subject: string; text: string } {
  const text = [
    `An agent was connected to your WhatBuild account at ${new URL(p.base).host}.`,
    "",
    `  Agent:     “${p.clientName}”, the name it gave itself, which WhatBuild hasn’t verified`,
    `  Held by:   ${p.held ?? "an app on your computer"}`,
    `  Reaches:   ${reachWords(p.reach)}`,
    `  May:       ${LEVEL_NAMES[p.level]}`,
    `  When:      ${p.at.slice(0, 16).replace("T", " ")} UTC`,
    "",
    "If you connected it, there is nothing to do.",
    "",
    "If you didn’t, disconnect it under Connect an agent:",
    `${p.base}/connect`,
    "",
    "To disconnect every agent and sign out of every browser at once, use Sign out everywhere in Settings:",
    `${p.base}/settings`,
    "",
    "--",
    "WhatBuild sends this when an agent connects as you for the first time, not when one you connected before connects again.",
    "",
  ].join("\n");
  return { subject: "A new agent is connected to your WhatBuild account", text };
}

/** Send a queued notice to the account's address now, from the worker. An account deleted since gets nothing. */
export async function sendConnectionNotice(db: Db, ports: Pick<Ports, "mailer" | "config">, job: ConnectionNoticeJob): Promise<boolean> {
  if (!ports.mailer) return false;
  const account = await db.selectFrom("accounts").select(["email"]).where("account_id", "=", job.account_id).where("deleted_at", "is", null).executeTakeFirst();
  if (!account) return false;
  const reach = await connectorReach(db, job.account_id, job.resource);
  const message = connectionNotice({ clientName: job.client_name, held: heldAt(job.redirect_uri), reach, level: job.level, at: job.at, base: ports.config.publicBaseUrl });
  await ports.mailer.send({ to: account.email, ...message });
  return true;
}
