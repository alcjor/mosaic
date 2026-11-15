// Viewer shell (brand book, section 6: Shell): the header band holds the dark
// mark, the mosaic's name, its short knowledge hash and one search field; a view switcher offers
// Schema, Neighbourhood, Path, Chain and Overview, and a Card / Graph / Table switch for the
// current thing; a view that is not built yet shows as not available, and Path says it comes
// with M9; below 960px the side columns become tabs. Rendered on the server side of Svelte.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import App from "../src/App.svelte";
import { parseRoute, routeHash } from "../src/lib/route.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { THING_VIEWS, VIEWS, viewNamed } from "../src/lib/views.js";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import { reading } from "./fixtures.js";

/** The opening tag of the element of `html` that carries `marker` (an attribute or its value). */
function tagWith(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `no element with ${marker}`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

/** The value of `attribute` in the opening tag `tag`, or null. */
function attribute(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1]!.replaceAll("&amp;", "&") : null;
}

/** The text of the element with id `id`. */
function textOf(html: string, id: string): string {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html);
  expect(m, `no element with id ${id}`).not.toBeNull();
  return m![1]!;
}

async function opened(): Promise<Viewer> {
  const viewer = new Viewer();
  await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
  return viewer;
}

describe("the views the switcher offers", () => {
  it("are Schema, Neighbourhood, Path, Chain and Overview, then Card, Graph and Table", () => {
    expect(VIEWS.map((v) => v.label)).toEqual(["Schema", "Neighbourhood", "Path", "Chain", "Overview"]);
    expect(THING_VIEWS.map((v) => v.label)).toEqual(["Card", "Graph", "Table"]);
  });

  it("say when a view that is not available comes; Path comes with M9", () => {
    for (const v of [...VIEWS, ...THING_VIEWS]) {
      if (!v.available) expect(v.note, v.id).toMatch(/\S/);
    }
    const path = viewNamed("path")!;
    expect(path.available).toBe(false);
    expect(path.note).toContain("M9");
  });

  it("Card, Graph and Table, the ways the viewer shows a thing, are available", () => {
    expect(THING_VIEWS.filter((v) => v.available).map((v) => v.id)).toEqual(["card", "graph", "table"]);
  });
});

describe("the address names a view", () => {
  it("each view survives the round trip, beside a query, a node and a table", () => {
    for (const v of VIEWS) {
      const route = { query: "x", node: "Item:a", view: v.id };
      expect(parseRoute(routeHash(route))).toEqual(route);
      const table = { type: "Item", page: 2, order: null, where: [] };
      expect(parseRoute(routeHash({ query: "", node: null, table, view: v.id }))).toEqual({ query: "", node: null, table, view: v.id });
    }
  });

  it("a name that is no view is ignored, and no view leaves the address as it was", () => {
    expect(parseRoute("#v=nothing&node=Item%3Aa")).toEqual({ query: "", node: "Item:a" });
    expect(parseRoute("#v=")).toEqual({ query: "", node: null });
    expect(routeHash({ query: "", node: "Item:a", view: null })).toBe("#node=Item%3Aa");
  });
});

describe("the header band", () => {
  it("in an export of a cut, the band holds only these and where the cut comes from", async () => {
    const viewer = new Viewer();
    const hash = "1a2b3c4d5e6f" + "0".repeat(52);
    await viewer.open(buildMosaic({ nodes: [{ type: "Item", key: "a" }], sources: [{ id: "netflix", kind: "mosaic", hash }] }), "cut.mosaic");
    const cutHash = viewer.file!.header.knowledge_hash;
    const { body } = render(App, { props: { viewer, exported: true, cutHash } });
    const band = body.slice(body.indexOf("<header"), body.indexOf("</header>"));
    const texts = [...band.replace(/<form[\s\S]*<\/form>/, "<form></form>").matchAll(/>([^<>]+)</g)].map((m) => m[1]!.trim()).filter(Boolean);
    expect(texts).toEqual(["cut.mosaic", cutHash.slice(0, 12), "Read-only export", "from netflix 1a2b3c4d5e6f", "Open a mosaic"]);
    expect(band.match(/<form/g)).toHaveLength(1);
    expect(band.match(/type="search"/g)).toHaveLength(1);
  });

  it("the switcher sits below the band, not on it", async () => {
    const { body } = render(App, { props: { viewer: await opened() } });
    expect(body.indexOf('aria-label="Views"')).toBeGreaterThan(body.indexOf("</header>"));
  });
});

describe("the view switcher", () => {
  it("before a mosaic is open, is not shown", () => {
    const { body } = render(App, { props: { viewer: new Viewer() } });
    expect(body).not.toContain('aria-label="Views"');
  });
});

describe("the Card / Graph / Table switch", () => {
  it("on a thing's page, Card is current, Table opens its type's table and keeps the thing, Graph opens its neighbourhood", async () => {
    const viewer = await opened();
    await viewer.search("Item");
    await viewer.show("Item:a");
    const { body } = render(App, { props: { viewer } });
    const card = tagWith(body, 'data-thing="card"');
    expect(attribute(card, "aria-current")).toBe("page");
    const table = tagWith(body, 'data-thing="table"');
    const to = parseRoute(attribute(table, "href")!);
    expect(to.table?.type).toBe("Item");
    expect(to.node).toBe("Item:a");
    expect(to.query).toBe("Item");
    const graph = tagWith(body, 'data-thing="graph"');
    expect(graph.startsWith("<a")).toBe(true);
    const around = parseRoute(attribute(graph, "href")!);
    expect(around.view).toBe("neighbourhood");
    expect(around.node).toBe("Item:a");
    expect(around.query).toBe("Item");
  });

  it("on a table opened from a thing, Table is current and Card goes back to the thing's page", async () => {
    const viewer = await opened();
    await viewer.show("Item:a");
    await viewer.showTable({ type: "Item", page: 1, order: null, where: [] });
    const { body } = render(App, { props: { viewer } });
    expect(attribute(tagWith(body, 'data-thing="table"'), "aria-current")).toBe("page");
    const back = parseRoute(attribute(tagWith(body, 'data-thing="card"'), "href")!);
    expect(back).toEqual({ query: "", node: "Item:a" });
  });

  it("on a type's table with no thing, Table is current and Card is disabled", async () => {
    const viewer = await opened();
    await viewer.showTable({ type: "Item", page: 1, order: null, where: [] });
    const { body } = render(App, { props: { viewer } });
    expect(attribute(tagWith(body, 'data-thing="table"'), "aria-current")).toBe("page");
    expect(attribute(tagWith(body, 'data-thing="card"'), "aria-disabled")).toBe("true");
  });
});

describe("shell: further cases", () => {
  async function opened(name = "mosaic.mosaic"): Promise<Viewer> {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), name);
    return viewer;
  }

  function band(body: string): string {
    return body.slice(body.indexOf("<header"), body.indexOf("</header>"));
  }

  describe("the view names", () => {
    it("are unique, and each id is the lower-cased label", () => {
      const ids = [...VIEWS, ...THING_VIEWS].map((v) => v.id as string);
      expect(new Set(ids).size).toBe(ids.length);
      for (const v of [...VIEWS, ...THING_VIEWS]) expect(v.id).toBe(v.label.toLowerCase());
    });

    it("viewNamed finds each view and no name inherited from Object", () => {
      for (const v of VIEWS) expect(viewNamed(v.id)).toBe(v);
      for (const name of ["", " ", "Schema", "SCHEMA", "schema ", "constructor", "__proto__", "toString", "hasOwnProperty", "card", "table", "graph", "\0"]) {
        expect(viewNamed(name), JSON.stringify(name)).toBeUndefined();
      }
    });

    it("the Path note names M9, whose kit tool it waits for, and no other view claims M9", () => {
      expect(viewNamed("path")!.note).toContain("M9");
      for (const v of [...VIEWS, ...THING_VIEWS]) {
        if (v.id !== "path" && v.note) expect(v.note, v.id).not.toContain("M9");
      }
    });

    it("an available view needs no note about when it comes", () => {
      for (const v of [...VIEWS, ...THING_VIEWS]) {
        if (v.available) expect(v.note ?? "", v.id).not.toMatch(/comes with/i);
      }
    });
  });

  describe("the address and the view", () => {
    // The address names a view as v=<id> (viewer/src/lib/route.ts, documented header).
    it("a view without a leading # parses as with it", () => {
      expect(parseRoute("v=chain").view).toBe("chain");
      expect(parseRoute("#v=chain").view).toBe("chain");
    });

    it("names Object carries on its prototype are no view", () => {
      for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
        expect(parseRoute(`#v=${name}`).view, name).toBeUndefined();
      }
    });

    it("a view name in another case, or padded, is no view", () => {
      for (const name of ["Schema", "CHAIN", "%20chain", "chain%20", "chain%00"]) {
        expect(parseRoute(`#v=${name}`).view, name).toBeUndefined();
      }
    });

    it("a view beside a query with reserved characters and non-ASCII text round-trips", () => {
      const route = { query: "a&b=c#d é 日本 %", node: "Title:s1&v=schema", view: "overview" as const };
      expect(parseRoute(routeHash(route))).toEqual(route);
      expect(routeHash(route).match(/#/g)).toHaveLength(1);
    });

    it("with two v the view is one of them, never a crash", () => {
      const view = parseRoute("#v=chain&v=schema").view;
      expect(["chain", "schema"]).toContain(view);
      expect(parseRoute("#v=chain&v=nothing").view === "chain" || parseRoute("#v=chain&v=nothing").view === undefined).toBe(true);
    });

    it("an address with only unknown parameters is the empty route", () => {
      expect(parseRoute("#zzz=1&v=nope")).toEqual({ query: "", node: null });
      expect(parseRoute("")).toEqual({ query: "", node: null });
      expect(parseRoute("#")).toEqual({ query: "", node: null });
    });

    it("routeHash is deterministic: the same route twice gives the same address", () => {
      const route = { query: "x", node: "Item:a", view: "schema" as const };
      expect(routeHash(route)).toBe(routeHash({ ...route }));
    });

    it("a route with a view and no node has no node in the address", () => {
      expect(routeHash({ query: "", node: null, view: "chain" })).toBe("#v=chain");
    });
  });

  describe("the header band (brand book 6, Shell)", () => {
    it("shows the file name as text, not as markup", async () => {
      const viewer = await opened("<b>x</b>&\"'.mosaic");
      const html = band(render(App, { props: { viewer } }).body);
      expect(html).not.toContain("<b>x</b>");
      expect(html).toContain("&lt;b");
      expect(html).toContain("&amp;");
    });

    it("a long name does not add a second line of text to the band's content", async () => {
      const viewer = await opened("n".repeat(500) + ".mosaic");
      const html = band(render(App, { props: { viewer } }).body);
      expect(html).toContain("n".repeat(500) + ".mosaic");
      expect(html.match(/type="search"/g)).toHaveLength(1);
    });

    it("the short hash is a prefix of the knowledge hash, in lower-case hexadecimal, the same length every time", async () => {
      const a = await opened("one.mosaic");
      const b = await opened("two.mosaic");
      const hash = a.file!.header.knowledge_hash;
      const shown = (v: Viewer) => /<([^<>]*)>([0-9a-f]{6,40})</.exec(band(render(App, { props: { viewer: v } }).body))![2]!;
      expect(hash.startsWith(shown(a))).toBe(true);
      expect(shown(a)).toBe(shown(b));
      expect(shown(a).length).toBeLessThan(hash.length);
    });

    it("before a mosaic is open, there is no name, no hash and no 'Read-only export' unless exported", () => {
      const html = band(render(App, { props: { viewer: new Viewer() } }).body);
      expect(html).toContain("Open a mosaic");
      expect(html).not.toContain("Read-only export");
      expect(html).not.toMatch(/[0-9a-f]{12}/);
    });
  });

  describe("the switcher", () => {
    it("lists the views in the plan's order in the page", async () => {
      const { body } = render(App, { props: { viewer: await opened() } });
      const at = VIEWS.map((v) => body.indexOf(`data-view="${v.id}"`));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((x, y) => x - y)).toEqual(at);
    });

    it("an unavailable view's link is not a link: no href, no tab stop that activates it", async () => {
      const { body } = render(App, { props: { viewer: await opened() } });
      for (const v of VIEWS.filter((x) => !x.available)) {
        const at = body.indexOf(`data-view="${v.id}"`);
        const tag = body.slice(body.lastIndexOf("<", at), body.indexOf(">", at) + 1);
        expect(tag, v.id).not.toMatch(/\shref=/);
        expect(tag, v.id).not.toMatch(/\sonclick=/);
      }
    });

    it("at most one view of the whole mosaic is current at a time", async () => {
      const viewer = await opened();
      for (const id of [null, ...VIEWS.map((v) => v.id)]) {
        viewer.viewId = id as never;
        const { body } = render(App, { props: { viewer } });
        const start = body.indexOf('aria-label="Views"');
        const nav = body.slice(start, body.indexOf("</nav>", start));
        expect(nav.match(/aria-current="page"/g)?.length ?? 0, String(id)).toBeLessThanOrEqual(1);
      }
    });

    it("a viewId that names nothing does not crash the page", async () => {
      const viewer = await opened();
      viewer.viewId = "constructor" as never;
      expect(() => render(App, { props: { viewer } })).not.toThrow();
    });
  });

  describe("the columns (brand book 6, Shell)", () => {
    it("the same page rendered twice is the same markup", async () => {
      const viewer = await opened();
      await viewer.search("Item");
      await viewer.show("Item:a");
      const a = render(App, { props: { viewer, narrow: true } }).body;
      const b = render(App, { props: { viewer, narrow: true } }).body;
      expect(a).toBe(b);
    });
  });
});
