// The overview's data (needs G-9, G-7, G-10): one shard per thing, in bands by type;
// a mosaic too big to draw whole draws a stated, deterministic sample and says so. Things are read
// through the kit's `table` (20 at a time, in id order), so a sample is whole pages of a type,
// spread evenly through it. Data is invented.
import { describe, expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { readOverview, sampleNote, samplePlan, SAMPLE_BUDGET } from "../src/lib/graph/overview.js";

const now = () => Promise.resolve();

describe("what the overview reads (G-9)", () => {
  it("reads every thing when the mosaic is small enough to draw whole", () => {
    const plan = samplePlan([
      { name: "A", count: 45 },
      { name: "B", count: 3 },
    ]);
    expect(plan.whole).toBe(true);
    expect(plan.types).toEqual([
      { type: "A", count: 45, pages: [1, 2, 3], totalPages: 3 },
      { type: "B", count: 3, pages: [1], totalPages: 1 },
    ]);
  });

  it("past the budget, reads a sample: whole pages spread evenly through each type, in proportion", () => {
    const plan = samplePlan([
      { name: "Big", count: 40_000 },
      { name: "Small", count: 30 },
    ]);
    expect(plan.whole).toBe(false);
    const big = plan.types.find((t) => t.type === "Big")!;
    expect(big.totalPages).toBe(2000);
    // About its share of the budget, in whole pages, the first page and then evenly spaced.
    expect(big.pages.length * 20).toBeLessThanOrEqual(SAMPLE_BUDGET);
    expect(big.pages.length * 20).toBeGreaterThan(SAMPLE_BUDGET * 0.9);
    expect(big.pages[0]).toBe(1);
    const gaps = big.pages.slice(1).map((p, i) => p - big.pages[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(big.pages.at(-1)!).toBeLessThanOrEqual(2000);
    // A small type still gets a page, so it has a band one can see; the sample stays in the budget.
    expect(plan.types.find((t) => t.type === "Small")).toEqual({ type: "Small", count: 30, pages: [1], totalPages: 2 });
    expect(plan.types.reduce((s, t) => s + t.pages.length, 0)).toBeLessThanOrEqual(SAMPLE_BUDGET / 20);
  });

  it("gives every type a page when there are no more types than pages", () => {
    const plan = samplePlan([{ name: "Big", count: 100_000 }, ...Array.from({ length: 40 }, (_, i) => ({ name: `S${i}`, count: 3 }))]);
    expect(plan.types.every((t) => t.pages.length > 0)).toBe(true);
    expect(plan.types.find((t) => t.type === "Big")!.pages).toHaveLength(1 + 33);
  });

  it("never reads past the budget: with more types than pages, the smallest are left out", () => {
    // 200 types of 20 things, 4,000 things: a page each would be the whole mosaic.
    const plan = samplePlan(Array.from({ length: 200 }, (_, i) => ({ name: `T${String(i).padStart(3, "0")}`, count: 20 + (i % 3) })));
    expect(plan.whole).toBe(false);
    const read = plan.types.filter((t) => t.pages.length > 0);
    expect(read).toHaveLength(75);
    expect(read.every((t) => t.pages.length === 1)).toBe(true);
    // Largest first: all 66 types of 22 things, then the first 9 of 21 by name.
    expect(read.filter((t) => t.count === 22)).toHaveLength(66);
    expect(read.filter((t) => t.count === 21).map((t) => t.type)).toEqual(["T001", "T004", "T007", "T010", "T013", "T016", "T019", "T022", "T025"]);
  });

  it("leaves out types with no things, and lists types by name (UTF-8 bytes)", () => {
    const plan = samplePlan([
      { name: "b", count: 1 },
      { name: "B", count: 1 },
      { name: "Empty", count: 0 },
    ]);
    expect(plan.types.map((t) => t.type)).toEqual(["B", "b"]);
  });

  it("is the same plan every time (G-7)", () => {
    const types = [
      { name: "P", count: 40_948 },
      { name: "T", count: 8_807 },
      { name: "C", count: 122 },
    ];
    expect(samplePlan(types)).toEqual(samplePlan([...types].reverse()));
  });
});

describe("what the overview says it shows (G-9, G-10)", () => {
  it("says nothing more when it shows every thing", () => {
    expect(sampleNote({ whole: true, bands: [{ type: "A", count: 3, things: [{ id: "A:1", label: null }, { id: "A:2", label: null }, { id: "A:3", label: null }] }] })).toBeNull();
  });

  it("states a sample: how many of how many, and how they were chosen", () => {
    const note = sampleNote({
      whole: false,
      bands: [
        { type: "Big", count: 40_000, things: Array.from({ length: 1480 }, (_, i) => ({ id: `Big:${i}`, label: null })) },
        { type: "Small", count: 30, things: Array.from({ length: 20 }, (_, i) => ({ id: `Small:${i}`, label: null })) },
      ],
    });
    expect(note).toBe("A sample: 1,500 of 40,030 things. For each type, pages of 20 things spread evenly through it in id order, in proportion to its size.");
  });

  it("says how many types have no page in it, when there are more types than pages", () => {
    const band = (type: string, count: number, shown: number) => ({ type, count, things: Array.from({ length: shown }, (_, i) => ({ id: `${type}:${i}`, label: null })) });
    expect(sampleNote({ whole: false, bands: [band("A", 40, 20), band("B", 20, 0)] })).toBe(
      "A sample: 20 of 60 things. For each type, pages of 20 things spread evenly through it in id order, in proportion to its size. 1 smaller type has no page in it: there are more types than pages of the sample.",
    );
    expect(sampleNote({ whole: false, bands: [band("A", 40, 20), band("B", 20, 0), band("C", 20, 0)] })).toContain("2 smaller types have no page in it");
  });
});

describe("reading the things (G-10)", () => {
  function mosaic() {
    return buildMosaic({
      typeProps: { Big: '{"name":"text"}', Small: '{"name":"text"}' },
      edgeTypes: [],
      nodes: [
        ...Array.from({ length: 45 }, (_, i) => ({ type: "Big", key: `k${String(i).padStart(2, "0")}`, label: `Big ${i}` })),
        { type: "Small", key: "s", label: "Small one" },
      ],
      edges: [],
    });
  }

  it("reads the pages planned, in id order, with each thing's name, telling after each page", async () => {
    const file = await openMosaic(mosaic(), "o.mosaic");
    const plan = samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count })));
    const told: number[] = [];
    const data = await readOverview(file, plan, { onPage: (read) => told.push(read), pause: now });
    expect(told).toEqual([1, 2, 3, 4]);
    expect(data.whole).toBe(true);
    const big = data.bands.find((b) => b.type === "Big")!;
    expect(big.things).toHaveLength(45);
    expect(big.things[0]).toEqual({ id: "Big:k00", label: "Big 0" });
    expect(data.bands.find((b) => b.type === "Small")!.things).toEqual([{ id: "Small:s", label: "Small one" }]);
  });

  it("stops when asked, and says it did", async () => {
    const file = await openMosaic(mosaic(), "o.mosaic");
    const plan = samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count })));
    const stop = new AbortController();
    const read = readOverview(file, plan, { signal: stop.signal, onPage: () => stop.abort(), pause: now });
    await expect(read).rejects.toThrow(/stopped/);
  });
});
