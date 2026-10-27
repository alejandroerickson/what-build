import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { AppError, invalid, tooLarge, type GrantSigner, type Mailer, type UrlFetcher } from "@whatbuild/core";

// ---- Grants ---------------------------------------------------------------------------------------

/**
 * Upload and download grants: base64url(payload) "." base64url(HMAC-SHA256). The MAC is computed
 * over the received payload bytes before parsing, so a re-serialized claim set can never carry a
 * foreign signature. Every replica holds the same key, so any replica verifies any grant.
 */
export class HmacGrantSigner implements GrantSigner {
  constructor(private readonly key: string) {}
  sign(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", this.key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }
  verify(token: string): Record<string, unknown> | null {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", this.key).update(body).digest();
    let given: Buffer;
    try {
      given = Buffer.from(mac, "base64url");
    } catch {
      return null;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
      if (typeof payload["exp"] !== "number" || payload["exp"] * 1000 < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

// ---- Mail -----------------------------------------------------------------------------------------

/** Development: print the message, so sign-in links appear in the terminal. */
export class ConsoleMailer implements Mailer {
  async send(m: { to: string; subject: string; text: string }) {
    console.log(`\n── mail to ${m.to} ──\n${m.subject}\n\n${m.text}\n──────────────\n`);
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  async send(m: { to: string; subject: string; text: string }) {
    this.sent.push(m);
  }
}

export class SmtpMailer implements Mailer {
  private transport: Promise<{ sendMail: (m: object) => Promise<unknown> }>;
  constructor(url: string, private readonly from: string) {
    this.transport = import("nodemailer").then((nm) => nm.default.createTransport(url));
  }
  async send(m: { to: string; subject: string; text: string }) {
    await (await this.transport).sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}

// ---- URL fetch --------------------------------------------------------------------------------------

/**
 * Addresses a fetch never reaches. IPv4: every special-purpose range (this network, private,
 * shared address space, loopback, link-local, protocol assignments, documentation, benchmarking,
 * the 6to4 relay, multicast, reserved and broadcast). IPv6: everything outside global unicast
 * (2000::/3), which takes in the unspecified and loopback addresses, IPv4-mapped and -compatible
 * addresses, NAT64, discard-only, unique local, link-local, site-local and multicast; and, inside
 * it, the protocol assignments (Teredo among them), documentation and 6to4. The lists are kept
 * apart because a BlockList checks an IPv4 address against IPv6 ranges in its mapped form, which
 * ::/3 would take in.
 */
const NON_PUBLIC_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const)
  NON_PUBLIC_V4.addSubnet(net, prefix, "ipv4");
const NON_PUBLIC_V6 = new BlockList();
for (const [net, prefix] of [["::", 3], ["4000::", 2], ["8000::", 1], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const)
  NON_PUBLIC_V6.addSubnet(net, prefix, "ipv6");

/** Whether an address may be fetched from: an IP address outside every range above. Anything else, a name or an address with a zone, is not. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (!family || ip.includes("%")) return false;
  return family === 4 ? !NON_PUBLIC_V4.check(ip, "ipv4") : !NON_PUBLIC_V6.check(ip, "ipv6");
}

/**
 * The address a URL names directly, or null when it names a host. The URL parser has already
 * turned every IPv4 notation (decimal, octal, hex, shortened) into dotted form; IPv6 keeps its
 * brackets. Node connects to an address without asking the lookup, so it is checked before.
 */
export function ipLiteral(url: URL): string | null {
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return isIP(host) ? host : null;
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

/**
 * The DNS lookup for outbound fetches: it only ever yields public addresses, and refuses a name if
 * any of its addresses is private, so a name cannot be steered to an internal host. It answers in
 * both shapes Node asks for: one address, or with `all` (as Node's happy-eyeballs connect asks) the
 * list of `{address, family}`. Checking here, rather than before the request, checks the address
 * actually connected to.
 */
export function publicOnlyLookup(resolve: Resolver = (h) => lookup(h, { all: true }), isPublic: (ip: string) => boolean = isPublicAddress): LookupFunction {
  return (hostname, options, callback) => {
    const fail = (message: string, code: string) => {
      const err = Object.assign(new Error(message), { code, hostname }) as NodeJS.ErrnoException;
      if (options.all) callback(err, []);
      else callback(err, "", 4);
    };
    resolve(hostname)
      .then((addrs) => {
        if (addrs.some((a) => !isPublic(a.address))) return fail(`${hostname} resolves to a non-public address, which is never fetched`, "EACCES");
        const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : (options.family ?? 0);
        const usable = family ? addrs.filter((a) => a.family === family) : addrs;
        const firstUsable = usable[0];
        if (!firstUsable) return fail(`${hostname} has no ${family ? `IPv${family} ` : ""}address`, "ENOTFOUND");
        if (options.all) callback(null, usable.map((a) => ({ address: a.address, family: a.family })));
        else callback(null, firstUsable.address, firstUsable.family);
      })
      .catch((e: NodeJS.ErrnoException) => fail(`${hostname} could not be resolved: ${e.code ?? e.message}`, e.code ?? "ENOTFOUND"));
  };
}

/** Sends one GET: `https.request`, or in tests a stand-in that reaches a local server. */
export type Requester = (url: URL, options: RequestOptions, onResponse: (res: IncomingMessage) => void) => ClientRequest;

export interface SafeUrlFetcherOptions {
  /** The DNS lookup every connection uses. */
  lookup?: LookupFunction;
  /** The whole fetch, every redirect included, in milliseconds. */
  deadlineMs?: number;
  /** The longest wait for the next bytes, in milliseconds. */
  idleMs?: number;
  request?: Requester;
}

/** One answer for every way a fetch fails on the network, so a failure says nothing about what lies behind the server. */
const unreachable = () =>
  invalid(
    "fetch_failed",
    'Couldn’t fetch that URL: no public HTTPS server answered in time with a valid certificate. Check the address, or download the file and upload it with attachments_write(action="request_upload").',
  );

type Hop = { redirect?: string; headers: Record<string, string | string[] | undefined>; body?: Uint8Array };

/** A file name as an address or a server's header gives it: decoded, or as it came when its escapes do not decode. */
function decodedOrAsIs(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * HTTPS only, public addresses only — an address written in the URL checked before connecting, a
 * name checked on the address actually connected to, and both again on every redirect — with a
 * size cap, an idle timeout, a deadline for the whole fetch, and no credentials forwarded.
 */
export class SafeUrlFetcher implements UrlFetcher {
  private readonly lookup: LookupFunction;
  private readonly deadlineMs: number;
  private readonly idleMs: number;
  private readonly send: Requester;

  constructor(options: SafeUrlFetcherOptions = {}) {
    this.lookup = options.lookup ?? publicOnlyLookup();
    this.deadlineMs = options.deadlineMs ?? 60_000;
    this.idleMs = options.idleMs ?? 30_000;
    this.send = options.request ?? ((url, opts, onResponse) => request(url, opts, onResponse));
  }

  async fetch(url: string, maxBytes: number) {
    const deadline = Date.now() + this.deadlineMs;
    let current = new URL(url);
    for (let hop = 0; hop < 5; hop++) {
      if (current.protocol !== "https:") throw invalid("unsafe_url", "Only https:// URLs can be fetched.");
      if (current.username || current.password) throw invalid("unsafe_url", "URLs with credentials can’t be fetched.");
      const literal = ipLiteral(current);
      if (literal !== null && !isPublicAddress(literal))
        throw invalid("unsafe_url", "Only public addresses are fetched: this URL, or one it redirected to, names a private, local or reserved address.");
      let res: Hop;
      try {
        res = await this.once(current, maxBytes, deadline);
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw unreachable();
      }
      if (res.redirect) {
        current = new URL(res.redirect, current);
        continue;
      }
      const disposition = res.headers["content-disposition"];
      const fromHeader = typeof disposition === "string" ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] : undefined;
      const fromPath = decodedOrAsIs(current.pathname.split("/").filter(Boolean).pop() ?? "");
      const fileName = (fromHeader ? decodedOrAsIs(fromHeader) : fromPath || "download").replace(/[\\/]/g, "_").slice(0, 150);
      const ct = res.headers["content-type"];
      return { bytes: res.body!, fileName, mediaType: typeof ct === "string" ? ct.split(";")[0]!.trim() : null };
    }
    throw invalid("fetch_failed", "Too many redirects.");
  }

  private once(url: URL, maxBytes: number, deadline: number): Promise<Hop> {
    return new Promise((resolvePromise, rejectPromise) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const settle = () => {
        settled = true;
        clearTimeout(timer);
        return true;
      };
      const resolve = (hop: Hop) => !settled && settle() && resolvePromise(hop);
      const reject = (e: unknown) => !settled && settle() && rejectPromise(e);
      const req = this.send(url, { method: "GET", timeout: this.idleMs, headers: { "User-Agent": "WhatBuild-fetch/1", Accept: "*/*" }, lookup: this.lookup }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: res.headers.location, headers: res.headers });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(invalid("fetch_failed", `The server answered ${status}.`, { status }));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? NaN);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(tooLarge(`The document is ${declared} bytes; fetching is limited to ${maxBytes}.`, { limit: maxBytes }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(tooLarge(`The document is larger than ${maxBytes} bytes.`, { limit: maxBytes }));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ headers: res.headers, body: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", reject);
        res.on("close", () => reject(new Error("the response ended early")));
      });
      // However steadily a server trickles bytes, the fetch ends at its deadline.
      timer = setTimeout(() => req.destroy(new Error("deadline")), Math.max(0, deadline - Date.now()));
      req.on("timeout", () => req.destroy(new Error("idle")));
      req.on("error", reject);
      req.end();
    });
  }
}
