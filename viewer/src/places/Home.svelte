<script lang="ts">
  /** Home: the map of types, and the view file's saved trails in the pane. A type leads to its table, a saved trail opens in Trails. */
  import Pane from "../components/Pane.svelte";
  import Place from "../components/Place.svelte";
  import SchemaView from "../components/SchemaView.svelte";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { linkOf } from "../lib/chainlink.js";
  import type { PlaceProps } from "./props.js";

  let { viewer, shape, links }: PlaceProps = $props();
</script>

<Place id="home">
  {#if viewer.file}
    <section aria-labelledby="home-map">
      <h1 class="title panel-title" id="home-map">Map of types</h1>
      <SchemaView file={viewer.file} {shape} hrefFor={links.thing} tableHref={links.table} />
    </section>
  {/if}
  {#snippet pane()}
    <Pane place="home" label="Saved trails">
      {#snippet head()}<h2 class="heading section-label">Saved trails</h2>{/snippet}
      {#if viewer.savedChains.length === 0}
        <EmptyState message="No saved trails yet. Build one in Trails and keep it in the view file.">
          {#snippet action()}<Button href={links.place("trails")}>Build a trail</Button>{/snippet}
        </EmptyState>
      {:else}
        <ul class="saved">
          {#each viewer.savedChains as s (s.name)}
            <li><Button href={links.trail(linkOf(s.chain, "columns", 0, [], { sort: null, filters: [] }))} data-trail={s.name}>{s.name}</Button></li>
          {/each}
        </ul>
      {/if}
    </Pane>
  {/snippet}
</Place>

<style>
  .title {
    margin: 0 0 var(--space-2);
    color: var(--heading);
  }

  .heading {
    margin: 0;
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .saved {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
