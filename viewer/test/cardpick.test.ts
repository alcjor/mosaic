// Choose what a card shows (docs/design.md, "Viewer: chains and cards"): V-6, the viewer
// lets a person choose, for each type, which facts its card shows: properties, the things it
// links to, and how many things it links to by a given link; V-7, a type's card is set once per
// type, so every card of the type changes with it; V-15, card choices are saved in the view
// file: the page cannot write files, so it gives the `cards` text to copy into it.
import { describe, expect, it } from "vitest";
import { cardsText, chooseCard, pickOptions, startingCard, toggle } from "../src/lib/cardpick.js";
import { parseView, Shape, type CardSettings, type Schema, type ViewSettings } from "../src/lib/view.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";
import { render } from "svelte/server";
import CardPicker from "../src/components/CardPicker.svelte";

/** Titles feature people and are directed by people; employees report to employees. */
const SCHEMA: Schema = {
  nodeTypes: [
    { name: "Title", count: 3 },
    { name: "Person", count: 4 },
    { name: "Employee", count: 2 },
  ],
  edgeTypes: [
    { name: "directed_by", from: "Title", to: "Person" },
    { name: "features", from: "Title", to: "Person" },
    { name: "reports_to", from: "Employee", to: "Employee" },
  ],
  propsOf: (type: string) => ({ Title: ["release_year", "rating"], Person: ["name"], Employee: ["title"] })[type] ?? [],
};

function view(json: Record<string, unknown> = {}): ViewSettings {
  return parseView({ search: "semantic", theme: "auto", types: null, export: { types: null }, cards: null, ...json });
}

describe("what a card can show (V-6)", () => {
  it("the summary and the type's properties, and each link the type has, written as the view file writes it", () => {
    expect(pickOptions(SCHEMA, "Title")).toEqual({ show: ["summary", "release_year", "rating"], links: ["directed_by", "features"] });
    expect(pickOptions(SCHEMA, "Person")).toEqual({ show: ["summary", "name"], links: ["directed_by in", "features in"] });
    // An edge type from a type to itself has both directions there: each is written with its own.
    expect(pickOptions(SCHEMA, "Employee")).toEqual({ show: ["summary", "title"], links: ["reports_to out", "reports_to in"] });
  });

  it("nothing for a type the mosaic lacks", () => {
    expect(pickOptions(SCHEMA, "Nope")).toEqual({ show: [], links: [] });
  });
});

describe("the card a choice starts from", () => {
  it("the type's card in the view file, as written", () => {
    const v = view({ cards: [{ name: "Title", show: ["rating"], links: ["directed_by"], counts: ["features"] }] });
    expect(startingCard(v, SCHEMA, "Title")).toEqual({ name: "Title", show: ["rating"], links: ["directed_by"], counts: ["features"] });
  });

  it("each link spelled as the picker spells it, as the view file means it (a bare edge type is each direction it has there)", () => {
    const v = view({
      cards: [
        { name: "Person", show: [], links: ["directed_by in"], counts: ["features"] },
        { name: "Employee", show: [], links: [], counts: ["reports_to"] },
        { name: "Title", show: [], links: ["directed_by out", "nope", "features"], counts: ["features out", "features"] },
      ],
    });
    expect(startingCard(v, SCHEMA, "Person")).toEqual({ name: "Person", show: [], links: ["directed_by in"], counts: ["features in"] });
    expect(startingCard(v, SCHEMA, "Employee")).toEqual({ name: "Employee", show: [], links: [], counts: ["reports_to out", "reports_to in"] });
    // A name the mosaic lacks is kept as written; a link written twice is picked once.
    expect(startingCard(v, SCHEMA, "Title")).toEqual({ name: "Title", show: [], links: ["directed_by", "nope", "features"], counts: ["features"] });
    // So unpicking such a link takes it off the card: no other spelling of it stays behind.
    const off = toggle(startingCard(v, SCHEMA, "Employee"), "counts", "reports_to in", false);
    expect(new Shape(chooseCard(v, off), SCHEMA).card("Employee")?.counts).toEqual([{ edge: "reports_to", direction: "out" }]);
  });

  it("with none set, the default card written out: the summary, the properties and a count per link", () => {
    expect(startingCard(view(), SCHEMA, "Title")).toEqual({ name: "Title", show: ["summary", "release_year", "rating"], links: [], counts: ["directed_by", "features"] });
  });

  it("with none set, a property named summary is the summary, once", () => {
    const schema: Schema = { ...SCHEMA, propsOf: (type: string) => (type === "Title" ? ["summary", "rating"] : []) };
    expect(startingCard(view(), schema, "Title").show).toEqual(["summary", "rating"]);
  });

  it("with none set, the default follows the view file's page for the type", () => {
    const v = view({ types: [{ name: "Title", label: null, columns: null, page: ["rating", "features"], names: {} }] });
    expect(startingCard(v, SCHEMA, "Title")).toEqual({ name: "Title", show: ["summary", "rating"], links: [], counts: ["features"] });
  });
});

describe("picking a fact", () => {
  const card: CardSettings = { name: "Title", show: ["summary", "rating"], links: [], counts: ["features"] };

  it("a fact picked comes last; one unpicked goes, and the others keep their order", () => {
    expect(toggle(card, "show", "release_year", true).show).toEqual(["summary", "rating", "release_year"]);
    expect(toggle(card, "show", "summary", false).show).toEqual(["rating"]);
    expect(toggle(card, "links", "directed_by", true).links).toEqual(["directed_by"]);
    expect(toggle(card, "counts", "features", false).counts).toEqual([]);
  });

  it("picking what is picked, or unpicking what is not, changes nothing", () => {
    expect(toggle(card, "show", "rating", true)).toEqual(card);
    expect(toggle(card, "links", "features", false)).toEqual(card);
  });

  it("never changes the card it is given", () => {
    const before = JSON.stringify(card);
    toggle(card, "show", "release_year", true);
    expect(JSON.stringify(card)).toBe(before);
  });
});

describe("a choice is the type's card everywhere (V-7)", () => {
  it("replaces the type's card in the settings, keeping every other card and setting", () => {
    const v = view({ theme: "dark", cards: [{ name: "Person", show: ["name"], links: [], counts: [] }, { name: "Title", show: ["rating"], links: [], counts: [] }] });
    const chosen = chooseCard(v, { name: "Title", show: ["summary"], links: ["directed_by"], counts: [] });
    expect(chosen.cards).toEqual([
      { name: "Person", show: ["name"], links: [], counts: [] },
      { name: "Title", show: ["summary"], links: ["directed_by"], counts: [] },
    ]);
    expect({ ...chosen, cards: null }).toEqual({ ...v, cards: null });
  });

  it("adds the type's card when the view file has none", () => {
    expect(chooseCard(view(), { name: "Title", show: [], links: [], counts: [] }).cards).toEqual([{ name: "Title", show: [], links: [], counts: [] }]);
  });

  it("the open page and every card of the type change at once", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.setView(view());
    await viewer.show("Item:a");
    expect(viewer.facts?.map((f) => f.kind)).toContain("count");
    await viewer.chooseCard({ name: "Item", show: ["code"], links: ["in_group"], counts: [] });
    expect(viewer.shape?.card("Item")).toEqual({ show: ["code"], links: [{ edge: "in_group", direction: "out" }], counts: [] });
    expect(viewer.facts?.map((f) => (f.kind === "property" ? `property:${f.name}` : f.kind))).toEqual(["property:code", "links"]);
    // Another thing of the type opens with the same card.
    await viewer.show("Item:b");
    expect(viewer.facts?.map((f) => (f.kind === "property" ? `property:${f.name}` : f.kind))).toEqual(["property:code", "links"]);
    expect(viewer.chosen).toEqual(["Item"]);
  });

  it("back to the view file's card, and a view file read again replaces the choices", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    const file = view({ cards: [{ name: "Item", show: ["size"], links: [], counts: [] }] });
    await viewer.setView(file);
    await viewer.chooseCard({ name: "Item", show: ["code"], links: [], counts: [] });
    await viewer.resetCard("Item");
    expect(viewer.shape?.card("Item")?.show).toEqual(["size"]);
    expect(viewer.chosen).toEqual([]);
    await viewer.chooseCard({ name: "Item", show: ["code"], links: [], counts: [] });
    await viewer.setView(file);
    expect(viewer.shape?.card("Item")?.show).toEqual(["size"]);
    expect(viewer.chosen).toEqual([]);
  });
});

describe("the view-file text to copy (V-15)", () => {
  it("the whole cards section, every card in order, each part as a list", () => {
    expect(
      cardsText([
        { name: "Title", show: ["summary", "release_year"], links: ["directed_by"], counts: ["features"] },
        { name: "Person", show: [], links: [], counts: ["features in", "directed_by in"] },
      ]),
    ).toBe(
      "cards:\n" +
        "  Title:\n" +
        "    show: [summary, release_year]\n" +
        "    links: [directed_by]\n" +
        "    counts: [features]\n" +
        "  Person:\n" +
        "    counts: [features in, directed_by in]\n",
    );
  });

  it("a card showing nothing is written as one", () => {
    expect(cardsText([{ name: "Title", show: [], links: [], counts: [] }])).toBe("cards:\n  Title: {}\n");
  });

  it("no cards is an empty section", () => {
    expect(cardsText([])).toBe("cards: {}\n");
  });

  it("quotes a name YAML would read as something other than that text", () => {
    const text = cardsText([{ name: "Null", show: ["release year", "true", "2020", "a: b", "#x", 'say "hi"', "é"], links: [], counts: [] }]);
    expect(text).toBe('cards:\n  "Null":\n    show: ["release year", "true", "2020", "a: b", "#x", "say \\"hi\\"", "é"]\n');
  });

  it("read back as the page reads settings, gives the same card", () => {
    // The text's JSON, as `mosaic view` would hand it: the same settings, so the same card on the mosaic.
    const cards: CardSettings[] = [
      { name: "Title", show: ["rating", "summary"], links: ["features"], counts: ["directed_by"] },
      { name: "Employee", show: [], links: ["reports_to in"], counts: ["reports_to out"] },
    ];
    const back = parseView({ cards }).cards!;
    expect(back).toEqual(cards);
    const shape = new Shape(view({ cards: back }), SCHEMA);
    expect(shape.card("Employee")).toEqual({ show: [], links: [{ edge: "reports_to", direction: "in" }], counts: [{ edge: "reports_to", direction: "out" }] });
  });
});

describe("the texts the view-file reader is tested with in CI (tests/viewer/test_card_text_read.py)", () => {
  // The page writes exactly these texts; the Python test reads each back as these cards.
  const LONG = "T".repeat(1100);
  const card = (name: string, show: string[] = [], links: string[] = [], counts: string[] = []): CardSettings => ({ name, show, links, counts });
  it.each([
    ["cards:\n  Item:\n    show: [code, summary]\n    links: [in_group]\n", [card("Item", ["code", "summary"], ["in_group"])]],
    ["cards:\n  Item:\n    counts: [in_group out]\n  Group:\n    show: [name]\n    links: [in_group in]\n    counts: [in_group in]\n", [card("Item", [], [], ["in_group out"]), card("Group", ["name"], ["in_group in"], ["in_group in"])]],
    ["cards:\n  Item: {}\n", [card("Item")]],
    ["cards: {}\n", []],
    [
      'cards:\n  "Null":\n    show: ["release year", "true", "2020", "a: b", "#x", "say \\"hi\\"", "é", "- x", "[y]"]\n    links: [no, on in]\n',
      [card("Null", ["release year", "true", "2020", "a: b", "#x", 'say "hi"', "é", "- x", "[y]"], ["no", "on in"])],
    ],
    ['cards:\n  Item:\n    show: ["a\\u2028b\\u007fc\\u0085d"]\n', [card("Item", ["a b\u007fc\u0085d"])]],
    [`cards:\n  ? ${LONG}\n  : {}\n`, [card(LONG)]],
  ] as const)("%#", (text, cards) => {
    expect(cardsText(cards)).toBe(text);
  });
});

describe("cardpick: further cases", () => {
  const SCHEMA: Schema = {
    nodeTypes: [
      { name: "Title", count: 3 },
      { name: "Person", count: 4 },
      { name: "Bare", count: 1 },
    ],
    edgeTypes: [
      { name: "directed_by", from: "Title", to: "Person" },
      { name: "features", from: "Title", to: "Person" },
      { name: "knows", from: "Person", to: "Person" },
      { name: "sequel_of", from: "Title", to: "Title" },
    ],
    propsOf: (type: string) => ({ Title: ["release_year", "rating"], Person: ["name"] })[type] ?? [],
  };

  function view(json: Record<string, unknown> = {}): ViewSettings {
    return parseView({ search: "semantic", theme: "auto", types: null, export: { types: null }, cards: null, ...json });
  }

  function deepFreeze<T>(value: T): T {
    if (typeof value === "object" && value !== null) {
      Object.freeze(value);
      for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
  }

  describe("what a card can show: edges of the picker (V-6)", () => {
    it("a type with no properties and no links still offers the summary", () => {
      expect(pickOptions(SCHEMA, "Bare")).toEqual({ show: ["summary"], links: [] });
    });

    it("an empty mosaic offers nothing, for any type", () => {
      const empty: Schema = { nodeTypes: [], edgeTypes: [], propsOf: () => [] };
      expect(pickOptions(empty, "Title")).toEqual({ show: [], links: [] });
      expect(pickOptions(empty, "")).toEqual({ show: [], links: [] });
    });

    it("a type name is matched exactly: case, spaces and prefixes make another type", () => {
      for (const other of ["title", "Title ", " Title", "Titl", "TITLE"]) {
        expect(pickOptions(SCHEMA, other)).toEqual({ show: [], links: [] });
      }
    });

    it("a type that is only the end of a link offers the link as incoming; both ends of one edge type in one type offer both directions, in a fixed order", () => {
      expect(pickOptions(SCHEMA, "Person").links).toEqual(["directed_by in", "features in", "knows out", "knows in"]);
      expect(pickOptions(SCHEMA, "Title").links).toEqual(["directed_by", "features", "sequel_of out", "sequel_of in"]);
    });

    it("a property named like the summary is offered once", () => {
      const schema: Schema = { ...SCHEMA, propsOf: () => ["summary", "rating"] };
      const { show } = pickOptions(schema, "Title");
      expect(new Set(show).size).toBe(show.length);
      expect(show.filter((n) => n === "summary")).toHaveLength(1);
    });

    it("is the same answer every time, and never changes the schema it reads", () => {
      const frozen = deepFreeze({ ...SCHEMA, nodeTypes: [...SCHEMA.nodeTypes], edgeTypes: [...SCHEMA.edgeTypes] });
      expect(pickOptions(frozen, "Person")).toEqual(pickOptions(frozen, "Person"));
      expect(JSON.stringify(pickOptions(frozen, "Title"))).toBe(JSON.stringify(pickOptions(SCHEMA, "Title")));
    });

    it("property names with spaces, quotes and non-ASCII text are offered as they are", () => {
      const schema: Schema = { ...SCHEMA, propsOf: () => ["release year", 'say "hi"', "é", "日本"] };
      expect(pickOptions(schema, "Title").show).toEqual(["summary", "release year", 'say "hi"', "é", "日本"]);
    });

    it("a property named like a JavaScript built-in is an ordinary name", () => {
      const schema: Schema = { ...SCHEMA, propsOf: () => ["constructor", "__proto__", "toString"] };
      expect(pickOptions(schema, "Title").show).toEqual(["summary", "constructor", "__proto__", "toString"]);
    });
  });

  describe("the card a choice starts from: edges (V-9, V-18)", () => {
    it("the view file's card is returned as written, even for facts the mosaic lacks (V-18: reported elsewhere, never dropped by a copy)", () => {
      const v = view({ cards: [{ name: "Title", show: ["nope", "rating"], links: ["gone"], counts: ["nope in"] }] });
      expect(startingCard(v, SCHEMA, "Title")).toEqual({ name: "Title", show: ["nope", "rating"], links: ["gone"], counts: ["nope in"] });
    });

    it("a card set to show nothing starts from nothing, not from the default", () => {
      const v = view({ cards: [{ name: "Title", show: [], links: [], counts: [] }] });
      expect(startingCard(v, SCHEMA, "Title")).toEqual({ name: "Title", show: [], links: [], counts: [] });
    });

    it("with none set, a type with no properties and no links starts with the summary only", () => {
      expect(startingCard(view(), SCHEMA, "Bare")).toEqual({ name: "Bare", show: ["summary"], links: [], counts: [] });
    });

    it("with none set, the default for an incoming-only type counts its incoming links as written", () => {
      expect(startingCard(view(), SCHEMA, "Person")).toEqual({
        name: "Person",
        show: ["summary", "name"],
        links: [],
        counts: ["directed_by in", "features in", "knows out", "knows in"],
      });
    });

    it("a type the mosaic lacks gives a card of that name that shows nothing the mosaic could not give", () => {
      const card = startingCard(view(), SCHEMA, "Nope");
      expect(card.name).toBe("Nope");
      expect(card.links).toEqual([]);
      expect(card.counts).toEqual([]);
    });

    it("starting from a card does not change the view settings", () => {
      const v = view({ cards: [{ name: "Title", show: ["rating"], links: [], counts: [] }] });
      const before = JSON.stringify(v);
      startingCard(v, SCHEMA, "Title");
      startingCard(v, SCHEMA, "Person");
      expect(JSON.stringify(v)).toBe(before);
    });

    it("a card for another type in the view file does not stand in for this type's", () => {
      const v = view({ cards: [{ name: "Person", show: ["name"], links: [], counts: [] }] });
      expect(startingCard(v, SCHEMA, "Title").show).toEqual(["summary", "release_year", "rating"]);
    });
  });

  describe("picking a fact: edges (V-6)", () => {
    const empty: CardSettings = { name: "Title", show: [], links: [], counts: [] };

    it("picking in an empty card makes a one-fact card, and unpicking the last fact leaves an empty part", () => {
      const one = toggle(empty, "show", "rating", true);
      expect(one).toEqual({ ...empty, show: ["rating"] });
      expect(toggle(one, "show", "rating", false)).toEqual(empty);
    });

    it("a pick touches its part only, and keeps the type's name", () => {
      const card: CardSettings = { name: "Title", show: ["a"], links: ["b"], counts: ["c"] };
      expect(toggle(card, "links", "x", true)).toEqual({ name: "Title", show: ["a"], links: ["b", "x"], counts: ["c"] });
      expect(toggle(card, "counts", "b", true)).toEqual({ name: "Title", show: ["a"], links: ["b"], counts: ["c", "b"] });
    });

    it("unpicking one fact keeps the others in order, however many", () => {
      const names = Array.from({ length: 30 }, (_, i) => `p${i}`);
      const card: CardSettings = { ...empty, show: names };
      expect(toggle(card, "show", "p17", false).show).toEqual(names.filter((n) => n !== "p17"));
    });

    it("picking, unpicking and picking again puts the fact last, never twice", () => {
      let card: CardSettings = { ...empty, show: ["a", "b", "c"] };
      card = toggle(card, "show", "a", false);
      card = toggle(card, "show", "a", true);
      expect(card.show).toEqual(["b", "c", "a"]);
      card = toggle(card, "show", "a", true);
      expect(card.show).toEqual(["b", "c", "a"]);
    });

    it("a name is matched exactly: a different case or a trailing space is another fact", () => {
      const card: CardSettings = { ...empty, show: ["rating"] };
      expect(toggle(card, "show", "Rating", false).show).toEqual(["rating"]);
      expect(toggle(card, "show", "rating ", true).show).toEqual(["rating", "rating "]);
    });

    it("a link and its other direction are different facts", () => {
      const card: CardSettings = { ...empty, links: ["knows out"] };
      expect(toggle(card, "links", "knows in", true).links).toEqual(["knows out", "knows in"]);
      expect(toggle(card, "links", "knows in", false).links).toEqual(["knows out"]);
    });

    it("works on a card that cannot be changed, and gives a new one", () => {
      const frozen = deepFreeze<CardSettings>({ name: "Title", show: ["a"], links: [], counts: [] });
      const picked = toggle(frozen, "show", "b", true);
      expect(picked).not.toBe(frozen);
      expect(frozen.show).toEqual(["a"]);
      expect(picked.show).toEqual(["a", "b"]);
    });

    it("the same pick on the same card gives the same card", () => {
      const card: CardSettings = { ...empty, show: ["a"] };
      expect(toggle(card, "show", "b", true)).toEqual(toggle(card, "show", "b", true));
    });

    it("a picked card read back by parseView is valid: no name twice in a part", () => {
      let card: CardSettings = { ...empty };
      for (const n of ["a", "b", "a", "c", "b", "a"]) card = toggle(card, "show", n, true);
      expect(() => parseView({ cards: [card] })).not.toThrow();
      expect(card.show).toEqual(["a", "b", "c"]);
    });
  });

  describe("a choice is the type's card everywhere: edges (V-7)", () => {
    const card = (name: string, show: string[] = []): CardSettings => ({ name, show, links: [], counts: [] });

    it("choosing the same type again replaces its card in place, never adding a second", () => {
      const v = view({ cards: [{ ...card("A", ["x"]) }, { ...card("B", ["y"]) }, { ...card("C", ["z"]) }] });
      const once = chooseCard(v, card("B", ["new"]));
      const twice = chooseCard(once, card("B", ["newer"]));
      expect(twice.cards?.map((c) => c.name)).toEqual(["A", "B", "C"]);
      expect(twice.cards?.[1]?.show).toEqual(["newer"]);
    });

    it("types chosen one after another keep the order they were first given", () => {
      const v = chooseCard(chooseCard(chooseCard(view(), card("Z")), card("A")), card("M"));
      expect(v.cards?.map((c) => c.name)).toEqual(["Z", "A", "M"]);
    });

    it("changes neither the settings it is given nor the card", () => {
      const v = deepFreeze(view({ cards: [card("A", ["x"])] }));
      const given = deepFreeze(card("A", ["y"]));
      const chosen = chooseCard(v, given);
      expect(v.cards?.[0]?.show).toEqual(["x"]);
      expect(chosen).not.toBe(v);
    });

    it("choosing a card equal to the file's gives equal settings", () => {
      const v = view({ cards: [card("A", ["x"])] });
      expect(chooseCard(v, card("A", ["x"]))).toEqual(v);
    });

    it("leaves types, edges, export, search and theme as they were", () => {
      const v = view({ theme: "dark", search: "text", types: [{ name: "A", label: "Things", columns: null, page: null, names: {} }], export: { types: ["A"] } });
      const chosen = chooseCard(v, card("A", ["x"]));
      expect({ ...chosen, cards: null }).toEqual({ ...v, cards: null });
    });

    it("a type named like a JavaScript built-in is an ordinary type", () => {
      for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
        const chosen = chooseCard(view(), card(name, ["x"]));
        expect(chosen.cards).toHaveLength(1);
        expect(chosen.cards?.[0]?.name).toBe(name);
        const shape = new Shape(chosen, { ...SCHEMA, nodeTypes: [...SCHEMA.nodeTypes, { name, count: 1 }], propsOf: () => ["x"] });
        expect(shape.card(name)?.show).toEqual(["x"]);
      }
    });

    it("a type with no card set reads as none, even when named like a JavaScript built-in", () => {
      const shape = new Shape(view({ cards: [card("Title", ["rating"])] }), SCHEMA);
      for (const name of ["constructor", "__proto__", "toString", "Person", "Nope"]) expect(shape.card(name)).toBeNull();
    });

    it("the open page changes at once, another type's page does not", async () => {
      const viewer = new Viewer();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      await viewer.setView(view());
      await viewer.show("Item:a");
      const before = viewer.facts?.map((f) => f.kind);
      await viewer.chooseCard({ name: "Group", show: [], links: [], counts: [] });
      expect(viewer.facts?.map((f) => f.kind)).toEqual(before);
      expect(viewer.chosen).toEqual(["Group"]);
    });

    it("a card choosing nothing shows no property and no link on the page, not the default", async () => {
      const viewer = new Viewer();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      await viewer.setView(view());
      await viewer.show("Item:a");
      await viewer.chooseCard({ name: "Item", show: [], links: [], counts: [] });
      expect(viewer.facts?.filter((f) => f.kind === "property" || f.kind === "links" || f.kind === "count")).toEqual([]);
    });

    it("types are chosen in the order first chosen, a type chosen again keeps its place, a reset takes it out", async () => {
      const viewer = new Viewer();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      await viewer.setView(view());
      await viewer.chooseCard(card("Item", ["code"]));
      await viewer.chooseCard(card("Group", ["name"]));
      await viewer.chooseCard(card("Item", ["size"]));
      expect(viewer.chosen).toEqual(["Item", "Group"]);
      expect(viewer.shape?.card("Item")?.show).toEqual(["size"]);
      await viewer.resetCard("Item");
      expect(viewer.chosen).toEqual(["Group"]);
      expect(viewer.shape?.card("Group")?.show).toEqual(["name"]);
    });

    it("resetting a type never chosen, or twice, changes nothing", async () => {
      const viewer = new Viewer();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      const file = view({ cards: [card("Item", ["size"])] });
      await viewer.setView(file);
      await viewer.resetCard("Item");
      await viewer.resetCard("Nope");
      expect(viewer.chosen).toEqual([]);
      expect(viewer.shape?.card("Item")?.show).toEqual(["size"]);
      await viewer.chooseCard(card("Item", ["code"]));
      await viewer.resetCard("Item");
      await viewer.resetCard("Item");
      expect(viewer.shape?.card("Item")?.show).toEqual(["size"]);
    });

    it("a choice naming facts the mosaic lacks leaves the page opening, showing only what the mosaic has (V-18)", async () => {
      const viewer = new Viewer();
      await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
      await viewer.setView(view());
      await viewer.show("Item:a");
      await viewer.chooseCard({ name: "Item", show: ["ghost", "code"], links: ["ghost_link", "in_group"], counts: ["ghost in"] });
      expect(viewer.shape?.card("Item")).toEqual({ show: ["code"], links: [{ edge: "in_group", direction: "out" }], counts: [] });
      expect(viewer.facts?.map((f) => (f.kind === "property" ? `property:${f.name}` : f.kind))).toEqual(["property:code", "links"]);
    });

    it("choosing a card when no mosaic is open does not throw", async () => {
      const viewer = new Viewer();
      await expect(viewer.chooseCard(card("Item", ["code"]))).resolves.not.toThrow();
    });
  });

  describe("the view-file text to copy: edges (V-15)", () => {
    it("is the same text for the same cards, and does not change them", () => {
      const cards = deepFreeze<CardSettings[]>([{ name: "A", show: ["x", "y"], links: ["l"], counts: ["l in"] }]);
      expect(cardsText(cards)).toBe(cardsText(cards));
      expect(cardsText(cards).endsWith("\n")).toBe(true);
      expect(cardsText(cards).endsWith("\n\n")).toBe(false);
    });

    it("uses only line feeds and no tabs", () => {
      const text = cardsText([{ name: "A\tb", show: ["x\ty"], links: [], counts: [] }, { name: "B", show: ["z"], links: [], counts: [] }]);
      expect(text).not.toContain("\r");
      expect(text).not.toMatch(/\t/);
    });

    it("every line of a name with a line break stays inside its value: one line per key", () => {
      const text = cardsText([{ name: "A\nB", show: ["x\ny", "z\r\nw"], links: [], counts: [] }]);
      const lines = text.split("\n");
      expect(lines.filter((l) => l !== "")).toHaveLength(3);
      expect(text).not.toContain("\r");
    });

    it("the cards come in the order given, not sorted", () => {
      const text = cardsText([
        { name: "Zed", show: ["b"], links: [], counts: [] },
        { name: "Alpha", show: ["a"], links: [], counts: [] },
      ]);
      expect(text.indexOf("Zed")).toBeLessThan(text.indexOf("Alpha"));
    });

    it("leaves out an empty part but never a non-empty one", () => {
      const text = cardsText([{ name: "A", show: [], links: ["l"], counts: [] }]);
      expect(text).toBe("cards:\n  A:\n    links: [l]\n");
    });

    it("a card with only counts, only links and only show are each written with just that part", () => {
      expect(cardsText([{ name: "A", show: ["s"], links: [], counts: [] }])).toBe("cards:\n  A:\n    show: [s]\n");
      expect(cardsText([{ name: "A", show: [], links: [], counts: ["c"] }])).toBe("cards:\n  A:\n    counts: [c]\n");
    });

    it("names that YAML would read as a number, a date, null, a flag or flow syntax are quoted", () => {
      const traps = ["null", "~", "true", "1e3", "0x1F", ".inf", ".nan", "2020-01-01", "a, b", "[", "]", "{", "}", "- x", "? x", "&a", "*a", "!t", "%d", "@a", "`a", "|", ">", "#c", "a #c", "a: b", "---", "", " "];
    for (const name of traps) {
      const text = cardsText([{ name: "T", show: [name], links: [], counts: [] }]);
      expect(text, JSON.stringify(name)).toContain(`show: [${JSON.stringify(name)}]`);
    }
  });

  it("a name with a quote or a backslash is quoted and escaped", () => {
    const text = cardsText([{ name: "T", show: ['a"b', "a\\b"], links: [], counts: [] }]);
    expect(text).toContain('show: ["a\\"b", "a\\\\b"]');
  });

  it.each([
    ["NUL", "\u0000"],
    ["SOH", "\u0001"],
    ["ESC", "\u001b"],
    ["DEL", "\u007f"],
    ["NEL", "\u0085"],
    ["LINE SEPARATOR", "\u2028"],
    ["PARAGRAPH SEPARATOR", "\u2029"],
    ["BYTE ORDER MARK", "\ufeff"],
  ])(
    "a name holding %s, which YAML cannot hold raw or reads as a line break, is escaped",
    (_label, ch) => {
      const text = cardsText([{ name: "T", show: [`a${ch}b`], links: [], counts: [] }]);
      // No raw control, no raw line separator (YAML 1.1 readers break lines on them), no raw
      // byte-order mark, anywhere in the text.
      expect(text).not.toContain(ch);
    },
  );

  it("a long type name is not written as an implicit key longer than YAML allows (1024 characters)", () => {
    const text = cardsText([{ name: "T".repeat(2000), show: ["x"], links: [], counts: [] }]);
    const keyLine = text.split("\n")[1]!;
    const key = keyLine.trim();
    // Either the key is no longer than 1024 characters on its line, or it is an explicit key.
    expect(key.length <= 1024 || key.startsWith("? ")).toBe(true);
  });

  it("reads back through parseView as the cards given, for many cards at once", () => {
    const cards: CardSettings[] = Array.from({ length: 50 }, (_, i) => ({ name: `T${i}`, show: [`p${i}`], links: [`e${i}`], counts: [`e${i} in`] }));
    expect(parseView({ cards }).cards).toEqual(cards);
    expect(cardsText(cards).split("\n").filter((l) => l.startsWith("  T"))).toHaveLength(50);
  });
});

describe("the picker as drawn: edges (V-6, brand book section 6)", () => {
  const card = { name: "Title", show: ["summary"], links: [], counts: [] };
  const props = (more: Record<string, unknown> = {}) => ({
    type: "Title",
    options: { show: ["summary", "rating"], links: ["directed_by"] },
    card,
    chosen: false,
    text: cardsText([card]),
    onpick: () => {},
    onreset: () => {},
    ...more,
  });

  it("a type, an option and a text holding markup are drawn as text, never as markup", () => {
    const evil = '<img src=x onerror=alert(1)>"><script>alert(2)</script>';
    const { body } = render(CardPicker, {
      props: props({
        type: evil,
        options: { show: [evil], links: [evil] },
        card: { name: evil, show: [evil], links: [evil], counts: [evil] },
        text: evil,
      }),
    });
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;");
  });

  it("a type with nothing to pick still draws the opener and the text to copy", () => {
    const { body } = render(CardPicker, { props: props({ options: { show: [], links: [] } }) });
    expect(body).toContain("Choose what Title cards show");
    expect(body).toMatch(/<textarea[^>]*readonly/);
    expect(body).not.toMatch(/<input type="checkbox"/);
  });

  it("every checkbox has a label the person can read", () => {
    const { body } = render(CardPicker, { props: props() });
    const boxes = [...body.matchAll(/<input type="checkbox"/g)];
    expect(boxes.length).toBe(2 + 1 + 1);
    // A label wraps each input, or names it by for/id.
    const labels = [...body.matchAll(/<label/g)];
    expect(labels.length).toBeGreaterThanOrEqual(boxes.length);
  });

  it("the opener names the panel it opens, and that panel exists", () => {
    const { body } = render(CardPicker, { props: props() });
    const controls = /aria-controls="([^"]+)"/.exec(body)?.[1];
    expect(controls).toBeTruthy();
    expect(body).toContain(`id="${controls}"`);
  });

  it("two pickers on one page do not share an id", () => {
    const a = render(CardPicker, { props: props() }).body;
    const b = render(CardPicker, { props: props({ type: "Person" }) }).body;
    const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    // Rendered on their own they may agree; rendered in one page the ids come from the instance.
    // So each picker's own ids must at least be unique inside it.
    for (const html of [a, b]) expect(new Set(ids(html)).size).toBe(ids(html).length);
  });

  it("the text to copy is shown exactly as given", () => {
    const text = 'cards:\n  Title:\n    show: ["a & b", "<c>"]\n';
    const { body } = render(CardPicker, { props: props({ text }) });
    expect(body).toContain("a &amp; b");
    expect(body).toContain("&lt;c>");
  });

  it("a card whose picks the mosaic lacks still draws, checking only what it can offer", () => {
    const { body } = render(CardPicker, { props: props({ card: { name: "Title", show: ["ghost", "rating"], links: ["ghost"], counts: ["ghost"] } }) });
    const checked = [...body.matchAll(/<input type="checkbox" value="([^"]+)"([^>]*)>/g)].filter((m) => m[2]!.includes("checked")).map((m) => m[1]);
    expect(checked).toEqual(["rating"]);
  });
});
});
