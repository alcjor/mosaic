<script lang="ts">
  /**
   * A trail as columns (lib/trailcolumns.ts): one per place of the chain, each listing the things
   * found there. Picking a thing pins its place to it, so the other columns narrow to what goes
   * with it; picking the pinned thing again leaves the place open. Each thing's name opens it in
   * Explore.
   */
  import type { TrailColumns } from "../lib/trailcolumns.js";
  import type { Shape } from "../lib/view.js";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Panel from "./ui/Panel.svelte";

  let {
    trail,
    shape = null,
    hrefFor,
    onpin,
  }: {
    trail: TrailColumns;
    shape?: Shape | null;
    hrefFor: (id: string) => string;
    /** Pin place `place` (0 is the start) to the thing `id`, or leave it open (null). */
    onpin: (place: number, id: string | null) => void;
  } = $props();

  const typeName = (type: string) => shape?.typeLabel(type) ?? type;
  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
</script>

<section class="trail" aria-label="Trail as columns">
  {#if trail.partial}
    <p class="note caption" role="status">The columns list the things of the first {figure(trail.read)} results. Pin a thing to narrow them.</p>
  {/if}
  <ol class="columns">
    {#each trail.columns as column, place (place)}
      <li class="column" data-column={place}>
        <Panel title="{place + 1} · {typeName(column.type)}">
          <p class="via caption">
            {#if column.step}
              {column.step.direction === "out" ? "→" : "←"}
              {shape?.edgeLabel(column.step.from, column.step.edge) ?? column.step.edge}
            {:else}
              Start
            {/if}
            · {figure(column.things.length)}{trail.partial ? "+" : ""}
            {column.things.length === 1 ? "thing" : "things"}
          </p>
          {#if column.things.length === 0}
            <EmptyState message="Nothing here: the trail has no result." />
          {:else}
            <ul class="things">
              {#each column.things as thing (thing.id)}
                {@const pinned = column.pin === thing.id}
                <li class="thing">
                  <Chip pressed={pinned} onclick={() => onpin(place, pinned ? null : thing.id)}>
                    <span data-pin={thing.id}>{pinned ? "Pinned" : "Pin"}</span>
                  </Chip>
                  <a class="name body-screen" href={hrefFor(thing.id)} data-id={thing.id}>{thing.label ?? thing.id}</a>
                  {#if !pinned && thing.results > 1}<span class="count caption">{figure(thing.results)}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </Panel>
      </li>
    {/each}
  </ol>
</section>

<style>
  .trail {
    min-inline-size: 0;
  }

  .note,
  .via {
    margin: 0;
    color: var(--ink-muted);
  }

  .note {
    margin-block-end: var(--space-2);
  }

  /* One column per place, side by side; the row scrolls sideways when the page is narrower. */
  .columns {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0;
    padding: 0 0 var(--space-2);
    overflow-x: auto;
    list-style: none;
  }

  .column {
    flex: 1 0 220px;
    min-inline-size: 0;
    max-inline-size: 360px;
  }

  .things {
    display: grid;
    gap: var(--space-1);
    max-block-size: 60vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .thing {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .name {
    flex: 1;
    min-inline-size: 0;
    overflow-wrap: anywhere;
    color: var(--ink);
    text-decoration: none;
  }

  .name:hover {
    color: var(--accent);
  }

  .name:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .count {
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }
</style>
