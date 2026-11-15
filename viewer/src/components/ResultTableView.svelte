<script lang="ts">
  /**
   * A chain's results as one table (V-11, V-13; brand book §6, TableView): a group of
   * columns per place of the chain, each the place's type's card; the column headers sort (up,
   * down, then the chain's order again); a filter under each header keeps the rows whose cell
   * holds its text; the pager moves through pages of 20 rows; and the rows the sort and filters
   * keep are saved as a CSV file. It says which rows are shown, of how many: the chain's count,
   * or how many rows the filters keep. While every row is read to sort or filter, it says how
   * many are read so far. A thing's name opens it in Explore. When the filters keep
   * nothing, a button clears them.
   */
  import Button from "./ui/Button.svelte";
  import { TABLE_ROWS, type ChainTable } from "../lib/chaintable.svelte.js";
  import { cellString } from "../lib/resulttable.js";
  import type { ChainCount } from "../lib/viewer.svelte.js";

  let {
    table,
    count,
    hrefFor = null,
  }: {
    table: ChainTable;
    count: ChainCount | null;
    hrefFor?: ((id: string) => string) | null;
  } = $props();

  const id = $props.id();
  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let columns = $derived(table.table.columns);
  /** The places, each with how many columns it has, for the group headers. */
  let groups = $derived.by(() => {
    const out: { place: number; group: string; span: number }[] = [];
    for (const c of columns) {
      const last = out.at(-1);
      if (last !== undefined && last.place === c.place) last.span++;
      else out.push({ place: c.place, group: c.group, span: 1 });
    }
    return out;
  });
  /** How many rows there are to page through: the rows kept, or the chain's count. */
  let total = $derived(table.matching ?? count?.total ?? 0);
  let known = $derived(table.matching !== null || (count !== null && count.done && count.exact));
  let none = $derived(table.filtered && table.rows !== null && table.rows.length === 0);
  // The rows shown are from `shownPage`, which is the page asked for once it is read.
  let first = $derived(table.shownPage * TABLE_ROWS);
  let shownTo = $derived(first + (table.rows?.length ?? 0));
  let last = $derived(known && shownTo >= total);
  let said = $derived.by(() => {
    if (table.rows === null) return "Reading the rows…";
    if (table.rows.length === 0) return table.matching !== null ? "No row matches the filters." : "No results.";
    const of = known ? figure(total) : `at least ${figure(Math.max(total, shownTo))}`;
    const which = table.matching !== null && count !== null ? ` that match, of ${figure(count.total)} results` : " results";
    return `Rows ${figure(first + 1)}–${figure(shownTo)} of ${of}${which}`;
  });
  let saving = $state("");

  function sortState(column: number): "ascending" | "descending" | "none" {
    const s = table.sort;
    return s === null || s.column !== column ? "none" : s.descending ? "descending" : "ascending";
  }

  async function save(): Promise<void> {
    saving = "Reading every row…";
    try {
      const text = await table.csv();
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "chain-results.csv";
      a.click();
      URL.revokeObjectURL(url);
      saving = "Saved as chain-results.csv.";
    } catch (e) {
      saving = `The rows could not be saved: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
</script>

<section class="result-table" aria-label="Results as a table">
  <div class="top">
    <p class="which caption" role="status" aria-live="polite">
      {said}{#if table.loaded !== null}. Reading every row to sort and filter: {figure(table.loaded)} read{/if}
    </p>
    <Button onclick={save} aria-describedby="{id}-save-note">Save as CSV</Button>
    <p class="said caption" id="{id}-save-note">Text that starts with = + - @ gets a leading ' so spreadsheets don't run it.</p>
    {#if saving !== ""}<p class="said caption" role="status">{saving}</p>{/if}
    {#if none}<Button onclick={() => table.clearFilters()}>Clear filters</Button>{/if}
  </div>
  {#if table.error !== null}
    <p class="problem caption" role="alert">The rows could not be read: {table.error}</p>
  {/if}
  <div class="scroll">
    <table class="rows body-app">
      <thead>
        <tr>
          <th scope="col" rowspan="3" class="num caption">#</th>
          {#each groups as g (g.place)}
            <th scope="colgroup" colspan={g.span} class="group caption">{g.place + 1} · {g.group}</th>
          {/each}
        </tr>
        <tr>
          {#each columns as c, i (i)}
            <th scope="col" class="head caption" aria-sort={sortState(i)} class:start={c.key === "label"}>
              <button class="sort" type="button" class:sorted={sortState(i) !== "none"} data-column={i} onclick={() => table.sortBy(i)}
                >{c.label}{sortState(i) === "ascending" ? " ↑" : sortState(i) === "descending" ? " ↓" : ""}</button
              >
            </th>
          {/each}
        </tr>
        <tr>
          {#each columns as c, i (i)}
            <td class="filter" class:start={c.key === "label"}>
              <input
                class="control caption"
                id="{id}-filter-{i}"
                type="search"
                aria-label="Filter {c.place + 1} {c.group}: {c.label}"
                placeholder="Filter"
                value={table.filters[i] ?? ""}
                onchange={(e) => table.filter(i, e.currentTarget.value)}
              />
            </td>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows ?? [] as row, i (row.index)}
          {@const place = first + i}
          <tr data-row={row.index}>
            <td class="num mono">
              {figure(place + 1)}
            </td>
            {#each row.cells as cell, i (i)}
              {@const column = columns[i]!}
              <td class:mono={typeof cell === "number" || typeof cell === "boolean"} class:start={column.key === "label"}>
                {#if column.key === "label" && hrefFor !== null}
                  <a href={hrefFor(row.ids[column.place]!)} data-id={row.ids[column.place]}>{cellString(cell)}</a>
                {:else}
                  {cellString(cell)}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <nav class="pager" aria-label="Pages of rows">
    <Button disabled={table.page === 0} onclick={() => table.show(0)}>First</Button>
    <Button disabled={table.page === 0} onclick={() => table.show(table.page - 1)}>Previous</Button>
    <Button disabled={last || (table.rows !== null && table.rows.length < TABLE_ROWS)} onclick={() => table.show(table.page + 1)}>Next</Button>
  </nav>
</section>

<style>
  /* The table takes the height it is given: its rows scroll inside their panel, the pager stays under it. */
  .result-table {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-block-size: 0;
    min-inline-size: 0;
  }

  .top,
  .pager {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .which {
    flex: 1 1 auto;
    margin: 0;
    color: var(--ink);
  }

  .said,
  .problem {
    flex: 1 1 100%;
    margin: 0;
    color: var(--ink-muted);
  }

  .problem {
    color: var(--majolica-text);
  }

  .scroll {
    flex: 0 1 auto;
    min-block-size: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .rows {
    inline-size: 100%;
    border-collapse: collapse;
  }

  .group {
    padding: var(--space-2) var(--space-3) 0;
    color: var(--heading);
    text-align: start;
    white-space: nowrap;
  }

  .head {
    padding: var(--space-1) var(--space-3);
    text-align: start;
    white-space: nowrap;
  }

  .head .sort {
    color: var(--ink-muted);
  }

  .start {
    border-inline-start: 1px solid var(--border);
  }

  .sort {
    padding: 0;
    border: none;
    border-block-end: 2px solid transparent;
    background: none;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }

  .sort.sorted {
    border-block-end-color: var(--accent);
  }

  .filter {
    padding: var(--space-1) var(--space-3);
    border-block-end: 1px solid var(--border);
  }

  .control {
    box-sizing: border-box;
    inline-size: 100%;
    min-inline-size: 6rem;
    block-size: 28px;
    padding-inline: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  td {
    padding: var(--space-2) var(--space-3);
    border-block-end: 1px solid var(--border);
    vertical-align: top;
  }

  tbody tr:last-child td {
    border-block-end: 0;
  }

  tbody tr:hover {
    background: var(--selection);
  }

  td a {
    color: var(--accent);
    text-decoration: none;
  }

  td a:hover {
    text-decoration: underline;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .num {
    color: var(--ink-muted);
    text-align: end;
    white-space: nowrap;
  }

  .sort:focus-visible,
  .control:focus-visible,
  td a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
