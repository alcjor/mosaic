// Descriptions from the view file, for the graph explorer's map (need G-2). The kit
// as it is gives no description (G-12), so the map shows one only when the view file gives it:
// `types.<Type>.describe` and `edges.<edge>.describe`. No description given means none shown. An edge type the mosaic lacks is
// a notice, as for every other name the view file gives, and the rest still applies.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseView, Shape, type ViewSettings } from "../src/lib/view.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SCHEMA = {
  nodeTypes: [
    { name: "Item", count: 3 },
    { name: "Tag", count: 1 },
  ],
  edgeTypes: [{ name: "has_tag", from: "Item", to: "Tag" }],
  propsOf: () => [],
};

function view(json: object): ViewSettings {
  return parseView({ search: "semantic", theme: "auto", types: null, edges: null, export: { types: null }, ...json });
}

const type = (name: string, describe: string | null = null) => ({ name, label: null, columns: null, page: null, names: {}, describe });

describe("descriptions in the view file (G-2)", () => {
  it("are none by default", () => {
    expect(DEFAULT_VIEW.edges).toBeNull();
    const shape = new Shape(DEFAULT_VIEW, SCHEMA);
    expect(shape.typeDescription("Item")).toBeNull();
    expect(shape.edgeDescription("has_tag")).toBeNull();
    expect(shape.notices).toEqual([]);
  });

  it("a type's description is the one its settings give, and only that type's", () => {
    const shape = new Shape(view({ types: [type("Item", "An item"), type("Tag")] }), SCHEMA);
    expect(shape.typeDescription("Item")).toBe("An item");
    expect(shape.typeDescription("Tag")).toBeNull();
    expect(shape.typeDescription("Absent")).toBeNull();
  });

  it("an edge type's description is the one `edges` gives, and edges choose nothing", () => {
    const shape = new Shape(view({ edges: [{ name: "has_tag", describe: "An item has a tag" }] }), SCHEMA);
    expect(shape.edgeDescription("has_tag")).toBe("An item has a tag");
    expect(shape.types.map((t) => t.name)).toEqual(["Item", "Tag"]);
    expect(shape.notices).toEqual([]);
  });

  it("an edge type with no describe has none", () => {
    const shape = new Shape(view({ edges: [{ name: "has_tag", describe: null }] }), SCHEMA);
    expect(shape.edgeDescription("has_tag")).toBeNull();
  });

  it("an edge type the mosaic lacks is a notice naming it, and the rest still applies", () => {
    const settings = view({
      types: [type("Item", "An item")],
      edges: [
        { name: "absent_edge", describe: "Nowhere" },
        { name: "has_tag", describe: "An item has a tag" },
      ],
    });
    const shape = new Shape(settings, SCHEMA);
    expect(shape.notices).toEqual(["view file: edges.absent_edge: the mosaic has no edge type absent_edge"]);
    expect(shape.edgeDescription("absent_edge")).toBeNull();
    expect(shape.edgeDescription("has_tag")).toBe("An item has a tag");
    expect(shape.typeDescription("Item")).toBe("An item");
  });

  it("a node type's name under edges is not an edge type", () => {
    const shape = new Shape(view({ edges: [{ name: "Item", describe: "x" }] }), SCHEMA);
    expect(shape.notices).toEqual(["view file: edges.Item: the mosaic has no edge type Item"]);
    expect(shape.edgeDescription("Item")).toBeNull();
  });

  it("malformed descriptions are refused, as other settings are", () => {
    expect(() => view({ types: [type("Item", "")] })).toThrow(/types\[0\]\.describe/);
    expect(() => view({ types: [{ ...type("Item"), describe: 3 }] })).toThrow(/types\[0\]\.describe/);
    expect(() => view({ edges: {} })).toThrow(/edges/);
    expect(() => view({ edges: [{ name: "", describe: null }] })).toThrow(/edges\[0\]\.name/);
    expect(() => view({ edges: [{ name: "e", describe: "" }] })).toThrow(/edges\[0\]\.describe/);
    expect(() => view({ edges: [{ name: "e" }, { name: "e" }] })).toThrow(/edges\[1\]\.name/);
  });

  it("settings without the keys, as an older `mosaic view` hands them, read as none", () => {
    const settings = parseView({ search: "text", theme: "dark", types: [{ name: "Item", label: null, columns: null, page: null, names: {} }], export: { types: null } });
    expect(settings.edges).toBeNull();
    expect(settings.types![0]!.describe).toBeNull();
  });
});

describe("descriptions cross from Python to the page (conformance/views/settings.json)", () => {
  const CASES = JSON.parse(readFileSync(`${ROOT}/conformance/views/settings.json`, "utf8")) as {
    cases: { view: string | null; settings: unknown }[];
  };
  const settings = (path: string | null) => parseView(CASES.cases.find((c) => c.view === path)!.settings);

  it("the example describes Title and features", () => {
    const example = settings("views/example.yaml");
    expect(example.types![0]).toMatchObject({ name: "Title", describe: "A movie or TV show in the catalogue" });
    expect(example.edges).toEqual([{ name: "features", describe: "A title features a person in its cast" }]);
  });

  it("the Netflix view file describes each type it lists and every edge type", () => {
    const netflix = settings("conformance/fixtures/netflix/view.yaml");
    expect(netflix.types!.every((t) => t.describe !== null && t.describe !== "")).toBe(true);
    expect(netflix.edges!.map((e) => e.name)).toEqual(["directed_by", "features", "made_in", "listed_in", "released_in"]);
  });

  it("no view file gives no descriptions", () => {
    expect(settings(null)).toEqual(DEFAULT_VIEW);
  });
});
