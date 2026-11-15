<script lang="ts" module>
  export type MenuItem = { label: string; onselect: () => void; disabled?: boolean };
</script>

<script lang="ts">
  /** Menu (bits-ui): a "more" button that opens a short list of actions. Arrow keys move, Escape closes. */
  import { DropdownMenu } from "bits-ui";

  let { label, items }: { label: string; items: MenuItem[] } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="ui-menu-button" aria-label={label}>
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h.01M8 8h.01M13 8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="ui-menu body-app" align="end" sideOffset={4}>
      {#each items as item (item.label)}
        <DropdownMenu.Item class="ui-menu-item" disabled={item.disabled ?? false} onSelect={item.onselect}>{item.label}</DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  :global(.ui-menu-button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 28px;
    block-size: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }

  :global(.ui-menu-button:hover),
  :global(.ui-menu-button[data-state="open"]) {
    background: var(--selection);
    color: var(--heading);
  }

  :global(.ui-menu-button:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :global(.ui-menu) {
    z-index: 30;
    min-inline-size: 180px;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--raised);
    color: var(--ink);
    box-shadow: 0 var(--space-2) var(--space-5) var(--shadow);
  }

  :global(.ui-menu-item) {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  :global(.ui-menu-item[data-highlighted]) {
    background: var(--selection);
    color: var(--heading);
    outline: none;
  }

  :global(.ui-menu-item[data-disabled]) {
    color: var(--ink-muted);
    cursor: default;
  }
</style>
