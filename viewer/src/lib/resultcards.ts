/**
 * One result of a chain as a row of cards (V-7, V-8, V-10): each thing of the result
 * with its type's card (the facts its type's card shows, each with its rows), and between
 * each two the link that joins them, with the rows behind it.
 *
 * A link's rows come from `cite` by from, type and to, and its qualifier (section 3.4): one with
 * no qualifier is cited with the empty qualifier, so it names that one link; one whose qualifier
 * the kit does not show (past the 20th of more than 20 links between one pair) is cited by
 * the pair alone, which gives the rows of every link of that type between the two, and the link
 * says so (`pairWide`). So is one whose qualifier the kit cut (section 8.2: other text at 400
 * characters, with the marker) when `cite` knows no link with the qualifier as shown.
 */
import { CUT_MARKER, type SealedFile } from "@mosaic/kit";
import { cardFacts, type Evidence, type Fact } from "./cards.js";
import type { Chain, Direction } from "./chain.js";
import { nodePage, type NodeView } from "./mosaic.js";
import type { Result } from "./results.js";
import type { Shape } from "./view.js";

/** A thing of the result with its card. */
export interface RowThing {
  readonly id: string;
  /** Its node page (`get`, `neighbors`, `cite`), or why it could not be read. */
  readonly page: NodeView | { readonly message: string };
  readonly facts: readonly Fact[];
}

/** The link between two places of the result. */
export interface RowLink {
  readonly edge: string;
  readonly direction: Direction;
  /** The thing the link leaves and the thing it reaches, whatever the step's direction. */
  readonly from: string;
  readonly to: string;
  /** Its qualifier; null for none; undefined when the kit does not show it. */
  readonly qualifier: string | null | undefined;
  /** True when the rows are those of every link of the type between the two. */
  readonly pairWide: boolean;
  readonly evidence: Evidence;
}

/** True when `qualifier` may be one the kit cut: 400 characters and the marker (section 8.2). */
const mayBeCut = (qualifier: string) => [...qualifier].length === 401 && qualifier.endsWith(CUT_MARKER);

export interface ResultRow {
  readonly things: readonly RowThing[];
  readonly links: readonly RowLink[];
}

/** The row of cards for `result`, a result of `chain`. */
export async function resultCards(file: SealedFile, chain: Chain, result: Result, shape: Shape | null): Promise<ResultRow> {
  const things: RowThing[] = [];
  for (const t of result.things) {
    const page = await nodePage(file, t.id);
    things.push({ id: t.id, page, facts: "node" in page ? await cardFacts(file, page, shape) : [] });
  }
  const links: RowLink[] = [];
  for (const [i, s] of chain.steps.entries()) {
    const here = result.things[i]!.id;
    const there = result.things[i + 1]!.id;
    const [from, to] = s.direction === "out" ? [here, there] : [there, here];
    const qualifier = result.links[i]!.qualifier;
    let pairWide = qualifier === undefined;
    let cited = await file.cite(pairWide ? { from, type: s.edge, to } : { from, type: s.edge, to, qualifier: qualifier ?? "" });
    const none = "error" in cited ? cited.error.code === "unknown_edge" : cited.data.total === 0;
    if (!pairWide && typeof qualifier === "string" && mayBeCut(qualifier) && none) {
      // Cut by the kit: no link has the qualifier as shown, so cite the pair.
      pairWide = true;
      cited = await file.cite({ from, type: s.edge, to });
    }
    const evidence: Evidence = "error" in cited ? { rows: [], total: 0, error: cited.error.message } : { rows: cited.data.evidence, total: cited.data.total };
    links.push({ edge: s.edge, direction: s.direction, from, to, qualifier, pairWide, evidence });
  }
  return { things, links };
}
