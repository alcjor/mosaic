// A thing's card shows what `get` returns, its links from `neighbors`, each opening the other node, and its
// sources from `cite`. Rendered on the server side of Svelte, from real kit answers.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import App from "../src/App.svelte";
import EntityCard from "../src/components/EntityCard.svelte";
import { nodePage, openMosaic, type NodeView } from "../src/lib/mosaic.js";
import { parseRoute, routeHash } from "../src/lib/route.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";

const hrefFor = (id: string) => routeHash({ query: "Item", node: id });

/** The values of `attribute` on every element of the markup that has it. */
function attributes(html: string, attribute: string): string[] {
  return [...html.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g"))].map((m) => m[1]!.replaceAll("&amp;", "&"));
}

describe("node page", () => {
  it("the card shows what get returns: label, type, id, summary and properties", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const view = (await nodePage(file, "Item:b")) as NodeView;
    const { body } = render(EntityCard, { props: { node: view.node } });
    expect(body).toContain("Item B");
    expect(body).toContain("Item:b");
    expect(body).toContain(">Item<");
    expect(body).toContain("Second");
    for (const [key, value] of Object.entries(view.node.props ?? {})) {
      expect(body).toContain(`>${key}<`);
      expect(body).toContain(`>${typeof value === "string" ? value : JSON.stringify(value)}<`);
    }
    file.close();
  });

  it("the context shows the links from neighbors, each opening the other node, and the sources from cite", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const view = (await nodePage(file, "Group:x")) as NodeView;
    const { body } = render(EntityCard, { props: { node: view.node, links: view.links, sources: { rows: view.sources, total: view.sourcesTotal }, hrefFor } });
    expect(body).toContain("← in group · 2");
    const links = attributes(body, "href").map(parseRoute);
    expect(links).toEqual([
      { query: "Item", node: "Item:a" },
      { query: "Item", node: "Item:b" },
    ]);
    for (const row of view.sources) {
      expect(body).toContain(`${row.source}${row.locator ? `:${row.locator}` : ""}`);
      if (row.snippet) expect(body).toContain(row.snippet);
    }
    expect(view.sources.length).toBeGreaterThan(0);
    file.close();
  });
});

describe("App", () => {
  it("before a mosaic is open, offers to open one and the search box is disabled", () => {
    const { body } = render(App, { props: { viewer: new Viewer() } });
    expect(body).toContain("Open a mosaic");
    expect(body).toMatch(/type="file"/);
    expect(body).toMatch(/type="search"[^>]*disabled/);
  });

  it("with a mosaic open, names it with its short hash, and Explore is the place shown", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.search("Item");
    await viewer.show("Item:a");
    viewer.place = "explore";
    const { body } = render(App, { props: { viewer } });
    const hash = viewer.file!.header.knowledge_hash;
    expect(body).toContain(">mosaic.mosaic<");
    expect(body).toContain(`>${hash.slice(0, 12)}<`);
    expect(body).toMatch(/type="search"(?![^>]*disabled)/);
    expect(body).toContain('data-place="explore"');
  });
});
