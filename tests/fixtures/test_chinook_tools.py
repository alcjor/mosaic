"""The kit's tool cases on the Chinook mosaic (Specification 0.1, sections 8 and 11).

Section 11: "tool cases with expected answers, on the Chinook mosaic. A kit's answers match and
are valid against ``answers.schema.json``". The mosaic is built as ``test_chinook.py`` builds it
(the source and the model fetched and checked by their pinned SHA-256, a new and empty directory,
vectors on), and is the one ``expected-hashes.json`` names. Then ``kit/scripts/run-cases.ts`` runs
every case of ``conformance/tools/expected-answers.json`` in the kit, with the model for the
vector tier of ``find``: each answer equals its expected answer and is valid against
``spec/answers.schema.json``. Run it with ``-s`` for the command and a line per case.
"""

import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from mosaic_format.reader import open as open_sealed

from tests.conftest import MODEL, REPO
from tests.fixtures import test_chinook
from tests.fixtures.expected import load_expected
from tests.fixtures.tool_cases import FILE, SCHEMA, differences, load

pytestmark = pytest.mark.slow

NODE_IDS: set[str] = set()
"""The ids of the built mosaic's nodes: an unknown id's suggestions must be among them."""


@pytest.fixture(scope="module")
def answers(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    """The kit's answer to every case, on the Chinook mosaic built in a new, empty directory."""
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
    run = test_chinook._run(tmp_path_factory.mktemp("chinook-tools") / "build")
    expected = load_expected(test_chinook.FIXTURE)[test_chinook.TARGET]
    assert run.mosaic_hash == expected.knowledge_hash, "the mosaic expected-hashes.json names"
    mosaic = tmp_path_factory.mktemp("chinook-mosaic") / "chinook.mosaic"
    mosaic.write_bytes(run.mosaic_bytes)
    bun = shutil.which("bun")
    assert bun, "bun runs the kit (README, Development)"
    command = [bun, "kit/scripts/run-cases.ts", str(mosaic), str(FILE), "--model", str(MODEL)]
    done = subprocess.run(
        command, cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=False
    )
    assert done.returncode == 0, done.stdout + done.stderr
    found: dict[str, Any] = json.loads(done.stdout)
    with open_sealed(mosaic) as m:
        NODE_IDS.update(str(i) for (i,) in m.query("SELECT id FROM node"))
    print(f"\n$ bun kit/scripts/run-cases.ts {mosaic.name} {FILE.relative_to(REPO)} --model …")
    for name, answer in found.items():
        if "error" in answer:
            print(f"{name}: {answer['tool']} error {answer['error']['code']}")
            continue
        data = answer["data"]
        listed = next(
            (data[k] for k in ("results", "rows", "edges", "evidence") if k in data), None
        )
        shown = "" if listed is None else f" {len(listed)} of {data['total']}"
        print(f"{name}: {answer['tool']}{shown}")
    return found


def test_every_case_gives_its_expected_answer(answers: dict[str, Any]) -> None:
    found = differences(load(FILE)["cases"], answers, node_ids=NODE_IDS or None)
    assert not found, "\n".join(found)


def test_every_answer_is_valid_against_the_answers_schema(answers: dict[str, Any]) -> None:
    validator = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
    for name, answer in answers.items():
        errors = [e.message for e in validator.iter_errors(answer)]
        assert not errors, f"{name}: {errors}"


def test_the_run_answers_every_case_and_nothing_else(answers: dict[str, Any]) -> None:
    assert list(answers) == list(load(FILE)["cases"])


CALLS = """
import { readFileSync } from "node:fs";
import { openFile, loadEmbedder } from "@@KIT@@/src/index.js";
const [mosaic, modelDir] = process.argv.slice(2);
const embedder = modelDir === "-" ? undefined : await loadEmbedder({
  model: new Uint8Array(readFileSync(`${modelDir}/onnx/model_quantized.onnx`)),
  tokenizer: new Uint8Array(readFileSync(`${modelDir}/tokenizer.json`)),
});
const file = await openFile(new Uint8Array(readFileSync(mosaic)), "chinook.mosaic",
  embedder ? { embedder } : {});
const out: unknown[] = [];
for (const call of JSON.parse(readFileSync(0, "utf8"))) {
  out.push(await (file as any)[call.tool](call.arguments));
}
console.log(JSON.stringify(out));
"""
VALIDATOR = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
MARKER = "…"


def _by(text: str) -> bytes:
    return text.encode("utf-8")


class World:
    """The mosaic built once, the kit's way of being called, and the source database."""

    def __init__(self, root: Path, second: Path) -> None:
        self.mosaic = root / "chinook.mosaic"
        self.second = second
        self.script = root / "calls.ts"
        self.script.write_text(CALLS.replace("@@KIT@@", str(REPO / "kit")), encoding="utf-8")
        self.db = sqlite3.connect(f"file:{test_chinook.SOURCE}?mode=ro", uri=True)

    def call(self, calls: list[dict[str, Any]], *, vectors: bool = True) -> list[dict[str, Any]]:
        """The kit's answers to ``calls`` (tool, arguments), each valid against the schema."""
        bun = shutil.which("bun")
        assert bun
        done = subprocess.run(
            [bun, str(self.script), str(self.mosaic), str(MODEL) if vectors else "-"],
            input=json.dumps(calls),
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        assert done.returncode == 0, done.stdout + done.stderr
        answers: list[dict[str, Any]] = json.loads(done.stdout)
        assert len(answers) == len(calls)
        for call, answer in zip(calls, answers, strict=True):
            errors = [e.message for e in VALIDATOR.iter_errors(answer)]
            assert not errors, f"{call}: {errors}"
            assert answer["tool"] == call["tool"]
        return answers

    def one(self, tool: str, **arguments: Any) -> dict[str, Any]:
        return self.call([{"tool": tool, "arguments": arguments}])[0]

    def data(self, tool: str, **arguments: Any) -> dict[str, Any]:
        answer = self.one(tool, **arguments)
        assert "data" in answer, answer
        data: dict[str, Any] = answer["data"]
        return data

    def error(self, tool: str, **arguments: Any) -> dict[str, Any]:
        answer = self.one(tool, **arguments)
        assert "error" in answer, answer
        error: dict[str, Any] = answer["error"]
        return error


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory) -> World:
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
    root = tmp_path_factory.mktemp("chinook-tools-edges")
    first = test_chinook._run(root / "build-1")
    second = test_chinook._run(root / "build-2")
    (root / "chinook.mosaic").write_bytes(first.mosaic_bytes)
    (root / "second.mosaic").write_bytes(second.mosaic_bytes)
    return World(root, root / "second.mosaic")


def _run_cases(mosaic: Path, cwd: Path = REPO) -> str:
    bun = shutil.which("bun")
    assert bun
    command = [bun, str(REPO / "kit/scripts/run-cases.ts"), str(mosaic), str(FILE)]
    command += ["--model", str(MODEL)]
    done = subprocess.run(
        command, cwd=cwd, capture_output=True, text=True, encoding="utf-8", check=False
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout


# --- determinism (principle 5) ------------------------------------------------------------------


def test_a_second_build_of_the_mosaic_gives_the_same_answers_to_every_case(world: World) -> None:
    assert _run_cases(world.mosaic) == _run_cases(world.second)


# --- the expected answers against the source database -------------------------------------------


def _rows(world: World, sql: str, *args: Any) -> list[tuple[Any, ...]]:
    return world.db.execute(sql, args).fetchall()


def test_get_track_gives_the_source_row(world: World) -> None:
    ((name, composer, ms, nbytes, price),) = _rows(
        world,
        "SELECT Name, Composer, Milliseconds, Bytes, UnitPrice FROM Track WHERE TrackId = 1",
    )
    data = load()["cases"]["get-track"]["answer"]["data"]
    assert data["label"] == name
    assert data["props"] == {
        "bytes": nbytes,
        "composer": composer,
        "milliseconds": ms,
        "name": name,
        "unit_price": price,
    }
    (on_playlists,) = _rows(world, "SELECT count(*) FROM PlaylistTrack WHERE TrackId = 1")[0]
    links = {(x["edge"], x["direction"]): x["count"] for x in data["links"]}
    assert links[("contains", "in")] == on_playlists
    assert links[("on_album", "out")] == links[("in_genre", "out")] == 1


def test_neighbors_totals_are_the_source_row_counts(world: World) -> None:
    cases = load()["cases"]
    (tracks,) = _rows(world, "SELECT count(*) FROM Track WHERE AlbumId = 1")[0]
    assert cases["neighbors-album-in"]["answer"]["data"]["total"] == tracks
    (listed,) = _rows(world, "SELECT count(*) FROM PlaylistTrack WHERE PlaylistId = 18")[0]
    assert cases["neighbors-playlist-out"]["answer"]["data"]["total"] == listed
    reports = {r[0] for r in _rows(world, "SELECT EmployeeId FROM Employee WHERE ReportsTo = 1")}
    shown = {e["id"] for e in cases["neighbors-manager"]["answer"]["data"]["edges"]}
    assert shown == {f"Employee:{i}" for i in reports}


def test_neighbors_album_in_lists_every_track_of_the_album(world: World) -> None:
    """Section 8.2: cut at 20 with the total (the album has 10 tracks: all of them show)."""
    edges = load()["cases"]["neighbors-album-in"]["answer"]["data"]["edges"]
    tracks = {f"Track:{i}" for (i,) in _rows(world, "SELECT TrackId FROM Track WHERE AlbumId = 1")}
    assert {e["id"] for e in edges} == tracks


def test_table_customer_country_is_the_source_table_filtered(world: World) -> None:
    rows = _rows(
        world,
        "SELECT 'Customer:' || c.CustomerId, c.FirstName, c.LastName, c.Country, e.LastName"
        " FROM Customer c LEFT JOIN Employee e ON e.EmployeeId = c.SupportRepId"
        " WHERE c.Country = 'Brazil'",
    )
    expected = sorted(
        ([r[0], r[1], r[2], r[3], [r[4]]] for r in rows), key=lambda r: _by(str(r[0]))
    )
    data = load()["cases"]["table-customer-country"]["answer"]["data"]
    assert data["rows"] == expected
    assert data["total"] == len(expected)


def test_table_page_2_of_jazz_tracks_is_the_second_page_of_the_source(world: World) -> None:
    rows = _rows(
        world,
        "SELECT t.TrackId, t.Name, g.Name FROM Track t JOIN Genre g ON g.GenreId = t.GenreId"
        " WHERE lower(g.Name) LIKE '%jazz%'",
    )
    ordered = sorted(rows, key=lambda r: _by(f"Track:{r[0]}"))
    data = load()["cases"]["table-page-2"]["answer"]["data"]
    assert data["total"] == len(ordered)
    assert [r[0] for r in data["rows"]] == [f"Track:{r[0]}" for r in ordered[20:40]]
    assert [r[2] for r in data["rows"]] == [[r[2]] for r in ordered[20:40]]


def test_table_albums_by_gives_every_album_of_the_artist_with_its_artist_label(
    world: World,
) -> None:
    rows = _rows(
        world,
        "SELECT a.AlbumId, a.Title, r.Name FROM Album a JOIN Artist r ON r.ArtistId = a.ArtistId"
        " WHERE lower(r.Name) LIKE '%led zeppelin%'",
    )
    expected = sorted(([f"Album:{r[0]}", r[1], [r[2]]] for r in rows), key=lambda r: _by(str(r[0])))
    data = load()["cases"]["table-albums-by"]["answer"]["data"]
    assert data["rows"] == expected[:20]
    assert data["total"] == len(expected)


def test_cite_cases_give_the_source_hash_and_locator_of_the_source_row(world: World) -> None:
    digest = hashlib.sha256(test_chinook.SOURCE.read_bytes()).hexdigest()
    cases = load()["cases"]
    node = cases["cite-node"]["answer"]["data"]["evidence"][0]
    edge = cases["cite-edge"]["answer"]["data"]["evidence"][0]
    assert node["source_hash"] == edge["source_hash"] == digest
    assert node["locator"] == "file=Chinook_Sqlite.sqlite;table=Track;row=1"
    assert edge["locator"] == "file=Chinook_Sqlite.sqlite;table=PlaylistTrack;row=18/597"
    assert _rows(world, "SELECT 1 FROM PlaylistTrack WHERE PlaylistId = 18 AND TrackId = 597")


def test_find_finds_every_node_labelled_exactly_iron_maiden(world: World) -> None:
    named = {
        f"{table}:{i}"
        for table, key, column in (
            ("Artist", "ArtistId", "Name"),
            ("Album", "AlbumId", "Title"),
            ("Track", "TrackId", "Name"),
        )
        for (i,) in _rows(world, f"SELECT {key} FROM {table} WHERE {column} = 'Iron Maiden'")
    }
    assert named
    shown = {r["id"] for r in world.data("find", query="Iron Maiden", limit=20)["results"]}
    assert named <= shown


# --- calls beyond the cases ---------------------------------------------------------------------


def test_neighbors_without_a_direction_gives_both_directions_in_one_list(world: World) -> None:
    both = world.data("neighbors", id="Album:1")
    out = world.data("neighbors", id="Album:1", direction="out")
    into = world.data("neighbors", id="Album:1", direction="in")
    assert both["total"] == out["total"] + into["total"]
    assert {(e["edge"], e["direction"], e["id"]) for e in both["edges"]} == {
        (e["edge"], e["direction"], e["id"]) for e in out["edges"] + into["edges"]
    }
    assert world.data("neighbors", id="Album:1", direction="both") == both


def test_neighbors_of_a_node_with_no_edges_of_that_kind_is_an_empty_success(world: World) -> None:
    """Section 8.1: only an unknown id is an error; a known node with no such edge has none."""
    data = world.data("neighbors", id="Genre:1", edge="by", direction="out")
    assert data["edges"] == [] and data["total"] == 0


def test_a_cite_of_an_edge_between_unlinked_nodes_is_an_error(world: World) -> None:
    error = world.error("cite", **{"from": "Track:1", "type": "on_album", "to": "Album:2"})
    assert error["code"] in {"unknown_edge", "unknown_id"}


# --- table: kinds, groups, nulls, pages (section 8.6) -------------------------------------------


def _kind(value: Any) -> str:
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    return "text" if isinstance(value, str) else "other"


def _holds(cell: Any, op: str, value: Any) -> bool:
    if op == "contains":
        return isinstance(cell, str) and str(value).lower() in cell.lower()
    same = cell is not None and _kind(cell) == _kind(value)
    if op == "!=":
        return not (same and cell == value)
    if not same:
        return False
    a, b = (_by(cell), _by(value)) if isinstance(cell, str) else (cell, value)
    return {"=": a == b, "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op]


# --- odd input to find and the other tools (section 8.1, 10) ------------------------------------


def test_find_with_a_type_never_lists_another_type_in_any_tier(world: World) -> None:
    for query in ("Track:1", "rock", "calm music for studying"):
        for result in world.data("find", query=query, type="Genre")["results"]:
            assert result["type"] == "Genre"


def test_find_without_the_model_has_no_vector_matches_and_still_answers(world: World) -> None:
    answer = world.call(
        [{"tool": "find", "arguments": {"query": "calm music for studying"}}], vectors=False
    )[0]
    assert all(r["match"] != "vector" for r in answer["data"]["results"])
