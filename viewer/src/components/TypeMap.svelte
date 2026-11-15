<script lang="ts" module>
  import { number } from "../lib/graph/mapview.js";

  /** A count as the map writes it: whole below ten thousand, then in thousands ("36.4k"). */
  export function shortCount(n: number): string {
    if (n < 10_000) return number(n);
    if (n < 1_000_000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, "")}k`;
    return `${(Math.floor(n / 100_000) / 10).toFixed(1).replace(/\.0$/, "")}M`;
  }
</script>

<script lang="ts">
  /**
   * The map of types (Home): every node type as a shard sized by how many things it holds and
   * coloured by its type, a line between two types that link, and on the line a pill naming
   * their link types. A shard opens its type's table. The map is laid out for the stage it is
   * given (lib/graph/schema.ts: the same types and stage, the same picture) and centred in it.
   * A type's or a link type's description, where the view file gives one, is its tooltip.
   */
  import type { EdgeType, NodeType } from "@mosaic/kit";
  import { columns, cutTo, NAME_COLUMNS } from "../lib/graph/mapview.js";
  import { layoutSchema } from "../lib/graph/schema.js";
  import { shardPoints, svgPoints } from "../lib/graph/shard.js";
  import { typeColours } from "../lib/typecolour.context.js";
  import type { Shape } from "../lib/view.js";

  let {
    types,
    edges,
    shape,
    hrefFor,
  }: {
    types: readonly NodeType[];
    edges: readonly EdgeType[];
    shape: Shape;
    /** Where a type's table is. */
    hrefFor: (type: string) => string;
  } = $props();

  const colourOf = typeColours();

  /** The stage's size, once measured; before that, a stage every window can show. */
  let width = $state(0);
  let height = $state(0);
  const box = $derived({ width: Math.max(320, width || 800), height: Math.max(280, height || 560) });

  /** Under a shard: its name and its count. */
  const BELOW = 44;
  /** Clear room kept to the stage's edge, and half the room a type's name may take. */
  const EDGE = 16;
  const NAME_HALF = 60;
  /** A pill: its height, the room each side of its text, and the width of one column of it. */
  const PILL = { height: 20, pad: 9, column: 6.3 };

  const layout = $derived.by(() => {
    const short = Math.min(box.width, box.height);
    const placed = layoutSchema(types, edges, {
      width: box.width,
      height: box.height,
      minRadius: Math.max(14, Math.round(short * 0.04)),
      maxRadius: Math.max(28, Math.round(short * 0.1)),
      margin: 48,
      room: Math.min(150, Math.round(short * 0.22)),
    });
    // Drawn inside the stage: the centres pulled together when the shards, with the names under
    // them, would pass its edge, then the whole centred.
    const span = (of: (t: (typeof placed.types)[number]) => [number, number]) => {
      const ends = placed.types.map(of);
      return ends.length === 0 ? { low: 0, high: 0 } : { low: Math.min(...ends.map((e) => e[0])), high: Math.max(...ends.map((e) => e[1])) };
    };
    const squeeze = (size: number, centres: { low: number; high: number }, drawn: { low: number; high: number }): number => {
      const over = drawn.high - drawn.low - (centres.high - centres.low);
      return centres.high === centres.low ? 1 : Math.min(1, Math.max(0.2, (size - 2 * EDGE - over) / (centres.high - centres.low)));
    };
    const sx = squeeze(box.width, span((t) => [t.x, t.x]), span((t) => [t.x - Math.max(t.r, NAME_HALF), t.x + Math.max(t.r, NAME_HALF)]));
    // A type linked to itself carries that link's pill above it.
    const looped = new Set(placed.edges.filter((e) => e.from === e.to).map((e) => e.from));
    const above = (t: { name: string; r: number }): number => t.r + (looped.has(t.name) ? 2 * PILL.height : 0);
    const sy = squeeze(box.height, span((t) => [t.y, t.y]), span((t) => [t.y - above(t), t.y + t.r + BELOW]));
    const pulled = placed.types.map((t) => ({ ...t, x: t.x * sx, y: t.y * sy }));
    const xs = pulled.flatMap((t) => [t.x - t.r, t.x + t.r]);
    const ys = pulled.flatMap((t) => [t.y - above(t), t.y + t.r + BELOW]);
    const dx = xs.length === 0 ? 0 : Math.round(box.width / 2 - (Math.min(...xs) + Math.max(...xs)) / 2);
    const dy = ys.length === 0 ? 0 : Math.round(box.height / 2 - (Math.min(...ys) + Math.max(...ys)) / 2);
    return { ...placed, types: pulled.map((t) => ({ ...t, x: Math.round(t.x + dx), y: Math.round(t.y + dy) })) };
  });

  const edgeLabel = (e: { name: string; from: string }): string => shape.label(e.from, e.name) ?? e.name.replaceAll("_", " ");

  /** One pill per pair of linked types, naming every link type between them. */
  const pills = $derived.by(() => {
    const at = new Map(layout.types.map((t) => [t.name, t]));
    const pairs = new Map<string, { a: string; b: string; names: string[]; says: string[] }>();
    for (const e of layout.edges) {
      const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
      const pair = pairs.get(`${a}\n${b}`) ?? { a, b, names: [], says: [] };
      pair.names.push(edgeLabel(e));
      const says = shape.edgeDescription(e.name);
      if (says !== null) pair.says.push(`${edgeLabel(e)}: ${says}`);
      pairs.set(`${a}\n${b}`, pair);
    }
    return [...pairs.values()].map((pair) => {
      const a = at.get(pair.a)!;
      const b = at.get(pair.b)!;
      const text = cutTo(pair.names.join(" · "), NAME_COLUMNS);
      const wide = Math.round(columns(text) * PILL.column + 2 * PILL.pad);
      // Midway between the two shards' rims; a type linked to itself carries its pill above it.
      const gap = Math.hypot(b.x - a.x, b.y - a.y);
      const along = gap === 0 ? 0 : (a.r + (gap - a.r - b.r) / 2) / gap;
      const x = Math.round(a.x + (b.x - a.x) * along);
      const y = pair.a === pair.b ? Math.round(a.y - a.r - PILL.height) : Math.round(a.y + (b.y - a.y) * along);
      return { key: `${pair.a}\n${pair.b}`, loop: pair.a === pair.b, a, b, text, wide, x, y, says: pair.says.join("\n") };
    });
  });
</script>

<div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
  <svg class="map" viewBox="0 0 {box.width} {box.height}" role="group" aria-label="Map of types">
    <g aria-hidden="true">
      {#each pills as p (p.key)}
        {#if !p.loop}<line class="edge" x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} />{/if}
      {/each}
    </g>
    {#each layout.types as t (t.name)}
      {@const says = shape.typeDescription(t.name)}
      <a class="type" href={hrefFor(t.name)} data-type={t.name} data-type-colour={colourOf(t.name)} aria-label="{shape.typeLabel(t.name)}: {number(t.count)}">
        {#if says}<title>{says}</title>{/if}
        <polygon class="shard" points={svgPoints(shardPoints(t.name, t.x, t.y, t.r))} />
        <text class="name label-app" x={t.x} y={t.y + t.r + 20} text-anchor="middle">{shape.typeLabel(t.name)}</text>
        <text class="count caption" x={t.x} y={t.y + t.r + 38} text-anchor="middle">{shortCount(t.count)}</text>
      </a>
    {/each}
    {#each pills as p (p.key)}
      <g class="pill" data-link={p.key.replace("\n", " ")}>
        {#if p.says}<title>{p.says}</title>{/if}
        <rect x={p.x - p.wide / 2} y={p.y - PILL.height / 2} width={p.wide} height={PILL.height} rx={PILL.height / 2} />
        <text class="caption" x={p.x} y={p.y + 4} text-anchor="middle">{p.text}</text>
      </g>
    {/each}
  </svg>
</div>

<style>
  .stage {
    position: relative;
    flex: 1;
    min-block-size: 320px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .map {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
  }

  .edge {
    stroke: var(--border);
    stroke-width: 2;
  }

  .type {
    cursor: pointer;
    text-decoration: none;
  }

  .shard {
    fill: var(--type-colour);
  }

  .type:hover .shard {
    stroke: var(--heading);
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .type:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 4px;
  }

  .name {
    fill: var(--heading);
  }

  .count {
    fill: var(--ink-muted);
    font-family: var(--font-mono);
  }

  .pill rect {
    fill: var(--surface);
    stroke: var(--border);
  }

  .pill text {
    fill: var(--ink-muted);
  }
</style>
