"""CSV rows to a tessera (Specification 0.1, section 4).

One CSV file gives one tessera. Its one source is the file (kind ``file``, the SHA-256 of the
file's bytes); each data row gives one node of one type, with evidence
``file=<name>;row=<n>``, ``row`` counting data rows from 1 after the header row, method
``extracted``. Nothing is guessed: the settings name the type, the key, label and summary
columns and the columns that become props, and they are recorded in ``header.settings``.

- **Keys.** With a key column, a row's key is that cell as written and the node id is
  ``<type>:<key>``; the type's ``key_prop`` is the column. Without one, the key is the row
  number (a weak id, docs/design.md ADR-002) and ``key_prop`` is NULL. A key must be non-empty
  and unique: node ids are unique within a tessera (section 4.1).
- **Cells.** Values are text, kept exactly as the CSV reader gives them (no trimming: that is
  the pattern's ``strip``, section 5.2). An empty cell makes no prop, label or summary, since a
  CSV cannot tell an empty value from a missing one. Props are ``text`` unless converted.
- **Conversions** are declared per prop column in ``Settings.convert``, never
  guessed: ``Date`` (the given formats, tried in order, to ISO ``YYYY-MM-DD``), ``Quantity``
  (a number and a unit from a declared unit map, as two props), ``Integer``, ``Number`` and
  ``Boolean`` (explicit spellings). A converter ignores white space around the value. A value
  it cannot read stays as text, exactly as written, and its row is listed in the build's
  ``Report``. The kinds declared in ``type.props`` follow the conversions (section 3.4). Month
  names are English and digits ASCII whatever the locale: nothing here reads the locale.
- **Reading.** The bytes are decoded with the given encoding (a leading byte order mark is
  dropped) and parsed with Python's ``csv`` module, strict quoting, ``"`` as the quote and
  doubled quotes as escapes. A quoted line break stays inside its cell; a blank line is no
  row. A row with a different number of fields than the header is refused.
- **No header row** (``Settings.columns``). When the settings name the columns, the file has no
  header row: the names are its columns, in order, and its first line is data row 1.
- **No value** (``Settings.nulls``). A cell equal to one of these texts, exactly and as a whole,
  is an empty cell everywhere: as a key, label, summary, prop, linked value or its sibling, and
  for the row filter.
- **Row filter** (``Settings.rows``). Only the rows whose cell in each named column equals the
  text, or one of the texts, exactly are imported; the other rows make nothing and only their
  number of fields is checked. Row numbers still count every data row of the file, so a
  locator's ``row`` and a row-number key point into the source.
- **Linked columns** (``Settings.links``) turn a column into linked things. Each
  cell is split on the link's separator, if it has one, and each value is trimmed of Unicode
  ``White_Space`` (section 5.2's set); an empty value makes nothing. Each distinct value is one
  node of the link's own type, keyed by the value (id ``<type>:<value>``, the type's
  ``key_prop`` the column, no summary), and each row and value pair is one
  edge of the link's type: from the row to the value (``out``, the default) or from the value
  to the row (``in``). The node and the edge get one evidence row per row and column they come
  from, ``file=<name>;row=<n>;field=<column>``, method ``extracted``; a value twice in one cell
  is one edge. Each link has its own node type and edge type, neither shared with the rows or
  another link, so the tessera stays in the source's own vocabulary and the pattern maps and
  merges them (section 4).
- **Sibling columns** of a link say more about its values, position by position. A sibling cell
  is split and trimmed as the link's cell is (not split without a separator), and the value at
  the same position as the link's value is used; a position past the end, or an empty value,
  gives nothing. ``label`` names the column of the linked node's label, ``props`` maps each
  prop of the linked node (text, declared in the link type's ``type.props``) to its column,
  and ``qualifier`` names the column of the edge's qualifier (``""`` when it gives nothing). A
  linked node met again keeps its first non-empty label and each prop's first non-empty value,
  in row order then position. Edges are one per row, value and qualifier: a value twice in a
  cell with two qualifiers is two edges. A sibling column may be used elsewhere too.
- **JSON text** (``settings``, ``props``) is in the canonical form of RFC 8785 (section 3.1).

Errors name the file and the row, line or column at fault. The source is only read.
"""

import codecs
import contextlib
import csv
import hashlib
import io
import json
import os
import re
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from mosaic_format.canonical_json import canonical_json
from mosaic_format.writer import (
    Content,
    Edge,
    EdgeKey,
    Evidence,
    Header,
    Node,
    Sealed,
    Source,
    Type,
    seal,
)

from mosaic_build import __version__
from mosaic_build.mosaic.normalise import trim
from mosaic_build.tessera.convert import (
    Boolean,
    Conversion,
    Date,
    Integer,
    Number,
    Quantity,
    check_conversions,
    prop_kinds,
)
from mosaic_build.tessera.notice import notice_problem

__all__ = [
    "Boolean",
    "Built",
    "Conversion",
    "Date",
    "Integer",
    "Link",
    "LinkError",
    "Number",
    "Quantity",
    "Report",
    "Settings",
    "build",
    "check_link",
    "check_settings",
    "content",
    "read",
]

PRODUCER = f"mosaic-csv/{__version__}"
"""Written as the header's ``producer`` and the producer of every evidence row."""

NODE_TYPE = re.compile(r"[A-Z][A-Za-z0-9]*")
"""Node type names (section 3.4)."""
EDGE_TYPE = re.compile(r"[a-z][a-z0-9_]*")
"""Edge type names (section 3.4)."""
_FIELD_SIZE = 2**31 - 1
"""Python's ``csv`` refuses longer cells (131,072 characters by default); this is its largest
limit on every platform. Cells are only as long as the file then."""
DIRECTIONS = ("out", "in")
"""A link's edge goes from the row to the value (``out``) or from the value to the row."""


class LinkError(ValueError):
    """A link setting the builder refuses: ``column`` names the link, ``field`` its field at
    fault, or None for the link as a whole."""

    def __init__(self, message: str, field: str | None = None, column: str | None = None) -> None:
        super().__init__(message)
        self.field = field
        self.column = column


@dataclass(frozen=True)
class Link:
    """A column whose values become linked things: their node type, the edge type, the edge's
    direction relative to the row (``out`` or ``in``) and the separator, None for one value per
    cell. ``label``, ``props`` (prop name to column) and ``qualifier`` name sibling columns
    that give, at the value's position, the linked node's label and props and the edge's
    qualifier."""

    type: str
    edge: str
    direction: str = "out"
    separator: str | None = None
    label: str | None = None
    props: Mapping[str, str] = field(default_factory=dict)
    qualifier: str | None = None

    def as_json(self) -> dict[str, object]:
        """The link as JSON; the sibling columns are recorded only when given."""
        value: dict[str, object] = {
            "type": self.type,
            "edge": self.edge,
            "direction": self.direction,
            "separator": self.separator,
        }
        if self.label is not None:
            value["label"] = self.label
        if self.props:
            value["props"] = dict(self.props)
        if self.qualifier is not None:
            value["qualifier"] = self.qualifier
        return value

    def siblings(self) -> list[str]:
        """The sibling columns the link reads."""
        named = [c for c in (self.label, self.qualifier) if c is not None]
        return [*named, *self.props.values()]

    def parts(self, cell: str) -> list[str]:
        """The cell's values by position, trimmed; empty ones kept, to keep the positions."""
        parts = [cell] if self.separator is None else cell.split(self.separator)
        return [trim(part) for part in parts]


@dataclass
class _Linked:
    """A linked node as gathered so far: the first label and the first value of each prop."""

    type: str
    key: str
    label: str | None = None
    props: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Settings:
    """What shapes a CSV tessera; recorded in ``header.settings`` as given.

    ``key``, ``label`` and ``summary`` name a column or are None; ``props`` names the columns
    that become props. ``key = None`` keys rows by their position. ``convert`` maps a prop
    column to its conversion; other props are text. ``rows`` maps a column to the text, or the
    texts, a row must have there to be imported. ``columns`` names the columns of a file
    without a header row, None for a file with one. ``nulls`` are the cells read as empty.
    """

    type: str = "Row"
    key: str | None = None
    label: str | None = None
    summary: str | None = None
    props: tuple[str, ...] = ()
    encoding: str = "utf-8"
    delimiter: str = ","
    convert: Mapping[str, Conversion] = field(default_factory=dict)
    links: Mapping[str, Link] = field(default_factory=dict)
    notice: str | None = None
    rows: Mapping[str, str | tuple[str, ...]] = field(default_factory=dict)
    columns: tuple[str, ...] | None = None
    nulls: tuple[str, ...] = ()

    def as_json(self) -> str:
        """The settings as canonical JSON text, for ``header.settings``.

        ``convert``, ``links``, ``rows`` and ``nulls`` are recorded only when they name
        something: none and an empty one are the same settings. ``columns`` is recorded when
        given.
        """
        value: dict[str, object] = {
            "type": self.type,
            "key": self.key,
            "label": self.label,
            "summary": self.summary,
            "props": list(self.props),
            "encoding": self.encoding,
            "delimiter": self.delimiter,
        }
        if self.convert:
            value["convert"] = {c: v.as_json() for c, v in self.convert.items()}
        if self.links:
            value["links"] = {c: v.as_json() for c, v in self.links.items()}
        if self.notice is not None:
            value["notice"] = self.notice
        if self.rows:
            value["rows"] = {c: v if isinstance(v, str) else list(v) for c, v in self.rows.items()}
        if self.columns is not None:
            value["columns"] = list(self.columns)
        if self.nulls:
            value["nulls"] = list(self.nulls)
        return _json(value)


@dataclass(frozen=True)
class Report:
    """What the builder could not do as asked, for its user; not part of the tessera.

    ``unconverted`` maps every converted column, in UTF-8 byte order, to the data rows (from 1)
    whose value its conversion could not read and so kept as text.
    """

    unconverted: Mapping[str, tuple[int, ...]] = field(default_factory=dict)

    def counts(self) -> dict[str, int]:
        """The number of values kept as text, per converted column."""
        return {column: len(rows) for column, rows in self.unconverted.items()}


@dataclass(frozen=True)
class Built(Sealed):
    """The sealed tessera and the builder's report on it."""

    report: Report = field(default_factory=Report)


def build(source: str | os.PathLike[str], out: str | os.PathLike[str], settings: Settings) -> Built:
    """Read the CSV file ``source`` and write its tessera to the new file ``out``.

    Raises ``ValueError`` naming the file and the row, line or column when the settings or the
    file cannot make a tessera; no file is left at ``out`` then. An existing ``out`` is never
    overwritten (``FileExistsError``). The result is the sealed file with the builder's report.
    """
    made, report = read(source, settings)
    sealed = seal(out, made)
    return Built(sealed.path, sealed.knowledge_hash, sealed.vector_hash, report)


def content(source: str | os.PathLike[str], settings: Settings) -> Content:
    """The tessera's content for the CSV file ``source``, ready to seal."""
    return read(source, settings)[0]


def read(source: str | os.PathLike[str], settings: Settings) -> tuple[Content, Report]:
    """The tessera's content for the CSV file ``source`` and the builder's report on it."""
    path = Path(source)
    name = path.name
    check_settings(settings)
    if ";" in name:
        raise ValueError(
            f"{name!r}: a file name with ';' cannot be a locator value (section 3.5); rename it"
        )
    data = path.read_bytes()
    text = _decode(name, data, settings.encoding)
    nulls = frozenset(settings.nulls)
    wanted = {c: (v,) if isinstance(v, str) else v for c, v in settings.rows.items()}

    nodes: list[Node] = []
    edges: list[Edge] = []
    evidence: list[Evidence] = []
    linked: dict[str, _Linked] = {}
    seen: dict[str, int] = {}
    unconverted: dict[str, list[int]] = {c: [] for c in settings.convert}
    with contextlib.closing(_records(name, text, settings.delimiter)) as records:
        if settings.columns is None:
            first = next(records, None)
            if first is None:
                raise ValueError(f"{name}: has no header row")
            header, named = first[1], "the header has"
        else:
            header, named = list(settings.columns), "the settings name"
        columns = _columns(name, header, settings)
        for n, (line, cells) in enumerate(records, start=1):
            where = f"{name}: row {n} (line {line})"
            if len(cells) != len(header):
                raise ValueError(
                    f"{where}: has {len(cells)} field{'s' if len(cells) != 1 else ''}, "
                    f"{named} {len(header)}"
                )
            if nulls:
                cells = ["" if cell in nulls else cell for cell in cells]
            if any(cells[columns[c]] not in texts for c, texts in wanted.items()):
                continue
            for column, cell in zip(header, cells, strict=True):
                if "\x00" in cell:
                    raise ValueError(
                        f"{where}: column {column!r} contains U+0000, which text never holds (3.1)"
                    )
            key = str(n) if settings.key is None else cells[columns[settings.key]]
            if settings.key is not None:
                if key == "":
                    raise ValueError(f"{where}: key column {settings.key!r} is empty")
                if key in seen:
                    raise ValueError(
                        f"{name}: rows {seen[key]} and {n} have the same key {key!r} in column "
                        f"{settings.key!r}; node ids are unique within a tessera (section 4.1)"
                    )
            seen[key] = n
            node_id = f"{settings.type}:{key}"
            props: dict[str, object] = {}
            for p in settings.props:
                cell = cells[columns[p]]
                if cell == "":
                    continue
                conversion = settings.convert.get(p)
                if conversion is None:
                    props[p] = cell
                    continue
                converted = conversion.read(p, cell)
                if converted is None:
                    props[conversion.fallback(p)] = cell
                    unconverted[p].append(n)
                else:
                    props.update(converted)
            nodes.append(
                Node(
                    id=node_id,
                    type=settings.type,
                    key=key,
                    label=_cell(cells, columns, settings.label),
                    summary=_cell(cells, columns, settings.summary),
                    props=_json(props) if props else None,
                )
            )
            evidence.append(_evidence(node_id, name, f"file={name};row={n}"))
            for column, link in settings.links.items():
                locator = f"file={name};row={n};field={column}"
                sibling = {c: link.parts(cells[columns[c]]) for c in link.siblings()}
                done: set[str | EdgeKey] = set()
                for i, value in enumerate(link.parts(cells[columns[column]])):
                    if not value:
                        continue
                    value_id = f"{link.type}:{value}"
                    thing = linked.setdefault(value_id, _Linked(link.type, value))
                    if link.label is not None:
                        thing.label = thing.label or _at(sibling[link.label], i) or None
                    for p, c in link.props.items():
                        if p not in thing.props and _at(sibling[c], i):
                            thing.props[p] = _at(sibling[c], i)
                    qualifier = "" if link.qualifier is None else _at(sibling[link.qualifier], i)
                    ends = (node_id, value_id) if link.direction == "out" else (value_id, node_id)
                    edge = Edge(type=link.edge, src=ends[0], dst=ends[1], qualifier=qualifier)
                    if value_id not in done:
                        evidence.append(_evidence(value_id, name, locator))
                    if edge.key not in done:
                        edges.append(edge)
                        evidence.append(_evidence(edge.key, name, locator))
                    done.update((value_id, edge.key))

    made = Content(
        header=Header(kind="tessera", producer=PRODUCER, settings=settings.as_json()),
        sources=[
            Source(
                id=name,
                kind="file",
                hash=hashlib.sha256(data).hexdigest(),
                path=name,
                notice=settings.notice,
            ),
        ],
        types=[
            Type(
                name=settings.type,
                kind="node",
                key_prop=settings.key,
                props=_json(prop_kinds(settings.props, settings.convert)),
            ),
            *_link_types(settings),
        ],
        nodes=[
            *nodes,
            *(
                Node(
                    id=i,
                    type=t.type,
                    key=t.key,
                    label=t.label,
                    props=_json(t.props) if t.props else None,
                )
                for i, t in linked.items()
            ),
        ],
        edges=edges,
        evidence=evidence,
    )
    report = Report(
        {c: tuple(unconverted[c]) for c in sorted(unconverted, key=lambda c: c.encode("utf-8"))}
    )
    return made, report


def _evidence(subject: str | EdgeKey, source: str, locator: str) -> Evidence:
    return Evidence(
        subject=subject, source=source, locator=locator, method="extracted", producer=PRODUCER
    )


def _link_types(settings: Settings) -> list[Type]:
    """Each link's node type, keyed by its column and with its text props, and its edge type."""
    types: list[Type] = []
    for column, link in settings.links.items():
        props = _json(dict.fromkeys(link.props, "text"))
        types.append(Type(name=link.type, kind="node", key_prop=column, props=props))
        ends = (settings.type, link.type) if link.direction == "out" else (link.type, settings.type)
        types.append(Type(name=link.edge, kind="edge", from_type=ends[0], to_type=ends[1]))
    return types


def check_link(column: str, link: Link) -> None:
    """Refuse a link that cannot make a tessera, naming the link and the setting at fault."""
    at = f"settings: links.{column}"
    if ";" in column:
        raise LinkError(f"{at}: a column name with ';' cannot be a locator value (section 3.5)")
    if NODE_TYPE.fullmatch(link.type) is None:
        raise LinkError(
            f"{at}: type {link.type!r} is not a node type name ^[A-Z][A-Za-z0-9]*$ (3.4)", "type"
        )
    if EDGE_TYPE.fullmatch(link.edge) is None:
        raise LinkError(
            f"{at}: edge {link.edge!r} is not an edge type name ^[a-z][a-z0-9_]*$ (3.4)", "edge"
        )
    if link.direction not in DIRECTIONS:
        raise LinkError(f"{at}: direction {link.direction!r} is not 'out' or 'in'", "direction")
    if link.separator == "":
        raise LinkError(
            f"{at}: separator must not be empty; leave it out for one value", "separator"
        )


def check_links(settings: Settings) -> None:
    """Refuse links that cannot make a tessera: each link, and types two of them would share."""
    node_types = {settings.type: "the rows"}
    edge_types: dict[str, str] = {}
    for column, link in settings.links.items():
        check_link(column, link)
        at = f"settings: links.{column}"
        if link.type in node_types:
            raise LinkError(
                f"{at}: type {link.type!r} is already the type of {node_types[link.type]}; "
                f"each link has its own type",
                "type",
                column,
            )
        if link.edge in edge_types:
            raise LinkError(
                f"{at}: edge {link.edge!r} is already the edge of {edge_types[link.edge]}; "
                f"each link has its own edge type",
                "edge",
                column,
            )
        node_types[link.type] = f"links.{column}"
        edge_types[link.edge] = f"links.{column}"


def check_settings(settings: Settings) -> None:
    """Refuse settings that cannot make a tessera, naming the setting at fault."""
    if NODE_TYPE.fullmatch(settings.type) is None:
        raise ValueError(
            f"settings: type {settings.type!r} is not a node type name ^[A-Z][A-Za-z0-9]*$ (3.4)"
        )
    if len(settings.delimiter) != 1 or settings.delimiter in '"\r\n':
        raise ValueError(
            f"settings: delimiter {settings.delimiter!r} must be one character, "
            f"not a quote or line break"
        )
    try:
        codecs.lookup(settings.encoding)
    except LookupError:
        raise ValueError(f"settings: encoding {settings.encoding!r} is unknown") from None
    duplicates = sorted({p for p in settings.props if settings.props.count(p) > 1})
    if duplicates:
        raise ValueError(f"settings: props name {duplicates[0]!r} twice")
    check_conversions(settings.props, settings.convert)
    check_links(settings)
    if settings.columns is not None:
        if not settings.columns:
            raise ValueError("settings: columns names no column; leave it out for a header row")
        twice = sorted({c for c in settings.columns if settings.columns.count(c) > 1})
        if twice:
            raise ValueError(f"settings: columns name {twice[0]!r} twice")
    for column, texts in settings.rows.items():
        if not texts and texts != "":
            raise ValueError(f"settings: rows.{column} names no text, so no row would be imported")
    problem = notice_problem(settings.notice)
    if problem is not None:
        raise ValueError(f"settings: {problem}")


def _decode(name: str, data: bytes, encoding: str) -> str:
    try:
        text = data.decode(encoding)
    except UnicodeDecodeError as e:
        raise ValueError(
            f"{name}: is not {encoding} text (at byte offset {e.start}: {e.reason})"
        ) from None
    return text.removeprefix("﻿")


def _records(name: str, text: str, delimiter: str) -> Generator[tuple[int, list[str]], None, None]:
    """The file's rows, one at a time, each with the line it starts on; blank lines dropped."""
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    limit = csv.field_size_limit(_FIELD_SIZE)  # the spec sets no limit on a cell's length
    try:
        line = reader.line_num + 1
        for record in reader:
            if record:
                yield line, record
            line = reader.line_num + 1
    except csv.Error as e:
        raise ValueError(f"{name}: line {reader.line_num}: {e}") from None
    finally:
        csv.field_size_limit(limit)


def _columns(name: str, header: Sequence[str], settings: Settings) -> dict[str, int]:
    """The position of every column a setting names; refused when absent or ambiguous."""
    wanted = [c for c in (settings.key, settings.label, settings.summary) if c is not None]
    siblings = [c for link in settings.links.values() for c in link.siblings()]
    where = "the header" if settings.columns is None else "the settings' columns"
    positions: dict[str, int] = {}
    for column in dict.fromkeys(
        [*wanted, *settings.props, *settings.links, *siblings, *settings.rows]
    ):
        found = [i for i, h in enumerate(header) if h == column]
        if not found:
            raise ValueError(f"{name}: column {column!r} is not in {where}")
        if len(found) > 1:
            raise ValueError(f"{name}: column {column!r} appears twice in {where}")
        positions[column] = found[0]
    return positions


def _cell(cells: Sequence[str], columns: Mapping[str, int], column: str | None) -> str | None:
    if column is None:
        return None
    value = cells[columns[column]]
    return value or None


def _at(parts: Sequence[str], position: int) -> str:
    """The value at ``position``, or ``""`` past the end."""
    return parts[position] if position < len(parts) else ""


def _json(value: Mapping[str, object]) -> str:
    """Canonical JSON text (RFC 8785, section 3.1) of an object of JSON values."""
    return canonical_json(json.dumps(value, ensure_ascii=False, allow_nan=False))
