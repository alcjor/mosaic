/**
 * A chain's results, through the kit (docs/design.md, "Viewer: chains and cards").
 *
 * - A result is one walk along the chain: one thing per place (the start, then one per step),
 *   each joined to the next by one link of the step's edge type, in the step's direction, and
 *   each the pinned thing where its place is pinned (V-1, V-2). Two links of one type between the
 *   same two things (told apart by a qualifier, section 3.4) make two results, each with its link.
 * - V-13: results come in one order, the kit's: by the start's id, then, step by step, by the next
 *   thing's id and the link's qualifier (UTF-8 bytes), as `table` and `neighbors` give them. The
 *   same mosaic gives the same results in the same order every time. {@link ChainResults.count}
 *   says how many there are, whether or not they are shown.
 * - V-14: a page of results asks only for what it shows: the first page of a busy thing's links
 *   is one `neighbors` call, and the count of a last step is the kit's link count, never a list.
 *   The count walks in the background, gives the page its turn as it goes, reports a running
 *   count that only grows, and stops when asked to.
 *
 * How it counts, with the kit as it is: the walks are counted place by place from the end, each
 * thing's count the sum of the counts of the things its links lead to (the last step's straight
 * from `neighbors`' total). Before the last pinned place, only the things that can reach that pin
 * are walked: they are found backwards from the pin, each place from the links reaching the next
 * (`links.ts` lists every link of a busy thing past the 20th). The count is exact whenever every
 * list it needs is (see `links.ts` for when the kit cannot tell); otherwise it is the number of
 * results found, with `exact` false and a note naming the thing whose links could not all be
 * listed, so it is at least that many.
 */
import { RESULT_LIMIT } from "@mosaic/kit";
import { checkChain, type Chain, type Step } from "./chain.js";
import { byBytes } from "./graph/bytes.js";
import { KitError, LinkReader, byLink, flip, pace, type Link, type LinkSource } from "./links.js";

/** A thing in a result. */
export interface ResultThing {
  readonly id: string;
  readonly label: string | null;
}

/** The link between two places of a result. */
export interface ResultLink {
  /**
   * Its qualifier (section 3.4); null when it has none; undefined when the kit does not show it
   * (one of more than 20 links between the same two things, past the 20th: see `links.ts`).
   */
  readonly qualifier: string | null | undefined;
}

/** One walk along the chain. */
export interface Result {
  /** One per place: the start, then one per step. */
  readonly things: readonly ResultThing[];
  /** One per step: the link from the thing before to the thing after. */
  readonly links: readonly ResultLink[];
}

/** How many results a chain has. */
export interface Count {
  /** The number of results; when not exact, the number found, so there are at least as many. */
  readonly total: number;
  readonly exact: boolean;
  /** What could not be counted, and pinned things the mosaic lacks; each names the thing. */
  readonly notes: readonly string[];
}

export interface CountOptions {
  readonly signal?: AbortSignal;
  /** Called as the count grows, with the results counted so far. */
  readonly progress?: (atLeast: number) => void;
}

/** A place's count: how many walks go on from a thing there to the end. */
interface Tally {
  readonly n: number;
  readonly exact: boolean;
}

/** The things before the last pinned place that can reach it, and their links on toward it. */
interface Backward {
  /** Per place up to the last pin: its things, by id. */
  readonly things: readonly Map<string, string | null>[];
  /** Per place before the last pin: each thing's links to the next place's things, in the kit's order. */
  readonly onward: readonly Map<string, Link[]>[];
  readonly exact: boolean;
}

/** The results of one chain on one open mosaic. */
export class ChainResults {
  readonly #source: LinkSource;
  readonly #reader: LinkReader;
  readonly #chain: Chain;
  readonly #pins: readonly (string | null)[];
  /** The last pinned place, or -1 when nothing is pinned. */
  readonly #last: number;
  /** What is wrong with the chain itself: a step the mosaic does not allow, a pin it lacks. */
  readonly #problems = new Set<string>();
  /** Links the kit counts but does not list. */
  readonly #unlisted = new Set<string>();
  /** Links the kit could not list or count. */
  readonly #notes = new Set<string>();
  readonly #tallies = new Map<string, Promise<Tally>>();
  #checked: Promise<boolean> | undefined;
  #backward: Promise<Backward | null> | undefined;

  constructor(source: LinkSource, chain: Chain, reader: LinkReader = new LinkReader(source)) {
    this.#source = source;
    this.#reader = reader;
    this.#chain = chain;
    this.#pins = [chain.pin, ...chain.steps.map((s) => s.pin)];
    let last = -1;
    this.#pins.forEach((p, i) => {
      if (p !== null) last = i;
    });
    this.#last = last;
  }

  get #length(): number {
    return this.#chain.steps.length;
  }

  #step(place: number): Step {
    return this.#chain.steps[place - 1]!;
  }

  #note(text: string | undefined): void {
    if (text !== undefined) this.#notes.add(text);
  }

  /**
   * True when the mosaic allows the chain as it is (`checkChain`: every step, every pin of
   * its place's type) and has every thing it pins; otherwise each problem is noted and the chain
   * finds nothing.
   */
  #valid(signal?: AbortSignal): Promise<boolean> {
    this.#checked ??= (async () => {
      const { problems } = checkChain(this.#source, this.#chain);
      for (const p of problems) this.#problems.add(p);
      if (problems.length > 0) return false;
      for (const pin of new Set(this.#pins)) {
        if (pin !== null && (await this.#reader.thing(pin, signal)) === null) {
          this.#problems.add(`${pin}: the mosaic has no such thing`);
          return false;
        }
      }
      return true;
    })();
    this.#checked.catch(() => (this.#checked = undefined));
    return this.#checked;
  }

  /** The things before the last pin that reach it; null when the chain finds nothing. */
  #back(signal?: AbortSignal): Promise<Backward | null> {
    this.#backward ??= (async () => {
      if (!(await this.#valid(signal))) return null;
      if (this.#last < 0) return { things: [], onward: [], exact: true };
      const pin = this.#pins[this.#last]!;
      const things: Map<string, string | null>[] = [];
      const onward: Map<string, Link[]>[] = [];
      things[this.#last] = new Map([[pin, (await this.#reader.thing(pin, signal))!.label]]);
      let exact = true;
      for (let place = this.#last; place > 0; place--) {
        const step = this.#step(place);
        const before = new Map<string, string | null>();
        const links = new Map<string, Link[]>();
        for (const [id, label] of [...things[place]!].sort(([a], [b]) => byBytes(a, b))) {
          const back = await this.#reader.all(id, step.edge, flip(step.direction), signal);
          if (!back.exact) {
            exact = false;
            this.#note(back.note);
          }
          for (const l of back.links) {
            const pin = this.#pins[place - 1];
            if (pin !== null && l.id !== pin) continue;
            before.set(l.id, l.label);
            links.set(l.id, [...(links.get(l.id) ?? []), { id, label, qualifier: l.qualifier }]);
          }
        }
        for (const list of links.values()) list.sort(byLink);
        things[place - 1] = before;
        onward[place - 1] = links;
      }
      return { things, onward, exact };
    })();
    this.#backward.catch(() => (this.#backward = undefined));
    return this.#backward;
  }

  /** The links from `id` at `place` to the next place, in the kit's order, or as many as are known. */
  async #onward(place: number, id: string, signal?: AbortSignal): Promise<{ links: readonly Link[]; exact: boolean }> {
    if (place < this.#last) {
      const back = (await this.#back(signal))!;
      return { links: back.onward[place]!.get(id) ?? [], exact: true };
    }
    const step = this.#step(place + 1);
    const all = await this.#reader.all(id, step.edge, step.direction, signal);
    if (!all.exact) this.#note(all.note);
    return all;
  }

  /** How many walks go on from `id` at `place` to the end. */
  #tally(place: number, id: string, signal?: AbortSignal): Promise<Tally> {
    const key = `${place} ${id}`;
    let found = this.#tallies.get(key);
    if (found === undefined) {
      found = (async (): Promise<Tally> => {
        if (place === this.#length) return { n: 1, exact: true };
        if (place === this.#length - 1 && place >= this.#last) {
          const step = this.#step(place + 1);
          const first = await this.#reader.first(id, step.edge, step.direction, signal);
          // The kit counts every link but lists none whose other end's id is too long to give.
          const listable = Math.min(first.total, RESULT_LIMIT);
          if (first.links.length < listable) {
            this.#unlisted.add(`${id}: the kit lists only ${first.links.length} of the first ${listable} of its ${first.total} ${step.edge} ${step.direction} links`);
          }
          return { n: first.total, exact: true };
        }
        const { links, exact } = await this.#onward(place, id, signal);
        let n = 0;
        let all = exact;
        for (const l of links) {
          const t = await this.#tally(place + 1, l.id, signal);
          n += t.n;
          all &&= t.exact;
        }
        return { n, exact: all };
      })();
      this.#tallies.set(key, found);
      found.catch(() => this.#tallies.delete(key));
    }
    return found;
  }

  /**
   * The start's things, a page of `table` at a time when nothing pins the start's side, in id
   * order, then whether they were all listed.
   */
  async *#starts(signal?: AbortSignal): AsyncGenerator<ResultThing, boolean> {
    const back = await this.#back(signal);
    if (back === null) return true;
    if (this.#last >= 0) {
      for (const [id, label] of [...back.things[0]!].sort(([a], [b]) => byBytes(a, b))) yield { id, label };
      return true;
    }
    const type = this.#chain.start;
    const shows = !this.#source.propsOf(type).includes("label");
    let listed = 0;
    for (let page = 1; ; page++) {
      const a = await this.#source.table({ type, columns: ["label"], page });
      await pace(signal);
      if ("error" in a) throw new KitError(a.error.message);
      for (const [id, label] of a.data.rows as [string, string | null][]) {
        listed++;
        yield { id, label: shows ? label : ((await this.#reader.thing(id, signal))?.label ?? null) };
      }
      if (page * RESULT_LIMIT >= a.data.total) {
        if (listed < a.data.total) this.#note(`${type}: table lists ${listed} of its ${a.data.total} things`);
        return listed === a.data.total;
      }
    }
  }

  /**
   * What the kit could not list or count for this chain so far, each naming the thing: a page
   * shorter than the count says, or a count that is not exact, says why here.
   */
  get notes(): readonly string[] {
    return [...this.#problems, ...this.#unlisted, ...this.#notes];
  }

  /**
   * `run` again when it stopped for another caller's abort (a call it shared, which the reader
   * keeps): only this caller's own signal stops it.
   */
  async #own<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (;;) {
      try {
        return await run();
      } catch (e) {
        const abort = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
        if (!abort || signal?.aborted === true) throw e;
      }
    }
  }

  /** How many results the chain has, counted in the background. */
  async count(options: CountOptions = {}): Promise<Count> {
    const { signal, progress } = options;
    signal?.throwIfAborted();
    let reported = 0;
    const report = (n: number) => {
      // A count asked again (after another caller's abort) never reports less than before.
      if (n > reported) progress?.((reported = n));
    };
    return this.#own(() => this.#count(report, signal), signal);
  }

  async #count(progress: (atLeast: number) => void, signal?: AbortSignal): Promise<Count> {
    let total = 0;
    let exact = true;
    const said = () => [...this.#problems, ...this.#unlisted];
    try {
      const back = await this.#back(signal);
      if (back === null) return { total: 0, exact: true, notes: said() };
      exact = back.exact;
      if (this.#length === 0 && this.#last < 0) {
        // No steps and no pin: one result per thing of the type, as `table` counts them.
        const a = await this.#source.table({ type: this.#chain.start, columns: ["label"] });
        if ("error" in a) throw new KitError(a.error.message);
        if (a.data.rows.length < Math.min(a.data.total, RESULT_LIMIT)) {
          this.#unlisted.add(`${this.#chain.start}: table lists only ${a.data.rows.length} of the first ${Math.min(a.data.total, RESULT_LIMIT)} of its ${a.data.total} things`);
        }
        progress(a.data.total);
        return { total: a.data.total, exact: true, notes: said() };
      }
      const starts = this.#starts(signal);
      for (;;) {
        const next = await starts.next();
        if (next.done) {
          exact &&= next.value;
          break;
        }
        const t = await this.#tally(0, next.value.id, signal);
        total += t.n;
        exact &&= t.exact;
        progress(total);
      }
    } catch (e) {
      if (!(e instanceof KitError)) throw e;
      this.#note(`the kit could not answer: ${e.message}`);
      exact = false;
    }
    return { total, exact, notes: exact ? said() : [...said(), ...this.#notes] };
  }

  /** The results from `offset`, at most `limit` of them, in the chain's order. */
  page(offset: number, limit: number, signal?: AbortSignal): Promise<Result[]> {
    return this.#own(async () => {
      if (limit <= 0) return [];
      if (offset === 0 && this.#last === 1 && this.#pins[0] === null) {
        const quick = await this.#nearPin(limit, signal);
        if (quick !== null) return quick;
      }
      const starts = this.#starts(signal);
      try {
        return await this.#walk(starts, null, offset, limit, signal);
      } finally {
        await starts.return(true);
      }
    }, signal);
  }

  /**
   * The first page of a chain whose only pin is its first step's (any thing, linked to one
   * thing): its starts are the things linking to the pin, in id order, and the kit's first 20 of
   * those links hold the first of them, with their links to it. Null when they do not hold the
   * page, which then comes the long way, from every start.
   */
  async #nearPin(limit: number, signal?: AbortSignal): Promise<Result[] | null> {
    if (!(await this.#valid(signal))) return [];
    const step = this.#step(1);
    const pin = this.#pins[1]!;
    const label = (await this.#reader.thing(pin, signal))?.label ?? null;
    const first = await this.#reader.first(pin, step.edge, flip(step.direction), signal);
    const complete = first.links.length === first.total;
    if (!complete && first.links.length < RESULT_LIMIT) return null;
    const groups: { start: ResultThing; links: Link[] }[] = [];
    for (const l of first.links) {
      if (groups.at(-1)?.start.id !== l.id) groups.push({ start: { id: l.id, label: l.label }, links: [] });
      groups.at(-1)!.links.push({ id: pin, label, qualifier: l.qualifier });
    }
    // Past the 20th, the last start may have more links to the pin: those known are its first,
    // so a page they fill is right; a page that needs more comes the long way.
    const onward = new Map(groups.map((g) => [g.start.id, g.links]));
    const starts = (async function* () {
      for (const g of groups) yield g.start;
    })();
    const found = await this.#walk(starts, (id) => onward.get(id) ?? [], 0, limit, signal);
    return found.length >= limit || complete ? found : null;
  }

  /** The results from `offset` of the walks from `starts`; `from` gives the first step's links, when known. */
  async #walk(
    starts: AsyncIterator<ResultThing, unknown>,
    from: ((id: string) => readonly Link[]) | null,
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Result[]> {
    const found: Result[] = [];
    let skip = offset;
    const visit = async (place: number, things: ResultThing[], links: ResultLink[]): Promise<void> => {
      if (place === this.#length) {
        if (skip > 0) skip--;
        else found.push({ things, links });
        return;
      }
      const id = things.at(-1)!.id;
      if (skip > 0) {
        const t = await this.#tally(place, id, signal);
        if (t.n <= skip) {
          skip -= t.n;
          return;
        }
      }
      const next = place === 0 && from !== null ? from(id) : this.#next(place, id, skip + limit - found.length, signal);
      for await (const l of next) {
        await visit(place + 1, [...things, { id: l.id, label: l.label }], [...links, { qualifier: l.qualifier }]);
        // Stop before asking for the next link: past the 20th, that means listing them all.
        if (found.length >= limit) return;
      }
    };
    for (;;) {
      if (found.length >= limit) break;
      const next = await starts.next();
      if (next.done === true) break;
      await visit(0, [next.value], []);
    }
    return found;
  }

  /**
   * The links from `id` at `place`, in the kit's order, as a page goes through them: at the last
   * step, where one link is one result, the first `wanted` of them, from the kit's first 20 when
   * they hold them; at an earlier step, the first 20, then, if the page goes on past them (links
   * can lead nowhere), the rest of them, listed only then.
   */
  async *#next(place: number, id: string, wanted: number, signal?: AbortSignal): AsyncGenerator<Link> {
    const step = this.#step(place + 1);
    // Each link as the page reaches it, with its qualifier read where the kit did not show it.
    const qualified = async function* (this: ChainResults, links: readonly Link[], from: number): AsyncGenerator<Link> {
      for (let i = from; i < links.length; i++) yield await this.#reader.qualify(id, step.edge, step.direction, links, i, signal);
    }.bind(this);
    if (place < this.#last) {
      yield* qualified((await this.#onward(place, id, signal)).links, 0);
      return;
    }
    // Past the last pin no place is pinned, so a thing's links need no sifting.
    const first = await this.#reader.first(id, step.edge, step.direction, signal);
    const last = place === this.#length - 1;
    if (last && first.links.length >= Math.min(wanted, first.total)) {
      yield* first.links;
      return;
    }
    if (!last) yield* first.links;
    if (first.links.length === first.total) return;
    const all = (await this.#onward(place, id, signal)).links;
    const seen = last ? undefined : first.links.at(-1);
    const from = seen === undefined ? 0 : all.findIndex((l) => byLink(l, seen) > 0);
    if (from >= 0) yield* qualified(all, from);
  }

}
