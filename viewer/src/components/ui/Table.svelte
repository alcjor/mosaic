<script lang="ts" generics="T">
  /**
   * Table (brand book, TableView): a sticky header on `surface-tint` and one row per item,
   * whose cells `row` renders. A click on a sortable header sets `sort` and reports it through
   * `onsort`; the caller sorts the rows. The sorted column has a 2px accent underline. A sortable
   * header's button carries its column's key as `data-column`.
   */
  import type { Snippet } from "svelte";
  import { nextSort, type Column, type Sort } from "./table.js";

  let {
    columns,
    rows,
    row,
    label,
    sort = $bindable(null),
    onsort,
  }: {
    columns: Column[];
    rows: T[];
    row: Snippet<[T, number]>;
    label: string;
    sort?: Sort | null;
    onsort?: (sort: Sort) => void;
  } = $props();

  function sortBy(key: string) {
    sort = nextSort(sort, key);
    onsort?.(sort);
  }
</script>

<div class="scroll">
  <table aria-label={label}>
    <thead>
      <tr>
        {#each columns as column (column.key)}
          {@const sorted = sort?.key === column.key ? sort.direction : undefined}
          <th scope="col" class="section-label" class:numeric={column.numeric} class:sorted aria-sort={sorted}>
            {#if column.sortable}
              <button type="button" class="section-label" data-column={column.key} onclick={() => sortBy(column.key)}
                >{column.label}<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path d={sorted === "descending" ? "M4 6l4 4 4-4" : sorted ? "M4 10l4-4 4 4" : "M5 6l3-3 3 3M5 10l3 3 3-3"} />
                </svg>
              </button>
            {:else}
              {column.label}
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as item, i (i)}
        <tr>{@render row(item, i)}</tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroll {
    max-block-size: 100%;
    overflow: auto;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
    color: var(--ink);
  }

  th {
    position: sticky;
    inset-block-start: 0;
    padding: var(--space-2) var(--space-3);
    border-block-end: 1px solid var(--border);
    background: var(--surface-tint);
    color: var(--ink-muted);
    text-align: start;
    white-space: nowrap;
  }

  th.numeric {
    text-align: end;
  }

  th.sorted {
    box-shadow: inset 0 -2px 0 var(--accent);
    color: var(--accent);
  }

  th button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font-family: var(--font-sans);
    cursor: pointer;
  }

  th button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  th path {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  tbody tr:hover {
    background: var(--surface-tint);
  }

  tbody :global(td) {
    padding: var(--space-2) var(--space-3);
    border-block-end: 1px solid var(--border);
  }
</style>
