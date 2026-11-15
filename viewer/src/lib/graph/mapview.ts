/**
 * What the map's screen writes (need G-1): numbers written the same way on every machine (no
 * locale), and names cut to the columns there are.
 */

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

/** The most columns an arrow's name takes on the map; a longer one is cut, ending in "…". */
export const NAME_COLUMNS = 40;

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
