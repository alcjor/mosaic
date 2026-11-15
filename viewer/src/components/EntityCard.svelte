<script lang="ts">
  /**
   * EntityCard (brand book, section 6): one thing's card, as its type's card sets it
   * (V-6, V-7, V-9): its label, type and id, then its facts, each with a CitationChip that
   * opens the rows behind it (V-8). Then its aliases and external references.
   *
   * The facts come from lib/cards.ts. Until they are given (or where a caller has none), the
   * card shows the thing's summary and properties as M3's node page did: those the view file's
   * `page` names, in that order, under its labels.
   */
  import type { GetData } from "@mosaic/kit";
  import { factId, plainFacts, type Fact } from "../lib/cards.js";
  import type { Shape } from "../lib/view.js";
  import CitationChip from "./CitationChip.svelte";
  import TypeChip from "./TypeChip.svelte";

  let {
    node,
    shape = null,
    facts = null,
    hrefFor = null,
  }: {
    node: GetData;
    shape?: Shape | null;
    /** The thing's card facts with their rows (lib/cards.ts), or null for the plain card. */
    facts?: readonly Fact[] | null;
    /** Where a linked thing's page is. */
    hrefFor?: ((id: string) => string) | null;
  } = $props();

  /** A property value as text: strings as they are, anything else as JSON. */
  function shown(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  let all = $derived(facts ?? plainFacts(node, shape));
  let summaries = $derived(all.filter((f) => f.kind === "summary"));
  let rows = $derived(all.filter((f) => f.kind !== "summary"));
  /** The plain card shows the summary as M3's did, before the facts. */
  let plainSummary = $derived(facts === null ? node.summary : null);


  function edgeName(edge: string, direction: "out" | "in"): string {
    const label = shape?.edgeLabel(node.type, edge) ?? edge;
    return direction === "in" ? `← ${label}` : label;
  }
</script>

<article class="card" aria-label={node.id}>
  <!-- The padding sits inside, so the card's facts lay out by its whole width. -->
  <div class="inner">
    <h1 class="title category">{node.label ?? node.id}</h1>
    <p class="kind"><TypeChip type={node.type} label={shape?.typeLabel(node.type) ?? null} /> <span class="id code">{node.id}</span></p>
    {#if plainSummary !== null}
      <p class="summary body-screen">{plainSummary}</p>
    {/if}
    {#each summaries as fact, i (i)}
      {#if fact.kind === "summary"}
        <div class="summary body-screen" data-fact="summary">
          <p class="text">{fact.value}</p>
          {#if fact.evidence !== null}
            <CitationChip sections={[{ title: null, evidence: fact.evidence }]} />
          {/if}
        </div>
      {/if}
    {/each}

    {#if rows.length > 0}
      <h2 class="heading section-label">{facts === null ? "Properties" : "Facts"}</h2>
      <dl class="facts body-screen">
        {#each rows as fact (factId(fact))}
          <div class="fact" data-fact={factId(fact)}>
            {#if fact.kind === "property"}
              <dt class="key" data-prop={fact.name}>{shape?.label(node.type, fact.name) ?? fact.name}</dt>
              <dd class="value" class:mono={typeof fact.value !== "string"}>{shown(fact.value)}</dd>
              {#if fact.evidence !== null}
                <dd class="cite"><CitationChip sections={[{ title: null, evidence: fact.evidence }]} /></dd>
              {/if}
            {:else if fact.kind === "links"}
              <dt class="key" data-edge={fact.edge}>{edgeName(fact.edge, fact.direction)}</dt>
              <dd class="value wide">
                {#if fact.things.length === 0}
                  <span class="none">none</span>
                {:else}
                  <ul class="things">
                    {#each fact.things as thing (`${thing.id} ${thing.qualifier ?? ""}`)}
                      <li class="thing">
                        {#if hrefFor}
                          <a class="link" href={hrefFor(thing.id)} data-id={thing.id}>{thing.label ?? thing.id}</a>
                        {:else}
                          <span class="link" data-id={thing.id}>{thing.label ?? thing.id}</span>
                        {/if}
                        <CitationChip sections={[{ title: null, evidence: thing.evidence }]} />
                      </li>
                    {/each}
                  </ul>
                  {#if fact.total > fact.things.length}
                    <p class="more caption">and {fact.total - fact.things.length} more</p>
                  {/if}
                {/if}
              </dd>
            {:else if fact.kind === "count"}
              <dt class="key" data-edge={fact.edge}>{edgeName(fact.edge, fact.direction)}</dt>
              <dd class="value mono">{fact.count}</dd>
              {#if fact.things.length > 0}
                <dd class="cite"><CitationChip sections={fact.things.map((t) => ({ title: t.label ?? t.id, evidence: t.evidence }))} /></dd>
              {/if}
            {/if}
          </div>
        {/each}
      </dl>
    {/if}

    {#if node.aliases.length > 0}
      <h2 class="heading section-label">Also known as</h2>
      <ul class="aliases body-screen">
        {#each node.aliases as alias (alias)}
          <li>{alias}</li>
        {/each}
      </ul>
      {#if node.aliases_total > node.aliases.length}
        <p class="more caption">and {node.aliases_total - node.aliases.length} more</p>
      {/if}
    {/if}

    {#if node.external_refs.length > 0}
      <h2 class="heading section-label">External references</h2>
      <ul class="refs code">
        {#each node.external_refs as ref, i (i)}
          <li><span class="ref-chip">{ref.system} · {ref.kind}</span> {JSON.stringify(ref.locator)}</li>
        {/each}
      </ul>
    {/if}
  </div>
</article>

<style>
  .card {
    /* A card lays its facts out by its own whole width, wherever it is and whatever the page's
       width: its container has no padding, so the width measured is the card's. */
    container-type: inline-size;
  }

  .inner {
    padding: var(--space-5);
  }

  .title {
    margin: 0;
    color: var(--heading);
    overflow-wrap: anywhere;
  }

  .kind {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
  }

  .id {
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }

  .summary {
    margin: var(--space-4) 0 0;
  }

  .heading {
    margin: var(--space-5) 0 var(--space-2);
    color: var(--accent);
    text-transform: uppercase;
  }

  /* PropertyTable (§6): key in ink-muted, value in ink, hairlines in border. Each fact is a row of
     the grid: key, value, chip; a chip's rows open across the whole row, under it. A narrower
     card lays them out in fewer columns, by its own width (below). */
  .facts {
    display: grid;
    grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr) auto;
    margin: 0;
  }

  .fact {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    gap: 0 var(--space-3);
    padding: var(--space-1) 0;
    border-block-end: 1px solid var(--border);
  }

  .key {
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }

  .value {
    margin: 0;
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .value.wide {
    grid-column: 2 / -1;
  }

  .cite {
    display: contents;
  }

  .cite :global(.chip) {
    align-self: start;
    justify-self: end;
    max-inline-size: 16rem;
  }

  .cite :global(.rows) {
    grid-column: 1 / -1;
  }

  /* By the card's own width, never the page's. Under 40rem: the key takes its own row,
     above the value and its source chip. */
  @container (width < 40rem) {
    .facts {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .key,
    .value.wide {
      grid-column: 1 / -1;
    }
  }

  /* Under 30rem: key, value and chip each take the card's width, one under the other. */
  @container (width < 30rem) {
    .facts {
      grid-template-columns: minmax(0, 1fr);
    }

    .key,
    .value.wide {
      grid-column: 1 / -1;
    }
  }

  .mono {
    font-family: var(--font-mono);
  }

  .summary .text {
    margin: 0 0 var(--space-1);
  }

  .things {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .thing {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1);
  }

  .link {
    color: var(--accent);
  }

  .none {
    color: var(--ink-muted);
  }

  .aliases,
  .refs {
    margin: 0;
    padding-inline-start: var(--space-4);
  }

  .ref-chip {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--ink-muted);
  }

  .more {
    margin: var(--space-1) 0 0;
    color: var(--ink-muted);
  }
</style>
