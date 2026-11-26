import { createHmac, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { ClientKeys } from "@whatbuild/core";
import type { Context } from "hono";
import type { ServerConfig } from "./config.ts";
import { carriesEdgeKey } from "./edge-key.ts";

/**
 * The header the proxy in front (deploy/cloudflare/worker.js) names the client's address in: the
 * address Cloudflare saw the request come from (CF-Connecting-IPv6, or else CF-Connecting-IP).
 */
export const CLIENT_ADDRESS_HEADER = "X-WhatBuild-Client-Address";

/**
 * The header beside it that proves the proxy named the address: an HMAC of the address keyed with
 * the edge key. A Worker older than the client address passes on every header a client sends, a
 * made-up address included, but no client knows the edge key to seal one; so the service never
 * trusts an address the proxy did not name, whichever of the two was deployed first.
 */
export const CLIENT_SEAL_HEADER = "X-WhatBuild-Client-Seal";

/** The seal on `address`, as the Worker makes it with the edge key. */
export function sealOf(address: string, edgeKey: string): string {
  return createHmac("sha256", edgeKey).update(`whatbuild client address ${address}`).digest("base64url");
}

/** The headers a proxy holding `edgeKey` sends to name `address`: for tests, and the abuse test. */
export function namedBy(edgeKey: string, address: string): Record<string, string> {
  return { [CLIENT_ADDRESS_HEADER]: address, [CLIENT_SEAL_HEADER]: sealOf(address, edgeKey) };
}

/** The servers that have said, once, that requests carry the edge key and no address. */
const told = new WeakSet<object>();

/**
 * The address a request came from, where the service can trust it: only on a request that carries
 * the edge key (WHATBUILD_EDGE_KEY) and an address sealed with it. Anywhere else (no edge key, as in
 * local development, on the dev deployment or behind another proxy) it is null, and only the
 * deployment's ceilings count (`abuse-limits.ts`). Called only where a limit per client applies.
 *
 * A request with the edge key and no sealed address means the Worker in front is older than the
 * service, and every limit per client is off: the server says so once, as an error, which the
 * log's alert mails (okf/operations/cloud-run.md, Abuse limits).
 */
export function clientAddress(c: Context, config: Pick<ServerConfig, "edgeKey">): string | null {
  if (!config.edgeKey || !carriesEdgeKey(c, config.edgeKey)) return null;
  const given = c.req.header(CLIENT_ADDRESS_HEADER)?.trim() ?? "";
  const seal = c.req.header(CLIENT_SEAL_HEADER)?.trim() ?? "";
  const expected = Buffer.from(sealOf(given, config.edgeKey));
  if ((isIPv4(given) || isIPv6(given)) && seal.length === expected.length && timingSafeEqual(Buffer.from(seal), expected)) return given;
  if (!told.has(config)) {
    told.add(config);
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        severity: "ERROR",
        event: "client_address_missing",
        path: c.req.path,
        message:
          "A request carried the edge key but no client address sealed with it, so the abuse limits per client are off and only the deployment's ceilings apply. Deploy the Cloudflare Worker from this release (okf/operations/cloud-run.md, Abuse limits). Said once for each instance.",
      }),
    );
  }
  return null;
}

/** An IPv6 address's eight groups, written out: "2001:db8::1" → ["2001", "db8", "0", …, "1"]. */
function groupsOf(v6: string): string[] {
  const [head, tail] = v6.toLowerCase().split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // An IPv4 address at the end takes two groups.
  const last = (right.length ? right : left).at(-1) ?? "";
  if (isIPv4(last)) {
    const [a, b, c, d] = last.split(".").map(Number) as [number, number, number, number];
    const groups = [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    (right.length ? right : left).splice(-1, 1, ...groups);
  }
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((g) => g.replace(/^0+(?=.)/, ""));
}

/** An IPv4 address written as IPv6 (::ffff:192.0.2.1), as the IPv4 address; null for any other. */
function mappedIPv4(groups: string[]): string | null {
  if (!(groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff")) return null;
  const [hi, lo] = [parseInt(groups[6]!, 16), parseInt(groups[7]!, 16)];
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * What one client is counted as: an IPv4 address whole, and an IPv6 address by its first 64 bits,
 * the network one subscriber's devices share. An IPv4 address written as IPv6 is the IPv4 address.
 */
export function clientOf(address: string): string {
  if (isIPv4(address)) return address;
  const groups = groupsOf(address);
  return mappedIPv4(groups) ?? `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * The /48 an IPv6 address is in, counted under limits of its own beside its /64's, since providers
 * commonly hand one customer a /56 or a /48 (and tunnel brokers hand anyone a /48), which would
 * otherwise be hundreds or thousands of clients. Null for an IPv4 address, which is counted whole.
 */
export function ipv6BlockOf(address: string): string | null {
  if (isIPv4(address)) return null;
  const groups = groupsOf(address);
  return mappedIPv4(groups) ? null : `${groups.slice(0, 3).join(":")}::/48`;
}

/**
 * The keys a client's counts are kept under: hashes of who it is counted as (and of its /48), keyed
 * with a secret derived from the grant key, so the table never holds an address and nobody who
 * reads it can test one. Null when the address is not known.
 */
export function clientKeys(address: string | null, grantKey: string): ClientKeys | null {
  if (!address) return null;
  const secret = createHmac("sha256", grantKey).update("whatbuild client addresses").digest();
  const key = (who: string) => createHmac("sha256", secret).update(who).digest("base64url").slice(0, 32);
  const block = ipv6BlockOf(address);
  return { address: key(clientOf(address)), ipv6_48: block ? key(block) : null };
}
