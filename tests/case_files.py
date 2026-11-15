"""Case files: ``tests/cases/<topic>.json`` is a list of objects, each with a ``name`` (the test
id), its inputs and its expected result. ``cases`` turns one into parameters for a test."""

import json
from pathlib import Path

import pytest

CASE_DIR = Path(__file__).resolve().parent / "cases"


def cases(topic: str, *keys: str, binary: tuple[str, ...] = ()) -> list[object]:
    """The ``keys`` of each case in ``cases/<topic>.json``; keys in ``binary`` are bytes,
    written in the file as Latin-1 text."""
    rows = json.loads((CASE_DIR / f"{topic}.json").read_text(encoding="utf-8"))
    return [
        pytest.param(
            *(row[k].encode("latin-1") if k in binary else row[k] for k in keys), id=row["name"]
        )
        for row in rows
    ]
