"""``mosaic view``: opens the viewer page with a mosaic loaded, with no query server.

docs/design.md (Implementation plan: Viewer); Specification 0.1, section 3.8. The command
applies the reading rules (steps 1 to 3) itself before a page opens; a missing or refused file
is an error naming the file and what failed, with exit status 1. The page's kit refuses the
same files by the same rules: ``kit/test/open.test.ts`` and ``kit/test/hashes.test.ts`` read
the same ``conformance/reading/`` cases.

These tests serve a stand-in for the built viewer; ``tests/viewer/test_view_page.py`` (slow)
builds the real one and opens it in Chromium.
"""

import _thread
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

import pytest
from mosaic_build import view
from mosaic_build.cli import main
from mosaic_format.file import SIDECARS

from tests.conftest import REPO

READING = REPO / "conformance" / "reading"
CASES = json.loads((READING / "cases.json").read_text(encoding="utf-8"))
HASHES = {"knowledge_hash", "vector_hash"}
"""The rules ``mosaic view`` leaves to the page: it checks the hashes once the mosaic shows, and
warns when they differ."""
OPENS = sorted(name for name, case in CASES.items() if case["opens"] or case["rule"] in HASHES)
REFUSED = sorted(set(CASES) - set(OPENS))


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A stand-in for the built viewer: a page and one asset."""
    directory = tmp_path / "dist"
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text("<!doctype html><title>viewer</title>", encoding="utf-8")
    (directory / "assets" / "page.js").write_text("export {};", encoding="utf-8")
    (directory / "assets" / "engine.wasm").write_bytes(b"\0asm")
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


def get(url: str) -> tuple[int, bytes, str]:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, b"", ""


def mosaic_url(page: str) -> str:
    """The mosaic's address, as the page resolves its ``?mosaic=`` against its own."""
    (named,) = parse_qs(urlsplit(page).query)["mosaic"]
    return urljoin(page, named)


class Browser:
    """Stands in for ``webbrowser.open``: fetches what a page would, then stops the command."""

    def __init__(self) -> None:
        self.urls: list[str] = []
        self.fetched: dict[str, tuple[int, bytes, str]] = {}

    def __call__(self, url: str, *_: object, **__: object) -> bool:
        self.urls.append(url)

        def visit() -> None:
            try:
                self.fetched["page"] = get(url)
                self.fetched["asset"] = get(urljoin(url, "assets/page.js"))
                self.fetched["wasm"] = get(urljoin(url, "assets/engine.wasm"))
                self.fetched["mosaic"] = get(mosaic_url(url))
            finally:
                _thread.interrupt_main()

        threading.Thread(target=visit, daemon=True).start()
        return True


def snapshot(path: Path) -> tuple[str, int, list[str]]:
    beside = sorted(p.name for p in path.parent.iterdir())
    return hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns, beside


@pytest.mark.parametrize("name", OPENS)
def test_view_opens_the_page_with_the_mosaic_loaded_and_leaves_the_file_unchanged(
    name: str,
    tmp_path: Path,
    dist: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    path = tmp_path / "files" / name
    path.parent.mkdir()
    shutil.copyfile(READING / name, path)
    before = snapshot(path)
    browser = Browser()
    monkeypatch.setattr("webbrowser.open", browser)

    assert main(["view", str(path)]) == 0

    (url,) = browser.urls
    assert urlsplit(url).hostname == "127.0.0.1"
    out = capsys.readouterr().out
    assert url in out and str(path) in out
    status, body, kind = browser.fetched["page"]
    assert (status, body) == (200, (dist / "index.html").read_bytes()) and kind.startswith(
        "text/html"
    )
    assert browser.fetched["asset"][0] == 200
    assert browser.fetched["wasm"][2] == "application/wasm"
    status, body, _ = browser.fetched["mosaic"]
    assert (status, body) == (200, path.read_bytes())
    # The page names the file by the last part of the mosaic's address.
    assert mosaic_url(url).rsplit("/", 1)[1] == name
    assert snapshot(path) == before
    assert not any(path.with_name(path.name + s).exists() for s in SIDECARS)


@pytest.mark.parametrize("name", REFUSED)
def test_view_refuses_a_file_the_reading_rules_refuse_and_opens_no_page(
    name: str,
    dist: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    opened: list[str] = []
    monkeypatch.setattr("webbrowser.open", lambda url, *a, **k: opened.append(url))
    path = READING / name
    before = snapshot(path)
    assert main(["view", str(path)]) == 1
    assert opened == []
    err = capsys.readouterr().err
    assert err.startswith(f"mosaic view: {path}: ")
    with pytest.raises(Exception) as refused:
        view.checked_bytes(path)
    assert str(refused.value) in err
    assert snapshot(path) == before


def test_view_names_the_rule_a_file_breaks(dist: Path, capsys: pytest.CaptureFixture[str]) -> None:
    words = {
        "application-id.mosaic": "application_id",
        "user-version.mosaic": "user_version",
        "format-version.mosaic": "0.2",
        "newer-minor.mosaic": "0.2",
        "schema-extra-table.mosaic": "schema",
    }
    for name, word in words.items():
        assert main(["view", str(READING / name)]) == 1
        assert word in capsys.readouterr().err.lower(), name


def test_view_of_a_missing_file_is_an_error_naming_it(
    tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    missing = tmp_path / "nothing.mosaic"
    assert main(["view", str(missing)]) == 1
    assert capsys.readouterr().err.startswith(f"mosaic view: {missing}: ")
    assert main(["view", str(tmp_path)]) == 1
    assert capsys.readouterr().err.startswith(f"mosaic view: {tmp_path}: ")


def test_view_without_a_built_viewer_says_how_to_build_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(view, "VIEWER_DIST", tmp_path / "no-dist")
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    assert main(["view", str(READING / "mosaic.mosaic")]) == 1
    assert str(tmp_path / "no-dist") in capsys.readouterr().err


def test_view_needs_a_file(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["view"])
    assert exit_info.value.code == 2


def test_the_server_hands_out_only_the_viewer_and_the_mosaic(dist: Path, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("not yours", encoding="utf-8")
    data = (READING / "mosaic.mosaic").read_bytes()
    server, url = view.serve(view.viewer_dist(), "m.mosaic", data)
    try:
        root = f"http://127.0.0.1:{server.server_address[1]}"
        assert get(f"{root}/file/m.mosaic")[:2] == (200, data)
        for path in [
            "/file/other.mosaic",
            "/../secret.txt",
            "/%2e%2e/secret.txt",
            "/assets/../../secret.txt",
            "/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
            "/assets",
            "/nothing",
            "/%00",
            "/assets/%00.js",
            "/" + "a" * 5000,
        ]:
            assert get(root + path)[0] == 404, path
        post = urllib.request.Request(f"{root}/file/m.mosaic", data=b"x", method="POST")
        with pytest.raises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(post, timeout=10)
        assert refused.value.code == 501
        assert get(url)[0] == 200
    finally:
        server.shutdown()
        server.server_close()


def test_view_runs_as_a_command_until_it_is_stopped(tmp_path: Path, dist: Path) -> None:
    """A process of its own, with a browser that records the address and fetches the file."""
    path = tmp_path / "m.mosaic"
    shutil.copyfile(READING / "mosaic.mosaic", path)
    before = snapshot(path)
    seen = tmp_path / "seen.json"
    browser = tmp_path / "browser.py"
    browser.write_text(
        "import json, sys, urllib.request\n"
        "from urllib.parse import parse_qs, unquote, urljoin, urlsplit\n"
        "url = sys.argv[1]\n"
        "named = urljoin(url, parse_qs(urlsplit(url).query)['mosaic'][0])\n"
        "page = urllib.request.urlopen(url).read()\n"
        "data = urllib.request.urlopen(named).read()\n"
        f"open({str(seen)!r}, 'w').write(json.dumps({{'url': url, 'page': len(page), "
        "'sha': __import__('hashlib').sha256(data).hexdigest()}))\n",
        encoding="utf-8",
    )
    env = {**os.environ, "BROWSER": f"{sys.executable} {browser} %s"}
    command = (
        "import sys; from mosaic_build import view; from mosaic_build.cli import main; "
        f"view.VIEWER_DIST = __import__('pathlib').Path({str(dist)!r}); "
        "sys.exit(main(sys.argv[1:]))"
    )
    proc = subprocess.Popen(
        [sys.executable, "-c", command, "view", str(path)],
        env=env,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 30
        while not seen.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert seen.exists(), "the browser was not opened"
        got = json.loads(seen.read_text(encoding="utf-8"))
    finally:
        proc.send_signal(2)
        out, _ = proc.communicate(timeout=30)
    assert proc.returncode == 0
    assert got["url"] in out
    assert got["page"] > 0
    assert got["sha"] == before[0]
    assert snapshot(path)[0] == before[0] and snapshot(path)[1] == before[1]


@pytest.fixture
def stand_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "dist"
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text("<!doctype html><title>viewer</title>", encoding="utf-8")
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


class Visitor:
    """A browser stand-in: runs ``action(url)`` on a thread, then stops the command."""

    def __init__(self, action: Callable[[str], Any]) -> None:
        self.action = action
        self.urls: list[str] = []
        self.result: Any = None
        self.error: BaseException | None = None

    def __call__(self, url: str, *_: object, **__: object) -> bool:
        self.urls.append(url)

        def visit() -> None:
            try:
                self.result = self.action(url)
            except BaseException as e:
                self.error = e
            finally:
                _thread.interrupt_main()

        threading.Thread(target=visit, daemon=True).start()
        return True


def mosaic_address(page: str) -> str:
    (named,) = parse_qs(urlsplit(page).query)["mosaic"]
    return urljoin(page, named)


def fetch(url: str) -> tuple[int, bytes, dict[str, str]]:
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status, response.read(), dict(response.headers)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_view(
    path: Path | str, monkeypatch: pytest.MonkeyPatch, action: Callable[[str], Any]
) -> tuple[int, Visitor]:
    visitor = Visitor(action)
    monkeypatch.setattr("webbrowser.open", visitor)
    code = main(["view", str(path)])
    if visitor.error:
        raise visitor.error
    return code, visitor


@pytest.mark.parametrize(
    "name", ["100%.mosaic", "a?b.mosaic", "plus+sign.mosaic", "%2e%2e.mosaic", "a%2Fb.mosaic"]
)
def test_special_characters_in_a_file_name_reach_the_page_whole(
    name: str, tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # design.md (Viewer): the page loads the file the command was given.
    path = tmp_path / name
    shutil.copyfile(READING / "mosaic.mosaic", path)
    code, visitor = run_view(path, monkeypatch, lambda url: fetch(mosaic_address(url)))
    assert code == 0
    status, body, _ = visitor.result
    assert (status, body) == (200, path.read_bytes())
    assert unquote(mosaic_address(visitor.urls[0]).rsplit("/", 1)[1]) == name


def test_a_read_only_file_in_a_read_only_directory_opens_without_a_sidecar(
    tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 3.8 step 1: opened read-only and immutable, even for a WAL-mode file (wal.mosaic).
    folder = tmp_path / "ro"
    folder.mkdir()
    path = folder / "wal.mosaic"
    shutil.copyfile(READING / "wal.mosaic", path)
    path.chmod(0o444)
    folder.chmod(0o555)
    try:
        code, visitor = run_view(path, monkeypatch, lambda url: fetch(mosaic_address(url)))
        names = sorted(p.name for p in folder.iterdir())
    finally:
        folder.chmod(0o755)
    assert code == 0
    assert visitor.result[:2] == (200, path.read_bytes())
    assert names == ["wal.mosaic"]


def test_the_server_listens_on_the_loopback_address_only(
    tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # design.md: no query server; the page is served to this machine only.
    shutil.copyfile(READING / "mosaic.mosaic", tmp_path / "m.mosaic")

    def probe(url: str) -> bool:
        port = urlsplit(url).port
        assert port is not None
        with socket.socket() as s:
            s.settimeout(3)
            return s.connect_ex(("127.0.0.2", port)) == 0  # another loopback address

    code, visitor = run_view(tmp_path / "m.mosaic", monkeypatch, probe)
    assert code == 0 and visitor.result is False


def test_the_server_is_stopped_when_the_command_returns(
    tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "m.mosaic"
    shutil.copyfile(READING / "mosaic.mosaic", path)
    code, visitor = run_view(path, monkeypatch, lambda url: fetch(url)[0])
    assert code == 0 and visitor.result == 200
    port = urlsplit(visitor.urls[0]).port
    with socket.socket() as s:
        s.settimeout(3)
        assert s.connect_ex(("127.0.0.1", port)) != 0


def test_a_refused_file_prints_nothing_on_stdout(
    stand_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # No page, so no address is announced.
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    for name in REFUSED:
        assert main(["view", str(READING / name)]) == 1, name
        captured = capsys.readouterr()
        assert captured.out == "", name
        assert str(READING / name) in captured.err, name


def test_view_with_two_files_is_a_usage_error(stand_in: Path) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["view", str(READING / "mosaic.mosaic"), str(READING / "tessera.tessera")])
    assert exit_info.value.code == 2


def visit(
    path: Path | str, monkeypatch: pytest.MonkeyPatch, action: Callable[[str], Any]
) -> tuple[int, list[str], Any]:
    urls: list[str] = []
    box: dict[str, Any] = {}

    def browser(url: str, *_: object, **__: object) -> bool:
        urls.append(url)

        def work() -> None:
            try:
                box["result"] = action(url)
            except BaseException as e:
                box["error"] = e
            finally:
                _thread.interrupt_main()

        threading.Thread(target=work, daemon=True).start()
        return True

    monkeypatch.setattr("webbrowser.open", browser)
    code = main(["view", str(path)])
    if "error" in box:
        raise box["error"]
    return code, urls, box.get("result")


def read(url: str, method: str = "GET") -> tuple[int, bytes]:
    request = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads any file")
def test_an_unreadable_file_is_an_error_naming_it(
    tmp_path: Path,
    stand_in: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    path = tmp_path / "locked.mosaic"
    shutil.copyfile(READING / "mosaic.mosaic", path)
    path.chmod(0)
    assert main(["view", str(path)]) == 1
    err = capsys.readouterr().err
    assert str(path) in err and "Traceback" not in err


@pytest.mark.parametrize("suffix", ["-wal", "-journal"])
def test_a_sidecar_beside_the_file_refuses_it_and_nothing_is_written(
    suffix: str,
    tmp_path: Path,
    stand_in: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # 3.1: a file has "no journal or write-ahead log beside it"; 3.8 step 1: read-only, so a
    # refusal must not recover, checkpoint or delete the sidecar either.
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: pytest.fail("a page was opened"))
    path = tmp_path / "m.mosaic"
    shutil.copyfile(READING / "mosaic.mosaic", path)
    side = tmp_path / ("m.mosaic" + suffix)
    side.write_bytes(b"not a real sidecar" * 50)
    before = (path.read_bytes(), side.read_bytes(), sorted(p.name for p in tmp_path.iterdir()))
    assert main(["view", str(path)]) == 1
    err = capsys.readouterr().err
    assert str(path) in err and "Traceback" not in err
    after = (path.read_bytes(), side.read_bytes(), sorted(p.name for p in tmp_path.iterdir()))
    assert after == before


def test_the_page_address_does_not_depend_on_the_query_string_it_is_asked_with(
    tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # design.md: the page is the viewer; the file travels in the address, not in a server query.
    shutil.copyfile(READING / "mosaic.mosaic", tmp_path / "m.mosaic")

    def probe(url: str) -> list[tuple[int, bytes]]:
        base = url.split("?", 1)[0]
        return [read(url), read(base), read(base + "?mosaic=other.mosaic"), read(url, "HEAD")]

    code, _, result = visit(tmp_path / "m.mosaic", monkeypatch, probe)
    assert code == 0
    page = (stand_in / "index.html").read_bytes()
    assert result[0] == (200, page)
    assert result[1] == (200, page)
    assert result[2][0] == 200
    assert result[3] == (200, b"") or result[3][0] in (200, 501)


def test_the_mosaic_can_be_read_by_a_head_request_without_a_body_or_not_at_all(
    tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    shutil.copyfile(READING / "mosaic.mosaic", tmp_path / "m.mosaic")
    code, _, result = visit(
        tmp_path / "m.mosaic", monkeypatch, lambda url: read(mosaic_address(url), "HEAD")
    )
    assert code == 0
    assert result[0] in (200, 405, 501)
    assert result[1] == b""


def test_two_servers_at_once_each_serve_their_own_file(
    tmp_path: Path, stand_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Two commands may run together: addresses differ and each gives its own file.
    first = tmp_path / "first.mosaic"
    shutil.copyfile(READING / "mosaic.mosaic", first)
    other = (READING / "tessera.tessera").read_bytes()

    def second(url: str) -> tuple[str, bytes, bytes]:
        server, page = view.serve(view.viewer_dist(), "second.tessera", other)
        try:
            root = f"http://127.0.0.1:{server.server_address[1]}"
            assert page.startswith(root)
            return root, read(f"{root}/file/second.tessera")[1], read(mosaic_address(url))[1]
        finally:
            server.shutdown()
            server.server_close()

    code, urls, result = visit(first, monkeypatch, second)
    assert code == 0
    root, from_second, from_first = result
    assert not urls[0].startswith(root)
    assert (from_second, from_first) == (other, first.read_bytes())


def test_unknown_options_are_a_usage_error(stand_in: Path) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["view", "--port", "1", str(READING / "mosaic.mosaic")])
    assert exit_info.value.code == 2
