"""Step 2 of a build: map piece nodes to canonical nodes (Specification 0.1, section 7.1 step 2).

For each ``types.<T>.from`` entry, every node of that piece type becomes a canonical node of
type ``T`` by the entry's field map (section 5.2):

- A field map value names a field of the piece node: one of ``key``, ``label``, ``summary``
  (its columns), or else a key of its ``props``. A field that is NULL, JSON ``null`` or not
  there gives no value.
- A type's ``key`` names one identifier, or several in order of trust. The entry for an
  identifier names the field that gives it, or several fields, whose values are joined with
  ``", "`` (a field without a value is left out; without the first, the identifier has no
  value); an identifier without an entry has no value, except that an entry naming none of
  the type's identifiers takes the first from the piece node's ``key``. A number becomes text
  in its canonical JSON form (``2020`` → ``"2020"``); a boolean, a JSON array or a JSON
  object fails the build with ``invalid_input``.
- ``strip`` removes a prefix from an identifier (as text, from the first; as a mapping, from
  the identifiers it names), then the normalisation steps run in order. An identifier that is
  missing, NULL or empty after that has no value.
- The node's key is the first identifier that has a value: as it is for the first of the
  type's ``key``, as ``<identifier>=<value>`` for a later one, so two identifiers never give
  the same key. A node with no identifier fails the build with ``invalid_input``. An
  identifier is never a property.
- The key's value as written, before ``strip``, is kept as an alias (``origin = source``) when
  it differs from the normalised value. Every later identifier that has a value is kept as an
  alias ``<identifier>=<value>`` (``origin = pattern``), so the node is found by it and keeps
  that name if an earlier identifier is filled in later.
- An entry whose canonical property is ``label`` or ``summary`` fills that column; without
  one, the node takes the piece node's ``label`` and ``summary``. These columns hold text, so
  a non-text value for them fails the build with ``invalid_input`` (no decision covers it).
- Every other entry fills a property in ``props``.
- A node of a mosaic piece is mapped the same way; its old id becomes an alias with
  ``origin = pattern`` (in step 3).
- A piece node is **weak-keyed** when its key comes from the piece node's ``key`` alone (an
  entry for the identifier naming ``key``, or no entry) and its piece type's ``key_prop`` is
  NULL:
  the key came from position, not a natural key (section 7.2; ADR-002).

Entries are taken in pattern order and, within an entry, the piece's nodes in ``nid`` order;
across pieces, in ``pieces`` order. That is the build order of step 3.
"""

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from mosaic_format.canonical_json import canonical_json

from mosaic_build.mosaic.errors import BuildError
from mosaic_build.mosaic.normalise import DEFAULT_STEPS, normalise
from mosaic_build.mosaic.pieces import Inputs, Piece

COLUMNS = ("key", "label", "summary")
"""Fields of a piece node held in its own columns rather than in ``props``."""

TEXT_COLUMNS = ("label", "summary")
"""Canonical properties that fill a node column instead of ``props`` (section 5.2)."""

STRIP = "strip"
"""The reserved field map option (section 5.2)."""


JOIN = ", "
"""What joins the values of an identifier made of several fields (section 5.2)."""


@dataclass(frozen=True)
class Identifier:
    """One identifier of a type as one ``from`` entry gives it."""

    prop: str
    rank: int
    """Its place in the type's ``key``, from 0."""
    fields: tuple[str, ...]
    strip: str | None

    def key(self, value: str) -> str:
        """The node key this identifier's ``value`` gives."""
        return value if self.rank == 0 else f"{self.prop}={value}"


@dataclass(frozen=True)
class Entry:
    """One ``types.<T>.from`` entry: the canonical type and the piece type it maps."""

    type: str
    key_prop: str
    steps: tuple[str, ...]
    piece: str
    piece_type: str
    fields: Mapping[str, str]
    """Canonical property → piece field, without ``strip`` and the identifiers."""
    identifiers: tuple[Identifier, ...] = ()
    """The type's identifiers this entry gives, in the order of the type's ``key``."""
    mapped: tuple[tuple[str, tuple[str, ...]], ...] = ()
    """Every canonical property and identifier with the piece fields that fill it, as written."""

    @property
    def reference(self) -> str:
        return f"{self.piece}.{self.piece_type}"

    def renames(self) -> dict[str, tuple[str, ...]]:
        """Piece field → the canonical properties it fills, the key property and columns too.

        Evidence about a field is renamed to these properties (step 3).
        """
        filled: dict[str, list[str]] = {}
        for prop, fields in self.mapped:
            for field in fields:
                filled.setdefault(field, []).append(prop)
        for column in TEXT_COLUMNS:
            if column not in self.fields:
                filled.setdefault(column, []).append(column)
        return {field: tuple(props) for field, props in filled.items()}


@dataclass(frozen=True)
class Mapped:
    """One piece node mapped to a canonical node, in build order."""

    entry: Entry
    piece: Piece
    nid: int
    """The piece node's row id: joins its evidence, aliases and external references."""
    old_id: str
    """The piece node's id."""
    key: str
    written: str
    """The key's value as written in the source, before ``strip``; the key when they are equal."""
    label: str | None
    summary: str | None
    props: Mapping[str, Any]
    weak: bool = False
    """Whether the key came from position rather than a natural key (section 7.2)."""
    also: tuple[str, ...] = ()
    """The later identifiers that have a value, each as the key it would give."""

    @property
    def type(self) -> str:
        return self.entry.type

    @property
    def id(self) -> str:
        return f"{self.entry.type}:{self.key}"


def entries(pattern: Mapping[str, Any]) -> list[Entry]:
    """Every ``from`` entry of the pattern, in pattern order."""
    found: list[Entry] = []
    for type_name, definition in pattern["types"].items():
        steps = tuple(definition.get("normalise", DEFAULT_STEPS))
        keys = key_props(definition)
        for reference, field_map in definition["from"].items():
            piece, _, piece_type = reference.rpartition(".")
            strip = field_map.get(STRIP)
            strips = strip if isinstance(strip, Mapping) else {keys[0]: strip}
            identifiers = []
            unnamed = not any(prop in field_map for prop in keys)
            for rank, prop in enumerate(keys):
                given = field_map.get(prop, "key" if rank == 0 and unnamed else None)
                if given is not None:
                    names = (given,) if isinstance(given, str) else tuple(given)
                    identifiers.append(Identifier(prop, rank, names, strips.get(prop)))
            mapped = [
                (p, (f,) if isinstance(f, str) else tuple(f))
                for p, f in field_map.items()
                if p != STRIP
            ]
            if unnamed:
                mapped.append((keys[0], ("key",)))
            found.append(
                Entry(
                    type=type_name,
                    key_prop=keys[0],
                    steps=steps,
                    piece=piece,
                    piece_type=piece_type,
                    fields={p: f for p, f in field_map.items() if p != STRIP and p not in keys},
                    identifiers=tuple(identifiers),
                    mapped=tuple(mapped),
                )
            )
    return found


def key_props(definition: Mapping[str, Any]) -> tuple[str, ...]:
    """A type's identifiers, in order of trust: its ``key``, one name or a list (section 5.2)."""
    key = definition["key"]
    return (key,) if isinstance(key, str) else tuple(key)


_ABSENT = object()


def _field(columns: Mapping[str, Any], props: Mapping[str, Any], name: str) -> Any:
    """A field of a piece node, or ``_ABSENT``; NULL and JSON ``null`` are absent too."""
    value = columns[name] if name in COLUMNS else props.get(name)
    return _ABSENT if value is None else value


def _where(entry: Entry, old_id: str) -> str:
    return f"piece {entry.piece!r}, node {old_id!r} ({entry.reference} → {entry.type})"


def _key_text(entry: Entry, old_id: str, field: str, value: Any) -> str:
    """An identifier field's value as text, or the build fails."""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return canonical_json(json.dumps(value))
    what = {bool: "a boolean", list: "a JSON array", dict: "a JSON object"}[type(value)]
    raise BuildError(
        "invalid_input",
        f"{_where(entry, old_id)}: key field {field!r} is {what}, not text or a number",
    )


def _identified(
    entry: Entry, old_id: str, identifier: Identifier, columns: Mapping[str, Any], props: Any
) -> tuple[str, str] | None:
    """An identifier's value as written and after ``strip`` and normalisation, if it has one."""
    parts = []
    for i, field in enumerate(identifier.fields):
        value = _field(columns, props, field)
        if value is not _ABSENT:
            parts.append(_key_text(entry, old_id, field, value))
        elif i == 0:
            return None
    written = JOIN.join(parts)
    stripped = written
    if identifier.strip is not None and stripped.startswith(identifier.strip):
        stripped = stripped[len(identifier.strip) :]
    value = normalise(stripped, entry.steps)
    return None if value == "" else (written, value)


def _column(entry: Entry, old_id: str, column: str, field: str, value: Any) -> str | None:
    if value is _ABSENT:
        return None
    if not isinstance(value, str):
        raise BuildError(
            "invalid_input",
            f"{_where(entry, old_id)}: field {field!r} fills {column}, which holds text, but its "
            f"value is {canonical_json(json.dumps(value))}",
        )
    return value


def _props(entry: Entry, old_id: str, text: object) -> dict[str, Any]:
    """A piece node's ``props``, which must be an I-JSON object (section 3.1).

    The piece is untrusted (section 3.8): the reading rules do not re-check its JSON text, so
    a value that has no canonical JSON form, such as an integer beyond 2^53 - 1, fails the build
    here with ``invalid_input`` rather than later, when values are compared or written.
    """
    if text is None:
        return {}
    try:
        canonical_json(str(text))
        props = json.loads(str(text))
    except ValueError as e:
        raise BuildError(
            "invalid_input", f"{_where(entry, old_id)}: props are not I-JSON (3.1): {e}"
        ) from None
    if not isinstance(props, dict):
        raise BuildError("invalid_input", f"{_where(entry, old_id)}: props are not a JSON object")
    return props


def map_node(entry: Entry, piece: Piece, row: Sequence[Any], *, positional: bool = False) -> Mapped:
    """Map one piece node, given as ``(nid, id, key, label, summary, props)``.

    ``positional`` says that the piece type's ``key_prop`` is NULL, so a key taken from the
    piece node's ``key`` is weak (section 7.2).
    """
    nid, old_id, key, label, summary, props_text = row
    props = _props(entry, old_id, props_text)
    columns = {"key": key, "label": label, "summary": summary}

    found = [
        (identifier, *named)
        for identifier in entry.identifiers
        if (named := _identified(entry, old_id, identifier, columns, props)) is not None
    ]
    if not found:
        fields = ", ".join(repr(f) for i in entry.identifiers for f in i.fields)
        raise BuildError(
            "invalid_input",
            f"{_where(entry, old_id)}: no key: {fields} has no value, or none after strip and "
            "normalisation",
        )
    chosen, written, value = found[0]

    texts: dict[str, str | None] = {}
    for column in TEXT_COLUMNS:
        field = entry.fields.get(column, column)
        texts[column] = _column(entry, old_id, column, field, _field(columns, props, field))
    mapped: dict[str, Any] = {}
    for prop, field in entry.fields.items():
        if prop in TEXT_COLUMNS:
            continue
        given = _field(columns, props, field)
        if given is not _ABSENT:
            mapped[prop] = given
    return Mapped(
        entry=entry,
        piece=piece,
        nid=nid,
        old_id=old_id,
        key=chosen.key(value),
        written=chosen.key(value) if written == value else written,
        label=texts["label"],
        summary=texts["summary"],
        props=mapped,
        weak=positional and chosen.fields == ("key",),
        also=tuple(i.key(v) for i, _, v in found[1:]),
    )


def map_nodes(inputs: Inputs) -> Iterator[Mapped]:
    """Step 2: every mapped piece node, in build order (pieces, then entries, then ``nid``)."""
    all_entries = entries(inputs.pattern)
    for piece in inputs.pieces:
        for entry in all_entries:
            if entry.piece != piece.name:
                continue
            positional = _positional(piece, entry.piece_type)
            rows = piece.file.query(
                "SELECT nid, id, key, label, summary, props FROM node WHERE type = ? ORDER BY nid",
                (entry.piece_type,),
            )
            for row in rows:
                yield map_node(entry, piece, row, positional=positional)


def _positional(piece: Piece, piece_type: str) -> bool:
    """Whether the piece declares node type ``piece_type`` with a NULL ``key_prop``."""
    rows = piece.file.query(
        "SELECT key_prop FROM type WHERE name = ? AND kind = 'node'", (piece_type,)
    )
    return any(key_prop is None for (key_prop,) in rows)
