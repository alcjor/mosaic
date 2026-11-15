/**
 * Numbers drawn from ids, never from `Math.random` or the clock, so the same mosaic always draws
 * the same picture (need G-7). Text is hashed by its UTF-8 bytes (FNV-1a, 32 bits), and the hash
 * seeds a small generator (mulberry32). Coordinates are rounded to hundredths of a pixel, so the
 * last bits of one browser's trigonometry never show in what is drawn.
 */

const UTF8 = new TextEncoder();

/** FNV-1a over the UTF-8 bytes of `text`: an unsigned 32-bit number. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of UTF8.encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A generator of numbers in [0, 1) seeded by `seed`: the same seed gives the same sequence. */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator seeded by the UTF-8 bytes of `id`. */
export function seeded(id: string): () => number {
  return generator(hashText(id));
}

/** `x` rounded to hundredths, with -0 written as 0. */
export function round(x: number): number {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
}
