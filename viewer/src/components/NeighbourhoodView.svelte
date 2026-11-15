<script lang="ts">
  /**
   * The Neighbourhood view (needs G-3, G-4, G-7, G-10, G-11): the thing at the centre
   * and its neighbours round it, grouped by edge type and direction, each group labelled with its
   * edge type and count. A group with more neighbours than the chosen limit (3, 5, 10 or 20) shows
   * that many and folds the rest into a bundle with its count; opening a bundle lists its things.
   * The view says when it shows only part. The Graph switch for the current thing opens it too.
   *
   * The data is the kit's, loaded by lib/graph/hood.ts with bounded calls (one `get` and one
   * `neighbors` per group) and kept for the session; the layout is lib/graph/hood-layout.ts, laid
   * out by forces, the same picture for the same thing and choices (G-7). A thing or bundle dragged
   * stays where it is dropped; a new choice keeps what was drawn near where it was. Below 960px
   * the picture gives way to the same contents as a list (G-11).
   *
   * The address holds the choices made (G-8): the view opens from an address's choices
   * (`address`), applying what the mosaic allows and saying what it could not, and tells the page
   * each new state (`onchoices`), so a link to it lands on exactly the same picture.
   *
   * Every link drawn keeps its source (G-6): selecting a thing shows its type's card,
   * the same card its page shows (V-7), and where it comes from; selecting a link (its line, or
   * from the list of a selected thing's links) shows the rows behind it, through `cite`
   * (lib/graph/sources.ts).
   */
  import type { SealedFile } from "@mosaic/kit";
  import { tick, untrack, type Snippet } from "svelte";
  import BundleList from "./BundleList.svelte";
  import CitationChip from "./CitationChip.svelte";
  import EntityCard from "./EntityCard.svelte";
  import Button from "./ui/Button.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import {
    collapse,
    DEFAULT_LIMIT,
    expand,
    hide,
    hoodOf,
    LIMITS,
    MOST_EXPANDED,
    MOST_HIDDEN,
    openBundle,
    recentre,
    showEdge,
    shows,
    unhide,
    withLimit,
    type Bundle,
    type Hood,
    type HoodState,
    type Limit,
    type Thing,
  } from "../lib/graph/hood.js";
  import { bundleId, layoutHood, placesOf, settleHood, type PlacedGroup, type PlacedThing } from "../lib/graph/hood-layout.js";
  import type { Point } from "../lib/graph/force-layout.js";
  import { groupText, mustOpen, once, partNotes, placeThingNames, summary, viewBoxOf } from "../lib/graph/hoodview.js";
  import { COLUMN, columns, noun, number, type Rect } from "../lib/graph/mapview.js";
  import { hoodLoaderFor, sourcesFor } from "../lib/graph/session.js";
  import { linkKey, type LinkRef, type Sources } from "../lib/graph/sources.js";
  import { shardPoints, svgPoints } from "../lib/graph/shard.js";
  import { applyAddress, hoodRoute } from "../lib/graph/hood-address.js";
  import { routeHash, type HoodChoices, type TableRoute } from "../lib/route.js";
  import type { NodeView } from "../lib/mosaic.js";
  import type { Shape } from "../lib/view.js";

  let {
    file,
    shape,
    centre,
    hrefFor,
    tableHref,
    hoodHref = (id: string) => routeHash({ query: "", node: id, view: "explore" }),
    initial,
    selected: first,
    selectedLink: firstLink,
    sources: given,
    address = null,
    unapplied: firstUnapplied = [],
    onchoices,
    only = null,
    extra,
  }: {
    file: SealedFile;
    shape: Shape;
    /** The thing at the centre: the current thing, or null when none is open. */
    centre: string | null;
    hrefFor: (id: string) => string;
    tableHref: (table: TableRoute) => string;
    /** The address of a thing's neighbourhood: re-centring goes there, so the address follows. */
    hoodHref?: (id: string) => string;
    /** A neighbourhood already loaded, drawn at once (the page loads its own). */
    initial?: Hood;
    /** A thing selected from the start. */
    selected?: string;
    /** A link selected from the start. */
    selectedLink?: LinkRef;
    /** Cards and link rows already read (the page reads its own, kept for the session). */
    sources?: Sources;
    /** The choices the address holds (G-8), applied when the centre or the address changes. */
    address?: HoodChoices | null;
    /** What an address already applied could not apply, said from the start. */
    unapplied?: readonly string[];
    /** Told each state the person's choices make, so the page's address can hold it. */
    onchoices?: (state: HoodState) => void;
    /** Show only the graph or only the selection's card (a narrow page shows one at a time). */
    only?: "graph" | "card" | null;
    /**
     * Shown under the selected thing's card, given its page: the shell's card picker and the
     * thing's links and sources, in place of the plain list of sources.
     */
    extra?: Snippet<[NodeView]>;
  } = $props();

  /** Shard sizes: the thing at the centre, a neighbour, a bundle. */
  const R_CENTRE = 26;
  const R_THING = 13;
  const R_BUNDLE = 22;

  /** The person's choices (G-5): expanded, hidden, edge types shown and limit, for the thing at the centre. */
  let choices = $state<HoodState | null>(untrack(() => initial?.state ?? (centre === null ? null : hoodOf(centre))));
  const limit = $derived(choices?.limit ?? DEFAULT_LIMIT);

  let hood = $state<Hood | null>(untrack(() => initial ?? null));
  let failed = $state<string | null>(null);

  /** What the address asked that the mosaic does not allow (G-8). */
  let unapplied = $state<readonly string[]>(untrack(() => firstUnapplied));

  // The centre follows the address. A new centre keeps the edge types shown and the limit, and
  // starts with nothing expanded, hidden or selected, unless the address says otherwise.
  $effect(() => {
    const c = centre;
    const asked = address;
    let stop: (() => void) | undefined;
    untrack(() => {
      if (c === null) return;
      if (asked !== null) {
        // An address with choices: open as it says, unless that is what is drawn already.
        if (choices !== null && choices.centre === c && sameChoices(choices, asked)) return;
        let current = true;
        void applyAddress(file, c, asked).then((applied) => {
          if (!current || centre !== c) return;
          if (choices?.centre !== c) {
            selected = { kind: "thing", id: c };
            opened = null;
          }
          choices = applied.state;
          unapplied = applied.unapplied;
        });
        stop = () => (current = false);
        return;
      }
      if (choices === null) choices = hoodOf(c);
      else if (choices.centre !== c) {
        choices = recentre(choices, c);
        selected = { kind: "thing", id: c };
        opened = null;
        unapplied = [];
      }
    });
    return stop;
  });

  /** Whether `state` is what `asked` names, as its address would write it. */
  function sameChoices(state: HoodState, asked: HoodChoices): boolean {
    const written = hoodRoute(state).hood ?? null;
    return JSON.stringify(written) === JSON.stringify({ expanded: asked.expanded, hidden: asked.hidden, edges: asked.edges, limit: asked.limit });
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

  /**
   * The neighbourhood drawn: the last one loaded for the thing at the centre, kept while a new
   * choice loads (the picture says it is busy), else none yet.
   */
  const shown = $derived(hood !== null && choices !== null && hood.state.centre === choices.centre ? hood : null);
  const busy = $derived(shown === null || JSON.stringify(shown.state) !== JSON.stringify(choices));
  /**
   * Things and bundles the person dragged round a centre, where they were dropped: they stay
   * there. A new centre is a new picture, with nothing pinned.
   */
  let pins = $state<{ centre: string; at: ReadonlyMap<string, Point> } | null>(null);
  /** Where everything was last drawn, and round which centre: a new picture of it stays near there. */
  let last: { centre: string; places: Map<string, Point> } | null = null;
  /** Ticks per pointer move while dragging; the drop settles the picture fully. */
  const DRAG_TICKS = 20;
  const layout = $derived.by(() => {
    if (shown === null) return null;
    const id = shown.centre.centre.id;
    const start = layoutHood(shown.centre, shown.expanded, { hidden: new Set(shown.state.hidden), shows: (e) => shows(shown.state, e) });
    const before = untrack(() => last);
    const pinned = pins?.centre === id ? pins.at : undefined;
    const ticks = dragBox === null ? undefined : DRAG_TICKS;
    const settled = settleHood(start, before?.centre === id ? { previous: before.places, ...(pinned ? { pinned } : {}), ...(ticks ? { ticks } : {}) } : {});
    last = { centre: id, places: placesOf(settled) };
    return settled;
  });

  /** The thing or bundle being dragged, and the picture's box while it is: the box holds still under the pointer. */
  let drag: { id: string; pointer: number; moved: boolean; box: Rect } | null = null;
  let dragBox = $state<Rect | null>(null);
  /** Set when a drag ends, so the click it ends with does not also select. */
  let dropped = false;
  const box = $derived(dragBox ?? (layout === null ? null : viewBoxOf(layout)));

  function svgPoint(e: PointerEvent): Point | null {
    const svg = (e.currentTarget as Element).closest("svg");
    const m = svg?.getScreenCTM?.();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
  }

  function grab(e: PointerEvent, id: string): void {
    dropped = false;
    if (e.button !== 0 || box === null) return;
    drag = { id, pointer: e.pointerId, moved: false, box };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function pull(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.pointer) return;
    const p = svgPoint(e);
    if (p === null) return;
    if (!drag.moved) {
      drag.moved = true;
      dragBox = drag.box;
    }
    const centre = shown?.centre.centre.id;
    if (centre === undefined) return;
    pins = { centre, at: new Map(pins?.centre === centre ? pins.at : []).set(drag.id, p) };
  }

  function drop(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.pointer) return;
    dropped = drag.moved;
    drag = null;
    dragBox = null;
  }

  /** A click on a thing or bundle selects it, unless it ends a drag. */
  function pick(next: Selection): void {
    if (dropped) dropped = false;
    else select(next);
  }
  const at = $derived(new Map((layout?.things ?? []).map((t) => [t.id, t])));
  const notes = $derived(shown === null || layout === null ? [] : partNotes(shown, layout));

  const typeLabel = (type: string | null) => (type === null ? "type not known" : shape.typeLabel(type));
  /** An edge type's name as the view file gives it, for a group of `owner`'s. */
  const edgeName = (ownerType: string | null, edge: string) => (ownerType === null ? null : shape.edgeLabel(ownerType, edge)) ?? edge;
  const nameOf = (t: { id: string; label: string | null }) => t.label ?? t.id;
  const radius = (t: PlacedThing) => (t.parent === null ? R_CENTRE : R_THING);
  const ownerType = (g: { owner: string }) => at.get(g.owner)?.type ?? null;
  const groupName = (g: PlacedGroup) => groupText(edgeName(ownerType(g), g.edge), g.direction, g.count);
  const groupKey = (g: { edge: string; direction: string }) => `${g.edge} ${g.direction}`;

  /** The groups a neighbour is drawn in: those whose links join it to the thing it hangs from, in the picture's order. */
  const groupsOf = $derived.by(() => {
    const out = new Map<string, PlacedGroup[]>();
    for (const t of layout?.things ?? []) {
      if (t.parent === null) continue;
      const mine: PlacedGroup[] = [];
      for (const l of layout!.links) {
        if (!((l.from === t.parent && l.to === t.id) || (l.to === t.parent && l.from === t.id))) continue;
        const direction = l.from === t.parent ? "out" : "in";
        const g = layout!.groups.find((x) => x.owner === t.parent && x.edge === l.edge && x.direction === direction);
        if (g !== undefined && !mine.includes(g)) mine.push(g);
      }
      out.set(t.id, mine);
    }
    return out;
  });

  /** A thing's name for a screen reader: its name, its type, and where it is in the picture. */
  function spoken(t: PlacedThing): string {
    const base = `${nameOf(t)} (${typeLabel(t.type)})`;
    if (t.parent === null) return `${base}, at the centre`;
    const groups = groupsOf.get(t.id) ?? [];
    return groups.length === 0 ? base : `${base}, in ${groups.map(groupName).join(" and ")}`;
  }

  /** Each group's name on a box: kept clear of by the things' names. */
  const GROUP_HIGH = 16;
  const groupBoxes = $derived(
    (layout?.groups ?? []).map((g) => {
      const width = columns(groupName(g)) * COLUMN + 6;
      return { x: g.labelAt.x - width / 2, y: g.labelAt.y - GROUP_HIGH / 2, width, height: GROUP_HIGH };
    }),
  );

  /** Each thing's name beside its shard, or null when there is no clear place for it. */
  const names = $derived.by(() => {
    if (layout === null) return [];
    const shards: Rect[] = layout.things.map((t) => ({ x: t.x - radius(t), y: t.y - radius(t), width: 2 * radius(t), height: 2 * radius(t) }));
    for (const g of layout.groups) if (g.bundle) shards.push({ x: g.bundle.x - R_BUNDLE, y: g.bundle.y - R_BUNDLE, width: 2 * R_BUNDLE, height: 2 * R_BUNDLE });
    const bundles = layout.groups.filter((g) => g.bundle !== null);
    return placeThingNames(
      [
        ...layout.things.map((t) => ({ x: t.x, y: t.y, r: radius(t), text: nameOf(t) })),
        ...bundles.map((g) => ({ x: g.bundle!.x + 3, y: g.bundle!.y - 3, r: R_BUNDLE + 3, text: `${number(g.bundle!.count)} more ${noun(g.bundle!.count, "link", "links")}` })),
      ],
      [...shards, ...groupBoxes],
    );
  });

  /** A link's line, from the edge of one shard to the edge of the other. */
  function line(from: PlacedThing, to: PlacedThing): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.max(1e-9, Math.hypot(dx, dy));
    const a = radius(from) + 2;
    const b = radius(to) + 7;
    const r = (n: number) => Math.round(n * 100) / 100;
    return `M${r(from.x + (dx * a) / d)},${r(from.y + (dy * a) / d)} L${r(to.x - (dx * b) / d)},${r(to.y - (dy * b) / d)}`;
  }

  /** A thing's link to itself: a loop out of its top right and back in at its right. */
  function loop(t: PlacedThing): string {
    const r = radius(t);
    return `M${t.x + r * 0.5},${t.y - r * 0.87} Q${t.x + r * 2.6},${t.y - r * 2.2} ${t.x + r + 5},${t.y}`;
  }

  /** A bundle's link: from its owner to it. */
  function toBundle(g: PlacedGroup): string {
    const owner = at.get(g.owner)!;
    return line(owner, { ...owner, id: "", x: g.bundle!.x, y: g.bundle!.y, parent: owner.id });
  }

  type Selection =
    | { kind: "thing"; id: string }
    | { kind: "bundle"; owner: string; edge: string; direction: "out" | "in" }
    | ({ kind: "link" } & LinkRef);
  let selected = $state<Selection | null>(
    untrack(() => {
      if (firstLink !== undefined) return { kind: "link", ...firstLink };
      // The thing at the centre is selected from the start, so its card shows beside the graph.
      const id = first ?? centre;
      return id === null ? null : { kind: "thing", id };
    }),
  );

  /** Where things and links come from (G-6): cards and rows read once, kept for the session. */
  const read = $derived(given ?? sourcesFor(file, shape));
  /** Bumped when a card or a link's rows arrive, so what was read is shown. */
  let arrived = $state(0);
  $effect(() => {
    const s = selected;
    const k = read;
    // Read what is not read yet, or what the kit could not give last time.
    if (s?.kind === "thing") {
      const c = k.cardNow(s.id);
      if (c === null || "message" in c) void k.card(s.id).then(() => arrived++);
    }
    if (s?.kind === "link") {
      const rows = k.linkNow(s);
      if (rows === null || rows.error !== undefined) void k.link(s).then(() => arrived++);
    }
  });
  /**
   * The lines drawn: one per start, edge type and end. Links of one type between the same two
   * things (told apart by their qualifiers) share a line, and selecting it shows the rows of each.
   */
  const lines = $derived.by(() => {
    const seen = new Set<string>();
    return (layout?.links ?? []).filter((l) => !seen.has(linkKey(l)) && seen.add(linkKey(l)) !== undefined);
  });
  const selectedCard = $derived.by(() => {
    void arrived;
    return selected?.kind === "thing" ? read.cardNow(selected.id) : null;
  });
  /** The link selected, if it is drawn. */
  const selectedLinkDrawn = $derived.by(() => {
    const s = selected;
    return s?.kind === "link" ? (lines.find((l) => linkKey(l) === linkKey(s)) ?? null) : null;
  });
  const selectedRows = $derived.by(() => {
    void arrived;
    return selectedLinkDrawn === null ? null : read.linkNow(selectedLinkDrawn);
  });
  const isLink = (l: LinkRef) => selected?.kind === "link" && linkKey(selected) === linkKey(l);
  /** A link in words: its start, its edge type as the view file names it, and its end. */
  function linkText(l: LinkRef): string {
    const from = at.get(l.from);
    const to = at.get(l.to);
    const edge = (from?.type ? shape.edgeLabel(from.type, l.edge) : null) ?? (to?.type ? shape.edgeLabel(to.type, l.edge) : null) ?? l.edge;
    return `${from ? nameOf(from) : l.from} ${edge} ${to ? nameOf(to) : l.to}`;
  }
  /** The links drawn to or from thing `id`, in the picture's order. */
  const linksOf = (id: string) => lines.filter((l) => l.from === id || l.to === id);

  let linkTitle = $state<HTMLElement | null>(null);
  /** A link chosen from the panel's list: the panel now shows it, and takes the focus (G-11). */
  function chooseLink(l: LinkRef): void {
    select({ kind: "link", from: l.from, edge: l.edge, to: l.to });
    void tick().then(() => linkTitle?.focus());
  }

  /** The bundle opened, as it loads. */
  let opened = $state<{ key: string; bundle: Bundle | null; failed: string | null } | null>(null);

  function select(next: Selection): void {
    selected = next;
    if (next.kind !== "bundle") return;
    const key = `${next.owner} ${next.edge} ${next.direction}`;
    if (!mustOpen(opened, key)) return;
    const owner: Thing = at.get(next.owner) ?? { id: next.owner, label: null, type: null };
    opened = { key, bundle: null, failed: null };
    openBundle(file, { id: owner.id, label: owner.label, type: owner.type }, next.edge, next.direction)
      .then((bundle) => opened?.key === key && (opened = { key, bundle, failed: null }))
      .catch((e: unknown) => opened?.key === key && (opened = { key, bundle: null, failed: e instanceof Error ? e.message : String(e) }));
  }

  /** A new limit draws a new picture: what was selected in the old one is let go. */
  function choose(n: Limit): void {
    if (choices === null || n === choices.limit) return;
    choices = withLimit(choices, n);
    selected = null;
    opened = null;
  }

  /** Make a choice (G-5). */
  function act(next: (state: HoodState) => HoodState): void {
    if (choices !== null) choices = next(choices);
  }

  /** Where the keyboard's focus goes after a choice that removes the control it was on (G-11). */
  let hiddenLine = $state<HTMLElement | null>(null);
  let actions = $state<HTMLElement | null>(null);
  /** A thing shown again: its actions take the focus once it is drawn. */
  let focusActionsOf = $state<string | null>(null);

  function hideThing(id: string): void {
    act((s) => hide(s, id));
    selected = null;
    // Its "show again" button takes the focus, so the choice can be undone at once.
    void tick().then(() => [...(hiddenLine?.querySelectorAll<HTMLElement>("[data-unhide]") ?? [])].find((b) => b.dataset.unhide === id)?.focus());
  }

  function unhideThing(id: string): void {
    const rest = (choices?.hidden ?? []).filter((h) => h !== id);
    act((s) => unhide(s, id));
    if (rest.length > 0) {
      const next = rest[Math.min((choices?.hidden ?? []).indexOf(id), rest.length - 1)] ?? rest[0]!;
      void tick().then(() => [...(hiddenLine?.querySelectorAll<HTMLElement>("[data-unhide]") ?? [])].find((b) => b.dataset.unhide === next)?.focus());
    } else {
      selected = { kind: "thing", id };
      focusActionsOf = id;
    }
  }

  $effect(() => {
    const id = focusActionsOf;
    if (id === null || selectedThing?.id !== id || actions === null) return;
    focusActionsOf = null;
    actions.querySelector<HTMLElement>("[data-action]")?.focus();
  });

  function setEdge(edge: string, on: boolean): void {
    act((s) => showEdge(s, file.edgeTypes.map((e) => e.name), edge, on));
    if (!on && selected?.kind === "bundle" && selected.edge === edge) {
      selected = null;
      opened = null;
    }
  }

  /**
   * An edge type's name in the list of edge types: as the view file names it for the thing at the
   * centre's type, else for the type the edge type leaves. Groups around an expanded thing of
   * another type use that thing's type, so a view file naming one edge type differently per type
   * names it there as that type does.
   */
  const edgeTypeName = (edge: string) => edgeName(shown?.centre.centre.type ?? null, edge);

  /** Every thing the neighbourhood has loaded, by id: the centre, the expanded and their neighbours. */
  const known = $derived.by(() => {
    const out = new Map<string, Thing>();
    for (const loaded of shown === null ? [] : [shown.centre, ...shown.expanded]) {
      out.set(loaded.centre.id, loaded.centre);
      for (const g of loaded.groups) for (const t of g.shown) if (!out.has(t.id)) out.set(t.id, t);
    }
    return out;
  });
  /** Expanded as the person chose, before the picture has caught up. */
  const isExpanded = (id: string) => choices?.expanded.includes(id) ?? false;

  function key(event: KeyboardEvent, next: Selection): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(next);
    }
  }

  const isThing = (id: string) => selected?.kind === "thing" && selected.id === id;
  const isBundle = (g: PlacedGroup) => selected?.kind === "bundle" && selected.owner === g.owner && selected.edge === g.edge && selected.direction === g.direction;
  const selectedThing = $derived(selected?.kind === "thing" ? (at.get(selected.id) ?? null) : null);

  /** For the list (G-11): each thing whose neighbourhood is open, the centre first, with its groups and their things. */
  const listOwners = $derived(
    shown === null || layout === null
      ? []
      : [shown.centre, ...shown.expanded]
          .filter((loaded) => at.has(loaded.centre.id))
          .map((loaded) => ({
            owner: loaded.centre,
            groups: layout.groups
              .filter((g) => g.owner === loaded.centre.id)
              .map((g) => ({
                g,
                things: once(loaded.groups.find((x) => x.edge === g.edge && x.direction === g.direction)?.shown ?? []).filter((t) => !shown.state.hidden.includes(t.id)),
              })),
          })),
  );
</script>

<div class="hood">
  <div class="canvas" hidden={only === "card"}>
    {#if centre === null}
      <EmptyState message="Search for a thing to explore it and what it links to." />
    {:else}
      <div class="controls">
        <span class="caption">Per group, show</span>
        <div class="limits" role="group" aria-label="Neighbours shown per group">
          {#each LIMITS as n (n)}
            <Button data-limit={n} pressed={n === limit} onclick={() => choose(n)}>{n}</Button>
          {/each}
        </div>
        {#if shown !== null && choices !== null}
          {@const offered = shown.counts}
          <details class="edges">
            <summary class="body-screen">Edge types shown: {number(offered.filter((c) => shows(choices!, c.edge)).length)} of {number(offered.length)}</summary>
            <fieldset class="edge-list">
              <legend class="caption">Each with its links among the things drawn, each link counted once</legend>
              {#each offered as c (c.edge)}
                <label class="edge-choice body-screen">
                  <input type="checkbox" data-edge-type={c.edge} checked={shows(choices, c.edge)} onchange={(e) => setEdge(c.edge, e.currentTarget.checked)} />
                  <span>{edgeTypeName(c.edge)} · {c.atLeast ? `at least ${number(c.count)}` : number(c.count)}</span>
                </label>
              {/each}
              {#if offered.some((c) => c.atLeast)}
                <p class="caption muted">
                  “At least”: the kit lists 20 of a thing's links at a time, so the links between two things that both have more
                  than that cannot always be told apart.
                </p>
              {/if}
            </fieldset>
          </details>
        {/if}
      </div>
      {#if choices !== null && choices.hidden.length > 0}
        <p class="hidden-line caption" bind:this={hiddenLine}>
          Hidden: {number(choices.hidden.length)}
          {#each choices.hidden as id (id)}
            {@const t = known.get(id)}
            <Button variant="ghost" data-unhide={id} label="Show {t ? nameOf(t) : id} again" onclick={() => unhideThing(id)}>{t ? nameOf(t) : id}</Button>
          {/each}
        </p>
      {/if}
      {#if failed !== null}
        <p class="banner body-screen" role="alert">Could not load the neighbourhood: {failed}</p>
      {:else if shown === null || layout === null || box === null}
        <p class="note caption" role="status">Loading the neighbourhood…</p>
      {:else}
        {@const c = shown.centre}
        <p class="intro caption">{summary(c)}</p>
        {#each unapplied as note (note)}
          <p class="note caption" role="status" data-unapplied>{note}</p>
        {/each}
        {#each notes as note (note)}
          <p class="note caption" role="status">{note}</p>
        {/each}
        <svg class="picture" viewBox="{box.x} {box.y} {box.width} {box.height}" role="group" aria-busy={busy} aria-label="Neighbourhood of {nameOf(c.centre)}">
          <defs>
            <marker id="hood-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path class="head" d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          {#each lines as l (linkKey(l))}
            {@const from = at.get(l.from)}
            {@const to = at.get(l.to)}
            {#if from && to}
              {@const d = l.from === l.to ? loop(from) : line(from, to)}
              <path class="link" class:selected={isLink(l)} {d} marker-end="url(#hood-arrow)" />
              <!-- A wider line the pointer can take, to select the link; the keyboard selects it from a thing's links. -->
              <path
                class="hit"
                class:selected={isLink(l)}
                data-link={linkKey(l)}
                {d}
                aria-hidden="true"
                onclick={() => select({ kind: "link", from: l.from, edge: l.edge, to: l.to })}
              />
            {/if}
          {/each}
          {#each layout.groups as g (g.owner + " " + groupKey(g))}
            {#if g.bundle}
              <path class="link folded" d={toBundle(g)} />
            {/if}
          {/each}
          {#each layout.groups as g, i (g.owner + " " + groupKey(g))}
            {@const b = groupBoxes[i]!}
            <g class="group-name" data-owner={g.owner} data-group={groupKey(g)} aria-hidden="true">
              <rect class="name-back" x={b.x} y={b.y} width={b.width} height={b.height} />
              <text class="group-label caption" x={g.labelAt.x} y={g.labelAt.y + 4} text-anchor="middle">{groupName(g)}</text>
            </g>
          {/each}
          {#each layout.things as t, i (t.id)}
            {@const r = radius(t)}
            {@const placed = names[i]}
            <g
              class="thing"
              class:centre={t.parent === null}
              class:expanded={isExpanded(t.id)}
              class:selected={isThing(t.id)}
              role="button"
              tabindex="0"
              data-centre={t.parent === null ? t.id : undefined}
              data-thing={t.parent === null ? undefined : t.id}
              data-expanded={isExpanded(t.id) ? t.id : undefined}
              aria-pressed={isThing(t.id)}
              aria-label={spoken(t)}
              onclick={() => pick({ kind: "thing", id: t.id })}
              onkeydown={(e) => key(e, { kind: "thing", id: t.id })}
              onpointerdown={(e) => grab(e, t.id)}
              onpointermove={pull}
              onpointerup={drop}
              onpointercancel={drop}
            >
              <polygon class="shard" points={svgPoints(shardPoints(t.id, t.x, t.y, r))} />
              {#if placed === null}
                <!-- No clear place for its name: it shows while the thing has the focus or is selected. -->
                <g class="late-name" aria-hidden="true">
                  <rect class="name-back" x={t.x - 70} y={t.y + r + 4} width="140" height="16" />
                  <text class="thing-label caption" x={t.x} y={t.y + r + 16} text-anchor="middle">{nameOf(t)}</text>
                </g>
              {/if}
            </g>
          {/each}
          {#each layout.groups as g (g.owner + " " + groupKey(g))}
            {#if g.bundle}
              {@const name = `${g.direction === "in" ? "← " : ""}${edgeName(ownerType(g), g.edge)}`}
              <g
                class="bundle"
                class:selected={isBundle(g)}
                role="button"
                tabindex="0"
                data-bundle={groupKey(g)}
                data-more={g.bundle.count}
                aria-pressed={isBundle(g)}
                aria-label="{name}: {number(g.bundle.count)} more {noun(g.bundle.count, 'link', 'links')}, not drawn. Open the bundle to list {g.bundle.count === 1 ? 'it' : 'them'}"
                onclick={() => pick({ kind: "bundle", owner: g.owner, edge: g.edge, direction: g.direction })}
                onkeydown={(e) => key(e, { kind: "bundle", owner: g.owner, edge: g.edge, direction: g.direction })}
                onpointerdown={(e) => grab(e, bundleId(g))}
                onpointermove={pull}
                onpointerup={drop}
                onpointercancel={drop}
              >
                <polygon class="stack" points={svgPoints(shardPoints(`${g.owner} ${groupKey(g)} 2`, g.bundle.x + 6, g.bundle.y - 6, R_BUNDLE))} />
                <polygon class="stack" points={svgPoints(shardPoints(`${g.owner} ${groupKey(g)} 1`, g.bundle.x + 3, g.bundle.y - 3, R_BUNDLE))} />
                <polygon class="shard bundle-shard" points={svgPoints(shardPoints(`${g.owner} ${groupKey(g)}`, g.bundle.x, g.bundle.y, R_BUNDLE))} />
                <text class="more panel-title" x={g.bundle.x} y={g.bundle.y + 5} text-anchor="middle">+</text>
              </g>
            {/if}
          {/each}
          <g class="names" aria-hidden="true">
            {#each names as n, i (i)}
              {#if n !== null}
                <rect class="name-back" x={n.back.x} y={n.back.y} width={n.back.width} height={n.back.height} />
                <text class="thing-label caption" class:centre-label={i === 0} x={n.x} y={n.y} text-anchor="middle">{n.text}</text>
              {/if}
            {/each}
          </g>
        </svg>
        <p class="picture-note caption">
          The thing at the centre, and round it its neighbours, one group per edge type and direction (← for links that
          reach it). A stack marked + holds the neighbours a group does not draw, with how many.
        </p>

        <!-- Below 960px: the same contents as a list (G-11). -->
        <div class="list">
          <h3 class="section-label heading">At the centre</h3>
          <button type="button" class="pick body-screen" class:selected={isThing(c.centre.id)} aria-pressed={isThing(c.centre.id)} onclick={() => select({ kind: "thing", id: c.centre.id })}>
            <span>{nameOf(c.centre)}</span><span class="caption">{typeLabel(c.centre.type)}</span>
          </button>
          {#each listOwners as { owner, groups } (owner.id)}
            {#if owner.id !== c.centre.id}
              <h3 class="section-label heading around">Around {nameOf(owner)}</h3>
            {/if}
            {#each groups as { g, things } (groupKey(g))}
              <h3 class="section-label heading group-heading">{groupName(g)}</h3>
              <ul>
                {#each things as t (t.id)}
                  <li class="item">
                    <a class="row body-screen" href={hrefFor(t.id)}>{nameOf(t)}</a>
                    <Button variant="ghost" label="More for {nameOf(t)}: unfold, hide, re-centre" onclick={() => select({ kind: "thing", id: t.id })}>More</Button>
                  </li>
                {/each}
                {#if g.bundle}
                  <li>
                    <button type="button" class="pick body-screen" class:selected={isBundle(g)} aria-pressed={isBundle(g)} onclick={() => select({ kind: "bundle", owner: g.owner, edge: g.edge, direction: g.direction })}>
                      <span>+{number(g.bundle.count)} more {noun(g.bundle.count, "link", "links")}</span><span class="caption">open the bundle</span>
                    </button>
                  </li>
                {/if}
              </ul>
            {/each}
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if centre !== null}
    <aside class="panel" aria-label="Selection" aria-live="polite" hidden={only === "graph"}>
      {#if selectedThing}
        <h3 class="section-label heading">{selectedThing.parent === null ? "At the centre" : "Selected thing"}</h3>
        <!-- Its card names it; until the card is read, this does. -->
        {#if selectedCard === null || "message" in selectedCard}
          <p class="panel-title name">{nameOf(selectedThing)}</p>
          <p class="caption muted">{typeLabel(selectedThing.type)} · <span class="code">{selectedThing.id}</span></p>
        {/if}
        {#if selectedThing.parent !== null}
          {@const id = selectedThing.id}
          {@const fullExpanded = !isExpanded(id) && (choices?.expanded.length ?? 0) >= MOST_EXPANDED}
          {@const fullHidden = (choices?.hidden.length ?? 0) >= MOST_HIDDEN}
          <div class="actions" bind:this={actions}>
            <!-- One button that turns from Unfold to Fold, so the keyboard's focus stays on it. -->
            <Button
              variant="primary"
              data-action={isExpanded(id) ? "collapse" : "expand"}
              disabled={fullExpanded}
              aria-describedby={fullExpanded ? "hood-most-expanded" : undefined}
              onclick={() => act((s) => (isExpanded(id) ? collapse(s, id) : expand(s, id)))}>{isExpanded(id) ? "Fold" : "Unfold"}</Button
            >
            <Button data-action="hide" disabled={fullHidden} aria-describedby={fullHidden ? "hood-most-hidden" : undefined} onclick={() => hideThing(id)}>Hide</Button>
            <Button href={hoodHref(id)} data-action="recentre">Re-centre here</Button>
          </div>
          <!-- At the bound, the control that would go past it says why it is off. -->
          {#if fullExpanded}
            <!-- One neighbourhood view is on the page at a time, so these ids are its own. -->
            <p class="caption muted" id="hood-most-expanded">At most {MOST_EXPANDED} unfolded: fold one to unfold another.</p>
          {/if}
          {#if fullHidden}
            <p class="caption muted" id="hood-most-hidden">At most {MOST_HIDDEN} hidden: show one again to hide another.</p>
          {/if}
        {/if}
        <div class="sources">
          {#if selectedCard === null}
            <p class="caption muted" role="status">Reading its card…</p>
          {:else if "message" in selectedCard}
            <p class="banner body-screen" role="alert">Could not read its card: {selectedCard.message}</p>
          {:else}
            <EntityCard node={selectedCard.page.node} {shape} facts={selectedCard.facts} {hrefFor} />
            {#if extra}
              {@render extra(selectedCard.page)}
            {:else}
              <h3 class="section-label heading">Where it comes from</h3>
              <CitationChip sections={[{ title: null, evidence: { rows: selectedCard.page.sources, total: selectedCard.page.sourcesTotal } }]} />
            {/if}
          {/if}
          {#if linksOf(selectedThing.id).length > 0}
            <h3 class="section-label heading">Its links in the picture</h3>
            <ul class="links">
              {#each linksOf(selectedThing.id) as l (linkKey(l))}
                <li>
                  <button type="button" class="pick body-screen" data-select-link={linkKey(l)} onclick={() => chooseLink(l)}>{linkText(l)}</button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else if selectedLinkDrawn !== null}
        {@const l = selectedLinkDrawn}
        <h3 class="section-label heading">Link</h3>
        <p class="panel-title name" tabindex="-1" bind:this={linkTitle}>{linkText(l)}</p>
        <p class="caption muted">
          From <a class="end" href={hrefFor(l.from)}>{at.get(l.from) ? nameOf(at.get(l.from)!) : l.from}</a>
          to <a class="end" href={hrefFor(l.to)}>{at.get(l.to) ? nameOf(at.get(l.to)!) : l.to}</a>
        </p>
        <h3 class="section-label heading">Where it comes from</h3>
        {#if selectedRows === null}
          <p class="caption muted" role="status">Reading its source…</p>
        {:else}
          <CitationChip sections={[{ title: null, evidence: selectedRows }]} />
        {/if}
      {:else if selected?.kind === "bundle"}
        <h3 class="section-label heading">Bundle</h3>
        {#if opened?.failed}
          <p class="banner body-screen" role="alert">Could not open the bundle: {opened.failed}</p>
        {:else if opened?.bundle}
          <BundleList
            bundle={opened.bundle}
            name={edgeName(opened.bundle.owner.type, opened.bundle.edge)}
            {hrefFor}
            {tableHref}
          />
        {:else}
          <p class="caption muted" role="status">Opening the bundle…</p>
        {/if}
      {:else}
        <EmptyState message="Select a thing to see its card, a link's line to see where it comes from, or a bundle to list what it holds." />
      {/if}
    </aside>
  {/if}
</div>

<style>
  /* A name with no break in it wraps anywhere rather than pushing the page sideways (G-11). */
  .hood {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow-wrap: anywhere;
  }

  .canvas {
    min-inline-size: 0;
    padding: 0 var(--space-4) var(--space-4);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    color: var(--ink-muted);
  }

  .limits {
    display: inline-flex;
    gap: var(--space-1);
  }

  .edges summary {
    cursor: pointer;
    color: var(--ink);
  }

  .edges summary:focus-visible,
  .edge-choice input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .edge-list {
    display: grid;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .edge-choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink);
    cursor: pointer;
  }

  .hidden-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    color: var(--ink-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .item .row {
    flex: 1;
  }

  .around {
    margin-block-start: var(--space-6);
  }

  .expanded .shard {
    stroke: var(--accent);
    stroke-width: 3;
  }

  .intro,
  .note {
    margin: var(--space-2) 0;
    color: var(--ink-muted);
  }

  .picture,
  .picture-note {
    display: none;
  }

  .picture {
    inline-size: 100%;
    block-size: auto;
    max-block-size: 70vh;
  }

  .shard {
    fill: var(--accent);
    stroke: var(--surface);
    stroke-width: 2;
  }

  /* The centre stands out from the page in both themes: the heading colour is dark on light, light on dark. */
  .centre .shard {
    fill: var(--heading);
  }

  /* A bundle: a stack of pale shards, its count on top, readable on both grounds. */
  .stack,
  .bundle-shard {
    fill: var(--surface-tint);
    stroke: var(--accent);
    stroke-width: 1.5;
  }

  .thing:hover .shard {
    fill: var(--shard-5);
  }

  .bundle:hover .bundle-shard {
    fill: var(--surface);
  }

  .thing.selected .shard {
    stroke: var(--heading);
    stroke-width: 4;
  }

  .bundle.selected .bundle-shard {
    stroke: var(--heading);
    stroke-width: 3;
  }

  /* Things and bundles are dragged: the pointer moves them, not the page. */
  .thing,
  .bundle {
    cursor: pointer;
    touch-action: none;
  }

  .thing:focus-visible,
  .bundle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .link {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }

  .folded {
    stroke-dasharray: 4 4;
  }

  .link.selected {
    stroke: var(--accent);
    stroke-width: 3;
  }

  /* The line the pointer takes to select a link: wider than the one drawn, and not seen. */
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
    cursor: pointer;
  }

  .head {
    fill: var(--ink-muted);
  }

  .name-back {
    fill: var(--surface);
  }

  .group-label {
    fill: var(--accent);
    font-family: var(--font-mono);
  }

  .thing-label {
    fill: var(--ink);
  }

  .centre-label {
    fill: var(--heading);
  }

  .more {
    fill: var(--heading);
    pointer-events: none;
  }

  .late-name {
    visibility: hidden;
  }

  .thing:focus-visible .late-name,
  .thing.selected .late-name {
    visibility: visible;
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

  .group-heading {
    text-transform: none;
    font-family: var(--font-mono);
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

  /* A long name with no break in it wraps rather than pushing the page sideways. */
  .pick > span,
  .row {
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  .pick:hover,
  .row:hover {
    background: var(--surface-tint);
  }

  .pick:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .pick.selected {
    border-inline-start-color: var(--accent);
    background: var(--surface-tint);
    color: var(--accent);
  }

  .sources {
    margin-block-start: var(--space-4);
  }

  .links {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .end {
    color: var(--accent);
  }

  .end:focus-visible,
  .name:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
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

  .banner {
    padding: var(--space-2) var(--space-3);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  /* From 960px: the picture, with the selection beside it. */
  @media (width >= 960px) {
    .hood {
      grid-template-columns: minmax(0, 1fr) 360px;
    }

    .picture,
    .picture-note {
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
