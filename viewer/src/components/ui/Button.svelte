<script lang="ts">
  /**
   * Button (brand book, section 6): 32px, primary (one per view), secondary or ghost. With
   * `href` it is a link that looks like a button; a disabled link loses its href. With
   * `pressed` it is a toggle. Other attributes (`data-*`, `aria-*`) go to the element.
   */
  import type { Snippet } from "svelte";

  let {
    variant = "secondary",
    href,
    disabled = false,
    type = "button",
    label,
    pressed,
    onclick,
    children,
    ...rest
  }: {
    variant?: "primary" | "secondary" | "ghost";
    href?: string;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    /** An accessible name, for a button whose content is only an icon. */
    label?: string;
    /** For a toggle: whether it is on. */
    pressed?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
    [attribute: string]: unknown;
  } = $props();
</script>

{#if href !== undefined}
  <a
    {...rest}
    class="button step-title {variant}"
    href={disabled ? undefined : href}
    aria-disabled={disabled ? "true" : undefined}
    aria-label={label}
    onclick={disabled ? (e) => e.preventDefault() : onclick}>{@render children()}</a
  >
{:else}
  <button {...rest} class="button step-title {variant}" {type} {disabled} aria-label={label} aria-pressed={pressed} {onclick}>{@render children()}</button>
{/if}

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    block-size: var(--space-6);
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }

  .primary {
    background: var(--accent);
    color: var(--surface);
  }

  .secondary {
    background: var(--surface);
    border-color: var(--accent);
    color: var(--accent);
  }

  .ghost {
    background: transparent;
    color: var(--ink);
  }

  .button[aria-pressed="true"] {
    background: var(--accent);
    color: var(--surface);
  }

  .primary:hover:not(:disabled, [aria-disabled="true"]) {
    background: var(--shard-3);
    color: var(--ceramic);
  }

  .secondary:hover:not(:disabled, [aria-disabled="true"], [aria-pressed="true"]),
  .ghost:hover:not(:disabled, [aria-disabled="true"], [aria-pressed="true"]) {
    background: var(--surface-tint);
  }

  .button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .button:disabled,
  .button[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
