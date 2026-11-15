<script lang="ts">
  /**
   * The graph of Explore (needs G-3, G-4, G-5, G-7, G-8, G-10): the thing at the centre and what
   * it links to, as shards coloured by type with their names under them, on a stage the graph
   * fills. Above it, one chip per link type shows or hides that type's links, "Fit to view"
   * brings the whole picture back on the stage and "Tidy layout" forgets where things were
   * dragged and settles the picture again.
   *
   * A thing shows a few of its links per link type; a badge "+N" counts the links it keeps
   * folded. Pointing at a thing (or moving the keyboard's focus to it) shows a small summary;
   * selecting it tells the page (`onselect`), which shows its card; selecting it again unfolds
   * it, and again shows more. A thing dragged stays where it is dropped. The stage itself is
   * dragged to move the picture, and the wheel makes it larger or smaller.
   *
   * The data is the kit's, loaded by lib/graph/hood.ts with bounded calls and kept for the
   * session; the layout is lib/graph/hood-layout.ts, laid out by forces, the same picture for the
   * same thing and choices (G-7). The address holds the choices made (G-8): the view opens from
   * an address's choices (`address`), applying what the mosaic allows and saying what it could
   * not, and tells the page each new state (`onchoices`).
   */
  import type { SealedFile } from "@mosaic/kit";
  import { untrack } from "svelte";
  import Shard from "./Shard.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import { canExpand, expand, hoodOf, recentre, showEdge, shows, type Hood, type HoodState, type Loaded } from "../lib/graph/hood.js";
  import { layoutHood, placesOf, settleHood, type PlacedGroup, type PlacedThing } from "../lib/graph/hood-layout.js";
  import type { Point } from "../lib/graph/force-layout.js";
  import { allOnStage, edgeChoices, fitView, foldedLinks, onStage, tipPlace, type View } from "../lib/graph/hoodview.js";
  import { cutTo, noun, number } from "../lib/graph/mapview.js";
  import { hoodLoaderFor } from "../lib/graph/session.js";
  import { linkKey } from "../lib/graph/sources.js";
  import { applyAddress, hoodRoute } from "../lib/graph/hood-address.js";
  import type { HoodChoices } from "../lib/route.js";
  import { typeColours } from "../lib/typecolour.context.js";
  import type { Shape } from "../lib/view.js";

  let {
    file,
    shape,
    centre,
    selected = null,
    onselect,
    address = null,
    onchoices,
  }: {
    file: SealedFile;
    shape: Shape;
    /** The thing at the centre. */
    centre: string;
    /** The thing selected, whose card the page shows. */
    selected?: string | null;
    onselect?: (id: string) => void;
    /** The choices the address holds (G-8), applied when the centre or the address changes. */
    address?: HoodChoices | null;
    /** Told each state the person's choices make, so the page's address can hold it. */
    onchoices?: (state: HoodState) => void;
  } = $props();

  const uid = $props.id();
  const colourOf = typeColours();

  /** How far a shard reaches from its middle: the thing at the centre, and any other. */
  const R_CENTRE = 32;
  const R_THING = 22;
  /** A shard's corners, as parts of its box. */
  const CORNERS = [
    [0.5, 0],
    [0.96, 0.22],
    [0.88, 0.8],
    [0.42, 1],
    [0.04, 0.7],
    [0.1, 0.2],
  ] as const;
  /** Most characters of a name under a shard. */
  const NAME = 28;
  const TIP_WIDE = 230;

  /** The person's choices (G-5): what is unfolded and the edge types shown, for the thing at the centre. */
  let choices = $state<HoodState | null>(null);
  let hood = $state<Hood | null>(null);
  let failed = $state<string | null>(null);
  /** What the address asked that the mosaic does not allow (G-8). */
  let unapplied = $state<readonly string[]>([]);

  // The centre follows the address. A new centre keeps the edge types shown and starts with
  // nothing more unfolded, unless the address says otherwise.
  $effect(() => {
    const c = centre;
    const asked = address;
    let stop: (() => void) | undefined;
    untrack(() => {
      if (asked !== null) {
        // An address with choices: open as it says, unless that is what is drawn already.
        if (choices !== null && choices.centre === c && sameChoices(choices, asked)) return;
        let current = true;
        void applyAddress(file, c, asked).then((applied) => {
          if (!current || centre !== c) return;
          choices = applied.state;
          unapplied = applied.unapplied;
        });
        stop = () => (current = false);
        return;
      }
      if (choices === null) choices = hoodOf(c);
      else if (choices.centre !== c) {
        choices = recentre(choices, c);
        unapplied = [];
      }
    });
    return stop;
  });

  /** Whether `state` is what `asked` names, as its address would write it. */
  function sameChoices(state: HoodState, asked: HoodChoices): boolean {
    return JSON.stringify(hoodRoute(state).hood ?? null) === JSON.stringify({ expanded: asked.expanded, edges: asked.edges });
  }

  // Each state the person's choices make goes to the page, for its address (G-8).
  $effect(() => {
    const state = choices;
    if (state !== null) untrack(() => onchoices?.(state));
  });

  $effect(() => {
    const state = choices;
    if (state === null) return;
    if (hood !== null && untrack(() => JSON.stringify(hood!.state) === JSON.stringify(state))) return;
    failed = null;
    let current = true;
    hoodLoaderFor(file)
      .load(state)
      .then((loaded) => current && (hood = loaded))
      .catch((e: unknown) => current && (failed = e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  });

  /** The neighbourhood drawn: the last one loaded for the thing at the centre, kept while a new choice loads. */
  const shown = $derived(hood !== null && choices !== null && hood.state.centre === choices.centre ? hood : null);
  const busy = $derived(shown === null || JSON.stringify(shown.state) !== JSON.stringify(choices));

  /** Things the person dragged round a centre, where they were dropped: they stay there. */
  let pins = $state<{ centre: string; at: ReadonlyMap<string, Point> } | null>(null);
  /** Where everything was last drawn, and round which centre: a new picture of it stays near there. */
  let last: { centre: string; places: Map<string, Point> } | null = null;
  /** Bumped by "Tidy layout", so the picture settles again from nothing. */
  let tidied = $state(0);
  /** True while a thing is dragged: the picture settles in fewer ticks, to keep up with the pointer. */
  let dragging = $state(false);
  const DRAG_TICKS = 20;

  const layout = $derived.by(() => {
    void tidied;
    if (shown === null) return null;
    const id = shown.centre.centre.id;
    const start = layoutHood(shown.centre, shown.expanded, { shows: (e) => shows(shown.state, e) });
    const before = untrack(() => last);
    const pinned = pins?.centre === id ? { pinned: pins.at } : {};
    const settled = settleHood(start, before?.centre === id ? { previous: before.places, ...pinned, ...(dragging ? { ticks: DRAG_TICKS } : {}) } : pinned);
    last = { centre: id, places: placesOf(settled) };
    return settled;
  });

  /** The stage's size, and how the picture sits on it. */
  let width = $state(0);
  let height = $state(0);
  let view = $state.raw<View | null>(null);
  /** What the view was last fitted to: a new centre or a new size fits it again. */
  let fitted: { centre: string; width: number; height: number } | null = null;

  // The picture fits the stage when it is first drawn, when the stage changes size, and when a
  // new choice puts a thing off the stage; otherwise it stays as the person left it.
  $effect(() => {
    const l = layout;
    const stage = { width, height };
    if (l === null || width === 0 || height === 0) return;
    untrack(() => {
      if (dragging) return;
      const id = l.things[0]!.id;
      const same = fitted !== null && fitted.centre === id && fitted.width === width && fitted.height === height;
      if (view !== null && same && allOnStage(l.things, view, stage)) return;
      view = fitView(l.things, stage);
      fitted = { centre: id, ...stage };
    });
  });

  function fit(): void {
    if (layout !== null && width > 0 && height > 0) view = fitView(layout.things, { width, height });
  }

  function tidy(): void {
    pins = null;
    last = null;
    fitted = null;
    tidied++;
  }

  const radius = (t: PlacedThing) => (t.parent === null ? R_CENTRE : R_THING);
  /** Each thing drawn, with where the view puts it. */
  const things = $derived(view === null || layout === null ? [] : layout.things.map((t) => ({ t, r: radius(t), ...onStage(view!, t) })));
  const at = $derived(new Map(things.map((p) => [p.t.id, p])));
  const folded = $derived(shown === null || layout === null ? new Map<string, number>() : foldedLinks(shown, layout));
  /** Every thing loaded, by id, with its link counts. */
  const loaded = $derived(new Map<string, Loaded>((shown === null ? [] : [shown.centre, ...shown.expanded, ...shown.leaves]).map((l) => [l.centre.id, l])));

  /** True when thing `id` is drawn: the page selects only what the graph shows. */
  export function has(id: string): boolean {
    return at.has(id);
  }

  const typeLabel = (type: string | null) => (type === null ? "type not known" : shape.typeLabel(type));
  const nameOf = (t: { id: string; label: string | null }) => t.label ?? t.id;
  /** An edge type as a reader says it, as the view file names it for `type`; links reaching the thing start with "←". */
  function edgeName(type: string | null, edge: string, direction: "out" | "in" = "out"): string {
    const words = (type === null ? null : shape.edgeLabel(type, edge)) ?? edge.replaceAll("_", " ");
    return direction === "in" ? `← ${words}` : words;
  }

  /** The lines drawn: one per start, edge type and end. */
  const lines = $derived.by(() => {
    const seen = new Set<string>();
    return (layout?.links ?? []).filter((l) => !seen.has(linkKey(l)) && seen.add(linkKey(l)) !== undefined);
  });

  /** One name per group of lines: beside the middle line of the group, half way along it. */
  const groupNames = $derived.by(() => {
    const out: { key: string; text: string; x: number; y: number; anchor: "start" | "middle" | "end" }[] = [];
    // A line belongs to the first group that draws it: the line an unfolded thing hangs by is its owner's.
    const named = new Set<string>();
    for (const g of layout?.groups ?? []) {
      const owner = at.get(g.owner);
      const mine = lines.filter((l) => l.edge === g.edge && l.from !== l.to && (g.direction === "out" ? l.from === g.owner : l.to === g.owner) && !named.has(linkKey(l)));
      for (const l of mine) named.add(linkKey(l));
      const ends = mine.map((l) => at.get(g.direction === "out" ? l.to : l.from));
      const end = ends[Math.floor((ends.length - 1) / 2)];
      if (owner === undefined || end === undefined) continue;
      const d = Math.max(1e-9, Math.hypot(end.x - owner.x, end.y - owner.y));
      // Beside the line, on its right going out and reading away from it, and every other name
      // nearer the owner, so the names of two lines side by side do not meet.
      const along = out.length % 2 === 0 ? 0.62 : 0.46;
      const side = { x: -(end.y - owner.y) / d, y: (end.x - owner.x) / d };
      out.push({
        key: groupKey(g),
        text: edgeName(owner.t.type, g.edge, g.direction),
        x: owner.x + (end.x - owner.x) * along + side.x * 8,
        y: owner.y + (end.y - owner.y) * along + side.y * 12 + 4,
        anchor: side.x > 0.3 ? "start" : side.x < -0.3 ? "end" : "middle",
      });
    }
    return out;
  });
  const groupKey = (g: PlacedGroup) => `${g.owner} ${g.edge} ${g.direction}`;

  /** A shard's corners round (`x`, `y`). */
  const shard = (x: number, y: number, r: number) => CORNERS.map(([cx, cy]) => `${Math.round((x - r + 2 * r * cx) * 10) / 10},${Math.round((y - r + 2 * r * cy) * 10) / 10}`).join(" ");
  /** A thing's link to itself: a loop out of its top right and back in at its right. */
  const loop = (p: { x: number; y: number; r: number }) => `M${p.x + p.r * 0.5},${p.y - p.r * 0.87} Q${p.x + p.r * 2.6},${p.y - p.r * 2.2} ${p.x + p.r},${p.y}`;

  /** The thing pointed at, and the thing the keyboard's focus is on. */
  let pointed = $state<string | null>(null);
  let focused = $state<string | null>(null);
  let tipHigh = $state(0);
  /** The thing whose summary shows, and where: on the stage and off the thing. */
  const tip = $derived.by(() => {
    const p = dragging ? undefined : at.get(pointed ?? focused ?? "");
    if (p === undefined) return null;
    const l = loaded.get(p.t.id);
    const facts = [...(l?.groups ?? [])]
      .filter((g) => g.count > 0 && (shown === null || shows(shown.state, g.edge)))
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map((g) => `${edgeName(p.t.type, g.edge, g.direction)} · ${number(g.count)}`);
    const n = folded.get(p.t.id) ?? 0;
    const more = choices !== null && canExpand(choices, p.t.id);
    const how =
      n === 0
        ? "select to read"
        : `${number(n)} ${noun(n, "link", "links")} folded · ${more ? (selected === p.t.id ? "select again to unfold" : "select to read, select again to unfold") : "open its table for the rest"}`;
    // Its name, under the shard, is part of the thing: the summary keeps off it too.
    const name = { wide: Math.min(nameOf(p.t).length, NAME) * 3.5 + 4, low: p.r + 22 };
    return { p, facts, how, ...tipPlace({ ...p, ...name }, { width: TIP_WIDE, height: tipHigh || 120 }, { width, height }) };
  });

  /** Select a thing; selected already, unfold it (again). */
  function activate(id: string): void {
    if (selected !== id) onselect?.(id);
    else if (choices !== null && (folded.get(id) ?? 0) > 0) choices = expand(choices, id);
  }

  function setEdge(edge: string, on: boolean): void {
    if (choices !== null) choices = showEdge(choices, file.edgeTypes.map((e) => e.name), edge, on);
  }

  let svg = $state<SVGSVGElement | null>(null);
  /** The thing being dragged, or the stage itself (`id` null), and where the pointer took it. */
  let drag: { id: string | null; pointer: number; x: number; y: number; from: View; moved: boolean } | null = null;
  /** Set when a drag ends, so the click it ends with does not also select. */
  let dropped = false;
  /** A pointer that moves less than this has clicked, not dragged. */
  const SLACK = 4;

  function grab(e: PointerEvent, id: string | null): void {
    dropped = false;
    if (e.button !== 0 || view === null) return;
    if (id === null && e.target !== e.currentTarget) return;
    drag = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY, from: view, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function pull(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.pointer || view === null || svg === null) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < SLACK) return;
    drag.moved = true;
    if (drag.id === null) {
      view = { k: drag.from.k, x: drag.from.x + e.clientX - drag.x, y: drag.from.y + e.clientY - drag.y };
      return;
    }
    const id = shown?.centre.centre.id;
    if (id === undefined) return;
    const box = svg.getBoundingClientRect();
    const p = { x: Math.round(((e.clientX - box.left - view.x) / view.k) * 100) / 100, y: Math.round(((e.clientY - box.top - view.y) / view.k) * 100) / 100 };
    dragging = true;
    pins = { centre: id, at: new Map(pins?.centre === id ? pins.at : []).set(drag.id, p) };
  }

  function drop(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.pointer) return;
    dropped = drag.moved && drag.id !== null;
    drag = null;
    dragging = false;
  }

  function click(id: string): void {
    if (dropped) dropped = false;
    else activate(id);
  }

  function key(e: KeyboardEvent, id: string): void {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    activate(id);
  }

  /** The wheel makes the picture larger or smaller round the pointer. */
  function zoom(e: WheelEvent): void {
    if (view === null || svg === null) return;
    e.preventDefault();
    const box = svg.getBoundingClientRect();
    const k = Math.max(0.2, Math.min(2, view.k * Math.exp(-e.deltaY * 0.0015)));
    const [x, y] = [e.clientX - box.left, e.clientY - box.top];
    view = { k, x: x - ((x - view.x) / view.k) * k, y: y - ((y - view.y) / view.k) * k };
  }
</script>

<div class="hood">
  <div class="bar">
    <div class="links" role="group" aria-label="Show links">
      <span class="heading section-label" aria-hidden="true">Show links</span>
      {#if shown !== null && choices !== null}
        {#each edgeChoices(shown) as edge (edge)}
          <Chip pressed={shows(choices, edge)} onclick={() => setEdge(edge, !shows(choices!, edge))}>{edgeName(shown.centre.centre.type, edge)}</Chip>
        {/each}
      {/if}
    </div>
    <Button onclick={fit}>Fit to view</Button>
    <Button onclick={tidy}>Tidy layout</Button>
  </div>
  {#each unapplied as note (note)}
    <p class="note caption" role="status" data-unapplied>{note}</p>
  {/each}
  {#each shown?.failed ?? [] as f (f.id)}
    <p class="note caption" role="status">Could not unfold {f.id}: {f.message}</p>
  {/each}
  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    {#if failed !== null}
      <p class="banner body-app" role="alert">Could not load the graph: {failed}</p>
    {:else if shown === null || view === null}
      <p class="note caption" role="status">Loading the graph…</p>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        class="picture"
        {width}
        {height}
        role="group"
        aria-busy={busy}
        aria-label="Graph round {nameOf(shown.centre.centre)}"
        bind:this={svg}
        onpointerdown={(e) => grab(e, null)}
        onpointermove={pull}
        onpointerup={drop}
        onpointercancel={drop}
        onwheel={zoom}
      >
        {#each lines as l (linkKey(l))}
          {@const from = at.get(l.from)}
          {@const to = at.get(l.to)}
          {#if from && to}
            {@const lit = pointed !== null && (l.from === pointed || l.to === pointed)}
            {#if l.from === l.to}
              <path class="link" class:lit data-link={linkKey(l)} d={loop(from)} />
            {:else}
              <line class="link" class:lit data-link={linkKey(l)} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            {/if}
          {/if}
        {/each}
        {#each groupNames as g (g.key)}
          <text class="group-name caption" data-group={g.key} x={g.x} y={g.y} text-anchor={g.anchor} aria-hidden="true">{g.text}</text>
        {/each}
        {#each things as { t, x, y, r } (t.id)}
          {@const n = folded.get(t.id) ?? 0}
          {@const badge = `+${number(n)}`}
          <g
            class="thing"
            class:selected={selected === t.id}
            role="button"
            tabindex="0"
            data-centre={t.parent === null ? t.id : undefined}
            data-thing={t.parent === null ? undefined : t.id}
            aria-pressed={selected === t.id}
            aria-label="{nameOf(t)} ({typeLabel(t.type)}){n > 0 ? `, ${number(n)} ${noun(n, 'link', 'links')} folded` : ''}"
            aria-describedby={tip?.p.t.id === t.id ? `${uid}-tip` : undefined}
            onclick={() => click(t.id)}
            onkeydown={(e) => key(e, t.id)}
            onpointerdown={(e) => grab(e, t.id)}
            onpointermove={pull}
            onpointerup={drop}
            onpointercancel={drop}
            onpointerenter={() => (pointed = t.id)}
            onpointerleave={() => pointed === t.id && (pointed = null)}
            onfocus={(e) => (focused = e.currentTarget.matches(":focus-visible") ? t.id : null)}
            onblur={() => focused === t.id && (focused = null)}
          >
            {#if selected === t.id}
              <circle class="ring" cx={x} cy={y} r={r + 9} />
            {/if}
            <polygon class="shard" data-type-colour={t.type === null ? undefined : (colourOf(t.type) ?? undefined)} points={shard(x, y, r)} />
            <text class="name caption" {x} y={y + r + 16} text-anchor="middle">{cutTo(nameOf(t), NAME)}</text>
            {#if n > 0}
              <g class="badge" data-folded={n} aria-hidden="true">
                <rect x={x + 8} y={y - r - 7} width={12 + 7 * badge.length} height="16" rx="8" />
                <text class="caption" x={x + 14 + 3.5 * badge.length} y={y - r + 5} text-anchor="middle">{badge}</text>
              </g>
            {/if}
          </g>
        {/each}
        {#if tip !== null}
          <foreignObject class="tip-box" x={tip.x} y={tip.y} width={TIP_WIDE} height={tipHigh || 120}>
            <div class="tip" role="tooltip" id="{uid}-tip" bind:offsetHeight={tipHigh}>
              <span class="kind caption"><Shard type={tip.p.t.type} />{typeLabel(tip.p.t.type)}</span>
              <strong class="label-app">{nameOf(tip.p.t)}</strong>
              {#each tip.facts as fact (fact)}
                <span class="caption">{fact}</span>
              {/each}
              <span class="how caption">{tip.how}</span>
            </div>
          </foreignObject>
        {/if}
      </svg>
    {/if}
  </div>
  <p class="hint caption">
    Point at a thing for a summary. Select it to read it on the right; select it again to unfold its links. Drag anything to rearrange; a dragged thing
    stays where you put it.
  </p>
</div>

<style>
  .hood {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-sizing: border-box;
    min-inline-size: 0;
    min-block-size: 0;
    padding: var(--space-4);
  }

  .bar,
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .links {
    flex: 1;
    min-inline-size: 0;
  }

  .heading {
    margin-inline-end: var(--space-1);
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .note,
  .hint {
    margin: 0;
    color: var(--ink-muted);
  }

  .stage .note {
    padding: var(--space-4);
  }

  .banner {
    margin: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  /* Below 960px the stage takes most of the window; from 960px, what the place leaves. */
  .stage {
    position: relative;
    block-size: 70vh;
    min-block-size: 320px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  @media (width >= 960px) {
    .stage {
      flex: 1;
      block-size: auto;
      min-block-size: 0;
    }
  }

  .picture {
    position: absolute;
    inset: 0;
    display: block;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .link {
    fill: none;
    stroke: var(--border);
    stroke-width: 2;
    pointer-events: none;
  }

  .link.lit {
    stroke: var(--accent);
  }

  .group-name,
  .name {
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 4;
    stroke-linejoin: round;
    pointer-events: none;
  }

  .group-name {
    fill: var(--ink-muted);
  }

  .name {
    fill: var(--ink);
  }

  .thing {
    cursor: grab;
    outline: none;
  }

  .shard {
    fill: var(--type-colour);
  }

  .ring {
    fill: none;
    stroke: var(--heading);
    stroke-width: 2;
    stroke-dasharray: 5 4;
  }

  .thing:focus-visible .shard {
    stroke: var(--focus-ring);
    stroke-width: 3;
    stroke-linejoin: round;
  }

  .badge rect {
    fill: var(--heading);
  }

  .badge text {
    fill: var(--surface);
    font-family: var(--font-mono);
    font-weight: bold;
  }

  .tip-box {
    overflow: visible;
    pointer-events: none;
  }

  .tip {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    box-sizing: border-box;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--raised);
    color: var(--ink);
    box-shadow: 0 var(--space-2) var(--space-5) var(--shadow);
    overflow-wrap: anywhere;
  }

  .tip strong {
    color: var(--heading);
  }

  .kind {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .kind,
  .how {
    color: var(--ink-muted);
  }
</style>
