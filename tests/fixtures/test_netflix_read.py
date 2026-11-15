"""The Netflix titles mosaic, read side (Specification 0.1, section 11).

Section 11: the Netflix titles case checks "the whole flow end to end on the simplest input:
import, build, seal, open in the kit and the viewer". The mosaic is built with vectors, as in
``tests/fixtures/test_netflix.py`` (the source and the model fetched and checked by their
pinned SHA-256), then opened in the kit inside Chromium with ``kit/scripts/open-time.ts``, which
recomputes the knowledge hash and the vector hash on open (section 3.8 step 3): both equal those
``mosaic_format`` computes, and a copy with one vector byte changed is refused, naming the hash.

Then ``mosaic view <mosaic> --model DIR`` opens the built viewer in Chromium
(``viewer/scripts/browse.ts --url``), which loads the model in the page and opens the mosaic with
the kit. A plain-language query that shares no word with a title's name lists that title among
the ``vector`` matches (section 6, section 8.5); its node page, its links and its sources open,
and so does the table of its type. Run it with ``-s`` for the hashes, size, query, results and
timings.
"""

import hashlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from mosaic_build.mosaic import vectors as v
from mosaic_format.hashes import knowledge_hash, vector_hash

from tests.conftest import MODEL, REPO
from tests.fixtures.test_netflix import Run
from tests.test_cli import entry_point

pytestmark = pytest.mark.slow

QUERY = "high school chemistry teacher becomes a drug dealer"
TITLE = "Title:s5941"
"""The title the query describes by its meaning; its name shares no word with the query."""


def _open_in_kit(path: Path) -> subprocess.CompletedProcess[str]:
    bun = shutil.which("bun")
    assert bun, "bun is needed to bundle the kit (README, Development)"
    return subprocess.run(
        [bun, "kit/scripts/open-time.ts", str(path), "--runs", "3"],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )


def test_the_kit_opens_the_netflix_mosaic_with_both_hashes_checked(
    built: tuple[Path, Run],
) -> None:
    path, run = built
    with sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True) as con:
        expected = (knowledge_hash(con), vector_hash(con))
    assert expected == (run.mosaic_hash, run.vector_hash)
    opened = _open_in_kit(path)
    assert opened.returncode == 0, opened.stderr
    result = json.loads(opened.stdout.strip().splitlines()[-1])
    print(
        f"\nnetflix in the kit (Chromium): {run.nodes:,} nodes, {result['bytes']:,} bytes; "
        f"open with hash checks {result['runs_ms']} ms, median {result['median_ms']} ms; "
        f"knowledge {result['knowledge_hash']} vector {result['vector_hash']}; "
        f"build {run.seconds['build']:.1f} s"
    )
    assert (result["knowledge_hash"], result["vector_hash"]) == expected


def test_the_kit_refuses_the_netflix_mosaic_with_one_vector_changed(
    built: tuple[Path, Run], tmp_path: Path
) -> None:
    path, _ = built
    changed = tmp_path / "changed.mosaic"
    shutil.copyfile(path, changed)
    with sqlite3.connect(changed) as con:
        ((nid, bits),) = con.execute("SELECT nid, bits FROM vector ORDER BY nid LIMIT 1")
        flipped = bytes([bits[0] ^ 0x80]) + bits[1:]
        con.execute("UPDATE vector SET bits = ? WHERE nid = ?", (flipped, nid))
    con.close()
    opened = _open_in_kit(changed)
    assert opened.returncode != 0
    assert "vector hash" in opened.stderr, opened.stderr


def _words(text: str) -> set[str]:
    return {w.casefold() for w in re.findall(r"\w+", text)}


def test_mosaic_view_lists_a_title_by_meaning_and_opens_its_page_links_sources_and_table(
    built: tuple[Path, Run], tmp_path: Path
) -> None:
    path, run = built
    bun = shutil.which("bun")
    assert bun, "bun is needed to build the viewer (README, Development)"
    with sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True) as con:
        ((label, titles),) = con.execute(
            "SELECT label, (SELECT count(*) FROM node WHERE type = 'Title') FROM node WHERE id = ?",
            (TITLE,),
        )
    con.close()
    assert not _words(QUERY) & _words(label), "the query must share no word with the name"
    build = subprocess.run(
        [bun, "run", "build"], cwd=REPO / "viewer", capture_output=True, text=True, check=False
    )
    assert build.returncode == 0, build.stdout + build.stderr
    before = hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns
    address = tmp_path / "address.txt"
    recorder = tmp_path / "browser.py"
    recorder.write_text(
        f"import sys; open({str(address)!r}, 'w').write(sys.argv[1])\n", encoding="utf-8"
    )
    env = {**os.environ, "BROWSER": f"{sys.executable} {recorder} %s"}
    started = time.monotonic()
    proc = subprocess.Popen(
        [str(entry_point()), "view", str(path), "--model", str(MODEL)],
        env=env,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        while not address.exists() and time.monotonic() - started < 60:
            time.sleep(0.1)
        assert address.exists(), "mosaic view opened no page"
        url = address.read_text(encoding="utf-8")
        walked = subprocess.run(
            [bun, "viewer/scripts/browse.ts", "--url", url, QUERY, TITLE, "--table", "Title"],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
    finally:
        proc.send_signal(signal.SIGINT)
        out, _ = proc.communicate(timeout=30)
    assert walked.returncode == 0, walked.stderr
    seen = json.loads(walked.stdout.strip().splitlines()[-1])
    walk, table = seen["named"], seen["table"]
    results = [(r["match"], r["id"]) for r in walk["results"]]
    print(
        f"\nmosaic view --model on Netflix: query {QUERY!r}; {TITLE} is {label!r}\n"
        f"results: {results}\n"
        f"node page: links {len(walk['links'])}, sources {len(walk['sources'])}; "
        f"table {table['type']}: {table['headers']}, {table['pager']!r}\n"
        f"timings: page ready (model and mosaic loaded, hashes checked) {walk['ms']['ready']} ms, "
        f"search {walk['ms']['search']} ms, node page {walk['ms']['node']} ms, "
        f"table {table['ms']} ms"
    )
    assert proc.returncode == 0 and url in out
    assert seen["errors"] == [] and walk["banners"] == []
    assert walk["header"][1] == run.mosaic_hash[:12]
    assert ("vector", TITLE) in results
    assert [i for m, i in results if i == TITLE and m != "vector"] == []
    # The title's node page, its links (the first one opens) and its sources.
    assert walk["card"].startswith(label) and TITLE in walk["card"]
    assert walk["links"] and walk["opened"] == walk["links"][0]
    assert walk["sources"]
    # The table of its type, filled by `table`.
    assert table["headers"][:2] == ["id", "label"]
    assert table["rows"] and all(r.startswith("Title:") for r in table["rows"])
    assert f"{titles} rows" in table["pager"]
    assert (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns) == before


RESULT_LIMIT = 20
"""Section 8.2: lists are cut at 20 items."""
RANK = {"exact": 0, "text": 1, "vector": 2}
AGREEMENT = 15
"""Of the oracle's first 20 vector matches, at least this many are in the page's list."""


@pytest.fixture(scope="module")
def netflix(request: pytest.FixtureRequest) -> tuple[Path, Run]:
    """The Netflix mosaic built with vectors (``built`` in tests/fixtures/conftest.py)."""
    return request.getfixturevalue("built")  # type: ignore[no-any-return]


@pytest.fixture(scope="module")
def bun() -> str:
    found = shutil.which("bun")
    assert found, "bun is needed to build the viewer (README, Development)"
    build = subprocess.run(
        [found, "run", "build"], cwd=REPO / "viewer", capture_output=True, text=True, check=False
    )
    assert build.returncode == 0, build.stdout + build.stderr
    return found


def walk(bun: str, tmp: Path, mosaic: Path, query: str, node: str, model: Path | None) -> Any:
    address = tmp / f"address-{time.monotonic_ns()}.txt"
    recorder = tmp / "browser.py"
    recorder.write_text(
        f"import sys; open({str(address)!r}, 'w').write(sys.argv[1])\n", encoding="utf-8"
    )
    env = {**os.environ, "BROWSER": f"{sys.executable} {recorder} %s"}
    args = [str(entry_point()), "view", str(mosaic), *(["--model", str(model)] if model else [])]
    proc = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, text=True)
    try:
        started = time.monotonic()
        while not address.exists() and time.monotonic() - started < 120:
            time.sleep(0.1)
        assert address.exists(), "mosaic view opened no page"
        run = subprocess.run(
            [bun, "viewer/scripts/browse.ts", "--url", address.read_text("utf-8"), query, node],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
    finally:
        proc.send_signal(signal.SIGINT)
        proc.communicate(timeout=30)
    assert run.returncode == 0, run.stderr
    seen = json.loads(run.stdout.strip().splitlines()[-1])
    assert seen["errors"] == [] and seen["named"]["banners"] == []
    return seen["named"]


def listed(walked: Any) -> list[tuple[str, str]]:
    return [(r["match"], r["id"]) for r in walked["results"]]


def oracle(mosaic: Path, query: str) -> list[str]:
    """Node ids by the spec's scoring, best first, ties by id (UTF-8 bytes)."""
    q = v.Embedder(MODEL).query(query)
    with sqlite3.connect(f"{mosaic.as_uri()}?mode=ro&immutable=1", uri=True) as con:
        rows = con.execute("SELECT n.id, x.bits FROM vector x JOIN node n USING (nid)").fetchall()
    ids = [r[0] for r in rows]
    bits = np.unpackbits(np.frombuffer(b"".join(r[1] for r in rows), dtype=np.uint8)).reshape(
        -1, 384
    )
    scores = (2.0 * bits - 1.0) @ np.asarray(q, dtype=np.float64)
    order = sorted(range(len(ids)), key=lambda i: (-round(float(scores[i]), 9), ids[i].encode()))
    return [ids[i] for i in order]


def test_the_vector_matches_follow_the_scoring_of_section_6(
    netflix: tuple[Path, Run],
    bun: str,
    tmp_path: Path,
) -> None:
    path, _ = netflix
    seen = walk(bun, tmp_path, path, QUERY, TITLE, MODEL)
    results = listed(seen)
    top = oracle(path, QUERY)[:RESULT_LIMIT]
    page = [i for m, i in results if m == "vector"]
    agree = len(set(page) & set(top))
    print(
        f"\nquery {QUERY!r}: page vector matches {len(page)}; oracle top {len(top)}; "
        f"agreement {agree}; TITLE oracle rank {top.index(TITLE) + 1 if TITLE in top else '>20'}; "
        f"page rank {page.index(TITLE) + 1 if TITLE in page else '-'}"
    )
    assert TITLE in top, "the oracle itself does not list the title"
    assert len(results) <= RESULT_LIMIT
    assert agree >= AGREEMENT, (page, top)


def test_exact_and_text_matches_come_first_and_no_node_is_listed_twice(
    netflix: tuple[Path, Run],
    bun: str,
    tmp_path: Path,
) -> None:
    path, _ = netflix
    seen = walk(bun, tmp_path, path, "Breaking Bad", TITLE, MODEL)
    results = listed(seen)
    ranks = [RANK[m] for m, _ in results]
    assert ranks == sorted(ranks), results
    ids = [i for _, i in results]
    assert len(set(ids)) == len(ids), "a node listed twice"
    assert len(results) <= RESULT_LIMIT
    assert (next(m for m, i in results if i == TITLE)) in {"exact", "text"}


def test_the_model_adds_only_vector_matches_after_the_names_and_text_ones(
    netflix: tuple[Path, Run],
    bun: str,
    tmp_path: Path,
) -> None:
    """Section 3.8: without the model, names and full text; with it, the same, then vectors."""
    path, _ = netflix
    with_model = listed(walk(bun, tmp_path, path, "Breaking Bad", TITLE, MODEL))
    without = listed(walk(bun, tmp_path, path, "Breaking Bad", TITLE, None))
    assert all(m != "vector" for m, _ in without)
    head = [r for r in with_model if r[0] != "vector"]
    assert head == without[: len(head)]
    assert len(head) == len(without) or len(with_model) == RESULT_LIMIT
