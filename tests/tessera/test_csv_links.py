"""The CSV tessera builder, columns as linked things (docs/design.md First milestone).

A column can become linked things: each value in its cells, split on an optional separator and
trimmed, is one node of the column's own type, keyed by the value, with one edge per row and
value pair (sections 3.4, 4.1). Every such node and edge has evidence pointing at the row and
the column, ``file=<name>;row=<n>;field=<column>`` (section 3.5). Empty cells and empty values
make nothing. The same file and settings give the same knowledge hash (section 4.3), and the
settings are recorded in ``header.settings`` (section 3.3).
"""

import json
from pathlib import Path

import mosaic_format
import pytest
from mosaic_build.tessera.csv import Link, Settings, build
from mosaic_build.tessera.settings import from_json, read
from mosaic_format.check import check_file

CSV = (
    "code,title,makers,shelf\n"
    'B1,First,"Ann Lee, Bo Chan",north\n'
    'B2,Second,"Bo Chan,  Cy Dow ",north\n'
    "B3,Third,,south\n"
    'B4,Fourth,"Ann Lee, , Ann Lee,\u00a0",\n'
)

SETTINGS = Settings(
    type="Book",
    key="code",
    label="title",
    links={
        "makers": Link(type="Maker", edge="made_by", separator=","),
        "shelf": Link(type="Shelf", edge="holds", direction="in"),
    },
)


def _write(tmp_path: Path, text: str, name: str = "books.csv") -> Path:
    path = tmp_path / name
    path.write_bytes(text.encode("utf-8"))
    return path


def _build(tmp_path: Path, settings: Settings = SETTINGS, text: str = CSV) -> Path:
    out = tmp_path / "books.tessera"
    build(_write(tmp_path, text), out, settings)
    return out


def _q(path: Path, sql: str) -> list[tuple[object, ...]]:
    with mosaic_format.open(path) as f:
        return f.query(sql)


def test_one_node_per_distinct_trimmed_value_keyed_by_the_value(tmp_path: Path) -> None:
    out = _build(tmp_path)
    makers = _q(out, "SELECT id, key, label FROM v_node WHERE type = 'Maker' ORDER BY id")
    assert makers == [
        ("Maker:Ann Lee", "Ann Lee", None),
        ("Maker:Bo Chan", "Bo Chan", None),
        ("Maker:Cy Dow", "Cy Dow", None),
    ]
    shelves = _q(out, "SELECT id, key FROM v_node WHERE type = 'Shelf' ORDER BY id")
    assert shelves == [("Shelf:north", "north"), ("Shelf:south", "south")]


def test_one_edge_per_row_and_value_pair_in_the_given_direction(tmp_path: Path) -> None:
    out = _build(tmp_path)
    edges = _q(out, "SELECT src, type, dst, qualifier FROM v_edge ORDER BY src, type, dst")
    assert edges == [
        ("Book:B1", "made_by", "Maker:Ann Lee", ""),
        ("Book:B1", "made_by", "Maker:Bo Chan", ""),
        ("Book:B2", "made_by", "Maker:Bo Chan", ""),
        ("Book:B2", "made_by", "Maker:Cy Dow", ""),
        ("Book:B4", "made_by", "Maker:Ann Lee", ""),
        ("Shelf:north", "holds", "Book:B1", ""),
        ("Shelf:north", "holds", "Book:B2", ""),
        ("Shelf:south", "holds", "Book:B3", ""),
    ]


def test_linked_types_and_edge_types_are_declared(tmp_path: Path) -> None:
    out = _build(tmp_path)
    types = _q(
        out, "SELECT name, kind, key_prop, from_type, to_type, props FROM type ORDER BY name"
    )
    assert types == [
        ("Book", "node", "code", None, None, "{}"),
        ("Maker", "node", "makers", None, None, "{}"),
        ("Shelf", "node", "shelf", None, None, "{}"),
        ("holds", "edge", None, "Shelf", "Book", "{}"),
        ("made_by", "edge", None, "Book", "Maker", "{}"),
    ]


def test_every_linked_node_has_evidence_for_each_row_and_column_it_occurs_in(
    tmp_path: Path,
) -> None:
    out = _build(tmp_path)
    rows = _q(
        out,
        "SELECT n.id, e.locator, e.method, e.prop FROM v_evidence e JOIN v_node n "
        "ON e.node = n.id WHERE n.type = 'Maker' ORDER BY n.id, e.locator",
    )
    assert rows == [
        ("Maker:Ann Lee", "file=books.csv;row=1;field=makers", "extracted", None),
        ("Maker:Ann Lee", "file=books.csv;row=4;field=makers", "extracted", None),
        ("Maker:Bo Chan", "file=books.csv;row=1;field=makers", "extracted", None),
        ("Maker:Bo Chan", "file=books.csv;row=2;field=makers", "extracted", None),
        ("Maker:Cy Dow", "file=books.csv;row=2;field=makers", "extracted", None),
    ]


def test_every_edge_has_evidence_pointing_at_its_row_and_column(tmp_path: Path) -> None:
    out = _build(tmp_path)
    rows = _q(
        out,
        "SELECT edge_src, edge_dst, locator FROM v_evidence WHERE edge_type IS NOT NULL "
        "ORDER BY edge_src, edge_dst",
    )
    assert rows == [
        ("Book:B1", "Maker:Ann Lee", "file=books.csv;row=1;field=makers"),
        ("Book:B1", "Maker:Bo Chan", "file=books.csv;row=1;field=makers"),
        ("Book:B2", "Maker:Bo Chan", "file=books.csv;row=2;field=makers"),
        ("Book:B2", "Maker:Cy Dow", "file=books.csv;row=2;field=makers"),
        ("Book:B4", "Maker:Ann Lee", "file=books.csv;row=4;field=makers"),
        ("Shelf:north", "Book:B1", "file=books.csv;row=1;field=shelf"),
        ("Shelf:north", "Book:B2", "file=books.csv;row=2;field=shelf"),
        ("Shelf:south", "Book:B3", "file=books.csv;row=3;field=shelf"),
    ]


def test_empty_cells_and_empty_or_white_space_values_make_nothing(tmp_path: Path) -> None:
    out = _build(tmp_path)
    # B3 has an empty makers cell, B4 an empty shelf cell; B4's makers hold an empty value
    # and a lone U+00A0 (Unicode White_Space) between separators.
    assert _q(out, "SELECT count(*) FROM v_edge WHERE src = 'Book:B3' AND type = 'made_by'") == [
        (0,)
    ]
    assert _q(out, "SELECT count(*) FROM v_edge WHERE dst = 'Book:B4' AND type = 'holds'") == [(0,)]
    keys = [k for (k,) in _q(out, "SELECT key FROM v_node WHERE type = 'Maker'")]
    assert "" not in keys and "\u00a0" not in keys


def test_a_value_twice_in_one_cell_is_one_edge_with_one_evidence_row(tmp_path: Path) -> None:
    out = _build(tmp_path)
    rows = _q(
        out,
        "SELECT count(*) FROM v_evidence WHERE edge_src = 'Book:B4' AND edge_dst = 'Maker:Ann Lee'",
    )
    assert rows == [(1,)]


def test_without_a_separator_a_cell_is_one_value_trimmed(tmp_path: Path) -> None:
    text = 'code,makers\nB1,"Ann Lee, Bo Chan"\nB2," Ann Lee "\n'
    settings = Settings(type="Book", key="code", links={"makers": Link("Maker", "made_by")})
    out = _build(tmp_path, settings, text)
    keys = _q(out, "SELECT key FROM v_node WHERE type = 'Maker' ORDER BY key")
    assert keys == [("Ann Lee",), ("Ann Lee, Bo Chan",)]


def test_the_tessera_passes_the_checker(tmp_path: Path) -> None:
    out = _build(tmp_path)
    assert check_file(out).ok


def test_the_same_file_and_settings_give_the_same_knowledge_hash(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    first = build(_write(a, CSV), a / "t.tessera", SETTINGS)
    second = build(_write(b, CSV), b / "t.tessera", SETTINGS)
    assert first.knowledge_hash == second.knowledge_hash
    assert (a / "t.tessera").read_bytes() == (b / "t.tessera").read_bytes()


def test_the_link_settings_are_recorded_in_header_settings(tmp_path: Path) -> None:
    out = _build(tmp_path)
    [(text,)] = _q(out, "SELECT settings FROM header")
    recorded = json.loads(str(text))
    assert recorded["links"] == {
        "makers": {"type": "Maker", "edge": "made_by", "direction": "out", "separator": ","},
        "shelf": {"type": "Shelf", "edge": "holds", "direction": "in", "separator": None},
    }
    assert from_json(recorded) == SETTINGS


def test_settings_without_links_record_no_links() -> None:
    assert "links" not in json.loads(Settings().as_json())


def test_a_yaml_settings_file_with_links(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(
        """\
type: Book
key: code
label: title
links:
  makers: {type: Maker, edge: made_by, separator: ","}
  shelf: {type: Shelf, edge: holds, direction: in}
""",
        encoding="utf-8",
    )
    assert read(path) == SETTINGS


@pytest.mark.parametrize(
    ("links", "line", "words"),
    [
        ("  makers: {type: maker, edge: made_by}\n", 4, "type"),
        ("  makers: {type: Maker, edge: MadeBy}\n", 4, "edge"),
        ("  makers: {type: Maker, edge: made_by, direction: up}\n", 4, "direction"),
        ("  makers: {type: Maker, edge: made_by, separator: ''}\n", 4, "separator"),
        ("  makers: {type: Maker, edge: made_by, colour: red}\n", 4, "colour"),
        ("  makers: {edge: made_by}\n", 4, "type"),
        ("  makers: [Maker, made_by]\n", 4, "makers"),
    ],
)
def test_a_wrong_link_setting_names_the_file_the_line_and_the_setting(
    tmp_path: Path, links: str, line: int, words: str
) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(f"type: Book\nkey: code\nlinks:\n{links}", encoding="utf-8")
    with pytest.raises(ValueError) as e:
        read(path)
    message = str(e.value)
    assert message.startswith(f"{path}:{line}: settings: ")
    assert "links.makers" in message and words in message


MAKERS = "  makers: {type: Maker, edge: made_by}\n"
SAME_TYPE = MAKERS + "  shelf:\n    edge: holds\n    type: Maker\n"
SAME_EDGE = MAKERS + "  shelf:\n    type: Shelf\n    edge: made_by\n"


@pytest.mark.parametrize(
    ("links", "line", "words"),
    [
        ("  makers: {type: Book, edge: made_by}\n", 4, "'Book' is already the type of the rows"),
        (
            SAME_TYPE,
            7,
            "links.shelf: type 'Maker' is already the type of links.makers",
        ),
        (
            SAME_EDGE,
            7,
            "links.shelf: edge 'made_by' is already the edge of links.makers",
        ),
    ],
)
def test_colliding_links_in_a_settings_file_name_the_file_the_line_and_the_setting(
    tmp_path: Path, links: str, line: int, words: str
) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(f"type: Book\nkey: code\nlinks:\n{links}", encoding="utf-8")
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:{line}: settings: ")
    assert words in str(e.value)


@pytest.mark.parametrize(
    ("links", "words"),
    [
        ({"makers": Link("Book", "made_by")}, "Book"),
        ({"makers": Link("Maker", "made_by"), "shelf": Link("Maker", "holds")}, "Maker"),
        ({"makers": Link("Maker", "made_by"), "shelf": Link("Shelf", "made_by")}, "made_by"),
    ],
)
def test_link_settings_that_would_collide_are_refused(
    tmp_path: Path, links: dict[str, Link], words: str
) -> None:
    settings = Settings(type="Book", key="code", links=links)
    with pytest.raises(ValueError, match=words):
        _build(tmp_path, settings)
    assert not (tmp_path / "books.tessera").exists()


def test_a_linked_column_missing_from_the_header_is_named(tmp_path: Path) -> None:
    settings = Settings(type="Book", key="code", links={"authors": Link("Maker", "made_by")})
    with pytest.raises(ValueError, match=r"books\.csv: column 'authors' is not in the header"):
        _build(tmp_path, settings)


def test_a_linked_column_whose_name_cannot_be_a_locator_value_is_refused(tmp_path: Path) -> None:
    text = "code,a;b\nB1,x\n"
    settings = Settings(type="Book", key="code", links={"a;b": Link("Thing", "has")})
    with pytest.raises(ValueError, match=r"section 3\.5"):
        _build(tmp_path, settings, text)


# Section 5.4: the characters with the Unicode White_Space property.
WHITE_SPACE = (
    [chr(c) for c in range(0x09, 0x0E)]
    + ["\u0020", "\u0085", "\u00a0", "\u1680"]
    + [chr(c) for c in range(0x2000, 0x200B)]
    + ["\u2028", "\u2029", "\u202f", "\u205f", "\u3000"]
)
# Characters that Python's str.strip() removes or that look blank, but are not White_Space.
NOT_WHITE_SPACE = ["\x1c", "\x1d", "\x1e", "\x1f", "\u180e", "\u200b", "\u2060", "\ufeff"]

TAGS = Settings(type="Item", key="code", links={"tags": Link("Tag", "tagged", separator=";")})


def _csv(tmp_path: Path, text: str, name: str = "items.csv") -> Path:
    path = tmp_path / name
    path.write_bytes(text.encode("utf-8"))
    return path


def _build_tags(
    tmp_path: Path, text: str, settings: Settings = TAGS, out: str = "t.tessera"
) -> Path:
    target = tmp_path / out
    build(_csv(tmp_path, text), target, settings)
    return target


def _tags(path: Path) -> list[str]:
    return [str(k) for (k,) in _q(path, "SELECT key FROM v_node WHERE type = 'Tag' ORDER BY id")]


# --- trimming: the White_Space set of section 5.4, nothing else --------------------------------


@pytest.mark.parametrize("space", WHITE_SPACE, ids=[f"U+{ord(c):04X}" for c in WHITE_SPACE])
def test_each_white_space_character_is_trimmed_from_a_value(tmp_path: Path, space: str) -> None:
    # "each value is trimmed"; White_Space as in section 5.4
    out = _build_tags(tmp_path, f'code,tags\nA,"{space}x{space};{space}"\n')
    assert _tags(out) == ["x"]


@pytest.mark.parametrize("char", NOT_WHITE_SPACE, ids=[f"U+{ord(c):04X}" for c in NOT_WHITE_SPACE])
def test_characters_outside_white_space_are_kept_in_a_value(tmp_path: Path, char: str) -> None:
    # section 5.4: neither str.isspace nor \s is the set; only White_Space is trimmed
    out = _build_tags(tmp_path, f'code,tags\nA,"{char}x{char}"\nB,"{char}"\n')
    assert _tags(out) == sorted([f"{char}x{char}", char], key=lambda s: s.encode("utf-8"))


def test_white_space_inside_a_value_is_kept_as_written(tmp_path: Path) -> None:
    # key = the value, trimmed only; collapse is a pattern step (section 5.4)
    out = _build_tags(tmp_path, 'code,tags\nA,"Ann  Lee"\nB,"Ann Lee"\nC,"Ann\tLee"\n')
    assert _tags(out) == ["Ann\tLee", "Ann  Lee", "Ann Lee"]


# --- keys are the value, byte for byte -----------------------------------------------------


def test_a_value_with_a_colon_equals_or_semicolon_in_a_quoted_cell(tmp_path: Path) -> None:
    # section 3.4: id = type:key; section 3.5: the locator names the column, not the value
    out = _build_tags(
        tmp_path,
        "code,tags\nA,a:b|c=d\n",
        Settings(type="Item", key="code", links={"tags": Link("Tag", "tagged", separator="|")}),
    )
    assert [str(i) for (i,) in _q(out, "SELECT id FROM v_node WHERE type = 'Tag' ORDER BY id")] == [
        "Tag:a:b",
        "Tag:c=d",
    ]
    assert check_file(out).ok


# --- separators are literal text ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("separator", "cell", "expected"),
    [
        (".", "a.b", ["a", "b"]),
        ("|", "a|b", ["a", "b"]),
        ("*", "a*b", ["a", "b"]),
        ("\\", "a\\b", ["a", "b"]),
        ("||", "a||b|c", ["b|c", "a"]),
        (" / ", "a / b/c", ["a", "b/c"]),
        ("\u00b7", "a\u00b7b", ["a", "b"]),
        ("\t", "a\tb", ["a", "b"]),
    ],
)
def test_the_separator_is_literal_text(
    tmp_path: Path, separator: str, cell: str, expected: list[str]
) -> None:
    # "split on a separator"; a separator is not a pattern
    settings = Settings(
        type="Item", key="code", links={"tags": Link("Tag", "tagged", separator=separator)}
    )
    out = _build_tags(tmp_path, f'code,tags\nA,"{cell}"\n', settings)
    assert sorted(_tags(out), key=lambda s: s.encode("utf-8")) == sorted(
        expected, key=lambda s: s.encode("utf-8")
    )


# --- rows and locators -------------------------------------------------------------------------


def test_row_numbers_count_records_not_lines_or_blank_lines(tmp_path: Path) -> None:
    # section 3.5 `row`; a quoted line break does not start a row, blank lines are not rows
    text = 'code,tags\nA,x\n\n"B\nB",y\n\nC,z\n'
    out = _build_tags(tmp_path, text)
    rows = _q(
        out,
        "SELECT n.key, e.locator FROM v_evidence e JOIN v_node n ON e.node = n.id "
        "WHERE n.type = 'Tag' ORDER BY n.key",
    )
    assert rows == [
        ("x", "file=items.csv;row=1;field=tags"),
        ("y", "file=items.csv;row=2;field=tags"),
        ("z", "file=items.csv;row=3;field=tags"),
    ]


def test_without_a_key_column_edges_use_the_row_position_keys(tmp_path: Path) -> None:
    # the row node's key is its row position (existing rows behaviour); edges must join to it
    settings = Settings(type="Item", links={"tags": Link("Tag", "tagged", separator=";")})
    out = _build_tags(tmp_path, "tags\nx;y\ny\n", settings)
    assert _q(out, "SELECT src, dst FROM v_edge ORDER BY src, dst") == [
        ("Item:1", "Tag:x"),
        ("Item:1", "Tag:y"),
        ("Item:2", "Tag:y"),
    ]
    assert check_file(out).ok


def test_two_linked_columns_share_a_value_without_sharing_a_node(tmp_path: Path) -> None:
    settings = Settings(
        type="Item",
        key="code",
        links={"a": Link("Left", "has_left"), "b": Link("Right", "has_right")},
    )
    out = _build_tags(tmp_path, "code,a,b\nA,v,v\n", settings)
    assert _q(out, "SELECT id FROM v_node WHERE type IN ('Left', 'Right') ORDER BY id") == [
        ("Left:v",),
        ("Right:v",),
    ]
    assert _q(out, "SELECT locator FROM v_evidence WHERE node = 'Left:v'") == [
        ("file=items.csv;row=1;field=a",)
    ]


def test_a_linked_value_equal_to_a_row_key_is_a_different_node(tmp_path: Path) -> None:
    out = _build_tags(tmp_path, "code,tags\nA,A\n")
    assert _q(out, "SELECT src, dst FROM v_edge") == [("Item:A", "Tag:A")]


def test_in_direction_with_a_repeated_value_is_one_edge(tmp_path: Path) -> None:
    settings = Settings(
        type="Item", key="code", links={"tags": Link("Tag", "holds", "in", separator=";")}
    )
    out = _build_tags(tmp_path, "code,tags\nA,x;x\n", settings)
    assert _q(out, "SELECT src, type, dst FROM v_edge") == [("Tag:x", "holds", "Item:A")]
    assert _q(out, "SELECT count(*) FROM v_evidence WHERE edge_type IS NOT NULL") == [(1,)]


def test_a_header_only_file_with_links_has_no_linked_things(tmp_path: Path) -> None:
    out = _build_tags(tmp_path, "code,tags\n")
    assert _q(out, "SELECT count(*) FROM node") == [(0,)]
    assert _q(out, "SELECT count(*) FROM edge") == [(0,)]
    assert check_file(out).ok


# --- refusals ------------------------------------------------------------------------------


def test_u0000_in_a_linked_cell_is_refused_naming_the_file_and_row(tmp_path: Path) -> None:
    # section 3.1: text MUST NOT contain U+0000
    path = _csv(tmp_path, "code,tags\nA,x\nB,y\x00z;w\n")
    with pytest.raises(ValueError, match=r"items\.csv.*\b2\b"):
        build(path, tmp_path / "t.tessera", TAGS)
    assert not (tmp_path / "t.tessera").exists()


def test_a_linked_column_the_header_has_twice_is_refused(tmp_path: Path) -> None:
    path = _csv(tmp_path, "code,tags,tags\nA,x,y\n")
    with pytest.raises(ValueError, match="tags"):
        build(path, tmp_path / "t.tessera", TAGS)
    assert not (tmp_path / "t.tessera").exists()


def test_the_row_key_column_cannot_be_a_linked_node_type_of_the_same_name(tmp_path: Path) -> None:
    # section 3.4: node ids are `type:key`; a link into the row type would collide with the rows
    settings = Settings(type="Item", key="code", links={"tags": Link("Item", "tagged")})
    with pytest.raises(ValueError, match="Item"):
        build(_csv(tmp_path, "code,tags\nA,x\n"), tmp_path / "t.tessera", settings)


@pytest.mark.parametrize("edge", ["Tagged", "1tag", "tag-ed", "", "tag ged", "t\u00e4g"])
def test_an_edge_type_outside_the_section_3_4_pattern_is_refused(tmp_path: Path, edge: str) -> None:
    settings = Settings(type="Item", key="code", links={"tags": Link("Tag", edge)})
    with pytest.raises(ValueError):
        build(_csv(tmp_path, "code,tags\nA,x\n"), tmp_path / "t.tessera", settings)
    assert not (tmp_path / "t.tessera").exists()


@pytest.mark.parametrize("node_type", ["tag", "_Tag", "Tag-1", "", "T ag", "\u00c9tag"])
def test_a_node_type_outside_the_section_3_4_pattern_is_refused(
    tmp_path: Path, node_type: str
) -> None:
    settings = Settings(type="Item", key="code", links={"tags": Link(node_type, "tagged")})
    with pytest.raises(ValueError):
        build(_csv(tmp_path, "code,tags\nA,x\n"), tmp_path / "t.tessera", settings)
    assert not (tmp_path / "t.tessera").exists()


# --- determinism and recorded settings -------------------------------------------------------


def test_the_order_links_are_listed_in_does_not_change_the_output(tmp_path: Path) -> None:
    # section 4.3: same source and settings, same hash; JSON is canonical (section 3.1)
    one = Settings(
        type="Item",
        key="code",
        links={"a": Link("Aa", "has_a", separator=";"), "b": Link("Bb", "has_b", "in")},
    )
    two = Settings(
        type="Item",
        key="code",
        links={"b": Link("Bb", "has_b", "in"), "a": Link("Aa", "has_a", separator=";")},
    )
    text = "code,a,b\nX,p;q,r\nY,q,s\n"
    (tmp_path / "1").mkdir()
    (tmp_path / "2").mkdir()
    first = build(_csv(tmp_path / "1", text), tmp_path / "1" / "t", one)
    second = build(_csv(tmp_path / "2", text), tmp_path / "2" / "t", two)
    assert first.knowledge_hash == second.knowledge_hash
    assert (tmp_path / "1" / "t").read_bytes() == (tmp_path / "2" / "t").read_bytes()


def test_header_settings_are_canonical_json_and_rebuild_the_same_file(tmp_path: Path) -> None:
    # sections 3.1, 3.3: header.settings records the settings; reading them back and
    # building again gives the same bytes
    settings = Settings(
        type="Item",
        key="code",
        label="code",
        links={"tags": Link("Tag", "tagged", "in", separator=" | ")},
    )
    text = "code,tags\nA,x | y\n"
    (tmp_path / "1").mkdir()
    (tmp_path / "2").mkdir()
    build(_csv(tmp_path / "1", text), tmp_path / "1" / "t", settings)
    [(recorded,)] = _q(tmp_path / "1" / "t", "SELECT settings FROM header")
    parsed = json.loads(str(recorded))
    assert json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False) == recorded
    build(_csv(tmp_path / "2", text), tmp_path / "2" / "t", from_json(parsed))
    assert (tmp_path / "1" / "t").read_bytes() == (tmp_path / "2" / "t").read_bytes()


# --- the settings file ----------------------------------------------------------------------


def _read(tmp_path: Path, text: str) -> Settings:
    path = tmp_path / "s.yaml"
    path.write_text(text, encoding="utf-8")
    return read(path)


def test_empty_links_mapping_is_no_links(tmp_path: Path) -> None:
    assert _read(tmp_path, "type: Item\nlinks: {}\n") == Settings(type="Item")


def test_an_explicit_null_separator_is_no_separator(tmp_path: Path) -> None:
    got = _read(tmp_path, "links:\n  t: {type: Tag, edge: tagged, separator: null}\n")
    assert got.links["t"].separator is None


def test_a_link_column_listed_twice_is_refused_naming_the_line(tmp_path: Path) -> None:
    path = tmp_path / "s.yaml"
    path.write_text(
        "type: Item\nlinks:\n  t: {type: Tag, edge: tagged}\n  t: {type: Tag, edge: tagged}\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:4")


@pytest.mark.parametrize("links", ["- a\n- b\n", "x\n", "5\n", "true\n"])
def test_links_that_are_not_a_mapping_are_refused_naming_the_setting(
    tmp_path: Path, links: str
) -> None:
    path = tmp_path / "s.yaml"
    path.write_text(
        "type: Item\nlinks:\n" + "".join(f"  {line}\n" for line in links.splitlines()),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="links") as e:
        read(path)
    assert str(e.value).startswith(f"{path}:")
