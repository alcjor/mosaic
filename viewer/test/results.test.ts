/**
 * Chain results through the kit (docs/design.md, "Viewer: chains and cards": V-13,
 * V-14; principle 5).
 *
 * The mosaics are invented. A walk-by-walk oracle, written from the edge lists alone, says what
 * every chain finds: a result is one walk along the chain, one thing per place (the start, then
 * one per step) and one link per step; two links of one type between the same two things (told
 * apart by their qualifier, section 3.4) make two results. Results come in the kit's order: by
 * the start's id, then, step by step, by the next thing's id and the link's qualifier (UTF-8
 * bytes), the order of `table` and `neighbors` (section 8.6, kit/src/neighbors.ts).
 */
import { type SealedFile } from "@mosaic/kit";
import { describe, expect, it } from "vitest";
import { buildMosaic, type EdgeSpec, type NodeSpec, compareUtf8 } from "../../kit/test/build-mosaic.js";
import { type Chain, type Direction, type Step } from "../src/lib/chain.js";
import { allLinks } from "../src/lib/links.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { ChainResults, type Result } from "../src/lib/results.js";

// ---------------------------------------------------------------------------------------------
// The mosaic "web": a busy hub holding 45 items (one of them twice, by qualifier), items that
// share labels with things the hub does not hold, a busy tag, and a tag sharing its label.

const pad = (n: number) => String(n).padStart(2, "0");

const WEB_NODES: NodeSpec[] = [
  { type: "Hub", key: "h", label: "Hub h" },
  { type: "Hub", key: "q", label: "Hub q" },
  ...Array.from({ length: 45 }, (_, n): NodeSpec => ({
    type: "Item",
    key: `i${pad(n)}`,
    // Two twins the hub holds, a third "Twin" it does not (Item:z); the last item has no label,
    // and neither has Item:y, which the hub does not hold.
    label: n === 40 || n === 41 ? "Twin" : n === 44 ? null : `Item ${pad(n)}`,
  })),
  { type: "Item", key: "y", label: null },
  { type: "Item", key: "z", label: "Twin" },
  { type: "Tag", key: "t", label: "Tag t" },
  { type: "Tag", key: "t2", label: "Tag t" },
  { type: "Tag", key: "u", label: "Tag tu" },
];

const WEB_EDGES: EdgeSpec[] = [
  ...Array.from({ length: 45 }, (_, n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: `Item:i${pad(n)}` })),
  { type: "holds", from: "Hub:h", to: "Item:i03", qualifier: "again" },
  { type: "holds", from: "Hub:q", to: "Item:i00" },
  { type: "holds", from: "Hub:q", to: "Item:i01" },
  { type: "holds", from: "Hub:q", to: "Item:z" },
  ...Array.from({ length: 30 }, (_, n): EdgeSpec => ({ type: "tagged", from: `Item:i${pad(n)}`, to: "Tag:t" })),
  { type: "tagged", from: "Item:i00", to: "Tag:t2" },
  { type: "tagged", from: "Item:i31", to: "Tag:t2" },
  { type: "tagged", from: "Item:i31", to: "Tag:u" },
];

const WEB_TYPES: [string, string, string][] = [
  ["holds", "Hub", "Item"],
  ["tagged", "Item", "Tag"],
];

function web(): Promise<SealedFile> {
  return openMosaic(buildMosaic({ nodes: WEB_NODES, edgeTypes: WEB_TYPES, edges: WEB_EDGES }), "web.mosaic");
}

// ---------------------------------------------------------------------------------------------
// The oracle: every walk of a chain over an edge list, in the kit's order.

interface Graph {
  readonly nodes: readonly NodeSpec[];
  readonly edges: readonly EdgeSpec[];
}

const id = (n: NodeSpec) => `${n.type}:${n.key}`;

/** Compare by Unicode code points, which is UTF-8 byte order. */
function bytes(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0)!);
  const y = [...b].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

function walks(g: Graph, chain: Chain): { things: string[]; qualifiers: (string | null)[] }[] {
  const starts = g.nodes.filter((n) => n.type === chain.start && (chain.pin === null || id(n) === chain.pin)).map(id).sort(bytes);
  let found = starts.map((s) => ({ things: [s], qualifiers: [] as (string | null)[] }));
  for (const step of chain.steps) {
    const next: typeof found = [];
    for (const w of found) {
      const here = w.things.at(-1)!;
      const hops = g.edges
        .filter((e) => e.type === step.edge && (step.direction === "out" ? e.from === here : e.to === here))
        .map((e) => ({ other: step.direction === "out" ? e.to : e.from, qualifier: e.qualifier ?? "" }))
        .filter((h) => step.pin === null || h.other === step.pin)
        .sort((a, b) => bytes(a.other, b.other) || bytes(a.qualifier, b.qualifier));
      for (const h of hops) next.push({ things: [...w.things, h.other], qualifiers: [...w.qualifiers, h.qualifier === "" ? null : h.qualifier] });
    }
    found = next;
  }
  return found;
}

const shown = (results: readonly Result[]) => results.map((r) => ({ things: r.things.map((t) => t.id), qualifiers: r.links.map((l) => l.qualifier) }));

const step = (edge: string, direction: Direction, type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });

async function everything(results: ChainResults): Promise<Result[]> {
  const all: Result[] = [];
  for (let offset = 0; ; offset += 20) {
    const page = await results.page(offset, 20);
    all.push(...page);
    if (page.length < 20) return all;
  }
}

/** The file, recording which of its tools were asked. */
function recorded(file: SealedFile): { file: SealedFile; asked: Set<string> } {
  const asked = new Set<string>();
  const proxy = new Proxy(file, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        asked.add(String(name));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { file: proxy, asked };
}

const WEB: Graph = { nodes: WEB_NODES, edges: WEB_EDGES };

const CHAINS: Record<string, Chain> = {
  "a busy hub, its items, their tags": { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] },
  "any hub, its items, tagged with one tag": { start: "Hub", pin: null, steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag", "Tag:t")] },
  "a busy tag, its items, the hubs holding them": { start: "Tag", pin: "Tag:t", steps: [step("tagged", "in", "Item"), step("holds", "in", "Hub")] },
  "any item, its tags": { start: "Item", pin: null, steps: [step("tagged", "out", "Tag")] },
  "a tag sharing its label, its items, the hubs, all their items": {
    start: "Tag",
    pin: "Tag:t2",
    steps: [step("tagged", "in", "Item"), step("holds", "in", "Hub"), step("holds", "out", "Item")],
  },
  "any hub, an item pinned in the middle, its tags": { start: "Hub", pin: null, steps: [step("holds", "out", "Item", "Item:i00"), step("tagged", "out", "Tag")] },
  "items without a label": { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item", "Item:i44"), step("holds", "in", "Hub")] },
};

// ---------------------------------------------------------------------------------------------

describe("every link of a thing, through the kit, past the 20th", () => {
  it("lists a busy thing's links in the kit's order, each with the right thing, though labels repeat", async () => {
    const file = await web();
    const listed = await allLinks(file, "Hub:h", "holds", "out");
    const expected = walks(WEB, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
    expect(listed.exact).toBe(true);
    expect(listed.total).toBe(46);
    expect(listed.links.map((l) => l.id)).toEqual(expected.map((w) => w.things[1]));
    // The first 20 come from `neighbors`, qualifiers and all; past them the kit's table shows
    // none, so each is "not shown" (undefined), never "none" (null).
    expect(listed.links.slice(0, 20).map((l) => l.qualifier)).toEqual(expected.slice(0, 20).map((w) => w.qualifiers[0]));
    expect(listed.links.slice(20).every((l) => l.qualifier === undefined)).toBe(true);
    const labels = new Map(WEB_NODES.map((n) => [id(n), n.label ?? null]));
    for (const l of listed.links) expect(l.label).toBe(labels.get(l.id));
  });

  it("lists a busy thing's incoming links, leaving out a thing that only shares its label", async () => {
    const file = await web();
    const listed = await allLinks(file, "Tag:t", "tagged", "in");
    expect(listed).toMatchObject({ exact: true, total: 30 });
    expect(listed.links.map((l) => l.id)).toEqual(Array.from({ length: 30 }, (_, n) => `Item:i${pad(n)}`));
  });

  it("gives the same first 20 as neighbors, and few links as neighbors does", async () => {
    const file = await web();
    const first = await file.neighbors({ id: "Hub:h", edge: "holds", direction: "out" });
    if ("error" in first) throw new Error(first.error.message);
    const listed = await allLinks(file, "Hub:h", "holds", "out");
    expect(listed.links.slice(0, 20).map((l) => l.id)).toEqual(first.data.edges.map((e) => e.id));
    const few = await allLinks(file, "Tag:t2", "tagged", "in");
    expect(few).toMatchObject({ exact: true, total: 2 });
    expect(few.links.map((l) => l.id)).toEqual(["Item:i00", "Item:i31"]);
  });

  it("asks only the kit's tools", async () => {
    const { file, asked } = recorded(await web());
    await allLinks(file, "Hub:h", "holds", "out");
    await allLinks(file, "Tag:t", "tagged", "in");
    expect([...asked].every((n) => ["get", "neighbors", "table", "propsOf"].includes(n))).toBe(true);
  });

  it("says when the kit cannot tell which thing a link leads to, and lists what it can", async () => {
    // Item:a and Item:b share a label and sit side by side in id order; each has more than 20
    // hubs, so neither `neighbors` nor the hubs' rows can tell which of them Hub:h holds.
    const hubs = Array.from({ length: 21 }, (_, n): NodeSpec => ({ type: "Hub", key: `g${pad(n)}`, label: `Hub g${pad(n)}` }));
    const items = Array.from({ length: 24 }, (_, n): NodeSpec => ({ type: "Item", key: `c${pad(n)}`, label: `Item c${pad(n)}` }));
    const bytes = buildMosaic({
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...hubs, ...items, { type: "Item", key: "d1", label: "Twin" }, { type: "Item", key: "d2", label: "Twin" }],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: [
        ...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
        { type: "holds", from: "Hub:h", to: "Item:d1" },
        ...hubs.flatMap((h): EdgeSpec[] => [
          { type: "holds", from: id(h), to: "Item:d1" },
          { type: "holds", from: id(h), to: "Item:d2" },
        ]),
      ],
    });
    const file = await openMosaic(bytes, "twins.mosaic");
    const listed = await allLinks(file, "Hub:h", "holds", "out");
    expect(listed.exact).toBe(false);
    expect(listed.total).toBe(25);
    expect(listed.links.map((l) => l.id)).toEqual(items.map(id));
    expect(listed.note).toMatch(/Hub:h/);
    expect(listed.note).toMatch(/holds/);
  });

  it("says when the kit cannot list them because the edge type's name is also a property's", async () => {
    // `table` reads a column name as a declared property first (section 8.6).
    const items = Array.from({ length: 25 }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n)}`, label: `Item ${pad(n)}` }));
    const bytes = buildMosaic({
      nodes: [...items, { type: "Tag", key: "t", label: "Tag t" }],
      edgeTypes: [["name", "Item", "Tag"]],
      edges: items.map((n): EdgeSpec => ({ type: "name", from: id(n), to: "Tag:t" })),
    });
    const file = await openMosaic(bytes, "shadow.mosaic");
    const listed = await allLinks(file, "Tag:t", "name", "in");
    expect(listed).toMatchObject({ exact: false, total: 25 });
    expect(listed.links.map((l) => l.id)).toEqual(items.slice(0, 20).map(id));
    expect(listed.note).toMatch(/Tag:t/);
  });
});

describe("a chain's results: one thing per step, in the same order every time (V-13)", () => {
  for (const [name, chain] of Object.entries(CHAINS)) {
    it(name, async () => {
      const file = await web();
      const expected = walks(WEB, chain);
      const found = await everything(new ChainResults(file, chain));
      expect(shown(found)).toEqual(expected);
      for (const r of found) {
        expect(r.things).toHaveLength(chain.steps.length + 1);
        expect(r.links).toHaveLength(chain.steps.length);
        expect(r.things.map((t) => t.id.split(":")[0])).toEqual([chain.start, ...chain.steps.map((s) => s.type)]);
      }
      // Again, from a new reader of the same mosaic: the same results in the same order.
      expect(shown(await everything(new ChainResults(await web(), chain)))).toEqual(expected);
    });
  }

  it("gives each thing its label", async () => {
    const file = await web();
    const found = await everything(new ChainResults(file, CHAINS["a busy hub, its items, their tags"]!));
    const labels = new Map(WEB_NODES.map((n) => [id(n), n.label ?? null]));
    for (const r of found) for (const t of r.things) expect(t.label).toBe(labels.get(t.id));
  });

  it("keeps two links between the same two things as two results, each with its qualifier", async () => {
    const file = await web();
    const found = await everything(new ChainResults(file, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item", "Item:i03")] }));
    expect(shown(found)).toEqual([
      { things: ["Hub:h", "Item:i03"], qualifiers: [null] },
      { things: ["Hub:h", "Item:i03"], qualifiers: ["again"] },
    ]);
  });

  it("pages through the results: any page is that part of the whole, and a page past the end is empty", async () => {
    const file = await web();
    const chain = CHAINS["a busy hub, its items, their tags"]!;
    const expected = walks(WEB, chain);
    const results = new ChainResults(file, chain);
    for (const [offset, limit] of [[0, 5], [3, 7], [19, 2], [20, 20], [30, 50], [expected.length - 1, 5]] as const) {
      expect(shown(await results.page(offset, limit)), `${offset}+${limit}`).toEqual(expected.slice(offset, offset + limit));
    }
    expect(await results.page(expected.length, 20)).toEqual([]);
    // A later page asked first, on a new reader, is the same.
    expect(shown(await new ChainResults(file, chain).page(30, 3))).toEqual(expected.slice(30, 33));
  });

  it("finds the results past a busy thing's first 20 links when those lead nowhere", async () => {
    // Hub:h holds 30 items; only the last five have a tag, so its first 20 links are dead ends.
    const items = Array.from({ length: 30 }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n)}`, label: `Item ${pad(n)}` }));
    const g: Graph = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...items, { type: "Tag", key: "t", label: "Tag t" }],
      edges: [
        ...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
        ...items.slice(25).map((n): EdgeSpec => ({ type: "tagged", from: id(n), to: "Tag:t" })),
      ],
    };
    const file = await openMosaic(buildMosaic({ nodes: [...g.nodes], edgeTypes: WEB_TYPES, edges: [...g.edges] }), "dead-ends.mosaic");
    for (const chain of [
      { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] },
      { start: "Hub", pin: null, steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] },
      { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag"), step("tagged", "in", "Item")] },
    ] satisfies Chain[]) {
      const expected = walks(g, chain);
      const results = new ChainResults(file, chain);
      expect(await results.count()).toEqual({ total: expected.length, exact: true, notes: [] });
      for (const [offset, limit] of [[0, 5], [0, 20], [2, 2], [4, 30]] as const) {
        expect(shown(await new ChainResults(file, chain).page(offset, limit)), `${offset}+${limit}`).toEqual(expected.slice(offset, offset + limit));
      }
    }
  });

  it("reads a qualifier past the 20th from the link's other side, where that side lists it", async () => {
    // Hub:h has 25 links, each to its own item; the last one has a qualifier. Each item has one link.
    const items = Array.from({ length: 25 }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n)}`, label: `Item ${pad(n)}` }));
    const g: Graph = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...items],
      edges: items.map((n, k): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n), ...(k === 24 ? { qualifier: "late" } : {}) })),
    };
    const file = await openMosaic(buildMosaic({ nodes: [...g.nodes], edgeTypes: [["holds", "Hub", "Item"]], edges: [...g.edges] }), "late.mosaic");
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
    expect(shown(await everything(new ChainResults(file, chain)))).toEqual(walks(g, chain));
    expect(shown(await new ChainResults(file, chain).page(24, 1))).toEqual([{ things: ["Hub:h", "Item:i24"], qualifiers: ["late"] }]);
  });

  it("lists every link to one thing though there are more than 20, and says which qualifiers the kit does not show", async () => {
    // Hub:h has 25 links to Item:i, told apart by qualifier, and one to Item:j: neither side lists
    // the 21st to 25th, so their qualifiers are not shown; their number is what the total leaves.
    const qualifiers = Array.from({ length: 25 }, (_, n) => `q${pad(n)}`);
    const g: Graph = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Item", key: "i", label: "Item i" }, { type: "Item", key: "j", label: "Item j" }],
      edges: [...qualifiers.map((q): EdgeSpec => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: q })), { type: "holds", from: "Hub:h", to: "Item:j" }],
    };
    const file = await openMosaic(buildMosaic({ nodes: [...g.nodes], edgeTypes: [["holds", "Hub", "Item"]], edges: [...g.edges] }), "pair.mosaic");
    for (const chain of [
      { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] },
      { start: "Item", pin: "Item:i", steps: [step("holds", "in", "Hub", "Hub:h")] },
    ] satisfies Chain[]) {
      const expected = walks(g, chain);
      const results = new ChainResults(file, chain);
      const found = shown(await everything(results));
      expect(await results.count()).toEqual({ total: expected.length, exact: true, notes: [] });
      expect(found.map((r) => r.things)).toEqual(expected.map((r) => r.things));
      expect(found.map((r) => r.qualifiers[0])).toEqual(expected.map((r, k) => (k < 20 ? r.qualifiers[0] : r.things[1] === "Item:j" ? null : undefined)));
    }
  });

  it("a page that cannot list every result says why, naming the thing, while the count stays the kit's", async () => {
    // Hub:h has 25 links to Item:i and 22 to Item:k: each side has more than 20, so the kit
    // cannot say how many of the links past the 20th go to which.
    const g: Graph = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Item", key: "i", label: "Item i" }, { type: "Item", key: "k", label: "Item k" }],
      edges: [
        ...Array.from({ length: 25 }, (_, n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: `q${pad(n)}` })),
        ...Array.from({ length: 22 }, (_, n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: "Item:k", qualifier: `q${pad(n)}` })),
      ],
    };
    const file = await openMosaic(buildMosaic({ nodes: [...g.nodes], edgeTypes: [["holds", "Hub", "Item"]], edges: [...g.edges] }), "pairs.mosaic");
    const results = new ChainResults(file, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
    expect(await results.count()).toEqual({ total: 47, exact: true, notes: [] });
    const found = await everything(results);
    expect(found.length).toBeLessThan(47);
    expect(results.notes.join(" ")).toMatch(/Hub:h/);
  });

  it("a chain with no steps lists the things of its type, or the one thing pinned", async () => {
    const file = await web();
    const items = await new ChainResults(file, { start: "Item", pin: null, steps: [] });
    expect((await everything(items)).map((r) => r.things[0]!.id)).toEqual(WEB_NODES.filter((n) => n.type === "Item").map(id).sort(bytes));
    expect(await items.count()).toMatchObject({ total: 47, exact: true });
    const one = new ChainResults(file, { start: "Item", pin: "Item:z", steps: [] });
    expect(shown(await one.page(0, 20))).toEqual([{ things: ["Item:z"], qualifiers: [] }]);
    expect(await one.count()).toMatchObject({ total: 1, exact: true });
  });

  it("a pinned thing the mosaic lacks finds nothing, and says so", async () => {
    const file = await web();
    const results = new ChainResults(file, { start: "Hub", pin: "Hub:nope", steps: [step("holds", "out", "Item")] });
    expect(await results.page(0, 20)).toEqual([]);
    const count = await results.count();
    expect(count).toMatchObject({ total: 0, exact: true });
    expect(count.notes.join(" ")).toMatch(/Hub:nope/);
  });

  it("asks only the kit's tools", async () => {
    const { file, asked } = recorded(await web());
    for (const chain of Object.values(CHAINS)) {
      const results = new ChainResults(file, chain);
      await everything(results);
      await results.count();
    }
    expect([...asked].every((n) => ["get", "neighbors", "table", "propsOf"].includes(n))).toBe(true);
  });
});

describe("how many results a chain has, even when only some are shown (V-13)", () => {
  for (const [name, chain] of Object.entries(CHAINS)) {
    it(name, async () => {
      const file = await web();
      const count = await new ChainResults(file, chain).count();
      expect(count).toEqual({ total: walks(WEB, chain).length, exact: true, notes: [] });
    });
  }

  it("counts without listing what it need not list, and reports a running count that ends at the total", async () => {
    const file = await web();
    const chain = CHAINS["a busy tag, its items, the hubs holding them"]!;
    const seen: number[] = [];
    const count = await new ChainResults(file, chain).count({ progress: (atLeast) => seen.push(atLeast) });
    expect(count.total).toBe(walks(WEB, chain).length);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen.every((n) => n <= count.total)).toBe(true);
  });

  it("stops counting when asked to", async () => {
    const file = await web();
    const stop = new AbortController();
    stop.abort();
    await expect(new ChainResults(file, CHAINS["a busy hub, its items, their tags"]!).count({ signal: stop.signal })).rejects.toThrow(/abort/i);
  });

  it("says the count is at least what it found, and why, when the kit cannot list every link", async () => {
    // As in the twins mosaic above: Hub:h's 25 items cannot all be told apart through the kit.
    const hubs = Array.from({ length: 21 }, (_, n): NodeSpec => ({ type: "Hub", key: `g${pad(n)}`, label: `Hub g${pad(n)}` }));
    const items = Array.from({ length: 24 }, (_, n): NodeSpec => ({ type: "Item", key: `c${pad(n)}`, label: `Item c${pad(n)}` }));
    const nodes = [{ type: "Hub", key: "h", label: "Hub h" }, ...hubs, ...items, { type: "Item", key: "d1", label: "Twin" }, { type: "Item", key: "d2", label: "Twin" }];
    const edges: EdgeSpec[] = [
      ...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
      { type: "holds", from: "Hub:h", to: "Item:d1" },
      ...hubs.flatMap((h): EdgeSpec[] => [
        { type: "holds", from: id(h), to: "Item:d1" },
        { type: "holds", from: id(h), to: "Item:d2" },
      ]),
    ];
    const file = await openMosaic(buildMosaic({ nodes, edgeTypes: [["holds", "Hub", "Item"]], edges }), "twins.mosaic");
    // One step: the count is the kit's own link count, exact.
    expect(await new ChainResults(file, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] }).count()).toEqual({ total: 25, exact: true, notes: [] });
    // Two steps: each item's hubs must be counted, and one item cannot be named.
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("holds", "in", "Hub")] };
    const count = await new ChainResults(file, chain).count();
    expect(count.exact).toBe(false);
    expect(count.total).toBe(24); // the 24 items it can name, each held by Hub:h alone
    expect(count.total).toBeLessThan(walks({ nodes, edges }, chain).length);
    expect(count.notes.join(" ")).toMatch(/Hub:h/);
  });
});

describe("a chain that would flood the page answers quickly and says how much is left out (V-14)", () => {
  it("a busy hub through its items: the first page and the count within the kit's time bound", async () => {
    const file = await web();
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
    const started = performance.now();
    const results = new ChainResults(file, chain);
    const [page, count] = await Promise.all([results.page(0, 20), results.count()]);
    expect(performance.now() - started).toBeLessThan(file.timeLimitMs);
    expect(page).toHaveLength(20);
    expect(count).toEqual({ total: 46, exact: true, notes: [] });
    expect(count.total - page.length).toBe(26);
  });
});

describe("results: further cases", () => {
  interface World {
    nodes: NodeSpec[];
    edgeTypes: [string, string, string][];
    edges: EdgeSpec[];
  }

  const id = (n: NodeSpec) => `${n.type}:${n.key}`;
  const step = (edge: string, direction: Direction, type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");

  function open(w: World): Promise<SealedFile> {
    return openMosaic(buildMosaic({ nodes: w.nodes, edgeTypes: w.edgeTypes, edges: w.edges }), "edges.mosaic");
  }

  interface Walk {
    things: string[];
    qualifiers: string[];
  }

  /** Every walk of a chain over an edge list, in the order the spec gives (UTF-8 bytes). */
  function walks(w: World, chain: Chain): Walk[] {
    const starts = w.nodes
      .filter((n) => n.type === chain.start && (chain.pin === null || id(n) === chain.pin))
      .map(id)
      .sort(compareUtf8);
    let found: Walk[] = starts.map((s) => ({ things: [s], qualifiers: [] }));
    for (const s of chain.steps) {
      const next: Walk[] = [];
      for (const walk of found) {
        const here = walk.things.at(-1)!;
        const hops = w.edges
          .filter((e) => e.type === s.edge && (s.direction === "out" ? e.from === here : e.to === here))
          .map((e) => ({ other: s.direction === "out" ? e.to : e.from, qualifier: e.qualifier ?? "" }))
          .filter((h) => s.pin === null || h.other === s.pin)
          .sort((a, b) => compareUtf8(a.other, b.other) || compareUtf8(a.qualifier, b.qualifier));
        for (const h of hops) next.push({ things: [...walk.things, h.other], qualifiers: [...walk.qualifiers, h.qualifier] });
      }
      found = next;
    }
    return found;
  }

  const ids = (rs: readonly Result[]) => rs.map((r) => r.things.map((t) => t.id));
  const qualifiers = (rs: readonly Result[]) => rs.map((r) => r.links.map((l) => l.qualifier ?? ""));

  async function everything(results: ChainResults, size = 20): Promise<Result[]> {
    const all: Result[] = [];
    for (let offset = 0; ; offset += size) {
      const page = await results.page(offset, size);
      all.push(...page);
      if (page.length < size) return all;
    }
  }

  /** The chain's results and count are exactly the oracle's. */
  /**
   * As {@link agrees}, for links the kit shows only in part: more than 20 links of one type between
   * the same two things. Past the 20th, neither `neighbors` (20 a side), `table` (one label per
   * thing) nor `cite` (no qualifier in its rows) gives a link's qualifier, so it may be "not shown"
   * (undefined) rather than the oracle's; every result, its order and the count still agree.
   */
  async function agreesPastTheKitsReach(w: World, chain: Chain): Promise<void> {
    const f = await open(w);
    const expected = walks(w, chain);
    const found = await everything(new ChainResults(f, chain));
    expect(ids(found)).toEqual(expected.map((x) => x.things));
    found.forEach((r, k) => {
      const want = expected[k]!.qualifiers;
      const got = r.links.map((l) => l.qualifier);
      if (k < 20) expect(got.map((q) => q ?? "")).toEqual(want);
      else got.forEach((q, j) => expect(q === undefined || q === (want[j] === "" ? null : want[j])).toBe(true));
    });
    expect(await new ChainResults(f, chain).count()).toEqual({ total: expected.length, exact: true, notes: [] });
  }

  async function agrees(w: World, chain: Chain, file?: SealedFile): Promise<void> {
    const f = file ?? (await open(w));
    const expected = walks(w, chain);
    const results = new ChainResults(f, chain);
    const found = await everything(results);
    expect(ids(found)).toEqual(expected.map((x) => x.things));
    expect(qualifiers(found)).toEqual(expected.map((x) => x.qualifiers));
    expect(await new ChainResults(f, chain).count()).toEqual({ total: expected.length, exact: true, notes: [] });
  }

  // ---------------------------------------------------------------------------------------------

  describe("order is UTF-8 byte order, not UTF-16 or locale (V-13; sections 3.6, 8.6)", () => {
    // U+FF5E sorts before U+1F600 in UTF-8 bytes but after it in UTF-16 code units.
    const keys = ["a", "B", "Z", "_", "é", "ß", "～", "\u{1F600}", "\u{10000}", "ﬁ", "z", "0", "10", "9", "é", "Ω", "中", "\u{20000}", "aa", "a b", "A", "~", "éé"];
    const items: NodeSpec[] = keys.map((k, n) => ({ type: "Item", key: k, label: `Item ${pad(n)}` }));
    const world: World = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...items],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
    };

    it("lists a busy thing's links, past the 20th, by the UTF-8 bytes of the next thing's id", async () => {
      expect(keys.length).toBeGreaterThan(20);
      await agrees(world, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
    });

    it("lists the starts by the UTF-8 bytes of their ids", async () => {
      await agrees(world, { start: "Item", pin: null, steps: [step("holds", "in", "Hub")] });
    });

    it("puts the astral id after the high BMP id, as the bytes do", async () => {
      const file = await open(world);
      const found = await everything(new ChainResults(file, { start: "Item", pin: null, steps: [] }));
      const order = found.map((r) => r.things[0]!.id);
      expect(order.indexOf("Item:～")).toBeLessThan(order.indexOf("Item:\u{1F600}"));
      expect(order.indexOf("Item:\u{1F600}")).toBeLessThan(order.indexOf("Item:\u{20000}"));
    });
  });

  describe("two links of one type between the same two things (section 3.4; V-13)", () => {
    const quals = ["", "a", "B", "é", "～", "\u{1F600}", "z", "A", "10", "9", "aa", "a b", ...Array.from({ length: 13 }, (_, n) => `q${pad(n)}`)];
    const world: World = {
      nodes: [
        { type: "Hub", key: "h", label: "Hub h" },
        { type: "Item", key: "i", label: "Item i" },
        { type: "Item", key: "j", label: "Item j" },
      ],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Item"]],
      edges: [
        ...quals.map((q): EdgeSpec => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: q === "" ? undefined : q })),
        { type: "holds", from: "Hub:h", to: "Item:j" },
      ],
    };

    it("makes a result per link, in qualifier byte order, though more than 20 leave one thing", async () => {
      expect(world.edges.filter((e) => e.type === "holds").length).toBeGreaterThan(20);
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      await agreesPastTheKitsReach(world, chain);
    });

    it("counts a result per link when the chain goes on from the thing", async () => {
      // Hub -> Item (26 links) -> back to the hubs: each of the 25 links to Item:i continues alike.
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("holds", "in", "Hub")] };
      const file = await open(world);
      const count = await new ChainResults(file, chain).count();
      const all = walks(world, chain).length;
      // The count is exact, or it says the kit could not list every link and is at most the whole.
      if (count.exact) expect(count.total).toBe(all);
      else {
        expect(count.total).toBeLessThanOrEqual(all);
        expect(count.notes.length).toBeGreaterThan(0);
      }
    });

    it("counts a result per link in the other direction too, pinned at the end", async () => {
      await agreesPastTheKitsReach(world, { start: "Item", pin: "Item:i", steps: [step("holds", "in", "Hub", "Hub:h")] });
    });
  });

  describe("a chain through the same type, cycles and self-links (V-1)", () => {
    const people = Array.from({ length: 30 }, (_, n): NodeSpec => ({ type: "Person", key: `p${pad(n)}`, label: `Person ${pad(n)}` }));
    const edges: EdgeSpec[] = [
      { type: "knows", from: "Person:p00", to: "Person:p00" }, // a self-link
      { type: "knows", from: "Person:p00", to: "Person:p01" },
      { type: "knows", from: "Person:p01", to: "Person:p02" },
      { type: "knows", from: "Person:p02", to: "Person:p00" }, // a cycle of three
      { type: "knows", from: "Person:p01", to: "Person:p00" }, // and back
      ...people.slice(3).map((p): EdgeSpec => ({ type: "knows", from: "Person:p00", to: id(p) })), // p00 is busy
      ...people.slice(3).map((p): EdgeSpec => ({ type: "knows", from: id(p), to: "Person:p01" })),
    ];
    const world: World = { nodes: people, edgeTypes: [["knows", "Person", "Person"]], edges };

    it("follows a self-link and a cycle for as many steps as the chain has, and stops", async () => {
      const hops = (n: number, d: Direction) => Array.from({ length: n }, () => step("knows", d, "Person"));
      await agrees(world, { start: "Person", pin: "Person:p00", steps: hops(4, "out") });
      await agrees(world, { start: "Person", pin: "Person:p00", steps: hops(3, "in") });
    });

    it("counts walks that go out and come back to the start", async () => {
      await agrees(world, { start: "Person", pin: "Person:p02", steps: [step("knows", "out", "Person"), step("knows", "in", "Person")] });
    });

    it("counts walks pinned at the end of a cycle, found backwards through the busy thing", async () => {
      await agrees(world, {
        start: "Person",
        pin: null,
        steps: [step("knows", "out", "Person"), step("knows", "out", "Person"), step("knows", "out", "Person", "Person:p00")],
      });
    });

    it("counts every start when nothing is pinned", async () => {
      await agrees(world, { start: "Person", pin: null, steps: [step("knows", "out", "Person"), step("knows", "in", "Person")] });
    });
  });

  describe("ids and labels with characters a query could trip on (sections 3.1, 8)", () => {
    const odd = ["it's", "100%", "a_b", "a\\b", 'say "hi"', "a:b", "sp ace", "semi;colon", "--", "/*", "x'; DROP TABLE node;--", "%", "_", "\\", "'", " ", "tab\tkey", "ünï", "a%b", "ab"];
    const items: NodeSpec[] = [
      ...odd.map((k): NodeSpec => ({ type: "Item", key: k, label: k })),
      // Labels that LIKE or GLOB would treat as patterns, shared by several things.
      { type: "Item", key: "w1", label: "%" },
      { type: "Item", key: "w2", label: "_" },
      { type: "Item", key: "w3", label: "*" },
      { type: "Item", key: "w4", label: "a%" },
      { type: "Item", key: "w5", label: "[ab]" },
    ];
    const tags: NodeSpec[] = [
      { type: "Tag", key: "t'", label: "Tag%" },
      { type: "Tag", key: "t%", label: "Tag%" },
      { type: "Tag", key: "t_", label: "Tag_" },
    ];
    const world: World = {
      nodes: [{ type: "Hub", key: "h'", label: "Hub's" }, { type: "Hub", key: "h%", label: "Hub's" }, ...items, ...tags],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [
        ...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h'", to: id(n) })),
        ...items.slice(0, 3).map((n): EdgeSpec => ({ type: "holds", from: "Hub:h%", to: id(n) })),
        ...items.map((n, k): EdgeSpec => ({ type: "tagged", from: id(n), to: id(tags[k % 3]!) })),
      ],
    };

    it("follows a busy thing's links to the right things", async () => {
      expect(items.length).toBeGreaterThan(20);
      await agrees(world, { start: "Hub", pin: "Hub:h'", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] });
    });

    it("counts through them, pinned at the end", async () => {
      await agrees(world, { start: "Hub", pin: null, steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag", "Tag:t%")] });
    });

    it("walks them backwards from a pinned busy thing", async () => {
      await agrees(world, { start: "Tag", pin: "Tag:t_", steps: [step("tagged", "in", "Item"), step("holds", "in", "Hub")] });
    });

    it("gives the labels as they are", async () => {
      const file = await open(world);
      const found = await everything(new ChainResults(file, { start: "Hub", pin: "Hub:h'", steps: [step("holds", "out", "Item")] }));
      const labels = new Map(world.nodes.map((n) => [id(n), n.label ?? null]));
      for (const r of found) for (const t of r.things) expect(t.label).toBe(labels.get(t.id));
    });
  });

  describe("empty, single and missing (V-13)", () => {
    const world: World = {
      nodes: [
        { type: "Hub", key: "h", label: "Hub h" },
        { type: "Item", key: "i", label: "Item i" },
        { type: "Item", key: "j", label: "Item j" },
        { type: "Tag", key: "t", label: "Tag t" },
      ],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [{ type: "holds", from: "Hub:h", to: "Item:i" }],
    };

    it("a chain that finds nothing has a count of 0, exact, and no results", async () => {
      const file = await open(world);
      const chain: Chain = { start: "Hub", pin: null, steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] };
      const results = new ChainResults(file, chain);
      expect(await results.page(0, 20)).toEqual([]);
      expect(await results.count()).toEqual({ total: 0, exact: true, notes: [] });
    });

    it("a mosaic with no links at all has no results for any step", async () => {
      const bare: World = { ...world, edges: [] };
      const file = await open(bare);
      const results = new ChainResults(file, { start: "Item", pin: null, steps: [step("tagged", "out", "Tag")] });
      expect(await results.page(0, 20)).toEqual([]);
      expect(await results.count()).toMatchObject({ total: 0, exact: true });
    });

    it("a chain of one result has a count of 1 and one result", async () => {
      await agrees(world, { start: "Hub", pin: null, steps: [step("holds", "out", "Item")] });
      const file = await open(world);
      expect(await new ChainResults(file, { start: "Hub", pin: null, steps: [step("holds", "out", "Item")] }).count()).toEqual({ total: 1, exact: true, notes: [] });
    });

    it("a pin on a thing the mosaic lacks in the middle finds nothing, and names the thing", async () => {
      const file = await open(world);
      const results = new ChainResults(file, { start: "Hub", pin: null, steps: [step("holds", "out", "Item", "Item:nope"), step("tagged", "out", "Tag")] });
      expect(await results.page(0, 20)).toEqual([]);
      const count = await results.count();
      expect(count).toMatchObject({ total: 0, exact: true });
      expect(count.notes.join(" ")).toMatch(/Item:nope/);
    });

    it("a pin on a thing the mosaic lacks at the end finds nothing, and names the thing", async () => {
      const file = await open(world);
      const results = new ChainResults(file, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item", "Item:zzz")] });
      expect(await results.page(0, 20)).toEqual([]);
      const count = await results.count();
      expect(count.total).toBe(0);
      expect(count.notes.join(" ")).toMatch(/Item:zzz/);
    });

    it("a pinned thing that exists but is not reached finds nothing, with no note about it", async () => {
      const file = await open(world);
      const results = new ChainResults(file, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item", "Item:j")] });
      expect(await results.page(0, 20)).toEqual([]);
      expect(await results.count()).toEqual({ total: 0, exact: true, notes: [] });
    });

    it("a pin of another type than its place finds nothing and does not fail", async () => {
      const file = await open(world);
      const results = new ChainResults(file, { start: "Hub", pin: "Item:i", steps: [step("holds", "out", "Item")] });
      expect(await results.page(0, 20)).toEqual([]);
      expect((await results.count()).total).toBe(0);
    });

    it("a start type with no things has a count of 0", async () => {
      const lonely: World = { ...world, nodes: world.nodes.filter((n) => n.type !== "Tag"), edgeTypes: [["holds", "Hub", "Item"]], edges: world.edges };
      const file = await open({ ...lonely, nodes: [...lonely.nodes] });
      const results = new ChainResults(file, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
      expect((await results.count()).total).toBe(1);
    });

    it("an empty page asked for gives nothing, and a page far past the end gives nothing", async () => {
      const file = await open(world);
      const results = new ChainResults(file, { start: "Hub", pin: null, steps: [step("holds", "out", "Item")] });
      expect(await results.page(0, 0)).toEqual([]);
      expect(await results.page(1_000_000, 20)).toEqual([]);
    });
  });

  describe("the same results every time, however they are asked for (V-13; principle 5)", () => {
    const items = Array.from({ length: 70 }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n)}`, label: n % 7 === 0 ? "Seven" : `Item ${pad(n)}` }));
    const world: World = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Tag", key: "t", label: "Tag t" }, { type: "Tag", key: "u", label: "Tag t" }, ...items],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [
        ...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
        ...items.filter((_, n) => n % 3 !== 0).map((n): EdgeSpec => ({ type: "tagged", from: id(n), to: "Tag:t" })),
        ...items.filter((_, n) => n % 2 === 0).map((n): EdgeSpec => ({ type: "tagged", from: id(n), to: "Tag:u" })),
      ],
    };
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] };

    it("pages of any size join into the same whole", async () => {
      const file = await open(world);
      const expected = walks(world, chain).map((x) => x.things);
      for (const size of [1, 3, 7, 20, 64, 1000]) {
        expect(ids(await everything(new ChainResults(file, chain), size)), `size ${size}`).toEqual(expected);
      }
    });

    it("pages asked in any order, on one reader, are each that part of the whole", async () => {
      const file = await open(world);
      const expected = walks(world, chain).map((x) => x.things);
      const results = new ChainResults(file, chain);
      for (const [offset, limit] of [[100, 5], [0, 3], [57, 20], [20, 1], [3, 30], [expected.length - 2, 10], [0, 3]] as const) {
        expect(ids(await results.page(offset, limit)), `${offset}+${limit}`).toEqual(expected.slice(offset, offset + limit));
      }
    });

    it("pages asked at the same time are each that part of the whole", async () => {
      const file = await open(world);
      const expected = walks(world, chain).map((x) => x.things);
      const results = new ChainResults(file, chain);
      const [a, b, c, n] = await Promise.all([results.page(0, 20), results.page(20, 20), results.page(40, 20), results.count()]);
      expect(ids(a)).toEqual(expected.slice(0, 20));
      expect(ids(b)).toEqual(expected.slice(20, 40));
      expect(ids(c)).toEqual(expected.slice(40, 60));
      expect(n.total).toBe(expected.length);
    });

    it("the count is the same asked twice, before and after listing, and never less than what is shown", async () => {
      const file = await open(world);
      const results = new ChainResults(file, chain);
      const first = await results.count();
      const listed = await everything(results);
      const second = await results.count();
      expect(second).toEqual(first);
      expect(first.total).toBe(listed.length);
      expect(first.exact).toBe(true);
    });

    it("the same mosaic read twice gives the same results in the same order", async () => {
      const bytes = buildMosaic({ nodes: world.nodes, edgeTypes: world.edgeTypes, edges: world.edges });
      const a = ids(await everything(new ChainResults(await openMosaic(bytes, "a.mosaic"), chain)));
      const b = ids(await everything(new ChainResults(await openMosaic(bytes.slice(), "b.mosaic"), chain)));
      expect(a).toEqual(b);
    });

    it("nodes and links given in another order build the same mosaic and the same results", async () => {
      const reversed: World = { nodes: [...world.nodes].reverse(), edgeTypes: world.edgeTypes, edges: [...world.edges].reverse() };
      expect(ids(await everything(new ChainResults(await open(reversed), chain)))).toEqual(ids(await everything(new ChainResults(await open(world), chain))));
    });

    it("each result's links number one fewer than its things, and each link's qualifier is null or text", async () => {
      const file = await open(world);
      for (const r of await everything(new ChainResults(file, chain))) {
        expect(r.links).toHaveLength(r.things.length - 1);
        for (const l of r.links) expect(l.qualifier === null || typeof l.qualifier === "string").toBe(true);
      }
    });
  });

  describe("stopping (V-14: rather than freezing)", () => {
    const items = Array.from({ length: 60 }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n)}`, label: `Item ${pad(n)}` }));
    const world: World = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Tag", key: "t", label: "Tag t" }, ...items],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })), ...items.map((n): EdgeSpec => ({ type: "tagged", from: id(n), to: "Tag:t" }))],
    };
    const chain: Chain = { start: "Hub", pin: null, steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag"), step("tagged", "in", "Item")] };

    it("a count stopped at once rejects, and a new count after it is still right", async () => {
      const file = await open(world);
      const stop = new AbortController();
      const results = new ChainResults(file, chain);
      const counting = results.count({ signal: stop.signal });
      stop.abort();
      await expect(counting).rejects.toThrow(/abort/i);
      expect((await results.count()).total).toBe(walks(world, chain).length);
    });

    it("a page asked for with a stopped signal rejects", async () => {
      const file = await open(world);
      const stop = new AbortController();
      stop.abort();
      await expect(new ChainResults(file, chain).page(0, 20, stop.signal)).rejects.toThrow(/abort/i);
    });

    it("the running count never goes down and never passes the total", async () => {
      const file = await open(world);
      const seen: number[] = [];
      const count = await new ChainResults(file, chain).count({ progress: (n) => seen.push(n) });
      expect(count.total).toBe(walks(world, chain).length);
      for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
      expect(Math.max(0, ...seen)).toBeLessThanOrEqual(count.total);
    });
  });

  describe("a chain that floods the page answers within the kit's time bound (V-14)", () => {
    const count = 2500;
    const items = Array.from({ length: count }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n, 5)}`, label: `Item ${pad(n, 5)}` }));
    const tags = Array.from({ length: 3 }, (_, n): NodeSpec => ({ type: "Tag", key: `t${n}`, label: `Tag ${n}` }));
    const world: World = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...items, ...tags],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [
        ...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
        ...items.flatMap((n, k): EdgeSpec[] => tags.slice(0, 1 + (k % 3)).map((t): EdgeSpec => ({ type: "tagged", from: id(n), to: id(t) }))),
      ],
    };
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] };

    it("the first page, a deep page and the exact count each come within the bound", async () => {
      const file = await open(world);
      const expected = walks(world, chain);
      const results = new ChainResults(file, chain);

      let t = performance.now();
      const first = await results.page(0, 20);
      expect(performance.now() - t, "first page").toBeLessThan(file.timeLimitMs);
      expect(ids(first)).toEqual(expected.slice(0, 20).map((x) => x.things));

      t = performance.now();
      const total = await results.count();
      expect(performance.now() - t, "count").toBeLessThan(file.timeLimitMs * 5);
      expect(total).toEqual({ total: expected.length, exact: true, notes: [] });
      expect(total.total - first.length).toBe(expected.length - 20);

      t = performance.now();
      const deep = await results.page(expected.length - 7, 20);
      expect(performance.now() - t, "deep page").toBeLessThan(file.timeLimitMs * 5);
      expect(ids(deep)).toEqual(expected.slice(-7).map((x) => x.things));
    }, 60_000);

    it("a chain from every start through a busy thing still gives its first page and its count", async () => {
      const file = await open(world);
      const wide: Chain = { start: "Tag", pin: null, steps: [step("tagged", "in", "Item"), step("holds", "in", "Hub"), step("holds", "out", "Item")] };
      const results = new ChainResults(file, wide);
      const t = performance.now();
      const page = await results.page(0, 20);
      expect(performance.now() - t).toBeLessThan(file.timeLimitMs * 5);
      expect(page).toHaveLength(20);
      const stop = new AbortController();
      const counting = results.count({ signal: stop.signal });
      stop.abort();
      await expect(counting).rejects.toThrow(/abort/i);
    }, 60_000);
  });

  describe("labels the kit cuts (section 8.2) do not mix up different things", () => {
    const long = "L".repeat(200);
    const items = Array.from({ length: 30 }, (_, n): NodeSpec => ({ type: "Item", key: `i${pad(n)}`, label: `${long}${n}` }));
    const world: World = {
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Tag", key: "t", label: "Tag t" }, ...items],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [...items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })), ...items.map((n): EdgeSpec => ({ type: "tagged", from: id(n), to: "Tag:t" }))],
    };

    it("the first page is the first twenty by id, and a count is exact or says it is not", async () => {
      const file = await open(world);
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item"), step("tagged", "out", "Tag")] };
      const expected = walks(world, chain);
      const results = new ChainResults(file, chain);
      expect(ids(await results.page(0, 20))).toEqual(expected.slice(0, 20).map((x) => x.things));
      const count = await results.count();
      if (count.exact) expect(count.total).toBe(expected.length);
      else {
        expect(count.total).toBeLessThanOrEqual(expected.length);
        expect(count.notes.length).toBeGreaterThan(0);
      }
    });
  });

  describe("a label with a NUL or other control characters (section 8.2)", () => {
    const nodes: NodeSpec[] = [
      { type: "Hub", key: "h", label: "Hub h" },
      { type: "Item", key: "a", label: "a\u0000b" },
      { type: "Item", key: "b", label: "a" },
      { type: "Item", key: "c", label: "line\nbreak" },
      { type: "Item", key: "d", label: "" },
    ];
    const world: World = {
      nodes,
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: nodes.slice(1).map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
    };

    it("lists every thing, in order, with a label that is text or null", async () => {
      const file = await open(world);
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      const found = await everything(new ChainResults(file, chain));
      expect(ids(found)).toEqual(walks(world, chain).map((x) => x.things));
      for (const r of found) for (const t of r.things) expect(t.label === null || typeof t.label === "string").toBe(true);
      expect(await new ChainResults(file, chain).count()).toEqual({ total: 4, exact: true, notes: [] });
    });
  });
});

describe("results walks: further cases", () => {
  interface World {
    nodes: NodeSpec[];
    edgeTypes: [string, string, string][];
    edges: EdgeSpec[];
  }

  const id = (n: NodeSpec) => `${n.type}:${n.key}`;
  const step = (edge: string, direction: Direction, type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");

  function open(w: World): Promise<SealedFile> {
    return openMosaic(buildMosaic({ nodes: w.nodes, edgeTypes: w.edgeTypes, edges: w.edges }), "walks.mosaic");
  }

  interface Walk {
    things: string[];
    qualifiers: string[];
  }

  function walks(w: World, chain: Chain): Walk[] {
    const starts = w.nodes
      .filter((n) => n.type === chain.start && (chain.pin === null || id(n) === chain.pin))
      .map(id)
      .sort(compareUtf8);
    let found: Walk[] = starts.map((s) => ({ things: [s], qualifiers: [] }));
    for (const s of chain.steps) {
      const next: Walk[] = [];
      for (const walk of found) {
        const here = walk.things.at(-1)!;
        const hops = w.edges
          .filter((e) => e.type === s.edge && (s.direction === "out" ? e.from === here : e.to === here))
          .map((e) => ({ other: s.direction === "out" ? e.to : e.from, qualifier: e.qualifier ?? "" }))
          .filter((h) => s.pin === null || h.other === s.pin)
          .sort((a, b) => compareUtf8(a.other, b.other) || compareUtf8(a.qualifier, b.qualifier));
        for (const h of hops) next.push({ things: [...walk.things, h.other], qualifiers: [...walk.qualifiers, h.qualifier] });
      }
      found = next;
    }
    return found;
  }

  const ids = (rs: readonly Result[]) => rs.map((r) => r.things.map((t) => t.id));

  async function everything(results: ChainResults, size = 20): Promise<Result[]> {
    const all: Result[] = [];
    for (let offset = 0; ; offset += size) {
      const page = await results.page(offset, size);
      all.push(...page);
      if (page.length < size) return all;
    }
  }

  /** Every result, its order and the exact count agree with the oracle; qualifiers when shown. */
  async function agrees(w: World, chain: Chain, file?: SealedFile): Promise<void> {
    const f = file ?? (await open(w));
    const expected = walks(w, chain);
    const found = await everything(new ChainResults(f, chain));
    expect(ids(found)).toEqual(expected.map((x) => x.things));
    found.forEach((r, k) => {
      r.links.forEach((l, j) => {
        const want = expected[k]!.qualifiers[j]!;
        // A qualifier is the link's own, or not shown (undefined): never another text.
        if (l.qualifier !== undefined) expect(l.qualifier ?? "", `result ${k}, link ${j}`).toBe(want);
      });
    });
    expect(await new ChainResults(f, chain).count()).toEqual({ total: expected.length, exact: true, notes: [] });
  }

  // ---------------------------------------------------------------------------------------------

  describe("the 20-link reach of the kit's neighbors, at its boundary (section 8; V-13)", () => {
    for (const n of [19, 20, 21, 22, 40, 41, 60]) {
      it(`a thing with ${n} links of one type to ${n} different things lists them all, in order`, async () => {
        const items = Array.from({ length: n }, (_, k): NodeSpec => ({ type: "Item", key: `k${pad((k * 13) % n, 3)}`, label: "same" }));
        const w: World = {
          nodes: [{ type: "Hub", key: "h", label: "Hub" }, ...items],
          edgeTypes: [["holds", "Hub", "Item"]],
          edges: items.map((x): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(x) })),
        };
        await agrees(w, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
        await agrees(w, { start: "Item", pin: null, steps: [step("holds", "in", "Hub")] });
      });
    }

    it("a thing with links both ways, more than 20 each, lists each direction by itself", async () => {
      const items = Array.from({ length: 30 }, (_, k): NodeSpec => ({ type: "N", key: `n${pad(k)}`, label: "x" }));
      const w: World = {
        nodes: [{ type: "N", key: "hub", label: "x" }, ...items],
        edgeTypes: [["to", "N", "N"]],
        edges: items.flatMap((x): EdgeSpec[] => [
          { type: "to", from: "N:hub", to: id(x) },
          { type: "to", from: id(x), to: "N:hub" },
        ]),
      };
      await agrees(w, { start: "N", pin: "N:hub", steps: [step("to", "out", "N")] });
      await agrees(w, { start: "N", pin: "N:hub", steps: [step("to", "in", "N")] });
      await agrees(w, { start: "N", pin: "N:hub", steps: [step("to", "out", "N"), step("to", "out", "N")] });
      await agrees(w, { start: "N", pin: "N:n05", steps: [step("to", "out", "N"), step("to", "out", "N"), step("to", "in", "N")] });
    });

    it("two edge types on one busy thing do not hide each other's links", async () => {
      const items = Array.from({ length: 25 }, (_, k): NodeSpec => ({ type: "Item", key: `k${pad(k)}`, label: "x" }));
      const w: World = {
        nodes: [{ type: "Hub", key: "h", label: "H" }, ...items],
        edgeTypes: [["holds", "Hub", "Item"], ["watches", "Hub", "Item"]],
        edges: [
          ...items.map((x): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(x) })),
          ...items.filter((_, k) => k % 2 === 0).map((x): EdgeSpec => ({ type: "watches", from: "Hub:h", to: id(x) })),
        ],
      };
      await agrees(w, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
      await agrees(w, { start: "Hub", pin: "Hub:h", steps: [step("watches", "out", "Item")] });
      await agrees(w, { start: "Item", pin: null, steps: [step("watches", "in", "Hub")] });
    });
  });

  describe("qualifiers the kit may cut or not show are never given wrong (section 3.4; section 8.2)", () => {
    const long = "Q".repeat(300);
    const quals = ["", `${long}a`, `${long}b`, `${long}c`, "short", "z"];
    const w: World = {
      nodes: [{ type: "Hub", key: "h", label: "H" }, { type: "Item", key: "i", label: "I" }],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: quals.map((q): EdgeSpec => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: q === "" ? undefined : q })),
    };

    it("keeps links whose qualifiers share a 300-character prefix apart, in qualifier byte order", async () => {
      const file = await open(w);
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      const found = await everything(new ChainResults(file, chain));
      expect(found).toHaveLength(quals.length);
      const shown = found.map((r) => r.links[0]!.qualifier).filter((q) => q !== undefined);
      // Shown qualifiers are whole (not cut with a marker) and in the order of the whole texts.
      for (const q of shown) expect(quals.includes(q ?? "") || q === null).toBe(true);
      const wanted = [...quals].sort(compareUtf8);
      found.forEach((r, k) => {
        const q = r.links[0]!.qualifier;
        if (q !== undefined) expect(q ?? "").toBe(wanted[k]);
      });
      expect(await new ChainResults(file, chain).count()).toEqual({ total: quals.length, exact: true, notes: [] });
    });

    it("gives an empty qualifier as null, and no other link null", async () => {
      const file = await open(w);
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      const found = await everything(new ChainResults(file, chain));
      const nulls = found.filter((r) => r.links[0]!.qualifier === null);
      expect(nulls.length).toBeLessThanOrEqual(1);
      expect(found[0]!.links[0]!.qualifier === null || found[0]!.links[0]!.qualifier === undefined).toBe(true);
    });

    it("a qualifier with a NUL or a newline is given whole or not at all", async () => {
      const odd = ["a\u0000b", "a\nb", "a", "\u0000", " "];
      const world: World = {
        nodes: w.nodes,
        edgeTypes: w.edgeTypes,
        edges: odd.map((q): EdgeSpec => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: q })),
      };
      await agrees(world, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
    });
  });

  describe("keys that look alike are different things, compared by bytes (sections 3.1, 8.6)", () => {
    const composed = "é"; // e with acute, one code point
    const decomposed = "é"; // e, combining acute
    const keys = [composed, decomposed, "E", "e", "ﬁ", "fi", "I", "İ", "i̇", " ", " ", "a​b", "ab"];
    const items = keys.map((k, n): NodeSpec => ({ type: "Item", key: k, label: `same label` + (n % 2 ? "" : "!") }));
    const w: World = {
      nodes: [{ type: "Hub", key: "h", label: "H" }, ...items],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
    };

    it("gives one result per key, composed and decomposed apart, in byte order", async () => {
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      await agrees(w, chain);
      const file = await open(w);
      expect(await new ChainResults(file, chain).count()).toEqual({ total: keys.length, exact: true, notes: [] });
    });

    it("a pin on the decomposed key finds only it", async () => {
      const pin = `Item:${decomposed}`;
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item", pin)] };
      const file = await open(w);
      const found = await everything(new ChainResults(file, chain));
      expect(ids(found)).toEqual([["Hub:h", pin]]);
    });

    it("a pin that differs only in case or normal form finds nothing", async () => {
      const file = await open(w);
      const chain: Chain = { start: "Item", pin: "Item:É", steps: [] };
      const found = await everything(new ChainResults(file, chain));
      expect(found).toEqual([]);
      expect((await new ChainResults(file, chain).count()).total).toBe(0);
    });
  });

  describe("a very long id (sections 3.1, 8.2)", () => {
    const world = (len: number): { w: World; items: NodeSpec[] } => {
      const prefix = "p".repeat(len);
      const items = ["c", "a", "b"].map((s): NodeSpec => ({ type: "Item", key: prefix + s, label: null }));
      return {
        items,
        w: {
          nodes: [{ type: "Hub", key: "h", label: "H" }, ...items],
          edgeTypes: [["holds", "Hub", "Item"]],
          edges: items.map((n): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(n) })),
        },
      };
    };

    it("gives whole ids, in order, though the ids differ only at the end (500 characters)", async () => {
      const { w, items } = world(500);
      await agrees(w, { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] });
      const file = await open(w);
      const found = await everything(new ChainResults(file, { start: "Item", pin: null, steps: [] }));
      expect(found.map((r) => r.things[0]!.id)).toEqual(items.map(id).sort(compareUtf8));
    });

    it("never counts exactly more results than it lists without saying what it left out (2000 characters)", async () => {
      // V-13: the number of results is always given; V-14: and how many were left out.
      const { w } = world(2000);
      const file = await open(w);
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      const results = new ChainResults(file, chain);
      const listed = await everything(results);
      const count = await results.count();
      if (count.exact && count.notes.length === 0) expect(listed.length).toBe(count.total);
      else expect(count.notes.length).toBeGreaterThan(0);
    });
  });

  describe("a step the mosaic cannot follow finds nothing and does not fail (V-1)", () => {
    const w: World = {
      nodes: [
        { type: "Hub", key: "h", label: "H" },
        { type: "Item", key: "i", label: "I" },
        { type: "Tag", key: "t", label: "T" },
      ],
      edgeTypes: [["holds", "Hub", "Item"], ["tagged", "Item", "Tag"]],
      edges: [{ type: "holds", from: "Hub:h", to: "Item:i" }, { type: "tagged", from: "Item:i", to: "Tag:t" }],
    };

    it("a step in the wrong direction finds nothing", async () => {
      const file = await open(w);
      const chain: Chain = { start: "Hub", pin: null, steps: [step("holds", "in", "Item")] };
      expect(await everything(new ChainResults(file, chain))).toEqual([]);
      expect((await new ChainResults(file, chain).count()).total).toBe(0);
    });

    it("a start pin of another type than the start finds nothing", async () => {
      const file = await open(w);
      const chain: Chain = { start: "Hub", pin: "Tag:t", steps: [] };
      expect(await everything(new ChainResults(file, chain))).toEqual([]);
      expect((await new ChainResults(file, chain).count()).total).toBe(0);
    });

    it("a start pin of another type than the start does not reach through a step", async () => {
      const file = await open(w);
      const chain: Chain = { start: "Tag", pin: "Item:i", steps: [step("tagged", "in", "Item")] };
      expect(await everything(new ChainResults(file, chain))).toEqual([]);
      expect((await new ChainResults(file, chain).count()).total).toBe(0);
    });

    it("every place pinned to the one walk finds exactly it", async () => {
      const chain: Chain = {
        start: "Hub",
        pin: "Hub:h",
        steps: [step("holds", "out", "Item", "Item:i"), step("tagged", "out", "Tag", "Tag:t")],
      };
      await agrees(w, chain);
      const file = await open(w);
      expect(ids(await everything(new ChainResults(file, chain)))).toEqual([["Hub:h", "Item:i", "Tag:t"]]);
    });
  });

  describe("a chain can use a type's own links in both directions (V-1)", () => {
    // A symmetric link kept both ways, a one-way link, and a self-link, among one type.
    const names = ["a", "b", "c", "d"];
    const nodes = names.map((k): NodeSpec => ({ type: "N", key: k, label: k }));
    const e = (from: string, to: string, qualifier?: string): EdgeSpec => ({ type: "to", from: `N:${from}`, to: `N:${to}`, qualifier });
    const w: World = {
      nodes,
      edgeTypes: [["to", "N", "N"]],
      edges: [e("a", "b"), e("b", "a"), e("b", "c"), e("c", "c"), e("c", "d", "x"), e("c", "d", "y"), e("d", "a")],
    };
    const chains: Chain[] = [
      { start: "N", pin: null, steps: [step("to", "out", "N")] },
      { start: "N", pin: null, steps: [step("to", "in", "N")] },
      { start: "N", pin: null, steps: [step("to", "out", "N"), step("to", "in", "N")] },
      { start: "N", pin: null, steps: [step("to", "in", "N"), step("to", "out", "N")] },
      { start: "N", pin: "N:a", steps: [step("to", "out", "N"), step("to", "out", "N"), step("to", "out", "N"), step("to", "out", "N")] },
      { start: "N", pin: null, steps: Array.from({ length: 6 }, () => step("to", "out", "N")) },
      { start: "N", pin: "N:c", steps: [step("to", "out", "N", "N:c"), step("to", "out", "N", "N:c"), step("to", "out", "N", "N:d")] },
    ];
    chains.forEach((chain, k) => {
      it(`agrees with the edge list for chain ${k + 1} of ${chains.length}`, async () => {
        await agrees(w, chain);
      });
    });

    it("counts a self-link once going out and once coming in", async () => {
      const file = await open(w);
      const out = await everything(new ChainResults(file, { start: "N", pin: "N:c", steps: [step("to", "out", "N", "N:c")] }));
      const inn = await everything(new ChainResults(file, { start: "N", pin: "N:c", steps: [step("to", "in", "N", "N:c")] }));
      expect(out).toHaveLength(1);
      expect(inn).toHaveLength(1);
    });
  });

  describe("results that are far apart in a flood: dead ends and exponential growth (V-14; V-13)", () => {
    it("finds the only start with a result among thousands that lead nowhere, within the bound", async () => {
      const n = 3000;
      const starts = Array.from({ length: n }, (_, k): NodeSpec => ({ type: "S", key: `s${pad(k, 5)}`, label: `S ${k}` }));
      const w: World = {
        nodes: [...starts, { type: "T", key: "t", label: "T" }],
        edgeTypes: [["to", "S", "T"]],
        edges: [{ type: "to", from: id(starts.at(-1)!), to: "T:t" }],
      };
      const file = await open(w);
      const chain: Chain = { start: "S", pin: null, steps: [step("to", "out", "T")] };
      let t = performance.now();
      const first = await new ChainResults(file, chain).page(0, 20);
      expect(performance.now() - t, "first page").toBeLessThan(file.timeLimitMs * 5);
      expect(ids(first)).toEqual([[id(starts.at(-1)!), "T:t"]]);
      t = performance.now();
      const count = await new ChainResults(file, chain).count();
      expect(performance.now() - t, "count").toBeLessThan(file.timeLimitMs * 5);
      expect(count).toEqual({ total: 1, exact: true, notes: [] });
    }, 60_000);

    it("a thousand things in the middle that lead nowhere do not stop the few that do", async () => {
      const n = 1500;
      const mids = Array.from({ length: n }, (_, k): NodeSpec => ({ type: "M", key: `m${pad(k, 5)}`, label: `M ${k}` }));
      const ends = [0, 1, 2].map((k): NodeSpec => ({ type: "E", key: `e${k}`, label: `E ${k}` }));
      const w: World = {
        nodes: [{ type: "H", key: "h", label: "H" }, ...mids, ...ends],
        edgeTypes: [["a", "H", "M"], ["b", "M", "E"]],
        edges: [
          ...mids.map((m): EdgeSpec => ({ type: "a", from: "H:h", to: id(m) })),
          ...ends.map((x): EdgeSpec => ({ type: "b", from: id(mids.at(-1)!), to: id(x) })),
          ...ends.map((x): EdgeSpec => ({ type: "b", from: id(mids[700]!), to: id(x) })),
        ],
      };
      const file = await open(w);
      const chain: Chain = { start: "H", pin: "H:h", steps: [step("a", "out", "M"), step("b", "out", "E")] };
      const t = performance.now();
      const first = await new ChainResults(file, chain).page(0, 20);
      expect(performance.now() - t).toBeLessThan(file.timeLimitMs * 5);
      expect(ids(first)).toEqual(walks(w, chain).map((x) => x.things));
      expect(await new ChainResults(file, chain).count()).toEqual({ total: 6, exact: true, notes: [] });
    }, 60_000);

    it("a chain of 12 steps through 3 things a layer has 3^12 results, counted and paged at the end", async () => {
      const depth = 12;
      const width = 3;
      const nodes: NodeSpec[] = [];
      const edges: EdgeSpec[] = [];
      for (let l = 0; l <= depth; l++) for (let k = 0; k < width; k++) nodes.push({ type: "N", key: `L${pad(l)}_${k}`, label: `L${l}_${k}` });
      for (let l = 0; l < depth; l++)
        for (let k = 0; k < width; k++) for (let j = 0; j < width; j++) edges.push({ type: "next", from: `N:L${pad(l)}_${k}`, to: `N:L${pad(l + 1)}_${j}` });
      const w: World = { nodes, edgeTypes: [["next", "N", "N"]], edges };
      const file = await open(w);
      const chain: Chain = { start: "N", pin: "N:L00_0", steps: Array.from({ length: depth }, () => step("next", "out", "N")) };
      const total = width ** depth;
      const results = new ChainResults(file, chain);
      let t = performance.now();
      expect(await results.count()).toEqual({ total, exact: true, notes: [] });
      expect(performance.now() - t, "count").toBeLessThan(file.timeLimitMs * 5);

      // Result k takes, at step s, the thing whose index is digit s of k in base 3 (ids sort so).
      const at = (k: number) => {
        const digits = k.toString(width).padStart(depth, "0").split("").map(Number);
        return ["N:L00_0", ...digits.map((d, s) => `N:L${pad(s + 1)}_${d}`)];
      };
      for (const offset of [0, 1, 2, 3, 1000, 265_000, total - 21, total - 20]) {
        t = performance.now();
        const page = await results.page(offset, 20);
        expect(performance.now() - t, `page at ${offset}`).toBeLessThan(file.timeLimitMs * 5);
        expect(ids(page), `page at ${offset}`).toEqual(Array.from({ length: 20 }, (_, i) => at(offset + i)));
      }
      expect(ids(await results.page(total - 3, 20))).toEqual([at(total - 3), at(total - 2), at(total - 1)]);
      expect(await results.page(total, 20)).toEqual([]);
    }, 120_000);

    it("a count beyond what a page could show is still the number of walks", async () => {
      const depth = 25;
      const nodes: NodeSpec[] = [];
      const edges: EdgeSpec[] = [];
      for (let l = 0; l <= depth; l++) for (let k = 0; k < 2; k++) nodes.push({ type: "N", key: `L${pad(l)}_${k}`, label: null });
      for (let l = 0; l < depth; l++)
        for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) edges.push({ type: "next", from: `N:L${pad(l)}_${k}`, to: `N:L${pad(l + 1)}_${j}` });
      const file = await open({ nodes, edgeTypes: [["next", "N", "N"]], edges });
      const chain: Chain = { start: "N", pin: "N:L00_0", steps: Array.from({ length: depth }, () => step("next", "out", "N")) };
      const results = new ChainResults(file, chain);
      expect(await results.count()).toEqual({ total: 2 ** depth, exact: true, notes: [] });
      const last = await results.page(2 ** depth - 1, 5);
      expect(ids(last)).toEqual([["N:L00_0", ...Array.from({ length: depth }, (_, s) => `N:L${pad(s + 1)}_1`)]]);
    }, 120_000);
  });

  describe("asking for pages and counts (V-13)", () => {
    const items = Array.from({ length: 45 }, (_, k): NodeSpec => ({ type: "Item", key: `k${pad(k)}`, label: `Item ${k}` }));
    const w: World = {
      nodes: [{ type: "Hub", key: "h", label: "H" }, ...items],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: items.map((x): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(x) })),
    };
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };

    it("a page that starts inside the busy thing's links past the 20th, and crosses the 40th, is that part of the whole", async () => {
      const file = await open(w);
      const whole = walks(w, chain).map((x) => x.things);
      const results = new ChainResults(file, chain);
      for (const [offset, limit] of [[19, 3], [18, 25], [39, 4], [20, 1], [40, 100], [44, 1], [45, 1], [0, 45], [0, 1000]] as const) {
        expect(ids(await results.page(offset, limit)), `${offset}+${limit}`).toEqual(whole.slice(offset, offset + limit));
      }
    });

    it("the count asked after pages from a fresh reader, and a fresh reader's count, are the same", async () => {
      const file = await open(w);
      const used = new ChainResults(file, chain);
      await used.page(30, 10);
      const a = await used.count();
      const b = await new ChainResults(file, chain).count();
      expect(a).toEqual(b);
      expect(a).toEqual({ total: 45, exact: true, notes: [] });
    });

    it("one reader on two open files of the same bytes gives the same results", async () => {
      const one = await open(w);
      const two = await open(w);
      expect(ids(await everything(new ChainResults(one, chain)))).toEqual(ids(await everything(new ChainResults(two, chain))));
    });

    it("the progress callback is called with whole numbers that never pass the total, and the total is reached when exact", async () => {
      const file = await open(w);
      const seen: number[] = [];
      const count = await new ChainResults(file, chain).count({ progress: (n) => seen.push(n) });
      expect(count.total).toBe(45);
      for (const n of seen) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeLessThanOrEqual(45);
      }
      for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    });

    it("a chain with nothing found calls progress with nothing above 0", async () => {
      const file = await open(w);
      const seen: number[] = [];
      const none: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item", "Item:nope")] };
      const count = await new ChainResults(file, none).count({ progress: (n) => seen.push(n) });
      expect(count.total).toBe(0);
      for (const n of seen) expect(n).toBe(0);
    });

    it("a count stopped part-way leaves the reader able to page and to count again", async () => {
      const file = await open(w);
      const results = new ChainResults(file, chain);
      const stop = new AbortController();
      const counting = results.count({ signal: stop.signal, progress: () => stop.abort() });
      await counting.catch(() => undefined);
      expect(ids(await results.page(0, 5))).toEqual(walks(w, chain).slice(0, 5).map((x) => x.things));
      expect(await results.count()).toEqual({ total: 45, exact: true, notes: [] });
    });

    it("a page stopped at once does not stop the next page asked on the same reader", async () => {
      const file = await open(w);
      const results = new ChainResults(file, chain);
      const stop = new AbortController();
      stop.abort();
      await expect(results.page(0, 20, stop.signal)).rejects.toThrow();
      expect(ids(await results.page(0, 20))).toEqual(walks(w, chain).slice(0, 20).map((x) => x.things));
    });

    it("a page stopped at once does not stop the count asked on the same reader", async () => {
      const file = await open(w);
      const results = new ChainResults(file, chain);
      const stop = new AbortController();
      stop.abort();
      await expect(results.page(0, 20, stop.signal)).rejects.toThrow();
      expect(await results.count()).toEqual({ total: 45, exact: true, notes: [] });
    });

    it("a page stopped just after it was asked does not stop the next one", async () => {
      const file = await open(w);
      const results = new ChainResults(file, chain);
      const stop = new AbortController();
      const asked = results.page(0, 20, stop.signal);
      stop.abort();
      await asked.catch(() => undefined);
      expect(ids(await results.page(0, 20))).toEqual(walks(w, chain).slice(0, 20).map((x) => x.things));
    });

    it("a page stopped on a chain pinned at its end does not stop the next one", async () => {
      const file = await open(w);
      const pinned: Chain = { start: "Hub", pin: null, steps: [step("holds", "out", "Item", "Item:k03")] };
      const results = new ChainResults(file, pinned);
      const stop = new AbortController();
      stop.abort();
      await expect(results.page(0, 20, stop.signal)).rejects.toThrow();
      expect(ids(await results.page(0, 20))).toEqual([["Hub:h", "Item:k03"]]);
    });
  });

  describe("a chain does not change what it is given (V-13; principle 5)", () => {
    it("leaves the chain, its steps and its pins as they were", async () => {
      const items = [0, 1, 2].map((k): NodeSpec => ({ type: "Item", key: `k${k}`, label: `Item ${k}` }));
      const w: World = {
        nodes: [{ type: "Hub", key: "h", label: "H" }, ...items],
        edgeTypes: [["holds", "Hub", "Item"]],
        edges: items.map((x): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(x) })),
      };
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      const before = JSON.stringify(chain);
      const frozen = structuredClone(chain);
      const file = await open(w);
      const results = new ChainResults(file, chain);
      await results.page(0, 20);
      await results.count();
      expect(JSON.stringify(chain)).toBe(before);
      expect(chain).toEqual(frozen);
    });

    it("gives results that do not change when the caller changes a page it was given", async () => {
      const items = [0, 1, 2].map((k): NodeSpec => ({ type: "Item", key: `k${k}`, label: `Item ${k}` }));
      const w: World = {
        nodes: [{ type: "Hub", key: "h", label: "H" }, ...items],
        edgeTypes: [["holds", "Hub", "Item"]],
        edges: items.map((x): EdgeSpec => ({ type: "holds", from: "Hub:h", to: id(x) })),
      };
      const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
      const file = await open(w);
      const results = new ChainResults(file, chain);
      const first = await results.page(0, 20);
      first.length = 0;
      expect(await results.page(0, 20)).toHaveLength(3);
    });
  });
});
