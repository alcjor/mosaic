/**
 * What the neighbourhood's stage works out from a picture (needs G-3, G-4, G-5, G-7): the edge
 * types its chips offer, how many links each thing keeps folded, how the picture fits the stage,
 * and where a thing's tooltip goes.
 */
import { byBytes } from "./bytes.js";
import type { Point } from "./force-layout.js";
import { shows, type Hood } from "./hood.js";
import type { HoodLayout } from "./hood-layout.js";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** How the picture sits on the stage: a point of it is drawn at `k` times itself, moved by (`x`, `y`). */
export interface View {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

/** The edge types the unfolded things have, shown or not, by name (UTF-8 bytes). */
export function edgeChoices(hood: Pick<Hood, "centre" | "expanded">): string[] {
  return [...new Set([hood.centre, ...hood.expanded].flatMap((l) => l.groups.map((g) => g.edge)))].sort(byBytes);
}

/**
 * How many links each thing drawn keeps folded: its links of the edge types shown, less those
 * the picture draws. A thing's link to itself is in both its directions, and counts in both.
 */
export function foldedLinks(hood: Pick<Hood, "state" | "centre" | "expanded" | "leaves">, layout: Pick<HoodLayout, "links">): Map<string, number> {
  const drawn = new Map<string, number>();
  for (const l of layout.links) for (const id of [l.from, l.to]) drawn.set(id, (drawn.get(id) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const loaded of [hood.centre, ...hood.expanded, ...hood.leaves]) {
    const all = loaded.groups.reduce((sum, g) => sum + (shows(hood.state, g.edge) ? g.count : 0), 0);
    out.set(loaded.centre.id, Math.max(0, all - (drawn.get(loaded.centre.id) ?? 0)));
  }
  return out;
}

/** Room kept between the things and the stage's edges, for their names and badges. */
const ROOM = { x: 80, y: 56 };
/** The picture is never drawn larger than it is laid out, nor smaller than this. */
const SMALLEST = 0.2;

/** The view that shows every one of `points` on `stage`, in its middle. */
export function fitView(points: readonly Point[], stage: Size): View {
  if (points.length === 0) return { k: 1, x: stage.width / 2, y: stage.height / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.max(
    SMALLEST,
    Math.min(1, (stage.width - 2 * ROOM.x) / Math.max(1, right - left), (stage.height - 2 * ROOM.y) / Math.max(1, bottom - top)),
  );
  return { k, x: stage.width / 2 - (k * (left + right)) / 2, y: stage.height / 2 - (k * (top + bottom)) / 2 };
}

/** Where `view` draws `p`. */
export function onStage(view: View, p: Point): Point {
  return { x: p.x * view.k + view.x, y: p.y * view.k + view.y };
}

/** True when `view` draws every one of `points` on `stage`, with half the room a fitted picture keeps. */
export function allOnStage(points: readonly Point[], view: View, stage: Size): boolean {
  return points.every((p) => {
    const at = onStage(view, p);
    return at.x >= ROOM.x / 2 && at.x <= stage.width - ROOM.x / 2 && at.y >= ROOM.y / 2 && at.y <= stage.height - ROOM.y / 2;
  });
}

/** How far a tooltip keeps from its thing and from the stage's edges. */
const TIP_GAP = 12;
const TIP_INSET = 8;

/**
 * The top left corner of a thing's tooltip: right of the thing, else left, below or above it,
 * the first that is whole on the stage; never over the thing itself. `thing` is where its shard
 * is drawn and how far it reaches (`r`); with its name under it, it reaches `wide` to each side
 * and `low` below.
 */
export function tipPlace(thing: Point & { readonly r: number; readonly wide?: number; readonly low?: number }, tip: Size, stage: Size): Point {
  const clamp = (n: number, most: number) => Math.max(TIP_INSET, Math.min(n, most - TIP_INSET));
  const wide = Math.max(thing.r, thing.wide ?? 0);
  const low = Math.max(thing.r, thing.low ?? 0);
  const y = clamp(thing.y - thing.r, stage.height - tip.height);
  const x = clamp(thing.x - tip.width / 2, stage.width - tip.width);
  const places: Point[] = [
    { x: thing.x + wide + TIP_GAP, y },
    { x: thing.x - wide - TIP_GAP - tip.width, y },
    { x, y: thing.y + low + TIP_GAP },
    { x, y: thing.y - thing.r - TIP_GAP - tip.height },
  ];
  const whole = (p: Point) => p.x >= TIP_INSET && p.y >= TIP_INSET && p.x + tip.width <= stage.width - TIP_INSET && p.y + tip.height <= stage.height - TIP_INSET;
  return places.find(whole) ?? places[0]!;
}
