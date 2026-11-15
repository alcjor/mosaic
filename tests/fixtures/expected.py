"""A fixture's expected hashes (Specification 0.1, section 11: "the expected mosaic").

``conformance/fixtures/<fixture>/expected-hashes.json`` records, for each target of the fixture's
pattern, the knowledge hash (section 3.6) and the vector hash (section 3.7) that a clean build
must give, and the ``embed_model`` the vector hash was made with (section 6). Its shape::

    {
      "comment": "...",
      "mosaics": {
        "<target>": {
          "knowledge_hash": "<64 lowercase hex>",
          "vector_hash": "<64 lowercase hex>" | null,
          "embed_model": "<name>@<64 lowercase hex>" | null
        }
      }
    }

The file is the contract: change it only with a reason. A slow fixture
test compares each build with it through :func:`differences`.

The knowledge hash and the model are compared exactly. The vector hash is the reference
build's: another processor may give vectors that differ in a few bits (ADR-005), so a build's
vectors are compared with ``expected-vectors.json`` instead, which holds the reference build's
bits for a sample of nodes (``{"comment": ..., "mosaics": {"<target>": {"<node id>": "<96
hex>"}}}``, written by ``scripts/make_expected_vectors.py``). At least :data:`AGREEMENT` of the
sample's bits must be the same.
"""

import hashlib
import json
import re
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from mosaic_format.yaml_read import load

FILE = "expected-hashes.json"
VECTORS_FILE = "expected-vectors.json"
FIELDS = ("knowledge_hash", "vector_hash", "embed_model")
AGREEMENT = 0.98
SAMPLE = 500
_HASH = re.compile(r"[0-9a-f]{64}")
_MODEL = re.compile(r"[^@\s]+@[0-9a-f]{64}")


@dataclass(frozen=True)
class Expected:
    """What one target's clean build must give."""

    knowledge_hash: str
    vector_hash: str | None
    embed_model: str | None
    vectors: Mapping[str, bytes] = field(default_factory=dict, compare=False)


class ExpectedError(ValueError):
    """An expected-hashes file that does not have the shape above."""


class _Twice(Exception):
    def __init__(self, key: str) -> None:
        self.key = key


def _once(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """A JSON object whose keys are all distinct: a target named twice is an error, not a guess."""
    found: dict[str, object] = {}
    for key, value in pairs:
        if key in found:
            raise _Twice(key)
        found[key] = value
    return found


def load_expected(fixture: Path) -> dict[str, Expected]:
    """Read ``fixture/expected-hashes.json``; raise :class:`ExpectedError` naming what is wrong."""
    path = fixture / FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_once)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ExpectedError(f"{path}: {error}") from error
    except _Twice as twice:
        raise ExpectedError(f"{path}: `{twice.key}` is named twice") from twice
    if not isinstance(data, dict) or set(data) - {"comment", "mosaics"}:
        raise ExpectedError(f"{path}: the top level holds only `comment` and `mosaics`")
    mosaics = data.get("mosaics")
    if not isinstance(mosaics, dict) or not mosaics:
        raise ExpectedError(f"{path}: `mosaics` names at least one target")
    expected: dict[str, Expected] = {}
    for target, entry in sorted(mosaics.items()):
        where = f"{path}: mosaics.{target}"
        if not isinstance(entry, dict) or set(entry) != set(FIELDS):
            raise ExpectedError(f"{where} holds exactly {', '.join(FIELDS)}")
        knowledge, vector, model = (entry[f] for f in FIELDS)
        if not isinstance(knowledge, str) or not _HASH.fullmatch(knowledge):
            raise ExpectedError(f"{where}.knowledge_hash is not 64 lowercase hex characters")
        if vector is not None and (not isinstance(vector, str) or not _HASH.fullmatch(vector)):
            raise ExpectedError(f"{where}.vector_hash is not 64 lowercase hex characters")
        if model is not None and (not isinstance(model, str) or not _MODEL.fullmatch(model)):
            raise ExpectedError(f"{where}.embed_model is not <name>@<64 lowercase hex>")
        if (vector is None) != (model is None):
            raise ExpectedError(f"{where}: vector_hash and embed_model are both set or both null")
        expected[target] = Expected(knowledge, vector, model, _vectors(fixture, target))
    return expected


def _vectors(fixture: Path, target: str) -> dict[str, bytes]:
    """The reference bits of ``target``'s sample, or nothing when the fixture records none."""
    path = fixture / VECTORS_FILE
    if not path.exists():
        return {}
    sample = json.loads(path.read_text(encoding="utf-8"))["mosaics"].get(target, {})
    return {node: bytes.fromhex(bits) for node, bits in sample.items()}


def built_vectors(mosaic: Path) -> dict[str, bytes]:
    """Every vector of a built mosaic, by node id."""
    con = sqlite3.connect(f"file:{mosaic}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT n.id, v.bits FROM vector v JOIN node n USING (nid)").fetchall()
    finally:
        con.close()
    return {str(node): bytes(bits) for node, bits in rows}


def sample(vectors: Mapping[str, bytes]) -> dict[str, bytes]:
    """The nodes whose vectors a fixture records: the :data:`SAMPLE` first by the hash of the id."""
    chosen = sorted(vectors, key=lambda node: hashlib.sha256(node.encode("utf-8")).digest())
    return {node: vectors[node] for node in sorted(chosen[:SAMPLE])}


def agreement(reference: Mapping[str, bytes], built: Mapping[str, bytes]) -> float:
    """The share of the reference's bits that ``built`` has too; a missing node agrees on none."""
    same = total = 0
    for node, bits in reference.items():
        total += 8 * len(bits)
        other = built.get(node)
        if other is not None and len(other) == len(bits):
            same += sum(8 - (a ^ b).bit_count() for a, b in zip(bits, other, strict=True))
    return same / total if total else 1.0


def pattern_targets(pattern: Path) -> list[str]:
    """The targets of a pattern: its `mosaics`, or `default` when it has none (section 5.4)."""
    data = load(pattern.read_text(encoding="utf-8"), pattern.name).data
    mosaics = data.get("mosaics") if isinstance(data, dict) else None
    return sorted(mosaics) if isinstance(mosaics, dict) and mosaics else ["default"]


def differences(
    expected: dict[str, Expected],
    target: str,
    *,
    knowledge_hash: str,
    vector_hash: str | None,
    embed_model: str | None,
    vectors: Mapping[str, bytes] | None = None,
) -> list[str]:
    """Each way the build of ``target`` differs from what is expected; empty when it matches.

    ``vectors`` are the build's, by node id; they are compared when the fixture records a sample.
    """
    want = expected.get(target)
    if want is None:
        return [f"{FILE} has no entry for target `{target}`"]
    found = [
        f"{target}.{name}: expected {wanted}, built {built}"
        for name, wanted, built in (
            ("knowledge_hash", want.knowledge_hash, knowledge_hash),
            ("embed_model", want.embed_model, embed_model),
        )
        if wanted != built
    ]
    if (want.vector_hash is None) != (vector_hash is None):
        found.append(f"{target}.vector_hash: expected {want.vector_hash}, built {vector_hash}")
    if want.vectors:
        share = agreement(want.vectors, vectors or {})
        if share < AGREEMENT:
            found.append(
                f"{target}: {share:.2%} of the bits of {len(want.vectors)} vectors are those of "
                f"{VECTORS_FILE}; at least {AGREEMENT:.0%} must be"
            )
    return found
