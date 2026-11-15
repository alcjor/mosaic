// Fix: the table names the page its rows are from (V-11, V-13: the viewer says which
// results it shows, of how many). Found by Area A's "Done when" check on main: right after a move
// to page 2, the status said "Rows 21–40" while the rows on screen were still page 1's, and their
// numbers ran from 21. What the table says, and how it numbers its rows, follow the rows it shows.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import ResultTableView from "../src/components/ResultTableView.svelte";
import { type Chain } from "../src/lib/chain.js";
import { Viewer } from "../src/lib/viewer.svelte.js";

const N = 45;
const pad = (i: number) => String(i).padStart(2, "0");
const BYTES = buildMosaic({
  nodes: [
    { type: "Hub", key: "h", label: "Hub h" },
    ...Array.from({ length: N }, (_, i) => ({ type: "Leaf", key: `l${pad(i)}`, label: `Leaf ${pad(i)}` })),
  ],
  edgeTypes: [["has", "Hub", "Leaf"]],
  edges: Array.from({ length: N }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${pad(i)}`, evidence: [{ locator: `r=${i}` }] })),
});
const CHAIN: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };

async function table(): Promise<Viewer> {
  const v = new Viewer();
  await v.open(BYTES, "hub.mosaic");
  v.setChain(CHAIN);
  await Promise.all([v.shown, v.counted]);
  await v.showChainAs("table");
  return v;
}
const drawn = (v: Viewer) => render(ResultTableView, { props: { table: v.chainTable!, count: v.chainCount, onshow: () => {} } }).body;
/** The row numbers the table shows, in order. */
const numbers = (body: string) => [...body.matchAll(/aria-label="Show result ([\d,]+) as cards"/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
const ids = (v: Viewer) => v.chainTable!.rows!.map((r) => r.ids[1]);

describe("while another page is read, the table still says and numbers the page it shows (V-13)", () => {
  it("a move to page 2 not yet answered: 'Rows 1–20', numbered 1 to 20, page 1's rows; once answered, 'Rows 21–40', numbered 21 to 40", async () => {
    const v = await table();
    const first = ids(v);
    const moving = v.chainTable!.show(1);
    const during = drawn(v);
    // The move is not answered yet: the rows on screen are still page 1's.
    expect(ids(v)[0]).toBe(first[0]);
    expect(during).toContain("Rows 1–20 of 45 results");
    expect(numbers(during)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await moving;
    const after = drawn(v);
    expect(ids(v)[0]).not.toBe(first[0]);
    expect(after).toContain("Rows 21–40 of 45 results");
    expect(numbers(after)).toEqual(Array.from({ length: 20 }, (_, i) => i + 21));
  });

  it("the page the rows are from is the one the table says, at every step of a walk through the pages", async () => {
    const v = await table();
    const t = v.chainTable!;
    for (const page of [1, 2, 0, 2, 1]) {
      const moving = t.show(page);
      expect(numbers(drawn(v))[0]).toBe(t.shownPage * 20 + 1);
      await moving;
      expect(t.shownPage).toBe(page);
      expect(numbers(drawn(v))[0]).toBe(page * 20 + 1);
      expect(drawn(v)).toContain(`Rows ${page * 20 + 1}–`);
    }
  });

  it("the row marked current is marked by its place among the rows shown", async () => {
    const v = await table();
    const t = v.chainTable!;
    t.pick(3);
    const moving = t.show(1);
    // Moving to page 2 makes its first row the place; the rows still shown are page 1's:
    // none of them is marked until page 2's rows are there.
    const during = drawn(v);
    const marked = [...during.matchAll(/<tr data-row="(\d+)"[^>]*aria-current="true"/g)].map((m) => Number(m[1]));
    expect(marked.every((row) => t.rows!.some((r) => r.index === row))).toBe(true);
    expect(t.shownPage).toBe(0);
    expect(marked).toEqual([]);
    await moving;
    const after = [...drawn(v).matchAll(/<tr data-row="(\d+)"[^>]*aria-current="true"/g)].map((m) => Number(m[1]));
    expect(after).toEqual([20]);
  });
});

describe("tableshown: further cases", () => {
  const pad = (i: number, w = 2) => String(i).padStart(w, "0");
  function bytes(n: number): Uint8Array {
    return buildMosaic({
      nodes: [
        { type: "Hub", key: "h", label: "Hub h" },
        ...Array.from({ length: n }, (_, i) => ({
          type: "Leaf",
          key: `l${pad(i, 4)}`,
          label: `${i % 2 === 0 ? "Alpha" : "Beta"} ${pad(i, 4)}`,
          props: `{"rank":${(i * 7) % n}}`,
        })),
      ],
      typeProps: { Leaf: '{"name":"text","rank":"real"}' },
      edgeTypes: [["has", "Hub", "Leaf"]],
      edges: Array.from({ length: n }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${pad(i, 4)}`, evidence: [{ locator: `r=${i}` }] })),
    });
  }
  const CHAIN: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };

  async function table(n = 45): Promise<Viewer> {
    const v = new Viewer();
    await v.open(bytes(n), "hub.mosaic");
    v.setChain(CHAIN);
    await Promise.all([v.shown, v.counted]);
    await v.showChainAs("table");
    return v;
  }
  const exact = (total: number) => ({ total, exact: true, done: true, notes: [] });
  const drawn = (v: Viewer, count: { total: number; exact: boolean; done: boolean; notes: never[] } | null = null) =>
    render(ResultTableView, { props: { table: v.chainTable!, count: count ?? v.chainCount, onshow: () => {} } }).body;
  const numbers = (body: string) => [...body.matchAll(/aria-label="Show result ([\d,]+) as cards"/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  const col = (v: Viewer, key: string) => v.chainTable!.table.columns.findIndex((c) => c.place === 1 && c.key === key);

  describe("the page named is the page of the rows drawn, at every moment (V-13)", () => {
    it("settled, the page shown is the page asked for", async () => {
      const v = await table();
      const t = v.chainTable!;
      await t.show(2);
      await t.shown;
      expect(t.shownPage).toBe(2);
      expect(t.page).toBe(2);
    });

    it("a table just opened names page 1: 'Rows 1–20', numbered 1 to 20", async () => {
      const v = await table();
      expect(v.chainTable!.shownPage).toBe(0);
      const body = drawn(v);
      expect(body).toContain("Rows 1–20 of 45 results");
      expect(numbers(body)).toEqual(range(1, 20));
    });

    it("asking for the page already shown changes nothing, before and after it settles", async () => {
      const v = await table();
      const t = v.chainTable!;
      const before = drawn(v);
      const again = t.show(0);
      expect(drawn(v)).toBe(before);
      await again;
      expect(t.shownPage).toBe(0);
      expect(drawn(v)).toBe(before);
    });

    it("from the short last page back to page 2, still pending: 'Rows 41–45', numbered 41 to 45", async () => {
      const v = await table();
      const t = v.chainTable!;
      await t.show(2);
      const moving = t.show(1);
      const during = drawn(v);
      if (t.shownPage === 2) {
        expect(during).toContain("Rows 41–45 of 45 results");
        expect(numbers(during)).toEqual(range(41, 5));
      }
      await moving;
      expect(drawn(v)).toContain("Rows 21–40 of 45 results");
      expect(numbers(drawn(v))).toEqual(range(21, 20));
    });

    it("two moves asked before either is answered: the last one asked is shown, and says so", async () => {
      const v = await table();
      const t = v.chainTable!;
      const first = t.show(1);
      const second = t.show(2);
      expect(numbers(drawn(v))[0]).toBe(t.shownPage * 20 + 1);
      await Promise.all([first, second]);
      await t.shown;
      expect(t.shownPage).toBe(2);
      expect(t.page).toBe(2);
      const body = drawn(v);
      expect(body).toContain("Rows 41–45 of 45 results");
      expect(numbers(body)).toEqual(range(41, 5));
    });

    it("a move away and a move back asked together: the page the rows are from is the page the table says, and it is page 1", async () => {
      const v = await table();
      const t = v.chainTable!;
      const away = t.show(2);
      const back = t.show(0);
      await Promise.all([away, back]);
      await t.shown;
      expect(t.shownPage).toBe(0);
      const body = drawn(v);
      expect(body).toContain("Rows 1–20 of 45 results");
      expect(numbers(body)).toEqual(range(1, 20));
      expect(t.rows!.map((r) => r.index)).toEqual(range(0, 20));
    });

    it("a stale answer never replaces a later one: moves asked in a burst end on the last", async () => {
      const v = await table();
      const t = v.chainTable!;
      const moves = [2, 1, 0, 2, 1].map((p) => t.show(p));
      await Promise.all(moves);
      await t.shown;
      expect(t.shownPage).toBe(1);
      expect(t.page).toBe(1);
      expect(t.rows!.map((r) => r.index)).toEqual(range(20, 20));
      expect(numbers(drawn(v))).toEqual(range(21, 20));
    });

    it("every moment of a walk: the first number drawn is the first row's place among the results", async () => {
      const v = await table();
      const t = v.chainTable!;
      for (const page of [2, 0, 1, 1, 2, 0]) {
        const moving = t.show(page);
        for (let i = 0; i < 3; i++) {
          expect(numbers(drawn(v))[0]).toBe(t.rows![0]!.index + 1);
          await Promise.resolve();
        }
        await moving;
        expect(numbers(drawn(v))[0]).toBe(t.rows![0]!.index + 1);
        expect(t.shownPage).toBe(page);
      }
    });

    it("while the count runs, a pending move still names the rows shown: 'Rows 1–20 of at least …'", async () => {
      const v = await table();
      const t = v.chainTable!;
      const moving = t.show(1);
      const running = { total: 45, exact: false, done: false, notes: [] as never[] };
      const during = drawn(v, running);
      if (t.shownPage === 0) {
        expect(during).toContain("Rows 1–20 of at least 45 results");
        expect(numbers(during)).toEqual(range(1, 20));
      }
      await moving;
      expect(drawn(v, running)).toContain("Rows 21–40 of at least 45 results");
    });

    it("the same state drawn twice gives the same bytes, pending or not", async () => {
      const v = await table();
      const t = v.chainTable!;
      const moving = t.show(1);
      expect(drawn(v, exact(45))).toBe(drawn(v, exact(45)));
      await moving;
      expect(drawn(v, exact(45))).toBe(drawn(v, exact(45)));
    });
  });

  describe("with a sort or a filter, the numbers follow the rows shown (V-11, V-13)", () => {
    it("sorted, a pending move to page 2 names page 1's rows and numbers them 1 to 20; answered, 21 to 40", async () => {
      const v = await table();
      const t = v.chainTable!;
      await t.sortBy(col(v, "property:rank"));
      await t.show(0);
      const moving = t.show(1);
      const during = drawn(v);
      if (t.shownPage === 0) {
        expect(during).toContain("Rows 1–20 of 45");
        expect(numbers(during)).toEqual(range(1, 20));
      }
      await moving;
      expect(numbers(drawn(v))).toEqual(range(21, 20));
      expect(t.rows!.map((r) => r.cells[col(v, "property:rank")])).toEqual(range(20, 20));
    });

    it("filtered to 30 rows, a pending move to page 2 keeps page 1's numbers; answered, 21 to 30", async () => {
      const v = await table(60);
      const t = v.chainTable!;
      await t.filter(col(v, "label"), "Alpha");
      expect(t.matching).toBe(30);
      await t.show(0);
      const moving = t.show(1);
      const during = numbers(drawn(v, exact(60)));
      if (t.shownPage === 0) expect(during).toEqual(range(1, 20));
      await moving;
      expect(t.shownPage).toBe(1);
      expect(numbers(drawn(v, exact(60)))).toEqual(range(21, 10));
    });

    it("a filter set while on page 3 brings the table to rows it can name: the numbers start at the first row's place", async () => {
      const v = await table(60);
      const t = v.chainTable!;
      await t.show(2);
      await t.filter(col(v, "label"), "Alpha");
      await t.shown;
      const first = numbers(drawn(v, exact(60)))[0]!;
      expect(first).toBe(t.shownPage * 20 + 1);
      expect(t.rows!.length).toBeGreaterThan(0);
    });
  });

  describe("the cards and the table agree on which page is shown (V-12, V-13)", () => {
    it("a result asked for on page 2 opens the table on page 2, and names it", async () => {
      const v = await table();
      await v.showChainAs("cards");
      await v.showResult(23);
      await v.showChainAs("table");
      const t = v.chainTable!;
      await t.shown;
      expect(t.shownPage).toBe(1);
      const body = drawn(v);
      expect(body).toContain("Rows 21–40 of 45 results");
      expect(numbers(body)).toEqual(range(21, 20));
    });

    it("back in the table after a move to page 3, it names page 3", async () => {
      const v = await table();
      await v.chainTable!.show(2);
      await v.showChainAs("cards");
      await v.showChainAs("table");
      await v.chainTable!.shown;
      expect(v.chainTable!.shownPage).toBe(2);
      expect(numbers(drawn(v))).toEqual(range(41, 5));
    });
  });

  describe("numbers beyond a thousand (V-13)", () => {
    it("a pending move from the last page to the first keeps the last page's numbers, 1201 to 1205", async () => {
      const v = await table(1205);
      const t = v.chainTable!;
      await t.show(60);
      expect(t.shownPage).toBe(60);
      expect(numbers(drawn(v, exact(1205)))).toEqual(range(1201, 5));
      const moving = t.show(0);
      const during = numbers(drawn(v, exact(1205)));
      if (t.shownPage === 60) expect(during).toEqual(range(1201, 5));
      await moving;
      expect(numbers(drawn(v, exact(1205)))).toEqual(range(1, 20));
    });
  });
});
