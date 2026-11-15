"""Which types an export carries (docs/design.md, View file).

The view file's ``export.types`` names the node types an export carries;
this file starts with the simplest case:
with ``export.types`` absent, the export carries the mosaic as it is, byte for byte, so the page
shows the mosaic's own knowledge hash.
"""

import base64
import gzip
import json
import re
import shutil
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from mosaic_build import cut, view
from mosaic_build.cli import main
from mosaic_build.mosaic import build
from mosaic_format import seal
from mosaic_format.check import check_file
from mosaic_format.reader import open as open_sealed
from mosaic_format.writer import (
    Alias,
    Content,
    Edge,
    EdgeKey,
    Evidence,
    ExternalRef,
    Header,
    Node,
    Source,
    Type,
)

from tests.conftest import REPO
from tests.mosaic.pieces import StubModel, evidence, mosaic, node, pattern, tessera

MOSAIC = REPO / "conformance" / "reading" / "mosaic.mosaic"


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "dist"
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text(
        '<script type="module" crossorigin src="./assets/index-A.js"></script>\n'
        '<link rel="stylesheet" crossorigin href="./assets/index-B.css">\n',
        encoding="utf-8",
    )
    (directory / "assets" / "index-A.js").write_text("const page = 1;\n", encoding="utf-8")
    (directory / "assets" / "index-B.css").write_text("body {}\n", encoding="utf-8")
    (directory / "assets" / "sqlite3-C.wasm").write_bytes(b"\0asm")
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


def carried(page: Path) -> bytes:
    found = re.search(r'id="mosaic-export">(.*?)</script>', page.read_text(encoding="utf-8"))
    assert found
    return gzip.decompress(base64.b64decode(json.loads(found.group(1))["mosaic"]))


def test_without_export_types_the_export_carries_the_mosaic_as_it_is(
    tmp_path: Path, dist: Path
) -> None:
    source = tmp_path / "mosaic.mosaic"
    shutil.copyfile(MOSAIC, source)
    settings = tmp_path / "view.yaml"
    settings.write_text("search: text\ntypes:\n  Item: {}\n", encoding="utf-8")
    page = tmp_path / "out.html"
    assert main(["export", str(source), "--view", str(settings), "-o", str(page)]) == 0
    assert carried(page) == MOSAIC.read_bytes()


# The answers. Q1, Reading B: the cut is a build with the source mosaic as its one piece,
# pinned by its knowledge hash. Q2, Reading A: a type the mosaic lacks, or none, is an error.


def export(tmp_path: Path, text: str, out: str = "out.html") -> tuple[int, Path, Path]:
    source = tmp_path / "mosaic.mosaic"
    if not source.exists():
        shutil.copyfile(MOSAIC, source)
    settings = tmp_path / "view.yaml"
    settings.write_text(text, encoding="utf-8")
    page = tmp_path / out
    return main(["export", str(source), "--view", str(settings), "-o", str(page)]), page, settings


def opened(tmp_path: Path, data: bytes) -> sqlite3.Connection:
    path = tmp_path / "carried.mosaic"
    path.write_bytes(data)
    return sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)


ITEM_ONLY = "search: text\nexport:\n  types: [Item]\n"
BOTH = "search: text\nexport:\n  types: [Item, Group]\n"


def test_an_export_of_some_types_carries_those_types_and_no_other(
    tmp_path: Path, dist: Path
) -> None:
    code, page, _ = export(tmp_path, ITEM_ONLY)
    assert code == 0
    con = opened(tmp_path, carried(page))
    assert con.execute("SELECT name, kind FROM type ORDER BY name").fetchall() == [("Item", "node")]
    assert con.execute("SELECT id FROM node ORDER BY id").fetchall() == [("Item:a",), ("Item:b",)]
    assert con.execute("SELECT count(*) FROM edge").fetchone() == (0,)


def test_edges_are_carried_when_both_ends_are(tmp_path: Path, dist: Path) -> None:
    code, page, _ = export(tmp_path, BOTH)
    assert code == 0
    con = opened(tmp_path, carried(page))
    assert [r[0] for r in con.execute("SELECT name FROM type ORDER BY name")] == [
        "Group",
        "Item",
        "in_group",
    ]
    assert con.execute("SELECT count(*) FROM edge").fetchone() == (2,)


def test_the_carried_mosaic_opens_by_the_reading_rules_and_passes_the_checker(
    tmp_path: Path, dist: Path
) -> None:
    code, page, _ = export(tmp_path, BOTH)
    assert code == 0
    path = tmp_path / "carried.mosaic"
    path.write_bytes(carried(page))
    with open_sealed(path) as sealed:  # section 3.8: both hashes checked
        assert sealed.kind == "mosaic"
    assert list(check_file(path).violations) == []


def test_the_cut_is_a_build_with_the_source_mosaic_as_its_one_piece(
    tmp_path: Path, dist: Path
) -> None:
    code, page, _ = export(tmp_path, ITEM_ONLY)
    assert code == 0
    source_hash = open_sealed(MOSAIC).knowledge_hash
    con = opened(tmp_path, carried(page))
    pieces = con.execute("SELECT id, kind, hash FROM source WHERE kind IN ('tessera', 'mosaic')")
    assert pieces.fetchall() == [("mosaic", "mosaic", source_hash)]
    for sid, via in con.execute("SELECT sid, via FROM evidence"):
        assert json.loads(via)[-1] == source_hash  # section 3.5
        (copied,) = con.execute("SELECT id FROM source WHERE sid = ?", (sid,)).fetchone()
        assert copied.startswith("mosaic/")  # section 3.2: the piece's rows, prefixed
    pattern_hash, target = con.execute("SELECT pattern_hash, target FROM header").fetchone()
    assert target == "export" and len(pattern_hash) == 64
    assert con.execute("SELECT knowledge_hash FROM header").fetchone()[0] != source_hash


def test_the_same_mosaic_and_types_give_the_same_export(tmp_path: Path, dist: Path) -> None:
    assert export(tmp_path, ITEM_ONLY, "one.html")[0] == 0
    assert export(tmp_path, ITEM_ONLY, "two.html")[0] == 0
    assert (tmp_path / "one.html").read_bytes() == (tmp_path / "two.html").read_bytes()


def test_the_source_is_never_written(tmp_path: Path, dist: Path) -> None:
    source = tmp_path / "mosaic.mosaic"
    shutil.copyfile(MOSAIC, source)
    before = source.read_bytes(), source.stat().st_mtime_ns
    assert export(tmp_path, BOTH)[0] == 0
    assert (source.read_bytes(), source.stat().st_mtime_ns) == before
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "dist",
        "mosaic.mosaic",
        "out.html",
        "view.yaml",
    ]


def test_the_page_keeps_the_source_s_file_name(tmp_path: Path, dist: Path) -> None:
    code, page, _ = export(tmp_path, ITEM_ONLY)
    assert code == 0
    found = re.search(r'id="mosaic-export">(.*?)</script>', page.read_text(encoding="utf-8"))
    assert found and json.loads(found.group(1))["name"] == "mosaic.mosaic"


@pytest.mark.parametrize(
    ("types", "line", "message"),
    [
        ("[Item, Nope]", 3, "export.types: the mosaic has no node type Nope"),
        ("[in_group]", 3, "export.types: the mosaic has no node type in_group"),
        ("[item]", 3, "export.types: the mosaic has no node type item"),
        ("[]", 3, "export.types is empty; name the types to carry"),
    ],
)
def test_a_type_the_mosaic_lacks_or_none_is_an_error_naming_the_file_line_and_setting(
    tmp_path: Path,
    dist: Path,
    capsys: pytest.CaptureFixture[str],
    types: str,
    line: int,
    message: str,
) -> None:
    code, page, settings = export(tmp_path, f"search: text\nexport:\n  types: {types}\n")
    assert code == 1
    assert capsys.readouterr().err == f"mosaic export: {settings}:{line}: view file: {message}\n"
    assert not page.exists()


def test_the_unknown_type_named_is_on_its_own_line(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    text = "search: text\nexport:\n  types:\n    - Item\n    - Nope\n"
    code, _, settings = export(tmp_path, text)
    assert code == 1
    assert capsys.readouterr().err.startswith(f"mosaic export: {settings}:5: view file:")


def test_piece_names_come_from_the_source_file_name() -> None:
    assert cut.piece_name(Path("netflix.mosaic")) == "netflix"
    assert cut.piece_name(Path("/x/default.mosaic")) == "default"
    assert cut.piece_name(Path("a b.c.mosaic")) == "a-b-c"
    assert cut.piece_name(Path("---.mosaic")) == "source"


def test_the_export_s_data_says_it_was_cut_and_an_export_of_the_whole_mosaic_does_not(
    tmp_path: Path, dist: Path
) -> None:
    def data(page: Path) -> dict[str, object]:
        found = re.search(r'id="mosaic-export">(.*?)</script>', page.read_text(encoding="utf-8"))
        assert found
        return json.loads(found.group(1))

    assert export(tmp_path, ITEM_ONLY, "cut.html")[0] == 0
    assert data(tmp_path / "cut.html")["cut"] is True
    assert export(tmp_path, "search: text\n", "whole.html")[0] == 0
    assert "cut" not in data(tmp_path / "whole.html")


# Answer, Q3 Reading A: the piece is named after the source file; the name is sealed in the
# cut's `source` row, so the same bytes exported under two file names give two different cuts.


def test_the_same_bytes_under_two_file_names_give_two_cuts_named_after_them(
    tmp_path: Path, dist: Path
) -> None:
    hashes = {}
    for name, piece in (("my data.mosaic", "my-data"), ("export.mosaic", "export-source")):
        source = tmp_path / name
        shutil.copyfile(MOSAIC, source)
        settings = tmp_path / "view.yaml"
        settings.write_text(ITEM_ONLY, encoding="utf-8")
        page = tmp_path / f"{piece}.html"
        assert main(["export", str(source), "--view", str(settings), "-o", str(page)]) == 0
        con = opened(tmp_path, carried(page))
        rows = con.execute("SELECT id FROM source WHERE kind = 'mosaic'").fetchall()
        assert rows == [(piece,)]
        hashes[piece] = con.execute("SELECT knowledge_hash FROM header").fetchone()[0]
        con.close()
    assert hashes["my-data"] != hashes["export-source"]


# Answer, Q4 Reading A: evidence on a node's key property is copied like any other: the
# copied row is its sid and its via ends in the source's hash. A node whose only evidence is on its
# key keeps it and stays in the cut.


def keyed_source(path: Path, description: str | None = None) -> str:
    producer = "test/1"
    content = Content(
        header=Header(kind="mosaic", producer=producer, pattern_hash="b" * 64, target="t"),
        sources=[
            Source(id="list", kind="tessera", hash="c" * 64),
            Source(id="list/src.csv", kind="file", hash="a" * 64),
        ],
        types=[
            Type(
                name="Gem",
                kind="node",
                description=description,
                key_prop="tag",
                props='{"unit":"text"}',
            )
        ],
        nodes=[
            Node("Gem:G-1", "Gem", "G-1", props='{"unit":"V"}'),
            Node("Gem:G-2", "Gem", "G-2"),
        ],
        evidence=[
            Evidence("Gem:G-1", "list/src.csv", "row=1", "extracted", producer),
            Evidence("Gem:G-1", "list/src.csv", "row=1;tag", "extracted", producer, "tag"),
            Evidence("Gem:G-2", "list/src.csv", "row=2;tag", "extracted", producer, "tag"),
        ],
    )
    return seal(path, content).knowledge_hash


def test_evidence_on_the_key_property_is_carried_and_a_node_with_only_that_stays(
    tmp_path: Path, dist: Path
) -> None:
    source = tmp_path / "gems.mosaic"
    source_hash = keyed_source(source)
    settings = tmp_path / "view.yaml"
    settings.write_text("search: text\nexport:\n  types: [Gem]\n", encoding="utf-8")
    page = tmp_path / "out.html"
    assert main(["export", str(source), "--view", str(settings), "-o", str(page)]) == 0
    con = opened(tmp_path, carried(page))
    assert con.execute("SELECT id FROM node ORDER BY id").fetchall() == [
        ("Gem:G-1",),
        ("Gem:G-2",),
    ]
    rows = con.execute(
        "SELECT n.id, e.prop, e.locator, s.id, e.via FROM evidence e JOIN node n USING (nid)"
        " JOIN source s USING (sid) ORDER BY n.id, e.locator"
    ).fetchall()
    via = json.dumps([source_hash], separators=(",", ":"))
    assert rows == [
        ("Gem:G-1", None, "row=1", "gems/list/src.csv", via),
        ("Gem:G-1", "tag", "row=1;tag", "gems/list/src.csv", via),
        ("Gem:G-2", "tag", "row=2;tag", "gems/list/src.csv", via),
    ]


# Answer, Q5 Reading A: after Q3's rule, any leading `-` and `_` are dropped, and the name
# is `source` when nothing is left.


@pytest.mark.parametrize(
    ("file_name", "piece"),
    [
        ("_draft.mosaic", "draft"),
        ("-x.mosaic", "x"),
        (".hidden.mosaic", "hidden"),
        ("---.mosaic", "source"),
    ],
)
def test_a_name_that_cannot_start_a_piece_name_loses_its_leading_dashes_and_underscores(
    tmp_path: Path, dist: Path, file_name: str, piece: str
) -> None:
    source = tmp_path / file_name
    shutil.copyfile(MOSAIC, source)
    settings = tmp_path / "view.yaml"
    settings.write_text(ITEM_ONLY, encoding="utf-8")
    page = tmp_path / "out.html"
    assert main(["export", str(source), "--view", str(settings), "-o", str(page)]) == 0
    con = opened(tmp_path, carried(page))
    assert con.execute("SELECT id FROM source WHERE kind = 'mosaic'").fetchall() == [(piece,)]


# Answer, Q6 Reading A: a type description longer than 200 characters is cut to its
# first 200 code points, with no ellipsis and no trimming; the export is not refused.


def test_a_type_description_over_200_characters_keeps_its_first_200_code_points(
    tmp_path: Path, dist: Path
) -> None:
    description = " \U0001f600é" + "word " * 80  # starts with a space; astral and accented
    assert len(description) > 200
    source = tmp_path / "gems.mosaic"
    keyed_source(source, description)
    settings = tmp_path / "view.yaml"
    settings.write_text("search: text\nexport:\n  types: [Gem]\n", encoding="utf-8")
    page = tmp_path / "out.html"
    assert main(["export", str(source), "--view", str(settings), "-o", str(page)]) == 0
    con = opened(tmp_path, carried(page))
    (kept,) = con.execute("SELECT description FROM type WHERE name = 'Gem'").fetchone()
    assert kept == description[:200]
    assert len(kept) == 200 and kept.startswith(" \U0001f600") and kept.endswith(description[199])


READING = REPO / "conformance" / "reading"
CASES = json.loads((READING / "cases.json").read_text(encoding="utf-8"))
OPENS = sorted(name for name, case in CASES.items() if case["opens"])


def rows(data: bytes, sql: str, where: Path) -> list[tuple[Any, ...]]:
    path = where / f"read-{abs(hash((data, sql)))}.mosaic"
    path.write_bytes(data)
    con = sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)
    try:
        return [tuple(r) for r in con.execute(sql)]
    finally:
        con.close()


def types_line(names: list[str]) -> str:
    return "search: text\nexport:\n  types: [" + ", ".join(names) + "]\n"


def cut_types(
    tmp_path: Path, source: Path, names: list[str], out: str = "out.html"
) -> tuple[int, Path, Path]:
    """Run ``mosaic export SOURCE --view V -o OUT`` with ``export.types`` set to ``names``."""
    settings = tmp_path / "view.yaml"
    settings.write_text(types_line(names), encoding="utf-8")
    page = tmp_path / out
    return main(["export", str(source), "--view", str(settings), "-o", str(page)]), page, settings


# --- a source with enough in it to see what a cut keeps and what it drops --------------------


def build_source(
    directory: Path,
    *,
    keys: tuple[str, ...] = ("A", "B"),
    aliases: tuple[tuple[str, str], ...] = (("ay", "Sculpture:A"),),
    qualifiers: tuple[str, ...] = ("",),
    name: str = "src.mosaic",
) -> Path:
    """Sculptures, one Unit, one Museum; edges Sculpture-Unit, Sculpture-Museum, Unit-Museum.
    Trust all, evidence all, text full, vectors on (stub model)."""
    directory.mkdir(parents=True, exist_ok=True)
    sculptures = [node(f"Sculpture:{k}", k, label=f"L{k}", summary=f"S{k}", w=1) for k in keys]
    nodes = [*sculptures, node("Unit:U", "U", label="Unit"), node("Museum:P", "P", label="Museum")]
    edges = [
        Edge("r_unit", f"Sculpture:{keys[0]}", "Unit:U", q, props='{"w":3}') for q in qualifiers
    ]
    edges += [
        Edge("r_plant", f"Sculpture:{keys[0]}", "Museum:P"),
        Edge("r_up", "Unit:U", "Museum:P"),
    ]
    ev = [evidence(n.id, f"row={i}", snippet=f"about {n.key}") for i, n in enumerate(nodes)]
    ev.append(
        evidence(
            f"Sculpture:{keys[0]}",
            "row=0;field=label",
            prop="label",
            method="inferred",
            confidence=0.7,
        )
    )
    ev += [evidence(e.key, f"edge={i}", snippet=f"edge {i}") for i, e in enumerate(edges)]
    piece = directory / "list.tessera"
    tessera(
        piece,
        nodes,
        edges=edges,
        evidence=ev,
        aliases=[Alias(text, node_id, "source") for text, node_id in aliases],
        external_refs=[
            ExternalRef("Sculpture:A", "hist", "ts", '{"s":"A"}', "src.csv"),
            ExternalRef("Museum:P", "hist", "ts", '{"s":"P"}', "src.csv"),
        ]
        if "A" in keys
        else [],
        text="about the sculptures\n",
        notice="CC0-1.0",
        declared={"Sculpture": {"w": "integer"}},
    )
    with open_sealed(piece) as sealed:
        listed = f"list@{sealed.knowledge_hash}"

    def kind(t: str) -> dict[str, Any]:
        fields = {"k": "key", "label": "label", "summary": "summary", "w": "w"}
        return {"key": "k", "describe": f"The {t}s", "from": {f"list.{t}": fields}}

    types = {t: kind(t) for t in ("Sculpture", "Unit", "Museum")}
    edge_types = {
        "r_unit": {"from": "Sculpture", "to": "Unit", "map": ["list.r_unit"]},
        "r_plant": {"from": "Sculpture", "to": "Museum", "map": ["list.r_plant"]},
        "r_up": {"from": "Unit", "to": "Museum", "map": ["list.r_up"]},
    }
    mosaics = {"t": {"trust": "all", "text": "full", "evidence": "all"}}
    built = build(
        pattern(directory, [listed], types, edge_types, mosaics),
        "t",
        directory / name,
        pieces=[piece],
        model=StubModel(),
    )
    return built.path


def query(path: Path, sql: str) -> list[tuple[Any, ...]]:
    with open_sealed(path) as sealed:
        return [tuple(r) for r in sealed.query(sql)]


NODES = "SELECT id, type, key, label, summary, props FROM node ORDER BY id"
EVIDENCE = (
    "SELECT coalesce(n.id, e.type || ' ' || a.id || ' ' || b.id || ' ' || e.qualifier),"
    " v.prop, v.locator, v.method, v.producer, v.confidence,"
    " (SELECT text FROM snippet WHERE evid = v.evid)"
    " FROM evidence v LEFT JOIN node n ON n.nid = v.nid LEFT JOIN edge e ON e.eid = v.eid"
    " LEFT JOIN node a ON a.nid = e.src LEFT JOIN node b ON b.nid = e.dst"
    " ORDER BY 1, 2, 3"
)


@pytest.fixture
def exported(tmp_path: Path, dist: Path) -> tuple[Path, Path]:
    """The source and the cut (Sculpture and Unit) written beside each other."""
    source = build_source(tmp_path / "in")
    code, page, _ = cut_types(tmp_path, source, ["Sculpture", "Unit"])
    assert code == 0
    out = tmp_path / "cut.mosaic"
    out.write_bytes(carried(page))
    return source, out


# --- what the cut keeps of the carried types (section 5.4, 7.1) -------------------------------


def test_carried_nodes_keep_every_field_of_the_source(exported: tuple[Path, Path]) -> None:
    # Section 3.4, 7.1 step 2: ids, keys, labels, summaries and props of the carried types.
    source, out = exported
    kept = [r for r in query(source, NODES) if r[1] in ("Sculpture", "Unit")]
    assert query(out, NODES) == kept


def test_an_edge_with_an_end_outside_the_types_is_dropped_with_its_evidence_and_counts(
    exported: tuple[Path, Path],
) -> None:
    # Section 5.4: edges are kept when both ends are. Sculpture-Museum and Unit-Museum go.
    _, out = exported
    assert query(out, "SELECT type FROM v_edge ORDER BY type") == [("r_unit",)]
    assert query(out, "SELECT count(*) FROM evidence WHERE eid IS NOT NULL") == [(1,)]
    assert query(out, "SELECT type, direction, count FROM link_count ORDER BY 1, 2") == [
        ("r_unit", "in", 1),
        ("r_unit", "out", 1),
    ]


def test_edge_props_survive_the_cut(exported: tuple[Path, Path]) -> None:
    # Section 3.4, 7.1 step 5: an edge's props are kept as they are.
    _, out = exported
    assert query(out, "SELECT props FROM edge") == [('{"w":3}',)]


def test_every_evidence_row_of_a_carried_fact_is_kept_with_its_method_and_snippet(
    exported: tuple[Path, Path],
) -> None:
    # Section 3.5: an inferred row keeps its confidence; locators, producers and snippets stay.
    source, out = exported
    ends = ("Museum:P", "r_plant", "r_up")
    wanted = [r for r in query(source, EVIDENCE) if not any(e in str(r[0]) for e in ends)]
    assert query(out, EVIDENCE) == wanted
    assert any(r[3] == "inferred" and r[5] == 0.7 for r in wanted)


def test_declared_types_follow_the_scope_with_their_key_prop_and_property_kinds(
    exported: tuple[Path, Path],
) -> None:
    # Section 7.1 step 7: node types in scope and edge types with both ends in scope.
    source, out = exported
    sql = "SELECT name, kind, key_prop, from_type, to_type, props FROM type ORDER BY name"
    wanted = [r for r in query(source, sql) if r[0] in ("Sculpture", "Unit", "r_unit")]
    assert query(out, sql) == wanted
    assert [r[0] for r in wanted] == ["Sculpture", "Unit", "r_unit"]


def test_external_references_follow_their_nodes(exported: tuple[Path, Path]) -> None:
    # Section 3.10: the reference of a carried node stays, the one of a dropped node goes.
    _, out = exported
    assert query(
        out, "SELECT n.id, x.system, x.kind, x.locator FROM external_ref x JOIN node n USING (nid)"
    ) == [("Sculpture:A", "hist", "ts", '{"s":"A"}')]


def test_a_carried_node_keeps_its_aliases_and_its_old_id_is_one_too(
    exported: tuple[Path, Path],
) -> None:
    # Section 7.1 step 2: a mosaic piece's old id becomes an alias with origin pattern.
    _, out = exported
    sql = "SELECT a.text, a.origin FROM alias a JOIN node n USING (nid) WHERE n.id = 'Sculpture:A'"
    assert sorted(query(out, sql)) == [("Sculpture:A", "pattern"), ("ay", "source")]


def test_notices_and_original_sources_of_the_piece_are_all_copied(
    exported: tuple[Path, Path],
) -> None:
    # Section 3.2 and invariant 15: every original source of the piece, with its hash and notice,
    # prefixed by the piece name; the piece's own rows of kind tessera or mosaic are not copied.
    source, out = exported
    src_hash = open_sealed(source).knowledge_hash
    assert query(out, "SELECT id, kind, hash, notice FROM source ORDER BY id") == [
        ("src", "mosaic", src_hash, None),
        ("src/list/src.csv", "file", "a" * 64, "CC0-1.0"),
    ]


def test_without_vectors_in_the_page_the_cut_has_none_and_says_so(
    exported: tuple[Path, Path],
) -> None:
    # Section 3.3 and 3.7: vector_hash and embed_model are NULL when there are no vectors.
    source, out = exported
    assert query(source, "SELECT count(*) FROM vector") == [(4,)]
    assert query(out, "SELECT count(*) FROM vector") == [(0,)]
    assert query(out, "SELECT vector_hash, embed_model FROM header") == [(None, None)]


# --- types the source declares but holds no rows for (section 7.1 step 7) ---------------------


def sparse_source(directory: Path) -> Path:
    """A mosaic that declares Spare and links (Item to Spare) without a row of either."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "sparse.mosaic"
    mosaic(
        path,
        Content(
            header=Header(kind="mosaic", producer="t/1", pattern_hash="c" * 64, target="t"),
            sources=[
                Source(id="p", kind="tessera", hash="d" * 64),
                Source(id="p/s.csv", kind="file", hash="e" * 64, notice="n"),
            ],
            types=[
                Type(name="Item", kind="node", key_prop="k"),
                Type(name="Spare", kind="node", key_prop="k"),
                Type(name="links", kind="edge", from_type="Item", to_type="Spare"),
            ],
            nodes=[node("Item:1", "1", label="One")],
            evidence=[evidence("Item:1", "row=1", source="p/s.csv")],
        ),
    )
    return path


@pytest.mark.parametrize(
    ("names", "declared"),
    [
        (["Item", "Spare"], ["Item", "Spare", "links"]),
        (["Item"], ["Item"]),
        (["Spare"], ["Spare"]),
    ],
)
def test_a_declared_type_with_no_rows_is_in_scope_and_declared_with_its_edges(
    tmp_path: Path, dist: Path, names: list[str], declared: list[str]
) -> None:
    code, page, _ = cut_types(tmp_path, sparse_source(tmp_path / "in"), names)
    assert code == 0
    out = tmp_path / "cut.mosaic"
    out.write_bytes(carried(page))
    assert [r[0] for r in query(out, "SELECT name FROM type ORDER BY name")] == sorted(declared)
    assert list(check_file(out).violations) == []


def test_a_cut_to_a_type_with_no_nodes_is_an_empty_mosaic_that_opens(
    tmp_path: Path, dist: Path
) -> None:
    code, page, _ = cut_types(tmp_path, sparse_source(tmp_path / "in"), ["Spare"])
    assert code == 0
    out = tmp_path / "cut.mosaic"
    out.write_bytes(carried(page))
    assert query(out, "SELECT count(*) FROM node") == [(0,)]
    assert query(out, "SELECT count(*) FROM evidence") == [(0,)]
    with open_sealed(out) as sealed:
        assert sealed.kind == "mosaic"


# --- order, names and bytes (sections 3.6, 5.1; principle 5) ---------------------------------


def test_a_cut_of_a_cut_chains_the_source_hashes_innermost_first(
    tmp_path: Path, dist: Path
) -> None:
    # Section 3.5: via lists the hashes of the mosaics the evidence passed through, innermost
    # first, so its last hash is a mosaic piece of this file.
    source = build_source(tmp_path / "in")
    code, page, _ = cut_types(tmp_path, source, ["Sculpture", "Unit"], "one.html")
    assert code == 0
    first = tmp_path / "second.mosaic"
    first.write_bytes(carried(page))
    first_hash = open_sealed(first).knowledge_hash
    code, page, _ = cut_types(tmp_path, first, ["Sculpture"], "two.html")
    assert code == 0
    out = tmp_path / "third.mosaic"
    out.write_bytes(carried(page))
    source_hash = open_sealed(source).knowledge_hash
    vias = {tuple(json.loads(r[0])) for r in query(out, "SELECT via FROM evidence")}
    assert vias == {(source_hash, first_hash)}
    assert query(out, "SELECT id, kind, hash FROM source WHERE kind = 'mosaic'") == [
        ("second", "mosaic", first_hash)
    ]
    assert query(out, "SELECT id FROM source WHERE kind = 'file'") == [("second/src/list/src.csv",)]
    assert list(check_file(out).violations) == []


# --- a tessera is cut the same way (same rule as for a mosaic) -----------------


def test_a_tessera_with_export_types_is_a_piece_of_kind_tessera_without_via(
    tmp_path: Path, dist: Path
) -> None:
    # Section 3.2: a piece is a tessera or a mosaic; section 3.5: no via for evidence that came
    # straight from a tessera.
    source = tmp_path / "t.tessera"
    tessera(
        source,
        [node("Row:a", "a", label="A"), node("Row:b", "b")],
        key_props={"Row": "k"},
    )
    names = ["Row"]
    code, page, _ = cut_types(tmp_path, source, names)
    assert code == 0
    out = tmp_path / "cut.mosaic"
    out.write_bytes(carried(page))
    assert query(out, "SELECT id, kind, hash FROM source WHERE kind IN ('tessera', 'mosaic')") == [
        ("t", "tessera", open_sealed(source).knowledge_hash)
    ]
    assert query(out, "SELECT count(*) FROM evidence WHERE via IS NOT NULL") == [(0,)]
    assert list(check_file(out).violations) == []


# --- sources the reading rules accept or refuse ---------------------------------------------


@pytest.mark.parametrize("name", [n for n in OPENS if n != "tessera.tessera"])
def test_every_file_that_opens_can_be_cut_to_all_its_types(
    tmp_path: Path, dist: Path, name: str
) -> None:
    # Section 3.8: a file that opens is exported; the cut opens by the same rules.
    source = tmp_path / name
    shutil.copyfile(READING / name, source)
    names = [r[0] for r in query(source, "SELECT name FROM type WHERE kind = 'node' ORDER BY name")]
    code, page, _ = cut_types(tmp_path, source, names)
    assert code == 0
    out = tmp_path / "cut.mosaic"
    out.write_bytes(carried(page))
    assert query(out, "SELECT id FROM node ORDER BY id") == query(
        source, "SELECT id FROM node ORDER BY id"
    )
    assert list(check_file(out).violations) == []
    assert open_sealed(out).knowledge_hash != open_sealed(source).knowledge_hash


# --- size ------------------------------------------------------------------------------------


PRODUCER = "test-builder/0.1"
HEX64 = re.compile(r"[0-9a-f]{64}")


def export_with(
    tmp_path: Path, source: Path, text: str | bytes, out: str = "out.html"
) -> tuple[int, Path, Path]:
    settings = tmp_path / "view.yaml"
    if isinstance(text, bytes):
        settings.write_bytes(text)
    else:
        settings.write_text(text, encoding="utf-8")
    page = tmp_path / out
    return main(["export", str(source), "--view", str(settings), "-o", str(page)]), page, settings


def cut_bytes(tmp_path: Path, source: Path, text: str | bytes, out: str = "out.html") -> bytes:
    code, page, _ = export_with(tmp_path, source, text, out)
    assert code == 0
    return carried(page)


def written(tmp_path: Path, data: bytes, name: str = "cut.mosaic") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


# --- a source with awkward keys, text, aliases of every origin and a self edge ----------------

DISC_DESCRIPTION = chr(0x1D49C) * 200  # 200 characters: 800 bytes in UTF-8, 400 UTF-16 units
LONG_SNIPPET = ("é" + chr(0x1F600)) * 20000
KEYS = (" pad ", "pad", "A", "a", "007", "é", "é")
GEM_PROPS = '{"extra":"x","j":{"a":null,"b":[1,2]},"n":1}'


def crafted(path: Path, *, disc_description: str | None = DISC_DESCRIPTION) -> Path:
    gems = [Node(f"Gem:{k}", "Gem", k, label=f"L {k}", props=GEM_PROPS) for k in KEYS]
    nodes = [*gems, Node("Disc:d1", "Disc", "d1", summary="a disc")]
    edges = [
        Edge("follows", "Gem:A", "Gem:a"),
        Edge("follows", "Gem:a", "Gem:a", "again"),
        Edge("reads", "Gem:A", "Disc:d1"),
    ]

    def ev(subject: str | EdgeKey, i: int, snippet: str | None = None) -> Evidence:
        return Evidence(subject, "list/src.csv", f"row={i}", "extracted", PRODUCER, snippet=snippet)

    evidence = [
        ev(n.id, i, LONG_SNIPPET if n.key == "A" else f"about {n.key}") for i, n in enumerate(nodes)
    ]
    evidence += [
        ev(EdgeKey(e.src, e.type, e.dst, e.qualifier), 100 + i) for i, e in enumerate(edges)
    ]
    content = Content(
        header=Header(kind="mosaic", producer=PRODUCER, pattern_hash="b" * 64, target="t"),
        sources=[
            Source(id="list", kind="tessera", hash="c" * 64),
            Source(id="list/src.csv", kind="file", hash="a" * 64, notice="CC0-1.0"),
        ],
        types=[
            Type("Disc", "node", disc_description, key_prop="tag"),
            Type("Gem", "node", None, key_prop="tag", props='{"j":"json","n":"integer"}'),
            Type("follows", "edge", None, from_type="Gem", to_type="Gem"),
            Type("reads", "edge", "Gems read discs", from_type="Gem", to_type="Disc"),
        ],
        nodes=nodes,
        edges=edges,
        aliases=[
            Alias("alpha", "Gem:A", "source"),
            Alias("Beta", "Gem:A", "pattern"),
            Alias("gamma", "Gem:A", "proposal"),
        ],
        evidence=evidence,
    )
    seal(path, content)
    assert list(check_file(path).violations) == []
    return path


@pytest.fixture
def weird(tmp_path: Path) -> Path:
    (tmp_path / "in").mkdir()
    return crafted(tmp_path / "in" / "weird.mosaic")


GEM_ONLY = "search: text\nexport:\n  types: [Gem]\n"


# --- what the cut says about itself (Q1: it is a build) ---------------------------------------


def test_a_type_description_of_200_characters_is_carried_and_none_stays_null(
    tmp_path: Path, dist: Path, weird: Path
) -> None:
    # Section 5.2: describe is at most 200 characters, counted as characters and not as bytes or
    # UTF-16 units; section 7.1 step 7: the description is NULL when there is none.
    both = "search: text\nexport:\n  types: [Disc, Gem]\n"
    out = written(tmp_path, cut_bytes(tmp_path, weird, both))
    assert query(out, "SELECT name, description FROM type ORDER BY name") == [
        ("Disc", DISC_DESCRIPTION),
        ("Gem", None),
        ("follows", None),
        ("reads", "Gems read discs"),
    ]
    assert list(check_file(out).violations) == []


def header(path: Path) -> tuple[Any, ...]:
    return query(path, "SELECT kind, target, pattern_hash, knowledge_hash FROM header")[0]


def test_the_cut_is_a_mosaic_with_a_pattern_hash_and_a_target(
    tmp_path: Path, dist: Path, weird: Path
) -> None:
    # Section 3.3: a mosaic's header has a pattern_hash (64 hex) and a target. Section 5.6: no piece
    # has the name of a target of the same pattern, which the piece-name rule of Q3 relies on.
    out = written(tmp_path, cut_bytes(tmp_path, weird, GEM_ONLY))
    kind, target, pattern_hash, knowledge = header(out)
    assert kind == "mosaic"
    assert target == "export"
    assert HEX64.fullmatch(pattern_hash) and HEX64.fullmatch(knowledge)
    assert pattern_hash != header(weird)[2]


# --- the piece name, character by character (Q3) ----------------------------------------------


def test_a_tessera_type_without_a_key_property_is_an_error_naming_it_or_a_cut_that_passes(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Section 5.2: "without one, the key is the piece node's key"; a mosaic needs a key_prop on
    # every node type (section 3.9). The spec does not decide what the cut's key_prop is for a
    # tessera type that has none (reported as a gap). Either way: no crash, nothing half written.
    source = tmp_path / "t.tessera"
    tessera(source, [node("Row:a", "a", label="A")])
    code, page, _ = export_with(tmp_path, source, "search: text\nexport:\n  types: [Row]\n")
    err = capsys.readouterr().err
    assert "Traceback" not in err
    if code == 0:
        out = written(tmp_path, carried(page))
        assert list(check_file(out).violations) == []
        assert query(out, "SELECT id FROM node") == [("Row:a",)]
    else:
        assert code == 1 and "Row" in err
        assert not page.exists()


# --- the text tier of the source is the tier of the cut (section 5.4) -------------------------


def text_source(directory: Path, tier: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    nodes = [node("Sculpture:A", "A", label="LA"), node("Unit:U", "U", label="Unit")]
    from mosaic_format.writer import Evidence as Row

    ev = [
        Row("Sculpture:A", "src.csv", "row=0", "extracted", PRODUCER, snippet="about A"),
        Row("Unit:U", "src.csv", "row=1", "extracted", PRODUCER, snippet="about U"),
    ]
    piece = directory / "list.tessera"
    tessera(piece, nodes, evidence=ev, text="the whole table\n", key_props={"Sculpture": "k"})
    with open_sealed(piece) as sealed:
        listed = f"list@{sealed.knowledge_hash}"
    types = {
        t: {"key": "k", "from": {f"list.{t}": {"k": "key", "label": "label"}}}
        for t in ("Sculpture", "Unit")
    }
    mosaics = {"t": {"trust": "all", "text": tier, "evidence": "all", "vectors": False}}
    from mosaic_build.mosaic import build

    return build(
        pattern(directory, [listed], types, {}, mosaics),
        "t",
        directory / f"{tier}.mosaic",
        pieces=[piece],
        model=StubModel(),
    ).path


@pytest.mark.parametrize("tier", ["none", "snippets", "full"])
def test_a_cut_of_every_type_keeps_the_text_the_source_holds_and_adds_none(
    tmp_path: Path, dist: Path, tier: str
) -> None:
    source = text_source(tmp_path / "in", tier)
    out = written(
        tmp_path, cut_bytes(tmp_path, source, "search: text\nexport:\n  types: [Sculpture, Unit]\n")
    )
    counts = "SELECT (SELECT count(*) FROM snippet), (SELECT count(*) FROM source_text)"
    assert query(source, counts) == {"none": [(0, 0)], "snippets": [(2, 0)], "full": [(2, 1)]}[tier]
    assert query(out, counts) == query(source, counts)
    assert list(check_file(out).violations) == []


def test_the_text_of_a_cut_is_the_text_of_its_nodes_only(tmp_path: Path, dist: Path) -> None:
    # Section 5.4 (text: snippets): "the passage behind each evidence row"; a dropped node takes its
    # evidence and its snippets with it.
    source = text_source(tmp_path / "in", "snippets")
    out = written(tmp_path, cut_bytes(tmp_path, source, "search: text\nexport:\n  types: [Unit]\n"))
    assert query(out, "SELECT text FROM snippet") == [("about U",)]


# --- the vector layer of a cut (slow: the real model of section 6) ----------------------------


@pytest.mark.slow
def test_a_semantic_cut_has_the_knowledge_of_the_text_cut_and_its_own_vectors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Sections 3.6 and 3.7: the knowledge hash does not cover vectors, so a cut made with
    # `search: semantic` and one made with `search: text` from the same file have the same
    # knowledge hash; the first adds one vector per carried node, made with the model of section 6
    # (embed_model), and its vector hash is the same on a second run (principle 5).
    from tests.conftest import MODEL, REPO

    monkeypatch.setattr(view, "VIEWER_DIST", REPO / "viewer" / "dist")
    if not (MODEL / "tokenizer.json").is_file():
        pytest.skip("the model is not fetched: uv run python scripts/fetch_model.py")
    if not (REPO / "viewer" / "dist" / "index.html").is_file():
        pytest.skip("the viewer is not built: bun run build")
    source = tmp_path / "in" / "weird.mosaic"
    source.parent.mkdir()
    crafted(source)
    plain = written(tmp_path, cut_bytes(tmp_path, source, GEM_ONLY, "t.html"), "text.mosaic")
    semantic_view = "search: semantic\nexport:\n  types: [Gem]\n"
    runs = []
    for i in range(2):
        page = tmp_path / f"s{i}.html"
        settings = tmp_path / "semantic.yaml"
        settings.write_text(semantic_view, encoding="utf-8")
        args = ["export", str(source), "--view", str(settings), "--model", str(MODEL)]
        assert main([*args, "-o", str(page)]) == 0
        runs.append(written(tmp_path, carried(page), f"semantic{i}.mosaic"))
    one, two = runs
    assert open_sealed(one).knowledge_hash == open_sealed(plain).knowledge_hash
    assert open_sealed(one).vector_hash == open_sealed(two).vector_hash is not None
    assert query(plain, "SELECT vector_hash, embed_model FROM header") == [(None, None)]
    embed = (
        "snowflake-arctic-embed-xs@e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1"
    )
    assert query(one, "SELECT embed_model FROM header") == [(embed,)]
    assert query(one, "SELECT (SELECT count(*) FROM vector), (SELECT count(*) FROM node)") == [
        (7, 7)
    ]
    vector_hash = open_sealed(one).vector_hash or ""
    print(
        f"\nsemantic cut: knowledge {open_sealed(one).knowledge_hash[:12]}"
        f" vector {vector_hash[:12]}"
    )
    assert list(check_file(one).violations) == []
