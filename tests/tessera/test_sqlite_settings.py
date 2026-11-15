"""A SQLite tessera's settings file: the shape of ``header.settings``.

The file is read as ``mosaic import csv --settings`` reads its own: YAML 1.2 core
schema, duplicate keys refused, and a key the settings do not have, a value of the wrong kind or
settings the builder refuses is an error naming the file, the line and the setting.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from mosaic_build.tessera.convert import Boolean, Date, Integer, Number, Quantity
from mosaic_build.tessera.sqlite import Settings, Table
from mosaic_build.tessera.sqlite_settings import from_json, read

EVERY_SETTING = Settings(
    tables={
        "Writer": Table(label="Name", summary="Note", props=("Name", "Born")),
        "Shelf": Table(type="Place", props=("Floor",), convert={"Floor": Integer()}),
        "Volume": Table(
            label="Title",
            props=("Title", "Pages", "Weight", "Lent", "Made", "Length"),
            convert={
                "Weight": Number(),
                "Lent": Boolean(true=("1",), false=("0",)),
                "Made": Date(("%Y-%m-%d",)),
                "Length": Quantity(number="Length", unit="Unit", units={"cm": "centimetre"}),
            },
            foreign_keys={"WriterId": "written_by", "ShelfCode": "kept_on"},
        ),
    }
)


def _file(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "settings.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_every_setting_round_trips_through_header_settings() -> None:
    """A tessera's ``header.settings``, read back, gives the same settings text (section 3.3).

    The text is canonical JSON, so its tables are in key order, not the file's.
    """
    again = from_json(json.loads(EVERY_SETTING.as_json()))
    assert again.as_json() == EVERY_SETTING.as_json()
    assert list(again.tables) == ["Shelf", "Volume", "Writer"]


def test_a_yaml_settings_file(tmp_path: Path) -> None:
    path = _file(
        tmp_path,
        """\
tables:
  Writer: {label: Name, summary: Note, props: [Name, Born]}
  Shelf:
    type: Place
    props: [Floor]
    convert: {Floor: {kind: integer}}
  Volume:
    label: Title
    props: [Title, Pages, Weight, Lent, Made, Length]
    convert:
      Weight: {kind: number}
      Lent: {kind: boolean, "true": ["1"], "false": ["0"]}
      Made: {kind: date, formats: ["%Y-%m-%d"]}
      Length: {kind: quantity, number: Length, unit: Unit, units: {cm: centimetre}}
    foreign_keys: {WriterId: written_by, ShelfCode: kept_on}
""",
    )
    assert read(path).as_json() == EVERY_SETTING.as_json()


def test_a_table_with_no_settings_takes_the_defaults(tmp_path: Path) -> None:
    """A table named with an empty mapping: its name as type, no label, summary or props."""
    settings = read(_file(tmp_path, "tables:\n  Writer: {}\n"))
    assert settings.tables["Writer"].type_for("Writer") == "Writer"
    assert json.loads(settings.as_json()) == {
        "tables": {"Writer": {"type": "Writer", "label": None, "summary": None, "props": []}}
    }


def test_the_tables_keep_the_order_of_the_file(tmp_path: Path) -> None:
    settings = read(_file(tmp_path, "tables:\n  B: {}\n  A: {}\n  C: {}\n"))
    assert list(settings.tables) == ["B", "A", "C"]


CASES = json.loads(
    (Path(__file__).parent / "cases" / "sqlite_wrong_settings.json").read_text("utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_a_wrong_setting_names_the_file_the_line_and_the_setting(
    tmp_path: Path, case: dict[str, Any]
) -> None:
    line, named = case["line"], case["named"]
    path = _file(tmp_path, case["text"])
    with pytest.raises(ValueError) as error:
        read(path)
    message = str(error.value)
    where = str(path) if line is None else f"{path}:{line}:"
    assert message.startswith(where), message
    assert named in message, message


def test_a_settings_file_that_is_not_utf8_names_the_file(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_bytes(b"tables:\n  W\xe9: {}\n")
    with pytest.raises(ValueError, match=r"settings\.yaml"):
        read(path)
