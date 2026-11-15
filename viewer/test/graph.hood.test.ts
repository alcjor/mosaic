// The data of a neighbourhood (needs G-3, G-4, G-5, G-10, G-12): a thing's neighbours grouped by
// edge type and direction, each group with its count, through the kit; a thing unfolded shows a
// few per group, and more each time it is unfolded again; things drawn and not unfolded come with
// their link counts alone. Data is invented.
import type { SealedFile } from "@mosaic/kit";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import { canExpand, expand, HoodError, HoodLoader, hoodOf, limitOf, loadThing, MOST_EXPANDED, recentre, showEdge, shows, STEPS, typeOfId, type HoodSource } from "../src/lib/graph/hood.js";
import { openMosaic } from "../src/lib/mosaic.js";

const pad = (i: number) => String(i).padStart(2, "0");

/** A hub with 25 items pointing at it and 3 tags it carries; the first item has 24 tags. */
function spec(): MosaicSpec {
  const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
  const tags = Array.from({ length: 24 }, (_, i) => `t${pad(i)}`);
  return {
    edgeTypes: [
      ["points_at", "Item", "Hub"],
      ["tagged", "Item", "Tag"],
      ["carries", "Hub", "Tag"],
    ],
    nodes: [
      { type: "Hub", key: "h", label: "The hub" },
      ...items.map((key) => ({ type: "Item", key, label: `Item ${key}` })),
      ...tags.map((key) => ({ type: "Tag", key, label: `Tag ${key}` })),
    ],
    edges: [
      ...items.map((key) => ({ type: "points_at", from: `Item:${key}`, to: "Hub:h" })),
      ...tags.slice(0, 3).map((key) => ({ type: "carries", from: "Hub:h", to: `Tag:${key}` })),
      ...tags.map((key) => ({ type: "tagged", from: "Item:i00", to: `Tag:${key}` })),
    ],
  };
}

const open = () => openMosaic(buildMosaic(spec()), "hood.mosaic");

/** `file`, counting the calls made to each tool. */
function counted(file: SealedFile): { source: HoodSource; calls: { get: number; neighbors: number } } {
  const calls = { get: 0, neighbors: 0 };
  const source: HoodSource = {
    edgeTypes: file.edgeTypes,
    get: (args) => (calls.get++, file.get(args as never)),
    neighbors: (args) => (calls.neighbors++, file.neighbors(args as never)),
  };
  return { source, calls };
}

describe("a thing's neighbours, grouped (G-3, G-12)", () => {
  it("come in one group per edge type and direction, each with its count and a few neighbours", async () => {
    const file = await open();
    const { source, calls } = counted(file);
    const hub = await loadThing(source, "Hub:h", 5);
    expect(hub.centre).toEqual({ id: "Hub:h", label: "The hub", type: "Hub" });
    expect(hub.groups.map((g) => [g.edge, g.direction, g.count, g.shown.length])).toEqual([
      ["carries", "out", 3, 3],
      ["points_at", "in", 25, 5],
    ]);
    expect(hub.groups[1]!.shown[0]).toEqual({ id: "Item:i00", label: "Item i00", type: "Item" });
    // One `get`, and one bounded `neighbors` per group, however busy the thing.
    expect(calls).toEqual({ get: 1, neighbors: 2 });
    file.close();
  });

  it("with a limit of 0 gives the counts alone, and asks for no neighbours", async () => {
    const file = await open();
    const { source, calls } = counted(file);
    const hub = await loadThing(source, "Hub:h", 0);
    expect(hub.groups.map((g) => [g.edge, g.count, g.shown.length])).toEqual([
      ["carries", 3, 0],
      ["points_at", 25, 0],
    ]);
    expect(calls).toEqual({ get: 1, neighbors: 0 });
    file.close();
  });

  it("report a thing the mosaic lacks, naming it", async () => {
    const file = await open();
    const failure = await loadThing(file, "Hub:none", 5).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HoodError);
    expect((failure as HoodError).id).toBe("Hub:none");
    file.close();
  });

  it("read a thing's type from its id when the edge type does not say", () => {
    expect(typeOfId("Item:x:y")).toBe("Item");
    expect(typeOfId("lower:x")).toBeNull();
    expect(typeOfId("NoColon")).toBeNull();
  });
});

describe("the person's choices (G-5)", () => {
  const all = ["carries", "points_at", "tagged"];

  it("start with the centre unfolded once, and every edge type shown", () => {
    const s = hoodOf("Hub:h");
    expect(limitOf(s, "Hub:h")).toBe(STEPS[0]);
    expect(limitOf(s, "Item:i00")).toBe(0);
    expect(shows(s, "tagged")).toBe(true);
  });

  it("unfold a thing, then show more of it each time it is unfolded again, up to the last step", () => {
    let s = hoodOf("Hub:h");
    const limits = [];
    for (let i = 0; i < STEPS.length + 1; i++) {
      s = expand(s, "Item:i00");
      limits.push(limitOf(s, "Item:i00"));
    }
    expect(limits).toEqual([...STEPS, STEPS.at(-1)]);
    expect(canExpand(s, "Item:i00")).toBe(false);
    // The centre is unfolded once already: it has one step less to go.
    expect(limitOf(expand(hoodOf("Hub:h"), "Hub:h"), "Hub:h")).toBe(STEPS[1]);
  });

  it("stop unfolding at the bound, and leave the state given untouched", () => {
    let s = hoodOf("Hub:h");
    for (let i = 0; i < MOST_EXPANDED + 5; i++) s = expand(s, `Tag:t${pad(i)}`);
    expect(s.expanded).toHaveLength(MOST_EXPANDED);
    const before = JSON.stringify(s);
    expect(expand(s, "Item:i00")).toBe(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("re-centre on a neighbour, keeping the edge types shown", () => {
    const s = showEdge(expand(hoodOf("Hub:h"), "Item:i00"), all, "carries", false);
    expect(recentre(s, "Item:i00")).toEqual({ centre: "Item:i00", expanded: [], edges: ["points_at", "tagged"] });
  });

  it("choose which edge types are shown, every one again being every one", () => {
    const off = showEdge(hoodOf("Hub:h"), all, "points_at", false);
    expect(off.edges).toEqual(["carries", "tagged"]);
    expect(shows(off, "points_at")).toBe(false);
    expect(showEdge(off, all, "points_at", true).edges).toBeNull();
    expect(showEdge(off, all, "not_an_edge", true).edges).toEqual(["carries", "tagged"]);
  });
});

describe("loading a neighbourhood from the person's choices (G-5, G-10)", () => {
  it("loads the centre, each unfolded thing once, and the link counts of the other things drawn", async () => {
    const file = await open();
    const hood = await new HoodLoader(file).load(expand(expand(hoodOf("Hub:h"), "Item:i00"), "Item:i00"));
    expect(hood.centre.groups.map((g) => g.shown.length)).toEqual([3, 5]);
    expect(hood.expanded.map((l) => l.centre.id)).toEqual(["Item:i00"]);
    // Unfolded twice: the second step of its tags.
    expect(hood.expanded[0]!.groups.find((g) => g.edge === "tagged")!.shown).toHaveLength(STEPS[1]);
    const leaves = new Map(hood.leaves.map((l) => [l.centre.id, l]));
    expect(leaves.has("Item:i00")).toBe(false);
    expect(leaves.get("Item:i01")!.groups.map((g) => [g.edge, g.count, g.shown.length])).toEqual([["points_at", 1, 0]]);
    expect(leaves.get("Tag:t00")!.groups.map((g) => [g.edge, g.direction, g.count])).toEqual([
      ["carries", "in", 1],
      ["tagged", "in", 1],
    ]);
    file.close();
  });

  it("keeps every group's count for an edge type not shown, with no neighbours", async () => {
    const file = await open();
    const hood = await new HoodLoader(file).load(showEdge(hoodOf("Hub:h"), file.edgeTypes.map((e) => e.name), "points_at", false));
    expect(hood.centre.groups.map((g) => [g.edge, g.count, g.shown.length])).toEqual([
      ["carries", 3, 3],
      ["points_at", 25, 0],
    ]);
    file.close();
  });

  it("reports an unfolded thing the mosaic lacks, and still loads the rest", async () => {
    const file = await open();
    const hood = await new HoodLoader(file).load(expand(expand(hoodOf("Hub:h"), "Item:gone"), "Item:i00"));
    expect(hood.failed.map((f) => f.id)).toEqual(["Item:gone"]);
    expect(hood.expanded.map((l) => l.centre.id)).toEqual(["Item:i00"]);
    file.close();
  });

  it("asks the kit once per thing for the session, and fails when the centre is not in the mosaic", async () => {
    const file = await open();
    const { source, calls } = counted(file);
    const loader = new HoodLoader(source);
    const first = await loader.load(hoodOf("Hub:h"));
    const asked = { ...calls };
    expect(await loader.load(hoodOf("Hub:h"))).toEqual(first);
    expect(calls).toEqual(asked);
    await expect(loader.load(hoodOf("Hub:none"))).rejects.toBeInstanceOf(HoodError);
    file.close();
  });
});
