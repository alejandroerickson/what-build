// Screenshot every screen of the running dev app with the locally installed Chrome (no browser
// download), in light and dark, on a desktop (1440×900) and a phone (390×844).
//
//   node scripts/shots.mjs <outdir> [baseUrl]
//   SHOTS=idea,story node scripts/shots.mjs <outdir>     only these screens
//
// Files are named <screen>-<theme>-<desktop|phone>.png. The canvas is the page's only scroller, so a
// capture grows the viewport to the canvas's content height (up to a cap) instead of fullPage.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? ".what-build/shots";
const base = process.argv[3] ?? "http://localhost:5273";
const only = (process.env.SHOTS ?? "").split(",").filter(Boolean);
const MAX_HEIGHT = 4000;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [];
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function context(theme, device, signIn = true) {
  const ctx = await browser.newContext(DEVICES[device]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("whatbuild.theme", t);
      if (!sessionStorage.getItem("shots.nav")) {
        localStorage.setItem("whatbuild.nav", "open");
        sessionStorage.setItem("shots.nav", "1");
      }
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  const tag = `${theme}/${device}`;
  // Signed out, the sign-in page's session check is expected to answer 401.
  page.on("console", (m) => m.type() === "error" && !(page.url().includes("/signin") && m.text().includes("401")) && errors.push(`${tag} ${page.url()}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag} ${page.url()}: ${e.message}`));
  if (signIn) {
    await page.goto(`${base}/signin`);
    await page.getByRole("button", { name: /Sam Okafor/ }).click();
    await page.waitForURL((u) => u.pathname === "/");
  }
  return { ctx, page };
}

/** Wait until the screen has settled: network idle, no skeletons, fonts loaded. */
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

async function capture(page, file, { full = true } = {}) {
  const vp = page.viewportSize();
  if (full) {
    const h = await page.evaluate(() => {
      const main = document.querySelector("main#main");
      if (!main) return document.documentElement.scrollHeight;
      return main.getBoundingClientRect().top + main.scrollHeight;
    });
    const height = Math.min(MAX_HEIGHT, Math.max(vp.height, Math.ceil(h)));
    if (height !== vp.height) {
      await page.setViewportSize({ width: vp.width, height });
      await page.waitForTimeout(250);
    }
  }
  await page.screenshot({ path: `${out}/${file}.png` });
  if (page.viewportSize().height !== vp.height) await page.setViewportSize(vp);
}

const wanted = (screen) => !only.length || only.includes(screen);

/** Resolve the sample product's ids through the API, with the signed-in session. */
async function sample(page) {
  const get = async (url) => (await page.request.get(url)).json();
  const products = await get(`${base}/api/v1/me/products`);
  const path = (products.items.find((p) => p.name === "Crewboard") ?? products.items[0]).path;
  const app = `${base}/t/${path}`;
  const P = `${base}/api/v1/p/${path}`;
  const sources = await get(`${P}/sources?limit=200`);
  const source = sources.records.find((r) => r.title.startsWith("Crew lead interview")) ?? sources.records[0];
  const assumptions = await get(`${P}/assumptions`);
  const mockups = await get(`${P}/mockups`);
  return {
    app,
    api: P,
    tenant: path.split("/")[0],
    source: source.record_id,
    mockup: mockups.items[0]?.mockup_id,
    assumption: (assumptions.items ?? assumptions.entries)[0].id,
  };
}

for (const device of ["desktop", "phone"]) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await context(theme, device);
    const s = await sample(page);
    const name = (screen) => `${screen}-${theme}-${device}`;
    const shoot = async (screen, url, opts) => {
      if (!wanted(screen)) return;
      if (url) await page.goto(url.startsWith("http") ? url : `${s.app}${url}`);
      await settle(page);
      await capture(page, name(screen), opts);
    };

    await shoot("overview", `${base}/`);
    await shoot("idea", "/idea");
    await shoot("evidence", "/evidence");
    for (const view of ["passages", "original", "notes", "files"]) await shoot(`source-${view}`, `/evidence/${s.source}?view=${view}`);
    await shoot("search", "/search?q=spreadsheet");
    if (s.mockup) await shoot("mockup", `/exploration/mockups/${s.mockup}`, { full: false });
    await shoot("assumptions", "/exploration/assumptions");
    await shoot("assumption", `/exploration/assumptions/${s.assumption}`);
    await shoot("story", "/story/overview", { full: false });
    if (wanted("export-dialog")) {
      await page.goto(`${s.app}/story/overview`);
      await settle(page);
      if (device === "phone") {
        await page.locator(".show-pill").click();
        await page.waitForTimeout(300);
      }
      await page.getByRole("button", { name: "Export “Where Crewboard's discovery stands”" }).click();
      await page.getByRole("menuitem", { name: /Export with its subpages/ }).click();
      await page.getByRole("dialog", { name: "Export to PDF" }).waitFor();
      await page.waitForTimeout(300);
      await capture(page, name("export-dialog"), { full: false });
    }
    if (wanted("story-notes")) {
      // The inspector scrolled to "Notes for agents", which people read and agents write.
      await page.goto(`${s.app}/story/overview`);
      await settle(page);
      const toggle = page.locator(".show-ins");
      if (await toggle.isVisible()) {
        await toggle.click();
        await page.waitForTimeout(400);
      }
      await page.locator(".inspector .group-title", { hasText: "Notes for agents" }).evaluate((el) => el.closest(".group").scrollIntoView({ block: "start" }));
      await page.waitForTimeout(200);
      await capture(page, name("story-notes"), { full: false });
    }
    await shoot("print-view", `${s.api}/story/print?page_ids=overview,hand-off-test`);
    await shoot("activity", "/activity");
    await shoot("settings", "/settings");
    await shoot("agents", `${base}/connect`);
    await shoot("settings", `${base}/settings`);
    await shoot("members", `${base}/t/${s.tenant}/members`);
    await shoot("not-found", "/no-such-screen", { full: false });

    if (device === "desktop" && wanted("panel-hidden")) {
      await page.goto(`${s.app}/evidence/${s.source}?view=passages`);
      await settle(page);
      await page.getByRole("button", { name: "Hide panel" }).click();
      await page.waitForTimeout(400);
      await capture(page, name("panel-hidden"), { full: false });
      await page.locator(".show-pill").click();
    }
    if (device === "phone" && wanted("drawer")) {
      await page.goto(`${s.app}/idea`);
      await settle(page);
      await page.locator(".show-pill").click();
      await page.waitForTimeout(400);
      await capture(page, name("drawer"), { full: false });
    }
    await ctx.close();

    if (wanted("signin")) {
      const anon = await context(theme, device, false);
      await anon.page.goto(`${base}/signin`);
      await settle(anon.page);
      await capture(anon.page, name("signin"), { full: false });
      await anon.ctx.close();
    }
  }
}

await browser.close();
if (errors.length) {
  console.log(errors.join("\n"));
  process.exit(1);
}
console.log(`no console errors; shots in ${out}`);
