<script lang="ts">
  /**
   * Tables: the types as chips across the top, and the table of the one picked filling the rest.
   * Picking a row shows its card in the pane, which starts collapsed to its rail.
   */
  import EntityCard from "../components/EntityCard.svelte";
  import Pane from "../components/Pane.svelte";
  import Place from "../components/Place.svelte";
  import TableView from "../components/TableView.svelte";
  import TypeList from "../components/TypeList.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { cardFacts, type Fact } from "../lib/cards.js";
  import { nodePage, type NodeView, type ToolFailure } from "../lib/mosaic.js";
  import { PANE_DEFAULT, seedPane } from "../lib/pane.js";
  import type { Condition } from "../lib/route.js";
  import type { PlaceProps } from "./props.js";

  let {
    viewer,
    shape,
    links,
  }: PlaceProps & {
    /** Tabs the place once had below 960px; the shell still hands them over. */
    picked?: string | null;
    onpick?: (tab: string) => void;
  } = $props();

  seedPane("tables", { ...PANE_DEFAULT, collapsed: true });

  function filtered(condition: Condition): void {
    const table = viewer.tableRoute;
    if (table) location.hash = links.table({ ...table, page: 1, where: [...table.where, condition] });
  }

  /** The row picked, and its card once read. */
  let row = $state.raw<{ id: string; label: string | null; type: string } | null>(null);
  let card = $state.raw<{ page: NodeView; facts: readonly Fact[] | null } | ToolFailure | null>(null);
  const type = $derived(viewer.tableRoute?.type ?? null);
  const selected = $derived(row !== null && row.type === type ? row : null);

  $effect(() => {
    const file = viewer.file;
    const picked = selected;
    card = null;
    if (file === null || picked === null) return;
    let live = true;
    void (async () => {
      const page = await nodePage(file, picked.id);
      if (!live) return;
      card = "message" in page ? page : { page, facts: null };
      if ("message" in page) return;
      const facts = await cardFacts(file, page, shape);
      if (live) card = { page, facts };
    })();
    return () => {
      live = false;
    };
  });
</script>

<Place id="tables" fill>
  <div class="tables">
    <nav class="types" aria-label="Types">
      <TypeList types={shape.types} selected={type} hrefFor={links.type} labelFor={(name) => shape.typeLabel(name)} />
    </nav>
    {#if viewer.tableRoute}
      {#key viewer.tableRoute.type}
        <TableView
          view={viewer.table}
          route={viewer.tableRoute}
          hrefFor={links.table}
          nodeHref={links.thing}
          onfilter={filtered}
          shape={viewer.shape}
          file={viewer.file}
          count={shape.types.find((t) => t.name === type)?.count ?? null}
          selected={selected?.id ?? null}
          onselect={(picked) => (row = { ...picked, type: type! })}
        />
      {/key}
    {:else}
      <EmptyState message="Pick a type to see its table." />
    {/if}
  </div>
  {#snippet pane()}
    <Pane place="tables" label="Selected row" strip={selected ? (selected.label ?? selected.id) : "Selected row"}>
      {#snippet head()}<h2 class="heading section-label">Selected row</h2>{/snippet}
      {#if selected === null}
        <p class="none caption">Pick a row to see its card here.</p>
      {:else if card === null}
        <p class="none caption" role="status">Loading…</p>
      {:else if "message" in card}
        <p class="banner body-app" role="alert">Could not read its card: {card.message}</p>
      {:else}
        <EntityCard node={card.page.node} {shape} facts={card.facts} hrefFor={links.thing} />
      {/if}
    </Pane>
  {/snippet}
</Place>

<style>
  .tables {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-sizing: border-box;
    min-inline-size: 0;
    min-block-size: 0;
    padding: var(--space-4);
  }

  .heading {
    margin: 0;
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .none {
    margin: 0;
    color: var(--ink-muted);
  }

  .banner {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }
</style>
