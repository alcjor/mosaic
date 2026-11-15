"""The view file: its settings, their defaults and its errors.

docs/design.md, Implementation plan, "View file": YAML, used by both ``mosaic view`` and
``mosaic export``; it sets which types appear, columns, what a node page shows, labels, theme,
which types an export carries, and ``search: semantic`` or ``search: text``. The keys, values
and defaults are those of ``views/example.yaml``: every key
is optional, so an empty view file, or none, gives M2's viewer; types appear in the order the
file writes them; ``label`` relabels a type and ``names`` its property and edge names;
``search`` defaults to ``semantic``. What ``export.types`` means is tested with the export.
"""

import json
from pathlib import Path

import jsonschema
import pytest
import yaml
from mosaic_build.view_file import TypeView, ViewSettings, from_json, read

from tests.case_files import cases

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "views" / "view.schema.json"
EXAMPLE = ROOT / "views" / "example.yaml"
FIXTURES = ROOT / "conformance" / "fixtures"


def _schema() -> dict:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def _write(tmp_path: Path, text: str | bytes, name: str = "view.yaml") -> Path:
    path = tmp_path / name
    if isinstance(text, bytes):
        path.write_bytes(text)
    else:
        path.write_text(text, encoding="utf-8", newline="")
    return path


# Defaults: no view file, or an empty one, is M2's viewer.

M2_VIEWER = {
    "search": "semantic",
    "theme": "auto",
    "types": None,
    "edges": None,
    "cards": None,
    "chains": None,
    "export": {"types": None},
}
"""M2's viewer as settings: semantic search, the system's theme, every node type by name with
every property and edge, the mosaic's own names, and the export's types unset."""


def test_no_view_file_gives_m2s_viewer() -> None:
    assert read(None) == ViewSettings()
    assert read(None).as_json() == M2_VIEWER


@pytest.mark.parametrize("text", ["", "\n", "# only a comment\n", "{}\n", "---\n"])
def test_an_empty_view_file_gives_m2s_viewer(tmp_path: Path, text: str) -> None:
    assert read(_write(tmp_path, text)).as_json() == M2_VIEWER


def test_each_setting_has_its_default() -> None:
    settings = ViewSettings()
    assert settings.search == "semantic"
    assert settings.theme == "auto"
    assert settings.types is None  # every node type, by name
    assert settings.export_types is None
    entry = TypeView("A")
    assert entry.label is None  # the type name
    assert entry.columns is None  # every declared property
    assert entry.page is None  # every property and every edge type
    assert dict(entry.names) == {}  # the mosaic's own names


def test_a_type_with_no_settings_keeps_every_default(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "types:\n  A: {}\n"))
    assert settings.types == (TypeView("A"),)
    assert settings.as_json()["types"] == [
        {
            "name": "A",
            "label": None,
            "columns": None,
            "page": None,
            "names": {},
            "describe": None,
            "colour": None,
        }
    ]


# Each setting, set.


@pytest.mark.parametrize("search", ["semantic", "text"])
def test_search_is_semantic_or_text(tmp_path: Path, search: str) -> None:
    assert read(_write(tmp_path, f"search: {search}\n")).search == search


@pytest.mark.parametrize("theme", ["auto", "light", "dark"])
def test_theme_is_auto_light_or_dark(tmp_path: Path, theme: str) -> None:
    assert read(_write(tmp_path, f"theme: {theme}\n")).theme == theme


def test_types_appear_in_the_order_the_file_writes_them(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "types:\n  Zeta: {}\n  Alpha: {}\n  Mid: {}\n"))
    assert settings.types is not None
    assert [t.name for t in settings.types] == ["Zeta", "Alpha", "Mid"]
    assert [t["name"] for t in settings.as_json()["types"]] == ["Zeta", "Alpha", "Mid"]


def test_an_empty_types_mapping_lists_no_types(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "types: {}\n"))
    assert settings.types == ()
    assert settings.as_json()["types"] == []


def test_a_type_sets_label_columns_page_and_names(tmp_path: Path) -> None:
    text = """\
types:
  Item:
    label: Thing
    columns: [b, a]
    page: [c, linked_to, a]
    names: {a: First, linked_to: Linked to}
"""
    settings = read(_write(tmp_path, text))
    assert settings.types == (
        TypeView(
            "Item",
            label="Thing",
            columns=("b", "a"),
            page=("c", "linked_to", "a"),
            names={"a": "First", "linked_to": "Linked to"},
        ),
    )
    assert settings.as_json()["types"] == [
        {
            "name": "Item",
            "label": "Thing",
            "columns": ["b", "a"],
            "page": ["c", "linked_to", "a"],
            "names": {"a": "First", "linked_to": "Linked to"},
            "describe": None,
            "colour": None,
        }
    ]


def test_empty_columns_and_page_show_none(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "types:\n  A: {columns: [], page: []}\n"))
    assert settings.types == (TypeView("A", columns=(), page=()),)


def test_export_types(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "export:\n  types: [B, A]\n"))
    assert settings.export_types == ("B", "A")
    assert settings.as_json()["export"] == {"types": ["B", "A"]}


def test_an_empty_export_mapping_keeps_its_default(tmp_path: Path) -> None:
    assert read(_write(tmp_path, "export: {}\n")).export_types is None


def test_the_settings_are_json_for_the_page() -> None:
    settings = from_json(
        {
            "search": "text",
            "theme": "dark",
            "types": {"A": {"label": "Ay", "columns": ["x"], "names": {"x": "Ex"}}},
            "export": {"types": ["A"]},
        }
    )
    data = settings.as_json()
    assert data == {
        "search": "text",
        "theme": "dark",
        "types": [
            {
                "name": "A",
                "label": "Ay",
                "columns": ["x"],
                "page": None,
                "names": {"x": "Ex"},
                "describe": None,
                "colour": None,
            }
        ],
        "edges": None,
        "cards": None,
        "chains": None,
        "export": {"types": ["A"]},
    }
    assert json.loads(json.dumps(data)) == data


# The shipped view files.


def _view_files() -> list[Path]:
    return [EXAMPLE, *sorted(FIXTURES.glob("*/view.yaml"))]


def test_every_fixture_has_a_view_file() -> None:
    fixtures = sorted(p.parent.name for p in FIXTURES.glob("*/pattern.yaml"))
    assert fixtures, "no fixture found"
    for name in fixtures:
        assert (FIXTURES / name / "view.yaml").is_file(), f"{name} has no view.yaml"


@pytest.mark.parametrize("path", _view_files(), ids=lambda p: p.parent.name + "/" + p.name)
def test_the_shipped_view_files_read_and_match_the_schema(path: Path) -> None:
    read(path)
    jsonschema.validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {}, _schema())


def test_the_example_sets_every_setting() -> None:
    settings = read(EXAMPLE)
    assert settings.types is not None and settings.export_types is not None
    first = settings.types[0]
    assert first.label is not None and first.columns is not None
    assert first.page is not None and dict(first.names)
    data = yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))
    assert {"search", "theme", "types", "cards", "export"} <= set(data)


def test_the_fixture_view_files_name_only_types_of_their_pattern() -> None:
    for view in sorted(FIXTURES.glob("*/view.yaml")):
        pattern = yaml.safe_load((view.parent / "pattern.yaml").read_text(encoding="utf-8"))
        settings = read(view)
        named = [t.name for t in settings.types or ()] + list(settings.export_types or ())
        assert set(named) <= set(pattern["types"]), view


def test_the_schema_is_a_valid_json_schema() -> None:
    jsonschema.Draft202012Validator.check_schema(_schema())


# Errors name the file, the line and the setting.


@pytest.mark.parametrize(
    ("text", "line", "setting"), cases("view_file_wrong", "text", "line", "setting")
)
def test_a_wrong_view_file_names_the_file_line_and_setting(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    message = str(e.value)
    assert message.startswith(f"{path}:{line}: "), message
    assert setting in message, message


@pytest.mark.parametrize(
    ("text", "line", "setting"), cases("view_file_wrong", "text", "line", "setting")
)
def test_the_schema_refuses_each_wrong_view_file(text: str, line: int, setting: str) -> None:
    data = yaml.safe_load(text)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(data, _schema())


def test_a_duplicate_key_names_the_file_and_line(tmp_path: Path) -> None:
    path = _write(tmp_path, "search: text\ntheme: dark\nsearch: semantic\n")
    with pytest.raises(ValueError, match=rf"^{path}:3: "):
        read(path)


def test_a_file_that_is_not_yaml_names_the_file_and_line(tmp_path: Path) -> None:
    path = _write(tmp_path, "types:\n  A: {columns: [x\n")
    with pytest.raises(ValueError, match=rf"^{path}:\d+: "):
        read(path)


def test_a_file_that_is_not_utf8_names_the_file(tmp_path: Path) -> None:
    path = tmp_path / "view.yaml"
    path.write_bytes(b"search: \xff\n")
    with pytest.raises(ValueError, match=rf"^{path}: "):
        read(path)


def test_a_missing_file_is_an_os_error(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        read(tmp_path / "absent.yaml")


@pytest.mark.parametrize(
    "value",
    [
        {"search": "fuzzy"},
        {"types": {"A": {"columns": "x"}}},
        {"export": {"types": [1]}},
        ["search"],
    ],
)
def test_from_json_refuses_what_read_refuses(value: object) -> None:
    with pytest.raises(ValueError):
        from_json(value)


@pytest.mark.parametrize(
    ("text", "line", "setting"), cases("view_file_first_wrong", "text", "line", "setting")
)
def test_of_several_wrong_settings_the_first_written_is_named(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:{line}: view file: {setting}"):
        read(path)


def test_the_conformance_settings_are_what_the_reader_gives() -> None:
    """Python and TypeScript meet at conformance/views/settings.json (the page reads it)."""
    cases = json.loads((ROOT / "conformance" / "views" / "settings.json").read_text("utf-8"))
    views = [c["view"] for c in cases["cases"]]
    assert views == ["views/example.yaml", "conformance/fixtures/netflix/view.yaml", None]
    for case in cases["cases"]:
        path = None if case["view"] is None else ROOT / case["view"]
        assert read(path).as_json() == case["settings"], case["view"]


SCHEMA_DOC = json.loads((ROOT / "views" / "view.schema.json").read_text(encoding="utf-8"))


# Line numbers (the error names the line of the setting).


def test_error_line_counts_comments_and_blank_lines(tmp_path: Path) -> None:
    path = _write(tmp_path, "# a comment\n\n\nsearch: fuzzy\n")
    with pytest.raises(ValueError, match=rf"^{path}:4: .*search"):
        read(path)


# Duplicates (spec 0.1 section 5: a reader MUST reject duplicate keys).


@pytest.mark.parametrize(("text", "line"), cases("view_file_duplicate_keys", "text", "line"))
def test_a_duplicate_key_at_any_depth_is_an_error(tmp_path: Path, text: str, line: int) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:{line}: "):
        read(path)


def test_a_repeated_column_is_an_error(tmp_path: Path) -> None:
    path = _write(tmp_path, "types:\n  A:\n    page: [x, y, x]\n")
    with pytest.raises(ValueError, match=rf"^{path}:3: .*types\.A\.page"):
        read(path)


# YAML 1.2 (the spec's reading of YAML).


def test_an_unknown_tag_is_an_error_not_code(tmp_path: Path) -> None:
    path = _write(tmp_path, "search: !!python/object/apply:os.getcwd []\n")
    with pytest.raises(ValueError, match=rf"^{path}:"):
        read(path)


# Text: CRLF, byte order mark, size, characters.


def test_types_are_not_sorted_by_utf8_bytes(tmp_path: Path) -> None:
    # Order is the file's, even where it contradicts byte order.
    names = ["\u00e9", "z", "B", "a"]
    settings = read(_write(tmp_path, "types:\n" + "".join(f"  {n}: {{}}\n" for n in names)))
    assert [t.name for t in settings.types or ()] == names


# Values.


def test_an_empty_export_types_list_is_kept_apart_from_the_default(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "export:\n  types: []\n"))
    assert settings.export_types == ()
    assert settings.as_json()["export"] == {"types": []}


def test_export_types_may_name_a_type_the_view_does_not_list(tmp_path: Path) -> None:
    settings = read(_write(tmp_path, "types:\n  A: {}\nexport:\n  types: [B]\n"))
    assert settings.export_types == ("B",)


@pytest.mark.parametrize(("text", "setting"), cases("view_file_wrong_kind", "text", "setting"))
def test_a_value_of_the_wrong_kind_names_file_line_and_setting(
    tmp_path: Path, text: str, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    message = str(e.value)
    assert message.startswith(f"{path}:"), message
    assert setting in message, message
    # the line is a number and is a line of the file
    line = int(message[len(str(path)) + 1 :].split(":", 1)[0])
    assert 1 <= line <= text.count("\n"), message


@pytest.mark.parametrize("text", cases("view_file_refused", "text"))
def test_reader_and_schema_both_refuse(tmp_path: Path, text: str) -> None:
    with pytest.raises(ValueError):
        read(_write(tmp_path, text))
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(yaml.safe_load(text), SCHEMA_DOC)


@pytest.mark.parametrize("text", cases("view_file_accepted", "text"))
def test_reader_and_schema_both_accept(tmp_path: Path, text: str) -> None:
    read(_write(tmp_path, text))
    jsonschema.validate(yaml.safe_load(text) or {}, SCHEMA_DOC)


# Determinism and shape of the settings handed to the page.


# The shipped view files.


def _pattern_things(pattern: dict, type_name: str) -> set[str]:
    properties = set(pattern["types"][type_name].get("from", {}).get("", {}))
    for mapping in pattern["types"][type_name].get("from", {}).values():
        properties |= set(mapping)
    edges = {
        name
        for name, edge in pattern.get("edges", {}).items()
        if edge["from"] == type_name or edge.get("to") == type_name
    }
    return properties | edges


def test_a_fixture_view_names_only_properties_and_edges_of_its_types() -> None:
    checked = 0
    for view in sorted(FIXTURES.glob("*/view.yaml")):
        pattern = yaml.safe_load((view.parent / "pattern.yaml").read_text(encoding="utf-8"))
        for entry in read(view).types or ():
            known = _pattern_things(pattern, entry.name)
            used = set(entry.columns or ()) | set(entry.page or ()) | set(entry.names)
            assert used <= known, (view, entry.name, sorted(used - known))
            checked += 1
    assert checked


def test_a_fixture_view_lists_each_type_once_and_in_the_pattern() -> None:
    for view in sorted(FIXTURES.glob("*/view.yaml")):
        names = [t.name for t in read(view).types or ()]
        assert len(names) == len(set(names)), view
