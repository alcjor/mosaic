<script lang="ts">
  /**
   * TableView (brand book, section 6): one page of `table` for a node type, filling the room it
   * is given. Above the table, its filters as chips that can be removed, and "Add a filter";
   * the table scrolls inside its frame; below it, where the page is in the rows, and the pager.
   * A header sorts (a third click goes back to the table's own order), a filter adds a `where`
   * condition, the pager moves through pages: each is a new `table` call through the page's
   * address. A row's name opens the thing; with `file`, the type's links are columns too, each
   * cell the things linked, as chips that open them (lib/tables.ts). With `onselect`, a row can
   * be picked. With a view file, the columns carry the file's labels.
   */
  import { Popover } from "bits-ui";
  import type { SealedFile } from "@mosaic/kit";
  import ThingChip from "./ThingChip.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Table from "./ui/Table.svelte";
  import type { Column, Sort } from "./ui/table.js";
  import { number } from "../lib/graph/mapview.js";
  import type { ToolFailure } from "../lib/mosaic.js";
  import { OPERATORS, type Condition, type TableRoute } from "../lib/route.js";
  import { cellText, filterKind, filterValue, linkColumns, PAGE_ROWS, rowLinks, type CellLinks, type TableView } from "../lib/tables.js";
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
    file = null,
    count = null,
    selected = null,
    onselect,
  }: {
    view: TableView | ToolFailure | null;
    route: TableRoute;
    hrefFor: (route: TableRoute) => string;
    nodeHref: (id: string) => string;
    onfilter: (condition: Condition) => void;
    /** Go to another route of this table (a sort); by default, through the page's address. */
    onroute?: (route: TableRoute) => void;
    shape?: Shape | null;
    /** The open mosaic, to read the rows' links from; without it the table has no link columns. */
    file?: SealedFile | null;
    /** How many things the type holds, filters aside. */
    count?: number | null;
    /** The id of the row picked, if any. */
    selected?: string | null;
    onselect?: (row: { id: string; label: string | null }) => void;
  } = $props();

  const named = (column: string): string => shape?.label(route.type, column) ?? (column === "label" ? "Name" : column);
  const WORDS: Partial<Record<Condition["op"], string>> = { "=": "is", "!=": "is not" };

  let shown = $derived(view !== null && "columns" in view ? view : null);
  /** `table` gives `id`, then the name (`label`), then the columns; a table without the name leads with the id. */
  let hasName = $derived(shown?.columns[1] === "label");
  let names = $derived(shown === null ? [] : shown.columns.slice(hasName ? 2 : 1));
  let links = $derived(file === null ? [] : linkColumns(file, route.type));
  let columns = $derived<Column[]>([
    hasName ? { key: "label", label: named("label"), sortable: true } : { key: "", label: "id" },
    ...names.map((name) => ({ key: name, label: named(name), sortable: true })),
    ...links.map((edge) => ({ key: edge.name, label: named(edge.name), sortable: true })),
  ]);
  let sort = $derived<Sort | null>(route.order === null ? null : { key: route.order.column, direction: route.order.desc ? "descending" : "ascending" });

  /** A header sorts through the address, from the first page: ascending, descending, then the table's own order. */
  function onsort(next: Sort): void {
    const back = route.order !== null && route.order.column === next.key && route.order.desc;
    onroute({ ...route, page: 1, order: back ? null : { column: next.key, desc: next.direction === "descending" } });
  }

  /** The links of the rows on this page, once read: row id, then edge type. */
  let cells = $state.raw<Map<string, Map<string, CellLinks>>>(new Map());
  $effect(() => {
    const page = shown;
    const edges = links.map((e) => e.name);
    if (file === null || page === null || edges.length === 0) {
      cells = new Map();
      return;
    }
    let live = true;
    void rowLinks(file, page.rows.map((row) => String(row[0])), edges).then((read) => {
      if (live) cells = read;
    });
    return () => {
      live = false;
    };
  });

  // The filter being added: its column is one of the table's, the first until another is picked.
  let filterable = $derived([...(hasName ? ["label"] : []), ...names, ...links.map((e) => e.name)]);
  let open = $state(false);
  let chosen = $state<string | null>(null);
  let column = $derived(chosen !== null && filterable.includes(chosen) ? chosen : (filterable[0] ?? ""));
  let op = $state<Condition["op"]>("=");
  let text = $state("");
  let problem = $state<string | null>(null);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!filterable.includes(column)) return;
    const kind = op === "contains" || links.some((e) => e.name === column) ? "text" : filterKind(shown, column, text);
    const value = filterValue(text, kind);
    if (value === null) {
      problem = kind === "number" ? "This column holds numbers: enter a number." : "This column holds true or false.";
      return;
    }
    problem = null;
    open = false;
    text = "";
    onfilter({ column, op, value });
  }

  let first = $derived(shown === null ? 0 : (shown.page - 1) * PAGE_ROWS + 1);
</script>

<section class="table-view" aria-label={`Table ${route.type}`} data-type={route.type}>
  <div class="bar">
    <span class="heading section-label">Filters</span>
    {#if route.where.length > 0}
      <ul class="filters" aria-label="Filters">
        {#each route.where as condition, i (i)}
          <li>
            <Chip
              removeLabel={`Remove filter ${condition.column} ${condition.op} ${JSON.stringify(condition.value)}`}
              onremove={() => onroute({ ...route, page: 1, where: route.where.filter((_, j) => j !== i) })}
              >{named(condition.column)} {WORDS[condition.op] ?? condition.op} <strong>{String(condition.value)}</strong></Chip
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#if filterable.length > 0}
      <Popover.Root bind:open>
        <Popover.Trigger class="table-filter-add control-app">Add a filter</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="table-filter-pop body-app" align="start" sideOffset={4}>
            <form class="filter-form" aria-label="Add a filter" onsubmit={submit}>
              <label class="field caption"
                >Column
                <select class="control body-app" name="column" value={column} onchange={(e) => (chosen = e.currentTarget.value)}>
                  {#each filterable as name (name)}
                    <option value={name}>{named(name)}</option>
                  {/each}
                </select>
              </label>
              <label class="field caption"
                >Operator
                <select class="control body-app" name="op" bind:value={op}>
                  {#each OPERATORS as o (o)}
                    <option value={o}>{WORDS[o] ?? o}</option>
                  {/each}
                </select>
              </label>
              <label class="field caption">Value <input class="control body-app" name="value" bind:value={text} /></label>
              {#if problem}<span class="problem caption" role="alert">{problem}</span>{/if}
              <Button type="submit" variant="primary">Add</Button>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    {/if}
    <span class="grow"></span>
    {#if shown}
      <span class="caption muted" data-total={shown.total}>
        {count !== null && shown.total !== count ? `${number(shown.total)} of ` : ""}{number(count ?? shown.total)} · {shape?.typeLabel(route.type) ?? route.type}
      </span>
    {/if}
  </div>

  {#if view === null}
    <p class="status caption" role="status">Loading…</p>
  {:else if "message" in view}
    <p class="banner body-app" role="alert">{view.message}</p>
  {:else}
    <div class="frame body-app">
      <Table
        {columns}
        rows={[...view.rows]}
        label={`Rows of ${route.type}`}
        {sort}
        {onsort}
        selected={onselect ? (cellsOf: readonly unknown[]) => String(cellsOf[0]) === selected : undefined}
        onrow={onselect ? (cellsOf: readonly unknown[]) => onselect({ id: String(cellsOf[0]), label: hasName && typeof cellsOf[1] === "string" ? cellsOf[1] : null }) : undefined}
      >
        {#snippet row(rowCells: readonly unknown[])}
          {@const id = String(rowCells[0])}
          <td class="name"><a class="label-app" href={nodeHref(id)} data-id={id}>{hasName && cellText(rowCells[1]) !== "" ? cellText(rowCells[1]) : id}</a></td>
          {#each rowCells.slice(hasName ? 2 : 1) as cell, i (i)}
            <td class:mono={typeof cell === "number" || typeof cell === "boolean"}>{cellText(cell)}</td>
          {/each}
          {#each links as edge (edge.name)}
            {@const linked = cells.get(id)?.get(edge.name)}
            <td class="links" data-link={edge.name}>
              {#if linked}
                <span class="things">
                  {#each linked.things as thing (thing.id)}
                    <ThingChip id={thing.id} label={thing.label} type={edge.to} href={nodeHref(thing.id)} />
                  {/each}
                  {#if linked.total > linked.things.length}<span class="caption muted">+{number(linked.total - linked.things.length)}</span>{/if}
                </span>
              {/if}
            </td>
          {/each}
        {/snippet}
      </Table>
      {#if view.rows.length === 0}
        <EmptyState message="No rows." />
      {/if}
    </div>
    <div class="foot caption muted">
      <span class="hint">Pick a name to explore it, a chip to follow the link, a column to sort.{onselect ? " The selected row's card opens in the side pane." : ""}</span>
      <span class="grow"></span>
      <nav class="pager" aria-label="Pages">
        <span class="where" data-page={view.page} data-pages={view.pages}>
          {view.rows.length > 0 ? `${number(first)}–${number(first + view.rows.length - 1)} of ` : ""}{number(view.total)}
        </span>
        <Button href={hrefFor({ ...route, page: view.page - 1 })} disabled={view.page <= 1} label="Previous page" rel={view.page > 1 ? "prev" : undefined}>‹</Button>
        <Button href={hrefFor({ ...route, page: view.page + 1 })} disabled={view.page >= view.pages} label="Next page" rel={view.page < view.pages ? "next" : undefined}
          >›</Button
        >
      </nav>
    </div>
  {/if}
</section>

<style>
  .table-view {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    min-inline-size: 0;
    min-block-size: 0;
  }

  .bar,
  .foot,
  .pager {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .bar {
    flex-wrap: wrap;
    min-block-size: var(--space-6);
  }

  .heading {
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .grow {
    flex: 1;
  }

  .muted,
  .status {
    color: var(--ink-muted);
  }

  .status {
    margin: 0;
  }

  :global(.table-filter-add) {
    block-size: var(--space-6);
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--accent);
    cursor: pointer;
  }

  :global(.table-filter-add:hover),
  :global(.table-filter-add[data-state="open"]) {
    background: var(--selection);
  }

  :global(.table-filter-add:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :global(.table-filter-pop) {
    z-index: 20;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--raised);
    box-shadow: var(--shadow);
    color: var(--ink);
  }

  .filter-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    inline-size: 240px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--ink-muted);
  }

  .control {
    box-sizing: border-box;
    block-size: var(--space-6);
    padding-inline: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .control:focus-visible,
  .name a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .problem {
    color: var(--majolica-text);
  }

  /* The table's frame takes the room left and the table scrolls inside it. */
  .frame {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-block-size: 160px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .frame :global(.scroll) {
    min-block-size: 0;
  }

  .frame :global(td) {
    vertical-align: middle;
  }

  /* A row's name stays on one line up to a width, then wraps; its chips never break inside. */
  .name {
    min-inline-size: 160px;
    max-inline-size: 320px;
  }

  .name a {
    color: var(--accent);
  }

  .frame :global(td:not(.name, .links)) {
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .things {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    inline-size: max-content;
    max-inline-size: 280px;
  }

  .hint {
    min-inline-size: 0;
  }

  .where {
    white-space: nowrap;
  }

  .banner {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }
</style>
