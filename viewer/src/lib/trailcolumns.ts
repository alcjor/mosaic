/**
 * A trail as columns: one per place of the chain (the start, then each step), each listing the
 * things found at that place among the chain's results, in the order the results first show
 * them, with how many of those results each is in. Pinning a place to one of its things makes a
 * narrower chain, whose columns list only what goes with that thing.
 *
 * The columns are read from the chain's first {@link COLUMN_RESULTS} results; `partial` says
 * when the chain has more, so the page can say the lists are not complete. The results read are
 * kept: they say which cards a line joins ({@link joinsOf}), what a picked card lights up
 * ({@link connected}), and they are the results shown one at a time.
 */
import type { GetData } from "@mosaic/kit";
import type { Chain } from "./chain.js";
import type { Result } from "./results.js";
import { inPageOrder, type Shape } from "./view.js";

/** How many of a chain's results the columns are read from. */
export const COLUMN_RESULTS = 200;

export interface ColumnThing {
  readonly id: string;
  readonly label: string | null;
  /** How many of the results read hold it at this place. */
  readonly results: number;
}

export interface TrailColumn {
  /** The place's node type. */
  readonly type: string;
  /** The step that leads here; null for the start. */
  readonly step: { readonly edge: string; readonly direction: "out" | "in"; readonly from: string } | null;
  /** The thing the place is pinned to, or null when it is open. */
  readonly pin: string | null;
  readonly things: readonly ColumnThing[];
}

export interface TrailColumns {
  readonly columns: readonly TrailColumn[];
  /** The results the columns were read from, in the chain's order. */
  readonly results: readonly Result[];
  /** How many results the columns were read from. */
  readonly read: number;
  /** True when the chain has more results than were read. */
  readonly partial: boolean;
}

/** The columns of `chain` from `results`, its first results in the chain's order. */
export function columnsOf(chain: Chain, results: readonly Result[], partial: boolean): TrailColumns {
  const places = [{ type: chain.start, pin: chain.pin, step: null as TrailColumn["step"] }];
  chain.steps.forEach((s, i) =>
    places.push({ type: s.type, pin: s.pin, step: { edge: s.edge, direction: s.direction, from: i === 0 ? chain.start : chain.steps[i - 1]!.type } }),
  );
  const columns = places.map((place, at) => {
    const seen = new Map<string, { id: string; label: string | null; results: number }>();
    for (const r of results) {
      const thing = r.things[at];
      if (thing === undefined) continue;
      const known = seen.get(thing.id);
      if (known) known.results++;
      else seen.set(thing.id, { id: thing.id, label: thing.label, results: 1 });
    }
    return { ...place, things: [...seen.values()] };
  });
  return { columns, results, read: results.length, partial };
}

/** A line between two cards of neighbouring columns: the things joined, the left one at `place`. */
export interface Join {
  readonly place: number;
  readonly from: string;
  readonly to: string;
}

/** A join's name, to tell whether it is lit. */
export const joinKey = (j: Join): string => JSON.stringify([j.place, j.from, j.to]);

/** The lines between the columns: one per pair of things some result holds side by side. */
export function joinsOf(results: readonly Result[]): Join[] {
  const seen = new Map<string, Join>();
  for (const r of results) {
    for (let place = 0; place + 1 < r.things.length; place++) {
      const join = { place, from: r.things[place]!.id, to: r.things[place + 1]!.id };
      seen.set(joinKey(join), join);
    }
  }
  return [...seen.values()];
}

/** What a picked card lights up: per place the things, and the joins, of the results that hold it. */
export interface Lit {
  readonly things: readonly ReadonlySet<string>[];
  readonly joins: ReadonlySet<string>;
}

/** Everything connected to the thing `id` at `place`: what the results that pass through it hold. */
export function connected(results: readonly Result[], place: number, id: string): Lit {
  const through = results.filter((r) => r.things[place]?.id === id);
  const places = Math.max(0, ...results.map((r) => r.things.length));
  return {
    things: Array.from({ length: places }, (_, at) => new Set(through.flatMap((r) => (r.things[at] ? [r.things[at].id] : [])))),
    joins: new Set(joinsOf(through).map(joinKey)),
  };
}

/** A property value as a card's line shows it. */
const shown = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * A small card's one line: the first `count` properties of the thing, those its type's card
 * shows when the view file sets one, else in the order of its page; "" when it has none.
 */
export function cardLine(node: Pick<GetData, "type" | "props">, shape: Shape | null, count = 3): string {
  const props = node.props ?? {};
  const card = shape?.card(node.type) ?? null;
  const names =
    card !== null
      ? card.show.filter((name) => name !== "summary" && Object.hasOwn(props, name))
      : inPageOrder(Object.keys(props), shape?.page(node.type) ?? null, (name) => name);
  return names
    .slice(0, count)
    .map((name) => shown(props[name]))
    .join(" · ");
}
