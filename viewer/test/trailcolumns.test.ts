// Trails as columns: the things at each place of the chain, read from its first results.
import { expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import type { Chain } from "../src/lib/chain.js";
import { COLUMN_RESULTS } from "../src/lib/trailcolumns.js";
import { Viewer } from "../src/lib/viewer.svelte.js";

const N = COLUMN_RESULTS + 5;
const leaf = (i: number) => `l${String(i).padStart(3, "0")}`;
/** One hub linked to more leaves than the columns read; the first two leaves are in one group. */
const FILE = buildMosaic({
  nodes: [
    { type: "Hub", key: "h", label: "Hub h" },
    ...Array.from({ length: N }, (_, i) => ({ type: "Leaf", key: leaf(i), label: `Leaf ${i}` })),
    { type: "Group", key: "g", label: "Group g" },
  ],
  edgeTypes: [
    ["has", "Hub", "Leaf"],
    ["in_group", "Leaf", "Group"],
  ],
  edges: [
    ...Array.from({ length: N }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:${leaf(i)}` })),
    ...[0, 1].map((i) => ({ type: "in_group", from: `Leaf:${leaf(i)}`, to: "Group:g" })),
  ],
});
const LEAVES: Chain = { start: "Hub", pin: null, steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };

async function withChain(chain: Chain): Promise<Viewer> {
  const v = new Viewer();
  await v.open(FILE, "hub.mosaic");
  v.setChain(chain);
  await v.shown;
  return v;
}

it("a chain with more results than the columns read says its lists are partial, and counts each thing's results", async () => {
  const v = await withChain(LEAVES);
  const trail = v.chainColumns!;
  expect(trail.partial).toBe(true);
  expect(trail.columns.map((c) => c.things.length)).toEqual([1, COLUMN_RESULTS]);
  expect(trail.columns[0]!.things[0]).toMatchObject({ id: "Hub:h", results: COLUMN_RESULTS });
});

it("a pin keeps the columns shown until the narrower ones are read; a chain with other places clears them at once", async () => {
  const v = await withChain(LEAVES);
  v.setChain({ ...LEAVES, steps: [{ ...LEAVES.steps[0]!, pin: `Leaf:${leaf(3)}` }] });
  expect(v.chainColumns).not.toBeNull();
  await v.shown;
  expect(v.chainColumns).toMatchObject({ partial: false, columns: [{ things: [{ id: "Hub:h" }] }, { pin: `Leaf:${leaf(3)}`, things: [{ id: `Leaf:${leaf(3)}` }] }] });
  v.setChain({ start: "Leaf", pin: null, steps: [{ edge: "in_group", direction: "out", type: "Group", pin: null }] });
  expect(v.chainColumns).toBeNull();
  await v.shown;
  expect(v.chainColumns!.columns.map((c) => c.things.map((t) => t.id))).toEqual([[`Leaf:${leaf(0)}`, `Leaf:${leaf(1)}`], ["Group:g"]]);
});
