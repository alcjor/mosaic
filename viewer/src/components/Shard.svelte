<script lang="ts">
  /**
   * Shard: the small irregular piece that stands for a type, in the type's colour
   * (lib/typecolour.ts). `colour` overrides what the shell provides for `type`.
   */
  import { typeColours } from "../lib/typecolour.context.js";

  let { type = null, colour = null, size = "small" }: { type?: string | null; colour?: number | null; size?: "small" | "large" } = $props();

  const colourOf = typeColours();
  let shown = $derived(colour ?? (type === null ? null : colourOf(type)));
</script>

<span class="shard" class:large={size === "large"} data-type-colour={shown} aria-hidden="true"></span>

<style>
  .shard {
    flex: none;
    display: inline-block;
    inline-size: 10px;
    block-size: 10px;
    background: var(--type-colour);
    clip-path: polygon(50% 0, 96% 24%, 86% 82%, 40% 100%, 4% 68%, 12% 18%);
  }

  .large {
    inline-size: 16px;
    block-size: 16px;
  }
</style>
