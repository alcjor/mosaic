/**
 * Where a neighbourhood's shards go (needs G-3, G-4, G-5, G-7): the thing at the centre, its
 * neighbours round it grouped by edge type and direction, each group's name and count beside it,
 * and the neighbours past the limit folded into one bundle per group.
 *
 * Groups go round the centre in the kit's order, edge type by UTF-8 bytes and `out` before `in`,
 * whatever order they are given in, starting at the top and turning clockwise; each takes a share
 * of the circle that follows how many shards it shows, a bundle counting one and a half. A
 * crowded group staggers its shards on two rings. Each thing is drawn once, where it first
 * appears; a link to it from another group is drawn to that place. An expanded thing's groups
 * open in a fan pointing away from the thing it hangs from. Nothing depends on time or chance.
 */
import { byBytes } from "./bytes.js";
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
  /** The bundle of the neighbours not drawn, if any. */
  readonly bundle: { readonly x: number; readonly y: number; readonly count: number } | null;
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

export interface HoodOptions {
  /** Things not to draw. */
  readonly hidden?: ReadonlySet<string>;
  /** Which edge types are shown; all by default. */
  readonly shows?: (edge: string) => boolean;
}

/** Distance from a thing to its neighbours. */
export const RING = 220;
/** How much farther the second ring of a crowded group lies. */
export const STAGGER = 56;
/** Shards in a group past which it uses two rings. */
const CROWDED = 6;
/** How much of a group's share a bundle takes, against one for a shard. */
const BUNDLE_WEIGHT = 1.5;
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
 * with its groups in a fan pointing away from where it hangs. An expanded thing not drawn (hidden,
 * or not a neighbour of anything drawn) is left out.
 */
export function layoutHood(centre: HoodInput, expanded: readonly HoodInput[] = [], options: HoodOptions = {}): HoodLayout {
  const hidden = options.hidden ?? new Set<string>();
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
      const visible = g.shown.filter((t) => !hidden.has(t.id) && !claimed.has(keyOf(linkOf(owner.centre.id, g, t.id))));
      for (const t of visible) claimed.add(keyOf(linkOf(owner.centre.id, g, t.id)));
      const folded = Math.max(0, g.count - g.shown.length);
      return { g, visible, folded, weight: Math.max(1, visible.length + (folded > 0 ? BUNDLE_WEIGHT : 0)) };
    });
    const total = slots.reduce((s, x) => s + x.weight, 0);
    let at = from;
    for (const { g, visible, folded, weight } of slots) {
      const share = (span * weight) / Math.max(1, total);
      const n = visible.length + (folded > 0 ? 1 : 0);
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
        bundle: folded > 0 ? { ...point(visible.length), count: folded } : null,
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
      if (!hidden.has(e.centre.id)) {
        const parent = things.get(p.parent)!;
        const away = Math.atan2(p.y - parent.y, p.x - parent.x);
        // Its fan opens away from where it hangs; the link it hangs by is drawn already.
        fan(e, p.x, p.y, away - FAN / 2, FAN, RING * FAN_RING);
      }
      opened = true;
    }
    waiting = still;
  }
  return { things: [...things.values()], groups, links };
}
