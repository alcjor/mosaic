// Trails: a chain as columns, one per step, or as one table.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN } from "./town.js";

const viewer = useViewer(TOWN);
const things = (page: import("playwright").Page, column: number) => page.locator(`li[data-column="${column}"] a[data-id]`).allInnerTexts();

test("a trail built step by step shows one column per step", async () => {
  const { page, shot } = await viewer.open("#v=trails");
  await page.getByLabel("Start from").selectOption("Person");
  await page.getByLabel("Add a step").selectOption({ index: 1 });
  await page.locator('li[data-column="1"]').waitFor();
  expect(await things(page, 0)).toEqual(["Ada", "Ben", "Cleo", "Dov"]);
  expect((await things(page, 1)).sort()).toEqual(["Bell Square", "Night Market", "Old Harbor"]);
  expect(new URL(page.url()).hash).toContain("c=Person");
  await shot("columns");
});

test("picking a thing pins it and narrows the other columns", async () => {
  const { page, shot } = await viewer.open("#v=trails&c=Person&k=visits");
  await page.locator('li[data-column="1"] a[data-id="Place:harbor"]').waitFor();
  await page.locator('li[data-column="1"] li', { hasText: "Old Harbor" }).getByRole("button").click();
  await expect.poll(() => things(page, 0)).toEqual(["Ada", "Cleo"]);
  expect(await things(page, 1)).toEqual(["Old Harbor"]);
  expect(new URL(page.url()).hash).toContain("p1=Place%3Aharbor");
  await shot("pinned");
  await page.locator('li[data-column="1"]').getByRole("button", { pressed: true }).click();
  await expect.poll(() => things(page, 0)).toEqual(["Ada", "Ben", "Cleo", "Dov"]);
});

test("the trail's results show as one table too", async () => {
  const { page, shot } = await viewer.open("#v=trails&c=Person&k=visits");
  await page.locator('li[data-column="1"]').waitFor();
  await page.getByRole("group", { name: "Show the trail as" }).getByRole("button", { name: "Table" }).click();
  const rows = page.locator('section[aria-label="Results as a table"] tbody tr');
  await expect.poll(() => rows.count()).toBe(6);
  expect(await page.locator("li[data-column]").count()).toBe(0);
  expect(new URL(page.url()).hash).toContain("show=table");
  await shot("table");
  await page.getByRole("group", { name: "Show the trail as" }).getByRole("button", { name: "Columns" }).click();
  await page.locator('li[data-column="1"]').waitFor();
});
