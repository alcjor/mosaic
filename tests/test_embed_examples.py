"""The kit answers a question from a mosaic without the viewer (docs/design.md, "the kit and
the format are the product"): a Node script and a plain web page, in ``examples/embed``.
"""

import json
import shutil
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from tests.conftest import REPO

GROUP_X = [
    "Item A in_group Group x (first/doc, row=1;field=group)",
    "Item B in_group Group x (inner/base/notes, line=3)",
]
ITEM_B = ["Item B in_group Group x (inner/base/notes, line=3)"]


def run(*command: str) -> str:
    done = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr
    return done.stdout


@pytest.fixture(scope="module")
def kit() -> None:
    bun = shutil.which("bun")
    assert bun, "bun is needed to build the kit (README, Development)"
    subprocess.run([bun, "run", "build"], cwd=REPO / "kit", check=True, capture_output=True)


@pytest.mark.slow
@pytest.mark.usefixtures("kit")
def test_a_node_script_answers_from_a_mosaic() -> None:
    assert run("node", "examples/embed/answer.mjs").splitlines() == GROUP_X
    asked = run("node", "examples/embed/answer.mjs", "conformance/reading/mosaic.mosaic", "Item B")
    assert asked.splitlines() == ITEM_B


@pytest.mark.slow
@pytest.mark.usefixtures("kit")
def test_a_plain_page_answers_from_a_mosaic() -> None:
    handler = partial(SimpleHTTPRequestHandler, directory=str(REPO))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/examples/embed/page.html"
        try:
            first = json.loads(run("bun", "examples/embed/open-page.ts", url))
            asked = json.loads(run("bun", "examples/embed/open-page.ts", url, "Item B"))
        finally:
            server.shutdown()
    assert first == {"lines": GROUP_X, "errors": []}
    assert asked == {"lines": ITEM_B, "errors": []}
