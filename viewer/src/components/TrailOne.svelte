<script lang="ts">
  /**
   * A trail one result at a time: the result as a row of full cards, one per place, each the
   * type's own card as "what cards show" sets it, with its sources (EntityCard), joined by the
   * names of the links between them. Previous and Next, or the left and right arrow keys, move
   * through the results read; the strip under the cards lists them all, to jump to one.
   */
  import type { FullCard } from "../lib/trailcards.svelte.js";
  import type { TrailColumns } from "../lib/trailcolumns.js";
  import type { Shape } from "../lib/view.js";
  import EntityCard from "./EntityCard.svelte";
  import Button from "./ui/Button.svelte";
  import EmptyState from "./ui/EmptyState.svelte";

  let {
    trail,
    at,
    total = null,
    shape = null,
    hrefFor,
    full,
    open,
    onat,
  }: {
    trail: TrailColumns;
    /** The result shown, from 0; beyond the last one read, the last shows. */
    at: number;
    /** How many results the chain has, once counted. */
    total?: number | null;
    shape?: Shape | null;
    hrefFor: (id: string) => string;
    /** Each thing's full card, by id, once read. */
    full: ReadonlyMap<string, FullCard>;
    /** Ask for the full card of a thing. */
    open: (id: string) => void;
    onat: (at: number) => void;
  } = $props();

  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let count = $derived(trail.results.length);
  let i = $derived(Math.max(0, Math.min(at, count - 1)));
  let result = $derived(trail.results[i] ?? null);
  /** The places a strip card names: those left open, or every place when all are pinned. */
  let named = $derived.by(() => {
    const open = trail.columns.flatMap((c, place) => (c.pin === null ? [place] : []));
    return open.length > 0 ? open : trail.columns.map((_, place) => place);
  });

  $effect(() => {
    for (const thing of result?.things ?? []) open(thing.id);
  });

  let strip = $state<HTMLElement>();
  $effect(() => {
    strip?.querySelector(`[data-result="${i}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  /** Left and right move through the results, unless the key is for a field or an open menu. */
  function key(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, select, textarea, [role='menu'], [role='dialog'], [contenteditable]")) return;
    if (event.key === "ArrowLeft" && i > 0) onat(i - 1);
    else if (event.key === "ArrowRight" && i < count - 1) onat(i + 1);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={key} />

<section class="one-at-a-time" aria-label="Trail one result at a time">
  {#if result === null}
    <EmptyState message="Nothing here: the trail has no result." />
  {:else}
    <div class="nav">
      <Button label="Previous result" disabled={i === 0} onclick={() => onat(i - 1)}>‹ Previous</Button>
      <strong class="where label-app" role="status">Result {figure(i + 1)} of {figure(trail.partial ? Math.max(total ?? 0, count) : count)}</strong>
      <Button label="Next result" disabled={i >= count - 1} onclick={() => onat(i + 1)}>Next ›</Button>
      <span class="hint caption">or use the arrow keys</span>
      {#if trail.partial}<span class="hint caption">· the first {figure(count)} results show here; the table has them all</span>{/if}
    </div>
    <div class="one"><div class="row">
      {#each result.things as thing, place (place)}
        {@const column = trail.columns[place]!}
        {@const card = full.get(thing.id)}
        {#if column.step}
          <div class="via caption">
            <span>{column.step.direction === "in" ? "← " : ""}{shape?.edgeLabel(column.step.from, column.step.edge) ?? column.step.edge}</span>
            <i></i>
          </div>
        {/if}
        <div class="big" data-place={place} data-id={thing.id}>
          {#if card !== undefined && "node" in card}
            <EntityCard node={card.node} {shape} facts={card.facts} {hrefFor} />
          {:else}
            <div class="waiting">
              <strong class="panel-title">{thing.label ?? thing.id}</strong>
              <span class="hint caption">{card === undefined ? "Reading the card…" : `The card could not be read: ${card.error}`}</span>
            </div>
          {/if}
          <span class="grow"></span>
          <div class="foot"><Button variant="ghost" href={hrefFor(thing.id)}>Open in Explore</Button></div>
        </div>
      {/each}
    </div></div>
    <h2 class="label section-label">All results</h2>
    <div class="strip" bind:this={strip}>
      {#each trail.results as r, n (n)}
        <button class="mini" class:on={n === i} type="button" aria-current={n === i ? "true" : undefined} data-result={n} onclick={() => onat(n)}>
          <strong class="label-app">{r.things[named[0]!]?.label ?? r.things[named[0]!]?.id}</strong>
          <span class="hint caption"
            >{named
              .slice(1)
              .map((place) => r.things[place]?.label ?? r.things[place]?.id)
              .join(" · ") || " "}</span
          >
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .one-at-a-time {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    min-block-size: 0;
    min-inline-size: 0;
  }

  .nav {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .where {
    color: var(--heading);
  }

  .hint {
    color: var(--ink-muted);
  }

  /* The cards take their own height, and scroll together when the place is shorter. */
  .one {
    flex: 0 1 auto;
    min-block-size: 0;
    overflow: auto;
  }

  .row {
    display: flex;
    align-items: stretch;
    min-inline-size: min-content;
  }

  .big {
    display: flex;
    flex: 1 0 280px;
    flex-direction: column;
    min-inline-size: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .waiting {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .grow {
    flex: 1;
  }

  .foot {
    padding: 0 var(--space-3) var(--space-3);
  }

  .via {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    inline-size: 120px;
    color: var(--ink-muted);
    text-align: center;
  }

  .via i {
    display: block;
    inline-size: 100%;
    block-size: 2px;
    background: var(--border);
  }

  .label {
    flex: none;
    margin: 0;
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .strip {
    display: flex;
    flex: none;
    gap: var(--space-2);
    padding: var(--space-1);
    overflow-x: auto;
  }

  .mini {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-1);
    inline-size: 220px;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--heading);
    text-align: start;
    cursor: pointer;
  }

  .mini strong,
  .mini span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .mini:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
