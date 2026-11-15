"""The view-file text the page gives for a chain built in it reads back as that chain
(docs/design.md V-15).

Each text here is what the page writes (``chainsText`` in ``viewer/src/lib/viewchains.ts``) for
the view file's chains and the one built, byte for byte: ``viewer/test/viewchains.test.ts``
checks the page writes exactly these texts. Read by the view-file reader ``mosaic view`` and
``mosaic export`` use, each gives the chains it was written for.
"""

from pathlib import Path
from typing import Any

import pytest
from mosaic_build import view_file

TEXTS: list[tuple[str, list[dict[str, Any]]]] = [
    (
        'chains:\n  "Items in x":\n    start: Item\n    steps:\n      - link: in_group out\n'
        '        pin: "Group:x"\n',
        [
            {
                "name": "Items in x",
                "start": "Item",
                "pin": None,
                "steps": [{"link": "in_group out", "pin": "Group:x"}],
            }
        ],
    ),
    (
        'chains:\n  A:\n    start: Group\n  Mine:\n    start: Item\n    pin: "Item:a"\n'
        '    steps:\n      - in_group\n      - link: in_group in\n        pin: "Item:b"\n',
        [
            {"name": "A", "start": "Group", "pin": None, "steps": []},
            {
                "name": "Mine",
                "start": "Item",
                "pin": "Item:a",
                "steps": [
                    {"link": "in_group", "pin": None},
                    {"link": "in_group in", "pin": "Item:b"},
                ],
            },
        ],
    ),
    ("chains: {}\n", []),
    (
        'chains:\n  "2024: \\"best\\" #1 é\\u2028":\n    start: Item\n    pin: "Item:true"\n',
        [{"name": '2024: "best" #1 é\u2028', "start": "Item", "pin": "Item:true", "steps": []}],
    ),
]


@pytest.mark.parametrize(("text", "chains"), TEXTS)
def test_the_page_s_text_reads_back_as_the_chains_it_was_written_for(
    tmp_path: Path, text: str, chains: list[dict[str, Any]]
) -> None:
    path = tmp_path / "view.yaml"
    path.write_text(text, encoding="utf-8")
    assert view_file.read(path).as_json()["chains"] == chains
