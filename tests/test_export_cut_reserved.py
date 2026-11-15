"""A cut refuses a property it cannot carry.

The cut is a
build, and in a field map a value ``key``, ``label`` or ``summary`` names that
column of the piece node, never a property of that name (section 5.2, section 7.1 step 3). So a
property with one of those names cannot be carried as itself. So ``mosaic export``
refuses such a cut, as it refuses a type the mosaic lacks: exit 1, naming the
view file, the line, the type and the property, and nothing written. The key property is not one
of them: its value is carried as the node's key.
"""

import base64
import gzip
import json
import re
import sqlite3
from pathlib import Path

import pytest
from mosaic_build import view
from mosaic_build.cli import main
from mosaic_format import knowledge_hash, seal
from mosaic_format.writer import Content, Edge, Evidence, Header, Node, Source, Type

PRODUCER = "test/1"


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


def source(path: Path, gem_props: str | None, gem_declared: str = '{"unit":"text"}') -> Path:
    """Gem (key property ``tag``) and Disc (key property ``code``), one node each."""
    seal(
        path,
        Content(
            header=Header(kind="mosaic", producer=PRODUCER, pattern_hash="b" * 64, target="t"),
            sources=[
                Source(id="list", kind="tessera", hash="c" * 64),
                Source(id="list/src.csv", kind="file", hash="a" * 64),
            ],
            types=[
                Type(name="Disc", kind="node", key_prop="code", props='{"size":"integer"}'),
                Type(name="Gem", kind="node", key_prop="tag", props=gem_declared),
            ],
            nodes=[
                Node("Disc:D-1", "Disc", "D-1", label="Disc one", props='{"size":2}'),
                Node("Gem:G-1", "Gem", "G-1", label="Gem one", props=gem_props),
            ],
            evidence=[
                Evidence("Disc:D-1", "list/src.csv", "row=1", "extracted", PRODUCER),
                Evidence("Gem:G-1", "list/src.csv", "row=2", "extracted", PRODUCER),
            ],
        ),
    )
    return path


def export(tmp_path: Path, mosaic: Path, view_text: str) -> tuple[int, Path, Path]:
    settings = tmp_path / "view.yaml"
    settings.write_text(view_text, encoding="utf-8")
    page = tmp_path / "out.html"
    return main(["export", str(mosaic), "--view", str(settings), "-o", str(page)]), page, settings


GEM = "search: text\nexport:\n  types: [Gem]\n"


@pytest.mark.parametrize(
    ("props", "declared", "named"),
    [
        ('{"key":"K-99","unit":"V"}', '{"key":"text","unit":"text"}', "key"),
        ('{"label":"prop label","unit":"V"}', '{"unit":"text"}', "label"),
        ('{"summary":"prop summary"}', '{"unit":"text"}', "summary"),
        ('{"unit":"V"}', '{"label":"text","unit":"text"}', "label"),  # declared, held by none
        (None, '{"key":"json"}', "key"),
    ],
    ids=[
        "held-key",
        "held-label",
        "held-summary",
        "declared-label",
        "declared-key",
    ],
)
def test_a_property_the_cut_cannot_carry_is_an_error_naming_the_file_line_type_and_property(
    tmp_path: Path,
    dist: Path,
    capsys: pytest.CaptureFixture[str],
    props: str | None,
    declared: str,
    named: str,
) -> None:
    mosaic = source(tmp_path / "gems.mosaic", props, declared)
    before = mosaic.read_bytes()
    code, page, settings = export(tmp_path, mosaic, GEM)
    assert code == 1
    assert capsys.readouterr().err == (
        f"mosaic export: {settings}:3: view file: export.types: node type Gem has a property "
        f"named {named}, which a cut cannot carry\n"
    )
    assert not page.exists()
    assert mosaic.read_bytes() == before  # principle 8
    assert sorted(p.name for p in tmp_path.iterdir()) == ["dist", "gems.mosaic", "view.yaml"]


def test_the_line_is_that_of_the_type_in_the_list(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mosaic = source(tmp_path / "gems.mosaic", '{"label":"x"}')
    text = "search: text\nexport:\n  types:\n    - Disc\n    - Gem\n"
    code, _, settings = export(tmp_path, mosaic, text)
    assert code == 1
    assert capsys.readouterr().err.startswith(
        f"mosaic export: {settings}:5: view file: export.types: node type Gem has a property"
    )


def test_of_several_such_properties_the_first_by_utf8_bytes_is_named(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mosaic = source(tmp_path / "gems.mosaic", '{"summary":"s","key":"k","label":"l"}')
    code, _, _ = export(tmp_path, mosaic, GEM)
    assert code == 1
    # key < label < summary by UTF-8 bytes, whatever the order the node holds them in.
    assert capsys.readouterr().err.endswith("has a property named key, which a cut cannot carry\n")


def test_a_type_the_cut_does_not_carry_may_hold_such_a_property(tmp_path: Path, dist: Path) -> None:
    mosaic = source(tmp_path / "gems.mosaic", '{"label":"prop label","key":"K"}')
    code, page, _ = export(tmp_path, mosaic, "search: text\nexport:\n  types: [Disc]\n")
    assert code == 0 and page.exists()


def test_without_export_types_such_a_mosaic_is_exported_as_it_is(
    tmp_path: Path, dist: Path
) -> None:
    mosaic = source(tmp_path / "gems.mosaic", '{"label":"prop label","key":"K"}')
    code, page, _ = export(tmp_path, mosaic, "search: text\n")
    assert code == 0 and page.exists()


def test_a_property_named_like_a_column_in_another_case_is_carried(
    tmp_path: Path, dist: Path
) -> None:
    # Names compare by UTF-8 bytes: `Label` is not the column `label`, so it is carried.
    mosaic = source(tmp_path / "gems.mosaic", '{"Label":"kept","unit":"V"}')
    code, page, _ = export(tmp_path, mosaic, GEM)
    assert code == 0
    found = re.search(r'id="mosaic-export">(.*?)</script>', page.read_text(encoding="utf-8"))
    assert found
    carried = tmp_path / "cut.mosaic"
    carried.write_bytes(gzip.decompress(base64.b64decode(json.loads(found.group(1))["mosaic"])))
    con = sqlite3.connect(f"{carried.as_uri()}?mode=ro&immutable=1", uri=True)
    assert con.execute("SELECT props FROM node").fetchone() == ('{"Label":"kept","unit":"V"}',)


@pytest.mark.parametrize(
    ("name", "shown"),
    [
        ("label ", '"label "'),
        (" key", '" key"'),
        ("kéy", '"kéy"'),
        ("a-b", '"a-b"'),
        ("2x", '"2x"'),
    ],
)
def test_a_property_name_a_pattern_cannot_hold_is_refused_the_same_way(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str], name: str, shown: str
) -> None:
    # A pattern names a property by letters, digits and `_` only (pattern.schema.json), so the
    # cut cannot carry this one either; the name is shown as JSON text, since it is not plain.
    mosaic = source(tmp_path / "gems.mosaic", json.dumps({name: "v", "unit": "V"}))
    code, page, settings = export(tmp_path, mosaic, GEM)
    assert code == 1
    assert capsys.readouterr().err == (
        f"mosaic export: {settings}:3: view file: export.types: node type Gem has a property "
        f"named {shown}, which a cut cannot carry\n"
    )
    assert not page.exists()


# Answer, Reading A: a node that holds its key property in props with a value other than its
# key is refused too; held with the key's own value (a number as its canonical JSON text, section
# 5.2), or only declared, it is carried as the key.


@pytest.mark.parametrize(
    ("node_key", "held"),
    [("G-1", '"OTHER"'), ("G-1", '"g-1"'), ("2", "2.5"), ("G-1", "null"), ("G-1", "true")],
)
def test_a_key_property_held_with_another_value_is_refused(
    tmp_path: Path,
    dist: Path,
    capsys: pytest.CaptureFixture[str],
    node_key: str,
    held: str,
) -> None:
    mosaic = keyed(tmp_path / "gems.mosaic", node_key, f'{{"tag":{held},"unit":"V"}}')
    code, page, settings = export(tmp_path, mosaic, GEM)
    assert code == 1
    assert capsys.readouterr().err == (
        f"mosaic export: {settings}:3: view file: export.types: node type Gem has a property "
        "named tag, which a cut cannot carry\n"
    )
    assert not page.exists()


@pytest.mark.parametrize(("node_key", "held"), [("G-1", '"G-1"'), ("2", "2"), ("2.5", "2.5")])
def test_a_key_property_held_with_the_key_s_own_value_is_carried_as_the_key(
    tmp_path: Path, dist: Path, node_key: str, held: str
) -> None:
    mosaic = keyed(tmp_path / "gems.mosaic", node_key, f'{{"tag":{held},"unit":"V"}}')
    code, page, _ = export(tmp_path, mosaic, GEM)
    assert code == 0 and page.exists()


def keyed(path: Path, node_key: str, props: str) -> Path:
    """Gem (key property ``tag``) with one node of key ``node_key`` holding ``props``."""
    seal(
        path,
        Content(
            header=Header(kind="mosaic", producer=PRODUCER, pattern_hash="b" * 64, target="t"),
            sources=[
                Source(id="list", kind="tessera", hash="c" * 64),
                Source(id="list/src.csv", kind="file", hash="a" * 64),
            ],
            types=[Type(name="Gem", kind="node", key_prop="tag", props='{"unit":"text"}')],
            nodes=[Node(f"Gem:{node_key}", "Gem", node_key, props=props)],
            evidence=[Evidence(f"Gem:{node_key}", "list/src.csv", "row=1", "extracted", PRODUCER)],
        ),
    )
    return path


@pytest.mark.parametrize("held", ["9007199254740993", "1e400"])
def test_a_crafted_key_property_value_outside_i_json_is_refused_not_a_crash(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str], held: str
) -> None:
    # Section 3.1: such a number cannot be written, but a crafted file can hold it with matching
    # hashes; it can never be the key (section 5.2), so the cut is refused like any other value.
    mosaic = keyed(tmp_path / "gems.mosaic", "G-1", '{"tag":"x"}')
    con = sqlite3.connect(mosaic, isolation_level=None)
    try:
        con.execute("UPDATE node SET props = ?", (f'{{"tag":{held}}}',))
        con.execute("UPDATE header SET knowledge_hash = ?", (knowledge_hash(con),))
    finally:
        con.close()
    code, page, _ = export(tmp_path, mosaic, GEM)
    assert code == 1
    assert capsys.readouterr().err.endswith("has a property named tag, which a cut cannot carry\n")
    assert not page.exists()


PAGE_DATA = re.compile(r'id="mosaic-export">(.*?)</script>')
REFUSAL = "has a property named {}, which a cut cannot carry"


def seal_source(
    path: Path,
    *,
    gem_nodes: list[str | None],
    gem_declared: str = '{"unit":"text"}',
    disc_nodes: list[str | None] | None = None,
    disc_declared: str = '{"size":"integer"}',
    edge_declared: str = '{"w":"integer"}',
    edge_props: str | None = '{"w":1}',
) -> Path:
    """Gem (key property ``tag``) and Disc (key property ``code``), plus a Gem-Disc edge."""
    discs = disc_nodes if disc_nodes is not None else [None]
    gems = [
        Node(f"Gem:G-{i}", "Gem", f"G-{i}", label=f"Gem {i}", props=p)
        for i, p in enumerate(gem_nodes)
    ]
    disc_rows = [
        Node(f"Disc:D-{i}", "Disc", f"D-{i}", label=f"Disc {i}", props=p)
        for i, p in enumerate(discs)
    ]
    edge = Edge("reads", gems[0].id, disc_rows[0].id, props=edge_props)
    seal(
        path,
        Content(
            header=Header(kind="mosaic", producer=PRODUCER, pattern_hash="b" * 64, target="t"),
            sources=[
                Source(id="list", kind="tessera", hash="c" * 64),
                Source(id="list/src.csv", kind="file", hash="a" * 64),
            ],
            types=[
                Type(name="Disc", kind="node", key_prop="code", props=disc_declared),
                Type(name="Gem", kind="node", key_prop="tag", props=gem_declared),
                Type(
                    name="reads",
                    kind="edge",
                    from_type="Gem",
                    to_type="Disc",
                    props=edge_declared,
                ),
            ],
            nodes=[*gems, *disc_rows],
            edges=[edge],
            evidence=[
                *(
                    Evidence(n.id, "list/src.csv", f"row={i}", "extracted", PRODUCER)
                    for i, n in enumerate([*gems, *disc_rows])
                ),
                Evidence(edge.key, "list/src.csv", "edge=1", "extracted", PRODUCER),
            ],
        ),
    )
    return path


def export_types(tmp_path: Path, mosaic: Path, types: str) -> tuple[int, Path, Path]:
    settings = tmp_path / "view.yaml"
    settings.write_text(f"search: text\nexport:\n  types: {types}\n", encoding="utf-8")
    page = tmp_path / "out.html"
    return main(["export", str(mosaic), "--view", str(settings), "-o", str(page)]), page, settings


def carried_rows(page: Path, sql: str, where: Path) -> list[tuple[object, ...]]:
    found = PAGE_DATA.search(page.read_text(encoding="utf-8"))
    assert found
    data = gzip.decompress(base64.b64decode(json.loads(found.group(1))["mosaic"]))
    path = where / "carried.mosaic"
    path.write_bytes(data)
    con = sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)
    try:
        return [tuple(r) for r in con.execute(sql)]
    finally:
        con.close()


def untouched(tmp_path: Path) -> list[str]:
    return sorted(p.name for p in tmp_path.iterdir())


# --- every node is looked at -------------------------------------------------------------------


def test_a_property_held_only_by_the_last_node_is_found(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Section 5.2: the rule is about the type's properties, not about its first node.
    nodes: list[str | None] = ['{"unit":"V"}'] * 40 + ['{"unit":"V","summary":"late"}']
    mosaic = seal_source(tmp_path / "g.mosaic", gem_nodes=nodes)
    code, page, settings = export_types(tmp_path, mosaic, "[Gem]")
    assert code == 1
    assert capsys.readouterr().err == (
        f"mosaic export: {settings}:3: view file: export.types: node type Gem "
        + REFUSAL.format("summary")
        + "\n"
    )
    assert not page.exists()
    assert untouched(tmp_path) == ["dist", "g.mosaic", "view.yaml"]


# --- which type, which line, with several types listed -------------------------------------------


def test_with_two_offending_types_the_first_in_the_list_is_named(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mosaic = seal_source(
        tmp_path / "g.mosaic",
        gem_nodes=['{"label":"g"}'],
        disc_nodes=['{"summary":"d"}'],
    )
    code, _, settings = export_types(tmp_path, mosaic, "[Disc, Gem]")
    assert code == 1
    assert capsys.readouterr().err == (
        f"mosaic export: {settings}:3: view file: export.types: node type Disc "
        + REFUSAL.format("summary")
        + "\n"
    )


def test_a_type_the_mosaic_lacks_listed_before_the_offending_one_is_the_one_named(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Q2: a type the mosaic lacks is an error naming the file, the line and the type.
    mosaic = seal_source(tmp_path / "g.mosaic", gem_nodes=['{"key":"k"}'])
    code, page, settings = export_types(tmp_path, mosaic, "[Ghost, Gem]")
    assert code == 1
    err = capsys.readouterr().err
    assert err.startswith(f"mosaic export: {settings}:3:")
    assert "Ghost" in err and "Gem" not in err
    assert not page.exists()


# --- what is not refused -------------------------------------------------------------------------


def test_an_edge_property_named_like_a_column_is_copied_as_it_is(
    tmp_path: Path, dist: Path
) -> None:
    # Section 7.1 step 7: `map` copies edge properties as they are; no field map is involved.
    mosaic = seal_source(
        tmp_path / "g.mosaic",
        gem_nodes=['{"unit":"V"}'],
        edge_declared='{"label":"text","key":"text"}',
        edge_props='{"key":"k","label":"l"}',
    )
    code, page, _ = export_types(tmp_path, mosaic, "[Gem, Disc]")
    assert code == 0
    [(props,)] = carried_rows(page, "SELECT props FROM edge", tmp_path)
    assert json.loads(str(props)) == {"key": "k", "label": "l"}
