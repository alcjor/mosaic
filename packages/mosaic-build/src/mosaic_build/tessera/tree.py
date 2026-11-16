"""Text files under one directory, as the sources of one tessera.

The document and code builders read a directory. Each file they read is one source of the
tessera (kind ``file``): its id and path are the file's path below the directory, with ``/``,
its hash the SHA-256 of its bytes, and its text is kept so the full text tier can hold it.
Files are named by ``include`` patterns (``**`` crosses directories) and taken in the UTF-8
byte order of their paths, so the same directory gives the same tessera.
"""

from __future__ import annotations

import hashlib
import os
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from mosaic_format.writer import Source


@dataclass(frozen=True)
class TextFile:
    """One file read: its path below the directory, its text and its source row."""

    path: str
    text: str
    source: Source

    def line(self, offset: int) -> int:
        """The line, from 1, of the character at ``offset``."""
        return bisect_right(_line_starts(self.text), offset)

    def locator(self, start: int, end: int) -> str:
        """The locator of the characters from ``start`` up to ``end`` (section 3.5)."""
        return f"file={self.path};line={self.line(start)};chars={start}-{end}"


_STARTS: dict[int, tuple[str, list[int]]] = {}


def _line_starts(text: str) -> list[int]:
    kept = _STARTS.get(id(text))
    if kept is None or kept[0] is not text:
        starts = [0]
        at = text.find("\n")
        while at != -1:
            starts.append(at + 1)
            at = text.find("\n", at + 1)
        _STARTS.clear()  # one text at a time is enough: builders go file by file
        _STARTS[id(text)] = kept = (text, starts)
    return kept[1]


def read_tree(
    root: str | os.PathLike[str], include: Sequence[str], notice: str | None
) -> list[TextFile]:
    """The files under ``root`` that ``include`` names, in the byte order of their paths.

    Raises ``ValueError`` naming the directory, pattern or file when ``root`` is not a
    directory, a pattern names no file, or a file is not UTF-8 text or has a path that cannot
    be a locator value.
    """
    base = Path(root)
    if not base.is_dir():
        raise ValueError(f"{base}: not a directory")
    paths: dict[str, Path] = {}
    for pattern in include:
        try:
            found = [p for p in base.glob(pattern) if p.is_file()]
        except (ValueError, NotImplementedError) as e:
            raise ValueError(f"{base}: include {pattern!r}: {e}") from None
        if not found:
            raise ValueError(f"{base}: include {pattern!r} names no file")
        for p in found:
            paths[p.relative_to(base).as_posix()] = p
    files: list[TextFile] = []
    for name in sorted(paths, key=lambda n: n.encode("utf-8")):
        if ";" in name or "\n" in name:
            raise ValueError(
                f"{base / name}: a path with ';' or a line break cannot be a locator value "
                "(section 3.5); rename the file"
            )
        data = paths[name].read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as e:
            raise ValueError(f"{base / name}: not UTF-8 text (byte {e.start})") from None
        source = Source(
            id=name,
            kind="file",
            hash=hashlib.sha256(data).hexdigest(),
            path=name,
            notice=notice,
            text=text,
        )
        files.append(TextFile(name, text, source))
    return files
