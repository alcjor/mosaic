// What a chain place's search finds (V-2, V-3: a pin is a thing of the open
// mosaic, of the place's type). Kept per place as it is, the latest search's answer only, and
// none of it once another mosaic is open.
import { describe, expect, it } from "vitest";
import { findThings, PlaceSearches, slotOf, slotsFrom } from "../src/lib/placesearch.svelte.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const thing = (id: string) => ({ id, label: id });

describe("a place's search", () => {
  it("shows what the latest search found; an older one answering later is dropped", async () => {
    const s = new PlaceSearches();
    const slow = s.run("start Item", () => later([thing("Item:old")], 40));
    const fast = s.run("start Item", () => later([thing("Item:new")], 5));
    await Promise.all([slow, fast]);
    expect(s.found["start Item"]).toEqual([thing("Item:new")]);
  });

  it("an answer that comes after the place was cleared (a pin chosen) is dropped", async () => {
    const s = new PlaceSearches();
    const asked = s.run("0 in_group out Group", () => later([thing("Group:x")], 10));
    s.clear("0 in_group out Group");
    await asked;
    expect(s.found["0 in_group out Group"]).toBeUndefined();
  });

  it("each place keeps its own answer", async () => {
    const s = new PlaceSearches();
    await Promise.all([s.run("start Item", async () => [thing("Item:a")]), s.run("0 in_group out Group", async () => [thing("Group:x")])]);
    expect(s.found).toEqual({ "start Item": [thing("Item:a")], "0 in_group out Group": [thing("Group:x")] });
  });

  it("nothing found, and a search the kit could not answer, are told apart", async () => {
    const s = new PlaceSearches();
    await s.run("start Item", async () => []);
    expect(s.found["start Item"]).toEqual([]);
    await s.run("start Item", async () => ({ error: "find: the query is too long" }));
    expect(s.found["start Item"]).toEqual({ error: "find: the query is too long" });
  });

  it("forgets every place, queries too, and drops answers still on their way", async () => {
    const s = new PlaceSearches();
    s.queries["start Item"] = "a";
    const asked = s.run("start Item", () => later([thing("Item:a")], 10));
    s.reset();
    await asked;
    expect(s.found).toEqual({});
    expect(s.queries).toEqual({});
  });
});

describe("the Chain view's searches belong to the open mosaic (V-3)", () => {
  it("another mosaic opened: no chain, no count, and nothing any place found or was asked", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    viewer.setChain({ start: "Item", pin: null, steps: [] });
    viewer.searches.queries["start Item"] = "Item";
    await viewer.searches.run("start Item", async () => [thing("Item:a")]);
    await viewer.open(reading("mosaic.mosaic").slice(), "other.mosaic");
    expect(viewer.chain).toBeNull();
    expect(viewer.chainCount).toBeNull();
    expect(viewer.searches.found).toEqual({});
    expect(viewer.searches.queries).toEqual({});
  });

  it("the same mosaic opened again keeps them", async () => {
    const viewer = new Viewer();
    const bytes = reading("mosaic.mosaic");
    await viewer.open(bytes, "mosaic.mosaic");
    viewer.setChain({ start: "Item", pin: null, steps: [] });
    await viewer.searches.run("start Item", async () => [thing("Item:a")]);
    await viewer.open(bytes, "mosaic.mosaic");
    expect(viewer.searches.found).toEqual({ "start Item": [thing("Item:a")] });
  });
});

describe("searching the kit for a place's things", () => {
  it("gives the things find gives, at most 10, of the place's type, or of any type", async () => {
    const asked: unknown[] = [];
    const file = { find: async (args: unknown) => (asked.push(args), { tool: "find" as const, mosaic: "m", data: { results: [{ id: "Person:ada", type: "Person", label: "Ada", match: "exact" as const }], total: 1 } }) };
    expect(await findThings(file as never, "Person", "Ada")).toEqual([{ id: "Person:ada", type: "Person", label: "Ada" }]);
    expect(asked).toEqual([{ query: "Ada", type: "Person", limit: 10 }]);
    await findThings(file as never, null, "Ada");
    expect(asked[1]).toEqual({ query: "Ada", limit: 10 });
  });

  it("gives the kit's error as an error, not as nothing found", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    const answer = await findThings(viewer.file!, "NoSuchType", "x");
    expect(answer).toMatchObject({ error: expect.stringMatching(/\S/) });
  });
});

describe("which places a removed step makes other places", () => {
  const step = (edge: string, direction: "out" | "in", type: string) => ({ edge, direction, type, pin: null });
  const chain = { start: "Person", pin: null, steps: [step("features", "in", "Title"), step("made_in", "out", "Country"), step("made_in", "in", "Title")] };

  it("a place is named by its position, link and type; the start by its type", () => {
    expect(slotOf(chain, -1)).toBe("start Person");
    expect(slotOf(chain, 1)).toBe("1 made_in out Country");
  });

  it("removing a step: that place and every one after it, and none before", () => {
    expect(slotsFrom(chain, 1)).toEqual(["1 made_in out Country", "2 made_in in Title"]);
    expect(slotsFrom(chain, 0)).toHaveLength(3);
    expect(slotsFrom(chain, 3)).toEqual([]);
  });

  it("their searches forgotten, the places before keep theirs", () => {
    const s = new PlaceSearches();
    for (const at of [slotOf(chain, -1), ...slotsFrom(chain, 0)]) s.queries[at] = "x";
    for (const at of slotsFrom(chain, 1)) s.clear(at);
    expect(Object.keys(s.queries).sort()).toEqual(["0 features in Title", "start Person"]);
  });
});
