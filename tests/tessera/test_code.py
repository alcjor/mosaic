"""The code tessera builder: C and C++ files under one directory to one tessera.

``data/code/thermostat`` is an invented program; ``data/code/thermostat.json`` is what the
builder reads from it: a node per file, define and function, their edges and aliases, and the
names in preprocessor conditions and function bodies as mentions.
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest
from mosaic_build.tessera.code import PRODUCER, Settings, load_settings, read
from mosaic_format.check import check_file
from mosaic_format.reader import open as open_sealed
from mosaic_format.writer import Content, seal

HERE = Path(__file__).parent
THERMOSTAT = HERE / "data" / "code" / "thermostat"
SETTINGS = Settings(include=("config.h", "src/*.c*"), commented_defines=True)


def _line(locator: str) -> int:
    found = re.search(r"line=(\d+)", locator)
    assert found is not None, locator
    return int(found.group(1))


def _read_as_json(made: Content) -> dict[str, Any]:
    return {
        "nodes": [
            {"id": n.id, "label": n.label, "summary": n.summary, "props": json.loads(n.props or "")}
            for n in made.nodes
        ],
        "edges": [[e.src, e.type, e.dst] for e in made.edges],
        "aliases": [[a.node, a.text, a.origin] for a in made.aliases],
        "mentions": [[m.role, m.text, m.node, _line(m.locator), m.kind] for m in made.mentions],
    }


def test_the_thermostat_gives_its_files_defines_functions_and_mentions() -> None:
    expected = json.loads((THERMOSTAT.parent / "thermostat.json").read_text("utf-8"))
    assert _read_as_json(read(THERMOSTAT, SETTINGS)) == expected


def test_without_commented_defines_a_commented_define_is_no_node() -> None:
    made = read(THERMOSTAT, Settings(include=SETTINGS.include))
    assert {n.key for n in made.nodes if n.type == "Define"} == {
        "TARGET_TENTHS", "HAS_FAN", "CLAMP", "FAN_PIN",
    }  # fmt: skip


def test_the_sealed_tessera_passes_the_check_and_has_the_same_hash_twice(tmp_path: Path) -> None:
    first = seal(tmp_path / "a.tessera", read(THERMOSTAT, SETTINGS))
    second = seal(tmp_path / "b.tessera", read(THERMOSTAT, SETTINGS))
    assert first.knowledge_hash == second.knowledge_hash
    assert [str(v) for v in check_file(first.path).violations] == []
    with open_sealed(first.path) as sealed:
        assert sealed.query("SELECT kind, producer, settings FROM header") == [
            ("tessera", PRODUCER, SETTINGS.as_json())
        ]
        assert sealed.query("SELECT count(*) FROM source") == [(3,)]


def test_evidence_cuts_each_fact_out_of_its_file_also_after_other_scripts() -> None:
    """Offsets count characters: the `°` above a function does not shift its range."""
    made = read(THERMOSTAT, SETTINGS)
    texts = {s.id: s.text or "" for s in made.sources}
    cut: dict[object, list[str]] = {}
    for e in made.evidence:
        found = re.search(r"chars=(\d+)-(\d+)", e.locator)
        assert found is not None, e.locator
        cut.setdefault(e.subject, []).append(
            texts[e.source][int(found.group(1)) : int(found.group(2))]
        )
    update = cut["Function:src/thermostat.cpp::Thermostat::update"][0]
    assert update.startswith("bool Thermostat::update(int now) {")
    assert update.endswith("return apply(on);\n}")
    assert cut["Define:TARGET_TENTHS"] == [
        "#define TARGET_TENTHS 215   // 21.5 °C",
        "#define TARGET_TENTHS 200",
    ]
    assert cut["Define:HAS_BUZZER"] == ["//#define HAS_BUZZER"]
    snippets = {e.subject: e.snippet for e in made.evidence if e.snippet is not None}
    assert snippets["Function:src/thermostat.cpp::Thermostat::update"] == (
        "// Switch the heater.\n// Returns true when it changed.\nbool Thermostat::update(int now)"
    )


def test_code_that_does_not_parse_is_read_as_far_as_it_goes(tmp_path: Path) -> None:
    (tmp_path / "clock.c").write_text(
        "#define TICK 1\nvoid half(void) { x = (a + ) * ( + b); }\n"
        "int broken( {{{ ]\nvoid chime(void) { ring(BELL); }\n",
        encoding="utf-8",
    )
    made = read(tmp_path, Settings(include=("*.c",)))
    assert "" not in {m.text for m in made.mentions}  # no name where the parser missed one
    assert "Define:TICK" in {n.id for n in made.nodes}


def test_a_file_that_is_not_utf8_is_an_error_naming_it(tmp_path: Path) -> None:
    (tmp_path / "clock.c").write_bytes(b"int tick; // caf\xe9\n")
    with pytest.raises(ValueError, match=re.escape(str(tmp_path / "clock.c"))):
        read(tmp_path, Settings(include=("*.c",)))


CASES = json.loads((HERE / "cases" / "code_wrong_settings.json").read_text("utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_a_wrong_setting_names_the_file_the_line_and_the_setting(
    tmp_path: Path, case: dict[str, Any]
) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(case["text"], encoding="utf-8")
    with pytest.raises(ValueError) as error:
        load_settings(path)
    message = str(error.value)
    assert message.startswith(f"{path}:{case['line']}:"), message
    assert case["named"] in message, message


def test_the_header_settings_as_a_settings_file_give_the_same_settings(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(Settings(("src/**/*.h",), notice="(c) Example").as_json(), encoding="utf-8")
    assert load_settings(path) == Settings(("src/**/*.h",), notice="(c) Example")
