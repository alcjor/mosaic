"""scripts/fetch_fixtures.py: a source is taken from its url or, failing that, from the
repository's `fixtures` branch, and either way must match its pinned SHA-256."""

import hashlib
import importlib.util
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from types import ModuleType

import pytest

from tests.conftest import REPO


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "fetch_fixtures", REPO / "scripts" / "fetch_fixtures.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


fetch = _load()
DATA = b"name,year\nA,2001\n"
PINNED = hashlib.sha256(DATA).hexdigest()


def git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


@pytest.fixture
def world(tmp_path: Path) -> tuple[Path, Path, Path]:
    """An origin with a `fixtures` branch holding demo/demo.csv, a clone of it, a manifest."""
    origin = tmp_path / "origin"
    origin.mkdir()
    git(origin, "init", "-q", "-b", "main")
    (origin / "README.md").write_text("main\n", encoding="utf-8")
    git(origin, "add", "-A")
    git(origin, "commit", "-qm", "main")
    git(origin, "checkout", "-q", "--orphan", "fixtures")
    git(origin, "rm", "-q", "-rf", ".")
    (origin / "demo").mkdir()
    (origin / "demo" / "demo.csv").write_bytes(DATA)
    git(origin, "add", "-A")
    git(origin, "commit", "-qm", "fixtures")
    git(origin, "checkout", "-q", "main")
    clone = tmp_path / "clone"
    git(tmp_path, "clone", "-q", "--single-branch", "-b", "main", str(origin), str(clone))
    manifest = tmp_path / "manifest.json"
    entry = {
        "name": "demo",
        "file": "demo.csv",
        "url": "https://example.invalid/demo.csv",
        "sha256": PINNED,
        "licence_confirmed": True,
    }
    manifest.write_text(json.dumps({"fixtures": [entry]}), encoding="utf-8")
    return clone, manifest, tmp_path / "downloads"


def _url_fails(url: str, target: Path) -> None:
    raise urllib.error.URLError("unreachable")


def test_an_unreachable_url_falls_back_to_the_fixtures_branch(
    world: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    clone, manifest, downloads = world
    monkeypatch.setattr(urllib.request, "urlretrieve", _url_fails)
    assert fetch.main(manifest, downloads, clone) == 0
    assert (downloads / "demo" / "demo.csv").read_bytes() == DATA
    assert "ok   demo" in capsys.readouterr().out
    assert not (downloads / "demo" / "demo.csv.part").exists()


def test_a_url_that_gives_other_bytes_falls_back_to_the_fixtures_branch(
    world: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    clone, manifest, downloads = world

    def wrong(url: str, target: Path) -> None:
        Path(target).write_bytes(b"<html>404</html>")

    monkeypatch.setattr(urllib.request, "urlretrieve", wrong)
    assert fetch.main(manifest, downloads, clone) == 0
    assert (downloads / "demo" / "demo.csv").read_bytes() == DATA


def test_a_working_url_is_used_and_the_branch_is_not_needed(
    world: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    clone, manifest, downloads = world

    def right(url: str, target: Path) -> None:
        Path(target).write_bytes(DATA)

    monkeypatch.setattr(urllib.request, "urlretrieve", right)
    monkeypatch.setattr(fetch, "from_fixtures_branch", lambda *a: pytest.fail("branch used"))
    assert fetch.main(manifest, downloads, clone) == 0


def test_a_branch_file_with_other_bytes_fails_the_pin(
    world: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    clone, manifest, downloads = world
    data = json.loads(manifest.read_text(encoding="utf-8"))
    data["fixtures"][0]["sha256"] = "0" * 64
    manifest.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(urllib.request, "urlretrieve", _url_fails)
    assert fetch.main(manifest, downloads, clone) == 1
    assert "FAIL demo" in capsys.readouterr().err


def test_a_source_on_neither_fails_naming_it(
    world: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    clone, manifest, downloads = world
    data = json.loads(manifest.read_text(encoding="utf-8"))
    data["fixtures"][0]["name"] = "absent"
    manifest.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(urllib.request, "urlretrieve", _url_fails)
    assert fetch.main(manifest, downloads, clone) == 1
    out = capsys.readouterr()
    assert "fixtures branch has no absent/demo.csv" in out.out
    assert "FAIL absent: sha256 (nothing fetched)" in out.err


def test_a_file_already_matching_its_pin_is_not_fetched_again(
    world: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    clone, manifest, downloads = world
    (downloads / "demo").mkdir(parents=True)
    (downloads / "demo" / "demo.csv").write_bytes(DATA)
    monkeypatch.setattr(urllib.request, "urlretrieve", lambda *a: pytest.fail("fetched"))
    assert fetch.main(manifest, downloads, clone) == 0
