import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { E2E_DIR, e2eBaseUrl, record } from "./e2e.ts";

/**
 * `pnpm e2e mcp <command>`: the end-to-end instance's MCP server, called the way an agent calls it.
 * The connection is a real one: the client registers itself, the person signs in and allows it on
 * the consent page, and the code is exchanged with PKCE, as any MCP client does; only the clicks
 * are made here. Each person's token is kept in .what-build/e2e/mcp/ and made again when a reset
 * forgets it.
 */
const TOKENS = join(E2E_DIR, "mcp");
const PEOPLE: Record<string, string> = { riley: "riley@example.com", sam: "sam@example.com", jordan: "jordan@example.com" };
const REDIRECT = "http://127.0.0.1:9/callback";

const HELP = `pnpm e2e mcp <command> [--as riley|sam|jordan|<email>] [--endpoint /mcp/t/<org>[/<team>/<product>]] [--level viewer|editor|admin]

  connect                 connect as that person (sam by default) through OAuth, as an agent would,
                          at the level chosen on the consent page (editor, Edit, unless --level says)
  info                    the server's name, version and instructions
  tools [--full]          the tools and their descriptions (--full adds each input schema)
  call <tool> '<json>'    call a tool with these arguments, and print its result
                          e.g. call products '{"action":"list"}'
                               call story '{"action":"get_page","product":"harbor-labs/product-team/crewboard","params":{"page_id":"overview"}}'
                          Grouped tools take action, params (the action's fields), describe and product;
                          call <tool> '{"action":"…","describe":true}' prints an action's schema.
                               call search '{"query":"gate code","product":"harbor-labs/product-team/crewboard"}'

A call connects first when it needs to. The endpoint defaults to /mcp (everything the person can reach).`;

type Level = "viewer" | "editor" | "admin";
type Saved = { email: string; endpoint: string; level: Level; client_id: string; access_token: string; expires_at: number };

function option(args: string[], flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** The cookies a response sets, leaving out the ones it clears (over HTTPS, signing in clears the session cookie's old name). */
const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((c) => !c.endsWith("="))
    .join("; ");
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Register, sign in, allow on the consent page at a level, and exchange the code: the whole OAuth connection. */
async function connect(email: string, endpoint: string, level: Level): Promise<Saved> {
  const base = e2eBaseUrl();
  const fail = async (step: string, res: Response) => new Error(`MCP connection failed at ${step}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const reg = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "WhatBuild end-to-end agent", redirect_uris: [REDIRECT] }) });
  if (!reg.ok) throw await fail("registration", reg);
  const { client_id } = (await reg.json()) as { client_id: string };

  const signin = await fetch(`${base}/auth/dev-sign-in`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email }) });
  if (!signin.ok) throw await fail("the development sign-in", signin);
  const session = cookiesOf(signin);

  const { verifier, challenge } = pkce();
  const resource = `${base}${endpoint}`;
  const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: randomBytes(8).toString("hex"), resource });
  const consent = await fetch(`${base}/oauth/authorize?${q}`, { headers: { cookie: session }, redirect: "manual" });
  if (consent.status !== 200) throw await fail("the consent page", consent);
  const html = await consent.text();
  const form = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) form.set(decode(m[1]!), decode(m[2]!));
  form.set("decision", "allow");
  form.set("level", level);
  const allow = await fetch(`${base}/oauth/authorize`, { method: "POST", headers: { cookie: `${session}; ${cookiesOf(consent)}`, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: form, redirect: "manual" });
  const code = new URL(allow.headers.get("location") ?? REDIRECT).searchParams.get("code");
  if (!code) throw await fail("Allow", allow);

  const token = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id, code_verifier: verifier, resource }) });
  if (!token.ok) throw await fail("the token exchange", token);
  const t = (await token.json()) as { access_token: string; expires_in: number };
  const saved: Saved = { email, endpoint, level, client_id, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
  mkdirSync(TOKENS, { recursive: true });
  writeFileSync(tokenFile(email, endpoint, level), JSON.stringify(saved), { mode: 0o600 });
  return saved;
}

const tokenFile = (email: string, endpoint: string, level: Level) => join(TOKENS, `${email}${endpoint.replace(/\//g, "_")}.${level}.json`);

async function session(email: string, endpoint: string, level: Level, fresh = false) {
  const file = tokenFile(email, endpoint, level);
  let saved = !fresh && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Saved) : null;
  if (!saved || saved.expires_at < Date.now()) saved = await connect(email, endpoint, level);
  const client = new Client({ name: "whatbuild-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${e2eBaseUrl()}${endpoint}`), { requestInit: { headers: { Authorization: `Bearer ${saved.access_token}` } } });
  await client.connect(transport);
  return client;
}

/** A session, connecting again once if the token was forgotten (a reset to the golden master forgets every token). */
async function withClient<T>(email: string, endpoint: string, level: Level, fn: (c: Client) => Promise<T>): Promise<T> {
  let client: Client;
  try {
    client = await session(email, endpoint, level);
  } catch (e) {
    if (!/401|Unauthorized|invalid_token/i.test(String(e))) throw e;
    client = await session(email, endpoint, level, true);
  }
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function mcpCommand(args: string[]) {
  const [cmd, tool, raw] = args.filter((a, i) => !a.startsWith("--") && !["--as", "--endpoint", "--level"].includes(args[i - 1] ?? ""));
  if (!cmd || cmd === "help") return console.log(HELP);
  const who = option(args, "--as") ?? "sam";
  const email = PEOPLE[who.toLowerCase()] ?? who;
  const endpoint = option(args, "--endpoint") ?? "/mcp";
  const level = (option(args, "--level") ?? "editor") as Level;
  if (!["viewer", "editor", "admin"].includes(level)) throw new Error(`--level is viewer, editor or admin, not ${level}.`);

  if (cmd === "connect") {
    const s = await connect(email, endpoint, level);
    record({ surface: "mcp", as: email, command: ["connect", endpoint, level], ok: true });
    return console.log(`Connected as ${s.email} to ${e2eBaseUrl()}${s.endpoint}, at ${s.level}.`);
  }
  if (cmd === "info")
    return withClient(email, endpoint, level, async (c) => {
      console.log(JSON.stringify({ server: c.getServerVersion(), instructions: c.getInstructions() }, null, 2));
    });
  if (cmd === "tools")
    return withClient(email, endpoint, level, async (c) => {
      for (const t of (await c.listTools()).tools) {
        console.log(`## ${t.name}\n${t.description ?? ""}`);
        if (args.includes("--full")) console.log(JSON.stringify(t.inputSchema, null, 2));
        console.log("");
      }
    });
  if (cmd === "call") {
    if (!tool) throw new Error("Name a tool: pnpm e2e mcp call <tool> '<json>'");
    let input: Record<string, unknown>;
    try {
      input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`The arguments are not JSON: ${raw}`);
    }
    return withClient(email, endpoint, level, async (c) => {
      const res = (await c.callTool({ name: tool, arguments: input })) as { isError?: boolean; content: { type: string; text?: string }[] };
      const text = res.content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
      const pretty = (() => {
        try {
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          return text;
        }
      })();
      record({ surface: "mcp", as: email, endpoint, command: ["call", tool, input], ok: !res.isError, result: pretty.slice(0, 2000) });
      if (res.isError) {
        console.error("error result:");
        console.log(pretty);
        process.exitCode = 1;
      } else console.log(pretty);
    });
  }
  throw new Error(`Unknown command ${cmd}.\n\n${HELP}`);
}
