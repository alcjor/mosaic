/**
 * What the neighbourhood's screen writes and where it puts its words (needs G-3, G-4, G-7, G-10):
 * each group named with its edge type, direction and count; the box that holds the
 * picture; each thing's name beside its shard, never over another name or a shard; and notes that
 * say when the picture shows only part of a thing's links.
 */
import { RESULT_LIMIT } from "@mosaic/kit";
import { byBytes } from "./bytes.js";
import type { Hood, Loaded } from "./hood.js";
import type { HoodLayout } from "./hood-layout.js";
import { COLUMN, columns, cutTo, noun, number, type PlacedName, type Rect } from "./mapview.js";

/**
 * A group's name: its edge type's name and its count; links reaching the thing start with "←",
 * so the two directions of one edge type read apart.
 */
export function groupText(name: string, direction: "out" | "in", count: number): string {
  return `${direction === "in" ? "← " : ""}${name} · ${number(count)}`;
}

/** Room round the picture for names, in its own units. */
const MARGIN = 110;

/** The box that holds every shard, bundle and group name of `layout`, with room for names. */
export function viewBoxOf(layout: HoodLayout): Rect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of layout.things) xs.push(t.x), ys.push(t.y);
  for (const g of layout.groups) {
    xs.push(g.labelAt.x), ys.push(g.labelAt.y);
    if (g.bundle) xs.push(g.bundle.x), ys.push(g.bundle.y);
  }
  const left = Math.min(...xs) - MARGIN;
  const top = Math.min(...ys) - MARGIN;
  return { x: left, y: top, width: Math.max(...xs) + MARGIN - left, height: Math.max(...ys) + MARGIN - top };
}

/** The most columns of a thing's name shown beside its shard; the whole name is in its page and the panel. */
export const THING_COLUMNS = 18;

/** A name's box: its height, and the room between it and its shard. */
const HIGH = 16;
const GAP = 4;
const PAD = 3;

/**
 * Where each thing's name goes: below its shard, else above, right or left of it, whichever is
 * first clear of the names already placed and of `keepClear` (the shards and the groups' names).
 * A name with no clear place is null: it shows when its thing has the focus or is selected, and
 * always in the list and the panel. Names are placed in the order given, so the first keep theirs.
 */
export function placeThingNames(spots: readonly { x: number; y: number; r: number; text: string }[], keepClear: readonly Rect[]): (PlacedName | null)[] {
  const placed: Rect[] = [];
  const r = (n: number) => Math.round(n * 100) / 100;
  return spots.map((spot) => {
    const text = cutTo(spot.text, THING_COLUMNS);
    const width = columns(text) * COLUMN + 2 * PAD;
    const tries: Rect[] = [
      { x: spot.x - width / 2, y: spot.y + spot.r + GAP, width, height: HIGH },
      { x: spot.x - width / 2, y: spot.y - spot.r - GAP - HIGH, width, height: HIGH },
      { x: spot.x + spot.r + GAP, y: spot.y - HIGH / 2, width, height: HIGH },
      { x: spot.x - spot.r - GAP - width, y: spot.y - HIGH / 2, width, height: HIGH },
    ];
    const clear = tries.find((at) => !placed.some((p) => clashes(at, p)) && !keepClear.some((k) => clashes(at, k)));
    if (clear === undefined) return null;
    placed.push(clear);
    return { text, x: r(clear.x + width / 2), y: r(clear.y + HIGH / 2 + 4), back: { x: r(clear.x), y: r(clear.y), width: r(width), height: HIGH } };
  });
}

function clashes(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}


/**
 * The edge types the things whose neighbourhoods are open (and drawn) have, by name (UTF-8 bytes),
 * each with the sum of its groups' counts, as the groups' names give them. The page uses it to say
 * how many edge types are turned off; the counts it shows by each edge type are the distinct links
 * of `edgeCounts` (lib/graph/hood.ts), not these sums.
 */
export function edgeChoices(hood: Pick<Hood, "centre" | "expanded">, drawn?: ReadonlySet<string>): { edge: string; count: number }[] {
  const counts = new Map<string, number>();
  // An expanded thing that is not drawn (folded into a bundle) opens nothing, so it adds nothing.
  const open = [hood.centre, ...hood.expanded.filter((e) => drawn === undefined || drawn.has(e.centre.id))];
  for (const loaded of open) for (const g of loaded.groups) counts.set(g.edge, (counts.get(g.edge) ?? 0) + g.count);
  return [...counts].sort(([a], [b]) => byBytes(a, b)).map(([edge, count]) => ({ edge, count }));
}

/** What the picture says when it shows only part of the links of the things in it (G-4, G-5, G-10). */
export function partNotes(hood: Pick<Hood, "centre" | "expanded"> & Partial<Pick<Hood, "state" | "failed">>, layout: HoodLayout): string[] {
  const notes: string[] = [];
  const edges = hood.state?.edges ?? null;
  if (edges !== null) {
    const off = edgeChoices(hood, new Set(layout.things.map((t) => t.id))).filter((c) => !edges.includes(c.edge)).length;
    if (off === 1) notes.push("1 edge type is not shown.");
    else if (off > 1) notes.push(`${number(off)} edge types are not shown.`);
  }
  for (const f of hood.failed ?? []) notes.push(`Could not open the neighbourhood of ${f.id}: ${f.message}`);
  const bundles = layout.groups.filter((g) => g.bundle !== null).length;
  if (bundles === 1) notes.push("1 group shows only part of its things: open its bundle to list the rest.");
  else if (bundles > 1) notes.push(`${number(bundles)} groups show only part of their things: open a bundle to list the rest.`);
  for (const loaded of [hood.centre, ...hood.expanded]) {
    if (loaded.unlisted > 0) {
      const name = loaded.centre.label ?? loaded.centre.id;
      const kinds = noun(loaded.unlisted, "kind", "kinds");
      notes.push(`${name} has ${number(loaded.unlisted)} more ${kinds} of link than the picture shows: the kit lists ${RESULT_LIMIT} kinds per thing.`);
    }
  }
  return notes;
}

/**
 * What a thing's links come to, for the line above the picture: its kinds of link (edge type and
 * direction) and its links. When the kit lists only some kinds, the links counted are those of
 * the kinds listed, and the line says so.
 */
export function summary(loaded: Pick<Loaded, "centre" | "groups" | "unlisted">): string {
  const name = loaded.centre.label ?? loaded.centre.id;
  const listed = loaded.groups.length;
  const kinds = listed + loaded.unlisted;
  const links = loaded.groups.reduce((s, g) => s + g.count, 0);
  const head = `${name}: ${number(kinds)} ${noun(kinds, "kind", "kinds")} of link`;
  const counted = `${number(links)} ${noun(links, "link", "links")}`;
  return loaded.unlisted > 0 ? `${head}; ${counted} in the ${number(listed)} the kit lists` : `${head}, ${counted}`;
}

/** `things` with each thing once, at its first place: two links to one thing list it once. */
export function once<T extends { readonly id: string }>(things: readonly T[]): T[] {
  const seen = new Set<string>();
  return things.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
}

/**
 * True when selecting the bundle `key` must ask the kit: it is not the bundle open, or opening it
 * failed (a failure is not kept, so selecting it again tries again).
 */
export function mustOpen(opened: { key: string; failed: string | null } | null, key: string): boolean {
  return opened === null || opened.key !== key || opened.failed !== null;
}
