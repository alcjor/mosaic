/**
 * A chain's results as one table (docs/design.md V-11, V-13): one row per result, in
 * the chain's order, and one group of columns per place, from that type's card:
 * the thing's name, then the facts its card shows, as plain values. With a card set in the view
 * file, its properties (or the summary), the things it links to by some links (by name) and how
 * many it links to by others; with none, the default card's declared properties and a count per
 * link. The cells carry no rows: the cards and node pages show where each fact comes from.
 *
 * Rows are read a page at a time, from the chain's results; sorting, filtering and saving need
 * every row, which {@link ResultTable.all} reads, reporting how many so far. Each thing is read
 * once (`get`, and `neighbors` for a column of linked things), however many results it is in.
 * Sorting compares numbers as numbers and text by its UTF-8 bytes, with empty cells last and
 * ties in the chain's order; a filter keeps the rows whose cell holds its text, in any case
 * (ASCII and Unicode simple case folding by `toLowerCase`, which no locale changes).
 *
 * The table is saved as CSV (RFC 4180, UTF-8, no byte order mark): a spreadsheet, a database or
 * a script reads it as it is, and every cell is one plain value, as the kit gives it, but for one
 * thing (after ADR-006): a text value that
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return is written after a `'`, so a
 * spreadsheet that opens the file never runs a mosaic's text as a formula. A number or a boolean
 * is written as it is.
 * Sorting orders numbers, then booleans, then text, so a column that mixes them still sorts the
 * same every time.
 */
import type { SealedFile } from "@mosaic/kit";
import type { Chain } from "./chain.js";
import { byBytes } from "./graph/bytes.js";
import { KitError, pace } from "./links.js";
import type { ChainResults, Result } from "./results.js";
import { inPageOrder, type Schema, type Shape } from "./view.js";

/** A column: a fact of the type at one place of the chain, or the thing's name (`label`). */
export interface Column {
  /** The place, from 0: the start, then one per step. */
  readonly place: number;
  readonly type: string;
  /** The place's type as the page names it. */
  readonly group: string;
  /** `label`, `summary`, `property:<name>`, `links:<edge> <direction>` or `count:<edge> <direction>`. */
  readonly key: string;
  /** The column's name under its group. */
  readonly label: string;
}

export type Cell = string | number | boolean | null;

export interface TableRow {
  /** The result's place in the chain's order, from 0. */
  readonly index: number;
  /** The things of the result, one per place. */
  readonly ids: readonly string[];
  /** One per column. */
  readonly cells: readonly Cell[];
}

export interface Sort {
  readonly column: number;
  readonly descending: boolean;
}

export interface Filter {
  readonly column: number;
  readonly text: string;
}

/** How many linked things a cell names; past them it says how many more there are. */
export const NAMED = 5;
/** Rows read at a time when every row is read. */
const CHUNK = 1000;

type Way = "out" | "in";

/** The columns of `chain`'s table: per place, the thing's name, then its type's card's facts. */
export function tableColumns(chain: Chain, schema: Schema, shape: Shape | null): Column[] {
  const types = [chain.start, ...chain.steps.map((s) => s.type)];
  return types.flatMap((type, place) => typeColumns(type, schema, shape).map((c) => ({ place, type, group: shape?.typeLabel(type) ?? type, ...c })));
}

function typeColumns(type: string, schema: Schema, shape: Shape | null): { key: string; label: string }[] {
  const edgeName = (edge: string) => shape?.edgeLabel(type, edge) ?? edge;
  const linked = (edge: string, way: Way) => (way === "out" ? `${edgeName(edge)} →` : `← ${edgeName(edge)}`);
  const property = (name: string) => ({ key: `property:${name}`, label: shape?.label(type, name) ?? name });
  const columns = [{ key: "label", label: "name" }];
  const card = shape?.card(type) ?? null;
  if (card !== null) {
    for (const name of card.show) columns.push(name === "summary" ? { key: "summary", label: "summary" } : property(name));
    for (const l of card.links) columns.push({ key: `links:${l.edge} ${l.direction}`, label: linked(l.edge, l.direction) });
    for (const l of card.counts) columns.push({ key: `count:${l.edge} ${l.direction}`, label: `${linked(l.edge, l.direction)} (count)` });
  } else {
    const shown = shape?.page(type) ?? null;
    for (const name of inPageOrder(schema.propsOf(type), shown, (n) => n)) columns.push(property(name));
    const ways: { edge: string; way: Way }[] = [];
    for (const e of schema.edgeTypes) {
      if (e.from === null || e.from === type) ways.push({ edge: e.name, way: "out" });
      if (e.to === null || e.to === type) ways.push({ edge: e.name, way: "in" });
    }
    for (const { edge, way } of inPageOrder(ways, shown, (w) => w.edge)) columns.push({ key: `count:${edge} ${way}`, label: `${linked(edge, way)} (count)` });
  }
  const seen = new Set<string>();
  return columns.filter((c) => !seen.has(c.key) && seen.add(c.key) !== undefined);
}

/** The rows of one chain's results on one open mosaic. */
export class ResultTable {
  readonly columns: readonly Column[];
  readonly #file: SealedFile;
  readonly #results: ChainResults;
  /** Each thing's cells, by id, read once. */
  readonly #things = new Map<string, Promise<ReadonlyMap<string, Cell>>>();

  constructor(file: SealedFile, chain: Chain, results: ChainResults, shape: Shape | null) {
    this.#file = file;
    this.#results = results;
    this.columns = tableColumns(chain, file, shape);
  }

  /** Rows `offset` to `offset + limit`, in the chain's order. */
  async rows(offset: number, limit: number, signal?: AbortSignal): Promise<TableRow[]> {
    const results = await this.#results.page(offset, limit, signal);
    const rows: TableRow[] = [];
    for (const [i, result] of results.entries()) rows.push(await this.#row(offset + i, result, signal));
    return rows;
  }

  /** Every row, in the chain's order; `progress` hears how many are read so far. */
  async all(options: { signal?: AbortSignal; progress?: (read: number) => void } = {}): Promise<TableRow[]> {
    const { signal, progress } = options;
    signal?.throwIfAborted();
    const rows: TableRow[] = [];
    for (;;) {
      const chunk = await this.rows(rows.length, CHUNK, signal);
      rows.push(...chunk);
      progress?.(rows.length);
      if (chunk.length < CHUNK) return rows;
      await pace(signal);
    }
  }

  async #row(index: number, result: Result, signal?: AbortSignal): Promise<TableRow> {
    const cells: Cell[] = [];
    for (const column of this.columns) {
      const thing = result.things[column.place]!;
      if (column.key === "label") {
        cells.push(thing.label ?? thing.id);
        continue;
      }
      const values = await this.#thing(thing.id, signal);
      cells.push(values.get(column.key) ?? null);
    }
    return { index, ids: result.things.map((t) => t.id), cells };
  }

  #thing(id: string, signal?: AbortSignal): Promise<ReadonlyMap<string, Cell>> {
    let found = this.#things.get(id);
    if (found === undefined) {
      found = this.#read(id, signal);
      // A read stopped or failed is read again next time.
      found.catch(() => this.#things.delete(id));
      this.#things.set(id, found);
    }
    return found;
  }

  /**
   * A thing's cells: its summary and properties (`get`), how many things it links to by each
   * link (`get` lists at most 20 kinds of link, so one past them is counted with `neighbors`),
   * and, for a column of linked things, their names (`neighbors`). A kit call that fails fails
   * the read, naming the thing: a cell is never left blank for a value that could not be read.
   */
  async #read(id: string, signal?: AbortSignal): Promise<ReadonlyMap<string, Cell>> {
    signal?.throwIfAborted();
    const cells = new Map<string, Cell>();
    const got = await this.#file.get({ id });
    if ("error" in got) throw new KitError(`${id}: ${got.error.message}`);
    const node = got.data;
    if (node.summary !== null) cells.set("summary", node.summary);
    for (const [name, value] of Object.entries(node.props ?? {})) cells.set(`property:${name}`, plain(value));
    const listed = new Map(node.links.map((l) => [`${l.edge} ${l.direction}`, l.count]));
    const complete = node.links.length >= node.links_total;
    const neighbors = async (link: string) => {
      signal?.throwIfAborted();
      const [edge, direction] = link.split(" ") as [string, "out" | "in"];
      const answer = await this.#file.neighbors({ id, edge, direction });
      if ("error" in answer) throw new KitError(`${id}: ${answer.error.message}`);
      return answer.data;
    };
    for (const column of this.columns) {
      if (column.type !== node.type || cells.has(column.key)) continue;
      const [kind, link] = [column.key.slice(0, column.key.indexOf(":")), column.key.slice(column.key.indexOf(":") + 1)];
      if (kind === "count") {
        cells.set(column.key, listed.get(link) ?? (complete ? 0 : (await neighbors(link)).total));
      } else if (kind === "links") {
        if (complete && !listed.has(link)) {
          cells.set(column.key, "");
          continue;
        }
        const found = await neighbors(link);
        const names = found.edges.slice(0, NAMED).map((e) => e.label ?? e.id);
        const more = found.total - names.length;
        cells.set(column.key, `${names.join("; ")}${more > 0 ? `; +${more} more` : ""}`);
      }
    }
    return cells;
  }
}

/** A property's value as one cell: text, a number and a boolean as they are, anything else as JSON. */
function plain(value: unknown): Cell {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/** A cell as text, as it shows and is filtered. */
export function cellString(cell: Cell): string {
  return cell === null ? "" : String(cell);
}

/** Numbers first, then booleans, then text, so a column mixing them sorts the same every time. */
const KIND: Readonly<Record<string, number>> = { number: 0, boolean: 1, string: 2 };

function compareCells(a: Cell, b: Cell): number {
  const kinds = (KIND[typeof a] ?? 2) - (KIND[typeof b] ?? 2);
  if (kinds !== 0) return kinds;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return byBytes(cellString(a), cellString(b));
}

/**
 * `rows` in the order `sort` says (numbers, then booleans, then text), empty cells last and ties
 * in the chain's order; null keeps the chain's.
 */
export function sortRows(rows: readonly TableRow[], sort: Sort | null): TableRow[] {
  const sorted = [...rows];
  sorted.sort((x, y) => {
    if (sort !== null) {
      const a = x.cells[sort.column] ?? null;
      const b = y.cells[sort.column] ?? null;
      const emptyA = a === null || a === "";
      const emptyB = b === null || b === "";
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      if (!emptyA) {
        const order = compareCells(a, b);
        if (order !== 0) return sort.descending ? -order : order;
      }
    }
    return x.index - y.index;
  });
  return sorted;
}

/** The rows of `rows` whose cell holds each filter's text, in any case; a blank filter keeps all. */
export function filterRows(rows: readonly TableRow[], filters: readonly Filter[]): TableRow[] {
  const active = filters.map((f) => ({ column: f.column, text: f.text.trim().toLowerCase() })).filter((f) => f.text !== "");
  return rows.filter((r) => active.every((f) => cellString(r.cells[f.column] ?? null).toLowerCase().includes(f.text)));
}

/** The table as CSV (RFC 4180): a header line naming each column, then one line per row. */
export function tableCsv(columns: readonly Column[], rows: readonly TableRow[]): string {
  const header = columns.map((c) => field(c.key === "label" ? `${c.place + 1} ${c.group}` : `${c.place + 1} ${c.group}: ${c.label}`));
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.cells.map((cell) => field(typeof cell === "string" && FORMULA.test(cell) ? `'${cell}` : cellString(cell))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * A text value a spreadsheet would read as a formula: its first character is `=`, `+`, `-`, `@`,
 * a tab or a carriage return. It is written after a `'` (ADR-006: a mosaic is
 * untrusted input, and the saved table must not make its text run).
 */
const FORMULA = /^[=+\-@\t\r]/;

function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
