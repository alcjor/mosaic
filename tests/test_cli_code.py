"""``mosaic import code``: a directory of C and C++ files to one tessera.

The settings come from a file in the shape of the tessera's ``header.settings``. A wrong
setting or a pattern that names no file is an error, exit status 1, and no tessera is written.
"""

from pathlib import Path

import pytest
from mosaic_build.cli import main
from mosaic_format.reader import open as open_sealed

THERMOSTAT = Path(__file__).parent / "tessera" / "data" / "code" / "thermostat"


def _import(tmp_path: Path, settings: str) -> tuple[int, Path, Path]:
    path = tmp_path / "settings.yaml"
    path.write_text(settings, encoding="utf-8")
    out = tmp_path / "pieces" / "thermostat.tessera"
    done = main(["import", "code", str(THERMOSTAT), "--settings", str(path), "-o", str(out)])
    return done, path, out


def test_import_code_writes_a_tessera_that_passes_check(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    done, _, out = _import(tmp_path, "include: [config.h, 'src/*.c*']\nnotice: (c) Example\n")
    assert done == 0
    with open_sealed(out) as sealed:
        assert f"knowledge_hash {sealed.knowledge_hash}" in capsys.readouterr().out
        assert sealed.query("SELECT id, notice FROM source ORDER BY id") == [
            ("config.h", "(c) Example"),
            ("src/clock.c", "(c) Example"),
            ("src/thermostat.cpp", "(c) Example"),
        ]
        assert sealed.query("SELECT count(*) FROM mention WHERE role = 'code.condition'") == [(4,)]
    assert main(["check", str(out)]) == 0


def test_a_wrong_setting_names_the_file_the_line_and_the_setting(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    done, path, out = _import(tmp_path, "include: [config.h]\ncomments: true\n")
    assert done == 1
    err = capsys.readouterr().err
    assert f"{path}:2:" in err and "comments" in err, err
    assert not out.exists()


def test_a_pattern_that_names_no_file_writes_no_tessera(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    done, _, out = _import(tmp_path, "include: ['*.java']\n")
    assert done == 1
    assert "*.java" in capsys.readouterr().err
    assert not out.exists()
