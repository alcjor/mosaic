/**
 * Chains on one mosaic, as the viewer finds their results (V-13, V-14), the kit
 * running in Bun as it runs in the page. Reads a JSON list of `{name, chain, pages}` (each page
 * `[offset, limit]`) and prints one JSON line: per chain, the results of each page (ids and
 * qualifiers), the count, and how long the first page and the count took on a fresh reader.
 *
 *     bun viewer/scripts/chains.ts FILE CHAINS.json
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { openFile } from "@mosaic/kit";
import type { Chain } from "../src/lib/chain.js";
import { ChainResults } from "../src/lib/results.js";

const [file, chains] = process.argv.slice(2);
if (!file || !chains) {
  console.error("usage: bun viewer/scripts/chains.ts FILE CHAINS.json");
  process.exit(2);
}
const asked = JSON.parse(readFileSync(chains, "utf-8")) as { name: string; chain: Chain; pages: [number, number][] }[];
const mosaic = await openFile(new Uint8Array(readFileSync(file)), basename(file));
try {
  const seen = [];
  for (const { name, chain, pages } of asked) {
    // A fresh reader: the first page and the count, side by side, as a page asks for them.
    const fresh = new ChainResults(mosaic, chain);
    const started = performance.now();
    let firstMs = 0;
    const [first, count] = await Promise.all([
      fresh.page(0, 20).then((p) => {
        firstMs = performance.now() - started;
        return p;
      }),
      fresh.count(),
    ]);
    const bothMs = performance.now() - started;
    const results = new ChainResults(mosaic, chain);
    const shown = [];
    for (const [offset, limit] of pages) {
      const page = await results.page(offset, limit);
      shown.push({ offset, limit, results: page.map((r) => ({ things: r.things.map((t) => t.id), labels: r.things.map((t) => t.label), qualifiers: r.links.map((l) => l.qualifier) })) });
    }
    seen.push({
      name,
      count,
      first: first.map((r) => r.things.map((t) => t.id)),
      pages: shown,
      ms: { first: Math.round(firstMs), both: Math.round(bothMs) },
    });
  }
  console.log(JSON.stringify({ timeLimitMs: mosaic.timeLimitMs, seen }));
} finally {
  mosaic.close();
}
