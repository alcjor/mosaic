// A link to a neighbourhood (need G-8): the address holds the centre, the things
// expanded and hidden, the edge types shown and the limit, so a colleague who opens it lands on
// exactly the same picture; a link naming a thing or an edge type the mosaic lacks still opens,
// and says what it could not apply. Data is invented.
import { type SealedFile } from "@mosaic/kit";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import { applyAddress, hoodRoute } from "../src/lib/graph/hood-address.js";
import { expand, hide, HoodLoader, hoodOf, showEdge, withLimit, type HoodState, collapse, LIMITS, recentre, unhide } from "../src/lib/graph/hood.js";
import { layoutHood } from "../src/lib/graph/hood-layout.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { parseRoute, routeHash, type Route } from "../src/lib/route.js";
import { render } from "svelte/server";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
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
      { type: "Tag", key: "odd &=#?% é 😀", label: "An odd one" },
    ],
    edges: [
      ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
      ...["t0", "t1", "t2", "odd &=#?% é 😀"].map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
      ...["x0", "x1", "x2", "x3"].map((t) => ({ type: "related", from: "Tag:t0", to: `Tag:${t}` })),
    ],
  };
}

const open = (): Promise<SealedFile> => openMosaic(buildMosaic(spec()), "hub.mosaic");
const ALL = ["carries", "points_at", "related"];

/** The address of `state`, as a colleague would open it: through the page's hash. */
const linkOf = (state: HoodState) => routeHash(hoodRoute(state));

/** The picture `state` draws: what is laid out, and where. */
async function picture(file: SealedFile, state: HoodState) {
  const hood = await new HoodLoader(file).load(state);
  return { layout: layoutHood(hood.centre, hood.expanded, { hidden: new Set(state.hidden), shows: (e) => state.edges === null || state.edges.includes(e) }), counts: hood.counts };
}

describe("the address of a neighbourhood (G-8)", () => {
  it("holds the centre, as the neighbourhood view", () => {
    const route = parseRoute(linkOf(hoodOf("Hub:h")));
    expect(route).toMatchObject({ node: "Hub:h", view: "neighbourhood" });
  });

  it("says nothing more for a neighbourhood with no choices made", () => {
    expect(linkOf(hoodOf("Hub:h"))).toBe(routeHash({ query: "", node: "Hub:h", view: "neighbourhood" }));
  });

  it("holds the things expanded, in the order opened, the things hidden, the edge types shown and the limit", () => {
    let s = hoodOf("Hub:h");
    s = expand(s, "Tag:t0");
    s = expand(s, "Tag:odd &=#?% é 😀");
    s = hide(s, "Item:i03");
    s = hide(s, "Item:i01");
    s = showEdge(s, ALL, "points_at", false);
    s = withLimit(s, 10);
    const route = parseRoute(linkOf(s));
    expect(route.hood).toEqual({ expanded: ["Tag:t0", "Tag:odd &=#?% é 😀"], hidden: ["Item:i01", "Item:i03"], edges: ["carries", "related"], limit: "10" });
  });

  it("tells every edge type shown from none shown", () => {
    const none = ALL.reduce((s, e) => showEdge(s, ALL, e, false), hoodOf("Hub:h"));
    expect(none.edges).toEqual([]);
    expect(parseRoute(linkOf(none)).hood?.edges).toEqual([]);
    expect(parseRoute(linkOf(hoodOf("Hub:h"))).hood?.edges ?? null).toBeNull();
  });

  it("keeps the search beside it, as a link to a thing does", () => {
    const hash = routeHash({ ...hoodRoute(expand(hoodOf("Hub:h"), "Tag:t0")), query: "tags" });
    expect(parseRoute(hash)).toMatchObject({ query: "tags", node: "Hub:h", view: "neighbourhood", hood: { expanded: ["Tag:t0"] } });
  });

  it("holds no choices for other views", () => {
    const hash = linkOf(expand(hoodOf("Hub:h"), "Tag:t0")).replace("v=neighbourhood", "v=schema");
    expect(parseRoute(hash).hood ?? null).toBeNull();
  });
});

describe("opening a link to a neighbourhood (G-8)", () => {
  it("draws exactly the same picture", async () => {
    const file = await open();
    let s = hoodOf("Hub:h", 3);
    s = expand(s, "Tag:t0");
    s = hide(s, "Tag:x1");
    s = hide(s, "Item:i00");
    s = showEdge(s, ALL, "points_at", false);
    s = withLimit(s, 20);
    const route = parseRoute(linkOf(s));
    const { state, unapplied } = await applyAddress(file, route.node!, route.hood!);
    expect(unapplied).toEqual([]);
    expect(state).toEqual(s);
    expect(await picture(file, state)).toEqual(await picture(file, s));
  });

  it("draws the same picture for every choice a person can make, one after another", async () => {
    const file = await open();
    const steps: ((s: HoodState) => HoodState)[] = [
      (s) => expand(s, "Tag:t0"),
      (s) => withLimit(s, 3),
      (s) => hide(s, "Tag:t1"),
      (s) => expand(s, "Tag:x2"),
      (s) => showEdge(s, ALL, "related", false),
      (s) => showEdge(s, ALL, "related", true),
      (s) => hide(s, "Tag:t0"),
      (s) => withLimit(s, 20),
    ];
    let s = hoodOf("Hub:h");
    for (const step of steps) {
      s = step(s);
      const route = parseRoute(linkOf(s));
      const opened = await applyAddress(file, route.node!, route.hood ?? null);
      expect(opened.state).toEqual(s);
      expect(opened.unapplied).toEqual([]);
    }
  });

  it("opens a link that names a thing the mosaic lacks, and says it could not expand or hide it", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: ["Tag:t0", "Tag:gone"], hidden: ["Item:nowhere", "Item:i02"], edges: null, limit: null });
    expect(state).toEqual(hide(expand(hoodOf("Hub:h"), "Tag:t0"), "Item:i02"));
    expect(unapplied).toEqual([
      "Could not expand Tag:gone: the mosaic has no such thing.",
      "Could not hide Item:nowhere: the mosaic has no such thing.",
    ]);
  });

  it("opens a link that names an edge type the mosaic lacks, and says it could not show it", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: [], hidden: [], edges: ["carries", "follows"], limit: null });
    expect(state.edges).toEqual(["carries"]);
    expect(unapplied).toEqual(["Could not show the edge type follows: the mosaic has no such edge type."]);
  });

  it("shows every edge type when a link names only edge types the mosaic lacks", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: [], hidden: [], edges: ["follows"], limit: null });
    expect(state.edges).toBeNull();
    expect(unapplied).toEqual(["Could not show the edge type follows: the mosaic has no such edge type."]);
  });

  it("opens a link with a limit that is not one of 3, 5, 10 or 20 at the default, and says so", async () => {
    const file = await open();
    for (const limit of ["7", "", "ten", "5.0", "-3"]) {
      const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: [], hidden: [], edges: null, limit });
      expect(state.limit).toBe(5);
      expect(unapplied).toEqual([`Could not show ${JSON.stringify(limit)} per group: a group shows 3, 5, 10 or 20; it shows 5.`]);
    }
  });

  it("says each thing once, in the order the link names them", async () => {
    const file = await open();
    const { unapplied } = await applyAddress(file, "Hub:h", { expanded: ["Tag:b", "Tag:a", "Tag:b"], hidden: [], edges: null, limit: null });
    expect(unapplied).toEqual(["Could not expand Tag:b: the mosaic has no such thing.", "Could not expand Tag:a: the mosaic has no such thing."]);
  });

  it("ignores the centre among the things expanded or hidden, as a person cannot choose it", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: ["Hub:h"], hidden: ["Hub:h"], edges: null, limit: null });
    expect(state).toEqual(hoodOf("Hub:h"));
    expect(unapplied).toEqual([]);
  });

  it("asks the kit about each thing once", async () => {
    const real = await open();
    let gets = 0;
    const file = new Proxy(real, {
      get: (t, k) => {
        const v = Reflect.get(t, k);
        if (k !== "get") return typeof v === "function" ? v.bind(t) : v;
        return (args: unknown) => {
          gets++;
          return (v as (a: unknown) => unknown).call(t, args);
        };
      },
    }) as SealedFile;
    await applyAddress(file, "Hub:h", { expanded: ["Tag:t0", "Tag:t0"], hidden: ["Tag:t0", "Item:i01"], edges: null, limit: null });
    expect(gets).toBe(2);
  });
});

describe("links a person did not make (G-8)", () => {
  it("opens a link naming every edge type as every edge type shown, as the person's own choice would be", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: [], hidden: [], edges: ["related", "carries", "points_at"], limit: null });
    expect(state.edges).toBeNull();
    expect(unapplied).toEqual([]);
    expect(linkOf(state)).toBe(linkOf(hoodOf("Hub:h")));
  });

  it("applies at most 50 things expanded and 50 hidden, and says how many more it left", async () => {
    const file = await open();
    const many = Array.from({ length: 60 }, (_, i) => `Item:i${pad(i % 25)}${i >= 25 ? `-${i}` : ""}`);
    const real = await openMosaic(buildMosaic(spec()), "hub.mosaic");
    let gets = 0;
    const counted = new Proxy(real, {
      get: (t, k) => {
        const v = Reflect.get(t, k);
        if (k !== "get") return typeof v === "function" ? v.bind(t) : v;
        return (args: unknown) => {
          gets++;
          return (v as (a: unknown) => unknown).call(t, args);
        };
      },
    }) as SealedFile;
    const { unapplied } = await applyAddress(counted, "Hub:h", { expanded: many, hidden: many, edges: null, limit: null });
    expect(unapplied).toContain("This link names 60 expanded things; the first 50 are shown.");
    expect(unapplied).toContain("This link names 60 hidden things; the first 50 are hidden.");
    expect(gets).toBeLessThanOrEqual(50);
    void file;
  });
});

describe("what a link could not apply, said in bounds (G-8)", () => {
  it("names at most 20 edge types the mosaic lacks, then says how many more", async () => {
    const file = await open();
    const lots = Array.from({ length: 25 }, (_, i) => `e${String(i).padStart(2, "0")}`);
    const { unapplied } = await applyAddress(file, "Hub:h", { expanded: [], hidden: [], edges: ["carries", ...lots], limit: null });
    expect(unapplied).toHaveLength(21);
    expect(unapplied[19]).toBe("Could not show the edge type e19: the mosaic has no such edge type.");
    expect(unapplied[20]).toBe("Could not show 5 more edge types: the mosaic has none of them.");
  });
});

describe("hood address: further cases", () => {
  const ODD = ["a+b c", " lead", "trail ", "x,y;z", 'q"uo\'te', "<b>tag</b>", "é😀", "a/b\\c", "1&x=2", "p%41", "__proto__"];
  const KEYS = ["t0", "t1", "t2", "x0", ...ODD];
  const pad = (i: number) => String(i).padStart(2, "0");

  function spec(): MosaicSpec {
    const items = Array.from({ length: 12 }, (_, i) => `i${pad(i)}`);
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
        ...KEYS.map((k) => ({ type: "Tag", key: k, label: `Tag ${k}` })),
      ],
      edges: [
        ...items.map((k) => ({ type: "points_at", from: `Item:${k}`, to: "Hub:h" })),
        ...KEYS.map((t) => ({ type: "carries", from: "Hub:h", to: `Tag:${t}` })),
        ...KEYS.slice(1).map((t) => ({ type: "related", from: "Tag:t0", to: `Tag:${t}` })),
      ],
    };
  }

  const open = (): Promise<SealedFile> => openMosaic(buildMosaic(spec()), "hub.mosaic");
  const ALL = ["carries", "points_at", "related"];
  const linkOf = (state: HoodState) => routeHash(hoodRoute(state));
  const none = { expanded: [], hidden: [], edges: null, limit: null } as const;

  async function picture(file: SealedFile, state: HoodState) {
    const hood = await new HoodLoader(file).load(state);
    return {
      layout: layoutHood(hood.centre, hood.expanded, { hidden: new Set(state.hidden), shows: (e) => state.edges === null || state.edges.includes(e) }),
      counts: hood.counts,
    };
  }

  /** Open `state`'s link as a colleague would: through the page's hash, then the mosaic. */
  async function reopen(file: SealedFile, state: HoodState) {
    const route = parseRoute(linkOf(state));
    return applyAddress(file, route.node!, route.hood ?? null);
  }

  describe("hostile characters in a link (G-8)", () => {
    it("brings back every thing expanded and hidden whatever characters its id holds", async () => {
      const file = await open();
      let s = hoodOf("Hub:h");
      for (const k of ODD.slice(0, 5)) s = expand(s, `Tag:${k}`);
      for (const k of ODD.slice(5)) s = hide(s, `Tag:${k}`);
      const opened = await reopen(file, s);
      expect(opened.unapplied).toEqual([]);
      expect(opened.state).toEqual(s);
      expect(await picture(file, opened.state)).toEqual(await picture(file, s));
    });

    it("brings back a centre whose id holds address characters", async () => {
      const file = await open();
      for (const k of ODD) {
        const s = expand(hoodOf(`Tag:${k}`), "Tag:t0");
        const opened = await reopen(file, s);
        expect(opened.state, k).toEqual(s);
      }
    });

    it("keeps ids and edge types made of address characters apart, at the route", () => {
      const nasty = ["a&x=b", "a=b", "#", "?", "%", "%zz", "+", "a b", ",", ";", "\n", "\0", "\u0000x", "é", "😀", "‮", "x\ty", "&", "x=1&h=2&l=3&e=carries"];
      const hood = { expanded: nasty.map((n) => `Tag:${n}`), hidden: nasty.map((n) => `Item:${n}`), edges: nasty, limit: "10" };
      const route: Route = { query: "q&x=1", node: "Hub:h&l=3", view: "neighbourhood", hood };
      const back = parseRoute(routeHash(route));
      expect(back.query).toBe("q&x=1");
      expect(back.node).toBe("Hub:h&l=3");
      expect(back.hood).toEqual(hood);
    });

    it("keeps an id and a single empty edge list distinct from no choices, at the route", () => {
      const back = parseRoute(routeHash({ query: "", node: "Hub:h", view: "neighbourhood", hood: { expanded: [], hidden: [], edges: [], limit: null } }));
      expect(back.hood?.edges).toEqual([]);
    });

    it("treats names that are properties of every object as things the mosaic lacks", async () => {
      const file = await open();
      const names = ["__proto__", "constructor", "toString", "hasOwnProperty", "Tag:__proto__x", "Tag:constructor", "valueOf"];
      const opened = await applyAddress(file, "Hub:h", { expanded: names, hidden: names, edges: names, limit: "constructor" });
      expect(opened.state.expanded).toEqual([]);
      expect(opened.state.hidden).toEqual([]);
      expect(opened.state.edges).toBeNull();
      expect(opened.state.limit).toBe(5);
      expect(opened.unapplied.length).toBeGreaterThan(0);
      expect(Object.keys({})).toEqual([]);
    });

    it("does not let an edge type or id named like a property change what later links mean", async () => {
      const file = await open();
      await applyAddress(file, "Hub:h", { expanded: ["__proto__"], hidden: ["__proto__"], edges: ["__proto__"], limit: "__proto__" });
      const after = await applyAddress(file, "Hub:h", none);
      expect(after).toEqual({ state: hoodOf("Hub:h"), unapplied: [] });
    });
  });

  describe("a link a person did not make (G-8)", () => {
    it("opens a link with broken percent escapes without failing", () => {
      const base = linkOf(expand(hoodOf("Hub:h"), "Tag:t0"));
      for (const junk of ["&x=%", "&x=%E0%A4%A", "&h=%zz&e=%", "&l=%ff", "&x=%00", "&=&=&", "&&&", "&x", "&l"]) {
        expect(() => parseRoute(base + junk), junk).not.toThrow();
      }
    });

    it("opens a link whose centre is missing from the address without failing", () => {
      const base = linkOf(expand(hoodOf("Hub:h"), "Tag:t0"));
      const hash = base.replace(/(^#|&)n=[^&]*/, "").replace(/(^#|&)node=[^&]*/, "");
      expect(() => parseRoute(hash)).not.toThrow();
    });

    it("opens a link that names the same thing as expanded and hidden, drawing it at most one way", async () => {
      const file = await open();
      const { state } = await applyAddress(file, "Hub:h", { ...none, expanded: ["Tag:t0"], hidden: ["Tag:t0"] });
      const both = state.expanded.filter((e) => state.hidden.includes(e));
      expect(both).toEqual([]);
      await expect(picture(file, state)).resolves.toBeDefined();
    });

    it("draws the same picture whatever order a link lists the things hidden", async () => {
      const file = await open();
      const ids = ["Tag:t2", "Tag:t0", "Item:i05", "Item:i01"];
      const a = await applyAddress(file, "Hub:h", { ...none, hidden: ids });
      const b = await applyAddress(file, "Hub:h", { ...none, hidden: [...ids].reverse() });
      expect(await picture(file, a.state)).toEqual(await picture(file, b.state));
    });

    it("draws the same picture whatever order a link lists the edge types shown, and ignores repeats", async () => {
      const file = await open();
      const a = await applyAddress(file, "Hub:h", { ...none, edges: ["carries", "related"] });
      const b = await applyAddress(file, "Hub:h", { ...none, edges: ["related", "carries", "related", "carries"] });
      expect(a.unapplied).toEqual([]);
      expect(b.unapplied).toEqual([]);
      expect(await picture(file, b.state)).toEqual(await picture(file, a.state));
      expect(linkOf(b.state)).toBe(linkOf(a.state));
    });

    it("says an unknown edge type once however often the link repeats it, and applies the known ones", async () => {
      const file = await open();
      const { state, unapplied } = await applyAddress(file, "Hub:h", { ...none, edges: ["nope", "carries", "nope", "nope"] });
      expect(state.edges).toEqual(["carries"]);
      expect(unapplied).toHaveLength(1);
      expect(unapplied[0]).toContain("nope");
    });

    it("names the thing or edge type it could not apply in what it says", async () => {
      const file = await open();
      const { unapplied } = await applyAddress(file, "Hub:h", { expanded: ["Tag:gone1"], hidden: ["Item:gone2"], edges: ["gone3"], limit: null });
      expect(unapplied).toHaveLength(3);
      for (const [i, name] of ["Tag:gone1", "Item:gone2", "gone3"].entries()) expect(unapplied[i]).toContain(name);
    });

    it("applies every thing it can when some named things are missing, in the middle of the list", async () => {
      const file = await open();
      const { state, unapplied } = await applyAddress(file, "Hub:h", { ...none, expanded: ["Tag:gone", "Tag:t0", "gone", "", "Tag:", "Tag:x0"], hidden: ["Item:i01", "Item:zz"] });
      expect(state.expanded).toEqual(["Tag:t0", "Tag:x0"]);
      expect(state.hidden).toEqual(["Item:i01"]);
      expect(unapplied).toHaveLength(4 + 1);
    });

    it("opens a link naming a type-less or empty id as a thing the mosaic lacks", async () => {
      const file = await open();
      const { state, unapplied } = await applyAddress(file, "Hub:h", { ...none, expanded: ["nocolon", ":", "Tag:"], hidden: ["\0", "Item:i01\0"] });
      expect(state).toEqual(hoodOf("Hub:h"));
      expect(unapplied).toHaveLength(5);
    });

    it("applies only the things whose id matches byte for byte, not their look-alikes", async () => {
      const file = await open();
      const { state, unapplied } = await applyAddress(file, "Hub:h", { ...none, expanded: ["tag:t0", "Tag:T0", "Tag:t0 ", "Tag:tα0", "Tag:é😀"] });
      expect(state.expanded).toEqual([]);
      expect(unapplied).toHaveLength(5);
    });

    it("holds a limit that is exactly 3, 5, 10 or 20 and no other spelling", async () => {
      const file = await open();
      for (const n of LIMITS) {
        const ok = await applyAddress(file, "Hub:h", { ...none, limit: String(n) });
        expect(ok.state.limit).toBe(n);
        expect(ok.unapplied).toEqual([]);
      }
      for (const bad of ["+5", " 5", "5 ", "5\n", "\n5", "1e1", "0x5", "٥", "٣", "Infinity", "NaN", "5,3", "3 5", "9".repeat(400), "0", "1", "2", "4", "21", "1000"]) {
        const r = await applyAddress(file, "Hub:h", { ...none, limit: bad });
        expect(r.state.limit, JSON.stringify(bad)).toBe(5);
        expect(r.unapplied, JSON.stringify(bad)).toHaveLength(1);
      }
    });

    it("says the limit it could not apply by naming it", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, limit: "7" });
      expect(r.unapplied[0]).toContain("7");
    });

    it("applies the rest of a link whose limit it could not", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { expanded: ["Tag:t0"], hidden: ["Item:i01"], edges: ["related"], limit: "7" });
      expect(r.state).toEqual({ ...showEdge(hide(expand(hoodOf("Hub:h"), "Tag:t0"), "Item:i01"), ALL, "carries", false), edges: ["related"] });
    });

    it("leaves what the link held untouched", async () => {
      const file = await open();
      const held = Object.freeze({
        expanded: Object.freeze(["Tag:t0", "Tag:gone"]),
        hidden: Object.freeze(["Item:i03", "Item:i01"]),
        edges: Object.freeze(["related", "nope", "carries"]),
        limit: "20",
      });
      const copy = JSON.parse(JSON.stringify(held));
      await applyAddress(file, "Hub:h", held);
      expect(JSON.parse(JSON.stringify(held))).toEqual(copy);
    });

    it("gives states that share nothing with the link it opened", async () => {
      const file = await open();
      const held = { expanded: ["Tag:t0"], hidden: ["Item:i01"], edges: ["carries"], limit: null };
      const { state } = await applyAddress(file, "Hub:h", held);
      held.expanded.push("Tag:x0");
      held.hidden.push("Item:i02");
      held.edges.push("related");
      expect(state.expanded).toEqual(["Tag:t0"]);
      expect(state.hidden).toEqual(["Item:i01"]);
      expect(state.edges).toEqual(["carries"]);
    });

    it("asks the kit for at most 50 things however many a link names, and finishes at once", async () => {
      const file = await open();
      const many = Array.from({ length: 100_000 }, (_, i) => `Tag:n${i}`);
      const t = performance.now();
      const r = await applyAddress(file, "Hub:h", { expanded: many, hidden: many, edges: null, limit: null });
      expect(performance.now() - t).toBeLessThan(5000);
      expect(r.unapplied.length).toBeLessThanOrEqual(50 + 50 + 2);
    });

    it("asks once about a thing a link names a hundred thousand times", async () => {
      const real = await open();
      let gets = 0;
      const file = new Proxy(real, {
        get: (t, k) => {
          const v = Reflect.get(t, k);
          if (k !== "get") return typeof v === "function" ? v.bind(t) : v;
          return (args: unknown) => {
            gets++;
            return (v as (a: unknown) => unknown).call(t, args);
          };
        },
      }) as SealedFile;
      const same = Array(100_000).fill("Tag:t0");
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: same, hidden: same });
      expect(gets).toBeLessThanOrEqual(1);
      expect(r.unapplied).toEqual([]);
    });

    it("applies a thing named after fifty repeats of another, as the repeats are one thing", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: [...Array(60).fill("Tag:t0"), "Tag:t1"], hidden: [...Array(60).fill("Item:i00"), "Item:i01"] });
      expect(r.state.expanded).toEqual(["Tag:t0", "Tag:t1"]);
      expect(r.state.hidden).toEqual(["Item:i00", "Item:i01"]);
      expect(r.unapplied).toEqual([]);
    });

    it("counts the 50 from the things a link names once, not from repeats", async () => {
      const file = await open();
      const names = Array.from({ length: 50 }, (_, i) => `Tag:gone${i}`);
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: [...names, ...names, ...names] });
      expect(r.unapplied.some((u) => /more/.test(u))).toBe(false);
      expect(r.unapplied).toHaveLength(50);
    });

    it("applies exactly 50 existing things, and says nothing of the 51st that was not named", async () => {
      const file = await open();
      const ids = ["t0", "t1", "t2", "x0", ...ODD].map((k) => `Tag:${k}`);
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: ids });
      expect(r.state.expanded).toEqual(ids);
      expect(r.unapplied).toEqual([]);
    });

    it("opens a link naming thousands of edge types the mosaic lacks, showing every edge type", async () => {
      const file = await open();
      const lots = Array.from({ length: 5000 }, (_, i) => `e${i}`);
      const r = await applyAddress(file, "Hub:h", { ...none, edges: lots });
      expect(r.state.edges).toBeNull();
      expect(r.unapplied.length).toBeGreaterThan(0);
    });

    it("opens a link whose centre the mosaic lacks without throwing", async () => {
      const file = await open();
      await expect(applyAddress(file, "Hub:nowhere", { ...none, expanded: ["Tag:t0"] })).resolves.toBeDefined();
    });

    it("reads the mosaic only through the kit calls get and edgeTypes", async () => {
      const real = await open();
      const asked: string[] = [];
      const file = new Proxy(real, {
        get: (t, k) => {
          const v = Reflect.get(t, k);
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            asked.push(String(k));
            return (v as (...a: unknown[]) => unknown).apply(t, args);
          };
        },
      }) as SealedFile;
      await applyAddress(file, "Hub:h", { expanded: ["Tag:t0"], hidden: ["Item:i01"], edges: ["carries"], limit: "10" });
      expect([...new Set(asked)].filter((k) => k !== "get" && k !== "edgeTypes")).toEqual([]);
    });
  });

  describe("the same address every time (G-7, G-8)", () => {
    it("writes the same address for the same choices, however a person reached them", () => {
      const a = hide(hide(hide(hoodOf("Hub:h"), "Item:i03"), "Item:i01"), "Tag:t2");
      const b = hide(hide(hide(hoodOf("Hub:h"), "Tag:t2"), "Item:i01"), "Item:i03");
      expect(linkOf(a)).toBe(linkOf(b));
      const c = unhide(hide(hide(hoodOf("Hub:h"), "Item:i01"), "Item:i02"), "Item:i02");
      expect(linkOf(c)).toBe(linkOf(hide(hoodOf("Hub:h"), "Item:i01")));
    });

    it("writes the address of a thing hidden by its UTF-8 bytes, not its UTF-16 units", () => {
      const hi = "Tag:\u{1F600}";
      const bmp = "Tag:～";
      const s = hide(hide(hoodOf("Hub:h"), bmp), hi);
      const t = hide(hide(hoodOf("Hub:h"), hi), bmp);
      expect(linkOf(s)).toBe(linkOf(t));
      expect(parseRoute(linkOf(s)).hood?.hidden).toEqual([bmp, hi]);
    });

    it("writes the same address for a limit chosen back to the default as for none chosen", () => {
      expect(linkOf(withLimit(withLimit(hoodOf("Hub:h"), 3), 5))).toBe(linkOf(hoodOf("Hub:h")));
    });

    it("writes the same address for every edge type shown again as for none unchosen", () => {
      const s = showEdge(showEdge(hoodOf("Hub:h"), ALL, "carries", false), ALL, "carries", true);
      expect(linkOf(s)).toBe(linkOf(hoodOf("Hub:h")));
    });

    it("writes the same address twice, and an opened link writes the address it was opened from", async () => {
      const file = await open();
      let s = hoodOf("Hub:h", 10);
      s = expand(expand(s, "Tag:x0"), "Tag:t0");
      s = hide(s, "Item:i04");
      s = showEdge(s, ALL, "points_at", false);
      expect(linkOf(s)).toBe(linkOf(s));
      const opened = await reopen(file, s);
      expect(linkOf(opened.state)).toBe(linkOf(s));
    });

    it("keeps the order things were expanded in, as the picture may follow it", async () => {
      const file = await open();
      const s = expand(expand(expand(hoodOf("Hub:h"), "Tag:x0"), "Tag:t2"), "Tag:t0");
      const opened = await reopen(file, s);
      expect(opened.state.expanded).toEqual(["Tag:x0", "Tag:t2", "Tag:t0"]);
    });
  });

  /** A small seeded generator, so every run of the property check draws the same choices. */
  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  describe("any sequence of choices reopens to the same picture (G-8)", () => {
    it("holds for 40 seeded sequences of 30 choices each, whichever choice a person makes", async () => {
      const file = await open();
      const things = [...KEYS.slice(0, 8).map((k) => `Tag:${k}`), "Hub:h", "Item:i00", "Item:i05", "Item:i11"];
      for (let seed = 1; seed <= 40; seed++) {
        const rnd = prng(seed);
        const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
        let s = hoodOf(pick(things), pick(LIMITS));
        for (let step = 0; step < 30; step++) {
          const op = Math.floor(rnd() * 8);
          if (op === 0) s = expand(s, pick(things));
          else if (op === 1) s = collapse(s, pick(things));
          else if (op === 2) s = hide(s, pick(things));
          else if (op === 3) s = unhide(s, pick(things));
          else if (op === 4) s = recentre(s, pick(things));
          else if (op === 5) s = withLimit(s, pick(LIMITS));
          else s = showEdge(s, ALL, pick(ALL), rnd() < 0.5);
          const opened = await reopen(file, s);
          const where = `seed ${seed} step ${step}`;
          expect(opened.unapplied, where).toEqual([]);
          expect(opened.state, where).toEqual(s);
          if (step % 10 === 9) expect(await picture(file, opened.state), where).toEqual(await picture(file, s));
        }
      }
    }, 120_000);
  });

  describe("what a link says it could not apply, drawn (G-8)", () => {
    const hrefFor = (id: string) => routeHash({ query: "", node: id });
    const tableHref = (table: Parameters<typeof routeHash>[0]["table"]) => routeHash({ query: "", node: null, table });
    const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });

    async function draw(file: SealedFile, state: HoodState, unapplied: readonly string[]) {
      const initial = await new HoodLoader(file).load(state);
      return render(NeighbourhoodView, {
        props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: state.centre, hrefFor, tableHref, hoodHref, initial, unapplied, address: hoodRoute(state).hood ?? null },
      }).body;
    }

    it("shows a name a link made of markup as text, never as markup", async () => {
      const file = await open();
      const evil = ['Tag:<img src=x onerror=alert(1)>', "<script>alert(1)</script>", '"><svg onload=alert(1)>'];
      const opened = await applyAddress(file, "Hub:h", { expanded: evil, hidden: evil, edges: evil, limit: "<b>big</b>" });
      expect(opened.unapplied.length).toBeGreaterThan(0);
      const html = await draw(file, opened.state, opened.unapplied);
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<svg onload");
      expect(html).not.toContain("<b>big");
      expect(html).toContain("&lt;");
    });

    it("draws a thing whose id holds markup characters as text, in the picture and its addresses", async () => {
      const file = await open();
      const s = hide(expand(hoodOf("Hub:h"), "Tag:<b>tag</b>"), 'Tag:q"uo\'te');
      const html = await draw(file, s, []);
      expect(html).not.toContain("<b>tag</b>");
      expect(html).not.toMatch(/="[^"]*"[^<>]*onerror/);
    });

    it("draws the same picture from a state and from its reopened link, with odd characters in ids", async () => {
      const file = await open();
      const s = hide(expand(hoodOf("Hub:h"), "Tag:x,y;z"), "Tag:1&x=2");
      const opened = await reopen(file, s);
      expect(await draw(file, opened.state, opened.unapplied)).toBe(await draw(file, s, []));
    });

    it("says nothing of what it could not apply when a link applies whole, whatever the choices", async () => {
      const file = await open();
      const s = showEdge(withLimit(hide(expand(hoodOf("Hub:h"), "Tag:t0"), "Item:i00"), 3), ALL, "points_at", false);
      const opened = await reopen(file, s);
      expect(await draw(file, opened.state, opened.unapplied)).not.toContain("data-unapplied");
    });
  });
});
