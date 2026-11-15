"""Read a view file: what ``mosaic view`` and ``mosaic export`` show.

docs/design.md, Implementation plan, "View file": YAML, used by both view and export; it sets
which types appear, columns, what a node page shows, labels, theme, which types an export
carries, and ``search: semantic`` or ``search: text``. The keys, values and defaults are those
of ``views/example.yaml``; ``views/view.schema.json`` is their JSON Schema.

- ``search``: ``semantic`` (the default) or ``text``.
- ``theme``: ``auto`` (the default, following the system), ``light`` or ``dark``.
- ``types``: the node types that appear, in the order written; by default every node type, by
  name. Each maps to ``label`` (shown instead of the type name), ``columns`` (its table: the
  node's name, then these properties; by default every declared property), ``page`` (its node
  page: these properties and edge types, in this order; by default all of them) and ``names``
  (labels for its property and edge type names) and ``describe`` (its description on the graph
  explorer's map, G-2; by default none). A type left out is absent from the type list and
  tables only: search and links still reach its nodes, and the kit is not shaped by the view
  file.
- ``edges``: edge types by name, in the order written, each with ``describe`` (its description
  on the map; by default none). It describes edge types; it does not choose which appear.
  Descriptions come from the view file because the kit as it is gives none (G-12).
- ``cards`` (docs/design.md, "Viewer: chains and cards", V-6, V-7, V-9, V-15): which
  facts each type's card shows, set once per type and apart from ``types``, so setting a card
  never changes which types the page lists. Each type maps to ``show`` (properties, or the
  node's ``summary``, in order), ``links`` (the things it links to by these links) and
  ``counts`` (how many things it links to by these links). A link is an edge type name, alone
  or followed by ``in`` or ``out`` for one direction; edge type names hold no spaces (section
  3.4). A part a card leaves out shows nothing; a type with no card gets the page's default.
- ``chains`` (docs/design.md, "Viewer: chains and cards", V-1, V-2, V-15, V-16,
  V-18): named chains, by label, in the order written. Each has a ``start`` (a node type), an
  optional ``pin`` (the one thing it starts from) and ``steps``, in order, each a link alone, or
  a mapping of ``link`` and ``pin`` (the one thing that step reaches). A link is spelled as in
  ``cards``: an edge type name, alone or followed by ``in`` or ``out``; alone, a step follows it
  out. A step's type is the other end of its edge type, so it is not written. By default, none.
- ``export.types``: which node types an export carries. The export carries a
  mosaic built from the source as its one piece with those types as its target's ``types``
  (:mod:`mosaic_build.cut`); a type the mosaic lacks, or an empty list, is an error. By
  default, the mosaic as it is.

Every key is optional, so an empty view file, or none (``read(None)``), gives M2's viewer. The
file is read as YAML 1.2 with duplicate keys refused. An unknown key and a value of
the wrong kind are errors naming the file, the line and the setting. Whether the named types and
properties are in the mosaic is not checked here: the page does that, against the mosaic it
opens.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mosaic_format.yaml_read import load

__all__ = [
    "SEARCH",
    "THEMES",
    "CardView",
    "ChainStep",
    "ChainView",
    "EdgeView",
    "TypeView",
    "ViewFileError",
    "ViewSettings",
    "from_json",
    "read",
]

SEARCH = ("semantic", "text")
"""The values of ``search``; the first is the default."""
THEMES = ("auto", "light", "dark")
"""The values of ``theme``; the first is the default."""

_KEYS = ("search", "theme", "types", "edges", "cards", "chains", "export")
_TYPE_KEYS = ("label", "columns", "page", "names", "describe")
_EDGE_KEYS = ("describe",)
_CARD_KEYS = ("show", "links", "counts")
_LINK = re.compile(r"[^ \t\n\v\f\r]+(?: (?:in|out))?")
"""A link, in a card or a chain step: an edge type name, alone or with one direction."""
_CHAIN_KEYS = ("start", "pin", "steps")
_STEP_KEYS = ("link", "pin")
_EXPORT_KEYS = ("types",)

type _Where = tuple[str | int, ...]
"""Where a value lies in the file: mapping keys and list indexes from the root."""


@dataclass(frozen=True)
class TypeView:
    """How one node type appears; ``None`` is the default (see the module)."""

    name: str
    label: str | None = None
    columns: tuple[str, ...] | None = None
    page: tuple[str, ...] | None = None
    names: Mapping[str, str] = field(default_factory=dict)
    describe: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "columns": None if self.columns is None else list(self.columns),
            "page": None if self.page is None else list(self.page),
            "names": dict(self.names),
            "describe": self.describe,
        }


@dataclass(frozen=True)
class EdgeView:
    """How one edge type appears on the map; ``None`` is the default (see the module)."""

    name: str
    describe: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {"name": self.name, "describe": self.describe}


@dataclass(frozen=True)
class CardView:
    """Which facts one type's card shows, in the order written; empty shows none."""

    name: str
    show: tuple[str, ...] = ()
    links: tuple[str, ...] = ()
    counts: tuple[str, ...] = ()

    def as_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "show": list(self.show),
            "links": list(self.links),
            "counts": list(self.counts),
        }


@dataclass(frozen=True)
class ChainStep:
    """One step of a saved chain: its link, and the one thing it reaches or ``None`` for any."""

    link: str
    pin: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {"link": self.link, "pin": self.pin}


@dataclass(frozen=True)
class ChainView:
    """A chain saved in the view file, by label: its start, its pin and its steps, in order."""

    name: str
    start: str
    pin: str | None = None
    steps: tuple[ChainStep, ...] = ()

    def as_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "start": self.start,
            "pin": self.pin,
            "steps": [s.as_json() for s in self.steps],
        }


@dataclass(frozen=True)
class ViewSettings:
    """A view file's settings; the defaults are M2's viewer."""

    search: str = SEARCH[0]
    theme: str = THEMES[0]
    types: tuple[TypeView, ...] | None = None
    edges: tuple[EdgeView, ...] | None = None
    cards: tuple[CardView, ...] | None = None
    chains: tuple[ChainView, ...] | None = None
    export_types: tuple[str, ...] | None = None

    def as_json(self) -> dict[str, Any]:
        """The settings as JSON data, for the page; ``null`` is a default the page applies."""
        return {
            "search": self.search,
            "theme": self.theme,
            "types": None if self.types is None else [t.as_json() for t in self.types],
            "edges": None if self.edges is None else [e.as_json() for e in self.edges],
            "cards": None if self.cards is None else [c.as_json() for c in self.cards],
            "chains": None if self.chains is None else [c.as_json() for c in self.chains],
            "export": {"types": None if self.export_types is None else list(self.export_types)},
        }


class ViewFileError(ValueError):
    """A setting that cannot be read; ``where`` is its place in the file."""

    def __init__(self, where: _Where, message: str) -> None:
        super().__init__(message)
        self.where = where
        self.message = message


def _name(where: _Where) -> str:
    """The setting's name, such as ``types.A.columns``; list indexes name their list."""
    return ".".join(str(w) for w in where if isinstance(w, str)) or "view file"


def _mapping(value: object, where: _Where, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ViewFileError(where, f"{_name(where)} must be a mapping of {what}")
    return value


def _unknown(where: _Where, known: tuple[str, ...]) -> ViewFileError:
    return ViewFileError(where, f"{_name(where)}: no such setting; one of {', '.join(known)}")


def _one_of(value: object, where: _Where, values: tuple[str, ...]) -> str:
    if not isinstance(value, str) or value not in values:
        raise ViewFileError(
            where, f"{_name(where)} must be one of {', '.join(values)}, not {value!r}"
        )
    return value


def _text(value: object, where: _Where) -> str:
    if not isinstance(value, str) or not value:
        raise ViewFileError(where, f"{_name(where)} must be non-empty text, not {value!r}")
    return value


def _texts(value: object, where: _Where) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ViewFileError(where, f"{_name(where)} must be a list of names, not {value!r}")
    seen: set[str] = set()
    for i, item in enumerate(value):
        if not isinstance(item, str) or not item:
            raise ViewFileError(
                (*where, i), f"{_name(where)}: item {i + 1} must be a non-empty name, not {item!r}"
            )
        if item in seen:
            raise ViewFileError((*where, i), f"{_name(where)} names {item!r} twice")
        seen.add(item)
    return tuple(value)


def _names(value: object, where: _Where) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ViewFileError(
            where, f"{_name(where)} must be a mapping of property and edge names to labels"
        )
    for key in value:
        if not key:
            raise ViewFileError((*where, key), f"{_name(where)}: a name must be non-empty text")
    return {k: _text(v, (*where, k)) for k, v in value.items()}


def _type_view(name: str, value: object, where: _Where) -> TypeView:
    got: dict[str, Any] = {}
    for key, item in _mapping(value, where, "a type's settings").items():  # in the order written
        at = (*where, key)
        match key:
            case "label" | "describe":
                got[key] = _text(item, at)
            case "columns" | "page":
                got[key] = _texts(item, at)
            case "names":
                got[key] = _names(item, at)
            case _:
                raise _unknown(at, _TYPE_KEYS)
    return TypeView(
        name=name,
        label=got.get("label"),
        columns=got.get("columns"),
        page=got.get("page"),
        names=got.get("names", {}),
        describe=got.get("describe"),
    )


def _types(value: object) -> tuple[TypeView, ...]:
    if not isinstance(value, dict):
        raise ViewFileError(("types",), "types must be a mapping of type names to settings")
    views = []
    for name, entry in value.items():
        if not name:
            raise ViewFileError(("types", name), "types: a type name must be non-empty text")
        views.append(_type_view(name, entry, ("types", name)))
    return tuple(views)


def _edges(value: object) -> tuple[EdgeView, ...]:
    if not isinstance(value, dict):
        raise ViewFileError(("edges",), "edges must be a mapping of edge type names to settings")
    views = []
    for name, entry in value.items():
        if not name:
            raise ViewFileError(("edges", name), "edges: an edge type name must be non-empty text")
        where = ("edges", name)
        describe = None
        for key, item in _mapping(entry, where, "an edge type's settings").items():
            if key != "describe":
                raise _unknown((*where, key), _EDGE_KEYS)
            describe = _text(item, (*where, key))
        views.append(EdgeView(name=name, describe=describe))
    return tuple(views)


def _links(value: object, where: _Where) -> tuple[str, ...]:
    links = _texts(value, where)
    for i, link in enumerate(links):
        if not _LINK.fullmatch(link):
            raise ViewFileError(
                (*where, i),
                f"{_name(where)}: item {i + 1} must be an edge type name, alone or followed by "
                f"in or out, not {link!r}",
            )
    return links


def _card(name: str, value: object, where: _Where) -> CardView:
    got: dict[str, tuple[str, ...]] = {}
    for key, item in _mapping(value, where, "a card's settings").items():
        at = (*where, key)
        match key:
            case "show":
                got[key] = _texts(item, at)
            case "links" | "counts":
                got[key] = _links(item, at)
            case _:
                raise _unknown(at, _CARD_KEYS)
    return CardView(
        name=name,
        show=got.get("show", ()),
        links=got.get("links", ()),
        counts=got.get("counts", ()),
    )


def _cards(value: object) -> tuple[CardView, ...]:
    if not isinstance(value, dict):
        raise ViewFileError(("cards",), "cards must be a mapping of type names to cards")
    cards = []
    for name, entry in value.items():
        if not name:
            raise ViewFileError(("cards", name), "cards: a type name must be non-empty text")
        cards.append(_card(name, entry, ("cards", name)))
    return tuple(cards)


def _step(value: object, where: _Where, n: int) -> ChainStep:
    step = f"{_name(where)}: step {n}"
    if isinstance(value, str):
        if not _LINK.fullmatch(value):
            raise ViewFileError(
                where,
                f"{step} must be an edge type name, alone or followed by in or out, not {value!r}",
            )
        return ChainStep(link=value)
    if not isinstance(value, dict):
        raise ViewFileError(where, f"{step} must be a link, or a mapping of link and pin")
    got: dict[str, str] = {}
    for key, item in value.items():
        if key not in _STEP_KEYS:
            raise _unknown((*where, key), _STEP_KEYS)
        got[key] = _text(item, (*where, key))
    if "link" not in got:
        raise ViewFileError(where, f"{step} needs a link")
    if not _LINK.fullmatch(got["link"]):
        raise ViewFileError(
            (*where, "link"),
            f"{step} must be an edge type name, alone or followed by in or out, "
            f"not {got['link']!r}",
        )
    return ChainStep(link=got["link"], pin=got.get("pin"))


def _chain(name: str, value: object, where: _Where) -> ChainView:
    got: dict[str, Any] = {}
    for key, item in _mapping(value, where, "a chain's start, pin and steps").items():
        at = (*where, key)
        match key:
            case "start" | "pin":
                got[key] = _text(item, at)
            case "steps":
                if not isinstance(item, list):
                    raise ViewFileError(at, f"{_name(at)} must be a list of steps, not {item!r}")
                got[key] = tuple(_step(s, (*at, i), i + 1) for i, s in enumerate(item))
            case _:
                raise _unknown(at, _CHAIN_KEYS)
    if "start" not in got:
        raise ViewFileError(where, f"{_name(where)}: a chain needs a start")
    return ChainView(name=name, start=got["start"], pin=got.get("pin"), steps=got.get("steps", ()))


def _chains(value: object) -> tuple[ChainView, ...]:
    if not isinstance(value, dict):
        raise ViewFileError(("chains",), "chains must be a mapping of labels to chains")
    chains = []
    for name, entry in value.items():
        if not name:
            raise ViewFileError(("chains", name), "chains: a label must be non-empty text")
        chains.append(_chain(name, entry, ("chains", name)))
    return tuple(chains)


def _export_types(value: object) -> tuple[str, ...] | None:
    got = None
    for key, item in _mapping(value, ("export",), "export settings").items():
        if key != "types":
            raise _unknown(("export", key), _EXPORT_KEYS)
        got = _texts(item, ("export", "types"))
    return got


def from_json(value: object) -> ViewSettings:
    """The settings that ``value``, a view file's data, gives; ``None`` is an empty file.

    The settings are read in the order written, so of several wrong ones the first is named.
    """
    if value is None:
        return ViewSettings()
    got: dict[str, Any] = {}
    for key, item in _mapping(value, (), "settings").items():
        match key:
            case "search":
                got[key] = _one_of(item, (key,), SEARCH)
            case "theme":
                got[key] = _one_of(item, (key,), THEMES)
            case "types":
                got[key] = _types(item)
            case "edges":
                got[key] = _edges(item)
            case "cards":
                got[key] = _cards(item)
            case "chains":
                got[key] = _chains(item)
            case "export":
                got[key] = _export_types(item)
            case _:
                raise _unknown((key,), _KEYS)
    return ViewSettings(
        search=got.get("search", SEARCH[0]),
        theme=got.get("theme", THEMES[0]),
        types=got.get("types"),
        edges=got.get("edges"),
        cards=got.get("cards"),
        chains=got.get("chains"),
        export_types=got.get("export"),
    )


def read(path: str | os.PathLike[str] | None) -> ViewSettings:
    """Read and check the view file ``path``; with none, the defaults (M2's viewer).

    Raises :class:`ValueError` naming the file, and the line when known, for a file that is
    not UTF-8 YAML or holds a setting that cannot be read; :class:`OSError` when it cannot be
    read.
    """
    if path is None:
        return ViewSettings()
    file = Path(path)
    try:
        text = file.read_bytes().decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError(f"{file}: view file: not UTF-8 text (byte {e.start})") from None
    doc = load(text, str(file))  # YamlError names the file and line
    try:
        return from_json(doc.data)
    except ViewFileError as e:
        line = doc.line(e.where)
        at = str(file) if line is None else f"{file}:{line}"
        raise ValueError(f"{at}: view file: {e.message}") from None
