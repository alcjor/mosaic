"""The view-file text the page gives for a card choice reads back as that choice
(docs/design.md V-15).

Each text here is what the page writes (``cardsText`` in ``viewer/src/lib/cardpick.ts``) for its
cards, byte for byte: ``viewer/test/cardpick.test.ts`` checks the page writes exactly these texts.
Read by the view-file reader ``mosaic view`` and ``mosaic export`` use, each gives the cards it
was written for.
"""

from pathlib import Path
from typing import Any

import pytest
from mosaic_build import view_file

LONG = "T" * 1100
"""A type name past YAML's implicit key limit (1024 characters): written as an explicit key."""

TEXTS: list[tuple[str, list[dict[str, Any]]]] = [
    (
        "cards:\n  Item:\n    show: [code, summary]\n    links: [in_group]\n",
        [{"name": "Item", "show": ["code", "summary"], "links": ["in_group"], "counts": []}],
    ),
    (
        "cards:\n  Item:\n    counts: [in_group out]\n  Group:\n    show: [name]\n"
        "    links: [in_group in]\n    counts: [in_group in]\n",
        [
            {"name": "Item", "show": [], "links": [], "counts": ["in_group out"]},
            {
                "name": "Group",
                "show": ["name"],
                "links": ["in_group in"],
                "counts": ["in_group in"],
            },
        ],
    ),
    ("cards:\n  Item: {}\n", [{"name": "Item", "show": [], "links": [], "counts": []}]),
    ("cards: {}\n", []),
    (
        'cards:\n  "Null":\n    show: ["release year", "true", "2020", "a: b", "#x", '
        '"say \\"hi\\"", "é", "- x", "[y]"]\n    links: [no, on in]\n',
        [
            {
                "name": "Null",
                "show": [
                    "release year",
                    "true",
                    "2020",
                    "a: b",
                    "#x",
                    'say "hi"',
                    "é",
                    "- x",
                    "[y]",
                ],
                "links": ["no", "on in"],
                "counts": [],
            }
        ],
    ),
    (
        'cards:\n  Item:\n    show: ["a\\u2028b\\u007fc\\u0085d"]\n',
        [{"name": "Item", "show": ["a\u2028b\x7fc\x85d"], "links": [], "counts": []}],
    ),
    (f"cards:\n  ? {LONG}\n  : {{}}\n", [{"name": LONG, "show": [], "links": [], "counts": []}]),
]


@pytest.mark.parametrize(("text", "cards"), TEXTS, ids=range(len(TEXTS)))
def test_the_text_the_page_writes_reads_back_as_the_cards_it_was_written_for(
    tmp_path: Path, text: str, cards: list[dict[str, Any]]
) -> None:
    path = tmp_path / "view.yaml"
    path.write_bytes(text.encode("utf-8"))
    read = view_file.read(path).as_json()["cards"]
    assert (read or []) == cards
