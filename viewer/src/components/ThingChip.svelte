<script lang="ts">
  /** A linked thing as a chip in its type's colour: its type's shard and its name, opening the thing. */
  import { typeColours } from "../lib/typecolour.context.js";
  import Shard from "./Shard.svelte";

  let { id, label, type, href }: { id: string; label: string | null; type: string | null; href: string } = $props();

  const colourOf = typeColours();
</script>

<a class="thing" {href} data-id={id} data-type-colour={type === null ? null : colourOf(type)}><Shard {type} />{label ?? id}</a>

<style>
  .thing {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    position: relative;
    isolation: isolate;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--ink);
    text-decoration: none;
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

  .thing:hover::before {
    opacity: 0.3;
  }

  .thing:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
