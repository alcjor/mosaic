/**
 * Where a neighbourhood's shards go (needs G-3, G-4, G-5, G-7): the thing at the centre, its
 * neighbours round it grouped by edge type and direction, each group's name beside it. The
 * neighbours a group does not show are counted (`folded`), not drawn.
 *
 * Groups go round the centre in the kit's order, edge type by UTF-8 bytes and `out` before `in`,
 * whatever order they are given in, starting at the top and turning clockwise; each takes a share
 * of the circle that follows how many shards it shows. A
 * crowded group staggers its shards on two rings. Each thing is drawn once, where it first
 * appears; a link to it from another group is drawn to that place. An expanded thing's groups
 * open in a fan pointing away from the thing it hangs from. Nothing depends on time or chance.
 *
 * That is where things start: `settleHood` then lets forces (lib/graph/force-layout.ts) push
 * them apart and pull links to length. Things the person dragged stay where they were dropped,
 * and things drawn before stay near where they were, so expanding one adds its neighbours round
 * it and leaves the rest of the picture in place.
 */
import { byBytes } from "./bytes.js";
import { settle, type ForceLink, type ForceNode, type Point } from "./force-layout.js";
import { round } from "./seed.js";

export interface HoodThing {
  readonly id: string;
  readonly label: string | null;
  readonly type: string | null;
}

export interface HoodGroup {
  readonly edge: string;
  readonly direction: "out" | "in";
  /** How many links of this edge type and direction the thing has. */
  readonly count: number;
  /** The neighbours shown, at most the limit, in the kit's order. */
  readonly shown: readonly HoodThing[];
}

/** One thing with its groups: the centre, or an expanded neighbour. */
export interface HoodInput {
  readonly centre: HoodThing;
  readonly groups: readonly HoodGroup[];
}

export interface PlacedThing extends HoodThing {
  readonly x: number;
  readonly y: number;
  /** The thing it hangs from (the centre or an expanded thing); null for the centre. */
  readonly parent: string | null;
}

export interface PlacedGroup {
  /** The thing whose group this is. */
  readonly owner: string;
  readonly edge: string;
  readonly direction: "out" | "in";
  readonly count: number;
  /** How many of its neighbours are drawn. */
  readonly shown: number;
  /** Where the group's name and count go. */
  readonly labelAt: { readonly x: number; readonly y: number };
  /** How many of its neighbours the group does not show. */
  readonly folded: number;
}

export interface PlacedLink {
  /** As the edge points: the thing it leaves and the thing it reaches. */
  readonly from: string;
  readonly to: string;
  readonly edge: string;
}

export interface HoodLayout {
  readonly things: readonly PlacedThing[];
  readonly groups: readonly PlacedGroup[];
  readonly links: readonly PlacedLink[];
}

export interface SettleOptions {
  /** Things the person dropped somewhere: they stay exactly there. */
  readonly pinned?: ReadonlyMap<string, Point>;
  /** Where things were last drawn (`placesOf`): they stay near there. */
  readonly previous?: ReadonlyMap<string, Point>;
  /** How many ticks to run: fewer while a thing is dragged, so the picture keeps up. */
  readonly ticks?: number;
}

export interface HoodOptions {
  /** Which edge types are shown; all by default. */
  readonly shows?: (edge: string) => boolean;
}

/** Distance from a thing to its neighbours. */
export const RING = 220;
/** How much farther the second ring of a crowded group lies. */
export const STAGGER = 56;
/** Shards in a group past which it uses two rings. */
const CROWDED = 6;
/** How far beyond its shards a group's name goes. */
const LABEL_GAP = 64;
/** How wide an expanded thing's fan opens. */
const FAN = (2 * Math.PI) / 3;
/** An expanded thing's ring, against the centre's. */
const FAN_RING = 0.7;

/** Groups in the kit's order: edge type by UTF-8 bytes, `out` before `in`. */
export function groupOrder(a: HoodGroup, b: HoodGroup): number {
  return byBytes(a.edge, b.edge) || (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1);
}

/**
 * Lay out `centre` with its groups round the origin, then each of `expanded`, in the order given,
 * with its groups in a fan pointing away from where it hangs. An expanded thing not drawn (not a
 * neighbour of anything drawn) is left out.
 */
export function layoutHood(centre: HoodInput, expanded: readonly HoodInput[] = [], options: HoodOptions = {}): HoodLayout {
  const shows = options.shows ?? (() => true);
  const things = new Map<string, PlacedThing>();
  const groups: PlacedGroup[] = [];
  const links: PlacedLink[] = [];
  things.set(centre.centre.id, { ...centre.centre, x: 0, y: 0, parent: null });

  // Links drawn so far, as the edge points: an expanded thing's group that lists the link it
  // hangs by (the same two things, edge type and way) does not draw it again.
  const drawn = new Set<string>();
  const linkOf = (owner: string, g: HoodGroup, other: string): PlacedLink =>
    g.direction === "out" ? { from: owner, to: other, edge: g.edge } : { from: other, to: owner, edge: g.edge };
  const keyOf = (l: PlacedLink) => `${l.from}\u0000${l.to}\u0000${l.edge}`;

  const fan = (owner: HoodInput, cx: number, cy: number, from: number, span: number, ring: number) => {
    const kept = owner.groups.filter((g) => shows(g.edge) && g.count > 0).sort(groupOrder);
    // Groups claim their links in the kit's order, so a link two groups list (a thing's link to
    // itself is in both its out and in groups) is drawn by the first only. A group's own rows are
    // claimed after it is read: two rows of one group for one pair are two links (two edges that
    // differ by qualifier, section 3.4), and both are drawn.
    const claimed = new Set(drawn);
    const slots = kept.map((g) => {
      const visible = g.shown.filter((t) => !claimed.has(keyOf(linkOf(owner.centre.id, g, t.id))));
      for (const t of visible) claimed.add(keyOf(linkOf(owner.centre.id, g, t.id)));
      return { g, visible, folded: Math.max(0, g.count - g.shown.length), weight: Math.max(1, visible.length) };
    });
    const total = slots.reduce((s, x) => s + x.weight, 0);
    let at = from;
    for (const { g, visible, folded, weight } of slots) {
      const share = (span * weight) / Math.max(1, total);
      const n = visible.length;
      const step = share / Math.max(1, n);
      const crowded = n > CROWDED;
      const point = (i: number) => {
        const a = at + step * (i + 0.5);
        const r = ring + (crowded && i % 2 === 1 ? STAGGER : 0);
        return { x: round(cx + r * Math.cos(a)), y: round(cy + r * Math.sin(a)) };
      };
      visible.forEach((t, i) => {
        if (!things.has(t.id)) things.set(t.id, { ...t, ...point(i), parent: owner.centre.id });
        const link = linkOf(owner.centre.id, g, t.id);
        drawn.add(keyOf(link));
        links.push(link);
      });
      const mid = at + share / 2;
      const labelR = ring + (crowded ? STAGGER : 0) + LABEL_GAP;
      groups.push({
        owner: owner.centre.id,
        edge: g.edge,
        direction: g.direction,
        count: g.count,
        shown: visible.length,
        labelAt: { x: round(cx + labelR * Math.cos(mid)), y: round(cy + labelR * Math.sin(mid)) },
        folded,
      });
      at += share;
    }
  };

  // The centre's groups go all the way round, from the top, clockwise on screen.
  fan(centre, 0, 0, -Math.PI / 2, 2 * Math.PI, RING);
  // An expanded thing opens once it is drawn: passes go on while one opens, so a thing given
  // before the neighbour it hangs from still opens, after it.
  let waiting = expanded.filter((e, i) => expanded.findIndex((x) => x.centre.id === e.centre.id) === i);
  for (let opened = true; opened; ) {
    opened = false;
    const still: HoodInput[] = [];
    for (const e of waiting) {
      const p = things.get(e.centre.id);
      if (p === undefined || p.parent === null) {
        still.push(e);
        continue;
      }
      const parent = things.get(p.parent)!;
      const away = Math.atan2(p.y - parent.y, p.x - parent.x);
      // Its fan opens away from where it hangs; the link it hangs by is drawn already.
      fan(e, p.x, p.y, away - FAN / 2, FAN, RING * FAN_RING);
      opened = true;
    }
    waiting = still;
  }
  return { things: [...things.values()], groups, links };
}

/** How far a shard keeps others from its middle, with room for its name. */
const KEEP_THING = 34;
const KEEP_CENTRE = 48;

/** Where each thing of `layout` is, to give `settleHood` as `previous`. */
export function placesOf(layout: HoodLayout): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const t of layout.things) out.set(t.id, { x: t.x, y: t.y });
  return out;
}

/**
 * Let forces settle `start` (from `layoutHood`). The centre stays at the origin unless pinned
 * elsewhere. A thing drawn before starts where it was and is pulled back there; a new
 * one starts where `start` puts it beside the thing it hangs from, wherever that thing now is.
 * Each group's name goes beyond the middle of its shards, away from its owner.
 */
export function settleHood(start: HoodLayout, options: SettleOptions = {}): HoodLayout {
  const pinned = options.pinned ?? new Map<string, Point>();
  const previous = options.previous ?? new Map<string, Point>();
  const seed = placesOf(start);
  const centre = start.things.find((t) => t.parent === null)!.id;
  const hangs = new Map<string, string>();
  for (const t of start.things) if (t.parent !== null) hangs.set(t.id, t.parent);

  // Where a node starts: where it was, else its place in `start` moved with what it hangs from.
  const begun = new Map<string, Point>();
  const begin = (id: string): Point => {
    const known = begun.get(id) ?? pinned.get(id) ?? previous.get(id);
    if (known !== undefined) return known;
    const own = seed.get(id)!;
    const parent = hangs.get(id);
    const p = parent === undefined ? own : begin(parent);
    const q = parent === undefined ? own : seed.get(parent)!;
    const at = { x: p.x + own.x - q.x, y: p.y + own.y - q.y };
    begun.set(id, at);
    return at;
  };
  const node = (id: string, radius: number): ForceNode => {
    const at = begin(id);
    const pin = pinned.get(id) ?? (id === centre ? { x: 0, y: 0 } : undefined);
    const home = previous.get(id);
    return { id, x: at.x, y: at.y, radius, ...(pin ? { pinned: pin } : {}), ...(home ? { home } : {}) };
  };
  const length = (a: string, b: string) => (a === centre || b === centre ? RING : RING * FAN_RING);
  const nodes: ForceNode[] = start.things.map((t) => node(t.id, t.parent === null ? KEEP_CENTRE : KEEP_THING));
  const links: ForceLink[] = start.links.map((l) => ({ source: l.from, target: l.to, length: length(l.from, l.to) }));
  // Known things start near rest: a cooler, shorter run moves them less.
  const known = previous.size > 0;
  const placed = settle(nodes, links, { heat: known ? 0.3 : 1, ticks: options.ticks ?? (known ? 150 : 300) });

  const things = start.things.map((t) => ({ ...t, ...placed.get(t.id)! }));
  const groups = start.groups.map((g) => {
    const owner = placed.get(g.owner)!;
    const members = start.links
      .filter((l) => l.edge === g.edge && (g.direction === "out" ? l.from === g.owner : l.to === g.owner))
      .map((l) => placed.get(g.direction === "out" ? l.to : l.from)!);
    if (members.length === 0) return g;
    const mid = { x: members.reduce((s, p) => s + p.x, 0) / members.length, y: members.reduce((s, p) => s + p.y, 0) / members.length };
    // Away from the owner; for shards that ring their owner evenly, the way `start` gave.
    let dx = mid.x - owner.x;
    let dy = mid.y - owner.y;
    if (Math.hypot(dx, dy) < 1) {
      const from = seed.get(g.owner)!;
      dx = g.labelAt.x - from.x;
      dy = g.labelAt.y - from.y;
    }
    const d = Math.max(1e-9, Math.hypot(dx, dy));
    const labelAt = { x: round(mid.x + (dx / d) * LABEL_GAP), y: round(mid.y + (dy / d) * LABEL_GAP) };
    return { ...g, labelAt };
  });
  return { things, groups, links: start.links };
}
