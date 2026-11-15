// Edge cases of each edge type's count in the Neighbourhood view (need G-5, G-7), written
// from the decision: "Distinct
// links of that type in the picture. Sum the drawn owners' group counts, subtract links counted
// from both ends, and show 'at least n' with a note only where a pair's overlap can't be known.
// Things not drawn add nothing. A turned-off edge type shows the count it would add. Add a legend
// line." The oracle here is not the viewer's: it counts, from the invented mosaic's own edges, the
// distinct links (src, type, dst, qualifier; section 3.4) with an end at the centre or at an expanded
// thing that is drawn. What a reader sees is the list of edge types in the rendered page. Data is
// invented.
import type { SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
import { expand, hide, HoodLoader, hoodOf, recentre, showEdge, withLimit, type Hood, type HoodState, type Limit } from "../src/lib/graph/hood.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, Shape } from "../src/lib/view.js";

const pad = (i: number, n = 2) => String(i).padStart(n, "0");
const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "explore" });
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
const bytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

const TYPES = { N: '{"name":"text"}', Hub: '{"name":"text"}', Tag: '{"name":"text"}' };
type E = { type: string; from: string; to: string; qualifier?: string };

async function load(spec: MosaicSpec): Promise<SealedFile> {
  return openMosaic(buildMosaic(spec), "counts.mosaic");
}
const allTypes = (file: SealedFile) => file.edgeTypes.map((e) => e.name);

async function hoodFor(spec: MosaicSpec, state: HoodState): Promise<{ file: SealedFile; hood: Hood }> {
  const file = await load(spec);
  return { file, hood: await new HoodLoader(file).load(state) };
}

function draw(file: SealedFile, hood: Hood, centre: string): string {
  return render(NeighbourhoodView, {
    props: { file, shape: new Shape(DEFAULT_VIEW, file), centre, hrefFor, tableHref, hoodHref, initial: hood },
  }).body;
}

/** "name · n" of each edge type offered, as a reader sees it (the box's own label). */
function offered(html: string): [string, string][] {
  return [...html.matchAll(/<input[^>]*data-edge-type="([^"]*)"[^>]*>\s*<span>([^<]*)<\/span>/g)].map((m) => [m[1]!, m[2]!]);
}
const labelled = (list: readonly (readonly [string, number])[]) => list.map(([e, c]) => [e, `${e} · ${c}`]);

/** Distinct links of each edge type with an end among `open`; the edge types by UTF-8 bytes. */
function oracle(edges: readonly E[], open: ReadonlySet<string>): Map<string, number> {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const e of edges) {
    if (!open.has(e.from) && !open.has(e.to)) continue;
    const key = JSON.stringify([e.from, e.type, e.to, e.qualifier ?? ""]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(e.type, (out.get(e.type) ?? 0) + 1);
  }
  return new Map([...out].sort((a, b) => bytes(a[0], b[0])));
}

const nodesN = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "N", key: `n${pad(i)}`, label: `Node ${pad(i)}` }));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random links among n nodes of one type: self-links, both directions, and parallel ones told apart by a qualifier. */
function randomEdges(rand: () => number, n: number, types: readonly string[], density: number): E[] {
  const out: E[] = [];
  for (const type of types) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (const qualifier of ["", "q"]) {
          if (rand() >= (qualifier === "" ? density : density / 4)) continue;
          out.push({ type, from: `N:n${pad(i)}`, to: `N:n${pad(j)}`, ...(qualifier ? { qualifier } : {}) });
        }
      }
    }
  }
  return out;
}

const countsOf = (hood: Hood) => hood.counts.map((c) => [c.edge, c.count] as const);
const oneEdgeType = (n: number, names = ["r"]): MosaicSpec["edgeTypes"] => names.map((t) => [t, "N", "N"] as [string, string, string]).slice(0, Math.max(n, names.length));

describe("each edge type's count is its distinct links among the things drawn (G-5)", () => {
  it("equals the distinct links with an end at the centre or at a drawn expanded thing, for random small mosaics, with edge types off and things hidden", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const n = 6 + Math.floor(rand() * 4);
      const types = ["r", "s", "t"];
      const edges = randomEdges(rand, n, types, 0.07 + rand() * 0.1);
      const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(3, types), nodes: nodesN(n), edges };
      const file = await load(spec);
      const centre = `N:n${pad(Math.floor(rand() * n))}`;
      const ids = nodesN(n).map((x) => `N:${x.key}`).filter((i) => i !== centre);
      const pick = ids.filter(() => rand() < 0.4);
      const off = types.filter(() => rand() < 0.25);
      const hidden = ids.filter((i) => !pick.includes(i) && rand() < 0.2);
      // Choices in an order that is not the id order, as a person would make them.
      let state = hoodOf(centre, 20);
      for (const e of off) state = showEdge(state, allTypes(file), e, false);
      for (const h of hidden) state = hide(state, h);
      for (const p of [...pick].reverse()) state = expand(state, p);
      const hood = await new HoodLoader(file).load(state);

      // Drawn: reached from an open thing through an edge type shown; a fixpoint over the expanded.
      const open = new Set([centre]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of pick) {
          if (open.has(p)) continue;
          const reached = edges.some((e) => !off.includes(e.type) && ((open.has(e.from) && e.to === p) || (open.has(e.to) && e.from === p)));
          if (reached) {
            open.add(p);
            grew = true;
          }
        }
      }
      const want = [...oracle(edges, open)];
      const why = `seed ${seed}, centre ${centre}, expanded ${pick}, off ${off}`;
      const html = draw(file, hood, centre);
      expect(offered(html), why).toEqual(labelled(want));
      expect(countsOf(hood), why).toEqual(want);
      expect(text(html), why).not.toContain("At least");
      expect(hood.counts.some((c) => c.atLeast), why).toBe(false);
    }
  });

  it("counts a link both ways between two open things as two links", async () => {
    const edges: E[] = [
      { type: "r", from: "N:n00", to: "N:n01" },
      { type: "r", from: "N:n01", to: "N:n00" },
    ];
    const { file, hood } = await hoodFor({ typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(2), edges }, expand(hoodOf("N:n00"), "N:n01"));
    expect(offered(draw(file, hood, "N:n00"))).toEqual(labelled([["r", 2]]));
  });

  it("counts links of one type between the same two open things that differ in a qualifier as separate links, each once", async () => {
    const edges: E[] = [
      { type: "r", from: "N:n00", to: "N:n01", qualifier: "work" },
      { type: "r", from: "N:n00", to: "N:n01", qualifier: "home" },
      { type: "r", from: "N:n01", to: "N:n00" },
      { type: "r", from: "N:n00", to: "N:n02" },
    ];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(3), edges };
    const { file, hood } = await hoodFor(spec, expand(hoodOf("N:n00"), "N:n01"));
    expect(offered(draw(file, hood, "N:n00"))).toEqual(labelled([["r", 4]]));
    expect(hood.counts[0]!.atLeast).toBe(false);
    // The centre alone sees the same four links in its groups.
    const alone = await new HoodLoader(file).load(hoodOf("N:n00"));
    expect(offered(draw(file, alone, "N:n00"))).toEqual(labelled([["r", 4]]));
  });

  it("counts a triangle of three open things once per link: six links, none twice", async () => {
    const ids = ["N:n00", "N:n01", "N:n02"];
    const edges: E[] = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => ({ type: "r", from: a, to: b })));
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(3), edges };
    const { file, hood } = await hoodFor(spec, expand(expand(hoodOf("N:n00"), "N:n01"), "N:n02"));
    expect(offered(draw(file, hood, "N:n00"))).toEqual(labelled([["r", 6]]));
  });

  it("counts a thing's link to itself once, on an expanded thing and on the centre, with the links between them", async () => {
    const edges: E[] = [
      { type: "r", from: "N:n00", to: "N:n00" },
      { type: "r", from: "N:n01", to: "N:n01" },
      { type: "r", from: "N:n00", to: "N:n01" },
      { type: "r", from: "N:n01", to: "N:n00" },
    ];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(2), edges };
    const { file, hood } = await hoodFor(spec, expand(hoodOf("N:n00"), "N:n01"));
    expect(offered(draw(file, hood, "N:n00"))).toEqual(labelled([["r", 4]]));
  });

  it("adds an expanded thing's links to things no other open thing has, and takes the link it shares with the centre off once", async () => {
    // hub -> a, hub -> b, a -> s, b -> s. Open: hub and a.
    const edges: E[] = [
      { type: "r", from: "N:n00", to: "N:n01" },
      { type: "r", from: "N:n00", to: "N:n02" },
      { type: "r", from: "N:n01", to: "N:n03" },
      { type: "r", from: "N:n02", to: "N:n03" },
    ];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(4), edges };
    const centreOnly = await hoodFor(spec, hoodOf("N:n00"));
    expect(offered(draw(centreOnly.file, centreOnly.hood, "N:n00"))).toEqual(labelled([["r", 2]]));
    const { file, hood } = await hoodFor(spec, expand(hoodOf("N:n00"), "N:n01"));
    // 2 from the centre + 2 from a - the shared one = 3; b's link to s is not among the things drawn.
    expect(offered(draw(file, hood, "N:n00"))).toEqual(labelled([["r", 3]]));
  });

  it("counts the links of an expanded thing reached through another expanded thing, not through the centre", async () => {
    const edges: E[] = [
      { type: "r", from: "N:n00", to: "N:n01" },
      { type: "s", from: "N:n01", to: "N:n02" },
      { type: "t", from: "N:n02", to: "N:n03" },
      { type: "t", from: "N:n02", to: "N:n04" },
    ];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(3, ["r", "s", "t"]), nodes: nodesN(5), edges };
    const { file, hood } = await hoodFor(spec, expand(expand(hoodOf("N:n00"), "N:n01"), "N:n02"));
    const html = draw(file, hood, "N:n00");
    expect(attr(html, "data-expanded").sort()).toEqual(["N:n01", "N:n02"]);
    expect(offered(html)).toEqual(labelled([["r", 1], ["s", 1], ["t", 2]]));
  });

  it("gives the same counts whichever expanded thing was opened first", async () => {
    const edges = randomEdges(mulberry32(99), 8, ["r", "s"], 0.12);
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(2, ["r", "s"]), nodes: nodesN(8), edges };
    const ids = ["N:n01", "N:n02", "N:n03", "N:n04"];
    const a = await hoodFor(spec, ids.reduce(expand, hoodOf("N:n00", 20)));
    const b = await hoodFor(spec, [...ids].reverse().reduce(expand, hoodOf("N:n00", 20)));
    expect(offered(draw(a.file, a.hood, "N:n00"))).toEqual(offered(draw(b.file, b.hood, "N:n00")));
    expect(a.hood.counts).toEqual(b.hood.counts);
  });

  it("draws the same bytes twice from the same choices (G-7)", async () => {
    const edges: E[] = [
      { type: "r", from: "N:n00", to: "N:n01" },
      { type: "r", from: "N:n01", to: "N:n00" },
      { type: "s", from: "N:n01", to: "N:n02" },
    ];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(2, ["r", "s"]), nodes: nodesN(3), edges };
    const one = await hoodFor(spec, expand(hoodOf("N:n00"), "N:n01"));
    const two = await hoodFor(spec, expand(hoodOf("N:n00"), "N:n01"));
    expect(draw(one.file, one.hood, "N:n00")).toBe(draw(two.file, two.hood, "N:n00"));
  });
});

describe("an edge type turned off (G-5)", () => {
  const edges: E[] = [
    { type: "carries", from: "Hub:h", to: "Tag:a" },
    { type: "carries", from: "Hub:h", to: "Tag:b" },
    { type: "related", from: "Tag:a", to: "Tag:b" },
    { type: "related", from: "Tag:b", to: "Tag:a" },
    { type: "related", from: "Tag:a", to: "Tag:s" },
    { type: "related", from: "Tag:b", to: "Tag:s" },
    { type: "related", from: "Tag:b", to: "Tag:t" },
  ];
  const spec = (): MosaicSpec => ({
    typeProps: TYPES,
    edgeTypes: [["carries", "Hub", "Tag"], ["related", "Tag", "Tag"]],
    nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...["a", "b", "s", "t"].map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
    edges,
  });
  const both = (s: HoodState) => expand(expand(s, "Tag:a"), "Tag:b");

  it("shows the count it would add, each link between two open things once, as when it is on", async () => {
    const file = await load(spec());
    const loader = new HoodLoader(file);
    const on = await loader.load(both(hoodOf("Hub:h")));
    const off = await loader.load(showEdge(both(hoodOf("Hub:h")), allTypes(file), "related", false));
    // related: a-b, b-a, a-s, b-s, b-t: five distinct links among the open things.
    expect(offered(draw(file, on, "Hub:h"))).toEqual(labelled([["carries", 2], ["related", 5]]));
    const html = draw(file, off, "Hub:h");
    expect(offered(html)).toEqual(labelled([["carries", 2], ["related", 5]]));
    expect(html).toMatch(/<input[^>]*data-edge-type="related"(?![^>]* checked)[^>]*>/);
    expect(text(html)).toContain("1 edge type is not shown.");
  });

  it("draws no group of it, and none of the things only it reached", async () => {
    const file = await load(spec());
    const off = await new HoodLoader(file).load(showEdge(both(hoodOf("Hub:h")), allTypes(file), "related", false));
    const html = draw(file, off, "Hub:h");
    expect(attr(html, "data-group").filter((g) => g.startsWith("related"))).toEqual([]);
    expect(attr(html, "data-thing")).not.toContain("Tag:s");
    expect(attr(html, "data-thing")).not.toContain("Tag:t");
  });

  it("adds nothing for an expanded thing it cuts off: the thing is not drawn, so its links count nowhere", async () => {
    const file = await load(spec());
    const state = showEdge(both(hoodOf("Hub:h")), allTypes(file), "carries", false);
    const html = draw(file, await new HoodLoader(file).load(state), "Hub:h");
    // Only the hub is open now; it has the two carries links and nothing else.
    expect(offered(html)).toEqual(labelled([["carries", 2]]));
    expect(attr(html, "data-expanded")).toEqual([]);
    expect(text(html)).toContain("1 edge type is not shown.");
  });

  it("does not offer an edge type that only a cut-off expanded thing has", async () => {
    const file = await load(spec());
    const state = showEdge(expand(hoodOf("Hub:h"), "Tag:a"), allTypes(file), "carries", false);
    const html = draw(file, await new HoodLoader(file).load(state), "Hub:h");
    expect(attr(html, "data-edge-type")).toEqual(["carries"]);
  });
});

describe("a thing hidden or folded, and an expanded thing that is not there (G-5)", () => {
  function star(): MosaicSpec {
    const tags = Array.from({ length: 8 }, (_, i) => `x${pad(i)}`);
    return {
      typeProps: TYPES,
      edgeTypes: [["carries", "Hub", "Tag"], ["extra", "Tag", "Tag"], ["related", "Tag", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...tags.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges: [
        ...tags.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
        { type: "related", from: "Tag:x00", to: "Tag:x01" },
        { type: "related", from: "Tag:x07", to: "Tag:x01" },
        { type: "extra", from: "Tag:x07", to: "Tag:x06" },
      ],
    };
  }
  const seen = async (state: HoodState) => {
    const { file, hood } = await hoodFor(star(), state);
    return { html: draw(file, hood, "Hub:h"), hood };
  };

  it("changes no count when a thing that is not expanded is hidden: its links still count", async () => {
    const plain = await seen(expand(hoodOf("Hub:h", 20), "Tag:x00"));
    const hid = await seen(hide(expand(hoodOf("Hub:h", 20), "Tag:x00"), "Tag:x01"));
    expect(offered(hid.html)).toEqual(offered(plain.html));
    expect(offered(hid.html)).toEqual(labelled([["carries", 8], ["related", 1]]));
  });

  it("counts as if collapsed when an expanded thing is hidden", async () => {
    const centre = await seen(hoodOf("Hub:h", 20));
    const hid = await seen(hide(expand(hoodOf("Hub:h", 20), "Tag:x07"), "Tag:x07"));
    expect(offered(hid.html)).toEqual(offered(centre.html));
    expect(offered(hid.html)).toEqual(labelled([["carries", 8]]));
  });

  it("adds nothing for an expanded thing folded into a bundle, not even an edge type only it has", async () => {
    // At limit 3 the first three tags are drawn; x07 is in the bundle, and has an `extra` link.
    const folded = await seen(expand(hoodOf("Hub:h", 3), "Tag:x07"));
    expect(attr(folded.html, "data-thing")).not.toContain("Tag:x07");
    expect(offered(folded.html)).toEqual(labelled([["carries", 8]]));
    // Drawn at a larger limit, the same choice does add its links.
    const drawnToo = await seen(expand(hoodOf("Hub:h", 10), "Tag:x07"));
    expect(offered(drawnToo.html)).toEqual(labelled([["carries", 8], ["extra", 1], ["related", 1]]));
  });

  it("follows what is drawn when the limit changes in the same state", async () => {
    const small = await seen(withLimit(expand(hoodOf("Hub:h"), "Tag:x07"), 3));
    const large = await seen(withLimit(expand(hoodOf("Hub:h"), "Tag:x07"), 10));
    expect(offered(small.html)).toEqual(labelled([["carries", 8]]));
    expect(offered(large.html)).toEqual(labelled([["carries", 8], ["extra", 1], ["related", 1]]));
  });

  it("does not change what a drawn expanded thing adds with the limit", async () => {
    const out: string[] = [];
    for (const limit of [3, 5, 10, 20] as Limit[]) out.push(JSON.stringify(offered((await seen(expand(hoodOf("Hub:h", limit), "Tag:x00"))).html)));
    expect(new Set(out).size).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual(labelled([["carries", 8], ["related", 1]]));
  });

  it("adds nothing for an expanded thing the mosaic lacks", async () => {
    const plain = await seen(hoodOf("Hub:h", 20));
    const ghost = await seen(expand(hoodOf("Hub:h", 20), "Tag:nowhere"));
    expect(offered(ghost.html)).toEqual(offered(plain.html));
  });

  it("counts the new centre's own links after re-centring, whatever was expanded before", async () => {
    const before = expand(expand(hoodOf("Hub:h", 20), "Tag:x07"), "Tag:x00");
    const { file, hood } = await hoodFor(star(), recentre(before, "Tag:x01"));
    expect(offered(draw(file, hood, "Tag:x01"))).toEqual(labelled([["carries", 1], ["related", 2]]));
  });
});

describe("a group's own count is unchanged by the edge type's count (G-5)", () => {
  it("keeps 'carries · 1' on the expanded thing's group while the edge type shows the distinct 3", async () => {
    const edges: E[] = ["a", "b", "c"].map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` }));
    const spec: MosaicSpec = {
      typeProps: TYPES,
      edgeTypes: [["carries", "Hub", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...["a", "b", "c"].map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` }))],
      edges,
    };
    const { file, hood } = await hoodFor(spec, expand(hoodOf("Hub:h"), "Tag:a"));
    const html = draw(file, hood, "Hub:h");
    expect(offered(html)).toEqual([["carries", "carries · 3"]]);
    const group = (owner: string, g: string) => new RegExp(`data-owner="${owner}" data-group="${g}"[^>]*>(?:(?!</g>)[\\s\\S])*?<text[^>]*>([^<]*)</text>`).exec(html)?.[1] ?? null;
    expect(group("Hub:h", "carries out")).toBe("carries · 3");
    expect(group("Tag:a", "carries in")).toContain("carries · 1");
  });
});

describe("where the kit cannot tell a pair's overlap (G-5)", () => {
  const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${pad(i)}`);

  it("is exact, with no note, when an expanded thing has few links and the centre has more than the kit lists at once", async () => {
    const spec: MosaicSpec = {
      typeProps: TYPES,
      edgeTypes: [["rel", "Hub", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: "H" }, ...tags(30).map((k) => ({ type: "Tag", key: k, label: k }))],
      edges: tags(30).map((t) => ({ type: "rel", from: "Hub:h", to: `Tag:${t}` })),
    };
    for (const tag of ["Tag:t00", "Tag:t10", "Tag:t19"]) {
      const { file, hood } = await hoodFor(spec, expand(hoodOf("Hub:h", 20), tag));
      const html = draw(file, hood, "Hub:h");
      expect(attr(html, "data-expanded")).toEqual([tag]);
      expect(offered(html), tag).toEqual([["rel", "rel · 30"]]);
      expect(text(html)).not.toContain("“At least”");
    }
  });

  it("is exact when the centre's list has gone past the expanded thing, though both have more links than the kit lists at once", async () => {
    // h -> t00..t29; t18 is also linked from 30 other hubs. h's first 20 links reach t18, so the
    // link h -> t18 is known; t18's list does not hold h (by id, h is last of its 31).
    const hubs = Array.from({ length: 30 }, (_, i) => `a${pad(i)}`);
    const spec: MosaicSpec = {
      typeProps: TYPES,
      edgeTypes: [["rel", "Hub", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: "H" }, ...hubs.map((k) => ({ type: "Hub", key: k, label: k })), ...tags(30).map((k) => ({ type: "Tag", key: k, label: k }))],
      edges: [...tags(30).map((t) => ({ type: "rel", from: "Hub:h", to: `Tag:${t}` })), ...hubs.map((k) => ({ type: "rel", from: `Hub:${k}`, to: "Tag:t18" }))],
    };
    const { file, hood } = await hoodFor(spec, expand(hoodOf("Hub:h", 20), "Tag:t18"));
    const html = draw(file, hood, "Hub:h");
    expect(attr(html, "data-expanded")).toEqual(["Tag:t18"]);
    // 30 from the centre + 31 into t18 - the one counted from both ends.
    expect(offered(html)).toEqual([["rel", "rel · 60"]]);
    expect(text(html)).not.toContain("“At least”");
  });

  it("is a lower bound that is never above the truth, shown as 'at least n' with the note, when neither end's list holds the other", async () => {
    // h -> e (e = t00, drawn from h), e -> z by `via`, so z is drawn through e. h -> z is the 26th
    // of h's `rel` links (past its first 20); z has 30 hubs a00..a29 and h linking to it, and h is
    // last of those by id: neither list reaches the other.
    const hubs = Array.from({ length: 30 }, (_, i) => `a${pad(i)}`);
    const spec: MosaicSpec = {
      typeProps: TYPES,
      edgeTypes: [["rel", "Hub", "Tag"], ["via", "Tag", "Tag"]],
      nodes: [{ type: "Hub", key: "h", label: "H" }, ...hubs.map((k) => ({ type: "Hub", key: k, label: k })), ...tags(25).map((k) => ({ type: "Tag", key: k, label: k })), { type: "Tag", key: "z", label: "Z" }],
      edges: [
        ...[...tags(25), "z"].map((t) => ({ type: "rel", from: "Hub:h", to: `Tag:${t}` })),
        ...hubs.map((k) => ({ type: "rel", from: `Hub:${k}`, to: "Tag:z" })),
        { type: "via", from: "Tag:t00", to: "Tag:z" },
      ],
    };
    const truth = oracle(spec.edges as E[], new Set(["Hub:h", "Tag:t00", "Tag:z"]));
    expect(truth.get("rel")).toBe(26 + 30);
    const { file, hood } = await hoodFor(spec, expand(expand(hoodOf("Hub:h", 20), "Tag:t00"), "Tag:z"));
    const html = draw(file, hood, "Hub:h");
    expect(attr(html, "data-expanded").sort()).toEqual(["Tag:t00", "Tag:z"]);
    const rel = offered(html).find(([e]) => e === "rel")![1];
    const m = /^rel · at least (\d+)$/.exec(rel);
    expect(m, rel).not.toBeNull();
    const n = Number(m![1]);
    expect(n).toBeLessThanOrEqual(56);
    // Never less than one open thing's own links (z has 31).
    expect(n).toBeGreaterThanOrEqual(31);
    expect(offered(html).find(([e]) => e === "via")![1]).toBe("via · 1");
    expect(text(html)).toContain("“At least”");
  });

  it("never counts above the truth, is exact where it says no 'at least', and shows the note exactly when a count is a bound, for crowded random mosaics", async () => {
    let bounds = 0;
    let exact = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rand = mulberry32(1000 + seed);
      const n = 27;
      const edges = randomEdges(rand, n, ["r", "s"], 0.85);
      const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(2, ["r", "s"]), nodes: nodesN(n), edges };
      const file = await load(spec);
      const centre = `N:n${pad(Math.floor(rand() * n))}`;
      const picks = nodesN(n).map((x) => `N:${x.key}`).filter((i) => i !== centre && rand() < 0.15);
      const hood = await new HoodLoader(file).load(picks.reduce(expand, hoodOf(centre, 20)));
      const html = draw(file, hood, centre);
      // What the page opened: the centre and the expanded things it drew.
      const opened = new Set([centre, ...attr(html, "data-expanded")]);
      const truth = oracle(edges, opened);
      const labels = offered(html);
      expect(labels.map(([e]) => e), `seed ${seed}`).toEqual([...truth.keys()]);
      let anyBound = false;
      for (const [edge, label] of labels) {
        const m = /^(?:\S+) · (at least )?([\d,]+)$/.exec(label);
        expect(m, label).not.toBeNull();
        const shownCount = Number(m![2]!.replaceAll(",", ""));
        const t = truth.get(edge)!;
        if (m![1]) {
          bounds++;
          anyBound = true;
          expect(shownCount, `seed ${seed} ${label}`).toBeLessThanOrEqual(t);
        } else {
          exact++;
          expect(shownCount, `seed ${seed} ${label}`).toBe(t);
        }
        // The provable floor (the kit cannot count a thing's links to itself): the
        // largest single group, out or in, of this type among the things the page opened.
        const floor = Math.max(
          ...[hood.centre, ...hood.expanded].filter((l) => opened.has(l.centre.id)).flatMap((l) => l.groups.filter((g) => g.edge === edge).map((g) => g.count)),
        );
        expect(shownCount, `seed ${seed} ${label}`).toBeGreaterThanOrEqual(floor);
      }
      expect(text(html).includes("“At least”"), `seed ${seed}: the note shows exactly when a count is a bound`).toBe(anyBound);
    }
    expect(bounds + exact).toBeGreaterThan(0);
  });
});

describe("a lower bound is as high as what is known (G-5)", () => {
  it("never shows an 'at least' below the links one open thing has on its own", async () => {
    // Four things, each linked both ways to every other and to 24 more, so that no list holds a
    // pair: whatever the overlap, the centre's own links are all in the picture.
    const rest = Array.from({ length: 24 }, (_, i) => `N:n${pad(i + 4)}`);
    const trio = ["N:n00", "N:n01", "N:n02", "N:n03"];
    const edges: E[] = [
      ...trio.flatMap((a) => trio.filter((b) => b !== a).map((b) => ({ type: "r", from: a, to: b }))),
      ...trio.flatMap((a) => rest.flatMap((b) => [{ type: "r", from: a, to: b }, { type: "r", from: b, to: a }])),
    ];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(28), edges };
    const { file, hood } = await hoodFor(spec, expand(expand(expand(hoodOf("N:n00", 20), "N:n01"), "N:n02"), "N:n03"));
    const html = draw(file, hood, "N:n00");
    expect(attr(html, "data-expanded").sort()).toEqual(["N:n01", "N:n02", "N:n03"]);
    const truth = oracle(edges, new Set(trio)).get("r")!;
    const label = offered(html)[0]![1];
    const n = Number(/(\d[\d,]*)$/.exec(label)![1]!.replaceAll(",", ""));
    const own = oracle(edges, new Set(["N:n00"])).get("r")!;
    expect(n, label).toBeLessThanOrEqual(truth);
    expect(n, label).toBeGreaterThanOrEqual(own);
    if (n < truth) expect(label).toContain("at least");
    else expect(label).not.toContain("at least");
  });
});

describe("the legend line (G-5)", () => {
  it("is there when nothing is expanded, and a thing with no links offers no edge type", async () => {
    const edges: E[] = [{ type: "r", from: "N:n00", to: "N:n01" }];
    const spec: MosaicSpec = { typeProps: TYPES, edgeTypes: oneEdgeType(1), nodes: nodesN(3), edges };
    const plain = await hoodFor(spec, hoodOf("N:n00"));
    expect(text(draw(plain.file, plain.hood, "N:n00"))).toMatch(/counted once/);
    const lone = await hoodFor(spec, hoodOf("N:n02"));
    expect(attr(draw(lone.file, lone.hood, "N:n02"), "data-edge-type")).toEqual([]);
  });
});
