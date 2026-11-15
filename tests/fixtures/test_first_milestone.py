"""The first milestone end to end (docs/design.md, First milestone; Specification 0.1, section 11;
).

"Done when the Netflix titles and Chinook mosaics build with their expected hashes, the viewer
opens them offline and exports each to one HTML file, and a plain-language search finds the right
titles."

- Both mosaics are built from clean directories: Netflix by the shared pair of clean builds
  (``tests/fixtures/conftest.py``, ``MOSAIC_FRESH_BUILDS=1`` rebuilds), Chinook once here. Each
  build's knowledge hash, vector hash and model are those its ``expected-hashes.json`` records.
- Each mosaic is exported with its fixture's view file, once with ``search: text`` and once with
  ``search: semantic`` (the pinned model inside), to one HTML file in an empty directory.
- Each export is opened from ``file://`` in Chromium with networking blocked
  (``viewer/scripts/search-export.ts``): it opens the mosaic named by its knowledge hash, asks for
  nothing outside the file, and searches.
- In the Netflix ``search: semantic`` export, plain-language queries that share no word with a
  title's name list that title among the first results, matched by meaning (the ``vector`` tier).
  The ``search: text`` export carries no model, so it finds the same titles by words of their text.

Run it with ``-s``: it prints every query with its first results, the export sizes and
the timings.
"""

import json
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from mosaic_build.cli import main

from tests.conftest import MODEL, REPO
from tests.fixtures import test_chinook
from tests.fixtures.conftest import NetflixBuilds
from tests.fixtures.expected import differences, load_expected
from tests.fixtures.test_netflix import FIXTURE as NETFLIX
from tests.fixtures.test_netflix import TARGET, Run

pytestmark = pytest.mark.slow

CHINOOK = test_chinook.FIXTURE
SETTINGS = ("text", "semantic")
TOP = 5
"""A title is found when it is among the first five results a reader sees."""

PLAIN = [
    ("high school chemistry teacher becomes a drug dealer", "Title:s5941", "Breaking Bad"),
    ("an orphan girl who is a genius at chess", "Title:s1805", "The Queen's Gambit"),
    ("deadly children's games played for a cash prize", "Title:s34", "Squid Game"),
    (
        "a boy disappears and a small town finds secret experiments and supernatural forces",
        "Title:s3686",
        "Stranger Things",
    ),
    ("a drama about Queen Elizabeth II and her reign", "Title:s1699", "The Crown"),
    ("a monster hunter in a fantasy world", "Title:s3118", "The Witcher"),
    ("nature documentary about climate change and wildlife", "Title:s3939", "Our Planet"),
    ("Colombian drug cartels", "Title:s5306", "Narcos"),
]
"""Plain-language queries for the ``search: semantic`` export: each describes a title by what it
is about, in words its name does not hold."""

WORDS = [
    ("chemistry teacher", "Title:s5941", "Breaking Bad"),
    ("girl chess talent", "Title:s1805", "The Queen's Gambit"),
    ("cash-strapped players", "Title:s34", "Squid Game"),
    ("small town secret experiments supernatural", "Title:s3686", "Stranger Things"),
    ("Queen Elizabeth", "Title:s1699", "The Crown"),
    ("Geralt of Rivia", "Title:s3118", "The Witcher"),
    ("climate change documentary", "Title:s3939", "Our Planet"),
    ("Colombia drug cartels", "Title:s5306", "Narcos"),
]
"""The same titles in the ``search: text`` export, by words of their description."""

CHINOOK_NAMES = [("AC/DC", "Artist:1", "AC/DC"), ("heavy metal", "Genre:13", "Heavy Metal")]
CHINOOK_PLAIN = [("classical orchestra music", "Playlist:12", "Classical")]


@dataclass(frozen=True)
class Built:
    name: str
    fixture: Path
    mosaic: Path
    runs: tuple[Run, ...]


@dataclass(frozen=True)
class Opened:
    name: str
    search: str
    page: Path
    files: list[str]
    export_seconds: float
    open_seconds: float
    seen: dict[str, Any]

    def found(self, query: str) -> list[dict[str, Any]]:
        [search] = [s for s in self.seen["searches"] if s["query"] == query]
        return search["results"]


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


@pytest.fixture(scope="module")
def chinook_run(chinook_runs: tuple[Run, Run]) -> Run:
    return chinook_runs[0]


@pytest.fixture(scope="module")
def built(
    netflix_builds: NetflixBuilds, chinook_run: Run, tmp_path_factory: pytest.TempPathFactory
) -> list[Built]:
    chinook = tmp_path_factory.mktemp("milestone-mosaic") / "chinook.mosaic"
    chinook.write_bytes(chinook_run.mosaic_bytes)
    return [
        Built(
            "netflix", NETFLIX, netflix_builds.mosaic, (netflix_builds.first, netflix_builds.second)
        ),
        Built("chinook", CHINOOK, chinook, (chinook_run,)),
    ]


@pytest.fixture(scope="module")
def opened(built: list[Built], tmp_path_factory: pytest.TempPathFactory) -> list[Opened]:
    bun = shutil.which("bun")
    assert bun, "bun is needed to build the viewer (README, Development)"
    assert subprocess.run([bun, "run", "build"], cwd=REPO / "viewer", check=False).returncode == 0
    base = tmp_path_factory.mktemp("milestone-exports")
    queries = {
        ("netflix", "semantic"): [q for q, _, _ in PLAIN],
        ("netflix", "text"): [q for q, _, _ in WORDS],
        ("chinook", "semantic"): [q for q, _, _ in CHINOOK_NAMES + CHINOOK_PLAIN],
        ("chinook", "text"): [q for q, _, _ in CHINOOK_NAMES],
    }
    found = []
    for mosaic in built:
        for search in SETTINGS:
            directory = base / f"{mosaic.name}-{search}"
            directory.mkdir()
            view = directory.parent / f"{mosaic.name}-{search}.yaml"
            text = (mosaic.fixture / "view.yaml").read_text(encoding="utf-8")
            assert "search: semantic\n" in text
            view.write_text(text.replace("search: semantic\n", f"search: {search}\n"), "utf-8")
            page = directory / f"{mosaic.name}.html"
            args = ["export", str(mosaic.mosaic), "--view", str(view), "-o", str(page)]
            if search == "semantic":
                args[-2:-2] = ["--model", str(MODEL)]
            started = time.perf_counter()
            assert main(args) == 0
            exported = time.perf_counter() - started
            started = time.perf_counter()
            run = subprocess.run(
                [bun, "viewer/scripts/search-export.ts", str(page), *queries[mosaic.name, search]],
                cwd=REPO,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=900,
                check=False,
            )
            assert run.returncode == 0, run.stderr
            seen = json.loads(run.stdout.strip().splitlines()[-1])
            found.append(
                Opened(
                    mosaic.name,
                    search,
                    page,
                    sorted(p.name for p in directory.iterdir()),
                    exported,
                    time.perf_counter() - started,
                    seen,
                )
            )
    for o in found:
        print(
            f"\n{o.name} export (search: {o.search}): {o.page.stat().st_size:,} bytes, "
            f"exported in {o.export_seconds:.1f} s, opened offline and ready in "
            f"{o.seen['readyMs']} ms"
        )
        for s in o.seen["searches"]:
            first = "; ".join(
                f"{r['id']} [{r['match']}] {r['text'].split(' · ')[0]}" for r in s["results"][:TOP]
            )
            print(f"  {s['query']!r} ({s['ms']} ms): {first or 'no results'}")
    return found


# --- build with the expected hashes -----------------------------------------------------------


def test_both_mosaics_build_from_clean_directories_with_their_expected_hashes(
    built: list[Built],
) -> None:
    assert [b.name for b in built] == ["netflix", "chinook"]
    for mosaic in built:
        expected = load_expected(mosaic.fixture)
        for run in mosaic.runs:
            found = differences(
                expected,
                TARGET,
                knowledge_hash=run.mosaic_hash,
                vector_hash=run.vector_hash,
                vectors=run.vector_bits,
                embed_model=run.embed_model,
            )
            assert not found, f"{mosaic.name}: " + "\n".join(found)
        print(
            f"\n{mosaic.name}: knowledge {mosaic.runs[0].mosaic_hash} vectors "
            f"{mosaic.runs[0].vector_hash} ({mosaic.runs[0].mosaic_size:,} bytes, "
            f"{mosaic.runs[0].nodes:,} nodes); build {mosaic.runs[0].seconds['build']:.1f} s"
        )


# --- export to one HTML file, open offline ----------------------------------------------------


def test_each_mosaic_exports_to_one_html_file_with_each_search_setting(
    opened: list[Opened],
) -> None:
    assert sorted((o.name, o.search) for o in opened) == sorted(
        (name, search) for name in ("netflix", "chinook") for search in SETTINGS
    )
    for o in opened:
        assert o.files == [o.page.name], f"{o.name} ({o.search}) wrote {o.files}"
        assert o.page.stat().st_size > 0
    for name in ("netflix", "chinook"):
        sizes = {o.search: o.page.stat().st_size for o in opened if o.name == name}
        # Only the semantic export carries the embedding model.
        assert sizes["semantic"] > sizes["text"]


def test_each_export_opens_from_file_with_networking_blocked(
    opened: list[Opened], built: list[Built]
) -> None:
    hashes = {b.name: b.runs[0].mosaic_hash for b in built}
    for o in opened:
        seen = o.seen
        where = f"{o.name} ({o.search})"
        assert seen["blocked"] == [], where
        assert seen["errors"] == [], where
        assert seen["alerts"] == [], where
        assert "Read-only export" in seen["header"], where
        assert hashes[o.name][:12] in seen["header"], where
        assert seen["mode"] == o.search, where
        assert all(s["results"] and s["alert"] is None for s in seen["searches"]), where


# --- a plain-language search finds the right titles --------------------------------------------


def _netflix(opened: list[Opened], search: str) -> Opened:
    [o] = [o for o in opened if o.name == "netflix" and o.search == search]
    return o


def test_the_plain_language_queries_share_no_word_with_the_titles_they_describe() -> None:
    for query, _, name in PLAIN:
        assert not _words(query) & _words(name), (query, name)


def test_a_plain_language_search_finds_the_right_netflix_titles_by_meaning(
    opened: list[Opened],
) -> None:
    export = _netflix(opened, "semantic")
    for query, title, name in PLAIN:
        first = export.found(query)[:TOP]
        listed = [r for r in first if r["id"] == title]
        assert listed, f"{query!r}: {name} ({title}) not among {[r['id'] for r in first]}"
        assert listed[0]["match"] == "vector", (query, listed[0])
        assert listed[0]["text"].startswith(name), (query, listed[0])


def test_the_text_export_finds_the_same_titles_by_words_of_their_text(
    opened: list[Opened],
) -> None:
    export = _netflix(opened, "text")
    assert {t for _, t, _ in WORDS} == {t for _, t, _ in PLAIN}
    for query, title, name in WORDS:
        first = export.found(query)[:TOP]
        listed = [r for r in first if r["id"] == title]
        assert listed, f"{query!r}: {name} ({title}) not among {[r['id'] for r in first]}"
        assert listed[0]["match"] == "text", (query, listed[0])
        assert listed[0]["text"].startswith(name), (query, listed[0])


def test_the_chinook_exports_find_by_name_and_the_semantic_one_by_meaning(
    opened: list[Opened],
) -> None:
    for o in (o for o in opened if o.name == "chinook"):
        cases = CHINOOK_NAMES + (CHINOOK_PLAIN if o.search == "semantic" else [])
        for query, node, label in cases:
            first = o.found(query)[:TOP]
            listed = [r for r in first if r["id"] == node]
            assert listed, f"{o.search}: {query!r}: {node} not among {[r['id'] for r in first]}"
            assert listed[0]["text"].startswith(label), (query, listed[0])
            if (query, node, label) in CHINOOK_PLAIN:
                assert listed[0]["match"] == "vector", (query, listed[0])


BUN = shutil.which("bun")


@dataclass(frozen=True)
class Export:
    page: Path
    mosaic: Path
    knowledge_hash: str


def _view(fixture: Path, search: str, where: Path) -> Path:
    text = (fixture / "view.yaml").read_text(encoding="utf-8")
    assert "search: semantic\n" in text
    where.write_text(text.replace("search: semantic\n", f"search: {search}\n"), encoding="utf-8")
    return where


def _export(mosaic: Path, fixture: Path, search: str, page: Path) -> None:
    view = _view(fixture, search, page.parent.with_name(page.parent.name + f"-{search}.yaml"))
    args = ["export", str(mosaic), "--view", str(view), "-o", str(page)]
    if search == "semantic":
        args[-2:-2] = ["--model", str(MODEL)]
    assert main(args) == 0


def _open(page: Path, queries: list[str]) -> dict[str, Any]:
    assert BUN, "bun is needed (README, Development)"
    run = subprocess.run(
        [BUN, "viewer/scripts/search-export.ts", str(page), *queries],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=900,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    seen: dict[str, Any] = json.loads(run.stdout.strip().splitlines()[-1])
    return seen


@pytest.fixture(scope="module")
def viewer_built() -> None:
    assert BUN, "bun is needed to build the viewer (README, Development)"
    assert subprocess.run([BUN, "run", "build"], cwd=REPO / "viewer", check=False).returncode == 0


@pytest.fixture(scope="module")
def netflix_mosaic(netflix_builds: NetflixBuilds) -> tuple[Path, Run]:
    return netflix_builds.mosaic, netflix_builds.first


@pytest.fixture(scope="module")
def netflix_text(
    viewer_built: None, netflix_mosaic: tuple[Path, Run], tmp_path_factory: pytest.TempPathFactory
) -> Export:
    page = tmp_path_factory.mktemp("edges-nt") / "netflix.html"
    _export(netflix_mosaic[0], NETFLIX, "text", page)
    return Export(page, netflix_mosaic[0], netflix_mosaic[1].mosaic_hash)


@pytest.fixture(scope="module")
def netflix_semantic(
    viewer_built: None, netflix_mosaic: tuple[Path, Run], tmp_path_factory: pytest.TempPathFactory
) -> Export:
    page = tmp_path_factory.mktemp("edges-ns") / "netflix.html"
    _export(netflix_mosaic[0], NETFLIX, "semantic", page)
    return Export(page, netflix_mosaic[0], netflix_mosaic[1].mosaic_hash)


def _results(seen: dict[str, Any], query: str) -> list[dict[str, Any]]:
    [search] = [s for s in seen["searches"] if s["query"] == query]
    results: list[dict[str, Any]] = search["results"]
    return results


# --- find, as section 8.5 fixes it ---------------------------------------------------------------


def test_an_exact_id_is_listed_first_tagged_exact_in_both_search_settings(
    netflix_text: Export, netflix_semantic: Export
) -> None:
    # Section 8.5: tiers "exact id, key and alias matches; then full-text hits; then vector hits".
    for e in (netflix_text, netflix_semantic):
        seen = _open(e.page, ["Title:s5941"])
        first = _results(seen, "Title:s5941")[0]
        assert first["id"] == "Title:s5941" and first["match"] == "exact", (e.page, first)


def test_the_text_export_never_lists_a_vector_match(netflix_text: Export) -> None:
    # Design.md, View file: ``search: text`` carries no model, so no vector tier exists.
    queries = [
        "high school chemistry teacher becomes a drug dealer",
        "an orphan girl who is a genius at chess",
        "Breaking Bad",
        "zzzzqqqq",
    ]
    seen = _open(netflix_text.page, queries)
    assert seen["mode"] == "text"
    for s in seen["searches"]:
        assert all(r["match"] in ("exact", "text") for r in s["results"]), s["query"]
