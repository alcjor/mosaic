// Switch between cards and table (docs/design.md, "Viewer: chains and cards"): V-12, the
// viewer switches between cards and table without losing the chain, the place in the results or
// the filters; V-13, it says how many results there are, in the same order every time.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import ResultRow from "../src/components/ResultRow.svelte";
import ResultTableView from "../src/components/ResultTableView.svelte";
import { type Chain } from "../src/lib/chain.js";
import { Viewer } from "../src/lib/viewer.svelte.js";

const N = 45;
/** One hub linked to N leaves, each with a rank; leaf i is named "Leaf <rank>", rank = (i * 7) % N. */
function hubBytes(): Uint8Array {
  const pad = (i: number) => String(i).padStart(2, "0");
  return buildMosaic({
    nodes: [
      { type: "Hub", key: "h", label: "Hub h" },
      ...Array.from({ length: N }, (_, i) => ({ type: "Leaf", key: `l${pad(i)}`, label: `Leaf ${pad((i * 7) % N)}`, props: `{"rank":${(i * 7) % N}}` })),
    ],
    typeProps: { Leaf: '{"name":"text","rank":"real"}' },
    edgeTypes: [["has", "Hub", "Leaf"]],
    edges: Array.from({ length: N }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${pad(i)}`, evidence: [{ locator: `r=${i}` }] })),
  });
}
const CHAIN: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };

async function viewer(): Promise<Viewer> {
  const v = new Viewer();
  await v.open(hubBytes(), "hub.mosaic");
  v.setChain(CHAIN);
  await Promise.all([v.shown, v.counted]);
  return v;
}
const leafShown = (v: Viewer) => v.chainRow?.things[1]!.id;
const rankColumn = (v: Viewer) => v.chainTable!.table.columns.findIndex((c) => c.key === "property:rank");

describe("switching keeps the place in the results (V-12)", () => {
  it("the table opens on the page that holds the result the cards show, that row marked; back to cards, the same result", async () => {
    const v = await viewer();
    await v.showResult(23);
    const shown = leafShown(v);
    await v.showChainAs("table");
    expect(v.chainTable?.page).toBe(1);
    expect(v.chainTable?.current).toBe(23);
    expect(v.chainTable?.rows?.[3]!.ids[1]).toBe(shown);
    await v.showChainAs("cards");
    expect(v.chainIndex).toBe(23);
    expect(leafShown(v)).toBe(shown);
  });

  it("a page of the table moved to: back to cards, its first row", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.show(2);
    const first = v.chainTable!.rows![0]!.ids[1];
    await v.showChainAs("cards");
    expect(v.chainIndex).toBe(40);
    expect(leafShown(v)).toBe(first);
  });

  it("a row of the table picked: back to cards, that result", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    v.chainTable!.pick(5);
    await v.showChainAs("cards");
    expect(v.chainIndex).toBe(5);
    expect(leafShown(v)).toBe(v.chainTable!.rows![5]!.ids[1]);
  });
});

describe("switching keeps the filters and the sort, and the cards follow them (V-12, V-13)", () => {
  it("filtered in the table: the cards move among the rows that match, and say so; back in the table, the filter is still set", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    const name = v.chainTable!.table.columns.findIndex((c) => c.place === 1 && c.key === "label");
    await v.chainTable!.filter(name, "Leaf 1");
    const matching = v.chainTable!.matching!;
    expect(matching).toBe(10); // Leaf 1, Leaf 10 … Leaf 19
    await v.showChainAs("cards");
    expect(v.chainIndex).toBe(0);
    expect(leafShown(v)).toBe(v.chainTable!.rows![0]!.ids[1]);
    expect(v.chainArranged).toEqual({ matching: 10, total: N });
    await v.showResult(matching + 5);
    expect(v.chainIndex).toBe(matching - 1);
    const { body } = render(ResultRow, { props: { row: v.chainRow!, index: v.chainIndex, count: v.chainCount, arranged: v.chainArranged, onmove: () => {} } });
    expect(body).toContain("Result 10 of 10 that match, of 45 results");
    await v.showChainAs("table");
    expect(v.chainTable!.filters[name]).toBe("Leaf 1");
    expect(v.chainTable!.matching).toBe(10);
    expect(v.chainTable!.current).toBe(9);
  });

  it("sorted in the table: the cards go in the table's order", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.sortBy(rankColumn(v));
    await v.chainTable!.sortBy(rankColumn(v)); // down
    await v.showChainAs("cards");
    const ranks: unknown[] = [];
    for (const i of [0, 1, 2]) {
      await v.showResult(i);
      ranks.push(leafShown(v));
    }
    const table = await v.chainTable!.arrangedRows();
    expect(ranks).toEqual(table.slice(0, 3).map((r) => r.ids[1]));
  });

  it("a filter cleared: the cards go back to every result, in the chain's order", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(0, "nothing");
    await v.chainTable!.filter(0, "");
    await v.showChainAs("cards");
    expect(v.chainArranged).toBeNull();
    expect(v.chainIndex).toBe(0);
  });

  it("a filter that keeps nothing: no card, and the cards say none match", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(0, "nothing like this");
    await v.showChainAs("cards");
    expect(v.chainRow).toBeNull();
    expect(v.chainArranged).toEqual({ matching: 0, total: N });
  });
});

describe("switching keeps the chain; another chain starts again", () => {
  it("the chain stays through both switches; a changed chain has no filters and starts at its first result", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(0, "Hub");
    await v.showChainAs("cards");
    await v.showChainAs("table");
    expect(v.chain).toEqual(CHAIN);
    v.setChain({ ...CHAIN, steps: [] });
    await v.chainTable?.shown;
    expect(v.chainTable?.filters.every((f) => f === "")).toBe(true);
    expect(v.chainTable?.current).toBe(0);
  });
});

// The cards follow the table. Position line, ends, a filter
// or sort change while a result is open, the empty state with "Clear filters", "at least n".
const pad = (i: number) => String(i).padStart(2, "0");
/** The chain's results in its order, each named by its leaf's label. */
const LABELS = Array.from({ length: N }, (_, i) => `Leaf ${pad((i * 7) % N)}`);
const labelShown = (v: Viewer) => (v.chainRow?.things[1]!.page as { node: { label: string } }).node.label;
const nameColumn = (v: Viewer) => v.chainTable!.table.columns.findIndex((c) => c.place === 1 && c.key === "label");
const rowText = (v: Viewer) =>
  render(ResultRow, { props: { row: v.chainRow!, index: v.chainIndex, count: v.chainCount, arranged: v.chainArranged, notice: v.chainNotice, onmove: () => {} } }).body;

describe("the position line", () => {
  it("a sort alone: 'Result 3 of 45', no 'that match'", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.sortBy(rankColumn(v));
    v.chainTable!.pick(2);
    await v.showChainAs("cards");
    const body = rowText(v);
    expect(body).toContain("Result 3 of 45");
    expect(body).not.toContain("that match");
  });

  it("a filter: 'Result 2 of 10 that match, of 45 results'", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    v.chainTable!.pick(1);
    await v.showChainAs("cards");
    expect(rowText(v)).toContain("Result 2 of 10 that match, of 45 results");
  });

  it("a count still growing keeps 'at least' with no filter", () => {
    const row = { things: [], links: [] };
    const { body } = render(ResultRow, { props: { row, index: 4, count: { total: 3, exact: false, done: false, notes: [] }, onmove: () => {} } });
    expect(body).toContain("Result 5 of at least 5");
  });
});

describe("Next and Previous move through the kept rows and stop at the ends", () => {
  it("at the first kept row Previous is off; at the last Next is off; no wrap-around", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    await v.showChainAs("cards");
    expect(rowText(v)).toMatch(/<button[^>]*disabled[^>]*>Previous<\/button>/);
    await v.showResult(9);
    const body = rowText(v);
    expect(body).toMatch(/<button[^>]*disabled[^>]*>Next<\/button>/);
    expect(body).not.toMatch(/<button[^>]*disabled[^>]*>Previous<\/button>/);
    await v.showResult(10);
    expect(v.chainIndex).toBe(9);
  });
});

describe("a filter or sort changed while a result is open", () => {
  it("the open result still kept: it stays open, its position updates, nothing is said", async () => {
    const v = await viewer();
    const at = LABELS.indexOf("Leaf 12");
    await v.showResult(at);
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    const kept = LABELS.filter((l) => l.startsWith("Leaf 1"));
    expect(v.chainTable!.current).toBe(kept.indexOf("Leaf 12"));
    expect(v.chainTable!.moved).toBe(false);
    await v.showChainAs("cards");
    expect(labelShown(v)).toBe("Leaf 12");
    expect(v.chainIndex).toBe(kept.indexOf("Leaf 12"));
    expect(rowText(v)).not.toContain("no longer matches");
  });

  it("a sort changed: the open result stays open, at its place in the new order; the table shows its first page", async () => {
    const v = await viewer();
    const at = LABELS.indexOf("Leaf 33");
    await v.showResult(at);
    await v.showChainAs("table");
    await v.chainTable!.sortBy(rankColumn(v));
    expect(v.chainTable!.current).toBe(33);
    expect(v.chainTable!.page).toBe(0);
    await v.showChainAs("cards");
    expect(labelShown(v)).toBe("Leaf 33");
    expect(v.chainIndex).toBe(33);
  });

  it("the open result dropped: the first kept row after it in the new order, and one line says so", async () => {
    const v = await viewer();
    const at = LABELS.indexOf("Leaf 20");
    await v.showResult(at);
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    const after = LABELS.slice(at + 1).find((l) => l.startsWith("Leaf 1"))!;
    const kept = LABELS.filter((l) => l.startsWith("Leaf 1"));
    expect(v.chainTable!.current).toBe(kept.indexOf(after));
    expect(v.chainTable!.moved).toBe(true);
    const table = render(ResultTableView, { props: { table: v.chainTable!, count: v.chainCount } }).body;
    expect(table).toContain("The result you were on no longer matches.");
    await v.showChainAs("cards");
    expect(labelShown(v)).toBe(after);
    expect(rowText(v)).toContain("The result you were on no longer matches.");
    await v.moveResult(v.chainIndex + 1);
    expect(rowText(v)).not.toContain("no longer matches");
  });

  it("the open result dropped with no kept row after it: the last kept row", async () => {
    const v = await viewer();
    await v.showResult(N - 1);
    const open = labelShown(v);
    expect(open.startsWith("Leaf 1")).toBe(false);
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    expect(v.chainTable!.current).toBe(9);
    expect(v.chainTable!.moved).toBe(true);
    await v.showChainAs("cards");
    expect(labelShown(v)).toBe(LABELS.filter((l) => l.startsWith("Leaf 1")).at(-1));
  });

  it("a sort under a filter, the open result dropped: 'after it' is in the new sort's order", async () => {
    const v = await viewer();
    await v.showResult(LABELS.indexOf("Leaf 20"));
    await v.showChainAs("table");
    await v.chainTable!.sortBy(rankColumn(v));
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    // In rank order the rows after Leaf 20 hold no "Leaf 1…": the last kept row, Leaf 19.
    await v.showChainAs("cards");
    expect(labelShown(v)).toBe("Leaf 19");
    expect(v.chainTable!.moved).toBe(true);
  });
});

describe("nothing matches: the empty state with Clear filters", () => {
  it("the table and the cards each offer Clear filters; it brings back every result, from the first", async () => {
    const v = await viewer();
    const at = LABELS.indexOf("Leaf 07");
    await v.showResult(at);
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "nothing like this");
    const table = render(ResultTableView, { props: { table: v.chainTable!, count: v.chainCount } }).body;
    expect(table).toContain("No row matches the filters.");
    expect(table).toMatch(/<button[^>]*>Clear filters<\/button>/);
    expect(v.chainTable!.moved).toBe(false);
    await v.showChainAs("cards");
    expect(v.chainRow).toBeNull();
    await v.clearChainFilters();
    expect(v.chainTable!.filters.every((f) => f === "")).toBe(true);
    expect(v.chainArranged).toBeNull();
    expect(v.chainRow).not.toBeNull();
    expect(v.chainIndex).toBe(0);
  });
});

describe("the place follows the cards; a count still growing", () => {
  it("a filter with a count still 'at least': 'that match, of at least n results'", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    await v.showChainAs("cards");
    const growing = { total: 30, exact: false, done: false, notes: [] };
    const { body } = render(ResultRow, { props: { row: v.chainRow!, index: v.chainIndex, count: growing, arranged: v.chainArranged, onmove: () => {} } });
    expect(body).toContain("Result 1 of 10 that match, of at least 45 results");
  });

  it("a card moved to under a filter, then the filters cleared: that card stays open", async () => {
    const v = await viewer();
    await v.showChainAs("table");
    await v.chainTable!.filter(nameColumn(v), "Leaf 1");
    await v.showChainAs("cards");
    await v.moveResult(4);
    const open = labelShown(v);
    await v.clearChainFilters();
    expect(labelShown(v)).toBe(open);
    expect(v.chainIndex).toBe(LABELS.indexOf(open));
    expect(v.chainNotice).toBeNull();
  });
});

describe("cardstable: further cases", () => {
  const N = 60;
  const pad = (i: number) => String(i).padStart(2, "0");
  /** Hub h (and an isolated hub z) over N leaves: even i "Alpha nn", odd i "Beta nn"; each leaf has one of three tags. */
  function bytes(): Uint8Array {
    return buildMosaic({
      nodes: [
        { type: "Hub", key: "h", label: "Hub h" },
        { type: "Hub", key: "z", label: "Hub z" },
        ...Array.from({ length: 3 }, (_, i) => ({ type: "Tag", key: `t${i}`, label: `Tag ${i}` })),
        ...Array.from({ length: N }, (_, i) => ({
          type: "Leaf",
          key: `l${pad(i)}`,
          label: `${i % 2 === 0 ? "Alpha" : "Beta"} ${pad((i * 7) % N)}`,
          props: `{"rank":${(i * 7) % N},"band":${i % 3}}`,
        })),
      ],
      typeProps: { Leaf: '{"name":"text","rank":"real","band":"real"}' },
      edgeTypes: [["has", "Hub", "Leaf"], ["tagged", "Leaf", "Tag"]],
      edges: [
        ...Array.from({ length: N }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${pad(i)}`, evidence: [{ locator: `r=${i}` }] })),
        ...Array.from({ length: N }, (_, i) => ({ type: "tagged", from: `Leaf:l${pad(i)}`, to: `Tag:t${i % 3}`, evidence: [{ locator: `t=${i}` }] })),
      ],
    });
  }
  const CHAIN: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };
  const CHAIN2: Chain = { start: "Hub", pin: "Hub:h", steps: [CHAIN.steps[0]!, { edge: "tagged", direction: "out", type: "Tag", pin: null }] };
  const EMPTY: Chain = { ...CHAIN, pin: "Hub:z" };
  const SINGLE: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: "Leaf:l05" }] };

  async function open(chain: Chain | null = CHAIN): Promise<Viewer> {
    const v = new Viewer();
    await v.open(bytes(), "hub.mosaic");
    v.setChain(chain);
    await Promise.all([v.shown, v.counted]);
    return v;
  }
  const label = (v: Viewer, place: number): string => (v.chainRow!.things[place]!.page as unknown as { node: { label: string } }).node.label;
  const ids = (v: Viewer) => v.chainRow?.things.map((t) => t.id);
  const col = (v: Viewer, place: number, key: string) => v.chainTable!.table.columns.findIndex((c) => c.place === place && c.key === key);

  /** Cards and table agree: the card shown is the row the table marks, among the rows as arranged. */
  async function agree(v: Viewer): Promise<void> {
    const rows = await v.chainTable!.arrangedRows();
    if (rows.length === 0) {
      expect(v.chainRow).toBeNull();
      return;
    }
    expect(v.chainIndex).toBe(v.chainTable!.current);
    expect(ids(v)).toEqual(rows[v.chainIndex]!.ids);
  }

  describe("round trips (V-12)", () => {
    it("many switches in a row change nothing: the place, the filter, the sort and the chain stay", async () => {
      const v = await open();
      await v.showResult(37);
      const before = ids(v);
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Alpha");
      await v.chainTable!.sortBy(col(v, 1, "property:rank"));
      await v.showChainAs("cards");
      const place = v.chainIndex;
      const there = ids(v);
      for (let i = 0; i < 4; i++) {
        await v.showChainAs("table");
        await v.showChainAs("cards");
      }
      expect(v.chainIndex).toBe(place);
      expect(ids(v)).toEqual(there);
      await v.showChainAs("table");
      expect(v.chainTable!.filters[col(v, 1, "label")]).toBe("Alpha");
      expect(v.chainTable!.sort).not.toBeNull();
      expect(v.chain).toEqual(CHAIN);
      expect(before).toBeDefined();
      await agree(v);
    });

    it("asking for the view already shown changes nothing", async () => {
      const v = await open();
      await v.showResult(12);
      const there = ids(v);
      await v.showChainAs("cards");
      expect(v.chainIndex).toBe(12);
      expect(ids(v)).toEqual(there);
      await v.showChainAs("table");
      const page = v.chainTable!.page;
      await v.showChainAs("table");
      expect(v.chainTable!.page).toBe(page);
      expect(v.chainTable!.current).toBe(12);
      expect(v.chainShow).toBe("table");
    });

    it("the first and the last result keep their place in both views", async () => {
      const v = await open();
      for (const place of [0, N - 1]) {
        await v.showResult(place);
        const there = ids(v);
        await v.showChainAs("table");
        expect(v.chainTable!.current).toBe(place);
        expect(v.chainTable!.page).toBe(Math.floor(place / 20));
        expect(v.chainTable!.rows![place % 20]!.ids).toEqual(there);
        await v.showChainAs("cards");
        expect(v.chainIndex).toBe(place);
        expect(ids(v)).toEqual(there);
      }
    });

    it("the place at a page boundary (19 and 20) lands on the right page", async () => {
      const v = await open();
      for (const [place, page] of [[19, 0], [20, 1], [39, 1], [40, 2]] as const) {
        await v.showResult(place);
        await v.showChainAs("table");
        expect(v.chainTable!.page).toBe(page);
        expect(v.chainTable!.current).toBe(place);
        await v.showChainAs("cards");
        expect(v.chainIndex).toBe(place);
      }
    });

    it("a place asked for beyond the ends, kept to the first and the last, is what the table opens on", async () => {
      const v = await open();
      await v.showResult(10_000);
      expect(v.chainIndex).toBe(N - 1);
      await v.showChainAs("table");
      expect(v.chainTable!.current).toBe(N - 1);
      await v.showChainAs("cards");
      await v.showResult(-5);
      expect(v.chainIndex).toBe(0);
      await v.showChainAs("table");
      expect(v.chainTable!.current).toBe(0);
      expect(v.chainTable!.page).toBe(0);
    });

    it("the count of results is the same, and done, in both views", async () => {
      const v = await open();
      expect(v.chainCount?.done).toBe(true);
      const count = v.chainCount;
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Beta");
      await v.showChainAs("cards");
      expect(v.chainCount).toEqual(count);
      expect(v.chainCount?.total).toBe(N);
      expect(v.chainArranged).toEqual({ matching: N / 2, total: N });
    });
  });

  describe("filters and sort: the cards follow the table (V-12, V-13)", () => {
    it("a filter with several pages of matches: every card in turn is the table's row at that place", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "alpha"); // any case
      expect(v.chainTable!.matching).toBe(30);
      await v.showChainAs("cards");
      const rows = await v.chainTable!.arrangedRows();
      expect(rows).toHaveLength(30);
      for (const place of [0, 1, 19, 20, 29]) {
        await v.showResult(place);
        expect(ids(v)).toEqual(rows[place]!.ids);
        expect(label(v, 1).toLowerCase()).toContain("alpha");
      }
      await v.showResult(30);
      expect(v.chainIndex).toBe(29);
      expect(v.chainArranged).toEqual({ matching: 30, total: N });
    });

    it("a row picked on the second page of a filtered table: the cards show it, and back in the table it is the current row", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Alpha");
      await v.chainTable!.show(1);
      v.chainTable!.pick(23); // a place among the rows kept, not on the page
      const picked = v.chainTable!.rows![3]!.ids;
      await v.showChainAs("cards");
      expect(ids(v)).toEqual(picked);
      const at = v.chainIndex;
      await v.showChainAs("table");
      expect(v.chainTable!.current).toBe(at);
      expect(v.chainTable!.page).toBe(Math.floor(at / 20));
      expect(v.chainTable!.rows![at % 20]!.ids).toEqual(picked);
    });

    it("filters on two steps apply together, and the cards keep only rows that match both", async () => {
      const v = await open(CHAIN2);
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Alpha");
      await v.chainTable!.filter(col(v, 2, "label"), "Tag 0");
      const matching = v.chainTable!.matching!;
      expect(matching).toBe(10); // even i, i % 3 = 0: i % 6 = 0
      await v.showChainAs("cards");
      expect(v.chainArranged).toEqual({ matching, total: N });
      const seen = new Set<string>();
      for (let i = 0; i < matching; i++) {
        await v.showResult(i);
        expect(label(v, 1)).toMatch(/^Alpha/);
        expect(label(v, 2)).toBe("Tag 0");
        seen.add(v.chainRow!.things[1]!.id);
      }
      expect(seen.size).toBe(matching);
      await v.showChainAs("table");
      expect(v.chainTable!.filters.filter((f) => f !== "")).toHaveLength(2);
    });

    it("a filter on a later step, then one cleared: the other filter alone stays", async () => {
      const v = await open(CHAIN2);
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 2, "label"), "Tag 1");
      await v.chainTable!.filter(col(v, 1, "label"), "Beta");
      await v.chainTable!.filter(col(v, 2, "label"), "");
      await v.showChainAs("cards");
      expect(v.chainArranged).toEqual({ matching: N / 2, total: N });
      await v.showChainAs("table");
      expect(v.chainTable!.filters[col(v, 1, "label")]).toBe("Beta");
      expect(v.chainTable!.filters[col(v, 2, "label")]).toBe("");
    });

    it("a filter that keeps every result: the cards still go through all of them, in the chain's order", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.filter(0, "Hub");
      await v.showChainAs("cards");
      const order: string[] = [];
      for (let i = 0; i < N; i++) {
        await v.showResult(i);
        order.push(v.chainRow!.things[1]!.id);
      }
      expect(new Set(order).size).toBe(N);
      await v.chainTable!.filter(0, "");
      const unfiltered = (await v.chainTable!.arrangedRows()).map((r) => r.ids[1]);
      expect(order).toEqual(unfiltered);
    });

    it("a filter that keeps nothing, back to the table and to the cards again: still nothing, filter set, no failure", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "no such leaf");
      await v.showChainAs("cards");
      expect(v.chainRow).toBeNull();
      await v.showChainAs("table");
      expect(v.chainTable!.matching).toBe(0);
      expect(v.chainTable!.filters[col(v, 1, "label")]).toBe("no such leaf");
      expect(v.chainTable!.rows).toEqual([]);
      expect(v.chainTable!.error).toBeNull();
      await v.showChainAs("cards");
      expect(v.chainFailure).toBeNull();
      expect(v.chainArranged).toEqual({ matching: 0, total: N });
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "");
      await v.showChainAs("cards");
      expect(v.chainRow).not.toBeNull();
      expect(v.chainArranged).toBeNull();
    });

    it("the filter and the place together: whatever the table's place is after a filter, the cards show that row", async () => {
      const v = await open();
      await v.showResult(41);
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Beta");
      await v.showChainAs("cards");
      await agree(v);
      await v.showChainAs("table");
      await agree(v);
      expect(v.chainTable!.current).toBeLessThan(v.chainTable!.matching!);
    });

    it("a sort changed with the table's place somewhere: the cards show the row the table marks", async () => {
      const v = await open();
      await v.showResult(23);
      await v.showChainAs("table");
      await v.chainTable!.sortBy(col(v, 1, "property:rank"));
      await v.showChainAs("cards");
      await agree(v);
      await v.showChainAs("table");
      await v.chainTable!.sortBy(col(v, 1, "property:rank"));
      await v.showChainAs("cards");
      await agree(v);
    });

    it("sorted and filtered: the cards, walked through, give the table's rows in the table's order", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Beta");
      await v.chainTable!.sortBy(col(v, 1, "property:rank"));
      await v.chainTable!.sortBy(col(v, 1, "property:rank"));
      await v.showChainAs("cards");
      const walked: unknown[] = [];
      for (let i = 0; i < 30; i++) {
        await v.showResult(i);
        walked.push(v.chainRow!.things[1]!.id);
      }
      const rows = await v.chainTable!.arrangedRows();
      expect(walked).toEqual(rows.map((r) => r.ids[1]));
      const ranks = rows.map((r) => Number(r.cells[col(v, 1, "property:rank")]));
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    });

    it("a sort on a column whose cells are all equal: the same order every time, and the cards follow it", async () => {
      const a = await open();
      const b = await open();
      for (const v of [a, b]) {
        await v.showChainAs("table");
        await v.chainTable!.sortBy(0); // the hub's own label: every cell equal
      }
      const ra = (await a.chainTable!.arrangedRows()).map((r) => r.ids);
      const rb = (await b.chainTable!.arrangedRows()).map((r) => r.ids);
      expect(ra).toEqual(rb);
      expect(ra).toHaveLength(N);
      await a.showChainAs("cards");
      for (const i of [0, 7, N - 1]) {
        await a.showResult(i);
        expect(ids(a)).toEqual(ra[i]);
      }
    });

    it("the same mosaic, the same sort and filter, two viewers: the same results in the same order", async () => {
      const order = async () => {
        const v = await open();
        await v.showChainAs("table");
        await v.chainTable!.filter(col(v, 1, "label"), "a");
        await v.chainTable!.sortBy(col(v, 1, "property:band"));
        await v.showChainAs("cards");
        const out: unknown[] = [];
        for (let i = 0; i < 12; i++) {
          await v.showResult(i);
          out.push(ids(v));
        }
        return out;
      };
      expect(await order()).toEqual(await order());
    });
  });

  describe("what the cards say about the results (V-13)", () => {
    it("with no sort and no filter the cards do not claim any match, and give the count", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.showChainAs("cards");
      expect(v.chainArranged).toBeNull();
      const { body } = render(ResultRow, { props: { row: v.chainRow!, index: v.chainIndex, count: v.chainCount, arranged: v.chainArranged, onmove: () => {} } });
      expect(body).toContain("Result 1 of 60");
      expect(body).not.toContain("that match");
    });
  });

  describe("the chain and what is not a result (V-12)", () => {
    it("a chain with no result: both views say so, and switching does not fail", async () => {
      const v = await open(EMPTY);
      expect(v.chainCount?.total).toBe(0);
      await v.showChainAs("table");
      await v.chainTable!.shown;
      expect(v.chainTable!.rows ?? []).toEqual([]);
      expect(v.chainTable!.error).toBeNull();
      await v.showChainAs("cards");
      expect(v.chainRow).toBeNull();
      expect(v.chainFailure).toBeNull();
      expect(v.chainCount?.total).toBe(0);
      expect(v.chain).toEqual(EMPTY);
    });

    it("a chain with one result: both views show it, either way round", async () => {
      const v = await open(SINGLE);
      expect(v.chainCount?.total).toBe(1);
      const there = ids(v);
      await v.showChainAs("table");
      expect(v.chainTable!.current).toBe(0);
      expect(v.chainTable!.rows).toHaveLength(1);
      expect(v.chainTable!.rows![0]!.ids).toEqual(there);
      await v.showChainAs("cards");
      expect(ids(v)).toEqual(there);
      await v.showResult(3);
      expect(v.chainIndex).toBe(0);
    });

    it("no chain: switching does not throw, and no chain appears", async () => {
      const v = await open(null);
      await v.showChainAs("table");
      await v.showChainAs("cards");
      expect(v.chain).toBeNull();
      expect(v.chainRow).toBeNull();
    });

    it("a changed chain, in the table, starts at its first result with no filter and no sort, in cards too", async () => {
      const v = await open();
      await v.showResult(30);
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, 1, "label"), "Beta");
      await v.chainTable!.sortBy(col(v, 1, "property:rank"));
      v.setChain(CHAIN2);
      await Promise.all([v.shown, v.counted]);
      await v.chainTable?.shown;
      expect(v.chainTable!.filters.every((f) => f === "")).toBe(true);
      expect(v.chainTable!.sort).toBeNull();
      expect(v.chainTable!.current).toBe(0);
      await v.showChainAs("cards");
      expect(v.chainIndex).toBe(0);
      expect(v.chainArranged).toBeNull();
      expect(v.chainRow!.things).toHaveLength(3);
    });
  });

  describe("switching while the viewer is still working (V-12)", () => {
    it("a switch asked for before the last result has shown: the result asked for last is the place", async () => {
      const v = await open();
      void v.showResult(10);
      void v.showResult(33);
      await v.showChainAs("table");
      expect(v.chainTable!.current).toBe(33);
      await v.showChainAs("cards");
      await v.shown;
      expect(v.chainIndex).toBe(33);
    });

    it("two switches asked for without waiting: the last one wins, and the place is kept", async () => {
      const v = await open();
      await v.showResult(25);
      const a = v.showChainAs("table");
      const b = v.showChainAs("cards");
      await Promise.all([a, b]);
      await v.shown;
      expect(v.chainShow).toBe("cards");
      expect(v.chainIndex).toBe(25);
      await agree((await v.showChainAs("table"), v));
    });

    it("a switch to the table and a filter asked for without waiting: the cards then follow that filter", async () => {
      const v = await open();
      await v.showChainAs("table");
      const name = col(v, 1, "label");
      void v.chainTable!.filter(name, "Beta");
      await v.chainTable!.shown;
      await v.showChainAs("cards");
      expect(v.chainArranged).toEqual({ matching: 30, total: N });
      await v.showResult(0);
      expect(label(v, 1)).toMatch(/^Beta/);
    });
  });
});

describe("cardstable answer: further cases", () => {
  const pad = (i: number, n = 2) => String(i).padStart(n, "0");
  const NOTE = "The result you were on no longer matches.";
  const CHAIN: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };

  interface LeafSpec {
    readonly name: string;
    readonly rank: number;
  }
  function mosaic(leaves: readonly LeafSpec[]): Uint8Array {
    return buildMosaic({
      nodes: [
        { type: "Hub", key: "h", label: "Hub h" },
        ...leaves.map((l, i) => ({ type: "Leaf", key: `l${pad(i, 4)}`, label: l.name, props: `{"rank":${l.rank}}` })),
      ],
      typeProps: { Leaf: '{"name":"text","rank":"real"}' },
      edgeTypes: [["has", "Hub", "Leaf"]],
      edges: leaves.map((_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${pad(i, 4)}`, evidence: [{ locator: `r=${i}` }] })),
    });
  }
  /** Leaf i is named "Leaf nn" with nn = (i * 7) % n, rank = nn: names and ranks are a permutation of 0..n-1. */
  const permuted = (n: number): LeafSpec[] =>
    Array.from({ length: n }, (_, i) => ({ name: `Leaf ${pad((i * 7) % n)}`, rank: (i * 7) % n }));

  async function open(bytes: Uint8Array = mosaic(permuted(60))): Promise<Viewer> {
    const v = new Viewer();
    await v.open(bytes, "hub.mosaic");
    v.setChain(CHAIN);
    await Promise.all([v.shown, v.counted]);
    return v;
  }
  const label = (v: Viewer): string => (v.chainRow!.things[1]!.page as unknown as { node: { label: string } }).node.label;
  const idOf = (v: Viewer) => v.chainRow!.things[1]!.id;
  const col = (v: Viewer, key: string) => v.chainTable!.table.columns.findIndex((c) => c.place === 1 && c.key === key);
  const text = (v: Viewer, count = v.chainCount): string =>
    render(ResultRow, { props: { row: v.chainRow!, index: v.chainIndex, count, arranged: v.chainArranged, notice: v.chainNotice, onmove: () => {} } }).body;
  const filterTo = async (v: Viewer, query: string, key = "label") => {
    await v.showChainAs("table");
    await v.chainTable!.filter(col(v, key), query);
  };
  /** Every card, first to last, by the thing's label. */
  async function walk(v: Viewer): Promise<string[]> {
    const out: string[] = [];
    let at = 0;
    await v.showResult(0);
    for (;;) {
      out.push(label(v));
      if (v.chainIndex !== at) throw new Error(`the place ${at} became ${v.chainIndex}`);
      await v.moveResult(at + 1);
      if (v.chainIndex === at) return out;
      at += 1;
    }
  }

  describe("the position line: wording and figures", () => {
    it("with no filter the line is 'Result 17 of 1,000', thousands marked, no 'that match'", async () => {
      const v = await open(mosaic(permuted(1000)));
      expect(v.chainCount?.total).toBe(1000);
      await v.showResult(16);
      const body = text(v);
      expect(body).toContain("Result 17 of 1,000");
      expect(body).not.toContain("that match");
    });

    it("with a filter the line is 'Result 2 of 5 that match, of 1,000 results'", async () => {
      // "Leaf 00" … "Leaf 99" among 1000 names "Leaf 000"… no: five names start with "Leaf 99", see below.
      const leaves = permuted(1000).map((l, i) => ({ ...l, name: i < 5 ? `Zed ${i}` : l.name }));
      const v = await open(mosaic(leaves));
      await filterTo(v, "Zed");
      await v.showChainAs("cards");
      await v.showResult(1);
      expect(text(v)).toContain("Result 2 of 5 that match, of 1,000 results");
    });

    it("with a filter and a count that is still 'at least n', the position line keeps 'at least'", async () => {
      const v = await open();
      await filterTo(v, "Leaf 1");
      await v.showChainAs("cards");
      await v.showResult(1);
      const growing = { total: 60, exact: false, done: false, notes: [] };
      const body = text(v, growing);
      expect(body).toContain("Result 2 of 10 that match, of at least 60 results");
    });

    it("with a sort alone and a count that is 'at least n', the line keeps 'at least' and claims no match", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.sortBy(col(v, "property:rank"));
      await v.showChainAs("cards");
      const body = text(v, { total: 60, exact: false, done: false, notes: [] });
      expect(body).toContain("Result 1 of at least 60");
      expect(body).not.toContain("that match");
    });

    it("a filter that keeps one result: 'Result 1 of 1 that match, of 60 results', and both Previous and Next are off", async () => {
      const v = await open();
      await filterTo(v, "Leaf 33");
      await v.showChainAs("cards");
      const body = text(v);
      expect(body).toContain("Result 1 of 1 that match, of 60 results");
      expect(body).toMatch(/<button[^>]*disabled[^>]*>Previous<\/button>/);
      expect(body).toMatch(/<button[^>]*disabled[^>]*>Next<\/button>/);
    });

    it("the position number follows the open result's place among the kept rows when a filter narrows", async () => {
      const names = permuted(60).map((l) => l.name);
      const keptNames = names.filter((n) => n.startsWith("Leaf 4"));
      const mine = keptNames[6]!; // the seventh kept row, in the chain's order
      const v = await open();
      await v.showResult(names.indexOf(mine));
      await filterTo(v, "Leaf 4");
      await v.showChainAs("cards");
      expect(label(v)).toBe(mine);
      expect(text(v)).toContain("Result 7 of 10 that match, of 60 results");
    });
  });

  describe("Next and Previous through the kept rows, in the table's order", () => {
    it("under a sort, going on from the first card gives the table's rows in the table's order, then stops", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.sortBy(col(v, "property:rank"));
      await v.chainTable!.sortBy(col(v, "property:rank")); // second press: descending, or still ascending: either way the table decides
      const table = (await v.chainTable!.arrangedRows()).map((r) => r.ids);
      await v.showChainAs("cards");
      const seen: string[][] = [];
      for (let at = 0; at < table.length; at++) {
        await v.showResult(at);
        seen.push(v.chainRow!.things.map((t) => t.id));
      }
      expect(seen).toEqual(table);
      await v.moveResult(table.length);
      expect(v.chainIndex).toBe(table.length - 1);
    });

    it("Previous from the first kept row stays on it, and Next from the last stays on it (no wrap-around)", async () => {
      const v = await open();
      await filterTo(v, "Leaf 2");
      await v.showChainAs("cards");
      const first = idOf(v);
      await v.moveResult(v.chainIndex - 1);
      expect(v.chainIndex).toBe(0);
      expect(idOf(v)).toBe(first);
      const last = (await walk(v)).length - 1;
      await v.showResult(last);
      const end = idOf(v);
      await v.moveResult(last + 1);
      expect(v.chainIndex).toBe(last);
      expect(idOf(v)).toBe(end);
    });

    it("stepping through a filtered set never shows a row the filter dropped", async () => {
      const v = await open();
      await filterTo(v, "Leaf 3");
      await v.showChainAs("cards");
      const shown = await walk(v);
      expect(shown).toHaveLength(10);
      expect(shown.every((l) => l.startsWith("Leaf 3"))).toBe(true);
      expect(new Set(shown).size).toBe(10);
    });
  });

  describe("a filter or sort changed while a card is open", () => {
    it("a filter that keeps the open result when two rows share the name: it stays on that very row", async () => {
      const twins = permuted(30).map((l, i) => ({ ...l, name: i % 2 === 0 ? "Twin" : l.name }));
      const v = await open(mosaic(twins));
      await v.showResult(10);
      const mine = idOf(v);
      expect(label(v)).toBe("Twin");
      await filterTo(v, "Twin");
      await v.showChainAs("cards");
      expect(idOf(v)).toBe(mine);
      expect(v.chainIndex).toBe(5);
      expect(text(v)).not.toContain("no longer matches");
    });

    it("the open result dropped, then a narrower filter that still keeps the row it moved to: it stays, and nothing is said again", async () => {
      const v = await open();
      await v.showResult(0);
      await filterTo(v, "Leaf 1");
      expect(v.chainNotice).toBe(NOTE);
      // The table shows the place it moved to; the card is redrawn only when shown again.
      const table = v.chainTable!;
      const now = String(table.rows![table.current % 20]!.cells[col(v, "label")]);
      await table.filter(col(v, "label"), now);
      expect(v.chainNotice).toBeNull();
      await v.showChainAs("cards");
      expect(label(v)).toBe(now);
      expect(v.chainNotice).toBeNull();
      expect(text(v)).not.toContain("no longer matches");
    });

    it("the open result the very first one and dropped: the first kept row after it", async () => {
      const v = await open();
      await v.showResult(0);
      const names = permuted(60).map((l) => l.name);
      const open0 = names[0]!;
      expect(open0.startsWith("Leaf 5")).toBe(false);
      await filterTo(v, "Leaf 5");
      const firstKept = names.find((n) => n.startsWith("Leaf 5"))!;
      await v.showChainAs("cards");
      expect(label(v)).toBe(firstKept);
      expect(v.chainIndex).toBe(0);
      expect(text(v)).toContain(NOTE);
    });

    it("the open result is the last one and the filter keeps it: it stays on it, the last kept row, and says nothing", async () => {
      const v = await open();
      await v.showResult(59);
      const open59 = label(v);
      await filterTo(v, open59.slice(0, 6));
      await v.showChainAs("cards");
      expect(label(v)).toBe(open59);
      expect(v.chainNotice).toBeNull();
      expect(text(v)).toContain("that match");
    });

    it("a sort changed while the open result is somewhere: it stays open, and nothing is said", async () => {
      const v = await open();
      await v.showResult(21);
      const open21 = idOf(v);
      await v.showChainAs("table");
      await v.chainTable!.sortBy(col(v, "label"));
      await v.showChainAs("cards");
      expect(idOf(v)).toBe(open21);
      expect(v.chainNotice).toBeNull();
    });

    it("the card stays on the same thing after a clear of the filter that kept it: its place is its place in all results", async () => {
      const v = await open();
      await filterTo(v, "Leaf 3");
      await v.showChainAs("cards");
      await v.showResult(4);
      const mine = idOf(v);
      await v.clearChainFilters();
      expect(idOf(v)).toBe(mine);
      expect(v.chainNotice).toBeNull();
    });

    it("the note is cleared by a card asked for by place, and by a row picked in the table", async () => {
      const v = await open();
      await v.showResult(0);
      await filterTo(v, "Leaf 5");
      expect(v.chainNotice).toBe(NOTE);
      await v.showChainAs("cards");
      await v.moveResult(2);
      expect(v.chainNotice).toBeNull();
      await v.showChainAs("table");
      await v.chainTable!.filter(col(v, "label"), "Leaf 1");
      // whether the open result is kept or not, what is said must match what happened
      const moved = v.chainTable!.moved;
      expect(v.chainNotice !== null).toBe(moved);
      v.chainTable!.pick(0);
      await v.showChainAs("cards");
      expect(v.chainNotice).toBeNull();
    });

    it("another chain forgets the note, the filters and the sort", async () => {
      const v = await open();
      await v.showResult(0);
      await filterTo(v, "Leaf 5");
      expect(v.chainNotice).toBe(NOTE);
      v.setChain({ ...CHAIN, steps: [{ ...CHAIN.steps[0]!, pin: "Leaf:l0003" }] });
      await Promise.all([v.shown, v.counted]);
      expect(v.chainNotice).toBeNull();
      expect(v.chainArranged).toBeNull();
    });

    it("the same changes asked in the same order on two viewers land on the same card with the same words", async () => {
      const go = async () => {
        const v = await open();
        await v.showResult(17);
        await filterTo(v, "Leaf 2");
        await v.chainTable!.sortBy(col(v, "property:rank"));
        await v.showChainAs("cards");
        return [idOf(v), v.chainIndex, v.chainNotice, text(v)] as const;
      };
      expect(await go()).toEqual(await go());
    });
  });

  describe("nothing matches", () => {
    it("no stale card: the card is gone, the cards know that none match out of all, and the open result is not named", async () => {
      const v = await open();
      await v.showResult(12);
      await filterTo(v, "no such name");
      await v.showChainAs("cards");
      expect(v.chainRow).toBeNull();
      expect(v.chainArranged).toEqual({ matching: 0, total: 60 });
      expect(v.chainNotice).toBeNull();
    });

    it("Clear filters keeps the sort: every result comes back, from the first in the table's order", async () => {
      const v = await open();
      await v.showChainAs("table");
      await v.chainTable!.sortBy(col(v, "property:rank"));
      const sortedFirst = (await v.chainTable!.arrangedRows())[0]!.ids;
      await v.chainTable!.filter(col(v, "label"), "no such name");
      expect((await v.chainTable!.arrangedRows())).toHaveLength(0);
      await v.clearChainFilters();
      expect(v.chainTable!.sort).not.toBeNull();
      expect(v.chainTable!.filters.every((f) => f === "")).toBe(true);
      await v.showChainAs("cards");
      expect(v.chainIndex).toBe(0);
      expect(v.chainRow!.things.map((t) => t.id)).toEqual(sortedFirst);
      expect(v.chainArranged?.matching ?? 60).toBe(60);
    });

    it("a filter changed from nothing-matches to something: a card of the kept rows comes back, never a stale one", async () => {
      const v = await open();
      await v.showResult(12);
      await filterTo(v, "no such name");
      await v.chainTable!.filter(col(v, "label"), "Leaf 4");
      await v.showChainAs("cards");
      expect(v.chainRow).not.toBeNull();
      expect(label(v).startsWith("Leaf 4")).toBe(true);
      expect(v.chainArranged).toEqual({ matching: 10, total: 60 });
    });

    it("Clear filters with nothing filtered changes nothing: the card and the place stay", async () => {
      const v = await open();
      await v.showResult(23);
      const mine = idOf(v);
      await v.showChainAs("table");
      await v.clearChainFilters();
      await v.showChainAs("cards");
      expect(idOf(v)).toBe(mine);
      expect(v.chainIndex).toBe(23);
    });
  });
});
