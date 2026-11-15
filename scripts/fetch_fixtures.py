"""Download conformance fixture sources and verify them by SHA-256.

Fixture sources are never committed (docs/design.md, Implementation plan):
they are listed in conformance/fixtures/manifest.json, downloaded here into
conformance/fixtures/downloads/, and checked against their pinned hash.
A fixture whose licence is not confirmed is skipped.

When a source cannot be fetched from its url, or what arrives does not match
its pinned hash, it is read from the repository's ``fixtures`` branch instead,
at ``<name>/<file>``: the home of sources that cannot be fetched from their origin
(the manifest's comment). Either way the file must match the pinned SHA-256.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "conformance" / "fixtures" / "manifest.json"
DOWNLOADS = REPO / "conformance" / "fixtures" / "downloads"
FIXTURES_BRANCH = "fixtures"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def from_url(url: str, target: Path) -> bool:
    """Download ``url`` to ``target``; False when it cannot be fetched."""
    part = target.with_name(target.name + ".part")
    try:
        urllib.request.urlretrieve(url, part)
    except OSError as e:  # URLError and HTTPError are OSErrors
        print(f"     {url}: {e}")
        part.unlink(missing_ok=True)
        return False
    part.replace(target)
    return True


def from_fixtures_branch(path: str, target: Path, repo: Path) -> bool:
    """Read ``path`` from the ``fixtures`` branch of ``repo``'s origin into ``target``."""
    fetched = subprocess.run(
        ["git", "-C", str(repo), "fetch", "--quiet", "origin", f"refs/heads/{FIXTURES_BRANCH}"],
        capture_output=True,
        check=False,
    )
    if fetched.returncode != 0:
        print(f"     fixtures branch: {fetched.stderr.decode(errors='replace').strip()}")
        return False
    shown = subprocess.run(
        ["git", "-C", str(repo), "show", f"FETCH_HEAD:{path}"], capture_output=True, check=False
    )
    if shown.returncode != 0:
        print(f"     fixtures branch has no {path}")
        return False
    target.write_bytes(shown.stdout)
    return True


def main(manifest_path: Path = MANIFEST, downloads: Path = DOWNLOADS, repo: Path = REPO) -> int:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    failures = 0
    for item in manifest["fixtures"]:
        name = item["name"]
        if not item.get("licence_confirmed"):
            print(f"skip {name}: licence not confirmed")
            continue
        if not item.get("url") or not item.get("sha256"):
            print(f"skip {name}: no url or hash pinned yet")
            continue
        pinned = item["sha256"]
        target = downloads / name / item["file"]
        if not (target.exists() and sha256(target) == pinned):
            target.parent.mkdir(parents=True, exist_ok=True)
            print(f"fetch {name} <- {item['url']}")
            if not (from_url(item["url"], target) and sha256(target) == pinned):
                path = f"{name}/{item['file']}"
                print(f"fetch {name} <- {FIXTURES_BRANCH} branch, {path}")
                from_fixtures_branch(path, target, repo)
        actual = sha256(target) if target.exists() else "(nothing fetched)"
        if actual != pinned:
            print(f"FAIL {name}: sha256 {actual} != pinned {pinned}", file=sys.stderr)
            failures += 1
        else:
            print(f"ok   {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
