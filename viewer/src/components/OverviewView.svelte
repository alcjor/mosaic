<script lang="ts">
  /**
   * The Overview (needs G-9, G-7, G-10, G-11), marked Experimental: the whole mosaic
   * as shards, one per thing, in bands by type and coloured by type. Selecting a shard names the
   * thing and opens its neighbourhood. A mosaic too big to draw whole draws a stated sample and
   * says so.
   *
   * The things are read through the kit's `table` in the background, a page at a time, and kept
   * for the session (lib/graph/overview.ts); the layout is lib/graph/overview-layout.ts, the same
   * picture for the same mosaic (G-7). The picture is one stop for the keyboard: the arrow keys go
   * from shard to shard, Page Up and Page Down from band to band, Enter selects. Below
   * 960px the picture gives way to the same contents as a list (G-11).
   */
  import type { SealedFile } from "@mosaic/kit";
  import { tick, untrack } from "svelte";
  import { noun, number, typeTable } from "../lib/graph/mapview.js";
  import { BAND_COLOURS, OverviewStopped, readOverview, sampleNote, samplePlan, type OverviewData } from "../lib/graph/overview.js";
  import { layoutOverview } from "../lib/graph/overview-layout.js";
  import { keepOverview, keptOverview } from "../lib/graph/session.js";
  import { svgPoints } from "../lib/graph/shard.js";
  import { routeHash, type TableRoute } from "../lib/route.js";
  import type { Shape } from "../lib/view.js";

  let {
    file,
    shape,
    hrefFor,
    tableHref,
    hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" }),
    initial,
    selected: first,
  }: {
    file: SealedFile;
    shape: Shape;
    hrefFor: (id: string) => string;
    tableHref: (table: TableRoute) => string;
    /** The address of a thing's neighbourhood. */
    hoodHref?: (id: string) => string;
    /** The overview already read, drawn at once (the page reads its own). */
    initial?: OverviewData;
    /** A thing named in the panel from the start, as if pointed at. */
    selected?: string;
  } = $props();

  /** The picture's box, in its own units: the SVG scales it to the column. */
  const SIZE = 640;
  /** Things a band lists at phone width before saying how many more are not listed. */
  const LISTED = 20;

  let data = $state<OverviewData | null>(untrack(() => initial ?? keptOverview(file) ?? null));
  let progress = $state<{ read: number; total: number } | null>(null);
  let failed = $state<string | null>(null);

  $effect(() => {
    if (data !== null) return;
    const stop = new AbortController();
    const plan = samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count })));
    readOverview(file, plan, { signal: stop.signal, onPage: (read, total) => (progress = { read, total }) })
      .then((read) => {
        keepOverview(file, read);
        data = read;
      })
      .catch((e: unknown) => {
        if (!(e instanceof OverviewStopped)) failed = e instanceof Error ? e.message : String(e);
      });
    // Leaving the view stops the reading; coming back reads again.
    return () => stop.abort();
  });

  const layout = $derived(data === null ? null : layoutOverview(data.bands.map((b) => ({ type: b.type, ids: b.things.map((t) => t.id) })), SIZE));
  const note = $derived(data === null ? null : sampleNote(data));
  /** Each thing read, by id: its name and type. */
  const things = $derived(new Map((data?.bands ?? []).flatMap((b) => b.things.map((t) => [t.id, { ...t, type: b.type }] as const))));
  /** Each band's colour, from the middle out, by type. */
  const colourOf = $derived(new Map((layout?.bands ?? []).map((b, i) => [b.type, i % BAND_COLOURS.length])));
  /** The bands from the middle out, with how many things each shows and holds. */
  const bands = $derived((layout?.bands ?? []).map((b) => ({ ...b, band: data!.bands.find((x) => x.type === b.type)! })));

  const nameOf = (id: string) => things.get(id)?.label ?? id;
  const typeLabel = (type: string) => shape.typeLabel(type);

  let selected = $state<string | null>(untrack(() => first ?? null));
  /** The shard the keyboard is on: the picture is one stop, and the arrow keys move within it. */
  let active = $state(0);
  let picture = $state<SVGSVGElement | null>(null);

  /** Pointing at a shard, or moving to it by keyboard, names its thing in the panel. */
  function name(id: string): void {
    selected = id;
  }

  /** Selecting a shard opens its neighbourhood (G-9). */
  function open(id: string): void {
    location.href = hoodHref(id);
  }

  /** The first shard of each band, by index into the shards. */
  const starts = $derived.by(() => {
    const out: number[] = [];
    (layout?.shards ?? []).forEach((s, i) => {
      if (i === 0 || layout!.shards[i - 1]!.type !== s.type) out.push(i);
    });
    return out;
  });

  async function moveTo(i: number): Promise<void> {
    const n = layout?.shards.length ?? 0;
    if (n === 0) return;
    active = Math.max(0, Math.min(n - 1, i));
    await tick();
    picture?.querySelectorAll<SVGElement>("[data-shard]")[active]?.focus();
  }

  function key(event: KeyboardEvent): void {
    let band = 0;
    starts.forEach((start, b) => {
      if (start <= active) band = b;
    });
    const moves: Record<string, () => number> = {
      ArrowRight: () => active + 1,
      ArrowDown: () => active + 1,
      ArrowLeft: () => active - 1,
      ArrowUp: () => active - 1,
      Home: () => 0,
      End: () => (layout?.shards.length ?? 1) - 1,
      PageDown: () => starts[Math.min(band + 1, starts.length - 1)] ?? active,
      PageUp: () => starts[Math.max(band - 1, 0)] ?? active,
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      void moveTo(move());
    } else if (event.key === "Enter") {
      event.preventDefault();
      const s = layout?.shards[active];
      if (s) open(s.id);
    }
  }

  const selectedThing = $derived(selected === null ? null : (things.get(selected) ?? null));
</script>

<div class="overview">
  <div class="canvas">
    <p class="intro caption">
      <span class="badge caption">Experimental</span>
      Every thing as a shard, in bands by type.
    </p>
    {#if failed !== null}
      <p class="banner body-screen" role="alert">Could not read the things: {failed}</p>
    {:else if data === null || layout === null}
      <p class="empty body-screen" role="status">
        Reading the things{progress ? `: page ${number(progress.read)} of ${number(progress.total)}` : "…"}
      </p>
    {:else}
      {#if note}
        <p class="note caption" role="status">{note}</p>
      {/if}
      <ul class="legend">
        {#each bands as b (b.type)}
          <li class="caption" data-band={b.type}>
            <svg class="swatch" viewBox="0 0 12 12" aria-hidden="true"><rect class="colour-{colourOf.get(b.type)}" width="12" height="12" /></svg>
            {typeLabel(b.type)} · {data.whole ? number(b.band.count) : `${number(b.band.things.length)} of ${number(b.band.count)}`}
          </li>
        {/each}
      </ul>
      <svg
        class="picture"
        viewBox="0 0 {SIZE} {SIZE}"
        role="group"
        aria-label="Overview: {number(layout.shards.length)} {noun(layout.shards.length, 'thing', 'things')} in bands by type. Arrow keys move from shard to shard, Page Up and Page Down from band to band, Enter opens a thing's neighbourhood."
        bind:this={picture}
      >
        {#each layout.shards as s, i (s.id)}
          <polygon
            class="shard colour-{colourOf.get(s.type)}"
            class:selected={selected === s.id}
            points={svgPoints(s.points)}
            role="link"
            tabindex={i === active ? 0 : -1}
            data-shard={s.id}
            aria-label="{nameOf(s.id)} ({typeLabel(s.type)})"
            onclick={() => open(s.id)}
            onpointerenter={() => name(s.id)}
            onfocus={() => {
              active = i;
              name(s.id);
            }}
            onkeydown={key}
          />
        {/each}
      </svg>

      <!-- Below 960px: the same contents as a list (G-11). -->
      <div class="list">
        {#each bands as b (b.type)}
          <h3 class="section-label heading" data-list-band={b.type}>{typeLabel(b.type)} · {data.whole ? number(b.band.count) : `${number(b.band.things.length)} of ${number(b.band.count)}`}</h3>
          <ul>
            {#each b.band.things.slice(0, LISTED) as t (t.id)}
              <li>
                <a class="pick body-screen" href={hoodHref(t.id)}>{t.label ?? t.id}</a>
              </li>
            {/each}
          </ul>
          {#if b.band.things.length > LISTED}
            <p class="caption muted">
              {number(b.band.things.length - LISTED)} more of the {number(b.band.things.length)} drawn {noun(b.band.things.length - LISTED, "is", "are")} not listed here.
              <a class="more" href={tableHref(typeTable(b.type))}>Open the table of {typeLabel(b.type)}</a>
            </p>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <aside class="panel" aria-label="Selection" aria-live="polite">
    {#if selectedThing}
      <h3 class="section-label heading">This shard</h3>
      <p class="panel-title name">{selectedThing.label ?? selectedThing.id}</p>
      <p class="caption muted">{typeLabel(selectedThing.type)} · <span class="code">{selectedThing.id}</span></p>
      <a class="button step-title" href={hoodHref(selectedThing.id)}>Open its neighbourhood</a>
      <a class="button step-title" href={hrefFor(selectedThing.id)}>Open its page</a>
    {:else}
      <p class="empty body-screen">Point at a shard, or move to it with the keys, to name its thing. Select it to open its neighbourhood.</p>
    {/if}
  </aside>
</div>

<style>
  /* A name with no break in it wraps anywhere rather than pushing the page sideways (G-11). */
  .overview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow-wrap: anywhere;
  }

  .canvas {
    min-inline-size: 0;
    padding: 0 var(--space-4) var(--space-4);
  }

  .intro,
  .note {
    margin: var(--space-2) 0;
    color: var(--ink-muted);
  }

  .badge {
    display: inline-block;
    margin-inline-end: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    color: var(--accent);
    text-transform: uppercase;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-2) 0;
    padding: 0;
    list-style: none;
    color: var(--ink);
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .swatch {
    inline-size: var(--space-3);
    block-size: var(--space-3);
  }

  .picture {
    display: none;
    inline-size: 100%;
    max-inline-size: 70vh;
    block-size: auto;
    margin-inline: auto;
  }

  /* The shards keep a thin edge in the page's ink, so each stands out in either theme. */
  .shard {
    stroke: var(--ink-muted);
    stroke-width: 0.4;
    cursor: pointer;
  }

  .colour-0 {
    fill: var(--shard-2);
  }

  .colour-1 {
    fill: var(--shard-4);
  }

  .colour-2 {
    fill: var(--shard-7);
  }

  .colour-3 {
    fill: var(--shard-3);
  }

  .colour-4 {
    fill: var(--shard-5);
  }

  .colour-5 {
    fill: var(--shard-1);
  }

  .shard:hover {
    fill: var(--surface-tint);
  }

  .shard.selected {
    fill: var(--heading);
    stroke: var(--heading);
    stroke-width: 2;
  }

  .shard:focus {
    outline: none;
  }

  .shard:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .heading {
    margin: var(--space-4) 0 var(--space-1);
    color: var(--accent);
    text-transform: uppercase;
  }

  .pick {
    box-sizing: border-box;
    display: block;
    inline-size: 100%;
    min-block-size: var(--space-6);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-inline-start: 3px solid transparent;
    background: none;
    color: var(--ink);
    text-align: start;
    font-family: var(--font-sans);
    text-decoration: none;
    cursor: pointer;
  }

  .pick:hover {
    background: var(--surface-tint);
  }

  .pick:focus-visible,
  .more:focus-visible,
  .button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .more {
    color: var(--accent);
  }

  .panel {
    padding: 0 var(--space-4) var(--space-4);
    border-block-start: 1px solid var(--border);
  }

  .name {
    margin: var(--space-1) 0;
    color: var(--heading);
  }

  .muted {
    margin: var(--space-1) 0;
    color: var(--ink-muted);
  }

  .code {
    font-family: var(--font-mono);
  }

  .button {
    display: inline-block;
    margin-block: var(--space-2);
    margin-inline-end: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--surface);
    text-decoration: none;
  }

  .button:hover {
    background: var(--shard-3);
  }

  .empty {
    margin: var(--space-4) 0;
    color: var(--ink-muted);
  }

  .banner {
    padding: var(--space-2) var(--space-3);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  /* From 960px: the picture, with the selection beside it. */
  @media (width >= 960px) {
    .overview {
      grid-template-columns: minmax(0, 1fr) 320px;
    }

    .picture {
      display: block;
    }

    .list {
      display: none;
    }

    .panel {
      border-block-start: none;
      border-inline-start: 1px solid var(--border);
    }
  }
</style>
