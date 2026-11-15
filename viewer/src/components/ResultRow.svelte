<script lang="ts">
  /**
   * One result of a chain as a row of cards (V-7, V-8, V-10, V-13): which result it
   * is, of how many, with buttons to the first, the one before and the one after, in the chain's
   * order; then one card per place, each its type's card (EntityCard), joined by the
   * links between them, each named with its direction and with a CitationChip that opens its rows.
   * Wide screens lay the row out across, scrolling inside it; a phone stacks it. While the table
   * sorts or filters the results, the row moves among the rows its filters keep, in its
   * order, and says how many match, of how many results; when the table's last filter dropped the
   * result that was open, one line says so.
   */
  import type { ChainCount } from "../lib/viewer.svelte.js";
  import type { ResultRow } from "../lib/resultcards.js";
  import type { Shape } from "../lib/view.js";
  import CitationChip from "./CitationChip.svelte";
  import EntityCard from "./EntityCard.svelte";

  let {
    row,
    index,
    count,
    onmove,
    shape = null,
    hrefFor = null,
    arranged = null,
    notice = null,
  }: {
    row: ResultRow;
    /** The result shown, from 0. */
    index: number;
    count: ChainCount | null;
    onmove: (index: number) => void;
    shape?: Shape | null;
    hrefFor?: ((id: string) => string) | null;
    /** While the table sorts or filters: how many rows its filters keep, of how many results. */
    arranged?: { readonly matching: number; readonly total: number } | null;
    /** One line said above the row, e.g. that the result open before a filter no longer matches. */
    notice?: string | null;
  } = $props();

  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  /** How many there are, as far as known: the result shown is one, so at least that many. */
  let of = $derived(
    arranged !== null
      ? ` of ${figure(arranged.matching)} that match, of ${count !== null && !(count.done && count.exact) ? `at least ${figure(Math.max(count.total, arranged.total))}` : figure(arranged.total)} results`
      : count === null
        ? ""
        : count.done && count.exact
          ? ` of ${figure(count.total)}`
          : ` of at least ${figure(Math.max(count.total, index + 1))}`,
  );
  let last = $derived(arranged !== null ? index + 1 >= arranged.matching : count !== null && count.done && index + 1 >= count.total);

  const edgeName = (from: string, edge: string) => shape?.edgeLabel(from.slice(0, from.indexOf(":")), edge) ?? edge;
</script>

<section class="results" aria-label="Results">
  <nav class="move" aria-label="Move between results">
    <p class="which category" role="status" aria-live="polite">Result {figure(index + 1)}{of}</p>
    {#if notice !== null}<p class="notice caption" role="status">{notice}</p>{/if}
    <button class="secondary step-title" type="button" disabled={index === 0} onclick={() => onmove(0)}>First</button>
    <button class="secondary step-title" type="button" disabled={index === 0} onclick={() => onmove(index - 1)}>Previous</button>
    <button class="secondary step-title" type="button" disabled={last} onclick={() => onmove(index + 1)}>Next</button>
  </nav>
  <ol class="row">
    {#each row.things as thing, i (i)}
      <li class="place">
        {#if "node" in thing.page}
          <EntityCard node={thing.page.node} {shape} facts={thing.facts} {hrefFor} />
        {:else}
          <p class="failed caption">{thing.id}: {thing.page.message}</p>
        {/if}
      </li>
      {#if row.links[i] !== undefined}
        {@const link = row.links[i]!}
        <li class="link" data-link={i}>
          <span class="edge caption">{link.direction === "out" ? `${edgeName(link.from, link.edge)} →` : `← ${edgeName(link.from, link.edge)}`}</span>
          {#if link.qualifier}<span class="qualifier code">{link.qualifier}</span>{/if}
          <CitationChip sections={[{ title: null, evidence: link.evidence }]} />
          {#if link.pairWide}
            <p class="pair caption">Its rows are those of every {edgeName(link.from, link.edge)} link between these two: the kit does not show which one this is.</p>
          {/if}
        </li>
      {/if}
    {/each}
  </ol>
</section>

<style>
  .results {
    display: grid;
    gap: var(--space-3);
    margin-block-start: var(--space-4);
  }

  .move {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .which {
    flex: 1 1 100%;
    margin: 0;
    color: var(--ink);
  }

  .notice {
    flex: 1 1 100%;
    margin: 0;
    color: var(--ink-muted);
  }

  .secondary {
    min-block-size: var(--space-6);
    padding: 0 var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--accent);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .secondary:hover:not(:disabled) {
    background: var(--surface-tint);
  }

  .secondary:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .row {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    margin: 0;
    padding: 0 0 var(--space-2);
    overflow-x: auto;
    list-style: none;
  }

  .place {
    flex: 0 0 auto;
    inline-size: 26rem;
    max-inline-size: 100%;
  }

  .link {
    display: grid;
    flex: 0 0 auto;
    gap: var(--space-1);
    justify-items: center;
    align-self: center;
    max-inline-size: 10rem;
    text-align: center;
  }

  .edge,
  .pair,
  .failed {
    margin: 0;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }

  .qualifier {
    overflow-wrap: anywhere;
  }

  @media (width < 600px) {
    .row {
      flex-direction: column;
      align-items: stretch;
      overflow-x: visible;
    }

    .place {
      inline-size: auto;
    }

    .link {
      align-self: center;
    }
  }
</style>
