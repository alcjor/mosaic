/**
 * The shard a thing or a type is drawn as (brand book, section 2 "The shard motif"): an irregular
 * polygon, like broken ceramic, never a square, hexagon or rounded tile. Its shape comes from the
 * id alone (need G-7): 5 or 7 corners at jittered angles and radii, one sometimes chipped.
 */
import { round, seeded } from "./seed.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The corners of the shard of `id`, centred on (`cx`, `cy`) and fitting in a circle of radius
 * `r`, clockwise on screen from the top.
 */
export function shardPoints(id: string, cx: number, cy: number, r: number): readonly Point[] {
  const next = seeded(id);
  const corners = next() < 0.5 ? 5 : 7;
  const step = (2 * Math.PI) / corners;
  const turn = next() * step;
  const points: Point[] = [];
  const chipped = next() < 0.4 ? Math.floor(next() * corners) : -1;
  for (let i = 0; i < corners; i++) {
    const angle = turn + i * step + (next() - 0.5) * step * 0.5;
    const radius = r * (0.78 + next() * 0.22);
    if (i === chipped) {
      // A chipped corner: two points where one would be, pulled in.
      const half = step * 0.18;
      for (const a of [angle - half, angle + half]) {
        points.push({ x: round(cx + radius * 0.82 * Math.sin(a)), y: round(cy - radius * 0.82 * Math.cos(a)) });
      }
    } else {
      points.push({ x: round(cx + radius * Math.sin(angle)), y: round(cy - radius * Math.cos(angle)) });
    }
  }
  return points;
}

/** `points` as the value of an SVG `points` attribute. */
export function svgPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}
