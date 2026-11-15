// Home: the map of types on its stage, and saved trails and "Jump back in" in the pane.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN, TOWN_VIEW } from "./town.js";

const viewer = useViewer(TOWN, { view: TOWN_VIEW });
const WIDE = { width: 1440, height: 900 };
type Page = import("playwright").Page;
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const scrolls = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);

test("the map of types fills the stage: shards by count, link types on the lines", async () => {
  const { page, shot } = await viewer.open("", WIDE);
  const home = page.locator('main[data-place="home"]');
  const map = home.locator("svg.map");
  await map.locator("a[data-type]").first().waitFor();
  expect(await home.getByRole("heading", { level: 1 }).innerText()).toBe("What is in this mosaic");
  expect(await map.locator("a[data-type]").evaluateAll((as) => as.map((a) => a.getAttribute("data-type")).sort())).toEqual(["Event", "Person", "Place"]);
  expect((await map.locator(".pill text").allTextContents()).sort()).toEqual(["held at", "visits"]);
  // Four people, three places, two events: the shards are sized in that order, each in its own colour.
  const sizes = await Promise.all(["Person", "Place", "Event"].map(async (type) => (await box(page, `svg.map a[data-type="${type}"] polygon`)).width));
  expect(sizes[0]!).toBeGreaterThan(sizes[1]!);
  expect(sizes[1]!).toBeGreaterThan(sizes[2]!);
  const colours = await map.locator("a[data-type]").evaluateAll((as) => as.map((a) => getComputedStyle(a.querySelector("polygon")!).fill));
  expect(new Set(colours).size).toBe(3);
  // The map sits in the middle of the stage, which takes the room the heading and the pane leave.
  const stage = await box(page, 'main[data-place="home"] .stage');
  const drawn = await Promise.all(["Person", "Place", "Event"].map((type) => box(page, `svg.map a[data-type="${type}"]`)));
  const left = Math.min(...drawn.map((b) => b.x)) - stage.x;
  const right = stage.x + stage.width - Math.max(...drawn.map((b) => b.x + b.width));
  expect(Math.abs(left - right)).toBeLessThan(40);
  expect(stage.height).toBeGreaterThan(600);
  expect(await scrolls(page)).toBe(false);
  await shot("map");
});

test("a type on the map opens its table", async () => {
  const { page, shot } = await viewer.open("", WIDE);
  await page.locator('main[data-place="home"] svg.map a[data-type="Place"]').click();
  await page.locator('main[data-place="tables"] section[aria-label="Table Place"] tbody tr').first().waitFor();
  expect(await page.locator('nav[aria-label="Types"] a[aria-current="page"]').getAttribute("data-type")).toBe("Place");
  await shot("type-to-table");
});

test("the pane holds the saved trails, each saying its steps, and a way to build one", async () => {
  const { page } = await viewer.open("", WIDE);
  const pane = page.getByRole("complementary", { name: "Saved trails" });
  const trail = pane.locator('a[data-trail="Who comes to events"]');
  expect(await trail.innerText()).toContain("Event → Place → Person");
  expect(await pane.getByRole("link", { name: "Build a new trail" }).getAttribute("href")).toContain("v=trails");
  await trail.click();
  await page.locator('main[data-place="trails"]').waitFor();
  expect(new URL(page.url()).hash).toContain("c=Event");
});

test("Jump back in lists the things opened in this mosaic, newest first, in dark too", async () => {
  const { page, shot } = await viewer.open("#node=Place%3Amarket&v=explore", WIDE);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator('main[data-place="explore"]').waitFor();
  await page.goto(page.url().replace(/#.*/, "#node=Person%3Aada&v=explore"));
  await page.locator('nav[aria-label="Places"] a[data-place-link="home"]').click();
  const recent = page.getByRole("region", { name: "Jump back in" }).locator("a[data-id]");
  await expect.poll(() => recent.evaluateAll((as) => as.map((a) => a.getAttribute("data-id")))).toEqual(["Person:ada", "Place:market"]);
  expect(await recent.first().innerText()).toContain("Ada");
  expect(await scrolls(page)).toBe(false);
  await shot("jump-back-in-dark");
  await recent.nth(1).click();
  await page.locator('main[data-place="explore"]').waitFor();
  expect(new URL(page.url()).hash).toContain("node=Place%3Amarket");
});
