"""The mosaic an export carries when its view file names ``export.types``.

The cut is a build (section 7.1). Its one piece is the source mosaic, of kind
``mosaic`` and pinned by its knowledge hash (section 5.1), or a source tessera as a ``tessera``
piece, whose evidence then has no ``via``; its one target, ``export``, has the view file's
``export.types`` as ``types`` (section 5.4: node types in scope, edges kept when both ends are). So
the cut's ``source`` holds the source mosaic's row, its evidence names the copied rows with the
source's hash at the end of ``via`` (sections 3.2 and 3.5), and its header's ``pattern_hash`` is the
hash of the pattern written here. Each carried type keeps its key, every property its nodes hold
(declared or not; one no piece declares is ``json``, section 7.1 step 7), its description and its
keys as they are (``normalise: []``); each carried edge type keeps its description. A description
longer than a pattern's ``describe`` holds (200 characters, section 5.2) keeps its first 200 code
points, with no ellipsis and no trimming. The target lists the types by UTF-8
bytes, keeps every fact (``trust: all``, ``evidence: all``) and the source's ``text`` setting; it
has vectors when the export carries the model. The pattern is canonical JSON text, so the same
mosaic and set of types give the same cut, byte for byte (principle 5).

The piece is named after the source file (:func:`piece_name`), so the same
bytes exported under two file names give two cuts. Evidence on a carried node's key property is
kept like any other, as in any build from a mosaic piece.

The source is only read: it is opened by the reading rules and given to the builder as an
available piece file.
"""

from __future__ import annotations

import json
import re
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from mosaic_format.canonical_json import canonical_json
from mosaic_format.reader import open as open_sealed

from mosaic_build.mosaic.build import build
from mosaic_build.mosaic.errors import BuildError

TARGET = "export"
"""The cut's target name; its header's ``target``."""

_PIECE = re.compile(r"[^A-Za-z0-9_-]")
_DESCRIBE = 200
"""The longest ``describe`` a pattern holds (section 5.2)."""
_TEXT = ("none", "snippets", "full")


class CutError(ValueError):
    """The cut cannot be built; the message names what failed."""


@dataclass(frozen=True)
class Source:
    """What a cut needs to know of its source mosaic."""

    knowledge_hash: str
    kind: str
    """``mosaic`` or ``tessera``: the kind of piece the source is in the cut's pattern."""
    node_types: dict[str, tuple[str | None, list[str], str | None]]
    """Each node type: its key property, its properties and its description.

    The properties are the declared ones in their order, then any other a node of the type
    holds, by UTF-8 bytes, so the cut carries every value (section 3.4).
    """
    edge_types: list[tuple[str, str | None, str | None, str | None]]
    """Each edge type: its name, from, to and description, by name."""
    text: str
    key_held_apart: frozenset[str] = frozenset()
    """Node types one of whose nodes holds its key property in ``props`` with a value other than
    its key: a value the cut cannot carry, since the key property's value is the key."""


def _text(value: object) -> str | None:
    return None if value is None else str(value)


def _as_key(value: object) -> str | None:
    """A held value as the key text it would be (section 5.2: a number as canonical JSON).

    ``None`` for a value no key can be: not text or a number, or a number outside I-JSON (section
    3.1), which a crafted file can hold.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return canonical_json(json.dumps(value))
        except ValueError:
            return None
    return None


def read_source(path: Path) -> Source:
    """The source mosaic's knowledge hash, declared types and ``text`` setting."""
    apart: set[str] = set()
    with open_sealed(path) as sealed:
        nodes: dict[str, tuple[str | None, list[str], str | None]] = {}
        for name, key, props, describe in sealed.query(
            "SELECT name, key_prop, props, description FROM type WHERE kind = 'node' "
            "ORDER BY name COLLATE BINARY"
        ):
            declared = [str(p) for p in (json.loads(props) if isinstance(props, str) else {})]
            held: set[str] = set()
            for node_key, value in sealed.query(
                "SELECT key, props FROM node WHERE type = ? AND props IS NOT NULL", (name,)
            ):
                found = json.loads(str(value))
                if isinstance(found, dict):
                    held.update(str(k) for k in found)
                    if key in found and _as_key(found[key]) != node_key:
                        apart.add(str(name))
            others = sorted(held - set(declared), key=lambda p: p.encode("utf-8"))
            nodes[str(name)] = (_text(key), declared + others, _text(describe))
        edges = [
            (str(n), _text(f), _text(t), _text(d))
            for n, f, t, d in sealed.query(
                "SELECT name, from_type, to_type, description FROM type WHERE kind = 'edge' "
                "ORDER BY name COLLATE BINARY"
            )
        ]
        rows = sealed.query("SELECT settings FROM header")
        knowledge_hash = sealed.knowledge_hash
        kind = sealed.kind
    try:
        settings = json.loads(str(rows[0][0])) if rows else {}
    except ValueError:
        settings = {}
    text = settings.get("text") if isinstance(settings, dict) else None
    text = text if text in _TEXT else "snippets"
    return Source(knowledge_hash, kind, nodes, edges, str(text), frozenset(apart))


def piece_name(source: Path) -> str:
    """The cut's name for its piece: the source file's name without its suffix.

    Each character a piece name cannot hold (section 5.1) becomes ``-``; leading ``-`` and ``_``,
    which cannot start a name, are left out, and ``source`` is the name when nothing is left
    (``_draft`` gives ``draft``, ``---`` gives ``source``).

    A name that is the cut's target's gets ``-source`` after it, since a piece may not have the
    name of a target of its pattern (section 5.6).
    """
    name = _PIECE.sub("-", Path(source.name).stem).lstrip("-_") or "source"
    return f"{name}-source" if name == TARGET else name


_COLUMNS = ("key", "label", "summary")
"""Field map values that name a piece node's column, never a property (section 5.2)."""
_PROPERTY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
"""A property name a pattern can hold (``pattern.schema.json``)."""


def uncarried(source: Source, node_type: str) -> str | None:
    """The first property, by UTF-8 bytes, of ``node_type`` that a cut cannot carry, if any.

    In a field map a value ``key``, ``label`` or ``summary`` names that column of the piece node
    (section 5.2, section 7.1 step 3), and a pattern names a property only by a name of letters,
    digits and ``_`` (``pattern.schema.json``), so a property a node holds or the type declares
    with one of those column names, or with another name, cannot be carried as itself. Such a
    cut is refused, never carried in part. The key property is one only when a node holds it in
    ``props`` with a value other than its key; declared, or held with
    the key's own value, it is carried as the node's key. The name is shown as JSON text when it
    is not a plain name.
    """
    key, props, _ = source.node_types[node_type]
    found = sorted(
        (
            p
            for p in props
            if (p == key and node_type in source.key_held_apart)
            or (p != key and (p in _COLUMNS or not _PROPERTY.fullmatch(p)))
        ),
        key=lambda p: p.encode("utf-8"),
    )
    if not found:
        return None
    named = found[0]
    return named if _PROPERTY.fullmatch(named) else json.dumps(named, ensure_ascii=False)


def pattern(source: Source, name: str, types: Sequence[str], vectors: bool) -> str:
    """The pattern the cut is built with, as canonical JSON text (YAML 1.2 reads it)."""
    node_types: dict[str, object] = {}
    for t in types:
        key, props, describe = source.node_types[t]
        if key is None:
            raise CutError(f"node type {t} has no key property, so it cannot be cut (section 3.9)")
        if (named := uncarried(source, t)) is not None:
            raise CutError(f"node type {t} has a property named {named}, which a cut cannot carry")
        fields = {key: "key", **{p: p for p in props if p != key}}
        entry: dict[str, object] = {"key": key, "normalise": [], "from": {f"{name}.{t}": fields}}
        if describe:
            entry["describe"] = describe[:_DESCRIBE]
        node_types[t] = entry
    edges: dict[str, object] = {}
    for edge, start, end, describe in source.edge_types:
        if start in types and end in types:
            entry = {"from": start, "to": end, "map": [f"{name}.{edge}"]}
            if describe:
                entry["describe"] = describe[:_DESCRIBE]
            edges[edge] = entry
    document: dict[str, object] = {
        "format": "0.1",
        "pieces": [{"name": name, "hash": source.knowledge_hash, "kind": source.kind}],
        "types": node_types,
        "mosaics": {
            TARGET: {
                "types": sorted(types, key=lambda t: t.encode("utf-8")),
                "trust": "all",
                "evidence": "all",
                "strict": False,
                "text": source.text,
                "vectors": vectors,
            }
        },
    }
    if edges:
        document["edges"] = edges
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def cut(source_path: Path, types: Sequence[str], model: Path | None = None) -> bytes:
    """The bytes of the mosaic cut from ``source_path`` to ``types``; vectors with ``model``."""
    source = read_source(source_path)
    with tempfile.TemporaryDirectory(prefix="mosaic-cut-") as work:
        directory = Path(work)
        pattern_path = directory / "pattern.yaml"
        text = pattern(source, piece_name(source_path), types, model is not None)
        pattern_path.write_text(text, encoding="utf-8")
        out = directory / "out" / "cut.mosaic"
        try:
            build(pattern_path, TARGET, out, pieces=[source_path], model=model)
        except BuildError as e:
            raise CutError(f"the export's cut of {source_path} failed: {e}") from None
        return out.read_bytes()
