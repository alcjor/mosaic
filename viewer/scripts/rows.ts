/**
 * A chain's results as rows of cards in the *Chain* view, in Chromium through Playwright
 * (V-7, V-8, V-10, V-13), printed as one JSON line; a screenshot of each width and theme.
 *
 *     bun viewer/scripts/rows.ts (--url URL | EXPORT.html) SHOTS_DIR NAME PLAN_JSON
 *
 * PLAN_JSON: `{start, query, pin, steps}`. The script picks the start, pins it by search, adds
 * the steps, and once the first result shows records which result it says, the cards in its row
 * (their ids) and the links between them (their names); then Next (pointer), Previous
 * (keyboard: focus, Enter), Next again and First, recording each; then opens the first link's
 * citation chip and records its rows. With `--url`, the page `mosaic view` serves; otherwise a
 * single-file export opened from `file://` with networking blocked.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";

const args = process.argv.slice(2);
const served = args[0] === "--url";
const [target, shots, name, planText] = served ? args.slice(1) : args;
if (!target || !shots || !name || !planText) {
  console.error("usage: bun viewer/scripts/rows.ts (--url URL | EXPORT.html) SHOTS_DIR NAME PLAN_JSON");
  process.exit(2);
}
const plan = JSON.parse(planText) as { start: string; query: string; pin: string; steps: string[] };
const url = served ? target : pathToFileURL(target).href;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const blocked: string[] = [];
const errors: string[] = [];
const screenshots: string[] = [];

async function open(browser: Browser, width: number, height: number, colorScheme: "light" | "dark"): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, offline: !served });
  if (!served) {
    await context.route("**/*", (route) => {
      const asked = route.request().url();
      if (asked === url || asked.startsWith(`${url}#`)) return route.continue();
      blocked.push(asked);
      return route.abort();
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}#v=chain`);
  await page.locator("[data-place=start] select").waitFor({ timeout: 120_000 });
  return page;
}

/** The row shown once it is the `n`th (from 1): its words, its cards and its links. */
async function row(page: Page, n: number) {
  const which = page.locator("section.results .which");
  await page.waitForFunction((k) => document.querySelector("section.results .which")?.textContent?.startsWith(`Result ${k}`) ?? false, n, { timeout: 120_000 });
  // The count runs beside the row: wait until it is done (no "at least"), then read the row.
  await page.waitForFunction(() => !(document.querySelector("section.results .which")?.textContent ?? "").includes("at least"), null, { timeout: 120_000 });
  return {
    which: (await which.textContent())?.trim() ?? "",
    cards: await page.locator("section.results .row > li.place article").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
    links: await page.locator("section.results .row > li.link .edge").allTextContents(),
  };
}

async function walk(page: Page) {
  await page.locator("[data-place=start] select").selectOption(plan.start);
  const find = page.locator("[data-place=start] input[type=search]");
  await find.fill(plan.query);
  await find.press("Enter");
  const thing = page.locator(`[data-place=start] button.thing:has(.code:text-is(${JSON.stringify(plan.pin)}))`);
  await thing.waitFor({ timeout: 30_000 });
  await thing.click();
  for (const s of plan.steps) await page.locator("[data-add] select").selectOption(s);
  const first = await row(page, 1);
  await page.locator("section.results button", { hasText: "Next" }).click();
  const second = await row(page, 2);
  await page.locator("section.results button", { hasText: "Previous" }).focus();
  await page.keyboard.press("Enter");
  const back = await row(page, 1);
  await page.locator("section.results button", { hasText: "Next" }).click();
  await row(page, 2);
  await page.locator("section.results button", { hasText: "First" }).click();
  const home = await row(page, 1);
  const chip = page.locator("section.results .row > li.link button.chip").first();
  await chip.click();
  const panel = page.locator(`#${await chip.getAttribute("aria-controls")}`);
  const opened = { expanded: await chip.getAttribute("aria-expanded"), rows: ((await panel.innerText()) ?? "").replace(/\s+/g, " ").trim() };
  const scroll = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  return { first, second, back, home, opened, scroll };
}

const browser = await chromium.launch();
const walks: Record<string, unknown>[] = [];
try {
  for (const [label, width, height] of [["desktop", 1280, 900], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      const page = await open(browser, width, height, scheme);
      const walked = await walk(page);
      await page.locator("section.results").scrollIntoViewIfNeeded();
      const path = join(shots!, `${name}-${label}-${scheme}.png`);
      await page.screenshot({ path, fullPage: false });
      screenshots.push(path);
      walks.push({ ...walked, width, scheme });
      await page.context().close();
    }
  }
  console.log(JSON.stringify({ walks, screenshots, blocked, errors }));
} finally {
  await browser.close();
}
