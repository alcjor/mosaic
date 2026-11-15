/** Text compared by its UTF-8 bytes, as the kit orders names and ids (Specification 0.1, section 3.1: text is ordered by UTF-8 bytes). */

const UTF8 = new TextEncoder();

/** Compare two strings by their UTF-8 bytes. */
export function byBytes(a: string, b: string): number {
  if (a === b) return 0;
  const x = UTF8.encode(a);
  const y = UTF8.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}
