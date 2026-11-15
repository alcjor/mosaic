"""``mosaic export FILE [--view VIEW] -o OUT.html``: one HTML file that opens offline.

docs/design.md, Implementation plan, Viewer: "``mosaic export`` saves the same page with the
mosaic inside as one HTML file that opens offline with a double-click"; View file: ``search:
text``, "a few MB". The export holds the page, the kit and the mosaic, shaped by a view file; a
file the reading rules refuse exits 1 and writes nothing; the source is never written
(principle 8); the export carries no embedding model and no ONNX Runtime. These tests use a
stand-in for the built viewer; ``tests/viewer/test_export_page.py`` opens a real export in a
browser.
"""

import base64
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from mosaic_build import export, view, view_file
from mosaic_build.cli import main
from mosaic_build.mosaic import vectors

from tests.conftest import REPO

READING = REPO / "conformance" / "reading"
CASES = json.loads((READING / "cases.json").read_text(encoding="utf-8"))
REFUSED = sorted(name for name, case in CASES.items() if not case["opens"])
TEXT = "search: text\ntypes:\n  Item:\n    label: Thing\n"
ONNX = b"onnx-runtime-would-be-here"
SQLITE = b"\0asm-sqlite-engine"


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A stand-in for the built viewer, laid out as ``bun run build`` lays it out."""
    directory = tmp_path / "dist"
    assets = directory / "assets"
    assets.mkdir(parents=True)
    (directory / "index.html").write_text(
        "<!doctype html>\n<html><head>\n"
        '<script type="module" crossorigin src="./assets/index-A1.js"></script>\n'
        '<link rel="stylesheet" crossorigin href="./assets/index-B2.css">\n'
        '</head><body><div id="app"></div></body></html>\n',
        encoding="utf-8",
    )
    (assets / "index-A1.js").write_text(
        'const page = "the page and the kit"; import("./ort.wasm.bundle.min-C3.js");\n',
        encoding="utf-8",
    )
    (assets / "index-B2.css").write_text("body { margin: 0; }\n", encoding="utf-8")
    (assets / "sqlite3-D4.wasm").write_bytes(SQLITE)
    (assets / "ort.wasm.bundle.min-C3.js").write_text("const ort = 'ONNX Runtime';\n", "utf-8")
    (assets / "ort-wasm-simd-threaded-E5.wasm").write_bytes(ONNX)
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


def files_in(directory: Path) -> list[str]:
    return sorted(str(p.relative_to(directory)) for p in directory.rglob("*"))


def source(tmp_path: Path, name: str = "mosaic.mosaic") -> Path:
    path = tmp_path / "in" / name
    path.parent.mkdir(exist_ok=True)
    shutil.copyfile(READING / "mosaic.mosaic", path)
    return path


def view_yaml(tmp_path: Path, text: str = TEXT) -> Path:
    path = tmp_path / "in" / "view.yaml"
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def unpacked(text: object) -> bytes:
    """The bytes the page unpacks: base64, then gzip."""
    return gzip.decompress(base64.b64decode(str(text)))


def data_of(page: str) -> dict[str, object]:
    found = re.search(r'<script type="application/json" id="mosaic-export">(.*?)</script>', page)
    assert found, "the export holds no data element"
    return json.loads(found.group(1))


def test_one_html_file_holds_the_page_the_kit_and_the_mosaic_shaped_by_the_view_file(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mosaic, settings = source(tmp_path), view_yaml(tmp_path)
    out = tmp_path / "out" / "export.html"
    out.parent.mkdir()
    before = files_in(tmp_path / "in"), mosaic.read_bytes(), settings.read_bytes()
    assert main(["export", str(mosaic), "--view", str(settings), "-o", str(out)]) == 0
    assert str(out) in capsys.readouterr().out
    assert files_in(tmp_path / "out") == ["export.html"]
    page = out.read_text(encoding="utf-8")
    assert page.startswith("<!doctype html>")
    assert 'const page = "the page and the kit"' in page  # the script, inlined
    assert "body { margin: 0; }" in page  # the stylesheet, inlined
    assert 'src="./assets' not in page and 'href="./assets' not in page  # nothing to fetch
    data = data_of(page)
    assert data["name"] == "mosaic.mosaic"
    assert unpacked(data["mosaic"]) == mosaic.read_bytes()
    assert unpacked(data["sqlite"]) == SQLITE
    assert data["view"] == view_file.read(settings).as_json()
    assert (files_in(tmp_path / "in"), mosaic.read_bytes(), settings.read_bytes()) == before


def test_the_export_carries_no_embedding_model_and_no_onnx_runtime(
    tmp_path: Path, dist: Path
) -> None:
    out = tmp_path / "export.html"
    assert (
        main(["export", str(source(tmp_path)), "--view", str(view_yaml(tmp_path)), "-o", str(out)])
        == 0
    )
    page = out.read_bytes()
    assert b"ONNX Runtime" not in page
    data = data_of(page.decode("utf-8"))
    assert sorted(data) == ["mosaic", "name", "sqlite", "view"]
    assert ONNX not in page and ONNX not in unpacked(data["mosaic"]) + unpacked(data["sqlite"])


@pytest.mark.parametrize("name", REFUSED)
def test_a_file_the_reading_rules_refuse_exits_1_and_writes_nothing(
    name: str, tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "in" / name
    path.parent.mkdir()
    shutil.copyfile(READING / name, path)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    out = tmp_path / "export.html"
    assert main(["export", str(path), "--view", str(view_yaml(tmp_path)), "-o", str(out)]) == 1
    assert capsys.readouterr().err.startswith(f"mosaic export: {path}")
    assert not out.exists()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_a_missing_file_exits_1_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "export.html"
    missing = tmp_path / "absent.mosaic"
    assert main(["export", str(missing), "--view", str(view_yaml(tmp_path)), "-o", str(out)]) == 1
    assert str(missing) in capsys.readouterr().err
    assert not out.exists()


def test_a_wrong_view_file_exits_1_with_its_error_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "export.html"
    bad = view_yaml(tmp_path, "search: text\ntheme: sepia\n")
    assert main(["export", str(source(tmp_path)), "--view", str(bad), "-o", str(out)]) == 1
    err = capsys.readouterr().err
    assert f"{bad}:2" in err and "theme" in err
    assert not out.exists()


@pytest.mark.parametrize("text", [None, "search: semantic\n", "theme: dark\n"])
def test_search_semantic_without_the_model_exits_1_asking_for_it_and_writes_nothing(
    text: str | None, tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "export.html"
    args = ["export", str(source(tmp_path)), "-o", str(out)]
    if text is not None:
        args += ["--view", str(view_yaml(tmp_path, text))]
    assert main(args) == 1
    assert "--model" in capsys.readouterr().err
    assert not out.exists()


MODEL_BYTES = b"onnx model bytes"
TOKENIZER_BYTES = b'{"tokenizer": true}'


@pytest.fixture
def model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A stand-in for the model of section 6, pinned by its own hashes."""
    directory = tmp_path / "model"
    (directory / "onnx").mkdir(parents=True)
    (directory / "onnx" / "model_quantized.onnx").write_bytes(MODEL_BYTES)
    (directory / "tokenizer.json").write_bytes(TOKENIZER_BYTES)
    pinned = vectors.Model(
        name=vectors.MODEL.name,
        repository=vectors.MODEL.repository,
        revision=vectors.MODEL.revision,
        licence=vectors.MODEL.licence,
        files=(
            vectors.PinnedFile(
                "onnx/model_quantized.onnx", hashlib.sha256(MODEL_BYTES).hexdigest()
            ),
            vectors.PinnedFile("tokenizer.json", hashlib.sha256(TOKENIZER_BYTES).hexdigest()),
        ),
    )
    monkeypatch.setattr(view, "MODEL", pinned)
    monkeypatch.setattr(export, "MODEL", pinned)
    return directory


SEMANTIC = "search: semantic\ntypes:\n  Item: {}\n"


def test_search_semantic_carries_the_model_and_onnx_runtime(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    out = tmp_path / "export.html"
    settings = view_yaml(tmp_path, SEMANTIC)
    args = ["export", str(source(tmp_path)), "--view", str(settings), "-o", str(out)]
    assert main([*args, "--model", str(model)]) == 0
    data = data_of(out.read_text(encoding="utf-8"))
    assert sorted(data) == ["model", "mosaic", "name", "ort", "sqlite", "view"]
    files, ort = data["model"], data["ort"]
    assert isinstance(files, dict) and isinstance(ort, dict)
    assert unpacked(files["model"]) == MODEL_BYTES
    assert unpacked(files["tokenizer"]) == TOKENIZER_BYTES
    assert unpacked(ort["module"]) == (dist / "assets" / "ort.wasm.bundle.min-C3.js").read_bytes()
    assert unpacked(ort["wasm"]) == ONNX
    assert data["view"] == view_file.read(settings).as_json()


def test_search_text_with_a_model_writes_the_text_export_without_it(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    # Answer B: as `mosaic view --model` does, the model is not used with search: text.
    out = tmp_path / "export.html"
    args = ["export", str(source(tmp_path)), "--view", str(view_yaml(tmp_path)), "-o", str(out)]
    assert main([*args, "--model", str(model)]) == 0
    data = data_of(out.read_text(encoding="utf-8"))
    assert sorted(data) == ["mosaic", "name", "sqlite", "view"]
    plain = tmp_path / "plain.html"
    assert main([*args[:-1], str(plain)]) == 0
    assert out.read_bytes() == plain.read_bytes()


def test_an_existing_output_is_never_overwritten(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "export.html"
    out.write_text("keep me", encoding="utf-8")
    assert (
        main(["export", str(source(tmp_path)), "--view", str(view_yaml(tmp_path)), "-o", str(out)])
        == 1
    )
    assert str(out) in capsys.readouterr().err
    assert out.read_text(encoding="utf-8") == "keep me"


def test_without_o_the_export_is_the_file_name_with_html_in_the_current_directory(
    tmp_path: Path,
    dist: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Answer: (a) Reading B, an optional -o FILE with a default; (b) Reading A, kept.
    mosaic, settings = source(tmp_path, "netflix.mosaic"), view_yaml(tmp_path)
    here = tmp_path / "here"
    here.mkdir()
    monkeypatch.chdir(here)
    assert main(["export", str(mosaic), "--view", str(settings)]) == 0
    assert files_in(here) == ["netflix.html"]
    assert "netflix.html" in capsys.readouterr().out
    first = (here / "netflix.html").read_bytes()
    assert unpacked(data_of(first.decode("utf-8"))["mosaic"]) == mosaic.read_bytes()
    # Run twice: the second keeps the first export and exits 1.
    assert main(["export", str(mosaic), "--view", str(settings)]) == 1
    assert "netflix.html" in capsys.readouterr().err
    assert (here / "netflix.html").read_bytes() == first


@pytest.mark.parametrize(
    ("name", "default"),
    [
        ("netflix.mosaic", "netflix.html"),
        ("rows.tessera", "rows.html"),
        ("archive.v2.mosaic", "archive.v2.html"),
        ("plain", "plain.html"),
    ],
)
def test_the_default_output_name(name: str, default: str) -> None:
    assert export.default_output(Path("/elsewhere") / name) == Path(default)


def test_an_unbuilt_viewer_exits_1_saying_how_to_build_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(view, "VIEWER_DIST", tmp_path / "nowhere")
    out = tmp_path / "export.html"
    assert (
        main(["export", str(source(tmp_path)), "--view", str(view_yaml(tmp_path)), "-o", str(out)])
        == 1
    )
    assert not out.exists()
    assert str(tmp_path / "nowhere") in capsys.readouterr().err


def test_text_from_the_file_name_cannot_break_out_of_the_page(tmp_path: Path, dist: Path) -> None:
    mosaic = source(tmp_path, "a<!--<script>&b.mosaic")
    out = tmp_path / "export.html"
    assert main(["export", str(mosaic), "--view", str(view_yaml(tmp_path)), "-o", str(out)]) == 0
    page = out.read_text(encoding="utf-8")
    assert page.count("<script") == 2  # the data element and the page's script, nothing more
    assert "<!--" not in page
    assert "<title>a&lt;!--&lt;script&gt;&amp;b.mosaic · Mosaic</title>" in page
    assert data_of(page)["name"] == "a<!--<script>&b.mosaic"


def test_a_build_whose_script_would_end_its_element_is_refused(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (dist / "assets" / "index-A1.js").write_text('const s = "</script>";\n', encoding="utf-8")
    out = tmp_path / "export.html"
    assert (
        main(["export", str(source(tmp_path)), "--view", str(view_yaml(tmp_path)), "-o", str(out)])
        == 1
    )
    assert not out.exists()


def test_the_same_inputs_give_the_same_export(tmp_path: Path, dist: Path) -> None:
    mosaic, settings = source(tmp_path), view_yaml(tmp_path)
    one, two = tmp_path / "one.html", tmp_path / "two.html"
    export.export(mosaic, one, settings)
    export.export(mosaic, two, settings)
    assert one.read_bytes() == two.read_bytes()


@pytest.mark.parametrize("given", [".", "/"])
def test_a_path_with_no_file_name_exits_1_naming_it(
    given: str,
    tmp_path: Path,
    dist: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.chdir(tmp_path)
    assert main(["export", given, "--view", str(view_yaml(tmp_path))]) == 1
    assert given in capsys.readouterr().err
    assert not [p for p in files_in(tmp_path) if p.endswith(".html") and not p.startswith("dist")]


def test_a_file_name_that_is_not_utf8_exits_1_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    directory = tmp_path / "in"
    directory.mkdir()
    raw = os.fsencode(directory) + b"/bad\xff.mosaic"
    shutil.copyfile(READING / "mosaic.mosaic", raw)
    path = Path(os.fsdecode(raw))
    out = tmp_path / "out.html"
    assert main(["export", str(path), "--view", str(view_yaml(tmp_path)), "-o", str(out)]) == 1
    err = capsys.readouterr().err
    assert "bad\\xff.mosaic" in err
    assert not out.exists()


OPENS = sorted(name for name, case in CASES.items() if case["opens"])
TEXT_ONLY = "search: text\n"


def listing(directory: Path) -> list[tuple[str, int]]:
    return sorted((str(p.relative_to(directory)), p.stat().st_size) for p in directory.rglob("*"))


def copied(tmp_path: Path, source: str, name: str | None = None, where: str = "in") -> Path:
    path = tmp_path / where / (name or source)
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(READING / source, path)
    return path


def settings(tmp_path: Path, text: str = TEXT_ONLY) -> Path:
    path = tmp_path / "views" / "view.yaml"
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


# --- every file the reading rules open can be exported (section 3.8) ------------------------


@pytest.mark.parametrize("name", OPENS)
def test_every_file_the_reading_rules_open_is_exported_whole_and_its_source_is_left_alone(
    name: str, tmp_path: Path, dist: Path
) -> None:
    # Section 3.8 / conformance/reading: wal.mosaic is in WAL mode, where opening it could
    # leave -wal and -shm files beside the source; principle 8.
    path = copied(tmp_path, name)
    before_bytes, before_dir = path.read_bytes(), listing(path.parent)
    mtime = path.stat().st_mtime_ns
    out = tmp_path / "out" / "export.html"
    out.parent.mkdir()
    assert main(["export", str(path), "--view", str(settings(tmp_path)), "-o", str(out)]) == 0
    data = data_of(out.read_text(encoding="utf-8"))
    assert unpacked(data["mosaic"]) == before_bytes
    assert data["name"] == name
    assert path.read_bytes() == before_bytes
    assert listing(path.parent) == before_dir
    assert path.stat().st_mtime_ns == mtime


# --- the output file ------------------------------------------------------------------------


def test_an_output_in_a_directory_that_does_not_exist_exits_1_naming_it_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = copied(tmp_path, "mosaic.mosaic")
    out = tmp_path / "nowhere" / "export.html"
    assert main(["export", str(source), "--view", str(settings(tmp_path)), "-o", str(out)]) == 1
    err = capsys.readouterr().err
    assert "nowhere" in err
    assert not (tmp_path / "nowhere").exists()


def test_an_output_that_is_a_directory_exits_1_and_leaves_it_alone(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = copied(tmp_path, "mosaic.mosaic")
    out = tmp_path / "out"
    out.mkdir()
    (out / "keep.txt").write_text("keep", encoding="utf-8")
    before = listing(out)
    assert main(["export", str(source), "--view", str(settings(tmp_path)), "-o", str(out)]) == 1
    assert str(out) in capsys.readouterr().err
    assert listing(out) == before


def test_an_output_that_is_the_source_itself_is_kept_and_exits_1(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Principle 8: never write to a source; the output "is never overwritten".
    source = copied(tmp_path, "mosaic.mosaic")
    before = source.read_bytes()
    code = main(["export", str(source), "--view", str(settings(tmp_path)), "-o", str(source)])
    assert code == 1
    assert str(source) in capsys.readouterr().err
    assert source.read_bytes() == before


# --- the view file ---------------------------------------------------------------------------


def test_a_missing_view_file_exits_1_naming_it_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "out.html"
    missing = tmp_path / "absent.yaml"
    source = copied(tmp_path, "mosaic.mosaic")
    assert main(["export", str(source), "--view", str(missing), "-o", str(out)]) == 1
    assert str(missing) in capsys.readouterr().err
    assert not out.exists()


def test_view_file_labels_with_markup_stay_inside_the_data_element_and_round_trip(
    tmp_path: Path, dist: Path
) -> None:
    label = 'Café 日本語 </script><script>alert(1)</script> <!-- &amp; "q"'
    text = f"search: text\ntypes:\n  Item:\n    label: {json.dumps(label)}\n"
    out = tmp_path / "out.html"
    source = copied(tmp_path, "mosaic.mosaic")
    assert (
        main(["export", str(source), "--view", str(settings(tmp_path, text)), "-o", str(out)]) == 0
    )
    page = out.read_text(encoding="utf-8")
    assert page.count("<script") == 2 and page.count("</script") == 2
    assert "<!--" not in page
    view_data: dict[str, list[dict[str, object]]] = json.loads(json.dumps(data_of(page)["view"]))
    types = view_data["types"]
    assert [t["label"] for t in types] == [label]


def test_a_non_ascii_file_name_is_kept_in_the_export(tmp_path: Path, dist: Path) -> None:
    source = copied(tmp_path, "mosaic.mosaic", "café-日本-\U0001f600.mosaic")
    out = tmp_path / "out.html"
    assert main(["export", str(source), "--view", str(settings(tmp_path)), "-o", str(out)]) == 0
    assert data_of(out.read_text(encoding="utf-8"))["name"] == source.name


# --- command line ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        ["--view"],
        ["x.mosaic", "-o"],
        ["x.mosaic", "--view"],
        ["x.mosaic", "y.mosaic"],
        ["--view", "v.yaml"],
        ["x.mosaic", "--no-such-option"],
    ],
    ids=[
        "no-file",
        "o-without-value",
        "view-without-value",
        "two-files",
        "no-file-with-view",
        "unknown-option",
    ],
)
def test_a_command_line_not_understood_exits_2(
    args: list[str], tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit) as stop:
        main(["export", *args])
    assert stop.value.code == 2
    assert list(tmp_path.glob("*.html")) == []


# --- the real built viewer (slow) ------------------------------------------------------------


def built() -> str:
    bun = shutil.which("bun")
    assert bun, "bun is needed to build the viewer (README, Development)"
    run = subprocess.run(
        [bun, "run", "build"], cwd=REPO / "viewer", capture_output=True, text=True, check=False
    )
    assert run.returncode == 0, run.stdout + run.stderr
    return bun


@pytest.mark.slow
def test_the_real_export_fetches_nothing_and_stays_a_few_megabytes(tmp_path: Path) -> None:
    # Design, View file: `search: text` is "a few MB": no embedding model and no ONNX
    # Runtime. A page that fetches nothing has no external script, style, image or frame.
    built()
    out = tmp_path / "real.html"
    source = copied(tmp_path, "mosaic.mosaic")
    assert main(["export", str(source), "--view", str(settings(tmp_path)), "-o", str(out)]) == 0
    size = out.stat().st_size
    print(f"\nreal export of a {source.stat().st_size}-byte mosaic: {size:,} bytes")
    page = out.read_text(encoding="utf-8")
    assert size < 5_000_000
    assert (
        re.search(r"<(script|link|img|iframe|source|video|audio)\b[^>]*\b(src|href)=", page) is None
    )
    assert 'rel="stylesheet"' not in page
    assert b"\0asm" not in out.read_bytes()  # no raw WebAssembly: it travels inside the data
    # The ONNX Runtime's WebAssembly is 14 MB; SQLite's is 0.9 MB.
    assert size < 14_000_000


@pytest.mark.slow
@pytest.mark.parametrize(
    ("name", "query", "node", "kind"),
    [
        ("tessera.tessera", "Row two", "Row:2", "Row"),
        ("non-ascii.mosaic", "Item B", "Item:b", "Item"),
        ("wal.mosaic", "Item B", "Item:b", "Item"),
        ("stat4.mosaic", "Item B", "Item:b", "Item"),
    ],
)
def test_every_file_the_reading_rules_open_exports_to_a_page_that_opens_offline(
    name: str, query: str, node: str, kind: str, tmp_path: Path
) -> None:
    bun = built()
    source = copied(tmp_path, name)
    page = tmp_path / "page.html"
    assert main(["export", str(source), "--view", str(settings(tmp_path)), "-o", str(page)]) == 0
    run = subprocess.run(
        [bun, "viewer/scripts/open-export.ts", str(page), query, node, kind],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    seen = json.loads(run.stdout.strip().splitlines()[-1])
    assert seen["blocked"] == [] and seen["errors"] == [] and seen["alerts"] == [], seen
    assert any(r["id"] == node for r in seen["results"])
    assert node in seen["rows"]
    assert seen["header"][0] == name
