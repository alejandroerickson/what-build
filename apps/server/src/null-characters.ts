import { invalid, nullCharacterPaths, OPERATIONS, wordList } from "@whatbuild/core";
import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { restPath } from "./rest.ts";

/**
 * A null character (U+0000) in a request is refused here, once, ahead of every route: Postgres keeps
 * no such character in text, and a file path cannot hold one. It looks in the path, the query and a
 * form's fields of every request, and in the JSON body of every route but three kinds: an
 * operation's, whose input check names each field beside the schema's own refusals (`parseInput`),
 * and the MCP endpoint's and the upload relay's, which read their bodies as they came and whose
 * bytes are not text to refuse. A field a route cleans of control characters on purpose is left to
 * it (CLEANED). A field is named as an operation names it: a query field or a form field by its
 * key, a path segment by the parameter its route gives it, a JSON field by its path.
 */

/** Each registry operation's REST route, as Hono records a matched route: its method and its pattern. */
const OPERATION_ROUTES = new Set(OPERATIONS.map((op) => `${op.rest.method} ${restPath(op)}`));

/** Routes that read the body as it came, which a check here must not read first. */
const RAW_BODY = /^\/(?:mcp(?:\/|$)|api\/v1\/uploads\/)/;

/**
 * JSON fields a route cleans of control characters itself, on purpose, rather than refusing them:
 * a client registering for MCP names itself, and keeps its name's printable characters.
 */
const CLEANED: Record<string, string[]> = { "/oauth/register": ["client_name"] };

const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const hasNul = (s: string) => s.includes("\u0000");

/** The parameter a matched route names the path segment at `index` by, from the first that names one there. */
function segmentName(patterns: string[], index: number): string | null {
  for (const p of patterns) {
    const m = /^:([A-Za-z0-9_]+)/.exec(p.split("/")[index] ?? "");
    if (m) return m[1]!;
  }
  return null;
}

/** The fields of a request that hold a null character, by name, and whether a part of its address no route names does. */
async function nullFields(c: Context): Promise<{ fields: string[]; address: boolean }> {
  const fields: string[] = [];
  let address = false;
  const url = new URL(c.req.url);
  const routes = matchedRoutes(c);
  const segments = url.pathname.split("/");
  segments.forEach((raw, i) => {
    if (!hasNul(decoded(raw))) return;
    const name = segmentName(routes.map((r) => r.path), i);
    if (name) fields.push(name);
    else address = true;
  });
  for (const [key, value] of url.searchParams) {
    if (hasNul(key)) address = true;
    else if (hasNul(value)) fields.push(key);
  }
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) || RAW_BODY.test(url.pathname)) return { fields, address };
  const type = c.req.header("content-type") ?? "";
  if (/^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(type)) {
    const form = await c.req.parseBody({ all: true }).catch(() => ({}) as Record<string, unknown>);
    for (const [key, value] of Object.entries(form)) if ((Array.isArray(value) ? value : [value]).some((v) => typeof v === "string" && hasNul(v)) || hasNul(key)) fields.push(key);
  } else if (/^application\/json/i.test(type) && !routes.some((r) => OPERATION_ROUTES.has(`${r.method} ${r.path}`))) {
    const body: unknown = await c.req.json().catch(() => undefined);
    const cleaned = CLEANED[url.pathname] ?? [];
    for (const p of nullCharacterPaths(body)) if (!cleaned.includes(String(p[0]))) fields.push(p.length ? p.join(".") : "body");
  }
  return { fields: [...new Set(fields)], address };
}

/** The refusal, worded as an operation's: `422 invalid_input`, naming each field, or the address. */
function refusal(fields: string[], address: boolean) {
  const names = [...fields.map((f) => `\`${f}\``), ...(address ? ["the address"] : [])];
  const said = wordList(names);
  return invalid(
    "invalid_input",
    `${said[0]!.toUpperCase() === said[0] ? said : said[0]!.toUpperCase() + said.slice(1)} ${names.length === 1 ? "holds" : "hold"} a null character (U+0000), which WhatBuild cannot store or search: take it out. Nothing was changed; correct the call and send it again.`,
    { fields },
  );
}

export function refuseNullCharacters(): MiddlewareHandler {
  return async (c, next) => {
    const { fields, address } = await nullFields(c);
    if (fields.length || address) return c.json({ error: refusal(fields, address).toJSON() }, 422);
    return next();
  };
}
