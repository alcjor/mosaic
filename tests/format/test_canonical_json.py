"""Canonical JSON text: RFC 8785 and I-JSON (section 3.1, decision).

Expected number strings are ECMAScript ``String(x)`` for each double, generated with Bun from
the bit patterns of RFC 8785 Appendix B, so they test against the standard, not this code.
"""

import json
import struct
from pathlib import Path
from typing import Any

import pytest
from mosaic_format.canonical_json import canonical_json

CASES = Path(__file__).parent / "cases"


def _cases(name: str) -> list[dict[str, Any]]:
    return json.loads((CASES / f"{name}.json").read_text("utf-8"))


# RFC 8785 Appendix B: IEEE 754 bit pattern -> ECMAScript Number::toString.
@pytest.mark.parametrize("case", _cases("canonical_json_rfc8785"), ids=lambda c: c["name"])
def test_numbers_follow_rfc_8785_appendix_b(case: dict[str, str]) -> None:
    (x,) = struct.unpack(">d", bytes.fromhex(case["bits"]))
    assert canonical_json(f"[{x!r}]") == f"[{case['expected']}]"


@pytest.mark.parametrize("case", _cases("canonical_json_spellings"), ids=lambda c: c["name"])
def test_number_spellings(case: dict[str, str]) -> None:
    assert canonical_json(f"[{case['text']}]") == f"[{case['expected']}]"


def test_keys_sort_by_utf16_code_units_not_utf8_bytes() -> None:
    """U+1F600 is a surrogate pair (0xD83D...), so it sorts before U+FB33 in UTF-16 order."""
    text = '{"\\u20ac":1,"\\r":2,"\\ufb33":3,"1":4,"\\ud83d\\ude00":5,"\\u0080":6,"\\u00f6":7}'
    expected = '{"\\r":2,"1":4,"\u0080":6,"\u00f6":7,"\u20ac":1,"\U0001f600":5,"\ufb33":3}'
    assert canonical_json(text) == expected


def test_strings_escape_only_what_json_requires() -> None:
    text = '"a\\u0000\\u001f\\u007f\\"\\\\\\/\\b\\f\\n\\r\\t\\u2028\\u00e9\\ud83d\\ude00"'
    expected = '"a\\u0000\\u001f\x7f\\"\\\\/\\b\\f\\n\\r\\t\u2028\u00e9\U0001f600"'
    assert canonical_json(text) == expected


def test_whitespace_goes_and_nesting_is_kept() -> None:
    text = ' { "b" : [ 1 , { "y" : true , "x" : null } ] , "a" : "s" } '
    assert canonical_json(text) == '{"a":"s","b":[1,{"x":null,"y":true}]}'


@pytest.mark.parametrize(
    "text",
    [
        '{"a":1,"b":[2,3]}',
        '["' + "b" * 64 + '","' + "a" * 64 + '"]',
        '{"note":"a\\u0000b","n":-0.5,"big":"12345678901234567890"}',
        "[]",
        "{}",
    ],
)
def test_canonical_text_is_a_fixed_point(text: str) -> None:
    once = canonical_json(text)
    assert canonical_json(once) == once


@pytest.mark.parametrize("case", _cases("canonical_json_refused"), ids=lambda c: c["name"])
def test_refuses_what_is_not_i_json(case: dict[str, Any]) -> None:
    with pytest.raises(ValueError) as refused:
        canonical_json(case["text"])
    for name in case["names"]:
        assert name in str(refused.value)
