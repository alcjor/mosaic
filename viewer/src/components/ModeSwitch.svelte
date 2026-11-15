<script lang="ts">
  /** The search mode switch, *Semantic* / *Text*: it starts as the view file's `search` setting. */
  import { MODE_NAMES, SEARCH_MODES, type SearchMode } from "../lib/view.js";

  let { mode = "semantic", disabled = false, onmode = () => {} }: { mode?: SearchMode; disabled?: boolean; onmode?: (mode: SearchMode) => void } = $props();
</script>

<span class="modes" role="group" aria-label="Search mode">
  {#each SEARCH_MODES as m (m)}
    <button class="mode section-label" class:active={m === mode} type="button" aria-pressed={m === mode} data-mode={m} {disabled} onclick={() => onmode(m)}
      >{MODE_NAMES[m]}</button
    >
  {/each}
</span>

<style>
  .modes {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .mode {
    block-size: 28px;
    padding: 0 var(--space-2);
    border: 0;
    background: var(--surface);
    color: var(--ink-muted);
    letter-spacing: 0;
    cursor: pointer;
  }

  .mode.active {
    background: var(--selection);
    color: var(--heading);
  }

  .mode:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .mode:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
