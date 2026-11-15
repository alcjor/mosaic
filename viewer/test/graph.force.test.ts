// The neighbourhood laid out by forces (G-7): the same input gives the same picture, a thing
// dropped stays where it was dropped, and expanding a thing adds its neighbours round it while
// the rest of the picture stays where it was.
import { describe, expect, it } from "vitest";
import { settle } from "../src/lib/graph/force-layout.js";
import { layoutHood, placesOf, RING, settleHood, type HoodGroup, type HoodInput, type HoodLayout } from "../src/lib/graph/hood-layout.js";

const thing = (id: string) => ({ id, label: id, type: id.slice(0, id.indexOf(":")) });
const group = (edge: string, direction: "out" | "in", count: number, ids: string[]): HoodGroup => ({ edge, direction, count, shown: ids.map(thing) });

const CENTRE: HoodInput = {
  centre: thing("Item:c"),
  groups: [group("tagged", "out", 3, ["Tag:a", "Tag:b", "Tag:c"]), group("about", "in", 9, ["Note:1", "Note:2", "Note:3"])],
};
const NOTE: HoodInput = { centre: thing("Note:1"), groups: [group("about", "out", 1, ["Item:c"]), group("by", "out", 2, ["Person:p", "Person:q"])] };

const placeOf = (layout: HoodLayout, id: string) => layout.things.find((t) => t.id === id)!;
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("forces", () => {
  it("give the same positions for the same input, every time", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id, x: 0, y: 0, radius: 20 }));
    const links = [{ source: "a", target: "b", length: 100 }, { source: "a", target: "c", length: 100 }];
    const first = settle(nodes, links);
    expect(settle(nodes, links)).toEqual(first);
    // Things that start on one spot are pushed apart.
    expect(new Set([...first.values()].map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });

  it("never move a pinned node", () => {
    const nodes = [
      { id: "a", x: 0, y: 0, radius: 20, pinned: { x: 300, y: -40 } },
      { id: "b", x: 300, y: -40, radius: 20 },
    ];
    expect(settle(nodes, [{ source: "a", target: "b", length: 100 }]).get("a")).toEqual({ x: 300, y: -40 });
  });
});

describe("a neighbourhood laid out by forces", () => {
  const first = () => settleHood(layoutHood(CENTRE));

  it("is the same picture for the same thing and choices, with the centre in the middle", () => {
    expect(first()).toEqual(first());
    expect(placeOf(first(), "Item:c")).toMatchObject({ x: 0, y: 0 });
    for (const t of first().things) expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true);
  });

  it("keeps neighbours near the thing they hang from and apart from each other", () => {
    const hood = first();
    const others = hood.things.filter((t) => t.parent !== null);
    for (const t of others) expect(apart(t, placeOf(hood, t.parent!))).toBeLessThan(2 * RING);
    for (const a of others) for (const b of others) if (a !== b) expect(apart(a, b)).toBeGreaterThan(30);
  });

  it("adds an expanded thing's neighbours round it and leaves the rest where it was", () => {
    const before = first();
    const pinned = new Map([["Tag:b", { x: -350, y: 120 }]]);
    const dropped = settleHood(layoutHood(CENTRE), { pinned, previous: placesOf(before) });
    const opened = settleHood(layoutHood(CENTRE, [NOTE]), { pinned, previous: placesOf(dropped) });

    expect(placeOf(opened, "Tag:b")).toMatchObject({ x: -350, y: 120 });
    for (const t of dropped.things) expect(apart(placeOf(opened, t.id), t)).toBeLessThan(20);
    const note = placeOf(opened, "Note:1");
    for (const id of ["Person:p", "Person:q"]) expect(apart(placeOf(opened, id), note)).toBeLessThan(RING);
  });
});
