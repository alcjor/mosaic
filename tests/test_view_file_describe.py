"""Descriptions in the view file, for the graph explorer's map (need G-2).

G-2: selecting a type or an edge type on the map shows its description. The kit as it is today
gives no description (G-12), so the map shows one only when the view file gives it (decided by
the maintainer): ``types.<Type>.describe`` for a node type and
``edges.<edge>.describe`` for an edge type, each optional, non-empty text. Without one, no
description is shown. ``edges`` describes; it does not choose which edge types appear.
"""

import json
from pathlib import Path

import jsonschema
import pytest
import yaml
from mosaic_build.view_file import EdgeView, TypeView, ViewSettings, from_json, read

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "views" / "view.schema.json"
EXAMPLE = ROOT / "views" / "example.yaml"
FIXTURES = ROOT / "conformance" / "fixtures"


def _schema() -> dict:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def _write(tmp_path: Path, text: str, *, raw: bytes | None = None) -> Path:
    path = tmp_path / "view.yaml"
    path.write_bytes(raw if raw is not None else text.encode("utf-8"))
    return path


def test_no_description_is_the_default() -> None:
    assert ViewSettings().edges is None
    assert TypeView("A").describe is None
    data = ViewSettings().as_json()
    assert data["edges"] is None
    assert from_json({"types": {"A": {}}}).as_json()["types"][0]["describe"] is None


def test_a_type_takes_a_description(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "types:\n  A:\n    describe: An a, as the source says\n"))
    assert settings.types == (TypeView("A", describe="An a, as the source says"),)
    assert settings.as_json()["types"][0]["describe"] == "An a, as the source says"


def test_edge_types_take_descriptions_in_the_order_written(tmp_path: Path) -> None:
    text = "edges:\n  zeta:\n    describe: Last by name, first here\n  alpha: {describe: Then}\n"
    settings = read(_write(tmp_path, text))
    assert settings.edges == (
        EdgeView("zeta", describe="Last by name, first here"),
        EdgeView("alpha", describe="Then"),
    )
    assert settings.as_json()["edges"] == [
        {"name": "zeta", "describe": "Last by name, first here"},
        {"name": "alpha", "describe": "Then"},
    ]


def test_an_edge_type_with_no_settings_has_no_description(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "edges:\n  e: {}\n"))
    assert settings.edges == (EdgeView("e"),)
    assert settings.as_json()["edges"] == [{"name": "e", "describe": None}]


def test_describing_edges_leaves_the_types_listed_alone(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "edges:\n  e: {describe: x}\n"))
    assert settings.types is None  # every node type, by name, as without a view file


def test_a_description_keeps_its_text_whole(tmp_path: Path) -> None:
    text = 'types:\n  A:\n    describe: "Sí: «x» — 2 lines\\nand: colons"\n'
    types = read(_write(tmp_path, text)).types
    assert types is not None
    assert types[0].describe == "Sí: «x» — 2 lines\nand: colons"


WRONG = [
    # (view file, line, setting named in the message)
    ("types:\n  A:\n    describe: 3\n", 3, "types.A.describe"),
    ("types:\n  A:\n    describe: ''\n", 3, "types.A.describe"),
    ("types:\n  A:\n    describe: [x]\n", 3, "types.A.describe"),
    ("edges: [e]\n", 1, "edges"),
    ("edges: x\n", 1, "edges"),
    ("edges:\n  e: yes\n", 2, "edges.e"),
    ("edges:\n  e:\n", 2, "edges.e"),
    ("edges:\n  e:\n    label: E\n", 3, "edges.e.label"),
    ("edges:\n  e:\n    describe: 1\n", 3, "edges.e.describe"),
    ("edges:\n  e:\n    describe: ''\n", 3, "edges.e.describe"),
    ('edges:\n  "": {}\n', 2, "edges"),
]


@pytest.mark.parametrize(("text", "line", "setting"), WRONG)
def test_a_wrong_description_names_the_file_line_and_setting(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    message = str(e.value)
    assert message.startswith(f"{path}:{line}: view file: {setting}"), message


@pytest.mark.parametrize(("text", "line", "setting"), WRONG)
def test_the_schema_refuses_each_wrong_description(text: str, line: int, setting: str) -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(yaml.safe_load(text), _schema())


def test_an_unknown_setting_lists_describe_and_edges(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="describe"):
        read(_write(tmp_path, "types:\n  A:\n    colour: x\n"))
    with pytest.raises(ValueError, match="edges"):
        read(_write(tmp_path, "colour: x\n"))
    with pytest.raises(ValueError, match=r"one of describe$"):
        read(_write(tmp_path, "edges:\n  e: {colour: x}\n"))


def test_the_example_describes_a_type_and_an_edge_type() -> None:
    settings = read(EXAMPLE)
    assert settings.types is not None and settings.types[0].describe
    assert settings.edges and settings.edges[0].describe


@pytest.mark.parametrize("fixture", ["netflix", "chinook"])
def test_the_fixtures_describe_their_listed_types_and_every_edge_type(fixture: str) -> None:
    view = FIXTURES / fixture / "view.yaml"
    pattern = yaml.safe_load((view.parent / "pattern.yaml").read_text(encoding="utf-8"))
    settings = read(view)
    assert settings.types, view
    for t in settings.types:
        assert t.describe, f"{view}: types.{t.name} has no describe"
    described = [e.name for e in settings.edges or ()]
    assert sorted(described) == sorted(pattern["edges"]), view


SCHEMA_DOC = json.loads((ROOT / "views" / "view.schema.json").read_text(encoding="utf-8"))


# Duplicates: a reader MUST reject duplicate keys, at any depth (spec 0.1 section 5).


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("edges:\n  e: {describe: a}\n  e: {describe: b}\n", 3),
        ("edges:\n  e:\n    describe: a\n    describe: b\n", 4),
        ("types:\n  A:\n    describe: a\n    describe: b\n", 4),
        ("edges: {}\nedges: {}\n", 2),
    ],
)
def test_a_duplicate_description_key_names_the_file_and_line(
    tmp_path: Path, text: str, line: int
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:{line}: .*duplicate"):
        read(path)


# Order and text.


def test_a_description_that_looks_like_another_type_is_text(tmp_path: Path) -> None:
    for word in ["yes", "no", "on", "off", "null", "~", "1e3", "0x1F", "2024-01-01"]:
        settings = read(_write(tmp_path, f'edges:\n  e: {{describe: "{word}"}}\n'))
        assert settings.edges == (EdgeView("e", describe=word),), word


# The reader and the schema agree.


@pytest.mark.parametrize(
    "text",
    [
        "types:\n  A:\n    describe: null\n",
        "types:\n  A:\n    describe:\n",
        "edges:\n  e:\n    describe: null\n",
        "edges:\n  e:\n    describe:\n",
        "edges:\n  e:\n    describe: true\n",
        "edges:\n  e:\n    describe: {a: b}\n",
        "edges:\n  e:\n    describe: [a]\n",
        "edges:\n  e: {describe: a, label: b}\n",
        "edges: null\n",
        "edges: 3\n",
        "edges:\n  - e\n",
        "edges:\n  e: ~\n",
        "edges:\n  e: []\n",
        "edges:\n  e: text\n",
        "export:\n  edges: [e]\n",
    ],
)
def test_reader_and_schema_both_refuse_each_wrong_edges_setting(tmp_path: Path, text: str) -> None:
    with pytest.raises(ValueError):
        read(_write(tmp_path, text))
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(yaml.safe_load(text), SCHEMA_DOC)


@pytest.mark.parametrize(
    "text",
    [
        "edges: {}\n",
        "edges:\n  e: {}\n",
        "edges:\n  e: {describe: ' '}\n",
        "edges:\n  e: {describe: '0'}\n",
        "types:\n  A: {describe: ' '}\n",
        "types: {}\nedges: {}\n",
        "edges: {e: {describe: a}, f: {}}\n",
    ],
)
def test_reader_and_schema_both_accept_each_edges_setting(tmp_path: Path, text: str) -> None:
    read(_write(tmp_path, text))
    jsonschema.validate(yaml.safe_load(text), SCHEMA_DOC)


def test_a_numeric_edge_name_is_refused_by_the_reader(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        read(_write(tmp_path, "edges:\n  3: {}\n"))


def test_an_empty_edges_mapping_describes_nothing_and_lists_no_type(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "edges: {}\n"))
    assert settings.types is None
    assert all(e["describe"] is None for e in (settings.as_json()["edges"] or []))


# Determinism and the hand-over to the page.


def test_settings_read_from_a_json_document_equal_those_read_from_the_file(
    tmp_path: Path,
) -> None:
    text = "types:\n  A: {describe: Sí}\n  B: {}\nedges:\n  z: {describe: Zed}\n  a: {}\n"
    settings = read(_write(tmp_path, text))
    again = from_json(json.loads(json.dumps(yaml.safe_load(text))))
    assert again == settings
    assert again.as_json() == settings.as_json()


@pytest.mark.parametrize(
    "value",
    [
        {"edges": {"e": {"describe": 3}}},
        {"edges": {"e": {"describe": ""}}},
        {"edges": {"": {"describe": "x"}}},
        {"edges": [{"name": "e", "describe": "x"}]},
        {"types": {"A": {"describe": ""}}},
    ],
)
def test_from_json_refuses_malformed_descriptions(value: object) -> None:
    with pytest.raises(ValueError):
        from_json(value)
