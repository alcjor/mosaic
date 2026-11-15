// The Neighbourhood view (needs G-3, G-4, G-7, G-11): the thing at the centre and its
// neighbours grouped by edge type and direction, each group labelled with its edge type and count;
// a group past the chosen limit shows that many and folds the rest into a bundle with its count;
// opening a bundle lists its things; the view says when it shows only part; below 960px the same
// contents come as a list. Rendered on the server from a neighbourhood loaded through the kit, as
// the page first draws it; the browser test drives it. Data is invented.
import { type SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import BundleList from "../src/components/BundleList.svelte";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
import { HoodLoader, hoodOf, openBundle, type Limit, LIMITS } from "../src/lib/graph/hood.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, parseView, Shape, type ViewSettings } from "../src/lib/view.js";
import { groupText, partNotes, placeThingNames, THING_COLUMNS } from "../src/lib/graph/hoodview.js";

const pad = (i: number) => String(i).padStart(2, "0");

/** A hub with 25 items pointing at it, 3 tags it carries, and a link to itself. */
function spec(): MosaicSpec {
  const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
  return {
    typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [
      ["points_at", "Item", "Hub"],
      ["carries", "Hub", "Tag"],
      ["next", "Hub", "Hub"],
    ],
    nodes: [
      { type: "Hub", key: "h", label: "The hub" },
      ...items.map((k) => ({ type: "Item", key: k, label: `Item ${k}` })),
      ...["t0", "t1", "t2"].map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` })),
    ],
    edges: [
      ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
      ...["t0", "t1", "t2"].map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
      { type: "next", from: "Hub:h", to: "Hub:h" },
    ],
  };
}

const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });

async function open(): Promise<SealedFile> {
  return openMosaic(buildMosaic(spec()), "hub.mosaic");
}

async function drawn(limit: Limit = 5, view: ViewSettings = DEFAULT_VIEW, centre: string | null = "Hub:h") {
  const file = await open();
  const initial = centre === null ? undefined : await new HoodLoader(file).load(hoodOf(centre, limit));
  const { body } = render(NeighbourhoodView, { props: { file, shape: new Shape(view, file), centre, hrefFor, tableHref, initial } });
  return body;
}

/** What a reader sees: the text without tags, spaces collapsed. */
const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

describe("the Neighbourhood view and the Graph switch (G-3)", () => {

  it("ask for a thing when none is open", async () => {
    expect(await drawn(5, DEFAULT_VIEW, null)).toContain("Search for a thing to explore it");
  });

  it("draw the thing at the centre", async () => {
    const html = await drawn();
    expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
    expect(attr(html, "aria-label")).toContain("The hub (Hub), at the centre");
  });

  it("draw every group, by edge type and direction, labelled with its edge type and count", async () => {
    const html = await drawn();
    expect(attr(html, "data-group")).toEqual(["carries out", "next out", "next in", "points_at in"]);
    for (const text of ["carries · 3", "next · 1", "← next · 1", "← points_at · 25"]) expect(html).toContain(text);
  });

  it("draw each neighbour shown, once, as a link from where it hangs", async () => {
    const html = await drawn();
    const things = attr(html, "data-thing");
    expect(things).toEqual(expect.arrayContaining(["Tag:t0", "Tag:t1", "Tag:t2", "Item:i00", "Item:i04"]));
    expect(new Set(things).size).toBe(things.length);
    expect(things).not.toContain("Item:i05");
  });
});

describe("limits and bundles (G-4)", () => {
  it("shows as many neighbours of a group as the limit, and folds the rest into a bundle with its count", async () => {
    for (const [limit, more] of [
      [3, 22],
      [5, 20],
      [10, 15],
      [20, 5],
    ] as const) {
      const html = await drawn(limit);
      expect(attr(html, "data-thing").filter((id) => id.startsWith("Item:"))).toHaveLength(limit);
      expect(attr(html, "data-bundle")).toEqual(["points_at in"]);
      expect(attr(html, "data-more")).toEqual([String(more)]);
      expect(html).toContain(`${more} more links<`);
      expect(html).toContain(`+${more}`);
      expect(attr(html, "aria-label")).toContain(`← points_at: ${more} more links, not drawn. Open the bundle to list them`);
    }
  });

  it("offers the limits 3, 5, 10 and 20, the one in use pressed", async () => {
    const html = await drawn(10);
    const limits = [...html.matchAll(/data-limit="(\d+)"[^>]*aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]);
    expect(limits).toEqual([
      ["3", "false"],
      ["5", "false"],
      ["10", "true"],
      ["20", "false"],
    ]);
  });
});

describe("a bundle opened (G-4)", () => {
  async function bundle() {
    const file = await open();
    const owner = { id: "Hub:h", label: "The hub", type: "Hub" };
    const opened = await openBundle(file, owner, "points_at", "in");
    return render(BundleList, { props: { bundle: opened, name: "points_at", hrefFor, tableHref } }).body;
  }

  it("lists its things, each a link to its page, and says how many of the total", async () => {
    const html = await bundle();
    const links = attr(html, "href").filter((h) => h.startsWith("#node="));
    expect(links).toHaveLength(20);
    expect(links[0]).toBe(hrefFor("Item:i00"));
    expect(text(html)).toContain("20 of 25 links");
  });

  it("opens the rest as a table, saying it finds them by the thing's name", async () => {
    const html = await bundle();
    expect(html).toContain("Open the rest as a table");
    expect(attr(html, "href")).toContain(tableHref({ type: "Item", page: 1, order: null, where: [{ column: "points_at", op: "contains", value: "The hub" }] }).replaceAll("&", "&amp;"));
    expect(html).toContain("by its name");
  });
});

describe("a bundle of links leaving the thing (G-4)", () => {
  it("lists its first 20 with their pages, then every one by name, once each", async () => {
    const tags = Array.from({ length: 24 }, (_, i) => `t${pad(i)}`);
    const file = await openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...tags.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
        edges: tags.map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
      }),
      "carries.mosaic",
    );
    const opened = await openBundle(file, { id: "Hub:h", label: "The hub", type: "Hub" }, "carries", "out");
    const html = render(BundleList, { props: { bundle: opened, name: "carries", hrefFor, tableHref } }).body;
    expect(attr(html, "href").filter((h) => h.startsWith("#node="))).toHaveLength(20);
    expect(text(html)).toContain("20 of 24 links");
    expect(html).toContain("Every one by name (24;");
    const names = [...html.matchAll(/class="each[^"]*">([^<]*)</g)].map((m) => m[1]);
    expect(names).toHaveLength(24);
    expect(new Set(names).size).toBe(24);
    expect(names).toContain("Tag t23");
    expect(html).not.toContain("Open the rest as a table");
  });
});

describe("two links of one edge type to one thing (G-3, G-4, G-11)", () => {
  /** Hub:h carries Tag:a three times (three qualifiers) and Tag:b once. */
  async function parallel() {
    return openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [
          { type: "Hub", key: "h", label: "The hub" },
          { type: "Tag", key: "a", label: "A" },
          { type: "Tag", key: "b", label: "B" },
        ],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:a", qualifier: "1" },
          { type: "carries", from: "Hub:h", to: "Tag:a", qualifier: "2" },
          { type: "carries", from: "Hub:h", to: "Tag:a", qualifier: "3" },
          { type: "carries", from: "Hub:h", to: "Tag:b" },
        ],
      }),
      "parallel.mosaic",
    );
  }

  it("count as links, and show the thing once in the picture and in the list", async () => {
    const file = await parallel();
    const initial = await new HoodLoader(file).load(hoodOf("Hub:h", 3));
    const html = render(NeighbourhoodView, { props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: "Hub:h", hrefFor, tableHref, initial } }).body;
    expect(html).toContain("carries · 4");
    expect(attr(html, "data-thing")).toEqual(["Tag:a"]);
    const list = html.slice(html.indexOf('class="list'));
    expect(attr(list, "href").filter((h) => h === hrefFor("Tag:a"))).toHaveLength(1);
    expect(list).toContain("+1 more link<");
    expect(attr(html, "aria-label")).toContain("carries: 1 more link, not drawn. Open the bundle to list it");
  });
});

describe("as a list, for narrow screens (G-11)", () => {
  it("gives the centre, each group with its count, its neighbours as links and its bundle", async () => {
    const html = await drawn();
    const list = html.slice(html.indexOf('class="list'));
    for (const text of ["The hub", "carries · 3", "← points_at · 25", "Tag t0", "Item i00"]) expect(list).toContain(text);
    expect(list).toContain(`href="${hrefFor("Tag:t0")}"`);
    expect(list).toContain("+20 more links");
  });
});

describe("names from the view file", () => {
  it("uses the type's label and the edge types' names", async () => {
    const view = parseView({
      search: "semantic",
      theme: "auto",
      types: [{ name: "Hub", label: "Hub place", columns: null, page: null, names: { carries: "Carries" }, describe: null }],
      edges: null,
      export: { types: null },
    });
    const html = await drawn(5, view);
    expect(attr(html, "aria-label")).toContain("The hub (Hub place), at the centre");
    expect(html).toContain("Carries · 3");
  });
});

describe("the same picture every time (G-7)", () => {
  it("draws the same markup for the same thing and limit", async () => {
    expect(await drawn()).toBe(await drawn());
  });
});

describe("neighbourhood view: further cases", () => {
  const pad = (i: number, n = 2) => String(i).padStart(n, "0");
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const TABLE = "#a-table-link";
  const tableHref = (_: TableRoute) => TABLE;

  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

  async function draw(spec: MosaicSpec, centre: string, limit: Limit = 5, view: ViewSettings = DEFAULT_VIEW): Promise<string> {
    const file = await openMosaic(buildMosaic(spec), "edge.mosaic");
    const initial = await new HoodLoader(file).load(hoodOf(centre, limit));
    return render(NeighbourhoodView, { props: { file, shape: new Shape(view, file), centre, hrefFor, tableHref, initial } }).body;
  }

  /** A hub with `n` tags it carries (edges leaving it). */
  function carrying(n: number, hubLabel: string | null = "The hub"): MosaicSpec {
    const keys = Array.from({ length: n }, (_, i) => `t${pad(i, 3)}`);
    return {
      typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [["carries", "Hub", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: hubLabel }, ...keys.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges: keys.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
    };
  }

  describe("a thing with no links (G-3)", () => {
    it("draws the centre alone, with no group, no bundle and no claim of showing only part", async () => {
      const html = await draw({ typeProps: { Hub: '{"name":"text"}' }, nodes: [{ type: "Hub", key: "h", label: "Lonely" }] }, "Hub:h");
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
      expect(attr(html, "data-group")).toEqual([]);
      expect(attr(html, "data-thing")).toEqual([]);
      expect(attr(html, "data-bundle")).toEqual([]);
      expect(html).not.toContain("shows only part");
      expect(html).not.toContain("show only part");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    });
  });

  describe("a link from a thing to itself (G-3)", () => {
    const loop: MosaicSpec = {
      typeProps: { Hub: '{"name":"text"}' },
      edgeTypes: [["next", "Hub", "Hub"]],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }],
      edges: [{ type: "next", from: "Hub:h", to: "Hub:h" }],
    };

    it("is a group in each direction, and the centre is not drawn a second time as its own neighbour", async () => {
      const html = await draw(loop, "Hub:h");
      expect(attr(html, "data-group")).toEqual(["next out", "next in"]);
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
      expect(attr(html, "data-thing")).not.toContain("Hub:h");
      expect(html).toContain("next · 1");
      expect(html).toContain("← next · 1");
    });
  });

  describe("a group exactly at the limit, and one past it (G-4)", () => {
    for (const limit of LIMITS) {
      it(`of ${limit} links draws all ${limit} and folds nothing (limit ${limit})`, async () => {
        const html = await draw(carrying(limit), "Hub:h", limit);
        expect(attr(html, "data-thing")).toHaveLength(limit);
        expect(attr(html, "data-bundle")).toEqual([]);
        expect(html).not.toContain("only part");
      });

      it(`of ${limit + 1} links draws ${limit} and folds exactly one into a bundle (limit ${limit})`, async () => {
        const html = await draw(carrying(limit + 1), "Hub:h", limit);
        expect(attr(html, "data-thing")).toHaveLength(limit);
        expect(attr(html, "data-bundle")).toEqual(["carries out"]);
        expect(attr(html, "data-more")).toEqual(["1"]);
        expect(html).toContain(`carries · ${limit + 1}`);
        expect(html).toContain("shows only part of its things");
      });
    }

    it("of 1,500 links still draws only the limit, and writes the count with its comma (G-10)", async () => {
      const html = await draw(carrying(1500), "Hub:h", 3);
      expect(attr(html, "data-thing")).toHaveLength(3);
      expect(attr(html, "data-more")).toEqual(["1497"]);
      expect(html).toContain("carries · 1,500");
      expect(html).toContain("1,497 more");
    });

    it("does not let one busy group hide another small group's whole contents", async () => {
      const spec = carrying(30);
      spec.typeProps!.Mark = '{"name":"text"}';
      spec.edgeTypes!.push(["marks", "Hub", "Mark"]);
      spec.nodes.push({ type: "Mark", key: "m", label: "Mark" });
      spec.edges!.push({ type: "marks", from: "Hub:h", to: "Mark:m" });
      const html = await draw(spec, "Hub:h", 3);
      expect(attr(html, "data-thing")).toContain("Mark:m");
      expect(attr(html, "data-bundle")).toEqual(["carries out"]);
    });
  });

  describe("several groups reaching one thing (G-3)", () => {
    function twoWays(): MosaicSpec {
      return {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [
          ["carries", "Hub", "Tag"],
          ["marks", "Tag", "Hub"],
        ],
        nodes: [
          { type: "Hub", key: "h", label: "The hub" },
          { type: "Tag", key: "t", label: "The tag" },
        ],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:t" },
          { type: "marks", from: "Tag:t", to: "Hub:h" },
        ],
      };
    }

    it("draws a neighbour in two groups once, and keeps both groups", async () => {
      const html = await draw(twoWays(), "Hub:h");
      expect(attr(html, "data-group")).toEqual(["carries out", "marks in"]);
      expect(attr(html, "data-thing")).toEqual(["Tag:t"]);
    });

    it("draws two links of one type to one thing (different qualifiers) as one shard in a group of 2", async () => {
      const spec = carrying(1);
      spec.edges!.push({ type: "carries", from: "Hub:h", to: "Tag:t000", qualifier: "again" });
      const html = await draw(spec, "Hub:h");
      expect(attr(html, "data-thing")).toEqual(["Tag:t000"]);
      expect(html).toContain("carries · 2");
      expect(attr(html, "data-bundle")).toEqual([]);
    });
  });

  describe("names that hold markup (G-3: names come from the mosaic and the view file)", () => {
    const nasty = '"><script>alert(1)</script>';

    it("never lets a label write into the page, in the picture, the list or an attribute", async () => {
      const spec = carrying(2, nasty);
      spec.nodes[1]!.label = `<img src=x onerror=alert(1)> & "quoted"`;
      const html = await draw(spec, "Hub:h");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      // Every aria-label is still one whole attribute: the quote in the label did not end it.
      expect(attr(html, "aria-label").some((a) => a.includes("&quot;"))).toBe(true);
      expect(html).not.toMatch(/aria-label="[^"]*"><script/);
    });

    it("never lets an edge type's name from the view file write into the page", async () => {
      const view = parseView({
        search: "semantic",
        theme: "auto",
        types: [{ name: "Hub", label: '"><svg onload=1>', columns: null, page: null, names: { carries: '"><b onclick=1>' }, describe: null }],
        edges: null,
        export: { types: null },
      });
      const html = await draw(carrying(2), "Hub:h", 5, view);
      expect(html).not.toContain("<svg onload");
      expect(html).not.toContain("<b onclick");
      expect(html).not.toContain('"><b');
    });
  });

  describe("labels missing, shared or long (G-3)", () => {
    it("names a neighbour with no label by its id, never as null or undefined", async () => {
      const spec = carrying(2);
      spec.nodes[1]!.label = null;
      const html = await draw(spec, "Hub:h");
      expect(html).not.toContain("null");
      expect(html).not.toContain("undefined");
      expect(html).toContain("Tag:t000");
    });

    it("draws a centre with no label, naming it by its id", async () => {
      const html = await draw(carrying(1, null), "Hub:h");
      expect(html).not.toContain("null");
      expect(html).not.toContain("undefined");
      expect(attr(html, "aria-label").some((a) => a.includes("Hub:h") && a.includes("at the centre"))).toBe(true);
    });

    it("draws two neighbours that share a label as two things, each its own link", async () => {
      const spec = carrying(2);
      spec.nodes[1]!.label = "Same";
      spec.nodes[2]!.label = "Same";
      const html = await draw(spec, "Hub:h");
      expect(attr(html, "data-thing")).toEqual(["Tag:t000", "Tag:t001"]);
      const list = html.slice(html.indexOf('class="list'));
      expect(list).toContain(`href="${hrefFor("Tag:t000")}"`);
      expect(list).toContain(`href="${hrefFor("Tag:t001")}"`);
    });

    it("draws a centre whose label is longer than the kit's 120 characters", async () => {
      const html = await draw(carrying(1, "L".repeat(400)), "Hub:h");
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
      expect(html).not.toContain("L".repeat(401));
    });
  });

  describe("a thing's name beside its shard, cut at the set columns (G-3)", () => {
    const one = (text: string) => placeThingNames([{ x: 0, y: 0, r: 12, text }], [])[0];

    it("keeps a name of exactly the set columns whole, and cuts one a column longer", () => {
      expect(one("x".repeat(THING_COLUMNS))!.text).toBe("x".repeat(THING_COLUMNS));
      expect(one("x".repeat(THING_COLUMNS + 1))!.text).toBe(`${"x".repeat(THING_COLUMNS - 1)}…`);
    });

    it("never cuts a character in two: a name of astral characters stays well formed", () => {
      for (const n of [THING_COLUMNS - 1, THING_COLUMNS, THING_COLUMNS + 1, 80]) {
        const text = "\u{1F600}".repeat(n);
        expect(one(text)!.text.isWellFormed()).toBe(true);
      }
    });

    it("copes with an empty name", () => {
      const placed = one("");
      expect(placed === null || typeof placed.text === "string").toBe(true);
    });
  });

  describe("order by UTF-8 bytes, not UTF-16 (G-7)", () => {
    it("draws neighbours with non-ASCII keys in the kit's byte order", async () => {
      // UTF-8: "z" < "é" (C3 A9) < FULLWIDTH A (EF BC A1) < MATHEMATICAL A (F0 9D 92 9C).
      // UTF-16 would put the astral one before the fullwidth one.
      const keys = ["\u{1D49C}", "Ａ", "é", "z"];
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [{ type: "Hub", key: "h", label: "Hub" }, ...keys.map((k) => ({ type: "Tag", key: k, label: `T ${k}` }))],
        edges: keys.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
      };
      const html = await draw(spec, "Hub:h", 10);
      expect(attr(html, "data-thing")).toEqual(["z", "é", "Ａ", "\u{1D49C}"].map((k) => `Tag:${k}`));
    });
  });

  describe("the same picture every time (G-7)", () => {
    it("is the same markup from a fresh file and a fresh loader, whatever order the data was given in", async () => {
      const spec = carrying(12);
      const shuffled: MosaicSpec = { ...spec, nodes: [...spec.nodes].reverse(), edges: [...spec.edges!].reverse() };
      for (const limit of LIMITS) {
        expect(await draw(shuffled, "Hub:h", limit)).toBe(await draw(spec, "Hub:h", limit));
      }
    });

    it("draws different pictures for different limits only where the group is past the limit", async () => {
      const small = carrying(3);
      expect(attr(await draw(small, "Hub:h", 3), "data-thing")).toEqual(attr(await draw(small, "Hub:h", 20), "data-thing"));
    });
  });

  describe("words that count (G-3)", () => {
    it("write one link as a link and one kind as a kind", async () => {
      const html = await draw(carrying(1), "Hub:h");
      expect(html).not.toMatch(/\b1 links\b/);
      expect(html).not.toMatch(/\b1 kinds\b/);
    });

    it("write a count of nothing and a thousand in a group's name", () => {
      expect(groupText("e", "out", 0)).toBe("e · 0");
      expect(groupText("e", "in", 999)).toBe("← e · 999");
      expect(groupText("e", "in", 1000)).toBe("← e · 1,000");
      expect(groupText("e", "out", 1234567)).toBe("e · 1,234,567");
    });

    it("say one kind of link not shown in the singular", () => {
      const centre = { id: "A:c", label: "Centre", type: "A" };
      const hood = { centre: { centre, groups: [], unlisted: 1 }, expanded: [], failed: [] };
      const notes = partNotes(hood, { things: [], groups: [], links: [] });
      expect(notes).toHaveLength(1);
      expect(notes[0]).not.toContain("1 more kinds");
    });

    it("say nothing when there is nothing to say", () => {
      const centre = { id: "A:c", label: "Centre", type: "A" };
      const hood = { centre: { centre, groups: [], unlisted: 0 }, expanded: [], failed: [] };
      expect(partNotes(hood, { things: [], groups: [], links: [] })).toEqual([]);
    });
  });

  describe("as a list, for narrow screens (G-11)", () => {
    it("gives every bundle its own entry with its own count, as the picture does", async () => {
      const spec = carrying(9);
      spec.typeProps!.Mark = '{"name":"text"}';
      spec.edgeTypes!.push(["marks", "Mark", "Hub"]);
      for (let i = 0; i < 7; i++) {
        spec.nodes.push({ type: "Mark", key: `m${i}`, label: `Mark ${i}` });
        spec.edges!.push({ type: "marks", from: `Mark:m${i}`, to: "Hub:h" });
      }
      const html = await draw(spec, "Hub:h", 3);
      expect(attr(html, "data-more").sort()).toEqual(["4", "6"]);
      const list = html.slice(html.indexOf('class="list'));
      expect(list).toContain("+6 more");
      expect(list).toContain("+4 more");
    });

    it("has no bundle entry when no group is past the limit", async () => {
      const html = await draw(carrying(3), "Hub:h", 3);
      const list = html.slice(html.indexOf('class="list'));
      expect(list).not.toMatch(/\+\d+ more/);
    });

    it("lists exactly the neighbours the picture draws, in the same order", async () => {
      const html = await draw(carrying(9), "Hub:h", 5);
      const drawn = attr(html, "data-thing");
      const list = html.slice(html.indexOf('class="list'));
      const links = attr(list, "href").filter((h) => h.startsWith("#node=")).map((h) => decodeURIComponent(h.slice("#node=".length)));
      expect(links).toEqual(drawn);
    });
  });

  describe("a bundle opened (G-4)", () => {
    async function opened(spec: MosaicSpec, edge: string, direction: "out" | "in", ownerId = "Hub:h", label: string | null = "The hub") {
      const file = await openMosaic(buildMosaic(spec), "bundle.mosaic");
      const bundle = await openBundle(file, { id: ownerId, label, type: "Hub" }, edge, direction);
      return render(BundleList, { props: { bundle, name: edge, hrefFor, tableHref } }).body;
    }

    it("of 8 things lists the 8, each a link to its page, and offers no table for the rest", async () => {
      const html = await opened(carrying(8), "carries", "out");
      expect(attr(html, "href").filter((h) => h.startsWith("#node="))).toHaveLength(8);
      expect(html).not.toContain(TABLE);
    });

    it("of exactly 20 things lists 20 and offers no table for a rest that is empty", async () => {
      const html = await opened(carrying(20), "carries", "out");
      expect(attr(html, "href").filter((h) => h.startsWith("#node="))).toHaveLength(20);
      expect(html).not.toContain(TABLE);
    });

    it("of 21 links reaching a thing lists 20, says there are 21 and offers the table", async () => {
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}' },
        edgeTypes: [["points_at", "Item", "Hub"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...Array.from({ length: 21 }, (_, i) => ({ type: "Item", key: `i${pad(i)}`, label: `Item ${i}` }))],
        edges: Array.from({ length: 21 }, (_, i) => ({ type: "points_at", from: `Item:i${pad(i)}`, to: "Hub:h" })),
      };
      const html = await opened(spec, "points_at", "in");
      expect(attr(html, "href").filter((h) => h.startsWith("#node="))).toHaveLength(20);
      expect(html).toContain("20 of 21");
      expect(html).toContain(TABLE);
    });

    it("of links reaching a thing with no name offers no table that would match every row, and says so", async () => {
      const items = Array.from({ length: 22 }, (_, i) => `i${pad(i)}`);
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}' },
        edgeTypes: [["points_at", "Item", "Hub"]],
        nodes: [{ type: "Hub", key: "h", label: "" }, ...items.map((k) => ({ type: "Item", key: k, label: k }))],
        edges: items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
      };
      const html = await opened(spec, "points_at", "in", "Hub:h", "");
      expect(html).not.toContain(TABLE);
      expect(attr(html, "href").filter((h) => h.startsWith("#node="))).toHaveLength(20);
      expect(html).toContain("20 of 22");
      expect(html).not.toContain("undefined");
    });

    it("writes nothing from a label into the page as markup", async () => {
      const spec = carrying(3, "<script>alert(1)</script>");
      spec.nodes[1]!.label = '<img src=x onerror=1>"';
      const html = await opened(spec, "carries", "out", "Hub:h", "<script>alert(1)</script>");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
    });

    it("names a thing with no label by its id", async () => {
      const spec = carrying(3);
      spec.nodes[1]!.label = null;
      const html = await opened(spec, "carries", "out");
      expect(html).not.toContain("null");
      expect(html).not.toContain("undefined");
      expect(html).toContain("Tag:t000");
    });

    it("lists the same things in the same order every time (G-7)", async () => {
      const a = await opened(carrying(25), "carries", "out");
      const b = await opened(carrying(25), "carries", "out");
      expect(a).toBe(b);
    });
  });
});

describe("neighbourhood view: further cases", () => {
  const pad = (i: number, n = 2) => String(i).padStart(n, "0");
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const TABLE = "#a-table-link";
  const tableHref = (_: TableRoute) => TABLE;
  /** What a reader sees: the text without tags, spaces collapsed. */
  const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
  const nodeLinks = (html: string) => attr(html, "href").filter((h) => h.startsWith("#node=")).map((h) => decodeURIComponent(h.slice("#node=".length)));
  const listOf = (html: string) => html.slice(html.indexOf('class="list'));

  async function draw(spec: MosaicSpec, centre: string, limit: Limit = 5, view: ViewSettings = DEFAULT_VIEW): Promise<string> {
    const file = await openMosaic(buildMosaic(spec), "cases.mosaic");
    const initial = await new HoodLoader(file).load(hoodOf(centre, limit));
    return render(NeighbourhoodView, { props: { file, shape: new Shape(view, file), centre, hrefFor, tableHref, initial } }).body;
  }

  async function opened(spec: MosaicSpec, edge: string, direction: "out" | "in", ownerId = "Hub:h", label: string | null = "The hub") {
    const file = await openMosaic(buildMosaic(spec), "cases.mosaic");
    const bundle = await openBundle(file, { id: ownerId, label, type: "Hub" }, edge, direction);
    return render(BundleList, { props: { bundle, name: edge, hrefFor, tableHref } }).body;
  }

  /** A hub carrying `n` tags (edges leaving it), one link each. */
  function carrying(n: number, hubLabel: string | null = "The hub"): MosaicSpec {
    const keys = Array.from({ length: n }, (_, i) => `t${pad(i, 4)}`);
    return {
      typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [["carries", "Hub", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: hubLabel }, ...keys.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges: keys.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
    };
  }

  /** The hub carries each named tag with `per` links (one per qualifier). */
  function parallel(tags: Record<string, number>, edge = "carries"): MosaicSpec {
    const keys = Object.keys(tags);
    return {
      typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [[edge, "Hub", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...keys.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges: keys.flatMap((k) => Array.from({ length: tags[k]! }, (_, q) => ({ type: edge, from: "Hub:h", to: `Tag:${k}`, qualifier: pad(q, 3) }))),
    };
  }

  /** Tags that point at the hub, with `per` links each (the group reaches the hub). */
  function reaching(tags: Record<string, number>): MosaicSpec {
    const keys = Object.keys(tags);
    return {
      typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [["points_at", "Tag", "Hub"]],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...keys.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges: keys.flatMap((k) => Array.from({ length: tags[k]! }, (_, q) => ({ type: "points_at", from: `Tag:${k}`, to: "Hub:h", qualifier: pad(q, 3) }))),
    };
  }

  describe("counts of a bundle say links, one in the singular and a thousand with its comma (G-4)", () => {
    it("writes '1,497 more links' in all three places for a group of 1,500", async () => {
      const html = await draw(carrying(1500), "Hub:h", 3);
      expect(html).toContain("1,497 more links<");
      expect(html).toContain("+1,497 more links<");
      expect(attr(html, "aria-label").some((a) => a.startsWith("carries: 1,497 more links,"))).toBe(true);
      expect(text(html) + " " + attr(html, "aria-label").join(" ")).not.toMatch(/(?<![,\d])1497\b/);
    });

    it("writes an opened bundle's total as '1 of 1 link' for one link, and 'links' for two", async () => {
      const one = text(await opened(reaching({ a: 1 }), "points_at", "in"));
      expect(one).toContain("1 of 1 link");
      expect(one).not.toMatch(/\b1 of 1 links\b/);
      const two = text(await opened(reaching({ a: 1, b: 1 }), "points_at", "in"));
      expect(two).toContain("2 of 2 links");
    });

    it("writes an opened bundle's total with the comma: '20 of 1,500 links'", async () => {
      const html = text(await opened(carrying(1500), "carries", "out"));
      expect(html).toContain("20 of 1,500 links");
    });
  });

  describe("a thing reached by several links of one group is listed once (G-3, G-4, G-11)", () => {
    it("opens a bundle of 27 links to 3 things as those 3 things, each once, in id order, with the count of links", async () => {
      const html = await opened(parallel({ a: 9, b: 9, c: 9 }), "carries", "out");
      expect(nodeLinks(html)).toEqual(["Tag:a", "Tag:b", "Tag:c"]);
      expect(text(html)).toContain("20 of 27 links");
      expect(text(html)).toMatch(/The first 20 links lead to these 3 things/);
    });

    it("offers the rest as a table when links reaching the thing are past the 20 listed, though they lead to 3 things", async () => {
      const html = await opened(reaching({ a: 9, b: 9, c: 4 }), "points_at", "in");
      expect(nodeLinks(html)).toEqual(["Tag:a", "Tag:b", "Tag:c"]);
      expect(text(html)).toContain("20 of 22 links");
      expect(html).toContain(TABLE);
    });

    it("offers no table when exactly 20 links reach the thing, all listed, though they lead to 3 things", async () => {
      const html = await opened(reaching({ a: 9, b: 9, c: 2 }), "points_at", "in");
      expect(nodeLinks(html)).toEqual(["Tag:a", "Tag:b", "Tag:c"]);
      expect(text(html)).toContain("20 of 20 links");
      expect(html).not.toContain(TABLE);
    });

    it("writes 'one thing' correctly when every link leads to the same single thing", async () => {
      const html = text(await opened(parallel({ a: 3 }), "carries", "out"));
      expect(html).toContain("3 of 3 links");
      expect(html).not.toMatch(/\b1 things\b/);
      expect(html).not.toMatch(/\b(these|those) 1\b/);
      expect(html).not.toMatch(/\b1 links\b/);
    });

    it("draws a group of 5 links to 2 things at limit 3 as a bundle of 2 more links, and opens it to both things once", async () => {
      const spec = parallel({ a: 3, b: 2 });
      const html = await draw(spec, "Hub:h", 3);
      expect(attr(html, "data-more")).toEqual(["2"]);
      expect(html).toContain("carries · 5");
      const drawn = attr(html, "data-thing");
      expect(new Set(drawn).size).toBe(drawn.length);
      expect(drawn.length).toBeGreaterThan(0);
      expect(drawn.length).toBeLessThanOrEqual(3);
      expect(nodeLinks(await opened(spec, "carries", "out"))).toEqual(["Tag:a", "Tag:b"]);
    });

    it("keeps the once-per-group rule per group: a thing in two groups is listed under each, once each", async () => {
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"], ["marks", "Tag", "Hub"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "a", label: "A" }],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:a", qualifier: "1" },
          { type: "carries", from: "Hub:h", to: "Tag:a", qualifier: "2" },
          { type: "marks", from: "Tag:a", to: "Hub:h" },
        ],
      };
      const html = await draw(spec, "Hub:h", 5);
      expect(attr(html, "data-thing")).toEqual(["Tag:a"]);
      expect(nodeLinks(listOf(html))).toEqual(["Tag:a", "Tag:a"]);
    });

    it("lists each thing of an opened bundle once whatever order the links were given in (G-7)", async () => {
      const spec = parallel({ a: 4, b: 4, c: 4 });
      const reversed: MosaicSpec = { ...spec, nodes: [...spec.nodes].reverse(), edges: [...spec.edges!].reverse() };
      const a = await opened(spec, "carries", "out");
      expect(await opened(reversed, "carries", "out")).toBe(a);
      expect(await draw(reversed, "Hub:h", 3)).toBe(await draw(spec, "Hub:h", 3));
    });
  });

  describe("the line above the picture (G-3, G-10)", () => {
    const intro = (html: string) => text(html.match(/<p class="intro[^>]*>[^<]*/)?.[0] ?? "");

    function kinds(n: number, doubleFirst: boolean): MosaicSpec {
      const names = Array.from({ length: n }, (_, i) => `e${pad(i)}`);
      return {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: names.map((e) => [e, "Hub", "Tag"] as [string, string, string]),
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "t", label: "The tag" }],
        edges: [
          ...names.map((e) => ({ type: e, from: "Hub:h", to: "Tag:t" })),
          ...(doubleFirst ? [{ type: names[0]!, from: "Hub:h", to: "Tag:t", qualifier: "again" }] : []),
        ],
      };
    }

    it("writes a thousand links with its comma", async () => {
      expect(intro(await draw(carrying(1500), "Hub:h", 3))).toBe("The hub: 1 kind of link, 1,500 links");
    });

    it("counts every kind and the links of the listed ones when the thing has 22 kinds", async () => {
      const html = await draw(kinds(22, true), "Hub:h");
      const groups = [...html.matchAll(/data-group="[^"]*"[^>]*>.*?<text[^>]*>[^<]*· (\d+)</g)].map((m) => Number(m[1]));
      expect(groups).toHaveLength(20);
      const sum = groups.reduce((a, b) => a + b, 0);
      expect(intro(html)).toContain("The hub: 22 kinds of link;");
      expect(intro(html)).toContain(`${sum} links in the 20`);
      expect(intro(html)).not.toMatch(/\b22 links\b/);
    });

    it("does not talk of the kit's listing when the thing has exactly 20 kinds", async () => {
      const html = await draw(kinds(20, false), "Hub:h");
      expect(intro(html)).toBe("The hub: 20 kinds of link, 20 links");
    });

    it("names a centre with no label by its id", async () => {
      expect(intro(await draw(carrying(1, null), "Hub:h"))).toBe("Hub:h: 1 kind of link, 1 link");
    });

    it("never lets a label write into the page through the line", async () => {
      const html = await draw(carrying(1, "<b onclick=1>x</b>"), "Hub:h");
      expect(html).not.toContain("<b onclick");
    });
  });

  describe("accessible names (G-11)", () => {
    it("name every neighbour by its label, its type and its group's text", async () => {
      const html = await draw(carrying(3), "Hub:h");
      const names = attr(html, "aria-label");
      for (const k of ["t0000", "t0001", "t0002"]) expect(names).toContain(`Tag ${k} (Tag), in carries · 3`);
    });

    it("name a neighbour reached by a group in each direction by both groups, as the picture draws both", async () => {
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"], ["marks", "Tag", "Hub"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "t", label: "The tag" }],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:t" },
          { type: "marks", from: "Tag:t", to: "Hub:h" },
        ],
      };
      const html = await draw(spec, "Hub:h");
      const mine = attr(html, "aria-label").filter((a) => a.startsWith("The tag"));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toContain("carries · 1");
      expect(mine[0]).toContain("marks · 1");
    });

    it("never leaves 'undefined', 'null' or 'NaN' in any name", async () => {
      const spec = carrying(4, null);
      spec.nodes[1]!.label = null;
      const html = await draw(spec, "Hub:h", 3);
      for (const a of attr(html, "aria-label")) expect(a).not.toMatch(/undefined|null|NaN/);
    });
  });

  describe("edge type names from the view file (G-3)", () => {
    const view = parseView({
      search: "semantic",
      theme: "auto",
      types: [{ name: "Hub", label: null, columns: null, page: null, names: { carries: "holds", marks: "is marked by" }, describe: null }],
      edges: null,
      export: { types: null },
    });
    const spec: MosaicSpec = {
      typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [["carries", "Hub", "Tag"], ["marks", "Tag", "Hub"]],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...["a", "b", "c", "d", "e"].map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges: [
        ...["a", "b", "c", "d", "e"].map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
        { type: "marks", from: "Tag:a", to: "Hub:h" },
      ],
    };

    it("uses the set name in group labels, neighbours' names, a bundle's name and the list", async () => {
      const html = await draw(spec, "Hub:h", 3, view);
      expect(html).toContain("holds · 5");
      expect(html).toContain("← is marked by · 1");
      const names = attr(html, "aria-label");
      expect(names.some((a) => a.includes("in holds · 5"))).toBe(true);
      expect(names.some((a) => a.startsWith("holds: 2 more links,"))).toBe(true);
      expect(listOf(html)).toContain("holds · 5");
    });

    it("shows the mosaic's own edge type name nowhere a person reads when a name is set", async () => {
      const html = await draw(spec, "Hub:h", 3, view);
      const seen = text(html.replace(/<g[^>]*>\s*<polygon/g, "<polygon")) + " " + attr(html, "aria-label").join(" ");
      expect(seen).not.toMatch(/\bcarries\b/);
      expect(seen).not.toMatch(/\bmarks\b/);
    });

    it("uses no set name for the other direction's group when only the edge type is named", async () => {
      const html = await draw(spec, "Hub:h", 3);
      expect(html).toContain("carries · 5");
      expect(html).toContain("← marks · 1");
    });
  });
});
