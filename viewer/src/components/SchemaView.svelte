<script lang="ts">
  /**
   * The Schema view (needs G-1, G-2, G-7, G-10, G-11): how the mosaic fits together
   * as one map. Every node type is a shard sized by how many things it holds; every edge type is
   * an arrow from its type to its other type, as thick as its links. Selecting a type or an edge
   * type shows its description, its counts, its most linked things as places to start, and the
   * table it opens.
   *
   * Node counts are the kit's. Link counts and most linked things come from walks (lib/graph),
   * run in the background once the map is drawn, a selected type first, stopped when the view is
   * left, and kept for the session; until a walk is done its numbers say they are partial. The
   * map is laid out in a fixed box and scaled to fit, so every window draws the same picture
   * (G-7). Below 960px the map gives way to the same contents as a list (G-11).
   */
  import type { SealedFile } from "@mosaic/kit";
  import { onMount } from "svelte";
  import { mapData, mostLinkedByEdge, mostLinkedOfType, mostLinkedWalk, type MapEdge, type MostLinked } from "../lib/graph/map.js";
  import { average, COLUMN, columns, edgeTable, noun, number, partialNote, placeNames, strokeWidth, typeTable, walksFor, type Rect } from "../lib/graph/mapview.js";
  import { layoutSchema, type PlacedType } from "../lib/graph/schema.js";
  import { talliesFor, Walker } from "../lib/graph/session.js";
  import { shardPoints, svgPoints } from "../lib/graph/shard.js";
  import type { TableRoute } from "../lib/route.js";
  import type { Shape } from "../lib/view.js";

  let {
    file,
    shape,
    hrefFor,
    tableHref,
  }: {
    file: SealedFile;
    shape: Shape;
    hrefFor: (id: string) => string;
    tableHref: (route: TableRoute) => string;
  } = $props();

  /** The map's box, in its own units: the SVG scales it to the column. */
  const BOX = { width: 800, height: 560, room: 150 };

  const tallies = $derived(talliesFor(file));
  /** Bumped after each page a walk counts, so the numbers follow. */
  let counted = $state(0);
  const data = $derived.by(() => {
    void counted;
    return mapData(file, shape, tallies);
  });
  const layout = $derived(
    layoutSchema(
      file.nodeTypes.map((t) => ({ name: t.name, count: t.count })),
      file.edgeTypes,
      BOX,
    ),
  );
  const mostLinks = $derived(Math.max(0, ...data.edges.map((e) => e.links.value ?? 0)));
  const edgeByName = $derived(new Map(data.edges.map((e) => [e.name, e])));
  const typeByName = $derived(new Map(data.types.map((t) => [t.name, t])));

  type Selection = { readonly kind: "type" | "edge"; readonly name: string };
  let selected = $state<Selection | null>(null);
  let failed = $state<string | null>(null);
  let walker: Walker | null = null;

  onMount(() => {
    walker = new Walker(
      tallies,
      () => counted++,
      undefined,
      (type, e) => (failed = `Could not count the links of ${type}: ${e instanceof Error ? e.message : String(e)}`),
    );
    walker.want(data.needs);
    return () => walker?.stop();
  });

  function select(next: Selection): void {
    selected = next;
    walker?.want(walksFor(next, file.edgeTypes), true);
  }

  function key(event: KeyboardEvent, next: Selection): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(next);
    }
  }

  const isSelected = (kind: Selection["kind"], name: string) => selected?.kind === kind && selected.name === name;
  const typeLabel = (type: string | null) => (type === null ? "any type" : shape.typeLabel(type));
  const edgeLabel = (edge: MapEdge) => (edge.from === null ? edge.name : (shape.label(edge.from, edge.name) ?? edge.name));
  const linkCount = (edge: MapEdge) => (edge.links.value === null ? "…" : `${number(edge.links.value)}${edge.links.partial ? "…" : ""}`);

  /** Where a type's name and count go, beside its shard. */
  function labelAt(t: PlacedType): { x: number; y: number; anchor: "start" | "middle" | "end"; dy: number } {
    switch (t.side) {
      case "below":
        return { x: t.x, y: t.y + t.r + 20, anchor: "middle", dy: 18 };
      case "above":
        return { x: t.x, y: t.y - t.r - 26, anchor: "middle", dy: 18 };
      case "right":
        return { x: t.x + t.r + 10, y: t.y - 4, anchor: "start", dy: 18 };
      default:
        return { x: t.x - t.r - 10, y: t.y - 4, anchor: "end", dy: 18 };
    }
  }

  /** A type's name is a 15px bold title: a column of it is at most this wide. */
  const TITLE_COLUMN = 9.5;

  /** What arrows' names keep clear of: each shard, and each type's name and count. */
  const keepClear = $derived.by((): Rect[] => {
    const out: Rect[] = [];
    for (const t of layout.types) {
      const r = Math.max(t.r, 4);
      out.push({ x: t.x - r, y: t.y - r, width: 2 * r, height: 2 * r });
      const at = labelAt(t);
      const width = Math.max(columns(typeLabel(t.name)) * TITLE_COLUMN, columns(number(t.count)) * COLUMN);
      const left = at.anchor === "start" ? at.x : at.anchor === "end" ? at.x - width : at.x - width / 2;
      out.push({ x: left, y: at.y - 15, width, height: at.dy + 19 });
    }
    return out;
  });

  /** Each arrow's name and count, placed apart from one another and from the types. */
  const names = $derived(
    placeNames(
      layout.edges.map((e) => ({ ...e, name: edgeLabel(edgeByName.get(e.name)!), count: linkCount(edgeByName.get(e.name)!) })),
      BOX,
      keepClear,
    ),
  );

  /** How far the walks have got, for a caption: none when every count is whole. */
  const progress = $derived.by(() => {
    if (data.complete) return null;
    const walking = data.needs.map((t) => tallies.peek(t));
    const things = data.needs.reduce((s, t) => s + (typeByName.get(t)?.count ?? 0), 0);
    const done = walking.reduce((s, t) => s + (t?.counted ?? 0), 0);
    return `Counting links: ${number(done)} of ${number(things)} ${noun(things, "thing", "things")} so far. Counts marked … are partial.`;
  });

</script>

<div class="schema">
  <div class="canvas">
    <p class="intro caption">
      {number(data.types.length)} types · {number(data.edges.length)} edge types
    </p>
    <svg class="map" viewBox="0 0 {BOX.width} {BOX.height}" role="group" aria-label="Map of the types and edge types">
      <defs>
        <marker
          id="schema-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path class="head" d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {#each layout.edges as e (e.name)}
        {@const edge = edgeByName.get(e.name)!}
        {@const width = strokeWidth(edge.links.value, mostLinks)}
        <g
          class="edge"
          class:selected={isSelected("edge", e.name)}
          role="button"
          tabindex="0"
          data-edge={e.name}
          aria-pressed={isSelected("edge", e.name)}
          aria-label="{edgeLabel(edge)}: from {typeLabel(edge.from)} to {typeLabel(edge.to)}, {linkCount(edge)} {noun(edge.links.value, "link", "links", edge.links.partial)}"
          onclick={() => select({ kind: "edge", name: e.name })}
          onkeydown={(event) => key(event, { kind: "edge", name: e.name })}
        >
          <!-- The focus ring follows the line (brand book §6): 2px of ring around a band as wide as the thickest arrow and 2px either side. -->
          <path class="ring" d="M{e.start.x},{e.start.y} Q{e.control.x},{e.control.y} {e.end.x},{e.end.y}" />
          <path class="ring-gap" d="M{e.start.x},{e.start.y} Q{e.control.x},{e.control.y} {e.end.x},{e.end.y}" />
          <path
            class="line"
            d="M{e.start.x},{e.start.y} Q{e.control.x},{e.control.y} {e.end.x},{e.end.y}"
            stroke-width={width}
            marker-end="url(#schema-arrow)"
          />
          <path class="hit" d="M{e.start.x},{e.start.y} Q{e.control.x},{e.control.y} {e.end.x},{e.end.y}" />
        </g>
      {/each}
      <!-- Arrows' names and counts, above every arrow: each on a box the arrows pass behind. -->
      <g class="edge-labels" aria-hidden="true">
        {#each layout.edges as e, i (e.name)}
          {@const at = names[i]!}
          <g class:selected={isSelected("edge", e.name)}>
            <rect class="label-back" x={at.back.x} y={at.back.y} width={at.back.width} height={at.back.height} />
            <text class="edge-label caption" x={at.x} y={at.y} text-anchor="middle">{at.text}</text>
          </g>
        {/each}
      </g>
      {#each layout.types as t (t.name)}
        {@const at = labelAt(t)}
        <g
          class="type"
          class:selected={isSelected("type", t.name)}
          role="button"
          tabindex="0"
          data-type={t.name}
          aria-pressed={isSelected("type", t.name)}
          aria-label="{typeLabel(t.name)}: {number(t.count)} {noun(t.count, "thing", "things")}"
          onclick={() => select({ kind: "type", name: t.name })}
          onkeydown={(event) => key(event, { kind: "type", name: t.name })}
        >
          <polygon class="shard" points={svgPoints(shardPoints(t.name, t.x, t.y, Math.max(t.r, 4)))} />
          <text class="type-label panel-title" x={at.x} y={at.y} text-anchor={at.anchor}>{typeLabel(t.name)}</text>
          <text class="type-count caption" x={at.x} y={at.y + at.dy} text-anchor={at.anchor}>{number(t.count)}</text>
        </g>
      {/each}
    </svg>
    <p class="caption note map-note">
      Each shard is one type, sized by how many things it holds. Each arrow is an edge type, from the type it leaves to
      the type it reaches, as thick as its links.
    </p>
    {#if progress}
      <p class="caption note" role="status">{progress}</p>
    {/if}
    {#if failed}
      <p class="banner body-screen" role="alert">{failed}</p>
    {/if}
    {#if layout.unplaced.length > 0}
      <p class="caption note">Edge types that do not name both their types, so no arrow can join them:</p>
      <ul class="unplaced">
        {#each layout.unplaced as e (e.name)}
          <li>
            <button type="button" class="pick body-screen" onclick={() => select({ kind: "edge", name: e.name })}>
              <span class="code">{e.name}</span> · {linkCount(edgeByName.get(e.name)!)}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Below 960px: the same contents as a list (G-11). -->
    <div class="list">
      <h3 class="section-label heading">Types</h3>
      <ul>
        {#each data.types as t (t.name)}
          <li>
            <button
              type="button"
              class="pick body-screen"
              class:selected={isSelected("type", t.name)}
              aria-pressed={isSelected("type", t.name)}
              onclick={() => select({ kind: "type", name: t.name })}
            >
              <span>{t.label}</span><span class="figure">{number(t.count)}</span>
            </button>
          </li>
        {/each}
      </ul>
      <h3 class="section-label heading">Edge types</h3>
      <ul>
        {#each data.edges as e (e.name)}
          <li>
            <button
              type="button"
              class="pick body-screen"
              class:selected={isSelected("edge", e.name)}
              aria-pressed={isSelected("edge", e.name)}
              onclick={() => select({ kind: "edge", name: e.name })}
            >
              <span>{edgeLabel(e)} <span class="caption">{typeLabel(e.from)} → {typeLabel(e.to)}</span></span><span class="figure">{linkCount(e)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>

  <aside class="panel" aria-label="Selection" aria-live="polite">
    {#if selected === null}
      <p class="empty body-screen">Select a type or an edge type to see its description, its counts and where to start.</p>
    {:else if selected.kind === "type"}
      {@const t = typeByName.get(selected.name)!}
      {@const most = mostLinkedOfType(tallies, t.name)}
      <h3 class="section-label heading">Selected type</h3>
      <p class="panel-title name">{t.label}</p>
      {#if t.label !== t.name}<p class="code muted">{t.name}</p>{/if}
      {#if t.describe}<p class="body-screen">{t.describe}</p>{/if}
      <p class="stat"><span class="figure big">{number(t.count)}</span> <span class="caption">{noun(t.count, "thing", "things")}</span></p>
      <a class="button step-title" href={tableHref(typeTable(t.name))}>Open as table</a>
      <h3 class="section-label heading">Most linked</h3>
      <p class="caption muted">Good places to start: the {t.label} things with the most links, both ways.</p>
      {@render things(most, t.label)}
    {:else}
      {@const e = edgeByName.get(selected.name)!}
      {@const most = mostLinkedByEdge(file, tallies, e.name)}
      {@const table = edgeTable(e)}
      <h3 class="section-label heading">Selected edge type</h3>
      <p class="panel-title name">{edgeLabel(e)}</p>
      <p class="code muted">{e.name}: {typeLabel(e.from)} → {typeLabel(e.to)}</p>
      {#if e.describe}<p class="body-screen">{e.describe}</p>{/if}
      <p class="stat"><span class="figure big">{linkCount(e)}</span> <span class="caption">{noun(e.links.value, "link", "links", e.links.partial)}</span></p>
      {#if e.perThing.value !== null}
        <p class="stat">
          <span class="figure big">{average(e.perThing.value)}{e.perThing.partial ? "…" : ""}</span>
          <span class="caption">per thing of {typeLabel(e.from)}, on average</span>
        </p>
      {/if}
      {#if e.links.partial}<p class="caption muted">Counts marked … are partial: the links are still being counted.</p>{/if}
      {#if table}
        <a class="button step-title" href={tableHref(table)}>Open as table</a>
        <p class="caption muted">Opens the table of {typeLabel(e.from)}, the type this edge type leaves; each thing's page lists its links.</p>
      {/if}
      <h3 class="section-label heading">Most linked</h3>
      <p class="caption muted">Good places to start: the things most of its links reach.</p>
      {@render things(most, typeLabel(mostLinkedWalk(file, e.name)))}
    {/if}
  </aside>
</div>

{#snippet things(most: MostLinked, counting: string)}
  {#if partialNote(most, counting)}<p class="caption muted" role="status">{partialNote(most, counting)}</p>{/if}
  {#if most.things.length === 0}
    {#if !most.partial}<p class="caption muted">No links.</p>{/if}
  {:else}
    <ol class="linked">
      {#each most.things as thing (thing.id)}
        <li>
          <a class="row body-screen" href={hrefFor(thing.id)}>
            <span>{thing.label ?? thing.id}</span><span class="figure">{number(thing.links)}{most.partial ? "…" : ""}</span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
{/snippet}

<style>
  .schema {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
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

  .map,
  .map-note {
    display: none;
  }

  .map {
    inline-size: 100%;
    block-size: auto;
  }

  .shard {
    fill: var(--accent);
    stroke: var(--surface);
    stroke-width: 2;
  }

  .type:hover .shard {
    fill: var(--shard-5);
  }

  .type.selected .shard {
    stroke: var(--heading);
    stroke-width: 4;
  }

  .type-label {
    fill: var(--heading);
  }

  .type.selected .type-label {
    fill: var(--accent);
  }

  .type-count,
  .edge-label {
    fill: var(--ink-muted);
    font-family: var(--font-mono);
  }

  /* Names and counts stay readable where an arrow passes under them. */
  .type-label,
  .type-count,
  .edge-label {
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 4;
    stroke-linejoin: round;
  }

  .line {
    fill: none;
    stroke: var(--ink-muted);
  }

  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 16;
  }

  .head {
    fill: var(--ink-muted);
  }

  .edge:hover .line,
  .edge.selected .line {
    stroke: var(--accent);
  }

  .edge-labels .selected .edge-label {
    fill: var(--accent);
  }

  .edge-labels {
    pointer-events: none;
  }

  .label-back {
    fill: var(--surface);
  }

  .type,
  .edge {
    cursor: pointer;
  }

  .type:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* An arrow's ring follows its curve, not the box around it. */
  .edge:focus {
    outline: none;
  }

  .ring,
  .ring-gap {
    fill: none;
    stroke-linecap: round;
    visibility: hidden;
  }

  /* The thickest arrow is 6 wide: 2 of gap either side of it, then 2 of ring. */
  .ring {
    stroke: var(--focus-ring);
    stroke-width: 14;
  }

  .ring-gap {
    stroke: var(--surface);
    stroke-width: 10;
  }

  .edge:focus-visible .ring,
  .edge:focus-visible .ring-gap {
    visibility: visible;
  }

  .list ul,
  .unplaced,
  .linked {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .heading {
    margin: var(--space-4) 0 var(--space-1);
    color: var(--accent);
    text-transform: uppercase;
  }

  .pick,
  .row {
    box-sizing: border-box;
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    inline-size: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-inline-start: 3px solid transparent;
    background: none;
    color: var(--ink);
    text-align: start;
    text-decoration: none;
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .pick:hover,
  .row:hover {
    background: var(--surface-tint);
  }

  .pick:focus-visible,
  .row:focus-visible,
  .button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .pick.selected {
    border-inline-start-color: var(--accent);
    background: var(--surface-tint);
    color: var(--accent);
  }

  .figure {
    font-family: var(--font-mono);
    color: var(--ink-muted);
  }

  .big {
    color: var(--heading);
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

  .stat {
    margin: var(--space-2) 0;
  }

  .button {
    display: inline-block;
    margin-block: var(--space-2);
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

  /* From 960px: the map, with the selection beside it. */
  @media (width >= 960px) {
    .schema {
      grid-template-columns: minmax(0, 1fr) 320px;
    }

    .map {
      display: block;
    }

    .list {
      display: none;
    }

    .map-note {
      display: block;
    }

    .panel {
      border-block-start: none;
      border-inline-start: 1px solid var(--border);
    }
  }
</style>
