/**
 * Link counts the kit gives one thing at a time, added up over a type (needs G-1, G-2, G-10).
 *
 * The kit names each node type's count, but not how many links each edge type holds, nor which
 * things are most linked. A tally walks one type through
 * bounded calls only: a `table` page of 20 for the ids, then `get` for each thing's link counts
 * per edge type and direction, which count every link exactly, two between one pair included.
 *
 * The walk runs in the background, a
 * page at a time, yielding to the page between pages; it stops when the person leaves (an
 * `AbortSignal`) and resumes where it stopped; each type is walked once per session
 * ({@link Tallies}); ties among the most linked go by id (UTF-8 bytes); and every number is
 * partial, and says so, until the walk is done and read every thing.
 */
import type { ErrorAnswer, GetAnswer, TableAnswer } from "@mosaic/kit";
import { byBytes } from "./bytes.js";

/** What a tally needs from an open mosaic: two of the kit's tools. */
export interface TallySource {
  table(args: unknown): Promise<TableAnswer | ErrorAnswer>;
  get(args: unknown): Promise<GetAnswer | ErrorAnswer>;
}

export interface Linked {
  readonly id: string;
  readonly label: string | null;
  readonly links: number;
}

export interface Tally {
  readonly type: string;
  /** Things of the type, as the kit counts them; null until the first page. */
  readonly total: number | null;
  /** Things counted so far. */
  readonly counted: number;
  /**
   * Things whose links could not all be read: left out of `table`'s rows (an id too long for an
   * answer) or with more edge types and directions than `get` lists. Counts miss their links.
   */
  readonly unread: number;
  /** Links leaving the type's things, per edge type, so far. */
  readonly out: ReadonlyMap<string, number>;
  /** Links reaching the type's things, per edge type, so far. */
  readonly in: ReadonlyMap<string, number>;
  /** The most linked things so far, by all their links, most first, ties by id. */
  readonly top: readonly Linked[];
  /** The most linked things so far by one edge type and direction (key: {@link byKey}). */
  readonly topBy: ReadonlyMap<string, readonly Linked[]>;
  /** True once every page was read; until then every number is partial. */
  readonly done: boolean;
}

/** The key of {@link Tally.topBy} for links of `edge` in `direction`. */
export function byKey(edge: string, direction: "out" | "in"): string {
  return `${direction} ${edge}`;
}

export class TallyError extends Error {
  override readonly name = "TallyError";
}

/** Most linked things a tally keeps, overall and per edge type and direction. */
export const TOP = 5;

/** Rows in a `table` page (section 8.6). */
const PAGE = 20;

/**
 * Things counted between two pauses of a background walk. Measured on Netflix in Chromium, a
 * whole page now and then took about 60 ms; ten things take half that.
 */
const SLICE = 10;

function failed(answer: TableAnswer | GetAnswer | ErrorAnswer): answer is ErrorAnswer {
  return "error" in answer;
}

function better(a: Linked, b: Linked): number {
  return b.links - a.links || byBytes(a.id, b.id);
}

/** `list` with `item` in its place, at most `keep` long. */
function ranked(list: readonly Linked[], item: Linked, keep: number): Linked[] {
  const next = [...list, item].sort(better);
  return next.length > keep ? next.slice(0, keep) : next;
}

/** One type's walk: advanced a page at a time, never two pages at once. */
export class TallyJob {
  readonly #source: TallySource;
  readonly #keep: number;
  #page = 1;
  #busy: Promise<void> = Promise.resolve();
  #tally: Tally;

  constructor(source: TallySource, type: string, keep = TOP) {
    this.#source = source;
    this.#keep = keep;
    this.#tally = { type, total: null, counted: 0, unread: 0, out: new Map(), in: new Map(), top: [], topBy: new Map(), done: false };
  }

  /** The tally so far. */
  get tally(): Tally {
    return this.#tally;
  }

  /**
   * Count the next page of things; nothing once done. Calls made at once run one after another.
   * With `pause`, it is awaited after every few things, so a page never holds the page's input
   * for long; the tally still changes a whole page at a time.
   */
  advance(pause?: () => Promise<void>): Promise<void> {
    const step = this.#busy.then(() => this.#step(pause));
    this.#busy = step.catch(() => {});
    return step;
  }

  async #step(pause?: () => Promise<void>): Promise<void> {
    const before = this.#tally;
    if (before.done) return;
    const { type } = before;
    const page = this.#page;
    const answer = await this.#source.table({ type, columns: ["label"], page });
    if (failed(answer)) throw new TallyError(`${type}: table, page ${page}: ${answer.error.message}`);
    const out = new Map(before.out);
    const into = new Map(before.in);
    const topBy = new Map(before.topBy);
    let top = before.top;
    let counted = before.counted;
    let unread = before.unread;
    for (const [i, row] of answer.data.rows.entries()) {
      if (pause !== undefined && i > 0 && i % SLICE === 0) await pause();
      const id = String(row[0]);
      const got = await this.#source.get({ id });
      if (failed(got)) throw new TallyError(`${type}: get ${id}: ${got.error.message}`);
      let links = 0;
      for (const l of got.data.links) {
        const sums = l.direction === "out" ? out : into;
        sums.set(l.edge, (sums.get(l.edge) ?? 0) + l.count);
        links += l.count;
        const key = byKey(l.edge, l.direction);
        topBy.set(key, ranked(topBy.get(key) ?? [], { id, label: got.data.label, links: l.count }, this.#keep));
      }
      if (got.data.links_total > got.data.links.length) unread++;
      top = ranked(top, { id, label: got.data.label, links }, this.#keep);
      counted++;
    }
    const total = answer.data.total;
    // Rows the kit leaves out (section 8.2: an id over 512 characters) are counted in `total`
    // but never listed, so the last page is the first one short of 20 rows.
    const done = answer.data.rows.length < PAGE;
    if (done) unread += Math.max(0, total - counted);
    this.#tally = { type, total, counted, unread, out, in: into, top, topBy, done };
    this.#page = page + 1;
  }
}

/** The walks of one open mosaic, one per type, kept for the session. */
export class Tallies {
  readonly #source: TallySource;
  readonly #jobs = new Map<string, TallyJob>();

  constructor(source: TallySource) {
    this.#source = source;
  }

  /** The walk of `type`, started once and kept. */
  job(type: string): TallyJob {
    let job = this.#jobs.get(type);
    if (job === undefined) {
      job = new TallyJob(this.#source, type);
      this.#jobs.set(type, job);
    }
    return job;
  }

  /** The tally of `type` so far, without starting its walk; null if never started. */
  peek(type: string): Tally | null {
    return this.#jobs.get(type)?.tally ?? null;
  }

  /**
   * Walk `type` in the background until done or `signal` stops it, calling `onTally` after each
   * page and then `pause`; within a page it awaits `breathe` every few things. Both yield to the
   * page by default (a zero timeout), so input and painting go on while it walks.
   */
  async run(
    type: string,
    {
      signal,
      onTally,
      pause = yieldToPage,
      breathe = yieldToPage,
    }: { signal?: AbortSignal; onTally?: (tally: Tally) => void; pause?: () => Promise<void>; breathe?: () => Promise<void> } = {},
  ): Promise<void> {
    const job = this.job(type);
    while (!job.tally.done && !signal?.aborted) {
      await job.advance(breathe);
      onTally?.(job.tally);
      await pause();
    }
  }
}

/**
 * Let the page handle input and paint before going on: a zero timeout, a new task after the
 * browser's own. (A message channel runs sooner but, measured on Netflix in Chromium, kept the
 * page from its other work for up to 100 ms; a zero timeout kept every wait near 50 ms.)
 */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
