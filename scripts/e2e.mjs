// Drive the real UI through the loop against a running `pnpm dev`: node scripts/e2e.mjs
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5273";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const step = (s) => console.log("✓", s);

await page.goto(`${base}/signin`);
await page.getByRole("button", { name: /Sam Okafor/ }).click();
await page.waitForURL(/objectives/);
step("signed in as an editor");
const app = page.url().replace(/\/objectives.*$/, "");

await page.goto(`${app}/sources/new`);
await page.getByLabel(/Interview transcript/).check();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Title").fill("Dispatcher interview — Brightway Cleaning, Sep 2026");
await page.getByLabel(/^Date/).fill("2026-09-10");
await page.getByLabel(/^Organization/).fill("Brightway Cleaning");
await page.getByRole("button", { name: "Continue" }).click();
mkdirSync(".what-build/e2e", { recursive: true });
writeFileSync(".what-build/e2e/dispatch.txt", "Interviewer: How do crews learn their day?\nJo: A group text at six in the morning.\nInterviewer: What goes wrong?\nJo: Gate codes. Half the time the code in the text is old.\n");
await page.locator('input[type="file"]').first().setInputFiles(".what-build/e2e/dispatch.txt");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Create source" }).click();
await page.waitForURL(/sources\/[0-9A-Z]{26}/);
step("created a source through the kind-first wizard and uploaded its file");
await page.getByText("Passages (4)").waitFor({ timeout: 15000 });
step("the worker parsed it into 4 passages (the page updated itself)");
await page.getByRole("tab").first().click().catch(() => {});
await page.locator(".segment-btn").nth(3).click();
await page.getByRole("button", { name: "Write a note" }).click();
await page.getByLabel(/Note on segment 3/).fill("Stale gate codes again — same as Greenline.");
await page.getByRole("button", { name: "Save note" }).click();
await page.getByText("Note added.").waitFor();
step("selected a passage and wrote a note on it");
await page.goto(`${app}/search?q=gate%20code`);
await page.locator(".hit").first().waitFor();
const hits = await page.locator(".hit").count();
step(`search found ${hits} passages for "gate code"`);
await page.locator(".hit a").first().click();
await page.waitForURL(/seq=/);
step("a hit opens the passage in place");
await page.goto(`${app}/activity`);
await page.getByText("added a note to").first().waitFor();
step("the activity log shows the note");
await page.goto(`${app}/settings`);
await page.getByRole("button", { name: "Export this product" }).click();
await page.getByRole("link", { name: /Download/ }).first().waitFor({ timeout: 20000 });
step("exported the product and got a download link");
await browser.close();
if (errors.length) {
  console.log("page errors:\n" + errors.join("\n"));
  process.exit(1);
}
