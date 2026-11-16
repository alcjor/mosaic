"""The fixture for text and mentions: Marlin (Specification 0.1, section 11).

``expected-build.json`` names the two sources (a pinned archive, the directory inside it, the
builder, its settings file and the piece it becomes) and what a clean build gives. Each archive
is unpacked and imported and the pattern built, twice from clean directories (reused while
nothing they depend on changes, ``build_cache``): both builds have the expected knowledge hash,
and the build report has the expected counts, notices and mentions. The mosaic is then read for
what link rules from mentions and the full text tier give, on one command followed from its
page to the options it needs and the function that implements it.
"""

import json
import subprocess
import sys
import tarfile
from collections import Counter
from pathlib import Path
from typing import Any, cast

import pytest
from mosaic_format.reader import open as open_sealed

from tests.conftest import REPO
from tests.fixtures import build_cache

pytestmark = pytest.mark.slow

FIXTURE = REPO / "conformance" / "fixtures" / "marlin"
DOWNLOADS = REPO / "conformance" / "fixtures" / "downloads"
EXPECTED: dict[str, Any] = json.loads((FIXTURE / "expected-build.json").read_text("utf-8"))
TEXT = (".md", ".h", ".cpp")


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


def _unpack(archive: Path, directory: Path) -> None:
    """Unpack the text files of ``archive``: untrusted data, so only plain files, as data."""
    with tarfile.open(archive) as tar:
        members = [m for m in tar if m.isfile() and m.name.endswith(TEXT)]
        tar.extractall(directory, members=members, filter="data")


def _build(directory: Path) -> tuple[dict[str, object], Path]:
    """Import both sources and build the pattern in ``directory``; the report and the mosaic."""
    directory.mkdir(parents=True)
    for source in EXPECTED["sources"]:
        _unpack(DOWNLOADS / source["download"], directory / "unpacked")
        _mosaic(
            "import",
            source["builder"],
            directory / "unpacked" / source["directory"],
            "--settings",
            FIXTURE / source["settings"],
            "-o",
            f"{source['piece']}.tessera",
            cwd=directory,
        )
    _mosaic("build", FIXTURE / "pattern.yaml", "--pieces", ".", "-o", "out", cwd=directory)
    report = json.loads((directory / "out" / "build-report.json").read_text("utf-8"))
    return report, directory / "out" / "default.mosaic"


@pytest.fixture(scope="session")
def builds(netflix_fetched: None, tmp_path_factory: pytest.TempPathFactory) -> build_cache.Builds:
    inputs = [
        *(DOWNLOADS / s["download"] for s in EXPECTED["sources"]),
        *(FIXTURE / s["settings"] for s in EXPECTED["sources"]),
        FIXTURE / "pattern.yaml",
        REPO / "uv.lock",
        REPO / "packages",
        REPO / "spec",
        Path(__file__),
        REPO / "tests" / "fixtures" / "build_cache.py",
    ]
    return build_cache.twice("marlin", inputs, _build, tmp_path_factory.mktemp("marlin"))


@pytest.fixture(scope="session")
def mosaic(builds: build_cache.Builds) -> Any:
    with open_sealed(builds.files[0]) as sealed:
        yield sealed


def test_two_clean_builds_have_the_expected_knowledge_hash(builds: build_cache.Builds) -> None:
    expected = EXPECTED["knowledge_hash"]
    assert [r["knowledge_hash"] for r in builds.records] == [expected, expected]


def test_the_build_report_has_the_expected_counts_and_notices(builds: build_cache.Builds) -> None:
    report = builds.records[0]
    assert report["outcome"] == "built"
    for entry in ("counts", "weak_ids", "notices"):
        assert report[entry] == EXPECTED[entry], entry
    for entry in ("conflicts", "alias_conflicts", "stale_references"):
        assert len(cast(list[object], report[entry])) == EXPECTED[entry], entry


def test_the_build_report_lists_the_expected_mentions_by_status_and_role(
    builds: build_cache.Builds,
) -> None:
    mentions = cast(list[dict[str, Any]], builds.records[0]["mentions"])
    found = Counter(f"{m['status']} {m['role']}" for m in mentions)
    assert dict(sorted(found.items())) == EXPECTED["mentions"]


def test_the_mosaic_is_small(builds: build_cache.Builds) -> None:
    assert cast(int, builds.records[0]["file_size"]) < 20_000_000


def _out(mosaic: Any, node: str, edge: str) -> list[str]:
    rows = mosaic.query(
        "SELECT d.id FROM edge AS e JOIN node AS s ON s.nid = e.src JOIN node AS d ON d.nid = e.dst"
        " WHERE s.id = ? AND e.type = ? ORDER BY d.id",
        (node, edge),
    )
    return [i for (i,) in rows]


PAGE = "Command:docs/gcode/M201.md"
HANDLER = "Function:Marlin/src/gcode/config/M200-M205.cpp::GcodeSuite::M201"


def test_a_page_links_to_the_options_its_front_matter_and_prose_name(mosaic: Any) -> None:
    assert _out(mosaic, PAGE, "requires") == [
        "Option:DISTINCT_E_FACTORS",
        "Option:XY_FREQUENCY_LIMIT",
    ]
    assert "Option:EEPROM_SETTINGS" in _out(mosaic, PAGE, "names_option")


def test_a_page_links_to_the_pages_it_names_by_code_or_by_address(mosaic: Any) -> None:
    assert _out(mosaic, PAGE, "related_to") == ["Command:docs/gcode/M204.md"]
    assert "Command:docs/gcode/M500.md" in _out(mosaic, PAGE, "refers_to")
    assert "Command:docs/gcode/M500.md" in _out(mosaic, PAGE, "links_to")


def test_a_page_links_to_the_function_named_like_its_code(mosaic: Any) -> None:
    assert _out(mosaic, PAGE, "implemented_by") == [HANDLER]


def test_a_function_links_to_the_options_its_conditions_name(mosaic: Any) -> None:
    assert "Option:XY_FREQUENCY_LIMIT" in _out(mosaic, HANDLER, "depends_on")


def test_a_mention_edge_cites_the_file_and_place_of_the_mention(mosaic: Any) -> None:
    rows = mosaic.query(
        "SELECT s.id, v.locator FROM evidence AS v JOIN source AS s USING (sid)"
        " JOIN edge AS e USING (eid) JOIN node AS a ON a.nid = e.src"
        " JOIN node AS b ON b.nid = e.dst"
        " WHERE a.id = ? AND e.type = 'implemented_by' AND b.id = ?",
        (PAGE, HANDLER),
    )
    ((source, locator),) = rows
    assert source == "docs/docs/gcode/M201.md"
    assert locator.startswith("file=docs/gcode/M201.md;line=12;chars=")


def test_a_code_several_pages_document_is_an_ambiguous_mention(
    builds: build_cache.Builds,
) -> None:
    mentions = cast(list[dict[str, Any]], builds.records[0]["mentions"])
    named = {
        tuple(m["candidates"])
        for m in mentions
        if m["status"] == "ambiguous" and m["text"] == "G34" and m["role"] == "prose.code"
    }
    assert named == {("Command:docs/gcode/G034-mgc.md", "Command:docs/gcode/G034-zsaa.md")}


def test_the_full_text_tier_holds_each_file_and_evidence_points_into_it(mosaic: Any) -> None:
    ((text, locator),) = mosaic.query(
        "SELECT t.text, v.locator FROM evidence AS v JOIN node AS n USING (nid)"
        " JOIN source_text AS t USING (sid) WHERE n.id = ? AND v.prop IS NULL",
        (HANDLER,),
    )
    start, end = (int(x) for x in locator.rsplit("chars=", 1)[1].split("-"))
    assert text[start:end].startswith("void GcodeSuite::M201() {")
    assert text[start:end].endswith("}")
    assert "M201: Set max acceleration" in text[:start]
