"""A type keyed by several identifiers in order of trust (Specification 0.1, section 5.2).

Each case of ``cases/key_identifiers.json`` gives a type's ``key`` and ``from``, the rows of
each piece (their props, in order), and the nodes and aliases the build has, or the node an
``invalid_input`` failure names.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from mosaic_build.mosaic.errors import BuildError

from tests.mosaic.pieces import node
from tests.mosaic.test_map_merge import assemble

CASES = json.loads((Path(__file__).parent / "cases" / "key_identifiers.json").read_text("utf-8"))


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_the_first_identifier_with_a_value_gives_the_key(
    tmp_path: Path, case: dict[str, Any]
) -> None:
    pieces = [
        (
            name,
            [node(f"Row:{i}", f"r{i}", **props) for i, props in enumerate(rows, 1)],
            {"source": f"{name}.csv"},
        )
        for name, rows in case["pieces"].items()
    ]
    types = {"Gem": {"key": case["key"], "from": case["from"]}}
    if "error" in case:
        with pytest.raises(BuildError) as e:
            assemble(tmp_path, pieces, types)
        assert e.value.reason == "invalid_input"
        assert case["error"] in str(e.value)
        return
    a = assemble(tmp_path, pieces, types)
    assert {n.id: json.loads(n.props or "{}") for n in a.node_rows()} == case["nodes"]
    assert [[x.text, x.node, x.origin] for x in a.aliases()] == case["aliases"]
