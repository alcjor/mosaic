"""The fixtures built from several pieces: museums and OpenFlights (Specification 0.1, section 11).

Each fixture's ``expected-build.json`` names its sources (a pinned download, its settings file
and the piece it becomes) and what a clean build gives. Every source is imported and the
pattern built, twice from clean directories (reused while nothing they depend on changes,
``build_cache``): both builds have the expected knowledge hash, and the build report has the
expected counts, weak ids, notices and numbers of conflicts. The museums mosaic is then read
for what merging two sources by several identifiers gives.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, cast

import pytest
from mosaic_format.reader import open as open_sealed

from tests.conftest import REPO
from tests.fixtures import build_cache

pytestmark = pytest.mark.slow

FIXTURES = REPO / "conformance" / "fixtures"
NAMES = ("museums", "openflights")


def _expected(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name / "expected-build.json").read_text("utf-8"))


def _mosaic(*args: str | Path, cwd: Path) -> None:
    done = subprocess.run(
        [sys.executable, "-m", "mosaic_build.cli", *map(str, args)],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert done.returncode == 0, done.stdout + done.stderr


def _build(name: str, directory: Path) -> tuple[dict[str, object], Path]:
    """Import every source and build the pattern in ``directory``; the report and the mosaic."""
    directory.mkdir(parents=True)
    for source in _expected(name)["sources"]:
        _mosaic(
            "import",
            "csv",
            FIXTURES / "downloads" / source["download"],
            "--settings",
            FIXTURES / name / source["settings"],
            "-o",
            f"{source['piece']}.tessera",
            cwd=directory,
        )
    _mosaic("build", FIXTURES / name / "pattern.yaml", "--pieces", ".", "-o", "out", cwd=directory)
    report = json.loads((directory / "out" / "build-report.json").read_text("utf-8"))
    return report, directory / "out" / "default.mosaic"


@pytest.fixture(scope="session", params=NAMES)
def built(
    request: pytest.FixtureRequest, netflix_fetched: None, tmp_path_factory: pytest.TempPathFactory
) -> tuple[str, build_cache.Builds]:
    name = request.param
    inputs = [
        *(FIXTURES / "downloads" / s["download"] for s in _expected(name)["sources"]),
        *(FIXTURES / name / s["settings"] for s in _expected(name)["sources"]),
        FIXTURES / name / "pattern.yaml",
        REPO / "uv.lock",
        REPO / "packages",
        REPO / "spec",
        Path(__file__),
        REPO / "tests" / "fixtures" / "build_cache.py",
    ]
    return name, build_cache.twice(
        name, inputs, lambda d: _build(name, d), tmp_path_factory.mktemp(name)
    )


def test_two_clean_builds_have_the_expected_knowledge_hash(
    built: tuple[str, build_cache.Builds],
) -> None:
    name, builds = built
    expected = _expected(name)["knowledge_hash"]
    assert [r["knowledge_hash"] for r in builds.records] == [expected, expected]


def test_the_build_report_has_the_expected_counts_weak_ids_and_notices(
    built: tuple[str, build_cache.Builds],
) -> None:
    name, builds = built
    expected, report = _expected(name), builds.records[0]
    assert report["outcome"] == "built"
    for entry in ("counts", "weak_ids", "notices"):
        assert report[entry] == expected[entry], entry
    for entry in ("conflicts", "alias_conflicts"):
        assert len(cast(list[object], report[entry])) == expected[entry], entry


@pytest.fixture(scope="session")
def museums(built: tuple[str, build_cache.Builds]) -> Any:
    name, builds = built
    if name != "museums":
        pytest.skip("read on the museums mosaic")
    with open_sealed(builds.files[0]) as sealed:
        yield sealed


def test_an_artist_both_museums_know_by_one_id_is_one_node_with_both_as_sources(
    museums: Any,
) -> None:
    pieces = museums.query(
        "SELECT DISTINCT s.id FROM evidence AS e JOIN source AS s USING (sid)"
        " JOIN node AS n USING (nid) WHERE n.id = 'Artist:Q5593' ORDER BY s.id"
    )
    assert [p for (p,) in pieces] == ["met/MetObjects.csv", "moma/Artists.csv"]
    aliases = museums.query(
        "SELECT a.text FROM alias AS a JOIN node AS n USING (nid) WHERE n.id = 'Artist:Q5593'"
    )
    # The Met's spelling of the id, and the identifiers that did not give the key.
    assert {a for (a,) in aliases} == {
        "https://www.wikidata.org/wiki/Q5593",
        "ulan=500009666",
        "moma_id=4609",
        "met_name=Pablo Picasso, 1881",
    }


def test_an_artist_without_a_shared_id_stays_one_node_per_museum(museums: Any) -> None:
    found = museums.query("SELECT id FROM node WHERE label = 'Ted Joans' ORDER BY id")
    assert [i for (i,) in found] == ["Artist:met_name=Ted Joans, 1928", "Artist:moma_id=69701"]


def test_two_roles_of_one_artist_on_one_work_are_two_edges_told_apart_by_qualifier(
    museums: Any,
) -> None:
    roles = museums.query(
        "SELECT e.qualifier FROM edge AS e JOIN node AS s ON s.nid = e.src"
        " JOIN node AS d ON d.nid = e.dst WHERE s.id = 'Artwork:481151'"
        " AND d.label = 'Louis Majorelle' ORDER BY e.qualifier"
    )
    assert [r for (r,) in roles] == ["Designer", "Manufacturer"]
