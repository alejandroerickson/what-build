import type { Db } from "./db.ts";
import type { Principal } from "./registry.ts";

/**
 * When an account first came back: its first call to an operation, from the web app or an agent, on
 * a later UTC day than the one it was made (`accounts.returned_at`), kept once. The landing pages
 * are compared by it, with which page and button the account came from
 * (okf/operations/analytics.md#the-landing-page-funnel). Each process asks at most once a day for
 * each account, and the call is never delayed or failed by it.
 */

/** The UTC day each account was last asked about, by this process. */
const asked = new Map<string, string>();
const writing = new Set<Promise<void>>();
let lastWarned = 0;
/** Past this many accounts, the days before today are forgotten. */
const ASKED_MAX = 10_000;

export function noteReturn(db: Db, principal: Pick<Principal, "account_id" | "auth_kind">, now = new Date()): void {
  if (principal.auth_kind === "system" || principal.auth_kind === "dev") return;
  const day = now.toISOString().slice(0, 10);
  if (asked.get(principal.account_id) === day) return;
  if (asked.size >= ASKED_MAX) for (const [id, d] of asked) if (d !== day) asked.delete(id);
  asked.set(principal.account_id, day);
  const write = db
    .updateTable("accounts")
    .set({ returned_at: now.toISOString() })
    .where("account_id", "=", principal.account_id)
    .where("returned_at", "is", null)
    .where("created_at", "<", `${day}T00:00:00.000Z`)
    .execute()
    .then(
      () => undefined,
      (e: Error) => {
        if (Date.now() - lastWarned < 60_000) return;
        lastWarned = Date.now();
        console.error(`first return: not kept: ${e.message}`);
      },
    );
  writing.add(write);
  void write.finally(() => writing.delete(write));
}

/** Waits for every return being kept: before a test reads them, and before shutting down. */
export async function returnsSettled(): Promise<void> {
  while (writing.size) await Promise.all([...writing]);
}
