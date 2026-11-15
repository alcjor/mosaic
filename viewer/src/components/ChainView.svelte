<script lang="ts">
  /**
   * The *Chain* view's builder (V-1, V-2, V-3, V-5; brand book, section 6): a start
   * type, then steps, each one kind of link in one direction to the next type, chosen only from
   * the steps the mosaic allows after the type before. Any place can be pinned to one
   * thing found by search, or left open to any thing of its type. A step can be changed or
   * removed, and a step added after the last, without starting over: every change goes to
   * `onchange`, and the count of the chain's results shows as it grows.
   *
   * Every control is a native select, input or button, so the builder works by keyboard as by
   * pointer; each has a label, and the focus ring of section 6.
   *
   * The view file's chains (V-15, V-16) are listed above the builder by their labels:
   * one picked becomes the chain, to change like any other. The page cannot write the view file,
   * so the chain built is given below as the view file's `chains` text, under a label the person
   * can change, to copy into it (lib/viewchains.ts).
   */
  import Button from "./ui/Button.svelte";
  import { change, extend, offers, pin, remove, restart, typeAt, type Chain, type ChainSchema, type Offer } from "../lib/chain.js";
  import { PlaceSearches, slotOf, slotsFrom, type Answer } from "../lib/placesearch.svelte.js";
  import type { ChainSettings, Shape } from "../lib/view.js";
  import type { ChainCount } from "../lib/viewer.svelte.js";
  import { chainName, chainSettings, chainsText, type SavedChain } from "../lib/viewchains.js";

  let {
    schema,
    chain,
    count = null,
    shape = null,
    onchange,
    find,
    searches = new PlaceSearches(),
    saved = [],
    fileChains = [],
  }: {
    schema: ChainSchema;
    chain: Chain | null;
    count?: ChainCount | null;
    shape?: Shape | null;
    onchange: (chain: Chain | null) => void;
    /** Things of `type` whose names match `query`, through the kit's `find`, or why it failed. */
    find: (type: string, query: string) => Promise<Answer>;
    /** What each place's search found, kept for the open mosaic (lib/placesearch.svelte.ts). */
    searches?: PlaceSearches;
    /** The view file's chains the open mosaic can apply, by label, in order. */
    saved?: readonly SavedChain[];
    /** The view file's chains as written, kept in the text to copy. */
    fileChains?: readonly ChainSettings[];
  } = $props();

  const id = $props.id();

  const typeName = (type: string) => shape?.typeLabel(type) ?? type;
  const edgeName = (type: string, edge: string) => shape?.edgeLabel(type, edge) ?? edge;
  const key = (o: Offer) => `${o.edge} ${o.direction}`;
  /** An offer as the builder names it: the link, its direction, and the type it leads to. */
  const offerName = (from: string, o: Offer) => `${edgeName(from, o.edge)} ${o.direction === "out" ? "→" : "←"} ${typeName(o.type)}`;

  /** A number with its thousands marked, the same everywhere (no locale). */
  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const results = (n: number) => `${figure(n)} result${n === 1 ? "" : "s"}`;

  let said = $derived.by(() => {
    if (count === null) return "";
    if (!count.done) return `Counting: at least ${results(count.total)} so far`;
    return count.exact ? results(count.total) : `At least ${results(count.total)}`;
  });

  /** The label the person gave the chain, or the saved chain's they picked; null for the default. */
  let label = $state<string | null>(null);
  let named = $derived(chain === null ? "" : label !== null && label.trim() !== "" ? label.trim() : chainName(chain, typeName));
  let text = $derived(chain === null ? "" : chainsText(fileChains, chainSettings(named, chain)));
  let area = $state<HTMLTextAreaElement>();
  let copied = $state("");
  /** Whether the panel with the view file text is open. */
  let keeping = $state(false);

  function open(s: SavedChain): void {
    searches.reset();
    label = s.name;
    onchange(s.chain);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = "Copied. Paste it into the view file, in place of its chains section.";
    } catch {
      area?.select();
      copied = "The page cannot copy here: the text is selected, copy it with your keyboard.";
    }
  }

  let last = $derived(chain === null ? null : typeAt(chain, chain.steps.length - 1));
  let addable = $derived(last === null ? [] : offers(schema, last));

  function start(type: string): void {
    // Another start, or none: every place is another place now.
    searches.reset();
    onchange(type === "" ? null : chain === null ? { start: type, pin: null, steps: [] } : restart(schema, chain, type));
  }

  function choose(index: number, value: string): void {
    if (chain === null) return;
    const o = offers(schema, typeAt(chain, index - 1)).find((x) => key(x) === value);
    if (o !== undefined) onchange(change(schema, chain, index, o));
  }

  /** Remove step `index`: the places from it on become other places, so what they found goes. */
  function removeStep(index: number): void {
    if (chain === null) return;
    for (const at of slotsFrom(chain, index)) searches.clear(at);
    onchange(remove(schema, chain, index));
  }

  function add(value: string): void {
    if (chain === null || last === null) return;
    const o = offers(schema, last).find((x) => key(x) === value);
    if (o !== undefined) onchange(extend(schema, chain, o));
  }

  /** The place `place` (-1 for the start) of the chain as it is now: its position, link and type. */
  function slot(place: number): string {
    return chain === null ? "" : slotOf(chain, place);
  }

  async function search(place: number, type: string): Promise<void> {
    const at = slot(place);
    const q = (searches.queries[at] ?? "").trim();
    if (q === "") return;
    await searches.run(at, () => find(type, q));
  }

  function pinTo(place: number, thing: string | null): void {
    if (chain === null) return;
    searches.clear(slot(place));
    onchange(pin(chain, place === -1 ? "start" : place, thing));
  }
</script>

{#snippet pinning(place: number, type: string, pinned: string | null)}
  {@const at = slot(place)}
  <div class="pin">
    {#if pinned === null}
      <p class="open caption">Any {typeName(type)}</p>
      <form class="find" onsubmit={(e) => (e.preventDefault(), void search(place, type))}>
        <label class="hidden" for="{id}-find-{place}">Pin to one {typeName(type)}</label>
        <input class="field body-screen" id="{id}-find-{place}" type="search" placeholder="Pin to one {typeName(type)}…" bind:value={searches.queries[at]} />
        <Button type="submit">Find</Button>
      </form>
      {@const answer = searches.found[at]}
      {#if answer !== undefined && "error" in answer}
        <p class="none caption">Could not search: {answer.error}</p>
      {:else if answer !== undefined && answer.length === 0}
        <p class="none caption">No {typeName(type)} matches “{searches.queries[at]?.trim() ?? ""}”.</p>
      {:else if answer !== undefined}
        <ul class="things">
          {#each answer as thing (thing.id)}
            <li><button class="thing" type="button" onclick={() => pinTo(place, thing.id)}><span class="body-screen">{thing.label ?? thing.id}</span> <span class="code caption">{thing.id}</span></button></li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="pinned"><span class="caption">Pinned to</span> <span class="code">{pinned}</span></p>
      <Button variant="ghost" label="Unpin: any {typeName(type)}" onclick={() => pinTo(place, null)}>Any {typeName(type)}</Button>
    {/if}
  </div>
{/snippet}

<div class="builder">
  {#if saved.length > 0}
    <nav class="saved" aria-label="Saved chains">
      <p class="section-label">Saved in the view file</p>
      <ul class="saved-list">
        {#each saved as s (s.name)}
          <li><Button onclick={() => open(s)}>{s.name}</Button></li>
        {/each}
      </ul>
    </nav>
  {/if}

  <div class="place" data-place="start">
    <label class="section-label" for="{id}-start">Start from</label>
    <select class="choice body-screen" id="{id}-start" onchange={(e) => start(e.currentTarget.value)}>
      <option value="" selected={chain === null}>Choose a type…</option>
      {#each schema.nodeTypes as t (t.name)}
        <option value={t.name} selected={chain?.start === t.name}>{typeName(t.name)} · {figure(t.count)}</option>
      {/each}
    </select>
    {#if chain !== null}
      {@render pinning(-1, chain.start, chain.pin)}
    {/if}
  </div>

  {#if chain !== null}
    {#each chain.steps as s, i (i)}
      {@const from = typeAt(chain, i - 1)}
      <div class="place" data-step="{i}">
        <label class="section-label" for="{id}-step-{i}">Step {i + 1}</label>
        <select class="choice body-screen" id="{id}-step-{i}" onchange={(e) => choose(i, e.currentTarget.value)}>
          {#each offers(schema, from) as o (key(o))}
            <option value={key(o)} selected={key(o) === key(s)}>{offerName(from, o)}</option>
          {/each}
        </select>
        {@render pinning(i, s.type, s.pin)}
        <Button variant="ghost" onclick={() => removeStep(i)}>Remove step {i + 1}</Button>
      </div>
    {/each}

    {#if addable.length > 0}
      <div class="place" data-add="">
        <label class="section-label" for="{id}-add">Add a step</label>
        <select class="choice body-screen" id="{id}-add" onchange={(e) => (add(e.currentTarget.value), (e.currentTarget.value = ""))}>
          <option value="" selected>Add a step after {typeName(last!)}…</option>
          {#each addable as o (key(o))}
            <option value={key(o)}>{offerName(last!, o)}</option>
          {/each}
        </select>
      </div>
    {:else}
      <p class="none caption">The mosaic allows no step after {typeName(last!)}.</p>
    {/if}
  {/if}

  <p class="count category" role="status" aria-live="polite">{said}</p>
  {#if count !== null && count.done && count.notes.length > 0}
    <ul class="notes caption">
      {#each count.notes as note, i (i)}<li>{note}</li>{/each}
    </ul>
  {/if}

  {#if chain !== null}
    <section class="save" aria-label="Keep the chain in the view file">
      <Button aria-expanded={keeping} aria-controls="{id}-keep" onclick={() => (keeping = !keeping)}>
        Keep the chain in the view file
      </Button>
      <div class="place keep" id="{id}-keep" hidden={!keeping}>
        <label class="section-label" for="{id}-label">Label</label>
        <input class="field body-screen" id="{id}-label" type="text" value={named} oninput={(e) => (label = e.currentTarget.value)} aria-describedby="{id}-label-note" />
        <p class="none caption" id="{id}-label-note">The view file's chain of this label, if it has one, is replaced; its other chains are kept.</p>
        <label class="section-label" for="{id}-text">View file text</label>
        <p class="none caption">The page cannot change the view file: copy the text below into it, in place of its chains section, to keep the chain.</p>
        <textarea class="text code" id="{id}-text" readonly wrap="off" rows={text.split("\n").length} value={text} bind:this={area}></textarea>
        <div class="actions">
          <Button onclick={copy}>Copy the text</Button>
          <p class="said caption" role="status">{copied}</p>
        </div>
      </div>
    </section>
  {/if}
</div>

<style>
  .saved-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .saved .section-label,
  .said {
    margin: 0;
  }

  .text {
    box-sizing: border-box;
    inline-size: 100%;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-tint);
    color: var(--ink);
    resize: vertical;
  }

  .keep {
    margin-block-start: var(--space-2);
  }

  .keep[hidden] {
    display: none;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .said {
    color: var(--ink-muted);
  }

  /* The places side by side, as the columns under them; the rest takes a line each. */
  .builder {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .builder > :not(.place) {
    flex: 1 1 100%;
  }

  .place {
    display: grid;
    flex: 1 1 220px;
    box-sizing: border-box;
    max-inline-size: 360px;
    justify-items: start;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .section-label {
    color: var(--ink-muted);
  }

  .choice,
  .field {
    box-sizing: border-box;
    min-block-size: var(--space-6);
    max-inline-size: 100%;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .choice,
  .pin,
  .find {
    box-sizing: border-box;
    inline-size: 100%;
  }

  .keep {
    max-inline-size: 48rem;
    justify-items: stretch;
  }

  .find {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .field {
    flex: 1;
    min-inline-size: 0;
  }

  .thing:hover {
    background: var(--surface-tint);
  }

  .choice:focus-visible,
  .field:focus-visible,
  .text:focus-visible,
  .thing:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .open,
  .none,
  .pinned .caption,
  .notes {
    margin: 0;
    color: var(--ink-muted);
  }

  .pinned {
    margin: 0;
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

  .hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .count {
    margin: 0;
    color: var(--ink);
  }
</style>
