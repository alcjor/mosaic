"""The CSV tessera builder: a row filter, files without a header row, and cells that mean
no value.

``rows`` imports only the rows with the wanted text in the named columns, and row numbers
still count every data row of the file (section 3.5). ``columns`` names the columns of a file
without a header row. ``nulls`` are the cells read as empty.
"""

import json
from pathlib import Path

import mosaic_format
import pytest
from mosaic_build.tessera.csv import Link, Settings, build
from mosaic_build.tessera.settings import from_json, read
from mosaic_format.check import check_file

CSV = (
    "code,room,state,tags\n"
    "A,north,shown,x;y\n"
    "B,south,shown,y\n"
    "A,south,stored,z\n"
    "D,north,stored,\n"
    "E,North,shown,x\n"
    "F,,shown,w\n"
)
# The same rows without a header row, with \N for no value.
DAT = "A,north,shown,x;y\nB,\\N,shown,\\N\nC,north,\\N,\\N;y\n"
NAMES = ("code", "room", "state", "tags")
TAGS = {"tags": Link("Tag", "tagged", separator=";", label="state")}


def _build(tmp_path: Path, settings: Settings, text: str = CSV, name: str = "items.csv") -> Path:
    source = tmp_path / name
    source.write_bytes(text.encode("utf-8"))
    out = tmp_path / "items.tessera"
    build(source, out, settings)
    return out


def _q(path: Path, sql: str) -> list[tuple[object, ...]]:
    with mosaic_format.open(path) as f:
        return f.query(sql)


def _rows(path: Path) -> list[tuple[object, ...]]:
    return _q(
        path,
        "SELECT n.id, e.locator FROM v_node n JOIN v_evidence e ON e.node = n.id "
        "WHERE n.type = 'Item' ORDER BY n.id",
    )


# --- the row filter ----------------------------------------------------------------------------


def test_only_rows_with_the_wanted_text_are_imported_and_keep_their_row_numbers(
    tmp_path: Path,
) -> None:
    # exact text: "North" is not "north"; row 3 repeats the key A but is skipped
    out = _build(tmp_path, Settings(type="Item", key="code", links=TAGS, rows={"room": "north"}))
    assert _rows(out) == [("Item:A", "file=items.csv;row=1"), ("Item:D", "file=items.csv;row=4")]
    assert _q(out, "SELECT id FROM v_node WHERE type = 'Tag' ORDER BY id") == [
        ("Tag:x",),
        ("Tag:y",),
    ]
    assert _q(out, "SELECT src, dst FROM v_edge ORDER BY dst") == [
        ("Item:A", "Tag:x"),
        ("Item:A", "Tag:y"),
    ]
    assert check_file(out).ok


def test_a_list_of_texts_and_several_columns(tmp_path: Path) -> None:
    rows = {"room": ("north", "North", ""), "state": "shown"}
    out = _build(tmp_path, Settings(type="Item", key="code", rows=rows))
    assert [i for i, _ in _rows(out)] == ["Item:A", "Item:E", "Item:F"]


def test_row_number_keys_count_every_row_of_the_file(tmp_path: Path) -> None:
    out = _build(tmp_path, Settings(type="Item", rows={"room": "south"}))
    assert _rows(out) == [("Item:2", "file=items.csv;row=2"), ("Item:3", "file=items.csv;row=3")]


def test_a_filter_column_missing_from_the_header_is_named(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"items\.csv: column 'hall'"):
        _build(tmp_path, Settings(type="Item", rows={"hall": "north"}))


# --- no header row, and cells that mean no value ------------------------------------------------


def test_named_columns_make_the_first_line_data_row_1(tmp_path: Path) -> None:
    settings = Settings(type="Item", key="code", label="room", columns=NAMES)
    out = _build(tmp_path, settings, DAT, "items.dat")
    assert _q(out, "SELECT n.id, n.label, e.locator FROM v_node n JOIN v_evidence e "
              "ON e.node = n.id ORDER BY n.id") == [
        ("Item:A", "north", "file=items.dat;row=1"),
        ("Item:B", "\\N", "file=items.dat;row=2"),
        ("Item:C", "north", "file=items.dat;row=3"),
    ]  # fmt: skip
    assert check_file(out).ok


def test_a_null_cell_is_an_empty_cell_everywhere(tmp_path: Path) -> None:
    settings = Settings(
        type="Item",
        key="code",
        label="room",
        props=("state",),
        links=TAGS,
        columns=NAMES,
        nulls=("\\N",),
    )
    out = _build(tmp_path, settings, DAT, "items.dat")
    assert _q(out, "SELECT id, label, props FROM v_node ORDER BY id") == [
        ("Item:A", "north", '{"state":"shown"}'),
        ("Item:B", None, '{"state":"shown"}'),
        ("Item:C", "north", None),
        # only a whole cell is a null: C's "\N;y" is two values; its null state is no label
        ("Tag:\\N", None, None),
        ("Tag:x", "shown", None),
        ("Tag:y", None, None),
    ]
    filtered = Settings(type="Item", key="code", columns=NAMES, nulls=("\\N",), rows={"room": ""})
    (tmp_path / "f").mkdir()
    assert [i for i, _ in _rows(_build(tmp_path / "f", filtered, DAT, "items.dat"))] == ["Item:B"]


def test_a_null_key_is_an_empty_key(tmp_path: Path) -> None:
    settings = Settings(type="Item", key="room", columns=NAMES, nulls=("\\N",))
    with pytest.raises(ValueError, match=r"items\.dat: row 2 .*'room'"):
        _build(tmp_path, settings, "A,north,s,t\nB,\\N,s,t\n", "items.dat")


def test_a_row_with_another_number_of_fields_than_the_named_columns_is_refused(
    tmp_path: Path,
) -> None:
    settings = Settings(type="Item", columns=("code", "room"))
    with pytest.raises(ValueError, match=r"items\.dat: row 1 "):
        _build(tmp_path, settings, DAT, "items.dat")
    assert not (tmp_path / "items.tessera").exists()


def test_a_column_the_named_columns_lack_is_named(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"items\.dat: column 'title'"):
        _build(tmp_path, Settings(type="Item", label="title", columns=NAMES), DAT, "items.dat")


# --- recorded settings -------------------------------------------------------------------------

EVERY = Settings(
    type="Item",
    key="code",
    links=TAGS,
    rows={"room": "north", "state": ("shown", "")},
    columns=NAMES,
    nulls=("\\N", "-"),
)


def test_the_settings_are_recorded_and_rebuild_the_same_file(tmp_path: Path) -> None:
    (tmp_path / "1").mkdir()
    (tmp_path / "2").mkdir()
    first = _build(tmp_path / "1", EVERY, DAT, "items.dat")
    [(text,)] = _q(first, "SELECT settings FROM header")
    recorded = json.loads(str(text))
    assert recorded["rows"] == {"room": "north", "state": ["shown", ""]}
    assert recorded["columns"] == list(NAMES)
    assert recorded["nulls"] == ["\\N", "-"]
    assert from_json(recorded) == EVERY
    second = _build(tmp_path / "2", from_json(recorded), DAT, "items.dat")
    assert first.read_bytes() == second.read_bytes()


def test_settings_without_them_record_none_of_them() -> None:
    assert not {"rows", "columns", "nulls"} & json.loads(Settings().as_json()).keys()


def test_a_yaml_settings_file(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(
        """\
type: Item
key: code
links:
  tags: {type: Tag, edge: tagged, separator: ";", label: state}
rows:
  room: north
  state: [shown, ""]
columns: [code, room, state, tags]
nulls: ['\\N', "-"]
""",
        encoding="utf-8",
    )
    assert read(path) == EVERY
