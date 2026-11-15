/**
 * Where the things of the graph come from (needs G-6, V-7). Selecting a thing shows its type's
 * card, built as its page builds it (lib/cards.ts on the kit's `get`, `neighbors` and `cite`),
 * so a type's card looks the same everywhere; the thing's own rows are where it comes from, and
 * the card's link chips open the rows behind its links.
 *
 * Each thing's card is read once per mosaic and view file, and kept: what is read is given at
 * once the next time, so a selection made again shows without waiting (G-10). A read the kit
 * could not give is shown but not kept: asking again tries again.
 */
import type { SealedFile } from "@mosaic/kit";
import { cardFacts, type Fact } from "../cards.js";
import { nodePage, type NodeView } from "../mosaic.js";
import type { Shape } from "../view.js";

/** One line drawn: every link of `edge` from `from` to `to`. */
export interface LinkRef {
  readonly from: string;
  readonly edge: string;
  readonly to: string;
}

/** A thing's card as its page shows it, or why the kit could not give it. */
export type ThingCard = { readonly page: NodeView; readonly facts: readonly Fact[] } | { readonly message: string };

/** A link's key: its ends and edge type, as JSON. */
export function linkKey(link: LinkRef): string {
  return JSON.stringify([link.from, link.edge, link.to]);
}

/** The cards read for one mosaic and view file. */
export class Sources {
  readonly #file: SealedFile;
  readonly #shape: Shape;
  readonly #cards = new Map<string, Promise<ThingCard>>();
  readonly #cardsRead = new Map<string, ThingCard>();

  constructor(file: SealedFile, shape: Shape) {
    this.#file = file;
    this.#shape = shape;
  }

  /** Whether these were read for `file` with `shape`. */
  isFor(file: SealedFile, shape: Shape): boolean {
    return this.#file === file && this.#shape === shape;
  }

  /** Thing `id`'s card, read once. */
  card(id: string): Promise<ThingCard> {
    let found = this.#cards.get(id);
    if (found === undefined) {
      this.#cardsRead.delete(id);
      found = (async (): Promise<ThingCard> => {
        const page = await nodePage(this.#file, id);
        if ("message" in page) return { message: page.message };
        return { page, facts: await cardFacts(this.#file, page, this.#shape) };
      })().catch((e: unknown) => ({ message: e instanceof Error ? e.message : String(e) }));
      found.then((c) => {
        this.#cardsRead.set(id, c);
        if ("message" in c) this.#cards.delete(id);
      });
      this.#cards.set(id, found);
    }
    return found;
  }

  /** Thing `id`'s card if it has been read, else null. */
  cardNow(id: string): ThingCard | null {
    return this.#cardsRead.get(id) ?? null;
  }
}
