<script lang="ts">
  /**
   * Chip: a 28px pill. With `pressed` it is a toggle (`aria-pressed`) that calls `onclick`;
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

<span class="chip control-app" class:selected={pressed === true} class:removable={onremove !== undefined} class:disabled>
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
    gap: var(--space-2);
    box-sizing: border-box;
    block-size: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--ink);
    white-space: nowrap;
  }

  .chip:not(.selected) {
    font-weight: normal;
  }

  .chip:hover:not(.disabled) {
    background: var(--selection);
  }

  /* On (a toggle that is pressed) or set (a filter in force): the accent outlines it. */
  .selected,
  .removable {
    border-color: var(--accent);
    background: var(--selection);
    color: var(--heading);
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
    border-radius: var(--radius-pill);
  }

  /* A toggle is pressed anywhere on its pill. */
  button.label {
    display: inline-block;
    align-self: stretch;
    margin-inline: calc(-1 * var(--space-3));
    padding-inline: var(--space-3);
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
