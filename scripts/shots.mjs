// Screenshot the running dev app with the locally installed Chrome (no browser download).
// node scripts/shots.mjs <outdir> [baseUrl]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? ".what-build/shots";
const base = process.argv[3] ?? "http://localhost:5273";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [];
async function session(width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} ${page.url()}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag} ${page.url()}: ${e.message}`));
  await page.goto(`${base}/signin`);
  await page.getByRole("button", { name: /Riley Chen/ }).click();
  await page.waitForURL(/objectives/);
  return { ctx, page };
}
const shots = (process.env.SHOTS ?? "").split(",").filter(Boolean);
const { ctx, page } = await session(1440, 900, "desktop");
const app = page.url().replace(/\/objectives.*$/, "");
const routes = [
  ["objectives", "/objectives"],
  ["sources", "/sources"],
  ["source", null],
  ["search", "/search?q=spreadsheet"],
  ["insights", "/insights"],
  ["insight", null],
  ["assumptions", "/insights/assumptions"],
  ["decision", null],
  ["story", "/story"],
  ["new-source", "/sources/new"],
  ["activity", "/activity"],
];
async function snap(name, url, w = page) {
  if (shots.length && !shots.includes(name)) return;
  if (url) await w.goto(url.startsWith("http") ? url : `${app}${url}`);
  await w.waitForLoadState("networkidle");
  await w.waitForTimeout(400);
  await w.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
for (const [name, url] of routes) {
  if (name === "source") {
    await page.goto(`${app}/sources`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /Crew lead interview/ }).click();
    await snap(name, null);
  } else if (name === "insight") {
    await page.goto(`${app}/insights`);
    await page.waitForLoadState("networkidle");
    await page.locator(".insight-list a").first().click();
    await snap(name, null);
  } else if (name === "decision") {
    await page.goto(`${app}/insights/decisions`);
    await page.waitForLoadState("networkidle");
    await page.locator(".entry-list a").first().click();
    await snap(name, null);
  } else await snap(name, url);
}
await snap("connect", `${base}/connect`);
await snap("products", `${base}/products`);
const mobile = await session(390, 844, "mobile");
for (const [name, url] of [["m-objectives", "/objectives"], ["m-sources", "/sources"]]) await snap(name, url, mobile.page);
await browser.close();
console.log(errors.length ? errors.join("\n") : "no console errors");
