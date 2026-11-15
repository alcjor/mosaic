<script lang="ts">
  /**
   * Chip: a small label. With `pressed` it is a toggle (`aria-pressed`) that calls `onclick`;
   * with `onremove` it carries a remove button named `removeLabel`.
   */
  import type { Snippet } from "svelte";

  let {
    pressed,
    disabled = false,
    onclick,
    onremove,
    removeLabel = "Remove",
    children,
  }: {
    pressed?: boolean;
    disabled?: boolean;
    onclick?: () => void;
    onremove?: () => void;
    removeLabel?: string;
    children: Snippet;
  } = $props();
</script>

<span class="chip caption" class:selected={pressed === true} class:disabled>
  {#if pressed !== undefined}
    <button class="label" type="button" aria-pressed={pressed} {disabled} {onclick}>{@render children()}</button>
  {:else}
    <span class="label">{@render children()}</span>
  {/if}
  {#if onremove}
    <button class="remove" type="button" aria-label={removeLabel} {disabled} onclick={onremove}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </button>
  {/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
  }

  .chip:hover:not(.disabled) {
    background: var(--surface-tint);
  }

  .selected {
    border-color: var(--accent);
    background: var(--surface-tint);
    color: var(--accent);
  }

  .disabled {
    opacity: 0.4;
  }

  button {
    display: inline-flex;
    align-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
  }

  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .remove {
    color: var(--ink-muted);
  }

  .remove path {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
</style>
