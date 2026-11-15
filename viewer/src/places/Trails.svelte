<script lang="ts">
  /**
   * Trails: a chain, built in one line (TrailBuilder), shown three ways: all its cards in
   * columns, one per step (TrailCards); one result at a time (TrailOne); or as one table
   * (ResultTableView). The title is the saved trail's name when the chain is one the view file
   * saves, else its types in order; beside it, the counts, and "Save this trail": the view
   * file's `chains` text with this chain in it, to copy (the page cannot write the view file).
   */
  import Place from "../components/Place.svelte";
  import ResultTableView from "../components/ResultTableView.svelte";
  import TrailBuilder from "../components/TrailBuilder.svelte";
  import TrailCards from "../components/TrailCards.svelte";
  import TrailOne from "../components/TrailOne.svelte";
  import TrailPopover from "../components/TrailPopover.svelte";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { pin } from "../lib/chain.js";
  import { findThings, type Answer } from "../lib/placesearch.svelte.js";
  import { TrailCards as CardReader } from "../lib/trailcards.svelte.js";
  import { chainName, chainSettings, chainsText } from "../lib/viewchains.js";
  import type { PlaceProps } from "./props.js";

  let { viewer, links }: PlaceProps = $props();

  const id = $props.id();
  const VIEWS = [
    { show: "columns", name: "All cards" },
    { show: "one", name: "One at a time" },
    { show: "table", name: "Table" },
  ] as const;

  const typeName = (type: string) => viewer.shape?.typeLabel(type) ?? type;
  /** A number with its thousands marked, the same everywhere (no locale). */
  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const results = (n: number) => `${figure(n)} result${n === 1 ? "" : "s"}`;

  /** Things of `type` named like `query`, for pinning a chain's place: the kit's `find`. */
  function findIn(type: string, query: string): Promise<Answer> {
    return viewer.file === null ? Promise.resolve([]) : findThings(viewer.file, type, query);
  }

  /** The saved trail the chain is, pins and all, if the view file saves it. */
  let saved = $derived(viewer.chain === null ? null : (viewer.savedChains.find((s) => JSON.stringify(s.chain) === JSON.stringify(viewer.chain)) ?? null));
  let title = $derived(viewer.chain === null ? "Trails" : (saved?.name ?? chainName(viewer.chain, typeName)));

  let counted = $derived.by(() => {
    const count = viewer.chainCount;
    if (count === null) return "";
    if (!count.done) return `Counting: at least ${results(count.total)} so far`;
    return count.exact ? results(count.total) : `At least ${results(count.total)}`;
  });
  /** How many things each place holds, among the results read. */
  let held = $derived(
    (viewer.chainColumns?.columns ?? []).map((c) => `${figure(c.things.length)}${viewer.chainColumns!.partial ? "+" : ""} ${typeName(c.type)}`).join(" · "),
  );

  /** A thing's name where the columns hold it, for a pinned place of the builder. */
  function nameOf(thing: string): string {
    for (const c of viewer.chainColumns?.columns ?? []) {
      const found = c.things.find((t) => t.id === thing);
      if (found) return found.label ?? thing;
    }
    return thing;
  }

  /** What the cards read from the mosaic, kept while the mosaic and the view stay the same. */
  let cards = $derived(viewer.file === null ? null : new CardReader(viewer.file, viewer.shape));

  /** The label the person gave the trail to save; null for its title. */
  let label = $state<string | null>(null);
  let named = $derived(label !== null && label.trim() !== "" ? label.trim() : title);
  let text = $derived(viewer.chain === null ? "" : chainsText(viewer.view.chains ?? [], chainSettings(named, viewer.chain)));
  let area = $state<HTMLTextAreaElement>();
  let copied = $state("");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = "Copied. Paste it into the view file, in place of its chains section.";
    } catch {
      area?.select();
      copied = "The page cannot copy here: the text is selected, copy it with your keyboard.";
    }
  }
</script>

<Place id="trails" fill>
  {#if viewer.file}
    <div class="trails">
      <div class="head">
        <h1 class="title heading-app">{title}</h1>
        <p class="counts body-app" role="status" aria-live="polite">{counted}{counted !== "" && held !== "" ? " · " : ""}{held}</p>
        <span class="grow"></span>
        {#if viewer.chain !== null}
          <TrailPopover label="Save this trail" align="end">
            {#snippet trigger()}Save this trail{/snippet}
            <label class="section-label" for="{id}-label">Name</label>
            <input class="field body-app" id="{id}-label" type="text" value={named} oninput={(e) => (label = e.currentTarget.value)} />
            <p class="note caption">
              The page cannot change the view file: copy the text below into it, in place of its chains section. A trail of this name there is replaced; the
              others are kept.
            </p>
            <label class="section-label" for="{id}-text">View file text</label>
            <textarea class="text code" id="{id}-text" readonly wrap="off" rows={Math.min(14, text.split("\n").length)} value={text} bind:this={area}></textarea>
            <div class="actions">
              <Button onclick={copy}>Copy the text</Button>
              <p class="note caption" role="status">{copied}</p>
            </div>
          </TrailPopover>
        {/if}
      </div>
      {#if viewer.chainCount !== null && viewer.chainCount.done && viewer.chainCount.notes.length > 0}
        <ul class="notes caption">
          {#each viewer.chainCount.notes as note, i (i)}<li>{note}</li>{/each}
        </ul>
      {/if}
      <TrailBuilder
        schema={viewer.file}
        chain={viewer.chain}
        shape={viewer.shape}
        onchange={(c) => viewer.chooseChain(c)}
        find={findIn}
        searches={viewer.searches}
        {nameOf}
      >
        {#if viewer.chain !== null}
          <span class="show-as" role="group" aria-label="Show the trail as">
            {#each VIEWS as v (v.show)}
              <button class="view section-label" type="button" aria-pressed={viewer.chainShow === v.show} onclick={() => void viewer.showChainAs(v.show)}>{v.name}</button>
            {/each}
          </span>
        {/if}
      </TrailBuilder>
      {#if viewer.chain === null}
        <div class="empty">
          <EmptyState message="Choose a type to start a trail from, then add steps along its links." />
          {#if viewer.savedChains.length > 0}
            <nav class="saved" aria-label="Saved trails">
              <h2 class="section-label">Saved trails</h2>
              <ul class="saved-list">
                {#each viewer.savedChains as s (s.name)}
                  <li><Button onclick={() => viewer.chooseChain(s.chain)}>{s.name}</Button></li>
                {/each}
              </ul>
            </nav>
          {/if}
        </div>
      {:else}
        {@const chain = viewer.chain}
        {#if viewer.chainShow === "table" && viewer.chainTable !== null}
          <div class="table"><ResultTableView table={viewer.chainTable} count={viewer.chainCount} hrefFor={links.thing} /></div>
        {:else if viewer.chainFailure !== null}
          <p class="banner body-app" role="alert">{viewer.chainFailure}</p>
        {:else if viewer.chainColumns !== null && cards !== null}
          {#if viewer.chainShow === "one"}
            <TrailOne
              trail={viewer.chainColumns}
              at={viewer.chainAt}
              total={viewer.chainCount?.done ? viewer.chainCount.total : null}
              shape={viewer.shape}
              hrefFor={links.thing}
              full={cards.full}
              open={(thing) => cards.open(thing)}
              onat={(at) => (viewer.chainAt = at)}
            />
          {:else}
            <TrailCards
              trail={viewer.chainColumns}
              shape={viewer.shape}
              hrefFor={links.thing}
              onpin={(place, thing) => viewer.chooseChain(pin(chain, place === 0 ? "start" : place - 1, thing))}
              lines={cards.lines}
              want={(ids) => cards.want(ids)}
            />
          {/if}
        {:else}
          <p class="note caption" role="status">Reading the trail…</p>
        {/if}
      {/if}
    </div>
  {/if}
</Place>

<style>
  /* The place's whole height: the title and the builder keep theirs, the view takes the rest and scrolls inside. */
  .trails {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-sizing: border-box;
    min-block-size: 0;
    min-inline-size: 0;
    padding: var(--space-4);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .title {
    margin: 0;
    color: var(--heading);
    font-weight: bold;
    overflow-wrap: anywhere;
  }

  .counts,
  .note,
  .notes {
    margin: 0;
    color: var(--ink-muted);
  }

  .notes {
    padding-inline-start: var(--space-4);
  }

  .grow {
    flex: 1;
  }

  .show-as {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .view {
    block-size: 28px;
    padding: 0 var(--space-3);
    border: 0;
    background: var(--surface);
    color: var(--ink-muted);
    letter-spacing: 0;
    white-space: nowrap;
    cursor: pointer;
  }

  .view[aria-pressed="true"] {
    background: var(--selection);
    color: var(--heading);
  }

  .view:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .empty {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
  }

  .table {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-block-size: 0;
  }

  .saved {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
  }

  .saved h2 {
    margin: 0;
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .saved-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .field,
  .text {
    box-sizing: border-box;
    inline-size: 100%;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .text {
    resize: vertical;
  }

  .field:focus-visible,
  .text:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .banner {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }
</style>
