// The map's screen helpers (needs G-1, G-2, G-10): counts written the same way on
// every machine, arrows as thick as their links, an edge type's table, and walks that run in the
// background a type at a time, put the type a person selects first, and stop when the view is
// left. Data is invented.
import { describe, expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { average, columns, cutTo, edgeTable, NAME_COLUMNS, noun, number, partialNote, placeNames, strokeWidth, typeTable, walksFor, type Rect } from "../src/lib/graph/mapview.js";
import { talliesFor, Walker } from "../src/lib/graph/session.js";
import { Tallies } from "../src/lib/graph/tally.js";

describe("numbers on the map", () => {
  it("are written with a comma between thousands, whatever the machine's language", () => {
    expect(number(0)).toBe("0");
    expect(number(999)).toBe("999");
    expect(number(8807)).toBe("8,807");
    expect(number(64124)).toBe("64,124");
    expect(number(1234567)).toBe("1,234,567");
  });

  it("take the singular for exactly one, and the plural for none, many or a count not yet whole", () => {
    expect(noun(1, "thing", "things")).toBe("thing");
    expect(noun(0, "thing", "things")).toBe("things");
    expect(noun(2, "thing", "things")).toBe("things");
    expect(noun(null, "link", "links")).toBe("links");
    expect(noun(1, "link", "links", true)).toBe("links");
  });

  it("give averages to one decimal, without a needless .0, and never write a few links as none", () => {
    expect(average(7.281)).toBe("7.3");
    expect(average(1)).toBe("1");
    expect(average(0.04)).toBe("under 0.1");
    expect(average(0)).toBe("0");
    expect(average(0.79)).toBe("0.8");
  });
});

describe("arrows (G-1: sizes follow the counts)", () => {
  it("grow with their links, from a thin line to a set width, the thickest for the most", () => {
    expect(strokeWidth(0, 100)).toBe(1);
    expect(strokeWidth(100, 100)).toBe(6);
    expect(strokeWidth(25, 100)).toBeCloseTo(3.5, 5);
    expect(strokeWidth(null, 100)).toBe(1);
    expect(strokeWidth(5, 0)).toBe(1);
  });
});

describe("an arrow's name (G-1: every edge type drawn with its count, readable)", () => {
  const box = { width: 800, height: 560 };
  const arrow = (sx: number, sy: number, ex: number, ey: number, name = "edge", count = "1") => {
    const middle = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
    return { start: { x: sx, y: sy }, end: { x: ex, y: ey }, control: middle, name, count };
  };
  const clash = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it("counts columns: wide characters take two, joining marks none", () => {
    expect(columns("abc")).toBe(3);
    expect(columns("漢字")).toBe(4);
    expect(columns("ＡＢ")).toBe(4);
    expect(columns("🎬")).toBe(2);
    expect(columns("é")).toBe(1);
    expect(columns("👍🏽")).toBe(2);
  });

  it("cuts a long name to its columns, ending in …, and leaves a short one whole", () => {
    expect(cutTo("short", 10)).toBe("short");
    expect(cutTo("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
    expect(columns(cutTo("漢".repeat(50), 10))).toBeLessThanOrEqual(10);
  });

  it("sits in the middle of its arrow with its count, on a box as wide as its text", () => {
    const [at] = placeNames([arrow(200, 200, 600, 200, "points_at", "30")], box, []);
    expect(at!.text).toBe("points_at · 30");
    expect(at!.x).toBe(400);
    expect(at!.back.width).toBeGreaterThanOrEqual(columns("points_at · 30") * 7);
    expect(at!.back.y).toBeLessThan(200);
    expect(at!.back.y + at!.back.height).toBeGreaterThan(200);
  });

  it("holds a box of wide characters' width", () => {
    const [at] = placeNames([arrow(200, 200, 600, 200, "漢字漢字漢字漢字漢字", "1")], box, []);
    expect(at!.back.width).toBeGreaterThanOrEqual(24 * 7);
  });

  it("cuts a very long name, never the count, and keeps the box inside the map", () => {
    const [at] = placeNames([arrow(700, 100, 790, 100, "x".repeat(300), "1,234")], box, []);
    expect(at!.text.endsWith("… · 1,234")).toBe(true);
    expect(columns(at!.text)).toBeLessThanOrEqual(NAME_COLUMNS + 8);
    expect(at!.back.x).toBeGreaterThanOrEqual(0);
    expect(at!.back.x + at!.back.width).toBeLessThanOrEqual(800);
  });

  it("keeps names apart when arrows cross at their middles, and clear of what it is told to", () => {
    const names = placeNames([arrow(200, 100, 600, 500, "one"), arrow(200, 500, 600, 100, "two"), arrow(100, 300, 700, 300, "three")], box, []);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expect(clash(names[i]!.back, names[j]!.back)).toBe(false);
    const shard = { x: 360, y: 280, width: 80, height: 40 };
    const [clear] = placeNames([arrow(100, 300, 700, 300, "four")], box, [shard]);
    expect(clear!.back.x >= 440 || clear!.back.x + clear!.back.width <= 360 || clear!.back.y >= 320 || clear!.back.y + clear!.back.height <= 280).toBe(true);
  });

  it("does not move while its count grows", () => {
    const first = placeNames([arrow(200, 200, 600, 200, "points_at", "…"), arrow(200, 220, 600, 220, "tagged", "…")], box, []);
    const later = placeNames([arrow(200, 200, 600, 200, "points_at", "12,345"), arrow(200, 220, 600, 220, "tagged", "8…")], box, []);
    expect(later.map((n) => [n.x, n.y])).toEqual(first.map((n) => [n.x, n.y]));
  });
});

describe("tables to open (G-2)", () => {
  it("a type opens its own table", () => {
    expect(typeTable("Title")).toEqual({ type: "Title", page: 1, order: null, where: [] });
  });

  it("an edge type opens the table of the type it leaves, or none when it may leave any type", () => {
    expect(edgeTable({ name: "features", from: "Title", to: "Person" })).toEqual({ type: "Title", page: 1, order: null, where: [] });
    expect(edgeTable({ name: "loose", from: null, to: "Person" })).toBeNull();
  });
});

describe("a selection (G-2, G-10)", () => {
  const edges = [
    { name: "features", from: "Title", to: "Person" },
    { name: "knows", from: "Person", to: "Person" },
    { name: "loose", from: null, to: "Person" },
  ];

  it("puts first the walk of a type, or of the type an edge type leaves and then the one it reaches", () => {
    expect(walksFor({ kind: "type", name: "Title" }, edges)).toEqual(["Title"]);
    expect(walksFor({ kind: "edge", name: "features" }, edges)).toEqual(["Title", "Person"]);
    expect(walksFor({ kind: "edge", name: "knows" }, edges)).toEqual(["Person"]);
    expect(walksFor({ kind: "edge", name: "loose" }, edges)).toEqual(["Person"]);
    expect(walksFor({ kind: "edge", name: "missing" }, edges)).toEqual([]);
  });

  it("says which type's things are still being counted for its most linked things", () => {
    expect(partialNote({ partial: false, counted: 5, total: 5 }, "Person")).toBeNull();
    expect(partialNote({ partial: true, counted: 0, total: null }, "Person")).toBe("The things of Person are waiting to be counted.");
    expect(partialNote({ partial: true, counted: 40, total: 1234 }, "Person")).toBe("So far: 40 of 1,234 things of Person counted.");
    expect(partialNote({ partial: true, counted: 0, total: 1 }, "Person")).toBe("So far: 0 of 1 thing of Person counted.");
  });
});

function star() {
  const spokes = Array.from({ length: 45 }, (_, i) => `s${String(i).padStart(2, "0")}`);
  return buildMosaic({
    typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}' },
    edgeTypes: [["points_at", "Spoke", "Hub"]],
    nodes: [{ type: "Hub", key: "h", label: "Hub" }, ...spokes.map((k) => ({ type: "Spoke", key: k, label: k }))],
    edges: spokes.map((k) => ({ type: "points_at", from: `Spoke:${k}`, to: "Hub:h" })),
  });
}

const now = () => Promise.resolve();

describe("walks in the background (G-10)", () => {
  it("are kept for the session, one set per open mosaic", async () => {
    const a = await openMosaic(star(), "a.mosaic");
    const b = await openMosaic(star(), "b.mosaic");
    expect(talliesFor(a)).toBe(talliesFor(a));
    expect(talliesFor(a)).not.toBe(talliesFor(b));
  });

  it("walk the types asked for, in turn, telling after each page", async () => {
    const file = await openMosaic(star(), "star.mosaic");
    const tallies = new Tallies(file);
    const seen: string[] = [];
    const walker = new Walker(tallies, (t) => seen.push(`${t.type} ${t.counted}`), now);
    walker.want(["Spoke", "Hub"]);
    await walker.idle();
    expect(seen).toEqual(["Spoke 20", "Spoke 40", "Spoke 45", "Hub 1"]);
    expect(tallies.peek("Spoke")!.done && tallies.peek("Hub")!.done).toBe(true);
  });

  it("put a type a person selects first, and go back to the rest after it", async () => {
    const file = await openMosaic(star(), "star.mosaic");
    const tallies = new Tallies(file);
    const seen: string[] = [];
    let walker: Walker;
    walker = new Walker(tallies, (t) => {
      seen.push(`${t.type} ${t.counted}`);
      if (t.type === "Spoke" && t.counted === 20) walker.want(["Hub"], true);
    }, now);
    walker.want(["Spoke"]);
    await walker.idle();
    expect(seen).toEqual(["Spoke 20", "Hub 1", "Spoke 40", "Spoke 45"]);
  });

  it("stop when the view is left, and a type walked once is not walked again", async () => {
    const file = await openMosaic(star(), "star.mosaic");
    const tallies = new Tallies(file);
    const seen: string[] = [];
    let walker: Walker;
    walker = new Walker(tallies, (t) => {
      seen.push(`${t.type} ${t.counted}`);
      walker.stop();
    }, now);
    walker.want(["Spoke"]);
    await walker.idle();
    expect(seen).toEqual(["Spoke 20"]);
    // Back on the view: the walk goes on where it stopped.
    const again = new Walker(tallies, (t) => seen.push(`${t.type} ${t.counted}`), now);
    again.want(["Spoke"]);
    await again.idle();
    expect(seen).toEqual(["Spoke 20", "Spoke 40", "Spoke 45"]);
    again.want(["Spoke"]);
    await again.idle();
    expect(seen).toHaveLength(3);
  });
});

describe("numbers on the map (G-1)", () => {
  it("put a comma at every thousand, up to billions, and leave small numbers whole", () => {
    expect(number(1000)).toBe("1,000");
    expect(number(10000)).toBe("10,000");
    expect(number(100000)).toBe("100,000");
    expect(number(999999)).toBe("999,999");
    expect(number(1000000000)).toBe("1,000,000,000");
    expect(number(1)).toBe("1");
    expect(number(10)).toBe("10");
    expect(number(100)).toBe("100");
  });

  it("write the same number the same way every time (G-7)", () => {
    for (const n of [0, 7, 8807, 64124, 1234567]) expect(number(n)).toBe(number(n));
  });
});

describe("averages on the map (G-2: links per thing on average)", () => {
  it("write whole averages without a decimal point, at any size", () => {
    expect(average(0)).toBe("0");
    expect(average(2)).toBe("2");
    expect(average(10)).toBe("10");
    expect(average(100)).toBe("100");
  });

  it("round to one decimal, and drop the .0 a rounding up leaves", () => {
    expect(average(12.34)).toBe("12.3");
    expect(average(1.96)).toBe("2");
    expect(average(0.31)).toBe("0.3");
    expect(average(0.96)).toBe("1");
  });
});

describe("arrow widths (G-1: sizes follow the counts)", () => {
  it("never shrink as links grow, and stay between the thinnest and the thickest", () => {
    let last = 0;
    for (let links = 0; links <= 1000; links += 7) {
      const w = strokeWidth(links, 1000);
      expect(w).toBeGreaterThanOrEqual(last);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(6);
      expect(Number.isFinite(w)).toBe(true);
      last = w;
    }
  });

  it("give the same width to the same count, and a wider one to a larger count", () => {
    expect(strokeWidth(40, 400)).toBe(strokeWidth(40, 400));
    expect(strokeWidth(41, 400)).toBeGreaterThan(strokeWidth(40, 400));
  });

  it("keep a single link visible next to a huge edge type, and the only edge type thickest", () => {
    expect(strokeWidth(1, 10_000_000)).toBeGreaterThanOrEqual(1);
    expect(strokeWidth(1, 10_000_000)).toBeLessThan(2);
    expect(strokeWidth(1, 1)).toBe(6);
  });

  it("do not depend on the unit: ten times the links against ten times the most gives the same width", () => {
    expect(strokeWidth(30, 300)).toBeCloseTo(strokeWidth(3, 30), 9);
  });
});

describe("tables to open (G-2)", () => {
  it("hand out a table route nobody else shares, so changing one does not change the next", () => {
    const a = typeTable("Title");
    a.where.push({ column: "x", op: "=", value: "y" } as never);
    a.page = 9;
    expect(typeTable("Title")).toEqual({ type: "Title", page: 1, order: null, where: [] });
    const first = edgeTable({ name: "e", from: "Title", to: "Person" })!;
    first.where.push({ column: "x", op: "=", value: "y" } as never);
    expect(edgeTable({ name: "e", from: "Title", to: "Person" })!.where).toEqual([]);
  });

  it("opens, for an edge type that leaves and reaches the same type, that type's table", () => {
    expect(edgeTable({ name: "knows", from: "Person", to: "Person" })).toEqual({
      type: "Person",
      page: 1,
      order: null,
      where: [],
    });
  });

  it("gives an edge type whose two ends are unset no table", () => {
    expect(edgeTable({ name: "loose", from: null, to: null })).toBeNull();
  });

  it("keeps a type name as given, whatever it holds", () => {
    expect(typeTable("Zeta9").type).toBe("Zeta9");
    expect(typeTable("").type).toBe("");
  });
});

function pile(n: number) {
  const keys = Array.from({ length: n }, (_, i) => `s${String(i).padStart(4, "0")}`);
  return buildMosaic({
    typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}', Empty: '{"name":"text"}' },
    types: ["Empty"],
    edgeTypes: [["points_at", "Spoke", "Hub"]],
    nodes: [{ type: "Hub", key: "h", label: "Hub" }, ...keys.map((k) => ({ type: "Spoke", key: k, label: k }))],
    edges: keys.map((k) => ({ type: "points_at", from: `Spoke:${k}`, to: "Hub:h" })),
  });
}

describe("walks in the background (G-10)", () => {
  it("asked for nothing, do nothing and finish", async () => {
    const file = await openMosaic(pile(25), "p.mosaic");
    const tallies = new Tallies(file);
    const seen: string[] = [];
    const walker = new Walker(tallies, (t) => seen.push(t.type), now);
    walker.want([]);
    await walker.idle();
    expect(seen).toEqual([]);
  });

  it("walk a type listed twice once", async () => {
    const file = await openMosaic(pile(25), "p.mosaic");
    const tallies = new Tallies(file);
    const seen: string[] = [];
    const walker = new Walker(tallies, (t) => seen.push(`${t.type} ${t.counted}`), now);
    walker.want(["Spoke", "Spoke"]);
    await walker.idle();
    expect(seen).toEqual(["Spoke 20", "Spoke 25"]);
  });

  it("finish a type that holds no things", async () => {
    const file = await openMosaic(pile(25), "p.mosaic");
    const tallies = new Tallies(file);
    const walker = new Walker(tallies, () => undefined, now);
    walker.want(["Empty"]);
    await walker.idle();
    expect(tallies.peek("Empty")!.done).toBe(true);
    expect(tallies.peek("Empty")!.counted).toBe(0);
  });

  it("count a type's things exactly, however many pages it takes", async () => {
    const file = await openMosaic(pile(61), "p.mosaic");
    const tallies = new Tallies(file);
    const walker = new Walker(tallies, () => undefined, now);
    walker.want(["Spoke"]);
    await walker.idle();
    const tally = tallies.peek("Spoke")!;
    expect(tally.done).toBe(true);
    expect(tally.counted).toBe(61);
  });

  it("give the same counts whatever order the types are walked in (G-7)", async () => {
    const run = async (order: string[]) => {
      const file = await openMosaic(pile(45), "p.mosaic");
      const tallies = new Tallies(file);
      const walker = new Walker(tallies, () => undefined, now);
      walker.want(order);
      await walker.idle();
      return order.slice().sort().map((t) => JSON.stringify(tallies.peek(t)));
    };
    expect(await run(["Spoke", "Hub"])).toEqual(await run(["Hub", "Spoke"]));
  });

  it("are shared by every screen that opens the same mosaic: counts walked once are there when asked again", async () => {
    const file = await openMosaic(pile(25), "p.mosaic");
    const first = new Walker(talliesFor(file), () => undefined, now);
    first.want(["Spoke"]);
    await first.idle();
    const seen: string[] = [];
    const second = new Walker(talliesFor(file), (t) => seen.push(t.type), now);
    second.want(["Spoke"]);
    await second.idle();
    expect(seen).toEqual([]);
    expect(talliesFor(file).peek("Spoke")!.done).toBe(true);
  });
});
