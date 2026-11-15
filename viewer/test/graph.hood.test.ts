// The data of a neighbourhood (needs G-3, G-4, G-5, G-10, G-12): a thing's
// neighbours grouped by edge type and direction, each group with its count, through the kit; a
// group past the limit (3, 5, 10 or 20) keeps that many and folds the rest into a bundle with its
// count; opening a bundle lists its things (20 with the total, and "open as table" for the rest); expanded, collapsed and hidden
// things and the edge types shown are state the data follows. Data is invented.
import { type ErrorAnswer, type SealedFile } from "@mosaic/kit";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { collapse, DEFAULT_LIMIT, expand, folded, hide, HoodError, HoodLoader, hoodOf, LIMITS, loadThing, openBundle, recentre, showEdge, shows, typeOfId, unhide, withLimit, type BundleSource, type HoodSource, type HoodState } from "../src/lib/graph/hood.js";

const pad = (i: number) => String(i).padStart(2, "0");

/**
 * A hub with 25 items pointing at it, 3 tags it carries, and one item with 24 tags (more than
 * one `neighbors` call lists); a loop on the hub; one tag shared with an item, so it appears in
 * two of the hub's groups.
 */
function spec(): MosaicSpec {
  const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
  const tags = Array.from({ length: 24 }, (_, i) => `t${pad(i)}`);
  return {
    typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [
      ["points_at", "Item", "Hub"],
      ["tagged", "Item", "Tag"],
      ["carries", "Hub", "Tag"],
      ["next", "Hub", "Hub"],
    ],
    nodes: [
      { type: "Hub", key: "h", label: "The hub" },
      { type: "Hub", key: "other", label: "The hub annex" },
      ...items.map((k) => ({ type: "Item", key: k, label: `Item ${k}` })),
      { type: "Item", key: "annexed", label: "Item for the annex only" },
      ...tags.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` })),
    ],
    edges: [
      ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
      { type: "points_at", from: "Item:i00", to: "Hub:other" },
      { type: "points_at", from: "Item:annexed", to: "Hub:other" },
      ...["t00", "t01", "t02"].map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
      ...tags.map((t) => ({ type: "tagged", from: "Item:i00", to: `Tag:${t}` })),
      { type: "next", from: "Hub:h", to: "Hub:h" },
    ],
  };
}

async function open(): Promise<SealedFile> {
  return openMosaic(buildMosaic(spec()), "hub.mosaic");
}

/** A source that counts the kit calls made through it. */
function counting(file: SealedFile) {
  const calls = { get: 0, neighbors: 0, table: 0, limits: [] as number[] };
  const source: HoodSource = {
    edgeTypes: file.edgeTypes,
    get: (a) => (calls.get++, file.get(a)),
    neighbors: (a) => (calls.neighbors++, calls.limits.push((a as { limit: number }).limit), file.neighbors(a)),
    table: (a) => (calls.table++, file.table(a)),
  };
  return { source, calls };
}

describe("a thing's neighbours, grouped (G-3)", () => {
  it("come in one group per edge type and direction, each with its count, in the kit's order", async () => {
    const file = await open();
    const hood = await loadThing(file, "Hub:h", 5);
    expect(hood.centre).toEqual({ id: "Hub:h", label: "The hub", type: "Hub" });
    expect(hood.groups.map((g) => [g.edge, g.direction, g.count])).toEqual([
      ["carries", "out", 3],
      ["next", "out", 1],
      ["next", "in", 1],
      ["points_at", "in", 25],
    ]);
    expect(hood.unlisted).toBe(0);
  });

  it("name each neighbour with its id, label and type", async () => {
    const file = await open();
    const hood = await loadThing(file, "Hub:h", 5);
    const carries = hood.groups.find((g) => g.edge === "carries")!;
    expect(carries.shown).toEqual([
      { id: "Tag:t00", label: "Tag t00", type: "Tag" },
      { id: "Tag:t01", label: "Tag t01", type: "Tag" },
      { id: "Tag:t02", label: "Tag t02", type: "Tag" },
    ]);
    const next = hood.groups.find((g) => g.edge === "next" && g.direction === "in")!;
    expect(next.shown).toEqual([{ id: "Hub:h", label: "The hub", type: "Hub" }]);
  });

  it("ask the kit one get and one bounded neighbors per group shown, however busy the thing", async () => {
    const file = await open();
    const { source, calls } = counting(file);
    await loadThing(source, "Hub:h", 3);
    expect(calls.get).toBe(1);
    expect(calls.neighbors).toBe(4);
    expect(calls.limits.every((l) => l === 3)).toBe(true);
    expect(calls.table).toBe(0);
  });

  it("report a thing the mosaic lacks, naming it", async () => {
    const file = await open();
    await expect(loadThing(file, "Hub:absent", 5)).rejects.toThrow(HoodError);
    await expect(loadThing(file, "Hub:absent", 5)).rejects.toThrow(/Hub:absent/);
  });

  it("read a thing's type from the edge type, else from its id", () => {
    expect(typeOfId("Item:x:y")).toBe("Item");
    expect(typeOfId("lower:x")).toBeNull();
    expect(typeOfId("NoColon")).toBeNull();
    expect(typeOfId(":x")).toBeNull();
  });
});

describe("limits and bundles (G-4)", () => {
  it("offer 3, 5, 10 and 20, 5 by default", () => {
    expect(LIMITS).toEqual([3, 5, 10, 20]);
    expect(DEFAULT_LIMIT).toBe(5);
    expect(hoodOf("Hub:h").limit).toBe(5);
  });

  for (const limit of LIMITS) {
    it(`keep ${limit} of a larger group and fold the rest into one bundle with its count`, async () => {
      const file = await open();
      const hood = await loadThing(file, "Hub:h", limit);
      const pointsAt = hood.groups.find((g) => g.edge === "points_at")!;
      expect(pointsAt.shown).toHaveLength(limit);
      expect(pointsAt.shown.map((t) => t.id)).toEqual(Array.from({ length: limit }, (_, i) => `Item:i${pad(i)}`));
      expect(folded(pointsAt)).toBe(25 - limit);
      const carries = hood.groups.find((g) => g.edge === "carries")!;
      expect(carries.shown).toHaveLength(Math.min(3, limit));
      expect(folded(carries)).toBe(3 - Math.min(3, limit));
    });
  }

  it("refuse a limit that is not one of those", async () => {
    const file = await open();
    await expect(loadThing(file, "Hub:h", 7 as never)).rejects.toThrow(RangeError);
    expect(() => withLimit(hoodOf("Hub:h"), 0 as never)).toThrow(RangeError);
  });

  it("open a small bundle as the whole list", async () => {
    const file = await open();
    const bundle = await openBundle(file, { id: "Hub:h", label: "The hub", type: "Hub" }, "carries", "out");
    expect(bundle.total).toBe(3);
    expect(bundle.things.map((t) => t.id)).toEqual(["Tag:t00", "Tag:t01", "Tag:t02"]);
    expect(bundle.table).toBeNull();
    expect(bundle.allLabels).toBeNull();
  });

  it("open a bundle of links reaching the thing as 20 with the total, and its table by name", async () => {
    const file = await open();
    const bundle = await openBundle(file, { id: "Hub:h", label: "The hub", type: "Hub" }, "points_at", "in");
    expect(bundle.total).toBe(25);
    expect(bundle.things).toHaveLength(20);
    expect(bundle.things[0]).toEqual({ id: "Item:i00", label: "Item i00", type: "Item" });
    expect(bundle.table).toEqual({ type: "Item", page: 1, order: null, where: [{ column: "points_at", op: "contains", value: "The hub" }] });
    expect(bundle.byName).toBe(true);
    // The table lists every one of the 25, and, by name, the item that points only at
    // "The hub annex" too: the list says it finds rows by name.
    const rows = await file.table({ type: "Item", where: bundle.table!.where });
    if ("error" in rows) throw new Error(rows.error.message);
    expect(rows.data.total).toBe(26);
  });

  it("open a bundle of links leaving the thing as every label they reach, from its own row", async () => {
    const file = await open();
    const bundle = await openBundle(file, { id: "Item:i00", label: "Item i00", type: "Item" }, "tagged", "out");
    expect(bundle.total).toBe(24);
    expect(bundle.things).toHaveLength(20);
    expect(bundle.allLabels).toEqual(Array.from({ length: 24 }, (_, i) => `Tag t${pad(i)}`));
    expect(bundle.table).toBeNull();
    expect(bundle.byName).toBe(false);
  });

  it("say no table can list the rest when the kit cut the thing's name (section 8.2)", async () => {
    const long = "H".repeat(130);
    const file = await openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}' },
        edgeTypes: [["points_at", "Item", "Hub"]],
        nodes: [
          { type: "Hub", key: "h", label: long },
          ...Array.from({ length: 25 }, (_, i) => ({ type: "Item", key: `i${pad(i)}`, label: `Item ${i}` })),
        ],
        edges: Array.from({ length: 25 }, (_, i) => ({ type: "points_at", from: `Item:i${pad(i)}`, to: "Hub:h" })),
      }),
      "long.mosaic",
    );
    const hub = (await loadThing(file, "Hub:h", 5)).centre;
    expect(Array.from(hub.label!).length).toBe(121); // 120 characters and the marker
    const bundle = await openBundle(file, hub, "points_at", "in");
    expect(bundle).toMatchObject({ total: 25, table: null, byName: false });
    expect(bundle.things).toHaveLength(20);
  });

  it("never read a property or node field named like the edge type as its links (section 8.6)", async () => {
    // `table` reads a column name as a declared property first, then key, label or summary, and
    // only then as an edge type: such a column would list the wrong things without a sign.
    const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
    const tags = Array.from({ length: 24 }, (_, i) => `t${pad(i)}`);
    const file = await openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"carries":"text","name":"text"}', Item: '{"name":"text","points_at":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [
          ["points_at", "Item", "Hub"],
          ["carries", "Hub", "Tag"],
          ["label", "Item", "Hub"],
        ],
        nodes: [
          { type: "Hub", key: "h", label: "The hub", props: '{"carries":"not links"}' },
          ...items.map((k) => ({ type: "Item", key: k, label: `Item ${k}`, props: '{"points_at":"not links"}' })),
          ...tags.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` })),
        ],
        edges: [
          ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
          ...items.map((k) => ({ type: "label", from: `Item:${k}`, to: "Hub:h" })),
          ...tags.map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
        ],
      }),
      "shadowed.mosaic",
    );
    const hub = { id: "Hub:h", label: "The hub", type: "Hub" };
    for (const edge of ["points_at", "label"]) {
      const bundle = await openBundle(file, hub, edge, "in");
      expect(bundle, edge).toMatchObject({ total: 25, table: null, allLabels: null, byName: false });
      expect(bundle.things).toHaveLength(20);
    }
    const carries = await openBundle(file, hub, "carries", "out");
    expect(carries).toMatchObject({ total: 24, table: null, allLabels: null });
    expect(carries.things).toHaveLength(20);
  });

  it("keep the 20 things when the kit will not give the thing's own row", async () => {
    const file = await open();
    const refusing: BundleSource = {
      edgeTypes: file.edgeTypes,
      propsOf: (t) => file.propsOf(t),
      get: (a) => file.get(a),
      neighbors: (a) => file.neighbors(a),
      table: async () => ({ tool: "table", mosaic: "hub.mosaic", error: { code: "bad_argument", message: "refused", suggestions: [] } }) as ErrorAnswer,
    };
    const bundle = await openBundle(refusing, { id: "Item:i00", label: "Item i00", type: "Item" }, "tagged", "out");
    expect(bundle).toMatchObject({ total: 24, allLabels: null, table: null });
    expect(bundle.things).toHaveLength(20);
  });

  it("say no table can list the rest when the thing has no name to find it by", async () => {
    const file = await open();
    const bundle = await openBundle(file, { id: "Hub:h", label: null, type: "Hub" }, "points_at", "in");
    expect(bundle.things).toHaveLength(20);
    expect(bundle.table).toBeNull();
  });
});

describe("the person's choices (G-5)", () => {
  const all = ["carries", "next", "points_at", "tagged"];

  it("start centred, with nothing expanded or hidden and every edge type shown", () => {
    expect(hoodOf("Hub:h")).toEqual({ centre: "Hub:h", expanded: [], hidden: [], edges: null, limit: 5 });
  });

  it("expand and collapse a neighbour, keeping the order opened; the centre is always open", () => {
    let s = hoodOf("Hub:h");
    s = expand(expand(expand(s, "Item:i03"), "Tag:t00"), "Item:i03");
    expect(s.expanded).toEqual(["Item:i03", "Tag:t00"]);
    expect(expand(s, "Hub:h")).toBe(s);
    s = collapse(s, "Item:i03");
    expect(s.expanded).toEqual(["Tag:t00"]);
    expect(collapse(s, "Item:i99")).toBe(s);
  });

  it("hide a neighbour, which also closes it, and show it again; never the centre", () => {
    let s = expand(hoodOf("Hub:h"), "Item:i03");
    s = hide(hide(s, "Item:i03"), "Item:i01");
    expect(s.hidden).toEqual(["Item:i01", "Item:i03"]);
    expect(s.expanded).toEqual([]);
    expect(hide(s, "Hub:h")).toBe(s);
    s = unhide(s, "Item:i03");
    expect(s.hidden).toEqual(["Item:i01"]);
    expect(expand(s, "Item:i01").hidden).toEqual([]);
  });

  it("re-centre on a neighbour, keeping the edge types shown and the limit", () => {
    const s = withLimit(showEdge(hide(expand(hoodOf("Hub:h"), "Item:i03"), "Item:i01"), all, "next", false), 10);
    expect(recentre(s, "Item:i03")).toEqual({ centre: "Item:i03", expanded: [], hidden: [], edges: ["carries", "points_at", "tagged"], limit: 10 });
  });

  it("choose which edge types are shown, every one again being every one", () => {
    let s = showEdge(hoodOf("Hub:h"), all, "points_at", false);
    expect(s.edges).toEqual(["carries", "next", "tagged"]);
    expect(shows(s, "points_at")).toBe(false);
    expect(shows(s, "next")).toBe(true);
    s = showEdge(s, all, "carries", false);
    expect(s.edges).toEqual(["next", "tagged"]);
    s = showEdge(showEdge(s, all, "carries", true), all, "points_at", true);
    expect(s.edges).toBeNull();
  });

  it("give every group with its count whether shown or not, and neighbours only for those shown", async () => {
    const file = await open();
    const s = showEdge(hoodOf("Hub:h"), all, "points_at", false);
    const hood = await new HoodLoader(file).load(s);
    const pointsAt = hood.centre.groups.find((g) => g.edge === "points_at")!;
    expect(pointsAt.count).toBe(25);
    expect(pointsAt.shown).toEqual([]);
    expect(folded(pointsAt)).toBe(0);
    expect(hood.centre.groups.find((g) => g.edge === "carries")!.shown).toHaveLength(3);
  });
});

describe("loading a neighbourhood from the person's choices (G-5, G-10)", () => {
  it("loads the centre and each expanded thing that is not hidden, in the order opened", async () => {
    const file = await open();
    const s = hide(expand(expand(expand(hoodOf("Hub:h"), "Item:i00"), "Tag:t01"), "Item:i02"), "Item:i02");
    const hood = await new HoodLoader(file).load(s);
    expect(hood.centre.centre.id).toBe("Hub:h");
    expect(hood.expanded.map((e) => e.centre.id)).toEqual(["Item:i00", "Tag:t01"]);
    expect(hood.failed).toEqual([]);
  });

  it("follows a change of limit", async () => {
    const file = await open();
    const loader = new HoodLoader(file);
    const five = await loader.load(hoodOf("Hub:h"));
    const twenty = await loader.load(withLimit(hoodOf("Hub:h"), 20));
    expect(five.centre.groups.find((g) => g.edge === "points_at")!.shown).toHaveLength(5);
    expect(twenty.centre.groups.find((g) => g.edge === "points_at")!.shown).toHaveLength(20);
  });

  it("asks the kit once per thing, limit and edge types for the session", async () => {
    const file = await open();
    const { source, calls } = counting(file);
    const loader = new HoodLoader(source);
    const s = expand(hoodOf("Hub:h"), "Item:i00");
    await loader.load(s);
    const asked = { get: calls.get, neighbors: calls.neighbors };
    await loader.load(s);
    await loader.load(collapse(s, "Item:i00"));
    expect({ get: calls.get, neighbors: calls.neighbors }).toEqual(asked);
  });

  it("reports an expanded thing the mosaic lacks, and still loads the rest", async () => {
    const file = await open();
    const hood = await new HoodLoader(file).load(expand(expand(hoodOf("Hub:h"), "Item:absent"), "Item:i00"));
    expect(hood.expanded.map((e) => e.centre.id)).toEqual(["Item:i00"]);
    expect(hood.failed.map((f) => f.id)).toEqual(["Item:absent"]);
    expect(hood.failed[0]!.message).toMatch(/Item:absent/);
  });

  it("fails when the centre is not in the mosaic, and asks again on a later try", async () => {
    const file = await open();
    const { source, calls } = counting(file);
    const loader = new HoodLoader(source);
    await expect(loader.load(hoodOf("Hub:absent"))).rejects.toThrow(/Hub:absent/);
    await expect(loader.load(hoodOf("Hub:absent"))).rejects.toThrow(/Hub:absent/);
    expect(calls.get).toBe(2);
  });

  it("gives the same data every time", async () => {
    const file = await open();
    const s = expand(hoodOf("Hub:h"), "Item:i00");
    const a = await new HoodLoader(file).load(s);
    const b = await new HoodLoader(file).load(s);
    expect(b).toEqual(a);
  });
});

describe("graph hood: further cases", () => {
  const pad = (i: number, n = 2) => String(i).padStart(n, "0");

  async function open(spec: MosaicSpec): Promise<SealedFile> {
    return openMosaic(buildMosaic(spec), "edges.mosaic");
  }

  function counting(file: SealedFile) {
    const calls = { get: 0, neighbors: 0, table: 0 };
    const source: HoodSource = {
      edgeTypes: file.edgeTypes,
      get: (a) => (calls.get++, file.get(a)),
      neighbors: (a) => (calls.neighbors++, file.neighbors(a)),
      table: (a) => (calls.table++, file.table(a)),
    };
    return { source, calls };
  }

  /** `count` spokes s00.. each pointing at Hub:h; one lone hub `lone` with nothing. */
  function star(count: number): MosaicSpec {
    const keys = Array.from({ length: count }, (_, i) => `s${pad(i, 3)}`);
    return {
      typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}' },
      edgeTypes: [["to_hub", "Spoke", "Hub"]],
      nodes: [
        { type: "Hub", key: "h", label: "Hub H" },
        { type: "Hub", key: "lone", label: "Lonely" },
        ...keys.map((k) => ({ type: "Spoke", key: k, label: `Spoke ${k}` })),
      ],
      edges: keys.map((k) => ({ type: "to_hub", from: `Spoke:${k}`, to: "Hub:h" })),
    };
  }

  const NODE = { id: "Hub:h", label: "Hub H", type: "Hub" };

  describe("a thing with no links (G-3)", () => {
    it("has no groups, nothing unlisted, and asks the kit for no neighbours", async () => {
      const file = await open(star(2));
      const { source, calls } = counting(file);
      const hood = await loadThing(source, "Hub:lone", 5);
      expect(hood.centre).toEqual({ id: "Hub:lone", label: "Lonely", type: "Hub" });
      expect(hood.groups).toEqual([]);
      expect(hood.unlisted).toBe(0);
      expect(calls.neighbors).toBe(0);
    });

    it("loads as a neighbourhood with the same empty centre", async () => {
      const file = await open(star(2));
      const hood = await new HoodLoader(file).load(hoodOf("Hub:lone"));
      expect(hood.centre.groups).toEqual([]);
      expect(hood.expanded).toEqual([]);
      expect(hood.failed).toEqual([]);
    });

    it("opens an empty-handed thing with a null label as a centre with a null label", async () => {
      const spec = star(1);
      spec.nodes.push({ type: "Hub", key: "nameless", label: null });
      const file = await open(spec);
      const hood = await loadThing(file, "Hub:nameless", 5);
      expect(hood.centre).toEqual({ id: "Hub:nameless", label: null, type: "Hub" });
    });
  });

  describe("a group at the limit's boundary (G-4)", () => {
    for (const limit of LIMITS) {
      it(`a group of exactly ${limit} shows all of them and folds nothing`, async () => {
        const file = await open(star(limit));
        const group = (await loadThing(file, "Hub:h", limit)).groups[0]!;
        expect(group.count).toBe(limit);
        expect(group.shown).toHaveLength(limit);
        expect(folded(group)).toBe(0);
      });

      it(`a group of ${limit} + 1 shows ${limit} and folds exactly one`, async () => {
        const file = await open(star(limit + 1));
        const group = (await loadThing(file, "Hub:h", limit)).groups[0]!;
        expect(group.count).toBe(limit + 1);
        expect(group.shown).toHaveLength(limit);
        expect(folded(group)).toBe(1);
      });
    }

    it("shown plus folded is always the count, for every limit and group size", async () => {
      const file = await open(star(23));
      for (const limit of LIMITS) {
        const group = (await loadThing(file, "Hub:h", limit)).groups[0]!;
        expect(group.shown.length + folded(group)).toBe(group.count);
      }
    });

    it("a larger limit shows a longer prefix of the same list, never a different order", async () => {
      const file = await open(star(23));
      const lists = [];
      for (const limit of LIMITS) lists.push((await loadThing(file, "Hub:h", limit)).groups[0]!.shown.map((t) => t.id));
      for (let i = 1; i < lists.length; i++) expect(lists[i]!.slice(0, lists[i - 1]!.length)).toEqual(lists[i - 1]);
    });

    it("a group's folded count is zero when the group is empty of neighbours shown", () => {
      expect(folded({ edge: "x", direction: "out", count: 9, shown: [] })).toBe(0);
      expect(folded({ edge: "x", direction: "out", count: 0, shown: [] })).toBe(0);
    });

    it("refuses limits between, below and above the four, and values that are not numbers", () => {
      for (const bad of [4, 6, 21, 0, -3, 2.5, Number.NaN, Infinity, "5", null, undefined]) {
        expect(() => withLimit(hoodOf("Hub:h"), bad as never)).toThrow(RangeError);
      }
    });

    it("refuses a bad limit before asking the kit anything", async () => {
      const file = await open(star(3));
      const { source, calls } = counting(file);
      await expect(loadThing(source, "Hub:h", 4 as never)).rejects.toThrow(RangeError);
      expect(calls).toEqual({ get: 0, neighbors: 0, table: 0 });
    });

    it("keeps the state it was given when a limit is refused", () => {
      const s = hoodOf("Hub:h");
      expect(() => withLimit(s, 7 as never)).toThrow();
      expect(s.limit).toBe(5);
    });
  });

  describe("links the kit cannot list whole (G-3, G-10)", () => {
    /** A hub with one link to a tag in each of `n` edge types: more groups than `get` lists. */
    function wide(n: number): MosaicSpec {
      const names = Array.from({ length: n }, (_, i) => `e${pad(i)}`);
      return {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: names.map((e) => [e, "Hub", "Tag"] as [string, string, string]),
        nodes: [
          { type: "Hub", key: "h", label: "Hub H" },
          { type: "Tag", key: "t", label: "Tag T" },
        ],
        edges: names.map((e) => ({ type: e, from: "Hub:h", to: "Tag:t" })),
      };
    }

    it("lists 20 groups and counts none unlisted when there are exactly 20", async () => {
      const hood = await loadThing(await open(wide(20)), "Hub:h", 5);
      expect(hood.groups).toHaveLength(20);
      expect(hood.unlisted).toBe(0);
    });

    it("lists no more than 20 groups of a thing with 23, and says so, never a clean 0", async () => {
      const hood = await loadThing(await open(wide(23)), "Hub:h", 5);
      expect(hood.groups.length).toBeLessThanOrEqual(20);
      expect(hood.unlisted).toBe(23 - hood.groups.length);
      expect(hood.unlisted).toBeGreaterThan(0);
    });

    it("keeps the listed groups in the kit's order (edge type by UTF-8 bytes) when some are unlisted", async () => {
      const hood = await loadThing(await open(wide(23)), "Hub:h", 3);
      const names = hood.groups.map((g) => g.edge);
      expect(names).toEqual([...names].sort());
    });
  });

  describe("several links to the same thing (G-3)", () => {
    function twice(): MosaicSpec {
      return {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [
          { type: "Hub", key: "h", label: "Hub H" },
          { type: "Tag", key: "t", label: "Tag T" },
        ],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:t", qualifier: "a" },
          { type: "carries", from: "Hub:h", to: "Tag:t", qualifier: "b" },
        ],
      };
    }

    it("counts links, not distinct things: two links of one type to one tag are a group of 2", async () => {
      const group = (await loadThing(await open(twice()), "Hub:h", 5)).groups[0]!;
      expect(group.count).toBe(2);
      expect(group.shown.every((t) => t.id === "Tag:t")).toBe(true);
      expect(group.shown.length + folded(group)).toBe(2);
    });

    it("opens the bundle with the total of links", async () => {
      const bundle = await openBundle(await open(twice()), NODE, "carries", "out");
      expect(bundle.total).toBe(2);
    });
  });

  describe("the order of neighbours is the kit's, by UTF-8 bytes (G-3, G-7)", () => {
    it("lists neighbours with non-ASCII keys exactly as the kit's neighbors does", async () => {
      // U+FF5E sorts before U+1F600 by UTF-8 bytes but after it by UTF-16 code units.
      const keys = ["z", "é", "\u{1F600}", "～", "a"];
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [{ type: "Hub", key: "h", label: "Hub H" }, ...keys.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
        edges: keys.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
      };
      const file = await open(spec);
      const kit = await file.neighbors({ id: "Hub:h", edge: "carries", direction: "out", limit: 20 });
      if ("error" in kit) throw new Error(kit.error.message);
      const group = (await loadThing(file, "Hub:h", 20)).groups[0]!;
      expect(group.shown.map((t) => t.id)).toEqual(kit.data.edges.map((e) => e.id));
      const bundle = await openBundle(file, NODE, "carries", "out");
      expect(bundle.things.map((t) => t.id)).toEqual(kit.data.edges.map((e) => e.id));
      expect(bundle.allLabels).toBeNull();
    });
  });

  describe("state is never changed in place (G-5, G-8)", () => {
    const all = ["carries", "next", "points_at", "tagged"];
    const frozen = (s: HoodState): HoodState =>
      Object.freeze({ ...s, expanded: Object.freeze([...s.expanded]), hidden: Object.freeze([...s.hidden]), edges: s.edges === null ? null : Object.freeze([...s.edges]) });

    it("leaves the state it was given untouched by every change", () => {
      const s = frozen(expand(hide(hoodOf("Hub:h"), "Item:a"), "Item:b"));
      const copy = JSON.parse(JSON.stringify(s));
      expand(s, "Item:c");
      collapse(s, "Item:b");
      hide(s, "Item:b");
      unhide(s, "Item:a");
      recentre(s, "Item:z");
      withLimit(s, 20);
      showEdge(s, all, "next", false);
      expect(JSON.parse(JSON.stringify(s))).toEqual(copy);
    });

    it("round-trips through JSON, as a link to a neighbourhood needs", () => {
      const s = withLimit(showEdge(hide(expand(hoodOf("Hub:h"), "Item:b"), "Item:a"), all, "next", false), 3);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    });
  });

  describe("expanded and hidden things (G-5)", () => {
    it("hides a thing once, however often it is hidden", () => {
      const s = hide(hide(hide(hoodOf("Hub:h"), "Item:a"), "Item:a"), "Item:a");
      expect(s.hidden).toEqual(["Item:a"]);
    });

    it("keeps hidden things in UTF-8 byte order, not UTF-16 order", () => {
      let s = hoodOf("Hub:h");
      for (const id of ["Tag:\u{1F600}", "Tag:～", "Tag:z", "Tag:é", "Tag:Z", "Tag:"]) s = hide(s, id);
      expect(s.hidden).toEqual(["Tag:", "Tag:Z", "Tag:z", "Tag:é", "Tag:～", "Tag:\u{1F600}"]);
    });

    it("gives the same hidden list whatever order things were hidden in", () => {
      const ids = ["Item:b", "Item:a", "Tag:é", "Item:B"];
      const forward = ids.reduce(hide, hoodOf("Hub:h"));
      const backward = [...ids].reverse().reduce(hide, hoodOf("Hub:h"));
      expect(forward.hidden).toEqual(backward.hidden);
    });

    it("unhiding a thing that is not hidden changes nothing", () => {
      const s = hide(hoodOf("Hub:h"), "Item:a");
      expect(unhide(s, "Item:b")).toBe(s);
      expect(unhide(hoodOf("Hub:h"), "Item:a").hidden).toEqual([]);
    });

    it("unhiding does not reopen what hiding closed", () => {
      const s = unhide(hide(expand(hoodOf("Hub:h"), "Item:a"), "Item:a"), "Item:a");
      expect(s.hidden).toEqual([]);
      expect(s.expanded).toEqual([]);
    });

    it("hiding a thing that was never expanded leaves the expanded list as it was", () => {
      const s = hide(expand(hoodOf("Hub:h"), "Item:b"), "Item:a");
      expect(s.expanded).toEqual(["Item:b"]);
    });

    it("collapsing a thing that is hidden or unknown changes nothing", () => {
      const s = hide(hoodOf("Hub:h"), "Item:a");
      expect(collapse(s, "Item:a")).toBe(s);
      expect(collapse(s, "Hub:h")).toBe(s);
    });

    it("reopening a collapsed thing puts it last in the order opened", () => {
      let s = expand(expand(hoodOf("Hub:h"), "Item:a"), "Item:b");
      s = expand(collapse(s, "Item:a"), "Item:a");
      expect(s.expanded).toEqual(["Item:b", "Item:a"]);
    });

    it("keeps ids that differ only by case or by composed and decomposed accents distinct", () => {
      let s = hoodOf("Hub:h");
      for (const id of ["Tag:é", "Tag:é", "Tag:E", "Tag:e"]) s = hide(s, id);
      expect(s.hidden).toHaveLength(4);
    });

    it("re-centres on the centre itself, or on a hidden or expanded thing, with nothing expanded or hidden", () => {
      const s = hide(expand(hoodOf("Hub:h"), "Item:a"), "Item:b");
      for (const id of ["Hub:h", "Item:a", "Item:b"]) {
        const r = recentre(s, id);
        expect(r.centre).toBe(id);
        expect(r.expanded).toEqual([]);
        expect(r.hidden).toEqual([]);
      }
    });
  });

  describe("edge types shown (G-5)", () => {
    const all = ["carries", "next", "points_at", "tagged"];

    it("starts showing every edge type, including ones made after a link was written", () => {
      const s = hoodOf("Hub:h");
      expect(s.edges).toBeNull();
      expect(shows(s, "brand_new")).toBe(true);
    });

    it("turning an edge type off then on again returns to showing every one", () => {
      const s = showEdge(showEdge(hoodOf("Hub:h"), all, "next", false), all, "next", true);
      expect(s.edges).toBeNull();
    });

    it("turning on what is already on, or off what is already off, changes nothing observable", () => {
      const base = hoodOf("Hub:h");
      expect(showEdge(base, all, "next", true).edges).toBeNull();
      const off = showEdge(base, all, "next", false);
      expect(showEdge(off, all, "next", false).edges).toEqual(["carries", "points_at", "tagged"]);
    });

    it("can show none at all, and then every edge type is hidden", () => {
      let s = hoodOf("Hub:h");
      for (const e of all) s = showEdge(s, all, e, false);
      expect(s.edges).toEqual([]);
      for (const e of all) expect(shows(s, e)).toBe(false);
      expect(shows(s, "brand_new")).toBe(false);
    });

    it("keeps the edge types shown in UTF-8 byte order whatever order they were turned on", () => {
      let s = hoodOf("Hub:h");
      for (const e of all) s = showEdge(s, all, e, false);
      for (const e of ["tagged", "carries", "points_at"]) s = showEdge(s, all, e, true);
      expect(s.edges).toEqual(["carries", "points_at", "tagged"]);
    });

    it("does not record an edge type the mosaic does not have", () => {
      const s = showEdge(showEdge(hoodOf("Hub:h"), all, "next", false), all, "ghost", true);
      expect(s.edges).toEqual(["carries", "points_at", "tagged"]);
      expect(showEdge(hoodOf("Hub:h"), all, "ghost", false).edges).toBeNull();
    });

    it("drops from a saved list an edge type the mosaic no longer has", () => {
      const old: HoodState = { ...hoodOf("Hub:h"), edges: ["carries", "gone", "next"] };
      const s = showEdge(old, all, "tagged", true);
      expect(s.edges).not.toContain("gone");
    });

    it("with no edge types at all, showing and hiding leave every one shown", () => {
      expect(showEdge(hoodOf("Hub:h"), [], "next", false).edges).toBeNull();
    });
  });

  describe("what a loaded neighbourhood follows (G-5, G-10)", () => {
    function two(): MosaicSpec {
      return {
        typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [
          ["carries", "Hub", "Tag"],
          ["points_at", "Item", "Hub"],
        ],
        nodes: [
          { type: "Hub", key: "h", label: "Hub H" },
          { type: "Item", key: "a", label: "Item A" },
          { type: "Tag", key: "t", label: "Tag T" },
        ],
        edges: [
          { type: "points_at", from: "Item:a", to: "Hub:h" },
          { type: "carries", from: "Hub:h", to: "Tag:t" },
        ],
      };
    }
    const all = ["carries", "points_at"];

    it("shows an edge type again, with its neighbours, once it is turned back on", async () => {
      const file = await open(two());
      const loader = new HoodLoader(file);
      const off = showEdge(hoodOf("Hub:h"), all, "carries", false);
      expect((await loader.load(off)).centre.groups.find((g) => g.edge === "carries")!.shown).toEqual([]);
      const on = await loader.load(showEdge(off, all, "carries", true));
      expect(on.centre.groups.find((g) => g.edge === "carries")!.shown.map((t) => t.id)).toEqual(["Tag:t"]);
    });

    it("keeps every group's count whether the edge type is shown or not, and the group order", async () => {
      const file = await open(two());
      const loader = new HoodLoader(file);
      const a = await loader.load(hoodOf("Hub:h"));
      const b = await loader.load(showEdge(showEdge(hoodOf("Hub:h"), all, "carries", false), all, "points_at", false));
      expect(b.centre.groups.map((g) => [g.edge, g.direction, g.count])).toEqual(a.centre.groups.map((g) => [g.edge, g.direction, g.count]));
      expect(b.centre.groups.every((g) => g.shown.length === 0 && folded(g) === 0)).toBe(true);
    });

    it("with no edge type shown asks the kit for no neighbours", async () => {
      const file = await open(two());
      const { source, calls } = counting(file);
      const none = showEdge(showEdge(hoodOf("Hub:h"), all, "carries", false), all, "points_at", false);
      await new HoodLoader(source).load(none);
      expect(calls.neighbors).toBe(0);
    });

    it("answers a change of limit from the kit once per limit, then from memory", async () => {
      const file = await open(star(8));
      const { source, calls } = counting(file);
      const loader = new HoodLoader(source);
      await loader.load(withLimit(hoodOf("Hub:h"), 3));
      await loader.load(withLimit(hoodOf("Hub:h"), 10));
      const asked = calls.neighbors;
      await loader.load(withLimit(hoodOf("Hub:h"), 3));
      await loader.load(withLimit(hoodOf("Hub:h"), 10));
      expect(calls.neighbors).toBe(asked);
    });

    it("does not let a neighbourhood loaded under one limit leak into another", async () => {
      const file = await open(star(8));
      const loader = new HoodLoader(file);
      const three = await loader.load(withLimit(hoodOf("Hub:h"), 3));
      const ten = await loader.load(withLimit(hoodOf("Hub:h"), 10));
      expect(three.centre.groups[0]!.shown).toHaveLength(3);
      expect(ten.centre.groups[0]!.shown).toHaveLength(8);
    });

    it("two loads at once of the same thing ask the kit once", async () => {
      const file = await open(star(8));
      const { source, calls } = counting(file);
      const loader = new HoodLoader(source);
      const [a, b] = await Promise.all([loader.load(hoodOf("Hub:h")), loader.load(hoodOf("Hub:h"))]);
      expect(calls.get).toBe(1);
      expect(b).toEqual(a);
    });

    it("loads an expanded thing under the same limit as the centre", async () => {
      const file = await open(two());
      const hood = await new HoodLoader(file).load(withLimit(expand(hoodOf("Hub:h"), "Item:a"), 3));
      expect(hood.state.limit).toBe(3);
      expect(hood.expanded[0]!.centre.id).toBe("Item:a");
    });

    it("does not load a hidden thing even if an old link lists it as expanded", async () => {
      const file = await open(two());
      const state: HoodState = { ...hoodOf("Hub:h"), expanded: ["Item:a"], hidden: ["Item:a"] };
      const hood = await new HoodLoader(file).load(state);
      expect(hood.expanded).toEqual([]);
      expect(hood.failed).toEqual([]);
    });

    it("reports every expanded thing it cannot find, not just the first", async () => {
      const file = await open(two());
      const hood = await new HoodLoader(file).load(expand(expand(hoodOf("Hub:h"), "Item:nope"), "Tag:nada"));
      expect(hood.failed.map((f) => f.id)).toEqual(["Item:nope", "Tag:nada"]);
    });

    it("can load a thing that is both a neighbour of the centre and expanded", async () => {
      const file = await open(two());
      const hood = await new HoodLoader(file).load(expand(hoodOf("Hub:h"), "Tag:t"));
      expect(hood.expanded.map((e) => e.centre.id)).toEqual(["Tag:t"]);
      expect(hood.expanded[0]!.groups.map((g) => [g.edge, g.direction, g.count])).toEqual([["carries", "in", 1]]);
    });

    it("gives the same bytes when loaded twice from fresh loaders", async () => {
      const file = await open(star(23));
      const s = withLimit(hoodOf("Hub:h"), 10);
      const a = JSON.stringify(await new HoodLoader(file).load(s));
      const b = JSON.stringify(await new HoodLoader(file).load(s));
      expect(b).toBe(a);
    });
  });

  describe("opening a bundle (G-4, G-10)", () => {
    it("lists exactly 20 things of a group of exactly 20, with the total", async () => {
      const file = await open(star(20));
      const bundle = await openBundle(file, NODE, "to_hub", "in");
      expect(bundle.total).toBe(20);
      expect(bundle.things).toHaveLength(20);
    });

    it("lists 20 of a group of 21, with the total 21 and a way to see the rest", async () => {
      const file = await open(star(21));
      const bundle = await openBundle(file, NODE, "to_hub", "in");
      expect(bundle.total).toBe(21);
      expect(bundle.things).toHaveLength(20);
      expect(bundle.table !== null || bundle.allLabels !== null).toBe(true);
    });

    it("lists the same first 20 things in the same order whenever it is opened", async () => {
      const file = await open(star(30));
      const a = await openBundle(file, NODE, "to_hub", "in");
      const b = await openBundle(file, NODE, "to_hub", "in");
      expect(b).toEqual(a);
      const kit = await file.neighbors({ id: "Hub:h", edge: "to_hub", direction: "in", limit: 20 });
      if ("error" in kit) throw new Error(kit.error.message);
      expect(a.things.map((t) => t.id)).toEqual(kit.data.edges.map((e) => e.id));
    });

    it("names the owner, edge type and direction it was opened for", async () => {
      const bundle = await openBundle(await open(star(25)), NODE, "to_hub", "in");
      expect(bundle.owner).toEqual(NODE);
      expect(bundle.edge).toBe("to_hub");
      expect(bundle.direction).toBe("in");
    });

    it("reaches the rest by a table whose filter finds every one of them", async () => {
      const file = await open(star(45));
      const bundle = await openBundle(file, NODE, "to_hub", "in");
      expect(bundle.table).not.toBeNull();
      const rows = await file.table({ type: bundle.table!.type, where: bundle.table!.where });
      if ("error" in rows) throw new Error(rows.error.message);
      expect(rows.data.total).toBeGreaterThanOrEqual(45);
      const ids = new Set(rows.data.rows.map((r) => r[0]));
      // The first page of the table is part of the group.
      expect([...ids].every((id) => typeof id === "string" && id.startsWith("Spoke:"))).toBe(true);
    });

    it("makes the table's type the type of the things the links come from", async () => {
      const bundle = await openBundle(await open(star(25)), NODE, "to_hub", "in");
      expect(bundle.table!.type).toBe("Spoke");
    });

    it("copes with an owner named with quotes, percent signs, backslashes and underscores", async () => {
      const odd = `50% off_sale "x" \\ 'y'`;
      const spec = star(25);
      spec.nodes[0] = { type: "Hub", key: "h", label: odd };
      const file = await open(spec);
      const bundle = await openBundle(file, { id: "Hub:h", label: odd, type: "Hub" }, "to_hub", "in");
      expect(bundle.total).toBe(25);
      expect(bundle.things).toHaveLength(20);
      const rows = await file.table({ type: "Spoke", where: bundle.table!.where });
      if ("error" in rows) throw new Error(rows.error.message);
      expect(rows.data.total).toBe(25);
    });

    it("copes with an owner named in non-ASCII text", async () => {
      const name = "Café \u{1F600} ～ 中";
      const spec = star(25);
      spec.nodes[0] = { type: "Hub", key: "h", label: name };
      const file = await open(spec);
      const bundle = await openBundle(file, { id: "Hub:h", label: name, type: "Hub" }, "to_hub", "in");
      const rows = await file.table({ type: "Spoke", where: bundle.table!.where });
      if ("error" in rows) throw new Error(rows.error.message);
      expect(rows.data.total).toBe(25);
    });

    it("does not offer a table filter for an owner whose name is empty, which would match every row", async () => {
      const spec = star(25);
      spec.nodes[0] = { type: "Hub", key: "h", label: "" };
      const file = await open(spec);
      const bundle = await openBundle(file, { id: "Hub:h", label: "", type: "Hub" }, "to_hub", "in");
      expect(bundle.things).toHaveLength(20);
      expect(bundle.table).toBeNull();
    });

    it("says by name when two owners share a name, so the list can hold more than the bundle", async () => {
      const spec = star(25);
      spec.nodes.push({ type: "Hub", key: "twin", label: "Hub H" });
      spec.edges.push({ type: "to_hub", from: "Spoke:s000", to: "Hub:twin" });
      const file = await open(spec);
      const bundle = await openBundle(file, NODE, "to_hub", "in");
      expect(bundle.total).toBe(25);
      expect(bundle.byName).toBe(true);
    });

    it("leaves a null label null among the things and among all the labels", async () => {
      const keys = Array.from({ length: 22 }, (_, i) => `t${pad(i)}`);
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [
          { type: "Hub", key: "h", label: "Hub H" },
          ...keys.map((k, i) => ({ type: "Tag", key: k, label: i === 0 || i === 21 ? null : `Tag ${k}` })),
        ],
        edges: keys.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
      };
      const file = await open(spec);
      const bundle = await openBundle(file, NODE, "carries", "out");
      expect(bundle.total).toBe(22);
      expect(bundle.things[0]).toEqual({ id: "Tag:t00", label: null, type: "Tag" });
      expect(bundle.allLabels).toHaveLength(22);
      expect(bundle.allLabels![0]).toBeNull();
      expect(bundle.allLabels![21]).toBeNull();
    });

    it("lists every label of links leaving a thing, one per link, even when two things share a label", async () => {
      const keys = Array.from({ length: 24 }, (_, i) => `t${pad(i)}`);
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [
          { type: "Hub", key: "h", label: "Hub H" },
          ...keys.map((k, i) => ({ type: "Tag", key: k, label: i < 2 ? "Same" : `Tag ${k}` })),
        ],
        edges: keys.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
      };
      const bundle = await openBundle(await open(spec), NODE, "carries", "out");
      expect(bundle.total).toBe(24);
      expect(bundle.allLabels).toHaveLength(24);
      expect(bundle.allLabels!.filter((l) => l === "Same")).toHaveLength(2);
    });

    it("does not list a different edge type's links in the bundle of another", async () => {
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}', Item: '{"name":"text"}' },
        edgeTypes: [
          ["carries", "Hub", "Tag"],
          ["owns", "Hub", "Item"],
        ],
        nodes: [
          { type: "Hub", key: "h", label: "Hub H" },
          { type: "Tag", key: "t", label: "Tag T" },
          { type: "Item", key: "i", label: "Item I" },
        ],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:t" },
          { type: "owns", from: "Hub:h", to: "Item:i" },
        ],
      };
      const bundle = await openBundle(await open(spec), NODE, "owns", "out");
      expect(bundle.things.map((t) => t.id)).toEqual(["Item:i"]);
      expect(bundle.total).toBe(1);
    });

    it("opens a self link from both of its sides", async () => {
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}' },
        edgeTypes: [["next", "Hub", "Hub"]],
        nodes: [{ type: "Hub", key: "h", label: "Hub H" }],
        edges: [{ type: "next", from: "Hub:h", to: "Hub:h" }],
      };
      const file = await open(spec);
      for (const direction of ["out", "in"] as const) {
        const bundle = await openBundle(file, NODE, "next", direction);
        expect(bundle.total).toBe(1);
        expect(bundle.things.map((t) => t.id)).toEqual(["Hub:h"]);
      }
    });

    it("is a bundle of the owner's own group count, as the neighbourhood showed it", async () => {
      const file = await open(star(27));
      const group = (await loadThing(file, "Hub:h", 3)).groups[0]!;
      const bundle = await openBundle(file, NODE, group.edge, group.direction);
      expect(bundle.total).toBe(group.count);
      expect(bundle.things.slice(0, group.shown.length)).toEqual(group.shown);
    });

    it("fails by naming the owner when the edge type or the owner is not in the mosaic", async () => {
      const file = await open(star(3));
      await expect(openBundle(file, { id: "Hub:ghost", label: "Ghost", type: "Hub" }, "to_hub", "in")).rejects.toThrow(/Hub:ghost/);
    });
  });

  describe("a thing's type (G-3)", () => {
    it("is read from an id of the form <type>:<key>, however odd the key", () => {
      expect(typeOfId("Item:")).toBe("Item");
      expect(typeOfId("Item::")).toBe("Item");
      expect(typeOfId("Item:a:b:c")).toBe("Item");
      expect(typeOfId("Item:\u{1F600}")).toBe("Item");
      expect(typeOfId("Item1:x")).toBe("Item1");
    });

    it("is null when the id has no type of that form", () => {
      for (const id of ["", ":", "item:x", "1Item:x", "It em:x", "It-em:x", "État:x", "Item"]) expect(typeOfId(id)).toBeNull();
    });
  });

  describe("a busy mosaic stays bounded (G-10)", () => {
    it("asks the kit for neighbours of a group of 1,000 with the limit, never 1,000", async () => {
      const file = await open(star(1000));
      const seen: number[] = [];
      const source: HoodSource = {
        edgeTypes: file.edgeTypes,
        get: (a) => file.get(a),
        neighbors: (a) => (seen.push((a as { limit: number }).limit), file.neighbors(a)),
        table: (a) => file.table(a),
      };
      const hood = await loadThing(source, "Hub:h", 20);
      expect(seen).toEqual([20]);
      expect(hood.groups[0]!.count).toBe(1000);
      expect(hood.groups[0]!.shown).toHaveLength(20);
      expect(folded(hood.groups[0]!)).toBe(980);
    });

    it("opens the bundle of 1,000 with 20 things and the total", async () => {
      const file = await open(star(1000));
      const bundle = await openBundle(file, NODE, "to_hub", "in");
      expect(bundle.total).toBe(1000);
      expect(bundle.things).toHaveLength(20);
    });
  });
});
