// Types take the palette's colours in the order listed; a view file may name a type's colour.
import { describe, expect, test } from "vitest";
import { assignColours, COLOURS } from "../src/lib/typecolour.js";
import { parseView, Shape } from "../src/lib/view.js";

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `T${i}` }));

describe("type colours", () => {
  test("types take sixteen colours in order, then repeat", () => {
    const got = assignColours(names(18));
    expect([...got.values()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 1, 2]);
    expect(COLOURS).toHaveLength(16);
  });

  test("a named colour is kept for its type and the others take the rest in order", () => {
    const got = assignColours([{ name: "A" }, { name: "B", colour: "cobalt" }, { name: "C" }, { name: "D", colour: "plum-2" }]);
    expect([...got]).toEqual([["A", 2], ["B", 1], ["C", 3], ["D", 12]]);
  });

  test("the view file's order and colours shape the page, and unlisted types follow", () => {
    const schema = {
      nodeTypes: ["Alpha", "Beta", "Gamma"].map((name) => ({ name, description: null, keyProp: "id", props: {} })),
      edgeTypes: [],
      propsOf: () => [],
    } as unknown as ConstructorParameters<typeof Shape>[1];
    const view = parseView({ types: [{ name: "Gamma" }, { name: "Alpha", colour: "rose" }] });
    const shape = new Shape(view, schema);
    expect(["Gamma", "Alpha", "Beta", "Other"].map((t) => shape.typeColour(t))).toEqual([1, 6, 2, null]);
    expect(() => parseView({ types: [{ name: "Alpha", colour: "green" }] })).toThrow(/types\[0\]\.colour/);
  });
});
