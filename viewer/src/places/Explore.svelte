<script lang="ts">
  /**
   * Explore: the graph round the thing the address names, the selected thing's card in the pane
   * (inside NeighbourhoodView), and the search results that led there. Below 960px its parts are tabs.
   */
  import CardPicker from "../components/CardPicker.svelte";
  import NeighbourhoodView from "../components/NeighbourhoodView.svelte";
  import NodeContext from "../components/NodeContext.svelte";
  import Place from "../components/Place.svelte";
  import ResultList from "../components/ResultList.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import Tabs from "../components/ui/Tabs.svelte";
  import { cardsText, pickOptions, startingCard, toggle } from "../lib/cardpick.js";
  import type { HoodState } from "../lib/graph/hood.js";
  import type { NodeView } from "../lib/mosaic.js";
  import type { HoodChoices } from "../lib/route.js";
  import type { PlaceProps } from "./props.js";

  let {
    viewer,
    shape,
    narrow,
    links,
    hood,
    onhood,
    picked,
    onpick,
  }: PlaceProps & {
    /** The graph's choices the address holds (G-8), for the graph to open. */
    hood: HoodChoices | null;
    /** Each choice made in the graph, for the address to follow. */
    onhood: (state: HoodState) => void;
    /** The tab a person picked since the address last changed, if any. */
    picked: string | null;
    onpick: (tab: string) => void;
  } = $props();

  const tabs = [
    { value: "results", label: "Results" },
    { value: "graph", label: "Graph" },
    { value: "card", label: "Card" },
  ];
  /** The tab shown below 960px: the one picked, else what the address opened. */
  let tab = $derived(picked !== null && tabs.some((t) => t.value === picked) ? picked : viewer.nodeId !== null ? "card" : "results");
</script>

{#snippet context(page: NodeView)}
  {#if viewer.file !== null}
    {@const card = startingCard(viewer.view, viewer.file, page.node.type)}
    <CardPicker
      type={card.name}
      options={pickOptions(viewer.file, card.name)}
      {card}
      chosen={viewer.chosen.includes(card.name)}
      text={cardsText(viewer.view.cards?.length ? viewer.view.cards : [card])}
      shape={viewer.shape}
      onpick={(part, name, on) => void viewer.chooseCard(toggle(card, part, name, on))}
      onreset={() => void viewer.resetCard(card.name)}
    />
    <aside aria-label="Links and sources">
      <NodeContext view={page} hrefFor={links.thing} shape={viewer.shape} />
    </aside>
  {/if}
{/snippet}

<Place id="explore" fill>
  <div class="explore">
    {#if narrow}
      <div class="tabs"><Tabs {tabs} value={tab} label="Explore" onchange={onpick} /></div>
    {/if}
    <nav class="results" aria-label="Results" hidden={narrow && tab !== "results"}>
      {#if viewer.results}
        <ResultList view={viewer.results} selected={viewer.nodeId} hrefFor={links.thing} typeLabel={(type) => shape.typeLabel(type)} />
      {:else}
        <EmptyState message="Search for a name, an alias or words in the text." />
      {/if}
    </nav>
    <div class="graph" hidden={narrow && tab === "results"}>
      {#if viewer.file === null || viewer.nodeId === null}
        <EmptyState message="No thing is open. Search for one in the field above, then pick a result to see it and what it links to." />
      {:else if viewer.page && "message" in viewer.page}
        <div class="missing">
          <p class="banner body-screen" role="alert">{viewer.page.message}</p>
          {#if viewer.page.suggestions.length > 0}
            <p class="caption">Closest:</p>
            <ul class="suggestions code">
              {#each viewer.page.suggestions as id (id)}
                <li><a href={links.thing(id)}>{id}</a></li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        <NeighbourhoodView
          file={viewer.file}
          {shape}
          centre={viewer.nodeId}
          hrefFor={links.thing}
          tableHref={links.table}
          hoodHref={links.thing}
          address={hood}
          onchoices={onhood}
          only={narrow ? (tab === "card" ? "card" : "graph") : null}
          extra={context}
        />
      {/if}
    </div>
  </div>
</Place>

<style>
  .explore {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    min-inline-size: 0;
  }

  [hidden] {
    display: none;
  }

  .tabs {
    padding: var(--space-2) var(--space-4) 0;
  }

  .results,
  .graph {
    min-inline-size: 0;
    background: var(--surface);
  }

  .missing {
    padding: 0 var(--space-4);
  }

  .banner {
    margin: var(--space-3) 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  .suggestions {
    margin: 0;
    padding-inline-start: var(--space-6);
  }

  /* From 960px: the results beside the graph, each scrolling on its own. */
  @media (width >= 960px) {
    .explore {
      grid-template-columns: 280px minmax(0, 1fr);
      align-content: stretch;
      min-block-size: 0;
    }

    .results {
      overflow: auto;
      border-inline-end: 1px solid var(--border);
    }

    .graph {
      display: grid;
      min-block-size: 0;
      overflow: hidden;
    }
  }
</style>
