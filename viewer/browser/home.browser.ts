// Home: the map of types and the view file's saved trails.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN, TOWN_VIEW } from "./town.js";

const viewer = useViewer(TOWN, { view: TOWN_VIEW });

test("Home shows the map of types and the saved trails", async () => {
  const { page, shot } = await viewer.open();
  const map = page.locator('main[data-place="home"] svg.map');
  await map.waitFor();
  for (const type of ["Person", "Place", "Event"]) expect(await map.textContent()).toContain(type);
  expect(await page.getByRole("complementary", { name: "Saved trails" }).getByRole("link").allInnerTexts()).toEqual(["Who comes to events"]);
  await shot("map-and-trails");
});

test("a type on the map leads to its table in Tables", async () => {
  const { page, shot } = await viewer.open();
  await page.locator('main[data-place="home"] svg [data-type="Place"]').click();
  await page.getByRole("link", { name: "Open as table" }).click();
  await page.locator('main[data-place="tables"] section[aria-label="Table Place"] tbody tr').first().waitFor();
  expect(await page.locator("tbody a[data-id]").allInnerTexts()).toEqual(["Place:harbor", "Place:market", "Place:square"]);
  await shot("type-to-table");
});

test("a saved trail opens in Trails, as columns", async () => {
  const { page, shot } = await viewer.open();
  await page.getByRole("link", { name: "Who comes to events" }).click();
  const columns = page.locator('main[data-place="trails"] [data-column]');
  await columns.first().waitFor();
  expect(await columns.count()).toBe(3);
  expect(await columns.nth(0).locator("a[data-id]").allInnerTexts()).toEqual(["Spring Fair", "Harbor Regatta"]);
  await shot("saved-trail");
});
