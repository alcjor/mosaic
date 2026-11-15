// Chain results as one table (docs/design.md, "Viewer: chains and cards"): V-11, the viewer
// shows all results of a chain as one table, with one group of columns per step, that can be
// sorted, filtered and saved as a file; V-13, the results come in the chain's order, and
// the viewer says how many there are.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type EdgeSpec, type NodeSpec } from "../../kit/test/build-mosaic.js";
import ResultTableView from "../src/components/ResultTableView.svelte";
import { ChainTable, TABLE_ROWS } from "../src/lib/chaintable.svelte.js";
import { type Chain, type Step } from "../src/lib/chain.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { ChainResults } from "../src/lib/results.js";
import { filterRows, ResultTable, sortRows, tableColumns, tableCsv, type TableRow, NAMED, type Cell, type Column } from "../src/lib/resulttable.js";
import { parseView, Shape } from "../src/lib/view.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";

const step = (edge: string, direction: "out" | "in", type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
const ITEMS: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };

async function opened(view: unknown = {}) {
  const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
  return { file, shape: new Shape(parseView(view), file) };
}

describe("one group of columns per place, from that type's card (V-11, V-7)", () => {
  it("each place: the thing's name, then what its type's card shows", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Item", show: ["code"], links: [], counts: ["in_group"] }] });
    const columns = tableColumns(ITEMS, file, shape);
    expect(columns.map((c) => [c.place, c.key])).toEqual([
      [0, "label"],
      [0, "property:code"],
      [0, "count:in_group out"],
      [1, "label"],
      [1, "property:name"],
      [1, "count:in_group in"],
    ]);
    expect(columns[0]).toMatchObject({ group: "Item", label: "name", type: "Item" });
  });

  it("a type with no card set: its name, its declared properties and a count per link, as its default card", async () => {
    const { file, shape } = await opened();
    const keys = tableColumns(ITEMS, file, shape).filter((c) => c.place === 0).map((c) => c.key);
    expect(keys[0]).toBe("label");
    expect(keys).toContain("property:code");
    expect(keys).toContain("count:in_group out");
    expect(keys.every((k) => k === "label" || k.startsWith("property:") || k.startsWith("count:"))).toBe(true);
  });

  it("the view file's labels name the groups and the columns", async () => {
    const { file, shape } = await opened({ types: [{ name: "Item", label: "Thing", names: { code: "Code" } }, { name: "Group" }] });
    const columns = tableColumns(ITEMS, file, shape);
    expect(columns.find((c) => c.key === "property:code")).toMatchObject({ group: "Thing", label: "Code" });
  });
});

describe("the rows: one per result, in the chain's order (V-11, V-13)", () => {
  it("a page of rows, each with the things' ids and the cells of every column", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] });
    const results = new ChainResults(file, ITEMS);
    const table = new ResultTable(file, ITEMS, results, shape);
    const rows = await table.rows(0, 10);
    expect(rows.map((r) => r.ids)).toEqual([
      ["Item:a", "Group:x"],
      ["Item:b", "Group:x"],
    ]);
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    const code = table.columns.findIndex((c) => c.key === "property:code");
    expect(rows.map((r) => r.cells[code])).toEqual(["a", "b"]);
    const groupCount = table.columns.findIndex((c) => c.place === 1 && c.key === "count:in_group in");
    expect(rows[0]!.cells[groupCount]).toBe(2);
  });

  it("all the rows, however many, with the progress as they load", async () => {
    const { file, shape } = await opened();
    const table = new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape);
    const seen: number[] = [];
    const rows = await table.all({ progress: (n) => seen.push(n) });
    expect(rows).toHaveLength(2);
    expect(seen.at(-1)).toBe(2);
  });

  it("a link column lists the things linked, by name", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Group", show: [], links: ["in_group"], counts: [] }] });
    const chain: Chain = { start: "Group", pin: null, steps: [] };
    const table = new ResultTable(file, chain, new ChainResults(file, chain), shape);
    const [row] = await table.rows(0, 1);
    const links = table.columns.findIndex((c) => c.key === "links:in_group in");
    expect(row!.cells[links]).toMatch(/Item A/);
  });

  it("a stopped load stops", async () => {
    const { file, shape } = await opened();
    const table = new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape);
    const stop = new AbortController();
    stop.abort();
    await expect(table.all({ signal: stop.signal })).rejects.toThrow();
  });
});

const row = (index: number, cells: (string | number | boolean | null)[]): TableRow => ({ index, ids: [], cells });

describe("sorted and filtered (V-11)", () => {
  const rows = [row(0, ["b", 2]), row(1, ["a", 10]), row(2, [null, 1]), row(3, ["a", 3])];

  it("by a column, up or down; numbers as numbers, text by its UTF-8 bytes, empty cells last; ties in the chain's order", () => {
    expect(sortRows(rows, { column: 0, descending: false }).map((r) => r.index)).toEqual([1, 3, 0, 2]);
    expect(sortRows(rows, { column: 0, descending: true }).map((r) => r.index)).toEqual([0, 1, 3, 2]);
    expect(sortRows(rows, { column: 1, descending: false }).map((r) => r.index)).toEqual([2, 0, 3, 1]);
    expect(sortRows([row(0, ["é"]), row(1, ["z"]), row(2, ["Z"])], { column: 0, descending: false }).map((r) => r.index)).toEqual([2, 1, 0]);
  });

  it("without a sort, the chain's order", () => {
    expect(sortRows(rows, null).map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it("a filter keeps the rows whose cell holds its text, in any case; filters on several columns all apply", () => {
    expect(filterRows(rows, [{ column: 0, text: "A" }]).map((r) => r.index)).toEqual([1, 3]);
    expect(filterRows(rows, [{ column: 0, text: "a" }, { column: 1, text: "3" }]).map((r) => r.index)).toEqual([3]);
    expect(filterRows(rows, [{ column: 1, text: "1" }]).map((r) => r.index)).toEqual([1, 2]);
    expect(filterRows(rows, [{ column: 0, text: "  " }]).map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });
});

describe("saved as a file: CSV, the filtered, sorted rows (V-11)", () => {
  it("a header of each column's place, type and name, then one line per row, RFC 4180", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] });
    const table = new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape);
    const rows = sortRows(await table.all(), { column: table.columns.findIndex((c) => c.key === "property:code"), descending: true });
    const lines = tableCsv(table.columns, rows).split("\r\n");
    // The name column by its place and type alone, so it never reads as a property called "name".
    expect(lines[0]).toBe("1 Item,1 Item: code,2 Group,2 Group: name,2 Group: ← in_group (count)");
    expect(lines[1]).toMatch(/^Item B,b,/);
    expect(lines.at(-1)).toBe("");
  });

  it("quotes what CSV must quote", () => {
    const columns = [{ place: 0, type: "T", group: "T", key: "property:x", label: "x" }];
    const text = tableCsv(columns, [row(0, ['a,"b"\nc']), row(1, [-3]), row(2, [null]), row(3, [true])]);
    expect(text.split("\r\n")).toEqual(["1 T: x", '"a,""b""\nc"', "-3", "", "true", ""]);
  });
});

describe("a chain on a mosaic with many results", () => {
  it("sorting all rows matches the rows one by one", async () => {
    const n = 60;
    const bytes = buildMosaic({
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...Array.from({ length: n }, (_, i) => ({ type: "Leaf", key: `l${String(i).padStart(2, "0")}`, label: `Leaf ${(i * 37) % n}`, props: `{"rank":${(i * 37) % n}}` }))],
      typeProps: { Leaf: '{"name":"text","rank":"real"}' },
      edgeTypes: [["has", "Hub", "Leaf"]],
      edges: Array.from({ length: n }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${String(i).padStart(2, "0")}`, evidence: [{ locator: `r=${i}` }] })),
    });
    const file = await openMosaic(bytes, "many.mosaic");
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [step("has", "out", "Leaf")] };
    const table = new ResultTable(file, chain, new ChainResults(file, chain), new Shape(parseView({}), file));
    const all = await table.all();
    expect(all).toHaveLength(n);
    const rank = table.columns.findIndex((c) => c.key === "property:rank");
    const sorted = sortRows(all, { column: rank, descending: false });
    expect(sorted.map((r) => r.cells[rank])).toEqual(Array.from({ length: n }, (_, i) => i));
  });
});

describe("the table as the page holds it: a page, a sort, filters, the rows to save", () => {
  async function chainTable(view: unknown = {}) {
    const { file, shape } = await opened(view);
    return new ChainTable(new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape));
  }

  it("a page of rows read from the chain's results, without reading them all", async () => {
    const t = await chainTable();
    await t.show(0);
    expect(t.rows?.map((r) => r.ids[0])).toEqual(["Item:a", "Item:b"]);
    expect(t.matching).toBeNull();
    expect(t.arranged).toBe(false);
  });

  it("a sort reads every row, then sorts; again the other way; a third time back to the chain's order", async () => {
    const t = await chainTable({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] });
    const code = t.table.columns.findIndex((c) => c.key === "property:code");
    await t.sortBy(code);
    expect(t.rows?.map((r) => r.ids[0])).toEqual(["Item:a", "Item:b"]);
    await t.sortBy(code);
    expect(t.rows?.map((r) => r.ids[0])).toEqual(["Item:b", "Item:a"]);
    expect(t.matching).toBe(2);
    await t.sortBy(code);
    expect(t.sort).toBeNull();
    expect(t.rows?.map((r) => r.ids[0])).toEqual(["Item:a", "Item:b"]);
  });

  it("a filter keeps the rows that match, back on the first page; the CSV holds just those, sorted", async () => {
    const t = await chainTable({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] });
    const code = t.table.columns.findIndex((c) => c.key === "property:code");
    await t.filter(code, "B");
    expect(t.rows?.map((r) => r.ids[0])).toEqual(["Item:b"]);
    expect(t.matching).toBe(1);
    const lines = (await t.csv()).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Item B,b,/);
    await t.filter(code, "");
    expect(t.matching).toBeNull();
    expect(t.rows).toHaveLength(2);
  });

  it("a filter that keeps nothing shows no rows, and says so", async () => {
    const t = await chainTable();
    await t.filter(0, "nothing like this");
    expect(t.rows).toEqual([]);
    const { body } = render(ResultTableView, { props: { table: t, count: { total: 2, exact: true, done: true, notes: [] } } });
    expect(body).toContain("No row matches the filters.");
  });
});

describe("the table, drawn", () => {
  it("a group of columns per place, sortable headers, a filter per column, the rows, and which rows of how many", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] });
    const t = new ChainTable(new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape));
    await t.show(0);
    const { body } = render(ResultTableView, { props: { table: t, count: { total: 2, exact: true, done: true, notes: [] }, hrefFor: (id: string) => `#node=${id}` } });
    expect(body).toMatch(/<th scope="colgroup" colspan="2"[^>]*>1 · Item<\/th>/);
    expect(body).toMatch(/<th scope="colgroup" colspan="\d+"[^>]*>2 · Group<\/th>/);
    expect(body).toMatch(/aria-sort="none"[^>]*><button class="sort[^"]*"[^>]*>code</);
    expect(body).toContain('aria-label="Filter 1 Item: code"');
    expect(body.match(/<tr data-row=/g)).toHaveLength(2);
    expect(body).toContain('href="#node=Item:a"');
    expect(body).toContain("Rows 1–2 of 2 results");
    expect(body).toContain("Save as CSV");
    expect(body).toMatch(/<button[^>]*disabled[^>]*>(?:<!--[^>]*-->)*\s*Next/);
  });

  it("while the count runs, at least how many", async () => {
    const { file, shape } = await opened();
    const t = new ChainTable(new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape));
    await t.show(0);
    const { body } = render(ResultTableView, { props: { table: t, count: { total: 1, exact: false, done: false, notes: [] } } });
    expect(body).toContain("Rows 1–2 of at least 2 results");
  });
});

describe("columns or table, in Trails (V-11)", () => {
  it("the results show as columns first; as a table when asked, read at once; a new chain gets a new table", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.shown;
    expect(viewer.chainShow).toBe("columns");
    await viewer.showChainAs("table");
    expect(viewer.chainTable?.rows).toHaveLength(2);
    viewer.setChain({ ...ITEMS, pin: "Item:b" });
    await viewer.chainTable?.shown;
    expect(viewer.chainTable?.rows?.map((r) => r.ids[0])).toEqual(["Item:b"]);
    viewer.setChain(null);
    expect(viewer.chainTable).toBeNull();
  });

  it("a card chosen in the page gives the table that card's columns", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.showChainAs("table");
    await viewer.chooseCard({ name: "Item", show: ["size"], links: [], counts: [] });
    await viewer.chainTable?.shown;
    expect(viewer.chainTable?.table.columns.filter((c) => c.place === 0).map((c) => c.key)).toEqual(["label", "property:size"]);
  });
});

describe("what the table reads must be right, or say why not", () => {
  it("a thing with more link groups than get lists: its counts are read, never taken as 0", async () => {
    const edges = Array.from({ length: 22 }, (_, i) => `e${String(i).padStart(2, "0")}`);
    const bytes = buildMosaic({
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, { type: "Leaf", key: "l", label: "Leaf l" }],
      edgeTypes: edges.map((e) => [e, "Hub", "Leaf"] as [string, string, string]),
      edges: edges.map((e) => ({ type: e, from: "Hub:h", to: "Leaf:l", evidence: [{ locator: `r=${e}` }] })),
    });
    const file = await openMosaic(bytes, "groups.mosaic");
    const chain: Chain = { start: "Hub", pin: "Hub:h", steps: [] };
    const table = new ResultTable(file, chain, new ChainResults(file, chain), new Shape(parseView({}), file));
    const [row] = await table.rows(0, 1);
    const counts = table.columns.flatMap((c, i) => (c.key.startsWith("count:") && c.key.endsWith(" out") ? [row!.cells[i]] : []));
    expect(counts).toHaveLength(22);
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it("a kit call that fails fails the read, naming the thing, never a blank cell", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Item", show: ["code"], links: [], counts: [] }] });
    const failing = new Proxy(file, {
      get: (target, key) => {
        if (key === "get") return async () => ({ error: { code: "internal", message: "the kit failed", suggestions: [] } });
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as typeof file;
    const table = new ResultTable(failing, ITEMS, new ChainResults(file, ITEMS), shape);
    await expect(table.rows(0, 1)).rejects.toThrow(/Item:a.*the kit failed/);
    const t = new ChainTable(table);
    await t.show(0);
    expect(t.error).toMatch(/Item:a/);
  });

  it("a table replaced stops reading every row", async () => {
    const { file, shape } = await opened();
    const t = new ChainTable(new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape));
    const sorting = t.sortBy(0);
    t.dispose();
    await sorting;
    expect(t.rows).toBeNull();
    await expect(t.arrangedRows()).rejects.toThrow();
  });

  it("the Viewer stops the old table's read when the chain changes", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain(ITEMS);
    await viewer.showChainAs("table");
    const old = viewer.chainTable!;
    viewer.setChain({ ...ITEMS, pin: "Item:a" });
    await expect(old.arrangedRows()).rejects.toThrow();
    expect(viewer.chainTable).not.toBe(old);
  });

  it("a column of numbers and text sorts the same every time: numbers, then booleans, then text", () => {
    const mixed = [row(0, [9]), row(1, ["1a"]), row(2, [10]), row(3, [true]), row(4, ["10"])];
    const once = sortRows(mixed, { column: 0, descending: false }).map((r) => r.index);
    expect(once).toEqual([0, 2, 3, 4, 1]);
    for (const order of [[4, 3, 2, 1, 0], [2, 4, 0, 1, 3]]) {
      expect(sortRows(order.map((i) => mixed[i]!), { column: 0, descending: false }).map((r) => r.index)).toEqual(once);
    }
  });

});

describe("the saved file keeps a spreadsheet from running a mosaic's text (V-11)", () => {
  // ADR-006 (a mosaic is untrusted; do not amplify it): a text value starting with = + - @, a tab or a carriage return is written after
  // a ', a number or boolean as it is, and every other cell byte for byte.
  const columns = [{ place: 0, type: "T", group: "T", key: "property:x", label: "x" }];
  const lines = (cells: (string | number | boolean | null)[]) => tableCsv(columns, cells.map((c, i) => row(i, [c]))).split("\r\n").slice(1, -1);

  it("each of the six leading characters, on a text cell", () => {
    expect(lines(["=1+1", "+33 1 23", "-3", "@SUM(A1)", "\tx", "\rx"])).toEqual(["'=1+1", "'+33 1 23", "'-3", "'@SUM(A1)", "'\tx", "\"'\rx\""]);
  });

  it("a number -3 and a text -3 in the same file", () => {
    expect(lines([-3, "-3"])).toEqual(["-3", "'-3"]);
  });

  it("a text cell with = not first, a boolean and an empty cell are as they are", () => {
    expect(lines(["a=b", "1+1", true, null, ""])).toEqual(["a=b", "1+1", "true", "", ""]);
  });

  it("a guarded cell that CSV must quote is guarded, then quoted", () => {
    expect(lines(['=HYPERLINK("http://x","y")'])).toEqual(['"\'=HYPERLINK(""http://x"",""y"")"']);
  });

  it("every other cell of a real table is byte for byte the kit's value", async () => {
    const { file, shape } = await opened({ cards: [{ name: "Item", show: ["code", "size"], links: [], counts: ["in_group"] }] });
    const table = new ResultTable(file, ITEMS, new ChainResults(file, ITEMS), shape);
    const rows = await table.all();
    const text = tableCsv(table.columns, rows);
    const parsed = text.split("\r\n").slice(1, -1).map((line) => line.split(","));
    expect(parsed).toEqual(rows.map((r) => r.cells.map((c) => (c === null ? "" : String(c)))));
  });
});

describe("resulttable: further cases", () => {
  const step = (edge: string, direction: "out" | "in", type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
  const row = (index: number, cells: Cell[]): TableRow => ({ index, ids: [], cells });
  const col = (key: string, label = key, place = 0, type = "T"): Column => ({ place, type, group: type, key, label });
  const idx = (rows: readonly TableRow[]) => rows.map((r) => r.index);

  async function open(spec: Parameters<typeof buildMosaic>[0], chain: Chain, view: unknown = {}) {
    const file = await openMosaic(buildMosaic(spec), "edges.mosaic");
    const shape = new Shape(parseView(view), file);
    const table = new ResultTable(file, chain, new ChainResults(file, chain), shape);
    return { file, shape, table };
  }

  /** A hub linked to n leaves; leaf i has rank (i*37)%n and a name. */
  function hubSpec(n: number, extra: (i: number) => Partial<NodeSpec> = () => ({})) {
    const nodes: NodeSpec[] = [
      { type: "Hub", key: "h", label: "Hub h" },
      ...Array.from({ length: n }, (_, i): NodeSpec => ({ type: "Leaf", key: `l${String(i).padStart(4, "0")}`, label: `Leaf ${i}`, props: `{"rank":${(i * 37) % n}}`, ...extra(i) })),
    ];
    const edges: EdgeSpec[] = Array.from({ length: n }, (_, i) => ({ type: "has", from: "Hub:h", to: `Leaf:l${String(i).padStart(4, "0")}`, evidence: [{ locator: `r=${i}` }] }));
    return { nodes, typeProps: { Leaf: '{"name":"text","rank":"real"}' }, edgeTypes: [["has", "Hub", "Leaf"]] as [string, string, string][], edges };
  }
  const HUB_CHAIN: Chain = { start: "Hub", pin: "Hub:h", steps: [step("has", "out", "Leaf")] };

  describe("sortRows (V-11)", () => {
    it("does not change the rows it is given, and gives the same order twice", () => {
      const rows = [row(0, ["b"]), row(1, ["a"]), row(2, ["c"])];
      const before = JSON.stringify(rows);
      const first = sortRows(rows, { column: 0, descending: false });
      expect(JSON.stringify(rows)).toBe(before);
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual(idx(first));
    });

    it("text by UTF-8 bytes: U+FFFD sorts before U+1F600 although its UTF-16 unit is greater", () => {
      // UTF-8: U+FFFD = EF BF BD, U+1F600 = F0 9F 98 80. UTF-16 code units: FFFD > D83D.
      const rows = [row(0, ["\u{1F600}"]), row(1, ["�"])];
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual([1, 0]);
      expect(idx(sortRows(rows, { column: 0, descending: true }))).toEqual([0, 1]);
    });

    it("text by bytes: a prefix comes before its longer text, upper case before lower case, digits before letters", () => {
      const rows = [row(0, ["ab"]), row(1, ["a"]), row(2, ["B"]), row(3, ["1"]), row(4, [""])];
      // "" is an empty cell and goes last or first with the other empty cells; the others are by bytes.
      const order = idx(sortRows(rows.filter((r) => r.cells[0] !== ""), { column: 0, descending: false }));
      expect(order).toEqual([3, 2, 1, 0]);
    });

    it("numbers as numbers: 9 before 10, negatives before zero, decimals between", () => {
      const rows = [row(0, [10]), row(1, [9]), row(2, [-2]), row(3, [0]), row(4, [9.5]), row(5, [-0.5])];
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual([2, 5, 3, 1, 4, 0]);
      expect(idx(sortRows(rows, { column: 0, descending: true }))).toEqual([0, 4, 1, 3, 5, 2]);
    });

    it("empty cells last in both directions, in the chain's order among themselves", () => {
      const rows = [row(0, [null]), row(1, ["a"]), row(2, [null]), row(3, ["b"])];
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual([1, 3, 0, 2]);
      expect(idx(sortRows(rows, { column: 0, descending: true }))).toEqual([3, 1, 0, 2]);
    });

    it("all cells equal: the chain's order, up or down", () => {
      const rows = [row(0, ["x"]), row(1, ["x"]), row(2, ["x"])];
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual([0, 1, 2]);
      expect(idx(sortRows(rows, { column: 0, descending: true }))).toEqual([0, 1, 2]);
    });

    it("ties follow the chain's order even when the rows arrive shuffled", () => {
      const rows = [row(3, ["x"]), row(0, ["x"]), row(2, ["x"]), row(1, ["x"])];
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual([0, 1, 2, 3]);
    });

    it("no rows, one row", () => {
      expect(sortRows([], { column: 0, descending: false })).toEqual([]);
      expect(idx(sortRows([row(0, ["a"])], { column: 0, descending: true }))).toEqual([0]);
    });

    it("a column of one kind of cell with a boolean sorts without failing, and the same way twice", () => {
      const rows = [row(0, [true]), row(1, [false]), row(2, [true]), row(3, [false])];
      const a = idx(sortRows(rows, { column: 0, descending: false }));
      expect(a).toHaveLength(4);
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual(a);
      expect(new Set(a)).toEqual(new Set([0, 1, 2, 3]));
    });

    it("a column of numbers and text together sorts without failing, all rows kept, the same way twice", () => {
      const rows = [row(0, ["9"]), row(1, [10]), row(2, ["a"]), row(3, [2]), row(4, [null])];
      const a = idx(sortRows(rows, { column: 0, descending: false }));
      expect([...a].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(a.at(-1)).toBe(4);
      expect(idx(sortRows(rows, { column: 0, descending: false }))).toEqual(a);
    });
  });

  describe("filterRows (V-11)", () => {
    const rows = [row(0, ["Abc", 1]), row(1, ["abd", 22]), row(2, [null, 3]), row(3, ["É", 4])];

    it("no filters keeps every row; the input is not changed", () => {
      const before = JSON.stringify(rows);
      expect(idx(filterRows(rows, []))).toEqual([0, 1, 2, 3]);
      filterRows(rows, [{ column: 0, text: "a" }]);
      expect(JSON.stringify(rows)).toBe(before);
    });

    it("the text is literal: '.' and '*' are not patterns, and '(' does not fail", () => {
      const r = [row(0, ["abc"]), row(1, ["a.c"]), row(2, ["a*"]), row(3, ["(x"])];
      expect(idx(filterRows(r, [{ column: 0, text: "a.c" }]))).toEqual([1]);
      expect(idx(filterRows(r, [{ column: 0, text: "a*" }]))).toEqual([2]);
      expect(idx(filterRows(r, [{ column: 0, text: "(" }]))).toEqual([3]);
      expect(idx(filterRows(r, [{ column: 0, text: "\\" }]))).toEqual([]);
    });

    it("an empty cell never matches a filter that has text", () => {
      expect(idx(filterRows(rows, [{ column: 0, text: "n" }]))).toEqual([]);
      expect(idx(filterRows(rows, [{ column: 0, text: "null" }]))).toEqual([]);
    });

    it("a number cell is matched by its written form", () => {
      expect(idx(filterRows(rows, [{ column: 1, text: "2" }]))).toEqual([1]);
    });

    it("any case, also beyond ASCII", () => {
      expect(idx(filterRows(rows, [{ column: 0, text: "é" }]))).toEqual([3]);
      expect(idx(filterRows(rows, [{ column: 0, text: "ABD" }]))).toEqual([1]);
    });

    it("two filters on one column both apply", () => {
      expect(idx(filterRows(rows, [{ column: 0, text: "ab" }, { column: 0, text: "d" }]))).toEqual([1]);
    });

    it("the rows keep their order and their chain positions", () => {
      const shuffled = [row(5, ["a"]), row(2, ["a"]), row(9, ["b"])];
      expect(idx(filterRows(shuffled, [{ column: 0, text: "a" }]))).toEqual([5, 2]);
    });

    it("the whole text must be there, not part of it: a longer text finds nothing in a shorter cell", () => {
      expect(idx(filterRows([row(0, ["ab"])], [{ column: 0, text: "abc" }]))).toEqual([]);
    });
  });

  describe("saved as CSV (V-11): RFC 4180, UTF-8, the rows given", () => {
    const one = [col("property:x", "x")];

    it("no rows: the header alone, ended by a line break", () => {
      expect(tableCsv(one, [])).toBe("1 T: x\r\n");
    });

    it("the same input twice gives the same bytes", () => {
      const rows = [row(0, ["a,b"]), row(1, [2.5])];
      expect(tableCsv(one, rows)).toBe(tableCsv(one, rows));
    });

    it("rows are written in the order given, not sorted again", () => {
      expect(tableCsv(one, [row(5, ["z"]), row(1, ["a"])]).split("\r\n")).toEqual(["1 T: x", "z", "a", ""]);
    });

    it("a lone carriage return, a line feed and a double quote are quoted; a plain space is not", () => {
      const lines = tableCsv(one, [row(0, ["a\rb"]), row(1, ["a\nb"]), row(2, ['say "hi"']), row(3, ["a b"])]);
      expect(lines).toBe('1 T: x\r\n"a\rb"\r\n"a\nb"\r\n"say ""hi"""\r\na b\r\n');
    });

    it("a header with a comma or a quote is quoted like any cell", () => {
      const columns = [col("property:x", 'a,"b"', 0, "T")];
      expect(tableCsv(columns, []).split("\r\n")[0]).toBe('"1 T: a,""b"""');
    });

    it("text that a spreadsheet would read as a formula starts with an apostrophe: = + - @ and tab", () => {
      const text = tableCsv(one, [row(0, ["=A1"]), row(1, ["+1"]), row(2, ["-1"]), row(3, ["@SUM(A1)"]), row(4, ["\tx"])]);
      const lines = text.split("\r\n");
      expect(lines.slice(1, 6)).toEqual(["'=A1", "'+1", "'-1", "'@SUM(A1)", "'\tx"]);
    });

    it("a formula with a comma is guarded and quoted", () => {
      expect(tableCsv(one, [row(0, ["=1,2"])]).split("\r\n")[1]).toBe('"\'=1,2"');
    });

    it("numbers are written as numbers, never guarded: 0, -0.5, 1.5, 1e21; false; an empty string and null are empty", () => {
      const lines = tableCsv(one, [row(0, [0]), row(1, [-0.5]), row(2, [1.5]), row(3, [1e21]), row(4, [false]), row(5, [""]), row(6, [null])]).split("\r\n");
      expect(lines.slice(1, 5)).toEqual(["0", "-0.5", "1.5", String(1e21)]);
      expect(lines.slice(5, 8)).toEqual(["false", "", ""]);
    });

    it("text beyond ASCII, a NUL and a very long text are kept whole", () => {
      const long = "é".repeat(50_000);
      const lines = tableCsv(one, [row(0, ["日本語 \u{1F600}"]), row(1, ["a\u0000b"]), row(2, [long])]).split("\r\n");
      expect(lines[1]).toBe("日本語 \u{1F600}");
      expect(lines[2]).toBe("a\u0000b");
      expect(lines[3]).toBe(long);
    });

    it("several columns: one cell per column, in the columns' order", () => {
      const columns = [col("label", "name", 0, "A"), col("property:x", "x", 0, "A"), col("label", "name", 1, "B")];
      expect(tableCsv(columns, [row(0, ["n", 1, "m,m"])])).toBe('1 A,1 A: x,2 B\r\nn,1,"m,m"\r\n');
    });

    it("the file has the same cells as the filtered, sorted rows, in the same order", () => {
      const rows = [row(0, ["b", 2]), row(1, ["a", 10]), row(2, ["a", 3]), row(3, ["c", 1])];
      const columns = [col("property:s"), col("property:n")];
      const kept = sortRows(filterRows(rows, [{ column: 0, text: "a" }]), { column: 1, descending: true });
      expect(tableCsv(columns, kept).split("\r\n")).toEqual(["1 T: property:s,1 T: property:n", "a,10", "a,3", ""]);
    });
  });

  describe("one group of columns per step (V-11)", () => {
    const spec = {
      nodes: [
        { type: "A", key: "1", label: "A 1", props: '{"v":1}' },
        { type: "B", key: "1", label: "B 1" },
        { type: "A", key: "2", label: "A 2", props: '{"v":2}' },
      ] as NodeSpec[],
      typeProps: { A: '{"name":"text","v":"real"}', B: '{"name":"text"}' },
      edgeTypes: [["ab", "A", "B"], ["ba", "B", "A"]] as [string, string, string][],
      edges: [
        { type: "ab", from: "A:1", to: "B:1" },
        { type: "ba", from: "B:1", to: "A:2" },
      ] as EdgeSpec[],
    };

    it("a chain with no step has one group", async () => {
      const chain: Chain = { start: "A", pin: null, steps: [] };
      const { table } = await open(spec, chain);
      expect(new Set(table.columns.map((c) => c.place))).toEqual(new Set([0]));
      const rows = await table.all();
      expect(rows.map((r) => r.ids)).toEqual([["A:1"], ["A:2"]]);
    });

    it("a type met twice has two groups, told apart by place, with the same columns", async () => {
      const chain: Chain = { start: "A", pin: "A:1", steps: [step("ab", "out", "B"), step("ba", "out", "A")] };
      const { table } = await open(spec, chain);
      expect([...new Set(table.columns.map((c) => c.place))]).toEqual([0, 1, 2]);
      const keys = (p: number) => table.columns.filter((c) => c.place === p).map((c) => c.key);
      expect(keys(2)).toEqual(keys(0));
      const [r] = await table.rows(0, 5);
      expect(r!.ids).toEqual(["A:1", "B:1", "A:2"]);
      expect(r!.cells).toHaveLength(table.columns.length);
      const csv = tableCsv(table.columns, [r!]).split("\r\n")[0]!;
      expect(csv.startsWith("1 A,")).toBe(true);
      expect(csv).toContain("3 A");
    });

    it("a step backwards (in) puts the thing at its own place", async () => {
      const chain: Chain = { start: "B", pin: "B:1", steps: [step("ab", "in", "A")] };
      const { table } = await open(spec, chain);
      const [r] = await table.rows(0, 5);
      expect(r!.ids).toEqual(["B:1", "A:1"]);
      expect(table.columns.filter((c) => c.place === 1).every((c) => c.type === "A")).toBe(true);
    });

    it("a chain with no result: no rows, the header alone, a page that says there are none", async () => {
      const chain: Chain = { start: "A", pin: "A:2", steps: [step("ab", "out", "B")] };
      const { file, shape, table } = await open(spec, chain);
      expect(await table.all()).toEqual([]);
      expect(await table.rows(0, 20)).toEqual([]);
      const t = new ChainTable(table);
      await t.show(0);
      expect(t.rows).toEqual([]);
      expect(tableCsv(table.columns, await table.all()).split("\r\n")).toHaveLength(2);
      expect((await t.csv()).split("\r\n")).toHaveLength(2);
      const { body } = render(ResultTableView, { props: { table: t, count: { total: 0, exact: true, done: true, notes: [] } } });
      expect(body).toContain("0");
      expect(file).toBeTruthy();
      expect(shape).toBeTruthy();
    });

    it("a card naming a property the mosaic does not have does not stop the table", async () => {
      const chain: Chain = { start: "A", pin: null, steps: [] };
      const { table } = await open(spec, chain, { cards: [{ name: "A", show: ["nothing_like_this", "v"], links: ["no_such_edge"], counts: ["no_such_edge"] }] });
      const rows = await table.all();
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.cells).toHaveLength(table.columns.length);
      const v = table.columns.findIndex((c) => c.key === "property:v");
      expect(rows.map((r) => r.cells[v])).toEqual([1, 2]);
    });

    it("a thing with no value for a property has an empty cell, not the word undefined", async () => {
      const chain: Chain = { start: "A", pin: "A:1", steps: [step("ab", "out", "B")] };
      const { table } = await open({ ...spec, typeProps: { ...spec.typeProps, B: '{"name":"text","w":"text"}' } }, chain, { cards: [{ name: "B", show: ["w"], links: [], counts: [] }] });
      const w = table.columns.findIndex((c) => c.key === "property:w");
      const [r] = await table.rows(0, 1);
      expect(r!.cells[w]).toBeNull();
      expect(tableCsv(table.columns, [r!])).not.toMatch(/undefined|null/);
    });
  });

  describe("the rows of a long result (V-11, V-13)", () => {
    it("pages cut from the chain's order join into all the rows, in one order every time", async () => {
      const { table } = await open(hubSpec(45), HUB_CHAIN);
      const all = await table.all();
      expect(all).toHaveLength(45);
      expect(idx(all)).toEqual(Array.from({ length: 45 }, (_, i) => i));
      const pages = [...(await table.rows(0, 20)), ...(await table.rows(20, 20)), ...(await table.rows(40, 20))];
      expect(pages.map((r) => r.ids)).toEqual(all.map((r) => r.ids));
      const again = await open(hubSpec(45), HUB_CHAIN);
      expect((await again.table.all()).map((r) => r.ids)).toEqual(all.map((r) => r.ids));
      expect(tableCsv(again.table.columns, await again.table.all())).toBe(tableCsv(table.columns, all));
    });

    it("a page past the end, an empty page and a page across the end", async () => {
      const { table } = await open(hubSpec(5), HUB_CHAIN);
      expect(await table.rows(5, 10)).toEqual([]);
      expect(await table.rows(500, 10)).toEqual([]);
      expect(await table.rows(0, 0)).toEqual([]);
      expect(idx(await table.rows(3, 10))).toEqual([3, 4]);
    });

    it("more rows than one read holds: every row once, in order, the progress rising to the total", async () => {
      const n = 2300;
      const { table } = await open(hubSpec(n), HUB_CHAIN);
      const seen: number[] = [];
      const all = await table.all({ progress: (k) => seen.push(k) });
      expect(all).toHaveLength(n);
      expect(idx(all)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(seen.at(-1)).toBe(n);
      expect(seen).toEqual([...seen].sort((a, b) => a - b));
    }, 60_000);

    it("a long text in a card's property is the kit's cut text (400 characters and the marker) in the table and in the file", async () => {
      // Section 8.2 / answers.schema.json: text from the file is cut (summaries and property text at
      // 400 characters, then the marker "…"); the viewer reads only through the kit.
      const long = "x".repeat(20_000);
      const { table } = await open(hubSpec(2, (i) => (i === 0 ? { props: JSON.stringify({ rank: 0, name: long }) } : {})), HUB_CHAIN, { cards: [{ name: "Leaf", show: ["name"], links: [], counts: [] }] });
      const name = table.columns.findIndex((c) => c.place === 1 && c.key === "property:name");
      const rows = await table.all();
      const cell = rows[0]!.cells[name] as string;
      expect(cell).toBe("x".repeat(400) + "…");
      expect(Array.from(cell)).toHaveLength(401);
      const csv = tableCsv(table.columns, rows);
      expect(csv).toContain(cell);
      expect(csv).not.toContain("x".repeat(401));
    });

    it("a name with commas, quotes and line breaks comes out of the file as one cell (parsed back)", async () => {
      const odd = 'Ann, "the" one\nsecond line';
      const { table } = await open(hubSpec(2, (i) => (i === 0 ? { label: odd } : {})), HUB_CHAIN);
      const csv = tableCsv(table.columns, await table.all());
      expect(csv).toContain('"Ann, ""the"" one\nsecond line"');
      expect(parseCsv(csv)).toHaveLength(3);
      const leaf = table.columns.findIndex((c) => c.place === 1 && c.key === "label");
      expect(parseCsv(csv)[1]![leaf]).toBe(odd);
    });

    it("a link column names at most the few it shows and says that there are more", async () => {
      const n = NAMED + 4;
      const { table } = await open(hubSpec(n), { start: "Hub", pin: "Hub:h", steps: [] }, { cards: [{ name: "Hub", show: [], links: ["has"], counts: ["has"] }] });
      const [r] = await table.rows(0, 1);
      const links = table.columns.findIndex((c) => c.key === "links:has out");
      const count = table.columns.findIndex((c) => c.key === "count:has out");
      expect(r!.cells[count]).toBe(n);
      const cell = String(r!.cells[links]);
      expect(cell).toContain("Leaf 0");
      expect(cell).not.toContain(`Leaf ${n - 1}`);
      expect(cell).toMatch(new RegExp(`\\b4\\b`));
    });
  });

  /** RFC 4180 parser for the tests: rows of cells. */
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let cell = "";
    let line: string[] = [];
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { line.push(cell); cell = ""; } else if (c === "\r" && text[i + 1] === "\n") { line.push(cell); rows.push(line); line = []; cell = ""; i++; } else cell += c;
    }
    if (cell !== "" || line.length > 0) { line.push(cell); rows.push(line); }
    return rows;
  }

  describe("the table as the page holds it: pages, sort and filters together (V-11, V-13)", () => {
    async function table(n = 45, view: unknown = {}) {
      const { table } = await open(hubSpec(n), HUB_CHAIN, view);
      return new ChainTable(table);
    }
    const RANK = { cards: [{ name: "Leaf", show: ["rank"], links: [], counts: [] }] };

    it("an unsorted, unfiltered table pages through the chain's order, a page of TABLE_ROWS", async () => {
      const t = await table(45);
      await t.show(0);
      expect(t.rows).toHaveLength(TABLE_ROWS);
      expect(idx(t.rows!)).toEqual(Array.from({ length: TABLE_ROWS }, (_, i) => i));
      await t.show(2);
      expect(idx(t.rows!)).toEqual(Array.from({ length: 45 - 2 * TABLE_ROWS }, (_, i) => 2 * TABLE_ROWS + i));
    });

    it("a sort pages through the sorted rows: numbers as numbers across pages", async () => {
      const t = await table(45, RANK);
      const rank = t.table.columns.findIndex((c) => c.place === 1 && c.key === "property:rank");
      await t.sortBy(rank);
      await t.show(0);
      const first = t.rows!.map((r) => r.cells[rank]);
      await t.show(1);
      const second = t.rows!.map((r) => r.cells[rank]);
      await t.show(2);
      const third = t.rows!.map((r) => r.cells[rank]);
      expect([...first, ...second, ...third]).toEqual(Array.from({ length: 45 }, (_, i) => i));
    });

    it("sort and filter together: the file holds the filtered rows in the sorted order", async () => {
      const t = await table(45, RANK);
      const rank = t.table.columns.findIndex((c) => c.place === 1 && c.key === "property:rank");
      const name = t.table.columns.findIndex((c) => c.place === 1 && c.key === "label");
      await t.filter(name, "Leaf 1");
      await t.sortBy(rank);
      await t.sortBy(rank); // down
      const lines = (await t.csv()).split("\r\n");
      // Leaf 1, 10..19 -> 11 rows, plus the header and the final line break.
      expect(lines).toHaveLength(11 + 2);
      expect(t.matching).toBe(11);
      const ranks = lines.slice(1, -1).map((l) => Number(l.split(",")[rank]));
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
      const names = lines.slice(1, -1).map((l) => l.split(",")[name]!);
      expect(names.every((x) => x.startsWith("Leaf 1"))).toBe(true);
    });

    it("a filter on two columns keeps the rows that match both", async () => {
      const t = await table(45, RANK);
      const rank = t.table.columns.findIndex((c) => c.place === 1 && c.key === "property:rank");
      const name = t.table.columns.findIndex((c) => c.place === 1 && c.key === "label");
      await t.filter(name, "Leaf 4");
      const withName = t.matching;
      expect(withName).toBe(6); // Leaf 4, 40..44
      await t.filter(rank, "1");
      expect(t.matching).toBeLessThan(withName!);
      for (const r of t.rows!) {
        expect(String(r.cells[name]).toLowerCase()).toContain("leaf 4");
        expect(String(r.cells[rank])).toContain("1");
      }
    });

    it("a filter goes back to the first page; the rows of the last page and the count agree", async () => {
      const t = await table(45);
      await t.show(2);
      expect(t.page).toBe(2);
      await t.filter(t.table.columns.findIndex((c) => c.place === 1 && c.key === "label"), "Leaf 3");
      expect(t.page).toBe(0);
      expect(t.matching).toBe(11);
      expect(t.rows).toHaveLength(11);
    });

    it("the file of an unfiltered, unsorted table holds every result, not just the page shown", async () => {
      const t = await table(45);
      await t.show(0);
      const lines = (await t.csv()).split("\r\n");
      expect(lines).toHaveLength(45 + 2);
    });

    it("the file of a filter that keeps nothing is the header alone", async () => {
      const t = await table(10);
      await t.filter(0, "zzz not there");
      expect(t.matching).toBe(0);
      expect(t.rows).toEqual([]);
      expect((await t.csv()).split("\r\n")).toHaveLength(2);
    });

    it("changes made one after the other without waiting end as the last one says", async () => {
      const t = await table(45);
      const name = t.table.columns.findIndex((c) => c.place === 1 && c.key === "label");
      void t.filter(name, "Leaf 1");
      void t.filter(name, "Leaf 2");
      await t.filter(name, "");
      await t.shown;
      expect(t.matching).toBeNull();
      expect(t.rows).toHaveLength(TABLE_ROWS);
      expect(idx(t.rows!)[0]).toBe(0);
    });

    it("a filter of spaces alone keeps every row and sets nothing", async () => {
      const t = await table(10);
      await t.filter(0, "   ");
      expect(t.arranged).toBe(false);
      expect(t.rows).toHaveLength(10);
    });

    it("the same sort twice on two tables of one mosaic gives the same file", async () => {
      const a = await table(45, RANK);
      const b = await table(45, RANK);
      const rank = a.table.columns.findIndex((c) => c.place === 1 && c.key === "property:rank");
      await a.sortBy(rank);
      await b.sortBy(rank);
      expect(await a.csv()).toBe(await b.csv());
    });

    it("a count column sorts as numbers: 9 before 10", async () => {
      const nodes: NodeSpec[] = Array.from({ length: 12 }, (_, i) => ({ type: "Hub", key: `h${String(i).padStart(2, "0")}`, label: `Hub ${i}` }));
      const leaves: NodeSpec[] = Array.from({ length: 12 }, (_, i) => ({ type: "Leaf", key: `l${i}`, label: `Leaf ${i}` }));
      // Hub i holds i leaves, so its count is i.
      const edges: EdgeSpec[] = [];
      for (let i = 0; i < 12; i++) for (let j = 0; j < i; j++) edges.push({ type: "has", from: `Hub:h${String(i).padStart(2, "0")}`, to: `Leaf:l${j}` });
      const { table: base } = await open({ nodes: [...nodes, ...leaves], typeProps: { Leaf: '{"name":"text"}', Hub: '{"name":"text"}' }, edgeTypes: [["has", "Hub", "Leaf"]], edges }, { start: "Hub", pin: null, steps: [] }, { cards: [{ name: "Hub", show: [], links: [], counts: ["has"] }] });
      const t = new ChainTable(base);
      const count = base.columns.findIndex((c) => c.key === "count:has out");
      await t.sortBy(count);
      await t.show(0);
      expect(t.rows!.map((r) => r.cells[count])).toEqual(Array.from({ length: 12 }, (_, i) => i));
    });
  });

  describe("the table drawn, with many results (V-13)", () => {
    it("a name or a value with markup is shown as text, never as markup", async () => {
      const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
      const { table } = await open(hubSpec(2, (i) => (i === 0 ? { label: evil } : {})), HUB_CHAIN);
      const t = new ChainTable(table);
      await t.show(0);
      const { body } = render(ResultTableView, { props: { table: t, count: { total: 2, exact: true, done: true, notes: [] } } });
      expect(body).not.toContain("<script>alert(2)");
      expect(body).not.toContain("<img src=x");
    });

    it("a type name with markup is shown as text in the group header", async () => {
      const odd = "<b>Type</b>";
      const { table } = await open({ nodes: [{ type: "Q", key: "q", label: "Q q" }], typeProps: { Q: '{"name":"text"}' } }, { start: "Q", pin: null, steps: [] }, { types: [{ name: "Q", label: odd }] });
      const t = new ChainTable(table);
      await t.show(0);
      const { body } = render(ResultTableView, { props: { table: t, count: { total: 1, exact: true, done: true, notes: [] } } });
      expect(body).not.toContain("<b>Type</b>");
    });
  });

  describe("the conformance mosaic read twice (V-13)", () => {
    it("two tables of one chain give the same rows and the same file", async () => {
      const chain: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
      const build = async () => {
        const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
        const t = new ResultTable(file, chain, new ChainResults(file, chain), new Shape(parseView({}), file));
        return tableCsv(t.columns, await t.all());
      };
      expect(await build()).toBe(await build());
    });

    it("tableColumns gives the same columns as the table built on the same chain", async () => {
      const chain: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
      const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
      const shape = new Shape(parseView({}), file);
      const t = new ResultTable(file, chain, new ChainResults(file, chain), shape);
      expect(tableColumns(chain, file, shape)).toEqual(t.columns);
    });
  });
});
