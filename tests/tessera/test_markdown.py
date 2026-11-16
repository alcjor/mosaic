"""The document tessera builder (Specification 0.1 sections 3.5, 4.1 and 4.2).

A directory of Markdown files gives one tessera: a source and a ``Page`` per file, a
``Section`` per heading, ``part_of`` and ``under`` edges, aliases from the front matter and
the ``address`` template, and mentions for inline code, link targets and the front matter
fields the settings name. ``data/markdown/handbook`` is an invented handbook; what it gives
is ``handbook.json``.
"""

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from mosaic_build.tessera.markdown import Settings, load_settings, read
from mosaic_format.check import check_file
from mosaic_format.writer import seal

DATA = Path(__file__).parent / "data" / "markdown"
HANDBOOK = DATA / "handbook"
CASES = json.loads(
    (Path(__file__).parent / "cases" / "markdown_wrong_settings.json").read_text("utf-8")
)


def _chars(locator: str) -> tuple[str, int, int, int]:
    """A locator's file, line and character range."""
    parts = dict(p.split("=", 1) for p in locator.split(";"))
    start, end = parts["chars"].split("-")
    return parts["file"], int(parts["line"]), int(start), int(end)


def test_the_handbook_gives_its_pages_sections_aliases_and_mentions() -> None:
    made = read(HANDBOOK, load_settings(DATA / "handbook.yaml"))
    found = {
        "nodes": [
            [n.id, n.type, n.label, n.summary, json.loads(n.props or "{}")] for n in made.nodes
        ],
        "edges": [[e.src, e.type, e.dst] for e in made.edges],
        "aliases": [[a.text, a.node] for a in made.aliases],
        "evidence": [
            [e.subject, e.locator, e.snippet] for e in made.evidence if isinstance(e.subject, str)
        ],
        "mentions": [[m.role, m.text, m.node, _chars(m.locator)[1]] for m in made.mentions],
    }
    assert found == json.loads((DATA / "handbook.json").read_text("utf-8"))
    assert {a.origin for a in made.aliases} == {"source"}
    assert {m.kind for m in made.mentions} == {"identifier"}


def test_a_mention_is_located_at_its_own_characters() -> None:
    made = read(HANDBOOK, load_settings(DATA / "handbook.yaml"))
    for mention in made.mentions:
        file, _, start, end = _chars(mention.locator)
        text = (HANDBOOK / file).read_text("utf-8")
        assert text[start:end] == mention.text, mention.locator
    assert len({m.locator for m in made.mentions}) == len(made.mentions)


def test_every_file_is_a_source_with_the_notice(tmp_path: Path) -> None:
    made = read(HANDBOOK, load_settings(DATA / "handbook.yaml"))
    assert [(s.id, s.kind, s.notice) for s in made.sources] == [
        (name, "file", "Invented handbook, free to copy")
        for name in ("catalogue.md", "guide/lending.md", "plain.md")
    ]


def test_the_sealed_tessera_passes_the_check_and_is_the_same_twice(tmp_path: Path) -> None:
    settings = load_settings(DATA / "handbook.yaml")
    copy = shutil.copytree(HANDBOOK, tmp_path / "elsewhere")
    first = seal(tmp_path / "first.tessera", read(HANDBOOK, settings))
    second = seal(tmp_path / "second.tessera", read(copy, settings))
    assert first.knowledge_hash == second.knowledge_hash
    assert [str(v) for v in check_file(first.path).violations] == []


def test_the_recorded_settings_are_a_settings_file(tmp_path: Path) -> None:
    settings = load_settings(DATA / "handbook.yaml")
    again = tmp_path / "settings.json"
    again.write_text(settings.as_json(), encoding="utf-8")
    assert load_settings(again) == settings


def test_a_front_matter_value_not_written_on_its_line_is_located_by_the_line(
    tmp_path: Path,
) -> None:
    text = '---\nuses: "shelf\\u005Fmark"\n---\nText.\n'
    (tmp_path / "a.md").write_text(text, encoding="utf-8")
    made = read(tmp_path, Settings(include=("*.md",), mentions={"uses": "value"}))
    assert [(m.role, m.text, m.locator) for m in made.mentions] == [
        ("front.uses", "shelf_mark", "file=a.md;line=2;chars=4-27")
    ]


def test_front_matter_values_are_located_in_the_value_also_over_several_lines(
    tmp_path: Path,
) -> None:
    text = "---\nneeds: e\nuses: >\n  ink and\n  paper\n---\nText.\n"
    (tmp_path / "a.md").write_text(text, encoding="utf-8")
    made = read(tmp_path, Settings(include=("*.md",), mentions={"needs": "value", "uses": "words"}))
    found = {m.text: _chars(m.locator)[2:] for m in made.mentions}
    assert {word: text[start:end] for word, (start, end) in found.items()} == {
        w: w for w in ("e", "ink", "and", "paper")
    }
    assert found["e"] == (11, 12)  # the value, not the "e" of its key


def test_aliases_that_differ_only_in_case_are_one_alias(tmp_path: Path) -> None:
    (tmp_path / "a.md").write_text("---\ncodes: [Q1, q1, Q2]\n---\nText.\n", encoding="utf-8")
    made = read(tmp_path, Settings(include=("*.md",), aliases=("codes",)))
    assert [a.text for a in made.aliases] == ["Q1", "Q2"]
    assert seal(tmp_path / "a.tessera", made).knowledge_hash


def test_an_include_pattern_must_name_files(tmp_path: Path) -> None:
    (tmp_path / "a.md").write_text("Text.\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"\*\*"):
        read(tmp_path, Settings(include=("**",)))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_a_wrong_setting_names_the_file_the_line_and_the_setting(
    tmp_path: Path, case: dict[str, Any]
) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(case["text"], encoding="utf-8")
    with pytest.raises(ValueError) as error:
        load_settings(path)
    message = str(error.value)
    assert message.startswith(f"{path}:{case['line']}:"), message
    assert case["named"] in message, message


@pytest.mark.parametrize(
    ("data", "where"),
    [
        (b"# Caf\xe9\n", "menu.md"),
        (b"---\ntitle: [open\n---\n# Menu\n", "menu.md:3"),
        (b"---\ntitle: a\ntitle: b\n---\n", "menu.md:3"),
        (b"---\n- soup\n---\n", "menu.md:2"),
    ],
    ids=["not UTF-8", "not YAML", "duplicate key", "not a mapping"],
)
def test_a_file_that_cannot_be_read_is_an_error_naming_it(
    tmp_path: Path, data: bytes, where: str
) -> None:
    (tmp_path / "menu.md").write_bytes(data)
    with pytest.raises(ValueError) as error:
        read(tmp_path, Settings(include=("*.md",)))
    assert str(tmp_path / where) in str(error.value)
