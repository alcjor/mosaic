"""Write a fixture's ``expected-vectors.json`` from a mosaic built from it.

The fixture tests compare a build's vectors with this sample rather than with one exact hash,
because another processor may give vectors that differ in a few bits (ADR-005).

    uv run python scripts/make_expected_vectors.py MOSAIC conformance/fixtures/chinook [TARGET]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from tests.fixtures.expected import VECTORS_FILE, built_vectors, sample  # noqa: E402


def main(mosaic: str, fixture: str, target: str = "default") -> int:
    chosen = sample(built_vectors(Path(mosaic)))
    out = Path(fixture) / VECTORS_FILE
    data: dict[str, Any] = json.loads(out.read_text("utf-8")) if out.exists() else {"mosaics": {}}
    data["comment"] = (
        "The reference build's vector bits (section 3.7, hex) for a sample of nodes. A build "
        "agrees with at least 98 % of them (ADR-005); written by scripts/make_expected_vectors.py."
    )
    data["mosaics"][target] = {node: bits.hex() for node, bits in chosen.items()}
    out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(chosen)} vectors to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(*sys.argv[1:]))
