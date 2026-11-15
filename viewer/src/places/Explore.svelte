<script lang="ts">
  /**
   * Explore: the graph round the thing the address names, filling the place, and the selected
   * thing's card in the pane. Search results drop down under the search field and open here;
   * with no thing open, the place points to the search.
   */
  import CardPicker from "../components/CardPicker.svelte";
  import EntityCard from "../components/EntityCard.svelte";
  import NeighbourhoodView from "../components/NeighbourhoodView.svelte";
  import Pane from "../components/Pane.svelte";
  import Place from "../components/Place.svelte";
  import TypeChip from "../components/TypeChip.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import Menu from "../components/ui/Menu.svelte";
  import { cardsText, pickOptions, startingCard, toggle } from "../lib/cardpick.js";
  import { typeOfId, type HoodState } from "../lib/graph/hood.js";
  import { sourcesFor } from "../lib/graph/session.js";
  import type { HoodChoices } from "../lib/route.js";
  import type { PlaceProps } from "./props.js";

  let {
    viewer,
    shape,
    links,
    hood,
    onhood,
  }: PlaceProps & {
    /** The graph's choices the address holds (G-8), for the graph to open. */
    hood: HoodChoices | null;
    /** Each choice made in the graph, for the address to follow. */
    onhood: (state: HoodState) => void;
    /** The shell's tabs for a narrow page: Explore has none, its card is under its graph. */
    picked?: string | null;
    onpick?: (tab: string) => void;
  } = $props();

  let graph = $state<NeighbourhoodView | null>(null);
  /** The thing a person selected round a centre; a new centre is selected itself. */
  let chosen = $state<{ centre: string; id: string } | null>(null);
  const selected = $derived(viewer.nodeId === null ? null : chosen?.centre === viewer.nodeId ? chosen.id : viewer.nodeId);
  const missing = $derived(viewer.page !== null && "message" in viewer.page ? viewer.page : null);
  const open = $derived(viewer.file !== null && viewer.nodeId !== null && missing === null);

  /** Cards read once and kept for the session; bumped when one arrives, so it is shown. */
  const read = $derived(viewer.file === null ? null : sourcesFor(viewer.file, shape));
  let arrived = $state(0);
  $effect(() => {
    const id = selected;
    if (id === null || read === null) return;
    const now = read.cardNow(id);
    if (now === null || "message" in now) void read.card(id).then(() => arrived++);
  });
  const card = $derived.by(() => {
    void arrived;
    return selected === null || read === null ? null : read.cardNow(selected);
  });
  const page = $derived(card !== null && "page" in card ? card.page : null);
  const type = $derived(page?.node.type ?? (selected === null ? null : typeOfId(selected)));

  /** The selected thing's type's card settings, and whether its picker is open. */
  const settings = $derived(viewer.file === null || type === null ? null : startingCard(viewer.view, viewer.file, type));
  let picking = $state(false);
  const menu = $derived.by(() => {
    if (settings === null) return [];
    const name = shape.typeLabel(settings.name);
    const items = [{ label: picking ? "Hide the card settings" : `Choose what ${name} cards show`, onselect: () => void (picking = !picking) }];
    if (viewer.chosen.includes(settings.name)) items.push({ label: "Back to the view file's card", onselect: () => void viewer.resetCard(settings.name) });
    return items;
  });

  function select(id: string): void {
    if (viewer.nodeId !== null) chosen = { centre: viewer.nodeId, id };
  }

  /** A linked thing picked on the card: selected in the graph when it is drawn there, else opened. */
  function pick(id: string): boolean {
    if (!graph?.has(id)) return false;
    select(id);
    return true;
  }
</script>

<Place id="explore" fill>
  {#if viewer.file === null || viewer.nodeId === null}
    <div class="none"><EmptyState message="No thing is open. Search for one in the field above, then pick a result to see it and what it links to." /></div>
  {:else if missing !== null}
    <div class="missing">
      <p class="banner body-app" role="alert">{missing.message}</p>
      {#if missing.suggestions.length > 0}
        <p class="caption">Closest:</p>
        <ul class="suggestions code">
          {#each missing.suggestions as id (id)}
            <li><a href={links.thing(id)}>{id}</a></li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <NeighbourhoodView bind:this={graph} file={viewer.file} {shape} centre={viewer.nodeId} {selected} onselect={select} address={hood} onchoices={onhood} />
  {/if}
  {#snippet pane()}
    {#if open && viewer.file !== null}
      <Pane place="explore" label="Selection" strip={page === null ? selected : (page.node.label ?? page.node.id)} aria-live="polite">
        {#snippet head()}
          {#if type !== null}
            <span class="kind"><TypeChip {type} label={shape.typeLabel(type)} /></span>
            <Menu label="Card settings: choose what {shape.typeLabel(type)} cards show" items={menu} />
          {/if}
        {/snippet}
        {#if settings !== null}
          <CardPicker
            type={settings.name}
            options={pickOptions(viewer.file, settings.name)}
            card={settings}
            chosen={viewer.chosen.includes(settings.name)}
            text={cardsText(viewer.view.cards?.length ? viewer.view.cards : [settings])}
            {shape}
            button={false}
            bind:open={picking}
            onpick={(part, name, on) => void viewer.chooseCard(toggle(settings, part, name, on))}
            onreset={() => void viewer.resetCard(settings.name)}
          />
        {/if}
        {#if card === null}
          <p class="caption muted" role="status">Reading its card…</p>
        {:else if "message" in card}
          <p class="banner body-app" role="alert">Could not read its card: {card.message}</p>
        {:else}
          <EntityCard
            node={card.page.node}
            {shape}
            facts={card.facts}
            links={card.page.links}
            sources={{ rows: card.page.sources, total: card.page.sourcesTotal }}
            chip={false}
            hrefFor={links.thing}
            tableHref={links.type(card.page.node.type)}
            trailHref={links.trail({ start: card.page.node.type, pin: card.page.node.id, steps: [], show: "columns", at: 1, sort: null, filters: [] })}
            onpick={pick}
          />
        {/if}
      </Pane>
    {/if}
  {/snippet}
</Place>

<style>
  .none {
    align-self: center;
  }

  .missing {
    padding: var(--space-4);
  }

  .kind {
    flex: 1;
    min-inline-size: 0;
  }

  .muted {
    margin: 0;
    color: var(--ink-muted);
  }

  .banner {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  .suggestions {
    margin: 0;
    padding-inline-start: var(--space-6);
  }
</style>
