// The graph explorer's layouts (needs G-7, G-1, G-3, G-9): the map's, the
// neighbourhood's positions are functions of the mosaic's data and the
// person's choices only. The same input gives the same positions, with no clock and no
// randomness; sizes on the map follow the counts; a neighbourhood places its groups by edge
// type and direction. Data is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byBytes } from "../src/lib/graph/bytes.js";
import { groupOrder, layoutHood, RING, type HoodGroup, type HoodInput, type PlacedLink } from "../src/lib/graph/hood-layout.js";
import { layoutSchema, type SchemaEdge, type SchemaType } from "../src/lib/graph/schema.js";
import { generator, hashText, round, seeded } from "../src/lib/graph/seed.js";
import { shardPoints, svgPoints } from "../src/lib/graph/shard.js";

// No layout may read the clock or draw a random number: each throws while a test runs.
beforeEach(() => {
  vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("a layout drew a random number");
  });
  vi.spyOn(Date, "now").mockImplementation(() => {
    throw new Error("a layout read the clock");
  });
  vi.spyOn(performance, "now").mockImplementation(() => {
    throw new Error("a layout read the clock");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("numbers from ids", () => {
  it("the same text always gives the same numbers, and other text others", () => {
    const a = seeded("Item:a");
    const b = seeded("Item:a");
    const first = Array.from({ length: 8 }, () => a());
    expect(Array.from({ length: 8 }, () => b())).toEqual(first);
    const c = seeded("Item:b");
    expect(Array.from({ length: 8 }, () => c())).not.toEqual(first);
    for (const x of first) expect(x >= 0 && x < 1).toBe(true);
  });

  it("hash text by its UTF-8 bytes (FNV-1a)", () => {
    expect(hashText("")).toBe(0x811c9dc5);
    expect(hashText("a")).toBe(0xe40c292c);
    expect(hashText("é")).not.toBe(hashText("é"));
    expect(generator(7)()).toBe(generator(7)());
  });

  it("round to hundredths and never give -0", () => {
    expect(round(1.23456)).toBe(1.23);
    expect(round(-1.005)).toBe(-1);
    expect(Object.is(round(-0.001), 0)).toBe(true);
  });
});

describe("shards (brand book section 2)", () => {
  it("are irregular polygons of 5 to 8 corners inside their circle, fixed by the id", () => {
    for (const id of ["Item:a", "Item:b", "Group:x", "T:😀", ""]) {
      const points = shardPoints(id, 50, 50, 20);
      expect(points).toEqual(shardPoints(id, 50, 50, 20));
      expect(points.length).toBeGreaterThanOrEqual(5);
      expect(points.length).toBeLessThanOrEqual(8);
      for (const p of points) expect(Math.hypot(p.x - 50, p.y - 50)).toBeLessThanOrEqual(20.01);
      const radii = points.map((p) => Math.hypot(p.x - 50, p.y - 50));
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.5);
    }
    expect(shardPoints("Item:a", 0, 0, 10)).not.toEqual(shardPoints("Item:b", 0, 0, 10));
  });
});

const TYPES: SchemaType[] = [
  { name: "Hub", count: 900 },
  { name: "Leaf", count: 30 },
  { name: "Other", count: 2 },
  { name: "Alone", count: 0 },
];
const EDGES: SchemaEdge[] = [
  { name: "has", from: "Hub", to: "Leaf" },
  { name: "names", from: "Hub", to: "Leaf" },
  { name: "points_to", from: "Other", to: "Hub" },
  { name: "self", from: "Leaf", to: "Leaf" },
  { name: "loose", from: null, to: "Hub" },
];
const BOX = { width: 800, height: 600 };

describe("the map (G-1, G-7)", () => {
  it("places every type once, inside the box", () => {
    const map = layoutSchema(TYPES, EDGES, BOX);
    expect(map.types.map((t) => t.name)).toEqual(["Alone", "Hub", "Leaf", "Other"]);
    for (const t of map.types) {
      expect(t.x - t.r).toBeGreaterThanOrEqual(0);
      expect(t.y - t.r).toBeGreaterThanOrEqual(0);
      expect(t.x + t.r).toBeLessThanOrEqual(800);
      expect(t.y + t.r).toBeLessThanOrEqual(600);
    }
  });

  it("sizes types by how many things they hold: a shard's area follows its count", () => {
    const map = layoutSchema(TYPES, EDGES, { ...BOX, minRadius: 0, maxRadius: 60 });
    const r = Object.fromEntries(map.types.map((t) => [t.name, t.r]));
    expect(r.Hub).toBe(60);
    expect(r.Alone).toBe(0);
    // Area in proportion: r² / count is the same for every type.
    expect((r.Leaf! * r.Leaf!) / 30).toBeCloseTo((60 * 60) / 900, 1);
    expect((r.Other! * r.Other!) / 2).toBeCloseTo((60 * 60) / 900, 1);
    const sized = layoutSchema(TYPES, EDGES, BOX);
    const s = Object.fromEntries(sized.types.map((t) => [t.name, t.r]));
    expect(s.Hub).toBeGreaterThan(s.Leaf!);
    expect(s.Leaf).toBeGreaterThan(s.Other!);
    expect(s.Other).toBeGreaterThan(s.Alone!);
  });

  it("is the same picture every time, whatever order types and edge types come in", () => {
    const one = layoutSchema(TYPES, EDGES, BOX);
    expect(layoutSchema(TYPES, EDGES, BOX)).toEqual(one);
    expect(layoutSchema([...TYPES].reverse(), [...EDGES].reverse(), BOX)).toEqual(one);
  });

  it("draws an arrow for every edge type that names its two types, apart from its twins", () => {
    const map = layoutSchema(TYPES, EDGES, BOX);
    expect(map.edges.map((e) => [e.name, e.from, e.to])).toEqual([
      ["has", "Hub", "Leaf"],
      ["names", "Hub", "Leaf"],
      ["points_to", "Other", "Hub"],
      ["self", "Leaf", "Leaf"],
    ]);
    expect(map.unplaced.map((e) => e.name)).toEqual(["loose"]);
    const [has, names] = map.edges;
    expect(has!.control).not.toEqual(names!.control);
    // An arrow starts at its type's shard and ends at the other's, not inside either.
    const hub = map.types.find((t) => t.name === "Hub")!;
    expect(Math.hypot(has!.start.x - hub.x, has!.start.y - hub.y)).toBeGreaterThanOrEqual(hub.r);
  });

  it("keeps shards apart, with room for their names", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, count: i * 10 }));
    const map = layoutSchema(many, [], BOX);
    for (const a of map.types) for (const b of map.types) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
  });

  it("puts a lone type in the middle", () => {
    expect(layoutSchema([{ name: "Only", count: 1 }], [], BOX).types[0]).toMatchObject({ x: 400, y: 300 });
  });

  it("puts each type's name on the side freest of arrows, below when none is near", () => {
    const map = layoutSchema(
      [
        { name: "A", count: 1 },
        { name: "B", count: 1 },
        { name: "C", count: 1 },
      ],
      [{ name: "down", from: "A", to: "B" }],
      { width: 800, height: 800 },
    );
    const at = Object.fromEntries(map.types.map((t) => [t.name, t]));
    const angle = Math.atan2(at.B!.y - at.A!.y, at.B!.x - at.A!.x);
    const dir: Record<string, number> = { below: Math.PI / 2, right: 0, above: -Math.PI / 2, left: Math.PI };
    const off = Math.abs(Math.atan2(Math.sin(angle - dir[at.A!.side]!), Math.cos(angle - dir[at.A!.side]!)));
    expect(off).toBeGreaterThan(Math.PI / 2);
    expect(at.C!.side).toBe("below");
  });
});

const thing = (id: string) => ({ id, label: id.slice(id.indexOf(":") + 1), type: id.slice(0, id.indexOf(":")) });
const group = (edge: string, direction: "out" | "in", count: number, ids: string[]): HoodGroup => ({ edge, direction, count, shown: ids.map(thing) });

const CENTRE: HoodInput = {
  centre: thing("Item:c"),
  groups: [
    group("tagged", "out", 2, ["Tag:a", "Tag:b"]),
    group("about", "in", 7, ["Note:1", "Note:2", "Note:3"]),
    group("about", "out", 1, ["Item:x"]),
    group("tagged", "in", 1, ["Tag:a"]),
  ],
};

describe("a neighbourhood (G-3, G-4, G-5, G-7)", () => {
  it("puts the thing at the centre and every neighbour on a ring round it", () => {
    const hood = layoutHood(CENTRE);
    const centre = hood.things.find((t) => t.id === "Item:c")!;
    expect(centre).toMatchObject({ x: 0, y: 0, parent: null });
    for (const t of hood.things.filter((x) => x.parent !== null)) expect(Math.hypot(t.x, t.y)).toBeCloseTo(RING, 0);
  });

  it("places its groups by edge type, then out before in, clockwise from the top", () => {
    const hood = layoutHood(CENTRE);
    expect(hood.groups.map((g) => `${g.edge} ${g.direction}`)).toEqual(["about out", "about in", "tagged out", "tagged in"]);
    const angle = (g: { labelAt: { x: number; y: number } }) => (Math.atan2(g.labelAt.y, g.labelAt.x) + 2.5 * Math.PI) % (2 * Math.PI);
    const angles = hood.groups.map(angle);
    expect([...angles].sort((a, b) => a - b)).toEqual(angles);
    expect([...CENTRE.groups].sort(groupOrder).map((g) => `${g.edge} ${g.direction}`)).toEqual(["about out", "about in", "tagged out", "tagged in"]);
  });

  it("is the same picture whatever order the groups come in", () => {
    const shuffled: HoodInput = { ...CENTRE, groups: [...CENTRE.groups].reverse() };
    expect(layoutHood(shuffled)).toEqual(layoutHood(CENTRE));
    expect(layoutHood(CENTRE)).toEqual(layoutHood(CENTRE));
  });

  it("folds a group's neighbours past those shown into one bundle with their count", () => {
    const hood = layoutHood(CENTRE);
    const about = hood.groups.find((g) => g.edge === "about" && g.direction === "in")!;
    expect(about).toMatchObject({ count: 7, shown: 3 });
    expect(about.bundle!.count).toBe(4);
    expect(Math.hypot(about.bundle!.x, about.bundle!.y)).toBeCloseTo(RING, 0);
    expect(hood.groups.find((g) => g.edge === "tagged" && g.direction === "out")!.bundle).toBeNull();
  });

  it("draws each thing once, and every link, as its edge points", () => {
    const hood = layoutHood(CENTRE);
    expect(hood.things.filter((t) => t.id === "Tag:a")).toHaveLength(1);
    expect(hood.links).toContainEqual({ from: "Item:c", to: "Tag:a", edge: "tagged" });
    expect(hood.links).toContainEqual({ from: "Tag:a", to: "Item:c", edge: "tagged" });
    expect(hood.links).toContainEqual({ from: "Note:1", to: "Item:c", edge: "about" });
  });

  it("leaves out hidden things and edge types not shown", () => {
    const hood = layoutHood(CENTRE, [], { hidden: new Set(["Note:2"]), shows: (e) => e !== "tagged" });
    expect(hood.things.map((t) => t.id).sort(byBytes)).toEqual(["Item:c", "Item:x", "Note:1", "Note:3"]);
    expect(hood.groups.map((g) => g.edge)).toEqual(["about", "about"]);
    expect(hood.links.some((l) => l.from === "Note:2" || l.to === "Note:2")).toBe(false);
  });

  it("opens an expanded neighbour's groups in a fan pointing away from the centre", () => {
    const note: HoodInput = { centre: thing("Note:1"), groups: [group("about", "out", 1, ["Item:c"]), group("by", "out", 2, ["Person:p", "Person:q"])] };
    const hood = layoutHood(CENTRE, [note]);
    const n = hood.things.find((t) => t.id === "Note:1")!;
    for (const id of ["Person:p", "Person:q"]) {
      const p = hood.things.find((t) => t.id === id)!;
      expect(p.parent).toBe("Note:1");
      // Farther from the centre than the neighbour it hangs from.
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(Math.hypot(n.x, n.y));
    }
    // The link back to the centre is not drawn twice.
    expect(hood.links.filter((l) => l.from === "Note:1" && l.to === "Item:c")).toHaveLength(1);
  });

  it("draws every link between an expanded thing and where it hangs, once each", () => {
    // Two links of different edge types between the centre and a neighbour: the expanded
    // neighbour's group that mirrors the link it hangs by adds nothing; its other link is drawn.
    const centre: HoodInput = { centre: thing("Item:c"), groups: [group("knows", "out", 1, ["Item:n"])] };
    const n: HoodInput = {
      centre: thing("Item:n"),
      groups: [group("knows", "in", 1, ["Item:c"]), group("likes", "out", 1, ["Item:c"]), group("likes", "in", 1, ["Item:z"])],
    };
    const hood = layoutHood(centre, [n]);
    expect(hood.links).toEqual([
      { from: "Item:c", to: "Item:n", edge: "knows" },
      { from: "Item:n", to: "Item:c", edge: "likes" },
      { from: "Item:z", to: "Item:n", edge: "likes" },
    ]);
    expect(hood.things.filter((t) => t.id === "Item:c")).toHaveLength(1);
    const knowsIn = hood.groups.find((g) => g.owner === "Item:n" && g.edge === "knows")!;
    expect(knowsIn).toMatchObject({ count: 1, shown: 0, bundle: null });
  });

  it("draws two links of one edge type between one pair, which the kit lists as two rows of one group", () => {
    // Two edges that differ only by qualifier (section 3.4) are two links, each with its evidence.
    const centre: HoodInput = { centre: thing("Item:c"), groups: [group("knows", "out", 2, ["Item:n", "Item:n"])] };
    const alone = layoutHood(centre);
    expect(alone.links).toEqual([
      { from: "Item:c", to: "Item:n", edge: "knows" },
      { from: "Item:c", to: "Item:n", edge: "knows" },
    ]);
    expect(alone.groups[0]).toMatchObject({ count: 2, shown: 2, bundle: null });
    // Expanded, the neighbour's group that mirrors both adds nothing.
    const n: HoodInput = { centre: thing("Item:n"), groups: [group("knows", "in", 2, ["Item:c", "Item:c"])] };
    const both = layoutHood(centre, [n]);
    expect(both.links).toEqual(alone.links);
  });

  it("opens expanded things given before the neighbour they hang from, and never twice", () => {
    const note: HoodInput = { centre: thing("Note:1"), groups: [group("by", "out", 1, ["Person:p"])] };
    const person: HoodInput = { centre: thing("Person:p"), groups: [group("knows", "out", 1, ["Person:z"])] };
    const inOrder = layoutHood(CENTRE, [note, person]);
    expect(layoutHood(CENTRE, [person, note, note])).toEqual(inOrder);
    expect(inOrder.things.find((t) => t.id === "Person:z")!.parent).toBe("Person:p");
  });

  it("leaves out an expanded thing that is hidden or not drawn", () => {
    const stray: HoodInput = { centre: thing("Elsewhere:1"), groups: [group("by", "out", 1, ["Person:p"])] };
    const note: HoodInput = { centre: thing("Note:1"), groups: [group("by", "out", 1, ["Person:p"])] };
    expect(layoutHood(CENTRE, [stray])).toEqual(layoutHood(CENTRE));
    const hidden = layoutHood(CENTRE, [note], { hidden: new Set(["Note:1"]) });
    expect(hidden.things.some((t) => t.id === "Person:p")).toBe(false);
  });

  it("is a lone centre when the thing has no links", () => {
    expect(layoutHood({ centre: thing("Item:alone"), groups: [] })).toEqual({
      things: [{ ...thing("Item:alone"), x: 0, y: 0, parent: null }],
      groups: [],
      links: [],
    });
  });
});

// These cases time the layouts and set the clock themselves, so the guard above is lifted for them.
describe("graph layout: timing and clock cases, and further ones", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Two names whose UTF-16 order and UTF-8 byte order disagree: U+FF5A is one UTF-16 unit above the
  // surrogates (0xD83D), but its UTF-8 bytes (EF BD 9A) sort below those of U+1F600 (F0 9F 98 80).
  const WIDE = "\uFF5A";
  const ASTRAL = "\u{1F600}";

  /** Every number in `value`, however deep. */
  function numbers(value: unknown, out: number[] = []): number[] {
    if (typeof value === "number") out.push(value);
    else if (Array.isArray(value)) for (const v of value) numbers(v, out);
    else if (value !== null && typeof value === "object") for (const v of Object.values(value)) numbers(v, out);
    return out;
  }

  /** Freeze `value` and everything in it, so a layout that writes to its input throws. */
  function freeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) freeze(v);
      Object.freeze(value);
    }
    return value;
  }

  describe("byBytes (the kit's order, UTF-8 bytes)", () => {
    it("orders by UTF-8 bytes, not by UTF-16 units", () => {
      expect(byBytes(WIDE, ASTRAL)).toBeLessThan(0);
      expect(byBytes(ASTRAL, WIDE)).toBeGreaterThan(0);
      // The default string sort disagrees, which is why the layouts must not use it.
      expect([ASTRAL, WIDE].sort()).toEqual([ASTRAL, WIDE]);
      expect([ASTRAL, WIDE].sort(byBytes)).toEqual([WIDE, ASTRAL]);
    });

    it("puts a prefix first, equal text at zero, and a NUL byte before any other", () => {
      expect(byBytes("a", "ab")).toBeLessThan(0);
      expect(byBytes("ab", "a")).toBeGreaterThan(0);
      expect(byBytes("", "a")).toBeLessThan(0);
      expect(byBytes("same", "same")).toBe(0);
      expect(byBytes("a", "a\0")).toBeLessThan(0);
      expect(byBytes("a\0z", "a\x01")).toBeLessThan(0);
    });

    it("puts uppercase before lowercase, as bytes do", () => {
      expect(byBytes("Z", "a")).toBeLessThan(0);
    });
  });

  describe("numbers from ids, more cases (G-7)", () => {
    it("hashes known texts by their UTF-8 bytes (FNV-1a, 32 bits)", () => {
      expect(hashText("foobar")).toBe(0xbf9cf968);
      expect(hashText("\0")).toBe(0x050c5d1f);
      expect(hashText("\u{1F600}")).toBe(0x33a29608);
      expect(hashText("a\0b")).toBe(0x10f3abd2);
    });

    it("tells a precomposed letter from the same letter written with a combining mark", () => {
      expect(hashText("\u00e9")).toBe(0x1e9de8c1);
      expect(hashText("e\u0301")).toBe(0xfa9bc71f);
    });

    it("hashes a very long text, with NULs in it, to an unsigned 32-bit number, the same twice", () => {
      const long = ("x\0y".repeat(1000) + "\u{1F600}").repeat(50);
      const h = hashText(long);
      expect(h).toBe(hashText(long));
      expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    });

    it("draws numbers in [0, 1) however many are drawn, and a long run is not constant", () => {
      const next = seeded("Item:a");
      const seen = new Set<number>();
      for (let i = 0; i < 5000; i++) {
        const x = next();
        expect(x >= 0 && x < 1).toBe(true);
        seen.add(x);
      }
      expect(seen.size).toBeGreaterThan(4900);
    });

    it("seeds a generator from the hash, so an id and its hash give one sequence", () => {
      const a = seeded("Item:a");
      const b = generator(hashText("Item:a"));
      expect(Array.from({ length: 5 }, () => a())).toEqual(Array.from({ length: 5 }, () => b()));
    });

    it("separates ids that differ by one byte, an empty id and a NUL id", () => {
      const first = (id: string) => seeded(id)();
      expect(new Set([first(""), first("\0"), first("a"), first("a\0"), first("a\0b")]).size).toBe(5);
    });

    it("rounds without giving -0, NaN or a number with more than two decimals", () => {
      for (const x of [0, -0, 1e-9, -1e-9, 123456.789, -123456.789, 1e12, 0.005, -0.004]) {
        const r = round(x);
        expect(Object.is(r, -0)).toBe(false);
        expect(Number.isFinite(r)).toBe(true);
        expect(Math.round(r * 100) / 100).toBe(r);
      }
    });
  });

  describe("shards, more cases (G-7, brand book section 2)", () => {
    it("has a shape that comes from the id alone: moving or scaling it moves or scales the same shape", () => {
      for (const id of ["Item:a", "Group:x", "T:\u{1F600}", "", "a\0b"]) {
        const base = shardPoints(id, 0, 0, 100);
        const moved = shardPoints(id, 300, -40, 100);
        const scaled = shardPoints(id, 0, 0, 50);
        expect(moved).toHaveLength(base.length);
        expect(scaled).toHaveLength(base.length);
        base.forEach((p, i) => {
          expect(moved[i]!.x - 300).toBeCloseTo(p.x, 1);
          expect(moved[i]!.y + 40).toBeCloseTo(p.y, 1);
          expect(scaled[i]!.x).toBeCloseTo(p.x / 2, 1);
          expect(scaled[i]!.y).toBeCloseTo(p.y / 2, 1);
        });
      }
    });

    it("goes clockwise on screen (y down), for every id", () => {
      for (let i = 0; i < 40; i++) {
        const pts = shardPoints(`Item:${i}`, 10, 10, 30);
        let area = 0;
        pts.forEach((p, j) => {
          const q = pts[(j + 1) % pts.length]!;
          area += p.x * q.y - q.x * p.y;
        });
        expect(area).toBeGreaterThan(0);
      }
    });

    it("starts at the top: the first corner is in the upper half or just past it", () => {
      for (let i = 0; i < 40; i++) {
        const pts = shardPoints(`Item:${i}`, 0, 0, 30);
        // Corners are at jittered angles, so only demand that no shard starts in its lower half.
        expect(pts[0]!.y).toBeLessThan(30 * 0.5);
      }
    });

    it("gives finite corners for a zero radius and for a very long id with NULs", () => {
      for (const p of shardPoints("Item:a", 5, 5, 0)) expect(p).toEqual({ x: 5, y: 5 });
      const long = shardPoints("x\0".repeat(5000), 0, 0, 10);
      expect(numbers(long).every(Number.isFinite)).toBe(true);
      expect(long).toEqual(shardPoints("x\0".repeat(5000), 0, 0, 10));
    });

    it("rounds every coordinate to hundredths", () => {
      for (const p of shardPoints("Item:round", 1 / 3, 2 / 3, 17.123456)) {
        expect(p.x).toBe(round(p.x));
        expect(p.y).toBe(round(p.y));
      }
    });

    it("writes corners as an SVG points value: x,y pairs separated by one space, nothing for none", () => {
      expect(svgPoints([])).toBe("");
      expect(svgPoints([{ x: 1, y: 2 }])).toBe("1,2");
      expect(
        svgPoints([
          { x: 1.5, y: -2 },
          { x: 0, y: 3.25 },
        ]),
      ).toBe("1.5,-2 0,3.25");
    });
  });

  describe("the map, more cases (G-1, G-7)", () => {
    it("is a box and no shard for no types", () => {
      const map = layoutSchema([], [], BOX);
      expect(map).toMatchObject({ width: 800, height: 600, types: [], edges: [], unplaced: [] });
    });

    it("leaves every edge type unplaced when there are no types to join", () => {
      const map = layoutSchema([], [{ name: "e", from: "A", to: "B" }], BOX);
      expect(map.edges).toEqual([]);
      expect(map.unplaced.map((e) => e.name)).toEqual(["e"]);
    });

    it("does not throw or give NaN when every count is zero", () => {
      const map = layoutSchema(
        [
          { name: "A", count: 0 },
          { name: "B", count: 0 },
        ],
        [{ name: "e", from: "A", to: "B" }],
        BOX,
      );
      expect(numbers(map).every(Number.isFinite)).toBe(true);
      expect(map.types).toHaveLength(2);
    });

    it("gives equal counts equal sizes, and orders the tie by name in UTF-8 bytes", () => {
      const types: SchemaType[] = [
        { name: ASTRAL, count: 5 },
        { name: WIDE, count: 5 },
        { name: "b", count: 5 },
      ];
      const map = layoutSchema(types, [], BOX);
      expect(new Set(map.types.map((t) => t.r)).size).toBe(1);
      expect(map.types.map((t) => t.name)).toEqual(["b", WIDE, ASTRAL]);
      expect(layoutSchema([...types].reverse(), [], BOX)).toEqual(map);
    });

    it("is the same picture whatever order a tie among equally connected types comes in", () => {
      const types: SchemaType[] = ["P", "Q", "R", "S"].map((name) => ({ name, count: 10 }));
      const edges: SchemaEdge[] = [
        { name: "a", from: "P", to: "Q" },
        { name: "b", from: "R", to: "S" },
        { name: "c", from: "Q", to: "R" },
        { name: "d", from: "S", to: "P" },
      ];
      const one = layoutSchema(types, edges, BOX);
      for (const t of [types, [...types].reverse(), [types[2]!, types[0]!, types[3]!, types[1]!]]) {
        for (const e of [edges, [...edges].reverse(), [edges[1]!, edges[3]!, edges[0]!, edges[2]!]]) {
          expect(layoutSchema(t, e, BOX)).toEqual(one);
        }
      }
    });

    it("is the same picture under any clock: the time of day never shows", () => {
      const types: SchemaType[] = [
        { name: "A", count: 3 },
        { name: "B", count: 9 },
      ];
      const edges: SchemaEdge[] = [{ name: "e", from: "A", to: "B" }];
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
        const early = layoutSchema(types, edges, BOX);
        vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
        expect(layoutSchema(types, edges, BOX)).toEqual(early);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not write to its input", () => {
      const types = freeze([
        { name: "B", count: 4 },
        { name: "A", count: 9 },
      ]);
      const edges = freeze([{ name: "e", from: "A", to: "B" }]);
      expect(() => layoutSchema(types, edges, freeze({ ...BOX }))).not.toThrow();
      expect(types.map((t) => t.name)).toEqual(["B", "A"]);
    });

    it("rounds every coordinate to hundredths and gives only finite numbers", () => {
      const types: SchemaType[] = Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, count: (i + 1) * 7 }));
      const edges: SchemaEdge[] = types.slice(1).map((t, i) => ({ name: `e${i}`, from: "T0", to: t.name }));
      const map = layoutSchema(types, edges, BOX);
      const all = numbers([map.types.map((t) => [t.x, t.y]), map.edges]);
      expect(all.every(Number.isFinite)).toBe(true);
      for (const x of all) expect(Math.round(x * 100) / 100).toBe(x);
    });

    it("puts two unconnected groups of types in one picture, each type once, inside the box", () => {
      const types: SchemaType[] = ["A", "B", "C", "D", "E"].map((name, i) => ({ name, count: i + 1 }));
      const edges: SchemaEdge[] = [
        { name: "ab", from: "A", to: "B" },
        { name: "cd", from: "C", to: "D" },
      ];
      const map = layoutSchema(types, edges, BOX);
      expect(map.types.map((t) => t.name)).toEqual(["A", "B", "C", "D", "E"]);
      for (const t of map.types) {
        expect(t.x - t.r).toBeGreaterThanOrEqual(0);
        expect(t.x + t.r).toBeLessThanOrEqual(800);
        expect(t.y - t.r).toBeGreaterThanOrEqual(0);
        expect(t.y + t.r).toBeLessThanOrEqual(600);
      }
      expect(layoutSchema([...types].reverse(), [...edges].reverse(), BOX)).toEqual(map);
    });

    it("draws a loop (an edge type from a type to itself) with finite points and keeps the shard where it is", () => {
      const types: SchemaType[] = [{ name: "Only", count: 5 }];
      const map = layoutSchema(types, [{ name: "loop", from: "Only", to: "Only" }], BOX);
      expect(map.edges).toHaveLength(1);
      expect(numbers(map.edges).every(Number.isFinite)).toBe(true);
      expect(map.types[0]).toMatchObject({ x: 400, y: 300 });
    });

    it("draws an edge type that names a type the mosaic does not hold without throwing, the same twice", () => {
      const types: SchemaType[] = [{ name: "A", count: 1 }];
      const edges: SchemaEdge[] = [{ name: "e", from: "A", to: "Ghost" }];
      const one = layoutSchema(types, edges, BOX);
      expect(layoutSchema(types, edges, BOX)).toEqual(one);
      expect(numbers(one).every(Number.isFinite)).toBe(true);
      expect(one.types.map((t) => t.name)).toEqual(["A"]);
    });

    it("keeps a larger count at least as large, over many counts, even very large ones", () => {
      const counts = [0, 1, 2, 3, 10, 1000, 1_000_000, 4_000_000_000];
      const types = counts.map((count, i) => ({ name: `T${i}`, count }));
      const map = layoutSchema(types, [], { width: 2000, height: 2000 });
      const r = map.types.map((t) => t.r);
      for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThanOrEqual(r[i - 1]!);
      expect(r.at(-1)!).toBeGreaterThan(r[0]!);
      expect(numbers(map).every(Number.isFinite)).toBe(true);
    });

    it("places thirty types apart and inside a big enough box, the same twice", () => {
      const types = Array.from({ length: 30 }, (_, i) => ({ name: `Type${String(i).padStart(2, "0")}`, count: 1 + ((i * 37) % 50) }));
      const edges = types.slice(1).map((t, i) => ({ name: `e${i}`, from: types[(i * 7) % (i + 1)]!.name, to: t.name }));
      const box = { width: 2400, height: 1800 };
      const map = layoutSchema(types, edges, box);
      expect(layoutSchema(types, edges, box)).toEqual(map);
      for (const a of map.types) {
        expect(a.x - a.r).toBeGreaterThanOrEqual(0);
        expect(a.y - a.r).toBeGreaterThanOrEqual(0);
        expect(a.x + a.r).toBeLessThanOrEqual(2400);
        expect(a.y + a.r).toBeLessThanOrEqual(1800);
        for (const b of map.types) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
      }
    });

    it("keeps each arrow's twins apart when three edge types join the same two types", () => {
      const types: SchemaType[] = [
        { name: "A", count: 4 },
        { name: "B", count: 4 },
      ];
      const edges: SchemaEdge[] = ["x", "y", "z"].map((name) => ({ name, from: "A", to: "B" }));
      const map = layoutSchema(types, edges, BOX);
      const controls = new Set(map.edges.map((e) => `${e.control.x},${e.control.y}`));
      expect(controls.size).toBe(3);
    });

    it("keeps two edge types that run opposite ways between two types apart", () => {
      const types: SchemaType[] = [
        { name: "A", count: 4 },
        { name: "B", count: 4 },
      ];
      const edges: SchemaEdge[] = [
        { name: "to", from: "A", to: "B" },
        { name: "back", from: "B", to: "A" },
      ];
      const map = layoutSchema(types, edges, BOX);
      const [back, to] = [map.edges.find((e) => e.name === "back")!, map.edges.find((e) => e.name === "to")!];
      expect(back.middle).not.toEqual(to.middle);
    });

    it("lists edge types in the kit's order: by name in UTF-8 bytes", () => {
      const types: SchemaType[] = [
        { name: "A", count: 1 },
        { name: "B", count: 1 },
      ];
      const edges: SchemaEdge[] = [ASTRAL, WIDE, "b", "B"].map((name) => ({ name, from: "A", to: "B" }));
      const map = layoutSchema(types, edges, BOX);
      expect(map.edges.map((e) => e.name)).toEqual(["B", "b", WIDE, ASTRAL]);
    });

    it("lists unplaced edge types in the kit's order too", () => {
      const edges: SchemaEdge[] = [ASTRAL, WIDE, "b"].map((name) => ({ name, from: null, to: null }));
      const map = layoutSchema([], edges, BOX);
      expect(map.unplaced.map((e) => e.name)).toEqual(["b", WIDE, ASTRAL]);
    });

    it("is the same picture whatever order several unplaced edge types come in (G-7)", () => {
      const edges: SchemaEdge[] = [
        { name: "z", from: null, to: "A" },
        { name: "m", from: "A", to: null },
        { name: "b", from: null, to: null },
      ];
      const types: SchemaType[] = [{ name: "A", count: 1 }];
      const one = layoutSchema(types, edges, BOX);
      expect(layoutSchema(types, [...edges].reverse(), BOX)).toEqual(one);
    });

    it("orders types by UTF-8 bytes, not UTF-16 units", () => {
      const map = layoutSchema(
        [ASTRAL, WIDE].map((name, i) => ({ name, count: i })),
        [],
        BOX,
      );
      expect(map.types.map((t) => t.name)).toEqual([WIDE, ASTRAL]);
    });

    it("keeps the picture's size to the box it is given", () => {
      for (const box of [{ width: 300, height: 300 }, { width: 1600, height: 400 }]) {
        const map = layoutSchema([{ name: "A", count: 2 }, { name: "B", count: 3 }], [{ name: "e", from: "A", to: "B" }], box);
        expect(map.width).toBe(box.width);
        expect(map.height).toBe(box.height);
      }
    });
  });

  const angleOf = (p: { x: number; y: number }) => (Math.atan2(p.y, p.x) + 2.5 * Math.PI) % (2 * Math.PI);

  describe("a neighbourhood, more cases (G-3, G-4, G-5, G-7)", () => {
    it("orders groups by edge type in UTF-8 bytes, not UTF-16 units", () => {
      const input: HoodInput = {
        centre: thing("Item:c"),
        groups: [group(ASTRAL, "out", 1, ["A:1"]), group(WIDE, "out", 1, ["A:2"]), group("z", "in", 1, ["A:3"]), group("z", "out", 1, ["A:4"])],
      };
      const hood = layoutHood(input);
      expect(hood.groups.map((g) => `${g.edge} ${g.direction}`)).toEqual(["z out", "z in", `${WIDE} out`, `${ASTRAL} out`]);
      expect(layoutHood({ ...input, groups: [...input.groups].reverse() })).toEqual(hood);
    });

    it("keeps each group's shards together: no shard of another group sits between them round the circle", () => {
      const input: HoodInput = {
        centre: thing("Item:c"),
        groups: [
          group("a", "out", 5, ["N:1", "N:2", "N:3", "N:4", "N:5"]),
          group("b", "out", 3, ["M:1", "M:2", "M:3"]),
          group("c", "in", 9, ["P:1", "P:2"]),
          group("d", "out", 1, ["Q:1"]),
        ],
      };
      const hood = layoutHood(input);
      const owner = new Map<string, string>();
      for (const g of input.groups) for (const t of g.shown) owner.set(t.id, g.edge);
      const ring = hood.things
        .filter((t) => t.parent !== null)
        .sort((p, q) => angleOf(p) - angleOf(q))
        .map((t) => owner.get(t.id)!);
      // Each group's name appears in one run round the circle.
      const runs = ring.filter((e, i) => i === 0 || ring[i - 1] !== e);
      expect(runs.length).toBe(new Set(ring).size);
    });

    it("starts at the top: the first group's shards are nearer the top than the last group's end", () => {
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 1, ["N:1"]), group("b", "out", 1, ["N:2"]), group("c", "out", 1, ["N:3"])] });
      const [a, b, c] = ["N:1", "N:2", "N:3"].map((id) => angleOf(hood.things.find((t) => t.id === id)!));
      expect(a!).toBeLessThan(b!);
      expect(b!).toBeLessThan(c!);
      // Turning clockwise on screen from the top: the first stays in the first half turn.
      expect(a!).toBeLessThan(Math.PI);
    });

    it("gives a group with more shards a larger share of the circle than a group with one", () => {
      const hood = layoutHood({
        centre: thing("Item:c"),
        groups: [group("a", "out", 1, ["N:1"]), group("b", "out", 8, ["M:1", "M:2", "M:3", "M:4", "M:5", "M:6", "M:7", "M:8"])],
      });
      const spread = (prefix: string) => {
        const as = hood.things.filter((t) => t.id.startsWith(prefix)).map(angleOf);
        return Math.max(...as) - Math.min(...as);
      };
      expect(spread("M:")).toBeGreaterThan(spread("N:"));
    });

    it("does not throw or give NaN for a group with a count of zero and nothing shown", () => {
      // The spec does not say whether such a group is drawn (reported as a gap), only that it is safe.
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 0, [])] });
      expect(hood.things).toHaveLength(1);
      expect(numbers(hood).every(Number.isFinite)).toBe(true);
    });

    it("shows only a bundle when the limit shows nothing but links remain", () => {
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 12, [])] });
      expect(hood.groups[0]!.shown).toBe(0);
      expect(hood.groups[0]!.bundle!.count).toBe(12);
      expect(numbers(hood).every(Number.isFinite)).toBe(true);
    });

    it("has no bundle when every link is shown, however many", () => {
      const ids = Array.from({ length: 20 }, (_, i) => `N:${i}`);
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 20, ids)] });
      expect(hood.groups[0]).toMatchObject({ count: 20, shown: 20, bundle: null });
    });

    it("puts a bundle where no shard of its group is", () => {
      const ids = ["N:1", "N:2", "N:3", "N:4", "N:5"];
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 500, ids), group("b", "in", 2, ["M:1", "M:2"])] });
      const a = hood.groups.find((g) => g.edge === "a")!;
      for (const id of ids) {
        const t = hood.things.find((x) => x.id === id)!;
        expect(Math.hypot(t.x - a.bundle!.x, t.y - a.bundle!.y)).toBeGreaterThan(1);
      }
    });

    it("places a crowded group of sixty without two shards on one spot, the same twice", () => {
      const ids = Array.from({ length: 60 }, (_, i) => `N:${String(i).padStart(2, "0")}`);
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 61, ids)] };
      const hood = layoutHood(input);
      expect(layoutHood(input)).toEqual(hood);
      const pts = hood.things.filter((t) => t.parent !== null);
      expect(pts).toHaveLength(60);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThan(1);
      }
      expect(numbers(hood).every(Number.isFinite)).toBe(true);
    });

    it("places forty groups at forty different angles", () => {
      const groups = Array.from({ length: 40 }, (_, i) => group(`e${String(i).padStart(2, "0")}`, "out", 1, [`N:${i}`]));
      const hood = layoutHood({ centre: thing("Item:c"), groups });
      expect(new Set(hood.groups.map((g) => angleOf(g.labelAt).toFixed(3))).size).toBe(40);
      expect(hood.groups.map((g) => g.edge)).toEqual(groups.map((g) => g.edge));
    });

    it("draws a thing linked to itself once, and keeps the centre at the origin", () => {
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("self", "out", 1, ["Item:c"]), group("self", "in", 1, ["Item:c"])] });
      expect(hood.things).toHaveLength(1);
      expect(hood.things[0]).toMatchObject({ id: "Item:c", x: 0, y: 0, parent: null });
      expect(numbers(hood).every(Number.isFinite)).toBe(true);
    });

    it("draws a neighbour in two groups of the same edge type once", () => {
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("knows", "out", 1, ["P:1"]), group("knows", "in", 1, ["P:1"]), group("likes", "out", 1, ["P:1"])] });
      expect(hood.things.filter((t) => t.id === "P:1")).toHaveLength(1);
      expect(hood.links).toContainEqual({ from: "Item:c", to: "P:1", edge: "knows" });
      expect(hood.links).toContainEqual({ from: "P:1", to: "Item:c", edge: "knows" });
      expect(hood.links).toContainEqual({ from: "Item:c", to: "P:1", edge: "likes" });
      expect(hood.links).toHaveLength(3);
    });

    it("leaves a lone centre when no edge type is shown", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 2, ["N:1", "N:2"]), group("b", "in", 1, ["M:1"])] };
      const hood = layoutHood(input, [], { shows: () => false });
      expect(hood.things.map((t) => t.id)).toEqual(["Item:c"]);
      expect(hood.groups).toEqual([]);
      expect(hood.links).toEqual([]);
    });

    it("asks only the edge type's name which types to show", () => {
      const asked: unknown[][] = [];
      layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 1, ["N:1"])] }, [], {
        shows: (...args: unknown[]) => {
          asked.push(args);
          return true;
        },
      });
      expect(asked.length).toBeGreaterThan(0);
      for (const a of asked) expect(a[0]).toBe("a");
    });

    it("leaves out every group but keeps nothing hanging when all its neighbours are hidden", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 2, ["N:1", "N:2"])] };
      const hood = layoutHood(input, [], { hidden: new Set(["N:1", "N:2"]) });
      expect(hood.things.map((t) => t.id)).toEqual(["Item:c"]);
      expect(hood.links).toEqual([]);
      expect(numbers(hood).every(Number.isFinite)).toBe(true);
    });

    it("draws no link to a hidden thing, in either direction, nor to what hangs from it", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 1, ["N:1"]), group("b", "in", 1, ["N:1"])] };
      const n1: HoodInput = { centre: thing("N:1"), groups: [group("by", "out", 1, ["P:1"])] };
      const hood = layoutHood(input, [n1], { hidden: new Set(["N:1"]) });
      expect(hood.links).toEqual([]);
      expect(hood.things.map((t) => t.id)).toEqual(["Item:c"]);
    });

    it("ignores an expanded input for the centre itself and the same picture comes out", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 2, ["N:1", "N:2"])] };
      expect(layoutHood(input, [input])).toEqual(layoutHood(input));
    });

    it("draws a thing reached from two expanded things once, at the first place it appears", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 2, ["N:1", "N:2"])] };
      const n1: HoodInput = { centre: thing("N:1"), groups: [group("by", "out", 1, ["P:1"])] };
      const n2: HoodInput = { centre: thing("N:2"), groups: [group("by", "out", 1, ["P:1"])] };
      const hood = layoutHood(input, [n1, n2]);
      expect(hood.things.filter((t) => t.id === "P:1")).toHaveLength(1);
      expect(hood.things.find((t) => t.id === "P:1")!.parent).toBe("N:1");
      expect(hood.links).toContainEqual({ from: "N:1", to: "P:1", edge: "by" });
      expect(hood.links).toContainEqual({ from: "N:2", to: "P:1", edge: "by" });
    });

    it("is the same picture for every order of a chain of four expanded things", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 1, ["L:1"])] };
      const chain = ["L:1", "L:2", "L:3", "L:4"].map((id, i): HoodInput => ({ centre: thing(id), groups: [group("next", "out", 1, [`L:${i + 2}`])] }));
      const want = layoutHood(input, chain);
      expect(want.things.map((t) => t.id).sort(byBytes)).toEqual(["Item:c", "L:1", "L:2", "L:3", "L:4", "L:5"]);
      const orders = [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 3, 2, 1]];
      for (const o of orders) expect(layoutHood(input, o.map((i) => chain[i]!))).toEqual(want);
    });

    it("opens an expanded thing's groups away from its parent, whichever side of the centre it is on", () => {
      const names = Array.from({ length: 6 }, (_, i) => `N:${i}`);
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 6, names)] };
      for (const n of names) {
        const expanded: HoodInput = { centre: thing(n), groups: [group("by", "out", 2, [`P:${n}:1`, `P:${n}:2`])] };
        const hood = layoutHood(input, [expanded]);
        const at = hood.things.find((t) => t.id === n)!;
        for (const p of hood.things.filter((t) => t.parent === n)) {
          expect(Math.hypot(p.x, p.y)).toBeGreaterThan(Math.hypot(at.x, at.y));
        }
      }
    });

    it("does not write to its input", () => {
      const input = freeze<HoodInput>({ centre: thing("Item:c"), groups: [group("b", "in", 3, ["N:1"]), group("a", "out", 1, ["N:2"])] });
      const expanded = freeze<HoodInput>({ centre: thing("N:1"), groups: [group("by", "out", 1, ["P:1"])] });
      expect(() => layoutHood(input, freeze([expanded]), { hidden: freeze(new Set(["Z"])) })).not.toThrow();
      expect(input.groups.map((g) => g.edge)).toEqual(["b", "a"]);
    });

    it("rounds every coordinate to hundredths", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 30, Array.from({ length: 11 }, (_, i) => `N:${i}`)), group("b", "in", 3, ["M:1", "M:2", "M:3"])] };
      const expanded: HoodInput = { centre: thing("N:3"), groups: [group("by", "out", 4, ["P:1", "P:2", "P:3", "P:4"])] };
      const hood = layoutHood(input, [expanded]);
      for (const x of numbers(hood)) expect(Math.round(x * 100) / 100).toBe(x);
    });

    it("is the same picture under any clock", () => {
      const input: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 3, ["N:1", "N:2"])] };
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
        const early = layoutHood(input);
        vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
        expect(layoutHood(input)).toEqual(early);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not move a neighbour when the thing's label or type differ, only its place in the groups matters", () => {
      const a: HoodInput = { centre: thing("Item:c"), groups: [group("a", "out", 2, ["N:1", "N:2"])] };
      const b: HoodInput = {
        centre: { id: "Item:c", label: null, type: null },
        groups: [{ edge: "a", direction: "out", count: 2, shown: [{ id: "N:1", label: null, type: null }, { id: "N:2", label: "other", type: "Other" }] }],
      };
      const place = (h: ReturnType<typeof layoutHood>) => h.things.map((t) => [t.id, t.x, t.y]);
      expect(place(layoutHood(b))).toEqual(place(layoutHood(a)));
    });

    it("keeps every neighbour of a lone group on the ring", () => {
      const hood = layoutHood({ centre: thing("Item:c"), groups: [group("a", "out", 3, ["N:1", "N:2", "N:3"])] });
      for (const t of hood.things.filter((x) => x.parent !== null)) expect(Math.hypot(t.x, t.y)).toBeCloseTo(RING, 0);
    });
  });

  /** Signed area of a polygon: positive when it turns clockwise on a y-down screen. */
  function area(points: readonly { x: number; y: number }[]): number {
    let a = 0;
    points.forEach((p, j) => {
      const q = points[(j + 1) % points.length]!;
      a += p.x * q.y - q.x * p.y;
    });
    return a / 2;
  }

  describe("a neighbourhood of a busy thing stays responsive (G-10)", () => {
    it("places twelve hundred shown neighbours in good time", () => {
      const ids = Array.from({ length: 1200 }, (_, i) => `Title:${String(i).padStart(5, "0")}`);
      const input: HoodInput = { centre: thing("Country:x"), groups: [group("made_in", "in", 5000, ids)] };
      const started = performance.now();
      const hood = layoutHood(input);
      const took = performance.now() - started;
      expect(hood.things).toHaveLength(1201);
      expect(hood.groups[0]!.bundle!.count).toBe(3800);
      expect(took).toBeLessThan(5000);
    });
  });

  describe("graph layout: further cases", () => {
    const TWO_PI = 2 * Math.PI;

    type P = { x: number; y: number };

    /** True when the segments ab and cd cross at a point inside both (touching ends do not count). */
    function crosses(a: P, b: P, c: P, d: P): boolean {
      const o = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const d1 = o(a, b, c);
      const d2 = o(a, b, d);
      const d3 = o(c, d, a);
      const d4 = o(c, d, b);
      return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
    }

    function inside(p: P, poly: readonly P[]): boolean {
      let in_ = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) in_ = !in_;
      }
      return in_;
    }

    function box(poly: readonly P[]) {
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }

    function area(poly: readonly P[]): number {
      let s = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        s += a.x * b.y - b.x * a.y;
      }
      return s / 2;
    }

    function overlaps(shards: readonly { id: string; points: readonly P[]; centre: P }[]): string[] {
      const boxes = shards.map((s) => box(s.points));
      const found: string[] = [];
      for (let i = 0; i < shards.length; i++) {
        for (let j = i + 1; j < shards.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
          const p = shards[i]!.points;
          const q = shards[j]!.points;
          let hit = false;
          for (let m = 0; m < p.length && !hit; m++) {
            for (let n = 0; n < q.length && !hit; n++) {
              if (crosses(p[m]!, p[(m + 1) % p.length]!, q[n]!, q[(n + 1) % q.length]!)) hit = true;
            }
          }
          if (!hit && (inside(shards[i]!.centre, q) || inside(shards[j]!.centre, p))) hit = true;
          if (hit) found.push(`${shards[i]!.id} / ${shards[j]!.id}`);
        }
      }
      return found;
    }

    const ids = (type: string, n: number) => Array.from({ length: n }, (_, i) => `${type}:${String(i).padStart(5, "0")}`);

    const thing = (id: string) => ({ id, label: id.slice(id.indexOf(":") + 1), type: id.slice(0, id.indexOf(":")) });
    const group = (edge: string, direction: "out" | "in", count: number, ids: string[]): HoodGroup => ({ edge, direction, count, shown: ids.map(thing) });
    const key = (l: PlacedLink) => `${l.from} -${l.edge}-> ${l.to}`;
    const keys = (links: readonly PlacedLink[]) => links.map(key).sort();
    /** A layout with its lists in a fixed order, so only what is drawn and where is compared. */
    const normal = (h: ReturnType<typeof layoutHood>) => ({
      things: [...h.things].sort((x, y) => (x.id < y.id ? -1 : 1)),
      groups: [...h.groups].sort((x, y) => `${x.owner} ${x.edge} ${x.direction}`.localeCompare(`${y.owner} ${y.edge} ${y.direction}`)),
      links: keys(h.links),
    });

    describe("an expanded thing's links to where it hangs (G-3, G-5, G-7)", () => {
      it("draws a link each way when both run by the same edge type, once each", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 1, ["P:n"]), group("knows", "in", 1, ["P:n"])] };
        const n: HoodInput = { centre: thing("P:n"), groups: [group("knows", "in", 1, ["P:c"]), group("knows", "out", 1, ["P:c"])] };
        const hood = layoutHood(centre, [n]);
        expect(keys(hood.links)).toEqual(["P:c -knows-> P:n", "P:n -knows-> P:c"]);
      });

      it("draws three links of three edge types between a thing and where it hangs, whatever the order of its groups", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("a", "out", 1, ["P:n"])] };
        const groups = [
          group("a", "in", 1, ["P:c"]),
          group("b", "out", 1, ["P:c"]),
          group("c", "in", 1, ["P:c"]),
          group("c", "out", 1, ["P:c"]),
        ];
        const want = ["P:c -a-> P:n", "P:c -c-> P:n", "P:n -b-> P:c", "P:n -c-> P:c"];
        const one = layoutHood(centre, [{ centre: thing("P:n"), groups }]);
        expect(keys(one.links)).toEqual(want);
        const other = layoutHood(centre, [{ centre: thing("P:n"), groups: [...groups].reverse() }]);
        expect(other).toEqual(one);
      });

      it("draws every link back to an expanded thing's own parent when that parent is itself expanded", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 1, ["P:n"])] };
        const n: HoodInput = { centre: thing("P:n"), groups: [group("knows", "in", 1, ["P:c"]), group("owns", "out", 1, ["P:m"])] };
        const m: HoodInput = {
          centre: thing("P:m"),
          groups: [group("owns", "in", 1, ["P:n"]), group("likes", "out", 1, ["P:n"]), group("rates", "in", 1, ["P:n"])],
        };
        const hood = layoutHood(centre, [n, m]);
        expect(keys(hood.links)).toEqual(["P:c -knows-> P:n", "P:m -likes-> P:n", "P:n -owns-> P:m", "P:n -rates-> P:m"]);
        expect(layoutHood(centre, [m, n])).toEqual(hood);
      });

      it("draws a link between two expanded neighbours of the centre once, though both list it", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 2, ["P:a", "P:b"])] };
        const a: HoodInput = { centre: thing("P:a"), groups: [group("knows", "in", 1, ["P:c"]), group("likes", "out", 1, ["P:b"])] };
        const b: HoodInput = { centre: thing("P:b"), groups: [group("knows", "in", 1, ["P:c"]), group("likes", "in", 1, ["P:a"])] };
        const hood = layoutHood(centre, [a, b]);
        expect(keys(hood.links)).toEqual(["P:a -likes-> P:b", "P:c -knows-> P:a", "P:c -knows-> P:b"]);
        // The order expanded things are given in may change which group counts a shared thing as drawn
        // ("where it first appears"), but never what is drawn or the links.
        const swapped = layoutHood(centre, [b, a]);
        expect(normal(swapped).things).toEqual(normal(hood).things);
        expect(normal(swapped).links).toEqual(normal(hood).links);
      });

      it("draws the links of an expanded thing to a neighbour already drawn elsewhere, without drawing that neighbour twice", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("tag", "out", 2, ["T:x", "T:y"]), group("knows", "out", 1, ["P:n"])] };
        const n: HoodInput = { centre: thing("P:n"), groups: [group("knows", "in", 1, ["P:c"]), group("tag", "out", 1, ["T:x"]), group("flag", "out", 1, ["T:x"])] };
        const hood = layoutHood(centre, [n]);
        expect(hood.things.filter((t) => t.id === "T:x")).toHaveLength(1);
        expect(keys(hood.links)).toEqual(["P:c -knows-> P:n", "P:c -tag-> T:x", "P:c -tag-> T:y", "P:n -flag-> T:x", "P:n -tag-> T:x"]);
      });

      it("draws only the links to the parent whose edge type is shown", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 1, ["P:n"])] };
        const n: HoodInput = { centre: thing("P:n"), groups: [group("knows", "in", 1, ["P:c"]), group("likes", "out", 1, ["P:c"]), group("hates", "out", 1, ["P:c"])] };
        const hood = layoutHood(centre, [n], { shows: (e) => e !== "likes" });
        expect(keys(hood.links)).toEqual(["P:c -knows-> P:n", "P:n -hates-> P:c"]);
      });

      it("draws no link to a hidden parent, and nothing of a thing that hangs from it", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 1, ["P:n"])] };
        const n: HoodInput = { centre: thing("P:n"), groups: [group("likes", "out", 1, ["P:c"])] };
        const hood = layoutHood(centre, [n], { hidden: new Set(["P:n"]) });
        expect(hood.things.map((t) => t.id)).toEqual(["P:c"]);
        expect(hood.links).toEqual([]);
      });

      it("never repeats a link, over every mix of mirrored and extra groups on two expanded things", () => {
        // Needs G-3, G-5: "every link drawn", each once. Every subset of five groups on each of two things.
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("e1", "out", 2, ["P:a", "P:b"])] };
        const offers = (self: string, other: string): HoodGroup[] => [
          group("e1", "in", 1, ["P:c"]),
          group("e2", "out", 1, ["P:c"]),
          group("e2", "in", 1, [other]),
          group("e3", "out", 1, [other]),
          group("e3", "in", 1, ["P:c"]),
        ].filter((g) => g.shown[0]!.id !== self);
        const a = offers("P:a", "P:b");
        const b = offers("P:b", "P:a");
        for (let mask = 0; mask < 1 << 10; mask++) {
          const ga = a.filter((_, i) => mask & (1 << i));
          const gb = b.filter((_, i) => mask & (1 << (i + 5)));
          const hood = layoutHood(centre, [
            { centre: thing("P:a"), groups: ga },
            { centre: thing("P:b"), groups: gb },
          ]);
          const all = keys(hood.links);
          expect(new Set(all).size, `mask ${mask}: ${all.join("; ")}`).toBe(all.length);
          // Every link a group states is drawn: the group's owner against each neighbour it shows.
          const want = new Set<string>(["P:c -e1-> P:a", "P:c -e1-> P:b"]);
          for (const [owner, groups] of [["P:a", ga], ["P:b", gb]] as const) {
            for (const g of groups) {
              for (const t of g.shown) want.add(g.direction === "out" ? `${owner} -${g.edge}-> ${t.id}` : `${t.id} -${g.edge}-> ${owner}`);
            }
          }
          expect(all, `mask ${mask}`).toEqual([...want].sort());
        }
      });

      it("draws a link from a thing to itself once, though the kit lists it in both its out and in groups (centre)", () => {
        const hood = layoutHood({ centre: thing("P:c"), groups: [group("self", "out", 1, ["P:c"]), group("self", "in", 1, ["P:c"])] });
        expect(keys(hood.links)).toEqual(["P:c -self-> P:c"]);
      });

      it("draws a thing's link to itself once when it is expanded", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 1, ["P:n"])] };
        const n: HoodInput = { centre: thing("P:n"), groups: [group("self", "out", 1, ["P:n"]), group("self", "in", 1, ["P:n"])] };
        const hood = layoutHood(centre, [n]);
        expect(hood.links.filter((l) => l.from === "P:n" && l.to === "P:n")).toHaveLength(1);
        expect(hood.things.filter((t) => t.id === "P:n")).toHaveLength(1);
      });

      it("is the same picture twice, and an extra link to the parent adds that link to the others", () => {
        const centre: HoodInput = { centre: thing("P:c"), groups: [group("knows", "out", 1, ["P:n"])] };
        const plain: HoodInput = { centre: thing("P:n"), groups: [group("knows", "in", 1, ["P:c"]), group("by", "out", 1, ["P:z"])] };
        const more: HoodInput = { centre: thing("P:n"), groups: [...plain.groups, group("likes", "out", 1, ["P:c"])] };
        expect(layoutHood(centre, [more])).toEqual(layoutHood(centre, [more]));
        const a = layoutHood(centre, [plain]);
        const b = layoutHood(centre, [more]);
        expect(b.things.map((t) => t.id)).toEqual(a.things.map((t) => t.id));
        expect(keys(b.links)).toEqual([...keys(a.links), "P:n -likes-> P:c"].sort());
      });
    });
  });
});
