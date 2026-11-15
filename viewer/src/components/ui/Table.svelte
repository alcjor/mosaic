<script lang="ts" generics="T">
  /**
   * Table (brand book, TableView): a sticky header on the page ground and one row per item,
   * whose cells `row` renders. A click on a sortable header sets `sort` and reports it through
   * `onsort`; the caller sorts the rows. The sorted column has a 2px accent underline. A sortable
   * header's button carries its column's key as `data-column`. With `onrow`, a row can be picked
   * and `selected` says which one is.
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
    selected,
    onrow,
  }: {
    columns: Column[];
    rows: T[];
    row: Snippet<[T, number]>;
    label: string;
    sort?: Sort | null;
    onsort?: (sort: Sort) => void;
    /** Which row is the selected one, if rows can be selected. */
    selected?: ((item: T, index: number) => boolean) | undefined;
    /** A row was picked: a click on it outside its links and buttons, or Enter on it. */
    onrow?: ((item: T, index: number) => void) | undefined;
  } = $props();

  function pick(event: Event, item: T, index: number) {
    if (event instanceof KeyboardEvent ? event.key !== "Enter" || event.target !== event.currentTarget : (event.target as Element).closest("a, button") !== null) return;
    onrow?.(item, index);
  }

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
          <th scope="col" class="control-app" class:numeric={column.numeric} class:sortable={column.sortable} class:sorted aria-sort={sorted}>
            {#if column.sortable}
              <button type="button" class="control-app" data-column={column.key} onclick={() => sortBy(column.key)}
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
        {#if onrow}
          <tr class:selected={selected?.(item, i)} aria-selected={selected?.(item, i) ?? false} tabindex="0" onclick={(e) => pick(e, item, i)} onkeydown={(e) => pick(e, item, i)}
            >{@render row(item, i)}</tr
          >
        {:else}
          <tr>{@render row(item, i)}</tr>
        {/if}
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

  /* The header sits on the page ground; a sortable header is a button over the whole cell, and
     the sorted one carries the accent underline. */
  th {
    position: sticky;
    inset-block-start: 0;
    z-index: 1;
    padding: var(--space-2) var(--space-3);
    box-shadow: inset 0 -1px 0 var(--border);
    background: var(--page);
    color: var(--heading);
    text-align: start;
    white-space: nowrap;
  }

  th.sortable {
    padding: 0;
  }

  th.numeric {
    text-align: end;
  }

  th.sorted {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  th button {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    inline-size: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  th button:hover {
    background: var(--selection);
  }

  th button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  th svg {
    color: var(--ink-muted);
  }

  th:not(.sorted) svg {
    opacity: 0;
  }

  th button:hover svg,
  th button:focus-visible svg {
    opacity: 1;
  }

  th path {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  tbody tr:hover {
    background: var(--page);
  }

  tbody tr.selected {
    background: var(--selection);
  }

  tbody tr:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  tbody :global(td) {
    padding: var(--space-2) var(--space-3);
    border-block-end: 1px solid var(--border);
  }
</style>
