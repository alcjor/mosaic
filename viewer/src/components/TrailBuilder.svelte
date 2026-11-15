<script lang="ts">
  /**
   * Trails' builder (V-1, V-2, V-3, V-5): the chain as one line that reads as a sentence,
   * "Start at [a thing or any Type] → link → [any Type] then follow → link → [any Type] … Add a
   * step". Each part is a compact control:
   *
   * - a place (the start, or where a step leads) is a chip naming the thing it is pinned to, or
   *   "any Type"; it opens a panel to pin the place to one thing found by search or to leave it
   *   open again, and, for the start, to choose another start type;
   * - a step's link is a menu of the steps the mosaic allows after the type before, with
   *   "Remove this step";
   * - "Add a step" is a menu of the steps the mosaic allows after the last type.
   *
   * Every change goes to `onchange`. What the line ends with (the switch of views) is `children`.
   */
  import { DropdownMenu } from "bits-ui";
  import type { Snippet } from "svelte";
  import { change, extend, offers, pin, remove, restart, typeAt, type Chain, type ChainSchema, type Offer } from "../lib/chain.js";
  import { PlaceSearches, slotOf, slotsFrom, type Answer } from "../lib/placesearch.svelte.js";
  import type { Shape } from "../lib/view.js";
  import Shard from "./Shard.svelte";
  import TrailPopover from "./TrailPopover.svelte";
  import Button from "./ui/Button.svelte";

  let {
    schema,
    chain,
    shape = null,
    onchange,
    find,
    searches = new PlaceSearches(),
    nameOf = (id) => id,
    children,
  }: {
    schema: ChainSchema;
    chain: Chain | null;
    shape?: Shape | null;
    onchange: (chain: Chain | null) => void;
    /** Things of `type` whose names match `query`, through the kit's `find`, or why it failed. */
    find: (type: string, query: string) => Promise<Answer>;
    /** What each place's search found, kept for the open mosaic (lib/placesearch.svelte.ts). */
    searches?: PlaceSearches;
    /** A pinned thing's name, where the page knows it. */
    nameOf?: (id: string) => string;
    children?: Snippet;
  } = $props();

  const id = $props.id();

  const typeName = (type: string) => shape?.typeLabel(type) ?? type;
  const edgeName = (type: string, edge: string) => shape?.edgeLabel(type, edge) ?? edge;
  const key = (o: Offer) => `${o.edge} ${o.direction}`;
  const arrow = (o: Offer) => (o.direction === "out" ? "→" : "←");
  /** An offer as a menu names it: the link, its direction, and the type it leads to. */
  const offerName = (from: string, o: Offer) => `${edgeName(from, o.edge)} ${arrow(o)} ${typeName(o.type)}`;
  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let last = $derived(chain === null ? null : typeAt(chain, chain.steps.length - 1));
  let addable = $derived(last === null ? [] : offers(schema, last));
  /** The place whose panel is open (-1 for the start), or null. */
  let opened = $state<number | null>(null);

  function start(type: string): void {
    // Another start, or none: every place is another place now.
    searches.reset();
    opened = null;
    onchange(type === "" ? null : chain === null ? { start: type, pin: null, steps: [] } : restart(schema, chain, type));
  }

  /** Remove step `index`: the places from it on become other places, so what they found goes. */
  function removeStep(index: number): void {
    if (chain === null) return;
    for (const at of slotsFrom(chain, index)) searches.clear(at);
    onchange(remove(schema, chain, index));
  }

  /** The place `place` (-1 for the start) of the chain as it is now: its position, link and type. */
  const slot = (place: number): string => (chain === null ? "" : slotOf(chain, place));

  async function search(place: number, type: string): Promise<void> {
    const at = slot(place);
    const q = (searches.queries[at] ?? "").trim();
    if (q === "") return;
    await searches.run(at, () => find(type, q));
  }

  function pinTo(place: number, thing: string | null): void {
    if (chain === null) return;
    searches.clear(slot(place));
    opened = null;
    onchange(pin(chain, place === -1 ? "start" : place, thing));
  }
</script>

{#snippet types(selected: string | null)}
  <option value="" selected={selected === null}>Choose a type…</option>
  {#each schema.nodeTypes as t (t.name)}
    <option value={t.name} selected={selected === t.name}>{typeName(t.name)} · {figure(t.count)}</option>
  {/each}
{/snippet}

{#snippet place(at: number, type: string, pinned: string | null)}
  {@const where = at === -1 ? "Start" : `Place ${at + 2}`}
  {@const said = pinned === null ? `any ${typeName(type)}` : nameOf(pinned)}
  <span class="place">
    <TrailPopover label="{where}: {said}" look="thing" bind:open={() => opened === at, (o) => (opened = o ? at : null)}>
      {#snippet trigger()}<Shard {type} /><span class="said">{said}</span>{/snippet}
      {#if at === -1}
        <label class="section-label" for="{id}-type">Start from</label>
        <select class="choice body-app" id="{id}-type" onchange={(e) => start(e.currentTarget.value)}>{@render types(type)}</select>
      {/if}
      {#if pinned === null}
        <form class="find" onsubmit={(e) => (e.preventDefault(), void search(at, type))}>
          <input
            class="choice field body-app"
            type="search"
            aria-label="Pin to one {typeName(type)}"
            placeholder="Pin to one {typeName(type)}…"
            bind:value={searches.queries[slot(at)]}
          />
          <Button type="submit">Find</Button>
        </form>
        {@const answer = searches.found[slot(at)]}
        {#if answer !== undefined && "error" in answer}
          <p class="note caption">Could not search: {answer.error}</p>
        {:else if answer !== undefined && answer.length === 0}
          <p class="note caption">No {typeName(type)} matches “{searches.queries[slot(at)]?.trim() ?? ""}”.</p>
        {:else if answer !== undefined}
          <ul class="things">
            {#each answer as thing (thing.id)}
              <li>
                <button class="thing" type="button" data-pin={thing.id} onclick={() => pinTo(at, thing.id)}>
                  <span class="body-app">{thing.label ?? thing.id}</span> <span class="code caption">{thing.id}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="note caption">Pinned to <span class="code">{pinned}</span></p>
        <Button onclick={() => pinTo(at, null)}>Any {typeName(type)}</Button>
      {/if}
    </TrailPopover>
  </span>
{/snippet}

<div class="bar body-app" role="group" aria-label="Trail builder">
  <strong class="label-app">Start at</strong>
  {#if chain === null}
    <select class="choice body-app" aria-label="Start at" onchange={(e) => start(e.currentTarget.value)}>{@render types(null)}</select>
  {:else}
    {@render place(-1, chain.start, chain.pin)}
    {#each chain.steps as s, i (i)}
      {@const from = typeAt(chain, i - 1)}
      {#if i > 0}<strong class="label-app">then follow</strong>{/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="trail-link body-app" aria-label="Step {i + 1}: {offerName(from, s)}" data-step={i}>
          {arrow(s)}
          {edgeName(from, s.edge)}
          {arrow(s)}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="ui-menu body-app" align="start" sideOffset={4}>
            {#each offers(schema, from) as o (key(o))}
              <DropdownMenu.Item class="ui-menu-item" disabled={key(o) === key(s)} onSelect={() => onchange(change(schema, chain, i, o))}>
                {offerName(from, o)}
              </DropdownMenu.Item>
            {/each}
            <DropdownMenu.Separator class="trail-rule" />
            <DropdownMenu.Item class="ui-menu-item" onSelect={() => removeStep(i)}>Remove this step</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {@render place(i, s.type, s.pin)}
    {/each}
    {#if addable.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="trail-link add body-app">Add a step</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="ui-menu body-app" align="start" sideOffset={4}>
            {#each addable as o (key(o))}
              <DropdownMenu.Item class="ui-menu-item" onSelect={() => onchange(extend(schema, chain, o))}>{offerName(last!, o)}</DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    {:else}
      <span class="note caption">No step leads on from {typeName(last!)}.</span>
    {/if}
  {/if}
  <span class="grow"></span>
  {@render children?.()}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .bar > strong {
    color: var(--heading);
    white-space: nowrap;
  }

  .grow {
    flex: 1;
  }

  .place {
    display: inline-flex;
    min-inline-size: 0;
  }

  .said {
    overflow: hidden;
    max-inline-size: 16rem;
    text-overflow: ellipsis;
  }

  .choice {
    box-sizing: border-box;
    block-size: var(--space-6);
    max-inline-size: 100%;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .find {
    display: flex;
    gap: var(--space-2);
  }

  .field {
    flex: 1;
    min-inline-size: 0;
  }

  .note {
    margin: 0;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }

  .things {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .thing {
    display: block;
    inline-size: 100%;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink);
    text-align: start;
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .thing .code {
    color: var(--ink-muted);
  }

  .thing:hover {
    background: var(--selection);
  }

  .choice:focus-visible,
  .thing:focus-visible,
  :global(.trail-link:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :global(.trail-link) {
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink-muted);
    white-space: nowrap;
    cursor: pointer;
  }

  :global(.trail-link.add) {
    padding: var(--space-1) var(--space-2);
    color: var(--accent);
  }

  :global(.trail-link:hover),
  :global(.trail-link[data-state="open"]) {
    background: var(--selection);
    color: var(--heading);
  }

  :global(.trail-rule) {
    block-size: 1px;
    margin: var(--space-1) 0;
    background: var(--border);
  }
</style>
