"""``mosaic export`` with ``search: semantic``: the export carries the pinned model.

docs/design.md, View file: ``search: semantic`` is "embedding model inside, about 25 MB". Section 6
pins the model file and the tokenizer by SHA-256. the export carries the pinned model
and tokenizer, "checked by hash as ``mosaic view --model`` checks them; a wrong or missing model
file exits 1 naming the file". Section 3.8: a file the reading rules refuse is never exported.
Principle 8: nothing the command is given is written. Principle 5: same inputs, same bytes. The
maintainer's answers: the view file is ``--view FILE``; ``-o FILE`` is optional with a
default and an existing output is kept. Help: "with search: text it carries no model, and
--model is an error".
"""

import base64
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from mosaic_build import export, view
from mosaic_build.cli import main
from mosaic_build.mosaic import vectors

from tests.conftest import REPO

READING = REPO / "conformance" / "reading"
SEMANTIC = "search: semantic\n"
TEXT = "search: text\n"
# Section 6, written out here from the specification, not read from the code.
SPEC_MODEL_HASH = "e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1"
SPEC_TOKENIZER_HASH = "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854"
# Every byte value, twice: NUL, newlines, bytes that are no UTF-8 text.
MODEL_BYTES = bytes(range(256)) * 2 + b"\0\0"
TOKENIZER_BYTES = b'{"tokenizer": true}\r\n\xff\xfe\0'
ORT_JS = "const ort = 'ONNX Runtime';\n"
ORT_WASM = b"\0asm-onnx-runtime"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stand_in_dist(directory: Path) -> None:
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
        'const page = "the page"; import("./ort.wasm.bundle.min-C3.js");\n', encoding="utf-8"
    )
    (assets / "index-B2.css").write_text("body { margin: 0; }\n", encoding="utf-8")
    (assets / "sqlite3-D4.wasm").write_bytes(b"\0asm-sqlite-engine")
    (assets / "ort.wasm.bundle.min-C3.js").write_text(ORT_JS, encoding="utf-8")
    (assets / "ort-wasm-simd-threaded-E5.wasm").write_bytes(ORT_WASM)


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A stand-in for the built viewer, laid out as ``bun run build`` lays it out."""
    directory = tmp_path / "dist"
    stand_in_dist(directory)
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


def pinned_stand_in() -> vectors.Model:
    return vectors.Model(
        name=vectors.MODEL.name,
        repository=vectors.MODEL.repository,
        revision=vectors.MODEL.revision,
        licence=vectors.MODEL.licence,
        files=(
            vectors.PinnedFile("onnx/model_quantized.onnx", sha(MODEL_BYTES)),
            vectors.PinnedFile("tokenizer.json", sha(TOKENIZER_BYTES)),
        ),
    )


@pytest.fixture
def model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A stand-in model pinned by its own hashes (the real one is 23 MB)."""
    directory = tmp_path / "model"
    (directory / "onnx").mkdir(parents=True)
    (directory / "onnx" / "model_quantized.onnx").write_bytes(MODEL_BYTES)
    (directory / "tokenizer.json").write_bytes(TOKENIZER_BYTES)
    (directory / "README.md").write_bytes(b"not a pinned file, never carried")
    pinned = pinned_stand_in()
    monkeypatch.setattr(view, "MODEL", pinned)
    monkeypatch.setattr(export, "MODEL", pinned)
    return directory


def copied(tmp_path: Path, source: str, name: str | None = None) -> Path:
    path = tmp_path / "in" / (name or source)
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(READING / source, path)
    return path


def settings(tmp_path: Path, text: str = SEMANTIC) -> Path:
    path = tmp_path / "views" / "view.yaml"
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def data_of(page: str) -> dict[str, object]:
    found = re.search(r'<script type="application/json" id="mosaic-export">(.*?)</script>', page)
    assert found, "the export holds no data element"
    return json.loads(found.group(1))


def carried_model(page: str) -> dict[str, object]:
    files = data_of(page)["model"]
    assert isinstance(files, dict)
    return files


def unpacked(text: object) -> bytes:
    return gzip.decompress(base64.b64decode(str(text)))


def run_export(
    tmp_path: Path, model_dir: Path | str | None, *, text: str | None = SEMANTIC, out: str = "o"
) -> tuple[int, Path]:
    target = tmp_path / "out" / f"{out}.html"
    target.parent.mkdir(exist_ok=True)
    args = ["export", str(copied(tmp_path, "mosaic.mosaic")), "-o", str(target)]
    if text is not None:
        args += ["--view", str(settings(tmp_path, text))]
    if model_dir is not None:
        args += ["--model", str(model_dir)]
    return main(args), target


# --- what the export carries (design, View file; section 6) ----------------------------------


def test_the_model_and_tokenizer_are_carried_byte_for_byte_whatever_their_bytes(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    # Section 6: the exact pinned files; binary content with NUL and non-UTF-8 bytes survives.
    code, out = run_export(tmp_path, model)
    assert code == 0
    page = out.read_text(encoding="utf-8")
    files = data_of(page)["model"]
    assert isinstance(files, dict)
    assert unpacked(files["model"]) == MODEL_BYTES
    assert unpacked(files["tokenizer"]) == TOKENIZER_BYTES


def test_only_the_two_pinned_files_are_carried_not_the_rest_of_the_model_directory(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    # Section 6 pins two files; a README or any other file beside them is not part of the model.
    (model / "onnx" / "model.onnx").write_bytes(b"UNPINNED-FULL-PRECISION-MODEL")
    code, out = run_export(tmp_path, model)
    assert code == 0
    page = out.read_bytes()
    carried_files = carried_model(page.decode("utf-8"))
    carried = b"".join(unpacked(v) for v in carried_files.values())
    assert b"UNPINNED" not in carried and b"never carried" not in carried
    assert b"UNPINNED" not in page and b"never carried" not in page
    assert sorted(carried_files) == ["model", "tokenizer"]


def test_the_runtime_travels_with_the_model_unchanged(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    # "the pinned model and tokenizer" and (commit title) ONNX Runtime; unchanged bytes.
    code, out = run_export(tmp_path, model)
    assert code == 0
    ort = data_of(out.read_text(encoding="utf-8"))["ort"]
    assert isinstance(ort, dict)
    assert unpacked(ort["module"]) == ORT_JS.encode()
    assert unpacked(ort["wasm"]) == ORT_WASM


def test_a_semantic_export_keeps_everything_a_text_export_holds(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    # The same page, mosaic, view and SQLite engine; the model only adds.
    _, semantic = run_export(tmp_path, model, out="semantic")
    _, text = run_export(tmp_path, None, text=TEXT, out="text")
    one = data_of(semantic.read_text(encoding="utf-8"))
    two = data_of(text.read_text(encoding="utf-8"))
    assert one["mosaic"] == two["mosaic"] and one["sqlite"] == two["sqlite"]
    assert one["name"] == two["name"]
    assert semantic.stat().st_size > text.stat().st_size
    assert "model" in one and "model" not in two and "ort" not in two


def test_without_view_the_default_search_is_semantic_and_carries_the_model(
    tmp_path: Path, dist: Path, model: Path
) -> None:
    # every key is optional and search defaults to semantic; a missing --view is the same.
    code, out = run_export(tmp_path, model, text=None)
    assert code == 0
    assert "model" in data_of(out.read_text(encoding="utf-8"))


# --- a wrong or missing model file exits 1 naming it -----------------------------


@pytest.mark.parametrize("path", ["onnx/model_quantized.onnx", "tokenizer.json"])
def test_each_missing_pinned_file_exits_1_naming_it_and_writes_nothing(
    path: str, tmp_path: Path, dist: Path, model: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (model / path).unlink()
    code, out = run_export(tmp_path, model)
    err = capsys.readouterr().err
    assert code == 1
    assert Path(path).name in err and "Traceback" not in err
    assert not out.exists()


@pytest.mark.parametrize("path", ["onnx/model_quantized.onnx", "tokenizer.json"])
@pytest.mark.parametrize("kind", ["empty", "appended", "truncated", "flipped"])
def test_each_pinned_file_with_other_bytes_exits_1_naming_it_and_both_hashes(
    path: str,
    kind: str,
    tmp_path: Path,
    dist: Path,
    model: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    good = (model / path).read_bytes()
    bad = {
        "empty": b"",
        "appended": good + b"\0",
        "truncated": good[:-1],
        "flipped": bytes([good[0] ^ 1]) + good[1:],
    }[kind]
    (model / path).write_bytes(bad)
    code, out = run_export(tmp_path, model)
    err = capsys.readouterr().err
    assert code == 1
    assert Path(path).name in err
    assert sha(bad) in err and sha(good) in err
    assert "Traceback" not in err
    assert not out.exists()


def test_the_pinned_hashes_are_those_of_section_6(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # No stand-in pins here: a directory of invented files is refused with the hashes the
    # specification gives, so the command is checking the real model.
    fake = tmp_path / "fake"
    (fake / "onnx").mkdir(parents=True)
    (fake / "onnx" / "model_quantized.onnx").write_bytes(b"not the model")
    (fake / "tokenizer.json").write_bytes(b"not the tokenizer")
    code, out = run_export(tmp_path, fake)
    err = capsys.readouterr().err
    assert code == 1
    assert SPEC_MODEL_HASH in err or SPEC_TOKENIZER_HASH in err
    assert not out.exists()


@pytest.mark.parametrize("breakage", ["missing", "changed", "empty"])
def test_the_error_of_export_names_what_the_error_of_view_names(
    breakage: str,
    tmp_path: Path,
    dist: Path,
    model: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # checked "as `mosaic view --model` checks them": the same file, the same hashes.
    tokenizer = model / "tokenizer.json"
    if breakage == "missing":
        tokenizer.unlink()
    else:
        tokenizer.write_bytes(b"" if breakage == "empty" else b"another")
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    mosaic = copied(tmp_path, "mosaic.mosaic")
    assert main(["view", str(mosaic), "--model", str(model)]) == 1
    seen = capsys.readouterr().err
    code, _ = run_export(tmp_path, model)
    got = capsys.readouterr().err
    assert code == 1
    for hash_ in re.findall(r"\b[0-9a-f]{64}\b", seen):
        assert hash_ in got
    assert "tokenizer.json" in got


# --- search: text and --model ----------------------------------------------------------------


# Answer B: with search: text the model is not used,
# as `mosaic view --model` does; the export is the text export and exits 0.


# --- the viewer build the export is made from -------------------------------------------------


@pytest.mark.parametrize("missing", ["ort.wasm.bundle.min-C3.js", "ort-wasm-simd-threaded-E5.wasm"])
def test_a_build_without_the_onnx_runtime_exits_1_and_writes_nothing(
    missing: str, tmp_path: Path, dist: Path, model: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # A semantic export with no runtime to carry cannot search by vectors offline: it must not
    # silently write a page that lacks it.
    (dist / "assets" / missing).unlink()
    code, out = run_export(tmp_path, model)
    err = capsys.readouterr().err
    assert code == 1 and "Traceback" not in err and err.startswith("mosaic export: ")
    assert not out.exists()


def test_a_text_export_does_not_need_the_onnx_runtime_in_the_build(
    tmp_path: Path, dist: Path
) -> None:
    for path in (dist / "assets").glob("ort*"):
        path.unlink()
    code, out = run_export(tmp_path, None, text=TEXT)
    assert code == 0 and "ort" not in data_of(out.read_text(encoding="utf-8"))


# --- the real built viewer and the real model (slow) -----------------------------------------


@pytest.mark.slow
def test_the_real_semantic_export_is_about_25_megabytes_and_fetches_nothing(tmp_path: Path) -> None:
    # Design, View file: `search: semantic` is "embedding model inside, about 25 MB". The model is
    # 23 MB (section 6) and the ONNX Runtime's WebAssembly 14 MB; both travel gzipped and base64.
    from tests.conftest import MODEL  # the files `scripts/fetch_model.py` puts in .cache

    if not (MODEL / "tokenizer.json").is_file():
        pytest.skip("the model is not fetched: uv run python scripts/fetch_model.py")
    bun = shutil.which("bun")
    assert bun, "bun is needed to build the viewer (README, Development)"
    built = subprocess.run(
        [bun, "run", "build"], cwd=REPO / "viewer", capture_output=True, text=True, check=False
    )
    assert built.returncode == 0, built.stdout + built.stderr
    mosaic = copied(tmp_path, "mosaic.mosaic")
    args = ["export", str(mosaic), "--view", str(settings(tmp_path)), "--model", str(MODEL)]
    one, two = tmp_path / "one.html", tmp_path / "two.html"
    assert main([*args, "-o", str(one)]) == 0
    assert main([*args, "-o", str(two)]) == 0
    size = one.stat().st_size
    print(f"\nreal semantic export of a {mosaic.stat().st_size}-byte mosaic: {size:,} bytes")
    print(f"sha256 {sha(one.read_bytes())}")
    assert one.read_bytes() == two.read_bytes()
    assert 20_000_000 < size < 32_000_000  # "about 25 MB", for a mosaic of 135 KB
    page = one.read_text(encoding="utf-8")
    assert re.search(r"<(script|link|img|iframe|source)\b[^>]*\b(src|href)=", page) is None
    data = data_of(page)
    model_files = data["model"]
    assert isinstance(model_files, dict)
    assert sha(unpacked(model_files["model"])) == SPEC_MODEL_HASH
    assert sha(unpacked(model_files["tokenizer"])) == SPEC_TOKENIZER_HASH
