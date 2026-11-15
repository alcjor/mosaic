// Build and change a chain (docs/design.md, "Viewer: chains and cards"): V-1, a chain is a
// start and an ordered list of steps; V-2, any step can be pinned to one thing or left open;
// V-3, only steps the mosaic allows are offered; V-5, a person can extend, shorten or change a
// chain and see the effect without starting over: each change shows its effect on the results'
// count at once, a running count that grows until it is exact.
import { describe, expect, it } from "vitest";
import { remove, type Chain, type ChainSchema, type Step, change, checkChain, extend, offers, pin, restart, shorten } from "../src/lib/chain.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";
import { buildMosaic, type EdgeSpec, type NodeSpec } from "../../kit/test/build-mosaic.js";

/** Titles are directed by and feature people, and are made in countries. */
const SCHEMA: ChainSchema = {
  nodeTypes: [
    { name: "Country", count: 2 },
    { name: "Person", count: 4 },
    { name: "Title", count: 3 },
  ],
  edgeTypes: [
    { name: "directed_by", from: "Title", to: "Person" },
    { name: "features", from: "Title", to: "Person" },
    { name: "knows", from: "Person", to: "Person" },
    { name: "made_in", from: "Title", to: "Country" },
  ],
};

const step = (edge: string, direction: "out" | "in", type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });

describe("removing a step (V-5)", () => {
  const chain: Chain = {
    start: "Person",
    pin: "Person:p",
    steps: [step("features", "in", "Title", "Title:t"), step("made_in", "out", "Country"), step("made_in", "in", "Title")],
  };

  it("the last step: the chain before it stays, pins and all", () => {
    expect(remove(SCHEMA, chain, 2)).toEqual({ ...chain, steps: chain.steps.slice(0, 2) });
  });

  it("a middle step: the steps after it stay when they still follow from the step before", () => {
    // A step from a type to itself can go, and what came after it still follows.
    const c: Chain = { start: "Person", pin: null, steps: [step("knows", "out", "Person", "Person:q"), step("features", "in", "Title", "Title:t")] };
    expect(remove(SCHEMA, c, 0)).toEqual({ start: "Person", pin: null, steps: [step("features", "in", "Title", "Title:t")] });
  });

  it("a middle step after which the rest no longer follows: they go too", () => {
    expect(remove(SCHEMA, chain, 0)).toEqual({ ...chain, steps: [] });
  });

  it("never changes the chain it is given", () => {
    const before = JSON.stringify(chain);
    remove(SCHEMA, chain, 1);
    expect(JSON.stringify(chain)).toBe(before);
  });

  it("a step the chain lacks is refused", () => {
    expect(() => remove(SCHEMA, chain, 3)).toThrow(RangeError);
  });
});

describe("the Chain view", () => {

  it("each change shows its effect on the count at once: a running count, then the exact one", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    expect(viewer.chain).toBeNull();
    viewer.setChain({ start: "Item", pin: null, steps: [] });
    // At once: the count has begun, before any call has answered.
    expect(viewer.chainCount).toMatchObject({ done: false });
    await viewer.counted;
    expect(viewer.chainCount).toEqual({ total: 2, exact: true, done: true, notes: [] });
    viewer.setChain({ start: "Item", pin: null, steps: [step("in_group", "out", "Group")] });
    await viewer.counted;
    expect(viewer.chainCount).toEqual({ total: 2, exact: true, done: true, notes: [] });
    viewer.setChain({ start: "Item", pin: "Item:a", steps: [step("in_group", "out", "Group")] });
    await viewer.counted;
    expect(viewer.chainCount?.total).toBe(1);
  });

  it("a change while a count runs stops it: only the latest chain's count is shown", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain({ start: "Item", pin: null, steps: [step("in_group", "out", "Group")] });
    const first = viewer.counted;
    viewer.setChain({ start: "Group", pin: null, steps: [] });
    await Promise.all([first, viewer.counted]);
    expect(viewer.chain?.start).toBe("Group");
    expect(viewer.chainCount).toEqual({ total: 1, exact: true, done: true, notes: [] });
  });

  it("the same mosaic opened again (another search mode) keeps the chain and counts it again", async () => {
    const viewer = new Viewer();
    const bytes = reading("mosaic.mosaic");
    await viewer.open(bytes, "mosaic.mosaic");
    viewer.setChain({ start: "Item", pin: null, steps: [step("in_group", "out", "Group")] });
    await viewer.counted;
    await viewer.open(bytes, "mosaic.mosaic");
    expect(viewer.chain).toEqual({ start: "Item", pin: null, steps: [step("in_group", "out", "Group")] });
    await viewer.counted;
    expect(viewer.chainCount).toEqual({ total: 2, exact: true, done: true, notes: [] });
  });

  it("no chain, no count", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain({ start: "Item", pin: null, steps: [] });
    viewer.setChain(null);
    expect(viewer.chainCount).toBeNull();
  });
});

describe("chainview: further cases", () => {
  const SCHEMA: ChainSchema = {
    nodeTypes: [
      { name: "Country", count: 2 },
      { name: "Person", count: 4 },
      { name: "Title", count: 3 },
    ],
    edgeTypes: [
      { name: "directed_by", from: "Title", to: "Person" },
      { name: "features", from: "Title", to: "Person" },
      { name: "knows", from: "Person", to: "Person" },
      { name: "made_in", from: "Title", to: "Country" },
    ],
  };

  const step = (edge: string, direction: "out" | "in", type: string, pinned: string | null = null): Step => ({ edge, direction, type, pin: pinned });
  const open = (type: string, pinned: string | null = null, steps: Step[] = []): Chain => ({ start: type, pin: pinned, steps });

  // ---------------------------------------------------------------------------------------------
  // remove (V-5)

  describe("removing a step: what stays (V-5, V-3)", () => {
    it("the start's pin stays when the first step goes", () => {
      const c = open("Person", "Person:p", [step("knows", "out", "Person"), step("knows", "out", "Person")]);
      expect(remove(SCHEMA, c, 0).pin).toBe("Person:p");
    });

    it("the steps after a removed step keep their pins when they still follow", () => {
      const c = open("Person", null, [step("knows", "out", "Person", "Person:a"), step("knows", "out", "Person", "Person:b"), step("knows", "in", "Person", "Person:c")]);
      expect(remove(SCHEMA, c, 1)).toEqual(open("Person", null, [step("knows", "out", "Person", "Person:a"), step("knows", "in", "Person", "Person:c")]));
    });

    it("the steps before a removed step keep their pins", () => {
      const c = open("Title", "Title:t", [step("features", "out", "Person", "Person:p"), step("knows", "out", "Person", "Person:q")]);
      expect(remove(SCHEMA, c, 1)).toEqual(open("Title", "Title:t", [step("features", "out", "Person", "Person:p")]));
    });

    it("a step that follows through a removed step's neighbour stays, a different direction included", () => {
      const c = open("Person", null, [step("knows", "out", "Person"), step("knows", "in", "Person")]);
      expect(remove(SCHEMA, c, 0)).toEqual(open("Person", null, [step("knows", "in", "Person")]));
    });

    it("from the first step that no longer follows, every step after it goes, even one that would follow", () => {
      // Title -made_in-> Country -made_in<- Title -features-> Person. Without step 0 the second
      // step does not follow from Title; the third would, but the chain stops where it breaks.
      const c = open("Title", null, [step("made_in", "out", "Country"), step("made_in", "in", "Title"), step("features", "out", "Person")]);
      expect(remove(SCHEMA, c, 0)).toEqual(open("Title"));
    });

    it("removing the only step leaves the start, pinned or not", () => {
      expect(remove(SCHEMA, open("Title", "Title:t", [step("made_in", "out", "Country", "Country:fr")]), 0)).toEqual(open("Title", "Title:t"));
    });

    it("removing the last step is the same as shortening to the steps before it", () => {
      const c = open("Title", null, [step("features", "out", "Person"), step("knows", "out", "Person", "Person:q")]);
      expect(remove(SCHEMA, c, 1)).toEqual(shorten(c, 1));
    });

    it("the result is always a chain the mosaic allows, whichever step goes", () => {
      const chains = [
        open("Title", null, [step("features", "out", "Person"), step("knows", "out", "Person"), step("knows", "in", "Person"), step("features", "in", "Title")]),
        open("Country", "Country:x", [step("made_in", "in", "Title"), step("directed_by", "out", "Person"), step("knows", "out", "Person")]),
        open("Person", null, [step("features", "in", "Title"), step("made_in", "out", "Country")]),
      ];
      for (const c of chains) {
        expect(checkChain(SCHEMA, c).problems).toEqual([]);
        for (let i = 0; i < c.steps.length; i++) {
          const r = remove(SCHEMA, c, i);
          expect(checkChain(SCHEMA, r), `${c.start} without step ${i}`).toEqual({ chain: r, problems: [] });
          expect(r.steps.length).toBeLessThan(c.steps.length);
          expect(r.start).toBe(c.start);
        }
      }
    });

    it("returns a new chain: neither the chain nor its steps are shared in a way that changing the result changes the input", () => {
      const c = open("Person", null, [step("knows", "out", "Person"), step("knows", "out", "Person", "Person:b")]);
      const frozen = JSON.stringify(c);
      const r = remove(SCHEMA, c, 0);
      expect(r).not.toBe(c);
      expect(r.steps).not.toBe(c.steps);
      expect(JSON.stringify(c)).toBe(frozen);
    });

    it("is deterministic: the same chain and index give the same chain", () => {
      const c = open("Person", "Person:p", [step("knows", "out", "Person"), step("features", "in", "Title")]);
      expect(JSON.stringify(remove(SCHEMA, c, 0))).toBe(JSON.stringify(remove(SCHEMA, c, 0)));
    });
  });

  describe("removing a step the chain lacks is refused (V-5)", () => {
    const c = open("Person", null, [step("knows", "out", "Person")]);
    for (const [name, index] of [["negative", -1], ["one past the last", 1], ["fractional", 0.5], ["not a number", Number.NaN], ["infinite", Number.POSITIVE_INFINITY]] as const) {
      it(`an index that is ${name}`, () => {
        expect(() => remove(SCHEMA, c, index)).toThrow(RangeError);
      });
    }

    it("a chain with no step has nothing to remove", () => {
      expect(() => remove(SCHEMA, open("Person"), 0)).toThrow(RangeError);
    });
  });

  describe("a chain changed step by step stays one the mosaic allows (V-3, V-5)", () => {
    it("extend, pin, change, shorten and restart each give a followable chain", () => {
      let c = restart(SCHEMA, open("Person"), "Title");
      const sequence: Chain[] = [c];
      c = extend(SCHEMA, c, { edge: "features", direction: "out", type: "Person" });
      sequence.push(c);
      c = pin(c, 0, "Person:p");
      sequence.push(c);
      c = extend(SCHEMA, c, { edge: "knows", direction: "out", type: "Person" });
      sequence.push(c);
      c = change(SCHEMA, c, 0, { edge: "directed_by", direction: "out", type: "Person" });
      sequence.push(c);
      c = shorten(c, 1);
      sequence.push(c);
      c = restart(SCHEMA, c, "Country");
      sequence.push(c);
      for (const s of sequence) expect(checkChain(SCHEMA, s).problems).toEqual([]);
      expect(c).toEqual(open("Country"));
    });

    it("the offers after every type in a chain built from offers are followable further or end", () => {
      let c = open("Title");
      for (let n = 0; n < 6; n++) {
        const last = c.steps.at(-1)?.type ?? c.start;
        const next = offers(SCHEMA, last)[0];
        if (next === undefined) break;
        c = extend(SCHEMA, c, next);
      }
      expect(c.steps.length).toBe(6);
      expect(checkChain(SCHEMA, c).problems).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The Viewer: a count at each change

  const NODES: NodeSpec[] = [
    { type: "Person", key: "a", label: "Ann" },
    { type: "Person", key: "b", label: "Bo" },
    { type: "Person", key: "c", label: "Cy" },
    { type: "Team", key: "x", label: "X" },
    { type: "Team", key: "y", label: "Y" },
    { type: "Team", key: "z", label: "Z" },
  ];
  const EDGES: EdgeSpec[] = [
    { type: "member_of", from: "Person:a", to: "Team:x" },
    { type: "member_of", from: "Person:a", to: "Team:y" },
    { type: "member_of", from: "Person:b", to: "Team:x" },
    { type: "member_of", from: "Person:c", to: "Team:z" },
    { type: "knows", from: "Person:a", to: "Person:b", qualifier: "work" },
    { type: "knows", from: "Person:a", to: "Person:b", qualifier: "school" },
    { type: "knows", from: "Person:b", to: "Person:c" },
  ];
  const TYPES: [string, string, string][] = [
    ["knows", "Person", "Person"],
    ["member_of", "Person", "Team"],
  ];
  const team = () => buildMosaic({ nodes: NODES, edgeTypes: TYPES, edges: EDGES });

  async function opened(bytes: Uint8Array = team()): Promise<Viewer> {
    const viewer = new Viewer();
    await viewer.open(bytes, "team.mosaic");
    expect(viewer.status).toBe("ready");
    return viewer;
  }

  async function counted(viewer: Viewer, chain: Chain | null) {
    viewer.setChain(chain);
    await viewer.counted;
    return viewer.chainCount;
  }

  describe("the Viewer counts each chain (V-5, V-13)", () => {
    it("every change along the way gives the count of that chain, the same as when built alone", async () => {
      const viewer = await opened();
      let c: Chain = restart(SCHEMA_TEAM, open("Person"), "Person");
      const expected: [string, Chain, number][] = [];
      expected.push(["start", c, 3]);
      c = extend(SCHEMA_TEAM, c, { edge: "member_of", direction: "out", type: "Team" });
      expected.push(["extend", c, 4]);
      c = pin(c, 0, "Team:x");
      expected.push(["pin a step", c, 2]);
      c = pin(c, "start", "Person:a");
      expected.push(["pin the start", c, 1]);
      c = pin(c, "start", null);
      expected.push(["unpin the start", c, 2]);
      c = change(SCHEMA_TEAM, c, 0, { edge: "member_of", direction: "out", type: "Team" });
      expected.push(["change the same step", c, 2]);
      c = shorten(c, 0);
      expected.push(["shorten", c, 3]);
      c = extend(SCHEMA_TEAM, c, { edge: "knows", direction: "out", type: "Person" });
      expected.push(["extend with a link of two qualifiers", c, 3]);
      for (const [name, chain, total] of expected) {
        const count = await counted(viewer, chain);
        expect(count, name).toMatchObject({ total, exact: true, done: true });
      }
    });

    it("each change replaces the count at once: not done, nothing left over from the chain before", async () => {
      const viewer = await opened();
      await counted(viewer, open("Person"));
      expect(viewer.chainCount?.total).toBe(3);
      viewer.setChain(open("Team"));
      expect(viewer.chainCount).toMatchObject({ done: false, exact: false });
      expect(viewer.chainCount!.total).toBeLessThanOrEqual(3);
      await viewer.counted;
      expect(viewer.chainCount).toMatchObject({ total: 3, done: true });
    });

    it("two links of one type between the same two things count as two results", async () => {
      const viewer = await opened();
      const c = open("Person", "Person:a", [step("knows", "out", "Person", "Person:b")]);
      expect(await counted(viewer, c)).toMatchObject({ total: 2, exact: true });
    });

    it("a link followed against its direction counts the same walks", async () => {
      const viewer = await opened();
      const out = await counted(viewer, open("Person", null, [step("member_of", "out", "Team")]));
      const back = await counted(viewer, open("Team", null, [step("member_of", "in", "Person")]));
      expect(back?.total).toBe(out?.total);
    });

    it("the same chain counted twice, on two viewers, gives the same count", async () => {
      const c = open("Person", null, [step("knows", "out", "Person"), step("member_of", "out", "Team")]);
      const first = await counted(await opened(), c);
      const second = await counted(await opened(), c);
      expect(second).toEqual(first);
    });

    it("the same chain set again gives the same count", async () => {
      const viewer = await opened();
      const c = open("Person", null, [step("member_of", "out", "Team")]);
      const first = await counted(viewer, c);
      expect(await counted(viewer, c)).toEqual(first);
    });

    it("a pin on a thing the mosaic lacks finds nothing, exactly, and names the thing", async () => {
      const viewer = await opened();
      const count = await counted(viewer, open("Person", "Person:nobody", [step("member_of", "out", "Team")]));
      expect(count).toMatchObject({ total: 0, done: true });
      expect(count?.notes.join(" ")).toContain("Person:nobody");
    });

    it("a pinned step on a thing the mosaic lacks finds nothing and names it", async () => {
      const viewer = await opened();
      const count = await counted(viewer, open("Person", null, [step("member_of", "out", "Team", "Team:nowhere")]));
      expect(count).toMatchObject({ total: 0, done: true });
      expect(count?.notes.join(" ")).toContain("Team:nowhere");
    });

    it("a start type the mosaic lacks does not break the count: it finishes with nothing", async () => {
      const viewer = await opened();
      const count = await counted(viewer, open("Ghost"));
      expect(count).toMatchObject({ total: 0, done: true });
    });

    it("a link type the mosaic lacks finishes with nothing", async () => {
      const viewer = await opened();
      const count = await counted(viewer, open("Person", null, [step("haunts", "out", "Team")]));
      expect(count).toMatchObject({ total: 0, done: true });
    });

    it("a pin of the wrong type finds nothing", async () => {
      const viewer = await opened();
      const count = await counted(viewer, open("Person", "Team:x"));
      expect(count).toMatchObject({ total: 0, done: true });
    });

    it("an empty mosaic's types count zero, exactly", async () => {
      const viewer = await opened(buildMosaic({ nodes: [] }));
      const count = await counted(viewer, open("Anything"));
      expect(count).toMatchObject({ total: 0, done: true });
    });
  });

  describe("a change while counting (V-5)", () => {
    it("clearing the chain while it counts leaves no count behind, even after the count would have ended", async () => {
      const viewer = await opened();
      viewer.setChain(open("Person", null, [step("knows", "out", "Person"), step("member_of", "out", "Team")]));
      const running = viewer.counted;
      viewer.setChain(null);
      expect(viewer.chainCount).toBeNull();
      await running;
      await viewer.counted;
      await new Promise((r) => setTimeout(r, 20));
      expect(viewer.chain).toBeNull();
      expect(viewer.chainCount).toBeNull();
    });

    it("many changes in a row: the last chain's count, and only it, ends up shown", async () => {
      const viewer = await opened();
      const chains = [open("Person"), open("Team"), open("Person", null, [step("knows", "out", "Person")]), open("Team", null, [step("member_of", "in", "Person")]), open("Person", "Person:a")];
      const all: Promise<void>[] = [];
      for (const c of chains) {
        viewer.setChain(c);
        all.push(viewer.counted);
      }
      await Promise.all(all);
      expect(viewer.chain).toBe(chains.at(-1));
      expect(viewer.chainCount).toMatchObject({ total: 1, exact: true, done: true });
      await new Promise((r) => setTimeout(r, 20));
      expect(viewer.chainCount).toMatchObject({ total: 1, exact: true, done: true });
    });

    it("the chain the viewer holds is the chain it was given, unchanged", async () => {
      const viewer = await opened();
      const c = open("Person", "Person:a", [step("member_of", "out", "Team")]);
      const before = JSON.stringify(c);
      await counted(viewer, c);
      expect(viewer.chain).toBe(c);
      expect(JSON.stringify(c)).toBe(before);
    });

    it("a chain set before any mosaic is open has no count, and no failure", () => {
      const viewer = new Viewer();
      expect(() => viewer.setChain(open("Person"))).not.toThrow();
      expect(viewer.chainCount).toBeNull();
    });

    it("opening another mosaic does not keep a chain that mosaic cannot follow, nor the count of the mosaic before (V-3)", async () => {
      const viewer = await opened();
      await counted(viewer, open("Person", null, [step("member_of", "out", "Team")]));
      expect(viewer.chainCount?.total).toBe(4);
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      expect(viewer.status).toBe("ready");
      // A chain over types the open mosaic does not have cannot be built (V-3): the viewer must not
      // keep showing one, nor the count of the mosaic before.
      const stale = viewer.chain !== null && checkChain({ nodeTypes: viewer.file!.nodeTypes, edgeTypes: viewer.file!.edgeTypes }, viewer.chain).problems.length > 0;
      expect(stale, "the chain of the mosaic before is still the chain").toBe(false);
      if (viewer.chain === null) expect(viewer.chainCount).toBeNull();
    });
  });

  const SCHEMA_TEAM: ChainSchema = {
    nodeTypes: [
      { name: "Person", count: 3 },
      { name: "Team", count: 3 },
    ],
    edgeTypes: [
      { name: "knows", from: "Person", to: "Person" },
      { name: "member_of", from: "Person", to: "Team" },
    ],
  };
});
