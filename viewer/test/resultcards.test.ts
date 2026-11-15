// Chain results as cards (docs/design.md, "Viewer: chains and cards"): V-10, each result of
// a chain shows as a row of cards, one per step, joined by the links that connect them; V-7, a
// type's card looks the same wherever the type appears; V-8, each
// link between two steps opens its source; V-13, the view says which result is shown out of how
// many and moves between results in the same order every time.
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import { buildMosaic, type EdgeSpec, type NodeSpec } from "../../kit/test/build-mosaic.js";
import ResultRow from "../src/components/ResultRow.svelte";
import { type Chain, type Step, type Direction } from "../src/lib/chain.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { PlaceSearches } from "../src/lib/placesearch.svelte.js";
import { resultCards } from "../src/lib/resultcards.js";
import { ChainResults } from "../src/lib/results.js";
import { parseView, Shape } from "../src/lib/view.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";

const step = (edge: string, direction: "out" | "in", type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
/** Items are in groups: Item:a and Item:b, both in Group:x. */
const ITEMS: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };

describe("a result as a row of cards (V-10, V-7)", () => {
  it("one card per place, each the thing's card as its type's card shows it, joined by the links", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const shape = new Shape(parseView({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] }), file);
    const [result] = await new ChainResults(file, ITEMS).page(0, 1);
    const row = await resultCards(file, ITEMS, result!, shape);
    expect(row.things.map((t) => t.id)).toEqual(["Item:a", "Group:x"]);
    // Item's card is the one the view file sets for Item; Group's is its default.
    expect(row.things[0]!.facts.map((f) => (f.kind === "property" ? f.name : f.kind))).toEqual(["code"]);
    expect(row.things[1]!.facts.some((f) => f.kind === "count")).toBe(true);
    expect(row.links).toEqual([expect.objectContaining({ edge: "in_group", direction: "out", from: "Item:a", to: "Group:x", qualifier: null, pairWide: false })]);
  });

  it("each link opens its own source rows through cite (V-8)", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const [result] = await new ChainResults(file, ITEMS).page(0, 1);
    const row = await resultCards(file, ITEMS, result!, null);
    const cited = await file.cite({ from: "Item:a", type: "in_group", to: "Group:x", qualifier: "" });
    if ("error" in cited) throw new Error(cited.error.message);
    expect(row.links[0]!.evidence).toEqual({ rows: cited.data.evidence, total: cited.data.total });
  });

  it("a link followed in: the link still runs from the thing it leaves to the thing it reaches", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const chain: Chain = { start: "Group", pin: null, steps: [step("in_group", "in", "Item")] };
    const [result] = await new ChainResults(file, chain).page(0, 1);
    const row = await resultCards(file, chain, result!, null);
    expect(row.links[0]).toMatchObject({ edge: "in_group", direction: "in", from: "Item:a", to: "Group:x" });
  });

  it("two links between one pair each cite their own; a qualifier the kit does not show cites the pair, and says so", async () => {
    const qualifiers = Array.from({ length: 22 }, (_, n) => `q${String(n).padStart(2, "0")}`);
    const bytes = buildMosaic({
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Item", key: "i", label: "Item i" }],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: qualifiers.map((q) => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: q, evidence: [{ locator: `row=${q}` }] })),
    });
    const file = await openMosaic(bytes, "pair.mosaic");
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
    const results = new ChainResults(file, chain);
    const first = await resultCards(file, chain, (await results.page(0, 1))[0]!, null);
    expect(first.links[0]).toMatchObject({ qualifier: "q00", pairWide: false });
    expect(first.links[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=q00"]);
    // Past the 20th of the pair, neither side lists the link: its rows are the pair's.
    const late = await resultCards(file, chain, (await results.page(21, 1))[0]!, null);
    expect(late.links[0]).toMatchObject({ qualifier: undefined, pairWide: true });
    expect(late.links[0]!.evidence.total).toBe(22);
  });
});

describe("which result, of how many, in the chain's order (V-13)", () => {
  it("starts at the first result, moves to the next and back, and not past either end", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await Promise.all([viewer.counted, viewer.shown]);
    expect(viewer.chainIndex).toBe(0);
    expect(viewer.chainRow?.things.map((t) => t.id)).toEqual(["Item:a", "Group:x"]);
    await viewer.showResult(1);
    expect(viewer.chainRow?.things.map((t) => t.id)).toEqual(["Item:b", "Group:x"]);
    await viewer.showResult(2);
    expect(viewer.chainIndex).toBe(1);
    await viewer.showResult(-1);
    expect(viewer.chainIndex).toBe(0);
    expect(viewer.chainRow?.things[0]!.id).toBe("Item:a");
  });

  it("a changed chain starts again at its first result", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    await viewer.showResult(1);
    viewer.setChain({ ...ITEMS, pin: "Item:b" });
    await viewer.shown;
    expect(viewer.chainIndex).toBe(0);
    expect(viewer.chainRow?.things[0]!.id).toBe("Item:b");
  });

  it("a chain with no results shows none", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain({ ...ITEMS, pin: "Item:nope" });
    await viewer.shown;
    expect(viewer.chainRow).toBeNull();
  });
});

describe("the row, drawn", () => {
  it("while the count has found fewer than the result shown, at least as many as that result", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const [result] = await new ChainResults(file, ITEMS).page(1, 1);
    const row = await resultCards(file, ITEMS, result!, null);
    const { body } = render(ResultRow, { props: { row, index: 1, count: { total: 0, exact: false, done: false, notes: [] }, onmove: () => {} } });
    expect(body).toContain("Result 2 of at least 2");
  });
});

describe("a place's search after the chain changes", () => {
  it("clearing a place forgets its query too", () => {
    const s = new PlaceSearches();
    s.queries["0 x out T"] = "a";
    s.clear("0 x out T");
    expect(s.queries["0 x out T"]).toBeUndefined();
  });
});

describe("moving between results, drawn (V-13)", () => {
  it("at the last result once the count is done: no Next; First and Previous offered", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const [result] = await new ChainResults(file, ITEMS).page(1, 1);
    const row = await resultCards(file, ITEMS, result!, null);
    const { body } = render(ResultRow, { props: { row, index: 1, count: { total: 2, exact: true, done: true, notes: [] }, onmove: () => {} } });
    expect(body).toContain("Result 2 of 2");
    expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Next/);
    expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Previous/);
    expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*First/);
  });

  it("while the count runs, Next stays offered at the last result found", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const [result] = await new ChainResults(file, ITEMS).page(1, 1);
    const row = await resultCards(file, ITEMS, result!, null);
    const { body } = render(ResultRow, { props: { row, index: 1, count: { total: 2, exact: false, done: false, notes: [] }, onmove: () => {} } });
    expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Next/);
  });
});

/** The open mosaic, with `neighbors` and `table` failing as a kit call can. */
function failing(file: object): never {
  const fail = async () => {
    throw new Error("the kit could not read the links");
  };
  return new Proxy(file, {
    get: (target, key) => {
      if (key === "neighbors" || key === "table") return fail;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as never;
}

describe("a result that cannot be shown, or is asked for far past the last", () => {
  it("a kit call that fails: no row, and a message naming the result and what failed", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.file = failing(viewer.file!);
    viewer.setChain(ITEMS);
    await expect(viewer.shown).resolves.toBeUndefined();
    await viewer.counted;
    expect(viewer.chainRow).toBeNull();
    expect(viewer.chainFailure).toContain("Result 1 could not be shown");
    expect(viewer.chainFailure).toContain("the kit could not read the links");
  });

  it("a result shown again after a failure clears the message", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    const file = viewer.file!;
    viewer.file = failing(file);
    viewer.setChain(ITEMS);
    await viewer.shown;
    viewer.file = file;
    viewer.setChain(ITEMS);
    await viewer.shown;
    expect(viewer.chainFailure).toBeNull();
    expect(viewer.chainRow?.things[0]!.id).toBe("Item:a");
  });

  it("far past the last: the last result, in a few walks, not one per result skipped", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    const page = vi.spyOn(ChainResults.prototype, "page");
    try {
      await viewer.showResult(1_000_000);
      expect(viewer.chainIndex).toBe(1);
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:b");
      expect(page.mock.calls.length).toBeLessThanOrEqual(25);
      await viewer.counted;
      page.mockClear();
      // Once the count is done, the last result is known: one walk to find it missing, one to show the last.
      await viewer.showResult(Number.MAX_SAFE_INTEGER);
      expect(viewer.chainIndex).toBe(1);
      expect(page.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      page.mockRestore();
    }
  });

  it("a result asked for while another is being found stops the first's walk", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    const page = vi.spyOn(ChainResults.prototype, "page");
    try {
      const first = viewer.showResult(1);
      const signal = page.mock.calls[0]?.[2];
      const second = viewer.showResult(0);
      await Promise.all([first, second]);
      expect(signal?.aborted).toBe(true);
      expect(viewer.chainIndex).toBe(0);
      expect(viewer.chainFailure).toBeNull();
    } finally {
      page.mockRestore();
    }
  });

  it("a changed chain stops the walk of the result asked for on the chain before", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    const page = vi.spyOn(ChainResults.prototype, "page");
    try {
      const asked = viewer.showResult(1);
      const signal = page.mock.calls[0]?.[2];
      viewer.setChain(null);
      await asked;
      expect(signal?.aborted).toBe(true);
      expect(viewer.chainRow).toBeNull();
    } finally {
      page.mockRestore();
    }
  });
});

describe("a card chosen or read again changes the row's cards too (V-7)", () => {
  const props = (row: { things: readonly { facts: readonly { kind: string; name?: string }[] }[] } | null) =>
    row?.things[0]!.facts.map((f) => (f.kind === "property" ? f.name : f.kind));

  it("a card chosen in the page: the result shown is drawn again with it, and with the view file's when reset", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    await viewer.showResult(1);
    const before = props(viewer.chainRow);
    await viewer.chooseCard({ name: "Item", show: ["code"], links: [], counts: [] });
    await viewer.shown;
    expect(viewer.chainIndex).toBe(1);
    expect(props(viewer.chainRow)).toEqual(["code"]);
    await viewer.resetCard("Item");
    await viewer.shown;
    expect(props(viewer.chainRow)).toEqual(before);
  });

  it("a view file read again: the result shown takes its cards", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    await viewer.setView(parseView({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] }));
    await viewer.shown;
    expect(props(viewer.chainRow)).toEqual(["code"]);
  });
});

describe("a card chosen while a move is on its way (V-7, V-13)", () => {
  it("the move still lands, drawn with the new card", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    const move = viewer.showResult(1);
    const chosen = viewer.chooseCard({ name: "Item", show: ["code"], links: [], counts: [] });
    await Promise.all([move, chosen, viewer.shown]);
    expect(viewer.chainIndex).toBe(1);
    expect(viewer.chainRow?.things[0]!.id).toBe("Item:b");
    expect(viewer.chainRow?.things[0]!.facts.map((f) => (f.kind === "property" ? f.name : f.kind))).toEqual(["code"]);
  });
});

describe("a qualifier the kit cut (section 8.2: 400 characters and the marker)", () => {
  const oneEdge = async (qualifiers: string[], at = 0) => {
    const bytes = buildMosaic({
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Item", key: "i", label: "Item i" }],
      edgeTypes: [["holds", "Hub", "Item"]],
      edges: qualifiers.map((q, n) => ({ type: "holds", from: "Hub:h", to: "Item:i", qualifier: q, evidence: [{ locator: `row=${n}` }] })),
    });
    const file = await openMosaic(bytes, "cut.mosaic");
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("holds", "out", "Item")] };
    const [result] = await new ChainResults(file, chain).page(at, 1);
    return resultCards(file, chain, result!, null);
  };

  it("is shown as the kit shows it, and cites the pair, saying so", async () => {
    const row = await oneEdge(["q".repeat(500)]);
    expect(row.links[0]).toMatchObject({ qualifier: `${"q".repeat(400)}…`, pairWide: true });
    expect(row.links[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=0"]);
  });

  it("one stored as 400 characters and the marker is the link itself: its own rows", async () => {
    // Its result comes second: "a" sorts first.
    const link = (await oneEdge([`${"q".repeat(400)}…`, "a"], 1)).links[0]!;
    expect(link).toMatchObject({ qualifier: `${"q".repeat(400)}…`, pairWide: false });
    expect(link.evidence.rows.map((r) => r.locator)).toEqual(["row=0"]);
  });
});

describe("resultcards: further cases", () => {
  const step = (edge: string, direction: Direction, type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
  const none = (total: number, exact = true) => ({ total, exact, done: exact, notes: [] });
  const noop = () => {};

  const NODES: NodeSpec[] = [
    { type: "A", key: "a", label: "A a" },
    { type: "B", key: "b", label: "B b" },
    { type: "C", key: "c", label: "C c" },
    { type: "D", key: "d", label: "D d" },
  ];
  const LINE = {
    nodes: NODES,
    edgeTypes: [["ab", "A", "B"], ["bc", "B", "C"], ["cd", "C", "D"]] as [string, string, string][],
    edges: [
      { type: "ab", from: "A:a", to: "B:b", evidence: [{ locator: "row=ab" }] },
      { type: "bc", from: "B:b", to: "C:c", evidence: [{ locator: "row=bc1" }, { locator: "row=bc2" }] },
      { type: "cd", from: "C:c", to: "D:d", evidence: [{ locator: "row=cd" }] },
    ] as EdgeSpec[],
  };
  const LONG: Chain = { start: "A", pin: null, steps: [step("ab", "out", "B"), step("bc", "out", "C"), step("cd", "out", "D")] };

  async function firstRow(file: Awaited<ReturnType<typeof openMosaic>>, chain: Chain, at = 0, shape: Shape | null = null) {
    const [result] = await new ChainResults(file, chain).page(at, 1);
    if (result === undefined) throw new Error(`no result ${at}`);
    return resultCards(file, chain, result, shape);
  }

  describe("one card per step, one link between each two (V-10)", () => {
    it("a chain of three steps gives four cards and three links, in the chain's order", async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      const row = await firstRow(file, LONG);
      expect(row.things.map((t) => t.id)).toEqual(["A:a", "B:b", "C:c", "D:d"]);
      expect(row.links.map((l) => [l.edge, l.from, l.to])).toEqual([["ab", "A:a", "B:b"], ["bc", "B:b", "C:c"], ["cd", "C:c", "D:d"]]);
    });

    it("each link cites its own rows, not those of its neighbours (V-8)", async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      const row = await firstRow(file, LONG);
      expect(row.links.map((l) => l.evidence.rows.map((r) => r.locator))).toEqual([["row=ab"], ["row=bc1", "row=bc2"], ["row=cd"]]);
      expect(row.links.map((l) => l.evidence.total)).toEqual([1, 2, 1]);
    });

    it("a chain with no step gives one card and no link", async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      const chain: Chain = { start: "A", pin: null, steps: [] };
      const row = await firstRow(file, chain);
      expect(row.things.map((t) => t.id)).toEqual(["A:a"]);
      expect(row.links).toEqual([]);
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } });
      expect(body.match(/<article class="card/g)).toHaveLength(1);
      expect(body).not.toContain("data-link=");
      expect(body).toContain("Result 1 of 1");
    });

    it("a row drawn gives one card and one link per step of a long chain, each link naming its type", async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      const row = await firstRow(file, LONG);
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } });
      expect(body.match(/<article class="card/g)).toHaveLength(4);
      expect(body.match(/data-link="/g)).toHaveLength(3);
      for (const [i, name] of ["ab", "bc", "cd"].entries()) expect(body.split(`data-link="${i}"`)[1]!.split("data-link=")[0]).toContain(name);
    });

    it("a link followed in is drawn differently from the same link followed out", async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      const out = await firstRow(file, { start: "A", pin: null, steps: [step("ab", "out", "B")] });
      const into = await firstRow(file, { start: "B", pin: null, steps: [step("ab", "in", "A")] });
      expect(into.links[0]).toMatchObject({ direction: "in", from: "A:a", to: "B:b" });
      const a = render(ResultRow, { props: { row: out, index: 0, count: none(1), onmove: noop } }).body;
      const b = render(ResultRow, { props: { row: into, index: 0, count: none(1), onmove: noop } }).body;
      const link = (body: string) => body.split('data-link="0"')[1]!;
      expect(link(a)).toContain("ab");
      expect(link(b)).toContain("ab");
      expect(link(a).match(/ab\s*[^\s<]*/)![0]).not.toBe(link(b).match(/ab\s*[^\s<]*/)![0]);
    });

    it("a thing linked to itself is two cards joined by one link that leaves and reaches it", async () => {
      const bytes = buildMosaic({
        nodes: [{ type: "H", key: "h", label: "H h" }],
        edgeTypes: [["loop", "H", "H"]],
        edges: [{ type: "loop", from: "H:h", to: "H:h", evidence: [{ locator: "row=loop" }] }],
      });
      const file = await openMosaic(bytes, "loop.mosaic");
      const chain: Chain = { start: "H", pin: null, steps: [step("loop", "out", "H")] };
      const row = await firstRow(file, chain);
      expect(row.things.map((t) => t.id)).toEqual(["H:h", "H:h"]);
      expect(row.links[0]).toMatchObject({ from: "H:h", to: "H:h" });
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } });
      expect(body.match(/<article class="card/g)).toHaveLength(2);
    });

    it("the same row twice is the same row (determinism)", async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      const one = await firstRow(file, LONG);
      const two = await firstRow(file, LONG);
      expect(JSON.stringify(two)).toBe(JSON.stringify(one));
      const html = (row: typeof one) => render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } }).body;
      expect(html(two)).toBe(html(one));
    });
  });

  describe("a link between two steps keeps its source (V-8)", () => {
    it("a link with a lot of evidence says how many rows it has", async () => {
      const bytes = buildMosaic({
        nodes: NODES.slice(0, 2),
        edgeTypes: [["ab", "A", "B"]],
        edges: [{ type: "ab", from: "A:a", to: "B:b", evidence: Array.from({ length: 60 }, (_, n) => ({ locator: `row=${String(n).padStart(3, "0")}` })) }],
      });
      const file = await openMosaic(bytes, "many.mosaic");
      const row = await firstRow(file, { start: "A", pin: null, steps: [step("ab", "out", "B")] });
      expect(row.links[0]!.evidence.total).toBe(60);
      expect(row.links[0]!.evidence.rows.length).toBeGreaterThan(0);
      expect(row.links[0]!.evidence.rows.length).toBeLessThanOrEqual(60);
    });

    it("exactly 20 links between a pair are all listed, each with its own qualifier and rows", async () => {
      const qs = Array.from({ length: 20 }, (_, n) => `q${String(n).padStart(2, "0")}`);
      const bytes = buildMosaic({
        nodes: NODES.slice(0, 2),
        edgeTypes: [["ab", "A", "B"]],
        edges: qs.map((q) => ({ type: "ab", from: "A:a", to: "B:b", qualifier: q, evidence: [{ locator: `row=${q}` }] })),
      });
      const file = await openMosaic(bytes, "twenty.mosaic");
      const chain: Chain = { start: "A", pin: null, steps: [step("ab", "out", "B")] };
      for (const [n, q] of qs.entries()) {
        const row = await firstRow(file, chain, n);
        expect(row.links[0], `result ${n}`).toMatchObject({ qualifier: q, pairWide: false });
        expect(row.links[0]!.evidence.rows.map((r) => r.locator)).toEqual([`row=${q}`]);
      }
    });

    it("a link with an empty qualifier and one with a qualifier are told apart", async () => {
      const bytes = buildMosaic({
        nodes: NODES.slice(0, 2),
        edgeTypes: [["ab", "A", "B"]],
        edges: [
          { type: "ab", from: "A:a", to: "B:b", qualifier: "", evidence: [{ locator: "row=plain" }] },
          { type: "ab", from: "A:a", to: "B:b", qualifier: "x", evidence: [{ locator: "row=x" }] },
        ],
      });
      const file = await openMosaic(bytes, "q.mosaic");
      const chain: Chain = { start: "A", pin: null, steps: [step("ab", "out", "B")] };
      const first = await firstRow(file, chain, 0);
      const second = await firstRow(file, chain, 1);
      expect(first.links[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=plain"]);
      expect(first.links[0]!.qualifier).toBeNull();
      expect(second.links[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=x"]);
      expect(second.links[0]!.qualifier).toBe("x");
    });
  });

  describe("a type's card is the same wherever the type appears (V-7)", () => {
    it("a thing's card is the same in two different chains", async () => {
      const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
      const shape = new Shape(parseView({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] }), file);
      const forward: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
      const backward: Chain = { start: "Group", pin: null, steps: [step("in_group", "in", "Item")] };
      const a = (await firstRow(file, forward, 0, shape)).things[0]!;
      const b = (await firstRow(file, backward, 0, shape)).things[1]!;
      expect(a.id).toBe("Item:a");
      expect(b.id).toBe("Item:a");
      expect(JSON.stringify(b.facts)).toBe(JSON.stringify(a.facts));
      expect(a.facts.map((f) => (f.kind === "property" ? f.name : f.kind))).toEqual(["code"]);
    });

    it("a card the view file sets is used at every place of the chain where its type appears", async () => {
      const file = await openMosaic(buildMosaic({
        nodes: [{ type: "H", key: "h", label: "H h", props: '{"p":1,"q":2}' }, { type: "H", key: "i", label: "H i", props: '{"p":3,"q":4}' }],
        typeProps: { H: '{"p":"number","q":"number"}' },
        edgeTypes: [["next", "H", "H"]],
        edges: [{ type: "next", from: "H:h", to: "H:i" }],
      }), "h.mosaic");
      const shape = new Shape(parseView({ cards: [{ name: "H", show: ["q"], links: [], counts: [] }] }), file);
      const row = await firstRow(file, { start: "H", pin: "H:h", steps: [step("next", "out", "H")] }, 0, shape);
      const names = row.things.map((t) => t.facts.filter((f) => f.kind === "property").map((f) => (f.kind === "property" ? f.name : "")));
      expect(names).toEqual([["q"], ["q"]]);
    });
  });

  describe("which result, of how many (V-13)", () => {
    const rowOf = async () => {
      const file = await openMosaic(buildMosaic(LINE), "line.mosaic");
      return firstRow(file, LONG);
    };

    it("the only result has neither Previous nor Next to go to", async () => {
      const row = await rowOf();
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } });
      expect(body).toContain("Result 1 of 1");
      expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Previous/);
      expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Next/);
    });

    it("the last of several results has Previous and no Next", async () => {
      const row = await rowOf();
      const { body } = render(ResultRow, { props: { row, index: 2, count: none(3), onmove: noop } });
      expect(body).toContain("Result 3 of 3");
      expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Previous/);
      expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Next/);
    });

    it("a middle result has both", async () => {
      const row = await rowOf();
      const { body } = render(ResultRow, { props: { row, index: 1, count: none(3), onmove: noop } });
      expect(body).toContain("Result 2 of 3");
      expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Previous/);
      expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Next/);
    });

    it("while the count runs, a result short of the end still has a Next", async () => {
      const row = await rowOf();
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1, false), onmove: noop } });
      expect(body).toContain("Result 1 of at least 1");
      expect(body).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Next/);
    });

    it("a count not yet started still says which result is shown, never undefined or NaN", async () => {
      const row = await rowOf();
      const { body } = render(ResultRow, { props: { row, index: 0, count: null, onmove: noop } });
      expect(body).toContain("Result 1");
      expect(body).not.toMatch(/undefined|NaN|null/);
    });

    it("a count in the millions is said in full, whatever grouping its digits get", async () => {
      const row = await rowOf();
      const { body } = render(ResultRow, { props: { row, index: 1233, count: none(1234567), onmove: noop } });
      const text = body.replace(/<[^>]*>/g, " ");
      expect(text.replace(/[,\s  .]/g, "")).toContain("Result1234of1234567");
    });
  });

  describe("the page draws only text, whatever the mosaic holds (V-8, principle 4)", () => {
    it("markup in a label, a key, a qualifier and a locator is shown as text, not run", async () => {
      const hostile = '<img src=x onerror="alert(1)">';
      const bytes = buildMosaic({
        nodes: [{ type: "A", key: "<b>a</b>", label: hostile }, { type: "B", key: "b", label: `</article>${hostile}` }],
        edgeTypes: [["ab", "A", "B"]],
        edges: [{ type: "ab", from: "A:<b>a</b>", to: "B:b", qualifier: hostile, evidence: [{ locator: hostile, snippet: hostile }] }],
      });
      const file = await openMosaic(bytes, "hostile.mosaic");
      const row = await firstRow(file, { start: "A", pin: null, steps: [step("ab", "out", "B")] });
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } });
      expect(body).not.toContain("<img");
      expect(body).not.toContain("<b>a</b>");
      expect(body.match(/<article class="card/g)).toHaveLength(2);
    });

    it("things whose order by UTF-8 bytes differs from UTF-16 keep the chain's order in the row", async () => {
      const file = await openMosaic(reading("non-ascii.mosaic"), "non-ascii.mosaic");
      const chain: Chain = { start: "Item", pin: null, steps: [] };
      const results = await new ChainResults(file, chain).page(0, 20);
      const ids = results.map((r) => r.things[0]!.id);
      const rows = [];
      for (const r of results) rows.push((await resultCards(file, chain, r, null)).things[0]!.id);
      expect(rows).toEqual(ids);
      expect(new Set(rows).size).toBe(rows.length);
    });
  });

  describe("the viewer moves between results (V-13)", () => {
    const ITEMS: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
    const open = async () => {
      const viewer = new Viewer();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      return viewer;
    };

    it("an index far past the end (100 000) shows the last result; one far before the start, the first", async () => {
      const viewer = await open();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      const total = viewer.chainCount!.total;
      expect(total).toBeGreaterThan(1);
      await viewer.showResult(100_000);
      expect(viewer.chainIndex).toBe(total - 1);
      expect(viewer.chainRow).not.toBeNull();
      await viewer.showResult(-1e9);
      expect(viewer.chainIndex).toBe(0);
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:a");
    });

    it("every result, one after the other, comes in the order the chain's results are listed", async () => {
      const viewer = await open();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      const total = viewer.chainCount!.total;
      const file = viewer.file!;
      const listed = await new ChainResults(file, ITEMS).page(0, total + 5);
      expect(listed).toHaveLength(total);
      const seen: string[][] = [];
      for (let i = 0; i < total; i++) {
        await viewer.showResult(i);
        expect(viewer.chainIndex).toBe(i);
        seen.push(viewer.chainRow!.things.map((t) => t.id));
      }
      expect(seen).toEqual(listed.map((r) => r.things.map((t) => t.id)));
    });

    it("two viewers on the same mosaic and chain show the same results in the same order", async () => {
      const run = async () => {
        const viewer = await open();
        viewer.setChain(ITEMS);
        await Promise.all([viewer.counted, viewer.shown]);
        const out: string[] = [];
        for (let i = 0; i < viewer.chainCount!.total; i++) {
          await viewer.showResult(i);
          out.push(JSON.stringify(viewer.chainRow));
        }
        return out;
      };
      expect(await run()).toEqual(await run());
    });

    it("two moves asked at once end on the later one", async () => {
      const viewer = await open();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      await Promise.all([viewer.showResult(1), viewer.showResult(0)]);
      expect(viewer.chainIndex).toBe(0);
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:a");
      await Promise.all([viewer.showResult(0), viewer.showResult(1)]);
      expect(viewer.chainIndex).toBe(1);
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:b");
    });

    it("a move still running when the chain changes does not show the old chain's result", async () => {
      const viewer = await open();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      const late = viewer.showResult(1);
      viewer.setChain({ ...ITEMS, pin: "Item:a" });
      await Promise.all([late, viewer.shown]);
      expect(viewer.chain?.pin).toBe("Item:a");
      expect(viewer.chainIndex).toBe(0);
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:a");
    });

    it("no chain shows no row and no count; clearing the chain clears both", async () => {
      const viewer = await open();
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainCount).toBeNull();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      expect(viewer.chainRow).not.toBeNull();
      viewer.setChain(null);
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainCount).toBeNull();
      await viewer.showResult(1);
      expect(viewer.chainRow).toBeNull();
    });

    it("a move with no chain, or on a mosaic with no results, does not throw and shows no row", async () => {
      const viewer = new Viewer();
      await expect(viewer.showResult(0)).resolves.toBeUndefined();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      viewer.setChain({ ...ITEMS, pin: "Item:nope" });
      await viewer.shown;
      await viewer.showResult(3);
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainIndex).toBe(0);
    });
  });
});

describe("resultcards: further cases", () => {
  const step = (edge: string, direction: Direction, type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
  const none = (total: number) => ({ total, exact: true, done: true, notes: [] });
  const noop = () => {};
  const ITEMS: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
  const codeCard = { name: "Item", show: ["code"], links: [], counts: [] };
  const facts = (row: { things: readonly { facts: readonly { kind: string; name?: string }[] }[] } | null, at = 0) =>
    row?.things[at]!.facts.map((f) => (f.kind === "property" ? f.name : f.kind));

  async function opened() {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    return viewer;
  }

  /** The open mosaic with `neighbors` and `table` failing while `broken.on` is set. */
  function flaky(file: object, broken: { on: boolean }): never {
    return new Proxy(file, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if ((key === "neighbors" || key === "table") && broken.on) {
          return async () => {
            throw new Error("the kit could not read the links");
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    }) as never;
  }

  describe("a card chosen with nothing, or something else, to redraw (V-7)", () => {
    it("a card chosen with no chain open does not throw and shows no row", async () => {
      const viewer = await opened();
      await expect(viewer.chooseCard(codeCard)).resolves.toBeUndefined();
      await expect(viewer.resetCard("Item")).resolves.toBeUndefined();
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainFailure).toBeNull();
    });

    it("a card chosen for a type the row does not hold leaves the result shown as it was", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await viewer.shown;
      await viewer.showResult(1);
      const before = JSON.stringify(viewer.chainRow);
      await viewer.chooseCard({ name: "Nothing", show: [], links: [], counts: [] });
      await viewer.shown;
      expect(viewer.chainIndex).toBe(1);
      expect(JSON.stringify(viewer.chainRow)).toBe(before);
    });

    it("a card reset when none was chosen leaves the result shown as it was", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await viewer.shown;
      const before = JSON.stringify(viewer.chainRow);
      await viewer.resetCard("Item");
      await viewer.shown;
      expect(JSON.stringify(viewer.chainRow)).toBe(before);
    });

    it("a card chosen stays chosen as the person moves to other results", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await viewer.shown;
      await viewer.chooseCard(codeCard);
      await viewer.shown;
      for (const at of [1, 0, 1]) {
        await viewer.showResult(at);
        expect(facts(viewer.chainRow), `result ${at}`).toEqual(["code"]);
      }
    });

    it("two cards chosen one right after the other: the last one is drawn", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await viewer.shown;
      const other = { name: "Item", show: ["label"], links: [], counts: [] };
      await Promise.all([viewer.chooseCard(other), viewer.chooseCard(codeCard)]);
      await viewer.shown;
      expect(facts(viewer.chainRow)).toEqual(["code"]);
      await Promise.all([viewer.chooseCard(codeCard), viewer.resetCard("Item")]);
      await viewer.shown;
      expect(facts(viewer.chainRow)).not.toEqual(["code"]);
    });

    it("a card chosen, then the chain cleared before the redraw ends: no row comes back", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await viewer.shown;
      const chosen = viewer.chooseCard(codeCard);
      viewer.setChain(null);
      await Promise.all([chosen, viewer.shown]);
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainCount).toBeNull();
    });

    it("a card chosen, then a new chain set at once: the new chain's first result is drawn with the card", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await viewer.shown;
      await viewer.showResult(1);
      const chosen = viewer.chooseCard(codeCard);
      viewer.setChain({ ...ITEMS, pin: "Item:b" });
      await Promise.all([chosen, viewer.shown]);
      expect(viewer.chainIndex).toBe(0);
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:b");
      expect(facts(viewer.chainRow)).toEqual(["code"]);
    });

    it("a card chosen applies to the chain's other cards of that type, and not to the others", async () => {
      const viewer = await opened();
      const chain: Chain = { start: "Group", pin: null, steps: [step("in_group", "in", "Item")] };
      viewer.setChain(chain);
      await viewer.shown;
      const plain = facts(viewer.chainRow, 0);
      await viewer.chooseCard(codeCard);
      await viewer.shown;
      expect(viewer.chainRow?.things[1]!.id).toBe("Item:a");
      expect(facts(viewer.chainRow, 1)).toEqual(["code"]);
      expect(facts(viewer.chainRow, 0)).toEqual(plain);
    });
  });

  describe("a kit that fails while the person moves (V-13)", () => {
    it("a move to a result that cannot be shown leaves no stale row and names that result", async () => {
      const viewer = await opened();
      const broken = { on: false };
      viewer.file = flaky(viewer.file!, broken);
      viewer.setChain(ITEMS);
      await viewer.shown;
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:a");
      broken.on = true;
      await viewer.showResult(1);
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainFailure).toContain("Result 2 could not be shown");
      expect(viewer.chainFailure).toContain("the kit could not read the links");
    });

    it("a move that works after one that failed clears the message and shows the result", async () => {
      const viewer = await opened();
      const broken = { on: false };
      viewer.file = flaky(viewer.file!, broken);
      viewer.setChain(ITEMS);
      await viewer.shown;
      broken.on = true;
      await viewer.showResult(1);
      expect(viewer.chainFailure).not.toBeNull();
      broken.on = false;
      await viewer.showResult(1);
      expect(viewer.chainFailure).toBeNull();
      expect(viewer.chainRow?.things[0]!.id).toBe("Item:b");
    });

    it("clearing the chain clears the failure message", async () => {
      const viewer = await opened();
      const broken = { on: true };
      viewer.file = flaky(viewer.file!, broken);
      viewer.setChain(ITEMS);
      await viewer.shown;
      expect(viewer.chainFailure).not.toBeNull();
      viewer.setChain(null);
      expect(viewer.chainFailure).toBeNull();
      expect(viewer.chainRow).toBeNull();
    });

    it("a card chosen while the kit fails does not throw and says what failed", async () => {
      const viewer = await opened();
      const broken = { on: false };
      viewer.file = flaky(viewer.file!, broken);
      viewer.setChain(ITEMS);
      await viewer.shown;
      broken.on = true;
      await expect(viewer.chooseCard(codeCard)).resolves.toBeUndefined();
      await viewer.shown;
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainFailure).toContain("the kit could not read the links");
    });

    it("a failure message never prints undefined or [object Object] when the kit throws a non-Error", async () => {
      const viewer = await opened();
      const file = viewer.file!;
      viewer.file = new Proxy(file, {
        get: (target, key) => {
          const value: unknown = Reflect.get(target, key, target);
          if (key === "neighbors") return async () => Promise.reject("plain text refusal");
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      }) as never;
      viewer.setChain(ITEMS);
      await viewer.shown;
      expect(viewer.chainRow).toBeNull();
      expect(viewer.chainFailure).toContain("Result 1 could not be shown");
      expect(viewer.chainFailure).not.toMatch(/undefined|\[object Object\]/);
    });
  });

  describe("indexes that are not whole numbers, or are at the edge (V-13)", () => {
    it("NaN and Infinity never give an index that is not a whole result", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      const total = viewer.chainCount!.total;
      for (const at of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        await viewer.showResult(at);
        expect(Number.isInteger(viewer.chainIndex), `${at}`).toBe(true);
        expect(viewer.chainIndex).toBeGreaterThanOrEqual(0);
        expect(viewer.chainIndex).toBeLessThan(total);
        expect(viewer.chainRow).not.toBeNull();
      }
      await viewer.showResult(Number.POSITIVE_INFINITY);
      expect(viewer.chainIndex).toBe(total - 1);
      await viewer.showResult(Number.NEGATIVE_INFINITY);
      expect(viewer.chainIndex).toBe(0);
    });

    it("a fraction shows a whole result next to it", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      await viewer.showResult(0.5);
      expect(Number.isInteger(viewer.chainIndex)).toBe(true);
      expect([0, 1]).toContain(viewer.chainIndex);
    });

    it("the last result, the one just past it and the one just before it", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      const total = viewer.chainCount!.total;
      await viewer.showResult(total - 1);
      expect(viewer.chainIndex).toBe(total - 1);
      const last = JSON.stringify(viewer.chainRow);
      await viewer.showResult(total);
      expect(viewer.chainIndex).toBe(total - 1);
      expect(JSON.stringify(viewer.chainRow)).toBe(last);
      await viewer.showResult(-0);
      expect(viewer.chainIndex + 0).toBe(0);
    });

    it("moving to the result already shown shows it again, unchanged", async () => {
      const viewer = await opened();
      viewer.setChain(ITEMS);
      await Promise.all([viewer.counted, viewer.shown]);
      await viewer.showResult(1);
      const before = JSON.stringify(viewer.chainRow);
      await viewer.showResult(1);
      expect(viewer.chainIndex).toBe(1);
      expect(JSON.stringify(viewer.chainRow)).toBe(before);
    });
  });

  describe("many results: each one the one the chain lists at that place (V-13)", () => {
    const nodes: NodeSpec[] = [{ type: "G", key: "g", label: "G g" }];
    const edges: EdgeSpec[] = [];
    for (let n = 0; n < 600; n++) {
      const key = `i${String(n).padStart(4, "0")}`;
      nodes.push({ type: "I", key, label: `I ${key}` });
      edges.push({ type: "of", from: `I:${key}`, to: "G:g", evidence: [{ locator: `row=${key}` }] });
    }
    const MANY = buildMosaic({ nodes, edgeTypes: [["of", "I", "G"]], edges });
    const CHAIN: Chain = { start: "I", pin: null, steps: [step("of", "out", "G")] };

    it("results across page boundaries are the listed ones, each with its own link's rows", async () => {
      const viewer = new Viewer();
      await viewer.open(MANY, "many.mosaic");
      viewer.setChain(CHAIN);
      await Promise.all([viewer.counted, viewer.shown]);
      expect(viewer.chainCount).toMatchObject({ total: 600, exact: true });
      const listed = await new ChainResults(viewer.file!, CHAIN).page(0, 600);
      expect(listed).toHaveLength(600);
      for (const at of [0, 1, 19, 20, 21, 49, 50, 51, 99, 100, 101, 255, 256, 257, 511, 512, 598, 599]) {
        await viewer.showResult(at);
        expect(viewer.chainIndex).toBe(at);
        const row = viewer.chainRow!;
        expect(row.things.map((t) => t.id), `result ${at}`).toEqual(listed[at]!.things.map((t) => t.id));
        expect(row.links[0]!.evidence.rows.map((r) => r.locator)).toEqual([`row=${row.things[0]!.id.slice(2)}`]);
      }
    });

    it("backwards from the end gives the same results as forwards", async () => {
      const viewer = new Viewer();
      await viewer.open(MANY, "many.mosaic");
      viewer.setChain(CHAIN);
      await Promise.all([viewer.counted, viewer.shown]);
      const forward: string[] = [];
      for (const at of [10, 300, 599]) {
        await viewer.showResult(at);
        forward.push(viewer.chainRow!.things[0]!.id);
      }
      const backward: string[] = [];
      for (const at of [599, 300, 10]) {
        await viewer.showResult(at);
        backward.push(viewer.chainRow!.things[0]!.id);
      }
      expect(backward.reverse()).toEqual(forward);
      expect(forward).toEqual(["I:i0010", "I:i0300", "I:i0599"]);
    });

    it("far past the last of 600 is the last, 'Result 600 of 600' once counted", async () => {
      const viewer = new Viewer();
      await viewer.open(MANY, "many.mosaic");
      viewer.setChain(CHAIN);
      await viewer.shown;
      await viewer.showResult(10_000_000);
      expect(viewer.chainIndex).toBe(599);
      expect(viewer.chainRow?.things[0]!.id).toBe("I:i0599");
      await viewer.counted;
      const { body } = render(ResultRow, { props: { row: viewer.chainRow!, index: viewer.chainIndex, count: viewer.chainCount, onmove: noop } });
      expect(body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).toContain("Result 600 of 600");
    });
  });

  describe("links in both directions, and what a path can come back to (V-10, V-8)", () => {
    const NODES: NodeSpec[] = [
      { type: "A", key: "a1", label: "A a1" },
      { type: "A", key: "a2", label: "A a2" },
      { type: "B", key: "b", label: "B b" },
    ];
    const EDGES: EdgeSpec[] = [
      { type: "ab", from: "A:a1", to: "B:b", evidence: [{ locator: "row=1" }] },
      { type: "ab", from: "A:a2", to: "B:b", evidence: [{ locator: "row=2" }] },
    ];
    const mosaic = () => openMosaic(buildMosaic({ nodes: NODES, edgeTypes: [["ab", "A", "B"]], edges: EDGES }), "ab.mosaic");

    it("out then in through the same type: two cards of A around one of B, the links in opposite directions", async () => {
      const file = await mosaic();
      const chain: Chain = { start: "A", pin: "A:a1", steps: [step("ab", "out", "B"), step("ab", "in", "A")] };
      const results = await new ChainResults(file, chain).page(0, 10);
      expect(results).toHaveLength(2);
      const rows = [];
      for (const r of results) rows.push(await resultCards(file, chain, r, null));
      expect(rows.map((r) => r.things.map((t) => t.id))).toEqual([["A:a1", "B:b", "A:a1"], ["A:a1", "B:b", "A:a2"]]);
      expect(rows[1]!.links.map((l) => [l.direction, l.from, l.to])).toEqual([["out", "A:a1", "B:b"], ["in", "A:a2", "B:b"]]);
      expect(rows[1]!.links.map((l) => l.evidence.rows.map((e) => e.locator))).toEqual([["row=1"], ["row=2"]]);
      const { body } = render(ResultRow, { props: { row: rows[1]!, index: 1, count: none(2), onmove: noop } });
      expect(body.match(/<article class="card/g)).toHaveLength(3);
      expect(body.match(/data-link="/g)).toHaveLength(2);
    });

    it("past the 20th link of a pair followed in, the link is the pair's, still running from the thing it leaves", async () => {
      const qs = Array.from({ length: 22 }, (_, n) => `q${String(n).padStart(2, "0")}`);
      const bytes = buildMosaic({
        nodes: [{ type: "P", key: "p", label: "P p" }, { type: "Q", key: "q", label: "Q q" }],
        edgeTypes: [["pq", "P", "Q"]],
        edges: qs.map((q) => ({ type: "pq", from: "P:p", to: "Q:q", qualifier: q, evidence: [{ locator: `row=${q}` }, { locator: `row=${q}b` }] })),
      });
      const file = await openMosaic(bytes, "pq.mosaic");
      const chain: Chain = { start: "Q", pin: "Q:q", steps: [step("pq", "in", "P")] };
      const results = new ChainResults(file, chain);
      const first = await resultCards(file, chain, (await results.page(0, 1))[0]!, null);
      expect(first.links[0]).toMatchObject({ direction: "in", from: "P:p", to: "Q:q", qualifier: "q00", pairWide: false });
      const late = await resultCards(file, chain, (await results.page(21, 1))[0]!, null);
      expect(late.links[0]).toMatchObject({ direction: "in", from: "P:p", to: "Q:q", pairWide: true });
      expect(late.links[0]!.evidence.total).toBe(44);
      const { body } = render(ResultRow, { props: { row: late, index: 21, count: none(22), onmove: noop } });
      expect(body).toContain("every pq link between these two");
    });

    it("qualifiers that sort differently by UTF-8 bytes and by UTF-16 units keep the UTF-8 order, each with its own rows", async () => {
      const bmp = "～";
      const astral = "\u{1F600}";
      const bytes = buildMosaic({
        nodes: [{ type: "A", key: "a", label: "A a" }, { type: "B", key: "b", label: "B b" }],
        edgeTypes: [["ab", "A", "B"]],
        edges: [
          { type: "ab", from: "A:a", to: "B:b", qualifier: astral, evidence: [{ locator: "row=astral" }] },
          { type: "ab", from: "A:a", to: "B:b", qualifier: bmp, evidence: [{ locator: "row=bmp" }] },
        ],
      });
      const file = await openMosaic(bytes, "order.mosaic");
      const chain: Chain = { start: "A", pin: null, steps: [step("ab", "out", "B")] };
      const results = new ChainResults(file, chain);
      const a = await resultCards(file, chain, (await results.page(0, 1))[0]!, null);
      const b = await resultCards(file, chain, (await results.page(1, 1))[0]!, null);
      expect([a.links[0]!.qualifier, b.links[0]!.qualifier]).toEqual([bmp, astral]);
      expect(a.links[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=bmp"]);
      expect(b.links[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=astral"]);
    });

    const oneLink = async (qualifier: string) => {
      const bytes = buildMosaic({
        nodes: [{ type: "A", key: "a", label: "A a" }, { type: "B", key: "b", label: "B b" }],
        edgeTypes: [["ab", "A", "B"]],
        edges: [{ type: "ab", from: "A:a", to: "B:b", qualifier, evidence: [{ locator: "row=only" }] }],
      });
      const file = await openMosaic(bytes, "q.mosaic");
      const chain: Chain = { start: "A", pin: null, steps: [step("ab", "out", "B")] };
      const [r] = await new ChainResults(file, chain).page(0, 1);
      return resultCards(file, chain, r!, null);
    };

    it("a qualifier of 400 characters keeps its own rows", async () => {
      const row = await oneLink("q".repeat(400));
      expect(row.links[0]!.evidence.rows.map((e) => e.locator)).toEqual(["row=only"]);
    });

    it("a qualifier too long for the kit to show still opens the link's source (V-8: every link keeps its source)", async () => {
      // The kit cuts long text (section 8.2); a link whose qualifier it cannot show whole is cited by
      // the pair, so its rows are never lost.
      const row = await oneLink("q".repeat(5000));
      expect(row.links[0]!.evidence.total).toBeGreaterThan(0);
      expect(row.links[0]!.evidence.rows.map((e) => e.locator)).toEqual(["row=only"]);
    });

    it("a qualifier of non-ASCII text keeps its own rows", async () => {
      const row = await oneLink("é\u{1F600}\u4E2D");
      expect(row.links[0]!.qualifier).toBe("é\u{1F600}\u4E2D");
      expect(row.links[0]!.evidence.rows.map((e) => e.locator)).toEqual(["row=only"]);
    });
  });

  describe("names with quotes and markup, in the places a row puts them (V-8, principle 4)", () => {
    it("a key holding quotes and tags cannot open an attribute or a tag in the page", async () => {
      const key = 'x" onfocus="alert(1)" data-x="';
      const edge = "ee";
      const bytes = buildMosaic({
        nodes: [{ type: "A", key, label: `A ${key}` }, { type: "B", key: "b<i>", label: "B b" }],
        edgeTypes: [[edge, "A", "B"]],
        edges: [{ type: edge, from: `A:${key}`, to: "B:b<i>", evidence: [{ locator: "row=1" }] }],
      });
      const file = await openMosaic(bytes, "quotes.mosaic");
      const chain: Chain = { start: "A", pin: null, steps: [step(edge, "out", "B")] };
      const [r] = await new ChainResults(file, chain).page(0, 1);
      const row = await resultCards(file, chain, r!, null);
      const { body } = render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } });
          expect(body).not.toContain("<i>");
      // In text a quote is only a quote; inside a tag, it must be escaped.
      expect(body.replace(/>[^<]*</g, "><")).not.toMatch(/onfocus=\s*"alert/);
      expect(body).toContain("aria-label=\"A:x&quot; onfocus=&quot;alert(1)&quot;");
      expect(body.match(/<article class="card/g)).toHaveLength(2);
    });

    it("the file name and the row drawn twice give the same bytes whatever the text (determinism)", async () => {
      const bytes = buildMosaic({
        nodes: [{ type: "A", key: "é", label: "\u{1F600}" }, { type: "B", key: "b", label: "B b" }],
        edgeTypes: [["ab", "A", "B"]],
        edges: [{ type: "ab", from: "A:é", to: "B:b", evidence: [{ locator: "row=é" }] }],
      });
      const html = async () => {
        const file = await openMosaic(bytes, "u.mosaic");
        const chain: Chain = { start: "A", pin: null, steps: [step("ab", "out", "B")] };
        const [r] = await new ChainResults(file, chain).page(0, 1);
        const row = await resultCards(file, chain, r!, null);
        return render(ResultRow, { props: { row, index: 0, count: none(1), onmove: noop } }).body;
      };
      expect(await html()).toBe(await html());
    });
  });
});
