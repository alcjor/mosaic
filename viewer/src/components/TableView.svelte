<script lang="ts">
  /**
   * TableView (brand book, section 6): one page of `table` for a node type. The column headers
   * sort, the filter form adds a `where` condition, and the pager moves through pages; each is a
   * new `table` call through the page's address. A row's id opens its node page. With a view
   * file, the type and its columns carry the file's labels.
   */
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Table from "./ui/Table.svelte";
  import type { Column, Sort } from "./ui/table.js";
  import type { ToolFailure } from "../lib/mosaic.js";
  import { OPERATORS, type Condition, type TableRoute } from "../lib/route.js";
  import { cellText, filterValue, type TableView } from "../lib/tables.js";
  import type { Shape } from "../lib/view.js";

  let {
    view,
    route,
    hrefFor,
    nodeHref,
    onfilter,
    onroute = (to: TableRoute) => {
      location.hash = hrefFor(to);
    },
    shape = null,
  }: {
    view: TableView | ToolFailure | null;
    route: TableRoute;
    hrefFor: (route: TableRoute) => string;
    nodeHref: (id: string) => string;
    onfilter: (condition: Condition) => void;
    /** Go to another route of this table (a sort); by default, through the page's address. */
    onroute?: (route: TableRoute) => void;
    shape?: Shape | null;
  } = $props();

  const named = (column: string): string => shape?.label(route.type, column) ?? column;

  let column = $state("");
  let op = $state<Condition["op"]>("=");
  let kind = $state<"text" | "number" | "boolean">("text");
  let text = $state("");
  let problem = $state<string | null>(null);

  let names = $derived(view && "columns" in view ? view.columns.slice(1) : []);
  /** The table's columns: the id, which sorts back to the default order, then the type's. */
  let columns = $derived<Column[]>([
    { key: "", label: "id", sortable: route.order !== null },
    ...names.map((name) => ({ key: name, label: named(name), sortable: true })),
  ]);
  let sort = $derived<Sort>(
    route.order === null ? { key: "", direction: "ascending" } : { key: route.order.column, direction: route.order.desc ? "descending" : "ascending" },
  );
  /** A header sorts through the address: a new `table` call, from its first page. */
  function onsort(next: Sort): void {
    onroute({ ...route, page: 1, order: next.key === "" ? null : { column: next.key, desc: next.direction === "descending" } });
  }

  // The column picked is always one of this table's columns, shown in the select: the first
  // until the reader picks another, and the first again when the table's columns change.
  $effect(() => {
    if (!names.includes(column)) column = names[0] ?? "";
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const value = filterValue(text, kind);
    const chosen = names.includes(column) ? column : names[0];
    if (chosen === undefined) return;
    if (value === null) {
      problem = kind === "number" ? "Enter a number." : "Enter true or false.";
      return;
    }
    if (op === "contains" && typeof value !== "string") {
      problem = "contains takes text.";
      return;
    }
    problem = null;
    onfilter({ column: chosen, op, value });
  }
</script>

<section class="table-view" aria-label={`Table ${route.type}`} data-type={route.type}>
  <h1 class="title category">{shape?.typeLabel(route.type) ?? route.type}</h1>

  {#if route.where.length > 0}
    <ul class="filters" aria-label="Filters">
      {#each route.where as condition, i (i)}
        <li>
          <Chip
            removeLabel={`Remove filter ${condition.column} ${condition.op} ${JSON.stringify(condition.value)}`}
            onremove={() => onroute({ ...route, page: 1, where: route.where.filter((_, j) => j !== i) })}
            ><span class="code-text">{condition.column} {condition.op} {JSON.stringify(condition.value)}</span></Chip
          >
        </li>
      {/each}
    </ul>
  {/if}

  {#if names.length > 0}
    <form class="filter-form" aria-label="Add a filter" onsubmit={submit}>
      <select class="control caption" name="column" aria-label="Column" bind:value={column}>
        {#each names as name (name)}
          <option value={name}>{named(name)}</option>
        {/each}
      </select>
      <select class="control caption" name="op" aria-label="Operator" bind:value={op}>
        {#each OPERATORS as o (o)}
          <option value={o}>{o}</option>
        {/each}
      </select>
      <select class="control caption" name="kind" aria-label="Value kind" bind:value={kind}>
        <option value="text">text</option>
        <option value="number">number</option>
        <option value="boolean">true / false</option>
      </select>
      <input class="control caption" name="value" aria-label="Value" bind:value={text} />
      <Button type="submit">Filter</Button>
      {#if problem}<span class="problem caption" role="alert">{problem}</span>{/if}
    </form>
  {/if}

  {#if view === null}
    <p class="status caption" role="status">Loading…</p>
  {:else if "message" in view}
    <p class="banner body-screen" role="alert">{view.message}</p>
  {:else}
    <Table {columns} rows={[...view.rows]} label={`Rows of ${route.type}`} sort={sort} {onsort}>
      {#snippet row(cells: readonly unknown[])}
        <td class="id"><a href={nodeHref(String(cells[0]))} data-id={String(cells[0])}>{String(cells[0])}</a></td>
        {#each cells.slice(1) as cell, i (i)}
          <td class:mono={typeof cell === "number" || typeof cell === "boolean"}>{cellText(cell)}</td>
        {/each}
      {/snippet}
    </Table>
    {#if view.rows.length === 0}
      <EmptyState message="No rows." />
    {/if}
    <nav class="pager caption" aria-label="Pages">
      {#if view.page > 1}
        <a href={hrefFor({ ...route, page: view.page - 1 })} rel="prev">Previous</a>
      {/if}
      <span class="where">Page {view.page} of {view.pages} · {view.total} {view.total === 1 ? "row" : "rows"}</span>
      {#if view.page < view.pages}
        <a href={hrefFor({ ...route, page: view.page + 1 })} rel="next">Next</a>
      {/if}
    </nav>
  {/if}
</section>

<style>
  .table-view {
    padding: var(--space-5);
    min-inline-size: 0;
  }

  .title {
    margin: 0 0 var(--space-3);
    color: var(--heading);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }

  .filter-form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  .status {
    color: var(--ink-muted);
  }

  .control {
    block-size: var(--space-6);
    padding-inline: var(--space-2);
    border: 1px solid var(--ink-muted);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .control:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .problem {
    color: var(--majolica-text);
  }

  .id a {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .mono,
  .code-text {
    font-family: var(--font-mono);
  }

  .pager {
    display: flex;
    gap: var(--space-3);
    margin-block-start: var(--space-3);
    color: var(--ink-muted);
  }

  .banner {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }
</style>
