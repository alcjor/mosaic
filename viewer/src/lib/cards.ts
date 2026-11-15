/**
 * A thing's card (docs/design.md, "Viewer: chains and cards"): the facts its type's
 * card shows, each with the rows behind it.
 *
 * - V-6, V-7: with a card set for the type in the view file (`cards`), the facts it lists,
 *   in its order: properties (or the summary), the things the thing links to by some links, and
 *   how many things it links to by others. A fact the thing does not have is left out. The card
 *   is the type's, so every thing of the type shows the same facts.
 * - V-9: with none set, a default drawn from what the mosaic holds: the summary, the properties
 *   and a count per link, as the node page showed them (in the order and with the selection of
 *   the view file's `page` for the type).
 * - V-8: every fact keeps its source. A property's or the summary's rows are the thing's own
 *   evidence (`cite` by id): the kit gives evidence per thing, not per property. A linked thing's
 *   rows are those of its link (`cite` by from, type and to); a count carries the rows of the
 *   links it counts, for the first {@link SHOWN} of them.
 *
 * Only the kit's tools are asked; at most {@link SHOWN} linked things per fact, one `cite` each.
 */
import type { CiteEvidence, SealedFile } from "@mosaic/kit";
import type { NodeView } from "./mosaic.js";
import { inPageOrder, type Shape } from "./view.js";

/** The rows behind a fact: at most 20, and how many there are; or why `cite` could not say. */
export interface Evidence {
  readonly rows: readonly CiteEvidence[];
  readonly total: number;
  /** `cite`'s error message when it failed: the rows are then unknown, not absent. */
  readonly error?: string;
}

/** A thing a fact links to, with the rows behind that link. */
export interface Linked {
  readonly id: string;
  readonly label: string | null;
  /** The link's qualifier (section 3.4), which tells two links of one type to one thing apart. */
  readonly qualifier: string | null;
  readonly evidence: Evidence;
}

export type Direction = "out" | "in";

export type Fact =
  | { readonly kind: "summary"; readonly value: string; readonly evidence: Evidence | null }
  | { readonly kind: "property"; readonly name: string; readonly value: unknown; readonly evidence: Evidence | null }
  | { readonly kind: "links"; readonly edge: string; readonly direction: Direction; readonly things: readonly Linked[]; readonly total: number }
  | { readonly kind: "count"; readonly edge: string; readonly direction: Direction; readonly count: number; readonly things: readonly Linked[] };

/** The most linked things a card shows, and cites, for one fact. */
export const SHOWN = 5;

const NONE: Evidence = { rows: [], total: 0 };

/**
 * What a citation chip says (brand book §6: "tessera name and row"): the first row's source, by
 * the last part of its id, and its locator, without a `file=` part that repeats that name; then
 * how many more rows there are. The rows themselves, opened from the chip, show both whole.
 */
export function chipLabel(evidence: Evidence): string {
  if (evidence.error !== undefined) return "source unreadable";
  const first = evidence.rows[0];
  if (first === undefined) return "no source";
  const name = first.source.slice(first.source.lastIndexOf("/") + 1);
  const locator = first.locator.split(";").filter((part) => part !== `file=${name}`).join(";");
  const more = evidence.total - 1;
  return `${locator === "" ? name : `${name}:${locator}`}${more > 0 ? ` +${more}` : ""}`;
}

/** The facts the thing of `page` shows on its type's card, each with its rows. */
export async function cardFacts(file: SealedFile, page: NodeView, shape: Shape | null): Promise<Fact[]> {
  const node = page.node;
  const own: Evidence = { rows: page.sources, total: page.sourcesTotal };
  const cited = new Map<string, Promise<Evidence>>();
  const linkEvidence = (edge: string, direction: Direction, other: string, qualifier: string | null): Promise<Evidence> => {
    const [from, to] = direction === "out" ? [node.id, other] : [other, node.id];
    const key = JSON.stringify([from, edge, to, qualifier]);
    let found = cited.get(key);
    if (found === undefined) {
      const subject = qualifier === null ? { from, type: edge, to } : { from, type: edge, to, qualifier };
      found = file.cite(subject).then((a) =>
        "error" in a ? { ...NONE, error: a.error.message } : { rows: a.data.evidence, total: a.data.total },
      );
      cited.set(key, found);
    }
    return found;
  };
  const group = (edge: string, direction: Direction) => page.links.find((l) => l.edge === edge && l.direction === direction);
  const linked = async (edge: string, direction: Direction): Promise<Linked[]> =>
    Promise.all(
      (group(edge, direction)?.edges ?? []).slice(0, SHOWN).map(async (e) => {
        const qualifier = e.qualifier ?? null;
        return { id: e.id, label: e.label, qualifier, evidence: await linkEvidence(edge, direction, e.id, qualifier) };
      }),
    );
  const property = (name: string, value: unknown): Fact => ({ kind: "property", name, value, evidence: own });
  const props = node.props ?? {};
  const facts: Fact[] = [];
  const card = shape?.card(node.type) ?? null;
  if (card === null) {
    if (node.summary !== null) facts.push({ kind: "summary", value: node.summary, evidence: own });
    const shown = shape?.page(node.type) ?? null;
    for (const [name, value] of inPageOrder(Object.entries(props), shown, ([name]) => name)) facts.push(property(name, value));
    for (const link of inPageOrder(page.links, shown, (l) => l.edge)) {
      facts.push({ kind: "count", edge: link.edge, direction: link.direction, count: link.count, things: await linked(link.edge, link.direction) });
    }
    return facts;
  }
  for (const name of card.show) {
    if (name === "summary") {
      if (node.summary !== null) facts.push({ kind: "summary", value: node.summary, evidence: own });
    } else if (Object.hasOwn(props, name)) {
      facts.push(property(name, props[name]));
    }
  }
  for (const { edge, direction } of card.links) {
    facts.push({ kind: "links", edge, direction, things: await linked(edge, direction), total: group(edge, direction)?.count ?? 0 });
  }
  for (const { edge, direction } of card.counts) {
    facts.push({ kind: "count", edge, direction, count: group(edge, direction)?.count ?? 0, things: await linked(edge, direction) });
  }
  return once(facts);
}

/** A fact's name on the card: its kind and property, or its kind, edge type and direction. */
export function factId(f: Fact): string {
  return f.kind === "property" ? `property:${f.name}` : f.kind === "summary" ? "summary" : `${f.kind}:${f.edge} ${f.direction}`;
}

/**
 * Each fact once, at its first place: a link written alone and with its direction (or twice)
 * names one fact, and a card lists a fact once.
 */
function once(facts: readonly Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => !seen.has(factId(f)) && seen.add(factId(f)) !== undefined);
}

/** The default card's properties without their rows, for a card drawn before `cite` has answered. */
export function plainFacts(node: NodeView["node"], shape: Shape | null): Fact[] {
  const facts: Fact[] = [];
  const shown = shape?.page(node.type) ?? null;
  for (const [name, value] of inPageOrder(Object.entries(node.props ?? {}), shown, ([name]) => name)) {
    facts.push({ kind: "property", name, value, evidence: null });
  }
  return facts;
}
