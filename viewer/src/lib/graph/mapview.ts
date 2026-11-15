/**
 * What the map's screen writes and links to (needs G-1, G-2): numbers written the same way on
 * every machine (no locale), arrows as thick as their links, and the table each selection opens.
 */
import type { EdgeType } from "@mosaic/kit";
import type { TableRoute } from "../route.js";

/** `n` with a comma between each three digits, as the page writes counts everywhere. */
export function number(n: number): string {
  const digits = String(Math.trunc(Math.abs(n)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${grouped}` : grouped;
}

/** The word for `n` of something: `one` for exactly one whole thing, else `many`. */
export function noun(n: number | null, one: string, many: string, partial = false): string {
  return n === 1 && !partial ? one : many;
}

/** `x` to one decimal, without a trailing `.0`. */
export function average(x: number): string {
  // Above nought but below what one decimal shows: not "0", which would read as none.
  if (x > 0 && x < 0.05) return "under 0.1";
  const fixed = x.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** Thinnest and thickest arrow, in pixels of the map's box. */
const THIN = 1;
const THICK = 6;

/** An arrow's width: from {@link THIN} to {@link THICK}, its area following its links against the most. */
export function strokeWidth(links: number | null, most: number): number {
  if (links === null || most <= 0) return THIN;
  return THIN + (THICK - THIN) * Math.sqrt(Math.max(0, links) / most);
}

/** The table a selected type opens: its own. */
export function typeTable(type: string): TableRoute {
  return { type, page: 1, order: null, where: [] };
}

/**
 * The table a selected edge type opens: the table of the type it leaves, whose things' pages list
 * their links of it; none when it may leave any type. `table` lists the rows of one node type
 * (section 8.6), so an edge type has no table of its own.
 */
export function edgeTable(edge: Pick<EdgeType, "name" | "from" | "to">): TableRoute | null {
  return edge.from === null ? null : typeTable(edge.from);
}

/**
 * The walks a selection puts first, in order: a type's own; for an edge type, the type it leaves
 * (its link counts) and then the type it reaches (its most linked things, see `mostLinkedByEdge`).
 */
export function walksFor(selection: { kind: "type" | "edge"; name: string }, edgeTypes: readonly Pick<EdgeType, "name" | "from" | "to">[]): string[] {
  if (selection.kind === "type") return [selection.name];
  const edge = edgeTypes.find((e) => e.name === selection.name);
  if (edge === undefined) return [];
  const walks: string[] = [];
  for (const type of [edge.from, edge.to]) if (type !== null && !walks.includes(type)) walks.push(type);
  return walks;
}

/**
 * What a partial list of most linked things says of the count behind it, naming the type being
 * counted (`label`); null when the list is whole.
 */
export function partialNote(most: { partial: boolean; counted: number; total: number | null }, label: string): string | null {
  if (!most.partial) return null;
  if (most.total === null) return `The things of ${label} are waiting to be counted.`;
  return `So far: ${number(most.counted)} of ${number(most.total)} ${noun(most.total, "thing", "things")} of ${label} counted.`;
}

type Point = { readonly x: number; readonly y: number };

/** A rectangle in the map's box. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The width of one column of an arrow's name (a 12px caption in the monospaced font), at most. */
export const COLUMN = 7.5;

/** The most columns an arrow's name takes on the map; a longer one is cut, ending in "…". */
export const NAME_COLUMNS = 40;

/** Room around a name inside its backing box, and the box's height. */
const PAD = 3;
const HIGH = 16;

/**
 * Columns a text takes in a monospaced font: wide characters (Chinese, Japanese, Korean,
 * fullwidth forms, emoji) take two, marks that join or modify the one before take none.
 */
export function columns(text: string): number {
  let n = 0;
  for (const ch of text) n += columnsOf(ch.codePointAt(0)!);
  return n;
}

function columnsOf(c: number): number {
  if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x1f3fb && c <= 0x1f3ff)) return 0;
  if (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x2600 && c <= 0x27bf) ||
    (c >= 0x1f000 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
    return 2;
  return 1;
}

/** `text` cut to at most `most` columns, ending in "…" when cut. */
export function cutTo(text: string, most: number): string {
  if (columns(text) <= most) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = columnsOf(ch.codePointAt(0)!);
    if (used + w > most - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

/** Where an arrow's name is drawn: its text (cut if long), centre and baseline, and its box. */
export interface PlacedName {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly back: Rect;
}

function area(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function onCurve(a: { start: Point; control: Point; end: Point }, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.start.x + 2 * u * t * a.control.x + t * t * a.end.x, y: u * u * a.start.y + 2 * u * t * a.control.y + t * t * a.end.y };
}

/** Places tried along an arrow, middle first, and nudges up and down from each. */
const ALONG = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
const NUDGE = [0, -(HIGH + 2), HIGH + 2];

/** Columns kept for an arrow's count (" · 1,234,567"), so its name does not move as it grows. */
const COUNT_COLUMNS = 12;

/**
 * Where each arrow's name goes (G-1: every edge type drawn with its count, readable): on a box in
 * the page's colour that the arrows pass behind, inside the map's `box`, apart from the other
 * names and from `keepClear` (the shards and their names). Each, in the order given, takes the
 * first place along its arrow that is clear, the middle first; where none is, the one that
 * covers least. A place depends on the name only, with room kept for the count, so names stay
 * where they are while counts come in (G-7, G-10). A name longer than {@link NAME_COLUMNS} is cut;
 * the count never is.
 */
export function placeNames(
  arrows: readonly { start: Point; control: Point; end: Point; name: string; count: string }[],
  box: { width: number; height: number },
  keepClear: readonly Rect[],
): PlacedName[] {
  const placed: Rect[] = [];
  const out: PlacedName[] = [];
  const r = (n: number) => Math.round(n * 100) / 100;
  for (const arrow of arrows) {
    const name = cutTo(arrow.name, NAME_COLUMNS);
    const text = `${name} · ${arrow.count}`;
    const drawn = columns(text) * COLUMN + 2 * PAD;
    const width = Math.max(drawn, (columns(name) + COUNT_COLUMNS) * COLUMN + 2 * PAD);
    let best: { at: Rect; cost: number } | null = null;
    for (const t of ALONG) {
      const p = onCurve(arrow, t);
      for (const dy of NUDGE) {
        const x = Math.min(Math.max(p.x - width / 2, 0), Math.max(0, box.width - width));
        const y = Math.min(Math.max(p.y + dy - HIGH / 2, 0), box.height - HIGH);
        const at = { x, y, width, height: HIGH };
        let cost = 0;
        for (const other of placed) cost += area(at, other) * 4;
        for (const other of keepClear) cost += area(at, other);
        if (best === null || cost < best.cost) best = { at, cost };
        if (cost === 0) break;
      }
      if (best!.cost === 0) break;
    }
    const at = best!.at;
    placed.push(at);
    const centre = at.x + at.width / 2;
    out.push({ text, x: r(centre), y: r(at.y + HIGH / 2 + 4), back: { x: r(centre - drawn / 2), y: r(at.y), width: r(drawn), height: HIGH } });
  }
  return out;
}
