// The Schema view (needs G-1, G-2, G-10, G-11): every type and edge type drawn with
// its count, sizes following the counts; selecting one shows its description, counts, most
// linked things and the table it opens; partial counts say so; below 960px the same contents
// come as a list. Rendered on the server, as the page first draws it; the browser test drives it.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import SchemaView from "../src/components/SchemaView.svelte";
import { openMosaic } from "../src/lib/mosaic.js";
import { talliesFor, Walker } from "../src/lib/graph/session.js";
import { routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, parseView, Shape, type ViewSettings } from "../src/lib/view.js";
import { VIEWS } from "../src/lib/views.js";
import { noun, partialNote, walksFor } from "../src/lib/graph/mapview.js";
import { Tallies } from "../src/lib/graph/tally.js";

function mosaic() {
  const spokes = Array.from({ length: 30 }, (_, i) => `s${String(i).padStart(2, "0")}`);
  return buildMosaic({
    typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [
      ["points_at", "Spoke", "Hub"],
      ["tagged", "Spoke", "Tag"],
    ],
    nodes: [
      { type: "Hub", key: "h", label: "The hub" },
      { type: "Tag", key: "t", label: "A tag" },
      ...spokes.map((k) => ({ type: "Spoke", key: k, label: `Spoke ${k}` })),
    ],
    edges: [
      ...spokes.map((k) => ({ type: "points_at", from: `Spoke:${k}`, to: "Hub:h" })),
      ...spokes.slice(0, 3).map((k) => ({ type: "tagged", from: `Spoke:${k}`, to: "Tag:t" })),
    ],
  });
}

const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });

async function drawn(walk = false, view = DEFAULT_VIEW) {
  const file = await openMosaic(mosaic(), "hub.mosaic");
  if (walk) {
    const tallies = talliesFor(file);
    for (const t of ["Hub", "Spoke", "Tag"]) while (!tallies.job(t).tally.done) await tallies.job(t).advance();
  }
  const { body } = render(SchemaView, { props: { file, shape: new Shape(view, file), hrefFor, tableHref } });
  return body;
}

const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

describe("the Schema view (G-1)", () => {
  it("is available in the shell's switcher", () => {
    expect(VIEWS.find((v) => v.id === "schema")).toMatchObject({ available: true });
  });

  it("draws every node type as a shard with its count, and every edge type as an arrow", async () => {
    const html = await drawn();
    expect(attr(html, "data-type")).toEqual(["Hub", "Spoke", "Tag"]);
    expect(attr(html, "data-edge")).toEqual(["points_at", "tagged"]);
    const labels = attr(html, "aria-label");
    expect(labels).toContain("Spoke: 30 things");
    expect(labels).toContain("Hub: 1 thing");
    expect(html).toContain("3 types · 2 edge types");
  });

  it("once walked, gives each edge type its links, whole, and draws arrows as thick as them", async () => {
    const html = await drawn(true);
    const labels = attr(html, "aria-label");
    expect(labels).toContain("points_at: from Spoke to Hub, 30 links");
    expect(labels).toContain("tagged: from Spoke to Tag, 3 links");
    expect(html).not.toContain("Counting links");
    // The arrow with more links is the thicker; the one with the most is the thickest drawn.
    const [pointsAt, tagged] = attr(html, "stroke-width").map(Number);
    expect(pointsAt).toBeGreaterThan(tagged!);
    expect(tagged).toBeGreaterThan(0);
  });

  it("sizes shards by their counts: the type with most things is the largest", async () => {
    const html = await drawn();
    const polygons = [...html.matchAll(/data-type="(\w+)"[^]*?points="([^"]+)"/g)].map((m) => {
      const xs = m[2]!.split(" ").map((p) => Number(p.split(",")[0]));
      return [m[1], Math.max(...xs) - Math.min(...xs)] as const;
    });
    const width = Object.fromEntries(polygons);
    // Spoke holds 30 things, Hub and Tag one each: Spoke is wider than both, and both are drawn.
    expect(width.Spoke).toBeGreaterThan(width.Hub!);
    expect(width.Spoke).toBeGreaterThan(width.Tag!);
    expect(width.Hub).toBeGreaterThan(0);
    expect(width.Tag).toBeGreaterThan(0);
  });

  it("asks for a selection before any is made (G-2)", async () => {
    expect(await drawn()).toContain("Select a type or an edge type to see its description, its counts and where to start.");
  });

  it("uses the view file's labels for types and edge types", async () => {
    const view = parseView({
      search: "semantic",
      theme: "auto",
      types: [{ name: "Spoke", label: "Spoke thing", columns: null, page: null, names: { points_at: "Points at" }, describe: "A spoke" }],
      edges: null,
      export: { types: null },
    });
    const html = await drawn(false, view);
    expect(attr(html, "aria-label")).toContain("Spoke thing: 30 things");
    expect(attr(html, "aria-label")).toContain("Points at: from Spoke thing to Hub, … links");
  });

  it("is the same picture every time (G-7)", async () => {
    expect(await drawn()).toBe(await drawn());
  });
});

async function draw(spec: MosaicSpec, opts: { walk?: string[] | "all"; view?: ViewSettings; pages?: Record<string, number> } = {}) {
  const file = await openMosaic(buildMosaic(spec), "edge.mosaic");
  const tallies = talliesFor(file);
  const types = file.nodeTypes.map((t) => t.name);
  const order = opts.walk === "all" ? types : (opts.walk ?? []);
  for (const t of order) {
    let pages = opts.pages?.[t] ?? Infinity;
    while (!tallies.job(t).tally.done && pages-- > 0) await tallies.job(t).advance();
  }
  const view = opts.view ?? DEFAULT_VIEW;
  return render(SchemaView, { props: { file, shape: new Shape(view, file), hrefFor, tableHref } }).body;
}

const pointsOf = (html: string, type: string) => {
  const m = new RegExp(`data-type="${type}"[^]*?points="([^"]+)"`).exec(html)!;
  return m[1]!.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
};
const widthOf = (html: string, type: string) => {
  const xs = pointsOf(html, type).map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
};
const heightOf = (html: string, type: string) => {
  const ys = pointsOf(html, type).map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys);
};
const areaOf = (html: string, type: string) => {
  const p = pointsOf(html, type);
  let twice = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice / 2);
};
const pathsOf = (html: string) => [...html.matchAll(/class="line[^"]*" d="([^"]+)"/g)].map((m) => m[1]!);

const things = (type: string, n: number, prefix = "k") =>
  Array.from({ length: n }, (_, i) => ({ type, key: `${prefix}${String(i).padStart(4, "0")}`, label: `${type} ${i}` }));

const view = (types: object[] | null, edges: object[] | null = null): ViewSettings =>
  parseView({ search: "semantic", theme: "auto", types, edges, export: { types: null } });
const typeView = (name: string, more: object = {}) => ({ name, label: null, columns: null, page: null, names: {}, describe: null, ...more });

describe("a mosaic with nothing to draw (G-1)", () => {
  it("draws a single type inside the picture", async () => {
    const html = await draw({ nodes: things("Solo", 1) });
    for (const [x, y] of pointsOf(html, "Solo")) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(560);
    }
  });
});

describe("every type is drawn, even an empty one (G-1)", () => {
  const spec: MosaicSpec = {
    types: ["Empty"],
    nodes: [...things("Full", 12)],
    edgeTypes: [["into", "Full", "Empty"]],
  };

  it("draws a type that holds nothing, with its count of 0, and gives it a visible shard", async () => {
    const html = await draw(spec);
    expect(attr(html, "data-type")).toEqual(["Empty", "Full"]);
    expect(attr(html, "aria-label")).toContain("Empty: 0 things");
    expect(widthOf(html, "Empty")).toBeGreaterThan(0);
    expect(heightOf(html, "Empty")).toBeGreaterThan(0);
  });

  it("gives an edge type with no links 0 links once counted, as the thinnest arrow", async () => {
    const html = await draw(spec, { walk: "all" });
    expect(attr(html, "aria-label")).toContain("into: from Full to Empty, 0 links");
    expect(attr(html, "stroke-width").map(Number)).toEqual([1]);
    expect(html).not.toContain("Counting links");
  });

  it("an edge type leaving a type that holds nothing is whole as soon as that type is walked", async () => {
    const html = await draw(
      { types: ["Empty"], nodes: things("Full", 2), edgeTypes: [["out", "Empty", "Full"]] },
      { walk: ["Empty"] },
    );
    expect(attr(html, "aria-label")).toContain("out: from Empty to Full, 0 links");
    expect(html).not.toContain("Counting links");
  });
});

describe("sizes follow the counts (G-1)", () => {
  const spec: MosaicSpec = {
    nodes: [...things("Aa", 1), ...things("Bb", 5), ...things("Cc", 40), ...things("Dd", 40), ...things("Ee", 200)],
  };

  it("never make a type with more things smaller than one with fewer", async () => {
    const html = await draw(spec);
    const w = ["Aa", "Bb", "Cc", "Ee"].map((t) => widthOf(html, t));
    const h = ["Aa", "Bb", "Cc", "Ee"].map((t) => heightOf(html, t));
    for (let i = 1; i < w.length; i++) expect(w[i]! * h[i]!).toBeGreaterThanOrEqual(w[i - 1]! * h[i - 1]!);
    expect(w[3]! * h[3]!).toBeGreaterThan(w[0]! * h[0]!);
  });

  it("gives two types with the same count about the same size, whatever their names (shards are irregular, so not the same box)", async () => {
    const html = await draw(spec);
    const ratio = areaOf(html, "Cc") / areaOf(html, "Dd");
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
    // ...and much nearer each other than either is to a type with five times more.
    expect(Math.abs(areaOf(html, "Cc") - areaOf(html, "Dd"))).toBeLessThan(Math.abs(areaOf(html, "Cc") - areaOf(html, "Ee")));
  });

  it("keeps the smallest type visible next to a type 200 times larger", async () => {
    const html = await draw(spec);
    expect(widthOf(html, "Aa")).toBeGreaterThan(1);
    expect(heightOf(html, "Aa")).toBeGreaterThan(1);
  });

  it("writes counts of a thousand and more with a comma, in the label and the list", async () => {
    const html = await draw({ nodes: things("Big", 1234) });
    expect(attr(html, "aria-label")).toContain("Big: 1,234 things");
    expect(html).toContain(">1,234<");
  });
});

describe("arrows follow the links (G-1)", () => {
  const spec: MosaicSpec = {
    edgeTypes: [
      ["few", "Src", "Dst"],
      ["more", "Src", "Dst"],
      ["most", "Src", "Dst"],
      ["same", "Src", "Dst"],
    ],
    nodes: [...things("Src", 30), ...things("Dst", 2)],
    edges: [
      ...things("Src", 2).map((n) => ({ type: "few", from: `Src:${n.key}`, to: "Dst:k0000" })),
      ...things("Src", 8).map((n) => ({ type: "more", from: `Src:${n.key}`, to: "Dst:k0000" })),
      ...things("Src", 30).map((n) => ({ type: "most", from: `Src:${n.key}`, to: "Dst:k0000" })),
      ...things("Src", 8).map((n) => ({ type: "same", from: `Src:${n.key}`, to: "Dst:k0001" })),
    ],
  };

  it("draw more links thicker, the same links the same, and the most links the thickest", async () => {
    const html = await draw(spec, { walk: "all" });
    const widths = attr(html, "stroke-width").map(Number); // data-edge order: few, more, most, same
    expect(attr(html, "data-edge")).toEqual(["few", "more", "most", "same"]);
    expect(widths[0]!).toBeLessThan(widths[1]!);
    expect(widths[1]!).toBeLessThan(widths[2]!);
    expect(widths[1]).toBe(widths[3]);
    expect(widths[2]).toBe(Math.max(...widths));
    expect(attr(html, "aria-label")).toContain("most: from Src to Dst, 30 links");
    expect(attr(html, "aria-label")).toContain("few: from Src to Dst, 2 links");
  });

  it("starts every arrow thin while the links are being counted", async () => {
    const html = await draw(spec);
    expect(new Set(attr(html, "stroke-width"))).toEqual(new Set(["1"]));
  });

  it("draws an edge type that joins a type to itself, once, with its links", async () => {
    const html = await draw(
      {
        nodes: things("Per", 4),
        edgeTypes: [["knows", "Per", "Per"]],
        edges: [
          { type: "knows", from: "Per:k0000", to: "Per:k0001" },
          { type: "knows", from: "Per:k0001", to: "Per:k0000" },
          { type: "knows", from: "Per:k0002", to: "Per:k0003" },
        ],
      },
      { walk: "all" },
    );
    expect(attr(html, "data-edge")).toEqual(["knows"]);
    expect(attr(html, "aria-label")).toContain("knows: from Per to Per, 3 links");
    expect(html).not.toContain("NaN");
  });

  it("writes link counts of a thousand and more with a comma", async () => {
    const html = await draw(
      {
        nodes: things("Src", 1100),
        types: ["Dst"],
        edgeTypes: [["to", "Src", "Dst"]],
      },
      { walk: "all" },
    );
    // No edge rows: the count is 0. Now with links:
    expect(attr(html, "aria-label")).toContain("to: from Src to Dst, 0 links");
    const big = await draw(
      {
        nodes: [...things("Src", 1100), { type: "Dst", key: "d", label: "d" }],
        edgeTypes: [["to", "Src", "Dst"]],
        edges: things("Src", 1100).map((n) => ({ type: "to", from: `Src:${n.key}`, to: "Dst:d" })),
      },
      { walk: "all" },
    );
    expect(attr(big, "aria-label")).toContain("to: from Src to Dst, 1,100 links");
  });
});

describe("counts that are still partial say so (G-10)", () => {
  const spec: MosaicSpec = {
    nodes: [...things("Src", 45), { type: "Dst", key: "d", label: "d" }, ...things("Other", 3)],
    edgeTypes: [
      ["to", "Src", "Dst"],
      ["back", "Other", "Dst"],
    ],
    edges: [
      ...things("Src", 45).map((n) => ({ type: "to", from: `Src:${n.key}`, to: "Dst:d" })),
      ...things("Other", 3).map((n) => ({ type: "back", from: `Other:${n.key}`, to: "Dst:d" })),
    ],
  };

  it("after one page of a type of 45, does not give the links of its edge type as whole", async () => {
    const html = await draw(spec, { walk: ["Src"], pages: { Src: 1 } });
    const labels = attr(html, "aria-label");
    expect(labels.find((l) => l.startsWith("to:"))).not.toMatch(/, 45 links$/);
    expect(labels.find((l) => l.startsWith("to:"))).not.toMatch(/, 20 links$/);
    expect(html).toContain("Counting links: 20 of 48 things so far.");
  });

  it("counts against the things of every type an edge type leaves, and ends when all are walked", async () => {
    const half = await draw(spec, { walk: ["Src"] });
    expect(half).toContain("Counting links: 45 of 48 things so far.");
    expect(attr(half, "aria-label")).toContain("to: from Src to Dst, 45 links");
    expect(attr(half, "aria-label").find((l) => l.startsWith("back:"))).not.toMatch(/, 3 links$/);
    const whole = await draw(spec, { walk: ["Src", "Other"] });
    expect(whole).not.toContain("Counting links");
    expect(attr(whole, "aria-label")).toContain("back: from Other to Dst, 3 links");
  });

  it("does not need the types edges only reach to be walked", async () => {
    const html = await draw(spec, { walk: ["Src", "Other"] });
    expect(html).not.toContain("Counting links");
  });
});

describe("the same picture every time (G-7)", () => {
  const spec: MosaicSpec = {
    nodes: [...things("Aa", 7), ...things("Bb", 33), ...things("Cc", 2)],
    edgeTypes: [
      ["ab", "Aa", "Bb"],
      ["bc", "Bb", "Cc"],
      ["ca", "Cc", "Aa"],
    ],
    edges: [
      ...things("Aa", 7).map((n) => ({ type: "ab", from: `Aa:${n.key}`, to: "Bb:k0000" })),
      ...things("Bb", 5).map((n) => ({ type: "bc", from: `Bb:${n.key}`, to: "Cc:k0001" })),
      { type: "ca", from: "Cc:k0000", to: "Aa:k0002" },
    ],
  };

  it("does not depend on the order the types were walked in", async () => {
    expect(await draw(spec, { walk: ["Aa", "Bb", "Cc"] })).toBe(await draw(spec, { walk: ["Cc", "Bb", "Aa"] }));
  });

  it("does not depend on the order the nodes and edges were written in", async () => {
    const reversed: MosaicSpec = { ...spec, nodes: [...spec.nodes].reverse(), edges: [...spec.edges!].reverse(), edgeTypes: spec.edgeTypes };
    expect(await draw(reversed, { walk: "all" })).toBe(await draw(spec, { walk: "all" }));
  });

  it("does not move a shard or an arrow while links are being counted", async () => {
    const before = await draw(spec);
    const after = await draw(spec, { walk: "all" });
    for (const t of ["Aa", "Bb", "Cc"]) expect(pointsOf(after, t)).toEqual(pointsOf(before, t));
    expect(pathsOf(after)).toEqual(pathsOf(before));
    expect(pathsOf(after)).toHaveLength(3);
  });

  it("draws every pair of shards at its own place", async () => {
    const html = await draw(spec);
    const centre = (t: string) => {
      const p = pointsOf(html, t);
      return p.map(([x, y]) => `${(x / p.length).toFixed(0)}`).join("") + p.reduce((a, [, y]) => a + y, 0) / p.length;
    };
    expect(new Set(["Aa", "Bb", "Cc"].map(centre)).size).toBe(3);
  });
});

describe("order is by UTF-8 bytes, not by the language of the machine (G-7)", () => {
  it("lists node types as bytes sort them: digits, then capitals, then lower case", async () => {
    const html = await draw({ nodes: [...things("Zed", 1), ...things("Ab", 1), ...things("AB", 1), ...things("A1", 1), ...things("Aa", 1)] });
    expect(attr(html, "data-type")).toEqual(["A1", "AB", "Aa", "Ab", "Zed"]);
  });

  it("lists edge types as bytes sort them: digits, then underscore, then letters", async () => {
    const html = await draw({
      nodes: [...things("Tt", 1)],
      edgeTypes: [
        ["ab", "Tt", "Tt"],
        ["b", "Tt", "Tt"],
        ["a_b", "Tt", "Tt"],
        ["a1", "Tt", "Tt"],
      ],
    });
    expect(attr(html, "data-edge")).toEqual(["a1", "a_b", "ab", "b"]);
    const list = html.slice(html.indexOf('class="list'));
    const at = ["a1", "a_b", "ab"].map((n) => list.indexOf(`<span>${n} `));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at.every((i) => i > 0)).toBe(true);
  });
});

describe("what the view file says is shown as text, never as markup (G-2)", () => {
  const spec: MosaicSpec = { nodes: [...things("Tt", 2), ...things("Uu", 1)], edgeTypes: [["to", "Tt", "Uu"]] };

  it("keeps a label with markup, quotes and ampersands from breaking out of the page", async () => {
    const html = await draw(spec, {
      view: view([typeView("Tt", { label: `A "quoted" <img src=x onerror=alert(1)> & more`, names: { to: `x" data-evil="1` }, describe: "<script>alert(1)</script>" })]),
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<[^<>]*\sdata-evil="/);
    expect(attr(html, "data-type")).toEqual(["Tt", "Uu"]);
    expect(attr(html, "data-edge")).toEqual(["to"]);
  });

  it("keeps a description with markup, in an edge type's entry too, out of the picture", async () => {
    const html = await draw(spec, { view: view(null, [{ name: "to", describe: "<b onmouseover=1>bold</b>" }]) });
    expect(html).not.toContain("<b ");
    expect(attr(html, "data-edge")).toEqual(["to"]);
  });

  it("shows a long label and one with astral characters and right-to-left text without failing", async () => {
    const label = `${"é".repeat(3000)} 😀 مرحبا`;
    const html = await draw(spec, { view: view([typeView("Tt", { label })]) });
    expect(attr(html, "data-type")).toEqual(["Tt", "Uu"]);
    expect(html).toContain("😀");
    expect(html).toContain("مرحبا");
  });

  it("ignores a view-file entry for a type or edge type the mosaic lacks, and draws what it has", async () => {
    const html = await draw(spec, { view: view([typeView("Ghost", { label: "Boo" }), typeView("Tt", { label: "Tee" })], [{ name: "nothing", describe: "none" }]) });
    expect(attr(html, "data-type")).toEqual(["Tt", "Uu"]);
    expect(attr(html, "data-edge")).toEqual(["to"]);
    expect(html).not.toContain("Boo");
    expect(attr(html, "aria-label")).toContain("Tee: 2 things");
  });

  it("draws every type of the mosaic even when the view file lists only some for tables", async () => {
    // views/view.schema.json: a type left out of `types` is absent from the type list and tables only.
    const html = await draw(spec, { view: view([typeView("Tt")]) });
    expect(attr(html, "data-type")).toEqual(["Tt", "Uu"]);
  });
});

describe("many types (G-1, G-10)", () => {
  it("draws sixty types and edge types, each once, inside the picture, none on top of another", async () => {
    const names = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, "0")}`);
    const html = await draw({
      nodes: names.flatMap((t, i) => things(t, 1 + (i % 7))),
      edgeTypes: names.slice(1).map((t, i) => [`e${String(i).padStart(2, "0")}`, names[i]!, t] as [string, string, string]),
    });
    expect(attr(html, "data-type")).toEqual(names);
    expect(attr(html, "data-edge")).toHaveLength(59);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    const centres = new Set<string>();
    for (const t of names) {
      const p = pointsOf(html, t);
      for (const [x, y] of p) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(800);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(560);
      }
      centres.add(`${(p.reduce((a, q) => a + q[0], 0) / p.length).toFixed(1)},${(p.reduce((a, q) => a + q[1], 0) / p.length).toFixed(1)}`);
    }
    expect(centres.size).toBe(60);
    expect(html).toContain("60 types · 59 edge types");
  });
});

describe("the list for narrow screens (G-11)", () => {
  it("holds every type and edge type with its figure, and the figure of an uncounted edge type is …", async () => {
    const html = await draw({ nodes: [...things("Src", 3), ...things("Dst", 2)], edgeTypes: [["to", "Src", "Dst"]] });
    const list = html.slice(html.indexOf('class="list'));
    expect(list).toContain("Src");
    expect(list).toContain("Dst");
    expect(list).toContain("to");
    expect(list).toContain(">…<");
    expect(list.match(/<button/g)).toHaveLength(3);
  });

  it("gives the buttons and shards of a selection the pressed state, none selected at first", async () => {
    const html = await draw({ nodes: things("Src", 3), edgeTypes: [["to", "Src", "Src"]] });
    expect(attr(html, "aria-pressed").every((v) => v === "false")).toBe(true);
  });

  it("makes each shard and arrow reachable by keyboard", async () => {
    const html = await draw({ nodes: things("Src", 3), edgeTypes: [["to", "Src", "Src"]] });
    expect(attr(html, "tabindex")).toEqual(["0", "0"]);
    expect(attr(html, "role")).toContain("button");
  });
});

describe("schema view: further cases", () => {
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });

  /** Draw the view after walking `walk` (type names, or every type) for `pages` pages each. */
  async function draw(spec: MosaicSpec, opts: { walk?: string[] | "all"; view?: ViewSettings; pages?: Record<string, number> } = {}) {
    const file = await openMosaic(buildMosaic(spec), "cases.mosaic");
    const tallies = talliesFor(file);
    const order = opts.walk === "all" ? file.nodeTypes.map((t) => t.name) : (opts.walk ?? []);
    for (const t of order) {
      let pages = opts.pages?.[t] ?? Infinity;
      while (!tallies.job(t).tally.done && pages-- > 0) await tallies.job(t).advance();
    }
    const view = opts.view ?? DEFAULT_VIEW;
    return render(SchemaView, { props: { file, shape: new Shape(view, file), hrefFor, tableHref } }).body;
  }

  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
  const things = (type: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ type, key: `k${String(i).padStart(4, "0")}`, label: `${type} ${i}` }));
  const typeView = (name: string, more: object = {}) => ({ name, label: null, columns: null, page: null, names: {}, describe: null, ...more });
  const view = (types: object[]): ViewSettings => parseView({ search: "semantic", theme: "auto", types, edges: null, export: { types: null } });

  /** Each arrow's name box, in the order the map draws them: its text and its rectangle. */
  function nameBoxes(html: string) {
    const layer = html.slice(html.indexOf('class="edge-labels'));
    return [...layer.matchAll(/class="label-back[^"]*" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^]*?<text[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
      text: m[5]!,
    }));
  }
  const listRows = (html: string) => {
    const list = html.slice(html.indexOf('class="list'));
    const edges = list.slice(list.indexOf("Edge types"));
    return edges;
  };

  describe("how an edge type is named on the map (G-1, G-2; view file `names`)", () => {
    const spec: MosaicSpec = {
      nodes: [...things("Src", 3), ...things("Mid", 2), ...things("Dst", 1)],
      edgeTypes: [
        ["alpha", "Src", "Dst"],
        ["beta", "Src", "Mid"],
        ["gamma", "Mid", "Dst"],
      ],
      edges: [{ type: "alpha", from: "Src:k0000", to: "Dst:k0000" }],
    };

    it("names an arrow, everywhere it appears, by the label its leaving type's `names` gives, and the raw name when it gives none", async () => {
      const v = view([typeView("Src", { names: { alpha: "Alpha label" } })]);
      const html = await draw(spec, { walk: "all", view: v });
      expect(attr(html, "aria-label")).toContain("Alpha label: from Src to Dst, 1 link");
      expect(attr(html, "aria-label")).toContain("beta: from Src to Mid, 0 links");
      expect(attr(html, "data-edge")).toEqual(["alpha", "beta", "gamma"]);
      expect(nameBoxes(html).map((b) => b.text)).toEqual(["Alpha label · 1", "beta · 0", "gamma · 0"]);
      const rows = listRows(html);
      expect(rows).toContain("Alpha label");
      expect(rows).not.toContain(">alpha");
    });

    it("ignores a label that the type an edge type reaches, or any other type, gives for it", async () => {
      const v = view([typeView("Dst", { names: { alpha: "From the far side" } }), typeView("Mid", { names: { alpha: "From a third type" } })]);
      const html = await draw(spec, { walk: "all", view: v });
      expect(html).not.toContain("From the far side");
      expect(html).not.toContain("From a third type");
      expect(attr(html, "aria-label")).toContain("alpha: from Src to Dst, 1 link");
    });

    it("keeps edge types in the order of their raw names, whatever their labels sort like (G-7)", async () => {
      const v = view([typeView("Src", { names: { alpha: "Zulu", beta: "Alpha" } })]);
      const html = await draw(spec, { view: v });
      expect(attr(html, "data-edge")).toEqual(["alpha", "beta", "gamma"]);
      expect(nameBoxes(html).map((b) => b.text.split(" · ")[0])).toEqual(["Zulu", "Alpha", "gamma"]);
    });

    it("draws two edge types that carry the same label as two arrows, each with its own count", async () => {
      const v = view([typeView("Src", { names: { alpha: "Same", beta: "Same" } })]);
      const html = await draw(spec, { walk: "all", view: v });
      expect(attr(html, "data-edge")).toEqual(["alpha", "beta", "gamma"]);
      expect(attr(html, "aria-label")).toContain("Same: from Src to Dst, 1 link");
      expect(attr(html, "aria-label")).toContain("Same: from Src to Mid, 0 links");
      expect(nameBoxes(html).map((b) => b.text)).toEqual(["Same · 1", "Same · 0", "gamma · 0"]);
    });

    it("writes a label with markup, quotes and ampersands as text in the name boxes and the list", async () => {
      const v = view([typeView("Src", { names: { alpha: `<i onclick=1>A</i> & "q"` } })]);
      const html = await draw(spec, { view: v });
      expect(html).not.toContain("<i onclick");
      const decoded = nameBoxes(html)[0]!.text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
      expect(decoded).toBe(`<i onclick=1>A</i> & "q" · …`);
    });

    it("uses the type's own label for the types an arrow joins, and the edge label for the arrow", async () => {
      const v = view([typeView("Src", { label: "Source", names: { alpha: "Goes to" } }), typeView("Dst", { label: "Destination" })]);
      const html = await draw(spec, { walk: "all", view: v });
      expect(attr(html, "aria-label")).toContain("Goes to: from Source to Destination, 1 link");
    });
  });

  describe("what a partial count says (G-10)", () => {
    const spec: MosaicSpec = {
      types: ["Quiet"],
      nodes: [...things("Src", 45), { type: "Dst", key: "d", label: "d" }, ...things("Oth", 2)],
      edgeTypes: [
        ["to", "Src", "Dst"],
        ["rare", "Src", "Dst"],
        ["back", "Oth", "Dst"],
        ["nothing", "Quiet", "Dst"],
      ],
      edges: [
        ...things("Src", 45).map((n) => ({ type: "to", from: `Src:${n.key}`, to: "Dst:d" })),
        { type: "rare", from: "Src:k0044", to: "Dst:d" },
        { type: "back", from: "Oth:k0000", to: "Dst:d" },
      ],
    };
    const labelOf = (html: string, name: string) => attr(html, "aria-label").find((l) => l.startsWith(`${name}:`))!;

    it("marks a lower bound with … after the number, in the arrow's name, its box and the list", async () => {
      const html = await draw(spec, { walk: ["Src"], pages: { Src: 1 } });
      expect(labelOf(html, "to")).toBe("to: from Src to Dst, 20… links");
      expect(nameBoxes(html).map((b) => b.text)).toContain("to · 20…");
      expect(listRows(html)).toContain(">20…<");
    });

    it("never gives as whole an edge type that has no link among the things counted so far", async () => {
      const html = await draw(spec, { walk: ["Src"], pages: { Src: 1 } });
      expect(labelOf(html, "rare")).not.toMatch(/, 0 links$/);
      expect(labelOf(html, "rare")).toMatch(/…/);
    });

    it("never gives as whole an edge type whose leaving type has not been counted at all", async () => {
      const html = await draw(spec, { walk: ["Src"] });
      expect(labelOf(html, "back")).toBe("back: from Oth to Dst, … links");
      expect(labelOf(html, "to")).toBe("to: from Src to Dst, 45 links");
    });

    it("counts a type once however many edge types leave it, in 'N of M things so far'", async () => {
      const html = await draw(spec);
      // Src (45) leaves three edge types, Oth (2) one, Quiet (0) one; Dst leaves none.
      expect(html).toContain("Counting links: 0 of 47 things so far.");
    });

    it("keeps saying so until every type an edge type leaves is walked, and not after", async () => {
      const part = await draw(spec, { walk: ["Src", "Oth"] });
      expect(attr(part, "aria-label").filter((l) => l.includes("…"))).toEqual([labelOf(part, "nothing")]);
      expect(part).toContain("Counting links:");
      const all = await draw(spec, { walk: ["Src", "Oth", "Quiet"] });
      expect(attr(all, "aria-label").some((l) => l.includes("…"))).toBe(false);
      expect(all).not.toContain("Counting links");
      expect(labelOf(all, "nothing")).toBe("nothing: from Quiet to Dst, 0 links");
    });

    it("shows the notice exactly when some arrow still shows …, and gives the same picture of the map each time (G-7)", async () => {
      for (const walk of [[], ["Src"], ["Src", "Oth"], ["Src", "Oth", "Quiet"], ["Quiet"]]) {
        const html = await draw(spec, { walk });
        const partial = attr(html, "aria-label").some((l) => l.includes("…"));
        expect(html.includes("Counting links")).toBe(partial);
        expect(await draw(spec, { walk })).toBe(html);
      }
    });

    it("does not move a shard or an arrow as the counts come in (G-7)", async () => {
      const geometry = (html: string) => [...html.matchAll(/(?:points|d)="([^"]+)"/g)].map((m) => m[1]);
      const first = await draw(spec, { walk: [] });
      const later = await draw(spec, { walk: "all" });
      const mid = await draw(spec, { walk: ["Src"], pages: { Src: 1 } });
      // Name boxes follow their text; only the shards and the lines stay put.
      const shape = (html: string) => geometry(html.slice(0, html.indexOf('class="edge-labels')));
      expect(shape(mid)).toEqual(shape(first));
      expect(shape(later)).toEqual(shape(first));
    });
  });

  describe("the note under 'Most linked' while a type is counted (G-10)", () => {
    it("says nothing when the counting is whole, however the numbers look", () => {
      expect(partialNote({ partial: false, counted: 0, total: 0 }, "T")).toBeNull();
      expect(partialNote({ partial: false, counted: 3, total: 9 }, "T")).toBeNull();
    });

    it("says waiting when counting has not started and the total is not known", () => {
      expect(partialNote({ partial: true, counted: 0, total: null }, "Person")).toBe("The things of Person are waiting to be counted.");
    });

    it("gives the count in whole numbers with a comma at every thousand, and the type by the name it was given", () => {
      expect(partialNote({ partial: true, counted: 1000, total: 40948 }, "Person")).toBe("So far: 1,000 of 40,948 things of Person counted.");
      expect(partialNote({ partial: true, counted: 7, total: 12 }, "Œuvre <b>")).toBe("So far: 7 of 12 things of Œuvre <b> counted.");
    });

    it("takes the singular for a type of exactly one thing", () => {
      expect(partialNote({ partial: true, counted: 0, total: 1 }, "T")).toBe("So far: 0 of 1 thing of T counted.");
    });

    it("takes the plural for a count still partial, whatever its size", () => {
      expect(noun(1, "link", "links", true)).toBe("links");
      expect(noun(0, "link", "links", true)).toBe("links");
      expect(noun(2, "link", "links", true)).toBe("links");
      expect(noun(1, "link", "links", false)).toBe("link");
    });
  });

  describe("which counts come first after a selection (G-10)", () => {
    const edgeTypes = [
      { name: "a", from: "A", to: "B" },
      { name: "loop", from: "A", to: "A" },
      { name: "open_from", from: null, to: "B" },
      { name: "open_to", from: "A", to: null },
      { name: "open_both", from: null, to: null },
    ];

    it("starts an edge type with the type it leaves, then the type it reaches, each once", () => {
      expect(walksFor({ kind: "edge", name: "a" }, edgeTypes)).toEqual(["A", "B"]);
      expect(walksFor({ kind: "edge", name: "loop" }, edgeTypes)).toEqual(["A"]);
    });

    it("starts an edge type that leaves any type with the type it reaches, and one that reaches any type with the type it leaves", () => {
      expect(walksFor({ kind: "edge", name: "open_from" }, edgeTypes)).toEqual(["B"]);
      expect(walksFor({ kind: "edge", name: "open_to" }, edgeTypes)).toEqual(["A"]);
      expect(walksFor({ kind: "edge", name: "open_both" }, edgeTypes)).toEqual([]);
    });

    it("starts a type with itself, even a type no edge type touches", () => {
      expect(walksFor({ kind: "type", name: "Lonely" }, edgeTypes)).toEqual(["Lonely"]);
      expect(walksFor({ kind: "type", name: "A" }, [])).toEqual(["A"]);
    });

    it("starts a type's own name as given, whatever bytes it holds", () => {
      expect(walksFor({ kind: "type", name: "Écrivain 😀" }, [])).toEqual(["Écrivain 😀"]);
    });

    function pile(n: number) {
      const keys = Array.from({ length: n }, (_, i) => `s${String(i).padStart(4, "0")}`);
      return buildMosaic({
        typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [
          ["points_at", "Spoke", "Hub"],
          ["tagged", "Hub", "Tag"],
        ],
        nodes: [
          { type: "Hub", key: "h", label: "Hub" },
          { type: "Tag", key: "t", label: "Tag" },
          ...keys.map((k) => ({ type: "Spoke", key: k, label: k })),
        ],
        edges: [...keys.map((k) => ({ type: "points_at", from: `Spoke:${k}`, to: "Hub:h" })), { type: "tagged", from: "Hub:h", to: "Tag:t" }],
      });
    }
    const now = () => Promise.resolve();

    it("puts the type a person selects first again each time, so the last selection is walked first", async () => {
      const file = await openMosaic(pile(61), "p.mosaic");
      const tallies = new Tallies(file);
      const seen: string[] = [];
      let walker: Walker;
      walker = new Walker(
        tallies,
        (t) => {
          seen.push(`${t.type} ${t.counted}`);
          if (t.type === "Spoke" && t.counted === 20) walker.want(["Hub"], true);
          if (t.type === "Hub") walker.want(["Tag"], true);
        },
        now,
      );
      walker.want(["Spoke"]);
      await walker.idle();
      expect(seen.slice(0, 3)).toEqual(["Spoke 20", "Hub 1", "Tag 1"]);
      expect(seen.slice(3)).toEqual(["Spoke 40", "Spoke 60", "Spoke 61"]);
    });

    it("does not walk again, or twice, a type asked for first when it is already whole", async () => {
      const file = await openMosaic(pile(25), "p.mosaic");
      const tallies = new Tallies(file);
      const seen: string[] = [];
      const walker = new Walker(tallies, (t) => seen.push(`${t.type} ${t.counted}`), now);
      walker.want(["Hub", "Spoke"]);
      await walker.idle();
      const before = seen.length;
      walker.want(["Hub"], true);
      walker.want(["Hub", "Spoke"], true);
      await walker.idle();
      expect(seen).toHaveLength(before);
    });

    it("finishes every type it was asked for, whatever the order of the asking (G-7)", async () => {
      const run = async (order: string[][]) => {
        const file = await openMosaic(pile(45), "p.mosaic");
        const tallies = new Tallies(file);
        const walker = new Walker(tallies, () => undefined, now);
        for (const [i, names] of order.entries()) walker.want(names, i > 0);
        await walker.idle();
        return ["Hub", "Spoke", "Tag"].map((t) => JSON.stringify(tallies.peek(t)));
      };
      const a = await run([["Spoke", "Hub", "Tag"]]);
      const b = await run([["Tag"], ["Hub"], ["Spoke"]]);
      expect(a).toEqual(b);
      expect(JSON.parse(a[1]!).done).toBe(true);
    });

    it("goes on with the walks asked for before after the types put first, never dropping them", async () => {
      const file = await openMosaic(pile(45), "p.mosaic");
      const tallies = new Tallies(file);
      const walker = new Walker(tallies, () => undefined, now);
      walker.want(["Spoke"]);
      walker.want(["Tag"], true);
      await walker.idle();
      expect(tallies.peek("Spoke")!.done).toBe(true);
      expect(tallies.peek("Tag")!.done).toBe(true);
    });
  });

  describe("an arrow's name stays readable (G-1: every edge type drawn with its count)", () => {
    const types = (n: number) => Array.from({ length: n }, (_, i) => `Ty${i}`);
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    it("keeps the boxes of a small mosaic's names apart from one another: 4 types each joined to every other", async () => {
      const t = types(4);
      const edgeTypes: [string, string, string][] = [];
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) edgeTypes.push([`e${i}${j}`, t[i]!, t[j]!]);
      const html = await draw({ nodes: t.flatMap((n, i) => things(n, 1 + i)), edgeTypes });
      const boxes = nameBoxes(html);
      expect(boxes).toHaveLength(6);
      const clashes: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i]!, boxes[j]!)) clashes.push(`${boxes[i]!.text} / ${boxes[j]!.text}`);
      expect(clashes).toEqual([]);
    });

    it("keeps every name box inside the map's box, whatever the number of types", async () => {
      for (const n of [1, 2, 7, 30]) {
        const t = types(n);
        const edgeTypes = t.map((name, i) => [`e${i}`, name, t[(i + 1) % n]!] as [string, string, string]);
        const html = await draw({ nodes: t.flatMap((name) => things(name, 2)), edgeTypes });
        for (const b of nameBoxes(html)) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(800);
          expect(b.y + b.h).toBeLessThanOrEqual(560);
        }
      }
    });

    it("keeps a very long label's box inside the map's box too (the view file sets no limit on a label's length)", async () => {
      const v = view([typeView("Src", { names: { to: "x".repeat(300) } })]);
      const html = await draw({ nodes: [...things("Src", 1), ...things("Dst", 1)], edgeTypes: [["to", "Src", "Dst"]] }, { view: v });
      const [box] = nameBoxes(html);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.w).toBeLessThanOrEqual(800);
    });
  });
});
