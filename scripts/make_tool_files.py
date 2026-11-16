"""Write ``conformance/tools/passages.mosaic``: a mosaic of the full text tier (section 7.3).

The Chinook mosaic of the other tool cases holds no source text, so the cases of
``conformance/tools/expected-passages.json`` (``cite`` with ``around``) run on this file: one
text source kept whole in ``source_text``, with evidence whose locators carry ``chars`` ranges,
and one source without text. The text has ``é`` and ``😀`` before the ranges, so offsets counted
in bytes or UTF-16 units give other passages than offsets counted in code points. Invented data.
Run it from the repository root::

    uv run python scripts/make_tool_files.py [--out DIR]
"""

import argparse
import hashlib
from pathlib import Path

from mosaic_format import seal
from mosaic_format.writer import Content, Evidence, Header, Node, Source, Type

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "conformance" / "tools"
NAME = "passages.mosaic"
PRODUCER = "make-tool-files/0.1"

TEXT = (
    "Café notes 😀 for the keeper. The lamp is lit at dusk. "
    "The keeper trims the wick before the bell rings twice. The log is signed at dawn."
)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _chars(phrase: str) -> str:
    start = TEXT.index(phrase)
    return f"chars={start}-{start + len(phrase)}"


def content() -> Content:
    """One piece with a text source and a table source; a note for each kind of locator."""
    notes, sheet = "first/notes", "first/sheet"

    def row(node: str, source: str, locator: str, snippet: str | None = None) -> Evidence:
        return Evidence(node, source, locator, "extracted", PRODUCER, snippet=snippet)

    return Content(
        header=Header(
            kind="mosaic", producer=PRODUCER, pattern_hash=_hash("pattern.yaml"), target="all"
        ),
        sources=[
            Source(id="first", kind="tessera", hash=_hash("first"), path="first.tessera"),
            Source(id=notes, kind="file", hash=_hash(TEXT), path="notes.txt", text=TEXT),
            Source(id=sheet, kind="file", hash=_hash("sheet.csv"), path="sheet.csv"),
        ],
        types=[Type(name="Note", kind="node", key_prop="name", props='{"name":"text"}')],
        nodes=[
            Node(id=f"Note:{key}", type="Note", key=key, label=label, props=f'{{"name":"{key}"}}')
            for key, label in [
                ("wick", "Trimming the wick"),
                ("lamp", "Lighting the lamp"),
                ("sheet", "A row of the sheet"),
                ("lost", "A range past the end of the text"),
            ]
        ],
        evidence=[
            row("Note:wick", notes, f"file=notes.txt;{_chars('trims the wick')}", "trims the wick"),
            row("Note:wick", notes, "file=notes.txt;line=1"),
            row("Note:lamp", notes, _chars("The lamp is lit"), "The lamp is lit"),
            row("Note:sheet", sheet, "row=1", "wick,1"),
            row("Note:lost", notes, f"chars=100-{len(TEXT) + 1}"),
        ],
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    out: Path = parser.parse_args(argv).out
    out.mkdir(parents=True, exist_ok=True)
    (out / NAME).unlink(missing_ok=True)
    print(f"{NAME} {seal(out / NAME, content()).knowledge_hash}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
