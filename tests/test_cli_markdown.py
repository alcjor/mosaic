"""``mosaic import markdown``: a directory of Markdown files to one tessera.

The settings come from a file in the shape of the tessera's ``header.settings``. A wrong
setting or a file that cannot be read is an error naming the file and line, exit status 1,
and no tessera is written. The directory is only read (principle 8).
"""

from pathlib import Path

import pytest
from mosaic_build.cli import main
from mosaic_format.check import check_file
from mosaic_format.reader import open as open_sealed

DATA = Path(__file__).parent / "tessera" / "data" / "markdown"


def _import(directory: Path, settings: Path, out: Path) -> int:
    return main(["import", "markdown", str(directory), "--settings", str(settings), "-o", str(out)])


def test_import_markdown_writes_a_tessera_that_passes_the_check(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "pieces" / "handbook.tessera"
    assert _import(DATA / "handbook", DATA / "handbook.yaml", out) == 0
    printed = capsys.readouterr().out
    with open_sealed(out) as sealed:
        assert f"knowledge_hash {sealed.knowledge_hash}" in printed
        assert sealed.query("SELECT id FROM source ORDER BY id") == [
            ("catalogue.md",),
            ("guide/lending.md",),
            ("plain.md",),
        ]
        assert sealed.query("SELECT count(*) FROM mention") == [(19,)]
    assert [str(v) for v in check_file(out).violations] == []


def test_the_recorded_settings_as_a_file_give_the_same_tessera(tmp_path: Path) -> None:
    first, second = tmp_path / "first.tessera", tmp_path / "second.tessera"
    assert _import(DATA / "handbook", DATA / "handbook.yaml", first) == 0
    with open_sealed(first) as sealed:
        ((recorded,),) = sealed.query("SELECT settings FROM header")
        knowledge_hash = sealed.knowledge_hash
    again = tmp_path / "settings.json"
    again.write_text(str(recorded), encoding="utf-8")
    assert _import(DATA / "handbook", again, second) == 0
    with open_sealed(second) as sealed:
        assert sealed.knowledge_hash == knowledge_hash


@pytest.mark.parametrize(
    ("settings", "page", "named"),
    [
        ("include: ['*.md']\ncolour: red\n", "# Menu\n", "settings.yaml:2"),
        ("include: ['*.md']\n", "---\n- soup\n---\n", "menu.md:2"),
        ("include: ['*.txt']\n", "# Menu\n", "*.txt"),
    ],
    ids=["wrong setting", "bad front matter", "no file"],
)
def test_a_refusal_names_the_file_and_writes_no_tessera(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], settings: str, page: str, named: str
) -> None:
    (tmp_path / "kitchen").mkdir()
    (tmp_path / "kitchen" / "menu.md").write_text(page, encoding="utf-8")
    (tmp_path / "settings.yaml").write_text(settings, encoding="utf-8")
    out = tmp_path / "kitchen.tessera"
    assert _import(tmp_path / "kitchen", tmp_path / "settings.yaml", out) == 1
    captured = capsys.readouterr()
    assert captured.out == "" and named in captured.err
    assert not out.exists()
