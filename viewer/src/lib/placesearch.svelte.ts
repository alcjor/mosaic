/**
 * What the *Chain* view's places found when a person searched for a thing to pin them to
 * (V-2, V-3). Kept by the place as it is (its position, link and type: `slot`), so a place
 * that changes is another place; only the latest search of a place shows its answer, so an older
 * one that answers later, or one that answers after the place was cleared, is dropped. The Viewer
 * holds one for the open mosaic and forgets it all when another opens.
 */

import type { SealedFile } from "@mosaic/kit";
import type { Chain } from "./chain.js";

/** A thing a search found. */
export interface Found {
  readonly id: string;
  readonly label: string | null;
}

/** What a place's search gave: the things found (maybe none), or why the kit could not say. */
export type Answer = readonly Found[] | { readonly error: string };

export class PlaceSearches {
  /** Each place's answer, by slot. */
  found = $state<Record<string, Answer>>({});
  /** Each place's query, as typed, by slot. */
  queries = $state<Record<string, string>>({});
  #asked = 0;
  readonly #latest = new Map<string, number>();

  /** Search for `slot` with `ask`; its answer shows unless another search or a clear came since. */
  async run(slot: string, ask: () => Promise<Answer>): Promise<void> {
    const mine = ++this.#asked;
    this.#latest.set(slot, mine);
    const answer = await ask();
    if (this.#latest.get(slot) !== mine) return;
    this.found = { ...this.found, [slot]: answer };
  }

  /** Forget what `slot` found and was asked, and any answer still on its way. */
  clear(slot: string): void {
    this.#latest.set(slot, ++this.#asked);
    const { [slot]: _gone, ...rest } = this.found;
    this.found = rest;
    const { [slot]: _asked, ...queries } = this.queries;
    this.queries = queries;
  }

  /** Forget every place, its query, and every answer still on its way. */
  reset(): void {
    this.#latest.clear();
    this.#asked++;
    this.found = {};
    this.queries = {};
  }
}

/** The place `place` (-1 for the start) of `chain` as it is now: its position, link and type. */
export function slotOf(chain: Chain, place: number): string {
  if (place === -1) return `start ${chain.start}`;
  const s = chain.steps[place]!;
  return `${place} ${s.edge} ${s.direction} ${s.type}`;
}

/** The places from step `index` on: removing that step makes each of them another place. */
export function slotsFrom(chain: Chain, index: number): string[] {
  return chain.steps.slice(index).map((_, k) => slotOf(chain, index + k));
}

/**
 * Things of `type` named like `query` (the kit's `find`, at most 10), or why the kit could not
 * search: a search it could not answer is not the same as nothing found.
 */
export async function findThings(file: Pick<SealedFile, "find">, type: string, query: string): Promise<Answer> {
  const found = await file.find({ query, type, limit: 10 });
  if ("error" in found) return { error: found.error.message };
  return found.data.results.map((r) => ({ id: r.id, label: r.label }));
}
