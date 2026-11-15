// What the map writes (need G-1): counts written the same way on every machine, and names cut
// to their columns. Data is invented.
import { describe, expect, it } from "vitest";
import { columns, cutTo, noun, number } from "../src/lib/graph/mapview.js";

describe("numbers on the map", () => {
  it("are written with a comma between thousands, whatever the machine's language", () => {
    expect(number(0)).toBe("0");
    expect(number(999)).toBe("999");
    expect(number(8807)).toBe("8,807");
    expect(number(64124)).toBe("64,124");
    expect(number(1234567)).toBe("1,234,567");
  });

  it("take the singular for exactly one, and the plural for none, many or a count not yet whole", () => {
    expect(noun(1, "thing", "things")).toBe("thing");
    expect(noun(0, "thing", "things")).toBe("things");
    expect(noun(2, "thing", "things")).toBe("things");
    expect(noun(null, "link", "links")).toBe("links");
    expect(noun(1, "link", "links", true)).toBe("links");
  });
});

describe("a name on the map", () => {
  it("counts columns: wide characters take two, joining marks none", () => {
    expect(columns("abc")).toBe(3);
    expect(columns("漢字")).toBe(4);
    expect(columns("ＡＢ")).toBe(4);
    expect(columns("🎬")).toBe(2);
    expect(columns("é")).toBe(1);
    expect(columns("👍🏽")).toBe(2);
  });

  it("cuts a long name to its columns, ending in …, and leaves a short one whole", () => {
    expect(cutTo("short", 10)).toBe("short");
    expect(cutTo("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
    expect(columns(cutTo("漢".repeat(50), 10))).toBeLessThanOrEqual(10);
  });
});

describe("numbers on the map (G-1)", () => {
  it("put a comma at every thousand, up to billions, and leave small numbers whole", () => {
    expect(number(1000)).toBe("1,000");
    expect(number(10000)).toBe("10,000");
    expect(number(100000)).toBe("100,000");
    expect(number(999999)).toBe("999,999");
    expect(number(1000000000)).toBe("1,000,000,000");
    expect(number(1)).toBe("1");
    expect(number(10)).toBe("10");
    expect(number(100)).toBe("100");
  });

  it("write the same number the same way every time (G-7)", () => {
    for (const n of [0, 7, 8807, 64124, 1234567]) expect(number(n)).toBe(number(n));
  });
});
