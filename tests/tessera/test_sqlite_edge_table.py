"""A table whose primary key is two foreign keys gives edges (sections 3.4, 3.5, 4.1).

The maintainer's answer (reading 2): such a table gives no node. Each row gives one
edge, from the row named by the first key column to the row named by the second. The table's
entry in the settings names the edge type, and the row's other columns are the edge's props.
The evidence locator is ``file=<name>;table=<table>;row=<first>/<second>``, with no ``field``.
A key of several columns that is not exactly two foreign keys is still refused, and so is a key
value that holds ``/``.
"""

import json
import re
import sqlite3
from pathlib import Path

import mosaic_format
import pytest
from mosaic_build import __version__
from mosaic_build.cli import main
from mosaic_build.tessera.sqlite import (
    SettingError,
    Settings,
    Table,
    build,
    check_settings,
)
from mosaic_format.check import check_file

PRODUCER = f"mosaic-sqlite/{__version__}"

SCHEMA = """
CREATE TABLE Writer (WriterId INTEGER PRIMARY KEY, Name TEXT NOT NULL);
CREATE TABLE Volume (VolumeId INTEGER PRIMARY KEY, Title TEXT NOT NULL);
CREATE TABLE Credit (
    WriterId INTEGER NOT NULL REFERENCES Writer (WriterId),
    VolumeId INTEGER NOT NULL REFERENCES Volume (VolumeId),
    Role     TEXT,
    Share    REAL,
    PRIMARY KEY (WriterId, VolumeId)
);
"""

ROWS = """
INSERT INTO Writer VALUES (1, 'Ada Quill'), (2, 'Bo Lark');
INSERT INTO Volume VALUES (10, 'Salt Roads'), (11, 'Quiet Hours');
INSERT INTO Credit VALUES (1, 10, 'author', 0.5), (2, 10, 'editor', NULL), (2, 11, NULL, 1.0);
"""

SETTINGS = Settings(
    tables={
        "Writer": Table(label="Name"),
        "Volume": Table(label="Title"),
        "Credit": Table(edge="credited"),
    }
)


def _database(path: Path, schema: str = SCHEMA, rows: str = ROWS) -> Path:
    con = sqlite3.connect(path)
    con.executescript(schema + rows)
    con.commit()
    con.close()
    return path


def _rows(path: Path, sql: str) -> list[tuple[object, ...]]:
    with mosaic_format.open(path) as f:
        return f.query(sql)


@pytest.fixture
def built(tmp_path: Path) -> Path:
    db = _database(tmp_path / "credits.db")
    out = tmp_path / "credits.tessera"
    build(db, out, SETTINGS)
    return out


def _refused(tmp_path: Path, db: Path, settings: Settings, match: str) -> None:
    out = tmp_path / "refused.tessera"
    with pytest.raises(ValueError, match=match or None):
        build(db, out, settings)
    assert not out.exists()


# --- what the table gives -------------------------------------------------------------------


def test_each_row_is_one_edge_from_the_first_key_columns_row_to_the_seconds(built: Path) -> None:
    edges = _rows(built, "SELECT type, src, dst, qualifier, props FROM v_edge ORDER BY src, dst")
    assert edges == [
        ("credited", "Writer:1", "Volume:10", "", '{"Role":"author","Share":0.5}'),
        ("credited", "Writer:2", "Volume:10", "", '{"Role":"editor"}'),
        ("credited", "Writer:2", "Volume:11", "", '{"Share":1}'),
    ]


def test_the_table_gives_no_node_and_no_node_type(built: Path) -> None:
    assert _rows(built, "SELECT id FROM node ORDER BY id") == [
        ("Volume:10",),
        ("Volume:11",),
        ("Writer:1",),
        ("Writer:2",),
    ]
    assert _rows(built, "SELECT count(*) FROM type WHERE name = 'Credit'") == [(0,)]


def test_the_edge_type_joins_the_two_tables_types_and_declares_the_other_columns(
    built: Path,
) -> None:
    assert _rows(
        built, "SELECT kind, key_prop, from_type, to_type, props FROM type WHERE name = 'credited'"
    ) == [("edge", None, "Writer", "Volume", '{"Role":"text","Share":"number"}')]


def test_each_edge_has_one_evidence_row_naming_the_table_and_the_row_with_no_field(
    built: Path,
) -> None:
    evidence = _rows(
        built,
        "SELECT edge_src, edge_dst, locator, method, producer, confidence, prop FROM v_evidence"
        " WHERE edge_type = 'credited' ORDER BY edge_src, edge_dst",
    )
    assert evidence == [
        ("Writer:1", "Volume:10", "file=credits.db;table=Credit;row=1/10", "extracted",
         PRODUCER, None, None),
        ("Writer:2", "Volume:10", "file=credits.db;table=Credit;row=2/10", "extracted",
         PRODUCER, None, None),
        ("Writer:2", "Volume:11", "file=credits.db;table=Credit;row=2/11", "extracted",
         PRODUCER, None, None),
    ]  # fmt: skip


def test_the_tessera_passes_the_checker(built: Path) -> None:
    assert [str(v) for v in check_file(built).violations] == []


def test_the_direction_follows_the_key_order_not_the_column_order(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "reversed.db",
        SCHEMA.replace("PRIMARY KEY (WriterId, VolumeId)", "PRIMARY KEY (VolumeId, WriterId)"),
    )
    out = tmp_path / "reversed.tessera"
    build(db, out, SETTINGS)
    assert _rows(out, "SELECT from_type, to_type FROM type WHERE name = 'credited'") == [
        ("Volume", "Writer")
    ]
    assert _rows(out, "SELECT src, dst FROM v_edge ORDER BY src, dst") == [
        ("Volume:10", "Writer:1"),
        ("Volume:10", "Writer:2"),
        ("Volume:11", "Writer:2"),
    ]
    assert _rows(
        out, "SELECT locator FROM v_evidence WHERE locator LIKE '%Credit%' ORDER BY 1"
    ) == [
        ("file=reversed.db;table=Credit;row=10/1",),
        ("file=reversed.db;table=Credit;row=10/2",),
        ("file=reversed.db;table=Credit;row=11/2",),
    ]


def test_both_key_columns_may_reference_the_same_table(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "pairs.db",
        "CREATE TABLE Writer (WriterId INTEGER PRIMARY KEY);"
        "CREATE TABLE Knows (A INTEGER REFERENCES Writer, B INTEGER REFERENCES Writer,"
        " PRIMARY KEY (A, B));",
        "INSERT INTO Writer VALUES (1), (2); INSERT INTO Knows VALUES (1, 2), (2, 1);",
    )
    out = tmp_path / "pairs.tessera"
    build(db, out, Settings(tables={"Writer": Table(), "Knows": Table(edge="knows")}))
    assert _rows(out, "SELECT src, dst FROM v_edge ORDER BY src") == [
        ("Writer:1", "Writer:2"),
        ("Writer:2", "Writer:1"),
    ]


def test_text_keys_are_joined_as_written(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "text.db",
        "CREATE TABLE Shelf (Code TEXT PRIMARY KEY); CREATE TABLE Tag (Name TEXT PRIMARY KEY);"
        "CREATE TABLE Tagged (Code TEXT REFERENCES Shelf, Name TEXT REFERENCES Tag,"
        " PRIMARY KEY (Code, Name));",
        "INSERT INTO Shelf VALUES ('A 1'); INSERT INTO Tag VALUES ('old');"
        "INSERT INTO Tagged VALUES ('A 1', 'old');",
    )
    out = tmp_path / "text.tessera"
    build(db, out, Settings(tables={"Shelf": Table(), "Tag": Table(), "Tagged": Table(edge="t")}))
    assert _rows(out, "SELECT src, dst FROM v_edge") == [("Shelf:A 1", "Tag:old")]
    assert _rows(out, "SELECT locator FROM v_evidence WHERE locator LIKE '%Tagged%'") == [
        ("file=text.db;table=Tagged;row=A 1/old",)
    ]


def test_the_settings_record_the_edge_and_the_same_input_gives_the_same_hash(
    tmp_path: Path,
) -> None:
    db = _database(tmp_path / "credits.db")
    first = build(db, tmp_path / "one.tessera", SETTINGS)
    second = build(db, tmp_path / "two.tessera", SETTINGS)
    assert first.knowledge_hash == second.knowledge_hash
    (settings,) = _rows(first.path, "SELECT settings FROM header")[0]
    assert json.loads(str(settings))["tables"]["Credit"] == {"edge": "credited"}


# --- what is refused ------------------------------------------------------------------------


def test_a_key_value_holding_a_slash_is_refused_naming_the_table(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "slash.db",
        "CREATE TABLE Shelf (Code TEXT PRIMARY KEY); CREATE TABLE Tag (Name TEXT PRIMARY KEY);"
        "CREATE TABLE Tagged (Code TEXT REFERENCES Shelf, Name TEXT REFERENCES Tag,"
        " PRIMARY KEY (Code, Name));",
        "INSERT INTO Shelf VALUES ('A/1'); INSERT INTO Tag VALUES ('old');"
        "INSERT INTO Tagged VALUES ('A/1', 'old');",
    )
    settings = Settings(tables={"Shelf": Table(), "Tag": Table(), "Tagged": Table(edge="t")})
    _refused(tmp_path, db, settings, r"slash\.db: table 'Tagged'.*'A/1'.*'/'")


@pytest.mark.parametrize(
    ("value", "match"),
    [("NULL", ""), ("''", ""), ("'a;b'", "';'")],
)
def test_a_key_value_no_locator_can_hold_is_refused(tmp_path: Path, value: str, match: str) -> None:
    db = _database(
        tmp_path / "bad.db",
        "CREATE TABLE Shelf (Code TEXT PRIMARY KEY); CREATE TABLE Tag (Name TEXT PRIMARY KEY);"
        "CREATE TABLE Tagged (Code TEXT REFERENCES Shelf, Name TEXT REFERENCES Tag,"
        " PRIMARY KEY (Code, Name));",
        "INSERT INTO Shelf VALUES ('ok'); INSERT INTO Tag VALUES ('old');"
        f"INSERT INTO Tagged VALUES ({value}, 'old');",
    )
    settings = Settings(tables={"Shelf": Table(), "Tag": Table(), "Tagged": Table(edge="t")})
    _refused(tmp_path, db, settings, rf"bad\.db: table 'Tagged'.*{match}")


def test_a_value_that_names_no_row_is_refused_naming_the_row_and_the_column(
    tmp_path: Path,
) -> None:
    db = _database(
        tmp_path / "dangling.db", rows=ROWS + "INSERT INTO Credit VALUES (1, 99, NULL, NULL);"
    )
    _refused(tmp_path, db, SETTINGS, r"dangling\.db: table 'Credit' row 1/99: 'VolumeId'.*99")


def test_two_rows_that_name_the_same_two_rows_are_refused(tmp_path: Path) -> None:
    # Untyped key columns keep 1 and ' 1' apart; a join compares both equal to Writer 1.
    db = _database(
        tmp_path / "twice.db",
        "CREATE TABLE Writer (WriterId INTEGER PRIMARY KEY);"
        "CREATE TABLE Volume (VolumeId INTEGER PRIMARY KEY);"
        "CREATE TABLE Credit (W REFERENCES Writer, V REFERENCES Volume, PRIMARY KEY (W, V));",
        "INSERT INTO Writer VALUES (1); INSERT INTO Volume VALUES (10);"
        "INSERT INTO Credit VALUES (1, 10), (' 1', 10);",
    )
    settings = Settings({"Writer": Table(), "Volume": Table(), "Credit": Table(edge="credited")})
    _refused(tmp_path, db, settings, r"twice\.db: table 'Credit'.*Writer:1.*Volume:10")


@pytest.mark.parametrize(
    ("schema", "columns"),
    [
        # two columns, one of them no foreign key
        ("CREATE TABLE W (Id INTEGER PRIMARY KEY);"
         "CREATE TABLE T (A INTEGER REFERENCES W, B INTEGER, PRIMARY KEY (A, B));", 2),
        # three columns, each a foreign key
        ("CREATE TABLE W (Id INTEGER PRIMARY KEY);"
         "CREATE TABLE T (A INTEGER REFERENCES W, B INTEGER REFERENCES W,"
         " C INTEGER REFERENCES W, PRIMARY KEY (A, B, C));", 3),
        # two columns that are one foreign key of two columns
        ("CREATE TABLE W (X INTEGER, Y INTEGER, PRIMARY KEY (X, Y));"
         "CREATE TABLE T (A INTEGER, B INTEGER, PRIMARY KEY (A, B),"
         " FOREIGN KEY (A, B) REFERENCES W (X, Y));", 2),
        # two columns with no foreign key at all
        ("CREATE TABLE W (Id INTEGER PRIMARY KEY);"
         "CREATE TABLE T (A INTEGER, B INTEGER, PRIMARY KEY (A, B));", 2),
    ],
)  # fmt: skip
def test_a_key_of_several_columns_that_is_not_two_foreign_keys_is_still_refused(
    tmp_path: Path, schema: str, columns: int
) -> None:
    db = _database(tmp_path / "keys.db", schema, "")
    for t in (Table(), Table(edge="t")):
        _refused(
            tmp_path,
            db,
            Settings(tables={"W": Table(), "T": t}) if "W (Id" in schema else Settings({"T": t}),
            rf"keys\.db: table 'T'.*{columns} columns",
        )


def test_a_table_of_two_foreign_keys_without_an_edge_setting_names_the_setting(
    tmp_path: Path,
) -> None:
    db = _database(tmp_path / "credits.db")
    settings = Settings(tables={"Writer": Table(), "Volume": Table(), "Credit": Table()})
    with pytest.raises(SettingError, match=r"credits\.db: table 'Credit'.*edge") as e:
        build(db, tmp_path / "x.tessera", settings)
    assert e.value.where == ("tables", "Credit")


def test_an_edge_setting_on_a_table_whose_key_is_one_column_names_the_setting(
    tmp_path: Path,
) -> None:
    db = _database(tmp_path / "credits.db")
    settings = Settings(
        tables={"Writer": Table(edge="w"), "Volume": Table(), "Credit": Table(edge="c")}
    )
    with pytest.raises(SettingError, match=r"credits\.db: table 'Writer'") as e:
        build(db, tmp_path / "x.tessera", settings)
    assert e.value.where == ("tables", "Writer", "edge")


def test_a_key_column_whose_table_the_settings_do_not_name_is_refused(tmp_path: Path) -> None:
    db = _database(tmp_path / "credits.db")
    settings = Settings(tables={"Writer": Table(), "Credit": Table(edge="credited")})
    with pytest.raises(SettingError, match=r"'VolumeId'.*'Volume'") as e:
        build(db, tmp_path / "x.tessera", settings)
    assert e.value.where == ("tables", "Credit")


def test_a_foreign_key_to_a_table_that_gives_edges_is_refused(tmp_path: Path) -> None:
    db = _database(
        tmp_path / "chain.db",
        SCHEMA + "CREATE TABLE Note (Id INTEGER PRIMARY KEY, W INTEGER, V INTEGER,"
        " FOREIGN KEY (W) REFERENCES Credit (WriterId));",
    )
    settings = Settings(tables={**SETTINGS.tables, "Note": Table(foreign_keys={"W": "on_credit"})})
    with pytest.raises(SettingError, match=r"'Note'.*'W'.*'Credit'") as e:
        build(db, tmp_path / "x.tessera", settings)
    assert e.value.where == ("tables", "Note", "foreign_keys", "W")


@pytest.mark.parametrize(
    ("table", "setting"),
    [
        (Table(edge="e", type="Credit"), "type"),
        (Table(edge="e", label="Role"), "label"),
        (Table(edge="e", summary="Role"), "summary"),
        (Table(edge="e", props=("Role",)), "props"),
        (Table(edge="e", foreign_keys={"WriterId": "w"}), "foreign_keys"),
    ],
)
def test_an_edge_table_takes_no_node_settings(table: Table, setting: str) -> None:
    with pytest.raises(SettingError, match=rf"tables\.Credit.*{setting}") as e:
        check_settings(Settings(tables={"Credit": table}))
    assert e.value.where == ("tables", "Credit", setting)


@pytest.mark.parametrize("edge", ["Credited", "", "1st", "with space"])
def test_an_edge_setting_that_is_no_edge_type_name_is_refused(edge: str) -> None:
    with pytest.raises(SettingError, match=r"tables\.Credit\.edge") as e:
        check_settings(Settings(tables={"Credit": Table(edge=edge)}))
    assert e.value.where == ("tables", "Credit", "edge")


def test_an_edge_type_named_twice_is_refused() -> None:
    settings = Settings(
        tables={
            "Volume": Table(foreign_keys={"WriterId": "credited"}),
            "Credit": Table(edge="credited"),
        }
    )
    with pytest.raises(SettingError, match=r"tables\.Credit\.edge.*'credited'") as e:
        check_settings(settings)
    assert e.value.where == ("tables", "Credit", "edge")


# --- through the settings file and the CLI ---------------------------------------

SETTINGS_FILE = """\
tables:
  Writer:
    label: Name
  Volume:
    label: Title
  Credit:
    edge: credited
"""


def _import(tmp_path: Path, text: str) -> tuple[int, Path]:
    db = _database(tmp_path / "credits.db")
    settings = tmp_path / "settings.yaml"
    settings.write_text(text, encoding="utf-8")
    out = tmp_path / "out" / "credits.tessera"
    rc = main(["import", "sqlite", str(db), "--settings", str(settings), "-o", str(out)])
    return rc, out


def test_mosaic_import_reads_the_edge_setting_from_the_settings_file(tmp_path: Path) -> None:
    rc, out = _import(tmp_path, SETTINGS_FILE)
    assert rc == 0
    assert _rows(out, "SELECT type, src, dst FROM v_edge ORDER BY src, dst") == [
        ("credited", "Writer:1", "Volume:10"),
        ("credited", "Writer:2", "Volume:10"),
        ("credited", "Writer:2", "Volume:11"),
    ]
    direct = build(tmp_path / "credits.db", tmp_path / "direct.tessera", SETTINGS)
    with mosaic_format.open(out) as f:
        assert f.knowledge_hash == direct.knowledge_hash


def test_a_missing_edge_setting_names_the_settings_file_and_the_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rc, out = _import(tmp_path, SETTINGS_FILE.replace("    edge: credited\n", "    {}\n"))
    assert rc == 1
    assert re.search(r"settings\.yaml:6: .*table 'Credit'.*edge", capsys.readouterr().err)
    assert not out.parent.exists()


def test_a_node_setting_beside_edge_names_the_settings_file_and_the_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rc, out = _import(tmp_path, SETTINGS_FILE + "    label: Role\n")
    assert rc == 1
    assert re.search(r"settings\.yaml:8: .*tables\.Credit\.label", capsys.readouterr().err)
    assert not out.parent.exists()


PARENTS = (
    "CREATE TABLE Writer (WriterId INTEGER PRIMARY KEY, Name TEXT, Code TEXT UNIQUE);"
    "CREATE TABLE Volume (VolumeId INTEGER PRIMARY KEY, Title TEXT);"
)
CREDIT = (
    "CREATE TABLE Credit (WriterId INTEGER REFERENCES Writer, VolumeId INTEGER REFERENCES Volume,"
    " Role TEXT, PRIMARY KEY (WriterId, VolumeId));"
)
PARENT_ROWS = (
    "INSERT INTO Writer VALUES (1, 'Ada', 'x'), (2, 'Bo', 'y');"
    "INSERT INTO Volume VALUES (10, 'Salt'), (11, 'Hours');"
)
PLAIN_SETTINGS = Settings(
    tables={"Writer": Table(), "Volume": Table(), "Credit": Table(edge="credited")}
)


def _plain_database(path: Path, schema: str = PARENTS + CREDIT, rows: str = PARENT_ROWS) -> Path:
    con = sqlite3.connect(path)
    con.executescript(schema + rows)
    con.commit()
    con.close()
    return path


def _violations(path: Path) -> list[str]:
    return [str(v) for v in check_file(path).violations]


# --- empty and looping tables ---------------------------------------------------------------


def test_an_edge_table_with_no_rows_gives_no_edge_and_still_a_valid_tessera(
    tmp_path: Path,
) -> None:
    # Section 3.4: an edge type is declared; the type of an empty table is declared too.
    db = _plain_database(tmp_path / "empty.db")
    out = tmp_path / "empty.tessera"
    build(db, out, PLAIN_SETTINGS)
    assert _rows(out, "SELECT count(*) FROM edge") == [(0,)]
    assert _violations(out) == []
    assert _rows(out, "SELECT from_type, to_type FROM type WHERE name = 'credited'") == [
        ("Writer", "Volume")
    ]


def test_a_foreign_key_on_a_column_outside_the_key_is_a_prop_and_gives_no_edge(
    tmp_path: Path,
) -> None:
    # "the row's other columns become the edge's props": no foreign_keys setting there.
    db = _plain_database(
        tmp_path / "extra.db",
        PARENTS + "CREATE TABLE Press (PressId INTEGER PRIMARY KEY);"
        "CREATE TABLE Credit (WriterId INTEGER REFERENCES Writer,"
        " VolumeId INTEGER REFERENCES Volume, PressId INTEGER REFERENCES Press,"
        " PRIMARY KEY (WriterId, VolumeId));",
        PARENT_ROWS + "INSERT INTO Press VALUES (7); INSERT INTO Credit VALUES (1, 10, 7);",
    )
    out = tmp_path / "extra.tessera"
    build(db, out, Settings(tables={**PLAIN_SETTINGS.tables, "Press": Table()}))
    assert _rows(out, "SELECT type, src, dst, props FROM v_edge") == [
        ("credited", "Writer:1", "Volume:10", '{"PressId":7}')
    ]


# --- values -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "match"),
    [
        ("'a' || char(0) || 'b'", r"U\+0000"),
        ("X'00ff'", "blob"),
        ("9e999", r"'Role'"),
        ("-9e999", r"'Role'"),
        ("CAST(X'ff' AS TEXT)", r"bad\.db"),
        ("CAST(X'eda080' AS TEXT)", r"bad\.db"),
    ],
)
def test_a_prop_value_a_tessera_cannot_hold_is_refused_naming_the_database(
    tmp_path: Path, value: str, match: str
) -> None:
    # Section 3.1 (no U+0000, I-JSON numbers, UTF-8 text); same refusals as for a node table.
    db = _plain_database(
        tmp_path / "bad.db",
        PARENTS + "CREATE TABLE Credit (WriterId INTEGER REFERENCES Writer,"
        " VolumeId INTEGER REFERENCES Volume, Role, PRIMARY KEY (WriterId, VolumeId));",
        PARENT_ROWS + f"INSERT INTO Credit VALUES (1, 10, {value});",
    )
    _refused(tmp_path, db, PLAIN_SETTINGS, match)


def test_a_row_with_only_null_other_columns_has_no_props(tmp_path: Path) -> None:
    db = _plain_database(
        tmp_path / "n.db", rows=PARENT_ROWS + "INSERT INTO Credit VALUES (1, 10, NULL);"
    )
    out = tmp_path / "n.tessera"
    build(db, out, PLAIN_SETTINGS)
    props = _rows(out, "SELECT props FROM edge")[0][0]
    assert props in (None, "{}")  # section 3.4: props is a JSON object or NULL
    assert _violations(out) == []


# --- several edge tables ---------------------------------------------------------------------


def test_two_edge_tables_with_one_edge_type_name_are_refused() -> None:
    settings = Settings(tables={"Credit": Table(edge="linked"), "Other": Table(edge="linked")})
    with pytest.raises(SettingError, match=r"'linked'") as e:
        check_settings(settings)
    assert e.value.where[:1] == ("tables",)


def test_two_edge_tables_between_the_same_two_rows_keep_both_edges_and_their_evidence(
    tmp_path: Path,
) -> None:
    db = _plain_database(
        tmp_path / "two.db",
        PARENTS + CREDIT + "CREATE TABLE Review (WriterId INTEGER REFERENCES Writer,"
        " VolumeId INTEGER REFERENCES Volume, PRIMARY KEY (WriterId, VolumeId));",
        PARENT_ROWS + "INSERT INTO Credit VALUES (1, 10, 'a'); INSERT INTO Review VALUES (1, 10);",
    )
    out = tmp_path / "two.tessera"
    build(db, out, Settings(tables={**PLAIN_SETTINGS.tables, "Review": Table(edge="reviewed")}))
    assert _rows(out, "SELECT type, src, dst, qualifier FROM v_edge ORDER BY type") == [
        ("credited", "Writer:1", "Volume:10", ""),
        ("reviewed", "Writer:1", "Volume:10", ""),
    ]
    assert _rows(out, "SELECT locator FROM v_evidence WHERE edge_type IS NOT NULL ORDER BY 1") == [
        ("file=two.db;table=Credit;row=1/10",),
        ("file=two.db;table=Review;row=1/10",),
    ]


# --- the settings file and the command ---------------------------------------------------------

FILE = "tables:\n  Writer: {}\n  Volume: {}\n  Credit:\n    edge: VALUE\n"


def _import_file(tmp_path: Path, settings_text: str, db: Path | None = None) -> tuple[int, Path]:
    db = db or _plain_database(
        tmp_path / "c.db", rows=PARENT_ROWS + "INSERT INTO Credit VALUES (1, 10, 'a');"
    )
    settings = tmp_path / "s.yaml"
    settings.write_text(settings_text, encoding="utf-8")
    out = tmp_path / "out" / "c.tessera"
    return main(["import", "sqlite", str(db), "--settings", str(settings), "-o", str(out)]), out


@pytest.mark.parametrize("value", ["5", "true", "[a]", "{a: b}", "''", "Credited", "a-b"])
def test_an_edge_that_is_no_edge_type_name_in_the_file_names_file_line_and_setting(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], value: str
) -> None:
    rc, out = _import_file(tmp_path, FILE.replace("VALUE", value))
    assert rc == 1
    err = capsys.readouterr().err
    assert "s.yaml:5" in err and "edge" in err
    assert not out.parent.exists()


def test_an_edge_left_empty_in_the_file_is_the_same_as_no_edge(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rc, out = _import_file(tmp_path, FILE.replace("VALUE", ""))
    assert rc == 1
    assert "s.yaml" in capsys.readouterr().err
    assert not out.parent.exists()


def test_the_command_refuses_a_slash_in_a_key_with_exit_1_naming_table_and_database(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    db = _plain_database(
        tmp_path / "s.db",
        "CREATE TABLE Shelf (Code PRIMARY KEY); CREATE TABLE Tag (Name PRIMARY KEY);"
        "CREATE TABLE Tagged (Code REFERENCES Shelf, Name REFERENCES Tag,"
        " PRIMARY KEY (Code, Name));",
        "INSERT INTO Shelf VALUES ('A/1'); INSERT INTO Tag VALUES ('t');"
        " INSERT INTO Tagged VALUES ('A/1', 't');",
    )
    rc, out = _import_file(
        tmp_path, "tables:\n  Shelf: {}\n  Tag: {}\n  Tagged:\n    edge: t\n", db
    )
    err = capsys.readouterr().err
    assert rc == 1
    assert "Tagged" in err and "s.db" in err
    assert not out.parent.exists()
