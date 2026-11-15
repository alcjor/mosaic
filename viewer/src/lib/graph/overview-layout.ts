/**
 * Where the overview's shards go (needs G-9, G-7): one shard per thing, in concentric bands, one
 * band per type, like the curved bands of a trencadís.
 *
 * Bands go from the middle out by how many shards they hold, most first, ties by type name
 * (UTF-8 bytes); each band's area follows its share of the shards. A band is cut into rows, and
 * each row into cells about as wide as the row is deep, so shards are roughly even; the cuts
 * between cells are jittered and each shard is pulled in from its neighbours for the gap, by
 * numbers drawn from its band, row and id only (brand book section 2: irregular polygons, never
 * squares or hexagons). Things fill a band in id order (UTF-8 bytes), row by row from the inside,
 * so the same things always draw the same picture.
 */
import { byBytes } from "./bytes.js";
import { round, seeded } from "./seed.js";
import type { Point } from "./shard.js";

export interface OverviewBand {
  readonly type: string;
  /** The things drawn, by id. */
  readonly ids: readonly string[];
}

export interface PlacedShard {
  readonly id: string;
  readonly type: string;
  /** Its corners, clockwise on screen. */
  readonly points: readonly Point[];
  /** A point inside it: where it is focused from and named. */
  readonly centre: Point;
}

export interface PlacedBand {
  readonly type: string;
  /** Inner and outer radius. */
  readonly inner: number;
  readonly outer: number;
  readonly shards: number;
}

export interface OverviewLayout {
  readonly size: number;
  readonly bands: readonly PlacedBand[];
  readonly shards: readonly PlacedShard[];
}

/** Space between neighbouring shards, in pixels: half on each side. */
export const GAP = 2;
/** How far a cut between two cells may move, as a share of a cell. */
const JITTER = 0.4;
/** The empty middle, as a share of the radius, so no shard is a sliver at the centre. */
const HOLE = 0.08;
/** The least share of the area a band takes, whatever it holds. */
const MIN_SHARE = 0.05;
/**
 * How far a cut leans: its outer end may move this share of a cell either way from its inner
 * end. With `JITTER`, `2 * LEAN < 1 - JITTER`, so neighbouring cuts never cross.
 */
const LEAN = 0.25;
/** How much rows of one band differ in depth. */
const ROW_VARIATION = 0.35;
/** Longest a shard may be along its row, against its depth. */
const MAX_ASPECT = 3;
/** Most corners a cut side of a shard gets. */
const SIDE_POINTS = 6;

/** Split `total` into whole parts that follow `weights`, largest remainders first, ties by index. */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ r: x - Math.floor(x), i })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    parts[i]!++;
    left--;
  }
  return parts;
}

/** Lay out `bands` as concentric rings in a square of side `size`. */
export function layoutOverview(bands: readonly OverviewBand[], size: number): OverviewLayout {
  const sorted = bands
    .map((b) => ({ type: b.type, ids: [...new Set(b.ids)].sort(byBytes) }))
    .filter((b) => b.ids.length > 0)
    .sort((a, b) => b.ids.length - a.ids.length || byBytes(a.type, b.type));
  const total = sorted.reduce((s, b) => s + b.ids.length, 0);
  const radius = size / 2 - GAP;
  const c = size / 2;
  const hole = radius * HOLE;
  const placedBands: PlacedBand[] = [];
  const shards: PlacedShard[] = [];
  let inner = hole;
  let area = 0;
  const fullArea = Math.PI * (radius * radius - hole * hole);
  // Each band's share of the area follows its shards, but never falls below a floor, so a type
  // with few things is still a band one can see and select.
  const floor = Math.min(MIN_SHARE, 1 / Math.max(1, sorted.length));
  const raw = sorted.map((b) => Math.max(floor, b.ids.length / Math.max(1, total)));
  const sum = raw.reduce((a, b) => a + b, 0);
  for (const [i, band] of sorted.entries()) {
    area += (fullArea * raw[i]!) / sum;
    const outer = Math.sqrt(area / Math.PI + hole * hole);
    placedBands.push({ type: band.type, inner: round(inner), outer: round(outer), shards: band.ids.length });
    shards.push(...bandShards(band.type, band.ids, c, inner, outer));
    inner = outer;
  }
  return { size, bands: placedBands, shards };
}

/** The shards of one band between radii `r0` and `r1` round (`c`, `c`). */
function bandShards(type: string, ids: readonly string[], c: number, r0: number, r1: number): PlacedShard[] {
  const n = ids.length;
  const bandArea = Math.PI * (r1 * r1 - r0 * r0);
  const side = Math.sqrt(bandArea / n);
  const rows = Math.max(1, Math.min(n, Math.round((r1 - r0) / side)));
  const bandRandom = seeded(`${type}\u0000rows`);
  // Rows of differing depth, so the band reads as laid by hand, not as rings of bricks.
  const depthWeights = Array.from({ length: rows }, () => 1 + (bandRandom() - 0.5) * 2 * ROW_VARIATION);
  const depthSum = depthWeights.reduce((a, b) => a + b, 0);
  const edges = [r0];
  for (const w of depthWeights) edges.push(edges.at(-1)! + ((r1 - r0) * w) / depthSum);
  edges[rows] = r1;
  // Cells per row follow each row's length and depth, so cells are about as big in every row.
  const perRow = apportion(
    n,
    Array.from({ length: rows }, (_, k) => ((edges[k]! + edges[k + 1]!) / 2) * (edges[k + 1]! - edges[k]!)),
  );
  const out: PlacedShard[] = [];
  let next = 0;
  for (let k = 0; k < rows; k++) {
    const cells = perRow[k]!;
    if (cells === 0) continue;
    const ri = edges[k]!;
    const ro = edges[k + 1]!;
    const depth = ro - ri;
    const width = (2 * Math.PI) / cells;
    const cuts = rowCuts(type, k, cells);
    for (let i = 0; i < cells; i++) {
      const id = ids[next++]!;
      const from = cuts[i]!;
      const wrap = i + 1 < cells ? 0 : 2 * Math.PI;
      const to = { inner: cuts[(i + 1) % cells]!.inner + wrap, outer: cuts[(i + 1) % cells]!.outer + wrap };
      // A row of few cells leaves the rest of its ring empty rather than bend one shard round it.
      const cap = (MAX_ASPECT * depth) / ((ri + ro) / 2);
      const clip = (a0: number, a1: number) => Math.min(a1, a0 + cap);
      out.push(cell(id, type, c, ri, ro, from, { inner: clip(from.inner, to.inner), outer: clip(from.outer, to.outer) }));
    }
  }
  return out;
}

/**
 * The cuts between the cells of row `row` of `type`'s band, at its inner and outer edge, in
 * angles that go up round the ring; the last cut is followed by the first, a turn later. Each
 * is jittered and leans, by numbers drawn from the type and row only, and never so far that two
 * neighbouring cuts cross: inner cuts lie at least `1 - JITTER` of a cell apart, and each end
 * leans at most `LEAN` of a cell, which `2 * LEAN < 1 - JITTER` keeps short of that.
 */
export function rowCuts(type: string, row: number, cells: number): { inner: number; outer: number }[] {
  const random = seeded(`${type}\u0000${row}`);
  const turn = random() * 2 * Math.PI;
  const width = (2 * Math.PI) / cells;
  return Array.from({ length: cells }, (_, i) => {
    const at = turn + width * (i + (cells > 1 ? (random() - 0.5) * JITTER : 0));
    return { inner: at, outer: at + (cells > 1 ? (random() - 0.5) * 2 * LEAN * width : 0) };
  });
}

/**
 * One shard: the cell between radii `ri`, `ro` and cuts `a0`, `a1`, kept half the gap inside
 * every side, so neighbouring shards never touch (G-9). Its arcs lie half a gap inside the row's
 * radii and are drawn in steps short enough that a chord sags at most a quarter of the gap; its
 * sides follow its cuts, half a gap inside them at every radius. Its depth is jittered a little
 * inwards and one of its four corners is sometimes chipped, by numbers from its id alone.
 */
function cell(
  id: string,
  type: string,
  c: number,
  ri: number,
  ro: number,
  a0: { inner: number; outer: number },
  a1: { inner: number; outer: number },
): PlacedShard {
  const random = seeded(id);
  const g = GAP / 2;
  const depth = ro - ri;
  const at = (r: number, a: number) => ({ x: c + r * Math.cos(a), y: c + r * Math.sin(a) });
  // Jitter the depth a little at each side, inwards only, so rows do not read as rings of bricks.
  const inR = ri + Math.min(depth * 0.3, g + depth * 0.08 * random());
  const outR = ro - Math.min(depth * 0.3, g + depth * 0.08 * random());
  const cut = (side: { inner: number; outer: number }, r: number) => side.inner + ((side.outer - side.inner) * (r - ri)) / Math.max(1e-9, depth);
  // Each side half a gap inside its cut; a cell too narrow for that keeps a sliver of its middle.
  const sides = (r: number): [number, number] => {
    const lo = cut(a0, r);
    const hi = cut(a1, r);
    const left = lo + g / r;
    const right = hi - g / r;
    if (right > left) return [left, right];
    const mid = (lo + hi) / 2;
    const half = (hi - lo) * 0.1;
    return [mid - half, mid + half];
  };
  // Steps along an arc of radius r short enough that a chord sags at most a quarter gap.
  const arcSteps = (r: number, span: number) => Math.max(1, Math.ceil(Math.abs(span) / (2 * Math.acos(Math.max(-1, 1 - g / 2 / r)))));
  // Steps along a side: enough to follow the cut's lean.
  const sideSteps = (side: 0 | 1) => {
    const turn = Math.abs(sides(outR)[side] - sides(inR)[side]) * outR;
    return Math.max(1, Math.min(SIDE_POINTS, Math.ceil(turn / g)));
  };
  const raw: { x: number; y: number }[] = [];
  const corners: number[] = [];
  const [o0, o1] = sides(outR);
  const so = arcSteps(outR, o1 - o0);
  corners.push(raw.length);
  for (let s = 0; s < so; s++) raw.push(at(outR, o0 + ((o1 - o0) * s) / so));
  const k1 = sideSteps(1);
  corners.push(raw.length);
  for (let s = 0; s < k1; s++) {
    const r = outR - ((outR - inR) * s) / k1;
    raw.push(at(r, sides(r)[1]));
  }
  const [i0, i1] = sides(inR);
  const si = arcSteps(inR, i1 - i0);
  corners.push(raw.length);
  for (let s = 0; s < si; s++) raw.push(at(inR, i1 - ((i1 - i0) * s) / si));
  const k0 = sideSteps(0);
  corners.push(raw.length);
  for (let s = 0; s < k0; s++) {
    const r = inR + ((outR - inR) * s) / k0;
    raw.push(at(r, sides(r)[0]));
  }
  // One of the four corners sometimes chipped (brand book section 2): a corner of a cell is
  // convex, so cutting it keeps the shard inside its cell.
  if (random() < 0.35) {
    const k = corners[Math.floor(random() * corners.length)]!;
    const p = raw[k]!;
    const prev = raw[(k + raw.length - 1) % raw.length]!;
    const next = raw[(k + 1) % raw.length]!;
    raw.splice(k, 1, mix(p, prev, 0.3), mix(p, next, 0.3));
  }
  const rm = (inR + outR) / 2;
  const [m0, m1] = sides(rm);
  const middle = at(rm, (m0 + m1) / 2);
  const points = raw.map((p) => ({ x: round(p.x), y: round(p.y) }));
  return { id, type, points, centre: { x: round(middle.x), y: round(middle.y) } };
}

function mix(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
