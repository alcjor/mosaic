"""The view file's cards: which facts each type's card shows.

docs/design.md, "Viewer: chains and cards": V-6, the viewer lets a person choose, for each type,
which facts its card shows: properties, the things it links to, and how many things it links to
by a given link; V-7, a type's card is set once per type, not per chain; V-9, a type with no card
set still gets a sensible default; V-15, card choices are saved in the view file, beside the
other choices it already holds; V-18, a view file whose cards name what the mosaic lacks still
opens (the page reports it: viewer/test/view.cards.test.ts).

The view file holds them under ``cards``, one entry per type, in the order written:

    cards:
      Title:
        show: [summary, release_year, rating]   # properties (and the summary), in order
        links: [directed_by, listed_in]          # the things it links to by these links
        counts: [features]                       # how many things it links to by these
      Person:
        counts: [features in, directed_by in]

A link is an edge type name, alone or followed by ``in`` or ``out`` for one direction.
"""

import json
import shutil
from pathlib import Path

import jsonschema
import pytest
import yaml
from mosaic_build import export, view, view_file
from mosaic_build.cli import main
from mosaic_build.view_file import CardView, from_json, read

from tests.case_files import cases
from tests.conftest import REPO

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "views" / "view.schema.json").read_text(encoding="utf-8"))
EXAMPLE = ROOT / "views" / "example.yaml"


def _write(tmp_path: Path, text: str | bytes, name: str = "view.yaml") -> Path:
    path = tmp_path / name
    if isinstance(text, bytes):
        path.write_bytes(text)
    else:
        path.write_text(text, encoding="utf-8", newline="")
    return path


def test_no_cards_is_none_set() -> None:
    assert read(None).cards is None
    assert read(None).as_json()["cards"] is None
    assert from_json({"search": "text"}).as_json()["cards"] is None


def test_a_card_sets_properties_links_and_counts_in_the_order_written(tmp_path: Path) -> None:
    text = (
        "cards:\n"
        "  Title:\n"
        "    show: [summary, release_year, rating]\n"
        "    links: [directed_by, listed_in out]\n"
        "    counts: [features]\n"
        "  Person:\n"
        "    counts: [features in, directed_by in]\n"
    )
    settings = read(_write(tmp_path, text))
    assert settings.cards == (
        CardView(
            name="Title",
            show=("summary", "release_year", "rating"),
            links=("directed_by", "listed_in out"),
            counts=("features",),
        ),
        CardView(name="Person", show=(), links=(), counts=("features in", "directed_by in")),
    )
    assert settings.as_json()["cards"] == [
        {
            "name": "Title",
            "show": ["summary", "release_year", "rating"],
            "links": ["directed_by", "listed_in out"],
            "counts": ["features"],
        },
        {"name": "Person", "show": [], "links": [], "counts": ["features in", "directed_by in"]},
    ]


def test_a_card_set_shows_only_what_it_lists(tmp_path: Path) -> None:
    """A card that is set lists its facts; a part it leaves out shows nothing (V-6)."""
    settings = read(_write(tmp_path, "cards:\n  Genre: {}\n"))
    assert settings.as_json()["cards"] == [{"name": "Genre", "show": [], "links": [], "counts": []}]


def test_cards_are_set_once_per_type_beside_the_types_list(tmp_path: Path) -> None:
    """Setting a card does not change which types the page lists (V-7, V-15)."""
    settings = read(_write(tmp_path, "cards:\n  Person:\n    show: [name]\n"))
    assert settings.types is None
    both = read(_write(tmp_path, "types:\n  Title: {}\ncards:\n  Person:\n    show: [name]\n"))
    assert [t.name for t in both.types or ()] == ["Title"]
    assert [c.name for c in both.cards or ()] == ["Person"]


def test_an_empty_cards_mapping_sets_no_card(tmp_path: Path) -> None:
    assert read(_write(tmp_path, "cards: {}\n")).as_json()["cards"] == []


def test_the_example_sets_cards_and_matches_the_schema() -> None:
    settings = read(EXAMPLE)
    assert settings.cards, "views/example.yaml shows the cards setting"
    jsonschema.validate(yaml.safe_load(EXAMPLE.read_text(encoding="utf-8")), SCHEMA)


@pytest.mark.parametrize(
    ("text", "line", "setting"), cases("cards_wrong", "text", "line", "setting")
)
def test_a_wrong_card_names_the_file_line_and_setting(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    message = str(e.value)
    assert message.startswith(f"{path}:{line}: view file: "), message
    assert setting in message, message


@pytest.mark.parametrize(
    ("text", "line", "setting"), cases("cards_wrong", "text", "line", "setting")
)
def test_the_schema_refuses_each_wrong_card(text: str, line: int, setting: str) -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(yaml.safe_load(text), SCHEMA)


@pytest.mark.parametrize(
    "item", ["directed_by", "directed_by in", "directed_by out", "x", "_a1", "Ünïcode"]
)
def test_a_link_is_an_edge_type_name_alone_or_with_in_or_out(tmp_path: Path, item: str) -> None:
    text = f"cards:\n  A:\n    links: ['{item}']\n    counts: ['{item}']\n"
    settings = read(_write(tmp_path, text))
    assert settings.cards == (CardView(name="A", show=(), links=(item,), counts=(item,)),)
    jsonschema.validate(yaml.safe_load(text), SCHEMA)


def test_the_same_link_in_links_and_counts_is_allowed(tmp_path: Path) -> None:
    """Showing the things a link leads to and how many there are are two facts (V-6)."""
    text = "cards:\n  A:\n    links: [rel]\n    counts: [rel]\n"
    assert read(_write(tmp_path, text)).as_json()["cards"][0]["counts"] == ["rel"]


@pytest.mark.parametrize("item", ["a\ufeff", "a\u0085", "a\u001c", "a\u00a0 in"])
def test_only_ascii_white_space_ends_a_links_name_as_in_the_page(tmp_path: Path, item: str) -> None:
    """The reader, the schema and the page (view.cards.test.ts) accept the same links."""
    data = {"cards": {"A": {"links": [item]}}}
    assert from_json(data).as_json()["cards"][0]["links"] == [item]
    jsonschema.validate(data, SCHEMA)


READING = REPO / "conformance" / "reading"


def _accepted(tmp_path: Path, text: str) -> bool:
    try:
        read(_write(tmp_path, text))
    except ValueError:
        return False
    return True


def _schema_accepts(text: str) -> bool:
    try:
        jsonschema.validate(yaml.safe_load(text), SCHEMA)
    except jsonschema.ValidationError:
        return False
    return True


# Duplicates (spec 0.1 section 5: duplicate keys are rejected) and ordering.


@pytest.mark.parametrize(("text", "line"), cases("cards_duplicate_keys", "text", "line"))
def test_a_duplicate_key_in_cards_names_file_and_line(tmp_path: Path, text: str, line: int) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:{line}: "), str(e.value)


def test_adding_cards_changes_no_other_setting(tmp_path: Path) -> None:
    """V-7, V-15: cards sit beside the other choices and do not alter them."""
    base = "search: text\ntheme: dark\ntypes:\n  A:\n    label: Ay\nexport:\n  types: [A]\n"
    plain = read(_write(tmp_path, base)).as_json()
    carded = read(_write(tmp_path, base + "cards:\n  B:\n    show: [x]\n")).as_json()
    assert {k: v for k, v in carded.items() if k != "cards"} == {
        k: v for k, v in plain.items() if k != "cards"
    }
    assert plain["cards"] is None


# YAML 1.2: only true/false are booleans, only null/~/empty are null.


@pytest.mark.parametrize(
    ("text", "line", "setting"), cases("cards_wrong_kind", "text", "line", "setting")
)
def test_a_card_of_the_wrong_kind_names_file_line_and_setting(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:{line}: view file: "), str(e.value)
    assert setting in str(e.value)
    assert not _schema_accepts(text)


def test_of_several_wrong_cards_the_first_written_is_named(tmp_path: Path) -> None:
    text = "cards:\n  A:\n    show: [x]\n  B:\n    links: [a b c]\n  C:\n    show: x\n"
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:5: "), str(e.value)
    assert "cards.B.links" in str(e.value)


# Links: an edge type name, alone or followed by one space and in or out.


@pytest.mark.parametrize("item", cases("cards_odd_links", "item"))
def test_the_reader_and_the_schema_agree_on_each_odd_link(tmp_path: Path, item: str) -> None:
    """One definition of a link: what the reader takes, the schema takes, and the converse."""
    text = f"cards:\n  A:\n    links: [{json.dumps(item)}]\n    counts: [{json.dumps(item)}]\n"
    assert _accepted(tmp_path, text) == _schema_accepts(text)


@pytest.mark.parametrize(
    "item", ["in", "out", "in in", "in out", "out in", "out out", "a/b", "日本 in"]
)
def test_a_link_may_be_an_edge_type_named_in_or_out(tmp_path: Path, item: str) -> None:
    text = f"cards:\n  A:\n    links: [{json.dumps(item)}]\n"
    assert read(_write(tmp_path, text)).cards == (CardView("A", (), (item,), ()),)


def test_the_same_edge_in_both_directions_is_two_links(tmp_path: Path) -> None:
    text = "cards:\n  A:\n    links: [rel in, rel out, rel]\n    counts: [rel out, rel in]\n"
    assert read(_write(tmp_path, text)).cards == (
        CardView("A", (), ("rel in", "rel out", "rel"), ("rel out", "rel in")),
    )


# Sizes, odd text and determinism.


def test_explicit_empty_lists_equal_omitted_parts(tmp_path: Path) -> None:
    explicit = "cards:\n  A:\n    show: []\n    links: []\n    counts: []\n"
    assert read(_write(tmp_path, explicit)) == read(_write(tmp_path, "cards:\n  A: {}\n"))


@pytest.mark.parametrize(
    "cards",
    [
        {"A": {"show": ["x", "x"]}},
        {"": {}},
        {"A": {"links": ["a b c"]}},
        {"A": {"counts": [3]}},
        {"A": {"colour": "red"}},
        {"A": None},
        {"A": []},
        [],
        [{"name": "A"}],
        "A",
        3,
        None,
    ],
)
def test_from_json_refuses_wrong_cards(cards: object) -> None:
    with pytest.raises(ValueError, match="cards"):
        from_json({"cards": cards})


# The schema alone.


# The commands (V-15, V-16, V-18): a wrong card is the same error as for the other keys, and the
# page gets the cards as written.


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "dist"
    assets = directory / "assets"
    assets.mkdir(parents=True)
    (directory / "index.html").write_text(
        "<!doctype html>\n<html><head>\n"
        '<script type="module" crossorigin src="./assets/index-A1.js"></script>\n'
        '<link rel="stylesheet" crossorigin href="./assets/index-B2.css">\n'
        '</head><body><div id="app"></div></body></html>\n',
        encoding="utf-8",
    )
    (assets / "index-A1.js").write_text('const page = "page";\n', encoding="utf-8")
    (assets / "index-B2.css").write_text("body { margin: 0; }\n", encoding="utf-8")
    (assets / "sqlite3-D4.wasm").write_bytes(b"\0asm")
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    monkeypatch.setattr(export, "VIEWER_DIST", directory, raising=False)
    return directory


def _mosaic(tmp_path: Path) -> Path:
    path = tmp_path / "files" / "mosaic.mosaic"
    path.parent.mkdir(exist_ok=True)
    shutil.copyfile(READING / "mosaic.mosaic", path)
    return path


def test_export_refuses_a_wrong_card_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bad = _write(tmp_path, "search: text\ncards:\n  Item:\n    show: [a, a]\n")
    out = tmp_path / "out.html"
    assert main(["export", str(_mosaic(tmp_path)), "--view", str(bad), "-o", str(out)]) == 1
    assert capsys.readouterr().err.startswith(f"mosaic export: {bad}:4: view file: cards.Item.show")
    assert not out.exists()


def test_export_carries_the_cards_even_for_types_the_mosaic_lacks(
    tmp_path: Path, dist: Path
) -> None:
    """V-18: a card naming what the mosaic lacks still opens; the page reports it, so the export
    keeps the card as written."""
    text = "search: text\ncards:\n  NoSuchType:\n    show: [nope]\n    links: [nothing out]\n"
    path = _write(tmp_path, text)
    out = tmp_path / "out.html"
    assert main(["export", str(_mosaic(tmp_path)), "--view", str(path), "-o", str(out)]) == 0
    page = out.read_text(encoding="utf-8")
    start = page.index('id="mosaic-export">') + len('id="mosaic-export">')
    data = json.loads(page[start : page.index("</script>", start)])
    assert data["view"]["cards"] == [
        {"name": "NoSuchType", "show": ["nope"], "links": ["nothing out"], "counts": []}
    ]
    assert data["view"] == view_file.read(path).as_json()
