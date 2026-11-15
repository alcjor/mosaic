/**
 * A trail as columns: one per place of the chain (the start, then each step), each listing the
 * things found at that place among the chain's results, in the order the results first show
 * them, with how many of those results each is in. Pinning a place to one of its things makes a
 * narrower chain, whose columns list only what goes with that thing.
 *
 * The columns are read from the chain's first {@link COLUMN_RESULTS} results; `partial` says
 * when the chain has more, so the page can say the lists are not complete.
 */
import type { Chain } from "./chain.js";
import type { Result } from "./results.js";

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
  return { columns, read: results.length, partial };
}
