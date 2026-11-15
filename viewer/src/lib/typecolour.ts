/**
 * One colour per type (brand book, section 6, Type colours): a palette of eight hues and a
 * second step of each, the design tokens `type-1` to `type-16`. Types take the colours in the
 * order the page lists them (the view file's order, then the file's), repeating after sixteen;
 * a view file may name a type's colour (`types.<Type>.colour`), and the other types then take
 * the colours no type names.
 *
 * In a component: `<Shard type="Title" />` draws the type's shard, and any element takes the
 * colour as `--type-colour` from `data-type-colour={colourOf(type)}`, where
 * `const colourOf = typeColours()` (lib/typecolour.context.ts) reads what the shell provided.
 */
export const HUES = ["cobalt", "turquoise", "terracotta", "plum", "slate", "rose", "sky", "umber"] as const;

/** The palette's names, in order: the name at index `n - 1` is the token `type-n`. */
export const COLOURS: readonly string[] = [...HUES, ...HUES.map((hue) => `${hue}-2`)];

/** A type and the colour the view file names for it, if any. */
export interface Coloured {
  readonly name: string;
  readonly colour?: string | null | undefined;
}

/** Each type's colour, as the number of its token (1 to 16), for `types` in the order listed. */
export function assignColours(types: readonly Coloured[]): Map<string, number> {
  const named = new Set(types.map((t) => COLOURS.indexOf(t.colour ?? "")).filter((i) => i >= 0));
  const all = COLOURS.map((_, i) => i);
  const free = named.size < all.length ? all.filter((i) => !named.has(i)) : all;
  const out = new Map<string, number>();
  let next = 0;
  for (const type of types) {
    const own = COLOURS.indexOf(type.colour ?? "");
    out.set(type.name, (own >= 0 ? own : free[next++ % free.length]!) + 1);
  }
  return out;
}
