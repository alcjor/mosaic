<script lang="ts">
  /**
   * The shell's view switcher (brand book, section 6, Shell): the views of the whole
   * mosaic on the left, and a Card / Graph / Table switch for the current thing on the right.
   * A view that is offered but cannot be opened now (not built yet, or with no thing to show)
   * stays in its place, disabled, and says why: the note is its description, and activating it
   * shows the note in the bar, so nothing unbuilt is presented as available.
   */
  import { THING_VIEWS, VIEWS, type ThingViewId, type ViewId } from "../lib/views.js";

  let {
    view = null,
    thing = null,
    viewHref,
    thingHref,
    thingNote,
  }: {
    /** The view of the whole mosaic that is open, or null. */
    view?: ViewId | null;
    /** How the current thing is shown, or null when no thing is shown. */
    thing?: ThingViewId | null;
    viewHref: (id: ViewId) => string;
    /** Where Card or Table leads, or null when it cannot be opened now. */
    thingHref: (id: ThingViewId) => string | null;
    /** Why Card or Table cannot be opened now. */
    thingNote: (id: ThingViewId) => string;
  } = $props();

  /** The note shown after a disabled view was activated. */
  let said = $state("");
</script>

{#snippet item(kind: "view" | "thing", id: string, label: string, href: string | null, note: string, current: boolean)}
  {#if href !== null}
    <a
      class="item body-screen"
      class:current
      {href}
      aria-current={current ? "page" : undefined}
      data-view={kind === "view" ? id : undefined}
      data-thing={kind === "thing" ? id : undefined}>{label}</a
    >
  {:else}
    <button
      class="item body-screen"
      class:current
      type="button"
      aria-disabled="true"
      aria-current={current ? "page" : undefined}
      aria-describedby="note-{kind}-{id}"
      title={note}
      data-view={kind === "view" ? id : undefined}
      data-thing={kind === "thing" ? id : undefined}
      onclick={() => (said = note)}>{label}</button
    >
    <span id="note-{kind}-{id}" hidden>{note}</span>
  {/if}
{/snippet}

<nav class="bar" aria-label="Views">
  <div class="views">
    {#each VIEWS as v (v.id)}
      {@render item("view", v.id, v.label, v.available ? viewHref(v.id) : null, v.note, v.id === view)}
    {/each}
  </div>
  <p class="said caption" role="status">{said}</p>
  <div class="things" role="group" aria-label="Show the current thing as">
    {#each THING_VIEWS as t (t.id)}
      {@const href = t.available ? thingHref(t.id) : null}
      {@render item("thing", t.id, t.label, href, t.available ? thingNote(t.id) : t.note, t.id === thing)}
    {/each}
  </div>
</nav>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border-block-end: 1px solid var(--border);
    background: var(--surface);
  }

  .views,
  .things {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .said {
    flex: 1;
    min-inline-size: 0;
    margin: 0;
    color: var(--ink-muted);
  }

  .item {
    padding: var(--space-1) var(--space-3);
    border: none;
    border-block-end: 2px solid transparent;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .item:hover:not([aria-disabled="true"], .current) {
    background: var(--surface-tint);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .item.current {
    border-block-end-color: var(--accent);
    background: var(--surface-tint);
    color: var(--accent);
  }

  .item[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .things {
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .things .item {
    border-block-end: none;
    border-radius: var(--radius-md);
  }

  .things .item.current {
    background: var(--accent);
    color: var(--surface);
  }
</style>
