// Trails: a chain built in one line, shown as columns of cards, one result at a time, or a table.
import { expect, test } from "vitest";
import type { MosaicSpec } from "../../kit/test/build-mosaic.js";
import { useViewer } from "./harness.js";

type Page = import("playwright").Page;

// An invented lending library: thirty readers, three books, two authors.
const reader = (key: string, label: string) => ({ type: "Reader", key, label, props: JSON.stringify({ joined: 2019 }), snippets: [`${label} holds a card.`] });
const book = (key: string, label: string, year: number, pages: number, shelf: string) => ({
  type: "Book",
  key,
  label,
  summary: `${label} is on shelf ${shelf}.`,
  props: JSON.stringify({ pages, shelf, year }),
  snippets: [`${label}, ${year}.`],
});
const crowd = Array.from({ length: 26 }, (_, i) => `r${String(i + 5).padStart(2, "0")}`);
const LIBRARY: MosaicSpec = {
  nodes: [
    reader("ada", "Ada"),
    reader("ben", "Ben"),
    reader("cleo", "Cleo"),
    reader("dov", "Dov"),
    ...crowd.map((key) => reader(key, `Reader ${key.slice(1)}`)),
    book("bells", "Bell Founding", 1962, 148, "A1"),
    book("lamps", "Lamp Oil", 1987, 212, "B2"),
    book("tides", "Tide Tables", 2004, 96, "C3"),
    { type: "Author", key: "ilan", label: "Ilan Reyes", snippets: ["Ilan Reyes writes about bells."] },
    { type: "Author", key: "mara", label: "Mara Voss", snippets: ["Mara Voss writes about the sea."] },
  ],
  edgeTypes: [
    ["borrowed", "Reader", "Book"],
    ["written_by", "Book", "Author"],
  ],
  edges: [
    { type: "borrowed", from: "Reader:ada", to: "Book:tides" },
    { type: "borrowed", from: "Reader:ada", to: "Book:lamps" },
    { type: "borrowed", from: "Reader:ben", to: "Book:lamps" },
    { type: "borrowed", from: "Reader:ben", to: "Book:bells" },
    { type: "borrowed", from: "Reader:cleo", to: "Book:tides" },
    { type: "borrowed", from: "Reader:dov", to: "Book:bells" },
    ...crowd.map((key) => ({ type: "borrowed", from: `Reader:${key}`, to: "Book:bells" })),
    { type: "written_by", from: "Book:tides", to: "Author:mara" },
    { type: "written_by", from: "Book:lamps", to: "Author:mara" },
    { type: "written_by", from: "Book:bells", to: "Author:ilan" },
  ],
};
const VIEW = { search: "text", chains: [{ name: "Who reads whom", start: "Reader", steps: [{ link: "borrowed" }, { link: "written_by" }] }] };
const TRAIL = "#v=trails&c=Reader&k=borrowed&k=written_by";

const viewer = useViewer(LIBRARY, { view: VIEW });
const hash = (page: Page) => new URL(page.url()).hash;
const cards = (page: Page, column: number) => page.locator(`[data-column="${column}"] li[data-id]`);
const names = (page: Page, column: number) => cards(page, column).locator("strong").allInnerTexts();
const lit = (page: Page, state: string) => page.locator(`li[data-lit="${state}"]`).evaluateAll((all) => all.map((li) => (li as HTMLElement).dataset.id).sort());
const card = (page: Page, column: number, id: string) => page.locator(`[data-column="${column}"] li[data-id="${id}"]`);
const pick = (page: Page, column: number, id: string) => card(page, column, id).getByRole("button", { pressed: undefined }).first();
const showAs = (page: Page, name: string) => page.getByRole("group", { name: "Show the trail as" }).getByRole("button", { name }).click();

test("a trail built in one line shows one column of cards per step, joined by lines", async () => {
  const { page, shot } = await viewer.open("#v=trails");
  await page.getByLabel("Start at").selectOption("Reader");
  await page.getByRole("button", { name: "Add a step" }).click();
  await page.getByRole("menuitem", { name: "borrowed → Book" }).click();
  await cards(page, 1).first().waitFor();
  expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe("Reader → Book");
  await page.getByRole("button", { name: "Add a step" }).click();
  await page.getByRole("menuitem", { name: "written_by → Author" }).click();
  await cards(page, 2).first().waitFor();
  expect((await names(page, 0)).slice(0, 4)).toEqual(["Ada", "Ben", "Cleo", "Dov"]);
  expect(await names(page, 1)).toEqual(["Lamp Oil", "Tide Tables", "Bell Founding"]);
  expect(await names(page, 2)).toEqual(["Mara Voss", "Ilan Reyes"]);
  expect(hash(page)).toContain("c=Reader&k=borrowed&k=written_by");
  await expect.poll(() => page.locator(".counts").innerText()).toContain("32 results");
  // A card says its first properties in one line; a line joins each pair a result holds side by side.
  await expect.poll(() => card(page, 1, "Book:lamps").innerText()).toContain("212 · B2 · 1987");
  await expect.poll(() => page.locator("svg.lines path").count()).toBeGreaterThanOrEqual(5);
  await shot("cards");

  // A step changes or goes from its own menu, without starting over.
  await page.getByRole("button", { name: /^Step 2/ }).click();
  await page.getByRole("menuitem", { name: "Remove this step" }).click();
  await expect.poll(() => page.locator("[data-column]").count()).toBe(2);
  expect(hash(page)).not.toContain("written_by");
});

test("picking a card lights up everything connected to it; picking it again clears", async () => {
  const { page, shot } = await viewer.open(TRAIL);
  await card(page, 1, "Book:tides").waitFor();
  await pick(page, 1, "Book:tides").click();
  expect(await lit(page, "picked")).toEqual(["Book:tides"]);
  expect(await lit(page, "lit")).toEqual(["Author:mara", "Reader:ada", "Reader:cleo"]);
  expect(await lit(page, "dimmed")).toContain("Author:ilan");
  expect(await page.locator('svg.lines path[data-lit="lit"]').count()).toBe(3);
  // Dimmed text stays readable: the card is not faded as a whole.
  expect(await card(page, 2, "Author:ilan").evaluate((li) => getComputedStyle(li).opacity)).toBe("1");
  await shot("picked");
  await pick(page, 1, "Book:tides").click();
  expect(await page.locator("li[data-lit]").count()).toBe(0);
});

test("a card's menu pins its place, which narrows the trail, and a double pick opens it in Explore", async () => {
  const { page, shot } = await viewer.open(TRAIL);
  await card(page, 1, "Book:tides").waitFor();
  await page.getByRole("button", { name: "More for Tide Tables" }).click();
  await page.getByRole("menuitem", { name: /^Pin/ }).click();
  await expect.poll(() => names(page, 0)).toEqual(["Ada", "Cleo"]);
  expect(await names(page, 1)).toEqual(["Tide Tables"]);
  expect(hash(page)).toContain("p1=Book%3Atides");
  await page.getByRole("button", { name: "Place 2: Tide Tables" }).waitFor();
  await shot("pinned");
  await page.getByRole("button", { name: "More for Tide Tables" }).click();
  await page.getByRole("menuitem", { name: /^Unpin/ }).click();
  await expect.poll(() => cards(page, 0).count()).toBe(20);

  // The builder pins a place to a thing found by search.
  await page.getByRole("button", { name: "Place 2: any Book" }).click();
  await page.getByLabel("Pin to one Book").fill("Lamp");
  await page.getByRole("button", { name: "Find" }).click();
  await page.locator('button[data-pin="Book:lamps"]').click();
  await expect.poll(() => names(page, 0)).toEqual(["Ada", "Ben"]);
  expect(hash(page)).toContain("p1=Book%3Alamps");

  await pick(page, 0, "Reader:ada").dblclick();
  await expect.poll(() => hash(page)).toContain("v=explore");
  expect(hash(page)).toContain("Reader%3Aada");
});

test("a long column shows its first cards and more on request, and scrolls on its own", async () => {
  const { page, shot } = await viewer.open(TRAIL);
  await card(page, 0, "Reader:ada").waitFor();
  expect(await cards(page, 0).count()).toBe(20);
  const list = page.locator('[data-column="0"] ul');
  expect(await list.evaluate((ul) => ul.scrollHeight > ul.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  // The lines follow a column as it scrolls.
  const line = () => page.locator("svg.lines path").first().getAttribute("d");
  const before = await line();
  await list.evaluate((ul) => ul.scrollTo(0, 60));
  await expect.poll(line).not.toBe(before);
  await page.getByRole("button", { name: "Show 10 more of 30" }).click();
  await expect.poll(() => cards(page, 0).count()).toBe(30);
  expect(await page.getByRole("button", { name: /^Show \d+ more/ }).count()).toBe(0);
  await list.evaluate((ul) => ul.scrollTo(0, ul.scrollHeight));
  await shot("more");
});

test("one result at a time: full cards, previous and next, the arrow keys and the strip", async () => {
  const { page, shot } = await viewer.open(TRAIL);
  await card(page, 0, "Reader:ada").waitFor();
  await showAs(page, "One at a time");
  const where = page.locator("section[aria-label='Trail one result at a time'] [role=status]");
  const shown = () => page.locator("[data-place][data-id]").evaluateAll((all) => all.map((el) => (el as HTMLElement).dataset.id));
  await expect.poll(() => where.innerText()).toBe("Result 1 of 32");
  expect(await shown()).toEqual(["Reader:ada", "Book:lamps", "Author:mara"]);
  expect(hash(page)).toContain("show=one");
  // Each card is the type's own card: its facts, and the sources behind them.
  const lamps = page.locator('[data-place="1"]');
  await lamps.locator("article").waitFor();
  await expect.poll(() => lamps.innerText()).toContain("212");
  await expect.poll(() => lamps.locator("[data-fact] button").count()).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Next result" }).click();
  await expect.poll(() => where.innerText()).toBe("Result 2 of 32");
  expect(await shown()).toEqual(["Reader:ada", "Book:tides", "Author:mara"]);
  await expect.poll(() => hash(page)).toContain("at=2");
  await page.locator("body").press("ArrowRight");
  await expect.poll(() => where.innerText()).toBe("Result 3 of 32");
  await page.locator("body").press("ArrowLeft");
  await page.locator("body").press("ArrowLeft");
  await expect.poll(() => where.innerText()).toBe("Result 1 of 32");
  expect(await page.getByRole("button", { name: "Previous result" }).isDisabled()).toBe(true);

  const strip = page.locator("button[data-result]");
  expect(await strip.count()).toBe(32);
  await strip.nth(5).click();
  await expect.poll(() => where.innerText()).toBe("Result 6 of 32");
  expect(await shown()).toEqual(["Reader:dov", "Book:bells", "Author:ilan"]);
  await page.locator('[data-place="2"] article').waitFor();
  await shot("one");

  // The address holds the view and the result's position.
  const again = await viewer.open(`${TRAIL}&show=one&at=4`);
  await expect.poll(() => again.page.locator("[data-place][data-id]").first().getAttribute("data-id")).toBe("Reader:ben");
  expect(await again.page.locator("section[aria-label='Trail one result at a time'] [role=status]").innerText()).toBe("Result 4 of 32");
});

test("the trail's results show as one table too", async () => {
  const { page, shot } = await viewer.open(TRAIL);
  await card(page, 0, "Reader:ada").waitFor();
  await showAs(page, "Table");
  const rows = page.locator('section[aria-label="Results as a table"] tbody tr');
  await expect.poll(() => rows.count()).toBe(20);
  expect(await page.locator("li[data-id]").count()).toBe(0);
  expect(hash(page)).toContain("show=table");
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  await shot("table");
  await showAs(page, "All cards");
  await card(page, 0, "Reader:ada").waitFor();
});

test("a saved trail opens under its name, and any trail can be saved as view file text", async () => {
  const { page, shot } = await viewer.open("#v=trails");
  await page.getByRole("navigation", { name: "Saved trails" }).getByRole("button", { name: "Who reads whom" }).click();
  await card(page, 2, "Author:mara").waitFor();
  expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe("Who reads whom");
  expect(await page.locator("[data-column]").count()).toBe(3);
  await page.getByRole("button", { name: "Save this trail" }).click();
  expect(await page.getByLabel("View file text").inputValue()).toContain("Who reads whom");
  await shot("saved");
});

test("in the dark theme the trail fits the window, and the page never scrolls as a whole", async () => {
  const { page, shot } = await viewer.open(TRAIL);
  await page.emulateMedia({ colorScheme: "dark" });
  await card(page, 1, "Book:tides").waitFor();
  await pick(page, 1, "Book:tides").click();
  const fit = await page.evaluate(() => {
    scrollTo(0, 400);
    return { scrolled: scrollY, tall: document.scrollingElement!.scrollHeight, wide: document.scrollingElement!.scrollWidth };
  });
  expect(fit).toEqual({ scrolled: 0, tall: 800, wide: 1280 });
  await shot("dark");
});
