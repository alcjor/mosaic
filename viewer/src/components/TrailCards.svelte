<script lang="ts">
  /**
   * A trail as cards (lib/trailcolumns.ts): one column per place of the chain, each a list of
   * small cards (the type's shard and name, the thing's name, one line of its first
   * properties), with a line between two cards wherever a result holds both side by side.
   *
   * Picking a card lights up everything the results through it hold, and dims the rest; picking
   * it again clears. A card's menu, or a double pick, opens the thing in Explore; the menu also
   * pins the place to the thing, which narrows the trail, or leaves it open again. A long column
   * shows its first cards and "Show N more of M". Each column scrolls on its own, and the lines
   * follow the cards.
   */
  import { connected, joinKey, joinsOf, type TrailColumns } from "../lib/trailcolumns.js";
  import type { Shape } from "../lib/view.js";
  import Shard from "./Shard.svelte";
  import Button from "./ui/Button.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Menu from "./ui/Menu.svelte";

  /** How many cards a column shows at first, and how many more each "Show more" adds. */
  const FIRST = 20;

  let {
    trail,
    shape = null,
    hrefFor,
    onpin,
    lines,
    want,
  }: {
    trail: TrailColumns;
    shape?: Shape | null;
    hrefFor: (id: string) => string;
    /** Pin place `place` (0 is the start) to the thing `id`, or leave it open (null). */
    onpin: (place: number, id: string | null) => void;
    /** Each thing's line of properties, by id, once read. */
    lines: ReadonlyMap<string, string>;
    /** Ask for the lines of the things now on screen. */
    want: (ids: readonly string[]) => void;
  } = $props();

  const typeName = (type: string) => shape?.typeLabel(type) ?? type;
  const figure = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  /** How many cards each column shows beyond the first, by place. */
  let extra = $state<Record<number, number>>({});
  const shownAt = (place: number) => FIRST + (extra[place] ?? 0);
  let visible = $derived(trail.columns.map((c, place) => c.things.slice(0, shownAt(place))));

  /** The card picked, if its column still holds it. */
  let picked = $state<{ place: number; id: string } | null>(null);
  let pick = $derived(picked !== null && trail.columns[picked.place]?.things.some((t) => t.id === picked!.id) ? picked : null);
  let lit = $derived(pick === null ? null : connected(trail.results, pick.place, pick.id));
  let joins = $derived(joinsOf(trail.results));

  $effect(() => want(visible.flat().map((t) => t.id)));

  function open(id: string): void {
    location.hash = hrefFor(id);
  }

  /** The lines as drawn: from the middle of a card's right edge to the middle of the next card's left edge. */
  let paths = $state.raw<{ key: string; d: string }[]>([]);
  let size = $state.raw({ width: 0, height: 0 });
  let cols = $state<HTMLElement>();

  function measure(): void {
    if (cols === undefined) return;
    const frame = cols.getBoundingClientRect();
    const at = new Map<string, { left: number; right: number; y: number; seen: boolean }>();
    for (const list of cols.querySelectorAll<HTMLElement>("[data-cards]")) {
      const view = list.getBoundingClientRect();
      for (const card of list.querySelectorAll<HTMLElement>("[data-card]")) {
        const r = card.getBoundingClientRect();
        const middle = r.top + r.height / 2;
        at.set(card.dataset.card!, {
          left: r.left - frame.left + cols.scrollLeft,
          right: r.right - frame.left + cols.scrollLeft,
          // A card scrolled out of its column keeps its line, drawn to the column's edge.
          y: Math.min(Math.max(middle, view.top), view.bottom) - frame.top,
          seen: middle >= view.top && middle <= view.bottom,
        });
      }
    }
    const drawn: { key: string; d: string }[] = [];
    for (const j of joins) {
      const a = at.get(JSON.stringify([j.place, j.from]));
      const b = at.get(JSON.stringify([j.place + 1, j.to]));
      if (a === undefined || b === undefined || (!a.seen && !b.seen)) continue;
      const mid = (a.right + b.left) / 2;
      drawn.push({ key: joinKey(j), d: `M${a.right} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.left} ${b.y}` });
    }
    paths = drawn;
    size = { width: cols.scrollWidth, height: cols.clientHeight };
  }

  $effect(() => {
    // Measured again whenever the cards or the lines between them change, and when the place is resized.
    void visible;
    void joins;
    measure();
    if (cols === undefined) return;
    const watch = new ResizeObserver(measure);
    watch.observe(cols);
    return () => watch.disconnect();
  });
</script>

<section class="trail" aria-label="Trail as cards">
  {#if trail.partial}
    <p class="note caption" role="status">The cards are the things of the first {figure(trail.read)} results. Pin a thing to narrow them.</p>
  {/if}
  <div class="cols" bind:this={cols}>
    <svg class="lines" aria-hidden="true" width={size.width} height={size.height}>
      {#each paths as p (p.key)}
        <path class="edge" class:lit={lit?.joins.has(p.key) ?? false} class:faint={lit !== null && !lit.joins.has(p.key)} data-lit={lit?.joins.has(p.key) ? "lit" : undefined} d={p.d} />
      {/each}
    </svg>
    <ol class="steps">
    {#each trail.columns as column, place (place)}
      {@const hidden = column.things.length - visible[place]!.length}
      <li class="step" data-column={place}>
        <h2 class="label section-label">
          {#if column.step}
            {column.step.direction === "in" ? "← " : ""}{shape?.edgeLabel(column.step.from, column.step.edge) ?? column.step.edge}
          {:else}
            Start
          {/if}
          · {typeName(column.type)}
        </h2>
        {#if column.things.length === 0}
          <EmptyState message="Nothing here: the trail has no result." />
        {:else}
          <ul class="cards" data-cards onscroll={measure}>
            {#each visible[place]! as thing (thing.id)}
              {@const name = thing.label ?? thing.id}
              {@const pinned = column.pin === thing.id}
              {@const on = pick !== null && pick.place === place && pick.id === thing.id}
              {@const glow = lit !== null && lit.things[place]!.has(thing.id)}
              {@const line = lines.get(thing.id)}
              <li
                class="card"
                class:pick={on}
                class:lit={glow && !on}
                class:dim={lit !== null && !glow}
                data-card={JSON.stringify([place, thing.id])}
                data-id={thing.id}
                data-lit={lit === null ? undefined : on ? "picked" : glow ? "lit" : "dimmed"}
              >
                <button
                  class="face"
                  type="button"
                  aria-pressed={on}
                  onclick={() => (picked = on ? null : { place, id: thing.id })}
                  ondblclick={() => open(thing.id)}
                >
                  <span class="kind caption"><Shard type={column.type} />{typeName(column.type)}{pinned ? " · pinned" : ""}</span>
                  <strong class="name panel-title">{name}</strong>
                  <span class="line code caption"
                    >{line === undefined ? " " : line !== "" ? line : `${figure(thing.results)} ${thing.results === 1 ? "result" : "results"}`}</span
                  >
                </button>
                <span class="more">
                  <Menu
                    label="More for {name}"
                    items={[
                      { label: "Open in Explore", onselect: () => open(thing.id) },
                      pinned
                        ? { label: `Unpin: any ${typeName(column.type)}`, onselect: () => onpin(place, null) }
                        : { label: "Pin: narrow the trail to this", onselect: () => onpin(place, thing.id) },
                    ]}
                  />
                </span>
              </li>
            {/each}
            {#if hidden > 0}
              <li class="rest">
                <Button variant="ghost" onclick={() => (extra[place] = (extra[place] ?? 0) + FIRST)}>
                  Show {figure(Math.min(FIRST, hidden))} more of {figure(column.things.length)}{trail.partial ? "+" : ""}
                </Button>
              </li>
            {/if}
          </ul>
        {/if}
      </li>
    {/each}
  </ol></div>
</section>

<style>
  .trail {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-block-size: 0;
    min-inline-size: 0;
  }

  .note {
    margin: 0;
    color: var(--ink-muted);
  }

  /* One column per place, side by side; the row scrolls sideways when the place is narrower. */
  .cols {
    position: relative;
    display: grid;
    flex: 1;
    grid-template-rows: minmax(0, 1fr);
    min-block-size: 0;
    overflow: auto hidden;
  }

  .steps {
    display: grid;
    grid-auto-columns: minmax(220px, 1fr);
    grid-auto-flow: column;
    grid-template-rows: minmax(0, 1fr);
    column-gap: calc(var(--space-5) + var(--space-4));
    min-block-size: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lines {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    pointer-events: none;
  }

  .edge {
    fill: none;
    stroke: var(--border);
    stroke-width: 2;
  }

  .edge.lit {
    stroke: var(--accent);
  }

  .edge.faint {
    opacity: 0.6;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-block-size: 0;
    min-inline-size: 0;
  }

  .label {
    margin: 0;
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  /* The column scrolls on its own; the room round the cards keeps a picked card's ring whole. */
  .cards {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    min-block-size: 0;
    margin: 0;
    padding: calc(var(--space-1) / 2);
    overflow-y: auto;
    list-style: none;
  }

  .card {
    position: relative;
    z-index: 1;
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .card.lit {
    border-color: var(--accent);
  }

  .card.pick {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* Dimmed, not faded: the ground and the shard step back, the text keeps a readable colour. */
  .card.dim {
    background: var(--page);
  }

  .card.dim .name {
    color: var(--ink-muted);
  }

  .card.dim .kind :global(.shard) {
    opacity: 0.6;
  }

  .face {
    display: flex;
    flex-direction: column;
    gap: calc(var(--space-1) / 2);
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 76px;
    justify-content: center;
    padding: var(--space-3) var(--space-6) var(--space-3) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--ink);
    text-align: start;
    cursor: pointer;
  }

  .face:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .kind {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink-muted);
  }

  .name {
    color: var(--heading);
    overflow-wrap: anywhere;
  }

  .line {
    overflow: hidden;
    color: var(--ink-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more {
    position: absolute;
    inset-block-start: var(--space-1);
    inset-inline-end: var(--space-1);
  }

  .rest {
    flex: none;
  }
</style>
