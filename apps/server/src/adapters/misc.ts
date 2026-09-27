import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { invalid, tooLarge, type GrantSigner, type Mailer, type UrlFetcher } from "@whatbuild/core";

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

function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return false;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("ff")) return false;
  // IPv4-mapped (::ffff:a.b.c.d, or its hex form ::ffff:7f00:1) and IPv4-compatible (::a.b.c.d).
  const mapped = v6.match(/^::(?:ffff:)?(.+)$/)?.[1];
  if (mapped) {
    if (isIP(mapped) === 4) return isPublicAddress(mapped);
    const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex && v6.startsWith("::ffff:")) {
      const [hi, lo] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return true;
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

/**
 * HTTPS only, public addresses only — checked on the address actually connected to, and again on
 * every redirect — with size and time caps and no credentials forwarded.
 */
export class SafeUrlFetcher implements UrlFetcher {
  constructor(private readonly lookup: LookupFunction = publicOnlyLookup()) {}

  async fetch(url: string, maxBytes: number) {
    let current = new URL(url);
    for (let hop = 0; hop < 5; hop++) {
      if (current.protocol !== "https:") throw invalid("unsafe_url", "Only https:// URLs can be fetched.");
      if (current.username || current.password) throw invalid("unsafe_url", "URLs with credentials cannot be fetched.");
      const res = await this.once(current, maxBytes);
      if (res.redirect) {
        current = new URL(res.redirect, current);
        continue;
      }
      const disposition = res.headers["content-disposition"];
      const fromHeader = typeof disposition === "string" ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] : undefined;
      const fromPath = decodeURIComponent(current.pathname.split("/").filter(Boolean).pop() ?? "");
      const fileName = (fromHeader ? decodeURIComponent(fromHeader) : fromPath || "download").replace(/[\\/]/g, "_").slice(0, 150);
      const ct = res.headers["content-type"];
      return { bytes: res.body!, fileName, mediaType: typeof ct === "string" ? ct.split(";")[0]!.trim() : null };
    }
    throw invalid("fetch_failed", "Too many redirects.");
  }

  private once(url: URL, maxBytes: number): Promise<{ redirect?: string; headers: Record<string, string | string[] | undefined>; body?: Uint8Array }> {
    return new Promise((resolvePromise, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          timeout: 30_000,
          headers: { "User-Agent": "WhatBuild-fetch/1", Accept: "*/*" },
          lookup: this.lookup,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            resolvePromise({ redirect: res.headers.location, headers: res.headers });
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            reject(new Error(`the server answered ${status}`));
            return;
          }
          const declared = Number(res.headers["content-length"] ?? NaN);
          if (Number.isFinite(declared) && declared > maxBytes) {
            res.destroy();
            reject(tooLarge(`The document is ${declared} bytes; fetching is limited to ${maxBytes}.`));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              res.destroy();
              reject(tooLarge(`The document is larger than ${maxBytes} bytes.`));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolvePromise({ headers: res.headers, body: new Uint8Array(Buffer.concat(chunks)) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timed out after 30 seconds")));
      req.on("error", reject);
      req.end();
    });
  }
}
