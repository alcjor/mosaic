/**
 * The data of a neighbourhood (needs G-3, G-4, G-5, G-10): a thing's neighbours
 * grouped by edge type and direction, each group with its count; groups past the chosen limit
 * folded into a bundle; and the person's choices (expanded, hidden, edge types shown, limit)
 * as state the data follows.
 *
 * Only bounded calls to the kit as it is (G-12): `get` for a thing's link counts per edge type
 * and direction, then one `neighbors` per group shown, with that edge type, direction and the
 * limit (at most 20). A Netflix country with thousands of titles is one `get` and one
 * `neighbors` of at most 20 edges.
 *
 * A bundle opens as a list (G-4: 20 things
 * with the total, as the node page lists links, and "open as table" for the rest). `neighbors`
 * has no offset, so past its 20 the kit reaches the rest through `table`: the things a bundle's
 * links come from are the rows of their type whose edge column holds the thing's label
 * (`contains`, so by name: a longer name holding it matches too, and the list says so; a name
 * that is empty, or that the kit cut at 120 characters, finds no table); the
 * things a bundle's links lead to are all in the thing's own row of its type, as the labels of
 * its edge column, which `table` never cuts at 20 (one label per thing, so two links to one
 * thing show once). Where `table` would read the edge type's name as a property or a node field
 * (section 8.6), neither is offered: the bundle lists its 20 and says so.
 */
import { RESULT_LIMIT, TEXT_LIMITS, type EdgeType, type ErrorAnswer, type GetAnswer, type NeighborsAnswer, type TableAnswer } from "@mosaic/kit";
import type { TableRoute } from "../route.js";
import { byBytes } from "./bytes.js";
import { layoutHood } from "./hood-layout.js";

/** The limits a person can choose for each group (G-4). */
export const LIMITS = [3, 5, 10, 20] as const;
export type Limit = (typeof LIMITS)[number];
export const DEFAULT_LIMIT: Limit = 5;

/** Most things one `neighbors` call lists (section 8.2). */
export const LISTED = RESULT_LIMIT;

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
  table(args: unknown): Promise<TableAnswer | ErrorAnswer>;
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

/** The key in an id of the form `<type>:<key>`, or null. */
function keyOfId(id: string): string | null {
  return typeOfId(id) === null ? null : id.slice(id.indexOf(":") + 1);
}

/** The type at the other end of `edge` seen from a thing, or null when the edge type does not say. */
function otherEnd(edges: readonly EdgeType[], edge: string, direction: "out" | "in"): string | null {
  const found = edges.find((e) => e.name === edge);
  return (direction === "out" ? found?.to : found?.from) ?? null;
}

/**
 * Load the thing `id` with its groups: its link counts, then up to `limit` neighbours of each
 * group whose edge type `shows` keeps (every one by default). One `get`, and one `neighbors`
 * per group shown.
 */
export async function loadThing(source: HoodSource, id: string, limit: Limit, shows: (edge: string) => boolean = () => true): Promise<Loaded> {
  if (!LIMITS.includes(limit)) throw new RangeError(`a group's limit is one of ${LIMITS.join(", ")}, not ${String(limit)}`);
  const got = await source.get({ id });
  if ("error" in got) throw new HoodError(id, got.error.code, `${id}: ${got.error.message}`);
  const groups: Group[] = [];
  for (const link of got.data.links) {
    let shown: Thing[] = [];
    if (shows(link.edge) && link.count > 0) {
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

/** How many of a group's neighbours are folded into its bundle. */
export function folded(group: Group): number {
  return group.shown.length === 0 ? 0 : Math.max(0, group.count - group.shown.length);
}

/** The person's choices: what the neighbourhood shows (G-5), and what a link to it holds (G-8). */
export interface HoodState {
  readonly centre: string;
  /** Things whose own neighbourhoods are open, in the order opened. */
  readonly expanded: readonly string[];
  /** Things not drawn, by id (UTF-8 bytes). */
  readonly hidden: readonly string[];
  /** Edge types shown, by name (UTF-8 bytes); null shows every one. */
  readonly edges: readonly string[] | null;
  readonly limit: Limit;
}

/**
 * The most things a neighbourhood holds expanded, and the most it holds hidden (G-8): the same bound when a person makes a picture and when a link is read,
 * so every link a person can make reopens as exactly the same picture.
 */
export const MOST_EXPANDED = 50;
export const MOST_HIDDEN = 50;

/** A neighbourhood centred on `id`, with nothing expanded or hidden, every edge type and the default limit. */
export function hoodOf(id: string, limit: Limit = DEFAULT_LIMIT): HoodState {
  return { centre: id, expanded: [], hidden: [], edges: null, limit };
}

const sortedSet = (items: Iterable<string>) => [...new Set(items)].sort(byBytes);

/** Open `id`'s own neighbourhood; a hidden thing is shown again. The centre's is always open. */
export function expand(state: HoodState, id: string): HoodState {
  if (id === state.centre) return state;
  // At the bound, another thing is not expanded: collapse one first.
  if (!state.expanded.includes(id) && state.expanded.length >= MOST_EXPANDED) return state;
  return {
    ...state,
    expanded: state.expanded.includes(id) ? state.expanded : [...state.expanded, id],
    hidden: state.hidden.filter((h) => h !== id),
  };
}

/** Close `id`'s own neighbourhood. */
export function collapse(state: HoodState, id: string): HoodState {
  return state.expanded.includes(id) ? { ...state, expanded: state.expanded.filter((e) => e !== id) } : state;
}

/** Stop drawing `id` (and its own neighbourhood). The centre is never hidden. */
export function hide(state: HoodState, id: string): HoodState {
  if (id === state.centre) return state;
  // At the bound, another thing is not hidden: show one again first.
  if (!state.hidden.includes(id) && state.hidden.length >= MOST_HIDDEN) return state;
  return { ...state, hidden: sortedSet([...state.hidden, id]), expanded: state.expanded.filter((e) => e !== id) };
}

/** Draw `id` again. */
export function unhide(state: HoodState, id: string): HoodState {
  return state.hidden.includes(id) ? { ...state, hidden: state.hidden.filter((h) => h !== id) } : state;
}

/** Centre on `id`: a new neighbourhood that keeps the edge types shown and the limit. */
export function recentre(state: HoodState, id: string): HoodState {
  return { centre: id, expanded: [], hidden: [], edges: state.edges, limit: state.limit };
}

/** Show `limit` neighbours per group. */
export function withLimit(state: HoodState, limit: Limit): HoodState {
  if (!LIMITS.includes(limit)) throw new RangeError(`a group's limit is one of ${LIMITS.join(", ")}, not ${String(limit)}`);
  return { ...state, limit };
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
  return { ...state, edges: every ? null : sortedSet([...now].filter((e) => all.includes(e))) };
}

/** True when `state` shows edge type `edge`. */
export function shows(state: HoodState, edge: string): boolean {
  return state.edges === null || state.edges.includes(edge);
}

/** An edge type's count in a neighbourhood (G-5): its links among the things drawn, each once. */
export interface EdgeCount {
  readonly edge: string;
  readonly count: number;
  /** True when the count is a lower bound: some links between two open things could not be told apart. */
  readonly atLeast: boolean;
}

/**
 * Each edge type's count among `open`, the things drawn whose neighbourhoods are open (the centre
 * and the expanded things drawn), counted as the
 * distinct links of that type their groups hold. Their groups' counts are summed, then each link
 * counted from both ends (a link between two open things, or a thing's link to itself) is taken
 * off once. A pair's links are read from one end's `neighbors` (at most 20, by the other's id, so
 * a list that is whole, or that has gone past the other's id, holds them all), else from the
 * other end's. Where neither can, the count is a lower bound: the sum less the most those links
 * could be, and never less than one thing's own distinct links: its out and in less its links to
 * itself, which, where neither of its lists reaches its own id, are at most the links neither
 * list shows. Edge types are by name (UTF-8 bytes); one
 * not shown is counted all the same, as what showing it would add.
 */
export async function edgeCounts(
  source: Pick<HoodSource, "neighbors">,
  open: readonly Loaded[],
  lists = new Map<string, { ids: readonly string[]; whole: boolean }>(),
): Promise<EdgeCount[]> {
  const countOf = (l: Loaded, edge: string, direction: "out" | "in") => l.groups.find((g) => g.edge === edge && g.direction === direction)?.count ?? 0;
  async function listOf(id: string, edge: string, direction: "out" | "in") {
    const key = JSON.stringify([id, edge, direction]);
    let found = lists.get(key);
    if (found === undefined) {
      const answer = await source.neighbors({ id, edge, direction, limit: LISTED });
      if ("error" in answer) throw new HoodError(id, answer.error.code, `${id}, ${edge} ${direction}: ${answer.error.message}`);
      found = { ids: answer.data.edges.map((e) => e.id), whole: answer.data.total <= answer.data.edges.length };
      lists.set(key, found);
    }
    return found;
  }
  const holds = (list: { ids: readonly string[]; whole: boolean }, other: string) =>
    list.whole || (list.ids.length > 0 && byBytes(other, list.ids[list.ids.length - 1]!) < 0);
  const edges = [...new Set(open.flatMap((l) => l.groups.map((g) => g.edge)))].sort(byBytes);
  const out: EdgeCount[] = [];
  for (const edge of edges) {
    let sum = 0;
    for (const l of open) sum += countOf(l, edge, "out") + countOf(l, edge, "in");
    let twice = 0;
    let unknown = 0;
    /** Each open thing's links to itself, where known. */
    const self = new Map<string, number>();
    for (const x of open) {
      if (countOf(x, edge, "out") === 0) continue;
      for (const y of open) {
        if (countOf(y, edge, "in") === 0) continue;
        let both: number | null = null;
        const fromX = await listOf(x.centre.id, edge, "out");
        if (holds(fromX, y.centre.id)) both = fromX.ids.filter((id) => id === y.centre.id).length;
        else {
          const fromY = await listOf(y.centre.id, edge, "in");
          if (holds(fromY, x.centre.id)) both = fromY.ids.filter((id) => id === x.centre.id).length;
        }
        if (both === null) unknown += Math.min(countOf(x, edge, "out"), countOf(y, edge, "in"));
        else twice += both;
        if (both !== null && x === y) self.set(x.centre.id, both);
      }
    }
    // The most one thing's own links are sure to be: out and in, less its links to itself. Where
    // neither of its lists reaches its own id, those are among the links neither list shows.
    let one = 0;
    for (const l of open) {
      const id = l.centre.id;
      const o = countOf(l, edge, "out");
      const i = countOf(l, edge, "in");
      const unlisted = (direction: "out" | "in", n: number) => n - (lists.get(JSON.stringify([id, edge, direction]))?.ids.length ?? 0);
      const toItself = self.get(id) ?? (o > 0 && i > 0 ? Math.min(unlisted("out", o), unlisted("in", i)) : 0);
      one = Math.max(one, o + i - toItself);
    }
    const distinct = sum - twice;
    out.push(unknown === 0 ? { edge, count: distinct, atLeast: false } : { edge, count: Math.max(distinct - unknown, one), atLeast: true });
  }
  return out;
}

/** A neighbourhood loaded: the centre's and each expanded thing's groups, as the state asks. */
export interface Hood {
  readonly state: HoodState;
  /** Each edge type's count among the things drawn (see {@link edgeCounts}). */
  readonly counts: readonly EdgeCount[];
  readonly centre: Loaded;
  /** Expanded things, in the order opened; one that could not be loaded is in `failed`. */
  readonly expanded: readonly Loaded[];
  /** Expanded things the kit could not give, each with why. */
  readonly failed: readonly { readonly id: string; readonly message: string }[];
}

/** Loads neighbourhoods, keeping each thing's groups for the session, per limit and edge types shown. */
export class HoodLoader {
  readonly #source: HoodSource;
  readonly #kept = new Map<string, Promise<Loaded>>();
  /** The `neighbors` lists the counts read, kept for the session too. */
  readonly #lists = new Map<string, { ids: readonly string[]; whole: boolean }>();

  constructor(source: HoodSource) {
    this.#source = source;
  }

  /** The thing `id` with its groups, as `state`'s limit and edge types ask. */
  thing(state: HoodState, id: string): Promise<Loaded> {
    const key = JSON.stringify([id, state.limit, state.edges]);
    let found = this.#kept.get(key);
    if (found === undefined) {
      found = loadThing(this.#source, id, state.limit, (e) => shows(state, e));
      // A failed load is not kept, so a later try asks again.
      found.catch(() => this.#kept.delete(key));
      this.#kept.set(key, found);
    }
    return found;
  }

  /** The neighbourhood `state` asks for. The centre must load; an expanded thing that fails is reported. */
  async load(state: HoodState): Promise<Hood> {
    const centre = await this.thing(state, state.centre);
    const expanded: Loaded[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of state.expanded) {
      if (state.hidden.includes(id)) continue;
      try {
        expanded.push(await this.thing(state, id));
      } catch (e) {
        failed.push({ id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    // The things drawn: an expanded thing folded into a bundle, or cut off by an edge type not
    // shown, opens nothing, so it counts for nothing.
    const drawn = new Set(layoutHood(centre, expanded, { hidden: new Set(state.hidden), shows: (e) => shows(state, e) }).things.map((t) => t.id));
    const counts = await edgeCounts(this.#source, [centre, ...expanded.filter((e) => drawn.has(e.centre.id))], this.#lists);
    return { state, counts, centre, expanded, failed };
  }
}

/** What opening a bundle needs: a neighbourhood's source, and each type's declared properties. */
export interface BundleSource extends HoodSource {
  propsOf(type: string): readonly string[];
}

/** The node fields `table` reads a column name as before an edge type (section 8.6). */
const FIELDS: readonly string[] = ["key", "label", "summary"];

/**
 * True when `table` on `type` reads the column `edge` as that edge type: section 8.6 reads a
 * column name as a declared property first, then as a node field, and only then as an edge type.
 */
function edgeColumn(source: BundleSource, type: string, edge: string): boolean {
  return !FIELDS.includes(edge) && !source.propsOf(type).includes(edge);
}

/** A bundle opened (G-4): the things it holds, as far as the kit lists them, and how to see the rest. */
export interface Bundle {
  readonly owner: Thing;
  readonly edge: string;
  readonly direction: "out" | "in";
  /** How many links the group has. */
  readonly total: number;
  /** The first things, with their ids, in the kit's order: at most 20. */
  readonly things: readonly Thing[];
  /**
   * Every thing the group's links lead to, by label, when the kit gives them all (links leaving
   * the owner, from the owner's row of its type's table); null otherwise.
   */
  readonly allLabels: readonly (string | null)[] | null;
  /** The table that lists the rest, or null when the kit has no such table. */
  readonly table: TableRoute | null;
  /** True when `table` finds its rows by the owner's name, so a longer name holding it shows too. */
  readonly byName: boolean;
}

/**
 * True when `label` can find its own rows by name: not missing, not empty (which every row
 * contains), and not cut by the kit (section 8.2: past 120 characters, with a marker no row holds).
 */
function findable(label: string | null): label is string {
  return label !== null && label !== "" && Array.from(label).length <= TEXT_LIMITS.label;
}

/** Open the bundle of `owner`'s links of `edge` in `direction`. */
export async function openBundle(source: BundleSource, owner: Thing, edge: string, direction: "out" | "in"): Promise<Bundle> {
  const answer = await source.neighbors({ id: owner.id, edge, direction, limit: LISTED });
  if ("error" in answer) throw new HoodError(owner.id, answer.error.code, `${owner.id}, ${edge} ${direction}: ${answer.error.message}`);
  const type = otherEnd(source.edgeTypes, edge, direction);
  const things = answer.data.edges.map((e) => ({ id: e.id, label: e.label, type: type ?? typeOfId(e.id) }));
  const total = answer.data.total;
  const bundle = { owner, edge, direction, total, things };
  if (total <= things.length) return { ...bundle, allLabels: null, table: null, byName: false };
  const ends = source.edgeTypes.find((e) => e.name === edge);
  if (direction === "in") {
    // The things whose links reach the owner: rows of the type the edge leaves, by the owner's name.
    const from = ends?.from ?? null;
    if (from === null || !findable(owner.label) || !edgeColumn(source, from, edge)) return { ...bundle, allLabels: null, table: null, byName: false };
    const table: TableRoute = { type: from, page: 1, order: null, where: [{ column: edge, op: "contains", value: owner.label }] };
    return { ...bundle, allLabels: null, table, byName: true };
  }
  // The things the owner's links reach: its own row, whose edge column lists them all.
  const key = keyOfId(owner.id);
  const ownType = owner.type ?? typeOfId(owner.id);
  const none = { ...bundle, allLabels: null, table: null, byName: false };
  if (key === null || ownType === null || ends?.from !== ownType || !edgeColumn(source, ownType, edge) || source.propsOf(ownType).includes("key")) return none;
  const row = await source.table({ type: ownType, columns: [edge], where: { column: "key", op: "=", value: key } });
  // A key the kit cannot take in a query (over 1000 characters) leaves the 20 things listed.
  if ("error" in row) return none;
  const cell = row.data.rows[0]?.[1];
  const allLabels = Array.isArray(cell) ? cell.map((l) => (l === null ? null : String(l))) : null;
  return { ...bundle, allLabels, table: null, byName: false };
}
