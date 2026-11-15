// The template for browser tests: open the page on a small invented mosaic, search, open a node.
import { expect, test } from "vitest";
import { useViewer } from "./harness.js";

const viewer = useViewer({
  nodes: [
    { type: "Place", key: "harbor", label: "Old Harbor", summary: "A quiet harbor with a lighthouse.", snippets: ["The harbor has a lighthouse."] },
    { type: "Place", key: "market", label: "Night Market", summary: "Stalls open after dark.", snippets: ["The market opens at dusk."] },
    { type: "Person", key: "ada", label: "Ada", summary: "Keeps the lighthouse.", snippets: ["Ada keeps the lighthouse."] },
  ],
  edgeTypes: [["keeps", "Person", "Place"]],
  edges: [{ type: "keeps", from: "Person:ada", to: "Place:harbor" }],
});

test("search finds a node and its page shows what links to it", async () => {
  const { page, shot } = await viewer.open();
  const box = page.getByRole("searchbox", { name: "Search the mosaic" });
  await box.fill("harbor");
  await box.press("Enter");
  const result = page.locator('nav[aria-label="Results"] a[data-id="Place:harbor"]');
  await result.waitFor();
  await result.click();
  const card = page.locator('article[aria-label="Place:harbor"]');
  await card.waitFor();
  expect(await card.innerText()).toContain("Old Harbor");
  await expect.poll(() => page.locator('aside[aria-label="Links and sources"] a[data-id="Person:ada"]').count()).toBe(1);
  await shot("node-page");
});
