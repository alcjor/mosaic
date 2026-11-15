/**
 * What Trails' cards show beside a thing's name, read from the open mosaic as the cards come on
 * screen: a small card's one line (lib/trailcolumns.ts, `cardLine`), and a full card's thing with
 * its facts and their sources (lib/cards.ts). Each thing is read once; one of these belongs to
 * one mosaic and one view, and another is made when either changes.
 */
import type { GetData, SealedFile } from "@mosaic/kit";
import { SvelteMap } from "svelte/reactivity";
import { cardFacts, type Fact } from "./cards.js";
import { nodePage } from "./mosaic.js";
import { cardLine } from "./trailcolumns.js";
import type { Shape } from "./view.js";

/** A full card: the thing, and its facts once their sources are read; or why it could not be read. */
export type FullCard = { readonly node: GetData; readonly facts: readonly Fact[] | null } | { readonly error: string };

export class TrailCards {
  /** Each thing's line, by id, once read ("" when it has no property). */
  readonly lines = new SvelteMap<string, string>();
  /** Each opened thing's full card, by id. */
  readonly full = new SvelteMap<string, FullCard>();
  readonly #asked = new Set<string>();
  readonly #file: SealedFile;
  readonly #shape: Shape | null;

  constructor(file: SealedFile, shape: Shape | null) {
    this.#file = file;
    this.#shape = shape;
  }

  /** Read the lines of `ids`, those not asked for yet. */
  want(ids: readonly string[]): void {
    for (const id of ids) {
      if (this.#asked.has(`line ${id}`)) continue;
      this.#asked.add(`line ${id}`);
      void this.#file.get({ id }).then((got) => this.lines.set(id, "error" in got ? "" : cardLine(got.data, this.#shape)));
    }
  }

  /** Read the full card of `id`, unless it was asked for: first the thing, then its facts. */
  open(id: string): void {
    if (this.#asked.has(`full ${id}`)) return;
    this.#asked.add(`full ${id}`);
    void (async () => {
      try {
        const page = await nodePage(this.#file, id);
        if (!("node" in page)) {
          this.full.set(id, { error: page.message });
          return;
        }
        this.full.set(id, { node: page.node, facts: null });
        this.full.set(id, { node: page.node, facts: await cardFacts(this.#file, page, this.#shape) });
      } catch (e) {
        this.full.set(id, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  }
}
