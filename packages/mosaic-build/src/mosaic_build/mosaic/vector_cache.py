"""A local cache of node vectors, so a repeated build skips the model.

A build with the same pieces and pattern embeds the same node texts, and the model, run as
section 6 says, gives the same bytes for the same text. The cache keeps those bytes by the
SHA-256 of the text, in one SQLite file per model, tokenizer and runtime version, so a text is
embedded once per machine. It is only a shortcut: a missing, unreadable or locked cache means
the model runs, never that a build fails or differs.

The files live in ``$MOSAIC_CACHE_DIR``, by default ``$XDG_CACHE_HOME/mosaic`` or
``~/.cache/mosaic``. An empty ``MOSAIC_CACHE_DIR`` turns the cache off.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from importlib import metadata
from pathlib import Path
from typing import TYPE_CHECKING

from mosaic_build.mosaic.vectors import EMBED_MODEL, MODEL

if TYPE_CHECKING:
    from mosaic_build.mosaic.vectors import Embeds

ENV = "MOSAIC_CACHE_DIR"


def cache_dir() -> Path | None:
    """Where Mosaic keeps its caches on this machine, or ``None`` when they are off."""
    chosen = os.environ.get(ENV)
    if chosen is not None:
        return Path(chosen).expanduser() if chosen else None
    base = os.environ.get("XDG_CACHE_HOME") or "~/.cache"
    return Path(base).expanduser() / "mosaic"


def model_key() -> str:
    """What a stored vector depends on besides its text: the pinned files and the runtime."""
    return f"{EMBED_MODEL}+{MODEL.tokenizer.sha256}+onnxruntime-{metadata.version('onnxruntime')}"


class CachedEmbeds:
    """``model`` with its answers kept in ``directory`` under ``key``."""

    def __init__(self, model: Embeds, key: str, directory: Path | None) -> None:
        self._model = model
        self._db = _open(directory, key) if directory is not None else None

    def bits(self, text: str) -> bytes:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        kept = self._run("SELECT bits FROM vector WHERE text_hash = ?", (digest,))
        if kept:
            return bytes(kept[0][0])
        made = self._model.bits(text)
        self._run("INSERT OR IGNORE INTO vector (text_hash, bits) VALUES (?, ?)", (digest, made))
        return made

    def _run(self, sql: str, values: tuple[bytes, ...]) -> list[tuple[bytes]]:
        if self._db is None:
            return []
        try:
            return self._db.execute(sql, values).fetchall()
        except sqlite3.Error:
            self._db = None  # the model answers from here on
            return []


def _open(directory: Path, key: str) -> sqlite3.Connection | None:
    name = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    try:
        folder = directory / "vectors"
        folder.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(folder / f"{name}.sqlite", timeout=5, isolation_level=None)
        db.execute("PRAGMA synchronous = OFF")
        db.execute(
            "CREATE TABLE IF NOT EXISTS vector "
            "(text_hash BLOB PRIMARY KEY, bits BLOB NOT NULL) WITHOUT ROWID"
        )
    except (OSError, sqlite3.Error):
        return None
    return db
