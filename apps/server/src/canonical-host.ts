import type { MiddlewareHandler } from "hono";
import type { ServerConfig } from "./config.ts";

/**
 * Paths that answer machines on whatever host they are reached by: probes, the REST API with its
 * upload and download grants, the MCP endpoints, the OAuth endpoints and the metadata clients read
 * beside them. Never redirected, so no probe, agent or client is turned away by a host name. A
 * prototype's documents (prototype.ts) and the content site's (content-documents.ts) are a frame's
 * or a tab's navigations, answered where the grant points.
 */
const MACHINE_PATHS = /^\/(health|api|mcp|oauth|\.well-known|prototypes|documents)(\/|$)/;

/** Hosts on this machine: a local server, a local copy of a deployment, the development server. */
const LOOPBACK = /^(localhost|[^:]+\.localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?$/;

/** The host the browser asked for: a proxy in front (the Cloudflare Worker) names it in X-Forwarded-Host. */
export function requestedHost(header: (name: string) => string | undefined): string {
  return (header("x-forwarded-host") ?? header("host") ?? "").split(",")[0]!.trim().toLowerCase();
}

/**
 * One address for the app: a browser that opens a page on any other name for this deployment (Cloud
 * Run's run.app address, Container Apps' default host, an earlier domain still pointed here) is sent
 * to the same path and query on WHATBUILD_PUBLIC_URL, where its session, sign-in and links live.
 *
 * Only a page load moves: GET or HEAD that the browser marks as a navigation (Sec-Fetch-Mode), on a
 * path that is not a machine's. Probes, agents and API clients send no such header and are answered
 * where they asked. The redirect is temporary, so a browser keeps no record of it; it is off when
 * the public URL is a loopback address (a deployment not yet told its address), on a loopback host,
 * on the public site's host, and when WHATBUILD_REDIRECT_TO_PUBLIC_URL is 0 (for a proxy that sends
 * its own host name and no X-Forwarded-Host, which would otherwise send browsers round in a loop).
 */
export function canonicalHost(config: ServerConfig): MiddlewareHandler {
  const target = new URL(config.publicBaseUrl);
  const site = config.siteUrl ? new URL(config.siteUrl).host.toLowerCase() : null;
  const content = config.contentUrl ? new URL(config.contentUrl).host.toLowerCase() : null;
  const off = !config.redirectToPublicUrl || LOOPBACK.test(target.host);
  return async (c, next) => {
    if (off || (c.req.method !== "GET" && c.req.method !== "HEAD") || c.req.header("sec-fetch-mode") !== "navigate" || MACHINE_PATHS.test(c.req.path)) return next();
    const host = requestedHost((name) => c.req.header(name));
    if (!host || host === target.host.toLowerCase() || LOOPBACK.test(host) || (site && (host === site || host === `www.${site}`)) || host === content) return next();
    const url = new URL(c.req.url);
    return c.redirect(`${config.publicBaseUrl}${url.pathname}${url.search}`, 302);
  };
}
