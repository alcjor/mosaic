// The bound on choices a neighbourhood holds (G-8, G-10):
// a person can expand at most 50 things and hide at most 50 things in one neighbourhood;
// the page applies the same bound when it makes a picture and when it reads a link, so every link
// a person can make reopens as exactly the same picture. At the bound the control that would go
// past it is disabled, with a short note saying why; a longer link written by hand opens the first
// 50 of each list in its order and says so. Data is invented.
import { type SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
import { applyAddress, hoodRoute } from "../src/lib/graph/hood-address.js";
import { expand, hide, HoodLoader, hoodOf, MOST_EXPANDED, MOST_HIDDEN, type HoodState, collapse, recentre, showEdge, unhide, withLimit, LIMITS } from "../src/lib/graph/hood.js";
import { layoutHood } from "../src/lib/graph/hood-layout.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { parseRoute, routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, Shape } from "../src/lib/view.js";

const pad = (i: number) => String(i).padStart(3, "0");
const N = 130;

/** A hub that carries 130 tags. */
function spec(): MosaicSpec {
  return {
    typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [["carries", "Hub", "Tag"]],
    nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...Array.from({ length: N }, (_, i) => ({ type: "Tag", key: `t${pad(i)}`, label: `Tag ${pad(i)}` }))],
    edges: Array.from({ length: N }, (_, i) => ({ type: "carries", from: "Hub:h", to: `Tag:t${pad(i)}` })),
  };
}

const tag = (i: number) => `Tag:t${pad(i)}`;
const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "explore" });
const open = (): Promise<SealedFile> => openMosaic(buildMosaic(spec()), "hub.mosaic");

/** `n` things expanded, one after another, from the first. */
const expanded = (n: number, from = 0) => Array.from({ length: n }, (_, i) => tag(from + i)).reduce(expand, hoodOf("Hub:h", 20));
/** `n` things hidden, one after another, from the first. */
const hidden = (n: number, from = 0) => Array.from({ length: n }, (_, i) => tag(from + i)).reduce(hide, hoodOf("Hub:h", 20));

async function picture(file: SealedFile, state: HoodState) {
  const hood = await new HoodLoader(file).load(state);
  return layoutHood(hood.centre, hood.expanded, { hidden: new Set(state.hidden), shows: () => true });
}

async function reopened(file: SealedFile, state: HoodState) {
  const route = parseRoute(routeHash(hoodRoute(state)));
  return applyAddress(file, route.node!, route.hood ?? null);
}

async function draw(file: SealedFile, state: HoodState, selected: string) {
  const initial = await new HoodLoader(file).load(state);
  const html = render(NeighbourhoodView, {
    props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: "Hub:h", hrefFor, tableHref, hoodHref, initial, selected },
  }).body;
  return html.slice(html.indexOf('aria-label="Selection"'));
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
/** The button of `action` in the panel, as markup. */
const button = (panel: string, action: string) => panel.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] ?? "";

describe("the bound, one for making a picture and for reading a link (G-8)", () => {
  it("is 50 expanded and 50 hidden", () => {
    expect(MOST_EXPANDED).toBe(50);
    expect(MOST_HIDDEN).toBe(50);
  });

  it("a picture with 50 things expanded reopens through its link as exactly the same picture", async () => {
    const file = await open();
    const made = expanded(50);
    expect(made.expanded).toHaveLength(50);
    const { state, unapplied } = await reopened(file, made);
    expect(unapplied).toEqual([]);
    expect(state).toEqual(made);
    expect(await picture(file, state)).toEqual(await picture(file, made));
  });

  it("a picture with 50 things hidden reopens through its link as exactly the same picture", async () => {
    const file = await open();
    const made = hidden(50);
    const { state, unapplied } = await reopened(file, made);
    expect(unapplied).toEqual([]);
    expect(state).toEqual(made);
    expect(await picture(file, state)).toEqual(await picture(file, made));
  });

  it("a person cannot expand a 51st thing: the choice changes nothing", () => {
    const at = expanded(50);
    expect(expand(at, tag(50))).toEqual(at);
    // Collapsing one makes room for another.
    const room = { ...at, expanded: at.expanded.slice(1) };
    expect(expand(room, tag(50)).expanded).toHaveLength(50);
  });

  it("a person cannot hide a 51st thing: the choice changes nothing", () => {
    const at = hidden(50);
    expect(hide(at, tag(50))).toEqual(at);
  });

  it("every picture a person can make, however many choices, reopens as the same picture", async () => {
    const file = await open();
    let s = hoodOf("Hub:h", 20);
    for (let i = 0; i < N; i++) s = i % 3 === 2 ? hide(s, tag(i)) : expand(s, tag(i));
    expect(s.expanded.length).toBeLessThanOrEqual(50);
    expect(s.hidden.length).toBeLessThanOrEqual(50);
    const { state, unapplied } = await reopened(file, s);
    expect(unapplied).toEqual([]);
    expect(state).toEqual(s);
  });
});

describe("at the bound, in the view (G-8, G-11)", () => {
  it("keeps Collapse of a thing expanded working at the bound", async () => {
    const file = await open();
    const panel = await draw(file, expanded(50), tag(3));
    expect(button(panel, "collapse")).not.toMatch(/\sdisabled(=""|\s|>)/);
    expect(text(panel)).not.toContain("At most 50 expanded");
  });
});

describe("a longer link, written by hand (G-8, G-10)", () => {
  it("opens the first 50 expanded things in the link's order, and says so", async () => {
    const file = await open();
    const order = Array.from({ length: 60 }, (_, i) => tag(59 - i));
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: order, hidden: [], edges: null, limit: "20" });
    expect(state.expanded).toEqual(order.slice(0, 50));
    expect(unapplied).toEqual(["This link names 60 expanded things; the first 50 are shown."]);
  });

  it("hides the first 50 hidden things in the link's order, and says so", async () => {
    const file = await open();
    const order = Array.from({ length: 60 }, (_, i) => tag(59 - i));
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: [], hidden: order, edges: null, limit: "20" });
    expect(state.hidden).toEqual([...order.slice(0, 50)].sort());
    expect(unapplied).toEqual(["This link names 60 hidden things; the first 50 are hidden."]);
  });
});

describe("hood bound: further cases", () => {
  const pad = (i: number) => String(i).padStart(3, "0");
  const N = 130;
  const tag = (i: number) => `Tag:t${pad(i)}`;
  const none = { expanded: [], hidden: [], edges: null, limit: null } as const;

  /** A hub that carries 130 tags, and the tags relate to one another a little. */
  function spec(): MosaicSpec {
    return {
      typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [
        ["carries", "Hub", "Tag"],
        ["related", "Tag", "Tag"],
      ],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...Array.from({ length: N }, (_, i) => ({ type: "Tag", key: `t${pad(i)}`, label: `Tag ${pad(i)}` }))],
      edges: [
        ...Array.from({ length: N }, (_, i) => ({ type: "carries", from: "Hub:h", to: tag(i) })),
        ...Array.from({ length: N - 1 }, (_, i) => ({ type: "related", from: tag(i), to: tag(i + 1) })),
      ],
    };
  }

  const open = (): Promise<SealedFile> => openMosaic(buildMosaic(spec()), "hub.mosaic");
  const linkOf = (state: HoodState) => routeHash(hoodRoute(state));

  async function picture(file: SealedFile, state: HoodState) {
    const hood = await new HoodLoader(file).load(state);
    return {
      layout: layoutHood(hood.centre, hood.expanded, { hidden: new Set(state.hidden), shows: (e) => state.edges === null || state.edges.includes(e) }),
      counts: hood.counts,
    };
  }

  async function reopened(file: SealedFile, state: HoodState) {
    const route = parseRoute(linkOf(state));
    return applyAddress(file, route.node!, route.hood ?? null);
  }

  /** Open a hand-written link: the page's hash, then the mosaic. */
  async function openHash(file: SealedFile, hash: string) {
    const route = parseRoute(hash);
    return applyAddress(file, route.node!, route.hood ?? null);
  }

  const enc = encodeURIComponent;
  const hand = (centre: string, parts: { x?: readonly string[]; h?: readonly string[]; e?: readonly string[]; l?: string }) =>
    `#node=${enc(centre)}&v=explore` +
    (parts.x ?? []).map((v) => `&x=${enc(v)}`).join("") +
    (parts.h ?? []).map((v) => `&h=${enc(v)}`).join("") +
    (parts.e ?? []).map((v) => `&e=${enc(v)}`).join("") +
    (parts.l === undefined ? "" : `&l=${enc(parts.l)}`);

  const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => tag(from + i));

  describe("a person's choices at the bound (G-8)", () => {
    const full = (from = 0) => range(50, from).reduce(expand, hoodOf("Hub:h", 20));
    const fullHidden = (from = 0) => range(50, from).reduce(hide, hoodOf("Hub:h", 20));

    it("expanding a thing already expanded, at the bound, changes nothing", () => {
      const at = full();
      expect(expand(at, tag(7))).toEqual(at);
    });

    it("hiding a thing already hidden, at the bound, changes nothing", () => {
      const at = fullHidden();
      expect(hide(at, tag(7))).toEqual(at);
    });

    it("collapsing one thing at the bound makes room for exactly one more, and the order of the rest is kept", () => {
      const at = full();
      const room = expand(collapse(at, tag(10)), tag(99));
      expect(room.expanded).toEqual([...at.expanded.filter((e) => e !== tag(10)), tag(99)]);
      expect(expand(room, tag(100))).toEqual(room);
    });

    it("showing one hidden thing again at the bound makes room for exactly one more", () => {
      const at = fullHidden();
      const room = hide(unhide(at, tag(10)), tag(99));
      expect(room.hidden).toHaveLength(50);
      expect(room.hidden).toContain(tag(99));
      expect(room.hidden).not.toContain(tag(10));
      expect(hide(room, tag(100))).toEqual(room);
    });

    it("the two bounds are independent: 50 expanded still lets a person hide, and the other way round", () => {
      expect(hide(full(), tag(99)).hidden).toEqual([tag(99)]);
      expect(expand(fullHidden(), tag(99)).expanded).toEqual([tag(99)]);
    });

    it("the bounds are as many as a link holds, not fewer: 50 expanded and 50 hidden together reopen unchanged", async () => {
      const file = await open();
      const both = range(50, 60).reduce(hide, full());
      expect(both.expanded).toHaveLength(50);
      expect(both.hidden).toHaveLength(50);
      const { state, unapplied } = await reopened(file, both);
      expect(unapplied).toEqual([]);
      expect(state).toEqual(both);
      expect(await picture(file, state)).toEqual(await picture(file, both));
    });

    it("the bound is the exported numbers, and a state never holds more than them", () => {
      let s = hoodOf("Hub:h", 20);
      for (let i = 0; i < N; i++) s = expand(s, tag(i));
      for (let i = 0; i < N; i++) s = hide(s, tag(i));
      expect(s.expanded.length).toBeLessThanOrEqual(MOST_EXPANDED);
      expect(s.hidden.length).toBeLessThanOrEqual(MOST_HIDDEN);
      expect(s.expanded.filter((e) => s.hidden.includes(e))).toEqual([]);
    });

    it("changes nothing about the choices when a person makes a refused choice, not even the order of the lists", () => {
      const at = range(50, 20).reduce(expand, hoodOf("Hub:h", 3));
      const before = JSON.stringify(at);
      expand(at, tag(0));
      expect(JSON.stringify(at)).toBe(before);
    });
  });

  /** A small seeded generator, so every run draws the same choices. */
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

  describe("every link a person can make reopens as exactly the same picture, at and past the bound (G-8)", () => {
    it("holds along 4 seeded walks of 360 choices over 130 things, which cross the bound again and again", async () => {
      const file = await open();
      const things = [...range(N), "Hub:h"];
      for (let seed = 1; seed <= 4; seed++) {
        const rnd = prng(seed * 7919);
        const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
        let s = hoodOf("Hub:h", pick(LIMITS));
        let atBound = 0;
        for (let step = 0; step < 360; step++) {
          // The first 200 choices only grow the lists, so the walk reaches the bound; then all kinds.
          const op = step < 200 ? (rnd() < 0.5 ? 0.1 : 0.5) : rnd();
          if (op < 0.35) s = expand(s, pick(things));
          else if (op < 0.65) s = hide(s, pick(things));
          else if (op < 0.75) s = collapse(s, pick(things));
          else if (op < 0.85) s = unhide(s, pick(things));
          else if (op < 0.9) s = recentre(s, pick(things));
          else if (op < 0.95) s = withLimit(s, pick(LIMITS));
          else s = showEdge(s, ["carries", "related"], pick(["carries", "related"]), rnd() < 0.5);
          const where = `seed ${seed} step ${step}`;
          expect(s.expanded.length, where).toBeLessThanOrEqual(50);
          expect(s.hidden.length, where).toBeLessThanOrEqual(50);
          if (s.expanded.length === 50 || s.hidden.length === 50) atBound++;
          if (step < 190 && step % 5 !== 4) continue; // the growth phase reopens every fifth choice
          const opened = await reopened(file, s);
          expect(opened.unapplied, where).toEqual([]);
          expect(opened.state, where).toEqual(s);
          if (step % 50 === 49) expect(await picture(file, opened.state), where).toEqual(await picture(file, s));
        }
        expect(atBound, `seed ${seed} met the bound`).toBeGreaterThan(0);
      }
    }, 120_000);
  });

  describe("a longer link, written by hand (G-8, G-10)", () => {
    it("says nothing at exactly 50 names, and says so at 51, naming how many it holds", async () => {
      const file = await open();
      const fifty = await applyAddress(file, "Hub:h", { ...none, expanded: range(50), hidden: range(50, 60) });
      expect(fifty.unapplied).toEqual([]);
      expect(fifty.state.expanded).toHaveLength(50);
      expect(fifty.state.hidden).toHaveLength(50);

      const more = await applyAddress(file, "Hub:h", { ...none, expanded: range(51), hidden: range(51, 60) });
      expect(more.state.expanded).toHaveLength(50);
      expect(more.state.hidden).toHaveLength(50);
      expect(more.unapplied).toHaveLength(2);
      expect(more.unapplied.some((u) => u.includes("51") && u.includes("50") && /expanded/.test(u))).toBe(true);
      expect(more.unapplied.some((u) => u.includes("51") && u.includes("50") && /hidden/.test(u))).toBe(true);
    });

    it("bounds each list on its own: 60 expanded with 3 hidden says only of the expanded", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: range(60), hidden: range(3, 100) });
      expect(r.state.expanded).toEqual(range(50));
      expect(r.state.hidden).toEqual(range(3, 100));
      expect(r.unapplied).toHaveLength(1);
      expect(r.unapplied[0]).toMatch(/expanded/);
    });

    it("takes the first 50 in the order the hash gives them, for both lists, written by hand", async () => {
      const file = await open();
      const ex = range(60).reverse();
      const hi = range(70, 60).reverse();
      const r = await openHash(file, hand("Hub:h", { x: ex, h: hi }));
      expect(r.state.expanded).toEqual(ex.slice(0, 50));
      expect([...r.state.hidden].sort()).toEqual(hi.slice(0, 50).sort());
      expect(r.unapplied).toHaveLength(2);
    });

    it("takes the first 50 of a hash whose lists are not in canonical order, whatever order the parser keeps", async () => {
      const file = await open();
      // Written shuffled by a deterministic stride, so the first 50 are scattered over the 130 things.
      const order = Array.from({ length: N }, (_, i) => tag((i * 37) % N));
      const r = await openHash(file, hand("Hub:h", { x: order }));
      expect(r.state.expanded).toEqual(order.slice(0, 50));
      const h = await openHash(file, hand("Hub:h", { h: order }));
      expect([...h.state.hidden].sort()).toEqual(order.slice(0, 50).sort());
    });

    it("counts a thing the link names twice as one, in the number it says", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: [...range(55), ...range(10)] });
      expect(r.state.expanded).toEqual(range(50));
      expect(r.unapplied).toHaveLength(1);
      expect(r.unapplied[0]).toContain("55");
      expect(r.unapplied[0]).not.toContain("65");
    });

    it("says the true number of things a very long link names", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: Array.from({ length: 5000 }, (_, i) => `Tag:n${i}`) });
      expect(r.state.expanded).toEqual([]);
      expect(r.unapplied.some((u) => u.includes("5000") && u.includes("50"))).toBe(true);
    });

    it("applies the rest of a long link in full: centre, edge types and limit", async () => {
      const file = await open();
      const r = await openHash(file, hand("Tag:t125", { x: range(60), h: range(60, 60), e: ["related", "nope"], l: "3" }));
      expect(r.state.centre).toBe("Tag:t125");
      expect(r.state.limit).toBe(3);
      expect(r.state.edges).toEqual(["related"]);
      expect(r.state.expanded).toEqual(range(50));
      expect(r.state.hidden).toHaveLength(50);
      // The bound notes, plus the one unknown edge type.
      expect(r.unapplied).toHaveLength(3);
      expect(r.unapplied.some((u) => u.includes("nope"))).toBe(true);
    });

    it("keeps a limit the link could not apply apart from the bound, saying each once", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: range(60), limit: "7" });
      expect(r.state.limit).toBe(5);
      expect(r.unapplied).toHaveLength(2);
      expect(r.unapplied.some((u) => u.includes("7"))).toBe(true);
      expect(r.unapplied.some((u) => /expanded/.test(u))).toBe(true);
    });

    it("still names every thing it lacks among the first 50, and applies the others", async () => {
      const file = await open();
      const names = [...range(20), ...Array.from({ length: 5 }, (_, i) => `Tag:gone${i}`), ...range(40, 20)];
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: names });
      for (let i = 0; i < 5; i++) expect(r.unapplied.some((u) => u.includes(`Tag:gone${i}`))).toBe(true);
      expect(r.unapplied.some((u) => u.includes("65") && u.includes("50"))).toBe(true);
      expect(r.state.expanded.length).toBeLessThanOrEqual(50);
      // Whatever the reading of "the first 50", the first 20 things before any gap are opened in order.
      expect(r.state.expanded.slice(0, 20)).toEqual(range(20));
      // What opens is in the link's order and has no thing the mosaic lacks.
      const index = (id: string) => names.indexOf(id);
      for (let i = 1; i < r.state.expanded.length; i++) expect(index(r.state.expanded[i]!)).toBeGreaterThan(index(r.state.expanded[i - 1]!));
      expect(r.state.expanded.some((id) => id.includes("gone"))).toBe(false);
    });

    it("opens a thing named in both lists as at most one of the two, within both bounds", async () => {
      const file = await open();
      const r = await applyAddress(file, "Hub:h", { ...none, expanded: range(60), hidden: range(60, 30) });
      expect(r.state.expanded.length).toBeLessThanOrEqual(50);
      expect(r.state.hidden.length).toBeLessThanOrEqual(50);
      expect(r.state.expanded.filter((e) => r.state.hidden.includes(e))).toEqual([]);
      expect(r.unapplied.length).toBeGreaterThan(0);
    });

    it("opens the same state and says the same things every time it is opened", async () => {
      const file = await open();
      const held = { ...none, expanded: range(70, 5), hidden: [...range(70, 60)].reverse(), edges: ["related", "carries"], limit: "10" };
      const a = await applyAddress(file, "Hub:h", held);
      const b = await applyAddress(file, "Hub:h", held);
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    });

    it("opens a link whose 50 were made by it as a link of its own, without saying it again", async () => {
      const file = await open();
      const first = await applyAddress(file, "Hub:h", { ...none, expanded: range(80), hidden: range(80, 80) });
      expect(first.unapplied.length).toBeGreaterThan(0);
      const again = await reopened(file, first.state);
      expect(again.unapplied).toEqual([]);
      expect(again.state).toEqual(first.state);
      expect(await picture(file, again.state)).toEqual(await picture(file, first.state));
    });

    it("does not touch the list the link held", async () => {
      const file = await open();
      const held = Object.freeze({ expanded: Object.freeze(range(60)), hidden: Object.freeze(range(60, 60)), edges: null, limit: null });
      await expect(applyAddress(file, "Hub:h", held)).resolves.toBeDefined();
      expect(held.expanded).toHaveLength(60);
    });

    it("draws, from the state of a long link, a picture with no more than 50 of each", async () => {
      const file = await open();
      const { state } = await applyAddress(file, "Hub:h", { ...none, expanded: range(120), hidden: range(120, 10) });
      const hood = await new HoodLoader(file).load(state);
      expect(hood.expanded.length).toBeLessThanOrEqual(50);
    });
  });

  describe("a link that names a great many things never stalls the page (G-8, G-10)", () => {
    it("parses, applies and loads a hash with 100000 expanded and 100000 hidden names within seconds", async () => {
      const file = await open();
      const many = Array.from({ length: 100_000 }, (_, i) => `Tag:t${pad(i % N)}-${i}`);
      const hash = hand("Hub:h", { x: many, h: many });
      const t = performance.now();
      const r = await openHash(file, hash);
      await new HoodLoader(file).load(r.state);
      expect(performance.now() - t).toBeLessThan(10_000);
      expect(r.state.expanded.length).toBeLessThanOrEqual(50);
      expect(r.unapplied.some((u) => u.includes("100000"))).toBe(true);
    }, 60_000);

    it("keeps a link of 100000 names of real things to 50 asked of the mosaic per list", async () => {
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
      // Distinct names, all of real things: the ids cycle, so only 130 are distinct. 60 distinct real ones first.
      const names = [...range(N), ...Array.from({ length: 5000 }, (_, i) => `Tag:x${i}`)];
      await applyAddress(file, "Hub:h", { ...none, expanded: names, hidden: names });
      // The centre, and at most the first 50 of each list.
      expect(gets).toBeLessThanOrEqual(1 + 50 + 50);
    });

    it("opens 50 expanded things with a real fan-out within seconds", async () => {
      // 55 hubs with 800 members each: the busiest things are far past what a picture can show whole.
      const hubs = 56;
      const per = 800;
      const big: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [
          ...Array.from({ length: hubs }, (_, i) => ({ type: "Hub", key: `h${pad(i)}`, label: `Hub ${pad(i)}` })),
          ...Array.from({ length: per * 2 }, (_, i) => ({ type: "Tag", key: `m${i}`, label: `Member ${i}` })),
        ],
        edges: Array.from({ length: hubs }, (_, h) => Array.from({ length: per }, (_, i) => ({ type: "carries", from: `Hub:h${pad(h)}`, to: `Tag:m${(h * 13 + i) % (per * 2)}` }))).flat(),
      };
      const file = await openMosaic(buildMosaic(big), "big.mosaic");
      const hash = hand("Hub:h000", { x: Array.from({ length: hubs - 1 }, (_, i) => `Hub:h${pad(i + 1)}`), h: Array.from({ length: 60 }, (_, i) => `Tag:m${i}`), l: "20" });
      const t = performance.now();
      const r = await openHash(file, hash);
      const hood = await new HoodLoader(file).load(r.state);
      const laid = layoutHood(hood.centre, hood.expanded, { hidden: new Set(r.state.hidden), shows: () => true });
      expect(performance.now() - t).toBeLessThan(15_000);
      expect(r.state.expanded).toHaveLength(50);
      expect(r.state.hidden).toHaveLength(50);
      expect(r.unapplied).toHaveLength(2);
      expect(laid).toBeDefined();
    }, 120_000);
  });

  describe("long ids at the bound (G-8)", () => {
    it("brings 50 expanded and 50 hidden things back whose ids are hundreds of characters of address characters", async () => {
      const odd = (i: number) => `k${i}-` + "&=+% ,;#?é😀\n\t".repeat(12);
      const items = Array.from({ length: 110 }, (_, i) => odd(i));
      const big: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...items.map((k) => ({ type: "Tag", key: k, label: `Tag ${k.slice(0, 4)}` }))],
        edges: items.map((k) => ({ type: "carries", from: "Hub:h", to: `Tag:${k}` })),
      };
      const file = await openMosaic(buildMosaic(big), "odd.mosaic");
      let s = hoodOf("Hub:h", 10);
      for (const k of items.slice(0, 50)) s = expand(s, `Tag:${k}`);
      for (const k of items.slice(50, 100)) s = hide(s, `Tag:${k}`);
      expect(s.expanded).toHaveLength(50);
      expect(s.hidden).toHaveLength(50);
      const { state, unapplied } = await reopened(file, s);
      expect(unapplied).toEqual([]);
      expect(state).toEqual(s);
      expect(linkOf(state)).toBe(linkOf(s));
    });
  });

  describe("at the bound, in the view (G-8, G-11)", () => {
    const hrefFor = (id: string) => routeHash({ query: "", node: id });
    const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
    const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "explore" });
    const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const button = (html: string, action: string) => html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] ?? "";
    const isDisabled = (b: string) => /\sdisabled(=""|\s|>)/.test(b);
    const NOTE_EXPANDED = "At most 50 unfolded: fold one to unfold another.";
    const NOTE_HIDDEN = "At most 50 hidden: show one again to hide another.";

    async function draw(file: SealedFile, state: HoodState, selected: string | null, unapplied: readonly string[] = []) {
      const initial = await new HoodLoader(file).load(state);
      return render(NeighbourhoodView, {
        props: { file, shape: new Shape(DEFAULT_VIEW, file), centre: state.centre, hrefFor, tableHref, hoodHref, initial, selected, unapplied, address: hoodRoute(state).hood ?? null },
      }).body;
    }
    const panelOf = (html: string) => html.slice(html.indexOf('aria-label="Selection"'));

    // Fifty things expanded and fifty hidden, none of them in the 20 drawn of the group.
    const atBoth = () => range(50, 80).reduce(hide, range(50, 30).reduce(expand, hoodOf("Hub:h", 20)));

    it("disables both Expand and Hide at both bounds, each with its own note, described by the right id", async () => {
      const file = await open();
      const panel = panelOf(await draw(file, atBoth(), tag(0)));
      const ex = button(panel, "expand");
      const hi = button(panel, "hide");
      expect(isDisabled(ex)).toBe(true);
      expect(isDisabled(hi)).toBe(true);
      const idEx = ex.match(/aria-describedby="([^"]+)"/)?.[1];
      const idHi = hi.match(/aria-describedby="([^"]+)"/)?.[1];
      expect(idEx).toBeDefined();
      expect(idHi).toBeDefined();
      expect(idEx).not.toBe(idHi);
      // Each id names an element with exactly the note, once.
      const noteOf = (id: string) => panel.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>([^<]*)<`))?.[1]?.trim();
      expect(noteOf(idEx!)).toBe(NOTE_EXPANDED);
      expect(noteOf(idHi!)).toBe(NOTE_HIDDEN);
      expect(panel.split(`id="${idEx}"`)).toHaveLength(2);
      expect(text(panel).split(NOTE_EXPANDED)).toHaveLength(2);
      expect(text(panel).split(NOTE_HIDDEN)).toHaveLength(2);
    });

    it("does not hide the note: it is in the page's text, not in a title or a hidden element", async () => {
      const file = await open();
      const panel = panelOf(await draw(file, atBoth(), tag(0)));
      const para = panel.match(/<[a-z]+[^>]*>[^<]*At most 50 expanded[^<]*<\/[a-z]+>/)?.[0] ?? "";
      expect(para).not.toMatch(/\shidden(=|\s|>)/);
      expect(para).not.toMatch(/display:\s*none/);
      expect(para).not.toMatch(/aria-hidden/);
    });

    it("with only 50 expanded: Expand is disabled and noted, Hide works and is not noted", async () => {
      const file = await open();
      const panel = panelOf(await draw(file, range(50, 30).reduce(expand, hoodOf("Hub:h", 20)), tag(0)));
      expect(isDisabled(button(panel, "expand"))).toBe(true);
      expect(isDisabled(button(panel, "hide"))).toBe(false);
      expect(button(panel, "hide")).not.toMatch(/aria-describedby/);
      expect(text(panel)).toContain(NOTE_EXPANDED);
      expect(text(panel)).not.toContain("At most 50 hidden");
    });

    it("with only 50 hidden: Hide is disabled and noted, Expand works and is not noted", async () => {
      const file = await open();
      const panel = panelOf(await draw(file, range(50, 30).reduce(hide, hoodOf("Hub:h", 20)), tag(0)));
      expect(isDisabled(button(panel, "hide"))).toBe(true);
      expect(isDisabled(button(panel, "expand"))).toBe(false);
      expect(button(panel, "expand")).not.toMatch(/aria-describedby/);
      expect(text(panel)).toContain(NOTE_HIDDEN);
      expect(text(panel)).not.toContain("At most 50 expanded");
    });

    it("keeps re-centring on a thing enabled at both bounds", async () => {
      const file = await open();
      const panel = panelOf(await draw(file, atBoth(), tag(0)));
      expect(panel).toMatch(/<a[^>]*href="#node=Tag%3At000&amp;v=explore"[^>]*>(?:<!--[^>]*-->)*Re-centre here</);
    });

    it("keeps the things hidden listed, each shown again by a button that is not disabled, at the bound", async () => {
      const file = await open();
      const html = await draw(file, atBoth(), null);
      const unhides = html.match(/<button[^>]*data-unhide="[^"]*"[^>]*>/g) ?? [];
      expect(unhides).toHaveLength(50);
      for (const b of unhides) expect(isDisabled(b)).toBe(false);
    });

    it("says nothing of the bound at 49 of each", async () => {
      const file = await open();
      const s = range(49, 80).reduce(hide, range(49, 30).reduce(expand, hoodOf("Hub:h", 20)));
      const panel = panelOf(await draw(file, s, tag(0)));
      expect(isDisabled(button(panel, "expand"))).toBe(false);
      expect(isDisabled(button(panel, "hide"))).toBe(false);
      expect(text(panel)).not.toContain("At most 50");
    });

    it("shows a long link's note in the page as plain text, with the picture it opened", async () => {
      const file = await open();
      const opened = await openHash(file, hand("Hub:h", { x: range(60), h: range(60, 60), l: "20" }));
      expect(opened.unapplied).toHaveLength(2);
      const html = await draw(file, opened.state, null, opened.unapplied);
      expect(text(html)).toContain("This link names 60 expanded things; the first 50 are shown.");
      expect(text(html)).toContain("This link names 60 hidden things; the first 50 are hidden.");
      expect(html).toContain("data-unapplied");
    });

    it("does not repeat a long link's note when the link made from its picture is drawn", async () => {
      const file = await open();
      const opened = await openHash(file, hand("Hub:h", { x: range(60), l: "20" }));
      const again = await reopened(file, opened.state);
      const html = await draw(file, again.state, null, again.unapplied);
      expect(html).not.toContain("data-unapplied");
      expect(text(html)).not.toContain("This link names");
    });

    it("draws the same page from a long link and from the link its own picture makes, but for the note", async () => {
      const file = await open();
      const opened = await openHash(file, hand("Hub:h", { x: range(60), h: range(60, 60), l: "20" }));
      const again = await reopened(file, opened.state);
      const a = await draw(file, opened.state, null, []);
      const b = await draw(file, again.state, null, again.unapplied);
      expect(b).toBe(a);
    });
  });
});
