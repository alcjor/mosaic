/**
 * The walks behind the map (needs G-1, G-2, G-10): in the background, never holding up input or the first picture; stopped
 * when the person leaves the view and resumed where they stopped; kept for the session.
 *
 * {@link talliesFor} keeps one set of walks per open mosaic. A {@link Walker} walks the types it
 * is asked for, one after another, a page at a time; a type the person selects goes first, and
 * the walk it interrupts goes on after it.
 */
import type { SealedFile } from "@mosaic/kit";
import type { Shape } from "../view.js";
import { HoodLoader } from "./hood.js";
import { Sources } from "./sources.js";
import { Tallies, yieldToPage, type Tally } from "./tally.js";

const kept = new WeakMap<SealedFile, Tallies>();

/** The walks of `file`, for as long as the page has it open. */
export function talliesFor(file: SealedFile): Tallies {
  let tallies = kept.get(file);
  if (tallies === undefined) {
    tallies = new Tallies(file);
    kept.set(file, tallies);
  }
  return tallies;
}

const loaders = new WeakMap<SealedFile, HoodLoader>();

/** The neighbourhoods of `file` loaded so far, kept for as long as the page has it open (G-10). */
export function hoodLoaderFor(file: SealedFile): HoodLoader {
  let loader = loaders.get(file);
  if (loader === undefined) {
    loader = new HoodLoader(file);
    loaders.set(file, loader);
  }
  return loader;
}

const sources = new WeakMap<SealedFile, Sources>();

/** The cards and link rows of `file` read so far, with `shape`, kept for the session (G-6, G-10). */
export function sourcesFor(file: SealedFile, shape: Shape): Sources {
  let found = sources.get(file);
  if (found === undefined || !found.isFor(file, shape)) {
    found = new Sources(file, shape);
    sources.set(file, found);
  }
  return found;
}

/** Walks types in the background, in the order asked, a selected type first. */
export class Walker {
  readonly #tallies: Tallies;
  readonly #onTally: (tally: Tally) => void;
  readonly #onError: (type: string, error: unknown) => void;
  readonly #pause: () => Promise<void>;
  readonly #queue: string[] = [];
  #current: { type: string; abort: AbortController } | null = null;
  #stopped = false;
  #loop: Promise<void> = Promise.resolve();
  #running = false;

  constructor(
    tallies: Tallies,
    onTally: (tally: Tally) => void,
    pause: () => Promise<void> = yieldToPage,
    onError: (type: string, error: unknown) => void = () => {},
  ) {
    this.#tallies = tallies;
    this.#onTally = onTally;
    this.#pause = pause;
    this.#onError = onError;
  }

  /** Walk `types` after those already asked for; with `first`, before them, now. */
  want(types: readonly string[], first = false): void {
    if (this.#stopped) return;
    for (const type of first ? [...types].reverse() : types) {
      const at = this.#queue.indexOf(type);
      if (first) {
        if (at >= 0) this.#queue.splice(at, 1);
        this.#queue.unshift(type);
      } else if (at < 0) {
        this.#queue.push(type);
      }
    }
    // The walk under way stops after its page and goes on later, from where it stopped.
    if (first && this.#current !== null && this.#current.type !== this.#queue[0]) this.#current.abort.abort();
    if (!this.#running) {
      this.#running = true;
      this.#loop = this.#run();
    }
  }

  async #run(): Promise<void> {
    while (!this.#stopped && this.#queue.length > 0) {
      const type = this.#queue[0]!;
      if (!this.#tallies.job(type).tally.done) {
        const abort = new AbortController();
        this.#current = { type, abort };
        try {
          await this.#tallies.run(type, { signal: abort.signal, onTally: this.#onTally, pause: this.#pause, breathe: this.#pause });
        } catch (e) {
          this.#onError(type, e);
          this.#queue.splice(this.#queue.indexOf(type), 1);
          continue;
        } finally {
          this.#current = null;
        }
      }
      if (this.#tallies.job(type).tally.done) {
        const at = this.#queue.indexOf(type);
        if (at >= 0) this.#queue.splice(at, 1);
      }
    }
    this.#running = false;
  }

  /** Settles when nothing is left to walk, or the walker stopped. */
  idle(): Promise<void> {
    return this.#loop;
  }

  /** Stop for good, after the page under way: the person left the view. */
  stop(): void {
    this.#stopped = true;
    this.#current?.abort.abort();
  }
}
