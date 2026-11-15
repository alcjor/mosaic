"""Vectors in the builder with the real model of section 6 (slow: it needs the model files).

``scripts/fetch_model.py`` fetches the files and checks them by their pinned hashes. A build
with the model directory gives each node the bits of its node text as the model embeds it on
its own (sections 3.7 and 6); two builds of the same inputs give the same vector hash (section
7); the mosaic passes the checker (section 3.9, invariant 14).
"""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest
from mosaic_build.cli import main
from mosaic_build.mosaic import Built, build
from mosaic_build.mosaic import vectors as v
from mosaic_format.check import check_file
from mosaic_format.reader import open as open_sealed

from tests.conftest import REPO
from tests.mosaic.pieces import evidence, node, pattern, tessera
from tests.test_cli import imported, write_pattern

pytestmark = pytest.mark.slow

ITEM = {
    "Item": {
        "key": "code",
        "from": {"list.Row": {"code": "key", "label": "label", "summary": "summary"}},
    }
}
NODES = [
    node("Row:P-1", "P-1", label="Bronze horse", summary="Cast in bronze from a clay model."),
    node("Row:V-2", "V-2", label="Marble relief", summary="Carved for the east gallery."),
    node("Row:T-3", "T-3", label="Plaster torso"),
    node("Row:Ω", "Ω", summary="A node keyed by a non-ASCII letter."),
]
EVIDENCE = [
    evidence("Row:P-1", "row=1", snippet="P-1,Bronze horse,bronze"),
    evidence("Row:V-2", "row=2", snippet="V-2,Marble relief"),
    evidence("Row:T-3", "row=3"),
    evidence("Row:Ω", "row=4", snippet="Ω," + "long text " * 120),
]


def _fetch() -> Path:
    path = REPO / "scripts" / "fetch_model.py"
    spec = importlib.util.spec_from_file_location("fetch_model_vectors", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_model_vectors"] = module
    spec.loader.exec_module(module)
    return module.fetch()


@pytest.fixture(scope="module")
def model_dir() -> Path:
    return _fetch()


def _build(directory: Path, model: Path) -> Built:
    directory.mkdir()
    path = directory / "list.tessera"
    h = tessera(path, NODES, evidence=EVIDENCE)
    return build(
        pattern(directory, [f"list@{h}"], ITEM),
        "default",
        directory / "out.mosaic",
        pieces=[path],
        model=model,
    )


def _rows(built: Built, sql: str) -> list[tuple[Any, ...]]:
    with open_sealed(built.path) as f:
        return [tuple(r) for r in f.query(sql)]


@pytest.fixture(scope="module")
def built(model_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Built:
    return _build(tmp_path_factory.mktemp("vectors") / "one", model_dir)


def test_each_vector_is_the_bits_of_the_node_text(built: Built, model_dir: Path) -> None:
    embedder = v.Embedder(model_dir)
    found = dict(_rows(built, "SELECT n.id, v.bits FROM vector v JOIN node n USING (nid)"))
    snippets = {e.subject: e.snippet for e in EVIDENCE}
    expected = {
        f"Item:{n.key}": embedder.bits(
            v.node_text("Item", n.key, n.label, n.summary, snippets[n.id])
        )
        for n in NODES
    }
    assert found == expected
    assert len(set(expected.values())) == len(NODES)


def test_the_header_names_the_model_and_the_hash_of_the_bits(built: Built) -> None:
    ((vector_hash, embed_model),) = _rows(built, "SELECT vector_hash, embed_model FROM header")
    bits = b"".join(bytes(b) for (b,) in _rows(built, "SELECT bits FROM vector ORDER BY nid"))
    assert vector_hash == hashlib.sha256(bits).hexdigest() == built.vector_hash
    assert embed_model == v.EMBED_MODEL


def test_two_builds_give_the_same_vector_hash(
    built: Built, model_dir: Path, tmp_path: Path
) -> None:
    again = _build(tmp_path / "two", model_dir)
    assert again.vector_hash == built.vector_hash
    assert again.knowledge_hash == built.knowledge_hash


def test_the_mosaic_passes_the_checker(built: Built) -> None:
    report = check_file(built.path, pieces=[built.path.parent / "list.tessera"])
    assert report.ok, report.violations


def test_the_model_runs_on_the_cpu_in_one_thread(model_dir: Path) -> None:
    # ADR-005, option A: vectors are built on the CPU, in one thread.
    session = v.Embedder(model_dir)._session
    options = session.get_session_options()
    assert session.get_providers() == ["CPUExecutionProvider"]
    assert (options.intra_op_num_threads, options.inter_op_num_threads) == (1, 1)


def _inputs() -> tuple[list[Any], list[Any]]:
    """Sixty nodes: empty and one-word texts, medium ones, and ones past 256 tokens."""
    nodes: list[Any] = []
    evs: list[Any] = []
    for i in range(60):
        key = f"K{i:03d}"
        words = ("alpha beta gamma delta " * (i * 3)).strip()
        nodes.append(
            node(f"Row:{key}", key, label=None if i % 7 == 0 else f"Label {i}", summary=words)
        )
        evs.append(
            evidence(f"Row:{key}", f"row={i + 1}", snippet=("é ü ß " * (i % 5 * 40)) or None)
        )
    return nodes, evs


def _build_many(directory: Path, model: Path, *, reverse: bool = False) -> Built:
    directory.mkdir(parents=True)
    nodes, evs = _inputs()
    if reverse:
        nodes, evs = nodes[::-1], evs[::-1]
    path = directory / "list.tessera"
    h = tessera(path, nodes, evidence=evs)
    return build(
        pattern(directory, [f"list@{h}"], ITEM),
        "default",
        directory / "out.mosaic",
        pieces=[path],
        model=model,
    )


def _vectors(built: Built) -> dict[str, bytes]:
    with open_sealed(built.path) as f:
        rows = [
            tuple(r)
            for r in f.query(
                "SELECT n.id, v.bits FROM vector v JOIN node n USING (nid) ORDER BY nid"
            )
        ]
    found: dict[str, bytes] = {}
    for i, b in rows:
        assert isinstance(b, bytes)
        found[str(i)] = b
    return found


@pytest.fixture(scope="module")
def forward(model_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Built:
    return _build_many(tmp_path_factory.mktemp("edges") / "fwd", model_dir)


def test_the_input_order_does_not_change_the_vector_hash(
    forward: Built, model_dir: Path, tmp_path: Path
) -> None:
    # Section 7: the same inputs give the same vector hash. Reversing the nodes changes how a
    # builder would group texts of different lengths for the model.
    backward = _build_many(tmp_path / "bwd", model_dir, reverse=True)
    assert backward.knowledge_hash == forward.knowledge_hash
    assert backward.vector_hash == forward.vector_hash
    assert _vectors(backward) == _vectors(forward)


def test_texts_of_every_length_are_embedded_as_the_model_embeds_each_on_its_own(
    forward: Built, model_dir: Path
) -> None:
    # Section 6: the stored vector is the signs of the node's own embedding, whatever else is in
    # the build (a longer text in the same group must not change a shorter one).
    embedder = v.Embedder(model_dir)
    nodes, evs = _inputs()
    snippets = {e.subject: e.snippet for e in evs}
    expected = {
        f"Item:{n.key}": embedder.bits(
            v.node_text("Item", n.key, n.label, n.summary, snippets[n.id])
        )
        for n in nodes
    }
    assert _vectors(forward) == expected


def test_the_command_line_builds_and_checks_a_mosaic_with_the_real_model(
    model_dir: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Section 7.2: the build report has the vector hash; the message "vectors skipped" is gone.
    _, piece_hash = imported(tmp_path)
    pattern_path = write_pattern(tmp_path, piece_hash)
    args = ["build", str(pattern_path), "--pieces", str(tmp_path / "pieces")]
    out = tmp_path / "out"
    assert main([*args, "--model", str(model_dir), "-o", str(out)]) == 0
    seen = capsys.readouterr()
    assert "skipped" not in seen.err + seen.out
    mosaic = out / "default.mosaic"
    with open_sealed(mosaic) as f:
        ((vector_hash, embed_model),) = f.query("SELECT vector_hash, embed_model FROM header")
    report = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    assert report["vector_hash"] == vector_hash and embed_model == v.EMBED_MODEL
    assert main(["check", str(mosaic), "--pieces", str(tmp_path / "pieces")]) == 0
