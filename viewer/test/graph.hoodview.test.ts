// What the neighbourhood's screen writes and where it puts its words (needs G-3, G-4,
// G-7, G-10): each group named with its edge type, direction and count; the picture's box holding
// every shard and word; a thing's name beside its shard, never over another name or shard; and
// notes saying when the picture shows only part of a thing's links. Data is invented.
import { describe, expect, it } from "vitest";
import type { HoodLayout } from "../src/lib/graph/hood-layout.js";
import { groupText, mustOpen, once, partNotes, placeThingNames, summary, THING_COLUMNS, viewBoxOf } from "../src/lib/graph/hoodview.js";
import type { Rect } from "../src/lib/graph/mapview.js";

const clash = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("a group's name (G-3: labelled with its edge type and count)", () => {
  it("gives the edge type's name and the count, with commas", () => {
    expect(groupText("features", "out", 3)).toBe("features · 3");
    expect(groupText("features", "out", 1234)).toBe("features · 1,234");
  });

  it("marks links that reach the thing, so the two directions of one edge type read apart", () => {
    expect(groupText("features", "in", 3)).toBe("← features · 3");
    expect(groupText("features", "in", 3)).not.toBe(groupText("features", "out", 3));
  });
});

function layout(): HoodLayout {
  return {
    things: [
      { id: "A:c", label: "Centre", type: "A", x: 0, y: 0, parent: null },
      { id: "B:1", label: "One", type: "B", x: 220, y: 0, parent: "A:c" },
      { id: "B:2", label: "Two", type: "B", x: -220, y: 40, parent: "A:c" },
    ],
    groups: [{ owner: "A:c", edge: "e", direction: "out", count: 9, shown: 2, labelAt: { x: 100, y: -260 }, bundle: { x: 0, y: 240, count: 7 } }],
    links: [
      { from: "A:c", to: "B:1", edge: "e" },
      { from: "A:c", to: "B:2", edge: "e" },
    ],
  };
}

describe("the picture's box", () => {
  it("holds every shard, bundle and group name, with room round them for names", () => {
    const box = viewBoxOf(layout());
    expect(box.x).toBeLessThan(-220);
    expect(box.x + box.width).toBeGreaterThan(220);
    expect(box.y).toBeLessThan(-260);
    expect(box.y + box.height).toBeGreaterThan(240);
  });

  it("is the same box every time (G-7)", () => {
    expect(viewBoxOf(layout())).toEqual(viewBoxOf(layout()));
  });

  it("has a size even for a thing alone", () => {
    const box = viewBoxOf({ things: [{ id: "A:c", label: null, type: "A", x: 0, y: 0, parent: null }], groups: [], links: [] });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe("a thing's name beside its shard", () => {
  it("goes below its shard when there is room", () => {
    const [name] = placeThingNames([{ x: 0, y: 0, r: 12, text: "Centre" }], []);
    expect(name).not.toBeNull();
    expect(name!.back.y).toBeGreaterThanOrEqual(12);
    expect(name!.x).toBe(0);
  });

  it("is cut past a set number of columns, ending in …", () => {
    const [name] = placeThingNames([{ x: 0, y: 0, r: 12, text: "x".repeat(80) }], []);
    expect(name!.text).toBe(`${"x".repeat(THING_COLUMNS - 1)}…`);
  });

  it("never sits over another name or a shard: it moves round its shard, or waits to be focused", () => {
    // A tight row of shards 30 apart: names cannot all fit below.
    const spots = Array.from({ length: 8 }, (_, i) => ({ x: i * 30, y: 0, r: 10, text: `Thing number ${i}` }));
    const shards = spots.map((s) => ({ x: s.x - s.r, y: s.y - s.r, width: 2 * s.r, height: 2 * s.r }));
    const names = placeThingNames(spots, shards);
    const placed = names.filter((n) => n !== null);
    expect(placed.length).toBeGreaterThan(0);
    expect(names.some((n) => n === null)).toBe(true);
    for (let i = 0; i < placed.length; i++) {
      for (const s of shards) expect(clash(placed[i]!.back, s)).toBe(false);
      for (let j = i + 1; j < placed.length; j++) expect(clash(placed[i]!.back, placed[j]!.back)).toBe(false);
    }
  });

  it("places names in the order given, so the first things keep theirs (G-7)", () => {
    const spots = [
      { x: 0, y: 0, r: 10, text: "First" },
      { x: 5, y: 0, r: 10, text: "Second" },
    ];
    const [first] = placeThingNames(spots, []);
    expect(first!.back.y).toBeGreaterThanOrEqual(10);
    expect(placeThingNames(spots, [])).toEqual(placeThingNames(spots, []));
  });
});

describe("saying when the picture shows only part (G-4, G-10)", () => {
  const centre = { id: "A:c", label: "Centre", type: "A" };

  it("says nothing when every link is drawn", () => {
    const hood = { centre: { centre, groups: [{ edge: "e", direction: "out" as const, count: 2, shown: [] }], unlisted: 0 }, expanded: [], failed: [] };
    expect(partNotes(hood, { ...layout(), groups: [{ ...layout().groups[0]!, count: 2, bundle: null }] })).toEqual([]);
  });

  it("says how many groups fold things into a bundle, and how to see them", () => {
    const hood = { centre: { centre, groups: [], unlisted: 0 }, expanded: [], failed: [] };
    expect(partNotes(hood, layout())).toEqual(["1 group shows only part of its things: open its bundle to list the rest."]);
    const two = { ...layout(), groups: [layout().groups[0]!, { ...layout().groups[0]!, edge: "f" }] };
    expect(partNotes(hood, two)).toEqual(["2 groups show only part of their things: open a bundle to list the rest."]);
  });

  it("says when the kit lists only some of a thing's kinds of link", () => {
    const hood = { centre: { centre, groups: [], unlisted: 3 }, expanded: [], failed: [] };
    expect(partNotes(hood, { ...layout(), groups: [] })).toEqual(["Centre has 3 more kinds of link than the picture shows: the kit lists 20 kinds per thing."]);
  });
});

describe("the line above the picture", () => {
  const centre = { id: "A:c", label: "Centre", type: "A" };
  const group = (count: number) => ({ edge: "e", direction: "out" as const, count, shown: [] });

  it("counts kinds of link and links, one in the singular", () => {
    expect(summary({ centre, groups: [group(1)], unlisted: 0 })).toBe("Centre: 1 kind of link, 1 link");
    expect(summary({ centre, groups: [group(3), group(1234)], unlisted: 0 })).toBe("Centre: 2 kinds of link, 1,237 links");
    expect(summary({ centre, groups: [], unlisted: 0 })).toBe("Centre: 0 kinds of link, 0 links");
  });

  it("counts every kind, and says its links are those of the kinds the kit lists, when it lists only some", () => {
    expect(summary({ centre, groups: Array.from({ length: 20 }, () => group(1)), unlisted: 1 })).toBe("Centre: 21 kinds of link; 20 links in the 20 the kit lists");
  });
});

describe("each thing once", () => {
  it("keeps the first place of each thing, in the order given", () => {
    const t = (id: string) => ({ id, label: id, type: null });
    expect(once([t("A:1"), t("A:2"), t("A:1"), t("A:3"), t("A:2")]).map((x) => x.id)).toEqual(["A:1", "A:2", "A:3"]);
    expect(once([])).toEqual([]);
  });
});

describe("opening a bundle again", () => {
  it("asks the kit for a bundle not open, or one whose opening failed, and not for one open", () => {
    expect(mustOpen(null, "A:c e out")).toBe(true);
    expect(mustOpen({ key: "A:c f out", failed: null }, "A:c e out")).toBe(true);
    expect(mustOpen({ key: "A:c e out", failed: null }, "A:c e out")).toBe(false);
    expect(mustOpen({ key: "A:c e out", failed: "timed out" }, "A:c e out")).toBe(true);
  });
});
