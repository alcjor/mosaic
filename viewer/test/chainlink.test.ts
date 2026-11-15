// Link to a chain (docs/design.md V-17): the viewer can link to one chain, with its pinned
// steps and filters, so a colleague lands on exactly the same results. The address holds the
// chain, its pins, the view (cards or table), the place in the results and the table's filters
// and sort; a link naming what the mosaic lacks opens and reports it (V-18).
import { describe, expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import { type Chain } from "../src/lib/chain.js";
import { parseRoute, routeHash, type ChainLinkRoute } from "../src/lib/route.js";
import { Viewer } from "../src/lib/viewer.svelte.js";

const N = 45;
const pad = (i: number) => String(i).padStart(2, "0");
/** One hub linked to N leaves, each with a rank; leaf i is named "Leaf <rank>", rank = (i * 7) % N. Leaf i is in group g<i % 3>. */
function bytes(): Uint8Array {
  return buildMosaic({
    nodes: [
      { type: "Hub", key: "h", label: "Hub h" },
      { type: "Hub", key: "k", label: "Hub k" },
      ...Array.from({ length: N }, (_, i) => ({ type: "Leaf", key: `l${pad(i)}`, label: `Leaf ${pad((i * 7) % N)}`, props: `{"rank":${(i * 7) % N}}` })),
      ...[0, 1, 2].map((g) => ({ type: "Group", key: `g${g}`, label: `Group ${g}` })),
    ],
    typeProps: { Leaf: '{"name":"text","rank":"real"}' },
    edgeTypes: [
      ["has", "Hub", "Leaf"],
      ["in_group", "Leaf", "Group"],
    ],
    edges: [
      ...Array.from({ length: N }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${pad(i)}`, evidence: [{ locator: `r=${i}` }] })),
      ...Array.from({ length: N }, (_, i) => ({ type: "in_group", from: `Leaf:l${pad(i)}`, to: `Group:g${i % 3}`, evidence: [{ locator: `g=${i}` }] })),
    ],
  });
}
const FILE = bytes();
const CHAIN: Chain = {
  start: "Hub",
  pin: "Hub:h",
  steps: [
    { edge: "has", direction: "out", type: "Leaf", pin: null },
    { edge: "in_group", direction: "out", type: "Group", pin: "Group:g1" },
  ],
};

async function opened(): Promise<Viewer> {
  const v = new Viewer();
  await v.open(FILE, "hub.mosaic");
  return v;
}
async function withChain(chain: Chain = CHAIN): Promise<Viewer> {
  const v = await opened();
  v.setChain(chain);
  await Promise.all([v.shown, v.counted]);
  return v;
}
const column = (v: Viewer, place: number, key: string) => v.chainTable!.table.columns.findIndex((c) => c.place === place && c.key === key);
/** What a person sees of the chain's results: the view, the place, the result open and the rows the table keeps. */
async function seen(v: Viewer) {
  const table = v.chainTable!;
  return {
    chain: v.chain,
    show: v.chainShow,
    // In the table, the place is the table's: the cards show it when shown again.
    columns: v.chainColumns?.columns.map((c) => c.things.map((t) => t.id)) ?? null,
    current: table.current,
    filters: table.filters,
    sort: table.sort,
    rows: (await table.arrangedRows()).map((r) => r.ids),
    page: v.chainShow === "table" ? table.rows?.map((r) => r.ids) : null,
  };
}
/** Open the address `hash` in a new viewer on the same mosaic, as a colleague would. */
async function follow(hash: string): Promise<Viewer> {
  const v = await opened();
  const route = parseRoute(hash);
  await v.openChainLink(route.chain!);
  return v;
}

describe("the address holds the chain (V-17)", () => {
  it("a chain with pins, the view, the place, the filters and the sort survive the address's round trip", () => {
    const link: ChainLinkRoute = {
      start: "Country",
      pin: "Country:United States",
      steps: [
        { link: "made_in in", pin: null },
        { link: "directed_by", pin: "Person:A&B=C #1" },
      ],
      show: "table",
      at: 42,
      sort: { place: 3, column: "property:release year", desc: true },
      filters: [
        { place: 3, column: "label", text: "john & co" },
        { place: 2, column: "count:made_in out", text: "=1" },
      ],
    };
    const route = { query: "x", node: null, view: "trails" as const, chain: link };
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it("the defaults are left out: columns, the first row, no sort, no filter, no pin", () => {
    const link: ChainLinkRoute = { start: "Hub", pin: null, steps: [{ link: "has", pin: null }], show: "columns", at: 1, sort: null, filters: [] };
    const hash = routeHash({ query: "", node: null, view: "trails", chain: link });
    expect(hash).toBe("#v=trails&c=Hub&k=has");
    expect(parseRoute(hash).chain).toEqual(link);
  });

  it("a chain is read only with v=trails and a start; what is malformed is the default", () => {
    expect(parseRoute("#c=Hub&k=has").chain).toBeUndefined();
    expect(parseRoute("#v=trails").chain).toBeUndefined();
    const odd = parseRoute("#v=trails&c=Hub&k=has&k=&show=grid&at=0&co=x&cf=%7Bnot%20json&p9=Leaf:l00").chain!;
    expect(odd).toEqual({ start: "Hub", pin: null, steps: [{ link: "has", pin: null }], show: "columns", at: 1, sort: null, filters: [] });
    const bad = parseRoute('#v=trails&c=Hub&k=has&at=-3&co=0%20label&cf=[[0,"label","x"],[1,2,"y"],[2,"label"],[2,"label","ok"]]').chain!;
    expect(bad.at).toBe(1);
    expect(bad.sort).toBeNull();
    expect(bad.filters).toEqual([{ place: 2, column: "label", text: "ok" }]);
  });
});

describe("the page writes its chain into the address, and the address opens the same results (V-17)", () => {
  it("the chain alone, as columns", async () => {
    const v = await withChain();
    const link = v.chainLink()!;
    expect(link).toEqual({
      start: "Hub",
      pin: "Hub:h",
      steps: [
        { link: "has", pin: null },
        { link: "in_group", pin: "Group:g1" },
      ],
      show: "columns",
      at: 1,
      sort: null,
      filters: [],
    });
    const w = await follow(routeHash({ query: "", node: null, view: "trails", chain: link }));
    expect(await seen(w)).toEqual(await seen(v));
    expect(w.linkNotices).toEqual([]);
  });

  it("the table, on a later page, with the place on it", async () => {
    const v = await withChain({ ...CHAIN, steps: [CHAIN.steps[0]!] });
    await v.showChainAs("table");
    await v.chainTable!.show(2);
    v.chainTable!.pick(43);
    const link = v.chainLink()!;
    expect(link).toMatchObject({ show: "table", at: 44, sort: null, filters: [] });
    const w = await follow(routeHash({ query: "", node: null, view: "trails", chain: link }));
    expect(w.chainShow).toBe("table");
    expect(w.chainTable!.page).toBe(2);
    expect(await seen(w)).toEqual(await seen(v));
  });

  it("a place beyond the last result opens the last one", async () => {
    const t = await follow("#v=trails&c=Hub&p0=Hub:h&k=has&at=999&show=table");
    expect(t.chainTable!.current).toBe(N - 1);
    expect(t.chainTable!.page).toBe(2);
  });

  it("the address changes with the chain, the view, the place, the filters and the sort", async () => {
    const v = await withChain({ ...CHAIN, steps: [CHAIN.steps[0]!] });
    const hashes = new Set<string>();
    const note = () => hashes.add(routeHash({ query: "", node: null, view: "trails", chain: v.chainLink() }));
    note();
    await v.showChainAs("table");
    note();
    await v.chainTable!.filter(column(v, 1, "label"), "2");
    note();
    await v.chainTable!.sortBy(column(v, 1, "label"));
    note();
    v.setChain(CHAIN);
    await v.shown;
    note();
    expect(hashes.size).toBe(5);
  });

  it("no chain, no link", async () => {
    const v = await opened();
    expect(v.chainLink()).toBeNull();
  });
});

describe("a link naming what the mosaic lacks opens and reports it (V-18)", () => {
  it("a type, an edge type or a pinned thing the mosaic lacks: no chain, and a notice naming it", async () => {
    for (const [hash, said] of [
      ["#v=trails&c=Film&k=has", "link: the mosaic has no node type Film"],
      ["#v=trails&c=Hub&k=directed_by", "link: step 1: the mosaic has no edge type directed_by"],
      ["#v=trails&c=Hub&p0=Hub:zz&k=has", "link: the mosaic has no thing Hub:zz"],
      ["#v=trails&c=Hub&k=has&p1=Leaf:nope", "link: the mosaic has no thing Leaf:nope"],
    ] as const) {
      const w = await follow(hash);
      expect(w.chain, hash).toBeNull();
      expect(w.linkNotices, hash).toEqual([said]);
    }
  });

  it("a filter or a sort on a column the table lacks is left out and named; the rest applies", async () => {
    const w = await follow('#v=trails&c=Hub&p0=Hub:h&k=has&co=2%20property:size&cf=[[2,"property:colour","red"],[2,"label","leaf 2"],[7,"label","x"]]');
    expect(w.chain).not.toBeNull();
    expect(w.chainTable!.sort).toBeNull();
    expect(w.chainTable!.filters.filter((f) => f !== "")).toEqual(["leaf 2"]);
    expect(await w.chainTable!.arrangedRows()).toHaveLength(10); // Leaf 20 … Leaf 29
    expect(w.linkNotices).toEqual([
      "link: the table has no column property:size at place 2: its sort is not applied",
      "link: the table has no column property:colour at place 2: its filter is not applied",
      "link: the table has no column label at place 7: its filter is not applied",
    ]);
  });

  it("a new link clears the notices of the one before", async () => {
    const w = await follow("#v=trails&c=Film&k=has");
    expect(w.linkNotices).toHaveLength(1);
    await w.openChainLink(parseRoute("#v=trails&c=Hub&k=has").chain!);
    expect(w.linkNotices).toEqual([]);
    expect(w.chain?.start).toBe("Hub");
  });
});

describe("a link that could not be applied stays in the address; a chain built by hand clears its notices", () => {
  it("while the link's chain could not open, the address is left as it is; once the person builds a chain, it follows", async () => {
    const w = await follow("#v=trails&c=Film&k=has");
    expect(w.chain).toBeNull();
    expect(w.chainAddress()).toBeUndefined();
    w.chooseChain({ start: "Hub", pin: null, steps: [] });
    await w.shown;
    expect(w.linkNotices).toEqual([]);
    expect(w.chainAddress()).toEqual(w.chainLink());
  });

  it("a chain shown writes itself; no chain and no failed link writes none", async () => {
    const v = await withChain();
    expect(v.chainAddress()).toEqual(v.chainLink());
    const u = await opened();
    expect(u.chainAddress()).toBeNull();
  });

  it("a chain built by hand after a link that half applied clears that link's notices", async () => {
    const w = await follow('#v=trails&c=Hub&p0=Hub:h&k=has&cf=[[2,"property:colour","red"]]');
    expect(w.linkNotices).toHaveLength(1);
    w.chooseChain(CHAIN);
    expect(w.linkNotices).toEqual([]);
  });
});

describe("chainlink: further cases", () => {
  const N = 30;
  const pad = (i: number) => String(i).padStart(2, "0");
  const ODD_KEY = "Zoë 日本 & co=#1 100% +x";
  const bytes = buildMosaic({
    nodes: [
      { type: "Hub", key: "h", label: "Hub h" },
      { type: "Hub", key: "k", label: "Hub k (no leaves)" },
      { type: "Hub", key: ODD_KEY, label: "Odd hub" },
      ...Array.from({ length: N }, (_, i) => ({ type: "Leaf", key: `l${pad(i)}`, label: `Leaf ${pad((i * 7) % N)}`, props: `{"rank":${(i * 7) % N}}` })),
      ...[0, 1, 2].map((g) => ({ type: "Group", key: `g${g}`, label: `Group ${g}` })),
    ],
    typeProps: { Leaf: '{"name":"text","rank":"real"}' },
    edgeTypes: [
      ["has", "Hub", "Leaf"],
      ["in_group", "Leaf", "Group"],
    ],
    edges: [
      ...Array.from({ length: N }, (_, i) => ({ type: "has", from: i < 5 ? `Hub:${ODD_KEY}` : "Hub:h", to: `Leaf:l${pad(i)}`, evidence: [{ locator: `r=${i}` }] })),
      ...Array.from({ length: N }, (_, i) => ({ type: "in_group", from: `Leaf:l${pad(i)}`, to: `Group:g${i % 3}`, evidence: [{ locator: `g=${i}` }] })),
    ],
  });

  const OUT: Chain = { start: "Hub", pin: "Hub:h", steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] };
  const IN: Chain = { start: "Leaf", pin: null, steps: [{ edge: "has", direction: "in", type: "Hub", pin: null }] };

  async function opened(): Promise<Viewer> {
    const v = new Viewer();
    await v.open(bytes, "hub.mosaic");
    return v;
  }
  async function withChain(chain: Chain): Promise<Viewer> {
    const v = await opened();
    v.setChain(chain);
    await Promise.all([v.shown, v.counted]);
    return v;
  }
  const column = (v: Viewer, place: number, key: string) => v.chainTable!.table.columns.findIndex((c) => c.place === place && c.key === key);
  async function seen(v: Viewer) {
    const table = v.chainTable;
    return {
      chain: v.chain,
      show: v.chainShow,
      columns: v.chainColumns?.columns.map((c) => c.things.map((t) => t.id)) ?? null,
      current: table?.current ?? null,
      filters: table?.filters ?? null,
      sort: table?.sort ?? null,
      rows: table ? (await table.arrangedRows()).map((r) => r.ids) : null,
      // The page the table shows is not in the address (only the place is): it is compared where
      // the place is on it.
      count: v.chainCount,
    };
  }
  const hashOf = (link: ChainLinkRoute | null) => routeHash({ query: "", node: null, view: "trails", chain: link });
  async function follow(hash: string, into?: Viewer): Promise<Viewer> {
    const v = into ?? (await opened());
    await v.openChainLink(parseRoute(hash).chain!);
    // The count runs in the background: compare once it has settled.
    await Promise.all([v.shown, v.counted]);
    return v;
  }

  describe("the address: grammar edges (V-17)", () => {
    it("a chain with no steps, only a start, survives the round trip", () => {
      const link: ChainLinkRoute = { start: "Hub", pin: "Hub:h", steps: [], show: "columns", at: 1, sort: null, filters: [] };
      expect(parseRoute(hashOf(link)).chain).toEqual(link);
    });

    it("names and pins with non-ASCII, percent, plus, quote, bracket and newline characters survive", () => {
      const link: ChainLinkRoute = {
        start: "Tipo ñ 日本",
        pin: `Tipo ñ 日本:${ODD_KEY}`,
        steps: [
          { link: "dirigé_par in", pin: "Person:😀%41 \"q\" [1,2]\n" },
          { link: "à→b", pin: null },
        ],
        show: "table",
        at: 7,
        sort: { place: 2, column: "property:größe & wert=1", desc: false },
        filters: [{ place: 3, column: "label", text: 'é "x" ] [ , & = # % + \n 😀' }],
      };
      expect(parseRoute(hashOf(link)).chain).toEqual(link);
    });

    it("a long chain with long pins and long filter text survives the round trip", () => {
      const long = "ü".repeat(3000) + "&=#";
      const link: ChainLinkRoute = {
        start: "T0",
        pin: `T0:${long}`,
        steps: Array.from({ length: 40 }, (_, i) => ({ link: `e${i}${i % 2 ? " in" : ""}`, pin: i % 5 === 0 ? `T${i + 1}:${long}` : null })),
        show: "columns",
        at: 123456,
        sort: null,
        filters: [{ place: 41, column: "label", text: long }],
      };
      expect(parseRoute(hashOf(link)).chain).toEqual(link);
    });

    it("the same link gives the same address every time, and reading then writing it again changes nothing", () => {
      const link: ChainLinkRoute = {
        start: "Hub",
        pin: "Hub:h",
        steps: [{ link: "has", pin: null }, { link: "in_group", pin: "Group:g1" }],
        show: "table",
        at: 5,
        sort: { place: 2, column: "property:rank", desc: true },
        filters: [{ place: 2, column: "label", text: "leaf" }, { place: 3, column: "label", text: "1" }],
      };
      const once = hashOf(link);
      expect(hashOf(link)).toBe(once);
      expect(routeHash(parseRoute(once))).toBe(once);
    });

    it("the parameters may come in any order and mean the same chain", () => {
      const a = parseRoute("#v=trails&c=Hub&p0=Hub:h&k=has&k=in_group&p2=Group:g1&show=table&at=4&co=2%20property:rank&cd=1&cf=[[2,\"label\",\"leaf\"]]").chain;
      const b = parseRoute("#cf=[[2,\"label\",\"leaf\"]]&cd=1&co=2%20property:rank&at=4&show=table&p2=Group:g1&k=has&k=in_group&p0=Hub:h&c=Hub&v=trails").chain;
      expect(a).toBeDefined();
      expect(b).toEqual(a);
      expect(a!.steps.map((s) => s.link)).toEqual(["has", "in_group"]);
    });

    it("a pin on place 0 and on a step are told apart from no pin; an empty pin is no pin", () => {
      const c = parseRoute("#v=trails&c=Hub&k=has&k=in_group&p0=&p2=Group:g1").chain!;
      expect(c.pin).toBeNull();
      expect(c.steps).toEqual([{ link: "has", pin: null }, { link: "in_group", pin: "Group:g1" }]);
    });

    it("a place that is not a whole number from 1 is the first result", () => {
      for (const at of ["", "abc", "2.5", "-1", "0", "NaN", "1e3x"]) {
        expect(parseRoute(`#v=trails&c=Hub&k=has&at=${at}`).chain!.at, `at=${at}`).toBe(1);
      }
      expect(parseRoute("#v=trails&c=Hub&k=has&at=12").chain!.at).toBe(12);
    });

    it("a sort or filter whose place is not from 1, or not whole, is dropped, not thrown on", () => {
      const c = parseRoute('#v=trails&c=Hub&k=has&co=0%20label&cf=[[0,"label","a"],[1.5,"label","b"],[-2,"label","c"],[1,"label","ok"]]').chain!;
      expect(c.sort).toBeNull();
      expect(c.filters).toEqual([{ place: 1, column: "label", text: "ok" }]);
    });

    it("a filter list that is not a list, or a sort with no column, is the default", () => {
      for (const cf of ["{}", '"x"', "7", "null", "[[", "[[1]]"]) {
        expect(() => parseRoute(`#v=trails&c=Hub&k=has&cf=${encodeURIComponent(cf)}`), cf).not.toThrow();
        expect(parseRoute(`#v=trails&c=Hub&k=has&cf=${encodeURIComponent(cf)}`).chain!.filters, cf).toEqual([]);
      }
      expect(parseRoute("#v=trails&c=Hub&k=has&co=2").chain!.sort).toBeNull();
      expect(parseRoute("#v=trails&c=Hub&k=has&cd=1").chain!.sort).toBeNull();
    });

    it("a descending sort writes cd=1, an ascending one does not", () => {
      const base = { start: "Hub", pin: null, steps: [{ link: "has", pin: null }], show: "table" as const, at: 1, filters: [] };
      const desc = hashOf({ ...base, sort: { place: 2, column: "label", desc: true } });
      const asc = hashOf({ ...base, sort: { place: 2, column: "label", desc: false } });
      expect(desc).toContain("cd=1");
      expect(asc).not.toContain("cd=");
      expect(parseRoute(asc).chain!.sort).toEqual({ place: 2, column: "label", desc: false });
      expect(parseRoute(desc).chain!.sort).toEqual({ place: 2, column: "label", desc: true });
    });

    it("the chain rides with a query and a node, and each comes back whole", () => {
      const link: ChainLinkRoute = { start: "Hub", pin: null, steps: [{ link: "has", pin: null }], show: "columns", at: 2, sort: null, filters: [] };
      const route = { query: "a&b=c", node: "Hub:A&B", view: "trails" as const, chain: link };
      expect(parseRoute(routeHash(route))).toEqual(route);
    });

    it("a chain's address does not turn into a neighbourhood's or a table's choices", () => {
      const r = parseRoute("#v=trails&c=Hub&k=has&p0=Hub:h&at=3");
      expect(r.hood ?? null).toBeNull();
      expect(r.table ?? null).toBeNull();
    });

    it("a chain view without a chain is written as the view alone and read back with no chain", () => {
      const hash = routeHash({ query: "", node: null, view: "trails" });
      expect(hash).toBe("#v=trails");
      expect(parseRoute(hash).view).toBe("trails");
      expect(parseRoute(hash).chain).toBeUndefined();
    });
  });

  describe("opening the link shows the same results (V-17)", () => {
    it("a chain followed against the arrow (in) opens the same", async () => {
      const v = await withChain(IN);
      const link = v.chainLink()!;
      expect(link.steps).toEqual([{ link: "has in", pin: null }]);
      const w = await follow(hashOf(link));
      expect(await seen(w)).toEqual(await seen(v));
    });

    it("a thing whose id holds spaces, ampersands, equals, hashes, percent and non-ASCII is a pin that opens", async () => {
      const v = await withChain({ ...OUT, pin: `Hub:${ODD_KEY}` });
      expect(v.chainCount).not.toBeNull();
      const link = v.chainLink()!;
      expect(link.pin).toBe(`Hub:${ODD_KEY}`);
      const w = await follow(hashOf(link));
      expect(w.linkNotices).toEqual([]);
      expect(await seen(w)).toEqual(await seen(v));
      expect(w.chainColumns?.columns[0]?.things[0]?.id).toBe(`Hub:${ODD_KEY}`);
    });

    it("the link written, read and applied twice gives the same results and the same address", async () => {
      const v = await withChain(OUT);
      await v.showChainAs("table");
      await v.chainTable!.sortBy(column(v, 1, "property:rank"));
      await v.chainTable!.filter(column(v, 1, "label"), "leaf 2");
      const hash = hashOf(v.chainLink());
      const a = await follow(hash);
      const b = await follow(hash);
      expect(await seen(a)).toEqual(await seen(b));
      expect(hashOf(a.chainLink())).toBe(hash);
      expect(hashOf(b.chainLink())).toBe(hash);
    });

    it("a table sorted, filtered, on a later page with the place on it opens the same, rows and all", async () => {
      const v = await withChain(OUT);
      await v.showChainAs("table");
      await v.chainTable!.sortBy(column(v, 1, "property:rank"));
      await v.chainTable!.sortBy(column(v, 1, "property:rank"));
      await v.chainTable!.filter(column(v, 1, "label"), "leaf");
      await v.chainTable!.show(1);
      v.chainTable!.pick(21);
      const link = v.chainLink()!;
      const w = await follow(hashOf(link));
      expect(w.linkNotices).toEqual([]);
      expect(await seen(w)).toEqual(await seen(v));
      expect(w.chainTable!.page).toBe(v.chainTable!.page);
    });

    it("a filter on the start's own column, and on two places at once, opens the same", async () => {
      const v = await withChain({ start: "Leaf", pin: null, steps: [{ edge: "has", direction: "in", type: "Hub", pin: null }] });
      await v.showChainAs("table");
      await v.chainTable!.filter(column(v, 0, "label"), "leaf 1");
      await v.chainTable!.filter(column(v, 1, "label"), "hub h");
      const link = v.chainLink()!;
      expect(link.filters.map((f) => f.place).sort()).toEqual([1, 2]);
      const w = await follow(hashOf(link));
      expect(await seen(w)).toEqual(await seen(v));
    });

    it("a sort on a count column keeps its column and direction", async () => {
      const v = await withChain({ start: "Hub", pin: null, steps: [{ edge: "has", direction: "out", type: "Leaf", pin: null }] });
      await v.showChainAs("table");
      const counts = v.chainTable!.table.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.key.startsWith("count:"));
      expect(counts.length).toBeGreaterThan(0);
      await v.chainTable!.sortBy(counts[0]!.i);
      await v.chainTable!.sortBy(counts[0]!.i);
      const link = v.chainLink()!;
      expect(link.sort).toMatchObject({ column: counts[0]!.c.key, desc: true });
      const w = await follow(hashOf(link));
      expect(await seen(w)).toEqual(await seen(v));
    });

    it("a chain with no results opens with none, and says none", async () => {
      const v = await withChain({ ...OUT, pin: "Hub:k" });
      const w = await follow(hashOf(v.chainLink()));
      expect(w.linkNotices).toEqual([]);
      expect(await seen(w)).toEqual(await seen(v));
      expect(w.chainCount).toEqual(v.chainCount);
    });

    it("a filter that matches nothing opens with none, the filter kept, and does not fail", async () => {
      const v = await withChain(OUT);
      await v.showChainAs("table");
      await v.chainTable!.filter(column(v, 1, "label"), "zzz-not-there");
      const link = v.chainLink()!;
      const w = await follow(hashOf(link));
      expect(w.linkNotices).toEqual([]);
      expect(await w.chainTable!.arrangedRows()).toHaveLength(0);
      expect(await seen(w)).toEqual(await seen(v));
    });

    it("opening a link replaces the chain, the filters, the sort and the place the viewer had", async () => {
      const w = await withChain(OUT);
      await w.showChainAs("table");
      await w.chainTable!.filter(column(w, 1, "label"), "leaf 1");
      await w.chainTable!.sortBy(column(w, 1, "label"));
      await follow("#v=trails&c=Hub&p0=Hub:h&k=has", w);
      const fresh = await follow("#v=trails&c=Hub&p0=Hub:h&k=has");
      expect(await seen(w)).toEqual(await seen(fresh));
      expect(w.chainShow).toBe("columns");
      expect(w.chainLink()!.filters).toEqual([]);
      expect(w.chainLink()!.sort).toBeNull();
      expect(w.chainLink()!.at).toBe(1);
    });

    it("two links opened one right after the other leave the second one's results", async () => {
      const w = await opened();
      const a = parseRoute("#v=trails&c=Hub&p0=Hub:h&k=has&at=9").chain!;
      const b = parseRoute("#v=trails&c=Leaf&k=in_group&show=table").chain!;
      await Promise.all([w.openChainLink(a), w.openChainLink(b)]);
      await Promise.all([w.shown, w.counted]);
      const only = await follow("#v=trails&c=Leaf&k=in_group&show=table");
      expect(w.chain?.start).toBe("Leaf");
      expect(await seen(w)).toEqual(await seen(only));
      expect(w.linking).toBe(false);
      expect(w.linkNotices).toEqual([]);
    });

    it("the link is the same however many times the page asks for it", async () => {
      const v = await withChain(OUT);
      expect(v.chainLink()).toEqual(v.chainLink());
      expect(hashOf(v.chainLink())).toBe(hashOf(v.chainLink()));
    });

  });

  describe("a link naming what the mosaic lacks opens and reports it (V-18)", () => {
    it("an edge type the mosaic has, but not out of that place's type, is reported by name", async () => {
      for (const [hash, name] of [
        ["#v=trails&c=Group&k=has", "has"],
        ["#v=trails&c=Hub&k=has%20in", "has"],
        ["#v=trails&c=Hub&k=has&k=has", "has"],
      ] as const) {
        const w = await follow(hash);
        expect(w.chain, hash).toBeNull();
        expect(w.linkNotices.length, hash).toBeGreaterThan(0);
        expect(w.linkNotices.join("\n"), hash).toContain(name);
      }
    });

    it("a link with several faults gives one notice, naming one thing that is really missing (the first)", async () => {
      const w = await follow("#v=trails&c=Hub&p0=Hub:zz&k=has&k=directed_by&p1=Leaf:nope");
      expect(w.chain).toBeNull();
      expect(w.linkNotices).toHaveLength(1);
      expect(w.linkNotices[0]).toMatch(/directed_by|Hub:zz|Leaf:nope/);
    });

    it("a missing start type is named even when everything after it is also missing", async () => {
      const w = await follow("#v=trails&c=Film&p0=Film:x&k=directed_by&p1=Person:y");
      expect(w.chain).toBeNull();
      expect(w.linkNotices.join("\n")).toContain("Film");
    });

    it("a failing link after a good one leaves no stale chain and no stale results", async () => {
      const w = await follow("#v=trails&c=Hub&p0=Hub:h&k=has");
      expect(w.chain).not.toBeNull();
      await follow("#v=trails&c=Film&k=has", w);
      expect(w.chain).toBeNull();
      expect(w.linkNotices.join("\n")).toContain("Film");
      expect(w.linkNotices.join("\n")).not.toContain("Hub");
      expect(w.chainLink()).toBeNull();
      expect(w.linking).toBe(false);
    });

    it("the notices say what is missing without raising: the viewer is still usable afterwards", async () => {
      const w = await follow("#v=trails&c=Film&k=has");
      w.setChain(OUT);
      await Promise.all([w.shown, w.counted]);
      expect(w.chain).toEqual(OUT);
      expect(w.chainRow).not.toBeNull();
    });

    it("a link with a good chain and a table choice on an absent column keeps the chain and its place", async () => {
      const w = await follow('#v=trails&c=Hub&p0=Hub:h&k=has&show=table&at=5&cf=[[2,"property:nope","x"]]');
      expect(w.chain).not.toBeNull();
      expect(w.chainShow).toBe("table");
      expect(w.chainTable!.current).toBe(4);
      expect(w.linkNotices.join("\n")).toContain("property:nope");
      expect(w.chainTable!.filters.filter((f) => f !== "")).toEqual([]);
    });

    it("a filter on a place beyond the chain's last, and on place 0, are named and left out", async () => {
      const w = await follow('#v=trails&c=Hub&p0=Hub:h&k=has&cf=[[9,"label","x"],[1,"label","hub"]]');
      expect(w.chain).not.toBeNull();
      expect(w.linkNotices.join("\n")).toContain("9");
      expect(w.chainTable!.filters.filter((f) => f !== "")).toEqual(["hub"]);
    });

    it("a pin that is a thing of another type than its place is not taken for a good pin", async () => {
      const w = await follow("#v=trails&c=Hub&p0=Leaf:l00&k=has");
      const results = w.chainCount;
      // Either the link is refused and the thing named, or it opens with no result: never a result
      // that is not under the pinned thing.
      if (w.chain === null) expect(w.linkNotices.join("\n")).toContain("Leaf:l00");
      else expect(JSON.stringify(results)).not.toContain('"total":30');
    });
  });
});
