<script lang="ts" module>
  export type Tab = { value: string; label: string; disabled?: boolean };
</script>

<script lang="ts">
  /**
   * Tabs (bits-ui): a row of tabs over one panel. `panel` renders the selected tab's content;
   * the others stay empty. Without `panel` it is the row of tabs alone, and the caller shows
   * the content `value` names (content that must stay on the page while another tab shows).
   * Arrow keys move between tabs.
   */
  import { Tabs } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    tabs,
    value = $bindable(tabs[0]?.value ?? ""),
    label,
    onchange,
    panel,
  }: {
    tabs: Tab[];
    value?: string;
    label: string;
    onchange?: (value: string) => void;
    panel?: Snippet<[string]>;
  } = $props();
</script>

<Tabs.Root bind:value onValueChange={(v) => onchange?.(v)}>
  <Tabs.List class="ui-tab-list" aria-label={label}>
    {#each tabs as tab (tab.value)}
      <Tabs.Trigger class="ui-tab control-app" value={tab.value} disabled={tab.disabled}>{tab.label}</Tabs.Trigger>
    {/each}
  </Tabs.List>
  {#if panel}
    {#each tabs as tab (tab.value)}
      <Tabs.Content class="ui-tab-panel" value={tab.value}>
        {#if tab.value === value}{@render panel(tab.value)}{/if}
      </Tabs.Content>
    {/each}
  {/if}
</Tabs.Root>

<style>
  :global(.ui-tab-list) {
    display: flex;
    gap: var(--space-1);
    border-block-end: 1px solid var(--border);
  }

  :global(.ui-tab) {
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-block-end: 2px solid transparent;
    background: none;
    color: var(--ink-muted);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  :global(.ui-tab:hover:not(:disabled)) {
    background: var(--surface-tint);
  }

  :global(.ui-tab[data-state="active"]) {
    border-block-end-color: var(--accent);
    color: var(--accent);
  }

  :global(.ui-tab:focus-visible),
  :global(.ui-tab-panel:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :global(.ui-tab:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(.ui-tab-panel) {
    padding-block: var(--space-3);
  }
</style>
