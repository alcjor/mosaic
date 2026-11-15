<script lang="ts">
  /**
   * Home: what is in the mosaic. The map of types fills the stage; a type opens its table. The
   * pane holds the view file's saved trails (each opens in Trails), "Build a new trail", and
   * "Jump back in": the last few things opened in this mosaic (lib/recent.ts).
   */
  import Pane from "../components/Pane.svelte";
  import Place from "../components/Place.svelte";
  import Shard from "../components/Shard.svelte";
  import TypeMap from "../components/TypeMap.svelte";
  import { linkOf } from "../lib/chainlink.js";
  import { number } from "../lib/graph/mapview.js";
  import { readRecent } from "../lib/recent.js";
  import { chainName } from "../lib/viewchains.js";
  import type { PlaceProps } from "./props.js";

  let { viewer, shape, links }: PlaceProps = $props();

  const kinds = $derived(viewer.file?.nodeTypes.length ?? 0);
  /** Read when Home opens, and again for another mosaic. */
  const recent = $derived(viewer.file === null ? [] : readRecent(viewer.file.header.knowledge_hash));
</script>

<Place id="home" fill>
  <div class="home">
    <header class="intro">
      <h1 class="title heading-app">What is in this mosaic</h1>
      <p class="line body-app">
        {number(kinds)}
        {kinds === 1 ? "kind" : "kinds"} of thing and how they connect. Each shard is sized by how many things it holds. Pick one to open its table.
      </p>
    </header>
    {#if viewer.file}
      <TypeMap types={viewer.file.nodeTypes} edges={viewer.file.edgeTypes} {shape} hrefFor={links.type} />
    {/if}
  </div>
  {#snippet pane()}
    <Pane place="home" label="Saved trails">
      {#snippet head()}<h2 class="heading section-label">Saved trails</h2>{/snippet}
      <div class="stack">
        {#if viewer.savedChains.length === 0}
          <p class="none caption">No saved trails yet. Build one in Trails and keep it in the view file.</p>
        {:else}
          <ul class="list trails">
            {#each viewer.savedChains as s (s.name)}
              <li>
                <a class="trail" href={links.trail(linkOf(s.chain, "columns", 0, [], { sort: null, filters: [] }))} data-trail={s.name}>
                  <strong class="label-app">{s.name}</strong>
                  <span class="caption steps">{chainName(s.chain, (type) => shape.typeLabel(type))}</span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
        <div><a class="build control-app" href={links.trail(null)} data-build-trail>Build a new trail</a></div>
        <section class="recent" aria-labelledby="home-recent">
          <h2 class="heading section-label" id="home-recent">Jump back in</h2>
          {#if recent.length === 0}
            <p class="none caption">Things you open in Explore show here.</p>
          {:else}
            <ul class="list">
              {#each recent as thing (thing.id)}
                <li>
                  <a class="hit body-app" href={links.thing(thing.id)} data-id={thing.id}>
                    <Shard type={thing.type} /><span class="name">{thing.label ?? thing.id}</span><span class="kind caption">{shape.typeLabel(thing.type)}</span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    </Pane>
  {/snippet}
</Place>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-sizing: border-box;
    min-inline-size: 0;
    min-block-size: 0;
    padding: var(--space-4);
  }

  .title {
    margin: 0;
    color: var(--heading);
  }

  .line {
    margin: var(--space-1) 0 0;
    color: var(--ink-muted);
  }

  .heading {
    margin: 0;
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .trails {
    gap: var(--space-3);
  }

  .trail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
  }

  .trail strong {
    color: var(--heading);
  }

  .steps,
  .none,
  .kind {
    color: var(--ink-muted);
  }

  .none {
    margin: 0;
  }

  .recent {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hit {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    color: var(--ink);
    text-decoration: none;
  }

  .build {
    display: inline-flex;
    align-items: center;
    block-size: var(--space-6);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    color: var(--accent);
    text-decoration: none;
  }

  .build:hover,
  .trail:hover,
  .hit:hover {
    background: var(--selection);
  }

  .build:focus-visible,
  .trail:focus-visible,
  .hit:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .name {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    font-family: var(--font-mono);
  }
</style>
