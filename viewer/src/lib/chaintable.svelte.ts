/**
 * The *Chain* view's table of results (V-11, V-13), as the page shows it: one page of
 * rows at a time, a sort, a filter per column, and the rows to save. Without a sort or a filter,
 * a page is read from the chain's results as it is shown; with one, every row is read first
 * (`loaded` says how many so far), then sorted and filtered in the page. The latest change wins:
 * an older read that answers later is dropped.
 */
import { filterRows, sortRows, tableCsv, type Filter, type ResultTable, type Sort, type TableRow } from "./resulttable.js";

/** Rows per page of the table. */
export const TABLE_ROWS = 20;

export class ChainTable {
  readonly table: ResultTable;
  /** The page shown, from 0. */
  page = $state(0);
  /** The rows of the page shown, or null while they are read. */
  rows = $state.raw<readonly TableRow[] | null>(null);
  /**
   * The page `rows` are from, from 0: while another page is read, the table still says
   * and numbers the rows it shows, not the page asked for.
   */
  shownPage = $state(0);
  sort = $state.raw<Sort | null>(null);
  /** Each column's filter text, by column; empty keeps every row. */
  filters = $state.raw<readonly string[]>([]);
  /** How many rows are read, while every row is read; null when it is not. */
  loaded = $state<number | null>(null);
  /** How many rows the sort and filters keep, once every row is read; null without them. */
  matching = $state<number | null>(null);
  /** Why the rows could not be read. */
  error = $state<string | null>(null);
  /** Settles when the page asked for last is shown; for tests and the page. */
  shown: Promise<void> = Promise.resolve();

  #all: Promise<TableRow[]> | null = null;
  #asked = 0;
  /** Stops every read of this table once it is replaced (V-14: a new chain answers at once). */
  readonly #stop = new AbortController();

  constructor(table: ResultTable) {
    this.table = table;
    this.filters = table.columns.map(() => "");
  }

  /** Stop every read of this table: it is replaced, or its chain is gone. */
  dispose(): void {
    this.#stop.abort();
  }

  /** True when a sort or a filter is set, so every row is needed. */
  get arranged(): boolean {
    return this.sort !== null || this.#active().length > 0;
  }

  /** True when a filter is set: the rows shown are those that match, of every result. */
  get filtered(): boolean {
    return this.#active().length > 0;
  }

  #active(): Filter[] {
    return this.filters.flatMap((text, column) => (text.trim() === "" ? [] : [{ column, text }]));
  }

  /** Show page `page` (from 0) of the rows as sorted and filtered now. */
  show(page: number): Promise<void> {
    const mine = ++this.#asked;
    this.page = Math.max(0, Math.trunc(page));
    this.shown = this.#show(mine);
    return this.shown;
  }

  /** Set the sort and filters a link names, before any row is shown. */
  restore(choices: { readonly sort: Sort | null; readonly filters: readonly string[] }): void {
    this.sort = choices.sort;
    this.filters = this.table.columns.map((_, i) => choices.filters[i] ?? "");
  }

  async #show(mine: number): Promise<void> {
    try {
      this.error = null;
      if (!this.arranged) {
        this.matching = null;
        const rows = await this.table.rows(this.page * TABLE_ROWS, TABLE_ROWS, this.#stop.signal);
        if (mine === this.#asked) {
          this.rows = rows;
          this.shownPage = this.page;
        }
        return;
      }
      const rows = await this.arrangedRows();
      if (mine !== this.#asked) return;
      this.matching = rows.length;
      const last = Math.max(0, Math.ceil(rows.length / TABLE_ROWS) - 1);
      if (this.page > last) this.page = last;
      this.rows = rows.slice(this.page * TABLE_ROWS, (this.page + 1) * TABLE_ROWS);
      this.shownPage = this.page;
    } catch (e) {
      if (mine === this.#asked && !this.#stop.signal.aborted) this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Every row, sorted and filtered as set now. */
  async arrangedRows(): Promise<TableRow[]> {
    const all = await this.#every();
    return sortRows(filterRows(all, this.#active()), this.sort);
  }

  #every(): Promise<TableRow[]> {
    if (this.#stop.signal.aborted) return Promise.reject(new DOMException("This table was replaced.", "AbortError"));
    if (this.#all === null) {
      this.loaded = 0;
      this.#all = this.table.all({ signal: this.#stop.signal, progress: (n) => (this.loaded = n) }).then(
        (rows) => {
          this.loaded = null;
          return rows;
        },
        (e: unknown) => {
          this.#all = null;
          this.loaded = null;
          throw e;
        },
      );
    }
    return this.#all;
  }

  /** Sort by `column`: up, then down, then the chain's order again; back to the first page. */
  sortBy(column: number): Promise<void> {
    const now = this.sort;
    this.sort = now === null || now.column !== column ? { column, descending: false } : now.descending ? null : { column, descending: true };
    return this.show(0);
  }

  /** Keep the rows whose `column` holds `text`; back to the first page. */
  filter(column: number, text: string): Promise<void> {
    this.filters = this.filters.map((t, i) => (i === column ? text : t));
    return this.show(0);
  }

  /** Clear every filter, keeping the sort; back to the first page. */
  clearFilters(): Promise<void> {
    this.filters = this.filters.map(() => "");
    return this.show(0);
  }

  /** The table as CSV: every row the sort and filters keep, in their order. */
  async csv(): Promise<string> {
    return tableCsv(this.table.columns, await this.arrangedRows());
  }
}
