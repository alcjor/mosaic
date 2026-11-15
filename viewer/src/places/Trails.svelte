<script lang="ts">
  /** Trails: a chain, built step by step, shown as columns (one per place) or as one table. */
  import ChainView from "../components/ChainView.svelte";
  import Place from "../components/Place.svelte";
  import ResultTableView from "../components/ResultTableView.svelte";
  import TrailColumns from "../components/TrailColumns.svelte";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { pin } from "../lib/chain.js";
  import { findThings, type Answer } from "../lib/placesearch.svelte.js";
  import type { PlaceProps } from "./props.js";

  let { viewer, links }: PlaceProps = $props();

  /** Things of `type` named like `query`, for pinning a chain's place: the kit's `find`. */
  function findIn(type: string, query: string): Promise<Answer> {
    return viewer.file === null ? Promise.resolve([]) : findThings(viewer.file, type, query);
  }
</script>

<Place id="trails">
  {#if viewer.file}
    <div class="trails">
      <ChainView
        schema={viewer.file}
        chain={viewer.chain}
        count={viewer.chainCount}
        shape={viewer.shape}
        onchange={(c) => viewer.chooseChain(c)}
        find={findIn}
        searches={viewer.searches}
        saved={viewer.savedChains}
        fileChains={viewer.view.chains ?? []}
      />
      {#if viewer.chain === null}
        <EmptyState message="Choose a type to start a trail from, then add steps along its links." />
      {:else}
        {@const chain = viewer.chain}
        <div class="show-as" role="group" aria-label="Show the trail as">
          <Button pressed={viewer.chainShow === "columns"} onclick={() => void viewer.showChainAs("columns")}>Columns</Button>
          <Button pressed={viewer.chainShow === "table"} onclick={() => void viewer.showChainAs("table")}>Table</Button>
        </div>
        {#if viewer.chainShow === "table" && viewer.chainTable !== null}
          <ResultTableView table={viewer.chainTable} count={viewer.chainCount} hrefFor={links.thing} />
        {:else if viewer.chainFailure !== null}
          <p class="banner body-screen" role="alert">{viewer.chainFailure}</p>
        {:else if viewer.chainColumns !== null}
          <TrailColumns
            trail={viewer.chainColumns}
            shape={viewer.shape}
            hrefFor={links.thing}
            onpin={(place, id) => viewer.chooseChain(pin(chain, place === 0 ? "start" : place - 1, id))}
          />
        {:else}
          <p class="caption" role="status">Reading the trail…</p>
        {/if}
      {/if}
    </div>
  {/if}
</Place>

<style>
  .trails {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    align-content: start;
  }

  .show-as {
    display: inline-flex;
    gap: var(--space-1);
  }

  .banner {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }
</style>
