<script lang="ts">
  /**
   * A compact control of Trails that opens a small panel under it (bits-ui Popover): the
   * trigger looks like a button, or like a thing's chip with `look="thing"`. Escape and a
   * press outside close it; `open` can be bound to close it from inside.
   */
  import { Popover } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    label,
    look = "button",
    align = "start",
    open = $bindable(false),
    trigger,
    children,
  }: {
    /** The trigger's accessible name. */
    label: string;
    look?: "button" | "thing";
    align?: "start" | "end";
    open?: boolean;
    trigger: Snippet;
    children: Snippet;
  } = $props();
</script>

<Popover.Root bind:open>
  <Popover.Trigger class="trail-trigger {look} {look === 'button' ? 'control-app' : 'body-app'}" aria-label={label}>
    {@render trigger()}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="trail-popover body-app" {align} sideOffset={4} aria-label={label}>
      {@render children()}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.trail-trigger) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-inline-size: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    white-space: nowrap;
    cursor: pointer;
  }

  :global(.trail-trigger.button) {
    block-size: var(--space-6);
    padding: 0 var(--space-3);
  }

  :global(.trail-trigger.thing) {
    padding: var(--space-1) var(--space-2);
    border-color: transparent;
    border-radius: var(--radius-sm);
    background: var(--selection);
  }

  :global(.trail-trigger:hover),
  :global(.trail-trigger[data-state="open"]) {
    background: var(--selection);
    border-color: var(--accent);
    color: var(--heading);
  }

  :global(.trail-trigger:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :global(.trail-popover) {
    z-index: 30;
    display: grid;
    gap: var(--space-2);
    box-sizing: border-box;
    inline-size: min(360px, 92vw);
    max-block-size: 70vh;
    padding: var(--space-3);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--raised);
    color: var(--ink);
    box-shadow: 0 var(--space-2) var(--space-5) var(--shadow);
  }
</style>
