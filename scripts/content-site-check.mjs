// Check a content site in a real Chrome: node scripts/content-site-check.mjs [app URL] [site URL]
//
// Run it against WhatBuild serving its built web app itself, with a content site set, so the app's
// pages carry the server's own policy (Vite's development server sends none):
//
//   pnpm build
//   PORT=8811 WHATBUILD_PUBLIC_URL=http://localhost:8811 WHATBUILD_CONTENT_URL=http://127.0.0.1:8811 \
//     WHATBUILD_WEB_DIST="$PWD/apps/web/dist" WHATBUILD_SITE_URL=http://site.localhost:8811 \
//     WHATBUILD_ANALYTICS_ID=G-TEST1234 pnpm dev
//   node scripts/content-site-check.mjs http://localhost:8811 http://site.localhost:8811
//
// Signs in to the sample product with analytics accepted, adds a Story page, a PDF and an uploaded
// HTML page, then opens a Story page, a canvas, the Idea screen, the Story style dialog, the print
// view, the PDF and the HTML page. Checks that each is served from the content site and renders
// there in an opaque origin, that a root-relative link in a page opens the app, that no request to
// the content site carries a cookie, and that no page reports a policy violation, the public site's
// included. Ends by timing a canvas of 25 pages. Exits non-zero on a failed check.
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:8811";
const siteUrl = process.argv[3] ?? null;
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Analytics accepted, so its script and its policy's sources are in play too.
await context.addCookies([base, siteUrl].filter(Boolean).map((url) => ({ name: "wb_cookies", value: "accepted", url })));
const page = await context.newPage();

// Every policy violation any page or frame reports, and every request to the content site.
const violations = [];
const watch = (p) =>
  p.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(`${m.location().url || p.url()}: ${m.text().slice(0, 240)}`);
  });
watch(page);
context.on("page", watch);
let content = null;
const toContent = [];
context.on("request", async (r) => {
  if (!content || !r.url().startsWith(content)) return;
  const headers = await r.allHeaders().catch(() => ({}));
  toContent.push({ url: r.url(), cookie: Boolean(headers["cookie"]) });
});

/** The frame showing a document from the content site whose address ends in `name`, once loaded. */
async function documentFrame(p, name, timeout = 15000) {
  const until = Date.now() + timeout;
  for (;;) {
    const f = p.frames().find((x) => x.url().startsWith(`${content}/documents/`) && new URL(x.url()).pathname.endsWith(`/${name}`));
    if (f) {
      await f.waitForLoadState("load");
      return f;
    }
    if (Date.now() > until) throw new Error(`no frame from the content site for ${name}`);
    await p.waitForTimeout(100);
  }
}
const originOf = (f) => f.evaluate(() => String(self.origin)).catch((e) => `unreadable: ${e.message}`);

// ---- Sign in, find the sample product, add what the check opens ---------------------------------
await page.goto(`${base}/signin`);
await page.getByRole("button", { name: /Sam Okafor/ }).click();
await page.waitForURL((u) => u.pathname === "/");
const products = await (await page.request.get(`${base}/api/v1/me/products`)).json();
const product = products.items.find((p) => /crewboard/i.test(p.name)) ?? products.items[0];
const P = `${base}/api/v1/p/${product.path}`;
const app = `${base}/t/${product.path}`;

// A page of its own each run, so a run that stopped partway leaves nothing in the next one's way.
const pageId = `content-site-check-${Date.now().toString(36)}`;
const story = await page.request.post(`${P}/story/pages/${pageId}/versions`, {
  data: {
    title: "Content site check",
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Content site check</title></head><body><h1 id="title">Served from the content site</h1><p><a id="root-relative" href="/t/${product.path}/evidence">Evidence</a></p></body></html>`,
  },
});
check(story.status() === 201, "published a Story page to check", String(story.status()));

async function attach(path, body) {
  const created = await (await page.request.post(`${P}/sources/with-upload`, { data: { title: `Content site check: ${path}`, path } })).json();
  const put = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body });
  if (put.status !== 201) throw new Error(`upload ${path}: ${put.status} ${await put.text()}`);
  return created.record.record_id;
}
const PDF = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
const pdfSource = await attach("plan.pdf", PDF);
const htmlSource = await attach("page.html", '<!doctype html><title>Uploaded</title><p id="hi" style="color:rgb(170, 0, 0)">Hello from a file</p><script>document.body.dataset.ran = "1"</script>');

// ---- A Story page --------------------------------------------------------------------------------
await page.goto(`${app}/story/${pageId}`);
const handOff = await page.request.get(`${P}/story/pages/${pageId}/versions/1/html?frame=1`, { maxRedirects: 0 });
content = new URL(handOff.headers()["location"] ?? "http://unset").origin;
check(handOff.status() === 302 && content !== new URL(base).origin, "the app's address for a page hands off to the content site", `${handOff.status()} to ${content}`);
const storyFrame = await documentFrame(page, "page.html");
check((await storyFrame.locator("#title").textContent()) === "Served from the content site", "a Story page renders from the content site");
check((await originOf(storyFrame)) === "null", "a Story page runs in an opaque origin", await originOf(storyFrame));
await page.waitForTimeout(1500);
check((await page.getByText("This page tried to open another address").count()) === 0, "a Story page reached through the hand-off is not taken for an address that replaced it");
const [opened] = await Promise.all([context.waitForEvent("page", { timeout: 10000 }).catch(() => null), storyFrame.locator("#root-relative").click()]);
await opened?.waitForLoadState("domcontentloaded").catch(() => undefined);
check(Boolean(opened) && opened.url().startsWith(`${app}/evidence`), "a root-relative link in a page opens the app, in a new tab", opened?.url() ?? "nothing opened");
await opened?.close();

// ---- A tab whose policy names the content site's prototypes only ---------------------------------
// As one loaded before the release that served documents from there. After a redirect a browser
// matches a frame's source by its host alone, so such a tab still frames the documents its app
// addresses hand off; one whose policy names no content site does not, until it is reloaded. Two
// servers of this script's own stand in for the app and the content site.
{
  const ports = [18921, 18922];
  const site = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html", "cross-origin-resource-policy": "cross-origin", "cross-origin-embedder-policy": "credentialless" });
    res.end('<p id="doc">a document</p>');
  }).listen(ports[1]);
  const other = `http://127.0.0.1:${ports[1]}`;
  const policies = { "only the content site's prototypes": `frame-src 'self' ${other}/prototypes/`, "no content site": "frame-src 'self'" };
  const tab = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/hand-off") return res.writeHead(302, { location: `${other}/documents/grant/page.html` }).end();
    const policy = policies[u.searchParams.get("policy")];
    if (!policy) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": policy, "cross-origin-embedder-policy": "credentialless" });
    res.end('<iframe src="/hand-off"></iframe>');
  }).listen(ports[0]);
  for (const [name, allowed] of [["only the content site's prototypes", true], ["no content site", false]]) {
    // Its own page, outside the context the rest watches: the second is refused on purpose.
    const p = await browser.newPage();
    await p.goto(`http://localhost:${ports[0]}/?policy=${encodeURIComponent(name)}`);
    await p.waitForTimeout(1000);
    const framed = p.frames().some((f) => f.url() === `${other}/documents/grant/page.html`);
    check(framed === allowed, `a tab whose policy names ${name} ${allowed ? "still frames" : "does not frame"} a handed-off document`);
    await p.close();
  }
  tab.close();
  site.close();
}

// ---- The Story style dialog ----------------------------------------------------------------------
// The Story opens with its panels hidden, for reading.
const show = page.getByRole("button", { name: /Show panels/ });
if (await show.isVisible()) await show.click();
await page.locator(".story-style-row").first().click();
const specimen = await documentFrame(page, "specimen.html");
check(((await specimen.locator("body").textContent()) ?? "").trim().length > 0, "the Story style dialog's specimen renders from the content site");
await page.keyboard.press("Escape");

// ---- A canvas ------------------------------------------------------------------------------------
const mockups = await (await page.request.get(`${P}/mockups`)).json();
const mockup = mockups.items.find((m) => !m.archived_at) ?? mockups.items[0];
await page.goto(`${app}/exploration/mockups/${mockup.mockup_id}`);
await page.locator(".xc-frame iframe").first().waitFor();
const canvasPage = await documentFrame(page, "page.html");
check(((await canvasPage.locator("body").textContent()) ?? "").trim().length > 0, "a mockup page on its canvas renders from the content site");
check((await originOf(canvasPage)) === "null", "a mockup page runs in an opaque origin");
await page.waitForTimeout(1500);
check((await page.locator(".xc-replaced").count()) === 0, "a page reached through the hand-off is not taken for an address that replaced it");

// ---- The Idea screen -----------------------------------------------------------------------------
await page.goto(`${app}/idea`);
await documentFrame(page, "card.html");
await page.waitForTimeout(1500);
const cards = await page.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => Math.round(f.getBoundingClientRect().height)));
const fromContent = page.frames().filter((f) => f.url().startsWith(`${content}/documents/`) && f.url().includes("/card.html")).length;
check(fromContent >= 1 && cards.length >= fromContent && cards.every((h) => h > 40), "the Idea screen's cards render from the content site and size themselves", `${fromContent} cards, heights ${cards.join(", ")}`);

// ---- The print view ------------------------------------------------------------------------------
const print = await context.newPage();
await print.goto(`${P}/story/print?page_ids=${pageId}`);
check(print.url().startsWith(`${content}/documents/`), "the print view opens on the content site", print.url().split("?")[0].replace(/documents\/[^/]+/, "documents/…"));
check((await print.locator("h1").first().textContent()) === product.name && (await print.locator("section.print-section").count()) === 1, "the print view renders its page");
check((await originOf(print.mainFrame())) === "null", "the print view runs in an opaque origin");
await print.close();

// ---- A PDF and an uploaded HTML page -------------------------------------------------------------
const pdfResponse = page.waitForResponse((r) => r.url().startsWith(`${content}/documents/`) && new URL(r.url()).pathname.endsWith("/plan.pdf"), { timeout: 15000 }).catch(() => null);
await page.goto(`${app}/evidence/${pdfSource}?view=attachments`);
await page.locator('button[title="Show plan.pdf"]').click();
const pdf = await pdfResponse;
check(pdf?.status() === 200 && pdf.headers()["content-type"] === "application/pdf", "a PDF's preview loads it from the content site", pdf ? `${pdf.status()} ${pdf.headers()["content-type"]}` : "no response");
await page.keyboard.press("Escape");

await page.goto(`${app}/evidence/${htmlSource}?view=attachments`);
await page.locator('button[title="Show page.html"]').click();
const uploaded = await documentFrame(page, "page.html");
check((await uploaded.locator("#hi").textContent()) === "Hello from a file", "an uploaded HTML page's preview renders from the content site");
const color = await uploaded.locator("#hi").evaluate((e) => getComputedStyle(e).color).catch(() => "unreadable");
check(color === "rgb(170, 0, 0)", "its inline style applies", color);
const ran = await uploaded.locator("body").getAttribute("data-ran");
check(ran === null, "its script does not run");
await page.keyboard.press("Escape");

// ---- A canvas of 25 pages ------------------------------------------------------------------------
const html = (i) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Route ${i}</title></head><body><h1>Route ${i}</h1><p>One of twenty-five.</p></body></html>`;
const many = await (await page.request.post(`${P}/mockups`, { data: { title: "Twenty-five pages", brief: "A canvas to time.", columns: 5, pages: Array.from({ length: 25 }, (_, i) => ({ page_id: `route-${i + 1}`, title: `Route ${i + 1}`, html: html(i + 1) })) } })).json();
const started = Date.now();
await page.goto(`${app}/exploration/mockups/${many.mockup_id}`);
await page.locator(".xc-frame iframe").first().waitFor();
let ready = 0;
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  ready = 0;
  for (const f of page.frames().filter((x) => x.url().startsWith(`${content}/documents/`)))
    if (await f.evaluate(() => /^Route \d+$/.test(document.querySelector("h1")?.textContent ?? "")).catch(() => false)) ready++;
  if (ready >= 25) break;
  await page.waitForTimeout(250);
}
check(ready === 25, "a canvas of 25 pages loaded every one from the content site", `${ready} of 25 in ${((Date.now() - started) / 1000).toFixed(1)} s`);
const mockupNow = await (await page.request.get(`${P}/mockups/${many.mockup_id}`)).json();
await page.request.delete(`${P}/mockups/${many.mockup_id}`, { data: { expected_etag: mockupNow.etag, reason: "Content site check", confirm: "delete permanently" } });

// ---- The public site -----------------------------------------------------------------------------
if (siteUrl) {
  const site = await context.newPage();
  watch(site);
  const r = await site.goto(siteUrl);
  check(r?.status() === 200, "the public site loads", String(r?.status()));
  await site.waitForTimeout(1000);
  await site.close();
}

// ---- What every load said ------------------------------------------------------------------------
check(toContent.length > 0 && toContent.every((l) => !l.cookie), "no request to the content site carried a cookie", `${toContent.length} requests`);
check(violations.length === 0, "no page or frame reported a policy violation", violations.slice(0, 5).join(" | "));

const p = await (await page.request.get(`${P}/story/pages/${pageId}`)).json();
await page.request.delete(`${P}/story/pages/${pageId}`, { data: { expected_etag: p.etag, reason: "Content site check", confirm: "delete permanently" } });
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log("\nEvery check passed.");
