"""The slow tests' build cache (tests/fixtures/build_cache.py).

A fixture is built twice from clean directories only when its inputs are new; the same inputs
reuse the two recorded builds. Each test uses its own cache root and a stand-in build that counts
its runs.
"""

from pathlib import Path

import pytest

from tests.fixtures import build_cache


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cache = tmp_path / "cache"
    monkeypatch.setenv("MOSAIC_FIXTURE_CACHE", str(cache))
    monkeypatch.delenv("MOSAIC_FRESH_BUILDS", raising=False)
    return cache


@pytest.fixture
def inputs(tmp_path: Path) -> list[Path]:
    src = tmp_path / "src"
    (src / "pkg").mkdir(parents=True)
    (src / "pkg" / "a.py").write_text("A = 1\n", encoding="utf-8")
    pattern = tmp_path / "pattern.yaml"
    pattern.write_text("pieces: []\n", encoding="utf-8")
    return [src, pattern]


class Builder:
    def __init__(self, fail: bool = False) -> None:
        self.calls = 0
        self.fail = fail

    def __call__(self, directory: Path) -> tuple[dict[str, object], Path]:
        self.calls += 1
        if self.fail:
            raise AssertionError("build failed")
        directory.mkdir(parents=True)
        out = directory / "out.mosaic"
        out.write_bytes(b"sealed")
        return {"hash": "h", "call": self.calls}, out


def test_new_inputs_are_built_twice_from_clean_directories(
    root: Path, inputs: list[Path], tmp_path: Path
) -> None:
    build = Builder()
    got = build_cache.twice("demo", inputs, build, tmp_path / "work")
    assert build.calls == 2
    assert not got.reused
    assert [r["call"] for r in got.records] == [1, 2]
    assert [p.read_bytes() for p in got.files] == [b"sealed", b"sealed"]


def test_the_same_inputs_reuse_both_recorded_builds(
    root: Path, inputs: list[Path], tmp_path: Path
) -> None:
    first = build_cache.twice("demo", inputs, Builder(), tmp_path / "w1")
    build = Builder()
    again = build_cache.twice("demo", inputs, build, tmp_path / "w2")
    assert build.calls == 0
    assert again.reused
    assert again.key == first.key
    assert again.records == first.records
    assert [p.read_bytes() for p in again.files] == [b"sealed", b"sealed"]


def test_a_changed_input_file_builds_twice_again(
    root: Path, inputs: list[Path], tmp_path: Path
) -> None:
    build_cache.twice("demo", inputs, Builder(), tmp_path / "w1")
    (inputs[0] / "pkg" / "a.py").write_text("A = 2\n", encoding="utf-8")
    build = Builder()
    got = build_cache.twice("demo", inputs, build, tmp_path / "w2")
    assert build.calls == 2 and not got.reused


def test_a_missing_input_is_an_error_naming_it(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match=r"nowhere\.yaml"):
        build_cache.inputs_key([tmp_path / "nowhere.yaml"])


def test_a_failing_build_caches_nothing(root: Path, inputs: list[Path], tmp_path: Path) -> None:
    with pytest.raises(AssertionError, match="build failed"):
        build_cache.twice("demo", inputs, Builder(fail=True), tmp_path / "w1")
    build = Builder()
    build_cache.twice("demo", inputs, build, tmp_path / "w2")
    assert build.calls == 2
