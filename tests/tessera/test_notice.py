"""A tessera's notice, set in its import settings (sections 3.2, 4.1, 7.2, 10).

The maintainer's answer: the Chinook mosaic carries its source's MIT notice, named in the
import settings. ``mosaic import csv`` and ``mosaic import sqlite`` read an optional ``notice``
setting. The tessera's one source row has that notice and ``header.settings`` records it. Without
it the notice is NULL and the tessera is as before. A mosaic built from such a tessera copies the
source row with its notice (section 3.2), and the build report lists it (section 7.2).
"""

import json
import re
import sqlite3
from pathlib import Path

import mosaic_format
import pytest
from mosaic_build.cli import main
from mosaic_build.tessera import csv, sqlite

NOTICE = "Invented Data. Copyright (c) 2026 Ada Quill. MIT License."

CSV_SETTINGS = """\
type: Thing
key: id
label: name
props: [name]
"""

SQLITE_SETTINGS = """\
tables:
  Thing:
    label: name
    props: [name]
"""


def _csv(directory: Path) -> Path:
    path = directory / "things.csv"
    path.write_text("id,name\n1,Alpha\n2,Beta\n", encoding="utf-8")
    return path


def _db(directory: Path) -> Path:
    path = directory / "things.db"
    con = sqlite3.connect(path)
    con.executescript(
        "CREATE TABLE Thing (id INTEGER PRIMARY KEY, name TEXT);"
        "CREATE TABLE Other (id INTEGER PRIMARY KEY, name TEXT);"
        "INSERT INTO Thing VALUES (1, 'Alpha'), (2, 'Beta');"
        "INSERT INTO Other VALUES (1, 'Gamma');"
    )
    con.commit()
    con.close()
    return path


KINDS = {
    "csv": (_csv, CSV_SETTINGS),
    "sqlite": (_db, SQLITE_SETTINGS),
}


def _import(tmp_path: Path, kind: str, settings: str) -> tuple[int, Path]:
    make, _ = KINDS[kind]
    tmp_path.mkdir(parents=True, exist_ok=True)
    source = make(tmp_path)
    path = tmp_path / "settings.yaml"
    path.write_text(settings, encoding="utf-8")
    out = tmp_path / "pieces" / "things.tessera"
    rc = main(["import", kind, str(source), "--settings", str(path), "-o", str(out)])
    return rc, out


def _rows(path: Path, sql: str) -> list[tuple[object, ...]]:
    with mosaic_format.open(path) as f:
        return f.query(sql)


def _with_notice(settings: str, notice: str = json.dumps(NOTICE)) -> str:
    return f"notice: {notice}\n" + settings


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_the_notice_setting_is_the_notice_of_the_one_source_row(tmp_path: Path, kind: str) -> None:
    rc, out = _import(tmp_path, kind, _with_notice(KINDS[kind][1]))
    assert rc == 0
    assert _rows(out, "SELECT notice FROM source") == [(NOTICE,)]


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_the_header_settings_record_the_notice(tmp_path: Path, kind: str) -> None:
    _, out = _import(tmp_path, kind, _with_notice(KINDS[kind][1]))
    ((settings,),) = _rows(out, "SELECT settings FROM header")
    assert json.loads(str(settings))["notice"] == NOTICE


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_the_header_settings_as_a_settings_file_give_the_same_tessera(
    tmp_path: Path, kind: str
) -> None:
    _, first = _import(tmp_path / "a", kind, _with_notice(KINDS[kind][1]))
    ((settings,),) = _rows(first, "SELECT settings FROM header")
    _, second = _import(tmp_path / "b", kind, str(settings))
    with mosaic_format.open(first) as a, mosaic_format.open(second) as b:
        assert a.knowledge_hash == b.knowledge_hash


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_without_a_notice_the_notice_is_null_and_the_settings_do_not_name_it(
    tmp_path: Path, kind: str
) -> None:
    _, out = _import(tmp_path, kind, KINDS[kind][1])
    assert _rows(out, "SELECT notice FROM source") == [(None,)]
    ((settings,),) = _rows(out, "SELECT settings FROM header")
    assert "notice" not in json.loads(str(settings))


def test_without_a_notice_the_settings_json_is_as_before() -> None:
    """A tessera without a notice keeps its hash: header.settings has no new key."""
    assert "notice" not in json.loads(csv.Settings().as_json())
    assert "notice" not in json.loads(sqlite.Settings().as_json())


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_the_notice_changes_the_knowledge_hash(tmp_path: Path, kind: str) -> None:
    _, plain = _import(tmp_path / "a", kind, KINDS[kind][1])
    _, noticed = _import(tmp_path / "b", kind, _with_notice(KINDS[kind][1]))
    with mosaic_format.open(plain) as a, mosaic_format.open(noticed) as b:
        assert a.knowledge_hash != b.knowledge_hash


def test_a_notice_keeps_its_text_as_written(tmp_path: Path) -> None:
    notice = "Données inventées.\nLigne deux, avec  deux espaces."
    _, out = _import(tmp_path, "csv", _with_notice(CSV_SETTINGS, json.dumps(notice)))
    assert _rows(out, "SELECT notice FROM source") == [(notice,)]


@pytest.mark.parametrize("kind", sorted(KINDS))
@pytest.mark.parametrize(
    ("value", "match"),
    [
        ("5", "notice"),
        ("[a]", "notice"),
        ("null", "notice"),
        ('""', "notice"),
        ('"a\\u0000b"', "U\\+0000"),
    ],
)
def test_a_notice_that_is_not_text_is_empty_or_holds_nul_names_the_file_and_the_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str, value: str, match: str
) -> None:
    rc, out = _import(tmp_path, kind, KINDS[kind][1] + f"notice: {value}\n")
    assert rc == 1
    err = capsys.readouterr().err
    assert "settings.yaml:5: " in err, err
    assert "notice" in err
    assert re.search(match, err), err
    assert not out.exists()


# --- the mosaic carries it (sections 3.2, 7.2) ----------------------------------------------


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_a_mosaic_built_from_the_tessera_carries_the_notice(tmp_path: Path, kind: str) -> None:
    _, tessera = _import(tmp_path, kind, _with_notice(KINDS[kind][1]))
    with mosaic_format.open(tessera) as t:
        piece = t.knowledge_hash
    pattern = tmp_path / "pattern.yaml"
    pattern.write_text(
        'format: "0.1"\n'
        f"pieces:\n  - things@{piece}\n"
        "types:\n"
        "  Thing:\n"
        "    key: id\n"
        "    describe: An invented thing\n"
        "    from:\n"
        "      things.Thing: {id: key}\n"
        "mosaics:\n  small: {vectors: false}\n",
        encoding="utf-8",
    )
    out = tmp_path / "out"
    args = ["build", str(pattern), "--target", "small", "--pieces", str(tessera.parent)]
    assert main([*args, "-o", str(out)]) == 0
    source = "things.csv" if kind == "csv" else "things.db"
    assert _rows(out / "small.mosaic", "SELECT id, notice FROM source ORDER BY id") == [
        ("things", None),
        (f"things/{source}", NOTICE),
    ]
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    assert report["notices"] == [{"piece": "things", "text": NOTICE}]


BOTH = sorted(KINDS)


def _imported(directory: Path, kind: str, settings: str | bytes, name: str = "things") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    make, _ = KINDS[kind]
    source = make(directory)
    path = directory / "settings.yaml"
    path.write_bytes(settings if isinstance(settings, bytes) else settings.encode("utf-8"))
    out = directory / "pieces" / f"{name}.tessera"
    rc = main(["import", kind, str(source), "--settings", str(path), "-o", str(out)])
    assert rc == 0
    return out


def _refuse(
    directory: Path, kind: str, settings: str | bytes, capsys: pytest.CaptureFixture[str]
) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    make, _ = KINDS[kind]
    source = make(directory)
    path = directory / "settings.yaml"
    path.write_bytes(settings if isinstance(settings, bytes) else settings.encode("utf-8"))
    out = directory / "pieces" / "things.tessera"
    rc = main(["import", kind, str(source), "--settings", str(path), "-o", str(out)])
    captured = capsys.readouterr()
    assert rc == 1, captured.err
    assert captured.out == "", captured.out
    assert "Traceback" not in captured.err, captured.err
    assert not out.exists()
    return captured.err


def _hash(path: Path) -> str:
    with mosaic_format.open(path) as f:
        return f.knowledge_hash


def _quoted(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)  # a YAML double-quoted scalar


# --- values that are not text, empty or hold U+0000 (Done when 2; section 3.1) ------------------


@pytest.mark.parametrize("kind", BOTH)
@pytest.mark.parametrize(
    "value",
    ["true", "false", "1.5", "2026", "{a: 1}", "[]", "~", "{}", "0", "-1", ".inf", "[a, b]"],
)
def test_a_notice_of_another_kind_than_text_is_an_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str, value: str
) -> None:
    # Done when 2: "a notice that is not text". An unquoted 2026 or true is a number or a boolean.
    err = _refuse(tmp_path, kind, KINDS[kind][1] + f"notice: {value}\n", capsys)
    assert "settings.yaml:5: " in err, err
    assert "notice" in err


@pytest.mark.parametrize("kind", BOTH)
@pytest.mark.parametrize("value", ['"2026"', '"true"', '"null"', '"0"'])
def test_a_quoted_scalar_that_looks_like_another_kind_is_text(
    tmp_path: Path, kind: str, value: str
) -> None:
    # Done when 1: text is text however it reads.
    out = _imported(tmp_path, kind, KINDS[kind][1] + f"notice: {value}\n")
    assert _rows(out, "SELECT notice FROM source") == [(json.loads(value),)]


@pytest.mark.parametrize("kind", BOTH)
def test_a_nul_written_as_a_yaml_zero_escape_is_an_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str
) -> None:
    # Section 3.1: text MUST NOT contain U+0000 (YAML's \0 escape is U+0000 too).
    err = _refuse(tmp_path, kind, KINDS[kind][1] + 'notice: "a\\0b"\n', capsys)
    assert "settings.yaml:5: " in err and "notice" in err and "U+0000" in err


@pytest.mark.parametrize("kind", BOTH)
def test_a_notice_with_an_unpaired_surrogate_is_an_error_not_a_crash(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str
) -> None:
    # Section 3.1: header.settings is I-JSON (no unpaired surrogates), so the notice cannot be
    # recorded; the refusal is an error naming the file, never a traceback.
    err = _refuse(tmp_path, kind, KINDS[kind][1] + 'notice: "a\\uD800b"\n', capsys)
    assert "settings.yaml:5: " in err and "notice" in err, err


@pytest.mark.parametrize("kind", BOTH)
def test_a_notice_given_twice_is_an_error_naming_the_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str
) -> None:
    # Section 5 (YAML core): a duplicate key is rejected; the one tessera has one notice.
    err = _refuse(tmp_path, kind, KINDS[kind][1] + 'notice: "a"\nnotice: "b"\n', capsys)
    assert "settings.yaml" in err


def _with(kind: str, notice: str) -> str:
    return f"notice: {_quoted(notice)}\n" + KINDS[kind][1]


# --- the text is kept exactly (sections 3.1, 3.6) -----------------------------------------------

CASES = Path(__file__).parent / "cases"
TEXTS = {
    c["name"]: c["text"] * c.get("repeat", 1)
    for c in json.loads((CASES / "notice_texts.json").read_text(encoding="utf-8"))
}


@pytest.mark.parametrize("kind", BOTH)
@pytest.mark.parametrize("name", sorted(TEXTS))
def test_the_notice_text_is_stored_byte_for_byte(tmp_path: Path, kind: str, name: str) -> None:
    # Section 3.2 / 10: notices travel unchanged. No strip, no normalisation, no newline change.
    text = TEXTS[name]
    out = _imported(tmp_path, kind, _with(kind, text))
    ((got,),) = _rows(out, "SELECT notice FROM source")
    assert isinstance(got, str)
    assert got.encode("utf-8") == text.encode("utf-8")
    ((settings,),) = _rows(out, "SELECT settings FROM header")
    assert json.loads(str(settings))["notice"] == text


# --- the settings and the hash (sections 3.3, 3.6, 4.1) ----------------------------------------


@pytest.mark.parametrize("kind", BOTH)
def test_the_notice_changes_only_the_notice_and_the_settings(tmp_path: Path, kind: str) -> None:
    plain = _imported(tmp_path / "a", kind, KINDS[kind][1])
    noticed = _imported(tmp_path / "b", kind, _with(kind, "N"))
    for table in ("node", "edge", "evidence", "type", "alias"):
        sql = f"SELECT * FROM {table}"
        assert _rows(plain, sql) == _rows(noticed, sql), table
    old = _rows(plain, "SELECT sid, id, kind, hash FROM source")
    assert old == _rows(noticed, "SELECT sid, id, kind, hash FROM source")
    ((s_plain,),) = _rows(plain, "SELECT settings FROM header")
    ((s_noticed,),) = _rows(noticed, "SELECT settings FROM header")
    expected = json.loads(str(s_plain))
    expected["notice"] = "N"
    assert json.loads(str(s_noticed)) == expected


@pytest.mark.parametrize("kind", BOTH)
def test_the_notice_alone_does_not_stand_for_the_other_settings(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str
) -> None:
    # A wrong setting elsewhere is still an error with the notice present.
    bad = _with(kind, "N") + "nonsense_setting: 1\n"
    err = _refuse(tmp_path, kind, bad, capsys)
    assert "settings.yaml" in err and "nonsense_setting" in err


# --- the mosaic carries it (sections 3.2, 7.2, 10) ---------------------------------------------


def _pattern(directory: Path, pieces: dict[str, str]) -> Path:
    listing = "".join(f"  - {name}@{digest}\n" for name, digest in pieces.items())
    froms = "".join(f"      {name}.Thing: {{id: key}}\n" for name in pieces)
    path = directory / "pattern.yaml"
    path.write_text(
        'format: "0.1"\n'
        f"pieces:\n{listing}"
        "types:\n"
        "  Thing:\n"
        "    key: id\n"
        "    describe: An invented thing\n"
        "    from:\n"
        f"{froms}"
        "mosaics:\n  small: {vectors: false}\n",
        encoding="utf-8",
    )
    return path


def _build(directory: Path, pieces: dict[str, Path]) -> tuple[Path, dict[str, object]]:
    pattern = _pattern(directory, {name: _hash(path) for name, path in pieces.items()})
    out = directory / "out"
    args = ["build", str(pattern), "--target", "small", "--pieces", str(directory / "pieces")]
    assert main([*args, "-o", str(out)]) == 0
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    return out / "small.mosaic", report


def _piece(directory: Path, kind: str, name: str, notice: str | None) -> Path:
    settings = KINDS[kind][1] if notice is None else _with(kind, notice)
    return _imported(directory, kind, settings, name)


def test_two_pieces_with_different_notices_give_two_report_entries_sorted_by_piece(
    tmp_path: Path,
) -> None:
    # Section 7.2: one entry per distinct piece name and notice text, sorted by piece then text.
    zed = _piece(tmp_path / "z", "csv", "zed", "Zed notice")
    abe = _piece(tmp_path / "a", "csv", "abe", "Abe notice")
    for p in (zed, abe):
        (tmp_path / "pieces").mkdir(exist_ok=True)
        (tmp_path / "pieces" / p.name).write_bytes(p.read_bytes())
    mosaic, report = _build(tmp_path, {"zed": zed, "abe": abe})
    assert report["notices"] == [
        {"piece": "abe", "text": "Abe notice"},
        {"piece": "zed", "text": "Zed notice"},
    ]
    rows = _rows(mosaic, "SELECT id, notice FROM source ORDER BY id")
    assert ("abe/things.csv", "Abe notice") in rows
    assert ("zed/things.csv", "Zed notice") in rows


def test_a_piece_without_a_notice_adds_no_report_entry_beside_one_with(tmp_path: Path) -> None:
    with_ = _piece(tmp_path / "a", "csv", "noted", "Noted")
    without = _piece(tmp_path / "b", "csv", "plain", None)
    (tmp_path / "pieces").mkdir(exist_ok=True)
    for p in (with_, without):
        (tmp_path / "pieces" / p.name).write_bytes(p.read_bytes())
    mosaic, report = _build(tmp_path, {"noted": with_, "plain": without})
    assert report["notices"] == [{"piece": "noted", "text": "Noted"}]
    assert _rows(mosaic, "SELECT notice FROM source WHERE id = 'plain/things.csv'") == [(None,)]
