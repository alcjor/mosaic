"""The Chinook fixture end to end (Specification 0.1, section 11).

The source, one SQLite database, is downloaded and checked against its pinned SHA-256 by
``scripts/fetch_fixtures.py`` (never committed). ``mosaic import sqlite`` makes the tessera with
``conformance/fixtures/chinook/settings.yaml``, ``mosaic check`` checks the pattern beside it
against that tessera, ``mosaic build`` builds it with vectors (the model of section 6, fetched
and checked by ``scripts/fetch_model.py``), and ``mosaic check`` checks the tessera and the
mosaic. The whole flow runs twice, each time in a new, empty directory: both runs give the
tessera hash that ``pattern.yaml`` pins (section 5.1), the same mosaic, knowledge hash and vector
hash, and a build report valid against ``spec/build-report.schema.json`` (section 7.2). Each
run's hashes and model are those ``expected-hashes.json`` records. The test prints the hashes,
file sizes and timings of both runs (run it with ``-s``).

Chinook is "the first case with several linked types" (section 11): eight node types and seven
edge types, among them a foreign key to its own table (``reports_to``) and a table whose primary
key is two foreign keys (``PlaylistTrack``, one ``contains`` edge per row).
"""

import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from mosaic_format.reader import Limits, SealedFile
from mosaic_format.reader import open as open_sealed
from mosaic_format.yaml_core import load

from tests.conftest import MODEL, REPO, SPEC
from tests.fixtures.expected import differences, load_expected
from tests.fixtures.test_netflix import Run, _timed
from tests.test_cli import entry_point

BUILD_BUDGET_SECONDS = 15 * 60
"""ADR-007, as for the Netflix mosaic: building with vectors takes under 15 minutes."""

FIXTURE = REPO / "conformance" / "fixtures" / "chinook"
TARGET = "default"
"""The pattern's one target (it has no ``mosaics``, section 5.4); its file is ``default.mosaic``."""
SOURCE = REPO / "conformance" / "fixtures" / "downloads" / "chinook" / "Chinook_Sqlite.sqlite"
NODES = {
    "Artist": 275,
    "Album": 347,
    "Track": 3503,
    "Genre": 25,
    "MediaType": 5,
    "Playlist": 18,
    "Employee": 8,
    "Customer": 59,
}
"""One node per row of each table the settings name: the rows of the pinned database."""
EDGES = {
    "by": 347,
    "on_album": 3503,
    "in_genre": 3503,
    "encoded_as": 3503,
    "contains": 8715,
    "reports_to": 7,
    "supported_by": 59,
}
"""One edge per non-NULL foreign key value, and one per row of ``PlaylistTrack``."""
NOTICE = "Chinook Database. Copyright (c) 2008-2024 Luis Rocha. MIT License."
"""The database's MIT copyright line, set in ``settings.yaml``."""

pytestmark = pytest.mark.slow


def _pinned_piece() -> tuple[str, str]:
    """The name and hash of the one piece that ``pattern.yaml`` pins."""
    pattern = load((FIXTURE / "pattern.yaml").read_text(encoding="utf-8"), "pattern.yaml").data
    [piece] = pattern["pieces"]
    name, _, pinned = piece.partition("@")
    return name, pinned


def _run(directory: Path) -> Run:
    """Import, check, build and check in ``directory``, which starts empty."""
    directory.mkdir()
    assert not any(directory.iterdir())
    name, _ = _pinned_piece()
    pieces, out = directory / "pieces", directory / "out"
    pieces.mkdir()
    shutil.copyfile(SOURCE, directory / SOURCE.name)
    tessera = pieces / f"{name}.tessera"
    pattern = FIXTURE / "pattern.yaml"
    settings = FIXTURE / "settings.yaml"
    seconds: dict[str, float] = {}
    _timed(
        seconds,
        "import",
        *("import", "sqlite", SOURCE.name, "--settings", settings, "-o", tessera),
        cwd=directory,
    )
    _timed(seconds, "check pattern", "check", pattern, "--pieces", pieces, cwd=directory)
    _timed(
        seconds,
        "build",
        *("build", pattern, "--pieces", pieces, "--model", MODEL, "-o", out),
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
    # The source is only read (principle 8): byte-identical, nothing made beside it.
    assert (directory / SOURCE.name).read_bytes() == SOURCE.read_bytes()
    assert sorted(p.name for p in directory.iterdir()) == [SOURCE.name, "out", "pieces"]
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    return Run(
        tessera_hash=tessera_hash,
        tessera_size=tessera.stat().st_size,
        mosaic_hash=mosaic_hash,
        vector_hash=None if vector_hash is None else str(vector_hash),
        embed_model=None if embed_model is None else str(embed_model),
        vectors=int(str(vectors)),
        nodes=int(str(nodes)),
        mosaic_size=mosaic.stat().st_size,
        mosaic_bytes=mosaic.read_bytes(),
        report=report,
        seconds=seconds,
    )


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> tuple[Run, Run]:
    fetched = subprocess.run(
        [sys.executable, "-I", str(REPO / "scripts" / "fetch_fixtures.py")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert "ok   chinook" in fetched.stdout, fetched.stdout + fetched.stderr
    model = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "fetch_model.py"), "--dest", str(MODEL)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert model.returncode == 0, model.stdout + model.stderr
    base = tmp_path_factory.mktemp("chinook")
    first, second = _run(base / "first"), _run(base / "second")
    for label, run in (("first", first), ("second", second)):
        timings = ", ".join(f"{step} {s:.1f} s" for step, s in run.seconds.items())
        print(
            f"\nchinook {label}: tessera {run.tessera_hash} ({run.tessera_size:,} bytes); "
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
            embed_model=run.embed_model,
        )
        assert not found, "\n".join(found)


def test_two_clean_builds_give_the_same_mosaic(runs: tuple[Run, Run]) -> None:
    first, second = runs
    assert first.tessera_hash == second.tessera_hash
    assert first.mosaic_hash == second.mosaic_hash
    assert first.vector_hash == second.vector_hash
    assert first.mosaic_bytes == second.mosaic_bytes
    assert first.report == second.report


def test_the_build_report_is_valid_and_names_the_mosaic(runs: tuple[Run, Run]) -> None:
    schema = json.loads((SPEC / "build-report.schema.json").read_text(encoding="utf-8"))
    for run in runs:
        Draft202012Validator(schema).validate(run.report)
        assert run.report["outcome"] == "built"
        assert run.report["knowledge_hash"] == run.mosaic_hash
        assert run.report["vector_hash"] == run.vector_hash
        assert run.report["file_size"] == run.mosaic_size


def test_the_mosaic_holds_every_linked_type_of_the_pattern(runs: tuple[Run, Run]) -> None:
    counts = runs[0].report["counts"]
    assert isinstance(counts, dict)
    assert counts["nodes"] == NODES
    assert counts["edges"] == EDGES


def test_the_mosaic_has_one_vector_per_node_and_names_the_model(runs: tuple[Run, Run]) -> None:
    for run in runs:
        assert run.vectors == run.nodes == sum(NODES.values())
        assert run.embed_model == (
            "snowflake-arctic-embed-xs@"
            "e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1"
        )


def test_the_build_with_vectors_takes_under_15_minutes(runs: tuple[Run, Run]) -> None:
    for run in runs:
        assert run.seconds["build"] < BUILD_BUDGET_SECONDS


def test_the_mosaic_carries_the_mit_notice(runs: tuple[Run, Run], tmp_path: Path) -> None:
    """Sections 3.2, 7.2, 10 and the maintainer's answer: the notice is not lost."""
    for run in runs:
        assert run.report["notices"] == [{"piece": "chinook", "text": NOTICE}]
    mosaic = tmp_path / "chinook.mosaic"
    mosaic.write_bytes(runs[0].mosaic_bytes)
    with open_sealed(mosaic) as m:
        assert m.query("SELECT id, kind, notice FROM source ORDER BY id") == [
            ("chinook", "tessera", None),
            ("chinook/Chinook_Sqlite.sqlite", "database", NOTICE),
        ]


def test_a_playlist_links_straight_to_its_tracks(runs: tuple[Run, Run], tmp_path: Path) -> None:
    """each row of PlaylistTrack is one edge from the playlist to the track."""
    mosaic = tmp_path / "chinook.mosaic"
    mosaic.write_bytes(runs[0].mosaic_bytes)
    with open_sealed(mosaic) as m:
        assert m.query(
            "SELECT count(*) FROM v_edge WHERE type = 'contains' AND src = 'Playlist:18'"
        ) == [(1,)]
        assert m.query(
            "SELECT locator FROM v_evidence WHERE edge_type = 'contains'"
            " AND edge_src = 'Playlist:18'"
        ) == [("file=Chinook_Sqlite.sqlite;table=PlaylistTrack;row=18/597",)]
        assert m.query(
            "SELECT dst FROM v_edge WHERE type = 'reports_to' AND src = 'Employee:2'"
        ) == [("Employee:1",)]


MANIFEST = REPO / "conformance" / "fixtures" / "manifest.json"
ALL_ROWS = Limits(seconds=None, rows=None)


def _mosaic(*args: str | Path, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(entry_point()), *(str(a) for a in args)],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def _ok(*args: str | Path, cwd: Path) -> str:
    done = _mosaic(*args, cwd=cwd)
    assert done.returncode == 0, f"mosaic {args[0]} failed:\n{done.stdout}{done.stderr}"
    return done.stdout


def _source(sql: str) -> list[tuple[Any, ...]]:
    """Rows of the pinned database, read-only."""
    with sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True) as db:
        return db.execute(sql).fetchall()


def _import(directory: Path, pieces: Path, *, source: str | Path | None = None) -> Path:
    name, _ = _pinned_piece()
    tessera = pieces / f"{name}.tessera"
    _ok(
        "import",
        "sqlite",
        source if source is not None else SOURCE.name,
        "--settings",
        FIXTURE / "settings.yaml",
        "-o",
        tessera,
        cwd=directory,
    )
    return tessera


@dataclass(frozen=True)
class Built:
    directory: Path
    pieces: Path
    tessera: Path
    mosaic: Path
    report: dict[str, object]

    def open(self) -> SealedFile:
        return open_sealed(self.mosaic, limits=ALL_ROWS)


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Built:
    directory = tmp_path_factory.mktemp("chinook-edges")
    pieces, out = directory / "pieces", directory / "out"
    pieces.mkdir()
    shutil.copyfile(SOURCE, directory / SOURCE.name)
    tessera = _import(directory, pieces)
    _ok(
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
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    return Built(directory, pieces, tessera, out / "default.mosaic", report)


def _q(built: Built, sql: str, params: tuple[object, ...] = ()) -> list[tuple[Any, ...]]:
    with built.open() as m:
        return m.query(sql, params, limits=ALL_ROWS)


# --- Keys, ids, labels, properties against the source (3.4, 5.2) -------------------------------

LABELS = {
    "Artist": ("Artist", "ArtistId", "Name"),
    "Album": ("Album", "AlbumId", "Title"),
    "Track": ("Track", "TrackId", "Name"),
    "Genre": ("Genre", "GenreId", "Name"),
    "MediaType": ("MediaType", "MediaTypeId", "Name"),
    "Playlist": ("Playlist", "PlaylistId", "Name"),
    "Employee": ("Employee", "EmployeeId", "LastName"),
    "Customer": ("Customer", "CustomerId", "LastName"),
}


@pytest.mark.parametrize("node_type", sorted(LABELS))
def test_every_row_of_a_table_is_one_node_with_its_label_byte_for_byte(
    built: Built, node_type: str
) -> None:
    """5.2, 3.4: the id is `<Type>:<key>` with the key as text; the label is the source's text."""
    table, pk, column = LABELS[node_type]
    expected = {
        f"{node_type}:{k}": label for k, label in _source(f"SELECT {pk}, {column} FROM {table}")
    }
    found = dict(_q(built, "SELECT id, label FROM node WHERE type = ?", (node_type,)))
    assert found == expected
    for node_id, key in _q(built, "SELECT id, key FROM node WHERE type = ?", (node_type,)):
        assert node_id == f"{node_type}:{key}"
        assert isinstance(key, str)


def test_non_ascii_labels_are_kept_as_the_source_wrote_them(built: Built) -> None:
    """3.1/3.6: text is UTF-8, compared by bytes; no normalisation changes a label."""
    rows = dict(_q(built, "SELECT id, label FROM node WHERE id IN ('Artist:6', 'Artist:18')"))
    assert rows["Artist:6"].encode("utf-8") == "Antônio Carlos Jobim".encode()
    assert rows["Artist:18"] == "Chico Science & Nação Zumbi"


def test_same_label_on_two_rows_is_two_nodes(built: Built) -> None:
    """3.4: (type, key) is the identity, never the label: two playlists are named Music."""
    rows = _q(built, "SELECT id FROM node WHERE type = 'Playlist' AND label = 'Music' ORDER BY id")
    assert rows == [("Playlist:1",), ("Playlist:8",)]
    tracks = _q(built, "SELECT count(*) FROM node WHERE type = 'Track' AND label = 'Wrathchild'")
    assert tracks == [(5,)]


def test_track_properties_equal_the_source_and_keep_their_kinds(built: Built) -> None:
    """3.4: props are a JSON object; numbers stay numbers, text stays text."""
    source = _source(
        "SELECT TrackId, Name, Composer, Milliseconds, Bytes, UnitPrice FROM Track ORDER BY TrackId"
    )
    found = {
        str(k): json.loads(str(p))
        for k, p in _q(built, "SELECT key, props FROM node WHERE type = 'Track'")
    }
    assert len(found) == len(source)
    for track_id, name, composer, ms, size, price in source:
        props = found[str(track_id)]
        assert props.get("name") == name
        assert props.get("composer") == composer  # absent and null both read as None
        assert props["milliseconds"] == ms and isinstance(props["milliseconds"], int)
        assert props["bytes"] == size and isinstance(props["bytes"], int)
        assert props["unit_price"] == price


def test_a_track_without_composer_has_no_composer_value(built: Built) -> None:
    """3.4 + 5.2: NULL in the source is no value. Track 65 has a NULL Composer."""
    assert _source("SELECT Composer FROM Track WHERE TrackId = 65") == [(None,)]
    [(props,)] = _q(built, "SELECT props FROM node WHERE id = 'Track:65'")
    assert json.loads(str(props)).get("composer") is None  # absent, or JSON null; never a stand-in


# --- Edges against the source (5.3 map, 3.9) ---------------------------------------------------

EDGE_SOURCES = {
    "by": ("SELECT AlbumId, ArtistId FROM Album", "Album", "Artist"),
    "on_album": ("SELECT TrackId, AlbumId FROM Track WHERE AlbumId IS NOT NULL", "Track", "Album"),
    "in_genre": ("SELECT TrackId, GenreId FROM Track WHERE GenreId IS NOT NULL", "Track", "Genre"),
    "encoded_as": (
        "SELECT TrackId, MediaTypeId FROM Track WHERE MediaTypeId IS NOT NULL",
        "Track",
        "MediaType",
    ),
    "contains": ("SELECT PlaylistId, TrackId FROM PlaylistTrack", "Playlist", "Track"),
    "reports_to": (
        "SELECT EmployeeId, ReportsTo FROM Employee WHERE ReportsTo IS NOT NULL",
        "Employee",
        "Employee",
    ),
    "supported_by": (
        "SELECT CustomerId, SupportRepId FROM Customer WHERE SupportRepId IS NOT NULL",
        "Customer",
        "Employee",
    ),
}


@pytest.mark.parametrize("edge_type", sorted(EDGE_SOURCES))
def test_each_edge_type_joins_exactly_the_pairs_the_source_rows_name(
    built: Built, edge_type: str
) -> None:
    """5.3 map: the edges are the foreign keys of the database, no more and no fewer."""
    sql, src_type, dst_type = EDGE_SOURCES[edge_type]
    expected = {(f"{src_type}:{a}", f"{dst_type}:{b}") for a, b in _source(sql)}
    rows = _q(built, "SELECT src, dst, qualifier FROM v_edge WHERE type = ?", (edge_type,))
    assert {(str(s), str(d)) for s, d, _ in rows} == expected
    assert len(rows) == len(expected)  # no duplicate pair
    assert all(q == "" for _, _, q in rows)  # 3.4: qualifier empty unless two edges join a pair


def test_the_top_employee_has_no_manager_edge(built: Built) -> None:
    """A NULL foreign key makes no edge (Employee 1 reports to nobody)."""
    assert _q(
        built, "SELECT count(*) FROM v_edge WHERE type = 'reports_to' AND src = 'Employee:1'"
    ) == [(0,)]
    assert _q(built, "SELECT count(*) FROM v_edge WHERE type = 'reports_to'") == [(7,)]


def test_a_playlist_with_no_tracks_still_has_a_node_and_no_edge(built: Built) -> None:
    """A node needs evidence, not edges: every playlist is a node, empty ones have none."""
    empty = _source(
        "SELECT PlaylistId FROM Playlist p WHERE NOT EXISTS "
        "(SELECT 1 FROM PlaylistTrack t WHERE t.PlaylistId = p.PlaylistId)"
    )
    for (pid,) in empty:
        assert _q(built, "SELECT count(*) FROM node WHERE id = ?", (f"Playlist:{pid}",)) == [(1,)]
        assert _q(built, "SELECT count(*) FROM v_edge WHERE src = ?", (f"Playlist:{pid}",)) == [
            (0,)
        ]


# --- Evidence (3.5, 3.9) -----------------------------------------------------------------------


def test_the_original_source_is_the_database_with_its_hash_and_the_piece_is_the_tessera(
    built: Built,
) -> None:
    """3.2, 3.5: `sid` names the original source, never a piece; hashes pin both."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    [sha] = [f["sha256"] for f in manifest["fixtures"] if f["name"] == "chinook"]
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == sha
    name, pinned = _pinned_piece()
    sources = _q(built, "SELECT id, kind, hash FROM source ORDER BY id")
    pieces = [s for s in sources if s[1] in ("tessera", "mosaic")]
    assert pieces == [(name, "tessera", pinned)]
    originals = [s for s in sources if s[1] not in ("tessera", "mosaic")]
    assert [(i, h) for i, _, h in originals] == [
        (f"{name}/{str(i).split('/', 1)[1]}", sha) for i, _, _ in originals
    ]
    assert len(originals) == 1
    assert originals[0][1] == "database"
    sources_in_evidence = {r[0] for r in _q(built, "SELECT DISTINCT source FROM v_evidence")}
    assert sources_in_evidence == {originals[0][0]}


def test_a_contains_edge_keeps_the_two_keys_of_its_row_in_the_locator(built: Built) -> None:
    """3.5: an edge made by a two-key row cites that row (most specific last)."""
    rows = _q(
        built,
        "SELECT edge_src, edge_dst, locator FROM v_evidence WHERE edge_type = 'contains' "
        "AND edge_src = 'Playlist:1'",
    )
    assert len(rows) == len(_source("SELECT 1 FROM PlaylistTrack WHERE PlaylistId = 1"))
    for src, dst, locator in rows:
        track = str(dst).split(":", 1)[1]
        assert str(locator).endswith(f"row=1/{track}"), (src, dst, locator)
