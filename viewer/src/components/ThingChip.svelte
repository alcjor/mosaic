<script lang="ts">
  /**
   * A linked thing as a chip in its type's colour: its type's shard and its name on a tint of
   * that colour. With `href` it opens the thing; `onclick` hears the pick first. A long name is
   * cut with an ellipsis and kept whole in the title.
   */
  import { typeColours } from "../lib/typecolour.context.js";
  import Shard from "./Shard.svelte";

  let {
    id,
    label,
    type,
    href,
    onclick,
  }: { id: string; label: string | null; type: string | null; href?: string | undefined; onclick?: (event: MouseEvent) => void } = $props();

  const colourOf = typeColours();
  let colour = $derived(type === null ? null : colourOf(type));
  let name = $derived(label ?? id);
</script>

{#if href !== undefined}
  <a class="thing" {href} data-id={id} data-type-colour={colour} title={name} {onclick}><Shard {type} /><span class="name">{name}</span></a>
{:else}
  <span class="thing" data-id={id} data-type-colour={colour} title={name}><Shard {type} /><span class="name">{name}</span></span>
{/if}

<style>
  .thing {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    position: relative;
    isolation: isolate;
    box-sizing: border-box;
    max-inline-size: 100%;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--ink);
    text-decoration: none;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The type's colour as a tint under the name: the colour itself, mostly let through. */
  .thing::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--type-colour);
    opacity: 0.16;
  }

  a.thing:hover::before {
    opacity: 0.3;
  }

  a.thing:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
