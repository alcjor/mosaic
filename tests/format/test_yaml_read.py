"""Patterns, proposals, settings and view files are read as YAML that holds JSON data.

Spec 0.1 section 5: the files are read as YAML 1.2 and a reader MUST reject duplicate keys.
A standard loader does the reading; keys must be text and values JSON data.
"""

import math

import pytest
from mosaic_format.yaml_read import YamlError, load


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("yes", "yes"),
        ("on", "on"),
        ("true", True),
        ("FALSE", False),
        ("null", None),
        ("~", None),
        ("", None),
        ("017", 17),
        ("0x1F", 31),
        ("1.5", 1.5),
        ("-.inf", -math.inf),
        ("12:30:00", "12:30:00"),
        ("'017'", "017"),
        ('"2026-11-01"', "2026-11-01"),
        ("!!str 12", "12"),
    ],
)
def test_scalars_are_yaml_1_2(text: str, value: object) -> None:
    loaded = load(f"v: {text}\n", "f.yaml").data
    assert loaded == {"v": value}
    assert type(loaded["v"]) is type(value)


def test_block_scalars_collections_and_aliases() -> None:
    doc = load("a: &x [1, two]\nb: {c: d}\ne: |\n  line\nf: *x\n", "f.yaml").data
    assert doc == {"a": [1, "two"], "b": {"c": "d"}, "e": "line\n", "f": [1, "two"]}


def _error(text: str) -> YamlError:
    with pytest.raises(YamlError) as caught:
        load(text, "where/f.yaml")
    assert "where/f.yaml" in str(caught.value)
    return caught.value


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("a: 1\na: 2\n", 2),
        ("a:\n  b: 1\n  c: 2\n  b: 3\n", 4),
        ("- {x: 1, x: 2}\n", 1),
        ("a: 1\n'a': 2\n", 2),
    ],
)
def test_duplicate_keys_are_rejected(text: str, line: int) -> None:
    error = _error(text)
    assert error.rule == "duplicate-key"
    assert error.line == line


def _bomb() -> str:
    lines = ["a0: &a0 [x, x, x, x, x, x, x, x, x, x]"]
    lines += [f"a{i}: &a{i} [{', '.join([f'*a{i - 1}'] * 10)}]" for i in range(1, 9)]
    return "\n".join(lines) + "\n"


@pytest.mark.parametrize(
    "text",
    [
        "a: [1\n",
        "a: !custom x\n",
        "a: !!int x\n",
        "a: !!binary aGk=\n",
        "a: 2026-11-01\n",
        "1: a\n",
        "null: a\n",
        "[a]: b\n",
        "a: 1\n---\nb: 2\n",
        "a: *missing\n",
        "v: " + "1" * 5000 + "\n",
        "[" * 2000,
        _bomb(),
    ],
    ids=[
        "unclosed",
        "unknown tag",
        "not an int",
        "bytes",
        "date",
        "number key",
        "null key",
        "list key",
        "two documents",
        "missing anchor",
        "huge number",
        "deep nesting",
        "alias bomb",
    ],
)
def test_other_yaml_is_rejected(text: str) -> None:
    assert _error(text).rule == "yaml"


def test_an_empty_file_is_null() -> None:
    assert load("", "f.yaml").data is None
    assert load("# only a comment\n", "f.yaml").data is None


def test_lines_are_kept_for_every_key_and_item() -> None:
    doc = load("a:\n  b:\n    - x\n    - y\nc: 1\n", "f.yaml")
    assert doc.line(()) == 1
    assert doc.line(("a",)) == 1
    assert doc.line(("a", "b")) == 2
    assert doc.line(("a", "b", 1)) == 4
    assert doc.line(("c",)) == 5
    # An unknown path falls back to its nearest known parent.
    assert doc.line(("a", "b", 1, "z")) == 4
