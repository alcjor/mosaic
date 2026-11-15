/**
 * The map of how a mosaic fits together (need G-1): every node type as a shard sized by how many
 * things it holds, every edge type as an arrow from its type to its other type.
 *
 * The layout depends only on the types, the edge types and the box (need G-7): types start on a
 * circle in breadth-first order from the most connected type, then a fixed number of
 * force-directed steps spread them out inside the box, keeping room between shards for labels. Nothing is random and nothing depends on time; ties go by
 * name (UTF-8 bytes), as the kit orders names.
 */
import { byBytes } from "./bytes.js";
import { round } from "./seed.js";

export interface SchemaType {
  readonly name: string;
  readonly count: number;
}

export interface SchemaEdge {
  readonly name: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface PlacedType extends SchemaType {
  readonly x: number;
  readonly y: number;
  /** The shard's radius: its area follows the count. */
  readonly r: number;
  /** Which side of the shard its name and count go: the side freest of arrows. */
  readonly side: LabelSide;
}

export type LabelSide = "below" | "right" | "above" | "left";

/** Each side's direction on screen, in the order a tie is settled. */
const SIDES: readonly (readonly [LabelSide, number])[] = [
  ["below", Math.PI / 2],
  ["right", 0],
  ["above", -Math.PI / 2],
  ["left", Math.PI],
];

export interface PlacedEdge {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  /** Where the arrow leaves its type's shard and where it reaches the other, and its bend. */
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly control: { readonly x: number; readonly y: number };
  /** Where its label sits: the middle of the curve. */
  readonly middle: { readonly x: number; readonly y: number };
}

export interface SchemaLayout {
  readonly width: number;
  readonly height: number;
  readonly types: readonly PlacedType[];
  readonly edges: readonly PlacedEdge[];
  /** Edge types that do not name both their types, so no arrow can join them. */
  readonly unplaced: readonly SchemaEdge[];
}

export interface SchemaBox {
  readonly width: number;
  readonly height: number;
  /** Smallest and largest shard radius. */
  readonly minRadius?: number;
  readonly maxRadius?: number;
  /** Space kept free at each side, for labels. */
  readonly margin?: number;
  /** Room kept between two shards beyond their radii, for names, counts and arrows. */
  readonly room?: number;
}

/** Force-directed steps: fixed, never timed. */
const STEPS = 240;

/** Passes that push apart shards closer than their room, after the force steps: fixed, never timed. */
const SETTLE = 200;

/** Room kept between two shards beyond their radii, for their names, counts and arrows. */
const LABEL_ROOM = 96;

/** How far apart two parallel arrows bend, as a share of their length. */
const BEND = 0.22;

function placedEdges(edges: readonly SchemaEdge[], known: ReadonlySet<string>) {
  const drawn: { name: string; from: string; to: string }[] = [];
  const unplaced: SchemaEdge[] = [];
  for (const e of edges) {
    if (e.from !== null && e.to !== null && known.has(e.from) && known.has(e.to)) {
      drawn.push({ name: e.name, from: e.from, to: e.to });
    } else {
      unplaced.push(e);
    }
  }
  drawn.sort((a, b) => byBytes(a.name, b.name));
  unplaced.sort((a, b) => byBytes(a.name, b.name));
  return { drawn, unplaced };
}

/** Types in breadth-first order from the most connected one, each component after the last. */
function startOrder(names: readonly string[], links: readonly { from: string; to: string }[]): string[] {
  const near = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const { from, to } of links) {
    if (from === to) continue;
    near.get(from)!.add(to);
    near.get(to)!.add(from);
  }
  const degree = (n: string) => near.get(n)!.size;
  const ranked = [...names].sort((a, b) => degree(b) - degree(a) || byBytes(a, b));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const root of ranked) {
    if (seen.has(root)) continue;
    seen.add(root);
    const queue = [root];
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(n);
      for (const m of [...near.get(n)!].sort(byBytes)) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
  }
  return order;
}

/** Lay out the map of `types` and `edges` in `box`. */
export function layoutSchema(types: readonly SchemaType[], edges: readonly SchemaEdge[], box: SchemaBox): SchemaLayout {
  const { width, height } = box;
  const minR = box.minRadius ?? 18;
  const maxR = box.maxRadius ?? 64;
  const margin = box.margin ?? maxR + 24;
  const labelRoom = box.room ?? LABEL_ROOM;
  const byName = new Map(types.map((t) => [t.name, t]));
  const names = [...byName.keys()].sort(byBytes);
  const { drawn, unplaced } = placedEdges(edges, new Set(names));
  const most = Math.max(1, ...types.map((t) => t.count));
  const radius = (count: number) => minR + (maxR - minR) * Math.sqrt(Math.max(0, count) / most);

  // Start: the most connected type in the middle, the rest on a circle in breadth-first order.
  const order = startOrder(names, drawn);
  const inner = { x0: margin, y0: margin, x1: Math.max(margin, width - margin), y1: Math.max(margin, height - margin) };
  const centre = { x: (inner.x0 + inner.x1) / 2, y: (inner.y0 + inner.y1) / 2 };
  const reach = Math.min(inner.x1 - inner.x0, inner.y1 - inner.y0) / 2;
  const r = new Map(names.map((n) => [n, radius(byName.get(n)!.count)]));
  const pos = new Map<string, { x: number; y: number }>();
  order.forEach((n, i) => {
    if (i === 0) pos.set(n, { ...centre });
    else {
      const a = (2 * Math.PI * (i - 1)) / Math.max(1, order.length - 1);
      pos.set(n, { x: centre.x + reach * Math.cos(a), y: centre.y + reach * Math.sin(a) });
    }
  });

  // Spread: Fruchterman-Reingold in the box itself, with shards that keep room for their labels,
  // walls at the box's edges and a temperature that falls each step.
  const area = Math.max(1, (inner.x1 - inner.x0) * (inner.y1 - inner.y0));
  const k = Math.sqrt(area / Math.max(1, names.length)) * 0.75;
  const pairs = drawn.filter((e) => e.from !== e.to);
  for (let step = 0; step < STEPS && names.length > 1; step++) {
    const t = (reach / 4) * (1 - step / STEPS) + 1;
    const move = new Map(names.map((n) => [n, { x: 0, y: 0 }]));
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = pos.get(order[i]!)!;
        const b = pos.get(order[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) {
          // Two at one place: part them along a direction fixed by their order.
          dx = i + 1;
          dy = j + 1;
          d = Math.hypot(dx, dy);
        }
        const room = r.get(order[i]!)! + r.get(order[j]!)! + labelRoom;
        const f = (k * k) / d + (d < room ? (room - d) * 2 : 0);
        const ma = move.get(order[i]!)!;
        const mb = move.get(order[j]!)!;
        ma.x += (dx / d) * f;
        ma.y += (dy / d) * f;
        mb.x -= (dx / d) * f;
        mb.y -= (dy / d) * f;
      }
    }
    for (const { from, to } of pairs) {
      const a = pos.get(from)!;
      const b = pos.get(to)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const f = (d * d) / k;
      const ma = move.get(from)!;
      const mb = move.get(to)!;
      ma.x -= (dx / d) * f;
      ma.y -= (dy / d) * f;
      mb.x += (dx / d) * f;
      mb.y += (dy / d) * f;
    }
    for (const n of order) {
      const m = move.get(n)!;
      const d = Math.hypot(m.x, m.y);
      const p = pos.get(n)!;
      if (d > 1e-12) {
        const s = Math.min(d, t) / d;
        p.x += m.x * s;
        p.y += m.y * s;
      }
      p.x = Math.min(inner.x1, Math.max(inner.x0, p.x));
      p.y = Math.min(inner.y1, Math.max(inner.y0, p.y));
    }
  }

  // Settle: the pull along edges can hold two shards closer than their room, so a fixed number
  // of passes push every such pair apart, half each way, in the start order; walls still hold.
  for (let pass = 0; pass < SETTLE && names.length > 1; pass++) {
    let moved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = pos.get(order[i]!)!;
        const b = pos.get(order[j]!)!;
        const room = r.get(order[i]!)! + r.get(order[j]!)! + labelRoom;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d >= room) continue;
        if (d < 1e-6) {
          dx = i + 1;
          dy = j + 1;
          d = Math.hypot(dx, dy);
        }
        const push = (room - Math.hypot(a.x - b.x, a.y - b.y)) / 2;
        a.x = Math.min(inner.x1, Math.max(inner.x0, a.x + (dx / d) * push));
        a.y = Math.min(inner.y1, Math.max(inner.y0, a.y + (dy / d) * push));
        b.x = Math.min(inner.x1, Math.max(inner.x0, b.x - (dx / d) * push));
        b.y = Math.min(inner.y1, Math.max(inner.y0, b.y - (dy / d) * push));
        moved = true;
      }
    }
    if (!moved) break;
  }

  const placed = new Map<string, PlacedType>();
  for (const n of names) {
    const p = names.length === 1 ? { x: width / 2, y: height / 2 } : pos.get(n)!;
    placed.set(n, { name: n, count: byName.get(n)!.count, x: round(p.x), y: round(p.y), r: round(r.get(n)!), side: "below" });
  }
  for (const n of names) {
    const p = placed.get(n)!;
    const angles: number[] = [];
    for (const e of drawn) {
      const other = e.from === n ? e.to : e.to === n ? e.from : null;
      if (other === null) continue;
      if (other === n) angles.push(-Math.PI / 4, 0);
      else angles.push(Math.atan2(placed.get(other)!.y - p.y, placed.get(other)!.x - p.x));
    }
    placed.set(n, { ...p, side: freestSide(angles) });
  }

  return {
    width,
    height,
    types: names.map((n) => placed.get(n)!),
    edges: arrows(drawn, placed),
    unplaced,
  };
}

/** Arrows between placed types: parallel ones bend apart, a type's own edge loops beside it. */
function arrows(drawn: readonly { name: string; from: string; to: string }[], placed: ReadonlyMap<string, PlacedType>): PlacedEdge[] {
  const pairKey = (a: string, b: string) => (byBytes(a, b) <= 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const groups = new Map<string, { name: string; from: string; to: string }[]>();
  for (const e of drawn) {
    const key = pairKey(e.from, e.to);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: PlacedEdge[] = [];
  for (const e of drawn) {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const group = groups.get(pairKey(e.from, e.to))!;
    const index = group.indexOf(e);
    if (e.from === e.to) {
      // A loop: out of the top right of the shard and back in at its right.
      const lift = a.r * (1.6 + 0.5 * index);
      const start = { x: round(a.x + a.r * 0.5), y: round(a.y - a.r * 0.87) };
      const end = { x: round(a.x + a.r), y: round(a.y) };
      const control = { x: round(a.x + lift * 1.4), y: round(a.y - lift * 1.2) };
      out.push({ name: e.name, from: e.from, to: e.to, start, end, control, middle: midpoint(start, control, end) });
      continue;
    }
    // Bend: 0 for a lone arrow; for several, spread evenly either side, the same way whichever
    // direction each arrow points.
    const offset = (index - (group.length - 1) / 2) * BEND;
    const flip = byBytes(e.from, e.to) <= 0 ? 1 : -1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(1e-9, Math.hypot(dx, dy));
    const nx = -dy / d;
    const ny = dx / d;
    const mx = (a.x + b.x) / 2 + nx * offset * flip * d;
    const my = (a.y + b.y) / 2 + ny * offset * flip * d;
    const start = towards(a, mx, my, a.r + 4);
    const end = towards(b, mx, my, b.r + 8);
    const control = { x: round(2 * mx - (start.x + end.x) / 2), y: round(2 * my - (start.y + end.y) / 2) };
    out.push({ name: e.name, from: e.from, to: e.to, start, end, control, middle: { x: round(mx), y: round(my) } });
  }
  return out;
}

/** The side whose direction is farthest from every arrow at `angles`; ties in {@link SIDES} order. */
function freestSide(angles: readonly number[]): LabelSide {
  let best: LabelSide = "below";
  let gap = -1;
  for (const [side, at] of SIDES) {
    const nearest = Math.min(Math.PI, ...angles.map((a) => Math.abs(Math.atan2(Math.sin(a - at), Math.cos(a - at)))));
    if (nearest > gap + 1e-9) {
      gap = nearest;
      best = side;
    }
  }
  return best;
}

/** The point at distance `by` from the centre of `p`, towards (`x`, `y`). */
function towards(p: PlacedType, x: number, y: number, by: number) {
  const dx = x - p.x;
  const dy = y - p.y;
  const d = Math.max(1e-9, Math.hypot(dx, dy));
  return { x: round(p.x + (dx / d) * by), y: round(p.y + (dy / d) * by) };
}

/** The middle of the quadratic curve from `a` through control `c` to `b`. */
function midpoint(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: round(0.25 * a.x + 0.5 * c.x + 0.25 * b.x), y: round(0.25 * a.y + 0.5 * c.y + 0.25 * b.y) };
}
