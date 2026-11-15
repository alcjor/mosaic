<script lang="ts">
  /** The shell's four places (lib/places.ts), as links: the one the page is at is current. */
  import { PLACES, type PlaceId } from "../lib/places.js";

  let { place, hrefFor }: { place: PlaceId; hrefFor: (id: PlaceId) => string } = $props();
</script>

<nav class="bar" aria-label="Places">
  {#each PLACES as p (p.id)}
    <a class="item step-title" class:current={p.id === place} href={hrefFor(p.id)} aria-current={p.id === place ? "page" : undefined} data-place-link={p.id}
      >{p.label}</a
    >
  {/each}
</nav>

<style>
  .bar {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4) 0;
    border-block-end: 1px solid var(--border);
    background: var(--surface);
  }

  .item {
    padding: var(--space-2) var(--space-3);
    border-block-end: 2px solid transparent;
    color: var(--ink);
    text-decoration: none;
  }

  .item:hover:not(.current) {
    background: var(--surface-tint);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .item.current {
    border-block-end-color: var(--accent);
    color: var(--accent);
  }
</style>
