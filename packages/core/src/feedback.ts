import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError, rateLimited } from "./errors.ts";
import type { Ports } from "./ports.ts";

/**
 * Feedback from people and their agents. A report names nobody: it keeps its kind, its words, the
 * release, the door it came through and, for an agent, its family, and the person's address only
 * when they chose to share it for a reply. What goes to the people who run the deployment is a
 * plain-text digest, at most one a day, to the address the deployment names
 * (`WHATBUILD_FEEDBACK_EMAIL`); without one, reports stay in the database.
 */

/**
 * The refusal of submit_feedback on an agent's connection whose person turned it off. It comes
 * before anything else about the call, its input included: the tool is off, whatever was sent.
 */
export const feedbackOff = () =>
  new AppError(403, "feedback_off", "The person turned off submit_feedback for this connection, in Connect an agent. Send no feedback another way; tell them what went wrong instead.");

/** Reports one person, with their agents, may send in a day (UTC). */
export const FEEDBACK_PER_DAY = 10;
/** Reports the whole deployment takes in a day, so no flood reaches the database or the inbox. */
export const FEEDBACK_PER_DEPLOYMENT_PER_DAY = 200;
/** Reports one digest carries; the rest wait for the next. */
export const DIGEST_MAX_REPORTS = 100;
/** Hours between digests. */
export const DIGEST_EVERY_HOURS = 24;

/** What each kind is called where people read it. */
export const FEEDBACK_KINDS: Record<string, string> = {
  issue: "Bug",
  improvement: "Improvement",
  feature_request: "Feature request",
  confusion: "Confusing",
  other: "Other",
};

/** The UTC day it is, as yyyy-mm-dd, and the moment the next one begins, when the allowances start again. */
export function feedbackDay(now = new Date()): { day: string; resets_at: string } {
  return {
    day: now.toISOString().slice(0, 10),
    resets_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(),
  };
}

/**
 * Count a report against the sender's day and the deployment's, or refuse it with
 * `429 rate_limited`. A day is the UTC day, whatever the sender's time zone, and a refusal says
 * when the next one begins. The count is kept apart from the reports, so it never says which are whose.
 */
export async function countFeedback(db: Db, accountId: string, now = new Date()): Promise<void> {
  const { day, resets_at } = feedbackDay(now);
  const received = await db
    .selectFrom("feedback")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("received_at", ">=", `${day}T00:00:00.000Z`)
    .executeTakeFirst();
  if (Number(received?.n ?? 0) >= FEEDBACK_PER_DEPLOYMENT_PER_DAY)
    throw rateLimited(`WhatBuild has taken all the feedback it takes in a day, counted by the UTC day. It takes more from ${resets_at}, midnight UTC.`, { limit: FEEDBACK_PER_DEPLOYMENT_PER_DAY });
  const counted = await db
    .insertInto("feedback_counts")
    .values({ account_id: accountId, day, sent: 1 })
    .onConflict((oc) => oc.columns(["account_id", "day"]).doUpdateSet({ sent: sql`feedback_counts.sent + 1` }).where("feedback_counts.sent", "<", FEEDBACK_PER_DAY))
    .returning("sent")
    .executeTakeFirst();
  if (!counted)
    throw rateLimited(
      `You have sent ${FEEDBACK_PER_DAY} pieces of feedback this UTC day, the most a day takes. You can send more from ${resets_at}, midnight UTC.`,
      { limit: FEEDBACK_PER_DAY },
    );
}

/** A day's counts go once the day is over. */
export async function pruneFeedbackCounts(db: Db): Promise<void> {
  await sql`delete from feedback_counts where day < (now() at time zone 'utc')::date`.execute(db);
}

interface DigestRow {
  category: string;
  message: string;
  tool: string | null;
  details: string | null;
  server_version: string;
  surface: string | null;
  client: string | null;
  screen: string | null;
  reply_to: string | null;
  received_at: string;
}

const indent = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? `   ${line}` : ""))
    .join("\n");

const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function heading(r: DigestRow): string {
  const kind = FEEDBACK_KINDS[r.category] ?? r.category;
  const from =
    r.surface === "mcp"
      ? `from an agent${r.client ? ` (${r.client})` : ""}${r.tool ? `, about ${r.tool}` : ""}`
      : r.surface === "web"
        ? `from the web app${r.screen ? `, on ${r.screen}` : ""}`
        : "";
  return `${kind}${from ? `, ${from}` : ""}. Release ${r.server_version}, ${stamp(r.received_at)}.`;
}

/** The digest's subject and plain text, for the reports in it and the number still waiting. */
export function digestMessage(rows: DigestRow[], waiting: number, host: string): { subject: string; text: string } {
  const n = rows.length;
  const reports = (k: number) => `${k} ${k === 1 ? "report" : "reports"}`;
  const blocks = rows.map((r, i) =>
    [
      `${i + 1}. ${heading(r)}`,
      "",
      indent(r.message),
      ...(r.details?.trim() ? ["", "   Details:", indent(r.details)] : []),
      ...(r.reply_to ? ["", `   Reply to: ${r.reply_to}`] : []),
    ].join("\n"),
  );
  const text = [
    `${reports(n)} of feedback reached ${host} since the last digest.`,
    "",
    blocks.join("\n\n"),
    "",
    ...(waiting ? [`${reports(waiting)} more wait for the next digest.`, ""] : []),
    "--",
    `WhatBuild sends this at most once every ${DIGEST_EVERY_HOURS} hours, while there is feedback it has not sent.`,
    "A report names nobody unless its sender shared their address to be answered.",
    "To stop it, remove WHATBUILD_FEEDBACK_EMAIL from the deployment's settings.",
    "",
  ].join("\n");
  return { subject: `WhatBuild feedback: ${reports(n)} from ${host}`, text };
}

/**
 * Send the digest if one is due: there is feedback not yet sent, and none went out in the last
 * `DIGEST_EVERY_HOURS`. One transaction holds a lock, so of several instances only one sends; the
 * reports are marked sent with the message, so a send that fails leaves them for the next try.
 * Answers how many reports went out, or null when no digest was due or another instance has it.
 */
export async function sendFeedbackDigest(db: Db, ports: Pick<Ports, "mailer" | "config">): Promise<number | null> {
  const to = ports.config.feedbackEmail;
  if (!to || !ports.mailer) return null;
  return db.transaction().execute(async (trx) => {
    const locked = await sql<{ ok: boolean }>`select pg_try_advisory_xact_lock(hashtextextended('feedback_digest', 0)) as ok`.execute(trx);
    if (!locked.rows[0]?.ok) return null;
    const last = await trx.selectFrom("feedback").select((eb) => eb.fn.max("sent_at").as("at")).executeTakeFirst();
    if (last?.at && Date.now() - Date.parse(String(last.at)) < DIGEST_EVERY_HOURS * 3600_000) return null;
    const rows = await trx
      .selectFrom("feedback")
      .select(["feedback_id", "category", "message", "tool", "details", "server_version", "surface", "client", "screen", "reply_to", "received_at"])
      .where("sent_at", "is", null)
      .orderBy("received_at")
      .limit(DIGEST_MAX_REPORTS)
      .forUpdate()
      .execute();
    if (!rows.length) return 0;
    const unsent = await trx.selectFrom("feedback").select((eb) => eb.fn.countAll<number>().as("n")).where("sent_at", "is", null).executeTakeFirst();
    const host = new URL(ports.config.publicBaseUrl).host;
    const shown = rows.map((r) => ({ ...r, received_at: new Date(r.received_at).toISOString() }));
    await ports.mailer!.send({ to, ...digestMessage(shown, Number(unsent?.n ?? 0) - rows.length, host) });
    await trx
      .updateTable("feedback")
      .set({ sent_at: new Date().toISOString() })
      .where("feedback_id", "in", rows.map((r) => r.feedback_id))
      .execute();
    return rows.length;
  });
}
