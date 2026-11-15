// One table per node type the mosaic declares, its columns those `table` gives, filled by
// `table`; sorting, filtering by the `where` operators and paging go through `table`; a row
// opens its node page (docs/design.md, First milestone: Viewer; sections 8.1 and 8.6).
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";
import TableViewComponent from "../src/components/TableView.svelte";
import TypeList from "../src/components/TypeList.svelte";
import { openMosaic, nodePage } from "../src/lib/mosaic.js";
import { OPERATORS, parseRoute, routeHash, type TableRoute } from "../src/lib/route.js";
import { cellText, filterValue, tableArgs, tableView, type TableView, PAGE_ROWS } from "../src/lib/tables.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";
import { TEXT_LIMITS, cut } from "@mosaic/kit";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";

const ITEM: TableRoute = { type: "Item", page: 1, order: null, where: [] };
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const nodeHref = (id: string) => routeHash({ query: "", node: id });

function attributes(html: string, attribute: string): string[] {
  return [...html.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g"))].map((m) => m[1]!.replaceAll("&amp;", "&"));
}

describe("table routes", () => {
  it("a table view's type, page, order and filters survive the address", () => {
    const routes: TableRoute[] = [
      ITEM,
      { type: "Item", page: 3, order: { column: "size", desc: true }, where: [] },
      {
        type: "Item",
        page: 2,
        order: { column: "label", desc: false },
        where: [
          { column: "code", op: "contains", value: "a&b=#" },
          { column: "size", op: ">=", value: 1 },
          { column: "flag", op: "!=", value: false },
        ],
      },
    ];
    for (const table of routes) {
      expect(parseRoute(routeHash({ query: "q", node: null, table })).table).toEqual(table);
    }
    expect(parseRoute("#q=x").table ?? null).toBeNull();
    expect(parseRoute("#t=").table ?? null).toBeNull();
  });

  it("a malformed page or filter in the address is ignored, never an error", () => {
    expect(parseRoute("#t=Item&p=0").table?.page).toBe(1);
    expect(parseRoute("#t=Item&p=-2").table?.page).toBe(1);
    expect(parseRoute("#t=Item&p=1e3").table?.page).toBe(1);
    expect(parseRoute("#t=Item&w=%7Bnot").table?.where).toEqual([]);
    expect(parseRoute(`#t=Item&w=${encodeURIComponent('[{"column":"a","op":"LIKE","value":"x"},{"column":"a","op":"=","value":1}]')}`).table?.where).toEqual([
      { column: "a", op: "=", value: 1 },
    ]);
  });
});

describe("tables through table", () => {
  it("the open file lists one table per declared node type, each opening its table", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const { body } = render(TypeList, { props: { types: file.nodeTypes, hrefFor: (t: string) => tableHref({ ...ITEM, type: t }) } });
    expect(attributes(body, "data-type")).toEqual(["Group", "Item"]);
    expect(attributes(body, "href").map((h) => parseRoute(h).table?.type)).toEqual(["Group", "Item"]);
    expect(body).toContain(">2<");
    file.close();
  });

  it("a table view is one table call with its page, order and filters, and shows what it returns", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const call = vi.spyOn(file, "table");
    const route: TableRoute = { type: "Item", page: 1, order: { column: "size", desc: true }, where: [{ column: "code", op: "contains", value: "A" }] };
    const view = (await tableView(file, route)) as TableView;
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith({
      type: "Item",
      page: 1,
      order: { column: "size", direction: "desc" },
      where: [{ column: "code", op: "contains", value: "A" }],
    });
    const answer = await file.table(tableArgs(route));
    if (!("data" in answer)) throw new Error("table failed");
    expect(view.columns).toEqual(answer.data.columns);
    expect(view.rows).toEqual(answer.data.rows);
    expect(view.total).toBe(answer.data.total);
    expect(view.pages).toBe(1);
    file.close();
  });

  it("without order or filters the call names the type and page only; the columns are table's defaults", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    expect(tableArgs(ITEM)).toEqual({ type: "Item", page: 1 });
    const view = (await tableView(file, ITEM)) as TableView;
    expect(view.columns).toEqual(["id", "label", "code", "size"]);
    expect(view.rows.map((r) => r[0])).toEqual(["Item:a", "Item:b"]);
    file.close();
  });

  it("a table call's error is shown, never an empty table", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const view = await tableView(file, { ...ITEM, order: { column: "colour", desc: false } });
    expect("message" in view && view.message).toMatch(/colour/);
    const unknown = await tableView(file, { ...ITEM, type: "Itme" });
    expect("message" in unknown && unknown.message).toMatch(/Item/);
    file.close();
  });

  it("the Viewer keeps the latest table page", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    const first = viewer.showTable(ITEM);
    const second = viewer.showTable({ ...ITEM, type: "Group" });
    await Promise.all([second, first]);
    expect(viewer.table && "route" in viewer.table && viewer.table.route.type).toBe("Group");
    await viewer.showTable(null);
    expect(viewer.table).toBeNull();
  });
});

describe("TableView", () => {
  async function rendered(route: TableRoute) {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const view = (await tableView(file, route)) as TableView;
    file.close();
    const { body } = render(TableViewComponent, { props: { view, route, hrefFor: tableHref, nodeHref, onfilter: () => {} } });
    return { view, body };
  }

  it("shows one header per column and one row per node, each row's id opening its node page", async () => {
    const { view, body } = await rendered(ITEM);
    for (const column of view.columns.slice(2)) expect(body).toContain(`>${column}`);
    const ids = attributes(body, "data-id");
    expect(ids).toEqual(["Item:a", "Item:b"]);
    const nodes = attributes(body, "href").map(parseRoute).filter((r) => r.node !== null).map((r) => r.node);
    expect(nodes).toEqual(["Item:a", "Item:b"]);
    expect(body).toContain("Item A");
    expect(body).toContain(">a<");
  });

  it("each column header is a button that sorts, and the sorted column says its direction", async () => {
    const { body } = await rendered(ITEM);
    expect(attributes(body, "data-column")).toEqual(["label", "code", "size"]);
    const asc = await rendered({ ...ITEM, order: { column: "size", desc: false } });
    expect(asc.body).toMatch(/aria-sort="ascending"[^>]*>(?:<!--[^>]*-->)*<button[^>]*data-column="size"/);
    const desc = await rendered({ ...ITEM, order: { column: "size", desc: true } });
    expect(desc.body).toMatch(/aria-sort="descending"[^>]*>(?:<!--[^>]*-->)*<button[^>]*data-column="size"/);
  });

  it("each filter can be removed", async () => {
    const route: TableRoute = { ...ITEM, where: [{ column: "code", op: "contains", value: "a" }] };
    const { body } = await rendered(route);
    expect(body).toMatch(/<button[^>]*aria-label="Remove filter code contains &quot;a&quot;"/);
  });

  it("pages through table, 20 rows a page, with the total", () => {
    const view: TableView = {
      route: { ...ITEM, page: 2 },
      columns: ["id", "label"],
      rows: Array.from({ length: 20 }, (_, i) => [`Item:${i}`, `Item ${i}`]),
      page: 2,
      total: 45,
      pages: 3,
    };
    const { body } = render(TableViewComponent, { props: { view, route: view.route, hrefFor: tableHref, nodeHref, onfilter: () => {} } });
    expect(attributes(body, "data-page")).toEqual(["2"]);
    expect(attributes(body, "data-pages")).toEqual(["3"]);
    expect(attributes(body, "data-total")).toEqual(["45"]);
    const pages = attributes(body, "href").map(parseRoute).filter((r) => r.table && r.node === null && r.table.where.length === 0 && r.table.order === null && r.table.page !== 1).map((r) => r.table!.page);
    expect(pages).toContain(3);
    expect(body).toContain('rel="prev"');
    expect(body).toContain('rel="next"');
  });
});

describe("filter values and cells", () => {
  it("a filter's text is read as the kind the reader picks", () => {
    expect(filterValue("2020", "text")).toBe("2020");
    expect(filterValue("2020", "number")).toBe(2020);
    expect(filterValue(" -1.5 ", "number")).toBe(-1.5);
    expect(filterValue("x", "number")).toBeNull();
    expect(filterValue("", "number")).toBeNull();
    expect(filterValue("true", "boolean")).toBe(true);
    expect(filterValue("false", "boolean")).toBe(false);
    expect(filterValue("yes", "boolean")).toBeNull();
  });

  it("cells show text, lists of labels, numbers and JSON; no value is empty", () => {
    expect(cellText("PG")).toBe("PG");
    expect(cellText(["Ann", null, "Bo"])).toBe("Ann, , Bo");
    expect(cellText(3)).toBe("3");
    expect(cellText(false)).toBe("false");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText([1, 2])).toBe("[1,2]");
    expect(cellText(null)).toBe("");
  });
});

describe("App", () => {
  it("Tables lists the types and shows the table a route asks for", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.showTable(ITEM);
    viewer.place = "tables";
    const { body } = render(App, { props: { viewer } });
    expect(body).toContain(">Tables<");
    expect(body).toContain('aria-label="Table Item"');
    expect(body).toContain('data-id="Item:a"');
  });
});

const canon = (value: unknown): string => JSON.stringify(value);

async function open(spec: MosaicSpec) {
  return openMosaic(buildMosaic(spec), "built.mosaic");
}

async function viewOf(spec: MosaicSpec, route: TableRoute): Promise<TableView> {
  const file = await open(spec);
  const view = await tableView(file, route);
  file.close();
  if (!("rows" in view)) throw new Error(`not a table view: ${JSON.stringify(view)}`);
  return view;
}

function draw(view: TableView, route: TableRoute = view.route): string {
  return render(TableViewComponent, { props: { view, route, hrefFor: tableHref, nodeHref, onfilter: () => {} } }).body;
}

/** The hrefs of the anchors whose opening tag carries `needle` (an attribute, in any order). */
function anchors(html: string, needle: RegExp): string[] {
  return [...html.matchAll(/<a\s[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => needle.test(tag))
    .map((tag) => /href="([^"]*)"/.exec(tag)?.[1]?.replaceAll("&amp;", "&") ?? "");
}

const ids = (view: TableView): unknown[] => view.rows.map((r) => r[0]);
const numbered = (n: number): MosaicSpec => ({
  typeProps: { Item: '{"n":"integer"}' },
  nodes: Array.from({ length: n }, (_, i) => ({ type: "Item", key: String(i).padStart(3, "0"), props: canon({ n: i }) })),
});

describe("one table per declared node type (design.md Viewer; section 8.6)", () => {
  it("a declared type with no nodes still has its table, empty, one page, total 0", async () => {
    const spec: MosaicSpec = { types: ["Empty"], nodes: [{ type: "Item", key: "a" }] };
    const file = await open(spec);
    expect(file.nodeTypes).toContainEqual({ name: "Empty", count: 0 });
    const { body } = render(TypeList, { props: { types: file.nodeTypes, hrefFor: (t: string) => tableHref({ ...ITEM, type: t }) } });
    expect(attributes(body, "data-type")).toEqual(["Empty", "Item"]);
    file.close();
    const view = await viewOf(spec, { ...ITEM, type: "Empty" });
    expect(view.rows).toEqual([]);
    expect(view.total).toBe(0);
    expect(view.pages).toBe(1);
    expect(view.columns[0]).toBe("id");
    expect(draw(view)).not.toContain("undefined");
  });

  it("a mosaic with no node at all lists no table and does not break the page", async () => {
    const viewer = new Viewer();
    await viewer.open(buildMosaic({ nodes: [] }), "empty.mosaic");
    expect(viewer.status).toBe("ready");
    const { body } = render(App, { props: { viewer } });
    expect(body).not.toContain("undefined");
    expect(attributes(body, "data-type")).toEqual([]);
  });

  it("tables are listed by type name in UTF-8 byte order, each with its own link and count", async () => {
    const names = ["Zed", "Ab", "AB", "A1", "B"];
    const file = await open({ types: names, nodes: [{ type: "B", key: "1" }] });
    const { body } = render(TypeList, { props: { types: file.nodeTypes, hrefFor: (t: string) => tableHref({ ...ITEM, type: t }) } });
    file.close();
    expect(attributes(body, "data-type")).toEqual(["A1", "AB", "Ab", "B", "Zed"]);
    expect(attributes(body, "href").map((h) => parseRoute(h).table?.type)).toEqual(["A1", "AB", "Ab", "B", "Zed"]);
  });

  it("a type name taken from the address that looks like markup is shown as text, never as markup", async () => {
    const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
    const viewer = new Viewer();
    await viewer.open(buildMosaic({ nodes: [{ type: "Item", key: "a" }] }), "a.mosaic");
    await viewer.showTable({ ...ITEM, type: evil });
    expect(viewer.table && "message" in viewer.table).toBe(true);
    const { body } = render(App, { props: { viewer } });
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<img");
  });

  it("every table lists exactly the type's nodes: their counts equal the totals `table` gives", async () => {
    const spec: MosaicSpec = {
      types: ["Empty"],
      nodes: [
        { type: "A", key: "1" },
        { type: "A", key: "2" },
        { type: "A", key: "3" },
        { type: "B", key: "1" },
      ],
    };
    const file = await open(spec);
    for (const t of file.nodeTypes) {
      const answer = await file.table({ type: t.name });
      if (!("data" in answer)) throw new Error("table failed");
      expect(answer.data.total, t.name).toBe(t.count);
    }
    file.close();
  });
});

describe("columns are the declared properties, filled by `table` (section 8.6)", () => {
  it("shows label, then the declared properties in the type's declaration order, and never an undeclared one", async () => {
    const view = await viewOf(
      {
        typeProps: { Item: '{"zeta":"text","alpha":"integer","mid":"boolean"}' },
        nodes: [{ type: "Item", key: "a", label: "A", props: canon({ zeta: "z", alpha: 1, mid: true, stray: "s" }) }],
      },
      ITEM,
    );
    expect(view.columns[0]).toBe("id");
    expect(view.columns).not.toContain("stray");
    expect(view.columns).toHaveLength(view.rows[0]!.length);
    expect(new Set(view.columns)).toEqual(new Set(["id", "label", "zeta", "alpha", "mid"]));
    expect(draw(view)).not.toContain("stray");
  });

  it("a type declaring more than 20 properties shows at most 20 columns after the id", async () => {
    const declared = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${String(i).padStart(2, "0")}`, "text"]));
    const view = await viewOf({ typeProps: { Item: canon(declared) }, nodes: [{ type: "Item", key: "a" }] }, ITEM);
    expect(view.columns.length).toBeLessThanOrEqual(21);
    expect(view.columns.length).toBeGreaterThan(2);
    expect(view.rows[0]).toHaveLength(view.columns.length);
  });

  it("a node with no value in a column has an empty cell, a stored 0, false and empty text are not empty", async () => {
    const view = await viewOf(
      {
        typeProps: { Item: '{"n":"integer","f":"boolean","t":"text","miss":"text"}' },
        nodes: [{ type: "Item", key: "a", props: canon({ n: 0, f: false, t: "" }) }],
      },
      ITEM,
    );
    const row = Object.fromEntries(view.columns.map((c, i) => [c, view.rows[0]![i]]));
    expect(row.n).toBe(0);
    expect(row.f).toBe(false);
    expect(row.t).toBe("");
    expect(row.miss ?? null).toBeNull();
    const body = draw(view);
    expect(body).toContain(">0<");
    expect(body).toContain(">false<");
    expect(cellText(row.miss)).toBe("");
    expect(cellText(0)).toBe("0");
  });

  it("long text is cut as section 8.2 says, so a table cell never holds a whole long text", async () => {
    const view = await viewOf(
      {
        typeProps: { Item: '{"t":"text"}' },
        nodes: [{ type: "Item", key: "a", label: "L".repeat(500), props: canon({ t: "P".repeat(2000) }) }],
      },
      ITEM,
    );
    const row = Object.fromEntries(view.columns.map((c, i) => [c, view.rows[0]![i]]));
    expect(row.label).toBe(cut("L".repeat(500), TEXT_LIMITS.label));
    expect((row.label as string).length).toBeLessThan(500);
    expect(row.t).toBe(cut("P".repeat(2000), TEXT_LIMITS.summary));
    expect((row.t as string).length).toBeLessThan(2000);
    expect(draw(view)).not.toContain("P".repeat(1000));
  });

  it("text from the file in a cell is escaped, never markup", async () => {
    const evil = `<script>alert(1)</script><b onclick="x">`;
    const view = await viewOf(
      { typeProps: { Item: '{"t":"text"}' }, nodes: [{ type: "Item", key: "a", label: evil, props: canon({ t: evil }) }] },
      ITEM,
    );
    const body = draw(view);
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<b onclick");
  });

  it("the table shows text ids only: the first cell of every row is a node's id, no integer row id", async () => {
    const view = await viewOf(numbered(3), ITEM);
    expect(ids(view)).toEqual(["Item:000", "Item:001", "Item:002"]);
    expect(view.columns).not.toContain("nid");
    expect(draw(view)).not.toMatch(/data-id="\d+"/);
  });
});

describe("paging goes through `table`, 20 rows a page (section 8.6)", () => {
  it("PAGE_ROWS is 20", () => {
    expect(PAGE_ROWS).toBe(20);
  });

  it("45 nodes make 3 pages of 20, 20 and 5 rows in id order, with the same total on each", async () => {
    const spec = numbered(45);
    const pages = await Promise.all([1, 2, 3].map((page) => viewOf(spec, { ...ITEM, page })));
    expect(pages.map((p) => p.rows.length)).toEqual([20, 20, 5]);
    expect(pages.map((p) => p.total)).toEqual([45, 45, 45]);
    expect(pages.map((p) => p.pages)).toEqual([3, 3, 3]);
    expect(pages.flatMap(ids)).toEqual(Array.from({ length: 45 }, (_, i) => `Item:${String(i).padStart(3, "0")}`));
  });

  it("exactly 20 nodes make one page, 21 nodes make two, none makes one", async () => {
    expect((await viewOf(numbered(20), ITEM)).pages).toBe(1);
    expect((await viewOf(numbered(21), ITEM)).pages).toBe(2);
    expect((await viewOf({ ...numbered(0), types: ["Item"] }, ITEM)).pages).toBe(1);
  });

  it("a page past the last is empty or an error shown, never rows of another page, and never throws", async () => {
    const file = await open(numbered(5));
    const view = await tableView(file, { ...ITEM, page: 9 });
    file.close();
    if ("rows" in view) expect(view.rows).toEqual([]);
    else expect(view.message.length).toBeGreaterThan(0);
  });

  it("an absurd page number in the address does not throw", async () => {
    const route = parseRoute("#t=Item&p=99999999999999999999999").table;
    expect(route).toBeTruthy();
    const file = await open(numbered(5));
    const view = await tableView(file, route!);
    file.close();
    expect("rows" in view || "message" in view).toBe(true);
  });

  it("the pager keeps the order and the filters, and says where the reader is", async () => {
    const route: TableRoute = {
      type: "Item",
      page: 2,
      order: { column: "n", desc: true },
      where: [{ column: "n", op: ">=", value: 0 }],
    };
    const view = await viewOf(numbered(45), route);
    const body = draw(view, route);
    expect(view.page).toBe(2);
    expect(attributes(body, "data-pages")).toEqual(["3"]);
    const pageLinks = anchors(body, /rel="(prev|next)"/).map(parseRoute);
    expect(pageLinks).toHaveLength(2);
    for (const link of pageLinks) {
      expect(link.table!.order).toEqual({ column: "n", desc: true });
      expect(link.table!.where).toEqual(route.where);
    }
  });

  it("the first page offers no previous page and the last offers no next page", async () => {
    const spec = numbered(45);
    const first = draw(await viewOf(spec, ITEM));
    expect(first).not.toContain('rel="prev"');
    expect(first).toContain('rel="next"');
    const last = draw(await viewOf(spec, { ...ITEM, page: 3 }));
    expect(last).toContain('rel="prev"');
    expect(last).not.toContain('rel="next"');
    const only = draw(await viewOf(numbered(3), ITEM));
    expect(only).not.toContain('rel="prev"');
    expect(only).not.toContain('rel="next"');
  });
});

describe("sorting goes through `table` (section 8.6)", () => {
  const MIXED: MosaicSpec = {
    typeProps: { Item: '{"v":"text"}' },
    nodes: [
      { type: "Item", key: "a-none" },
      { type: "Item", key: "b-text", props: canon({ v: "b" }) },
      { type: "Item", key: "c-num", props: canon({ v: 5 }) },
      { type: "Item", key: "d-true", props: canon({ v: true }) },
      { type: "Item", key: "e-false", props: canon({ v: false }) },
      { type: "Item", key: "f-list", props: canon({ v: ["x"] }) },
      { type: "Item", key: "g-obj", props: canon({ v: { k: 1 } }) },
      { type: "Item", key: "h-num", props: canon({ v: -2 }) },
      { type: "Item", key: "i-text", props: canon({ v: "a" }) },
      { type: "Item", key: "j-null", props: canon({ v: null }) },
    ],
  };

  it("values of different kinds sort in groups, nodes with no value last in both directions", async () => {
    const asc = await viewOf(MIXED, { ...ITEM, order: { column: "v", desc: false } });
    expect(ids(asc)).toEqual([
      "Item:e-false",
      "Item:d-true",
      "Item:h-num",
      "Item:c-num",
      "Item:i-text",
      "Item:b-text",
      "Item:f-list",
      "Item:g-obj",
      "Item:a-none",
      "Item:j-null",
    ]);
    const desc = await viewOf(MIXED, { ...ITEM, order: { column: "v", desc: true } });
    expect(ids(desc)).toEqual([
      "Item:d-true",
      "Item:e-false",
      "Item:c-num",
      "Item:h-num",
      "Item:b-text",
      "Item:i-text",
      "Item:f-list",
      "Item:g-obj",
      "Item:a-none",
      "Item:j-null",
    ]);
  });

  it("descending keeps ties in id order, as ascending does", async () => {
    const spec: MosaicSpec = {
      typeProps: { Item: '{"g":"integer"}' },
      nodes: ["c", "a", "b"].map((k) => ({ type: "Item", key: k, props: canon({ g: 1 }) })),
    };
    expect(ids(await viewOf(spec, { ...ITEM, order: { column: "g", desc: false } }))).toEqual(["Item:a", "Item:b", "Item:c"]);
    expect(ids(await viewOf(spec, { ...ITEM, order: { column: "g", desc: true } }))).toEqual(["Item:a", "Item:b", "Item:c"]);
  });

  it("text sorts by UTF-8 bytes, not by locale or case", async () => {
    const spec: MosaicSpec = {
      typeProps: { Item: '{"s":"text"}' },
      nodes: ["é", "z", "Z", "a", "～", "\u{1F600}"].map((s, i) => ({ type: "Item", key: String(i), props: canon({ s }) })),
    };
    const view = await viewOf(spec, { ...ITEM, order: { column: "s", desc: false } });
    const col = view.columns.indexOf("s");
    expect(view.rows.map((r) => r[col])).toEqual(["Z", "a", "z", "é", "～", "\u{1F600}"]);
  });

  it("a sort by the node's label, key or summary needs no declared property", async () => {
    const spec: MosaicSpec = {
      nodes: [
        { type: "Item", key: "1", label: "B", summary: "x" },
        { type: "Item", key: "2", label: "A", summary: "z" },
      ],
    };
    expect(ids(await viewOf(spec, { ...ITEM, order: { column: "label", desc: false } }))).toEqual(["Item:2", "Item:1"]);
    expect(ids(await viewOf(spec, { ...ITEM, order: { column: "summary", desc: true } }))).toEqual(["Item:2", "Item:1"]);
    expect(ids(await viewOf(spec, { ...ITEM, order: { column: "key", desc: true } }))).toEqual(["Item:2", "Item:1"]);
  });

  it("sorting by a column the type does not have is an error naming it, never rows in another order", async () => {
    const file = await open(numbered(3));
    const view = await tableView(file, { ...ITEM, order: { column: "nope", desc: false } });
    file.close();
    expect("rows" in view).toBe(false);
    expect("message" in view && view.message).toContain("nope");
  });

  it("an unsorted table marks no property column as sorted (the id order is the default one)", async () => {
    const body = draw(await viewOf(numbered(3), ITEM));
    for (const tag of body.match(/<th\s[^>]*>[^]*?<\/th>/g) ?? []) {
      if (/data-column=/.test(tag)) expect(tag).not.toMatch(/aria-sort="(ascending|descending)"/);
    }
  });
});

describe("filtering goes through `table`, with the where operators (section 8.6)", () => {
  const SPEC: MosaicSpec = {
    typeProps: { Item: '{"code":"text","n":"integer","f":"boolean"}' },
    nodes: [
      { type: "Item", key: "1", label: "One", props: canon({ code: "Alpha", n: 1, f: true }) },
      { type: "Item", key: "2", label: "Two", props: canon({ code: "beta", n: 2, f: false }) },
      { type: "Item", key: "3", label: "Three", props: canon({ code: "ALPHABET", n: 3 }) },
      { type: "Item", key: "4", label: "Four", props: canon({ n: "3" }) },
      { type: "Item", key: "5", label: "Five" },
    ],
  };
  const where = async (column: string, op: TableRoute["where"][number]["op"], value: string | number | boolean) =>
    ids(await viewOf(SPEC, { ...ITEM, where: [{ column, op, value }] })).map((id) => String(id).slice(5));

  it("each operator is passed through unchanged and holds as section 8.6 words it", async () => {
    expect(await where("n", "=", 2)).toEqual(["2"]);
    expect(await where("n", "!=", 2)).toEqual(["1", "3", "4", "5"]);
    expect(await where("n", "<", 3)).toEqual(["1", "2"]);
    expect(await where("n", "<=", 3)).toEqual(["1", "2", "3"]);
    expect(await where("n", ">", 1)).toEqual(["2", "3"]);
    expect(await where("n", ">=", 2)).toEqual(["2", "3"]);
    expect(await where("code", "contains", "alpha")).toEqual(["1", "3"]);
    expect(await where("f", "=", true)).toEqual(["1"]);
    expect(await where("f", "!=", true)).toEqual(["2", "3", "4", "5"]);
    expect(OPERATORS).toHaveLength(7);
  });

  it("text 3 and number 3 are different values: the kind of the filter decides", async () => {
    expect(await where("n", "=", "3")).toEqual(["4"]);
    expect(await where("n", "=", 3)).toEqual(["3"]);
    expect(await where("f", "=", "true")).toEqual([]);
  });

  it("several filters must all hold", async () => {
    const both = await viewOf(SPEC, {
      ...ITEM,
      where: [
        { column: "code", op: "contains", value: "alpha" },
        { column: "n", op: ">", value: 1 },
      ],
    });
    expect(ids(both)).toEqual(["Item:3"]);
    expect(both.total).toBe(1);
  });

  it("the total counts every node the filters keep, not the page's rows", async () => {
    const view = await viewOf(numbered(45), { ...ITEM, where: [{ column: "n", op: ">=", value: 10 }] });
    expect(view.total).toBe(35);
    expect(view.rows).toHaveLength(20);
    expect(view.pages).toBe(2);
  });

  it("a filter that keeps nothing shows an empty table with total 0, not an error", async () => {
    const view = await viewOf(SPEC, { ...ITEM, where: [{ column: "code", op: "=", value: "nothing" }] });
    expect(view.rows).toEqual([]);
    expect(view.total).toBe(0);
    expect(view.pages).toBe(1);
    expect(attributes(draw(view), "data-total")).toEqual(["0"]);
  });

  it("filtering on a column the type does not have is an error naming it, never an empty table", async () => {
    const file = await open(SPEC);
    const view = await tableView(file, { ...ITEM, where: [{ column: "colour", op: "=", value: "red" }] });
    file.close();
    expect("rows" in view).toBe(false);
    expect("message" in view && view.message).toContain("colour");
  });

  it("21 filters are refused by `table` and the refusal is shown, not thrown", async () => {
    const file = await open(SPEC);
    const where = Array.from({ length: 21 }, () => ({ column: "n", op: ">=" as const, value: 0 }));
    const view = await tableView(file, { ...ITEM, where });
    file.close();
    expect("rows" in view).toBe(false);
    expect("message" in view && view.message.length).toBeGreaterThan(0);
  });

  it("a filter on a column that `columns` leaves out still works: the table's own columns do not limit it", async () => {
    const view = await viewOf(SPEC, { ...ITEM, where: [{ column: "key", op: "=", value: "2" }] });
    expect(ids(view)).toEqual(["Item:2"]);
  });

});

describe("a row opens its node page (design.md Viewer)", () => {
  const ODD = ["a/b c", "x&y=z", "h#h", "q?r", "p%20q", "é+ü", "日本", "a:b"];
  const SPEC: MosaicSpec = { nodes: ODD.map((key) => ({ type: "Item", key, label: `L ${key}` })) };

  it("every row's link carries exactly that row's id, whatever characters the id has", async () => {
    const view = await viewOf(SPEC, ITEM);
    const body = draw(view);
    const rowIds = attributes(body, "data-id").map((a) => a.replaceAll("&quot;", '"'));
    expect(rowIds.sort()).toEqual(ids(view).map(String).sort());
    const linked = attributes(body, "href").map(parseRoute).filter((r) => r.node !== null).map((r) => r.node);
    expect(new Set(linked)).toEqual(new Set(ODD.map((k) => `Item:${k}`)));
  });

  it("the node a row links to opens through `get`: its page shows that node", async () => {
    const file = await open(SPEC);
    const view = await tableView(file, ITEM);
    if (!("rows" in view)) throw new Error("no table");
    for (const row of view.rows) {
      const node = parseRoute(nodeHref(String(row[0]))).node;
      expect(node).toBe(row[0]);
      const page = await nodePage(file, node!);
      expect("node" in page, String(row[0])).toBe(true);
    }
    file.close();
  });

  it("a node link leaves the table's view: the address of a row holds the node and no stale table state", async () => {
    const link = parseRoute(nodeHref("Item:a/b c"));
    expect(link.node).toBe("Item:a/b c");
    expect(link.table ?? null).toBeNull();
  });
});

describe("table addresses (reload and share)", () => {
  it("filter values keep their kind through the address: text 2020, number 2020, true and text true", () => {
    const where: TableRoute["where"] = [
      { column: "a", op: "=", value: "2020" },
      { column: "a", op: "=", value: 2020 },
      { column: "a", op: "=", value: true },
      { column: "a", op: "=", value: "true" },
      { column: "a", op: "=", value: "" },
      { column: "a", op: ">", value: 0 },
      { column: "a", op: "<", value: -0.5 },
      { column: "a", op: "<=", value: 1e21 },
      { column: "a", op: "contains", value: "null" },
      { column: "a", op: "contains", value: "日本 \u{1F600} é" },
    ];
    const table: TableRoute = { type: "Item", page: 1, order: null, where };
    expect(parseRoute(routeHash({ query: "", node: null, table })).table).toEqual(table);
  });

  it("column and type names with reserved characters survive the address", () => {
    const table: TableRoute = {
      type: "T&p=1#x%",
      page: 4,
      order: { column: "col&w=[]", desc: true },
      where: [{ column: "c=d", op: "=", value: "v&t=Other" }],
    };
    const back = parseRoute(routeHash({ query: "", node: null, table })).table;
    expect(back).toEqual(table);
  });

  it("the table, the search query and the open node do not overwrite one another", () => {
    const route = { query: "lamp a", node: "Item:a", table: { ...ITEM, page: 2 } };
    const back = parseRoute(routeHash(route));
    expect(back.query).toBe("lamp a");
    expect(back.node).toBe("Item:a");
    expect(back.table).toEqual(route.table);
  });

  it("the same route always gives the same address", () => {
    const table: TableRoute = {
      type: "Item",
      page: 2,
      order: { column: "n", desc: false },
      where: [{ column: "n", op: ">", value: 1 }],
    };
    const route = { query: "", node: null, table };
    expect(routeHash(route)).toBe(routeHash({ ...route }));
    expect(routeHash(parseRoute(routeHash(route)))).toBe(routeHash(route));
  });

  it("a route without a table gives an address with no table part", () => {
    expect(routeHash({ query: "x", node: null })).not.toMatch(/[#&]t=/);
    expect(routeHash({ query: "x", node: null, table: null })).not.toMatch(/[#&]t=/);
  });

  it("a malformed address never gives a table with page below 1, a fractional page or an unknown operator", () => {
    for (const p of ["0", "-1", "2.5", "abc", "", "NaN", "Infinity", " "]) {
      const table = parseRoute(`#t=Item&p=${encodeURIComponent(p)}`).table;
      expect(table?.page, `p=${JSON.stringify(p)}`).toBe(1);
    }
    for (const w of ["[]", "{}", "null", "1", '"x"', "[null]", '[{"column":"a"}]', '[{"column":"a","op":"=","value":null}]', '[{"column":"a","op":"=","value":{"x":1}}]', '[{"column":"a","op":"=","value":[1]}]']) {
      const table = parseRoute(`#t=Item&w=${encodeURIComponent(w)}`).table;
      expect(table?.where, `w=${w}`).toEqual([]);
    }
    for (const o of [""]) {
      expect(parseRoute(`#t=Item&o=${encodeURIComponent(o)}`).table?.order ?? null, `o=${o}`).toBeNull();
    }
  });

  it("an address never makes the viewer throw: any table asked of the open mosaic is a view or a shown error", async () => {
    const file = await open(numbered(3));
    for (const hash of ["#t=Item&p=0", "#t=Item&w=%00", "#t=%00", "#t=Item&o=%5B%5D", "#t=Item&w=%5B%7B%7D%5D", "#t=__proto__", "#t=constructor"]) {
      const route = parseRoute(hash).table;
      if (!route) continue;
      const view = await tableView(file, route);
      expect("rows" in view || "message" in view, hash).toBe(true);
    }
    file.close();
  });

  it("the table's arguments for a route are the same call twice, and never carry a field the route lacks", () => {
    const route: TableRoute = {
      type: "Item",
      page: 3,
      order: { column: "n", desc: true },
      where: [{ column: "n", op: "!=", value: 2 }],
    };
    expect(tableArgs(route)).toEqual(tableArgs(route));
    expect(Object.keys(tableArgs(ITEM)).sort()).toEqual(["page", "type"]);
    expect(tableArgs(route)).toEqual({
      type: "Item",
      page: 3,
      order: { column: "n", direction: "desc" },
      where: [{ column: "n", op: "!=", value: 2 }],
    });
  });
});

describe("filter values and cells, edge inputs", () => {
  it("a number filter refuses what JSON cannot carry", () => {
    for (const text of ["Infinity", "-Infinity", "NaN", "1,5", "1 2", "--1", "0x", "  "]) {
      expect(filterValue(text, "number"), text).toBeNull();
    }
    expect(filterValue("1e3", "number")).toBe(1000);
    expect(filterValue("0", "number")).toBe(0);
    expect(filterValue("-0.25", "number")).toBe(-0.25);
  });

  it("a text filter is the text as typed, spaces and case kept", () => {
    expect(filterValue(" Ab ", "text")).toBe(" Ab ");
    expect(filterValue("null", "text")).toBe("null");
    expect(filterValue("2020", "text")).toBe("2020");
  });

  it("a boolean filter is only true or false", () => {
    for (const text of ["", "1", "0", "null", "on", "no"]) expect(filterValue(text, "boolean"), text).toBeNull();
  });

  it("cell text of a list or an object is JSON or labels and never `[object Object]`", () => {
    expect(cellText({ a: { b: [1, "x"] } })).toBe('{"a":{"b":[1,"x"]}}');
    expect(cellText([])).toBe("");
    expect(cellText(["日本", "é"])).toBe("日本, é");
    expect(cellText(undefined)).toBe("");
    expect(cellText("")).toBe("");
    expect(cellText("a\nb")).toContain("a");
    for (const v of [{ x: 1 }, [{ x: 1 }], [[1]], true, 1.5, -3]) expect(cellText(v)).not.toContain("[object");
  });
});

describe("the Viewer and its tables", () => {
  const A: MosaicSpec = { nodes: [{ type: "Item", key: "a" }] };
  const B: MosaicSpec = { nodes: [{ type: "Other", key: "b" }] };

  it("asking for a table before a mosaic is open does not throw and shows no table", async () => {
    const viewer = new Viewer();
    await viewer.showTable(ITEM);
    expect(viewer.table ?? null).toBeNull();
  });

  it("opening another mosaic drops the table of the previous one", async () => {
    const viewer = new Viewer();
    await viewer.open(buildMosaic(A), "a.mosaic");
    await viewer.showTable(ITEM);
    expect(viewer.table && "rows" in viewer.table).toBe(true);
    await viewer.open(buildMosaic(B), "b.mosaic");
    expect(viewer.table ?? null).toBeNull();
    expect(viewer.file?.nodeTypes.map((t) => t.name)).toEqual(["Other"]);
  });

  it("the table of a type the open mosaic lacks is a shown error naming the type, then a real table replaces it", async () => {
    const viewer = new Viewer();
    await viewer.open(buildMosaic(A), "a.mosaic");
    await viewer.showTable({ ...ITEM, type: "Ghost" });
    expect(viewer.table && "message" in viewer.table && viewer.table.message).toContain("Ghost");
    await viewer.showTable(ITEM);
    expect(viewer.table && "rows" in viewer.table).toBe(true);
  });

  it("many table requests in a row end on the last one asked", async () => {
    const viewer = new Viewer();
    await viewer.open(buildMosaic(numbered(45)), "n.mosaic");
    const asked = [1, 2, 3, 2, 1, 3].map((page) => viewer.showTable({ ...ITEM, page }));
    await Promise.all(asked);
    expect(viewer.table && "page" in viewer.table && viewer.table.page).toBe(3);
  });

  it("the same table drawn twice is the same page, byte for byte", async () => {
    const view = await viewOf(numbered(25), { ...ITEM, order: { column: "n", desc: true }, where: [{ column: "n", op: ">", value: 2 }] });
    expect(draw(view)).toBe(draw(view));
    const again = await viewOf(numbered(25), view.route);
    expect(again.rows).toEqual(view.rows);
  });

  it("the table view's route is the route asked", async () => {
    const route: TableRoute = { ...ITEM, page: 2, order: { column: "n", desc: true } };
    expect((await viewOf(numbered(45), route)).route).toEqual(route);
  });
});

describe("tables columns: further cases", () => {
  const ITEM: TableRoute = { type: "Item", page: 1, order: null, where: [] };
  const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
  const nodeHref = (id: string) => routeHash({ query: "", node: id });
  const canon = (value: unknown): string => JSON.stringify(value);

  async function viewOf(spec: MosaicSpec, route: TableRoute): Promise<TableView> {
    const file = await openMosaic(buildMosaic(spec), "built.mosaic");
    const view = await tableView(file, route);
    file.close();
    if (!("rows" in view)) throw new Error(`not a table view: ${JSON.stringify(view)}`);
    return view;
  }

  function draw(view: TableView, route: TableRoute = view.route): string {
    return render(TableViewComponent, { props: { view, route, hrefFor: tableHref, nodeHref, onfilter: () => {} } }).body;
  }

  const ids = (view: TableView): unknown[] => view.rows.map((r) => r[0]);
  const cells = (view: TableView, column: string): unknown[] => {
    const at = view.columns.indexOf(column);
    expect(at, `column ${column} in ${view.columns.join(",")}`).toBeGreaterThan(-1);
    return view.rows.map((r) => r[at]);
  };
  const numbered = (n: number): MosaicSpec => ({
    typeProps: { Item: '{"n":"integer"}' },
    nodes: Array.from({ length: n }, (_, i) => ({ type: "Item", key: String(i).padStart(4, "0"), props: canon({ n: i }) })),
  });

  describe("the columns of a table (section 8.6, Rows)", () => {
    it("shows label, then the declared properties in stored order, 20 columns in all after the id", async () => {
      // Section 8.6: "label, then the declared properties in the order the type declares them,
      // 20 columns in all" (id comes first and is extra: `data.columns` is `id`, then the columns).
      const declared = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${String(i).padStart(2, "0")}`, "text"]));
      const view = await viewOf({ typeProps: { Item: canon(declared) }, nodes: [{ type: "Item", key: "a" }] }, ITEM);
      expect(view.columns).toEqual(["id", "label", ...Array.from({ length: 19 }, (_, i) => `p${String(i).padStart(2, "0")}`)]);
      expect(view.rows[0]).toHaveLength(21);
    });

    it("a type declaring exactly 19 properties shows all of them", async () => {
      const declared = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`p${String(i).padStart(2, "0")}`, "text"]));
      const view = await viewOf({ typeProps: { Item: canon(declared) }, nodes: [{ type: "Item", key: "a" }] }, ITEM);
      expect(view.columns).toHaveLength(21);
      expect(view.columns.at(-1)).toBe("p18");
    });

    it("a type declaring no property has only id and label", async () => {
      const view = await viewOf({ typeProps: { Item: "{}" }, nodes: [{ type: "Item", key: "a", label: "A" }] }, ITEM);
      expect(view.columns).toEqual(["id", "label"]);
      expect(view.rows).toEqual([["Item:a", "A"]]);
    });

    it("property names that are also names of JavaScript objects are plain columns", async () => {
      const names = ["__proto__", "constructor", "hasOwnProperty", "toString", "length"];
      const declared = Object.fromEntries(names.map((n) => [n, "text"]));
      const props = `{${names.map((n, i) => `${canon(n)}:${canon(`v${i}`)}`).join(",")}}`;
      const view = await viewOf({ typeProps: { Item: `{${names.map((n) => `${canon(n)}:"text"`).join(",")}}` }, nodes: [{ type: "Item", key: "a", props }] }, ITEM);
      expect(Object.keys(declared)).toHaveLength(5);
      expect([...view.columns].sort()).toEqual(["id", "label", ...names].sort());
      for (const [i, n] of names.entries()) expect(cells(view, n), n).toEqual([`v${i}`]);
      // And a filter and an order on them go through `table` like any other column.
      const filtered = await viewOf(
        { typeProps: { Item: `{${names.map((n) => `${canon(n)}:"text"`).join(",")}}` }, nodes: [{ type: "Item", key: "a", props }, { type: "Item", key: "b", props: "{}" }] },
        { ...ITEM, where: [{ column: "constructor", op: "=", value: "v1" }], order: { column: "__proto__", desc: false } },
      );
      expect(ids(filtered)).toEqual(["Item:a"]);
    });

    it("column names with markup are escaped in headers and attributes", async () => {
      const evil = `"><img src=x onerror=alert(1)>`;
      const view = await viewOf({ typeProps: { Item: canon({ [evil]: "text" }) }, nodes: [{ type: "Item", key: "a", props: canon({ [evil]: evil }) }] }, ITEM);
      const body = draw(view, { ...ITEM, order: { column: evil, desc: false } });
      expect(body).not.toContain("<img");
      expect(body).not.toMatch(/<[^>]*\sonerror=/);
    });

    it("a node id with quotes and markup is one link to exactly that node, never markup", async () => {
      const key = `x"><script>alert(1)</script>'`;
      const view = await viewOf({ nodes: [{ type: "Item", key, label: "L" }] }, ITEM);
      const body = draw(view);
      expect(body).not.toContain("<script>");
      const links = [...body.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => parseRoute(m[1]!.replaceAll("&amp;", "&")).node);
      expect(links).toContain(`Item:${key}`);
    });

    it("a json property holding a list or an object is drawn as its JSON text, escaped", async () => {
      const view = await viewOf(
        {
          typeProps: { Item: '{"j":"json"}' },
          nodes: [
            { type: "Item", key: "1", props: canon({ j: { k: "<b>" } }) },
            { type: "Item", key: "2", props: canon({ j: ["x", "y"] }) },
          ],
        },
        ITEM,
      );
      expect(cells(view, "j")).toEqual([{ k: "<b>" }, ["x", "y"]]);
      const body = draw(view);
      expect(body).not.toContain("[object");
      expect(body).not.toContain("<b>");
    });

    it("a stored JSON null in a property is an empty cell, like a node with no value", async () => {
      const view = await viewOf(
        { typeProps: { Item: '{"v":"text"}' }, nodes: [{ type: "Item", key: "a", props: canon({ v: null }) }, { type: "Item", key: "b" }] },
        ITEM,
      );
      expect(cells(view, "v")).toEqual([null, null]);
    });

    it("a label of many astral characters is cut at 120 characters without breaking one in half", async () => {
      const label = "\u{1F600}".repeat(300);
      const view = await viewOf({ nodes: [{ type: "Item", key: "a", label }] }, ITEM);
      const cell = cells(view, "label")[0] as string;
      expect(cell).toBe(cut(label, TEXT_LIMITS.label));
      expect(cell.isWellFormed()).toBe(true);
      expect(draw(view).includes("\u{1F600}".repeat(200))).toBe(false);
    });

    it("a summary or key filter sees the stored text, not the cut one", async () => {
      // Section 8.6: text is cut in cells; `where` compares the values (section 8.2 cuts what is returned).
      const long = "q".repeat(300) + "TAIL";
      const spec: MosaicSpec = { nodes: [{ type: "Item", key: "a", label: long }, { type: "Item", key: "b", label: "short" }] };
      const view = await viewOf(spec, { ...ITEM, where: [{ column: "label", op: "contains", value: "tail" }] });
      expect(ids(view)).toEqual(["Item:a"]);
    });
  });

  describe("the type list (design.md Viewer)", () => {
    it("shows each table's count next to its name, 0 for a declared type without nodes", async () => {
      const file = await openMosaic(
        buildMosaic({ types: ["Empty"], nodes: [{ type: "A", key: "1" }, { type: "A", key: "2" }, { type: "A", key: "3" }] }),
        "t.mosaic",
      );
      const { body } = render(TypeList, { props: { types: file.nodeTypes, hrefFor: (t: string) => tableHref({ ...ITEM, type: t }) } });
      file.close();
      const row = (name: string) => new RegExp(`data-type="${name}"[^]*?</a>`).exec(body)![0];
      expect(row("A")).toMatch(/>3</);
      expect(row("Empty")).toMatch(/>0</);
    });
  });

  describe("filtering and ordering, through `table` (section 8.6)", () => {
    it("`contains` ignores case across the Unicode default lowercase mapping and finds list items", async () => {
      const spec: MosaicSpec = {
        typeProps: { Item: '{"s":"text","l":"json"}' },
        nodes: [
          { type: "Item", key: "1", props: canon({ s: "Éclair", l: ["Red", "Green"] }) },
          { type: "Item", key: "2", props: canon({ s: "eclair", l: ["Blue"] }) },
          { type: "Item", key: "3", props: canon({ s: "ΣΑΣ", l: [1, 2] }) },
          { type: "Item", key: "4" },
        ],
      };
      const run = async (column: string, value: string) => ids(await viewOf(spec, { ...ITEM, where: [{ column, op: "contains", value }] }));
      expect(await run("s", "éCL")).toEqual(["Item:1"]);
      expect(await run("s", "ECL")).toEqual(["Item:2"]);
      // A text always contains itself, whatever the lowercase mapping does to it (final sigma included).
      expect(await run("s", "ΣΑΣ")).toEqual(["Item:3"]);
      expect(await run("l", "GREEN")).toEqual(["Item:1"]);
      expect(await run("l", "1")).toEqual([]);
    });

    it("`contains` with an empty text holds on every node with text, and on none without", async () => {
      // Section 8.6: "holds on text that contains the given text"; every text contains "".
      const spec: MosaicSpec = {
        typeProps: { Item: '{"s":"text"}' },
        nodes: [{ type: "Item", key: "1", props: canon({ s: "x" }) }, { type: "Item", key: "2", props: canon({ s: "" }) }, { type: "Item", key: "3" }],
      };
      const view = await viewOf(spec, { ...ITEM, where: [{ column: "s", op: "contains", value: "" }] });
      expect(ids(view)).toEqual(["Item:1", "Item:2"]);
    });

    it("text comparisons go by UTF-8 bytes: an astral character is above a character of the plane below it", async () => {
      // U+FF5E (3 bytes EF BD 9E) sorts before U+1F600 (F0 9F 98 80) in bytes; UTF-16 order would reverse them.
      const spec: MosaicSpec = {
        typeProps: { Item: '{"s":"text"}' },
        nodes: ["\u{1F600}", "～", "ﬁ"].map((s, i) => ({ type: "Item", key: String(i), props: canon({ s }) })),
      };
      const gt = await viewOf(spec, { ...ITEM, where: [{ column: "s", op: ">", value: "～" }] });
      expect(cells(gt, "s")).toEqual(["\u{1F600}"]);
      const lt = await viewOf(spec, { ...ITEM, where: [{ column: "s", op: "<", value: "～" }] });
      expect(cells(lt, "s")).toEqual(["ﬁ"]);
    });

    it("numbers compare by value whatever their spelling: 1, 1.0 and 1e0 are one value", async () => {
      const spec: MosaicSpec = {
        typeProps: { Item: '{"x":"number"}' },
        nodes: [
          { type: "Item", key: "a", props: '{"x":1}' },
          { type: "Item", key: "b", props: '{"x":1.0}' },
          { type: "Item", key: "c", props: '{"x":10e-1}' },
          { type: "Item", key: "d", props: '{"x":-0}' },
          { type: "Item", key: "e", props: '{"x":0.5}' },
        ],
      };
      expect(ids(await viewOf(spec, { ...ITEM, where: [{ column: "x", op: "=", value: 1 }] }))).toEqual(["Item:a", "Item:b", "Item:c"]);
      expect(ids(await viewOf(spec, { ...ITEM, where: [{ column: "x", op: "=", value: 0 }] }))).toEqual(["Item:d"]);
      expect(ids(await viewOf(spec, { ...ITEM, order: { column: "x", desc: false } }))).toEqual(["Item:d", "Item:e", "Item:a", "Item:b", "Item:c"]);
    });

    it("an order on one column and a filter on another both hold, and paging runs over the filtered total", async () => {
      const view = await viewOf(numbered(70), {
        type: "Item",
        page: 2,
        order: { column: "n", desc: true },
        where: [{ column: "n", op: "<", value: 50 }, { column: "n", op: ">=", value: 5 }],
      });
      expect(view.total).toBe(45);
      expect(view.pages).toBe(3);
      expect(cells(view, "n")).toEqual(Array.from({ length: 20 }, (_, i) => 29 - i));
    });

    it("the last page of a filtered table holds the remainder", async () => {
      const view = await viewOf(numbered(70), { ...ITEM, page: 3, where: [{ column: "n", op: "<", value: 45 }] });
      expect(view.total).toBe(45);
      expect(cells(view, "n")).toEqual([40, 41, 42, 43, 44]);
    });

    it("ordering by label puts nodes with no label last, ascending or descending, ties by id", async () => {
      const spec: MosaicSpec = {
        nodes: [
          { type: "Item", key: "1", label: "B" },
          { type: "Item", key: "2" },
          { type: "Item", key: "3", label: "A" },
          { type: "Item", key: "4", label: "B" },
          { type: "Item", key: "0" },
        ],
      };
      expect(ids(await viewOf(spec, { ...ITEM, order: { column: "label", desc: false } }))).toEqual(["Item:3", "Item:1", "Item:4", "Item:0", "Item:2"]);
      expect(ids(await viewOf(spec, { ...ITEM, order: { column: "label", desc: true } }))).toEqual(["Item:1", "Item:4", "Item:3", "Item:0", "Item:2"]);
    });

    it("a boolean filter on a property that holds text, numbers or nothing keeps only real booleans for `=`", async () => {
      const spec: MosaicSpec = {
        typeProps: { Item: '{"f":"boolean"}' },
        nodes: [
          { type: "Item", key: "1", props: canon({ f: true }) },
          { type: "Item", key: "2", props: canon({ f: "true" }) },
          { type: "Item", key: "3", props: canon({ f: 1 }) },
          { type: "Item", key: "4" },
        ],
      };
      expect(ids(await viewOf(spec, { ...ITEM, where: [{ column: "f", op: "=", value: true }] }))).toEqual(["Item:1"]);
      expect(ids(await viewOf(spec, { ...ITEM, where: [{ column: "f", op: "!=", value: true }] }))).toEqual(["Item:2", "Item:3", "Item:4"]);
    });

    it("an unknown column is refused even when the table has no node, and the message names the column", async () => {
      const file = await openMosaic(buildMosaic({ types: ["Empty"], nodes: [{ type: "A", key: "1" }] }), "t.mosaic");
      for (const route of [
        { ...ITEM, type: "Empty", where: [{ column: "ghost", op: "=" as const, value: 1 }] },
        { ...ITEM, type: "Empty", order: { column: "ghost", desc: true } },
      ]) {
        const view = await tableView(file, route);
        expect("rows" in view).toBe(false);
        expect("message" in view && view.message).toContain("ghost");
      }
      file.close();
    });

    it("a column name of another type is unknown here", async () => {
      const file = await openMosaic(
        buildMosaic({
          typeProps: { A: '{"only_a":"text"}', B: '{"only_b":"text"}' },
          nodes: [{ type: "A", key: "1", props: canon({ only_a: "x" }) }, { type: "B", key: "1", props: canon({ only_b: "y" }) }],
        }),
        "t.mosaic",
      );
      const view = await tableView(file, { type: "B", page: 1, order: null, where: [{ column: "only_a", op: "=", value: "x" }] });
      expect("rows" in view).toBe(false);
      expect("message" in view && view.message).toContain("only_a");
      file.close();
    });
  });

  describe("paging (section 8.6: page from 1, 20 rows, total counts every kept node)", () => {
    it("1000 nodes: the last page holds 20, the pager says 50 pages, and rows are in id byte order", async () => {
      const spec = numbered(1000);
      const last = await viewOf(spec, { ...ITEM, page: 50 });
      expect(last.pages).toBe(50);
      expect(last.total).toBe(1000);
      expect(ids(last)).toEqual(Array.from({ length: 20 }, (_, i) => `Item:${String(980 + i).padStart(4, "0")}`));
    });

    it("ids sort by UTF-8 bytes across pages: upper case before lower case, no locale folding", async () => {
      const keys = ["b", "B", "a", "A", "é", "e", "Z", "z", "_", "0"];
      const spec: MosaicSpec = { nodes: keys.map((key) => ({ type: "Item", key })) };
      const view = await viewOf(spec, ITEM);
      expect(ids(view)).toEqual(["0", "A", "B", "Z", "_", "a", "b", "e", "z", "é"].map((k) => `Item:${k}`));
    });

    it("page 0, a negative page and a fractional page are refused by `table` and shown, never thrown", async () => {
      const file = await openMosaic(buildMosaic(numbered(3)), "t.mosaic");
      for (const page of [0, -1, 1.5, Number.NaN]) {
        const view = await tableView(file, { ...ITEM, page });
        expect("rows" in view || "message" in view, String(page)).toBe(true);
        if ("rows" in view) expect(view.page).toBeGreaterThanOrEqual(1);
      }
      file.close();
    });

    it("a big table is read in a page's time: 3000 nodes ordered and filtered answer well inside the kit's limit", async () => {
      const spec = numbered(3000);
      const file = await openMosaic(buildMosaic(spec), "big.mosaic");
      const started = performance.now();
      const view = await tableView(file, { type: "Item", page: 75, order: { column: "n", desc: true }, where: [{ column: "n", op: ">=", value: 1000 }] });
      const took = performance.now() - started;
      file.close();
      expect("rows" in view).toBe(true);
      if ("rows" in view) {
        expect(view.total).toBe(2000);
        expect(view.pages).toBe(100);
        expect(cells(view, "n")).toEqual(Array.from({ length: 20 }, (_, i) => 2999 - 74 * 20 - i));
      }
      expect(took).toBeLessThan(3000);
    });
  });

  describe("the Viewer and tables in flight (design.md Viewer)", () => {
    const A: MosaicSpec = { nodes: [{ type: "Item", key: "a" }] };
    const B: MosaicSpec = { nodes: [{ type: "Other", key: "b" }] };

    it("requests asked page 3, 2, 1 end on page 1, the last asked", async () => {
      const viewer = new Viewer();
      await viewer.open(buildMosaic(numbered(60)), "n.mosaic");
      await Promise.all([3, 2, 1].map((page) => viewer.showTable({ ...ITEM, page })));
      expect(viewer.table && "page" in viewer.table && viewer.table.page).toBe(1);
    });

    it("a table still being read when another mosaic opens is not shown over the new mosaic", async () => {
      const viewer = new Viewer();
      await viewer.open(buildMosaic(A), "a.mosaic");
      const pending = viewer.showTable(ITEM);
      await viewer.open(buildMosaic(B), "b.mosaic");
      await pending;
      expect(viewer.file?.nodeTypes.map((t) => t.name)).toEqual(["Other"]);
      const shown = viewer.table;
      // Either nothing, or a refusal: never the rows of the file that is closed.
      expect(shown && "rows" in shown ? shown.rows : []).toEqual([]);
    });

    it("showing a table twice with the same route gives equal views", async () => {
      const viewer = new Viewer();
      await viewer.open(buildMosaic(numbered(30)), "n.mosaic");
      await viewer.showTable({ ...ITEM, page: 2, order: { column: "n", desc: true } });
      const first = JSON.stringify(viewer.table);
      await viewer.showTable({ ...ITEM, page: 2, order: { column: "n", desc: true } });
      expect(JSON.stringify(viewer.table)).toBe(first);
    });
  });
});
