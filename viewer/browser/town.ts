// The invented mosaic the browser tests open: a small town of people, places and events.
import type { MosaicSpec } from "../../kit/test/build-mosaic.js";

const person = (key: string, label: string, summary: string) => ({ type: "Person", key, label, summary, snippets: [summary] });
const place = (key: string, label: string, summary: string) => ({ type: "Place", key, label, summary, snippets: [summary] });

export const TOWN: MosaicSpec = {
  nodes: [
    person("ada", "Ada", "Ada keeps the lighthouse."),
    person("ben", "Ben", "Ben bakes bread for the market."),
    person("cleo", "Cleo", "Cleo sails out of the harbor."),
    person("dov", "Dov", "Dov rings the bell in the square."),
    place("harbor", "Old Harbor", "A quiet harbor with a lighthouse."),
    place("market", "Night Market", "Stalls that open after dark."),
    place("square", "Bell Square", "The square under the bell tower."),
    { type: "Event", key: "fair", label: "Spring Fair", summary: "A fair held each spring.", snippets: ["The fair fills the square."] },
    { type: "Event", key: "regatta", label: "Harbor Regatta", summary: "Boats race round the lighthouse.", snippets: ["The regatta starts at the harbor."] },
  ],
  edgeTypes: [
    ["visits", "Person", "Place"],
    ["held_at", "Event", "Place"],
  ],
  edges: [
    { type: "visits", from: "Person:ada", to: "Place:harbor" },
    { type: "visits", from: "Person:ada", to: "Place:market" },
    { type: "visits", from: "Person:ben", to: "Place:market" },
    { type: "visits", from: "Person:ben", to: "Place:square" },
    { type: "visits", from: "Person:cleo", to: "Place:harbor" },
    { type: "visits", from: "Person:dov", to: "Place:square" },
    { type: "held_at", from: "Event:fair", to: "Place:square" },
    { type: "held_at", from: "Event:regatta", to: "Place:harbor" },
  ],
};

/** A view file's settings that save one trail: who visits where an event is held. */
export const TOWN_VIEW = {
  search: "text",
  chains: [{ name: "Who comes to events", start: "Event", steps: [{ link: "held_at" }, { link: "visits in" }] }],
};
