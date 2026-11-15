"""The SQLite tessera builder (Specification 0.1 sections 3.4, 3.5, 4.1 and 4.3).

One SQLite database gives one tessera. Each table the settings name gives one node type, each
row one node keyed by its primary key, the columns the settings name its props, and each value
of a foreign key the settings name one edge from the row to the row it names. Every node and
edge has evidence whose locator names the file, the table and the row (section 3.5). The
database is only read (principle 8), and the same database and settings give the same knowledge
hash, with the settings recorded in ``header.settings`` (sections 3.3 and 4.3).
"""

import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path

import mosaic_format
import pytest
from mosaic_build import __version__
from mosaic_build.tessera.convert import Boolean, Date
from mosaic_build.tessera.sqlite import Settings, Table, build, read
from mosaic_format.check import check_file

PRODUCER = f"mosaic-sqlite/{__version__}"

SCHEMA = """
CREATE TABLE Writer (
    WriterId INTEGER PRIMARY KEY,
    Name     TEXT NOT NULL,
    Born     TEXT
);
CREATE TABLE Shelf (
    Code  TEXT PRIMARY KEY,
    Floor INTEGER
);
CREATE TABLE Volume (
    VolumeId  INTEGER PRIMARY KEY,
    Title     TEXT NOT NULL,
    Pages     INTEGER,
    Weight    REAL,
    Lent      INTEGER,
    WriterId  INTEGER NOT NULL REFERENCES Writer (WriterId),
    ShelfCode TEXT REFERENCES Shelf,
    SequelOf  INTEGER REFERENCES Volume (VolumeId)
);
CREATE TABLE Unlisted (Id INTEGER PRIMARY KEY, Note TEXT);
"""

ROWS = """
INSERT INTO Writer VALUES (1, 'Ada Quill', '3 March 1901'), (2, 'Bo Lark', NULL);
INSERT INTO Shelf VALUES ('A1', 0), ('B7', 2);
INSERT INTO Volume VALUES
    (10, 'Salt Roads', 312, 0.45, 1, 1, 'A1', NULL),
    (11, 'Salt Roads Again', 280, 0.5, 0, 1, 'B7', 10),
    (12, 'Quiet Hours', NULL, NULL, NULL, 2, NULL, NULL);
INSERT INTO Unlisted VALUES (1, 'not imported');
"""

SETTINGS = Settings(
    tables={
        "Writer": Table(label="Name", props=("Name", "Born")),
        "Shelf": Table(type="Place", props=("Floor",)),
        "Volume": Table(
            label="Title",
            props=("Title", "Pages", "Weight", "Lent"),
            foreign_keys={"WriterId": "written_by", "ShelfCode": "kept_on", "SequelOf": "follows"},
        ),
    }
)


def _database(path: Path, schema: str = SCHEMA, rows: str | None = None) -> Path:
    """A database of ``schema`` and ``rows``; the sample rows go with the sample schema only."""
    if rows is None:
        rows = ROWS if schema is SCHEMA else ""
    con = sqlite3.connect(path)
    con.executescript(schema + rows)
    con.commit()
    con.close()
    return path


def _rows(path: Path, sql: str) -> list[tuple[object, ...]]:
    with mosaic_format.open(path) as f:
        return f.query(sql)


@pytest.fixture
def db(tmp_path: Path) -> Path:
    return _database(tmp_path / "library.db")


@pytest.fixture
def built(db: Path) -> Path:
    out = db.with_name("library.tessera")
    build(db, out, SETTINGS)
    return out


# --- nodes, keys and props (sections 3.4, 4.1) ---------------------------------------------


def test_each_row_of_each_named_table_is_one_node_keyed_by_its_primary_key(built: Path) -> None:
    nodes = _rows(built, "SELECT id, type, key, label, summary, props FROM node ORDER BY nid")
    assert nodes == [
        ("Place:A1", "Place", "A1", None, None, '{"Floor":0}'),
        ("Place:B7", "Place", "B7", None, None, '{"Floor":2}'),
        ("Volume:10", "Volume", "10", "Salt Roads", None,
         '{"Lent":1,"Pages":312,"Title":"Salt Roads","Weight":0.45}'),
        ("Volume:11", "Volume", "11", "Salt Roads Again", None,
         '{"Lent":0,"Pages":280,"Title":"Salt Roads Again","Weight":0.5}'),
        ("Volume:12", "Volume", "12", "Quiet Hours", None, '{"Title":"Quiet Hours"}'),
        ("Writer:1", "Writer", "1", "Ada Quill", None,
         '{"Born":"3 March 1901","Name":"Ada Quill"}'),
        ("Writer:2", "Writer", "2", "Bo Lark", None, '{"Name":"Bo Lark"}'),
    ]  # fmt: skip


def test_a_table_the_settings_do_not_name_gives_nothing(built: Path) -> None:
    assert _rows(built, "SELECT count(*) FROM node WHERE type = 'Unlisted'") == [(0,)]
    assert _rows(built, "SELECT count(*) FROM type WHERE name = 'Unlisted'") == [(0,)]


def test_each_table_is_one_node_type_keyed_by_its_primary_key_column(built: Path) -> None:
    types = _rows(
        built,
        "SELECT name, kind, key_prop, from_type, to_type, props FROM type"
        " WHERE kind = 'node' ORDER BY name",
    )
    assert types == [
        ("Place", "node", "Code", None, None, '{"Floor":"integer"}'),
        ("Volume", "node", "VolumeId", None, None,
         '{"Lent":"integer","Pages":"integer","Title":"text","Weight":"number"}'),
        ("Writer", "node", "WriterId", None, None, '{"Born":"text","Name":"text"}'),
    ]  # fmt: skip


def test_values_keep_their_kind_and_null_makes_no_prop(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "values.db",
        "CREATE TABLE T (K TEXT PRIMARY KEY, I INTEGER, R REAL, S TEXT, Big INTEGER, M);",
        "INSERT INTO T VALUES ('a', -3, 1.5, 'x y', 9007199254740993, 'text'),"
        " ('b', NULL, 2.0, '', NULL, 4);",
    )
    out = tmp_path / "values.tessera"
    build(db, out, Settings(tables={"T": Table(props=("I", "R", "S", "Big", "M"))}))
    assert _rows(out, "SELECT key, props FROM node ORDER BY nid") == [
        # An integer beyond +/-(2**53 - 1) is stored as a string (section 3.1).
        ("a", '{"Big":"9007199254740993","I":-3,"M":"text","R":1.5,"S":"x y"}'),
        ("b", '{"M":4,"R":2,"S":""}'),
    ]
    # A column holding text and numbers is declared json: its values keep their kinds.
    assert _rows(out, "SELECT props FROM type WHERE name = 'T'") == [
        ('{"Big":"integer","I":"integer","M":"json","R":"number","S":"text"}',)
    ]


def test_conversions_apply_to_a_columns_values(tmp_path: Path, db: Path) -> None:
    settings = Settings(
        tables={
            "Writer": Table(
                label="Name",
                props=("Name", "Born"),
                convert={"Born": Date(("%d %B %Y",))},
            ),
            "Volume": Table(
                props=("Lent",),
                convert={"Lent": Boolean(true=("1",), false=("0",))},
            ),
        }
    )
    out = tmp_path / "converted.tessera"
    made = build(db, out, settings)
    props = _rows(out, "SELECT id, props FROM node ORDER BY nid")
    assert props == [
        ("Volume:10", '{"Lent":true}'),
        ("Volume:11", '{"Lent":false}'),
        ("Volume:12", None),
        ("Writer:1", '{"Born":"1901-03-03","Name":"Ada Quill"}'),
        ("Writer:2", '{"Name":"Bo Lark"}'),
    ]
    kinds = _rows(out, "SELECT name, props FROM type WHERE kind = 'node' ORDER BY name")
    assert kinds == [("Volume", '{"Lent":"boolean"}'), ("Writer", '{"Born":"text","Name":"text"}')]
    assert made.report.counts() == {"Volume.Lent": 0, "Writer.Born": 0}


def test_a_value_a_conversion_cannot_read_is_kept_and_reported(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "odd.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, D TEXT);",
        "INSERT INTO T VALUES (1, '2 May 2020'), (2, 'soon'), (3, 'later');",
    )
    settings = Settings(tables={"T": Table(props=("D",), convert={"D": Date(("%d %B %Y",))})})
    made = build(db, tmp_path / "odd.tessera", settings)
    assert _rows(made.path, "SELECT props FROM node ORDER BY nid") == [
        ('{"D":"2020-05-02"}',),
        ('{"D":"soon"}',),
        ('{"D":"later"}',),
    ]
    assert made.report.unconverted == {"T.D": ("2", "3")}  # by key


# --- foreign keys (sections 3.4, 4.1) ------------------------------------------------------


def test_each_foreign_key_value_is_one_edge_to_the_row_it_names(built: Path) -> None:
    edges = _rows(
        built,
        "SELECT s.id, e.type, d.id, e.qualifier, e.props FROM edge e"
        " JOIN node s ON s.nid = e.src JOIN node d ON d.nid = e.dst ORDER BY e.eid",
    )
    # A NULL foreign key makes no edge; SequelOf names a row of its own table.
    assert sorted(edges) == [
        ("Volume:10", "kept_on", "Place:A1", "", None),
        ("Volume:10", "written_by", "Writer:1", "", None),
        ("Volume:11", "follows", "Volume:10", "", None),
        ("Volume:11", "kept_on", "Place:B7", "", None),
        ("Volume:11", "written_by", "Writer:1", "", None),
        ("Volume:12", "written_by", "Writer:2", "", None),
    ]


def test_each_foreign_key_is_an_edge_type_from_its_table_to_the_table_it_names(
    built: Path,
) -> None:
    types = _rows(
        built,
        "SELECT name, key_prop, from_type, to_type, props FROM type"
        " WHERE kind = 'edge' ORDER BY name",
    )
    assert types == [
        ("follows", None, "Volume", "Volume", "{}"),
        ("kept_on", None, "Volume", "Place", "{}"),
        ("written_by", None, "Volume", "Writer", "{}"),
    ]


def test_a_foreign_key_the_settings_do_not_name_makes_no_edge(tmp_path: Path, db: Path) -> None:
    settings = Settings(
        tables={
            "Writer": Table(),
            "Volume": Table(foreign_keys={"WriterId": "written_by"}),
        }
    )
    out = tmp_path / "some.tessera"
    build(db, out, settings)
    assert _rows(out, "SELECT DISTINCT type FROM edge") == [("written_by",)]


def test_a_foreign_key_to_a_unique_column_names_that_row(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "unique.db",
        "CREATE TABLE P (Id INTEGER PRIMARY KEY, Code TEXT UNIQUE);"
        "CREATE TABLE C (Id INTEGER PRIMARY KEY, PCode TEXT REFERENCES P (Code));",
        "INSERT INTO P VALUES (1, 'x'), (2, 'y'); INSERT INTO C VALUES (5, 'y');",
    )
    out = tmp_path / "unique.tessera"
    build(db, out, Settings(tables={"P": Table(), "C": Table(foreign_keys={"PCode": "in_p"})}))
    edges = _rows(
        out,
        "SELECT s.id, e.type, d.id FROM edge e"
        " JOIN node s ON s.nid = e.src JOIN node d ON d.nid = e.dst",
    )
    assert edges == [("C:5", "in_p", "P:2")]


# --- evidence (section 3.5) ----------------------------------------------------------------


def test_every_node_has_evidence_naming_the_table_and_the_row(built: Path) -> None:
    evidence = _rows(
        built,
        "SELECT n.id, e.prop, s.id, e.locator, e.method, e.producer, e.confidence, e.via"
        " FROM evidence e JOIN node n USING (nid) JOIN source s USING (sid) ORDER BY e.evid",
    )
    assert evidence == [
        (f"{t}:{k}", None, "library.db", f"file=library.db;table={table};row={k}", "extracted",
         PRODUCER, None, None)
        for t, table, k in [
            ("Place", "Shelf", "A1"), ("Place", "Shelf", "B7"), ("Volume", "Volume", "10"),
            ("Volume", "Volume", "11"), ("Volume", "Volume", "12"), ("Writer", "Writer", "1"),
            ("Writer", "Writer", "2"),
        ]
    ]  # fmt: skip


def test_every_edge_has_evidence_naming_the_table_the_row_and_the_column(built: Path) -> None:
    evidence = _rows(
        built,
        "SELECT s.id, x.type, d.id, e.locator, e.method, e.producer FROM evidence e"
        " JOIN edge x USING (eid) JOIN node s ON s.nid = x.src JOIN node d ON d.nid = x.dst",
    )
    assert sorted(evidence) == [
        ("Volume:10", "kept_on", "Place:A1",
         "file=library.db;table=Volume;row=10;field=ShelfCode", "extracted", PRODUCER),
        ("Volume:10", "written_by", "Writer:1",
         "file=library.db;table=Volume;row=10;field=WriterId", "extracted", PRODUCER),
        ("Volume:11", "follows", "Volume:10",
         "file=library.db;table=Volume;row=11;field=SequelOf", "extracted", PRODUCER),
        ("Volume:11", "kept_on", "Place:B7",
         "file=library.db;table=Volume;row=11;field=ShelfCode", "extracted", PRODUCER),
        ("Volume:11", "written_by", "Writer:1",
         "file=library.db;table=Volume;row=11;field=WriterId", "extracted", PRODUCER),
        ("Volume:12", "written_by", "Writer:2",
         "file=library.db;table=Volume;row=12;field=WriterId", "extracted", PRODUCER),
    ]  # fmt: skip


def test_the_one_source_is_the_database_with_the_hash_of_its_bytes(built: Path, db: Path) -> None:
    sources = _rows(built, "SELECT id, kind, path, hash, notice FROM source")
    digest = hashlib.sha256(db.read_bytes()).hexdigest()
    assert sources == [("library.db", "database", "library.db", digest, None)]


def test_the_tessera_passes_check_file(built: Path) -> None:
    report = check_file(built)
    assert [str(v) for v in report.violations] == []


def test_nothing_but_the_graph_evidence_and_search_is_filled(built: Path) -> None:
    for table in ("alias", "snippet", "mention", "link_count", "vector", "source_text",
                  "external_ref"):  # fmt: skip
        assert _rows(built, f"SELECT count(*) FROM {table}") == [(0,)], table


# --- the header and determinism (sections 3.3, 4.3) ----------------------------------------


def test_the_header_is_a_tessera_recording_its_producer_and_settings(built: Path) -> None:
    (header,) = _rows(
        built,
        "SELECT format_version, kind, producer, settings, vector_hash, embed_model,"
        " pattern_hash, target, ai_model FROM header",
    )
    assert header[:3] == ("0.1", "tessera", PRODUCER)
    assert json.loads(str(header[3])) == {
        "tables": {
            "Shelf": {"type": "Place", "label": None, "summary": None, "props": ["Floor"]},
            "Volume": {
                "type": "Volume",
                "label": "Title",
                "summary": None,
                "props": ["Title", "Pages", "Weight", "Lent"],
                "foreign_keys": {
                    "WriterId": "written_by",
                    "ShelfCode": "kept_on",
                    "SequelOf": "follows",
                },
            },
            "Writer": {"type": "Writer", "label": "Name", "summary": None,
                       "props": ["Name", "Born"]},
        }
    }  # fmt: skip
    assert header[3] == SETTINGS.as_json()
    assert header[4:] == (None, None, None, None, None)


def test_the_same_database_and_settings_give_the_same_knowledge_hash(
    tmp_path: Path, db: Path
) -> None:
    first = build(db, tmp_path / "a.tessera", SETTINGS)
    second = build(db, tmp_path / "b.tessera", SETTINGS)
    assert first.knowledge_hash == second.knowledge_hash
    with mosaic_format.open(first.path) as f:
        assert f.knowledge_hash == first.knowledge_hash


def test_the_same_rows_written_in_another_order_give_the_same_graph(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    statements = [s for s in ROWS.split(";") if s.strip()]
    a = _database(tmp_path / "a" / "library.db")
    b = _database(tmp_path / "b" / "library.db", rows=";".join(reversed(statements)) + ";")
    one, _ = read(a, SETTINGS)
    two, _ = read(b, SETTINGS)
    assert sorted(map(repr, one.nodes)) == sorted(map(repr, two.nodes))
    assert sorted(map(repr, one.edges)) == sorted(map(repr, two.edges))
    assert sorted(map(repr, one.evidence)) == sorted(map(repr, two.evidence))


# --- the source is only read (principle 8) -------------------------------------------------


def test_the_database_is_byte_identical_and_untouched_after_import(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    db = _database(tmp_path / "src" / "library.db")
    before = db.read_bytes()
    stat = db.stat()
    db.chmod(0o444)
    build(db, tmp_path / "out.tessera", SETTINGS)
    assert db.read_bytes() == before
    assert db.stat().st_mtime_ns == stat.st_mtime_ns
    assert sorted(os.listdir(db.parent)) == ["library.db"]


def test_a_database_in_write_ahead_log_mode_is_read_and_left_as_it_was(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    db = tmp_path / "src" / "library.db"
    con = sqlite3.connect(db)
    con.execute("PRAGMA journal_mode = wal")
    con.executescript(SCHEMA + ROWS)
    con.commit()
    con.close()  # the last connection checkpoints and removes the log
    assert sorted(os.listdir(db.parent)) == ["library.db"]
    before = db.read_bytes()
    made = build(db, tmp_path / "wal.tessera", SETTINGS)
    assert db.read_bytes() == before
    assert sorted(os.listdir(db.parent)) == ["library.db"]
    assert _rows(made.path, "SELECT count(*) FROM node") == [(7,)]


@pytest.mark.parametrize("beside", ["-wal", "-journal"])
def test_a_database_with_a_log_beside_it_is_refused(tmp_path: Path, db: Path, beside: str) -> None:
    """Its content is not the file's bytes alone, so the source hash would not name it."""
    log = db.with_name(db.name + beside)
    log.write_bytes(b"pending")
    out = tmp_path / "out.tessera"
    with pytest.raises(ValueError, match=f"library.db.*{beside}"):
        build(db, out, SETTINGS)
    assert not out.exists()
    assert log.read_bytes() == b"pending"


# --- what the builder refuses --------------------------------------------------------------


def _refused(tmp_path: Path, db: Path, settings: Settings, match: str) -> None:
    out = tmp_path / "refused.tessera"
    with pytest.raises(ValueError, match=match or None):
        build(db, out, settings)
    assert not out.exists()


def test_a_file_that_is_not_a_database_is_refused_naming_it(tmp_path: Path) -> None:
    path = tmp_path / "notes.db"
    path.write_bytes(b"just some text, not a database\n" * 10)
    _refused(tmp_path, path, SETTINGS, r"notes\.db")


@pytest.mark.parametrize(
    ("settings", "match"),
    [
        (Settings(tables={"Nowhere": Table()}), r"library\.db.*table 'Nowhere'"),
        (Settings(tables={"Writer": Table(props=("Age",))}), r"Writer.*column 'Age'"),
        (Settings(tables={"Writer": Table(label="Nick")}), r"Writer.*column 'Nick'"),
        (
            Settings(tables={"Writer": Table(foreign_keys={"Name": "named"})}),
            r"Writer.*'Name'",
        ),
        (
            Settings(tables={"Volume": Table(foreign_keys={"WriterId": "written_by"})}),
            r"Volume.*'WriterId'.*'Writer'",
        ),
        (Settings(tables={"Writer": Table(type="writer")}), r"Writer.*type 'writer'"),
        (
            Settings(tables={"Writer": Table(type="X"), "Shelf": Table(type="X")}),
            r"type 'X'",
        ),
        (
            Settings(
                tables={
                    "Writer": Table(),
                    "Volume": Table(foreign_keys={"WriterId": "Written"}),
                }
            ),
            r"Volume.*edge 'Written'",
        ),
        (Settings(tables={}), r""),
    ],
    ids=[
        "unknown-table",
        "unknown-prop",
        "unknown-label",
        "no-such-foreign-key",
        "foreign-key-to-an-unnamed-table",
        "bad-type-name",
        "type-twice",
        "bad-edge-name",
        "no-tables",
    ],
)
def test_wrong_settings_are_refused_naming_the_setting(
    tmp_path: Path, db: Path, settings: Settings, match: str
) -> None:
    _refused(tmp_path, db, settings, match)


def test_a_foreign_key_value_naming_no_row_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "dangling.db",
        "CREATE TABLE P (Id INTEGER PRIMARY KEY);"
        "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId INTEGER REFERENCES P);",
        "INSERT INTO P VALUES (1); INSERT INTO C VALUES (7, 2);",
    )
    settings = Settings(tables={"P": Table(), "C": Table(foreign_keys={"PId": "in_p"})})
    _refused(tmp_path, db, settings, r"dangling\.db: table 'C' row 7: 'PId'")


def test_a_table_without_a_primary_key_is_refused(tmp_path: Path) -> None:
    db = _database(tmp_path / "nokey.db", "CREATE TABLE T (A TEXT);", "INSERT INTO T VALUES ('x');")
    _refused(tmp_path, db, Settings(tables={"T": Table()}), r"nokey\.db: table 'T'")


def test_a_table_whose_primary_key_has_two_columns_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "pair.db",
        "CREATE TABLE T (A INTEGER, B INTEGER, PRIMARY KEY (A, B));",
        "INSERT INTO T VALUES (1, 2);",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table()}), r"pair\.db: table 'T'.*2 columns")


def test_a_null_or_empty_key_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "nullkey.db",
        "CREATE TABLE T (K TEXT PRIMARY KEY);",
        "INSERT INTO T VALUES ('');",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table()}), r"nullkey\.db: table 'T'")


def test_a_key_with_a_semicolon_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "semi.db",
        "CREATE TABLE T (K TEXT PRIMARY KEY);",
        "INSERT INTO T VALUES ('a;b');",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table()}), r"semi\.db: table 'T'.*';'")


def test_a_blob_value_is_refused_naming_the_row_and_column(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "blob.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, B BLOB);",
        "INSERT INTO T VALUES (1, X'00ff');",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table(props=("B",))}), r"table 'T' row 1: 'B'")


def test_text_holding_u0000_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "nul.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, S TEXT);",
        "INSERT INTO T VALUES (1, 'a' || char(0) || 'b');",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table(props=("S",))}), r"row 1: 'S'.*U\+0000")


@pytest.mark.parametrize(
    ("schema", "match"),
    [
        (
            "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId REFERENCES P);CREATE TABLE P (A TEXT);",
            r"table 'P'",
        ),
        (
            "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId REFERENCES P);",
            r"table 'P'",
        ),
        (
            "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId REFERENCES P (Nope));"
            "CREATE TABLE P (Id INTEGER PRIMARY KEY);",
            r"table 'C': column 'PId'.*'Nope'.*'P'",
        ),
    ],
    ids=["parent-without-a-key", "parent-not-a-table", "parent-column-missing"],
)
def test_a_foreign_key_whose_parent_cannot_be_read_is_refused(
    tmp_path: Path, schema: str, match: str
) -> None:
    """The child table is named first, so its foreign key is read before the parent."""
    db = _database(tmp_path / "parent.db", schema, "")
    settings = Settings(tables={"C": Table(foreign_keys={"PId": "in_p"}), "P": Table()})
    _refused(tmp_path, db, settings, match)


def _violations(path: Path) -> list[str]:
    return [str(v) for v in check_file(path).violations]


# --- tables and keys that look odd (sections 3.4, 4.1) -------------------------------------


def test_an_empty_table_declares_its_type_and_gives_no_node(tmp_path: Path) -> None:
    # Section 3.4: every type used is declared; an empty table is still a table the settings name.
    db = _database(tmp_path / "e.db", "CREATE TABLE T (K INTEGER PRIMARY KEY, V TEXT);")
    out = tmp_path / "e.tessera"
    build(db, out, Settings(tables={"T": Table(props=("V",))}))
    assert _rows(out, "SELECT count(*) FROM node") == [(0,)]
    assert _rows(out, "SELECT count(*) FROM evidence") == [(0,)]
    assert _rows(out, "SELECT name FROM type") == [("T",)]
    assert _violations(out) == []


def test_keys_zero_negative_unicode_and_punctuation_are_kept_as_text(tmp_path: Path) -> None:
    # Section 3.4: the id is <type>:<source key>; a ':' or '=' in the key is not special.
    db = _database(
        tmp_path / "k.db",
        "CREATE TABLE T (K TEXT PRIMARY KEY);",
        "INSERT INTO T VALUES ('0'), ('-1'), ('a:b'), ('x=y'), ('A'), ('a'), (' pad '),"
        " ('é'), (char(101, 769)), (char(128512));",
    )
    out = tmp_path / "k.tessera"
    build(db, out, Settings(tables={"T": Table()}))
    keys = {k for (k,) in _rows(out, "SELECT key FROM node")}
    assert keys == {"0", "-1", "a:b", "x=y", "A", "a", " pad ", "é", "é", "\U0001f600"}
    ids = {i for (i,) in _rows(out, "SELECT id FROM node")}
    assert ids == {f"T:{k}" for k in keys}
    locators = {loc for (loc,) in _rows(out, "SELECT locator FROM evidence")}
    assert "file=k.db;table=T;row=x=y" in locators
    assert "file=k.db;table=T;row=\U0001f600" in locators
    assert _violations(out) == []  # includes canonical order by UTF-8 bytes (section 3.6)


def test_the_key_column_may_also_be_a_prop(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "p.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, V TEXT);",
        "INSERT INTO T VALUES (7, 'x');",
    )
    out = tmp_path / "p.tessera"
    build(db, out, Settings(tables={"T": Table(props=("K", "V"))}))
    assert _rows(out, "SELECT props FROM node") == [('{"K":7,"V":"x"}',)]
    assert _violations(out) == []


# --- labels and summaries (section 3.2: the search index holds them) -----------------------


def test_a_summary_column_fills_the_summary_and_the_search_index(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "s.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, L TEXT, S TEXT);",
        "INSERT INTO T VALUES (1, 'Name one', 'a long summary'), (2, 'Name two', NULL);",
    )
    out = tmp_path / "s.tessera"
    build(db, out, Settings(tables={"T": Table(label="L", summary="S")}))
    assert _rows(out, "SELECT key, label, summary FROM node ORDER BY nid") == [
        ("1", "Name one", "a long summary"),
        ("2", "Name two", None),
    ]
    assert _rows(out, "SELECT rowid FROM search WHERE search MATCH 'summary'") == [(1,)]
    assert _violations(out) == []


# --- values (sections 3.1, 3.4) ------------------------------------------------------------


def test_numbers_at_the_edge_of_the_exact_integer_range(tmp_path: Path) -> None:
    # Section 3.1: an integer outside +/-(2^53 - 1) is stored as a string.
    db = _database(
        tmp_path / "n.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, V INTEGER);",
        "INSERT INTO T VALUES (1, 9007199254740991), (2, 9007199254740992),"
        " (3, -9007199254740991), (4, -9007199254740992), (5, 9223372036854775807);",
    )
    out = tmp_path / "n.tessera"
    build(db, out, Settings(tables={"T": Table(props=("V",))}))
    assert _rows(out, "SELECT props FROM node ORDER BY nid") == [
        ('{"V":9007199254740991}',),
        ('{"V":"9007199254740992"}',),
        ('{"V":-9007199254740991}',),
        ('{"V":"-9007199254740992"}',),
        ('{"V":"9223372036854775807"}',),
    ]
    assert _violations(out) == []


def test_a_real_with_an_integer_value_beyond_the_exact_range_is_not_written_broken(
    tmp_path: Path,
) -> None:
    # Section 3.1 says an *integer* outside +/-(2^53 - 1) is a string; a REAL such as 1.2e20 is a
    # finite double whose RFC 8785 text is plain digits. The spec does not say which it is, so
    # either a valid tessera or a refusal naming the row is accepted, never a broken file.
    db = _database(
        tmp_path / "big.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, V REAL);",
        "INSERT INTO T VALUES (1, 123456789012345680000.0);",
    )
    out = tmp_path / "big.tessera"
    try:
        build(db, out, Settings(tables={"T": Table(props=("V",))}))
    except ValueError as e:
        assert "'V'" in str(e) or "1" in str(e)
        assert not out.exists()
        return
    assert _violations(out) == []


@pytest.mark.parametrize("literal", ["9e999", "-9e999"])
def test_an_infinite_real_is_refused_naming_the_row_and_column(
    tmp_path: Path, literal: str
) -> None:
    # Section 3.1 (I-JSON): no number outside the range of an IEEE 754 double.
    db = _database(
        tmp_path / "inf.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, V REAL);",
        f"INSERT INTO T VALUES (1, {literal});",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table(props=("V",))}), r"row 1.*'V'")


@pytest.mark.parametrize("blob", ["X'ff'", "X'c328'", "X'eda080'", "X'f4908080'"])
def test_text_that_is_not_utf8_is_refused_naming_the_row(tmp_path: Path, blob: str) -> None:
    # Section 3.1 (I-JSON): no unpaired surrogates; ED A0 80 encodes one.
    db = _database(
        tmp_path / "bad.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, S TEXT);",
        f"INSERT INTO T VALUES (1, CAST({blob} AS TEXT));",
    )
    _refused(tmp_path, db, Settings(tables={"T": Table(props=("S",))}), r"bad\.db")


# --- foreign keys (section 4.1) ------------------------------------------------------------

PARENT = "CREATE TABLE P (Id INTEGER PRIMARY KEY);INSERT INTO P VALUES (1), (2);"


def test_a_foreign_key_declared_at_table_level_is_an_edge(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "t.db",
        PARENT + "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId INTEGER,"
        " FOREIGN KEY (PId) REFERENCES P (Id) ON DELETE CASCADE);",
        "INSERT INTO C VALUES (9, 2);",
    )
    out = tmp_path / "t.tessera"
    build(db, out, Settings(tables={"P": Table(), "C": Table(foreign_keys={"PId": "in_p"})}))
    edges = _rows(
        out,
        "SELECT s.id, e.type, d.id FROM edge e"
        " JOIN node s ON s.nid = e.src JOIN node d ON d.nid = e.dst",
    )
    assert edges == [("C:9", "in_p", "P:2")]
    assert _violations(out) == []


def test_two_columns_with_one_edge_name_to_the_same_row_keep_both_citations(
    tmp_path: Path,
) -> None:
    # Section 3.4: an edge is (src, type, dst, qualifier); both columns cite the one fact.
    db = _database(
        tmp_path / "two.db",
        PARENT + "CREATE TABLE C (Id INTEGER PRIMARY KEY,"
        " A INTEGER REFERENCES P, B INTEGER REFERENCES P);",
        "INSERT INTO C VALUES (5, 1, 1);",
    )
    out = tmp_path / "two.tessera"
    settings = Settings(
        tables={"P": Table(), "C": Table(foreign_keys={"A": "has_p", "B": "has_p"})}
    )
    try:
        build(db, out, settings)
    except ValueError:
        assert not out.exists()  # refusing is allowed; a broken file is not
        return
    assert _violations(out) == []
    fields = sorted(
        str(loc) for (loc,) in _rows(out, "SELECT locator FROM evidence WHERE eid IS NOT NULL")
    )
    assert fields == [
        "file=two.db;table=C;row=5;field=A",
        "file=two.db;table=C;row=5;field=B",
    ]


# --- evidence at scale and determinism (sections 3.5, 4.3) ---------------------------------


def test_the_order_tables_are_named_in_does_not_change_the_hash(tmp_path: Path) -> None:
    db = _database(tmp_path / "o.db", PARENT + "CREATE TABLE Q (Id INTEGER PRIMARY KEY);")
    forward = Settings(tables={"P": Table(), "Q": Table()})
    backward = Settings(tables={"Q": Table(), "P": Table()})
    a = build(db, tmp_path / "a.tessera", forward)
    b = build(db, tmp_path / "b.tessera", backward)
    assert a.knowledge_hash == b.knowledge_hash
    assert forward.as_json() == backward.as_json()


# --- the source: path, kind, damage (principle 8; sections 4.1, 10) ------------------------


def test_a_path_with_uri_characters_is_read(tmp_path: Path) -> None:
    folder = tmp_path / "a b#c?d%20e"
    folder.mkdir()
    db = _database(
        folder / "we#ird?na%me.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY);",
        "INSERT INTO T VALUES (1);",
    )
    before = db.read_bytes()
    out = tmp_path / "uri.tessera"
    build(db, out, Settings(tables={"T": Table()}))
    assert _rows(out, "SELECT count(*) FROM node") == [(1,)]
    assert _rows(out, "SELECT path FROM source") == [("we#ird?na%me.db",)]
    assert db.read_bytes() == before
    assert sorted(p.name for p in folder.iterdir()) == ["we#ird?na%me.db"]


def test_a_missing_database_is_an_error_and_is_not_created(tmp_path: Path) -> None:
    missing = tmp_path / "missing.db"
    out = tmp_path / "out.tessera"
    with pytest.raises((ValueError, OSError), match=r"missing\.db"):
        build(missing, out, Settings(tables={"T": Table()}))
    assert not missing.exists()
    assert not out.exists()
    assert list(tmp_path.iterdir()) == []


def test_an_empty_file_is_refused_naming_it_and_left_empty(tmp_path: Path) -> None:
    empty = tmp_path / "empty.db"
    empty.write_bytes(b"")
    _refused(tmp_path, empty, Settings(tables={"T": Table()}), r"empty\.db")
    assert empty.read_bytes() == b""
    assert sorted(p.name for p in tmp_path.iterdir()) == ["empty.db"]


def test_a_tessera_given_as_the_source_is_refused(tmp_path: Path) -> None:
    # Section 4.1 and ADR-003: a source MUST NOT be a tessera or a mosaic.
    base = _database(
        tmp_path / "base.db", "CREATE TABLE T (K INTEGER PRIMARY KEY);", "INSERT INTO T VALUES (1);"
    )
    made = build(base, tmp_path / "made.tessera", Settings(tables={"T": Table()}))
    source = tmp_path / "x.db"
    shutil.copyfile(made.path, source)
    _refused(
        tmp_path,
        source,
        Settings(tables={"node": Table(type="Node")}),
        r"x\.db.*tessera",
    )


def _valid_or_refused(tmp_path: Path, db: Path, settings: Settings) -> Path | None:
    """A build either gives a valid tessera or refuses cleanly; never a broken file."""
    out = tmp_path / "either.tessera"
    try:
        build(db, out, settings)
    except ValueError:
        assert not out.exists()
        return None
    assert _violations(out) == []
    return out


# --- the locator is ';'-separated (section 3.5): no name in it may break it ----------------


def test_a_table_name_holding_a_semicolon_does_not_break_the_locator(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "t.db",
        'CREATE TABLE "a;row=9" (K INTEGER PRIMARY KEY);',
        'INSERT INTO "a;row=9" VALUES (1);',
    )
    out = _valid_or_refused(tmp_path, db, Settings(tables={"a;row=9": Table(type="T")}))
    if out is not None:
        for (loc,) in _rows(out, "SELECT locator FROM evidence"):
            pairs = str(loc).split(";")
            assert all("=" in p for p in pairs), loc
            assert [p.split("=", 1)[0] for p in pairs].count("row") == 1, loc


def test_a_foreign_key_column_holding_a_semicolon_does_not_break_the_locator(
    tmp_path: Path,
) -> None:
    db = _database(
        tmp_path / "c.db",
        PARENT + 'CREATE TABLE C (Id INTEGER PRIMARY KEY, "x;y=z" INTEGER REFERENCES P);',
        "INSERT INTO C VALUES (5, 1);",
    )
    out = _valid_or_refused(
        tmp_path, db, Settings(tables={"P": Table(), "C": Table(foreign_keys={"x;y=z": "of"})})
    )
    if out is not None:
        for (loc,) in _rows(out, "SELECT locator FROM evidence"):
            assert all("=" in p for p in str(loc).split(";")), loc


def test_a_file_name_holding_a_semicolon_does_not_break_the_locator(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "a;table=Z.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY);",
        "INSERT INTO T VALUES (1);",
    )
    out = _valid_or_refused(tmp_path, db, Settings(tables={"T": Table()}))
    if out is not None:
        for (loc,) in _rows(out, "SELECT locator FROM evidence"):
            names = [p.split("=", 1)[0] for p in str(loc).split(";")]
            assert names.count("table") == 1, loc


# --- which "tables" the settings may name (section 4.1: tables only) -----------------------


def test_a_view_named_in_the_settings_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "v.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY);CREATE VIEW W AS SELECT K FROM T;",
        "INSERT INTO T VALUES (1);",
    )
    _refused(tmp_path, db, Settings(tables={"W": Table()}), r"v\.db.*'W'")


def test_a_virtual_table_named_in_the_settings_is_refused(tmp_path: Path) -> None:
    db = tmp_path / "f.db"
    con = sqlite3.connect(db)
    try:
        con.execute("CREATE VIRTUAL TABLE F USING fts5(body)")
    except sqlite3.OperationalError:
        pytest.skip("this SQLite has no FTS5")
    con.execute("INSERT INTO F VALUES ('x')")
    con.commit()
    con.close()
    _refused(tmp_path, db, Settings(tables={"F": Table(props=("body",))}), r"f\.db.*'F'")


# --- keys that SQLite keeps apart but the text key would merge (sections 3.4, 4.1) ---------


def test_integer_one_and_text_one_in_an_untyped_key_column_are_two_rows_with_one_key(
    tmp_path: Path,
) -> None:
    # SQLite keeps 1 and '1' apart in a column with no affinity; as text keys they are equal and
    # (type, key) is unique, so the builder must refuse (the docs: "two rows with the same key").
    db = _database(
        tmp_path / "dup.db",
        "CREATE TABLE T (K PRIMARY KEY);",
        "INSERT INTO T VALUES (1), ('1');",
    )
    assert _valid_or_refused(tmp_path, db, Settings(tables={"T": Table()})) is None


# --- foreign keys (section 4.1) ------------------------------------------------------------


def test_a_text_foreign_key_value_names_the_integer_key_it_equals_in_a_join(
    tmp_path: Path,
) -> None:
    # The docs: values are "compared as SQLite compares them in a join" (column affinity).
    db = _database(
        tmp_path / "aff.db",
        PARENT + "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId TEXT REFERENCES P);",
        "INSERT INTO C VALUES (5, '2');",
    )
    out = tmp_path / "aff.tessera"
    build(db, out, Settings(tables={"P": Table(), "C": Table(foreign_keys={"PId": "in_p"})}))
    assert _rows(
        out,
        "SELECT s.id, d.id FROM edge e JOIN node s ON s.nid = e.src JOIN node d ON d.nid = e.dst",
    ) == [("C:5", "P:2")]
    assert _violations(out) == []


def test_a_foreign_key_of_a_column_with_only_null_still_declares_its_edge_type(
    tmp_path: Path,
) -> None:
    # Docs: a foreign key the settings name "gives one edge type"; no edge needs to exist.
    db = _database(
        tmp_path / "nulls.db",
        PARENT + "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId INTEGER REFERENCES P);",
        "INSERT INTO C VALUES (1, NULL), (2, NULL);",
    )
    out = tmp_path / "nulls.tessera"
    build(db, out, Settings(tables={"P": Table(), "C": Table(foreign_keys={"PId": "in_p"})}))
    assert _rows(out, "SELECT count(*) FROM edge") == [(0,)]
    assert _rows(out, "SELECT name, from_type, to_type FROM type WHERE kind = 'edge'") == [
        ("in_p", "C", "P")
    ]
    assert _violations(out) == []


def test_a_composite_foreign_key_is_refused_naming_the_column(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "comp.db",
        "CREATE TABLE P (A INTEGER, B INTEGER, PRIMARY KEY (A, B));"
        "CREATE TABLE C (Id INTEGER PRIMARY KEY, A INTEGER, B INTEGER,"
        " FOREIGN KEY (A, B) REFERENCES P (A, B));",
        "",
    )
    _refused(
        tmp_path,
        db,
        Settings(tables={"C": Table(foreign_keys={"A": "in_p"})}),
        r"comp\.db.*(?:'A'|'C'|'P')",
    )


def test_a_column_with_two_foreign_keys_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "dbl.db",
        "CREATE TABLE P (Id INTEGER PRIMARY KEY);CREATE TABLE Q (Id INTEGER PRIMARY KEY);"
        "CREATE TABLE C (Id INTEGER PRIMARY KEY, X INTEGER REFERENCES P,"
        " FOREIGN KEY (X) REFERENCES Q (Id));",
    )
    _refused(
        tmp_path,
        db,
        Settings(tables={"P": Table(), "Q": Table(), "C": Table(foreign_keys={"X": "in"})}),
        r"dbl\.db.*'X'",
    )


# --- props, labels, settings that repeat or overlap ----------------------------------------


def test_a_column_named_twice_in_props_is_valid_or_refused(tmp_path: Path) -> None:
    # Section 3.1 (I-JSON): no duplicate object keys.
    db = _database(
        tmp_path / "d.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, V TEXT);",
        "INSERT INTO T VALUES (1, 'x');",
    )
    out = _valid_or_refused(tmp_path, db, Settings(tables={"T": Table(props=("V", "V"))}))
    if out is not None:
        assert _rows(out, "SELECT props FROM node") == [('{"V":"x"}',)]


@pytest.mark.parametrize(
    ("label", "word"),
    [
        ('He said "hi', "said"),
        ("AND OR NOT ( ) *", "AND"),
        ("NEAR(a b", "NEAR"),
        ("col:val", "val"),
        ("a' OR 1=1 --", "OR"),
        ("caf\u00e9 \U0001f600 end", "end"),
    ],
)
def test_a_label_holding_search_syntax_is_indexed_as_text(
    tmp_path: Path, label: str, word: str
) -> None:
    # Section 3.2: the search index holds the label; it is data, not a query.
    db = tmp_path / "fts.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE T (K INTEGER PRIMARY KEY, L TEXT)")
    con.execute("INSERT INTO T VALUES (1, ?)", (label,))
    con.commit()
    con.close()
    out = tmp_path / "fts.tessera"
    build(db, out, Settings(tables={"T": Table(label="L")}))
    assert _rows(out, "SELECT label FROM node") == [(label,)]
    assert _rows(out, f"SELECT rowid FROM search WHERE search MATCH '\"{word}\"'") == [(1,)]
    assert _violations(out) == []


def test_a_node_without_label_or_summary_still_has_a_search_row(tmp_path: Path) -> None:
    # Section 3.2: one search row per node, rowid = nid; a column with nothing to hold is NULL.
    db = _database(
        tmp_path / "ns.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, L TEXT);",
        "INSERT INTO T VALUES (1, 'one'), (2, NULL), (3, 'three');",
    )
    out = tmp_path / "ns.tessera"
    build(db, out, Settings(tables={"T": Table(label="L")}))
    assert _rows(out, "SELECT rowid FROM search ORDER BY rowid") == [(1,), (2,), (3,)]
    assert _rows(out, "SELECT rowid FROM search WHERE search MATCH 'three'") == [(3,)]
    assert _violations(out) == []


@pytest.mark.parametrize(
    ("values", "kind"),
    [
        ("1, 2, 3", "integer"),
        ("1, 2.5", "number"),
        ("1, 'a'", "json"),
        ("2.5, 'a'", "json"),
        ("NULL, NULL", "text"),
    ],
)
def test_a_column_declares_the_kind_its_values_have(tmp_path: Path, values: str, kind: str) -> None:
    # Section 3.4: declared properties map a name to a kind; values SHOULD match.
    rows = ", ".join(f"({i}, {v})" for i, v in enumerate(values.split(", "), start=1))
    db = _database(
        tmp_path / "kind.db",
        "CREATE TABLE T (K INTEGER PRIMARY KEY, V);",
        f"INSERT INTO T VALUES {rows};",
    )
    out = tmp_path / "kind.tessera"
    build(db, out, Settings(tables={"T": Table(props=("V",))}))
    ((declared,),) = _rows(out, "SELECT props FROM type WHERE kind = 'node'")
    assert json.loads(str(declared)) == {"V": kind}
    assert _violations(out) == []


# --- the source is never touched (principle 8) ---------------------------------------------


def test_the_output_path_being_the_source_is_refused_and_the_source_is_untouched(
    tmp_path: Path,
) -> None:
    db = _database(
        tmp_path / "same.db", "CREATE TABLE T (K INTEGER PRIMARY KEY);", "INSERT INTO T VALUES (1);"
    )
    before = db.read_bytes()
    with pytest.raises((ValueError, OSError)):
        build(db, db, Settings(tables={"T": Table()}))
    assert db.read_bytes() == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["same.db"]


def test_a_failed_build_leaves_nothing_beside_the_source_or_the_output(tmp_path: Path) -> None:
    # A late failure (second row) must not leave a partial output or temporary file.
    folder = tmp_path / "work"
    folder.mkdir()
    db = _database(
        folder / "late.db",
        PARENT + "CREATE TABLE C (Id INTEGER PRIMARY KEY, PId INTEGER REFERENCES P);",
        "INSERT INTO C VALUES (1, 1), (2, 99);",
    )
    with pytest.raises(ValueError, match=r"late\.db"):
        build(
            db,
            folder / "late.tessera",
            Settings(tables={"P": Table(), "C": Table(foreign_keys={"PId": "in_p"})}),
        )
    assert sorted(p.name for p in folder.iterdir()) == ["late.db"]
