// Tables: pick a type, see its table; sort it, filter it.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN } from "./town.js";

const viewer = useViewer(TOWN);
const ids = (page: import("playwright").Page) => page.locator("tbody a[data-id]").allInnerTexts();

test("Tables lists the types, and a type shows its table", async () => {
  const { page, shot } = await viewer.open("#v=tables");
  expect(await page.locator('main[data-place="tables"]').innerText()).toContain("Pick a type");
  await page.locator('nav[aria-label="Types"] a[data-type="Person"]').click();
  await page.locator('section[aria-label="Table Person"] tbody tr').first().waitFor();
  expect(await ids(page)).toEqual(["Person:ada", "Person:ben", "Person:cleo", "Person:dov"]);
  await shot("table");
});

test("a column header sorts the table, and a filter narrows it", async () => {
  const { page, shot } = await viewer.open("#v=tables&t=Person");
  const header = page.locator("thead").getByRole("button", { name: "label" });
  await header.click();
  await page.locator('th[aria-sort="ascending"]', { hasText: "label" }).waitFor();
  await header.click();
  await page.locator('th[aria-sort="descending"]', { hasText: "label" }).waitFor();
  await expect.poll(() => ids(page)).toEqual(["Person:dov", "Person:cleo", "Person:ben", "Person:ada"]);
  await page.getByLabel("Column", { exact: true }).selectOption("label");
  await page.getByLabel("Operator", { exact: true }).selectOption("contains");
  await page.getByLabel("Value", { exact: true }).fill("e");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect.poll(() => ids(page)).toEqual(["Person:cleo", "Person:ben"]);
  await shot("sorted-and-filtered");
  await page.getByRole("button", { name: /^Remove filter/ }).click();
  await expect.poll(() => ids(page)).toHaveLength(4);
});

test("a row's id opens the thing in Explore", async () => {
  const { page } = await viewer.open("#v=tables&t=Place");
  await page.locator('tbody a[data-id="Place:market"]').click();
  await page.locator('main[data-place="explore"] aside[aria-label="Selection"] article[aria-label="Place:market"]').waitFor();
});
