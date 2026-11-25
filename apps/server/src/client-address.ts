import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { Context } from "hono";
import type { ServerConfig } from "./config.ts";
import { carriesEdgeKey } from "./edge-key.ts";

/**
 * The header the proxy in front (deploy/cloudflare/worker.js) names the client's address in: the
 * address Cloudflare saw the request come from (CF-Connecting-IP), which nobody else can set there.
 */
export const CLIENT_ADDRESS_HEADER = "X-WhatBuild-Client-Address";

/**
 * The address a request came from, where the service can trust it: only on a request that carries
 * the edge key (WHATBUILD_EDGE_KEY), whose proxy replaces whatever a client sent in the header.
 * Anywhere else (no edge key, as in local development, on the dev deployment or behind another
 * proxy) it is null, and only the deployment's ceilings count (`abuse-limits.ts`).
 */
export function clientAddress(c: Context, config: Pick<ServerConfig, "edgeKey">): string | null {
  if (!config.edgeKey || !carriesEdgeKey(c, config.edgeKey)) return null;
  const given = c.req.header(CLIENT_ADDRESS_HEADER)?.trim() ?? "";
  return isIPv4(given) || isIPv6(given) ? given : null;
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

/**
 * What one client is counted as: an IPv4 address whole, and an IPv6 address by its first 64 bits,
 * since one subscriber is given a whole /64 and can use any address in it. An IPv4 address written as
 * IPv6 (::ffff:192.0.2.1) is the IPv4 address.
 */
export function clientOf(address: string): string {
  if (isIPv4(address)) return address;
  const groups = groupsOf(address);
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const [hi, lo] = [parseInt(groups[6]!, 16), parseInt(groups[7]!, 16)];
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * The key a client's counts are kept under: a hash of who it is counted as, keyed with a secret
 * derived from the grant key, so the table never holds an address and nobody who reads it can test
 * one. Null when the address is not known.
 */
export function clientKey(address: string | null, grantKey: string): string | null {
  if (!address) return null;
  const secret = createHmac("sha256", grantKey).update("whatbuild client addresses").digest();
  return createHmac("sha256", secret).update(clientOf(address)).digest("base64url").slice(0, 32);
}
