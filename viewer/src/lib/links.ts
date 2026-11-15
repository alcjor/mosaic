/**
 * Every link of one thing by one edge type and direction, through the kit as it is:
 * what a chain needs to count and list its results past the 20th
 * link of a busy thing (V-13, V-14).
 *
 * `neighbors` lists at most 20 edges, with the exact total and no offset. Past the 20th, the
 * links are worked out from `table` (Specification 0.1, section 8.6), which never cuts an edge
 * cell at 20:
 *
 * - **Out** (the thing's own edges): its row of its type, with the edge type as the column, holds
 *   the labels of the things the edges lead to, one per thing, in the order of their ids (UTF-8
 *   bytes). The first 20 edges come from `neighbors`, ids and all; each later label is matched to
 *   the things of the other type with that label (`table` with `where label`, or, when many
 *   labels are to be matched, every row of that type once). Since the labels come in id order,
 *   each must name a thing whose id comes after the one before: where that leaves one thing, it
 *   is the one; where it leaves several (things sharing a label, side by side in id order), each
 *   is checked from its own side (`neighbors`, in, at most 20).
 * - **In** (edges reaching the thing): the rows of the other type whose edge cell holds the
 *   thing's label (`where … contains`, then the exact label in the cell), in id order. Where
 *   another thing of the thing's type shares its label, a row is kept only when its own links
 *   (out, as above) include the thing.
 * - Two links of one type between the same two things (told apart by a qualifier, section 3.4)
 *   show once in a cell. When the cells name fewer things than there are links, each thing past
 *   the 20th link is asked from its own side for its links to this one (`neighbors`, at most 20);
 *   when one thing alone has too many to say, it has what is left of the total.
 * - Past the 20th, the kit does not show a link's qualifier: `table`'s cells hold labels and
 *   `cite`'s rows hold none. Such a link's qualifier is `undefined`, "not shown", never null,
 *   which says it has none; {@link LinkReader.qualify} reads it from either side where that side
 *   has at most 20 such links.
 *
 * Where none of this can tell (a label shared by things that each have more than 20 such links,
 * a thing without a row, an edge type whose name `table` reads as a property or node field of
 * its type), the list holds what is known and says so: `exact` is false, `note` says why. The
 * total is always the kit's own count.
 *
 * Only `get`, `neighbors` and `table` are asked, each within the kit's time bound; between calls
 * the walk gives the page its turn, so a long walk never freezes it.
 */
import { CUT_MARKER, RESULT_LIMIT, type ErrorAnswer, type SealedFile, type TableAnswer } from "@mosaic/kit";
import type { Direction } from "./chain.js";
import { byBytes } from "./graph/bytes.js";

/** One link: the thing at its other end, and its qualifier. */
export interface Link {
  readonly id: string;
  readonly label: string | null;
  /** Its qualifier (section 3.4); null when it has none; undefined when the kit does not show it. */
  readonly qualifier: string | null | undefined;
}

/** A thing's links by one edge type and direction. */
export interface Links {
  /** In the kit's order: by the other thing's id, then the qualifier (UTF-8 bytes). */
  readonly links: readonly Link[];
  /** How many links there are: the kit's own count, exact. */
  readonly total: number;
  /** True when `links` holds every one of them. */
  readonly exact: boolean;
  /** Why it does not, when it does not. */
  readonly note?: string;
}

/** What links need from an open mosaic. */
export type LinkSource = Pick<SealedFile, "nodeTypes" | "edgeTypes" | "propsOf" | "get" | "neighbors" | "table">;

/** A tool's error answer, as an exception naming the call. */
export class KitError extends Error {
  override readonly name = "KitError";
}

/** The node fields `table` reads a column name as when the type declares no such property. */
const FIELDS = ["key", "label", "summary"] as const;

/** How long the walk works before it gives the page its turn, in milliseconds. */
const SLICE_MS = 12;

let worked = 0;

/** Give the page its turn when the walk has worked long enough; stop when asked to. */
export async function pace(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const now = performance.now();
  if (worked === 0) worked = now;
  if (now - worked < SLICE_MS) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  worked = performance.now();
  signal?.throwIfAborted();
}

export const flip = (d: Direction): Direction => (d === "out" ? "in" : "out");

/**
 * Links in the kit's order: by the other thing's id, then the qualifier (UTF-8 bytes). A qualifier
 * not shown sorts last: the kit shows the first ones, in this order, so those it does not come after.
 */
export const byLink = (a: Link, b: Link): number => {
  const byId = byBytes(a.id, b.id);
  if (byId !== 0 || a.qualifier === b.qualifier) return byId;
  if (a.qualifier === undefined) return 1;
  if (b.qualifier === undefined) return -1;
  return byBytes(a.qualifier ?? "", b.qualifier ?? "");
};

/** The type in an id of the form `<type>:<key>` (section 3.4). */
const typeOf = (id: string) => id.slice(0, id.indexOf(":"));

/** True when the kit cut this label (section 8.2): the marker after 120 characters. */
const wasCut = (label: string) => [...label].length === 121 && label.endsWith(CUT_MARKER);

/** A `where` that keeps the things labelled `label` as the kit gives it, and maybe a few more. */
const labelled = (label: string) =>
  wasCut(label) ? { column: "label", op: "contains", value: label.slice(0, -1) } : { column: "label", op: "=", value: label };

interface Found {
  readonly links: readonly Link[];
  readonly total: number;
}

interface Thing {
  readonly id: string;
  readonly label: string | null;
}

/** Keep a promise while it may still settle well; forget it when it fails, so it is asked again. */
function kept<K, V>(map: Map<K, Promise<V>>, key: K, make: () => Promise<V>): Promise<V> {
  let found = map.get(key);
  if (found === undefined) {
    found = make();
    map.set(key, found);
    found.catch(() => map.delete(key));
  }
  return found;
}

/**
 * Reads links through the kit and keeps what it read, so a chain asks each thing once. One
 * reader serves one open mosaic.
 */
export class LinkReader {
  readonly #source: LinkSource;
  readonly #things = new Map<string, Promise<Thing | null>>();
  readonly #first = new Map<string, Promise<Found>>();
  readonly #all = new Map<string, Promise<Links>>();
  readonly #index = new Map<string, Promise<Map<string | null, string[]> | null>>();
  readonly #named = new Map<string, Promise<string[] | null>>();

  constructor(source: LinkSource) {
    this.#source = source;
  }

  async #ask<T>(answer: Promise<T | ErrorAnswer>, signal?: AbortSignal): Promise<T> {
    const a = await answer;
    await pace(signal);
    if (typeof a === "object" && a !== null && "error" in a) throw new KitError(a.error.message);
    return a as T;
  }

  /** The thing `id` (`get`), or null when the mosaic has no such thing. */
  thing(id: string, signal?: AbortSignal): Promise<Thing | null> {
    return kept(this.#things, id, async () => {
      const a = await this.#source.get({ id });
      await pace(signal);
      if (!("error" in a)) return { id: a.data.id, label: a.data.label };
      if (a.error.code === "unknown_id") return null;
      throw new KitError(a.error.message);
    });
  }

  /** The first 20 links (`neighbors`), and how many there are. */
  first(id: string, edge: string, direction: Direction, signal?: AbortSignal): Promise<Found> {
    return kept(this.#first, JSON.stringify([id, edge, direction]), async () => {
      const a = await this.#ask(this.#source.neighbors({ id, edge, direction }), signal);
      return { links: a.data.edges.map((e) => ({ id: e.id, label: e.label, qualifier: e.qualifier ?? null })), total: a.data.total };
    });
  }

  /** How many links there are: the kit's count. */
  async count(id: string, edge: string, direction: Direction, signal?: AbortSignal): Promise<number> {
    return (await this.first(id, edge, direction, signal)).total;
  }

  /** Every link, or as many as the kit can tell, in the kit's order. */
  all(id: string, edge: string, direction: Direction, signal?: AbortSignal): Promise<Links> {
    return kept(this.#all, JSON.stringify([id, edge, direction]), () => this.#allOf(id, edge, direction, signal));
  }

  async #allOf(id: string, edge: string, direction: Direction, signal?: AbortSignal): Promise<Links> {
    const first = await this.first(id, edge, direction, signal);
    if (first.links.length === first.total) return { ...first, exact: true };
    const short = (links: readonly Link[], why: string): Links => ({
      links,
      total: first.total,
      exact: false,
      note: `${id}: the kit cannot list all ${first.total} of its ${edge} ${direction} links, only ${links.length} (${why})`,
    });
    const type = this.#source.edgeTypes.find((e) => e.name === edge);
    if (type === undefined || type.from === null || type.to === null) return short(first.links, `the mosaic has no edge type ${edge} with both ends`);
    if (this.#shadowed(type.from, edge)) return short(first.links, `table reads ${edge} as a property or field of ${type.from}`);
    try {
      const found = direction === "out" ? await this.#out(id, edge, type.to, first, signal) : await this.#in(id, edge, type.from, type.to, first, signal);
      if (typeof found === "string") return short(first.links, found);
      // Every link found is certain, and the total is the kit's: all are found when the numbers meet.
      return found.length === first.total ? { links: found, total: first.total, exact: true } : short(found, "things that share a label could not be told apart");
    } catch (e) {
      if (e instanceof KitError) return short(first.links, e.message);
      throw e;
    }
  }

  /** True when `table` on `type` reads `column` as something else (section 8.6). */
  #shadowed(type: string, column: string): boolean {
    return this.#source.propsOf(type).includes(column) || (FIELDS as readonly string[]).includes(column);
  }

  /** The labels in `id`'s row of its type, in the column `edge`: the things its links lead to. */
  async #cell(self: Thing, edge: string, signal?: AbortSignal): Promise<readonly (string | null)[] | string> {
    const type = typeOf(self.id);
    const props = this.#source.propsOf(type);
    let where: object;
    if (!props.includes("key")) where = { column: "key", op: "=", value: self.id.slice(type.length + 1) };
    else if (self.label !== null && !props.includes("label")) where = labelled(self.label);
    else return `table cannot pick out ${self.id}'s row`;
    for (let page = 1; ; page++) {
      const a = await this.#ask(this.#source.table({ type, columns: [edge], where, page }), signal);
      const row = a.data.rows.find((r) => r[0] === self.id);
      if (row !== undefined) return row[1] as (string | null)[];
      if (page * RESULT_LIMIT >= a.data.total) return `table has no row for ${self.id}`;
    }
  }

  /** Every thing of `type` by its label as the kit gives it; null when `table` reads label as a property. */
  #byLabel(type: string, signal?: AbortSignal): Promise<Map<string | null, string[]> | null> {
    return kept(this.#index, type, async () => {
      if (this.#source.propsOf(type).includes("label")) return null;
      const index = new Map<string | null, string[]>();
      for (let page = 1; ; page++) {
        const a = await this.#ask(this.#source.table({ type, columns: ["label"], page }), signal);
        for (const [id, label] of a.data.rows as [string, string | null][]) index.set(label, [...(index.get(label) ?? []), id]);
        if (page * RESULT_LIMIT >= a.data.total) return index;
      }
    });
  }

  /** The things of `type` labelled `label` as the kit gives it, by id; null when `table` cannot say. */
  #withLabel(type: string, label: string | null, signal?: AbortSignal): Promise<string[] | null> {
    if (label === null) return this.#byLabel(type, signal).then((index) => (index === null ? null : (index.get(null) ?? [])));
    return kept(this.#named, JSON.stringify([type, label]), async () => {
      if (this.#source.propsOf(type).includes("label")) return null;
      const ids: string[] = [];
      for (let page = 1; ; page++) {
        const a: TableAnswer = await this.#ask(this.#source.table({ type, columns: ["label"], where: labelled(label), page }), signal);
        for (const [id, l] of a.data.rows as [string, string | null][]) if (l === label) ids.push(id);
        if (page * RESULT_LIMIT >= a.data.total) return ids.sort(byBytes);
      }
    });
  }

  /** The things of `type` labelled each of `labels`, by id: one lookup each, or the whole type once. */
  async #candidates(type: string, labels: readonly (string | null)[], signal?: AbortSignal): Promise<Map<string | null, string[]> | null> {
    const distinct = [...new Set(labels)];
    const pages = Math.ceil((this.#source.nodeTypes.find((t) => t.name === type)?.count ?? 0) / RESULT_LIMIT);
    const found = new Map<string | null, string[]>();
    if (distinct.length * 2 > pages) {
      const index = await this.#byLabel(type, signal);
      if (index === null) return null;
      for (const l of distinct) found.set(l, [...(index.get(l) ?? [])].sort(byBytes));
      return found;
    }
    for (const l of distinct) {
      const ids = await this.#withLabel(type, l, signal);
      if (ids === null) return null;
      found.set(l, ids);
    }
    return found;
  }

  /** `other`'s links by `edge` (`direction`, from its side) to `id`; null when it has too many to say. */
  async #between(other: string, edge: string, direction: Direction, id: string, signal?: AbortSignal): Promise<Link[] | null> {
    const back = await this.first(other, edge, direction, signal);
    if (back.links.length < back.total) return null;
    return back.links.filter((l) => l.id === id);
  }

  /**
   * `links[index]` (links of `id` by `edge` in `direction`, in the kit's order) with its qualifier
   * read from either side, where that side lists all its links of the pair: the pair's links come
   * in qualifier order on both sides, so its place among them names it.
   */
  async qualify(id: string, edge: string, direction: Direction, links: readonly Link[], index: number, signal?: AbortSignal): Promise<Link> {
    const link = links[index]!;
    if (link.qualifier !== undefined) return link;
    let start = index;
    while (start > 0 && links[start - 1]!.id === link.id) start--;
    let end = index;
    while (end + 1 < links.length && links[end + 1]!.id === link.id) end++;
    for (const pair of [() => this.#between(id, edge, direction, link.id, signal), () => this.#between(link.id, edge, flip(direction), id, signal)]) {
      const found = await pair();
      if (found !== null && found.length === end - start + 1) return { ...link, qualifier: found[index - start]!.qualifier };
    }
    return link;
  }

  /**
   * The links to `things`, the things past the first 20 links (the last of those first included),
   * in id order; `complete` when they are every thing the links lead to. One link each when there
   * are as many things as links left; otherwise each thing's own side says how many, and one
   * thing whose side has too many to say has what is left of the total.
   */
  async #spread(id: string, edge: string, direction: Direction, first: Found, things: readonly Thing[], complete: boolean, signal?: AbortSignal): Promise<Link[]> {
    const ids = new Set(things.map((t) => t.id));
    const links: Link[] = first.links.filter((l) => !ids.has(l.id));
    const shown = (t: Thing) => first.links.filter((l) => l.id === t.id);
    if (complete && links.length + things.length === first.total) {
      for (const t of things) links.push(shown(t)[0] ?? { id: t.id, label: t.label, qualifier: undefined });
      return links;
    }
    const unknown: Thing[] = [];
    for (const t of things) {
      const pair = await this.#between(t.id, edge, flip(direction), id, signal);
      if (pair === null) unknown.push(t);
      else links.push(...pair.map((l) => ({ id: t.id, label: t.label, qualifier: l.qualifier })));
    }
    for (const t of unknown) {
      const known = shown(t);
      const left = first.total - links.length - unknown.filter((u) => u !== t).reduce((n, u) => n + Math.max(1, shown(u).length), 0);
      const more = complete && unknown.length === 1 ? Math.max(0, left - known.length) : 0;
      links.push(...known, ...Array.from({ length: more }, (): Link => ({ id: t.id, label: t.label, qualifier: undefined })));
    }
    return links;
  }

  async #out(id: string, edge: string, to: string, first: Found, signal?: AbortSignal): Promise<Link[] | string> {
    const self = await this.thing(id, signal);
    if (self === null) return `the mosaic has no ${id}`;
    const cell = await this.#cell(self, edge, signal);
    if (typeof cell === "string") return cell;
    // The things of the first 20 links hold the cell's first places.
    const known: Thing[] = [];
    for (const l of first.links) if (known.at(-1)?.id !== l.id) known.push({ id: l.id, label: l.label });
    const rest = cell.slice(known.length);
    const candidates = await this.#candidates(to, rest, signal);
    if (candidates === null) return `table reads label as a property of ${to}`;
    // Each later place holds a thing with its label whose id comes after the one before: the
    // earliest and the latest such choices bound every possible one, place by place.
    const options = rest.map((l) => candidates.get(l) ?? []);
    const low: string[] = [];
    let after = known.at(-1)?.id ?? "";
    for (const ids of options) {
      const pick = ids.find((c) => byBytes(c, after) > 0);
      if (pick === undefined) return "a label in its row names no thing table lists";
      low.push(pick);
      after = pick;
    }
    const high: string[] = [];
    let before: string | null = null;
    for (let k = options.length - 1; k >= 0; k--) {
      const ids = options[k]!;
      let pick: string | undefined;
      for (let j = ids.length - 1; j >= 0 && pick === undefined; j--) if (before === null || byBytes(ids[j]!, before) < 0) pick = ids[j];
      if (pick === undefined || byBytes(pick, low[k]!) < 0) return "a label in its row names no thing table lists";
      high[k] = pick;
      before = pick;
    }
    const later: Thing[] = known.slice(-1);
    let complete = true;
    for (let k = 0; k < options.length; k++) {
      if (low[k] === high[k]) {
        later.push({ id: low[k]!, label: rest[k]! });
        continue;
      }
      // Several things fit this place: the one linked, as its own side says.
      let pick: string | null = null;
      for (const c of options[k]!.filter((c) => byBytes(c, low[k]!) >= 0 && byBytes(c, high[k]!) <= 0)) {
        if (later.some((t) => t.id === c)) continue;
        const linked = await this.#between(c, edge, "in", id, signal);
        if (linked === null) break;
        if (linked.length > 0) {
          pick = c;
          break;
        }
      }
      if (pick === null) complete = false;
      else later.push({ id: pick, label: rest[k]! });
    }
    return (await this.#spread(id, edge, "out", first, later, complete, signal)).sort(byLink);
  }

  async #in(id: string, edge: string, from: string, to: string, first: Found, signal?: AbortSignal): Promise<Link[] | string> {
    const self = await this.thing(id, signal);
    if (self === null) return `the mosaic has no ${id}`;
    const label = self.label;
    const named = await this.#withLabel(to, label, signal);
    if (named === null) return `table reads label as a property of ${to}`;
    // The rows of the other type whose cell holds this thing's label, by id.
    const showsLabel = !this.#source.propsOf(from).includes("label");
    const where = label === null ? {} : { where: { column: edge, op: "contains", value: wasCut(label) ? label.slice(0, -1) : label } };
    const rows: (Thing & { times: number })[] = [];
    for (let page = 1; ; page++) {
      const a = await this.#ask(this.#source.table({ type: from, columns: showsLabel ? [edge, "label"] : [edge], ...where, page }), signal);
      for (const row of a.data.rows) {
        const times = (row[1] as (string | null)[]).filter((l) => l === label).length;
        if (times > 0) rows.push({ id: row[0] as string, label: showsLabel ? (row[2] as string | null) : null, times });
      }
      if (page * RESULT_LIMIT >= a.data.total) break;
    }
    const listed = new Map(first.links.map((l) => [l.id, l.label]));
    const last = first.links.at(-1)?.id;
    // A row holding the label once per thing that has it links to all of them; otherwise its
    // own links say whether it links to this one.
    const later: Thing[] = [];
    let complete = true;
    for (const r of rows) {
      if (listed.has(r.id) && r.id !== last) continue;
      let linked = listed.has(r.id) || r.times >= named.length;
      if (!linked) {
        const own = await this.all(r.id, edge, "out", signal);
        linked = own.links.some((l) => l.id === id);
        if (!linked && !own.exact) complete = false;
      }
      if (!linked) continue;
      const label = listed.has(r.id) ? listed.get(r.id)! : showsLabel ? r.label : ((await this.thing(r.id, signal))?.label ?? null);
      later.push({ id: r.id, label });
    }
    return (await this.#spread(id, edge, "in", first, later, complete, signal)).sort(byLink);
  }
}

/** Every link of the thing `id` by `edge` in `direction`, or as many as the kit can tell. */
export function allLinks(source: LinkSource, id: string, edge: string, direction: Direction): Promise<Links> {
  return new LinkReader(source).all(id, edge, direction);
}
