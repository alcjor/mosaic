// Trails as columns: the things at each place of the chain, read from its first results.
import { expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import type { Chain } from "../src/lib/chain.js";
import type { Result } from "../src/lib/results.js";
import { COLUMN_RESULTS, cardLine, connected, joinKey, joinsOf } from "../src/lib/trailcolumns.js";
import { Viewer } from "../src/lib/viewer.svelte.js";

/** Walks through things named by one letter each: "abx" is a → b → x. */
const walks = (...paths: string[]): Result[] => paths.map((p) => ({ things: [...p].map((id) => ({ id, label: null })), links: [] }));

it("a line joins each pair of things some result holds side by side, once", () => {
  const joins = joinsOf(walks("abx", "aby", "cbx"));
  expect(joins.map((j) => [j.place, j.from, j.to])).toEqual([[0, "a", "b"], [1, "b", "x"], [1, "b", "y"], [0, "c", "b"]]);
});

it("a picked thing lights up what the results through it hold, at its own place only", () => {
  // "b" is at place 1 in three results and at place 2 in one: picking it at place 1 leaves that one out.
  const results = walks("abx", "aby", "cbx", "dzb");
  const lit = connected(results, 1, "b");
  expect(lit.things.map((s) => [...s].sort())).toEqual([["a", "c"], ["b"], ["x", "y"]]);
  expect(lit.joins.has(joinKey({ place: 0, from: "a", to: "b" }))).toBe(true);
  expect(lit.joins.has(joinKey({ place: 0, from: "d", to: "z" }))).toBe(false);
  expect(connected(results, 0, "d").things.map((s) => [...s])).toEqual([["d"], ["z"], ["b"]]);
});

it("a card's line holds the thing's first properties, as text", () => {
  expect(cardLine({ type: "Title", props: { rating: "R", released: 1995, seen: true, tags: ["x"] } }, null)).toBe("R · 1995 · true");
  expect(cardLine({ type: "Title", props: null }, null)).toBe("");
});

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
