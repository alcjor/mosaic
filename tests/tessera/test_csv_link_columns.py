"""The CSV tessera builder, linked things from parallel columns.

A link's sibling columns hold, at the same position as the link's value, the linked node's
label and props and the edge's qualifier (section 3.4). A linked node keeps the first
non-empty label and prop values; edges are one per row, value and qualifier.
"""

import json
from pathlib import Path

import mosaic_format
import pytest
from mosaic_build.tessera.csv import Link, Settings, build
from mosaic_build.tessera.settings import from_json, read
from mosaic_format.check import check_file

CSV = (
    "code,title,maker_ids,makers,roles,born,pages\n"
    "J1,Jar,a1|b2,Ann Lee|Bo Chan,potter|painter,1900|1910,https://example.org/a1|\n"
    "J2,Bowl,b2 | c3,Robert Chan| Cy Dow ,potter,|,|https://example.org/c3\n"
    "J3,Cup,a1|a1|a1||d4,,potter|glazer|potter|x,1899,\n"
    "J4,Lid,,Nobody,potter,1950,\n"
)

SETTINGS = Settings(
    type="Item",
    key="code",
    label="title",
    props=("makers",),
    links={
        "maker_ids": Link(
            type="Maker",
            edge="made_by",
            separator="|",
            label="makers",
            props={"born": "born", "page": "pages"},
            qualifier="roles",
        )
    },
)


def _build(tmp_path: Path, settings: Settings = SETTINGS, text: str = CSV) -> Path:
    source = tmp_path / "items.csv"
    source.write_bytes(text.encode("utf-8"))
    out = tmp_path / "items.tessera"
    build(source, out, settings)
    return out


def _q(path: Path, sql: str) -> list[tuple[object, ...]]:
    with mosaic_format.open(path) as f:
        return f.query(sql)


def test_a_linked_node_takes_its_label_and_props_from_the_same_position(tmp_path: Path) -> None:
    out = _build(tmp_path)
    makers = _q(out, "SELECT id, label, props FROM v_node WHERE type = 'Maker' ORDER BY id")
    # b2 keeps its first label; a1's birth year is not replaced by row 3's; an empty cell and a
    # position past the end give nothing; an empty link value (J3's fourth, J4) makes nothing.
    assert [(i, label, json.loads(str(p)) if p else None) for i, label, p in makers] == [
        ("Maker:a1", "Ann Lee", {"born": "1900", "page": "https://example.org/a1"}),
        ("Maker:b2", "Bo Chan", {"born": "1910"}),
        ("Maker:c3", "Cy Dow", {"page": "https://example.org/c3"}),
        ("Maker:d4", None, None),
    ]
    assert check_file(out).ok


def test_one_edge_per_row_value_and_qualifier(tmp_path: Path) -> None:
    out = _build(tmp_path)
    edges = _q(out, "SELECT src, dst, qualifier FROM v_edge ORDER BY src, dst, qualifier")
    assert edges == [
        ("Item:J1", "Maker:a1", "potter"),
        ("Item:J1", "Maker:b2", "painter"),
        ("Item:J2", "Maker:b2", "potter"),
        ("Item:J2", "Maker:c3", ""),
        ("Item:J3", "Maker:a1", "glazer"),
        ("Item:J3", "Maker:a1", "potter"),
        ("Item:J3", "Maker:d4", ""),
    ]


def test_evidence_is_one_row_per_node_and_per_edge_for_a_row_and_column(tmp_path: Path) -> None:
    out = _build(tmp_path)
    rows = _q(
        out,
        "SELECT node, edge_dst, locator FROM v_evidence WHERE locator LIKE '%row=3;%' "
        "ORDER BY node, edge_dst",
    )
    at = "file=items.csv;row=3;field=maker_ids"
    assert sorted(rows, key=repr) == sorted(
        [
            ("Maker:a1", None, at),
            ("Maker:d4", None, at),
            (None, "Maker:a1", at),
            (None, "Maker:a1", at),
            (None, "Maker:d4", at),
        ],
        key=repr,
    )


def test_the_linked_type_declares_its_props_as_text(tmp_path: Path) -> None:
    out = _build(tmp_path)
    [(key_prop, props)] = _q(out, "SELECT key_prop, props FROM type WHERE name = 'Maker'")
    assert key_prop == "maker_ids"
    assert json.loads(str(props)) == {"born": "text", "page": "text"}


def test_a_sibling_column_used_as_a_prop_is_still_a_prop_of_the_row(tmp_path: Path) -> None:
    out = _build(tmp_path)
    [(props,)] = _q(out, "SELECT props FROM v_node WHERE id = 'Item:J1'")
    assert json.loads(str(props)) == {"makers": "Ann Lee|Bo Chan"}


def test_without_a_separator_a_sibling_cell_is_one_value(tmp_path: Path) -> None:
    link = Link("Maker", "made_by", label="makers", qualifier="roles")
    out = _build(tmp_path, Settings(type="Item", key="code", links={"maker_ids": link}))
    assert _q(out, "SELECT id, label FROM v_node WHERE id = 'Maker:a1|b2'") == [
        ("Maker:a1|b2", "Ann Lee|Bo Chan")
    ]
    assert _q(out, "SELECT qualifier FROM v_edge WHERE src = 'Item:J1'") == [("potter|painter",)]


def test_the_sibling_columns_are_recorded_and_rebuild_the_same_file(tmp_path: Path) -> None:
    (tmp_path / "1").mkdir()
    (tmp_path / "2").mkdir()
    first = _build(tmp_path / "1")
    [(text,)] = _q(first, "SELECT settings FROM header")
    recorded = json.loads(str(text))
    assert recorded["links"]["maker_ids"] == {
        "type": "Maker",
        "edge": "made_by",
        "direction": "out",
        "separator": "|",
        "label": "makers",
        "props": {"born": "born", "page": "pages"},
        "qualifier": "roles",
    }
    assert from_json(recorded) == SETTINGS
    second = _build(tmp_path / "2", from_json(recorded))
    assert first.read_bytes() == second.read_bytes()


def test_a_link_without_sibling_columns_records_none() -> None:
    assert Link("Maker", "made_by").as_json().keys() == {"type", "edge", "direction", "separator"}


def test_a_yaml_settings_file_with_sibling_columns(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(
        """\
type: Item
key: code
label: title
props: [makers]
links:
  maker_ids:
    type: Maker
    edge: made_by
    separator: "|"
    label: makers
    props: {born: born, page: pages}
    qualifier: roles
""",
        encoding="utf-8",
    )
    assert read(path) == SETTINGS


@pytest.mark.parametrize(
    "link",
    [
        Link("Maker", "made_by", label="names"),
        Link("Maker", "made_by", props={"born": "names"}),
        Link("Maker", "made_by", qualifier="names"),
    ],
    ids=["label", "props", "qualifier"],
)
def test_a_sibling_column_missing_from_the_header_is_named(tmp_path: Path, link: Link) -> None:
    settings = Settings(type="Item", key="code", links={"maker_ids": link})
    with pytest.raises(ValueError, match=r"items\.csv: column 'names'"):
        _build(tmp_path, settings)
    assert not (tmp_path / "items.tessera").exists()
