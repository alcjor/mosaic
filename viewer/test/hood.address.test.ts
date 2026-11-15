// A link to a neighbourhood (G-8): the address holds the things unfolded, in order, and the edge
// types shown; opening it applies what the mosaic allows and says what it could not. Data is invented.
import { describe, expect, it } from "vitest";
import { buildMosaic } from "../../kit/test/build-mosaic.js";
import { applyAddress, hoodRoute } from "../src/lib/graph/hood-address.js";
import { expand, hoodOf, limitOf, MOST_EXPANDED, showEdge, STEPS, type HoodState } from "../src/lib/graph/hood.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { parseRoute, routeHash } from "../src/lib/route.js";

const tags = Array.from({ length: 60 }, (_, i) => `Tag:t${String(i).padStart(2, "0")}`);
const open = () =>
  openMosaic(
    buildMosaic({
      edgeTypes: [
        ["carries", "Hub", "Tag"],
        ["related", "Tag", "Tag"],
      ],
      nodes: [{ type: "Hub", key: "h", label: "The hub" }, ...tags.map((id) => ({ type: "Tag", key: id.slice(4), label: id }))],
      edges: [...tags.map((to) => ({ type: "carries", from: "Hub:h", to })), { type: "related", from: tags[0]!, to: tags[1]! }],
    }),
    "address.mosaic",
  );

/** The state the address of `state` opens, and what it could not apply. */
async function reopened(state: HoodState) {
  const file = await open();
  const route = parseRoute(routeHash(hoodRoute(state)));
  const applied = await applyAddress(file, route.node!, route.hood ?? null);
  file.close();
  return applied;
}

describe("the address of a neighbourhood (G-8)", () => {
  it("is the thing alone when nothing more is unfolded and every edge type is shown", () => {
    expect(routeHash(hoodRoute(hoodOf("Hub:h")))).toBe(routeHash({ query: "", node: "Hub:h", view: "explore" }));
  });

  it("holds the things unfolded, in order and as often as unfolded, and the edge types shown", () => {
    const state = showEdge(expand(expand(expand(hoodOf("Hub:h"), tags[1]!), tags[0]!), tags[1]!), ["carries", "related"], "related", false);
    const params = new URLSearchParams(routeHash(hoodRoute(state)).slice(1));
    expect(params.getAll("x")).toEqual([tags[1], tags[0], tags[1]]);
    expect(params.getAll("e")).toEqual(["carries"]);
  });

  it("reopens as the same choices, for each a person can make", async () => {
    const all = ["carries", "related"];
    const states = [
      hoodOf("Hub:h"),
      expand(expand(hoodOf("Hub:h"), tags[2]!), "Hub:h"),
      expand(expand(hoodOf("Hub:h"), tags[2]!), tags[2]!),
      showEdge(hoodOf("Hub:h"), all, "carries", false),
      showEdge(showEdge(hoodOf("Hub:h"), all, "carries", false), all, "related", false),
    ];
    for (const state of states) expect(await reopened(state)).toEqual({ state, unapplied: [] });
  });

  it("no longer reads the parts whose controls are gone", () => {
    expect(parseRoute("#node=Hub%3Ah&v=explore&h=Tag%3At00&l=20").hood).toBeUndefined();
  });
});

describe("opening a link a person did not make (G-8)", () => {
  it("does not unfold a thing the mosaic lacks, and says so once", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: ["Tag:none", tags[0]!, "Tag:none"], edges: null });
    expect(state.expanded).toEqual([tags[0]]);
    expect(unapplied).toHaveLength(1);
    expect(unapplied[0]).toContain("Tag:none");
    file.close();
  });

  it("unfolds a thing named more often than it has steps as far as it goes", async () => {
    const file = await open();
    const { state } = await applyAddress(file, "Hub:h", { expanded: Array.from({ length: 6 }, () => tags[0]!), edges: null });
    expect(limitOf(state, tags[0]!)).toBe(STEPS.at(-1));
    expect(state.expanded).toHaveLength(STEPS.length);
    file.close();
  });

  it("unfolds the first 50 of a longer list, and says how many it named", async () => {
    const file = await open();
    const { state, unapplied } = await applyAddress(file, "Hub:h", { expanded: tags, edges: null });
    expect(state.expanded).toEqual(tags.slice(0, MOST_EXPANDED));
    expect(unapplied).toHaveLength(1);
    expect(unapplied[0]).toContain(String(tags.length));
    file.close();
  });

  it("shows the edge types the mosaic has, names those it lacks, and shows every one when it has none of them", async () => {
    const file = await open();
    const some = await applyAddress(file, "Hub:h", { expanded: [], edges: ["related", "nope"] });
    expect(some.state.edges).toEqual(["related"]);
    expect(some.unapplied.join(" ")).toContain("nope");
    expect((await applyAddress(file, "Hub:h", { expanded: [], edges: ["nope"] })).state.edges).toBeNull();
    expect((await applyAddress(file, "Hub:h", { expanded: [], edges: ["related", "carries"] })).state.edges).toBeNull();
    expect((await applyAddress(file, "Hub:h", { expanded: [], edges: [] })).state.edges).toEqual([]);
    file.close();
  });
});
