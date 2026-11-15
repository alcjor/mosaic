<script lang="ts">
  /**
   * A bundle opened (need G-4): the things a group folds away, as far as the kit lists
   * them. That is the first 20 with their pages and how many there are in all. The rest come as
   * every name, when the kit gives them all (links leaving the thing), or as a table (links
   * reaching it), or the list says that the kit lists only these (how each is found is in
   * lib/graph/hood.ts).
   */
  import Button from "./ui/Button.svelte";
  import type { Bundle } from "../lib/graph/hood.js";
  import { once } from "../lib/graph/hoodview.js";
  import { noun, number } from "../lib/graph/mapview.js";
  import type { TableRoute } from "../lib/route.js";

  let {
    bundle,
    name,
    hrefFor,
    tableHref,
  }: {
    bundle: Bundle;
    /** The group's name: its edge type's name, as the view file gives it. */
    name: string;
    hrefFor: (id: string) => string;
    tableHref: (table: TableRoute) => string;
  } = $props();

  const owner = $derived(bundle.owner.label ?? bundle.owner.id);
  const rest = $derived(bundle.total - bundle.things.length);
  /** The things the links listed lead to, each once (two links to one thing are one row). */
  const things = $derived(once(bundle.things));
</script>

<div class="bundle">
  <p class="body-screen">
    <span class="code">{bundle.direction === "in" ? "← " : ""}{name}</span>
    {bundle.direction === "in" ? "links reaching" : "links from"}
    {owner}:
    <span class="figure">{number(bundle.things.length)} of {number(bundle.total)}</span>
    {noun(bundle.total, "link", "links")}
  </p>
  {#if things.length < bundle.things.length}
    <p class="caption muted">
      {#if things.length === 1}
        The first {number(bundle.things.length)} links all lead to this one thing.
      {:else}
        The first {number(bundle.things.length)} links lead to these {number(things.length)} things: some lead to one thing more than once.
      {/if}
    </p>
  {/if}
  <ol class="things">
    {#each things as thing (thing.id)}
      <li><a class="row body-screen" href={hrefFor(thing.id)}>{thing.label ?? thing.id}</a></li>
    {/each}
  </ol>
  {#if rest > 0}
    {#if bundle.allLabels}
      <p class="caption muted">Every one by name ({number(bundle.allLabels.length)}; one name for each thing, however many links lead to it):</p>
      <p class="names body-screen">
        {#each bundle.allLabels as label, i (i)}{#if i > 0}<span class="dot" aria-hidden="true"> · </span>{/if}<span class="each">{label ?? "(no name)"}</span>{/each}
      </p>
    {:else if bundle.table}
      <Button variant="primary" href={tableHref(bundle.table)}>Open the rest as a table</Button>
      {#if bundle.byName}
        <p class="caption muted">
          The table finds them by its name, so a thing linked to another whose name holds “{owner}” is listed too.
        </p>
      {/if}
    {:else}
      <p class="caption muted">The kit lists the first {number(bundle.things.length)} links; the other {number(rest)} cannot be listed here.</p>
    {/if}
  {/if}
</div>

<style>
  .bundle p {
    margin: var(--space-2) 0;
  }

  .things {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .names {
    padding-inline-start: var(--space-3);
    color: var(--ink);
  }

  .dot {
    color: var(--ink-muted);
  }

  .row {
    display: block;
    overflow-wrap: anywhere;
    padding: var(--space-1) var(--space-3);
    border-inline-start: 3px solid transparent;
    color: var(--ink);
    text-decoration: none;
  }

  .row:hover {
    background: var(--surface-tint);
  }

  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .figure {
    font-family: var(--font-mono);
    color: var(--heading);
  }

  .code {
    font-family: var(--font-mono);
  }

  .muted {
    color: var(--ink-muted);
  }
</style>
