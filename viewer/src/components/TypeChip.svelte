<script lang="ts">
  /** TypeChip (brand book, section 6): the type name, or the view file's label for it, after the type's shard. */
  import Shard from "./Shard.svelte";

  let { type, label = null }: { type: string; label?: string | null } = $props();
</script>

<span class="chip caption"><Shard {type} />{label ?? type}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--ink-muted);
  }
</style>
