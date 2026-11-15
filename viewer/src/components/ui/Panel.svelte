<script lang="ts">
  /** Panel: a titled section, with optional actions beside the title. */
  import type { Snippet } from "svelte";

  let { title, actions, children }: { title: string; actions?: Snippet; children: Snippet } = $props();
  const id = $props.id();
</script>

<section class="panel" aria-labelledby={id}>
  <header>
    <h2 class="panel-title" {id}>{title}</h2>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  {@render children()}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    color: var(--heading);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
