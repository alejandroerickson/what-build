import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "playwright-core";
import { currentRunDir, E2E_DIR, e2eBaseUrl, record } from "./e2e.ts";

/**
 * `pnpm e2e browser <command>`: a real browser an agent drives one command at a time, for any agent
 * that can run a shell. The first command starts a daemon that keeps the browser open, so the page,
 * its session and what went wrong in it last between commands. Elements are named the way people
 * and screen readers see them: by role and accessible name, or by label.
 */
const STATE = join(E2E_DIR, "browser.json");
const LOG = join(E2E_DIR, "browser.log");
const PEOPLE: Record<string, string> = {
  riley: "riley@example.com",
  sam: "sam@example.com",
  jordan: "jordan@example.com",
  // The synthetic organization's own people (e2e.ts).
  morgan: "morgan@example.com",
  casey: "casey@example.com",
  avery: "avery@example.com",
};

const HELP = `pnpm e2e browser <command>   (the browser starts with the first command, headless; start --headed to watch)

  open <path|url>                 go to a page of the app (/t/harbor-labs/…) or any URL; each
    [--header "Name: value"]      --header is sent with that request only (a Story preview's grant)
  signin <person|email>           sign in through the development sign-in, with the browser's
                                  storage cleared first, and open the overview
  signout                         forget the session and the browser's storage
  snapshot [<role> [name]]        the page's accessibility tree, or one region's (snapshot main): what to
                                  click and fill. The panel spans several landmarks (its navigation, its
                                  search box, its filters), so take the whole page when looking for a way
  click <role> <name>             click an element by role and accessible name (button, link, tab, …)
  click-text <text>               click the element showing this text
  fill <label> <value>            fill a field by its label
  select <label> <option>         choose an option in a select
  check <label> | uncheck <label> tick or clear a checkbox or radio
  press <key>                     press a key (Enter, Escape, ArrowRight, Control+k, …)
  upload <label> <file>           put a file into the file input with this label (or "file" for the first)
  wait <text> [ms]                wait until the text shows, visibly (default 10000 ms)
  wait-url <part> [ms]            wait until the address contains this (after a redirect in the app)
  screenshot [name] [--full]      save a screenshot into the run's shots/ folder (--full adds only what
                                  the document scrolls; the app scrolls its own panes, so scroll first)
  viewport <width> <height>       resize (390 844 is a phone)
  theme <light|dark>              switch the color scheme
  eval <javascript>               evaluate an expression in the page and print the result
  back | reload                   history back, or reload
  problems                        everything that went wrong since the last time you asked (! lines):
                                  console errors, uncaught exceptions, failed requests, 5xx responses,
                                  and a 4xx for a script, style, image or font; and, as · lines, the
                                  4xx the app's own requests and pages were answered with (a refusal
                                  the app shows as a message: 403, 404, 409, 410, …), which are not problems
  stop                            close the browser

Options: --nth <n> picks the nth match (from 0) when a name matches several; --exact matches the
name exactly. Every command prints where the page is, any new problems (!), and the refusals the
app was answered with (·).`;

/** What went wrong, or with `answered`, a refusal the app was answered with and shows itself: noted, not a problem. */
type Problem = { kind: string; text: string; url: string; answered?: true };

/** Chrome's own line for any response of 400 or more; the response itself says more, and whether it is a problem. */
const FAILED_TO_LOAD = /^Failed to load resource: the server responded with a status of \d{3}/;
/** Requests whose 4xx the app answers itself, with a message on the page: its calls, and pages the server writes. */
const APP_ANSWERS = new Set(["fetch", "xhr", "document"]);

const line = (p: Problem) => `${p.answered ? "·" : "!"} ${p.kind}: ${p.text}`;

async function daemon(headed: boolean) {
  const executablePath = process.env["CHROME"];
  const browser = await chromium.launch({ headless: !headed, ...(executablePath ? { executablePath } : { channel: "chrome" }) });
  const base = e2eBaseUrl();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: base });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(15000);
  const problems: Problem[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !FAILED_TO_LOAD.test(m.text())) problems.push({ kind: "console error", text: m.text(), url: page.url() });
  });
  page.on("pageerror", (e) => problems.push({ kind: "uncaught exception", text: e.message, url: page.url() }));
  page.on("requestfailed", (r) => {
    const failure = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(failure)) problems.push({ kind: "request failed", text: `${r.method()} ${r.url()} ${failure}`, url: page.url() });
  });
  page.on("response", (r) => {
    const status = r.status();
    const text = `${r.request().method()} ${r.url()}`;
    if (status >= 500) problems.push({ kind: `HTTP ${status}`, text, url: page.url() });
    else if (status >= 400 && APP_ANSWERS.has(r.request().resourceType())) problems.push({ kind: `HTTP ${status} (answered)`, text, url: page.url(), answered: true });
    else if (status >= 400) problems.push({ kind: `HTTP ${status}`, text, url: page.url() });
  });
  let reported = 0;
  const fresh = () => {
    const out = problems.slice(reported);
    reported = problems.length;
    return out;
  };

  // Only the command line may drive the browser: it reads this token from the state file, which only
  // its owner can read, and a web page cannot send the header without a preflight this never answers.
  const token = randomBytes(24).toString("hex");
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-e2e-token"] !== token) {
      res.statusCode = 403;
      res.end();
      return;
    }
    let body = "";
    req.on("data", (d: Buffer) => (body += d.toString()));
    req.on("end", () => {
      const { args } = JSON.parse(body || "{}") as { args: string[] };
      run(page, args, base)
        .then(async (text) => {
          if (args[0] === "stop") {
            res.end(JSON.stringify({ ok: true, text }));
            await browser.close();
            rmSync(STATE, { force: true });
            process.exit(0);
          }
          if (args[0] !== "eval" && args[0] !== "snapshot") await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
          res.end(JSON.stringify({ ok: true, text, url: page.url(), problems: args[0] === "problems" ? [] : fresh() }));
        })
        .catch((e: unknown) => res.end(JSON.stringify({ ok: false, text: e instanceof Error ? e.message.split("\n").slice(0, 12).join("\n") : String(e), url: page.url(), problems: fresh() })));
    });
  });

  async function run(page: Page, args: string[], base: string): Promise<string> {
    const flags = { nth: valueOf(args, "--nth"), exact: args.includes("--exact"), full: args.includes("--full") };
    const [cmd, a, b] = positional(args);
    const pick = (l: Locator) => (flags.nth !== undefined ? l.nth(Number(flags.nth)) : l);
    // The one element a command acts on, or a plain refusal saying how many matched, so a command
    // never fails quietly on a name that matches nothing or several things.
    const one = async (l: Locator, what: string) => {
      if (flags.nth !== undefined) return l.nth(Number(flags.nth));
      await l.first().waitFor({ state: "attached" }).catch(() => {});
      const n = await l.count();
      if (n === 0) throw new Error(`Nothing on the page matches ${what}. snapshot lists the roles, names and labels there are.`);
      if (n > 1) throw new Error(`${n} elements match ${what}. Add --exact for an exact name, or --nth <i> (from 0) to choose one.`);
      return l;
    };
    switch (cmd) {
      case "open": {
        const url = need(a, "a path or URL");
        const headers = Object.fromEntries(valuesOf(args, "--header").map((h) => [h.slice(0, h.indexOf(":")).trim(), h.slice(h.indexOf(":") + 1).trim()]));
        if (!Object.keys(headers).length) await page.goto(url);
        else {
          await page.setExtraHTTPHeaders(headers);
          await page.goto(url).finally(() => page.setExtraHTTPHeaders({}));
        }
        return `opened ${page.url()}`;
      }
      case "signin": {
        const email = PEOPLE[need(a, "a person (riley, sam, jordan, morgan, casey, avery) or an email").toLowerCase()] ?? a!;
        // A new person starts clean: the app keeps some state per browser (the last Story page, the
        // panel), which must not carry from one person to the next.
        await signedOut(page);
        const r = await page.context().request.post(`${base}/auth/dev-sign-in`, { data: { email }, headers: { Origin: base } });
        if (!r.ok()) throw new Error(`The development sign-in refused ${email}: ${r.status()} ${await r.text()}`);
        await page.goto("/");
        return `signed in as ${email}`;
      }
      case "signout":
        await signedOut(page);
        await page.goto("/");
        return "signed out";
      case "snapshot":
        return a ? pick(page.getByRole(a as never, b ? { name: b, exact: flags.exact } : {})).first().ariaSnapshot() : page.locator("body").ariaSnapshot();
      case "click":
        await (await one(page.getByRole(need(a, "a role") as never, { name: need(b, "a name"), exact: flags.exact }), `${a} "${b}"`)).click();
        return `clicked ${a} "${b}"`;
      case "click-text":
        await (await one(page.getByText(need(a, "the text"), { exact: flags.exact }), `the text "${a}"`)).click();
        return `clicked "${a}"`;
      case "fill":
        await (await one(page.getByLabel(need(a, "a label"), { exact: flags.exact }), `the label "${a}"`)).fill(b ?? "");
        return `filled "${a}"`;
      case "select":
        await (await one(page.getByLabel(need(a, "a label"), { exact: flags.exact }), `the label "${a}"`)).selectOption({ label: need(b, "an option") });
        return `selected "${b}" in "${a}"`;
      case "check":
      case "uncheck":
        await (await one(page.getByLabel(need(a, "a label"), { exact: flags.exact }), `the label "${a}"`)).setChecked(cmd === "check");
        return `${cmd}ed "${a}"`;
      case "press":
        await page.keyboard.press(need(a, "a key"));
        return `pressed ${a}`;
      case "upload": {
        const file = resolve(need(b, "a file"));
        const input = a === "file" ? page.locator('input[type="file"]') : page.getByLabel(need(a, "a label"), { exact: flags.exact });
        await pick(flags.nth === undefined ? input.first() : input).setInputFiles(file);
        return `put ${file} into "${a}"`;
      }
      case "wait-url": {
        const part = need(a, "part of an address");
        await page.waitForURL((u) => u.toString().includes(part), { timeout: Number(b ?? 10000) });
        return `at an address containing "${part}"`;
      }
      case "wait":
        await pick(page.getByText(need(a, "the text"), { exact: flags.exact }).filter({ visible: true })).first().waitFor({ timeout: Number(b ?? 10000) });
        return `"${a}" is showing`;
      case "screenshot": {
        const dir = join(currentRunDir() ?? E2E_DIR, "shots");
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${(a ?? new Date().toISOString().slice(11, 19).replace(/:/g, "")).replace(/[^\w.-]+/g, "-")}.png`);
        await page.screenshot({ path, fullPage: flags.full });
        return `saved ${path}`;
      }
      case "viewport":
        await page.setViewportSize({ width: Number(need(a, "a width")), height: Number(need(b, "a height")) });
        return `viewport ${a}×${b}`;
      case "theme":
        await page.emulateMedia({ colorScheme: need(a, "light or dark") === "dark" ? "dark" : "light" });
        return `${a} theme`;
      case "eval":
        return JSON.stringify(await page.evaluate(need(a, "an expression")), null, 2) ?? "undefined";
      case "back":
        await page.goBack();
        return "went back";
      case "reload":
        await page.reload();
        return "reloaded";
      case "problems": {
        const all = fresh();
        return all.length ? all.map((p) => `${line(p)}  (on ${p.url})`).join("\n") : "no problems";
      }
      case "stop":
        return "browser closed";
      default:
        throw new Error(`Unknown command ${cmd ?? ""}.\n\n${HELP}`);
    }
  }

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    writeFileSync(STATE, JSON.stringify({ port: typeof address === "object" && address ? address.port : 0, token, pid: process.pid, base }), { mode: 0o600 });
  });
}

/**
 * The browser with nobody signed in and none of the app's storage. The app is left first: a page
 * still open when the cookies go would have its next request refused (401) and send itself to
 * sign-in, racing whatever the driver opens next. The storage is cleared on the signed-out sign-in
 * page, whose session check is answered without a refusal.
 */
async function signedOut(page: Page) {
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/signin");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

function valueOf(args: string[], flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Every value given after `flag`, which may be repeated. */
function valuesOf(args: string[], flag: string) {
  return args.flatMap((a, i) => (a === flag && args[i + 1] !== undefined ? [args[i + 1]!] : [])).filter((v) => v.includes(":"));
}

function positional(args: string[]) {
  return args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--nth" && args[i - 1] !== "--header");
}

function need(v: string | undefined, what: string): string {
  if (v === undefined || v === "") throw new Error(`Give ${what}.`);
  return v;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

type Daemon = { port: number; token: string };

async function ensureDaemon(headed: boolean): Promise<Daemon> {
  if (existsSync(STATE)) {
    const s = JSON.parse(readFileSync(STATE, "utf8")) as Daemon & { pid: number };
    // A daemon started before the token ignores the header, so it serves until it is stopped.
    if (alive(s.pid)) return { port: s.port, token: s.token ?? "" };
    rmSync(STATE, { force: true });
  }
  mkdirSync(E2E_DIR, { recursive: true });
  const log = openSync(LOG, "a");
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--daemon", ...(headed ? ["--headed"] : [])], { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, "utf8")) as Daemon;
    if (child.exitCode !== null) break;
  }
  throw new Error(`The browser did not start; see ${LOG}. It uses the installed Google Chrome, or the browser at $CHROME.`);
}

export async function browserCommand(args: string[]) {
  if (!args.length || args[0] === "help") return console.log(HELP);
  if (args[0] === "stop" && !existsSync(STATE)) return console.log("The browser is not running.");
  const { port, token } = await ensureDaemon(args[0] === "start" && args.includes("--headed"));
  if (args[0] === "start") return console.log(`The browser is running, on ${e2eBaseUrl()}.`);
  const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", headers: { "x-e2e-token": token }, body: JSON.stringify({ args }) });
  const out = (await res.json()) as { ok: boolean; text: string; url?: string; problems?: Problem[] };
  record({ surface: "web", command: args, ok: out.ok, url: out.url, result: out.ok ? out.text.slice(0, 400) : out.text, problems: out.problems });
  console.log(out.text);
  if (out.url && args[0] !== "eval" && args[0] !== "snapshot") console.log(`— at ${out.url}`);
  for (const p of out.problems ?? []) console.log(line(p));
  if (!out.ok) process.exitCode = 1;
}

if (process.argv.includes("--daemon")) void daemon(process.argv.includes("--headed"));
