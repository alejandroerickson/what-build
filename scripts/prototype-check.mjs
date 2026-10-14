// Check a mockup's prototype in a real Chrome against a running `pnpm dev`: node scripts/prototype-check.mjs [app URL]
//
// Publishes a synthetic prototype (several documents, relative assets, a module and a classic
// script, a font, an image, a JSON fixture, a PDF fixture, a nested iframe, a form with a submit
// handler, and a document that touches localStorage behind a guard) to the sample product, opens
// it on the canvas and on the Story, and checks that it works there as it would at home, inside
// the sandbox: nothing loads from elsewhere, no load carries the session cookie, a document is
// never opened at the top level, and an address that replaces a prototype's document is put back.
// Ends by timing a canvas of 25 entries. Exits non-zero on a failed check.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5273";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

// ---- The fixture, zipped with the system's zip ---------------------------------------------------
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const files = {
  "index.html":
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Crew board</title><link rel="stylesheet" href="css/app.css"></head><body>' +
    '<h1 class="crew">Crew board</h1><p><a id="to-about" href="about.html">About</a> <a id="to-state" href="state.html">State</a> <a id="report" href="fixtures/report.pdf">Report</a></p>' +
    '<p id="fixture">loading</p><form id="find"><input id="q" name="q" value="north"><button id="go">Find</button></form><p id="found"></p>' +
    '<div class="dot" style="width:8px;height:8px"></div><img id="dot" src="img/dot.png" alt="" width="8" height="8">' +
    '<iframe id="embed" src="embed/earlier.html" title="An earlier direction" width="320" height="80"></iframe>' +
    '<script src="js/classic.js"></script><script type="module" src="js/app.mjs"></script></body></html>',
  "about.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>About</title></head><body><p id="about">About the crews</p><a id="back" href="index.html">Back</a></body></html>',
  "state.html":
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>State</title></head><body>' +
    '<script>var s; try { localStorage.setItem("k", "v"); s = "available"; } catch (e) { s = "threw " + e.name; } document.documentElement.dataset.storage = s;</script>' +
    '<p id="rest">The rest of the page</p><script>document.getElementById("rest").dataset.ok = "1";</script></body></html>',
  "embed/earlier.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Earlier</title></head><body><p id="earlier">An earlier direction</p></body></html>',
  "css/app.css": '@font-face { font-family: Crew; src: url("../fonts/crew.woff2") format("woff2"); } .crew { font-family: Crew, serif; } .dot { background: url(../img/dot.png); }',
  "js/classic.js": 'document.body.dataset.classic = "ran";',
  "js/lib.mjs": 'export const label = "ran";',
  "js/app.mjs":
    'import { label } from "./lib.mjs"; document.body.dataset.module = label;' +
    'const r = await fetch("data.json"); document.getElementById("fixture").textContent = (await r.json()).title;' +
    'document.getElementById("find").addEventListener("submit", (e) => { e.preventDefault(); document.getElementById("found").textContent = "found " + document.getElementById("q").value; });',
  "data.json": '{"title":"Fixture loaded"}',
  "fixtures/report.pdf": "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
};
function zipOf(manifest) {
  const dir = mkdtempSync(join(tmpdir(), "wb-prototype-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, "prototype", path)), { recursive: true });
    writeFileSync(join(dir, "prototype", path), text);
  }
  mkdirSync(join(dir, "prototype", "img"), { recursive: true });
  writeFileSync(join(dir, "prototype", "img", "dot.png"), PNG);
  mkdirSync(join(dir, "prototype", "fonts"), { recursive: true });
  copyFileSync(join(root, "packages/core/src/story-fonts/figtree.woff2"), join(dir, "prototype", "fonts", "crew.woff2"));
  execFileSync("zip", ["-q", "-r", "-X", "canvas.zip", "manifest.json", "prototype"], { cwd: dir });
  const bytes = readFileSync(join(dir, "canvas.zip"));
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

// ---- Sign in, find the sample product, publish ---------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
const loads = [];
page.on("request", async (r) => {
  if (!r.url().includes("/prototypes/")) return;
  const headers = await r.allHeaders().catch(() => ({}));
  loads.push({ url: r.url(), type: r.resourceType(), cookie: Boolean(headers["cookie"]), navigation: r.isNavigationRequest() });
});

await page.goto(`${base}/signin`);
await page.getByRole("button", { name: /Sam Okafor/ }).click();
await page.waitForURL((u) => u.pathname === "/");
const products = await (await page.request.get(`${base}/api/v1/me/products`)).json();
const product = products.items.find((p) => /crewboard/i.test(p.name)) ?? products.items[0];
const P = `${base}/api/v1/p/${product.path}`;
const app = `${base}/t/${product.path}`;

async function publish(manifest, extra = {}) {
  const g = await (await page.request.post(`${P}/mockups/uploads`, { data: {} })).json();
  const put = await fetch(g.url, { method: "PUT", headers: g.headers, body: zipOf(manifest) });
  if (put.status !== 201) throw new Error(`upload: ${put.status} ${await put.text()}`);
  const r = await page.request.post(`${P}/mockups`, { data: { upload_id: g.upload_id, ...extra } });
  const body = await r.json();
  if (r.status() !== 201) throw new Error(`publish: ${r.status()} ${JSON.stringify(body)}`);
  return body;
}
const published = await publish({
  title: "Crew board prototype",
  pages: [
    { page_id: "board", title: "Board", entry: "index.html#today" },
    { page_id: "about", title: "About", entry: "about.html" },
    { page_id: "state", title: "State", entry: "state.html" },
  ],
});
check(published.current.prototype?.file_count === 12, "published a prototype of 12 files", `${published.current.prototype?.file_count} files`);
check(
  published.prototype_warnings.some((w) => w.startsWith("state.html uses localStorage")),
  "publish warns that state.html uses localStorage",
  published.prototype_warnings.join(" | "),
);

// ---- The canvas ----------------------------------------------------------------------------------
await page.goto(`${app}/exploration/mockups/${published.mockup_id}`);
await page.locator(".xc-frame iframe").first().waitFor();
const interact = () => page.getByRole("radio", { name: "Interact" }).click();
await interact();
check((await page.locator("[data-mode]").first().getAttribute("data-mode")) === "interact", "the canvas is in interact mode");
const frameFor = async (path, timeout = 15000) => {
  const until = Date.now() + timeout;
  for (;;) {
    const f = page.frames().find((x) => x.url().includes("/prototypes/") && new URL(x.url()).pathname.endsWith(path));
    if (f) {
      await f.waitForLoadState("load");
      return f;
    }
    if (Date.now() > until) throw new Error(`no frame for ${path}`);
    await page.waitForTimeout(100);
  }
};
const board = await frameFor("/index.html");
await board.waitForFunction(() => document.body.dataset.module === "ran" && document.getElementById("fixture").textContent === "Fixture loaded", null, { timeout: 10000 }).catch(() => undefined);
const state = await board.evaluate(async () => {
  await document.fonts.ready;
  const img = document.getElementById("dot");
  return {
    classic: document.body.dataset.classic,
    module: document.body.dataset.module,
    fixture: document.getElementById("fixture").textContent,
    font: document.fonts.check('16px "Crew"'),
    image: img.complete && img.naturalWidth === 1,
    cssImage: getComputedStyle(document.querySelector(".dot")).backgroundImage,
    origin: String(self.origin),
  };
});
check(state.classic === "ran", "a classic script ran");
check(state.module === "ran", "a module script and the module it imports ran");
check(state.fixture === "Fixture loaded", "a JSON fixture was fetched from the prototype");
check(state.font, "a font loaded by a relative url() in the stylesheet");
check(state.image && state.cssImage.includes("img/dot.png"), "an image loaded, by <img> and by the stylesheet");
check(state.origin === "null", "the prototype runs in an opaque origin", state.origin);
const nested = page.frames().find((f) => f.url().endsWith("/embed/earlier.html"));
check(Boolean(nested) && (await nested.locator("#earlier").textContent()) === "An earlier direction", "the nested iframe of another of its documents loaded");

// The form: its submit handler runs, and nothing submits anywhere.
const boardUrl = board.url();
// The board is scaled, which Playwright's pointer cannot aim through; submit as Enter or the button would.
await board.evaluate(() => document.getElementById("find").requestSubmit());
await page.waitForTimeout(500);
check((await board.locator("#found").textContent()) === "found north", "the form's submit handler ran");
check(board.url() === boardUrl, "the form submitted nowhere: the frame did not navigate");

// Keys pass from inside a prototype's document to the canvas.
await board.locator("body").press("h");
await page.waitForTimeout(200);
check((await page.locator("[data-mode]").first().getAttribute("data-mode")) === "pan", "a canvas key pressed inside the prototype reaches the canvas");
await interact();

// A link within the prototype moves the frame, and is not put back.
await board.locator("#to-about").dispatchEvent("click");
const about = await frameFor("/about.html");
await page.waitForTimeout(2000);
check((await about.locator("#about").textContent()) === "About the crews", "a link to another of its documents opened it in the frame");
check((await page.locator(".xc-replaced").count()) === 0, "moving between its documents is not taken for a replacement");
await about.locator("body").press("h");
await page.waitForTimeout(200);
check((await page.locator("[data-mode]").first().getAttribute("data-mode")) === "pan", "keys pass from the next document too");
await interact();

// An address that is not one of its documents replaces it: the app puts the prototype back.
await about.evaluate(() => {
  location.href = "/api/v1/me";
});
await page.locator(".xc-replaced").first().waitFor({ timeout: 8000 }).then(() => check(true, "an address that replaced a prototype's document was put back")).catch(() => check(false, "an address that replaced a prototype's document was put back"));

// A prototype that touches localStorage behind a guard: storage throws, the rest of it works.
const stateFrame = await frameFor("/state.html");
const storage = await stateFrame.evaluate(() => ({ storage: document.documentElement.dataset.storage, rest: document.getElementById("rest").dataset.ok }));
check(storage.storage === "threw SecurityError", "localStorage is unavailable and throws, as publish said", storage.storage);
check(storage.rest === "1", "the rest of a document that guards it works");

// Never at the top level on the app's origin.
const top = await context.newPage();
const opened = await top.goto(published.current.pages[0].prototype_url);
check(opened?.status() === 403, "a prototype's document opened at the top level is refused", String(opened?.status()));
await top.close();

// No load a prototype's document makes carries the session cookie.
const subresources = loads.filter((l) => !l.navigation);
check(subresources.length > 0 && subresources.every((l) => !l.cookie), "no script, style, font, image or fetch of a prototype carries the session cookie", `${subresources.length} loads`);
check(loads.some((l) => l.type === "font") && loads.some((l) => l.type === "fetch") && loads.some((l) => l.type === "script"), "fonts, scripts and fetches were among them");

// ---- The Story -----------------------------------------------------------------------------------
const promoted = await (await page.request.post(`${P}/story/promote-mockup`, { data: { mockup_id: published.mockup_id, mockup_page_id: "board", title: "Crew board prototype" } })).json();
await page.goto(`${app}/story/${promoted.page_id}`);
const storyBoard = await frameFor("/index.html");
await storyBoard.waitForFunction(() => document.body.dataset.module === "ran", null, { timeout: 10000 }).catch(() => undefined);
check((await storyBoard.evaluate(() => document.body.dataset.module)) === "ran", "the Story shows a promoted entry, its scripts running");
await storyBoard.locator("#to-about").dispatchEvent("click");
const storyAbout = await frameFor("/about.html");
await page.waitForTimeout(2000);
check((await storyAbout.locator("#about").textContent()) === "About the crews" && (await page.getByText("This page tried to open another address").count()) === 0, "on the Story too, its links move between its documents in place");
const p = await (await page.request.get(`${P}/story/pages/${promoted.page_id}`)).json();
await page.request.delete(`${P}/story/pages/${promoted.page_id}`, { data: { expected_etag: p.etag, reason: "Browser check", confirm: "delete permanently" } });

// ---- A canvas of 25 entries ----------------------------------------------------------------------
const many = await publish({
  title: "Twenty-five routes",
  columns: 5,
  pages: Array.from({ length: 25 }, (_, i) => ({ page_id: `route-${i + 1}`, title: `Route ${i + 1}`, entry: `index.html?route=${i + 1}`, width: 1280, height: 800 })),
});
const started = Date.now();
await page.goto(`${app}/exploration/mockups/${many.mockup_id}`);
await page.locator(".xc-frame iframe").first().waitFor();
let ready = 0;
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  ready = 0;
  for (const f of page.frames().filter((x) => /\/index\.html\?route=/.test(x.url())))
    if (await f.evaluate(() => document.body?.dataset.module === "ran" && document.getElementById("fixture")?.textContent === "Fixture loaded").catch(() => false)) ready++;
  if (ready >= 25) break;
  await page.waitForTimeout(250);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
check(ready === 25, "a canvas of 25 entries loaded every one", `${ready} of 25 in ${seconds} s`);
console.log(`  ${loads.length} prototype requests in all`);

const unexpected = consoleErrors.filter((e) => !/api\/v1\/me|401|403|Unauthorized|Forbidden/.test(e));
check(unexpected.length === 0, "no other console errors", unexpected.slice(0, 5).join(" | "));
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log("\nEvery check passed.");
