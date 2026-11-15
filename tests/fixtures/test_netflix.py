"""The Netflix titles fixture end to end (Specification 0.1, section 11).

The source is downloaded and checked against its pinned SHA-256 by ``scripts/fetch_fixtures.py``
(never committed). ``mosaic import csv`` makes the tessera with
``conformance/fixtures/netflix/settings.yaml``, ``mosaic build`` builds the pattern beside it,
and ``mosaic check`` checks the pattern, the tessera and the mosaic. The whole flow runs twice,
each time in a new, empty directory: both runs give the tessera hash that ``pattern.yaml`` pins
(section 5.1) and the same mosaic knowledge hash, and the build report is valid against
``spec/build-report.schema.json`` (section 7.2). The pattern's one target has vectors on (the
default), so ``mosaic build`` gets the model of section 6 with ``--model``, fetched and checked
by ``scripts/fetch_model.py``: both runs give the same vector hash (section 7), one vector per
node, and the knowledge hash of the same target with vectors off (section 3.6). The test prints
the hashes, file sizes and timings of both runs (run it with ``-s``). Each run's
knowledge hash, vector hash and model are those ``expected-hashes.json`` records.
"""

from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from jsonschema import Draft202012Validator
from jsonschema.protocols import Validator
from mosaic_format.reader import Limits, SealedFile
from mosaic_format.reader import open as open_sealed
from mosaic_format.yaml_read import load

from tests.conftest import MODEL, REPO, SPEC
from tests.fixtures.expected import built_vectors, differences, load_expected
from tests.test_cli import entry_point

if TYPE_CHECKING:
    from tests.fixtures.conftest import NetflixBuilds

BUILD_BUDGET_SECONDS = 15 * 60
"""ADR-007: building the Netflix mosaic, vectors included, takes under 15 minutes."""

FIXTURE = REPO / "conformance" / "fixtures" / "netflix"
TARGET = "default"
"""The pattern's one target (it has no ``mosaics``, section 5.4); its file is ``default.mosaic``."""
SOURCE = REPO / "conformance" / "fixtures" / "downloads" / "netflix-titles" / "netflix_titles.csv"
TYPES = ("Title", "Person", "Country", "Genre", "Year")
EDGES = ("directed_by", "features", "made_in", "listed_in", "released_in")

pytestmark = pytest.mark.slow


@dataclass(frozen=True)
class Run:
    tessera_hash: str
    tessera_size: int
    mosaic_hash: str
    vector_hash: str | None
    embed_model: str | None
    vectors: int
    vector_bits: dict[str, bytes]
    nodes: int
    mosaic_size: int
    mosaic_bytes: bytes
    report: dict[str, object]
    seconds: dict[str, float]


def _mosaic(*args: str | Path, cwd: Path) -> subprocess.CompletedProcess[str]:
    done = subprocess.run(
        [str(entry_point()), *(str(a) for a in args)],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert done.returncode == 0, f"mosaic {args[0]} failed:\n{done.stdout}{done.stderr}"
    return done


def _timed(seconds: dict[str, float], step: str, *args: str | Path, cwd: Path) -> str:
    started = time.perf_counter()
    out = _mosaic(*args, cwd=cwd).stdout
    seconds[step] = time.perf_counter() - started
    return out


def _pinned_piece() -> tuple[str, str]:
    """The name and hash of the one piece that ``pattern.yaml`` pins."""
    pattern = load((FIXTURE / "pattern.yaml").read_text(encoding="utf-8"), "pattern.yaml").data
    [piece] = pattern["pieces"]
    name, _, pinned = piece.partition("@")
    return name, pinned


def _run(directory: Path) -> Run:
    """Import, build and check in ``directory``, which starts empty."""
    directory.mkdir()
    assert not any(directory.iterdir())
    name, _ = _pinned_piece()
    pieces, out = directory / "pieces", directory / "out"
    pieces.mkdir()
    shutil.copyfile(SOURCE, directory / SOURCE.name)
    tessera = pieces / f"{name}.tessera"
    seconds: dict[str, float] = {}
    settings = FIXTURE / "settings.yaml"
    _timed(
        seconds,
        "import",
        "import",
        "csv",
        SOURCE.name,
        "--settings",
        settings,
        "-o",
        tessera,
        cwd=directory,
    )
    _timed(
        seconds,
        "check pattern",
        "check",
        FIXTURE / "pattern.yaml",
        "--pieces",
        pieces,
        cwd=directory,
    )
    _timed(
        seconds,
        "build",
        "build",
        FIXTURE / "pattern.yaml",
        "--pieces",
        pieces,
        "--model",
        MODEL,
        "-o",
        out,
        cwd=directory,
    )
    mosaic = out / f"{TARGET}.mosaic"
    _timed(seconds, "check tessera", "check", tessera, cwd=directory)
    _timed(seconds, "check mosaic", "check", mosaic, "--pieces", pieces, cwd=directory)
    with open_sealed(tessera) as t:
        tessera_hash = t.knowledge_hash
    with open_sealed(mosaic) as m:
        mosaic_hash = m.knowledge_hash
        ((vector_hash, embed_model, vectors, nodes),) = m.query(
            "SELECT vector_hash, embed_model, (SELECT count(*) FROM vector), "
            "(SELECT count(*) FROM node) FROM header"
        )
    bits = built_vectors(mosaic)
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    return Run(
        tessera_hash=tessera_hash,
        tessera_size=tessera.stat().st_size,
        mosaic_hash=mosaic_hash,
        vector_hash=None if vector_hash is None else str(vector_hash),
        embed_model=None if embed_model is None else str(embed_model),
        vectors=int(str(vectors)),
        vector_bits=bits,
        nodes=int(str(nodes)),
        mosaic_size=mosaic.stat().st_size,
        mosaic_bytes=mosaic.read_bytes(),
        report=report,
        seconds=seconds,
    )


@pytest.fixture(scope="module")
def runs(netflix_builds: NetflixBuilds) -> tuple[Run, Run]:
    """Two clean builds of the fixture (tests/fixtures/conftest.py, reused while the inputs are
    unchanged)."""
    first, second = netflix_builds.first, netflix_builds.second
    for label, run in (("first", first), ("second", second)):
        timings = ", ".join(f"{step} {s:.1f} s" for step, s in run.seconds.items())
        print(
            f"\nnetflix {label}: tessera {run.tessera_hash} ({run.tessera_size:,} bytes); "
            f"mosaic {run.mosaic_hash} vectors {run.vector_hash} ({run.mosaic_size:,} bytes, "
            f"{run.nodes:,} nodes); {timings}"
        )
    return first, second


def test_the_imported_tessera_has_the_hash_the_pattern_pins(runs: tuple[Run, Run]) -> None:
    _, pinned = _pinned_piece()
    for run in runs:
        assert run.tessera_hash == pinned


def test_each_build_has_the_expected_hashes(runs: tuple[Run, Run]) -> None:
    """Section 11: the fixture holds "the expected mosaic"."""
    expected = load_expected(FIXTURE)
    for run in runs:
        found = differences(
            expected,
            TARGET,
            knowledge_hash=run.mosaic_hash,
            vector_hash=run.vector_hash,
            vectors=run.vector_bits,
            embed_model=run.embed_model,
        )
        assert not found, "\n".join(found)


def test_two_clean_builds_give_the_same_knowledge_hash(runs: tuple[Run, Run]) -> None:
    first, second = runs
    assert first.tessera_hash == second.tessera_hash
    assert first.mosaic_hash == second.mosaic_hash
    assert first.mosaic_bytes == second.mosaic_bytes
    assert first.report == second.report


def test_the_build_report_is_valid_and_names_the_mosaic(runs: tuple[Run, Run]) -> None:
    schema = json.loads((SPEC / "build-report.schema.json").read_text(encoding="utf-8"))
    for run in runs:
        Draft202012Validator(schema).validate(run.report)
        assert run.report["outcome"] == "built"
        assert run.report["knowledge_hash"] == run.mosaic_hash
        assert run.report["file_size"] == run.mosaic_size


def test_the_mosaic_holds_every_type_and_edge_type_of_the_pattern(runs: tuple[Run, Run]) -> None:
    counts = runs[0].report["counts"]
    assert isinstance(counts, dict)
    assert set(counts["nodes"]) == set(TYPES)
    assert set(counts["edges"]) == set(EDGES)
    assert all(n > 0 for n in [*counts["nodes"].values(), *counts["edges"].values()])
    # Every row of the source is one title.
    assert counts["nodes"]["Title"] == 8807


# --- vectors ----------------------------------------------------------------------


def test_the_mosaic_has_one_vector_per_node_and_names_the_model(runs: tuple[Run, Run]) -> None:
    for run in runs:
        assert run.vectors == run.nodes > 0
        assert run.embed_model == (
            "snowflake-arctic-embed-xs@"
            "e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1"
        )
        assert run.vector_hash is not None
        assert run.report["vector_hash"] == run.vector_hash


def test_two_clean_builds_give_the_same_vector_hash(runs: tuple[Run, Run]) -> None:
    first, second = runs
    assert first.vector_hash == second.vector_hash


def test_the_build_with_vectors_takes_under_15_minutes(runs: tuple[Run, Run]) -> None:
    for run in runs:
        assert run.seconds["build"] < BUILD_BUDGET_SECONDS


def test_the_knowledge_hash_is_that_of_the_same_target_with_vectors_off(
    runs: tuple[Run, Run], plain: Plain
) -> None:
    # Section 3.6: the knowledge hash does not cover vectors.
    with open_sealed(plain.mosaic) as m:
        assert m.knowledge_hash == runs[0].mosaic_hash
        assert m.query("SELECT vector_hash, embed_model FROM header") == [(None, None)]


MANIFEST = REPO / "conformance" / "fixtures" / "manifest.json"
ALL_ROWS = Limits(seconds=None, rows=None)

# Section 5.2: the Unicode White_Space set, which is not Python's str.strip() set.
WHITE_SPACE = "".join(
    chr(c)
    for c in (
        *range(0x09, 0x0E),
        0x20,
        0x85,
        0xA0,
        0x1680,
        *range(0x2000, 0x200B),
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
    )
)


def _cli(
    *args: str | Path, cwd: Path, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    if args and args[0] == "build":  # the pattern's targets have vectors on
        args = ("build", "--model", MODEL, *args[1:])
    return subprocess.run(
        [str(entry_point()), *(str(a) for a in args)],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        check=False,
    )


def _ok(*args: str | Path, cwd: Path, env: dict[str, str] | None = None) -> str:
    done = _cli(*args, cwd=cwd, env=env)
    assert done.returncode == 0, f"mosaic {args[0]} failed:\n{done.stdout}{done.stderr}"
    return done.stdout


def _query(
    sealed: SealedFile,
    sql: str,
    params: list[object] | None = None,
    *,
    limits: Limits | None = None,
) -> list[tuple[Any, ...]]:
    return sealed.query(sql, params or (), limits=limits)  # type: ignore[return-value]


def _knowledge_hash(path: Path) -> str:
    with open_sealed(path) as sealed:
        return sealed.knowledge_hash


def _pin() -> tuple[str, str]:
    text = (FIXTURE / "pattern.yaml").read_text(encoding="utf-8")
    found = re.search(r"^\s*-\s*([A-Za-z0-9_-]+)@([0-9a-f]{64})\s*$", text, re.MULTILINE)
    assert found, "pattern.yaml pins no piece as name@hash"
    return found.group(1), found.group(2)


def _pattern_with(directory: Path, *, pin: str | None = None, mosaics: str = "") -> Path:
    name, pinned = _pin()
    text = (FIXTURE / "pattern.yaml").read_text(encoding="utf-8")
    text = text.replace(f"{name}@{pinned}", f"{name}@{pin or pinned}")
    path = directory / "pattern.yaml"
    path.write_text(text + mosaics, encoding="utf-8")
    return path


@dataclass(frozen=True)
class Flow:
    directory: Path
    pieces: Path
    out: Path
    tessera: Path
    mosaic: Path
    tessera_hash: str
    mosaic_hash: str
    report: dict[str, object]


@pytest.fixture(scope="module")
def fetched() -> None:
    done = subprocess.run(
        [sys.executable, "-I", str(REPO / "scripts" / "fetch_fixtures.py")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert "ok   netflix-titles" in done.stdout, done.stdout + done.stderr
    model = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "fetch_model.py"), "--dest", str(MODEL)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert model.returncode == 0, model.stdout + model.stderr


@pytest.fixture(scope="module")
def flow(netflix_builds: NetflixBuilds, tmp_path_factory: pytest.TempPathFactory) -> Flow:
    """The first clean build of the session, with its tessera imported again beside it."""
    directory = tmp_path_factory.mktemp("netflix-edges")
    name, _ = _pin()
    pieces, out = directory / "pieces", directory / "out"
    pieces.mkdir()
    out.mkdir()
    tessera = pieces / f"{name}.tessera"
    shutil.copyfile(SOURCE, directory / SOURCE.name)
    _ok(
        "import", "csv", SOURCE.name, "--settings", FIXTURE / "settings.yaml", "-o", tessera,
        cwd=directory,
    )  # fmt: skip
    first = netflix_builds.first
    assert _knowledge_hash(tessera) == first.tessera_hash
    mosaic = out / "default.mosaic"
    shutil.copyfile(netflix_builds.mosaic, mosaic)
    return Flow(
        directory, pieces, out, tessera, mosaic, first.tessera_hash, first.mosaic_hash,
        first.report,
    )  # fmt: skip


NO_VECTORS = "\nmosaics:\n  default: {vectors: false}\n"
"""The fixture's one target with vectors off. Section 3.6: the knowledge hash does not cover
vectors (``test_netflix.py`` checks the two builds give the same one), so the tests below that
are about pins, ``strict``, budgets and where the command runs build without vectors and compare
with ``plain``, not with ``flow``. A vector build takes about 130 s, one without about 15 s."""


@dataclass(frozen=True)
class Plain:
    mosaic: Path
    report: dict[str, object]


@pytest.fixture(scope="module")
def plain(flow: Flow, tmp_path_factory: pytest.TempPathFactory) -> Plain:
    """The flow's pieces built again with vectors off, from a new directory."""
    directory = tmp_path_factory.mktemp("netflix-plain")
    pattern = _pattern_with(directory, mosaics=NO_VECTORS)
    out = directory / "out"
    _ok("build", pattern, "--pieces", flow.pieces, "-o", out, cwd=directory)
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    assert report["vector_hash"] is None
    assert _knowledge_hash(out / "default.mosaic") == flow.mosaic_hash
    return Plain(out / "default.mosaic", report)


def _trim(text: str) -> str:
    return text.strip(WHITE_SPACE)


def _rows() -> list[dict[str, str]]:
    with SOURCE.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _values(cell: str, separator: str | None) -> list[str]:
    parts = cell.split(separator) if separator else [cell]
    return [v for v in (_trim(p) for p in parts) if v]


def _schema() -> Validator:
    return Draft202012Validator(
        json.loads((SPEC / "build-report.schema.json").read_text(encoding="utf-8"))
    )


# --- The source is only read (principle 8) and is the pinned one (section 3.2) ---


def test_the_mosaic_names_the_pinned_tessera_and_csv_as_sources(flow: Flow) -> None:
    # Section 3.2: one row per piece; the piece's original sources are copied, id prefixed.
    pinned_csv = next(
        f for f in json.loads(MANIFEST.read_text())["fixtures"] if f["name"] == "netflix-titles"
    )["sha256"]
    name, pin = _pin()
    with open_sealed(flow.mosaic) as mosaic:
        rows = _query(mosaic, "SELECT id, kind, hash FROM source ORDER BY id", limits=ALL_ROWS)
    assert (name, "tessera", pin) in rows
    files = [r for r in rows if r[1] == "file"]
    assert len(files) == 1
    assert files[0][0].startswith(f"{name}/")
    assert files[0][2] == pinned_csv


# --- The tessera against the CSV, counted independently (sections 4.1, 5.2, 5.3, 7.2) ---


LINKS = {
    # column -> (separator, node type in the mosaic, edge type)
    "director": (",", "Person", "directed_by"),
    "cast": (",", "Person", "features"),
    "country": (",", "Country", "made_in"),
    "listed_in": (",", "Genre", "listed_in"),
    "release_year": (None, "Year", "released_in"),
}


def test_node_counts_equal_the_distinct_trimmed_values_of_the_csv(flow: Flow) -> None:
    # Sections 4.1 and 5.2: one node per distinct trimmed value; empty values make none; the
    # Person type is the union of directors and cast.
    rows = _rows()
    wanted: dict[str, set[str]] = {"Title": {r["show_id"] for r in rows}}
    for column, (separator, node_type, _) in LINKS.items():
        found = wanted.setdefault(node_type, set())
        for row in rows:
            found.update(_values(row[column], separator))
    counts = flow.report["counts"]
    assert isinstance(counts, dict)
    assert {t: n for t, n in counts["nodes"].items()} == {t: len(v) for t, v in wanted.items()}


def test_edge_counts_equal_the_distinct_row_and_value_pairs_of_the_csv(flow: Flow) -> None:
    # Section 4.1 (one edge per row and value pair) and 7.1 step 5 (duplicates are one edge).
    rows = _rows()
    wanted: dict[str, set[tuple[str, str]]] = {}
    for column, (separator, _, edge_type) in LINKS.items():
        pairs = wanted.setdefault(edge_type, set())
        for row in rows:
            pairs.update((row["show_id"], v) for v in _values(row[column], separator))
    counts = flow.report["counts"]
    assert isinstance(counts, dict)
    assert counts["edges"] == {t: len(p) for t, p in wanted.items()}


def test_a_person_who_directs_and_acts_is_one_node_with_both_edges(flow: Flow) -> None:
    # Sections 5.2 and 7.1 step 3: nodes of the same type and key are one node.
    rows = _rows()
    directors = {v for r in rows for v in _values(r["director"], ",")}
    cast = {v for r in rows for v in _values(r["cast"], ",")}
    both = sorted(directors & cast)
    assert both, "the source has no person who directs and acts"
    sample = both[0]
    with open_sealed(flow.mosaic) as mosaic:
        nodes = _query(mosaic, "SELECT nid FROM node WHERE id = ?", [f"Person:{sample}"])
        assert len(nodes) == 1
        kinds = {
            r[0]
            for r in _query(
                mosaic,
                "SELECT DISTINCT type FROM edge WHERE dst = ?",
                [nodes[0][0]],
                limits=ALL_ROWS,
            )
        }
    assert kinds == {"directed_by", "features"}


def test_a_title_without_a_director_has_no_directed_by_edge(flow: Flow) -> None:
    # Section 4.1: an empty cell makes no node and no edge.
    rows = _rows()
    empty = next(r["show_id"] for r in rows if _trim(r["director"]) == "")
    with open_sealed(flow.mosaic) as mosaic:
        found = _query(
            mosaic,
            "SELECT count(*) FROM edge e JOIN node n ON n.nid = e.src "
            "WHERE n.id = ? AND e.type = 'directed_by'",
            [f"Title:{empty}"],
        )
        assert _query(mosaic, "SELECT 1 FROM node WHERE id = ?", [f"Title:{empty}"])
    assert found == [(0,)]


def test_dates_become_dates_and_durations_quantities(flow: Flow) -> None:
    # Section 4.1 conversions chosen in settings.yaml: date_added a date, duration a quantity.
    with open_sealed(flow.mosaic) as mosaic:
        rows = _query(mosaic, "SELECT id, props FROM node WHERE type = 'Title'", limits=ALL_ROWS)
    props = {i: json.loads(p) for i, p in rows}
    source = {f"Title:{r['show_id']}": r for r in _rows()}
    assert len(props) == len(source)
    dated = 0
    for node_id, p in props.items():
        added = _trim(source[node_id]["date_added"])
        if not added:
            assert "date_added" not in p, node_id
            continue
        dated += 1
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", p["date_added"]), (node_id, p["date_added"])
    assert dated > 8000
    # `duration` is a number when the cell holds a number and a unit.
    by_unit = {p.get("duration_unit") for p in props.values()}
    assert by_unit <= {None, "minute", "season"}
    assert {"minute", "season"} <= by_unit
    first = props["Title:s1"]
    assert (first["duration"], first["duration_unit"]) == (90, "minute")
    assert (props["Title:s2"]["duration"], props["Title:s2"]["duration_unit"]) == (2, "season")
    # A "1 Season" cell and a "2 Seasons" cell are the same unit.
    assert (props["Title:s3"]["duration"], props["Title:s3"]["duration_unit"]) == (1, "season")


# --- Evidence on every node and edge (principle 4; sections 3.5, 3.9 invariant on evidence) ---


def test_an_edges_locator_points_at_its_titles_row_and_the_edges_column(flow: Flow) -> None:
    # Section 3.5: a locator is `name=value` pairs; the row is the title's own row, the field the
    # column the value came from.
    column_of = {edge: column for column, (_, _, edge) in LINKS.items()}
    with open_sealed(flow.mosaic) as mosaic:
        title_rows = {
            nid: dict(p.split("=", 1) for p in loc.split(";"))
            for nid, loc in _query(
                mosaic,
                "SELECT n.nid, v.locator FROM node n JOIN evidence v ON v.nid = n.nid "
                "WHERE n.type = 'Title' AND v.prop IS NULL",
                limits=ALL_ROWS,
            )
        }
        edges = _query(
            mosaic,
            "SELECT e.type, e.src, v.locator FROM edge e JOIN evidence v ON v.eid = e.eid",
            limits=ALL_ROWS,
        )
    assert len(title_rows) == 8807
    assert len(edges) > 8807
    for edge_type, src, locator in edges:
        pairs = dict(p.split("=", 1) for p in locator.split(";"))
        assert pairs["field"] == column_of[edge_type], locator
        assert pairs["row"] == title_rows[src]["row"], locator
        assert pairs["file"] == title_rows[src]["file"], locator


# --- Targets: strict and budget (sections 5.4, 7.1 step 8, 7.3) ---
