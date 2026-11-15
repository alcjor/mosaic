// Cards in the view file (docs/design.md, "Viewer: chains and cards"): V-6, the viewer lets
// a person choose, for each type, which facts its card shows: properties, the things it links
// to, and how many things it links to by a given link; V-9, a type with no card set still gets a
// default; V-15, card choices are saved in the view file; V-18, a view file whose cards name
// types, links or properties the mosaic does not have still opens, and the viewer reports what
// it could not apply instead of failing. The page reads the settings `mosaic view` and
// `mosaic export` hand it (`ViewSettings.as_json`), as conformance/views/settings.json pins them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseView, Shape, type Schema } from "../src/lib/view.js";

const ROOT = new URL("../..", import.meta.url).pathname;

/** The settings' JSON with only `cards` given. */
function withCards(cards: unknown): unknown {
  return { search: "semantic", theme: "auto", types: null, export: { types: null }, cards };
}

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

describe("cards in the settings", () => {
  it("no cards is none set", () => {
    expect(parseView(withCards(null)).cards).toBeNull();
    expect(parseView({ search: "text" }).cards).toBeNull();
  });

  it("each card keeps its type, properties, links and counts in the order written", () => {
    const view = parseView(
      withCards([
        { name: "Title", show: ["summary", "rating"], links: ["directed_by"], counts: ["features"] },
        { name: "Person", show: [], links: [], counts: ["features in", "directed_by in"] },
      ]),
    );
    expect(view.cards).toEqual([
      { name: "Title", show: ["summary", "rating"], links: ["directed_by"], counts: ["features"] },
      { name: "Person", show: [], links: [], counts: ["features in", "directed_by in"] },
    ]);
  });

  it.each([
    ["cards not a list", { Title: {} }],
    ["a card with no name", [{ show: [] }]],
    ["a type named twice", [{ name: "Title" }, { name: "Title" }]],
    ["show not a list", [{ name: "Title", show: "rating" }]],
    ["a property named twice", [{ name: "Title", show: ["rating", "rating"] }]],
    ["a link with another word than in or out", [{ name: "Title", links: ["directed_by sideways"] }]],
    ["a link of three words", [{ name: "Title", links: ["directed_by out in"] }]],
    ["a count named twice", [{ name: "Title", counts: ["features", "features"] }]],
  ])("malformed settings are refused: %s", (_, cards) => {
    expect(() => parseView(withCards(cards))).toThrow(/cards/);
  });
});

describe("links read the same in the page as in the reader", () => {
  it.each(["a\ufeff", "a\u0085", "a\u001c", "a\u00a0 in"])("only ASCII white space ends a link's name: %j", (link) => {
    expect(parseView(withCards([{ name: "T", show: [], links: [link], counts: [] }])).cards![0]!.links).toEqual([link]);
  });
});

describe("a type's card on the open mosaic", () => {
  it("a type the view file sets no card for reads as having none set, so the page gives it the default", () => {
    const shape = new Shape(parseView(withCards([{ name: "Title", show: ["rating"], links: [], counts: [] }])), SCHEMA);
    expect(shape.card("Person")).toBeNull();
    expect(shape.card("Employee")).toBeNull();
    expect(new Shape(parseView(withCards(null)), SCHEMA).card("Title")).toBeNull();
  });

  it("a card set gives its properties, and links and counts with their direction", () => {
    const shape = new Shape(
      parseView(
        withCards([
          { name: "Title", show: ["summary", "release_year", "rating"], links: ["directed_by"], counts: ["features out"] },
          { name: "Person", show: ["name"], links: [], counts: ["features in", "directed_by"] },
        ]),
      ),
      SCHEMA,
    );
    expect(shape.card("Title")).toEqual({
      show: ["summary", "release_year", "rating"],
      links: [{ edge: "directed_by", direction: "out" }],
      counts: [{ edge: "features", direction: "out" }],
    });
    expect(shape.card("Person")).toEqual({
      show: ["name"],
      links: [],
      counts: [
        { edge: "features", direction: "in" },
        { edge: "directed_by", direction: "in" },
      ],
    });
    expect(shape.notices).toEqual([]);
  });

  it("a link with no direction, on a type at both ends, means both directions, out first", () => {
    const shape = new Shape(parseView(withCards([{ name: "Employee", show: [], links: ["reports_to"], counts: ["reports_to in"] }])), SCHEMA);
    expect(shape.card("Employee")).toEqual({
      show: [],
      links: [
        { edge: "reports_to", direction: "out" },
        { edge: "reports_to", direction: "in" },
      ],
      counts: [{ edge: "reports_to", direction: "in" }],
    });
  });

  it("a card set with nothing listed shows nothing, not the default", () => {
    const shape = new Shape(parseView(withCards([{ name: "Person", show: [], links: [], counts: [] }])), SCHEMA);
    expect(shape.card("Person")).toEqual({ show: [], links: [], counts: [] });
  });

  it("what the mosaic lacks is reported by name and left out; the rest still applies (V-18)", () => {
    const shape = new Shape(
      parseView(
        withCards([
          { name: "Film", show: ["rating"], links: [], counts: [] },
          { name: "Title", show: ["rating", "budget"], links: ["made_in", "directed_by in"], counts: ["features"] },
          { name: "Person", show: [], links: ["features out"], counts: ["features in"] },
        ]),
      ),
      SCHEMA,
    );
    expect(shape.notices).toEqual([
      "view file: cards.Film: the mosaic has no node type Film",
      "view file: cards.Title.show: Title has no property budget",
      "view file: cards.Title.links: Title has no edge type made_in",
      "view file: cards.Title.links: Title has no edge type directed_by in",
      "view file: cards.Person.links: Person has no edge type features out",
    ]);
    expect(shape.card("Film")).toBeNull();
    expect(shape.card("Title")).toEqual({ show: ["rating"], links: [], counts: [{ edge: "features", direction: "out" }] });
    expect(shape.card("Person")).toEqual({ show: [], links: [], counts: [{ edge: "features", direction: "in" }] });
    expect(shape.types.map((t) => t.name)).toEqual(["Title", "Person", "Employee"]);
  });

  it("a card does not change which types the page lists (V-7: set once per type)", () => {
    const view = parseView({
      ...(withCards([{ name: "Person", show: ["name"], links: [], counts: [] }]) as object),
      types: [{ name: "Title", label: null, columns: null, page: null, names: {} }],
    });
    const shape = new Shape(view, SCHEMA);
    expect(shape.types.map((t) => t.name)).toEqual(["Title"]);
    expect(shape.card("Person")).toEqual({ show: ["name"], links: [], counts: [] });
  });
});

describe("Python and the page agree on views/example.yaml", () => {
  it("the cards the reader gives (conformance/views/settings.json) read the same in the page", () => {
    const cases = JSON.parse(readFileSync(`${ROOT}/conformance/views/settings.json`, "utf8")) as {
      cases: { view: string | null; settings: { cards: unknown } }[];
    };
    const example = cases.cases.find((c) => c.view === "views/example.yaml")!;
    const cards = example.settings.cards as { name: string }[];
    expect(cards.length).toBeGreaterThan(0);
    expect(parseView(example.settings).cards).toEqual(cards);
    for (const c of cases.cases.filter((c) => c.view !== "views/example.yaml")) {
      expect(parseView(c.settings).cards, String(c.view)).toBeNull();
    }
  });
});

describe("view cards: further cases", () => {
  function withCards(cards: unknown, more: object = {}): unknown {
    return { search: "semantic", theme: "auto", types: null, export: { types: null }, cards, ...more };
  }

  const card = (name: string, parts: { show?: string[]; links?: string[]; counts?: string[] } = {}) => ({
    name,
    show: parts.show ?? [],
    links: parts.links ?? [],
    counts: parts.counts ?? [],
  });

  const SCHEMA: Schema = {
    nodeTypes: [
      { name: "Title", count: 3 },
      { name: "Person", count: 4 },
      { name: "Employee", count: 2 },
      { name: "Empty", count: 0 },
    ],
    edgeTypes: [
      { name: "directed_by", from: "Title", to: "Person" },
      { name: "reports_to", from: "Employee", to: "Employee" },
      { name: "in", from: "Title", to: "Person" },
      { name: "out", from: "Person", to: "Title" },
    ],
    propsOf: (type: string) => ({ Title: ["release_year", "rating"], Person: ["name"], Employee: ["title"] })[type] ?? [],
  };

  const shapeOf = (cards: unknown, schema: Schema = SCHEMA, more: object = {}) => new Shape(parseView(withCards(cards, more)), schema);

  describe("malformed cards are refused naming the setting (V-18 applies to what the mosaic lacks, not to a wrong file)", () => {
    it.each([
      ["an empty type name", [card("")]],
      ["a type name that is not text", [{ ...card("A"), name: 3 }]],
      ["a null type name", [{ ...card("A"), name: null }]],
      ["a card that is not an object", ["Title"]],
      ["a null card", [null]],
      ["an empty property name", [card("Title", { show: [""] })]],
      ["a null property name", [{ ...card("Title"), show: [null] }]],
      ["a numeric property name", [{ ...card("Title"), show: [3] }]],
      ["links that are not a list", [{ ...card("Title"), links: "directed_by" }]],
      ["counts that are not a list", [{ ...card("Title"), counts: { a: 1 } }]],
      ["a null link", [{ ...card("Title"), links: [null] }]],
      ["an empty link", [card("Title", { links: [""] })]],
      ["a link with a leading space", [card("Title", { links: [" directed_by"] })]],
      ["a link with a trailing space", [card("Title", { links: ["directed_by "] })]],
      ["a link with a trailing newline", [card("Title", { links: ["directed_by\n"] })]],
      ["a link with a tab before the direction", [card("Title", { links: ["directed_by\tin"] })]],
      ["a link with two spaces before the direction", [card("Title", { links: ["directed_by  in"] })]],
      ["a link with a capitalised direction", [card("Title", { links: ["directed_by IN"] })]],
      ["a count with another word than a direction", [card("Title", { counts: ["directed_by up"] })]],
      ["the same link twice in links", [card("Title", { links: ["directed_by in", "directed_by in"] })]],
      ["the same link twice in counts", [card("Title", { counts: ["directed_by", "directed_by"] })]],
      ["the same property twice", [card("Title", { show: ["rating", "summary", "rating"] })]],
      ["the same type twice, far apart", [card("Title"), card("Person"), card("Title")]],
    ])("%s", (_, cards) => {
      expect(() => parseView(withCards(cards))).toThrow(/cards/);
    });

    it("a card listing the same edge in two directions, or alone and with a direction, is not a duplicate", () => {
      const view = parseView(withCards([card("Employee", { links: ["reports_to in", "reports_to out"], counts: ["reports_to", "reports_to in"] })]));
      expect(view.cards).toHaveLength(1);
    });

    it("parsing does not change the settings it is given", () => {
      const deep = (v: unknown): unknown => {
        if (v && typeof v === "object") for (const x of Object.values(v)) deep(x);
        return v && typeof v === "object" ? Object.freeze(v) : v;
      };
      const data = deep(withCards([card("Title", { show: ["summary"], links: ["directed_by"], counts: ["features in"] })]));
      expect(() => parseView(data)).not.toThrow();
    });
  });

  describe("a type's card on the open mosaic", () => {
    it("an empty list of cards sets no card for any type, and says nothing", () => {
      const shape = shapeOf([]);
      for (const t of SCHEMA.nodeTypes) expect(shape.card(t.name)).toBeNull();
      expect(shape.notices).toEqual([]);
    });

    it("a type the file names but the mosaic lacks has no card and one notice naming it", () => {
      const shape = shapeOf([card("Film", { show: ["rating"] })]);
      expect(shape.card("Film")).toBeNull();
      expect(shape.notices).toHaveLength(1);
      expect(shape.notices[0]).toContain("Film");
      expect(shape.notices[0]).toContain("cards");
    });

    it("type names match exactly: case and Unicode normalisation make different names", () => {
      const nfd = "Café";
      const schema: Schema = { ...SCHEMA, nodeTypes: [...SCHEMA.nodeTypes, { name: "Café", count: 1 }] };
      const shape = shapeOf([card("title", { show: ["rating"] }), card(nfd, { show: ["x"] }), card("Café")], schema);
      expect(shape.card("title")).toBeNull();
      expect(shape.card("Title")).toBeNull();
      expect(shape.card(nfd)).toBeNull();
      expect(shape.card("Café")).toEqual({ show: [], links: [], counts: [] });
      expect(shape.notices).toHaveLength(2);
      expect(shape.notices[0]).toContain("title");
      expect(shape.notices[1]).toContain(nfd);
    });

    it("a type with no nodes still has the card the file sets", () => {
      expect(shapeOf([card("Empty")]).card("Empty")).toEqual({ show: [], links: [], counts: [] });
    });

    it("a type the view file leaves out of `types` still has its card, and no notice", () => {
      const types = [{ name: "Title", label: null, columns: null, page: null, names: {} }];
      const shape = shapeOf([card("Employee", { show: ["title"], counts: ["reports_to in"] })], SCHEMA, { types });
      expect(shape.types.map((t) => t.name)).toEqual(["Title"]);
      expect(shape.card("Employee")).toEqual({ show: ["title"], links: [], counts: [{ edge: "reports_to", direction: "in" }] });
      expect(shape.notices).toEqual([]);
    });

    it("a card for a type the file lists but the mosaic lacks gives a notice for the type and one for the card", () => {
      const types = [{ name: "Film", label: null, columns: null, page: null, names: {} }];
      const shape = shapeOf([card("Film")], SCHEMA, { types });
      expect(shape.notices.filter((n) => n.includes("Film")).length).toBeGreaterThanOrEqual(2);
    });

    it("a property that only exists on another type is not shown", () => {
      const shape = shapeOf([card("Person", { show: ["rating", "name"] })]);
      expect(shape.card("Person")?.show).toEqual(["name"]);
      expect(shape.notices).toHaveLength(1);
      expect(shape.notices[0]).toContain("rating");
    });

    it("an edge type is not a property: show names properties only", () => {
      const shape = shapeOf([card("Title", { show: ["directed_by", "rating"] })]);
      expect(shape.card("Title")?.show).toEqual(["rating"]);
      expect(shape.notices).toHaveLength(1);
      expect(shape.notices[0]).toContain("directed_by");
    });

    it("the summary needs no property of that name, but only that exact word", () => {
      const shape = shapeOf([card("Empty", { show: ["summary", "Summary"] })]);
      expect(shape.card("Empty")?.show).toEqual(["summary"]);
      expect(shape.notices).toHaveLength(1);
      expect(shape.notices[0]).toContain("Summary");
    });

    it("a property is not an edge type: links and counts name edge types only", () => {
      const shape = shapeOf([card("Title", { links: ["rating"], counts: ["release_year out"] })]);
      expect(shape.card("Title")).toEqual({ show: [], links: [], counts: [] });
      expect(shape.notices).toHaveLength(2);
      expect(shape.notices[0]).toContain("rating");
      expect(shape.notices[1]).toContain("release_year");
    });

    it("an edge type that does not touch the type is a notice, whatever the direction", () => {
      const shape = shapeOf([card("Employee", { links: ["directed_by", "directed_by in", "directed_by out"] })]);
      expect(shape.card("Employee")?.links).toEqual([]);
      expect(shape.notices).toHaveLength(3);
    });

    it("a count that the mosaic lacks is named in a notice and left out; the others stay, in order", () => {
      const shape = shapeOf([card("Title", { counts: ["nope", "directed_by", "also_nope out"] })]);
      expect(shape.card("Title")?.counts).toEqual([{ edge: "directed_by", direction: "out" }]);
      expect(shape.notices).toHaveLength(2);
      expect(shape.notices[0]).toContain("nope");
      expect(shape.notices[1]).toContain("also_nope");
      expect(shape.notices.every((n) => n.includes("cards.Title.counts"))).toBe(true);
    });

    it("notices come in the order the cards and their parts are written", () => {
      const shape = shapeOf([
        card("Person", { show: ["p_missing"] }),
        card("Zed"),
        card("Title", { show: ["t_missing"], links: ["l_missing"], counts: ["c_missing"] }),
      ]);
      expect(shape.notices.map((n) => ["p_missing", "Zed", "t_missing", "l_missing", "c_missing"].find((w) => n.includes(w)))).toEqual([
        "p_missing",
        "Zed",
        "t_missing",
        "l_missing",
        "c_missing",
      ]);
    });

    it("edge types named in or out are edge types, not directions", () => {
      const shape = shapeOf([
        card("Title", { links: ["in", "in out"], counts: ["out in"] }),
        card("Person", { links: ["in in"], counts: ["out", "out out"] }),
      ]);
      expect(shape.notices).toEqual([]);
      expect(shape.card("Title")).toEqual({
        show: [],
        links: [
          { edge: "in", direction: "out" },
          { edge: "in", direction: "out" },
        ],
        counts: [{ edge: "out", direction: "in" }],
      });
      expect(shape.card("Person")).toEqual({
        show: [],
        links: [{ edge: "in", direction: "in" }],
        counts: [
          { edge: "out", direction: "out" },
          { edge: "out", direction: "out" },
        ],
      });
    });

    it("a self-link written in both directions keeps the order written", () => {
      const shape = shapeOf([card("Employee", { links: ["reports_to in", "reports_to out"] })]);
      expect(shape.card("Employee")?.links).toEqual([
        { edge: "reports_to", direction: "in" },
        { edge: "reports_to", direction: "out" },
      ]);
    });

    it("cards of different types do not leak into each other (V-7)", () => {
      const shape = shapeOf([card("Title", { show: ["rating"] }), card("Person", { show: ["name"] })]);
      expect(shape.card("Title")?.show).toEqual(["rating"]);
      expect(shape.card("Person")?.show).toEqual(["name"]);
      expect(shape.card("Employee")).toBeNull();
    });

    it("asking twice, or building twice, gives the same card and the same notices", () => {
      const cards = [card("Title", { show: ["summary", "zzz"], links: ["directed_by", "q"], counts: ["directed_by"] })];
      const a = shapeOf(cards);
      const b = shapeOf(cards);
      expect(a.card("Title")).toEqual(a.card("Title"));
      expect(a.card("Title")).toEqual(b.card("Title"));
      expect(a.notices).toEqual(b.notices);
    });

    it("a mosaic with no types and no edges opens: every card is a notice", () => {
      const empty: Schema = { nodeTypes: [], edgeTypes: [], propsOf: () => [] };
      const shape = shapeOf([card("Title", { show: ["a"], links: ["b"] }), card("Person")], empty);
      expect(shape.card("Title")).toBeNull();
      expect(shape.card("Person")).toBeNull();
      expect(shape.notices.length).toBeGreaterThanOrEqual(2);
    });

    it("names that look like object internals are plain names", () => {
      const names = ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"];
      const schema: Schema = {
        nodeTypes: [{ name: "constructor", count: 1 }],
        edgeTypes: [{ name: "__proto__", from: "constructor", to: "constructor" }],
        propsOf: (t) => (t === "constructor" ? ["toString"] : []),
      };
      const shape = shapeOf(
        [card("constructor", { show: ["toString", "hasOwnProperty"], links: ["__proto__ in"], counts: ["constructor"] }), card("__proto__", { show: ["x"] })],
        schema,
      );
      expect(shape.card("constructor")).toEqual({
        show: ["toString"],
        links: [{ edge: "__proto__", direction: "in" }],
        counts: [],
      });
      expect(shape.card("__proto__")).toBeNull();
      for (const n of names) {
        if (n !== "constructor") expect(shape.card(n)).toBeNull();
      }
      expect(shape.notices.some((n) => n.includes("hasOwnProperty"))).toBe(true);
      expect(({} as Record<string, unknown>).x).toBeUndefined();
    });

    it("a notice shows a name as text, whole, whatever it holds", () => {
      const odd = "<img src=x onerror=alert(1)>\u0000" + "x".repeat(5000);
      const shape = shapeOf([card("Title", { show: [odd] })]);
      expect(shape.card("Title")?.show).toEqual([]);
      expect(shape.notices).toHaveLength(1);
      expect(shape.notices[0]).toContain(odd);
    });

    it("many properties and many cards still apply in order, with one notice per missing name", () => {
      const props = Array.from({ length: 5000 }, (_, i) => `p${i}`);
      const schema: Schema = { ...SCHEMA, propsOf: (t) => (t === "Title" ? props.filter((_, i) => i % 2 === 0) : []) };
      const shape = shapeOf([card("Title", { show: props })], schema);
      expect(shape.card("Title")?.show).toEqual(props.filter((_, i) => i % 2 === 0));
      expect(shape.notices).toHaveLength(2500);
    });
  });
});
