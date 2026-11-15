// Explore: the graph fills the place, the selected thing's card is in the pane; search results open here.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";
import { TOWN } from "./town.js";

type Page = import("playwright").Page;

const viewer = useViewer(TOWN);
const pane = 'aside[aria-label="Selection"]';
const harbor = "#v=explore&node=Place%3Aharbor";
const thing = (page: Page, id: string) => page.locator(`svg.picture [data-thing="${id}"]`);
const shard = (page: Page, id: string) => thing(page, id).locator("polygon");
const drawn = (page: Page) => page.locator("svg.picture [data-thing]").evaluateAll((things) => things.map((t) => t.getAttribute("data-thing")).sort());
const middle = async (page: Page, id: string) => {
  const b = (await shard(page, id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function drag(page: Page, id: string, dx: number, dy: number) {
  const from = await middle(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  return from;
}

test("with no thing open, Explore points to the search", async () => {
  const { page, shot } = await viewer.open("#v=explore");
  expect(await page.locator('main[data-place="explore"]').innerText()).toContain("Search for one");
  expect(await page.locator("svg.picture").count()).toBe(0);
  expect(await page.locator(pane).count()).toBe(0);
  await shot("empty");
});

test("a search result opens in Explore: the graph round it, and its card in the pane", async () => {
  const { page, shot } = await viewer.open();
  await page.getByRole("searchbox", { name: "Search the mosaic" }).fill("harbor");
  await page.getByRole("listbox").locator('[role="option"][data-id="Place:harbor"]').click();
  await page.locator('main[data-place="explore"] svg.picture [data-centre="Place:harbor"]').waitFor();
  expect(await drawn(page)).toEqual(["Event:regatta", "Person:ada", "Person:cleo"]);
  // The thing at the centre is selected, with a ring; a badge counts the links a thing keeps folded.
  expect(await page.locator('svg.picture [data-centre="Place:harbor"] .ring').count()).toBe(1);
  expect(await thing(page, "Person:ada").locator(".badge").textContent()).toBe("+1");
  expect(await thing(page, "Person:cleo").locator(".badge").count()).toBe(0);
  // A link type is named once for its group of lines.
  expect(await page.locator("svg.picture .group-name").allTextContents()).toEqual(["← held at", "← visits"]);
  const card = page.locator(`${pane} article[aria-label="Place:harbor"]`);
  await card.waitFor();
  expect(await card.innerText()).toContain("Old Harbor");
  // The card names the thing: the pane does not say its name a second time.
  expect(await page.locator(pane).getByText("Old Harbor", { exact: true }).count()).toBe(1);
  await shot("graph-and-card");
});

test("pointing at a thing shows its summary, on the stage and off the thing", async () => {
  const { page, shot } = await viewer.open(harbor);
  for (const id of ["Person:ada", "Person:cleo", "Event:regatta"]) {
    const at = await middle(page, id);
    await page.mouse.move(at.x, at.y);
    const tip = page.getByRole("tooltip");
    await tip.waitFor();
    const text = await tip.innerText();
    expect(text).toContain(id === "Event:regatta" ? "Event" : "Person");
    if (id === "Person:ada") {
      expect(text).toContain("Ada");
      expect(text).toContain("visits · 2");
      expect(text).toContain("1 link folded");
      await shot("tooltip");
    }
    await expect
      .poll(async () => {
        const t = (await tip.boundingBox())!;
        const stage = (await page.locator("svg.picture").boundingBox())!;
        const s = (await shard(page, id).boundingBox())!;
        const inside = t.x >= stage.x && t.y >= stage.y && t.x + t.width <= stage.x + stage.width && t.y + t.height <= stage.y + stage.height;
        const apart = t.x >= s.x + s.width || t.x + t.width <= s.x || t.y >= s.y + s.height || t.y + t.height <= s.y;
        return inside && apart;
      })
      .toBe(true);
  }
  await page.mouse.move(2, 2);
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  // The keyboard's focus shows it too.
  await page.locator("svg.picture [data-centre]").focus();
  await page.keyboard.press("Tab");
  await page.getByRole("tooltip").waitFor();
});

test("selecting a thing shows its card; selecting it again unfolds it", async () => {
  const { page, shot } = await viewer.open(harbor);
  await shard(page, "Person:ada").click();
  await page.locator(`${pane} article[aria-label="Person:ada"]`).waitFor();
  expect(await thing(page, "Person:ada").getAttribute("aria-pressed")).toBe("true");
  expect(await thing(page, "Place:market").count()).toBe(0);
  await shard(page, "Person:ada").click();
  await thing(page, "Place:market").waitFor();
  // Its folded link is drawn now: the badge has gone, and the new thing has its own.
  expect(await thing(page, "Person:ada").locator(".badge").count()).toBe(0);
  expect(await thing(page, "Place:market").locator(".badge").textContent()).toBe("+1");
  expect(new URL(page.url()).hash).toContain("x=Person%3Aada");
  await shot("unfolded");
  // The address opens the same picture.
  const again = await viewer.open(new URL(page.url()).hash);
  await thing(again.page, "Place:market").waitFor();
});

test("a link type's chip hides and shows its links", async () => {
  const { page, shot } = await viewer.open(harbor);
  await thing(page, "Person:ada").waitFor();
  const chips = page.getByRole("group", { name: "Show links" });
  expect(await chips.getByRole("button").allInnerTexts()).toEqual(["held at", "visits"]);
  await chips.getByRole("button", { name: "visits" }).click();
  await expect.poll(() => drawn(page)).toEqual(["Event:regatta"]);
  expect(await chips.getByRole("button", { name: "visits" }).getAttribute("aria-pressed")).toBe("false");
  expect(new URL(page.url()).hash).toContain("&e=held_at");
  await shot("link-type-hidden");
  await chips.getByRole("button", { name: "visits" }).click();
  await expect.poll(() => drawn(page)).toEqual(["Event:regatta", "Person:ada", "Person:cleo"]);
  expect(new URL(page.url()).hash).not.toContain("&e=");
});

test("a thing dragged stays where it is dropped, until the layout is tidied", async () => {
  const { page, shot } = await viewer.open(harbor);
  await thing(page, "Person:cleo").waitFor();
  const from = await drag(page, "Person:cleo", 90, 60);
  const dropped = await middle(page, "Person:cleo");
  expect(Math.hypot(dropped.x - from.x - 90, dropped.y - from.y - 60)).toBeLessThan(3);
  // The drag did not select it.
  expect(await thing(page, "Person:cleo").getAttribute("aria-pressed")).toBe("false");
  // Another choice draws the picture again: the thing dragged is still where it was dropped.
  await shard(page, "Person:ada").click();
  await shard(page, "Person:ada").click();
  await thing(page, "Place:market").waitFor();
  const stage = (await page.locator("svg.picture").boundingBox())!;
  const after = await middle(page, "Person:cleo");
  expect(after.x).toBeGreaterThan(stage.x);
  expect(after.x).toBeLessThan(stage.x + stage.width);
  await shot("dragged");
  // Dragged off the stage's middle and tidied: the picture settles again, without the pin.
  const before = await middle(page, "Person:cleo");
  const ada = await middle(page, "Person:ada");
  await page.getByRole("button", { name: "Tidy layout" }).click();
  await expect.poll(async () => {
    const now = await middle(page, "Person:cleo");
    return Math.hypot(now.x - before.x, now.y - before.y);
  }).toBeGreaterThan(20);
  await shot("tidied");
  // "Fit to view" brings back a picture moved off the stage.
  await page.mouse.move(stage.x + 12, stage.y + 12);
  await page.mouse.down();
  await page.mouse.move(stage.x + 300, stage.y + 200, { steps: 6 });
  await page.mouse.up();
  const moved = await middle(page, "Person:ada");
  expect(moved.x - ada.x).not.toBe(0);
  await page.getByRole("button", { name: "Fit to view" }).click();
  const fitted = await middle(page, "Person:ada");
  expect(Math.abs(fitted.x - (stage.x + stage.width / 2))).toBeLessThan(stage.width / 2 - 20);
});

test("the card shows properties and sources, and its link chips select things in the graph", async () => {
  const { page, shot } = await viewer.open(harbor);
  const card = page.locator(`${pane} article[aria-label="Place:harbor"]`);
  await card.waitFor();
  expect(await page.locator(`${pane} .head`).innerText()).toContain("Place");
  expect(await card.getByRole("link", { name: "Open in its table" }).getAttribute("href")).toContain("v=tables");
  expect(await card.getByRole("link", { name: "Start a trail here" }).getAttribute("href")).toContain("v=trails");
  const links = card.getByRole("region", { name: "Links" });
  expect(await links.locator("section[data-edge]").evaluateAll((groups) => groups.map((g) => g.querySelector("h3")!.textContent))).toEqual(["← held at · 1", "← visits · 2"]);
  expect(await links.locator("a[data-id]").evaluateAll((all) => all.map((a) => a.getAttribute("data-id")))).toEqual(["Event:regatta", "Person:ada", "Person:cleo"]);
  expect(await card.getByRole("region", { name: "Sources" }).innerText()).toContain("A quiet harbor with a lighthouse.");
  await shot("card");
  // A link chip selects its thing in the graph: the centre stays, the card changes.
  await links.locator('a[data-id="Person:cleo"]').click();
  await page.locator(`${pane} article[aria-label="Person:cleo"]`).waitFor();
  expect(await thing(page, "Person:cleo").getAttribute("aria-pressed")).toBe("true");
  expect(await page.locator('svg.picture [data-centre="Place:harbor"]').count()).toBe(1);
  // The card settings are in the pane head's menu.
  await page.locator(pane).getByRole("button", { name: /^Card settings/ }).click();
  await page.getByRole("menuitem", { name: "Choose what Person cards show" }).click();
  const picker = page.locator(pane).getByRole("region", { name: "Choose what Person cards show" });
  await picker.getByRole("checkbox").first().waitFor();
  await shot("card-settings");
  await picker.locator('fieldset[data-part="counts"]').getByRole("checkbox").first().uncheck();
  await expect.poll(() => page.locator(`${pane} article section[data-edge]`).count()).toBe(0);
});

test("a link group's heading stays clean: a source button shows where its links come from", async () => {
  const { page, shot } = await viewer.open(harbor);
  const links = page.locator(`${pane} article[aria-label="Place:harbor"]`).getByRole("region", { name: "Links" });
  const group = links.locator("section[data-edge]").first();
  await group.waitFor();
  const source = group.getByRole("button", { name: /^Source: / });
  // Nothing but the heading shows until the button is used, from the keyboard here.
  expect(await group.locator(".rows:not([hidden])").count()).toBe(0);
  await source.focus();
  await page.keyboard.press("Enter");
  expect(await source.getAttribute("aria-expanded")).toBe("true");
  expect(await group.locator(".rows:not([hidden]) .where").first().innerText()).toMatch(/\S/);
  await shot("link-source");
});

test("in the dark theme the stage and the pane are dark, and the page never scrolls", async () => {
  const { page, shot } = await viewer.open(harbor);
  await page.emulateMedia({ colorScheme: "dark" });
  await thing(page, "Person:ada").waitFor();
  const light = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).reduce((sum, n) => sum + Number(n), 0) / 3;
  expect(light(await page.locator(".stage").evaluate((e) => getComputedStyle(e).backgroundColor))).toBeLessThan(60);
  expect(light(await page.locator(pane).evaluate((e) => getComputedStyle(e).backgroundColor))).toBeLessThan(60);
  const at = await middle(page, "Person:ada");
  await page.mouse.move(at.x, at.y);
  await page.getByRole("tooltip").waitFor();
  await shot("dark");
  // The graph fills what the window leaves: nothing scrolls as a whole.
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight && document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  const stage = (await page.locator(".stage").boundingBox())!;
  expect(stage.height).toBeGreaterThan(400);
  expect(stage.y + stage.height).toBeLessThanOrEqual(800);
});
