"""``mosaic view --model DIR`` gives the page the model of section 6.

The model reaches the page at runtime from the directory given to ``mosaic view``, checked by
its pinned hashes (section 6), never bundled into the viewer build. With it, the page embeds
queries and ``find`` lists vector matches; without it, the page opens and searches by names and
full text only (section 3.8). A directory whose files are not the pinned ones is an error
naming the file and both hashes, with exit status 1, and no page opens.

These tests pin a stand-in model of two small files (the real one is 23 MB), so the checks run
fast; ``tests/fixtures/test_netflix_read.py`` (slow) gives the real model to the real viewer.
"""

import _thread
import hashlib
import http.client
import json
import shutil
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit

import pytest
from mosaic_build import view
from mosaic_build.cli import main
from mosaic_build.mosaic.vectors import MODEL, Model, PinnedFile

from tests.conftest import REPO
from tests.test_view import get, mosaic_url, snapshot

READING_MOSAIC = REPO / "conformance" / "reading" / "mosaic.mosaic"
FILES = {"onnx/model_quantized.onnx": b"stand-in model bytes", "tokenizer.json": b'{"model":{}}'}


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "dist"
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text("<!doctype html><title>viewer</title>", encoding="utf-8")
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def model(tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A directory whose two files are the pinned ones of a stand-in model, plus a bystander."""
    directory = tmp_path / "model"
    for path, data in FILES.items():
        (directory / path).parent.mkdir(parents=True, exist_ok=True)
        (directory / path).write_bytes(data)
    (directory / "README.md").write_bytes(README)
    pinned = Model(
        name=MODEL.name,
        repository=MODEL.repository,
        revision=MODEL.revision,
        licence=MODEL.licence,
        files=tuple(PinnedFile(path, sha(data)) for path, data in FILES.items()),
    )
    monkeypatch.setattr(view, "MODEL", pinned)
    return directory


def model_url(page: str) -> str | None:
    """The model's address, as the page resolves its ``?model=`` against its own, or None."""
    named = parse_qs(urlsplit(page).query).get("model")
    return None if named is None else urljoin(page, named[0])


class Browser:
    """Stands in for ``webbrowser.open``: fetches the model files, then stops the command."""

    def __init__(self) -> None:
        self.urls: list[str] = []
        self.fetched: dict[str, tuple[int, bytes, str]] = {}

    def __call__(self, url: str, *_: object, **__: object) -> bool:
        self.urls.append(url)

        def visit() -> None:
            try:
                self.fetched["mosaic"] = get(mosaic_url(url))
                base = model_url(url) or urljoin(url, "model/")
                for path in [*FILES, "README.md", "../file/x", "onnx"]:
                    self.fetched[path] = get(urljoin(base, path))
            finally:
                _thread.interrupt_main()

        threading.Thread(target=visit, daemon=True).start()
        return True


def test_view_with_a_model_gives_the_page_the_pinned_files(
    tmp_path: Path, dist: Path, model: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "m.mosaic"
    shutil.copyfile(READING_MOSAIC, path)
    files_before = {p: snapshot(model / p) for p in FILES}
    browser = Browser()
    monkeypatch.setattr("webbrowser.open", browser)

    assert main(["view", str(path), "--model", str(model)]) == 0

    (url,) = browser.urls
    assert model_url(url) is not None
    assert browser.fetched["mosaic"][:2] == (200, path.read_bytes())
    for p, data in FILES.items():
        assert browser.fetched[p][:2] == (200, data), p
    # Only the pinned files of the directory reach the page.
    for p in ["README.md", "onnx"]:
        assert browser.fetched[p][0] == 404, p
    assert {p: snapshot(model / p) for p in FILES} == files_before


def test_view_without_a_model_opens_the_page_with_no_model(
    tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser = Browser()
    monkeypatch.setattr("webbrowser.open", browser)
    assert main(["view", str(READING_MOSAIC)]) == 0
    (url,) = browser.urls
    assert model_url(url) is None
    assert browser.fetched["mosaic"][0] == 200
    for p in FILES:
        assert browser.fetched[p][0] == 404, p


@pytest.mark.parametrize("changed", sorted(FILES))
def test_a_model_file_with_another_hash_is_an_error_naming_the_file_and_both_hashes(
    changed: str,
    dist: Path,
    model: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    other = b"other bytes"
    (model / changed).write_bytes(other)
    assert main(["view", str(READING_MOSAIC), "--model", str(model)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("mosaic view: ")
    assert changed in err
    assert _sha(other) in err and _sha(FILES[changed]) in err
    assert (model / changed).read_bytes() == other


@pytest.mark.parametrize("missing", sorted(FILES))
def test_a_model_directory_without_a_pinned_file_is_an_error_naming_it(
    missing: str,
    dist: Path,
    model: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    (model / missing).unlink()
    assert main(["view", str(READING_MOSAIC), "--model", str(model)]) == 1
    assert missing in capsys.readouterr().err


def test_a_model_that_is_no_directory_is_an_error_naming_it(
    tmp_path: Path,
    dist: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    nothing = tmp_path / "no-model"
    assert main(["view", str(READING_MOSAIC), "--model", str(nothing)]) == 1
    assert str(nothing) in capsys.readouterr().err


def test_a_refused_mosaic_is_refused_before_the_model_is_read(
    dist: Path,
    model: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    refused = READING_MOSAIC.with_name("application-id.mosaic")
    assert main(["view", str(refused), "--model", str(model)]) == 1
    assert "application_id" in capsys.readouterr().err


def test_the_served_model_is_the_bytes_that_were_checked(dist: Path, model: Path) -> None:
    files = view.checked_model(model)
    assert files == FILES
    data = READING_MOSAIC.read_bytes()
    server, url = view.serve(view.viewer_dist(), "m.mosaic", data, model=files)
    try:
        # A change to the directory after the check never reaches the page.
        (model / "tokenizer.json").write_bytes(b"changed afterwards")
        base = model_url(url)
        assert base is not None
        assert get(urljoin(base, "tokenizer.json"))[:2] == (200, FILES["tokenizer.json"])
        post = urllib.request.Request(urljoin(base, "tokenizer.json"), data=b"x", method="POST")
        with pytest.raises(urllib.error.HTTPError) as no:
            urllib.request.urlopen(post, timeout=10)
        assert no.value.code == 501
    finally:
        server.shutdown()
        server.server_close()


READING = REPO / "conformance" / "reading"
CASES = json.loads((READING / "cases.json").read_text(encoding="utf-8"))
OPENS = sorted(name for name, case in CASES.items() if case["opens"])
README = b"not a pinned file, and secret"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tree(directory: Path) -> dict[str, tuple[bytes | None, int]]:
    """Every entry under ``directory`` with its bytes (None for a directory) and mtime."""
    found: dict[str, tuple[bytes | None, int]] = {}
    for p in sorted(directory.rglob("*")):
        key = p.relative_to(directory).as_posix()
        found[key] = (p.read_bytes() if p.is_file() else None, p.stat().st_mtime_ns)
    return found


def model_base(page: str) -> str:
    (named,) = parse_qs(urlsplit(page).query)["model"]
    return urljoin(page, named)


class Visitor:
    """A browser stand-in: runs ``action(url)`` on a thread, then stops the command."""

    def __init__(self, action: Callable[[str], Any]) -> None:
        self.action = action
        self.urls: list[str] = []
        self.result: Any = None
        self.error: BaseException | None = None

    def __call__(self, url: str, *_: object, **__: object) -> bool:
        self.urls.append(url)

        def go() -> None:
            try:
                self.result = self.action(url)
            except BaseException as e:
                self.error = e
            finally:
                _thread.interrupt_main()

        threading.Thread(target=go, daemon=True).start()
        return True


def view_with(
    args: list[str], monkeypatch: pytest.MonkeyPatch, action: Callable[[str], Any]
) -> tuple[int, Visitor]:
    visitor = Visitor(action)
    monkeypatch.setattr("webbrowser.open", visitor)
    code = main(["view", *args])
    if visitor.error:
        raise visitor.error
    return code, visitor


def no_page(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))


def raw(url: str, path: str, method: str = "GET") -> tuple[int, bytes, dict[str, str]]:
    """A request whose path is sent exactly as given, so no client tidies it first."""
    parts = urlsplit(url)
    assert parts.hostname is not None
    connection = http.client.HTTPConnection(parts.hostname, parts.port, timeout=10)
    try:
        connection.putrequest(method, path, skip_accept_encoding=True)
        connection.endheaders()
        response = connection.getresponse()
        return response.status, response.read(), dict(response.getheaders())
    finally:
        connection.close()


# --- the model directory itself ---------------------------------------------------------------


def test_the_files_of_another_model_directory_name_are_looked_up_by_pinned_path_not_by_name(
    model: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The right bytes under the wrong path are no model: the file is missing at its path."""
    no_page(monkeypatch)
    (model / "tokenizer.json").rename(model / "Tokenizer.json.bak")
    assert main(["view", str(READING / "mosaic.mosaic"), "--model", str(model)]) == 1
    assert "tokenizer.json" in capsys.readouterr().err


def test_a_model_given_with_a_tessera_opens_it_too(
    model: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code, visitor = view_with(
        [str(READING / "tessera.tessera"), "--model", str(model)],
        monkeypatch,
        lambda page: urllib.request.urlopen(urljoin(model_base(page), "tokenizer.json")).read(),
    )
    assert code == 0 and visitor.result == FILES["tokenizer.json"]


def test_the_model_directory_is_left_exactly_as_it_was(
    model: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = tree(model)
    code, _ = view_with(
        [str(READING / "mosaic.mosaic"), "--model", str(model)],
        monkeypatch,
        lambda page: urllib.request.urlopen(urljoin(model_base(page), "tokenizer.json")).read(),
    )
    assert code == 0
    assert tree(model) == before


# --- the model never loosens the reading rules (section 3.8) ----------------------------------


@pytest.mark.parametrize("name", OPENS)
def test_a_file_the_reading_rules_accept_opens_with_a_model_of_another_vector_model(
    name: str, model: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Section 3.8: a reader that does not support the file's embedding model still opens it."""
    code, visitor = view_with(
        [str(READING / name), "--model", str(model)], monkeypatch, lambda _: 0
    )
    assert code == 0 and len(visitor.urls) == 1


# --- what the server hands out (section 10: nothing beyond the pinned files) ------------------


@pytest.mark.parametrize(
    "tail",
    [
        "README.md",
        "onnx",
        "onnx/",
        "tokenizer.json/",
        "tokenizer.json/extra",
        "onnx/../README.md",
        "%2e%2e/README.md",
        "..%2fREADME.md",
        "onnx/..%2fREADME.md",
        "%2e%2e%2f%2e%2e%2fmodel%2fREADME.md",
        "..\\README.md",
        "onnx\\..\\README.md",
        "tokenizer.json%00.md",
        "TOKENIZER.JSON",
        "onnx/MODEL_QUANTIZED.ONNX",
        "tokenizer.json.bak",
    ],
)
def test_nothing_but_the_pinned_files_is_served_under_the_model_address(
    tail: str, model: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (model / "tokenizer.json.bak").write_bytes(README)

    def ask(page: str) -> tuple[int, bytes]:
        base = model_base(page)
        status, body, _ = raw(base, urlsplit(base).path + tail)
        return status, body

    code, visitor = view_with(
        [str(READING / "mosaic.mosaic"), "--model", str(model)], monkeypatch, ask
    )
    assert code == 0
    status, body = visitor.result
    assert README not in body and b"secret" not in body
    assert not (status == 200 and body in FILES.values()), "a pinned file under another name"
    assert 400 <= status < 500, status


def test_the_model_is_read_only_over_http(model: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def ask(page: str) -> list[int]:
        base = model_base(page)
        codes = []
        for method in ["POST", "PUT", "DELETE", "PATCH"]:
            codes.append(raw(base, urlsplit(base).path + "tokenizer.json", method)[0])
        return codes

    before = tree(model)
    code, visitor = view_with(
        [str(READING / "mosaic.mosaic"), "--model", str(model)], monkeypatch, ask
    )
    assert code == 0
    assert all(400 <= c < 600 for c in visitor.result), visitor.result
    assert tree(model) == before


def test_without_a_model_the_model_address_serves_nothing_and_the_page_names_none(
    dist: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def ask(page: str) -> list[int]:
        origin = f"{urlsplit(page).scheme}://{urlsplit(page).netloc}"
        return [raw(origin, f"/model/{p}")[0] for p in FILES]

    code, visitor = view_with([str(READING / "mosaic.mosaic")], monkeypatch, ask)
    assert code == 0
    assert all(c == 404 for c in visitor.result), visitor.result
    (url,) = visitor.urls
    assert "model" not in parse_qs(urlsplit(url).query)


def test_the_page_address_with_a_model_names_both_the_mosaic_and_the_model(
    model: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code, visitor = view_with(
        [str(READING / "mosaic.mosaic"), "--model", str(model)], monkeypatch, lambda _: 0
    )
    assert code == 0
    (url,) = visitor.urls
    assert set(parse_qs(urlsplit(url).query)) >= {"mosaic", "model"}
