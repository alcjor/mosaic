"""The design tokens are sound, and tokens.css is generated from them.

See design/README.md. Stylelint (viewer/.stylelintrc.json) rejects raw colours and
lengths in the viewer, inline styles included; the viewer's browser tests
(viewer/browser/shell.browser.ts) check that the page uses only tokens it defines.
"""

import json
import re
import subprocess
import sys

from tests.conftest import REPO

TOKENS = REPO / "design" / "tokens.json"


def test_token_names_are_unique_and_valid() -> None:
    data = json.loads(TOKENS.read_text(encoding="utf-8"))
    names = [t["name"] for t in data["color"]["tokens"]]
    for family in ("spacing", "radius"):
        names += [t["name"] for t in data.get(family, {}).get("tokens", [])]
    assert len(names) == len(set(names)), "duplicate token names"
    assert all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", n) for n in names)


def test_every_token_has_a_usage_note() -> None:
    data = json.loads(TOKENS.read_text(encoding="utf-8"))
    for family in ("color", "spacing", "radius"):
        for tok in data[family]["tokens"]:
            assert tok.get("usage"), f"{family} token {tok['name']} has no usage note"


def test_tokens_css_is_up_to_date() -> None:
    result = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "gen_tokens.py"), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
