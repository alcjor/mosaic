// The person's choices in the Neighbourhood view (need G-5): a neighbour can be
// expanded to its own neighbourhood, collapsed, hidden and shown again, re-centred on and opened as
// a page; the edge types shown can be chosen, each with its count. Rendered on the server from a
// neighbourhood loaded through the kit with those choices, as the page draws it once they are made;
// the browser test makes them by keyboard and pointer. Data is invented.
import { type SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
import { expand, hide, HoodLoader, hoodOf, showEdge, type HoodState, collapse, recentre, unhide, withLimit, type Limit } from "../src/lib/graph/hood.js";
import { edgeChoices } from "../src/lib/graph/hoodview.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, Shape } from "../src/lib/view.js";

const pad = (i: number) => String(i).padStart(2, "0");

/** A hub with 25 items pointing at it and 3 tags it carries; the first tag is related to 4 more. */
function spec(): MosaicSpec {
  const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
  return {
    typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [
      ["points_at", "Item", "Hub"],
      ["carries", "Hub", "Tag"],
      ["related", "Tag", "Tag"],
    ],
    nodes: [
      { type: "Hub", key: "h", label: "The hub" },
      ...items.map((k) => ({ type: "Item", key: k, label: `Item ${k}` })),
      ...["t0", "t1", "t2", "x0", "x1", "x2", "x3"].map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` })),
    ],
    edges: [
      ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
      ...["t0", "t1", "t2"].map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
      ...["x0", "x1", "x2", "x3"].map((t) => ({ type: "related", from: "Tag:t0", to: `Tag:${t}` })),
    ],
  };
}

const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });

async function open(): Promise<SealedFile> {
  return openMosaic(buildMosaic(spec()), "hub.mosaic");
}

async function drawn(choose: (s: HoodState, file: SealedFile) => HoodState, selected?: string) {
  const file = await open();
  const state = choose(hoodOf("Hub:h"), file);
  const initial = await new HoodLoader(file).load(state);
  const { body } = render(NeighbourhoodView, {
    props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: "Hub:h", hrefFor, tableHref, hoodHref, initial, selected },
  });
  return body;
}

const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const all = (file: SealedFile) => file.edgeTypes.map((e) => e.name);

describe("expanding a neighbour (G-5)", () => {
  it("draws its own neighbourhood beside it: its groups, named, and its neighbours", async () => {
    const html = await drawn((s) => expand(s, "Tag:t0"));
    const groups = [...html.matchAll(/data-owner="([^"]*)" data-group="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(groups).toContain("Tag:t0 related out");
    expect(groups).toContain("Tag:t0 carries in");
    expect(attr(html, "data-thing")).toEqual(expect.arrayContaining(["Tag:x0", "Tag:x1", "Tag:x2", "Tag:x3"]));
    expect(html).toContain("related · 4");
  });

  it("collapsing is the state without it: its own neighbours go", async () => {
    const html = await drawn((s) => s);
    expect(attr(html, "data-thing")).not.toContain("Tag:x0");
    expect(attr(html, "data-expanded")).toEqual([]);
  });
});

describe("hiding a neighbour (G-5)", () => {
  it("stops drawing it, and lists it as hidden with a way to show it again", async () => {
    const html = await drawn((s) => hide(s, "Tag:t1"));
    expect(attr(html, "data-thing")).not.toContain("Tag:t1");
    expect(attr(html, "data-thing")).toContain("Tag:t0");
    expect(text(html)).toContain("Hidden: 1");
    expect(attr(html, "data-unhide")).toEqual(["Tag:t1"]);
    expect(attr(html, "aria-label")).toContain("Show Tag t1 again");
    // The group still counts every link: hiding a thing changes the picture, not the mosaic.
    expect(html).toContain("carries · 3");
  });

  it("hides its own neighbourhood too, when it was expanded", async () => {
    const html = await drawn((s) => hide(expand(s, "Tag:t0"), "Tag:t0"));
    expect(attr(html, "data-thing")).not.toContain("Tag:x0");
    expect(attr(html, "data-expanded")).toEqual([]);
  });
});

describe("choosing the edge types shown (G-5)", () => {
  it("offers every edge type the things drawn have, each with its count, checked when shown", async () => {
    const html = await drawn((s) => expand(s, "Tag:t0"));
    const boxes = [...html.matchAll(/<input[^>]*data-edge-type="([^"]*)"[^>]*>/g)].map((m) => [m[1], / checked[ =>]/.test(m[0])]);
    expect(boxes).toEqual([
      ["carries", true],
      ["points_at", true],
      ["related", true],
    ]);
    const label = text(html);
    // Each link once: the hub's 3, of which Tag t0's 1 is one.
    expect(label).toContain("carries · 3");
    expect(label).toContain("points_at · 25");
    expect(label).toContain("related · 4");
  });

  it("counts each link once among the things drawn", async () => {
    const file = await open();
    const hood = await new HoodLoader(file).load(expand(hoodOf("Hub:h"), "Tag:t0"));
    // The hub carries 3 tags; Tag t0's one carries link is one of them, counted once.
    expect(hood.counts).toEqual([
      { edge: "carries", count: 3, atLeast: false },
      { edge: "points_at", count: 25, atLeast: false },
      { edge: "related", count: 4, atLeast: false },
    ]);
  });

  it("counts a thing's link to itself once, though it is in its out and its in group", async () => {
    const file = await openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"name":"text"}' },
        edgeTypes: [["next", "Hub", "Hub"]],
        nodes: [
          { type: "Hub", key: "h", label: "The hub" },
          { type: "Hub", key: "k", label: "Another" },
        ],
        edges: [
          { type: "next", from: "Hub:h", to: "Hub:h" },
          { type: "next", from: "Hub:h", to: "Hub:k" },
        ],
      }),
      "loop.mosaic",
    );
    const hood = await new HoodLoader(file).load(expand(hoodOf("Hub:h"), "Hub:k"));
    expect(hood.counts).toEqual([{ edge: "next", count: 2, atLeast: false }]);
  });

  it("says 'at least' when the kit cannot tell the links between two open things apart, and never counts more than there are", async () => {
    // Hub h links (rel) to 25 tags, the last of them z; z is linked (rel) from 25 hubs, h the
    // last by id. Neither end's 20 reach the other, so whether h–z is one of them is not known.
    const tags = Array.from({ length: 24 }, (_, i) => `t${pad(i)}`);
    const hubs = Array.from({ length: 24 }, (_, i) => `a${pad(i)}`);
    const file = await openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [
          ["rel", "Hub", "Tag"],
          ["marks", "Hub", "Tag"],
        ],
        nodes: [
          { type: "Hub", key: "h", label: "H" },
          ...hubs.map((k) => ({ type: "Hub", key: k, label: k })),
          ...tags.map((k) => ({ type: "Tag", key: k, label: k })),
          { type: "Tag", key: "z", label: "Z" },
        ],
        edges: [
          ...[...tags, "z"].map((t) => ({ type: "rel", from: "Hub:h", to: `Tag:${t}` })),
          ...hubs.map((k) => ({ type: "rel", from: `Hub:${k}`, to: "Tag:z" })),
          { type: "marks", from: "Hub:h", to: "Tag:z" },
        ],
      }),
      "far.mosaic",
    );
    const hood = await new HoodLoader(file).load(expand(hoodOf("Hub:h"), "Tag:z"));
    const rel = hood.counts.find((c) => c.edge === "rel")!;
    // There are 49 distinct rel links; the count may only say so as a bound it can stand by.
    expect(rel.atLeast).toBe(true);
    expect(rel.count).toBeLessThanOrEqual(49);
    expect(rel.count).toBeGreaterThanOrEqual(25);
    expect(hood.counts.find((c) => c.edge === "marks")).toEqual({ edge: "marks", count: 1, atLeast: false });
    const html = render(NeighbourhoodView, {
      props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: "Hub:h", hrefFor, tableHref, hoodHref, initial: hood },
    }).body;
    expect(text(html)).toContain(`rel · at least ${rel.count}`);
    expect(text(html)).toContain("“At least”: the kit lists 20 of a thing's links at a time");
  });
});

describe("an expanded thing folded into a bundle (G-5)", () => {
  it("opens nothing until it is drawn: no groups of its own, and nothing in the edge types or their counts", async () => {
    // Item i24 is the last of 25 items, folded into the bundle at limit 5; it points at the hub only.
    const html = await drawn((s) => expand(s, "Item:i24"));
    expect(attr(html, "data-thing")).not.toContain("Item:i24");
    expect([...html.matchAll(/data-owner="([^"]*)"/g)].map((m) => m[1])).not.toContain("Item:i24");
    expect(html).toContain("points_at · 25<");
    const file = await open();
    const hood = await new HoodLoader(file).load(expand(hoodOf("Hub:h"), "Item:i24"));
    expect(edgeChoices(hood, new Set(["Hub:h", "Tag:t0"]))).toEqual([
      { edge: "carries", count: 3 },
      { edge: "points_at", count: 25 },
    ]);
  });
});

describe("a selected neighbour's actions (G-5)", () => {
  it("offer Expand, Hide, Re-centre here and Open its page", async () => {
    const html = await drawn((s) => s, "Tag:t0");
    const panel = html.slice(html.indexOf('aria-label="Selection"'));
    expect(attr(panel, "data-action")).toEqual(["expand", "hide"]);
    expect(panel).toContain(`href="${hoodHref("Tag:t0").replaceAll("&", "&amp;")}"`);
    expect(panel).toContain(`href="${hrefFor("Tag:t0")}"`);
    expect(text(panel)).toContain("Re-centre here");
    expect(text(panel)).toContain("Open its page");
  });

  it("offer Collapse instead of Expand when it is expanded", async () => {
    const html = await drawn((s) => expand(s, "Tag:t0"), "Tag:t0");
    const panel = html.slice(html.indexOf('aria-label="Selection"'));
    expect(attr(panel, "data-action")).toEqual(["collapse", "hide"]);
  });

  it("offer only Open its page for the thing at the centre", async () => {
    const html = await drawn((s) => s, "Hub:h");
    const panel = html.slice(html.indexOf('aria-label="Selection"'));
    expect(attr(panel, "data-action")).toEqual([]);
    expect(text(panel)).not.toContain("Re-centre here");
    expect(text(panel)).toContain("Open its page");
  });
});

describe("the same picture for the same choices (G-7)", () => {
  it("draws the same markup every time", async () => {
    const choose = (s: HoodState, file: SealedFile) => showEdge(hide(expand(s, "Tag:t0"), "Tag:t2"), all(file), "points_at", false);
    expect(await drawn(choose)).toBe(await drawn(choose));
  });
});

describe("neighbourhood choices: further cases", () => {
  const pad = (i: number, n = 2) => String(i).padStart(n, "0");
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
  const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });

  /** What a reader sees: the text without tags, spaces collapsed. */
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
  const unescape = (s: string) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
  const panelOf = (html: string) => html.slice(html.indexOf('aria-label="Selection"'));

  const TYPES = { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' };

  /**
   * A hub that carries tags a, b and c; a and b are both related to the shared tags s0..s2; a is
   * related to b, c points back at the hub (so a link runs between the hub and a neighbour), and the
   * isolated tag `lone` has no links at all.
   */
  function web(): MosaicSpec {
    const t = (k: string, label: string | null = `Tag ${k}`) => ({ type: "Tag", key: k, label });
    return {
      typeProps: TYPES,
      edgeTypes: [
        ["carries", "Hub", "Tag"],
        ["related", "Tag", "Tag"],
        ["back_to", "Tag", "Hub"],
      ],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, t("a"), t("b"), t("c"), t("s0"), t("s1"), t("s2"), t("lone")],
      edges: [
        ...["a", "b", "c"].map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
        ...["s0", "s1", "s2"].flatMap((s) => ["a", "b"].map((k) => ({ type: "related", from: `Tag:${k}`, to: `Tag:${s}` }))),
        { type: "related", from: "Tag:a", to: "Tag:b" },
        { type: "back_to", from: "Tag:c", to: "Hub:h" },
      ],
    };
  }

  async function load(spec: MosaicSpec): Promise<SealedFile> {
    return openMosaic(buildMosaic(spec), "edges.mosaic");
  }

  async function drawn(
    spec: MosaicSpec,
    choose: (s: HoodState, file: SealedFile) => HoodState = (s) => s,
    opts: { centre?: string; selected?: string; limit?: Limit } = {},
  ): Promise<string> {
    const file = await load(spec);
    const centre = opts.centre ?? "Hub:h";
    const state = choose(hoodOf(centre, opts.limit), file);
    const initial = await new HoodLoader(file).load(state);
    return render(NeighbourhoodView, {
      props: { file, shape: new Shape(DEFAULT_VIEW, file), centre, hrefFor, tableHref, hoodHref, initial, selected: opts.selected },
    }).body;
  }

  const things = (html: string) => attr(html, "data-thing");
  const allTypes = (file: SealedFile) => file.edgeTypes.map((e) => e.name);

  describe("a neighbour that links back to the centre (G-5)", () => {
    it("draws the centre once when an expanded neighbour leads back to it", async () => {
      const html = await drawn(web(), (s) => expand(s, "Tag:c"));
      expect(things(html).filter((id) => id === "Hub:h")).toEqual([]);
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
      expect(attr(html, "data-expanded")).toEqual(["Tag:c"]);
      expect(attr(html, "data-owner").length).toBeGreaterThan(0);
    });

    it("names the expanded neighbour's link back to the centre as its own group, with its count", async () => {
      const html = await drawn(web(), (s) => expand(s, "Tag:c"));
      const groups = [...html.matchAll(/data-owner="([^"]*)" data-group="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
      expect(groups).toContain("Tag:c back_to out");
      expect(groups).toContain("Tag:c carries in");
    });
  });

  describe("two expanded neighbours that share neighbours (G-5)", () => {
    it("draw each shared neighbour once", async () => {
      const html = await drawn(web(), (s) => expand(expand(s, "Tag:a"), "Tag:b"));
      const ids = things(html);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(expect.arrayContaining(["Tag:s0", "Tag:s1", "Tag:s2"]));
    });

    it("draws the same neighbours whichever was expanded first, and keeps each one's own groups", async () => {
      const ab = await drawn(web(), (s) => expand(expand(s, "Tag:a"), "Tag:b"));
      const ba = await drawn(web(), (s) => expand(expand(s, "Tag:b"), "Tag:a"));
      expect([...things(ab)].sort()).toEqual([...things(ba)].sort());
      for (const html of [ab, ba]) {
        const groups = [...html.matchAll(/data-owner="([^"]*)" data-group="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
        expect(groups).toEqual(expect.arrayContaining(["Tag:a related out", "Tag:b related out"]));
      }
    });
  });

  describe("hiding a thing another open thing also reaches (G-5)", () => {
    it("stops drawing it from the centre's groups and from an expanded neighbour's", async () => {
      const html = await drawn(web(), (s) => hide(expand(s, "Tag:a"), "Tag:s1"));
      expect(things(html)).not.toContain("Tag:s1");
      expect(things(html)).toEqual(expect.arrayContaining(["Tag:s0", "Tag:s2"]));
      expect(attr(html, "data-unhide")).toEqual(["Tag:s1"]);
    });

    it("still counts every link of the group it was in", async () => {
      const html = await drawn(web(), (s) => hide(expand(s, "Tag:a"), "Tag:s1"));
      expect(html).toContain("related · 4");
    });

    it("draws a hidden thing again when it is expanded, and lists nothing as hidden", async () => {
      const html = await drawn(web(), (s) => expand(hide(s, "Tag:a"), "Tag:a"));
      expect(things(html)).toContain("Tag:a");
      expect(attr(html, "data-unhide")).toEqual([]);
      expect(text(html)).not.toContain("Hidden:");
    });

    it("lists several hidden things in a fixed order, however they were hidden, with their count", async () => {
      const one = await drawn(web(), (s) => hide(hide(hide(s, "Tag:c"), "Tag:a"), "Tag:b"));
      const two = await drawn(web(), (s) => hide(hide(hide(s, "Tag:b"), "Tag:c"), "Tag:a"));
      expect(attr(one, "data-unhide")).toEqual(["Tag:a", "Tag:b", "Tag:c"]);
      expect(text(one)).toContain("Hidden: 3");
      expect(one).toBe(two);
    });

    it("draws the centre even when a link asked to hide it", async () => {
      // A hidden id can come from an address (G-8); the thing at the centre is what the view is about.
      const html = await drawn(web(), (s) => hide(s, "Hub:h"));
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
      expect(things(html)).toEqual(expect.arrayContaining(["Tag:a", "Tag:b", "Tag:c"]));
    });

    it("shows it again with the same picture as if it had never been hidden", async () => {
      const plain = await drawn(web(), (s) => expand(s, "Tag:a"));
      const back = await drawn(web(), (s) => unhide(hide(expand(s, "Tag:a"), "Tag:s1"), "Tag:s1"));
      expect(back).toBe(plain);
    });
  });

  describe("expanding and collapsing are inverses in the picture (G-5, G-7)", () => {
    it("collapsing what was expanded draws exactly the picture before", async () => {
      const before = await drawn(web());
      const after = await drawn(web(), (s) => collapse(expand(s, "Tag:a"), "Tag:a"));
      expect(after).toBe(before);
    });

    it("expanding a thing with no links opens nothing to draw, and says so rather than failing", async () => {
      const html = await drawn(web(), (s) => expand(s, "Tag:lone"));
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
      expect(things(html)).toEqual(expect.arrayContaining(["Tag:a", "Tag:b", "Tag:c"]));
    });

    it("expands every neighbour of a busy thing at once, drawing each thing once", async () => {
      const items = Array.from({ length: 25 }, (_, i) => `i${pad(i)}`);
      const spec: MosaicSpec = {
        typeProps: TYPES,
        edgeTypes: [
          ["points_at", "Item", "Hub"],
          ["near", "Item", "Item"],
        ],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...items.map((k) => ({ type: "Item", key: k, label: `Item ${k}` }))],
        edges: [
          ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
          ...items.slice(1).map((k, i) => ({ type: "near", from: `Item:${items[i]}`, to: `Item:${k}` })),
        ],
      };
      const plain = things(await drawn(spec)).filter((id) => id.startsWith("Item:"));
      expect(plain).toHaveLength(5);
      const html = await drawn(spec, (s) => plain.reduce(expand, s));
      const ids = things(html);
      expect(new Set(ids).size).toBe(ids.length);
      expect(attr(html, "data-expanded").sort()).toEqual([...plain].sort());
    });
  });

  describe("every edge type switched off (G-5)", () => {
    it("keeps an edge type switched off offered, with its count, once an expanded thing has more of it", async () => {
      const file = await load(web());
      const loader = new HoodLoader(file);
      const off = showEdge(hoodOf("Hub:h"), allTypes(file), "related", false);
      const hood = await loader.load(expand(off, "Tag:a"));
      const choices = edgeChoices(hood);
      expect(choices.find((c) => c.edge === "related")).toEqual({ edge: "related", count: 4 });
      const html = await drawn(web(), () => expand(off, "Tag:a"));
      expect(things(html)).not.toContain("Tag:s0");
    });
  });

  describe("the edge types offered (G-5)", () => {
    it("lists them by UTF-8 bytes, not by UTF-16 code units", async () => {
      // Edge type names are a-z, 0-9 and _ (format.sql): a locale puts "_" before digits, bytes after.
      const names = ["ab", "a_b", "a1", "a", "b2", "a_"];
      const spec: MosaicSpec = {
        typeProps: TYPES,
        edgeTypes: names.map((n) => [n, "Hub", "Tag"] as [string, string, string]),
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "t", label: "Tag t" }],
        edges: names.map((n) => ({ type: n, from: "Hub:h", to: "Tag:t" })),
      };
      const file = await load(spec);
      const hood = await new HoodLoader(file).load(hoodOf("Hub:h"));
      const bytes = [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      expect(edgeChoices(hood).map((c) => c.edge)).toEqual(bytes);
      const html = await drawn(spec);
      expect(attr(html, "data-edge-type").map(unescape)).toEqual(bytes);
    });

    it("offers an edge type the centre lacks only once an expanded thing has it", async () => {
      const before = await drawn(web());
      const after = await drawn(web(), (s) => expand(s, "Tag:a"));
      expect(attr(before, "data-edge-type")).toEqual(["back_to", "carries"]);
      expect(attr(after, "data-edge-type")).toEqual(["back_to", "carries", "related"]);
    });

    it("offers none for a thing with no links", async () => {
      const html = await drawn(web(), undefined, { centre: "Tag:lone" });
      expect(attr(html, "data-edge-type")).toEqual([]);
      expect(attr(html, "data-centre")).toEqual(["Tag:lone"]);
    });

    it("shows the same picture whatever order the edge types were switched off in", async () => {
      const choose = (order: string[]) => (s: HoodState, file: SealedFile) => order.reduce((acc, e) => showEdge(acc, allTypes(file), e, false), s);
      const one = await drawn(web(), choose(["carries", "back_to"]));
      const two = await drawn(web(), choose(["back_to", "carries"]));
      expect(one).toBe(two);
    });
  });

  describe("text that looks like markup, and things without a name (G-5, G-11)", () => {
    const odd = '<img src=x onerror=alert(1)> & "quoted" \'single\'';
    const spec = (): MosaicSpec => ({
      typeProps: TYPES,
      edgeTypes: [["carries", "Hub", "Tag"]],
      nodes: [
        { type: "Hub", key: "h", label: "The hub" },
        { type: "Tag", key: "odd", label: odd },
        { type: "Tag", key: "nameless", label: null },
      ],
      edges: [
        { type: "carries", from: "Hub:h", to: "Tag:odd" },
        { type: "carries", from: "Hub:h", to: "Tag:nameless" },
      ],
    });

    it("writes a hidden thing's name as text, never as markup", async () => {
      const html = await drawn(spec(), (s) => hide(s, "Tag:odd"));
      expect(html).not.toContain("<img");
      expect(attr(html, "aria-label").map(unescape)).toContain(`Show ${odd} again`);
    });

    it("writes the actions of a selected thing with such a name as text", async () => {
      const html = await drawn(spec(), (s) => s, { selected: "Tag:odd" });
      expect(html).not.toContain("<img");
      expect(text(panelOf(html))).toContain("Re-centre here");
    });

    it("names a thing without a label by its id in the actions and in the show-again button", async () => {
      const plain = await drawn(spec(), (s) => s, { selected: "Tag:nameless" });
      expect(text(panelOf(plain))).toContain("Tag:nameless");
      const hidden = await drawn(spec(), (s) => hide(s, "Tag:nameless"));
      expect(attr(hidden, "aria-label")).toContain("Show Tag:nameless again");
      expect(attr(hidden, "data-unhide")).toEqual(["Tag:nameless"]);
    });
  });

  describe("a thing the mosaic lacks, asked to open (G-5, G-8)", () => {
    it("says it could not open it by name and still draws everything else", async () => {
      const html = await drawn(web(), (s) => expand(expand(s, "Tag:ghost"), "Tag:a"));
      expect(text(html)).toContain("Tag:ghost");
      expect(things(html)).toEqual(expect.arrayContaining(["Tag:a", "Tag:s0"]));
      expect(attr(html, "data-centre")).toEqual(["Hub:h"]);
    });

    it("draws a centre that is a neighbour of nothing it expanded, without the expansion's groups", async () => {
      const html = await drawn(web(), (s) => expand(s, "Tag:lone"));
      const groups = [...html.matchAll(/data-owner="([^"]*)"/g)].map((m) => m[1]);
      expect(groups).not.toContain("Tag:lone");
    });
  });

  describe("limits apply to an expanded thing's groups too (G-4, G-5)", () => {
    function crowd(): MosaicSpec {
      const tags = Array.from({ length: 8 }, (_, i) => `x${pad(i)}`);
      return {
        typeProps: TYPES,
        edgeTypes: [
          ["carries", "Hub", "Tag"],
          ["related", "Tag", "Tag"],
        ],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "a", label: "Tag a" }, ...tags.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
        edges: [{ type: "carries", from: "Hub:h", to: "Tag:a" }, ...tags.map((k) => ({ type: "related", from: "Tag:a", to: `Tag:${k}` }))],
      };
    }

    it("shows that many of its neighbours and folds the rest into a bundle with its count", async () => {
      const html = await drawn(crowd(), (s) => expand(s, "Tag:a"), { limit: 3 });
      expect(things(html).filter((id) => id.startsWith("Tag:x"))).toHaveLength(3);
      expect(attr(html, "data-more")).toEqual(["5"]);
      expect(html).toContain("related · 8");
    });

    it("follows a new limit: a larger one folds less, in the same state", async () => {
      const small = await drawn(crowd(), (s) => withLimit(expand(s, "Tag:a"), 3));
      const large = await drawn(crowd(), (s) => withLimit(expand(s, "Tag:a"), 10));
      expect(things(small).filter((id) => id.startsWith("Tag:x"))).toHaveLength(3);
      expect(things(large).filter((id) => id.startsWith("Tag:x"))).toHaveLength(8);
      expect(attr(large, "data-more")).toEqual([]);
    });
  });

  describe("re-centring on a neighbour (G-5)", () => {
    it("clears what was expanded and hidden, and draws the neighbour's own neighbourhood at the centre", async () => {
      const html = await drawn(web(), (s) => recentre(hide(expand(s, "Tag:b"), "Tag:c"), "Tag:a"));
      expect(attr(html, "data-centre")).toEqual(["Tag:a"]);
      expect(attr(html, "data-expanded")).toEqual([]);
      expect(attr(html, "data-unhide")).toEqual([]);
      expect(things(html)).toEqual(expect.arrayContaining(["Hub:h", "Tag:b", "Tag:s0"]));
    });

    it("uses the address of the thing even when its key has characters that need escaping", async () => {
      const key = "a b&c=d#e?f/é\u{1F600}";
      const spec: MosaicSpec = {
        typeProps: TYPES,
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key, label: "Odd" }],
        edges: [{ type: "carries", from: "Hub:h", to: `Tag:${key}` }],
      };
      const html = await drawn(spec, (s) => s, { selected: `Tag:${key}` });
      const hrefs = attr(panelOf(html), "href").map(unescape);
      expect(hrefs).toContain(hoodHref(`Tag:${key}`));
      expect(hrefs).toContain(hrefFor(`Tag:${key}`));
    });
  });

  describe("the same picture for the same choices, however reached (G-7)", () => {
    it("draws the same markup for the same state built in a different order", async () => {
      const one = await drawn(web(), (s, f) => showEdge(hide(expand(expand(s, "Tag:a"), "Tag:b"), "Tag:s2"), allTypes(f), "back_to", false));
      const two = await drawn(web(), (s, f) => hide(showEdge(expand(expand(s, "Tag:b"), "Tag:a"), allTypes(f), "back_to", false), "Tag:s2"));
      expect(things(one).slice().sort()).toEqual(things(two).slice().sort());
      expect(attr(one, "data-unhide")).toEqual(attr(two, "data-unhide"));
      expect(attr(one, "data-edge-type")).toEqual(attr(two, "data-edge-type"));
    });

    it("draws the same markup twice from two separately opened files", async () => {
      const choose = (s: HoodState) => hide(expand(s, "Tag:a"), "Tag:s0");
      expect(await drawn(web(), choose)).toBe(await drawn(web(), choose));
    });
  });
});
