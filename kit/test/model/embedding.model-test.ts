// The real model (section 6): the kit's tokenizer gives the builder's token ids, the
// kit's query vectors agree in sign with the builder's, the vector tier finds by meaning, and
// the kit with the model stays under its size budget (ADR-007). The builder's ids and signs are
// in `conformance/embedding/cases.json` (`scripts/make_embedding_cases.py`).
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  EMBED_MODEL,
  MAX_TOKENS,
  MODEL,
  WordPiece,
  loadEmbedder,
  openFile,
  queryText,
  score,
  type QueryEmbedder,
} from "../../src/index.js";
import { buildMosaic } from "../build-mosaic.js";

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const MODEL_DIR = process.env["MOSAIC_MODEL_DIR"] ?? repo(`.cache/model/${MODEL.name}@${MODEL.revision}`);

interface Case {
  query: string;
  text: string;
  ids: number[];
  bits: string;
}
const CASES = JSON.parse(readFileSync(repo("conformance/embedding/cases.json"), "utf8")) as {
  embed_model: string;
  max_tokens: number;
  cases: Case[];
};

function modelFile(path: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(join(MODEL_DIR, path)));
  } catch {
    throw new Error(`${join(MODEL_DIR, path)} is missing: run uv run python scripts/fetch_model.py`);
  }
}

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
const bitOf = (bytes: Uint8Array, i: number): boolean => (bytes[i >> 3]! & (0x80 >> (i & 7))) !== 0;

let embedder: QueryEmbedder;
let tokenizer: WordPiece;

beforeAll(async () => {
  const files = { model: modelFile(MODEL.modelFile.path), tokenizer: modelFile(MODEL.tokenizer.path) };
  tokenizer = new WordPiece(new TextDecoder().decode(files.tokenizer));
  embedder = await loadEmbedder(files);
});

describe("the real model (section 6)", () => {
  it("is the model the cases were made with", () => {
    expect(CASES.embed_model).toBe(EMBED_MODEL);
    expect(CASES.max_tokens).toBe(MAX_TOKENS);
    expect(embedder.model).toBe(EMBED_MODEL);
  });

  it("the kit's tokenizer gives the builder's token ids for every case, truncated at 256", () => {
    for (const c of CASES.cases) {
      expect(c.text).toBe(queryText(c.query));
      expect(tokenizer.encode(c.text, MAX_TOKENS), JSON.stringify(c.query).slice(0, 60)).toEqual(c.ids);
    }
    expect(CASES.cases.some((c) => c.ids.length === MAX_TOKENS)).toBe(true);
  });

  it("the kit's query vectors agree in sign with the builder's on at least 98 % of the dimensions of the set", async () => {
    let differing = 0;
    let worst = 1;
    for (const c of CASES.cases) {
      const v = await embedder.embedQuery(c.query);
      expect(v).toHaveLength(DIMENSIONS);
      expect(Math.hypot(...v)).toBeCloseTo(1, 5);
      const builder = hexBytes(c.bits);
      let agree = 0;
      for (let i = 0; i < DIMENSIONS; i++) if (v[i]! > 0 === bitOf(builder, i)) agree += 1;
      differing += DIMENSIONS - agree;
      worst = Math.min(worst, agree / DIMENSIONS);
    }
    const total = CASES.cases.length * DIMENSIONS;
    console.log(
      `sign agreement: ${CASES.cases.length} texts, ${differing} of ${total} dimensions differ ` +
        `(${((100 * differing) / total).toFixed(2)} %), worst text ${(100 * worst).toFixed(2)} % agree`,
    );
    // Spike S5 measured 0.87 % of bits differing between runtimes, over a set of texts.
    expect(1 - differing / total).toBeGreaterThanOrEqual(0.98);
    // No text is far off: a tokenizer or pooling fault would show here first.
    expect(worst).toBeGreaterThanOrEqual(0.95);
  });

  it("embeds a query in tens of milliseconds", async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      await embedder.embedQuery(`which film is about a robot, take ${i}`);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    console.log(`query embedding: median ${times[5]!.toFixed(1)} ms, max ${times[9]!.toFixed(1)} ms`);
    expect(times[5]).toBeLessThan(1_000);
  });

  it("find lists by meaning: a query sharing no word with the node finds it in the vector tier", async () => {
    // Stored vectors are the builder's, from the cases: each node holds the signs the builder
    // gave one text.
    const byQuery = new Map(CASES.cases.map((c) => [c.query, hexBytes(c.bits)]));
    const texts = {
      "Item:robot": "a film about a lonely robot who falls in love in space",
      "Item:ocean": "documentary on ocean life and coral reefs",
      "Item:heat": "which step switches the lamp on?",
      "Item:seated": "Seated Figure",
    };
    const nodes = Object.keys(texts).map((id) => ({ type: "Item", key: id.slice(5), label: id.slice(5) }));
    const vectors = Object.fromEntries(Object.entries(texts).map(([id, t]) => [id, byQuery.get(t)!]));
    const file = await openFile(buildMosaic({ nodes, vectors }), "meaning.mosaic", { embedder });
    expect(file.vectorSearch).toBe(true);
    const first = async (query: string) => {
      const answer = await file.find({ query });
      if (!("data" in answer)) throw new Error(JSON.stringify(answer));
      return answer.data.results[0];
    };
    expect(await first("android romance among the stars")).toMatchObject({ id: "Item:robot", match: "vector" });
    expect(await first("marine animals under the sea")).toMatchObject({ id: "Item:ocean", match: "vector" });
    file.close();
  });
});

describe("kit size with the model (ADR-007)", () => {
  it("is under 60 MB compressed: the kit, SQLite, ONNX Runtime's WebAssembly and the model files", () => {
    const require = createRequire(import.meta.url);
    const src = fileURLToPath(new URL("../../src/", import.meta.url));
    const sqlite = join(dirname(require.resolve("@sqlite.org/sqlite-wasm/package.json")), "dist");
    const ort = dirname(require.resolve("onnxruntime-web/wasm"));
    const files = [
      ...readdirSync(src).map((name) => join(src, name)),
      join(sqlite, "index.mjs"),
      join(sqlite, "sqlite3.wasm"),
      join(ort, "ort.wasm.bundle.min.mjs"),
      join(ort, "ort-wasm-simd-threaded.wasm"),
      join(MODEL_DIR, MODEL.modelFile.path),
      join(MODEL_DIR, MODEL.tokenizer.path),
    ];
    const sizes = files.map((path) => gzipSync(readFileSync(path), { level: 9 }).byteLength);
    const total = sizes.reduce((a, b) => a + b, 0);
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    console.log(
      `kit with model: ${mb(total)} compressed (model ${mb(sizes.at(-2)!)}, ONNX Runtime ${mb(sizes.at(-3)! + sizes.at(-4)!)})`,
    );
    expect(total).toBeLessThan(60 * 1024 * 1024);
  });
});

// Queries `conformance/embedding/cases.json` does not hold (`embedding-edge-cases.json`): the
// tokenizer's special tokens written as text, combining marks, Hangul jamo, supplementary-plane
// ideographs, ZWJ sequences, odd white space, NUL, very long words and the 256-token boundary.
interface EdgeCase {
  query: string;
  ids: number[];
  bits: string;
}
const ALL = JSON.parse(readFileSync(new URL("./embedding-edge-cases.json", import.meta.url), "utf8")) as EdgeCase[];
/** The special tokens written as text: the pinned tokenizer reads each as one token (own tests). */
const SPECIAL = ALL.find((c) => c.query.startsWith("[CLS]"))!;
const EDGE_CASES = ALL.filter((c) => c !== SPECIAL);

const label = (q: string): string => JSON.stringify(q).slice(0, 50);

describe("the tokenizer on queries outside the conformance cases (section 6)", () => {
  it("gives the builder's token ids for every edge case", () => {
    const wrong: string[] = [];
    for (const c of EDGE_CASES) {
      const ids = tokenizer.encode(queryText(c.query), MAX_TOKENS);
      if (JSON.stringify(ids) !== JSON.stringify(c.ids)) wrong.push(`${label(c.query)}: ${ids.length} vs ${c.ids.length} ids`);
    }
    expect(wrong).toEqual([]);
  });

  it("reads the special tokens [CLS] [SEP] [UNK] [MASK] [PAD] written in a query as the pinned tokenizer.json does (one token each)", () => {
    // tokenizer.json lists them as added special tokens, so the builder's tokenizer gives
    // 9 prefix tokens + 5 + [SEP] = 15 ids, not the pieces of "[", "cls", "]", …
    expect(SPECIAL.ids).toHaveLength(15);
    expect(tokenizer.encode(queryText(SPECIAL.query), MAX_TOKENS)).toEqual(SPECIAL.ids);
  });

  it("embeds a query holding special-token text with a vector agreeing in sign with the builder's on 98 % of the dimensions", async () => {
    const v = await embedder.embedQuery(SPECIAL.query);
    const builder = hexBytes(SPECIAL.bits);
    let agree = 0;
    for (let i = 0; i < DIMENSIONS; i++) if (v[i]! > 0 === bitOf(builder, i)) agree += 1;
    expect(agree / DIMENSIONS).toBeGreaterThanOrEqual(0.98);
  });

  it("truncates at 256 tokens, special tokens included: 255 stays, 256 stays, more is cut to 256 ending in [SEP]", () => {
    const lengths = EDGE_CASES.filter((c) => c.query.startsWith("word word")).map((c) => c.ids.length);
    expect(lengths).toEqual([255, 256, 256]);
    for (const c of EDGE_CASES.filter((c) => c.ids.length === MAX_TOKENS)) {
      const ids = tokenizer.encode(queryText(c.query), MAX_TOKENS);
      expect(ids).toHaveLength(MAX_TOKENS);
      expect(ids[0]).toBe(101);
      expect(ids[MAX_TOKENS - 1]).toBe(102);
    }
  });
});

describe("the query embedder on queries outside the conformance cases (section 6)", () => {
  it("gives a finite vector of 384 dimensions with Euclidean norm 1 for every edge case, including NUL and white space only", async () => {
    for (const c of EDGE_CASES) {
      const v = await embedder.embedQuery(c.query);
      expect(v, label(c.query)).toHaveLength(DIMENSIONS);
      expect(v.every(Number.isFinite), label(c.query)).toBe(true);
      expect(Math.hypot(...v), label(c.query)).toBeCloseTo(1, 4);
    }
  });

  it("agrees in sign with the builder's vector on at least 98 % of the dimensions over the edge cases", async () => {
    let differing = 0;
    let worst = 1;
    for (const c of EDGE_CASES) {
      const v = await embedder.embedQuery(c.query);
      const builder = hexBytes(c.bits);
      let agree = 0;
      for (let i = 0; i < DIMENSIONS; i++) if (v[i]! > 0 === bitOf(builder, i)) agree += 1;
      differing += DIMENSIONS - agree;
      worst = Math.min(worst, agree / DIMENSIONS);
    }
    const total = EDGE_CASES.length * DIMENSIONS;
    console.log(`edge cases: ${EDGE_CASES.length} texts, ${differing} of ${total} differ (${((100 * differing) / total).toFixed(2)} %), worst ${(100 * worst).toFixed(2)} % agree`);
    expect(1 - differing / total).toBeGreaterThanOrEqual(0.98);
    expect(worst).toBeGreaterThanOrEqual(0.95);
  });

  it("answers concurrent embeddings each with its own query's vector", async () => {
    const queries = EDGE_CASES.slice(0, 8).map((c) => c.query);
    const alone: Float32Array[] = [];
    for (const q of queries) alone.push(Float32Array.from(await embedder.embedQuery(q)));
    const together = await Promise.all(queries.map((q) => embedder.embedQuery(q)));
    together.forEach((v, i) => expect([...v], label(queries[i]!)).toEqual([...alone[i]!]));
  });

  it("scores a stored vector made from the same text higher than other texts' vectors (cosine near 1 against sign bits)", async () => {
    const own = EDGE_CASES.find((c) => c.query === "x-ray co-operate don't e.g. 3.14 a/b")!;
    const v = await embedder.embedQuery(own.query);
    const ownScore = score(v, hexBytes(own.bits));
    for (const other of EDGE_CASES.filter((c) => c !== own && c.query.length > 3)) {
      expect(ownScore, label(other.query)).toBeGreaterThan(score(v, hexBytes(other.bits)));
    }
  });
});

describe("find with the real model on stored builder vectors (sections 6, 8.5)", () => {
  it("lists the node whose vector the builder made from the query's own text first, tagged vector, whichever the id order", async () => {
    const picks = EDGE_CASES.filter((c) => c.query.length > 3 && c.query.length < 60 && !c.query.includes("\0"));
    const nodes = picks.slice(0, 8).map((c, i) => ({ type: "Item", key: `n${7 - i}`, label: `node ${i}` }));
    const vectors = Object.fromEntries(picks.slice(0, 8).map((c, i) => [`Item:n${7 - i}`, hexBytes(c.bits)]));
    const file = await openFile(buildMosaic({ nodes, vectors }), "own.mosaic", { embedder });
    expect(file.vectorSearch).toBe(true);
    for (const [i, c] of picks.slice(0, 8).entries()) {
      const answer = await file.find({ query: c.query });
      if (!("data" in answer)) throw new Error(JSON.stringify(answer));
      // A query made only of punctuation has no words: nothing is searched.
      const hasWords = /[\p{L}\p{N}]/u.test(c.query);
      if (!hasWords) continue;
      expect(answer.data.results[0], label(c.query)).toMatchObject({ id: `Item:n${7 - i}`, match: "vector" });
    }
    file.close();
  });

  it("a mosaic whose embed_model is the kit's name with another file hash is not vector-searched", async () => {
    const other = `${MODEL.name}@${"0".repeat(64)}`;
    const file = await openFile(
      buildMosaic({ nodes: [{ type: "Item", key: "a" }], vectors: { "Item:a": hexBytes(EDGE_CASES[2]!.bits) }, embedModel: other }),
      "other.mosaic",
      { embedder },
    );
    expect(EMBED_MODEL).not.toBe(other);
    expect(file.vectorSearch).toBe(false);
    file.close();
  });
});
