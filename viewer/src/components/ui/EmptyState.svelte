<script lang="ts">
  /** EmptyState (brand book, section 6): the tessera icon and one line, with an optional action. */
  import type { Snippet } from "svelte";

  let { message, action }: { message: string; action?: Snippet } = $props();
</script>

<div class="empty">
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2.5l10 1.5-1.5 9.5-9-1.5z" /></svg>
  <p class="body-screen">{message}</p>
  {#if action}{@render action()}{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
    color: var(--ink-muted);
    text-align: center;
  }

  p {
    margin: 0;
  }

  path {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
</style>
