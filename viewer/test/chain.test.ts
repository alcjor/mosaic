// Chains: steps the mosaic allows (docs/design.md, "Viewer: chains and cards"):
// V-1, a chain is a start and an ordered list of steps, each step following one kind of link in
// one direction to the next thing; V-2, any step can be pinned to one particular thing or left
// open to any thing of that type; V-3, the viewer only offers steps the mosaic's types and links
// allow, so a chain that cannot be followed cannot be built; V-5, a person can extend, shorten or
// change a chain without starting over.
import { describe, expect, it } from "vitest";
import { openMosaic } from "../src/lib/mosaic.js";
import { change, checkChain, extend, offers, pin, restart, shorten, typeAt, type Chain, type ChainSchema, type Offer } from "../src/lib/chain.js";
import { reading } from "./fixtures.js";

/** Titles are directed by and feature people, and are made in countries; employees report to employees. */
const SCHEMA: ChainSchema = {
  nodeTypes: [
    { name: "Country", count: 2 },
    { name: "Employee", count: 2 },
    { name: "Person", count: 4 },
    { name: "Title", count: 3 },
  ],
  edgeTypes: [
    { name: "directed_by", from: "Title", to: "Person" },
    { name: "features", from: "Title", to: "Person" },
    { name: "made_in", from: "Title", to: "Country" },
    { name: "reports_to", from: "Employee", to: "Employee" },
  ],
};

const start = (type: string, pinned: string | null = null): Chain => ({ start: type, pin: pinned, steps: [] });

describe("a chain", () => {
  it("is a start type, optionally pinned, and steps, each one edge type in one direction to the next type, optionally pinned", () => {
    let chain = start("Person", "Person:Al Pacino");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "in", type: "Title" });
    chain = extend(SCHEMA, chain, { edge: "directed_by", direction: "out", type: "Person" });
    chain = pin(chain, 1, "Person:Martin Scorsese");
    expect(chain).toEqual({
      start: "Person",
      pin: "Person:Al Pacino",
      steps: [
        { edge: "features", direction: "in", type: "Title", pin: null },
        { edge: "directed_by", direction: "out", type: "Person", pin: "Person:Martin Scorsese" },
      ],
    });
    expect([typeAt(chain, -1), typeAt(chain, 0), typeAt(chain, 1)]).toEqual(["Person", "Title", "Person"]);
    expect(checkChain(SCHEMA, chain)).toEqual({ chain, problems: [] });
  });

  it("a step is left open, or pinned to one thing, and can be unpinned", () => {
    const chain = extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" });
    expect(chain.steps[0]!.pin).toBeNull();
    const pinned = pin(chain, 0, "Country:Spain");
    expect(pinned.steps[0]!.pin).toBe("Country:Spain");
    expect(pin(pinned, 0, null).steps[0]!.pin).toBeNull();
    expect(pin(chain, "start", "Title:s1").pin).toBe("Title:s1");
  });

  it("a pin names a thing of its step's type", () => {
    const chain = extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" });
    expect(() => pin(chain, 0, "Person:Spain")).toThrow(/Country/);
    expect(() => pin(chain, "start", "Country:Spain")).toThrow(/Title/);
    expect(() => pin(chain, 1, "Country:Spain")).toThrow(/step/);
  });
});

describe("the steps offered after a type", () => {
  it("are exactly the edge types declared from or to it, each with its direction and the type it leads to", () => {
    expect(offers(SCHEMA, "Title")).toEqual([
      { edge: "directed_by", direction: "out", type: "Person" },
      { edge: "features", direction: "out", type: "Person" },
      { edge: "made_in", direction: "out", type: "Country" },
    ]);
    expect(offers(SCHEMA, "Person")).toEqual([
      { edge: "directed_by", direction: "in", type: "Title" },
      { edge: "features", direction: "in", type: "Title" },
    ]);
    expect(offers(SCHEMA, "Country")).toEqual([{ edge: "made_in", direction: "in", type: "Title" }]);
  });

  it("an edge type from a type to itself is offered both ways, out first", () => {
    expect(offers(SCHEMA, "Employee")).toEqual([
      { edge: "reports_to", direction: "out", type: "Employee" },
      { edge: "reports_to", direction: "in", type: "Employee" },
    ]);
  });

  it("come in a fixed order, by edge type name in UTF-8 byte order, whatever order the mosaic lists them", () => {
    const shuffled: ChainSchema = { ...SCHEMA, edgeTypes: [...SCHEMA.edgeTypes].reverse() };
    expect(offers(shuffled, "Title")).toEqual(offers(SCHEMA, "Title"));
    const odd: ChainSchema = {
      nodeTypes: [{ name: "A", count: 1 }],
      edgeTypes: [
        { name: "zz", from: "A", to: "A" },
        { name: "a_b", from: "A", to: "A" },
        { name: "ab", from: "A", to: "A" },
        { name: "a9", from: "A", to: "A" },
      ],
    };
    expect(offers(odd, "A").filter((o) => o.direction === "out").map((o) => o.edge)).toEqual(["a9", "a_b", "ab", "zz"]);
  });

  it("a step whose other end is not a node type the kit lists, or that the kit cannot name, is not offered", () => {
    const partial: ChainSchema = {
      nodeTypes: [{ name: "Title", count: 1 }],
      edgeTypes: [
        { name: "made_in", from: "Title", to: "Country" },
        { name: "odd", from: "Title", to: null },
        { name: "self", from: "Title", to: "Title" },
      ],
    };
    expect(offers(partial, "Title")).toEqual([
      { edge: "self", direction: "out", type: "Title" },
      { edge: "self", direction: "in", type: "Title" },
    ]);
  });

  it("a type with no edge types, or that the mosaic lacks, is offered nothing", () => {
    expect(offers({ nodeTypes: [{ name: "Lone", count: 1 }], edgeTypes: [] }, "Lone")).toEqual([]);
    expect(offers(SCHEMA, "Film")).toEqual([]);
  });

  it("on a real mosaic, are its declared edge types", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    for (const type of file.nodeTypes) {
      for (const o of offers(file, type.name)) {
        const e = file.edgeTypes.find((x) => x.name === o.edge)!;
        expect(o.direction === "out" ? [e.from, e.to] : [e.to, e.from]).toEqual([type.name, o.type]);
      }
      const expected = file.edgeTypes.filter((e) => e.from === type.name).length + file.edgeTypes.filter((e) => e.to === type.name).length;
      expect(offers(file, type.name)).toHaveLength(expected);
    }
    file.close();
  });
});

describe("a chain the mosaic does not allow", () => {
  it("cannot be built: a step not offered is refused", () => {
    expect(() => extend(SCHEMA, start("Person"), { edge: "made_in", direction: "in", type: "Title" })).toThrow(/Person/);
    expect(() => extend(SCHEMA, start("Person"), { edge: "features", direction: "out", type: "Title" })).toThrow(/features out/);
    expect(() => extend(SCHEMA, start("Person"), { edge: "features", direction: "in", type: "Country" })).toThrow(/Title/);
    expect(() => extend(SCHEMA, start("Film"), { edge: "features", direction: "in", type: "Title" })).toThrow(/Film/);
  });

  it("is reported step by step, and only the part before the first wrong step is kept, never followed past it", () => {
    const given: Chain = {
      start: "Person",
      pin: null,
      steps: [
        { edge: "features", direction: "in", type: "Title", pin: null },
        { edge: "made_in", direction: "in", type: "Country", pin: null },
        { edge: "made_in", direction: "in", type: "Title", pin: null },
      ],
    };
    const { chain, problems } = checkChain(SCHEMA, given);
    expect(chain).toEqual({ ...given, steps: given.steps.slice(0, 1) });
    expect(problems).toEqual(["step 2: Title has no edge type made_in in"]);
  });

  it("a step that leads to another type than the mosaic says is reported", () => {
    const given: Chain = { start: "Title", pin: null, steps: [{ edge: "made_in", direction: "out", type: "Person", pin: null }] };
    expect(checkChain(SCHEMA, given)).toEqual({ chain: start("Title"), problems: ["step 1: made_in out from Title leads to Country, not Person"] });
  });

  it("a start type the mosaic lacks is reported and nothing is kept", () => {
    expect(checkChain(SCHEMA, start("Film"))).toEqual({ chain: null, problems: ["start: the mosaic has no node type Film"] });
  });

  it("a pin of another type is reported and dropped; the step is kept, open", () => {
    const given: Chain = {
      start: "Title",
      pin: "Person:x",
      steps: [{ edge: "made_in", direction: "out", type: "Country", pin: "Title:s1" }],
    };
    expect(checkChain(SCHEMA, given)).toEqual({
      chain: { start: "Title", pin: null, steps: [{ edge: "made_in", direction: "out", type: "Country", pin: null }] },
      problems: ["start: Person:x is not a Title", "step 1: Title:s1 is not a Country"],
    });
  });
});

describe("changing a chain", () => {
  const long = (): Chain => {
    let chain = start("Person", "Person:a");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "in", type: "Title" });
    chain = pin(chain, 0, "Title:t");
    chain = extend(SCHEMA, chain, { edge: "made_in", direction: "out", type: "Country" });
    chain = pin(chain, 1, "Country:c");
    return extend(SCHEMA, chain, { edge: "made_in", direction: "in", type: "Title" });
  };

  it("extending keeps every step and pin before", () => {
    const chain = long();
    const more = extend(SCHEMA, chain, { edge: "directed_by", direction: "out", type: "Person" });
    expect(more.steps.slice(0, 3)).toEqual(chain.steps);
    expect(more.pin).toBe("Person:a");
    expect(more.steps).toHaveLength(4);
  });

  it("shortening keeps the steps before and their pins", () => {
    const chain = long();
    expect(shorten(chain, 2)).toEqual({ ...chain, steps: chain.steps.slice(0, 2) });
    expect(shorten(chain, 0)).toEqual({ ...chain, steps: [] });
    expect(shorten(chain, 9)).toEqual(chain);
  });

  it("changing a step keeps the steps before and their pins, and later steps that still follow", () => {
    const chain = long();
    // features in → directed_by in still leads to Title: the later steps still follow.
    const same = change(SCHEMA, chain, 0, { edge: "directed_by", direction: "in", type: "Title" });
    expect(same.steps[0]).toEqual({ edge: "directed_by", direction: "in", type: "Title", pin: "Title:t" });
    expect(same.steps.slice(1)).toEqual(chain.steps.slice(1));
    expect(same.pin).toBe("Person:a");
  });

  it("changing a step to one that leads elsewhere drops what no longer follows, and that step's pin", () => {
    let chain = start("Title");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "out", type: "Person" });
    chain = pin(chain, 0, "Person:p");
    chain = extend(SCHEMA, chain, { edge: "directed_by", direction: "in", type: "Title" });
    const moved = change(SCHEMA, chain, 0, { edge: "made_in", direction: "out", type: "Country" });
    expect(moved).toEqual({ start: "Title", pin: null, steps: [{ edge: "made_in", direction: "out", type: "Country", pin: null }] });
  });

  it("a change to a step the type does not offer is refused", () => {
    expect(() => change(SCHEMA, long(), 1, { edge: "features", direction: "out", type: "Person" })).not.toThrow();
    expect(() => change(SCHEMA, long(), 1, { edge: "reports_to", direction: "out", type: "Employee" })).toThrow(/Title/);
    expect(() => change(SCHEMA, long(), 7, { edge: "made_in", direction: "out", type: "Country" })).toThrow(/step/);
  });

  it("changing the start to another type drops the steps and the pin; to the same type, keeps them", () => {
    const chain = long();
    expect(restart(SCHEMA, chain, "Title")).toEqual(start("Title"));
    expect(restart(SCHEMA, chain, "Person")).toEqual(chain);
    expect(() => restart(SCHEMA, chain, "Film")).toThrow(/Film/);
  });

  it("never changes the chain it is given", () => {
    const chain = long();
    const copy = JSON.parse(JSON.stringify(chain)) as Chain;
    extend(SCHEMA, chain, { edge: "directed_by", direction: "out", type: "Person" });
    shorten(chain, 1);
    change(SCHEMA, chain, 0, { edge: "directed_by", direction: "in", type: "Title" });
    pin(chain, 0, null);
    restart(SCHEMA, chain, "Title");
    expect(chain).toEqual(copy);
  });
});

const step = (edge: string, direction: "out" | "in", type: string, pinned: string | null = null) => ({ edge, direction, type, pin: pinned });

describe("offers: ordering and determinism (V-3, section 8.1)", () => {
  it("orders edge type names by UTF-8 bytes, not UTF-16 units (a supplementary character sorts after U+FF5E)", () => {
    // U+FF5E is one UTF-16 unit 0xFF5E and three UTF-8 bytes EF BD 9E; U+1F600 is the pair
    // D83D DE00 and four UTF-8 bytes F0 9F 98 80. UTF-8 order puts the emoji last; UTF-16 first.
    const schema: ChainSchema = {
      nodeTypes: [{ name: "A", count: 1 }],
      edgeTypes: [
        { name: "\u{1F600}", from: "A", to: "A" },
        { name: "～", from: "A", to: "A" },
        { name: "z", from: "A", to: "A" },
      ],
    };
    expect(offers(schema, "A").filter((o) => o.direction === "out").map((o) => o.edge)).toEqual(["z", "～", "\u{1F600}"]);
  });

  it("orders a name before any longer name it prefixes, and upper case before lower case (bytes)", () => {
    const schema: ChainSchema = {
      nodeTypes: [{ name: "A", count: 1 }],
      edgeTypes: ["ab", "a", "B", "abc", "Z", "b"].map((name) => ({ name, from: "A", to: "A" })),
    };
    expect(offers(schema, "A").filter((o) => o.direction === "in").map((o) => o.edge)).toEqual(["B", "Z", "a", "ab", "abc", "b"]);
  });

  it("keeps a decomposed and a precomposed spelling apart, with no Unicode normalisation", () => {
    const nfc = "café";
    const nfd = "café";
    const schema: ChainSchema = {
      nodeTypes: [{ name: "A", count: 1 }, { name: nfc, count: 1 }, { name: nfd, count: 1 }],
      edgeTypes: [
        { name: "e", from: "A", to: nfd },
        { name: "e2", from: "A", to: nfc },
      ],
    };
    expect(offers(schema, "A")).toEqual([
      { edge: "e", direction: "out", type: nfd },
      { edge: "e2", direction: "out", type: nfc },
    ]);
    expect(offers(schema, nfc)).toEqual([{ edge: "e2", direction: "in", type: "A" }]);
    expect(offers(schema, nfd)).toEqual([{ edge: "e", direction: "in", type: "A" }]);
  });

  it("matches type names exactly: case and spelling matter", () => {
    expect(offers(SCHEMA, "title")).toEqual([]);
    expect(offers(SCHEMA, "Titles")).toEqual([]);
    expect(offers(SCHEMA, "")).toEqual([]);
  });

  it("is the same twice, and does not change or retain the schema it is given", () => {
    const copy = JSON.parse(JSON.stringify(SCHEMA)) as ChainSchema;
    const a = offers(SCHEMA, "Title");
    const b = offers(SCHEMA, "Title");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(SCHEMA).toEqual(copy);
    (a as Offer[]).pop();
    expect(offers(SCHEMA, "Title")).toHaveLength(3);
  });

  it("offers an edge type once per direction it touches the type, never in a direction it does not", () => {
    const outs = offers(SCHEMA, "Title").filter((o) => o.edge === "made_in");
    expect(outs).toEqual([{ edge: "made_in", direction: "out", type: "Country" }]);
    expect(offers(SCHEMA, "Country").filter((o) => o.direction === "out")).toEqual([]);
    expect(offers(SCHEMA, "Person").filter((o) => o.direction === "out")).toEqual([]);
  });

  it("orders both directions of one edge type together: all outs of a name, then its in, then the next name", () => {
    const schema: ChainSchema = {
      nodeTypes: [{ name: "A", count: 1 }, { name: "B", count: 1 }],
      edgeTypes: [
        { name: "b", from: "A", to: "A" },
        { name: "a", from: "B", to: "A" },
        { name: "a2", from: "A", to: "B" },
      ],
    };
    expect(offers(schema, "A")).toEqual([
      { edge: "a", direction: "in", type: "B" },
      { edge: "a2", direction: "out", type: "B" },
      { edge: "b", direction: "out", type: "A" },
      { edge: "b", direction: "in", type: "A" },
    ]);
  });

  it("handles a type with thousands of edge types, in order, quickly", () => {
    const edgeTypes = Array.from({ length: 5000 }, (_, i) => ({ name: `e${String(4999 - i).padStart(5, "0")}`, from: "A", to: "B" }));
    const schema: ChainSchema = { nodeTypes: [{ name: "A", count: 1 }, { name: "B", count: 1 }], edgeTypes };
    const t0 = performance.now();
    const o = offers(schema, "A");
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(o).toHaveLength(5000);
    expect(o[0]!.edge).toBe("e00000");
    expect(o[4999]!.edge).toBe("e04999");
  });

  it("copes with NUL and very long names", () => {
    const long = "x".repeat(100_000);
    const schema: ChainSchema = {
      nodeTypes: [{ name: "A\u0000B", count: 1 }, { name: "A", count: 1 }],
      edgeTypes: [
        { name: long + "b", from: "A\u0000B", to: "A" },
        { name: long + "a", from: "A\u0000B", to: "A" },
        { name: "e\u0000", from: "A\u0000B", to: "A" },
        { name: "e", from: "A\u0000B", to: "A" },
      ],
    };
    expect(offers(schema, "A\u0000B").map((o) => o.edge === "e" || o.edge === "e\u0000" ? o.edge : o.edge.slice(-1))).toEqual(["e", "e\u0000", "a", "b"]);
    expect(offers(schema, "A")).toHaveLength(4);
  });
});

describe("typeAt (V-1)", () => {
  it("is the start type for -1 and each step's type after", () => {
    const chain = extend(SCHEMA, start("Person"), { edge: "features", direction: "in", type: "Title" });
    expect(typeAt(chain, -1)).toBe("Person");
    expect(typeAt(chain, 0)).toBe("Title");
  });
});

describe("a chain is plain data (V-1, V-2; it is saved in the view file later)", () => {
  it("survives a JSON round trip unchanged, with every step carrying all four fields and no undefined", () => {
    let chain = start("Title", "Title:s1");
    chain = extend(SCHEMA, chain, { edge: "made_in", direction: "out", type: "Country" });
    chain = extend(SCHEMA, chain, { edge: "made_in", direction: "in", type: "Title" });
    chain = pin(chain, 1, "Title:s2");
    expect(JSON.parse(JSON.stringify(chain))).toEqual(chain);
    for (const s of chain.steps) expect(Object.keys(s).sort()).toEqual(["direction", "edge", "pin", "type"]);
    expect(Object.keys(chain).sort()).toEqual(["pin", "start", "steps"]);
    expect(Object.keys(start("Title")).sort()).toEqual(["pin", "start", "steps"]);
  });

  it("the same builds give the same bytes", () => {
    const build = () => {
      let c = start("Person", "Person:a");
      c = extend(SCHEMA, c, { edge: "features", direction: "in", type: "Title" });
      c = pin(c, 0, "Title:t");
      return JSON.stringify(c);
    };
    expect(build()).toBe(build());
  });
});

describe("pins (V-2)", () => {
  it("a pin keeps the other pins and steps, and sets only the one asked", () => {
    let chain = start("Person", "Person:a");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "in", type: "Title" });
    chain = extend(SCHEMA, chain, { edge: "made_in", direction: "out", type: "Country" });
    chain = pin(chain, 0, "Title:t");
    chain = pin(chain, 1, "Country:c");
    expect(pin(chain, 0, null)).toEqual({
      start: "Person",
      pin: "Person:a",
      steps: [step("features", "in", "Title"), step("made_in", "out", "Country", "Country:c")],
    });
    expect(pin(chain, "start", null).steps).toEqual(chain.steps);
  });

  it("repinning a step replaces its pin", () => {
    const chain = pin(extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" }), 0, "Country:a");
    expect(pin(chain, 0, "Country:b").steps[0]!.pin).toBe("Country:b");
  });

  it("a key may contain colons: the id is the type, a colon, then the whole key", () => {
    const chain = extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" });
    expect(pin(chain, 0, "Country:a:b:c").steps[0]!.pin).toBe("Country:a:b:c");
    expect(pin(chain, "start", "Title:tt:1").pin).toBe("Title:tt:1");
  });

  it("a key may be any text, NUL and non-ASCII included, kept byte for byte", () => {
    const chain = start("Title");
    const id = "Title:café \u0000 \u{1F600} " + "k".repeat(50_000);
    expect(pin(chain, "start", id).pin).toBe(id);
  });

  it("an id whose type is only a prefix or another case of the type is refused", () => {
    const chain = extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" });
    expect(() => pin(chain, "start", "Titles:x")).toThrow(/Title/);
    expect(() => pin(chain, "start", "title:x")).toThrow(/Title/);
    expect(() => pin(chain, "start", "Title")).toThrow(/Title/);
    expect(() => pin(chain, 0, "Countryside:x")).toThrow(/Country/);
    expect(() => pin(chain, 0, "")).toThrow();
  });

  it("a refused pin leaves the chain as it was", () => {
    const chain = extend(SCHEMA, start("Title", "Title:a"), { edge: "made_in", direction: "out", type: "Country" });
    const copy = JSON.parse(JSON.stringify(chain)) as Chain;
    expect(() => pin(chain, 0, "Person:x")).toThrow();
    expect(chain).toEqual(copy);
  });

  it("pinning to the same id leaves an equal chain", () => {
    const chain = start("Title", "Title:a");
    expect(pin(chain, "start", "Title:a")).toEqual(chain);
  });

  it("refuses a step index below 0 or past the last step", () => {
    const chain = extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" });
    expect(() => pin(chain, -1, "Title:x")).toThrow();
    expect(() => pin(chain, 1, "Country:x")).toThrow();
  });
});

describe("extend (V-3, V-5)", () => {
  it("adds an open step even when the offer given is a pinned step", () => {
    const given = { edge: "made_in", direction: "out", type: "Country", pin: "Country:c" } as Offer;
    const chain = extend(SCHEMA, start("Title"), given);
    expect(chain.steps).toEqual([step("made_in", "out", "Country", null)]);
  });

  it("builds a chain only from offers: every offer of every type can be followed, and every step then checks", () => {
    // Walk every offer of every type, two steps deep: no chain built from offers is ever reported.
    for (const t of SCHEMA.nodeTypes) {
      for (const o1 of offers(SCHEMA, t.name)) {
        const one = extend(SCHEMA, start(t.name), o1);
        for (const o2 of offers(SCHEMA, o1.type)) {
          const two = extend(SCHEMA, one, o2);
          expect(checkChain(SCHEMA, two)).toEqual({ chain: two, problems: [] });
        }
      }
    }
  });

  it("is refused for an offer that differs from a real one only in direction, edge name case or type", () => {
    const base = start("Title");
    expect(() => extend(SCHEMA, base, { edge: "made_in", direction: "in", type: "Country" })).toThrow();
    expect(() => extend(SCHEMA, base, { edge: "Made_in", direction: "out", type: "Country" })).toThrow();
    expect(() => extend(SCHEMA, base, { edge: "made_in", direction: "out", type: "country" })).toThrow();
    expect(() => extend(SCHEMA, base, { edge: "made_in", direction: "out", type: "Title" })).toThrow();
    expect(() => extend(SCHEMA, base, { edge: "", direction: "out", type: "" })).toThrow();
  });

  it("a refused extension leaves the chain as it was", () => {
    const chain = start("Title", "Title:a");
    const copy = JSON.parse(JSON.stringify(chain)) as Chain;
    expect(() => extend(SCHEMA, chain, { edge: "reports_to", direction: "out", type: "Employee" })).toThrow();
    expect(chain).toEqual(copy);
  });

  it("follows the last step's type, not the start's", () => {
    const chain = extend(SCHEMA, start("Title"), { edge: "made_in", direction: "out", type: "Country" });
    expect(() => extend(SCHEMA, chain, { edge: "features", direction: "out", type: "Person" })).toThrow();
    expect(extend(SCHEMA, chain, { edge: "made_in", direction: "in", type: "Title" }).steps).toHaveLength(2);
  });

  it("the same edge type can be followed back and forth, any number of times", () => {
    let chain = start("Title");
    for (let i = 0; i < 500; i++) {
      chain = extend(SCHEMA, chain, i % 2 === 0 ? { edge: "made_in", direction: "out", type: "Country" } : { edge: "made_in", direction: "in", type: "Title" });
    }
    expect(chain.steps).toHaveLength(500);
    expect(typeAt(chain, 499)).toBe("Title");
    expect(checkChain(SCHEMA, chain)).toEqual({ chain, problems: [] });
  });

  it("a self-link type is a step in either direction, and both keep the type", () => {
    let chain = start("Employee", "Employee:boss");
    chain = extend(SCHEMA, chain, { edge: "reports_to", direction: "in", type: "Employee" });
    chain = extend(SCHEMA, chain, { edge: "reports_to", direction: "out", type: "Employee" });
    expect(chain.steps.map((s) => s.direction)).toEqual(["in", "out"]);
    expect(chain.pin).toBe("Employee:boss");
  });
});

describe("shorten (V-5)", () => {
  const long = (): Chain => {
    let c = start("Person", "Person:a");
    c = extend(SCHEMA, c, { edge: "features", direction: "in", type: "Title" });
    c = pin(c, 0, "Title:t");
    c = extend(SCHEMA, c, { edge: "made_in", direction: "out", type: "Country" });
    return pin(c, 1, "Country:c");
  };

  it("to its own length is the same chain, and the start pin is always kept", () => {
    const chain = long();
    expect(shorten(chain, chain.steps.length)).toEqual(chain);
    expect(shorten(chain, 0).pin).toBe("Person:a");
  });

  it("an empty chain stays empty", () => {
    expect(shorten(start("Title", "Title:a"), 0)).toEqual(start("Title", "Title:a"));
    expect(shorten(start("Title"), 3)).toEqual(start("Title"));
  });

  it("a shortened chain can be extended again, and what was dropped does not come back", () => {
    const back = extend(SCHEMA, shorten(long(), 1), { edge: "made_in", direction: "out", type: "Country" });
    expect(back.steps[1]).toEqual(step("made_in", "out", "Country", null));
    expect(back.steps[0]!.pin).toBe("Title:t");
  });
});

describe("change (V-5)", () => {
  const long = (): Chain => {
    let c = start("Person", "Person:a");
    c = extend(SCHEMA, c, { edge: "features", direction: "in", type: "Title" });
    c = pin(c, 0, "Title:t");
    c = extend(SCHEMA, c, { edge: "made_in", direction: "out", type: "Country" });
    c = pin(c, 1, "Country:c");
    return extend(SCHEMA, c, { edge: "made_in", direction: "in", type: "Title" });
  };

  it("to the step it already is leaves an equal chain", () => {
    const chain = long();
    expect(change(SCHEMA, chain, 0, { edge: "features", direction: "in", type: "Title" })).toEqual(chain);
    expect(change(SCHEMA, chain, 2, { edge: "made_in", direction: "in", type: "Title" })).toEqual(chain);
  });

  it("the last step to another type drops only that step's pin and keeps all before", () => {
    let chain = start("Person", "Person:a");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "in", type: "Title" });
    chain = pin(chain, 0, "Title:t");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "out", type: "Person" });
    chain = pin(chain, 1, "Person:p");
    expect(change(SCHEMA, chain, 1, { edge: "made_in", direction: "out", type: "Country" })).toEqual({
      start: "Person",
      pin: "Person:a",
      steps: [step("features", "in", "Title", "Title:t"), step("made_in", "out", "Country", null)],
    });
  });

  it("in the middle to another type keeps the start pin and earlier pins, drops the step's pin and all after", () => {
    const chain = long();
    // Step 0 (features in -> Title) becomes directed_by in -> Title (same type) as control, then
    // step 1 changes from made_in out (-> Country) to features out (-> Person).
    const moved = change(SCHEMA, chain, 1, { edge: "features", direction: "out", type: "Person" });
    expect(moved).toEqual({
      start: "Person",
      pin: "Person:a",
      steps: [step("features", "in", "Title", "Title:t"), step("features", "out", "Person", null)],
    });
  });

  it("the first step to another type keeps the start and its pin and drops every step after", () => {
    let chain = start("Title", "Title:s");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "out", type: "Person" });
    chain = pin(chain, 0, "Person:p");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "in", type: "Title" });
    expect(change(SCHEMA, chain, 0, { edge: "made_in", direction: "out", type: "Country" })).toEqual({
      start: "Title",
      pin: "Title:s",
      steps: [step("made_in", "out", "Country", null)],
    });
  });

  it("to another edge type leading to the same type keeps the step's pin (the thing is still of that type)", () => {
    let chain = start("Title");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "out", type: "Person" });
    chain = pin(chain, 0, "Person:p");
    expect(change(SCHEMA, chain, 0, { edge: "directed_by", direction: "out", type: "Person" }).steps).toEqual([step("directed_by", "out", "Person", "Person:p")]);
  });

  it("a self-link type changed from out to in keeps the pin and the steps after", () => {
    let chain = start("Employee");
    chain = extend(SCHEMA, chain, { edge: "reports_to", direction: "out", type: "Employee" });
    chain = pin(chain, 0, "Employee:e1");
    chain = extend(SCHEMA, chain, { edge: "reports_to", direction: "out", type: "Employee" });
    const flipped = change(SCHEMA, chain, 0, { edge: "reports_to", direction: "in", type: "Employee" });
    expect(flipped.steps).toEqual([step("reports_to", "in", "Employee", "Employee:e1"), step("reports_to", "out", "Employee", null)]);
  });

  it("is refused for an offer whose type is not the one the mosaic says, and for a negative index", () => {
    const chain = long();
    expect(() => change(SCHEMA, chain, 0, { edge: "features", direction: "in", type: "Country" })).toThrow();
    expect(() => change(SCHEMA, chain, -1, { edge: "features", direction: "in", type: "Title" })).toThrow();
  });

  it("is refused on an empty chain", () => {
    expect(() => change(SCHEMA, start("Title"), 0, { edge: "made_in", direction: "out", type: "Country" })).toThrow();
  });

  it("a refused change leaves the chain as it was", () => {
    const chain = long();
    const copy = JSON.parse(JSON.stringify(chain)) as Chain;
    expect(() => change(SCHEMA, chain, 1, { edge: "reports_to", direction: "out", type: "Employee" })).toThrow();
    expect(chain).toEqual(copy);
  });

  it("a change that keeps the type whose later step no longer follows cannot happen: everything left checks", () => {
    const chain = long();
    for (const o of offers(SCHEMA, "Person")) {
      const next = change(SCHEMA, chain, 0, o);
      expect(checkChain(SCHEMA, next)).toEqual({ chain: next, problems: [] });
    }
    for (const o of offers(SCHEMA, "Title")) {
      const next = change(SCHEMA, chain, 1, o);
      expect(checkChain(SCHEMA, next)).toEqual({ chain: next, problems: [] });
    }
  });
});

describe("restart (V-5)", () => {
  it("to another type gives an open, empty chain; to a type with no links also", () => {
    const schema: ChainSchema = { nodeTypes: [{ name: "Lone", count: 1 }, ...SCHEMA.nodeTypes], edgeTypes: SCHEMA.edgeTypes };
    expect(restart(schema, start("Title", "Title:a"), "Lone")).toEqual(start("Lone"));
  });

  it("to the same type keeps an empty chain's pin", () => {
    expect(restart(SCHEMA, start("Title", "Title:a"), "Title")).toEqual(start("Title", "Title:a"));
  });

  it("is refused for a type the mosaic lacks, case and spelling included", () => {
    expect(() => restart(SCHEMA, start("Title"), "title")).toThrow();
    expect(() => restart(SCHEMA, start("Title"), "")).toThrow();
  });
});

describe("checkChain (V-3: reported, never followed)", () => {
  it("an empty chain on a known type is allowed, with no problem", () => {
    expect(checkChain(SCHEMA, start("Title"))).toEqual({ chain: start("Title"), problems: [] });
  });

  it("an empty chain on an unknown type reports it", () => {
    const { chain, problems } = checkChain(SCHEMA, start("Film", "Film:x"));
    expect(chain).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Film/);
  });

  it("a wrong first step keeps the start and its pin, and no step", () => {
    const given: Chain = { start: "Title", pin: "Title:a", steps: [step("reports_to", "out", "Employee", "Employee:x"), step("made_in", "out", "Country")] };
    const { chain, problems } = checkChain(SCHEMA, given);
    expect(chain).toEqual(start("Title", "Title:a"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^step 1/);
  });

  it("keeps the steps and pins before the first wrong step, and reports nothing about steps after it", () => {
    const given: Chain = {
      start: "Person",
      pin: "Person:a",
      steps: [step("features", "in", "Title", "Title:t"), step("nope", "out", "Country", "Country:c"), step("also_nope", "out", "Nowhere", "Nowhere:z")],
    };
    const { chain, problems } = checkChain(SCHEMA, given);
    expect(chain).toEqual({ start: "Person", pin: "Person:a", steps: [step("features", "in", "Title", "Title:t")] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^step 2/);
  });

  it("reports a wrong direction on a one-way edge type", () => {
    const given: Chain = { start: "Person", pin: null, steps: [step("features", "out", "Title")] };
    const { chain, problems } = checkChain(SCHEMA, given);
    expect(chain).toEqual(start("Person"));
    expect(problems).toHaveLength(1);
  });

  it("reports an edge type the mosaic does not declare, case and spelling included", () => {
    for (const edge of ["Features", "feature", "features ", ""]) {
      const given: Chain = { start: "Title", pin: null, steps: [step(edge, "out", "Person")] };
      const { chain, problems } = checkChain(SCHEMA, given);
      expect(chain).toEqual(start("Title"));
      expect(problems).toHaveLength(1);
    }
  });

  it("reports pin problems in order, start then steps, before a later wrong step's problem", () => {
    const given: Chain = {
      start: "Person",
      pin: "Title:x",
      steps: [step("features", "in", "Title", "Person:y"), step("made_in", "in", "Country", null)],
    };
    const { chain, problems } = checkChain(SCHEMA, given);
    expect(chain).toEqual({ start: "Person", pin: null, steps: [step("features", "in", "Title", null)] });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^start/);
    expect(problems[1]).toMatch(/^step 1/);
    expect(problems[2]).toMatch(/^step 2/);
  });

  it("a pin whose type is only a prefix of the step's type is reported and dropped", () => {
    const given: Chain = { start: "Title", pin: "Titles:x", steps: [step("made_in", "out", "Country", "Countryside:y")] };
    const { chain, problems } = checkChain(SCHEMA, given);
    expect(chain).toEqual({ start: "Title", pin: null, steps: [step("made_in", "out", "Country", null)] });
    expect(problems).toHaveLength(2);
  });

  it("is idempotent: what it keeps checks clean, and checking it again changes nothing", () => {
    const given: Chain = {
      start: "Title",
      pin: "Person:p",
      steps: [step("made_in", "out", "Country", "Title:s"), step("made_in", "out", "Country")],
    };
    const first = checkChain(SCHEMA, given);
    const again = checkChain(SCHEMA, first.chain!);
    expect(again).toEqual({ chain: first.chain, problems: [] });
  });

  it("does not change the chain it is given", () => {
    const given: Chain = { start: "Title", pin: "Person:p", steps: [step("made_in", "in", "Title", "Title:s")] };
    const copy = JSON.parse(JSON.stringify(given)) as Chain;
    checkChain(SCHEMA, given);
    expect(given).toEqual(copy);
  });

  it("is the same twice", () => {
    const given: Chain = { start: "Title", pin: null, steps: [step("made_in", "in", "Title")] };
    expect(JSON.stringify(checkChain(SCHEMA, given))).toBe(JSON.stringify(checkChain(SCHEMA, given)));
  });

  it("a chain from a view file built against a mosaic that has since lost an edge type keeps the part still allowed", () => {
    const smaller: ChainSchema = { nodeTypes: SCHEMA.nodeTypes, edgeTypes: SCHEMA.edgeTypes.filter((e) => e.name !== "made_in") };
    let chain = start("Person", "Person:a");
    chain = extend(SCHEMA, chain, { edge: "features", direction: "in", type: "Title" });
    chain = extend(SCHEMA, chain, { edge: "made_in", direction: "out", type: "Country" });
    const { chain: kept, problems } = checkChain(smaller, chain);
    expect(kept).toEqual({ ...chain, steps: chain.steps.slice(0, 1) });
    expect(problems).toHaveLength(1);
  });

  it("a mosaic that has lost a node type reports a chain starting on it and keeps nothing", () => {
    const smaller: ChainSchema = { nodeTypes: SCHEMA.nodeTypes.filter((t) => t.name !== "Person"), edgeTypes: SCHEMA.edgeTypes };
    const { chain, problems } = checkChain(smaller, start("Person"));
    expect(chain).toBeNull();
    expect(problems).toHaveLength(1);
  });

  it("checks a very long chain without trouble", () => {
    const steps = Array.from({ length: 5000 }, (_, i) => (i % 2 === 0 ? step("made_in", "out", "Country") : step("made_in", "in", "Title")));
    const given: Chain = { start: "Title", pin: null, steps };
    expect(checkChain(SCHEMA, given)).toEqual({ chain: given, problems: [] });
    const broken: Chain = { ...given, steps: [...steps.slice(0, 4000), step("zzz", "out", "Country"), ...steps.slice(4001)] };
    const r = checkChain(SCHEMA, broken);
    expect(r.chain!.steps).toHaveLength(4000);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^step 4001/);
  });
});
