import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORMAT_SQL } from "../src/format-sql.js";
import { FileRefusedError, IMPLEMENTED_VERSIONS, REFUSAL_RULES, openFile, type RefusalRule } from "../src/index.js";

const conformance = (path: string): string =>
  fileURLToPath(new URL(`../../conformance/${path}`, import.meta.url));

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(conformance(path)));

interface ReadingCase {
  opens: boolean;
  rule: RefusalRule | null;
  header?: Record<string, unknown>;
}

const CASES = JSON.parse(readFileSync(conformance("reading/cases.json"), "utf8")) as Record<
  string,
  ReadingCase
>;

/** What the error message names for each rule, so a person can tell what failed. */
const NAMES: Record<RefusalRule, string> = {
  sqlite: "SQLite",
  encoding: "text encoding",
  application_id: "application_id",
  user_version: "user_version",
  format_version: "format version",
  schema: "schema",
  header: "header",
  knowledge_hash: "knowledge hash mismatch",
  vector_hash: "vector hash mismatch",
};

async function refusal(bytes: Uint8Array, name: string): Promise<FileRefusedError> {
  try {
    (await openFile(bytes, name)).close();
  } catch (e) {
    expect(e).toBeInstanceOf(FileRefusedError);
    return e as FileRefusedError;
  }
  throw new Error(`${name} opened, but it must be refused`);
}

describe("conformance/reading: the kit opens or refuses each file as cases.json says (3.8)", () => {
  const names = Object.keys(CASES).sort();

  it("covers every refusal rule and both kinds of file", () => {
    const rules = new Set(Object.values(CASES).map((c) => c.rule));
    expect([...rules].filter((r) => r !== null).sort()).toEqual([...REFUSAL_RULES].sort());
    expect(names.filter((n) => CASES[n]!.opens)).toEqual([
      "mosaic.mosaic",
      "non-ascii.mosaic",
      "stat4.mosaic",
      "tessera.tessera",
      "wal.mosaic",
    ]);
  });

  for (const name of names) {
    const c = CASES[name]!;
    if (c.opens) {
      it(`opens ${name} and returns its header (3.3)`, async () => {
        const file = await openFile(read(`reading/${name}`), name);
        try {
          expect(file.name).toBe(name);
          expect({ ...file.header }).toEqual(c.header);
        } finally {
          file.close();
        }
      });
    } else {
      it(`refuses ${name} for ${c.rule}, naming the file and what failed`, async () => {
        const error = await refusal(read(`reading/${name}`), name);
        expect(error.rule).toBe(c.rule);
        expect(error.file).toBe(name);
        expect(error.message.startsWith(`${name}: `)).toBe(true);
        expect(error.message).toContain(NAMES[c.rule!]);
      });
    }
  }
});

describe("conformance/invalid/files: the kit refuses the files that break 3.8 steps 2 and 3", () => {
  const invalid = JSON.parse(readFileSync(conformance("invalid/files/cases.json"), "utf8")) as Record<
    string,
    { rules: string[] }
  >;
  const step2: Record<string, { rule: RefusalRule; checker: string }> = {
    "container.tessera": { rule: "application_id", checker: "container" },
    "inv-1-no-header.tessera": { rule: "header", checker: "inv-1" },
    "inv-1-version.tessera": { rule: "format_version", checker: "inv-1" },
    "inv-6-hash.tessera": { rule: "knowledge_hash", checker: "inv-6" },
    "inv-14-vector-hash.mosaic": { rule: "vector_hash", checker: "inv-14" },
  };

  for (const [name, { rule, checker }] of Object.entries(step2)) {
    it(`refuses ${name} for ${rule}, as mosaic check does (${checker})`, async () => {
      expect(invalid[name]?.rules).toContain(checker);
      const error = await refusal(read(`invalid/files/${name}`), name);
      expect(error.rule).toBe(rule);
    });
  }
});

describe("SQLite header settings that section 3.8 step 2 does not check", () => {
  it("opens a file in WAL mode with no write-ahead log beside it, without changing its bytes", async () => {
    const bytes = read("reading/wal.mosaic");
    expect([bytes[18], bytes[19]]).toEqual([2, 2]);
    const before = bytes.slice();
    const file = await openFile(bytes, "wal.mosaic");
    expect({ ...file.header }).toEqual(CASES["mosaic.mosaic"]!.header);
    file.close();
    expect(bytes).toEqual(before);
  });

  it("refuses a file flagged UTF-16, naming the encoding (3.1", async () => {
    for (const [code, label] of [
      [2, "UTF-16le"],
      [3, "UTF-16be"],
    ] as const) {
      const bytes = read("reading/mosaic.mosaic");
      new DataView(bytes.buffer, bytes.byteOffset).setUint32(56, code);
      const error = await refusal(bytes, "utf16.mosaic");
      expect(error.rule).toBe("encoding");
      expect(error.message).toContain(`text encoding ${label}`);
    }
  });
});

describe("a crafted header (3.8 step 4, section 10)", () => {
  const COLUMNS =
    "format_version, kind, producer, settings, knowledge_hash, vector_hash, embed_model, pattern_hash, target, ai_model";

  /** mosaic.mosaic with `extra` more header rows: CHECK (one = 1) is not enforced on read. */
  async function withHeaderRows(extra: number): Promise<Uint8Array> {
    const s = await sqlite3InitModule();
    const bytes = read("reading/mosaic.mosaic");
    const db = new s.oo1.DB(":memory:", "c");
    try {
      const pointer = s.wasm.allocFromTypedArray(bytes);
      const flags = s.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      expect(s.capi.sqlite3_deserialize(db, "main", pointer, bytes.length, bytes.length, flags)).toBe(0);
      db.exec("PRAGMA ignore_check_constraints = ON");
      db.exec(
        `WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < ${extra + 1}) ` +
          `INSERT INTO header SELECT n.i, ${COLUMNS} FROM n, (SELECT ${COLUMNS} FROM header WHERE one = 1)`,
      );
      expect(db.selectValue("SELECT count(*) FROM header")).toBe(extra + 1);
      return s.capi.sqlite3_js_db_export(db);
    } finally {
      db.close();
    }
  }

  it("refuses a header of 100,000 rows for header, saying it has 2 rows or more", async () => {
    const error = await refusal(await withHeaderRows(99_999), "rows.mosaic");
    expect(error.rule).toBe("header");
    expect(error.message).toContain("header has 2 rows or more");
  });

  it("says a header with no rows has 0 rows", async () => {
    const error = await refusal(read("reading/no-header.mosaic"), "no-header.mosaic");
    expect(error.message).toContain("header has 0 rows");
  });
});

describe("opening is read-only (3.8 step 1)", () => {
  it("leaves the given bytes as they were and opens them again the same way", async () => {
    const bytes = read("reading/mosaic.mosaic");
    const before = bytes.slice();
    const first = await openFile(bytes, "mosaic.mosaic");
    const header = { ...first.header };
    first.close();
    expect(bytes).toEqual(before);
    const second = await openFile(bytes, "mosaic.mosaic");
    expect({ ...second.header }).toEqual(header);
    second.close();
    expect(bytes).toEqual(before);
  });

  it("gives a header that cannot be changed", async () => {
    const file = await openFile(read("reading/tessera.tessera"), "tessera.tessera");
    try {
      expect(Object.isFrozen(file.header)).toBe(true);
    } finally {
      file.close();
    }
  });

  it("keeps its header after it is closed, and closing twice is harmless", async () => {
    const file = await openFile(read("reading/tessera.tessera"), "tessera.tessera");
    file.close();
    expect(file.header.kind).toBe("tessera");
    expect(() => file.close()).not.toThrow();
  });
});

describe("the schema the kit compares against (3.1)", () => {
  const spec = readFileSync(fileURLToPath(new URL("../../spec/format.sql", import.meta.url)), "utf8");

  it("makes the same sqlite_schema as spec/format.sql", async () => {
    const sqlite3 = await sqlite3InitModule();
    const schema = (sql: string) => {
      const db = new sqlite3.oo1.DB(":memory:", "c");
      try {
        db.exec(sql);
        return db.selectArrays("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name");
      } finally {
        db.close();
      }
    };
    expect(schema(FORMAT_SQL)).toEqual(schema(spec));
  });
});

const MOSAIC = "reading/mosaic.mosaic";
const TESSERA = "reading/tessera.tessera";

async function expectRule(bytes: Uint8Array, name: string, rule: RefusalRule): Promise<void> {
  const error = await refusal(bytes, name);
  expect(error.rule).toBe(rule);
  expect(error.file).toBe(name);
  expect(error.message.startsWith(`${name}: `)).toBe(true);
}

/** Opens, or is refused cleanly; any other failure is a bug (3.8 step 4: untrusted input). */
async function opensOrRefused(bytes: Uint8Array, name: string): Promise<"opened" | "refused"> {
  try {
    (await openFile(bytes, name)).close();
    return "opened";
  } catch (e) {
    expect(e, `${name}: ${String(e)}`).toBeInstanceOf(FileRefusedError);
    expect(REFUSAL_RULES).toContain((e as FileRefusedError).rule);
    return "refused";
  }
}

describe("versions (3.3, 9)", () => {
  for (const version of ["0.2", "0.10", "0.0", "1.0", "0.1.1", "2.0", "0.11"]) {
    it(`refuses format_version ${version} for its version (9: only 0.1 is implemented)`, async () => {
      const bytes = await mutate(TESSERA, `UPDATE header SET format_version = '${version}'`);
      await expectRule(bytes, "v.tessera", "format_version");
    });
  }

  it("refuses a newer minor version of a mosaic even when its schema is also changed (9: cannot check)", async () => {
    const bytes = await mutate(
      MOSAIC,
      "UPDATE header SET format_version = '0.2'",
      "CREATE TABLE added_in_0_2 (x INTEGER)",
    );
    await expectRule(bytes, "future.mosaic", "format_version");
  });
});

describe("application_id and user_version (3.1, 3.8 step 2)", () => {
  it("refuses application_id that differs from MOSA by one bit", async () => {
    const bytes = await mutate(TESSERA, `PRAGMA application_id = ${0x4d4f5341 ^ 1}`);
    await expectRule(bytes, "app.tessera", "application_id");
  });

  for (const v of [0, 2, -1, 256]) {
    it(`refuses user_version ${v}`, async () => {
      const bytes = await mutate(MOSAIC, `PRAGMA user_version = ${v}`);
      await expectRule(bytes, "uv.mosaic", "user_version");
    });
  }
});

describe("the schema is exactly 3.1's (3.8 step 2)", () => {
  const cases: Record<string, string[]> = {
    "an added trigger": [
      "CREATE TRIGGER sneaky AFTER INSERT ON alias BEGIN SELECT 1; END",
    ],
    "an added view": ["CREATE VIEW v_extra AS SELECT id FROM node"],
    "an added index": ["CREATE INDEX node_label ON node (label)"],
    "an added table": ["CREATE TABLE extra (x)"],
    "a dropped table": ["DROP TABLE external_ref"],
    "a dropped view": ["DROP VIEW v_node"],
    "a view with a different definition": [
      "DROP VIEW v_node",
      "CREATE VIEW v_node AS SELECT id, type FROM node",
    ],
    "a CHECK constraint that differs": [
      "PRAGMA writable_schema = 1",
      "UPDATE sqlite_schema SET sql = replace(sql, 'count > 0', 'count > 1') WHERE name = 'link_count'",
    ],
    "a different index definition": [
      "DROP INDEX edge_in",
      "CREATE INDEX edge_in ON edge (type, dst)",
    ],
    "an added column on a data table": ["ALTER TABLE node ADD COLUMN extra TEXT"],
  };
  for (const [what, sql] of Object.entries(cases)) {
    it(`refuses ${what} in a mosaic`, async () => {
      const bytes = await mutate(MOSAIC, ...sql);
      await expectRule(bytes, "schema.mosaic", "schema");
    });
  }

  it("refuses an added trigger in a tessera too", async () => {
    const bytes = await mutate(TESSERA, "CREATE TRIGGER t AFTER INSERT ON node BEGIN SELECT 1; END");
    await expectRule(bytes, "schema.tessera", "schema");
  });

  it("opens a file that holds sqlite_stat1, which format.sql allows", async () => {
    const bytes = await mutate(MOSAIC, "ANALYZE");
    const file = await openFile(bytes, "stat.mosaic");
    try {
      expect(file.header.kind).toBe("mosaic");
    } finally {
      file.close();
    }
  });
});

describe("the header is exactly one row of a known kind (3.3)", () => {
  it("refuses two header rows", async () => {
    const bytes = await mutate(
      TESSERA,
      "INSERT INTO header SELECT 2, format_version, kind, producer, settings, knowledge_hash, vector_hash, embed_model, pattern_hash, target, ai_model FROM header",
    );
    await expectRule(bytes, "two.tessera", "header");
  });

  it("refuses a single header row whose `one` is not 1", async () => {
    const bytes = await mutate(TESSERA, "UPDATE header SET one = 2");
    await expectRule(bytes, "one.tessera", "header");
  });

  for (const kind of ["Tessera", "MOSAIC", "", "tessera ", "piece"]) {
    it(`refuses header kind ${JSON.stringify(kind)}`, async () => {
      const bytes = await mutate(TESSERA, `UPDATE header SET kind = '${kind}'`);
      await expectRule(bytes, "kind.tessera", "header");
    });
  }

  it("returns text of the header as UTF-8, with non-ASCII and emoji intact", async () => {
    const producer = "ツール🧩/1.0";
    const aiModel = "modèle-é@2";
    const bytes = await mutate(
      TESSERA,
      `UPDATE header SET producer = '${producer}', ai_model = '${aiModel}'`,
    );
    const file = await openFile(bytes, "utf8.tessera");
    try {
      expect(file.header.producer).toBe(producer);
      expect(file.header.ai_model).toBe(aiModel);
      expect(file.header.embed_model).toBeNull();
    } finally {
      file.close();
    }
  });

  it("returns a long settings value whole", async () => {
    const settings = JSON.stringify({ k: "x".repeat(100_000) });
    const bytes = await mutate(TESSERA, `UPDATE header SET settings = '${settings}'`);
    const file = await openFile(bytes, "long.tessera");
    try {
      expect(file.header.settings).toBe(settings);
    } finally {
      file.close();
    }
  });
});

describe("untrusted, truncated and corrupt files are refused, never a crash (3.8 step 4, 10)", () => {
  it("refuses 100 zero bytes", async () => {
    expect(await opensOrRefused(new Uint8Array(100), "zeros.mosaic")).toBe("refused");
  });

  it("refuses the SQLite magic with nothing after it", async () => {
    const magic = new TextEncoder().encode("SQLite format 3\0");
    expect(await opensOrRefused(magic, "magic.mosaic")).toBe("refused");
  });

  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.99]) {
    it(`refuses a mosaic cut to ${fraction * 100}% of its bytes`, async () => {
      const whole = read(MOSAIC);
      const cut = whole.slice(0, Math.floor(whole.length * fraction));
      const error = await refusal(cut, "cut.mosaic");
      expect(REFUSAL_RULES).toContain(error.rule);
    });
  }

  it("refuses a mosaic cut by one byte", async () => {
    const whole = read(MOSAIC);
    expect(await opensOrRefused(whole.slice(0, whole.length - 1), "cut1.mosaic")).toBe("refused");
  });

  it("refuses a mosaic with extra bytes that are not a whole page", async () => {
    const whole = read(MOSAIC);
    const longer = new Uint8Array(whole.length + 7);
    longer.set(whole);
    // The page count in the file header no longer matches the length: opened or refused,
    // never another error.
    await opensOrRefused(longer, "long.mosaic");
  });

  it("opens or refuses cleanly with any one byte of the first 100 changed", async () => {
    const whole = read(TESSERA);
    for (let i = 0; i < 100; i++) {
      for (const value of [0x00, 0xff, whole[i]! ^ 0x01]) {
        const bytes = whole.slice();
        bytes[i] = value;
        await opensOrRefused(bytes, `byte-${i}-${value}.tessera`);
      }
    }
  });

  it("opens or refuses cleanly with a whole data page overwritten", async () => {
    const whole = read(MOSAIC);
    const pages = Math.floor(whole.length / 4096);
    for (const page of [1, 2, Math.floor(pages / 2), pages - 1]) {
      if (page < 1 || page >= pages) continue;
      for (const fill of [0x00, 0xff]) {
        const bytes = whole.slice();
        bytes.fill(fill, page * 4096, (page + 1) * 4096);
        await opensOrRefused(bytes, `page-${page}-${fill}.mosaic`);
      }
    }
  });

  it("opens or cleanly refuses a file whose text encoding flag is no SQLite encoding", async () => {
    const bytes = read(TESSERA);
    bytes[59] = 7;
    await opensOrRefused(bytes, "enc-7.tessera");
  });
});

describe("what a caller gives and gets back (3.8 step 1, 3.3)", () => {
  it("opens bytes that are a view into a larger buffer", async () => {
    const whole = read(MOSAIC);
    const big = new Uint8Array(whole.length + 37);
    big.fill(0xaa);
    big.set(whole, 17);
    const view = big.subarray(17, 17 + whole.length);
    expect(view.byteOffset).toBe(17);
    const file = await openFile(view, "view.mosaic");
    try {
      const expected = JSON.parse(readFileSync(conformance("reading/cases.json"), "utf8"))[
        "mosaic.mosaic"
      ].header;
      expect({ ...file.header }).toEqual(expected);
    } finally {
      file.close();
    }
  });

  it("refuses a view whose surrounding buffer would be valid but whose own bytes are not", async () => {
    const whole = read(MOSAIC);
    const big = new Uint8Array(whole.length + 8);
    big.set(whole, 0);
    const view = big.subarray(8); // starts mid-file
    expect(await opensOrRefused(view, "shifted.mosaic")).toBe("refused");
  });

  it("does not change the given bytes when it refuses the file", async () => {
    for (const name of ["application-id.mosaic", "schema-extra-table.mosaic", "no-header.mosaic"]) {
      const bytes = read(`reading/${name}`);
      const before = bytes.slice();
      await refusal(bytes, name);
      expect(bytes).toEqual(before);
    }
  });

  it("keeps the header after the caller changes the given bytes", async () => {
    const bytes = read(TESSERA);
    const file = await openFile(bytes, "t.tessera");
    const before = { ...file.header };
    bytes.fill(0);
    expect({ ...file.header }).toEqual(before);
    file.close();
  });

  it("opens the same bytes twice at once, and closing one leaves the other", async () => {
    const bytes = read(MOSAIC);
    const [a, b] = await Promise.all([openFile(bytes, "a.mosaic"), openFile(bytes, "b.mosaic")]);
    expect(a.name).toBe("a.mosaic");
    expect(b.name).toBe("b.mosaic");
    expect({ ...a.header }).toEqual({ ...b.header });
    a.close();
    expect(b.header.kind).toBe("mosaic");
    b.close();
  });
});

describe("the error names the file and what failed (3.8 step 2)", () => {
  const odd = ["", "a b.mosaic", "名前.mosaic", "with\nnewline.mosaic", "dir/sub/x.tessera", "a'b\".mosaic"];
  for (const name of odd) {
    it(`keeps the name ${JSON.stringify(name)} as given`, async () => {
      const error = await refusal(read("reading/user-version.mosaic"), name);
      expect(error.file).toBe(name);
      expect(error.message.startsWith(`${name}: `)).toBe(true);
      expect(error.message).toContain("user_version");
      expect(error.name).toBe("FileRefusedError");
      expect(error).toBeInstanceOf(Error);
    });
  }

  it("gives a different message for each rule", async () => {
    const files: Record<RefusalRule, string> = {
      sqlite: "not-sqlite.mosaic",
      encoding: "utf-16.mosaic",
      application_id: "application-id.mosaic",
      user_version: "user-version.mosaic",
      format_version: "format-version.mosaic",
      schema: "schema-extra-table.mosaic",
      header: "no-header.mosaic",
      knowledge_hash: "node-changed.mosaic",
      vector_hash: "vector-changed.mosaic",
    };
    const messages = new Set<string>();
    for (const rule of REFUSAL_RULES) {
      const error = await refusal(read(`reading/${files[rule]}`), "f");
      expect(error.rule).toBe(rule);
      messages.add(error.message);
    }
    expect(messages.size).toBe(REFUSAL_RULES.length);
  });

  it("names the version it found when it refuses a format version", async () => {
    const error = await refusal(read("reading/newer-minor.mosaic"), "n.mosaic");
    expect(error.message).toContain("0.2");
  });
});

const STAT4 = "CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)";

/** Edit a copy of `path` with SQL (checks off, schema writable) and return the new bytes. */
async function mutate(path: string, ...statements: string[]): Promise<Uint8Array> {
  return mutateBytes(read(path), ...statements);
}

async function mutateBytes(bytes: Uint8Array, ...statements: string[]): Promise<Uint8Array> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:", "c");
  try {
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      "main",
      p,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) throw new Error(`deserialize failed: ${rc}`);
    db.exec("PRAGMA ignore_check_constraints = 1");
    db.exec("PRAGMA foreign_keys = 0");
    for (const sql of statements) db.exec(sql);
    return new Uint8Array(sqlite3.capi.sqlite3_js_db_export(db.pointer!));
  } finally {
    db.close();
  }
}

/** SQL that adds `sqlite_stat4` as SQLite declares it (the `sqlite_` prefix is reserved). */
const addStat4 = (): string[] => [
  STAT4.replace("sqlite_stat4", "stat4_placeholder"),
  "PRAGMA writable_schema = 1",
  `UPDATE sqlite_schema SET name = 'sqlite_stat4', tbl_name = 'sqlite_stat4', sql = '${STAT4}' WHERE name = 'stat4_placeholder'`,
  "PRAGMA writable_schema = 0",
];

async function opensAs(bytes: Uint8Array, name: string, kind: string): Promise<void> {
  const file = await openFile(bytes, name);
  try {
    expect(file.header.kind).toBe(kind);
  } finally {
    file.close();
  }
}

describe("text is stored as UTF-8 (3.1", () => {
  it("refuses a mosaic whose encoding flag says UTF-16be, for encoding", async () => {
    const bytes = read(MOSAIC);
    bytes[59] = 3;
    await expectRule(bytes, "be.mosaic", "encoding");
  });

  it("refuses UTF-16 for encoding even when the file is a tessera carrying only the flag", async () => {
    const bytes = read(TESSERA);
    bytes[59] = 2; // UTF-16le
    await expectRule(bytes, "flag.tessera", "encoding");
  });
});

describe("sqlite_stat4 may be present (3.1", () => {
  it("opens a mosaic holding sqlite_stat4 and returns the same header as without it", async () => {
    const bytes = await mutate(MOSAIC, ...addStat4());
    const file = await openFile(bytes, "s4.mosaic");
    try {
      const plain = await openFile(read(MOSAIC), "plain.mosaic");
      try {
        expect({ ...file.header }).toEqual({ ...plain.header });
      } finally {
        plain.close();
      }
    } finally {
      file.close();
    }
  });

  it("opens a tessera holding sqlite_stat1 and sqlite_stat4 together", async () => {
    await opensAs(await mutate(TESSERA, "ANALYZE", ...addStat4()), "s14.tessera", "tessera");
  });

  it("opens a mosaic whose sqlite_stat4 has rows that no statistics would give", async () => {
    // The table is declared in one pass and filled in a second, once SQLite has reread the schema.
    const declared = await mutate(MOSAIC, ...addStat4());
    const bytes = await mutateBytes(
      declared,
      "INSERT INTO sqlite_stat4 VALUES ('node', 'nothing', 'x y z', '1', '2', x'00ff')",
      "INSERT INTO sqlite_stat4 VALUES (NULL, NULL, NULL, NULL, NULL, NULL)",
      "INSERT INTO sqlite_stat4 VALUES ('no_such_table', 'no_such_index', '9999999999 1', '', '', zeroblob(5000))",
    );
    // Statistics are not knowledge, and are not read as knowledge: the file still opens.
    await opensAs(bytes, "s4junk.mosaic", "mosaic");
  });

  it("opens a file whose sqlite_stat1 holds garbage rows", async () => {
    const bytes = await mutate(
      MOSAIC,
      "ANALYZE",
      "INSERT INTO sqlite_stat1 VALUES ('node', 'zz', 'not numbers')",
      "INSERT INTO sqlite_stat1 VALUES ('ghost', NULL, '-5 -5')",
    );
    await opensAs(bytes, "s1junk.mosaic", "mosaic");
  });

  it("still refuses a file that holds sqlite_stat4 and a table format.sql does not define", async () => {
    const bytes = await mutate(MOSAIC, ...addStat4(), "CREATE TABLE extra (x)");
    await expectRule(bytes, "s4extra.mosaic", "schema");
  });

  it("does not take a user table named like a statistics table for one", async () => {
    // `stat4_placeholder` is not an SQLite internal table: it stays an extra table.
    const bytes = await mutate(MOSAIC, STAT4.replace("sqlite_stat4", "stat4_placeholder"));
    await expectRule(bytes, "lookalike.mosaic", "schema");
  });

  it("does not take a table named sqlite_stat41 for one of SQLite's statistics tables", async () => {
    const bytes = await mutate(
      MOSAIC,
      "CREATE TABLE stat_x (tbl,idx,neq,nlt,ndlt,sample)",
      "PRAGMA writable_schema = 1",
      "UPDATE sqlite_schema SET name = 'sqlite_stat41', tbl_name = 'sqlite_stat41', sql = 'CREATE TABLE sqlite_stat41(tbl,idx,neq,nlt,ndlt,sample)' WHERE name = 'stat_x'",
      "PRAGMA writable_schema = 0",
    );
    await expectRule(bytes, "stat41.mosaic", "schema");
  });
});

describe("the search virtual table has format.sql's definition (3.1)", () => {
  const search = (definition: string): string[] => [
    "DROP TABLE search",
    `CREATE VIRTUAL TABLE search USING fts5 (${definition})`,
  ];
  const cases: Record<string, string[]> = {
    "another tokenizer": search(
      `label, aliases, summary, snippets, content = '', tokenize = "unicode61"`,
    ),
    "the porter tokenizer": search(
      `label, aliases, summary, snippets, content = '', tokenize = "porter unicode61 tokenchars '-_.'"`,
    ),
    "other token characters": search(
      `label, aliases, summary, snippets, content = '', tokenize = "unicode61 tokenchars '-_'"`,
    ),
    "stored content": search(
      `label, aliases, summary, snippets, tokenize = "unicode61 tokenchars '-_.'"`,
    ),
    "columns in another order": search(
      `aliases, label, summary, snippets, content = '', tokenize = "unicode61 tokenchars '-_.'"`,
    ),
    "a column fewer": search(
      `label, aliases, summary, content = '', tokenize = "unicode61 tokenchars '-_.'"`,
    ),
    "a column more": search(
      `label, aliases, summary, snippets, extra, content = '', tokenize = "unicode61 tokenchars '-_.'"`,
    ),
    "a prefix index": search(
      `label, aliases, summary, snippets, content = '', prefix = '2', tokenize = "unicode61 tokenchars '-_.'"`,
    ),
    "no positions": search(
      `label, aliases, summary, snippets, content = '', detail = 'column', tokenize = "unicode61 tokenchars '-_.'"`,
    ),
  };
  for (const [what, sql] of Object.entries(cases)) {
    it(`refuses ${what}, for schema`, async () => {
      await expectRule(await mutate(MOSAIC, ...sql), "search.mosaic", "schema");
    });
  }

  it("refuses an fts5vocab table beside search", async () => {
    const bytes = await mutate(MOSAIC, "CREATE VIRTUAL TABLE vocab USING fts5vocab(search, 'row')");
    await expectRule(bytes, "vocab.mosaic", "schema");
  });

  it("refuses a table named like a shadow table of search that SQLite did not make", async () => {
    const bytes = await mutate(MOSAIC, "CREATE TABLE search_extra (x)");
    await expectRule(bytes, "shadow.mosaic", "schema");
  });

  it("refuses a missing search table", async () => {
    await expectRule(await mutate(MOSAIC, "DROP TABLE search"), "nosearch.mosaic", "schema");
  });

  it("opens the conformance files, whose search table has its shadow tables", async () => {
    await opensAs(read(MOSAIC), "m.mosaic", "mosaic");
    await opensAs(read(TESSERA), "t.tessera", "tessera");
  });
});

describe("a header value stored as the wrong type is not the value it looks like (3.3)", () => {
  it("refuses a kind stored as a blob that spells tessera", async () => {
    const bytes = await mutate(TESSERA, "UPDATE header SET kind = CAST('tessera' AS BLOB)");
    const error = await refusal(bytes, "blobkind.tessera");
    expect(REFUSAL_RULES).toContain(error.rule);
  });

  it("refuses a format_version stored as a blob that spells 0.1", async () => {
    const bytes = await mutate(TESSERA, "UPDATE header SET format_version = CAST('0.1' AS BLOB)");
    const error = await refusal(bytes, "blobversion.tessera");
    expect(REFUSAL_RULES).toContain(error.rule);
  });
});
