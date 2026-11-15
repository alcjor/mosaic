// The shell: four places, Home by default; the address names the place; narrow pages use tabs.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN } from "./town.js";

const viewer = useViewer(TOWN);

test("the shell offers Home, Explore, Trails and Tables, and opens at Home", async () => {
  const { page, shot } = await viewer.open();
  const places = page.getByRole("navigation", { name: "Places" }).getByRole("link");
  expect(await places.allInnerTexts()).toEqual(["Home", "Explore", "Trails", "Tables"]);
  expect(await page.locator('[aria-current="page"]').innerText()).toBe("Home");
  for (const place of ["Explore", "Trails", "Tables", "Home"]) {
    await places.filter({ hasText: place }).click();
    await page.locator(`main[data-place="${place.toLowerCase()}"]`).waitFor();
    expect(await page.locator('nav[aria-label="Places"] [aria-current="page"]').innerText()).toBe(place);
  }
  expect(new URL(page.url()).hash).not.toContain("v=");
  await shot("home");
});

test("the address names the place, and a place keeps what was open in it", async () => {
  const { page, shot } = await viewer.open("#v=tables&t=Place");
  await page.locator('section[aria-label="Table Place"] tbody tr').first().waitFor();
  await page.getByRole("link", { name: "Home" }).click();
  await page.locator('main[data-place="home"]').waitFor();
  await page.getByRole("link", { name: "Tables" }).click();
  await page.locator('section[aria-label="Table Place"] tbody tr').first().waitFor();
  expect(new URL(page.url()).hash).toContain("t=Place");
  await shot("back-in-tables");
});

test("every style the page uses comes from a token it defines", async () => {
  const { page } = await viewer.open("#v=explore&node=Place%3Aharbor");
  await page.locator('aside[aria-label="Selection"] article').waitFor();
  const unknown = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const names = new Set<string>();
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
        for (const m of rule.cssText.matchAll(/var\((--[\w-]+)/g)) names.add(m[1]!);
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    return [...names].filter((name) => root.getPropertyValue(name) === "");
  });
  expect(unknown).toEqual([]);
  expect(await page.locator("[style]:not(svg *)").count()).toBe(0);
});

test("below 960px a place's side panes are tabs", async () => {
  const { page, shot } = await viewer.open("#v=explore&q=harbor&node=Place%3Aharbor", { width: 420, height: 800 });
  const tabs = page.getByRole("tablist", { name: "Explore" }).getByRole("tab");
  expect(await tabs.allInnerTexts()).toEqual(["Results", "Graph", "Card"]);
  await page.locator('aside[aria-label="Selection"] article[aria-label="Place:harbor"]').waitFor();
  expect(await page.locator('nav[aria-label="Results"]').isVisible()).toBe(false);
  await shot("narrow-card");
  await tabs.filter({ hasText: "Graph" }).click();
  await page.getByRole("link", { name: "Ada" }).waitFor();
  expect(await page.locator('aside[aria-label="Selection"]').isVisible()).toBe(false);
  await tabs.filter({ hasText: "Results" }).click();
  await page.locator('nav[aria-label="Results"] a[data-id="Place:harbor"]').waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot("narrow-results");
  // The other places fit the width too.
  for (const [hash, ready] of [
    ["#", 'main[data-place="home"] .list'],
    ["#v=trails&c=Person&k=visits", 'li[data-column="1"]'],
    ["#v=tables&t=Person", 'section[aria-label="Table Person"] tbody tr'],
  ] as const) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.locator(ready).first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), hash).toBe(true);
    await shot(`narrow-${hash.match(/v=(\w+)/)?.[1] ?? "home"}`);
  }
});
