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


def _luminance(colour: str) -> float:
    channels = [int(colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: str, b: str) -> float:
    lighter, darker = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def test_every_type_colour_shows_on_the_surface_and_its_two_steps_differ() -> None:
    data = json.loads(TOKENS.read_text(encoding="utf-8"))
    tokens = {t["name"]: t["value"] for t in data["color"]["tokens"]}
    for theme in (t["id"] for t in data["color"]["themes"]):

        def value(name: str, theme: str = theme) -> str:
            got = tokens[name]
            return got if isinstance(got, str) else got[theme]

        colours = [value(f"type-{n}") for n in range(1, 17)]
        assert len(set(colours)) == 16
        for n, colour in enumerate(colours, start=1):
            ratio = _contrast(colour, value("surface"))
            assert ratio >= 3, f"type-{n} in {theme}: {ratio:.2f}:1 on surface"
        for n in range(8):
            apart = _contrast(colours[n], colours[n + 8])
            assert apart >= 1.9, f"type-{n + 1} and type-{n + 9} in {theme}: {apart:.2f}:1"
