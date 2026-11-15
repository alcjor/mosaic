// The neighbourhood opened from a link (need G-8): the picture a colleague lands on is
// exactly the one whose address was shared, and a link naming what the mosaic lacks says what it
// could not apply. Rendered on the server from neighbourhoods loaded through the kit; the browser
// test makes the choices, shares the address and opens it. Data is invented.
import type { SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
import { applyAddress, hoodRoute } from "../src/lib/graph/hood-address.js";
import { expand, hide, HoodLoader, hoodOf, showEdge, withLimit, type HoodState } from "../src/lib/graph/hood.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { parseRoute, routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, Shape } from "../src/lib/view.js";

const pad = (i: number) => String(i).padStart(2, "0");

function spec(): MosaicSpec {
  const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
  return {
    typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [
      ["points_at", "Item", "Hub"],
      ["carries", "Hub", "Tag"],
      ["related", "Tag", "Tag"],
    ],
    nodes: [
      { type: "Hub", key: "h", label: "The hub" },
      ...items.map((k) => ({ type: "Item", key: k, label: `Item ${k}` })),
      ...["t0", "t1", "t2", "x0", "x1", "x2", "x3"].map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` })),
    ],
    edges: [
      ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
      ...["t0", "t1", "t2"].map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
      ...["x0", "x1", "x2", "x3"].map((t) => ({ type: "related", from: "Tag:t0", to: `Tag:${t}` })),
    ],
  };
}

const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });
const ALL = ["carries", "points_at", "related"];

async function draw(file: SealedFile, state: HoodState, unapplied: readonly string[] = []) {
  const initial = await new HoodLoader(file).load(state);
  return render(NeighbourhoodView, {
    props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: state.centre, hrefFor, tableHref, hoodHref, initial, unapplied, address: hoodRoute(state).hood ?? null },
  }).body;
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("a neighbourhood opened from a link (G-8)", () => {
  it("draws exactly the picture whose address was shared", async () => {
    const file = await openMosaic(buildMosaic(spec()), "hub.mosaic");
    let made = hoodOf("Hub:h");
    made = expand(made, "Tag:t0");
    made = hide(made, "Item:i02");
    made = showEdge(made, ALL, "points_at", false);
    made = withLimit(made, 3);
    const route = parseRoute(routeHash(hoodRoute(made)));
    const opened = await applyAddress(file, route.node!, route.hood ?? null);
    expect(await draw(file, opened.state)).toBe(await draw(file, made));
  });
});
