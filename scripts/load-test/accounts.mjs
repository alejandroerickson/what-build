#!/usr/bin/env node
// Synthetic people for a load test of a dev deployment (okf/operations/load-testing.md), never
// production: sessions a load test signs in with, and agents' access tokens, made straight in the
// database because a dev deployment's sign-in is a real identity provider's.
//
//   node scripts/load-test/accounts.mjs <folder> --base https://<the service's address> \
//     [--members 199] [--guests 25] [--agents 80]
//
// Writes into <folder>, readable only by you:
//   setup.sql     an organization of its own, `load-test-synthetic`, with an owner and the members
//                 (admins there, so each may hold a live stream on a product made in it); guest
//                 accounts in no organization; a session for each, and an access token to /mcp at the
//                 viewer level for the first agents members, all lasting two days
//   teardown.sql  removes every row setup.sql made, and what the test left under those accounts
//   tokens.json   the sessions and tokens, for scripts/load-test/load.js
// Apply them with psql as the deployment's database role. Every address is at example.com.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const folder = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : dflt;
};
const base = opt("base", "");
if (!folder || folder.startsWith("--") || !/^https?:\/\/[^/]+$/.test(base)) {
  console.error("usage: node scripts/load-test/accounts.mjs <folder> --base https://<the service's address> [--members 199] [--guests 25] [--agents 80]");
  process.exit(2);
}
const members = Number(opt("members", 199));
const guests = Number(opt("guests", 25));
const agents = Math.min(members, Number(opt("agents", 80)));

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let last = 0n;
/** A ULID, as the server's ids are; increasing, so two made in the same millisecond differ. */
function ulid() {
  let n = (BigInt(Date.now()) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`);
  if (n <= last) n = last + 1n;
  last = n;
  let s = "";
  for (let i = 25; i >= 0; i--) s += B32[Number((n >> BigInt(5 * i)) & 31n)];
  return s;
}
const token = () => randomBytes(32).toString("base64url");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const SLUG = "load-test-synthetic";
const tenant = ulid();
const owner = { kind: "owner", id: ulid(), email: "load-test-owner@example.com", name: "Load test owner" };
const actor = JSON.stringify({ client: null, surface: "web", account_id: owner.id, display_name: owner.name });
const people = [owner];
for (let i = 1; i <= members; i++) people.push({ kind: "member", id: ulid(), email: `load-test-m${String(i).padStart(3, "0")}@example.com`, name: `Load test member ${i}` });
for (let i = 1; i <= guests; i++) people.push({ kind: "guest", id: ulid(), email: `load-test-g${String(i).padStart(3, "0")}@example.com`, name: `Load test guest ${i}` });
const client = ulid();

const sql = ["BEGIN;"];
const out = { base, organization: SLUG, owner: "", members: [], guests: [], agents: [] };
for (const p of people)
  sql.push(`INSERT INTO accounts (account_id, email, display_name, email_verified_at, hide_example, tutorials_off) VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.name)}, now(), false, true);`);
sql.push(`INSERT INTO tenants (tenant_id, slug, name, plan, status, created_by, example) VALUES (${q(tenant)}, ${q(SLUG)}, 'Load test (synthetic)', 'unlimited', 'active', ${q(actor)}::jsonb, false);`);
for (const p of people) {
  if (p.kind !== "guest")
    sql.push(`INSERT INTO memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_by) VALUES (${q(ulid())}, ${q(tenant)}, 'tenant', ${q(tenant)}, ${q(p.id)}, ${q(p.kind === "owner" ? "owner" : "admin")}, ${q(actor)}::jsonb);`);
  const t = token();
  sql.push(`INSERT INTO sessions (session_hash, account_id, expires_at, user_agent, legacy_cookie) VALUES (${q(hash(t))}, ${q(p.id)}, now() + interval '2 days', 'whatbuild-load-test', false);`);
  if (p.kind === "owner") out.owner = t;
  else out[p.kind === "member" ? "members" : "guests"].push(t);
}
sql.push(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (${q(client)}, 'Load test (synthetic)', '[]'::jsonb);`);
for (const p of people.filter((x) => x.kind === "member").slice(0, agents)) {
  const t = token();
  sql.push(
    `INSERT INTO oauth_tokens (token_hash, kind, client_id, account_id, resource, scope, family_id, expires_at, level, feedback) VALUES (${q(hash(t))}, 'access', ${q(client)}, ${q(p.id)}, ${q(`${base}/mcp`)}, 'whatbuild', ${q(ulid())}, now() + interval '2 days', 'viewer', false);`,
  );
  out.agents.push(t);
}
sql.push("COMMIT;");

const ids = people.map((p) => q(p.id)).join(",");
const teardown = `-- Run after the organization ${SLUG} and anything made in it are deleted through the app's API
-- (okf/operations/load-testing.md); with nothing made in it, this deletes the organization too.
BEGIN;
DELETE FROM oauth_tokens WHERE client_id = ${q(client)} OR account_id IN (${ids});
DELETE FROM oauth_codes WHERE client_id = ${q(client)} OR account_id IN (${ids});
DELETE FROM oauth_clients WHERE client_id = ${q(client)};
DELETE FROM sessions WHERE account_id IN (${ids});
DELETE FROM guest_passes WHERE account_id IN (${ids});
DELETE FROM limit_counters WHERE account_id IN (${ids}) OR tenant_id = ${q(tenant)};
DELETE FROM memberships WHERE tenant_id = ${q(tenant)} OR account_id IN (${ids});
DELETE FROM tenants WHERE tenant_id = ${q(tenant)} AND NOT EXISTS (SELECT 1 FROM products WHERE tenant_id = ${q(tenant)});
DELETE FROM accounts WHERE account_id IN (${ids}) AND email LIKE 'load-test-%@example.com';
COMMIT;
`;

mkdirSync(folder, { recursive: true, mode: 0o700 });
writeFileSync(join(folder, "setup.sql"), sql.join("\n") + "\n", { mode: 0o600 });
writeFileSync(join(folder, "teardown.sql"), teardown, { mode: 0o600 });
writeFileSync(join(folder, "tokens.json"), JSON.stringify(out), { mode: 0o600 });
console.log(`${people.length} accounts (${members} members, ${guests} guests), ${agents} agent tokens, in ${folder}`);
