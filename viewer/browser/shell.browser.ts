// The shell: four places, Home by default; the address names the place; the page fits the window;
// one right pane, resized and collapsed; search results drop down; narrow pages use tabs.
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
  // Explore has no tabs: the selected thing's card is under the graph.
  await page.locator('svg.picture [data-thing="Person:ada"]').waitFor();
  await page.locator('aside[aria-label="Selection"] article[aria-label="Place:harbor"]').waitFor();
  expect(await page.getByRole("tablist", { name: "Explore" }).count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot("narrow-explore");
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

const PLACES = [
  ["home", "#", 'main[data-place="home"] svg.map'],
  ["explore", "#v=explore&q=a&node=Place%3Aharbor", 'aside[aria-label="Selection"] article'],
  ["trails", "#v=trails&c=Person&k=visits", '[data-column="1"]'],
  ["tables", "#v=tables&t=Person", 'section[aria-label="Table Person"] tbody tr'],
] as const;

test("the page fits the window and never scrolls as a whole, in every place and both themes", async () => {
  const { page, shot } = await viewer.open();
  const grounds: Record<string, { band: string; page: string }> = {};
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [place, hash, ready] of PLACES) {
      await page.evaluate((h) => (location.hash = h), hash);
      await page.locator(ready).first().waitFor();
      const fit = await page.evaluate(() => {
        window.scrollTo(0, 5000);
        const shell = document.querySelector(".shell")!.getBoundingClientRect();
        return { scrolled: window.scrollY, tall: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth, bottom: shell.bottom };
      });
      expect(fit, `${place} ${theme}`).toEqual({ scrolled: 0, tall: 800, wide: 1280, bottom: 800 });
      await shot(`${place}-${theme}`);
    }
    grounds[theme] = await page.evaluate(() => ({
      band: getComputedStyle(document.querySelector("header .band")!).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }));
  }
  // Only the band is navy, in both themes; the grounds are neutral and differ.
  expect(grounds.dark!.band).toBe(grounds.light!.band);
  for (const theme of ["light", "dark"]) {
    const [r, g, b] = grounds[theme]!.page.match(/\d+/g)!.map(Number) as [number, number, number];
    expect(Math.max(r, g, b) - Math.min(r, g, b), theme).toBeLessThan(8);
  }
  expect(grounds.dark!.page).not.toBe(grounds.light!.page);
});

test("what the page has to say does not push the place past the window", async () => {
  const { page, shot } = await viewer.open("#v=trails&c=Nothing&k=nowhere");
  await page.locator('[role="status"] li, [role="alert"]').first().waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
  expect(await page.evaluate(() => document.querySelector("main")!.getBoundingClientRect().bottom)).toBe(800);
  await shot("notices");
});

test("the pane is resized by its edge and collapsed to a rail, and both survive a reload, per place", async () => {
  const { page, shot } = await viewer.open();
  const pane = page.locator('aside[data-pane="home"]');
  const width = async (of = pane) => Math.round((await of.boundingBox())!.width);
  await pane.waitFor();
  expect(await width()).toBe(340);
  const grip = (await pane.getByRole("separator").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await width()).toBe(440);
  await page.reload();
  await pane.waitFor();
  expect(await width()).toBe(440);
  await shot("pane-wide");

  await pane.getByRole("button", { name: "Collapse Saved trails" }).click();
  expect(await width()).toBe(40);
  expect(await pane.getByRole("link").count()).toBe(0);
  await page.reload();
  await pane.waitFor();
  expect(await width()).toBe(40);
  await shot("pane-rail");
  // Explore's pane is its own.
  await page.evaluate(() => (location.hash = "#v=explore&node=Place%3Aharbor"));
  const selection = page.locator('aside[data-pane="explore"]');
  await selection.locator("article").waitFor();
  expect(await width(selection)).toBe(340);
  await page.evaluate(() => (location.hash = "#"));
  await pane.getByRole("button", { name: "Show Saved trails" }).click();
  await pane.getByRole("link", { name: "Build a new trail" }).waitFor();
  expect(await width()).toBe(440);
});

test("search results drop down under the field; the keyboard moves through them and Enter opens one in Explore", async () => {
  const { page, shot } = await viewer.open();
  const box = page.getByRole("searchbox", { name: "Search the mosaic" });
  const options = page.getByRole("listbox").getByRole("option");
  await box.fill("harbor");
  await options.first().waitFor();
  expect(await options.evaluateAll((all) => all.map((o) => o.getAttribute("data-id")))).toEqual(["Place:harbor", "Event:regatta"]);
  const field = (await box.boundingBox())!;
  const list = (await page.getByRole("listbox").boundingBox())!;
  expect(list.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(Math.round(list.x)).toBe(Math.round(field.x));
  await shot("search-dropdown");
  await box.press("Escape");
  expect(await page.getByRole("listbox").isVisible()).toBe(false);
  expect(new URL(page.url()).hash).toBe("");
  await box.press("ArrowDown");
  await options.first().waitFor();
  await box.press("ArrowDown");
  expect(await page.locator('[role="option"][aria-selected="true"]').getAttribute("data-id")).toBe("Event:regatta");
  await box.press("Enter");
  await page.locator('main[data-place="explore"] article[aria-label="Event:regatta"]').waitFor();
  expect(await page.getByRole("listbox").isVisible()).toBe(false);
  // A result picked with the pointer opens too.
  await box.fill("ada");
  await options.filter({ hasText: "Ada" }).click();
  await page.locator('main[data-place="explore"] article[aria-label="Person:ada"]').waitFor();
});
