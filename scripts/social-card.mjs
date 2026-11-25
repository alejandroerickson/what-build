// Make the public site's social card, the picture a link to the site shows where it is shared
// (LinkedIn, X, Slack, iMessage): apps/web/public/social-card.png, 1200 × 630, which both
// landing pages name as og:image and twitter:image.
//
//   corepack pnpm dev                           the sample, in another terminal
//   node scripts/social-card.mjs [baseUrl]      http://localhost:5273 by default
//
// The card is the landing page's own look: the mark, the name and the tagline on the site's dotted
// canvas, beside a real screen of the app. That screen is the sample product's Idea as its owner
// sees it with an agent connected, which this script connects first through OAuth as any agent
// does (pnpm e2e mcp connect). Nothing in the screen is drawn here. Run it again when the tagline
// (TAGLINE, the front page's h1) or that screen changes, and look at the result before committing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.argv[2] ?? "http://localhost:5273";
const out = `${root}apps/web/public/social-card.png`;
const OWNER = "riley@example.com";
/** The front page's h1 (apps/web/src/site/landing/Landing.tsx), broken as it is there. */
const TAGLINE = ["Product engineering", "at the speed of", "AI engineering."];

execFileSync("corepack", ["pnpm", "--silent", "e2e", "mcp", "connect", "--as", "riley"], { cwd: root, stdio: "inherit", env: { ...process.env, WHATBUILD_E2E_URL: base } });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

/** The sample product's Idea, its product concept at the top of the canvas, at twice the pixels. */
async function screen() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, colorScheme: "light", baseURL: base });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("whatbuild.theme", "light");
      localStorage.setItem("whatbuild.nav", "open");
    } catch {}
  });
  const signIn = await ctx.request.post("/auth/dev-sign-in", { data: { email: OWNER }, headers: { Origin: base } });
  if (!signIn.ok()) throw new Error(`The development sign-in answered ${signIn.status()}: is pnpm dev running at ${base}?`);
  await ctx.request.patch("/api/v1/me", { data: { tutorial: { off: true } }, headers: { Origin: base } });
  const page = await ctx.newPage();
  await page.goto("/t/harbor-labs/crewboard/idea");
  await page.getByText("Product concept", { exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The canvas is the page's one scroller: bring the concept's card to the panel's top inset.
  await page.evaluate(() => {
    const card = document.querySelector(".idea-card-concept");
    const canvas = document.querySelector(".canvas");
    canvas.scrollTop += card.getBoundingClientRect().top - 10;
  });
  // The card's front is drawn in a frame of its own.
  await page.waitForTimeout(2500);
  const shot = await page.screenshot();
  await ctx.close();
  return shot;
}

const font = readFileSync(`${root}apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`).toString("base64");
const shot = (await screen()).toString("base64");

// The W mark (apps/web/src/shell/brand.tsx) in Ink and Panel White.
const mark = `<svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1e1e1e"/><path d="M0 7.5H32" stroke="#fff" stroke-width="0.9"/><path d="M8 11.8l3.2 12L16 13.8l4.8 10L24 11.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const card = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Inter Variable"; font-weight: 100 900; src: url(data:font/woff2;base64,${font}) format("woff2"); }
* { margin: 0; box-sizing: border-box; }
body {
  width: 1200px; height: 630px; overflow: hidden; position: relative;
  /* The front page's canvas and dots (landing.css). */
  background: #f0f0f0 radial-gradient(circle, #d3d3d3 1.1px, transparent 1.5px) 12px 12px / 24px 24px;
  color: #1e1e1e; font-family: "Inter Variable", sans-serif; -webkit-font-smoothing: antialiased;
}
.brand { position: absolute; left: 72px; top: 150px; display: flex; align-items: center; gap: 14px; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; }
h1 { position: absolute; left: 72px; top: 248px; font-size: 58px; font-weight: 600; line-height: 1.04; letter-spacing: -0.035em; }
/* The app's screen, its corner and the Lifted shadow, running off the card's edges. */
.screen { position: absolute; left: 664px; top: 88px; width: 864px; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 28px rgb(0 0 0 / 0.16), 0 0 0 1px rgb(0 0 0 / 0.12); }
.screen img { display: block; width: 100%; }
</style></head><body>
<div class="brand">${mark}<span>WhatBuild</span></div>
<h1>${TAGLINE.join("<br>")}</h1>
<div class="screen"><img src="data:image/png;base64,${shot}" alt=""></div>
</body></html>`;

const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(card);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`Wrote ${out.slice(root.length)}. Look at it before committing.`);
