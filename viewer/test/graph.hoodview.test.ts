// What the graph's stage works out from a picture (needs G-3, G-4, G-5, G-7): the link types its
// chips offer, the links each thing keeps folded, how the picture fits the stage, and where a
// thing's tooltip goes. Data is invented.
import { describe, expect, it } from "vitest";
import { hoodOf, showEdge, type Hood, type Loaded } from "../src/lib/graph/hood.js";
import { layoutHood } from "../src/lib/graph/hood-layout.js";
import { allOnStage, edgeChoices, fitView, foldedLinks, onStage, tipPlace } from "../src/lib/graph/hoodview.js";

const thing = (id: string) => ({ id, label: id, type: id.split(":")[0]! });
const loaded = (id: string, groups: [edge: string, direction: "out" | "in", count: number, shown: string[]][]): Loaded => ({
  centre: thing(id),
  groups: groups.map(([edge, direction, count, shown]) => ({ edge, direction, count, shown: shown.map(thing) })),
  unlisted: 0,
});

/** A film with 7 actors (2 drawn) and a genre; one actor drawn has 3 films, the other only this one. */
function hood(): Hood {
  return {
    state: hoodOf("Film:f"),
    centre: loaded("Film:f", [
      ["features", "out", 7, ["Person:a", "Person:b"]],
      ["listed_in", "out", 1, ["Genre:g"]],
    ]),
    expanded: [],
    leaves: [loaded("Person:a", [["features", "in", 3, []]]), loaded("Person:b", [["features", "in", 1, []]]), loaded("Genre:g", [["listed_in", "in", 40, []]])],
    failed: [],
  };
}
const layoutOf = (h: Hood) => layoutHood(h.centre, h.expanded, { shows: (e) => h.state.edges === null || h.state.edges.includes(e) });

describe("the link types offered and the links kept folded (G-4, G-5)", () => {
  it("offers the link types of the things unfolded, by name, shown or not", () => {
    const h = hood();
    expect(edgeChoices(h)).toEqual(["features", "listed_in"]);
    expect(edgeChoices({ ...h, state: showEdge(h.state, ["features", "listed_in"], "features", false) })).toEqual(["features", "listed_in"]);
  });

  it("counts for each thing its links that the picture does not draw", () => {
    const h = hood();
    expect(Object.fromEntries(foldedLinks(h, layoutOf(h)))).toEqual({ "Film:f": 5, "Person:a": 2, "Person:b": 0, "Genre:g": 39 });
  });

  it("counts only links of the edge types shown", () => {
    const base = hood();
    const h = { ...base, state: showEdge(base.state, ["features", "listed_in"], "features", false) };
    const centre = loaded("Film:f", [
      ["features", "out", 7, []],
      ["listed_in", "out", 1, ["Genre:g"]],
    ]);
    const folded = foldedLinks({ ...h, centre, leaves: [base.leaves[2]!] }, layoutOf({ ...h, centre }));
    expect(Object.fromEntries(folded)).toEqual({ "Film:f": 0, "Genre:g": 39 });
  });
});

describe("the picture on the stage (G-7)", () => {
  const stage = { width: 900, height: 560 };

  it("fits every thing on the stage, never drawn larger than laid out", () => {
    const near = [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: -110, y: 190 }];
    const far = [...near, { x: 2400, y: -1300 }];
    for (const points of [near, far]) {
      const view = fitView(points, stage);
      expect(allOnStage(points, view, stage)).toBe(true);
      expect(view.k).toBeLessThanOrEqual(1);
    }
    expect(fitView(near, stage).k).toBe(1);
    expect(fitView(far, stage).k).toBeLessThan(0.5);
    // In the middle: the things' box is centred on the stage.
    const view = fitView(near, stage);
    expect(onStage(view, { x: 55, y: 95 })).toEqual({ x: 450, y: 280 });
  });

  it("says when a thing has left the stage", () => {
    const view = fitView([{ x: 0, y: 0 }], stage);
    expect(allOnStage([{ x: 0, y: 0 }, { x: 600, y: 0 }], view, stage)).toBe(false);
  });
});

describe("a thing's tooltip (G-11)", () => {
  const stage = { width: 900, height: 560 };
  const tip = { width: 230, height: 120 };
  const spots = [
    { x: 450, y: 280 },
    { x: 20, y: 20 },
    { x: 880, y: 20 },
    { x: 880, y: 540 },
    { x: 20, y: 540 },
    { x: 450, y: 550 },
    { x: 890, y: 280 },
  ];

  it("is whole on the stage and never over its thing, wherever the thing is", () => {
    for (const spot of spots) {
      const at = { ...spot, r: 22 };
      const p = tipPlace(at, tip, stage);
      expect(p.x >= 0 && p.y >= 0 && p.x + tip.width <= stage.width && p.y + tip.height <= stage.height, JSON.stringify(spot)).toBe(true);
      const apart = p.x >= at.x + at.r || p.x + tip.width <= at.x - at.r || p.y >= at.y + at.r || p.y + tip.height <= at.y - at.r;
      expect(apart, JSON.stringify(spot)).toBe(true);
    }
  });

  it("goes right of the thing where there is room, else left of it", () => {
    expect(tipPlace({ x: 450, y: 280, r: 22 }, tip, stage).x).toBeGreaterThan(450 + 22);
    expect(tipPlace({ x: 880, y: 280, r: 22 }, tip, stage).x + tip.width).toBeLessThan(880 - 22);
  });
});
