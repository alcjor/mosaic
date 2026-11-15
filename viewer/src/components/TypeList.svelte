<script lang="ts">
  /**
   * The node types the page lists (all the mosaic declares, or the view file's, in its order) as
   * a row of chips that wraps: each has its type's shard, its label and its count, and opens its
   * table.
   */
  import type { NodeType } from "@mosaic/kit";
  import { number } from "../lib/graph/mapview.js";
  import Shard from "./Shard.svelte";

  let {
    types,
    selected = null,
    hrefFor,
    labelFor = (type: string) => type,
  }: {
    types: readonly NodeType[];
    selected?: string | null;
    hrefFor: (type: string) => string;
    labelFor?: (type: string) => string;
  } = $props();
</script>

{#if types.length === 0}
  <p class="none caption">This mosaic declares no node type.</p>
{/if}
<ul class="chips">
  {#each types as type (type.name)}
    <li>
      <a
        class="chip control-app"
        class:selected={type.name === selected}
        href={hrefFor(type.name)}
        aria-current={type.name === selected ? "page" : undefined}
        data-type={type.name}
      >
        <Shard type={type.name} />{labelFor(type.name)}
        <span class="count caption">{number(type.count)}</span>
      </a>
    </li>
  {/each}
</ul>

<style>
  .none {
    margin: 0;
    color: var(--ink-muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    block-size: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
  }

  .chip:not(.selected) {
    font-weight: normal;
  }

  .chip:hover {
    background: var(--selection);
  }

  .chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .selected {
    border-color: var(--accent);
    background: var(--selection);
    color: var(--heading);
  }

  .count {
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }
</style>
