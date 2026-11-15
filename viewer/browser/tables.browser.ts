// Tables: types as chips, the table of the one picked; links as chips, filters as chips, a row's card in the pane.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN } from "./town.js";

const viewer = useViewer(TOWN);
const WIDE = { width: 1440, height: 900 };
type Page = import("playwright").Page;
const names = (page: Page) => page.locator("tbody td.name a").allInnerTexts();
const scrolls = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);

test("the types are chips with counts, and a type shows its table with its links as chips", async () => {
  const { page, shot } = await viewer.open("#v=tables", WIDE);
  expect(await page.locator('main[data-place="tables"]').innerText()).toContain("Pick a type");
  const chips = page.locator('nav[aria-label="Types"] a[data-type]');
  expect((await chips.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())).toEqual(["Event 2", "Person 4", "Place 3"]);
  await chips.nth(1).click();
  const table = page.locator('section[aria-label="Table Person"]');
  await table.locator("tbody tr").first().waitFor();
  expect(await names(page)).toEqual(["Ada", "Ben", "Cleo", "Dov"]);
  expect(await table.locator("thead th").allInnerTexts()).toEqual(["Name", "name", "visits"]);
  const links = table.locator('tbody tr:first-child td[data-link="visits"] a[data-id]');
  await links.first().waitFor();
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute("data-id")))).toEqual(["Place:harbor", "Place:market"]);
  expect(await table.locator('nav[aria-label="Pages"]').innerText()).toContain("1–4 of 4");
  expect(await scrolls(page)).toBe(false);
  await shot("table");
  // A chip in a cell follows the link: the thing opens in Explore.
  await links.nth(1).click();
  await page.locator('main[data-place="explore"]').waitFor();
  expect(new URL(page.url()).hash).toContain("node=Place%3Amarket");
});

test("a column header sorts the table; a filter is added from a popover and removed as a chip", async () => {
  const { page, shot } = await viewer.open("#v=tables&t=Person", WIDE);
  const header = page.locator("thead").getByRole("button", { name: "Name", exact: true });
  await header.click();
  await page.locator('th[aria-sort="ascending"]', { hasText: /^Name/ }).waitFor();
  await header.click();
  await page.locator('th[aria-sort="descending"]', { hasText: /^Name/ }).waitFor();
  await expect.poll(() => names(page)).toEqual(["Dov", "Cleo", "Ben", "Ada"]);
  await page.getByRole("button", { name: "Add a filter" }).click();
  const form = page.getByRole("form", { name: "Add a filter" });
  await form.getByLabel("Column").selectOption("visits");
  await form.getByLabel("Operator").selectOption("contains");
  await form.getByLabel("Value").fill("harbor");
  await shot("add-a-filter");
  await form.getByRole("button", { name: "Add" }).click();
  await expect.poll(() => names(page)).toEqual(["Cleo", "Ada"]);
  expect(new URL(page.url()).hash).toContain("w=");
  expect(await page.locator('ul[aria-label="Filters"] li').allInnerTexts()).toEqual(["visits contains harbor"]);
  expect(await page.locator("[data-total]").innerText()).toContain("2 of 4");
  await shot("sorted-and-filtered");
  await page.getByRole("button", { name: /^Remove filter/ }).click();
  await expect.poll(() => names(page)).toHaveLength(4);
});

test("a row's name opens the thing in Explore", async () => {
  const { page } = await viewer.open("#v=tables&t=Place", WIDE);
  await page.locator('tbody a[data-id="Place:market"]').click();
  await page.locator('main[data-place="explore"]').waitFor();
  expect(new URL(page.url()).hash).toContain("node=Place%3Amarket");
});

test("picking a row shows its card in the pane, which starts collapsed; in dark too", async () => {
  const { page, shot } = await viewer.open("#v=tables&t=Person", WIDE);
  await page.emulateMedia({ colorScheme: "dark" });
  const pane = page.getByRole("complementary", { name: "Selected row" });
  expect(await pane.getAttribute("class")).toContain("collapsed");
  await page.locator("tbody tr", { hasText: "Ben" }).locator("td").last().click({ position: { x: 300, y: 8 } });
  await page.locator('tbody tr[aria-selected="true"]', { hasText: "Ben" }).waitFor();
  expect(await pane.innerText()).toContain("Ben");
  await shot("row-picked-dark");
  await pane.getByRole("button", { name: "Show Selected row" }).click();
  await pane.locator('article[aria-label="Person:ben"]').waitFor();
  expect(await pane.innerText()).toContain("Ben bakes bread for the market.");
  expect(await scrolls(page)).toBe(false);
  await shot("row-card-dark");
});

test("below 960px the chips wrap and the table still shows", async () => {
  const { page, shot } = await viewer.open("#v=tables&t=Place", { width: 420, height: 800 });
  await page.locator('section[aria-label="Table Place"] tbody tr').first().waitFor();
  expect(await names(page)).toEqual(["Old Harbor", "Night Market", "Bell Square"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot("narrow");
});
