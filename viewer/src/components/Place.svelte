<script lang="ts">
  /**
   * Place (brand book, section 6, Shell): the frame every place fills. From 960px it takes what
   * the window leaves under the shell's rows and never scrolls as a whole: its main part scrolls
   * on its own (or, with `fill`, hands its whole height to what it holds) and `pane`, the
   * place's one right pane (Pane.svelte), sits beside it. Below 960px the place is one
   * scrolling column, the pane under the main part.
   */
  import type { Snippet } from "svelte";
  import type { PlaceId } from "../lib/places.js";

  let { id, fill = false, children, pane }: { id: PlaceId; fill?: boolean; children: Snippet; pane?: Snippet } = $props();
</script>

<main class="place" data-place={id}>
  <div class="main" class:fill>{@render children()}</div>
  {@render pane?.()}
</main>

<style>
  .place {
    flex: 1;
    box-sizing: border-box;
    min-inline-size: 0;
    min-block-size: 0;
    overflow: auto;
    background: var(--page);
    color: var(--ink);
  }

  .main {
    box-sizing: border-box;
    min-inline-size: 0;
  }

  .main:not(.fill) {
    padding: var(--space-4);
  }

  @media (width >= 960px) {
    .place {
      display: flex;
      overflow: hidden;
    }

    .main {
      flex: 1;
      min-block-size: 0;
      overflow: auto;
    }

    .main.fill {
      display: grid;
      overflow: hidden;
    }
  }
</style>
