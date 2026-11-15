<script lang="ts">
  /**
   * The row under the band: the shell's four places (lib/places.ts) as links, the one the page
   * is at current, and at the right whatever `status` renders (the verified mark, the search
   * mode switch, the menu). Without `hrefFor` (no mosaic is open) it shows no places.
   */
  import type { Snippet } from "svelte";
  import { PLACES, type PlaceId } from "../lib/places.js";

  let { place, hrefFor = null, status }: { place: PlaceId; hrefFor?: ((id: PlaceId) => string) | null; status?: Snippet } = $props();
</script>

<div class="bar">
  <nav class="places" aria-label="Places">
    {#if hrefFor}
      {#each PLACES as p (p.id)}
        <a
          class="item"
          class:body-app={p.id !== place}
          class:label-app={p.id === place}
          class:current={p.id === place}
          href={hrefFor(p.id)}
          aria-current={p.id === place ? "page" : undefined}
          data-place-link={p.id}>{p.label}</a
        >
      {/each}
    {/if}
  </nav>
  {#if status}<div class="status caption">{@render status()}</div>{/if}
</div>

<style>
  .bar {
    flex: none;
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    box-sizing: border-box;
    min-block-size: var(--app-places);
    padding: 0 var(--space-4);
    border-block-end: 1px solid var(--border);
    background: var(--surface);
  }

  .places {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    min-inline-size: 0;
  }

  .item {
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-block-end: 2px solid transparent;
    color: var(--ink-muted);
    text-decoration: none;
  }

  .item:hover:not(.current) {
    color: var(--heading);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .item.current {
    border-block-end-color: var(--accent);
    color: var(--heading);
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-inline-start: auto;
    color: var(--ink-muted);
  }

  /* Below 560px the places take the row and the status wraps under them. */
  @media (width < 560px) {
    .bar {
      flex-wrap: wrap;
    }

    .places {
      min-block-size: var(--app-places);
    }

    .status {
      padding-block-end: var(--space-2);
    }
  }
</style>
