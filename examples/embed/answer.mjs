// Answer a question from a mosaic with the kit alone: no viewer, no server.
//
//     bun install && bun run build        (once, from the repository root)
//     node examples/embed/answer.mjs [FILE.mosaic] [WORDS]
//
// Prints what is linked to the first thing WORDS finds, and the source of each link.
import { readFileSync } from "node:fs";
import { openFile } from "../../kit/dist/index.js";

const file = process.argv[2] ?? new URL("../../conformance/reading/mosaic.mosaic", import.meta.url);
const words = process.argv[3] ?? "Group x";

const mosaic = await openFile(new Uint8Array(readFileSync(file)), "mosaic");
try {
  const found = await mosaic.find({ query: words, limit: 1 });
  const thing = found.data?.results[0];
  if (!thing) throw new Error(`nothing found for ${JSON.stringify(words)}`);
  const links = await mosaic.neighbors({ id: thing.id });
  for (const link of links.data.edges) {
    const [from, to] = link.direction === "in" ? [link, thing] : [thing, link];
    const cited = await mosaic.cite({ from: from.id, type: link.edge, to: to.id });
    const sources = cited.data.evidence.map((e) => `${e.source}, ${e.locator}`).join("; ");
    console.log(`${from.label} ${link.edge} ${to.label} (${sources})`);
  }
} finally {
  mosaic.close();
}
