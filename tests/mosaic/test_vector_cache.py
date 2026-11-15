"""The vector cache: a text is embedded once, and a cache that cannot be used changes nothing."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from mosaic_build.mosaic.vector_cache import CachedEmbeds, cache_dir


class Model:
    """Stands in for the model and remembers the texts it was asked for."""

    def __init__(self) -> None:
        self.asked: list[str] = []

    def bits(self, text: str) -> bytes:
        self.asked.append(text)
        return hashlib.sha256(text.encode("utf-8")).digest() + bytes(16)


def run(directory: Path | None, key: str = "model-a") -> tuple[list[bytes], list[str]]:
    model = Model()
    cached = CachedEmbeds(model, key, directory)
    return [
        cached.bits(t) for t in ("Seated figure", "Standing figure", "Seated figure")
    ], model.asked


def test_a_later_build_gets_the_same_bytes_without_the_model(tmp_path: Path) -> None:
    first, asked = run(tmp_path)
    assert asked == ["Seated figure", "Standing figure"]
    assert run(tmp_path) == (first, [])


def test_another_model_does_not_share_vectors(tmp_path: Path) -> None:
    run(tmp_path)
    assert run(tmp_path, key="model-b")[1] == ["Seated figure", "Standing figure"]


@pytest.mark.parametrize("state", ["off", "not a directory", "damaged file"])
def test_a_cache_that_cannot_be_used_leaves_the_model_to_answer(tmp_path: Path, state: str) -> None:
    expected, _ = run(tmp_path / "good")
    directory: Path | None = tmp_path / "cache"
    if state == "off":
        directory = None
    elif state == "not a directory":
        (tmp_path / "cache").write_text("in the way", encoding="utf-8")
    else:
        run(directory)
        for file in (tmp_path / "cache" / "vectors").iterdir():
            file.write_bytes(b"not a database" * 500)
    for _ in range(2):
        found, asked = run(directory)
        assert found == expected and asked


def test_the_cache_directory_comes_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MOSAIC_CACHE_DIR", str(tmp_path))
    assert cache_dir() == tmp_path
    monkeypatch.setenv("MOSAIC_CACHE_DIR", "")
    assert cache_dir() is None
    monkeypatch.delenv("MOSAIC_CACHE_DIR")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    assert cache_dir() == tmp_path / "mosaic"
