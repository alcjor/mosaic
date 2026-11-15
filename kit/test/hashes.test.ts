// Section 3.8 step 3: the kit recomputes the knowledge hash (3.6) and the vector hash (3.7) on
// every open and refuses the file on a mismatch, naming the hash that differs.
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FileRefusedError, encodeKnowledge, knowledgeHash, openFile, vectorHash } from "../src/index.js";

const conformance = (path: string): string =>
  fileURLToPath(new URL(`../../conformance/${path}`, import.meta.url));

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(conformance(path)));

interface Hashes {
  opens: boolean;
  knowledge_hash: string;
  vector_hash: string | null;
}

/** What `mosaic_format` computes for every file that reaches step 3 (scripts/make_reading_files.py). */
const HASHES = JSON.parse(readFileSync(conformance("reading/hashes.json"), "utf8")) as Record<string, Hashes>;

const sqlite3 = await sqlite3InitModule();

/** `bytes` as a database, read-only, without the reading rules: to compute hashes alone. */
function database(bytes: Uint8Array, writable = false): Database {
  // An in-memory copy cannot be in WAL mode: read a WAL-flagged file as it stands (3.1).
  if (bytes[18] === 2) bytes[18] = 1;
  if (bytes[19] === 2) bytes[19] = 1;
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const flags =
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
    (writable ? sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE : sqlite3.capi.SQLITE_DESERIALIZE_READONLY);
  const rc = sqlite3.capi.sqlite3_deserialize(db, "main", p, bytes.length, bytes.length, flags);
  if (rc !== 0) throw new Error(`deserialize failed: ${rc}`);
  return db;
}

/** A copy of `path` changed by `statements` (constraints off), its header left as it was. */
function changed(path: string, ...statements: string[]): Uint8Array {
  const db = database(read(path), true);
  try {
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.exec("PRAGMA foreign_keys = OFF");
    for (const sql of statements) db.exec(sql);
    return sqlite3.capi.sqlite3_js_db_export(db);
  } finally {
    db.close();
  }
}

async function refusal(bytes: Uint8Array, name: string): Promise<FileRefusedError> {
  try {
    (await openFile(bytes, name)).close();
  } catch (e) {
    expect(e).toBeInstanceOf(FileRefusedError);
    return e as FileRefusedError;
  }
  throw new Error(`${name} opened, but it must be refused`);
}

describe("conformance/reading/hashes.json: the kit's hashes are those of mosaic_format (3.6, 3.7)", () => {
  const keys = Object.keys(HASHES).sort();

  it("covers the valid files of conformance/ and the files refused for a hash", () => {
    expect(keys).toContain("reading/mosaic.mosaic");
    expect(keys).toContain("reading/tessera.tessera");
    expect(keys).toContain("reading/non-ascii.mosaic");
    expect(keys).toContain("invalid/files/inv-15-piece.tessera");
    expect(keys.filter((k) => !HASHES[k]!.opens).length).toBeGreaterThanOrEqual(7);
  });

  for (const key of keys) {
    const expected = HASHES[key]!;

    it(`computes the knowledge and vector hash of ${key} as mosaic_format does`, () => {
      const db = database(read(key));
      try {
        expect(knowledgeHash(db)).toBe(expected.knowledge_hash);
        expect(vectorHash(db)).toBe(expected.vector_hash);
      } finally {
        db.close();
      }
    });

    if (expected.opens) {
      it(`opens ${key}, whose header holds the hashes its content gives`, async () => {
        const file = await openFile(read(key), key);
        try {
          expect(file.header.knowledge_hash).toBe(expected.knowledge_hash);
          expect(file.header.vector_hash).toBe(expected.vector_hash);
        } finally {
          file.close();
        }
      });
    } else {
      it(`refuses ${key}, naming the hash that differs and both values`, async () => {
        const db = database(read(key));
        const header = db.selectObject("SELECT knowledge_hash, vector_hash FROM header") as Record<string, unknown>;
        db.close();
        const error = await refusal(read(key), key);
        if (header.knowledge_hash !== expected.knowledge_hash) {
          expect(error.rule).toBe("knowledge_hash");
          expect(error.message).toContain("knowledge hash mismatch");
          expect(error.message).toContain(String(header.knowledge_hash));
          expect(error.message).toContain(expected.knowledge_hash);
        } else {
          expect(error.rule).toBe("vector_hash");
          expect(error.message).toContain("vector hash mismatch");
          expect(error.message).toContain(String(header.vector_hash));
          expect(error.message).toContain(String(expected.vector_hash));
        }
      });
    }
  }
});

describe("one changed row is refused on open, naming the hash that differs (3.8 step 3)", () => {
  const MOSAIC = "reading/mosaic.mosaic";
  const TESSERA = "reading/tessera.tessera";
  const knowledge: Record<string, [string, string]> = {
    "the format version's kind": [TESSERA, "UPDATE header SET kind = 'mosaic'"],
    "a source": [MOSAIC, "UPDATE source SET notice = 'changed' WHERE sid = 1"],
    "a type": [MOSAIC, "UPDATE type SET description = 'changed' WHERE name = 'Item'"],
    "a node": [MOSAIC, "UPDATE node SET summary = 'changed' WHERE nid = 1"],
    "a node's id": [MOSAIC, "UPDATE node SET id = 'Item:aa' WHERE nid = 1"],
    "an edge": [MOSAIC, "UPDATE edge SET qualifier = 'q' WHERE eid = 2"],
    "an alias": [MOSAIC, "UPDATE alias SET origin = 'pattern' WHERE text = 'A'"],
    "an evidence row": [MOSAIC, "UPDATE evidence SET producer = 'other/1' WHERE evid = 1"],
    "a confidence, past the sixth decimal": [MOSAIC, "UPDATE evidence SET confidence = 0.500001 WHERE confidence IS NOT NULL"],
    "a snippet": [MOSAIC, "UPDATE snippet SET text = 'changed' WHERE evid = 1"],
    "a mention": [TESSERA, "UPDATE mention SET locator = 'row=9' WHERE mid = 1"],
    "an external reference": [MOSAIC, "UPDATE external_ref SET system = 'other' WHERE xid = 1"],
    "a removed node row": [MOSAIC, "DELETE FROM node WHERE nid = 3"],
    "an added alias": [MOSAIC, "INSERT INTO alias (text, nid, origin) VALUES ('extra', 1, 'source')"],
  };
  for (const [what, [path, sql]] of Object.entries(knowledge)) {
    it(`refuses ${what} for knowledge_hash`, async () => {
      const error = await refusal(changed(path, sql), "changed.mosaic");
      expect(error.rule).toBe("knowledge_hash");
      expect(error.message).toMatch(/^changed\.mosaic: knowledge hash mismatch: the header says '[0-9a-f]{64}', the content gives '[0-9a-f]{64}'/);
    });
  }

  it("opens a confidence changed below the sixth decimal, which the hash rounds away (3.6)", async () => {
    const bytes = changed(MOSAIC, "UPDATE evidence SET confidence = 0.5000001 WHERE confidence IS NOT NULL");
    (await openFile(bytes, "rounded.mosaic")).close();
  });

  const vector: Record<string, string> = {
    "a changed vector": "UPDATE vector SET bits = zeroblob(48) WHERE nid = 2",
    "a removed vector": "DELETE FROM vector WHERE nid = 3",
    "two vectors swapped":
      "CREATE TEMP TABLE old AS SELECT nid, bits FROM vector; " +
      "UPDATE vector SET bits = (SELECT bits FROM old WHERE old.nid = 3 - vector.nid) WHERE nid IN (1, 2)",
    "every vector removed": "DELETE FROM vector",
  };
  for (const [what, sql] of Object.entries(vector)) {
    it(`refuses ${what} for vector_hash`, async () => {
      const error = await refusal(changed(MOSAIC, sql), "changed.mosaic");
      expect(error.rule).toBe("vector_hash");
      expect(error.message).toContain("vector hash mismatch: the header says '");
    });
  }

  it("refuses a vector that is not a 48-byte blob, naming its node", async () => {
    const error = await refusal(changed(MOSAIC, "UPDATE vector SET bits = zeroblob(47) WHERE nid = 1"), "short.mosaic");
    expect(error.rule).toBe("vector_hash");
    expect(error.message).toContain("'Group:x'");
    expect(error.message).toContain("48-byte blob");
  });

  it("refuses a value the knowledge hash cannot encode: a REAL outside confidence", async () => {
    const error = await refusal(changed(MOSAIC, "UPDATE alias SET nid = 1.5 WHERE text = 'A'"), "real.mosaic");
    expect(error.rule).toBe("knowledge_hash");
    expect(error.message).toContain("part 'alias', row 1 in canonical order, column 'nid'");
  });

  it("refuses a value the knowledge hash cannot encode: a confidence that is not REAL", async () => {
    const bytes = changed(MOSAIC, "UPDATE evidence SET confidence = 'high' WHERE confidence IS NOT NULL");
    const error = await refusal(bytes, "text.mosaic");
    expect(error.rule).toBe("knowledge_hash");
    expect(error.message).toContain("column 'confidence'");
  });
});

describe("canonical order compares text by UTF-8 bytes (3.6)", () => {
  // U+FF5E is EF BD 9E in UTF-8 and FF5E in UTF-16; U+1F600 is F0 9F 98 80 and D83D DE00.
  const [tilde, emoji] = ["～", "\u{1F600}"];

  it("non-ascii.mosaic holds ids, keys and aliases that sort the other way by UTF-16", () => {
    expect(tilde < emoji).toBe(false);
    const db = database(read("reading/non-ascii.mosaic"));
    try {
      const ids = db.selectValues("SELECT id FROM node WHERE key IN (?, ?) ORDER BY nid", [tilde, emoji]);
      expect(ids).toEqual([`Item:${tilde}`, `Item:${emoji}`]);
      expect(db.selectValues("SELECT text FROM alias WHERE nid > 3 ORDER BY text COLLATE NOCASE, nid")).toEqual([tilde, emoji]);
    } finally {
      db.close();
    }
  });

  it("gives the header's hash for that file, and another once its two aliases trade nodes", async () => {
    const file = await openFile(read("reading/non-ascii.mosaic"), "non-ascii.mosaic");
    file.close();
    const swapped = changed(
      "reading/non-ascii.mosaic",
      "UPDATE alias SET nid = CASE nid WHEN 4 THEN 5 ELSE 4 END WHERE nid IN (4, 5)",
    );
    expect((await refusal(swapped, "swapped.mosaic")).rule).toBe("knowledge_hash");
  });

  it("writes the alias part in UTF-8 byte order, as SHA-256 over those bytes gives the header's hash", () => {
    const db = database(read("reading/non-ascii.mosaic"));
    try {
      const chunks: Uint8Array[] = [];
      encodeKnowledge(db, (bytes) => chunks.push(bytes.slice()));
      const text = Buffer.concat(chunks).toString("utf8");
      expect(text).toContain(`'${tilde}',4,'source'\n'${emoji}',5,'source'\n`);
      expect(text).toContain(`,'Item:${tilde}','Item','${tilde}',`);
      expect(text.indexOf(`'Item:${tilde}'`)).toBeLessThan(text.indexOf(`'Item:${emoji}'`));
      const header = db.selectValue("SELECT knowledge_hash FROM header");
      expect(createHash("sha256").update(Buffer.concat(chunks)).digest("hex")).toBe(header);
    } finally {
      db.close();
    }
  });
});

const sha256 = (...chunks: Uint8Array[]): string => {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return h.digest("hex");
};

const MOSAIC = "reading/mosaic.mosaic";
const TESSERA = "reading/tessera.tessera";
/** A writable copy of `path`, constraints off, changed by `statements`. The caller closes it. */
function edit(path: string, ...statements: string[]): Database {
  const db = database(read(path), true);
  db.exec("PRAGMA ignore_check_constraints = ON");
  db.exec("PRAGMA foreign_keys = OFF");
  for (const sql of statements) db.exec(sql);
  return db;
}

/** The oracle: section 3.6, column by column, as SQL. */
const PARTS: [string, string[], string][] = [
  ["header", ["format_version", "kind"], "one"],
  ["source", ["sid", "id", "kind", "hash", "notice"], "sid"],
  ["type", ["name", "kind", "description", "key_prop", "from_type", "to_type", "props"], "name"],
  ["node", ["nid", "id", "type", "key", "label", "summary", "props"], "nid"],
  ["edge", ["eid", "type", "src", "dst", "qualifier", "props"], "eid"],
  ["alias", ["text", "nid", "origin"], "text, nid"],
  [
    "evidence",
    ["evid", "nid", "eid", "prop", "sid", "locator", "method", "producer", "confidence", "via"],
    "evid",
  ],
  ["snippet", ["evid", "text"], "evid"],
  ["mention", ["mid", "text", "locator", "nid", "role", "kind"], "mid"],
  ["source_text", ["sid", "text"], "sid"],
  ["external_ref", ["xid", "nid", "system", "kind", "locator", "sid"], "xid"],
];

function oracleBytes(db: Database): Buffer {
  const out: Buffer[] = [];
  for (const [table, columns, order] of PARTS) {
    out.push(Buffer.from(`#${table}\n`));
    const quoted = columns
      .map((c) => `quote(${c === "confidence" ? "CAST(round(confidence*1000000) AS INTEGER)" : c})`)
      .join("||','||");
    const rows = db.selectValues(`SELECT CAST(${quoted}||char(10) AS BLOB) FROM ${table} ORDER BY ${order}`);
    for (const row of rows) out.push(Buffer.from(row as Uint8Array));
  }
  return Buffer.concat(out);
}

const oracleKnowledge = (db: Database): string => sha256(oracleBytes(db));

function oracleVector(db: Database): string | null {
  const rows = db.selectValues("SELECT bits FROM vector ORDER BY nid") as Uint8Array[];
  return rows.length === 0 ? null : sha256(...rows);
}

/** `db` exported with its header hashes rewritten to what the content gives. */
function sealedBytes(db: Database): Uint8Array {
  db.exec({ sql: "UPDATE header SET knowledge_hash = ?", bind: [oracleKnowledge(db)] });
  const v = oracleVector(db);
  if (v !== null) db.exec({ sql: "UPDATE header SET vector_hash = ?", bind: [v] });
  return sqlite3.capi.sqlite3_js_db_export(db);
}

/** `path` changed by `statements`, then resealed: the file is intact for any reader of 3.6. */
function resealed(path: string, ...statements: string[]): Uint8Array {
  const db = edit(path, ...statements);
  try {
    return sealedBytes(db);
  } finally {
    db.close();
  }
}

/** Opens `bytes`, which must pass; the kit's header hash must be what the oracle gives. */
async function opensWithOracleHash(bytes: Uint8Array, name: string): Promise<void> {
  const db = database(bytes);
  const expected = oracleKnowledge(db);
  db.close();
  const file = await openFile(bytes, name);
  try {
    expect(file.header.knowledge_hash).toBe(expected);
  } finally {
    file.close();
  }
}

describe("the kit's hashes are those of section 3.6 and 3.7 written out in SQL", () => {
  const HASHES = JSON.parse(readFileSync(conformance("reading/hashes.json"), "utf8")) as Record<string, unknown>;
  for (const key of Object.keys(HASHES).sort()) {
    it(`gives for ${key} the oracle's knowledge hash and vector hash`, () => {
      const db = database(read(key));
      try {
        expect(knowledgeHash(db)).toBe(oracleKnowledge(db));
        expect(vectorHash(db)).toBe(oracleVector(db));
      } finally {
        db.close();
      }
    });
  }

  for (const path of [MOSAIC, TESSERA, "reading/non-ascii.mosaic"]) {
    it(`encodes ${path} to the oracle's bytes, whatever the chunking`, () => {
      const db = database(read(path));
      try {
        const chunks: Uint8Array[] = [];
        encodeKnowledge(db, (bytes) => chunks.push(bytes.slice()));
        expect(Buffer.concat(chunks).equals(oracleBytes(db))).toBe(true);
      } finally {
        db.close();
      }
    });
  }
});

describe("the knowledge hash encodes each value as quote() does (3.6)", () => {
  const cases: Record<string, string[]> = {
    "single quotes doubled": ["UPDATE node SET label = 'it''s ''quoted'''  WHERE nid = 1"],
    "a quote alone": ["UPDATE node SET label = '''' WHERE nid = 1"],
    "newlines, CRLF and commas in text": ["UPDATE node SET summary = 'a,b' || char(10) || 'c' || char(13) || char(10) || ',' WHERE nid = 1"],
    "text that looks like a part marker": ["UPDATE node SET summary = char(10) || '#node' || char(10) || '1,''x''' WHERE nid = 1"],
    "the text NULL, which is not NULL": ["UPDATE node SET summary = 'NULL' WHERE nid = 1"],
    "the empty string, which is not NULL": ["UPDATE node SET summary = '' WHERE nid = 1"],
    "a snippet with quotes and newlines": ["UPDATE snippet SET text = 'a''b' || char(10) || 'c' WHERE evid = 1"],
    "a notice with non-ASCII text": ["UPDATE source SET notice = 'Ünïcödé ～ \u{1F600} é' WHERE sid = 1"],
    "NFC and NFD forms of one letter as two keys": [
      "UPDATE node SET key = char(233), id = 'Item:' || char(233) WHERE nid = 1",
      "UPDATE node SET key = 'e' || char(769), id = 'Item:e' || char(769) WHERE nid = 2",
    ],
    "a blob in a text column": ["UPDATE node SET summary = X'00ff41' WHERE nid = 1"],
    "an uppercase and lowercase hex blob": ["UPDATE node SET label = X'abCDef' WHERE nid = 1"],
    "an empty blob": ["UPDATE node SET label = X'' WHERE nid = 1"],
    "a 4 MB text": ["UPDATE node SET summary = replace(hex(zeroblob(1000000)), '0', char(233)) WHERE nid = 1"],
    "integers past 2^53": ["UPDATE alias SET nid = 9007199254740993 WHERE text = 'A'"],
    "the largest 64-bit integer": ["UPDATE alias SET nid = 9223372036854775807 WHERE text = 'A'"],
    "the smallest 64-bit integer": ["UPDATE alias SET nid = -9223372036854775808 WHERE text = 'A'"],
    "a negative integer": ["UPDATE alias SET nid = -7 WHERE text = 'A'"],
    "an empty graph: every table but the header empty": PARTS.slice(1)
      .map(([t]) => `DELETE FROM ${t}`),
  };
  for (const [what, statements] of Object.entries(cases)) {
    it(`gives the oracle's hash for ${what}`, () => {
      const db = edit(MOSAIC, ...statements);
      try {
        expect(knowledgeHash(db)).toBe(oracleKnowledge(db));
      } finally {
        db.close();
      }
    });

    it(`opens ${what} once the header holds that hash`, async () => {
      await opensWithOracleHash(resealed(MOSAIC, ...statements), "awkward.mosaic");
    });
  }

  it("tells NULL, 'NULL', '' and a blob apart", () => {
    const hash = (sql: string): string => {
      const db = edit(MOSAIC, sql);
      try {
        return knowledgeHash(db);
      } finally {
        db.close();
      }
    };
    const hashes = [
      hash("UPDATE node SET summary = NULL WHERE nid = 1"),
      hash("UPDATE node SET summary = 'NULL' WHERE nid = 1"),
      hash("UPDATE node SET summary = '' WHERE nid = 1"),
      hash("UPDATE node SET summary = X'' WHERE nid = 1"),
      hash("UPDATE node SET summary = '0' WHERE nid = 1"),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("hashes an empty graph to the header part and ten empty parts, written out by hand", () => {
    const db = edit(TESSERA, ...PARTS.slice(1).map(([t]) => `DELETE FROM ${t}`));
    try {
      const expected =
        "#header\n'0.1','tessera'\n#source\n#type\n#node\n#edge\n#alias\n#evidence\n#snippet\n" +
        "#mention\n#source_text\n#external_ref\n";
      expect(knowledgeHash(db)).toBe(sha256(Buffer.from(expected)));
      expect(vectorHash(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("orders aliases by their NOCASE collation, then nid, not by bytes (3.6)", () => {
    // NOCASE folds ASCII only: '_' (5F) sorts before 'a' (61) and 'Z' folds to 'z'; é and É differ.
    const statements = ["DELETE FROM alias"];
    const rows: [string, number][] = [
      ["Z", 1], ["_", 2], ["a", 3], ["B", 2], ["b", 1], ["A", 2], ["É", 1], ["é", 2], ["z", 3], ["~", 1],
    ];
    for (const [text, nid] of rows) statements.push(`INSERT INTO alias (text, nid, origin) VALUES ('${text}', ${nid}, 'source')`);
    const db = edit(MOSAIC, ...statements);
    try {
      expect(knowledgeHash(db)).toBe(oracleKnowledge(db));
      const chunks: Uint8Array[] = [];
      encodeKnowledge(db, (b) => chunks.push(b.slice()));
      const text = Buffer.concat(chunks).toString("utf8");
      const alias = text.slice(text.indexOf("#alias\n"), text.indexOf("#evidence\n"));
      expect(alias).toBe(
        "#alias\n'_',2,'source'\n'A',2,'source'\n'a',3,'source'\n'b',1,'source'\n'B',2,'source'\n" +
          "'Z',1,'source'\n'z',3,'source'\n'~',1,'source'\n'É',1,'source'\n'é',2,'source'\n",
      );
    } finally {
      db.close();
    }
  });

  it("encodes confidence as the integer round(confidence*1000000), half away from zero (3.6)", () => {
    const values = [
      "0", "1", "0.5", "0.0000004999999", "0.0000005", "0.0000015", "0.1234565", "0.285", "0.9999995",
      "0.9999994999", "0.3333335", "0.7000005", "1e-7", "0.1", "0.2", "0.3", "0.000001", "0.0000025",
    ];
    let seed = 12345;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push(`${(seed % 10000000) / 10000000}`);
    }
    const statements = values.map(
      (v, i) =>
        `INSERT INTO evidence (nid, eid, prop, sid, locator, method, producer, confidence, via) ` +
        `VALUES (1, NULL, NULL, 1, 'row=${i + 100}', 'inferred', 'p/1', ${v}, NULL)`,
    );
    const db = edit(MOSAIC, ...statements);
    try {
      expect(knowledgeHash(db)).toBe(oracleKnowledge(db));
    } finally {
      db.close();
    }
  });

  it("encodes confidence 0.0000005 as 1 and 0.0000004999999 as 0", () => {
    const db = edit(
      MOSAIC,
      "DELETE FROM evidence WHERE nid IS NOT 1 OR evid > 1",
      "DELETE FROM snippet WHERE evid > 1",
      "UPDATE evidence SET method = 'inferred', confidence = 0.0000005 WHERE evid = 1",
    );
    try {
      const chunks: Uint8Array[] = [];
      encodeKnowledge(db, (b) => chunks.push(b.slice()));
      const text = Buffer.concat(chunks).toString("utf8");
      const row = text.split("\n").find((l, i, all) => all[i - 1]?.startsWith("#evidence"));
      expect(row).toMatch(/,'inferred','[^']*',1,/);
    } finally {
      db.close();
    }
  });
});

describe("text that is not valid UTF-8 is untrusted data (3.8 step 4) and still hashes by its bytes (3.6)", () => {
  const bad: Record<string, string> = {
    "a lone continuation byte": "X'41808243'",
    "a truncated sequence": "X'41E282'",
    "an overlong NUL": "X'41C080'",
    "an encoded surrogate": "X'41EDA080'",
    "a byte past U+10FFFF": "X'41F4908080'",
  };
  for (const [what, hex] of Object.entries(bad)) {
    it(`gives the bytes' hash or refuses the file: ${what}`, async () => {
      const db = edit(MOSAIC, `UPDATE node SET summary = CAST(${hex} AS TEXT) WHERE nid = 1`);
      try {
        const expected = oracleKnowledge(db);
        let got: string | undefined;
        try {
          got = knowledgeHash(db);
        } catch {
          // Refusing is allowed; a different hash from the bytes' is not.
        }
        if (got !== undefined) expect(got).toBe(expected);
        const bytes = sealedBytes(db);
        try {
          const file = await openFile(bytes, "bad-utf8.mosaic");
          file.close();
        } catch (e) {
          expect(e).toBeInstanceOf(FileRefusedError);
        }
      } finally {
        db.close();
      }
    });
  }
});

describe("the vector hash is SHA-256 of the bits in nid order (3.7)", () => {
  it("covers bytes of every value, high bytes included", () => {
    const hex = Array.from({ length: 48 }, (_, i) => ((i * 37 + 128) & 255).toString(16).padStart(2, "0")).join("");
    const db = edit(MOSAIC, `UPDATE vector SET bits = X'${hex}' WHERE nid = 1`);
    try {
      const rows = db.selectValues("SELECT bits FROM vector ORDER BY nid") as Uint8Array[];
      expect(vectorHash(db)).toBe(sha256(...rows));
    } finally {
      db.close();
    }
  });

  it("follows nid, not the order the rows were written in", () => {
    const db = edit(
      MOSAIC,
      "CREATE TEMP TABLE keep AS SELECT nid, bits FROM vector",
      "DELETE FROM vector",
      "INSERT INTO vector (nid, bits) SELECT nid, bits FROM keep ORDER BY nid DESC",
    );
    try {
      const ordered = db.selectValues("SELECT bits FROM keep ORDER BY nid") as Uint8Array[];
      expect(vectorHash(db)).toBe(sha256(...ordered));
    } finally {
      db.close();
    }
  });

  it("is of the bits concatenated, not of their hex or of one hash per vector", () => {
    const db = database(read(MOSAIC));
    try {
      const rows = db.selectValues("SELECT bits FROM vector ORDER BY nid") as Uint8Array[];
      const joined = sha256(Buffer.concat(rows));
      expect(vectorHash(db)).toBe(joined);
      expect(vectorHash(db)).not.toBe(sha256(Buffer.from(rows.map((r) => Buffer.from(r).toString("hex")).join(""))));
    } finally {
      db.close();
    }
  });

  it("is null for a file with no vectors", () => {
    const db = database(read(TESSERA));
    try {
      expect(vectorHash(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("opens vectors rewritten and resealed, with the header's new vector hash", async () => {
    const bytes = resealed(MOSAIC, `UPDATE vector SET bits = X'${"0f".repeat(48)}' WHERE nid = 2`);
    const file = await openFile(bytes, "vectors.mosaic");
    try {
      expect(file.header.vector_hash).toBe(
        sha256(
          ...[1, 2, 3].map((n) => {
            const db = database(bytes);
            try {
              return db.selectValue("SELECT bits FROM vector WHERE nid = ?", [n]) as Uint8Array;
            } finally {
              db.close();
            }
          }),
        ),
      );
    } finally {
      file.close();
    }
  });
});

describe("a changed or added row is refused on open, whichever table it is in (3.8 step 3)", () => {
  const changes: Record<string, [string, string]> = {
    "an added source_text row": [TESSERA, "INSERT INTO source_text (sid, text) VALUES (1, 'whole text')"],
    "a node's label made NULL": [MOSAIC, "UPDATE node SET label = NULL WHERE nid = 1"],
    "a node's summary NULL made empty": [MOSAIC, "UPDATE node SET summary = '' WHERE summary IS NULL"],
    "a trailing space in a label": [MOSAIC, "UPDATE node SET label = label || ' ' WHERE nid = 1"],
    "an evidence via": [MOSAIC, "UPDATE evidence SET via = '[]' WHERE evid = 1"],
  };
  for (const [what, [path, sql]] of Object.entries(changes)) {
    it(`refuses ${what} for knowledge_hash, with both hashes in the message`, async () => {
      const db = edit(path, sql);
      const changedRows = db.selectValue("SELECT changes()") as number;
      const bytes = sqlite3.capi.sqlite3_js_db_export(db);
      db.close();
      // A statement that matches no row changes nothing: skip nothing silently, fail the test.
      expect(changedRows).toBeGreaterThan(0);
      const error = await refusal(bytes, "changed.mosaic");
      expect(error.rule).toBe("knowledge_hash");
      expect(error.message).toMatch(/[0-9a-f]{64}.*[0-9a-f]{64}/);
    });
  }

  it("opens a file whose header says producer, settings or target are something else: they are not hashed", async () => {
    const bytes = resealed(MOSAIC, "UPDATE header SET producer = 'other/9', target = 'elsewhere'");
    (await openFile(bytes, "producer.mosaic")).close();
    const unsealed = edit(MOSAIC, "UPDATE header SET producer = 'other/9'");
    const raw = sqlite3.capi.sqlite3_js_db_export(unsealed);
    unsealed.close();
    (await openFile(raw, "producer-only.mosaic")).close();
  });
});

describe("only the header's own hashes decide, written exactly (3.3, 3.8 step 3)", () => {
  const wrong = "0".repeat(64);
  const header = (sql: string, path = MOSAIC): Uint8Array => {
    const db = edit(path, sql);
    try {
      return sqlite3.capi.sqlite3_js_db_export(db);
    } finally {
      db.close();
    }
  };

  it("refuses the right hash in capital letters: the header holds lowercase hex", async () => {
    const db = database(read(MOSAIC));
    const right = db.selectValue("SELECT knowledge_hash FROM header") as string;
    db.close();
    const error = await refusal(header(`UPDATE header SET knowledge_hash = '${right.toUpperCase()}'`), "caps.mosaic");
    expect(error.rule).toBe("knowledge_hash");
  });

  it("refuses the right hash with a trailing space or newline", async () => {
    for (const tail of [" ", "\n"]) {
      const db = database(read(MOSAIC));
      const right = db.selectValue("SELECT knowledge_hash FROM header") as string;
      db.close();
      const bytes = header(`UPDATE header SET knowledge_hash = '${right}${tail === "\n" ? "' || char(10) || '" : tail}'`);
      const error = await refusal(bytes, "tail.mosaic");
      expect(error.rule).toBe("knowledge_hash");
    }
  });

  it("refuses vectors beside a NULL header vector hash, and a vector hash beside no vectors", async () => {
    const withVectors = await refusal(
      header("INSERT INTO vector (nid, bits) VALUES (1, zeroblob(48))", TESSERA),
      "v.tessera",
    );
    expect(withVectors.rule).toBe("vector_hash");
    const noVectors = await refusal(header("DELETE FROM vector"), "none.mosaic");
    expect(noVectors.rule).toBe("vector_hash");
  });

  it("opens the file and leaves a changed derived table and search index unread (3.6: not hashed)", async () => {
    const bytes = header("DELETE FROM link_count");
    (await openFile(bytes, "derived.mosaic")).close();
  });
});

describe("a 10,000-node mosaic: the kit's hash matches the oracle and opens in under 3 s (ADR-007)", () => {
  it("hashes 12,000 nodes, their evidence and vectors, as the oracle does", async () => {
    const db = edit(
      MOSAIC,
      `INSERT INTO node (nid, id, type, key, label, summary, props)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12000)
         SELECT 1000 + i, 'Item:z' || printf('%05d', i), 'Item', 'z' || printf('%05d', i),
                'Label ' || i, 'Summary of ' || i || ' ～ \u{1F600}', NULL FROM n`,
      `INSERT INTO vector (nid, bits)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12000)
         SELECT 1000 + i, randomblob(48) FROM n`,
      `INSERT INTO evidence (nid, eid, prop, sid, locator, method, producer, confidence, via)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12000)
         SELECT 1000 + i, NULL, NULL, 1, 'row=' || i, 'inferred', 'p/1', (i % 1000) / 1000.0, NULL FROM n`,
    );
    const bytes = sealedBytes(db);
    const expected = oracleKnowledge(db);
    const expectedVectors = oracleVector(db);
    db.close();
    const start = performance.now();
    const file = await openFile(bytes, "big.mosaic");
    const ms = performance.now() - start;
    console.log(`open with both hashes, 12,003 nodes, ${(bytes.length / 1048576).toFixed(1)} MB: ${ms.toFixed(0)} ms`);
    try {
      expect(file.header.knowledge_hash).toBe(expected);
      expect(file.header.vector_hash).toBe(expectedVectors);
    } finally {
      file.close();
    }
    expect(ms).toBeLessThan(3000);
  }, 60_000);
});
