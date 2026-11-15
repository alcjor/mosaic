// Explore: the graph beside the selected thing's card; search results open here.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN } from "./town.js";

const viewer = useViewer(TOWN);
const selection = 'aside[aria-label="Selection"]';

test("with no thing open, Explore points to the search", async () => {
  const { page, shot } = await viewer.open("#v=explore");
  expect(await page.locator('main[data-place="explore"]').innerText()).toContain("Search for one");
  expect(await page.locator("svg.picture").count()).toBe(0);
  await shot("empty");
});

test("a search result opens in Explore, with the graph and its card", async () => {
  const { page, shot } = await viewer.open();
  const box = page.getByRole("searchbox", { name: "Search the mosaic" });
  await box.fill("harbor");
  await box.press("Enter");
  await page.locator('nav[aria-label="Results"] a[data-id="Place:harbor"]').click();
  await page.locator('main[data-place="explore"] svg.picture [data-centre="Place:harbor"]').waitFor();
  expect(await page.locator("svg.picture [data-thing]").evaluateAll((things) => things.map((t) => t.getAttribute("data-thing")).sort())).toEqual([
    "Event:regatta",
    "Person:ada",
    "Person:cleo",
  ]);
  const card = page.locator(`${selection} article[aria-label="Place:harbor"]`);
  await card.waitFor();
  expect(await card.innerText()).toContain("Old Harbor");
  const context = page.locator(`${selection} aside[aria-label="Links and sources"]`);
  expect(await context.locator("a[data-id]").evaluateAll((links) => links.map((a) => a.getAttribute("data-id")).sort())).toEqual([
    "Event:regatta",
    "Person:ada",
    "Person:cleo",
  ]);
  expect(await context.getByRole("region", { name: "Sources" }).innerText()).toContain("A quiet harbor with a lighthouse.");
  await page.locator(selection).getByRole("button", { name: /card/i }).first().waitFor();
  await shot("graph-and-card");
});

test("selecting a thing in the graph shows its card, and unfolding it adds what it links to", async () => {
  const { page, shot } = await viewer.open("#v=explore&node=Place%3Aharbor");
  await page.locator('svg.picture [data-thing="Person:ada"]').click();
  await page.locator(`${selection} article[aria-label="Person:ada"]`).waitFor();
  expect(await page.locator('svg.picture [data-thing="Place:market"]').count()).toBe(0);
  await page.locator(selection).getByRole("button", { name: "Unfold" }).click();
  await page.locator('svg.picture [data-thing="Place:market"]').waitFor();
  expect(new URL(page.url()).hash).toContain("x=Person%3Aada");
  await shot("unfolded");
});

test("a thing dragged in the graph moves, and stays where it is dropped", async () => {
  const { page, shot } = await viewer.open("#v=explore&node=Place%3Aharbor");
  const thing = page.locator('svg.picture [data-thing="Person:cleo"] polygon');
  await thing.waitFor();
  const centre = async () => {
    const b = (await thing.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const from = await centre();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 6 });
  await page.mouse.move(from.x + 120, from.y + 80, { steps: 6 });
  await page.mouse.up();
  const dropped = await centre();
  expect(Math.hypot(dropped.x - from.x, dropped.y - from.y)).toBeGreaterThan(60);
  // Another choice draws the picture again: the thing dragged stays where it was dropped.
  await page.locator('svg.picture [data-thing="Person:ada"]').click();
  await page.locator(selection).getByRole("button", { name: "Unfold" }).click();
  await page.locator('svg.picture [data-thing="Place:market"]').waitFor();
  const svg = (await page.locator("svg.picture").boundingBox())!;
  const after = await centre();
  expect(after.x).toBeGreaterThan(svg.x);
  expect(Math.hypot(after.x - from.x, after.y - from.y)).toBeGreaterThan(30);
  await shot("dragged");
});
