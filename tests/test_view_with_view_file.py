"""``mosaic view FILE --view VIEW``: the page shaped by a view file, reloaded on save.

docs/design.md, Implementation plan, "View file": "used by both view and export"; "mosaic view
watches it and reloads the page on save". The command reads the view file once before any page
opens: a wrong one is the view-file reader's error naming the file, the line and the
setting, exit status 1, and
no page opens. While the page is open, the server hands it the file's current settings at
``view.json`` (``ViewSettings.as_json``), read again on each request, so a saved file reaches the
page without restarting the command; a file saved with an error answers that error, and the
page keeps what it shows.
"""

import _thread
import json
import os
import shutil
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit

import pytest
from mosaic_build import view, view_file
from mosaic_build.cli import main

from tests.conftest import REPO

MOSAIC = REPO / "conformance" / "reading" / "mosaic.mosaic"
VIEW = "types:\n  Item:\n    label: Thing\n"


@pytest.fixture
def dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "dist"
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text("<!doctype html><title>viewer</title>", encoding="utf-8")
    monkeypatch.setattr(view, "VIEWER_DIST", directory)
    return directory


def fetch(url: str) -> tuple[int, bytes, str]:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "")


def view_url(page: str) -> str:
    """The view file's settings' address, as the page resolves its ``?view=`` against its own."""
    (named,) = parse_qs(urlsplit(page).query)["view"]
    return urljoin(page, named)


def mosaic_copy(tmp_path: Path) -> Path:
    path = tmp_path / "files" / "mosaic.mosaic"
    path.parent.mkdir()
    shutil.copyfile(MOSAIC, path)
    return path


def test_a_missing_view_file_exits_1_naming_it(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    missing = tmp_path / "absent.yaml"
    assert main(["view", str(mosaic_copy(tmp_path)), "--view", str(missing)]) == 1
    assert str(missing) in capsys.readouterr().err


class Browser:
    """Stands in for ``webbrowser.open``: runs ``visit`` on the address, then stops the command."""

    def __init__(self, visit: Callable[[str], object]) -> None:
        self.visit = visit
        self.urls: list[str] = []
        self.error: BaseException | None = None

    def __call__(self, url: str, *_: object, **__: object) -> bool:
        self.urls.append(url)

        def run() -> None:
            try:
                self.visit(url)
            except BaseException as e:  # reported by the test, after the command stops
                self.error = e
            finally:
                _thread.interrupt_main()

        threading.Thread(target=run, daemon=True).start()
        return True


def test_the_page_gets_the_current_settings_read_again_on_each_request(
    tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "view.yaml"
    path.write_text(VIEW, encoding="utf-8")
    seen: list[tuple[int, dict[str, object], str]] = []

    def visit(url: str) -> None:
        def settings() -> tuple[int, dict[str, object], str]:
            status, body, kind = fetch(view_url(url))
            return status, json.loads(body), kind

        seen.append(settings())
        path.write_text("search: text\n", encoding="utf-8")
        seen.append(settings())
        path.write_text("search: fuzzy\n", encoding="utf-8")
        seen.append(settings())
        path.write_text(VIEW, encoding="utf-8")
        seen.append(settings())

    browser = Browser(visit)
    monkeypatch.setattr("webbrowser.open", browser)
    before = path.read_bytes()
    assert main(["view", str(mosaic_copy(tmp_path)), "--view", str(path)]) == 0
    assert browser.error is None, browser.error
    first, second, broken, fixed = seen
    assert first == (200, view_file.read(path).as_json(), "application/json")
    assert second[0] == 200 and second[1]["search"] == "text"
    status, body, _ = broken
    assert status == 422
    message = f"{path}:1: view file: search must be one of semantic, text, not 'fuzzy'"
    assert body == {"error": message}
    assert fixed == first
    assert path.read_bytes() == before  # the command never writes the view file


def test_without_a_view_file_the_page_is_named_none(
    tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    got: list[tuple[int, bytes, str]] = []
    browser = Browser(lambda url: got.append(fetch(urljoin(url, "view.json"))))
    monkeypatch.setattr("webbrowser.open", browser)
    assert main(["view", str(mosaic_copy(tmp_path))]) == 0
    (url,) = browser.urls
    assert "view" not in parse_qs(urlsplit(url).query)
    assert got[0][0] == 404


def test_the_address_names_the_settings_beside_the_mosaic_and_the_model() -> None:
    url = view.page_url(8000, "a.mosaic", model=True, view=True)
    query = parse_qs(urlsplit(url).query)
    assert query["mosaic"] == ["file/a.mosaic"]
    assert query["model"] == ["model/"]
    assert query["view"] == ["view.json"]
    assert "view" not in parse_qs(urlsplit(view.page_url(8000, "a.mosaic")).query)


@pytest.fixture
def mosaic(tmp_path: Path) -> Path:
    path = tmp_path / "files" / "mosaic.mosaic"
    path.parent.mkdir()
    shutil.copyfile(MOSAIC, path)
    return path


def get(url: str, method: str = "GET", data: bytes | None = None) -> tuple[int, bytes, Any]:
    request = urllib.request.Request(url, method=method, data=data)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def settings_url(page: str) -> str:
    (named,) = parse_qs(urlsplit(page).query)["view"]
    return urljoin(page, named)


def run_view(
    args: list[str], monkeypatch: pytest.MonkeyPatch, action: Callable[[str], Any]
) -> tuple[int, list[str], Any]:
    """Run ``mosaic view ARGS``; ``action`` gets the page address, then the command is stopped."""
    urls: list[str] = []
    box: dict[str, Any] = {}

    def browser(url: str, *_: object, **__: object) -> bool:
        urls.append(url)

        def work() -> None:
            try:
                box["result"] = action(url)
            except BaseException as e:  # reported by the test, after the command stops
                box["error"] = e
            finally:
                _thread.interrupt_main()

        threading.Thread(target=work, daemon=True).start()
        return True

    monkeypatch.setattr("webbrowser.open", browser)
    code = main(["view", *args])
    if "error" in box:
        raise box["error"]
    return code, urls, box.get("result")


def refused(
    args: list[str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> str:
    """Run a command that must exit 1 with no page; return its stderr."""
    opened: list[str] = []
    monkeypatch.setattr("webbrowser.open", lambda url, *a, **k: opened.append(url) or True)
    served: list[object] = []
    monkeypatch.setattr(view, "serve", lambda *a, **k: served.append(a))
    assert main(["view", *args]) == 1
    assert opened == [] and served == []
    return capsys.readouterr().err


# A wrong view file: exit 1, the file named, no page.


@pytest.mark.parametrize(
    ("text", "line", "setting"),
    [
        ("search: fuzzy\n", 1, "search"),
        ("# c\n\n\ntheme: sepia\n", 4, "theme"),
        ("types:\n  A:\n    colour: red\n", 3, "colour"),
        ("colour: red\n", 1, "colour"),
        ("types:\n  A: {}\n  A: {}\n", 3, "A"),
    ],
)
def test_wrong_view_file_names_file_line_and_setting(
    text: str,
    line: int,
    setting: str,
    tmp_path: Path,
    dist: Path,
    mosaic: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    bad = tmp_path / "v.yaml"
    bad.write_text(text, encoding="utf-8")
    err = refused([str(mosaic), "--view", str(bad)], monkeypatch, capsys)
    assert f"{bad}:{line}:" in err
    assert setting in err


@pytest.mark.parametrize("content", [b"\xff\xfe\x00bad", b"search: text\n\x00\n", b"{{{"])
def test_corrupt_view_file_is_an_error_naming_it_not_a_crash(
    content: bytes,
    tmp_path: Path,
    dist: Path,
    mosaic: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    bad = tmp_path / "v.yaml"
    bad.write_bytes(content)
    err = refused([str(mosaic), "--view", str(bad)], monkeypatch, capsys)
    assert str(bad) in err
    assert "Traceback" not in err


# A right view file: the page is shaped by it.


def test_empty_view_file_gives_the_defaults_and_opens_the_page(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Answer: every key is optional, so an empty view file gives M2's viewer."""
    path = tmp_path / "empty.yaml"
    path.write_bytes(b"")
    code, urls, got = run_view(
        [str(mosaic), "--view", str(path)], monkeypatch, lambda u: get(settings_url(u))
    )
    assert code == 0 and len(urls) == 1
    status, body, _ = got
    assert status == 200
    assert json.loads(body) == view_file.read(path).as_json()
    assert json.loads(body)["search"] == "semantic"


def test_types_come_in_the_order_the_file_writes_them_and_unicode_survives(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Answer: types appear in the order the file writes them."""
    path = tmp_path / "v.yaml"
    path.write_text(
        "types:\n  Zed:\n    label: Zèbre ✓\n  Alpha: {}\n  Mid: {}\n", encoding="utf-8"
    )
    code, _, got = run_view(
        [str(mosaic), "--view", str(path)], monkeypatch, lambda u: get(settings_url(u))
    )
    assert code == 0
    text = got[1].decode("utf-8")
    assert text.index("Zed") < text.index("Alpha") < text.index("Mid")
    assert "Zèbre ✓" in text or "Z\\u00e8bre" in text
    assert "Zèbre ✓" in json.dumps(json.loads(text), ensure_ascii=False)


# While the page is open.


def test_an_editor_that_saves_by_renaming_a_new_file_over_it_is_seen(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "v.yaml"
    path.write_text("search: semantic\n", encoding="utf-8")

    def visit(page: str) -> list[Any]:
        seen = [json.loads(get(settings_url(page))[1])["search"]]
        temp = tmp_path / "v.yaml.swp"
        temp.write_text("search: text\n", encoding="utf-8")
        os.replace(temp, path)
        seen.append(json.loads(get(settings_url(page))[1])["search"])
        return seen

    code, _, got = run_view([str(mosaic), "--view", str(path)], monkeypatch, visit)
    assert code == 0 and got == ["semantic", "text"]


def test_a_file_saved_with_each_kind_of_error_answers_an_error_and_the_server_lives_on(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "v.yaml"
    path.write_text("search: text\n", encoding="utf-8")
    broken = [b"search: fuzzy\n", b"\xff\xfe\x00", b"{{{", b"search: text\nsearch: text\n"]

    def visit(page: str) -> list[tuple[int, dict[str, Any]]]:
        out = []
        for content in broken:
            path.write_bytes(content)
            status, body, _ = get(settings_url(page))
            out.append((status, json.loads(body)))
        path.write_text("search: text\n", encoding="utf-8")
        status, body, _ = get(settings_url(page))
        out.append((status, json.loads(body)))
        # the mosaic is still served after all that
        (named,) = parse_qs(urlsplit(page).query)["mosaic"]
        assert get(urljoin(page, named))[0] == 200
        return out

    code, _, got = run_view([str(mosaic), "--view", str(path)], monkeypatch, visit)
    assert code == 0
    for status, body in got[:-1]:
        assert status == 422
        assert str(path) in body["error"]
    assert got[-1][0] == 200 and got[-1][1]["search"] == "text"


def test_a_view_file_removed_while_open_is_an_error_naming_it_not_the_old_settings(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "v.yaml"
    path.write_text("search: text\n", encoding="utf-8")

    def visit(page: str) -> tuple[int, bytes]:
        path.unlink()
        status, body, _ = get(settings_url(page))
        # restored: served again
        path.write_text("search: text\n", encoding="utf-8")
        assert get(settings_url(page))[0] == 200
        return status, body

    code, _, (status, body) = run_view([str(mosaic), "--view", str(path)], monkeypatch, visit)
    assert code == 0
    assert status >= 400 and str(path) in body.decode("utf-8", "replace")


def test_the_server_never_writes_through_the_settings_address(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "v.yaml"
    path.write_text("search: text\n", encoding="utf-8")
    before = path.read_bytes()

    def visit(page: str) -> list[int]:
        url = settings_url(page)
        return [
            get(url, "POST", b"search: semantic\n")[0],
            get(url, "PUT", b"search: semantic\n")[0],
            get(url, "DELETE")[0],
        ]

    code, _, got = run_view([str(mosaic), "--view", str(path)], monkeypatch, visit)
    assert code == 0
    assert all(s >= 400 for s in got)
    assert path.read_bytes() == before


def test_the_view_file_itself_is_not_served_as_a_file(
    tmp_path: Path, dist: Path, mosaic: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "v.yaml"
    path.write_text("search: text\n# secret-comment\n", encoding="utf-8")

    def visit(page: str) -> list[int]:
        return [
            get(urljoin(page, "v.yaml"))[0],
            get(urljoin(page, "file/v.yaml"))[0],
            get(urljoin(page, "view.yaml"))[0],
            get(urljoin(page, "file/../v.yaml"))[0],
        ]

    code, _, got = run_view([str(mosaic), "--view", str(path)], monkeypatch, visit)
    assert code == 0
    assert all(s != 200 for s in got)
