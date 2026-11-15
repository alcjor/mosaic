/**
 * A link to a chain (need V-17): the Trails address holds the chain, its pins,
 * the view (columns or table), the table's page and the table's sort and filters
 * (lib/route.ts writes and reads them), so a colleague lands on exactly the same results.
 *
 * A link's chain is read as the view file's chains are (V-18): one naming a type, an edge
 * type or a link the mosaic lacks, or pinning a thing it lacks, opens no chain and is reported
 * by its first fault, or by each thing it lacks. A sort or a filter on a column the chain's table
 * does not have (another type's card, another mosaic) is left out and named; the rest applies.
 */
import type { Chain } from "./chain.js";
import type { ChainLinkRoute } from "./route.js";
import type { Column, Sort } from "./resulttable.js";
import type { ChainSettings } from "./view.js";

/** The chain a link names, written as the view file writes a chain. */
export function linkSettings(link: ChainLinkRoute): ChainSettings {
  return { name: "link", start: link.start, pin: link.pin, steps: link.steps.map((s) => ({ link: s.link, pin: s.pin })) };
}

/** What the table shows a link applies: its sort and filters, by column. */
export interface TableChoices {
  readonly sort: Sort | null;
  readonly filters: readonly string[];
}

/** The link to `chain` shown as `show`, at `place` (from 0), with the table's `choices`. */
export function linkOf(chain: Chain, show: ChainLinkRoute["show"], place: number, columns: readonly Column[], choices: TableChoices): ChainLinkRoute {
  const name = (i: number) => ({ place: columns[i]!.place + 1, column: columns[i]!.key });
  const sort = choices.sort === null || columns[choices.sort.column] === undefined ? null : { ...name(choices.sort.column), desc: choices.sort.descending };
  return {
    start: chain.start,
    pin: chain.pin,
    steps: chain.steps.map((s) => ({ link: s.direction === "out" ? s.edge : `${s.edge} in`, pin: s.pin })),
    show,
    at: place + 1,
    sort,
    filters: choices.filters.flatMap((text, i) => (text.trim() === "" || columns[i] === undefined ? [] : [{ ...name(i), text }])),
  };
}

/** The table's choices a link names, on `columns`, and a notice for each it names that they lack. */
export function tableChoices(link: ChainLinkRoute, columns: readonly Column[]): { choices: TableChoices; notices: string[] } {
  const notices: string[] = [];
  const find = (place: number, column: string, what: string): number => {
    const i = columns.findIndex((c) => c.place === place - 1 && c.key === column);
    if (i < 0) notices.push(`link: the table has no column ${column} at place ${place}: its ${what} is not applied`);
    return i;
  };
  let sort: Sort | null = null;
  if (link.sort !== null) {
    const i = find(link.sort.place, link.sort.column, "sort");
    if (i >= 0) sort = { column: i, descending: link.sort.desc };
  }
  const filters = columns.map(() => "");
  for (const f of link.filters) {
    const i = find(f.place, f.column, "filter");
    if (i >= 0) filters[i] = f.text;
  }
  return { choices: { sort, filters }, notices };
}
