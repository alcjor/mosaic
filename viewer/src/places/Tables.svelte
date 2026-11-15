<script lang="ts">
  /** Tables: the types, and the table of the one picked. Below 960px the two are tabs. */
  import Place from "../components/Place.svelte";
  import TableView from "../components/TableView.svelte";
  import TypeList from "../components/TypeList.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import Tabs from "../components/ui/Tabs.svelte";
  import type { Condition } from "../lib/route.js";
  import type { PlaceProps } from "./props.js";

  let {
    viewer,
    shape,
    narrow,
    links,
    picked,
    onpick,
  }: PlaceProps & {
    /** The tab a person picked since the address last changed, if any. */
    picked: string | null;
    onpick: (tab: string) => void;
  } = $props();

  const tabs = [
    { value: "types", label: "Types" },
    { value: "table", label: "Table" },
  ];
  /** The tab shown below 960px: the one picked, else what the address opened. */
  let tab = $derived(picked !== null && tabs.some((t) => t.value === picked) ? picked : viewer.tableRoute !== null ? "table" : "types");

  function filtered(condition: Condition): void {
    const table = viewer.tableRoute;
    if (table) location.hash = links.table({ ...table, page: 1, where: [...table.where, condition] });
  }
</script>

<Place id="tables" fill>
  <div class="tables">
    {#if narrow}
      <div class="tabs"><Tabs {tabs} value={tab} label="Tables" onchange={onpick} /></div>
    {/if}
    <nav class="types" aria-label="Types" hidden={narrow && tab !== "types"}>
      <TypeList types={shape.types} selected={viewer.tableRoute?.type ?? null} hrefFor={links.type} labelFor={(type) => shape.typeLabel(type)} />
    </nav>
    <div class="table" hidden={narrow && tab !== "table"}>
      {#if viewer.tableRoute}
        {#key viewer.tableRoute.type}
          <TableView view={viewer.table} route={viewer.tableRoute} hrefFor={links.table} nodeHref={links.thing} onfilter={filtered} shape={viewer.shape} />
        {/key}
      {:else}
        <EmptyState message="Pick a type to see its table." />
      {/if}
    </div>
  </div>
</Place>

<style>
  .tables {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    min-inline-size: 0;
  }

  [hidden] {
    display: none;
  }

  .tabs {
    padding: var(--space-2) var(--space-4) 0;
  }

  .types,
  .table {
    min-inline-size: 0;
    background: var(--surface);
  }

  /* From 960px: the types beside the table, each scrolling on its own. */
  @media (width >= 960px) {
    .tables {
      grid-template-columns: 280px minmax(0, 1fr);
      align-content: stretch;
      min-block-size: 0;
    }

    .types,
    .table {
      min-block-size: 0;
      overflow: auto;
    }

    .types {
      border-inline-end: 1px solid var(--border);
    }
  }
</style>
