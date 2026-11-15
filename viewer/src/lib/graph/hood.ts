/**
 * The data of a neighbourhood (needs G-3, G-4, G-5, G-10): a thing's neighbours grouped by edge
 * type and direction, each group with its count, and the person's choices (what is unfolded and
 * the edge types shown) as state the data follows.
 *
 * A thing unfolded shows a few neighbours per group; unfolded again it shows more, up to the 20
 * the kit lists. The links a thing has beyond those drawn are its folded links, counted on its
 * badge: a thing drawn but not unfolded is asked for its link counts alone.
 *
 * Only bounded calls to the kit as it is (G-12): `get` for a thing's link counts per edge type
 * and direction, then one `neighbors` per group shown, with that edge type, direction and the
 * limit (at most 20). A Netflix country with thousands of titles is one `get` and one
 * `neighbors` of at most 20 edges.
 */
import { RESULT_LIMIT, type EdgeType, type ErrorAnswer, type GetAnswer, type NeighborsAnswer } from "@mosaic/kit";
import { byBytes } from "./bytes.js";
import { layoutHood } from "./hood-layout.js";

/** Neighbours shown per group by a thing unfolded once, twice and three times. */
export const STEPS = [5, 10, RESULT_LIMIT] as const;
export type Limit = (typeof STEPS)[number];

export interface Thing {
  readonly id: string;
  readonly label: string | null;
  /** Its type: the edge type's other end, else the `<type>:` of its id (section 3.4), else null. */
  readonly type: string | null;
}

export interface Group {
  readonly edge: string;
  readonly direction: "out" | "in";
  /** How many links of this edge type and direction the thing has. */
  readonly count: number;
  /** The neighbours shown: at most the limit, in the kit's order; none for an edge type not shown. */
  readonly shown: readonly Thing[];
}

export interface Loaded {
  readonly centre: Thing;
  /** Every group `get` lists, in the kit's order (edge type by UTF-8 bytes, out before in). */
  readonly groups: readonly Group[];
  /** Groups `get` could not list (it lists at most 20): the picture shows only part. */
  readonly unlisted: number;
}

/** What a neighbourhood needs from an open mosaic. */
export interface HoodSource {
  readonly edgeTypes: readonly EdgeType[];
  get(args: unknown): Promise<GetAnswer | ErrorAnswer>;
  neighbors(args: unknown): Promise<NeighborsAnswer | ErrorAnswer>;
}

/** A tool's error while loading a neighbourhood, naming the thing and the call. */
export class HoodError extends Error {
  override readonly name = "HoodError";
  constructor(
    readonly id: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The type in an id of the form `<type>:<key>` (section 3.4), or null. */
export function typeOfId(id: string): string | null {
  const at = id.indexOf(":");
  return at > 0 && /^[A-Z][A-Za-z0-9]*$/.test(id.slice(0, at)) ? id.slice(0, at) : null;
}

/** The type at the other end of `edge` seen from a thing, or null when the edge type does not say. */
function otherEnd(edges: readonly EdgeType[], edge: string, direction: "out" | "in"): string | null {
  const found = edges.find((e) => e.name === edge);
  return (direction === "out" ? found?.to : found?.from) ?? null;
}

/**
 * Load the thing `id` with its groups: its link counts, then up to `limit` neighbours of each
 * group whose edge type `shows` keeps (every one by default). One `get`, and one `neighbors`
 * per group shown; with a limit of 0, the counts alone.
 */
export async function loadThing(source: HoodSource, id: string, limit: Limit | 0, shows: (edge: string) => boolean = () => true): Promise<Loaded> {
  if (limit !== 0 && !STEPS.includes(limit)) throw new RangeError(`a group's limit is one of ${STEPS.join(", ")}, not ${String(limit)}`);
  const got = await source.get({ id });
  if ("error" in got) throw new HoodError(id, got.error.code, `${id}: ${got.error.message}`);
  const groups: Group[] = [];
  for (const link of got.data.links) {
    let shown: Thing[] = [];
    if (limit > 0 && shows(link.edge) && link.count > 0) {
      const answer = await source.neighbors({ id, edge: link.edge, direction: link.direction, limit });
      if ("error" in answer) throw new HoodError(id, answer.error.code, `${id}, ${link.edge} ${link.direction}: ${answer.error.message}`);
      const type = otherEnd(source.edgeTypes, link.edge, link.direction);
      shown = answer.data.edges.slice(0, limit).map((e) => ({ id: e.id, label: e.label, type: type ?? typeOfId(e.id) }));
    }
    groups.push({ edge: link.edge, direction: link.direction, count: link.count, shown });
  }
  return {
    centre: { id: got.data.id, label: got.data.label, type: got.data.type },
    groups,
    unlisted: Math.max(0, got.data.links_total - got.data.links.length),
  };
}

/** The person's choices: what the neighbourhood shows (G-5), and what a link to it holds (G-8). */
export interface HoodState {
  readonly centre: string;
  /**
   * Things unfolded, in the order unfolded. A thing named again is unfolded again, for more of
   * its links; the centre is unfolded once from the start, and named here for more.
   */
  readonly expanded: readonly string[];
  /** Edge types shown, by name (UTF-8 bytes); null shows every one. */
  readonly edges: readonly string[] | null;
}

/**
 * The most times things are unfolded in one neighbourhood (G-8): the same bound when a person
 * makes a picture and when a link is read, so every link a person can make reopens as the same
 * picture.
 */
export const MOST_EXPANDED = 50;

/** A neighbourhood centred on `id`, with nothing more unfolded and every edge type. */
export function hoodOf(id: string): HoodState {
  return { centre: id, expanded: [], edges: null };
}

/** How many times `id` is unfolded: the centre once from the start. */
export function unfolds(state: HoodState, id: string): number {
  return state.expanded.filter((e) => e === id).length + (id === state.centre ? 1 : 0);
}

/** How many neighbours per group `id` shows: 0 when it is not unfolded. */
export function limitOf(state: HoodState, id: string): Limit | 0 {
  const n = unfolds(state, id);
  return n === 0 ? 0 : STEPS[Math.min(n, STEPS.length) - 1]!;
}

/** True when `id` can be unfolded (again): it is not at the last step, nor the picture at its bound. */
export function canExpand(state: HoodState, id: string): boolean {
  return unfolds(state, id) < STEPS.length && state.expanded.length < MOST_EXPANDED;
}

/** Unfold `id`: its own neighbourhood opens, or, already open, shows more per group. */
export function expand(state: HoodState, id: string): HoodState {
  return canExpand(state, id) ? { ...state, expanded: [...state.expanded, id] } : state;
}

/** Centre on `id`: a new neighbourhood that keeps the edge types shown. */
export function recentre(state: HoodState, id: string): HoodState {
  return { centre: id, expanded: [], edges: state.edges };
}

/**
 * Show or stop showing edge type `edge`, of the mosaic's edge types `all`; showing every one is
 * `edges: null`, so a link made before an edge type was added still shows it.
 */
export function showEdge(state: HoodState, all: readonly string[], edge: string, on: boolean): HoodState {
  const now = new Set(state.edges ?? all);
  if (on) now.add(edge);
  else now.delete(edge);
  const every = all.every((e) => now.has(e));
  return { ...state, edges: every ? null : [...now].filter((e) => all.includes(e)).sort(byBytes) };
}

/** True when `state` shows edge type `edge`. */
export function shows(state: HoodState, edge: string): boolean {
  return state.edges === null || state.edges.includes(edge);
}

/** A neighbourhood loaded: the centre's and each unfolded thing's groups, as the state asks. */
export interface Hood {
  readonly state: HoodState;
  readonly centre: Loaded;
  /** Unfolded things, each once, in the order first unfolded; one that could not be loaded is in `failed`. */
  readonly expanded: readonly Loaded[];
  /** The things drawn that are not unfolded, each with its link counts and no neighbours. */
  readonly leaves: readonly Loaded[];
  /** Unfolded things the kit could not give, each with why. */
  readonly failed: readonly { readonly id: string; readonly message: string }[];
}

/** Loads neighbourhoods, keeping each thing's groups for the session, per limit and edge types shown. */
export class HoodLoader {
  readonly #source: HoodSource;
  readonly #kept = new Map<string, Promise<Loaded>>();

  constructor(source: HoodSource) {
    this.#source = source;
  }

  /** The thing `id` with its groups, as `state` unfolds it and shows edge types. */
  thing(state: HoodState, id: string): Promise<Loaded> {
    const limit = limitOf(state, id);
    const key = JSON.stringify([id, limit, limit === 0 ? null : state.edges]);
    let found = this.#kept.get(key);
    if (found === undefined) {
      found = loadThing(this.#source, id, limit, (e) => shows(state, e));
      // A failed load is not kept, so a later try asks again.
      found.catch(() => this.#kept.delete(key));
      this.#kept.set(key, found);
    }
    return found;
  }

  /** The neighbourhood `state` asks for. The centre must load; an unfolded thing that fails is reported. */
  async load(state: HoodState): Promise<Hood> {
    const centre = await this.thing(state, state.centre);
    const expanded: Loaded[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of new Set(state.expanded)) {
      if (id === state.centre) continue;
      try {
        expanded.push(await this.thing(state, id));
      } catch (e) {
        failed.push({ id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    // Each thing drawn and not unfolded is asked for its link counts, for its badge.
    const open = new Set([state.centre, ...state.expanded]);
    const leaves: Loaded[] = [];
    for (const t of layoutHood(centre, expanded, { shows: (e) => shows(state, e) }).things) {
      if (open.has(t.id)) continue;
      // One the kit cannot give is drawn without a badge.
      const leaf = await this.thing(state, t.id).catch(() => null);
      if (leaf !== null) leaves.push(leaf);
    }
    return { state, centre, expanded, leaves, failed };
  }
}
