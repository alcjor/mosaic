// Chains in the view file (docs/design.md, "Viewer: chains and cards"): V-15, chains are
// saved in the view file beside its other choices; V-16, anyone who opens the same mosaic with the
// same view file sees the same chains; V-18, a view file whose chains name types, links or things
// the mosaic does not have still opens, and the viewer reports what it could not apply.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import ChainView from "../src/components/ChainView.svelte";
import { type Chain, type Step, offers } from "../src/lib/chain.js";
import { parseView, type ChainSettings } from "../src/lib/view.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { chainName, chainSettings, chainsText, checkChains, resolveChains, pinsOf, withThings, type SavedChain } from "../src/lib/viewchains.js";
import { reading } from "./fixtures.js";
import { openMosaic } from "../src/lib/mosaic.js";

const step = (edge: string, direction: "out" | "in", type: string, pin: string | null = null): Step => ({ edge, direction, type, pin });
const saved = (name: string, start: string, steps: { link: string; pin?: string | null }[] = [], pin: string | null = null): ChainSettings => ({
  name,
  start,
  pin,
  steps: steps.map((s) => ({ link: s.link, pin: s.pin ?? null })),
});

describe("the view file's chains, as the page reads them", () => {
  it("are read with their label, start, pin and steps, in the order written", () => {
    const view = parseView({
      chains: [
        { name: "Items in x", start: "Item", pin: null, steps: [{ link: "in_group out", pin: "Group:x" }] },
        { name: "Groups", start: "Group", pin: null, steps: [] },
      ],
    });
    expect(view.chains?.map((c) => c.name)).toEqual(["Items in x", "Groups"]);
    expect(view.chains?.[0]).toEqual(saved("Items in x", "Item", [{ link: "in_group out", pin: "Group:x" }]));
  });

  it("none written is none", () => {
    expect(parseView({}).chains).toBeNull();
    expect(parseView({ chains: null }).chains).toBeNull();
  });

  it("a wrong value is refused, naming where", () => {
    expect(() => parseView({ chains: [{ name: "C", start: "Item", pin: null, steps: [{ link: "in_group both", pin: null }] }] })).toThrow(/chains\[0\]\.steps\[0\]\.link/);
    expect(() => parseView({ chains: [{ name: "C", start: "", pin: null, steps: [] }] })).toThrow(/chains\[0\]\.start/);
    expect(() => parseView({ chains: [{ name: "C", start: "A" }, { name: "C", start: "B" }] })).toThrow(/chains\[1\]\.name/);
  });
});

describe("the view file's chains on the open mosaic (V-16, V-18)", () => {
  it("each is the chain it writes: a step's type is the other end of its link", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const { chains, notices } = resolveChains([saved("Items in x", "Item", [{ link: "in_group out", pin: "Group:x" }]), saved("Back", "Group", [{ link: "in_group in" }], "Group:x")], file);
    expect(notices).toEqual([]);
    expect(chains).toEqual([
      { name: "Items in x", chain: { start: "Item", pin: null, steps: [step("in_group", "out", "Group", "Group:x")] } },
      { name: "Back", chain: { start: "Group", pin: "Group:x", steps: [step("in_group", "in", "Item")] } },
    ]);
  });

  it("a link written alone is followed out; `in` must be written, even on an edge type from a type to itself", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const { chains } = resolveChains([saved("Bare", "Item", [{ link: "in_group" }]), saved("Back", "Group", [{ link: "in_group" }])], file);
    expect(chains.map((c) => c.name)).toEqual(["Bare"]);
    expect(chains[0]!.chain.steps).toEqual([step("in_group", "out", "Group")]);
  });

  it("a chain naming a type, link or pin the mosaic lacks is reported by name and left out; the others stay", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const { chains, notices } = resolveChains(
      [
        saved("No type", "Nope"),
        saved("No link", "Item", [{ link: "knows out" }]),
        saved("Wrong way", "Item", [{ link: "in_group in" }]),
        saved("Wrong pin", "Item", [{ link: "in_group out", pin: "Item:a" }]),
        saved("Good", "Group"),
      ],
      file,
    );
    expect(chains.map((c) => c.name)).toEqual(["Good"]);
    expect(notices).toHaveLength(4);
    expect(notices[0]).toMatch(/^view file: chains\.No type: .*Nope/);
    expect(notices[1]).toMatch(/^view file: chains\.No link: step 1: .*knows/);
    expect(notices[2]).toMatch(/^view file: chains\.Wrong way: step 1: .*in_group/);
    expect(notices[3]).toMatch(/^view file: chains\.Wrong pin: step 1: Item:a is not a Group/);
  });

  it("the Viewer lists them; a thing the mosaic lacks is reported by name; the rest of the view file applies and the page opens", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.setView(
      parseView({
        cards: [{ name: "Item", show: ["code"], links: [], counts: [] }],
        chains: [saved("Gone", "Item", [{ link: "in_group out", pin: "Group:nope" }]), saved("Items", "Item", [{ link: "in_group out" }]), saved("Ghost", "Nope")],
      }),
    );
    await viewer.chainsChecked;
    expect(viewer.status).toBe("ready");
    expect(viewer.savedChains.map((c) => c.name)).toEqual(["Items"]);
    // In the order the view file writes the chains.
    expect(viewer.chainNotices).toEqual([expect.stringMatching(/^view file: chains\.Gone: the mosaic has no thing Group:nope$/), expect.stringMatching(/^view file: chains\.Ghost: .*Nope/)]);
    expect(viewer.shape?.card("Item")?.show).toEqual(["code"]);
  });

  it("another mosaic opened: its own chains and notices", async () => {
    const viewer = new Viewer();
    await viewer.setView(parseView({ chains: [saved("Items", "Item")] }));
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.chainsChecked;
    expect(viewer.savedChains.map((c) => c.name)).toEqual(["Items"]);
    expect(viewer.chainNotices).toEqual([]);
  });
});

describe("a chain the person built, as view-file text to copy (V-15)", () => {
  const built: Chain = { start: "Item", pin: "Item:a", steps: [step("in_group", "out", "Group"), step("in_group", "in", "Item", "Item:b")] };

  it("is written as the view file writes it: a link alone, or a link with its pin", () => {
    // A link followed out is written alone, as a card's; `in` is written.
    expect(chainSettings("Mine", built)).toEqual(saved("Mine", "Item", [{ link: "in_group" }, { link: "in_group in", pin: "Item:b" }], "Item:a"));
    expect(chainsText([], chainSettings("Mine", built))).toBe(
      'chains:\n  Mine:\n    start: Item\n    pin: "Item:a"\n    steps:\n      - in_group\n      - link: in_group in\n        pin: "Item:b"\n',
    );
  });

  it("a chain of a start alone has no steps; no chains at all is an empty section", () => {
    expect(chainsText([], chainSettings("Items", { start: "Item", pin: null, steps: [] }))).toBe("chains:\n  Items:\n    start: Item\n");
    expect(chainsText([], null)).toBe("chains: {}\n");
  });

  it("keeps the view file's chains, in order; one of the same label is replaced where it stands", () => {
    const file = [saved("A", "Item"), saved("B", "Group"), saved("C", "Item")];
    const text = chainsText(file, saved("B", "Item", [{ link: "in_group out" }]));
    expect(text).toBe("chains:\n  A:\n    start: Item\n  B:\n    start: Item\n    steps:\n      - in_group out\n  C:\n    start: Item\n");
    expect(chainsText(file, saved("D", "Group"))).toMatch(/ {2}C:\n {4}start: Item\n {2}D:\n {4}start: Group\n$/);
  });

  it("labels and ids YAML would read as other text are quoted", () => {
    const text = chainsText([], saved("2024: best #1", "Item", [{ link: "in_group out", pin: "Group:true" }], "Item:null"));
    expect(text).toContain('  "2024: best #1":\n');
    expect(text).toContain('    pin: "Item:null"\n');
    expect(text).toContain('        pin: "Group:true"\n');
  });

  it("a default label names the chain's types in order", () => {
    expect(chainName(built, (t) => t)).toBe("Item → Group → Item");
    expect(chainName(built, (t) => (t === "Item" ? "Thing" : t))).toBe("Thing → Group → Thing");
  });
});

describe("the Chain view, drawn, with the view file's chains", () => {
  const SCHEMA = { nodeTypes: [{ name: "Group", count: 1 }, { name: "Item", count: 2 }], edgeTypes: [{ name: "in_group", from: "Item", to: "Group" }] };
  const props = (chain: Chain | null, more: Record<string, unknown> = {}) => ({ schema: SCHEMA, chain, count: null, onchange: () => {}, find: async () => [], ...more });
  const items = { name: "Items in x", chain: { start: "Item", pin: null, steps: [step("in_group", "out", "Group", "Group:x")] } };

  it("lists each saved chain by its label, as a button that opens it", () => {
    const { body } = render(ChainView, { props: props(null, { saved: [items, { name: "Groups", chain: { start: "Group", pin: null, steps: [] } }] }) });
    const list = body.split('aria-label="Saved chains"')[1]!;
    expect(list).toMatch(/<button[^>]*>(?:<!--[^>]*-->)*\s*Items in x\s*(?:<!--[^>]*-->)*<\/button>/);
    expect(list).toMatch(/<button[^>]*>(?:<!--[^>]*-->)*\s*Groups\s*(?:<!--[^>]*-->)*<\/button>/);
    expect(list.indexOf("Items in x")).toBeLessThan(list.indexOf("Groups"));
  });

  it("with none saved, no list", () => {
    expect(render(ChainView, { props: props(null) }).body).not.toContain("Saved chains");
  });

  it("gives the chain built as view-file text, under a label the person can change", () => {
    const chain: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
    const { body } = render(ChainView, { props: props(chain, { fileChains: [saved("Old", "Group")] }) });
    expect(body).toMatch(/<input[^>]*id="[^"]*-label"[^>]*value="Item → Group"/);
    expect(body).toContain("chains:\n  Old:\n    start: Group\n  Item → Group:\n    start: Item\n    steps:\n      - in_group\n".replace("  Item → Group:", '  "Item → Group":'));
    expect(body).toContain("Copy the text");
    // Behind a button, closed until asked for: the results stay next to their count.
    expect(body).toMatch(/<button[^>]*aria-expanded="false"[^>]*>(?:<!--[^>]*-->)*\s*Keep the chain in the view file/);
    expect(body).toMatch(/<div class="place keep[^"]*"[^>]*hidden/);
  });

  it("with no chain, no text", () => {
    expect(render(ChainView, { props: props(null) }).body).not.toContain("Copy the text");
  });
});

describe("the texts tests/viewer/test_chain_text_read.py reads back, byte for byte", () => {
  it("are the texts the page writes", () => {
    expect(chainsText([], saved("Items in x", "Item", [{ link: "in_group out", pin: "Group:x" }]))).toBe(
      'chains:\n  "Items in x":\n    start: Item\n    steps:\n      - link: in_group out\n        pin: "Group:x"\n',
    );
    const mine: Chain = { start: "Item", pin: "Item:a", steps: [step("in_group", "out", "Group"), step("in_group", "in", "Item", "Item:b")] };
    expect(chainsText([saved("A", "Group")], chainSettings("Mine", mine))).toBe(
      'chains:\n  A:\n    start: Group\n  Mine:\n    start: Item\n    pin: "Item:a"\n    steps:\n      - in_group\n      - link: in_group in\n        pin: "Item:b"\n',
    );
    expect(chainsText([], null)).toBe("chains: {}\n");
    expect(chainsText([], saved('2024: "best" #1 é\u2028', "Item", [], "Item:true"))).toBe('chains:\n  "2024: \\"best\\" #1 é\\u2028":\n    start: Item\n    pin: "Item:true"\n');
  });
});

describe("what the page reports of the view file's chains, in order (V-18)", () => {
  it("a chain with several faults: one notice, naming the first", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const { notices } = resolveChains([saved("Two faults", "Item", [{ link: "in_group out", pin: "Item:a" }, { link: "knows out" }])], file);
    // The first in the chain's order: step 1's pin comes before step 2's link.
    expect(notices).toEqual(["view file: chains.Two faults: step 1: Item:a is not a Group"]);
    const linkFirst = resolveChains([saved("Link first", "Item", [{ link: "knows out" }, { link: "in_group out", pin: "Item:a" }])], file);
    expect(linkFirst.notices).toEqual(["view file: chains.Link first: step 1: the mosaic has no edge type knows"]);
    const pinFirst = resolveChains([saved("Pin first", "Item", [{ link: "in_group out", pin: "Item:a" }, { link: "in_group in" }, { link: "in_group out", pin: "Item:b" }])], file);
    expect(pinFirst.notices).toEqual(["view file: chains.Pin first: step 1: Item:a is not a Group"]);
  });

  it("one notice per chain, in the order the view file writes them, whatever the fault", async () => {
    const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
    const has = async (id: string) => id !== "Group:nope";
    const { chains, notices } = await checkChains([saved("Gone", "Item", [{ link: "in_group out", pin: "Group:nope" }]), saved("Ghost", "Nope"), saved("Items", "Item")], file, has);
    expect(chains.map((c) => c.name)).toEqual(["Items"]);
    expect(notices).toEqual(["view file: chains.Gone: the mosaic has no thing Group:nope", "view file: chains.Ghost: the mosaic has no node type Nope"]);
  });

  it("the Viewer reports them in that order", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.setView(parseView({ chains: [saved("Gone", "Item", [{ link: "in_group out", pin: "Group:nope" }]), saved("Ghost", "Nope")] }));
    await viewer.chainsChecked;
    expect(viewer.chainNotices).toEqual(["view file: chains.Gone: the mosaic has no thing Group:nope", "view file: chains.Ghost: the mosaic has no node type Nope"]);
  });
});

const SCHEMA = {
  nodeTypes: [
    { name: "Group", count: 1 },
    { name: "Item", count: 2 },
    { name: "Person", count: 3 },
  ],
  edgeTypes: [
    { name: "in_group", from: "Item", to: "Group" },
    { name: "knows", from: "Person", to: "Person" },
    { name: "in", from: "Person", to: "Item" },
    { name: "out", from: "Item", to: "Person" },
  ],
} as never;

describe("resolveChains: what the view file's chains are on a mosaic (V-1, V-2, V-18)", () => {
  it("none or an empty list gives no chains and no notices", () => {
    expect(resolveChains(null, SCHEMA)).toEqual({ chains: [], notices: [] });
    expect(resolveChains([], SCHEMA)).toEqual({ chains: [], notices: [] });
  });

  it("a chain of several steps follows each step's other end, pinned or open (V-1, V-2)", () => {
    const { chains, notices } = resolveChains([saved("Long", "Item", [{ link: "in_group out" }, { link: "in_group in", pin: "Item:b" }, { link: "out out" }], "Item:a")], SCHEMA);
    expect(notices).toEqual([]);
    expect(chains).toEqual([
      { name: "Long", chain: { start: "Item", pin: "Item:a", steps: [step("in_group", "out", "Group"), step("in_group", "in", "Item", "Item:b"), step("out", "out", "Person")] } },
    ]);
  });

  it("a link that leaves and returns to the same type is followed either way", () => {
    const { chains, notices } = resolveChains([saved("Friends", "Person", [{ link: "knows out" }, { link: "knows in" }])], SCHEMA);
    expect(notices).toEqual([]);
    expect(chains[0]!.chain.steps.map((s) => s.type)).toEqual(["Person", "Person"]);
  });

  it("an edge type named in or out is a link all the same, split at its last space", () => {
    const { chains, notices } = resolveChains([saved("Odd", "Person", [{ link: "in out" }, { link: "out out" }, { link: "out in" }])], SCHEMA);
    expect(notices).toEqual([]);
    expect(chains[0]!.chain.steps.map((s) => `${s.edge} ${s.direction} ${s.type}`)).toEqual(["in out Item", "out out Person", "out in Item"]);
  });

  it("a chain of a start alone is a chain", () => {
    expect(resolveChains([saved("Groups", "Group")], SCHEMA).chains).toEqual([{ name: "Groups", chain: { start: "Group", pin: null, steps: [] } }]);
  });

  it("type and edge type names are matched exactly: case, spaces and look-alikes are other names", () => {
    const { chains, notices } = resolveChains(
      [saved("case", "item"), saved("padded", "Item "), saved("edge case", "Item", [{ link: "In_group out" }]), saved("lookalike", "Itеm")],
      SCHEMA,
    );
    expect(chains).toEqual([]);
    expect(notices).toHaveLength(4);
  });

  it("every chain that cannot be applied has its own notice, in the order written, and the others are applied in their order", () => {
    const { chains, notices } = resolveChains(
      [saved("one", "Nope"), saved("a", "Group"), saved("two", "Item", [{ link: "zzz out" }]), saved("b", "Item"), saved("three", "Item", [{ link: "in_group out", pin: "Item:a" }]), saved("c", "Person")],
      SCHEMA,
    );
    expect(chains.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(notices).toHaveLength(3);
    expect(notices[0]).toContain("one");
    expect(notices[1]).toContain("two");
    expect(notices[2]).toContain("three");
  });

  it("a notice names the chain by its label, whatever the label holds", () => {
    const label = '2024: "best" #1 é 😀';
    const { notices } = resolveChains([saved(label, "Nope")], SCHEMA);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(label);
  });

  it("a chain wrong in several places is reported once and names the first fault", () => {
    const { chains, notices } = resolveChains([saved("Bad", "Nope", [{ link: "zzz out" }], "Nope:x")], SCHEMA);
    expect(chains).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Nope");
  });

  it("a pin of another type on the start is reported, not applied", () => {
    const { chains, notices } = resolveChains([saved("Pinned wrong", "Group", [], "Item:a")], SCHEMA);
    expect(chains).toEqual([]);
    expect(notices).toEqual([expect.stringContaining("Pinned wrong")]);
  });

  it("a step wrong after good steps is reported with its place, and the chain is left out whole", () => {
    const { chains, notices } = resolveChains([saved("Late", "Item", [{ link: "in_group out" }, { link: "in_group out" }])], SCHEMA);
    expect(chains).toEqual([]);
    expect(notices[0]).toMatch(/step 2/);
  });

  it("the same settings twice give the same chains and notices, and are not changed", () => {
    const settings = [saved("a", "Item", [{ link: "in_group out", pin: "Group:x" }]), saved("b", "Nope")];
    const before = JSON.stringify(settings);
    const first = resolveChains(settings, SCHEMA);
    const second = resolveChains(settings, SCHEMA);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(settings)).toBe(before);
  });

  it("a mosaic with no types or links reports every chain and does not fail", () => {
    const { chains, notices } = resolveChains([saved("a", "Item"), saved("b", "Group")], { nodeTypes: [], edgeTypes: [] } as never);
    expect(chains).toEqual([]);
    expect(notices).toHaveLength(2);
  });

  it("many chains are all resolved, in order", () => {
    const settings = Array.from({ length: 300 }, (_, i) => saved(`C${i}`, i % 2 ? "Item" : "Nope"));
    const { chains, notices } = resolveChains(settings, SCHEMA);
    expect(chains).toHaveLength(150);
    expect(notices).toHaveLength(150);
    expect(chains.map((c) => c.name).slice(0, 3)).toEqual(["C1", "C3", "C5"]);
  });
});

describe("withThings: the pinned things the mosaic has (V-2, V-18)", () => {
  const chain = (name: string, pin: string | null, ...stepPins: (string | null)[]): SavedChain => ({
    name,
    chain: { start: "Item", pin, steps: stepPins.map((p) => step("in_group", "out", "Group", p)) },
  });

  it("keeps a chain with no pin without asking, and the rest in order", async () => {
    const asked: string[] = [];
    const { chains, notices } = await withThings([chain("a", null), chain("b", "Item:a"), chain("c", null, null)], async (id) => (asked.push(id), true));
    expect(chains.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(notices).toEqual([]);
    expect(asked).toEqual(["Item:a"]);
  });

  it("leaves out a chain whose start pin is missing, and names the thing and the chain", async () => {
    const { chains, notices } = await withThings([chain("gone", "Item:zz"), chain("ok", "Item:a")], async (id) => id !== "Item:zz");
    expect(chains.map((c) => c.name)).toEqual(["ok"]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("gone");
    expect(notices[0]).toContain("Item:zz");
  });

  it("a missing pin on a later step leaves the chain out too", async () => {
    const { chains, notices } = await withThings([chain("late", "Item:a", null, "Group:zz")], async (id) => id !== "Group:zz");
    expect(chains).toEqual([]);
    expect(notices.join("\n")).toContain("Group:zz");
  });

  it("every missing thing of a chain is named", async () => {
    const { chains, notices } = await withThings([chain("two", "Item:m1", "Group:m2")], async () => false);
    expect(chains).toEqual([]);
    const text = notices.join("\n");
    expect(text).toContain("Item:m1");
    expect(text).toContain("Group:m2");
  });

  it("a thing the kit cannot look up is not a thing the mosaic lacks: the chain stays, with no notice", async () => {
    const { chains, notices } = await withThings([chain("a", "Item:a")], async () => {
      throw new Error("cannot look up");
    });
    expect(chains.map((c) => c.name)).toEqual(["a"]);
    expect(notices).toEqual([]);
  });

  it("no chains is no chains", async () => {
    expect(await withThings([], async () => false)).toEqual({ chains: [], notices: [] });
  });
});

describe("pinsOf and chainSettings (V-2, V-15)", () => {
  const built: Chain = { start: "Item", pin: "Item:a", steps: [step("in_group", "out", "Group"), step("in_group", "in", "Item", "Item:b")] };

  it("pinsOf gives the start's pin then each step's, in place order, without the open ones", () => {
    expect(pinsOf(built)).toEqual(["Item:a", "Item:b"]);
    expect(pinsOf({ start: "Item", pin: null, steps: [step("in_group", "out", "Group")] })).toEqual([]);
    expect(pinsOf({ start: "Item", pin: null, steps: [step("a", "out", "G", "G:1"), step("a", "out", "G", "G:1")] })).toEqual(["G:1", "G:1"]);
  });

  it("chainSettings does not carry a step's type, which the mosaic gives back", () => {
    const settings = chainSettings("Mine", built);
    expect(JSON.stringify(settings)).not.toContain("Group");
    const { chains } = resolveChains([settings], SCHEMA);
    expect(chains).toEqual([{ name: "Mine", chain: built }]);
  });

  it("a chain with no steps has no steps in the settings", () => {
    expect(chainSettings("Solo", { start: "Item", pin: null, steps: [] })).toEqual(saved("Solo", "Item"));
  });
});

describe("chainName: a default label (V-1)", () => {
  it("a chain of a start alone is its type's label", () => {
    expect(chainName({ start: "Item", pin: null, steps: [] }, (t) => `<${t}>`)).toBe("<Item>");
  });

  it("repeats a type as often as the chain does, and asks the label of each type", () => {
    const asked: string[] = [];
    const name = chainName({ start: "Person", pin: null, steps: [step("knows", "out", "Person"), step("knows", "out", "Person")] }, (t) => (asked.push(t), t));
    expect(name).toBe("Person → Person → Person");
    expect(asked).toHaveLength(3);
  });
});

describe("chainsText: the view file's chains section to copy (V-15)", () => {
  it("ends in one line feed, has no carriage return and no tab", () => {
    const text = chainsText([saved("A", "Item", [{ link: "in_group out", pin: "Group:x" }])], saved("B\r\nx\t", "Item", [], "Item:a\u2028b"));
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).not.toMatch(/[\r\t]/);
  });

  it("is the same text for the same input, twice", () => {
    const s = [saved("A", "Item", [{ link: "in_group out" }]), saved("B", "Group")];
    expect(chainsText(s, saved("C", "Item"))).toBe(chainsText(s, saved("C", "Item")));
  });

  it("a chain of the saved label is replaced where it stands and none is repeated", () => {
    const text = chainsText([saved("A", "Group"), saved("B", "Group"), saved("C", "Group")], saved("A", "Item"));
    expect(text).toBe("chains:\n  A:\n    start: Item\n  B:\n    start: Group\n  C:\n    start: Group\n");
  });

  it("a label that differs by case or by a space is a new chain", () => {
    const text = chainsText([saved("A", "Group")], saved("a", "Item"));
    expect(text).toContain("  A:\n    start: Group\n");
    expect(text).toContain("  a:\n    start: Item\n");
    expect(chainsText([saved("A", "Group")], saved("A ", "Item"))).toContain('"A ":');
  });

  it("adding to no saved chains gives only the one", () => {
    expect(chainsText([], saved("Only", "Item"))).toBe("chains:\n  Only:\n    start: Item\n");
  });

  it("does not change the saved chains it is given", () => {
    const s = [saved("A", "Group")];
    const before = JSON.stringify(s);
    chainsText(s, saved("A", "Item"));
    chainsText(s, saved("Z", "Item"));
    expect(JSON.stringify(s)).toBe(before);
  });

  it("a long label, start and pin are written whole", () => {
    const long = "L".repeat(5000);
    const text = chainsText([], saved(long, "T".repeat(3000), [{ link: "e out", pin: "P:" + "p".repeat(3000) }], "S:" + "s".repeat(3000)));
    for (const part of [long, "T".repeat(3000), "p".repeat(3000), "s".repeat(3000)]) expect(text).toContain(part);
  });
});

describe("parseView: chains of the view file as the page reads them (V-15)", () => {
  it("a chain of the settings the command serves keeps its steps' pins and order", () => {
    const view = parseView({ chains: [{ name: "C", start: "A", pin: "A:1", steps: [{ link: "e out", pin: null }, { link: "f in", pin: "B:2" }, { link: "e out", pin: null }] }] });
    expect(view.chains![0]!.steps.map((s) => s.link)).toEqual(["e out", "f in", "e out"]);
    expect(view.chains![0]!.steps[1]!.pin).toBe("B:2");
  });

  it.each([
    ["a step with two spaces", { link: "e  out", pin: null }],
    ["a step with a tab", { link: "e\tout", pin: null }],
    ["a step with a trailing line feed", { link: "e out\n", pin: null }],
    ["a step with a leading space", { link: " e out", pin: null }],
    ["a step with no edge type", { link: " out", pin: null }],
    ["a step of three words", { link: "e out in", pin: null }],
    ["a step with another direction", { link: "e up", pin: null }],
    ["a step with an empty pin", { link: "e out", pin: "" }],
    ["a step with a pin that is not text", { link: "e out", pin: 4 }],
  ])("refuses %s, naming where", (_, wrong) => {
    expect(() => parseView({ chains: [{ name: "C", start: "A", pin: null, steps: [wrong] }] })).toThrow(/chains\[0\]\.steps\[0\]/);
  });

  it("refuses an empty label, an empty pin and a start that is not text, naming where", () => {
    expect(() => parseView({ chains: [{ name: "", start: "A", pin: null, steps: [] }] })).toThrow(/chains\[0\]\.name/);
    expect(() => parseView({ chains: [{ name: "C", start: "A", pin: "", steps: [] }] })).toThrow(/chains\[0\]\.pin/);
    expect(() => parseView({ chains: [{ name: "C", start: 3, pin: null, steps: [] }] })).toThrow(/chains\[0\]\.start/);
  });

  it("refuses chains that are not a list", () => {
    expect(() => parseView({ chains: { C: { start: "A" } } })).toThrow(/chains/);
    expect(() => parseView({ chains: "x" })).toThrow(/chains/);
  });

  it("an empty list of chains is kept as no chain saved, not as none set", () => {
    expect(parseView({ chains: [] }).chains).toEqual([]);
  });

  it("a duplicate label is refused, whichever pair of chains it is", () => {
    const c = (name: string) => ({ name, start: "A", pin: null, steps: [] });
    expect(() => parseView({ chains: [c("a"), c("b"), c("a")] })).toThrow(/chains\[2\]\.name/);
  });
});

describe("the Chain view draws a view file's labels as text, never as markup", () => {
  const hostile = '<img src=x onerror="alert(1)"> & "q"';
  const props = (more: Record<string, unknown>) => ({
    schema: { nodeTypes: [{ name: "Group", count: 1 }, { name: "Item", count: 2 }], edgeTypes: [{ name: "in_group", from: "Item", to: "Group" }] },
    chain: null,
    count: null,
    onchange: () => {},
    find: async () => [],
    ...more,
  });

  it("a saved chain's label", async () => {
    const { render } = await import("svelte/server");
    const ChainView = (await import("../src/components/ChainView.svelte")).default;
    const { body } = render(ChainView, { props: props({ saved: [{ name: hostile, chain: { start: "Item", pin: null, steps: [] } }] }) });
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img src=x");
  });

  it("the text to copy, which holds the label", async () => {
    const { render } = await import("svelte/server");
    const ChainView = (await import("../src/components/ChainView.svelte")).default;
    const chain: Chain = { start: "Item", pin: null, steps: [step("in_group", "out", "Group")] };
    const { body } = render(ChainView, { props: props({ chain, fileChains: [saved(hostile, "Group")] }) });
    expect(body).not.toContain("<img src=x");
  });
});

const applied = (start: string, links: string[]) => resolveChains([saved("C", start, links.map((link) => ({ link })))], SCHEMA);

describe("a link alone is followed out; `in` must be written", () => {
  it("on an edge type from a type to itself, alone is out and `in` is the other way", () => {
    const { chains, notices } = applied("Person", ["knows", "knows in", "knows out"]);
    expect(notices).toEqual([]);
    expect(chains[0]!.chain.steps).toEqual([step("knows", "out", "Person"), step("knows", "in", "Person"), step("knows", "out", "Person")]);
  });

  it("alone gives the same step as `out`", () => {
    for (const start of ["Item", "Person"]) {
      const a = applied(start, [start === "Item" ? "in_group" : "knows"]);
      const b = applied(start, [start === "Item" ? "in_group out" : "knows out"]);
      expect(a.notices).toEqual([]);
      expect(a).toEqual(b);
    }
  });

  it("alone from the type an edge type points to is not applied: it is reported, and `in` fixes it", () => {
    const bare = applied("Group", ["in_group"]);
    expect(bare.chains).toEqual([]);
    expect(bare.notices).toEqual([expect.stringContaining("in_group")]);
    expect(applied("Group", ["in_group in"]).chains[0]!.chain.steps).toEqual([step("in_group", "in", "Item")]);
  });

  it("an edge type named `in` or `out`, alone, is that edge type followed out", () => {
    expect(applied("Person", ["in"]).chains[0]!.chain.steps).toEqual([step("in", "out", "Item")]);
    expect(applied("Item", ["out"]).chains[0]!.chain.steps).toEqual([step("out", "out", "Person")]);
  });

  it("an edge type named `in`, alone from the type it points to, is reported; `in in` follows it back", () => {
    const bare = applied("Item", ["in"]);
    expect(bare.chains).toEqual([]);
    expect(bare.notices).toHaveLength(1);
    expect(applied("Item", ["in in"]).chains[0]!.chain.steps).toEqual([step("in", "in", "Person")]);
    expect(applied("Person", ["out in"]).chains[0]!.chain.steps).toEqual([step("out", "in", "Item")]);
    expect(applied("Person", ["out"]).chains).toEqual([]);
  });

  it("a chain mixing alone, `out` and `in` follows each step from the type the one before reached", () => {
    const { chains, notices } = applied("Item", ["in_group", "in_group in", "in_group out", "in_group in", "out"]);
    expect(notices).toEqual([]);
    expect(chains[0]!.chain.steps.map((s) => `${s.direction}:${s.type}`)).toEqual(["out:Group", "in:Item", "out:Group", "in:Item", "out:Person"]);
  });

  it("a step alone with a pin, written as a link with its pin, is followed out and checked against the type reached", () => {
    const good = resolveChains([saved("C", "Item", [{ link: "in_group", pin: "Group:x" }])], SCHEMA);
    expect(good.chains[0]!.chain.steps).toEqual([step("in_group", "out", "Group", "Group:x")]);
    const wrong = resolveChains([saved("C", "Item", [{ link: "in_group", pin: "Item:x" }])], SCHEMA);
    expect(wrong.chains).toEqual([]);
    expect(wrong.notices[0]).toMatch(/step 1/);
  });
});

describe("a link spelled other than a card spells it is not a step", () => {
  const BAD = ["", " ", "in_group  out", " in_group", "in_group ", "in_group out ", "in_group\tout", "in_group\nout", "in_group out\n", "in_group OUT", "in_group Out", "in_group both", "in_group in in", "in_group out out"];
  // Not white space to the link syntax, so one edge type name: the mosaic lacks it.
  const ODD_NAMES = ["in_group\u00a0out", "in_group\u2003in", "in_group\u2028in"];

  it("resolveChains reports each, naming the chain, and does not throw", () => {
    for (const link of [...BAD, ...ODD_NAMES]) {
      const { chains, notices } = resolveChains([saved("Spelled", "Item", [{ link }]), saved("Fine", "Item")], SCHEMA);
      expect(chains.map((c) => c.name), JSON.stringify(link)).toEqual(["Fine"]);
      expect(notices, JSON.stringify(link)).toEqual([expect.stringContaining("Spelled")]);
    }
  });

  it("parseView refuses each, naming the step", () => {
    for (const link of BAD) {
      expect(() => parseView({ chains: [{ name: "C", start: "Item", pin: null, steps: [{ link, pin: null }] }] }), JSON.stringify(link)).toThrow(/chains\[0\]\.steps\[0\]\.link/);
    }
  });

  it("parseView takes the three spellings, and edge types named in or out", () => {
    for (const link of ["e", "e in", "e out", "in", "out", "in in", "out out", "in out", "out in", "é in", "😀"]) {
      const view = parseView({ chains: [{ name: "C", start: "A", pin: null, steps: [{ link, pin: null }] }] });
      expect(view.chains?.[0]?.steps[0]?.link, link).toBe(link);
    }
  });

  it("parseView refuses a step with a bad link after good ones, naming that step", () => {
    const steps = [{ link: "e", pin: null }, { link: "e in", pin: null }, { link: "e sideways", pin: null }];
    expect(() => parseView({ chains: [{ name: "C", start: "A", pin: null, steps }] })).toThrow(/chains\[0\]\.steps\[2\]\.link/);
  });
});

describe("the page writes a link followed out alone, and what it writes is the chain it built", () => {
  it("writes alone for out and `in` for in, whatever the edge type is named", () => {
    const edges = ["knows", "in", "out", "in_group", "é", "😀 ", "x".repeat(2000)].map((e) => e.trim());
    for (const edge of edges) {
      expect(chainSettings("C", { start: "S", pin: null, steps: [step(edge, "out", "T")] }).steps[0]!.link, edge).toBe(edge);
      expect(chainSettings("C", { start: "S", pin: null, steps: [step(edge, "in", "T")] }).steps[0]!.link, edge).toBe(`${edge} in`);
    }
  });

  it("every one-step and two-step chain the page can offer is written and read back as itself", () => {
    const builds: Chain[] = [];
    for (const t of SCHEMA.nodeTypes) {
      for (const o1 of offers(SCHEMA, t.name)) {
        const one: Chain = { start: t.name, pin: null, steps: [{ ...o1, pin: null }] };
        builds.push(one);
        for (const o2 of offers(SCHEMA, o1.type)) builds.push({ start: t.name, pin: null, steps: [...one.steps, { ...o2, pin: null }] });
      }
    }
    expect(builds.length).toBeGreaterThan(20);
    for (const chain of builds) {
      const { chains, notices } = resolveChains([chainSettings("C", chain)], SCHEMA);
      expect(notices, JSON.stringify(chain)).toEqual([]);
      expect(chains, JSON.stringify(chain)).toEqual([{ name: "C", chain }]);
    }
  });

  it("the same, with every step pinned and the start pinned", () => {
    const chain: Chain = { start: "Person", pin: "Person:a", steps: [step("knows", "out", "Person", "Person:b"), step("knows", "in", "Person", "Person:c"), step("in", "out", "Item", "Item:d"), step("out", "out", "Person", "Person:e")] };
    const { chains, notices } = resolveChains([chainSettings("C", chain)], SCHEMA);
    expect(notices).toEqual([]);
    expect(chains).toEqual([{ name: "C", chain }]);
  });

  it("an `out` read from the view file and the same alone are the same chain once applied, and each writes back alone", () => {
    const { chains } = applied("Person", ["knows out", "in"]);
    const again = resolveChains([chainSettings("C", chains[0]!.chain)], SCHEMA);
    expect(again.chains[0]!.chain).toEqual(chains[0]!.chain);
    expect(chainSettings("C", chains[0]!.chain).steps.map((s) => s.link)).toEqual(["knows", "in"]);
  });

  it("the text to copy has the link alone for out, `in` for in, and no `out` spelled", () => {
    const chain: Chain = { start: "Person", pin: null, steps: [step("knows", "out", "Person"), step("knows", "in", "Person"), step("in", "out", "Item"), step("in", "in", "Person")] };
    expect(chainsText([], chainSettings("C", chain))).toBe("chains:\n  C:\n    start: Person\n    steps:\n      - knows\n      - knows in\n      - in\n      - in in\n");
  });

  it("a chain read with `out` spelled keeps its spelling in the text when it is saved unchanged", () => {
    const file = [saved("Old", "Person", [{ link: "knows out" }, { link: "knows" }])];
    expect(chainsText(file, null)).toBe("chains:\n  Old:\n    start: Person\n    steps:\n      - knows out\n      - knows\n");
  });
});
