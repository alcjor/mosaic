"""The document tessera builder: Markdown files under one directory (sections 3.5, 4.1, 4.2).

Every file the ``include`` patterns name is one source of the tessera and one ``Page`` node,
keyed by its path below the directory. Every heading is a ``Section`` node keyed
``<path>#<slug>``, ``part_of`` its page and ``under`` the nearest earlier heading of a lower
level. Evidence locates the whole file for a page, the characters from a heading to the next
heading for a section, and the heading line for an edge.

A file may start with YAML front matter: a first line ``---``, up to the next line ``---``.
The settings name the front matter fields read as the page's label, summary, props and
aliases; ``address`` is a template (``{path}``, ``{dir}``, ``{stem}``, ``{name}``) giving one
more alias, such as the name other sources use for the page.

Mentions (kind ``identifier``) belong to the section they are in, else to the page. Roles:

- ``prose.code``: an inline code span holding one name, with no white space.
- ``prose.link``: the target of an inline link, without its fragment; not an image's, and
  not one with a scheme or starting ``//``.
- ``front.<field>``: for each field in the ``mentions`` setting, the scalars under a key of
  that name at any depth of the front matter, a list giving each item. Mode ``value`` takes
  the scalar, trimmed; mode ``words`` takes each run of letters, digits, ``_`` and ``.`` in
  it, without the dots at its ends. Each is located on its YAML line; one that is not
  written there as text (a folded or escaped scalar) is located by the whole line.

Locators are unique in a tessera, so a mention at the place of an earlier one is left out;
front matter mentions come first.

The limits of the scanner. It reads lines, not the Markdown grammar, because every fact needs
exact character offsets: only ATX headings (``#`` to ``######``) are headings, not underlined
ones; fenced blocks (three or more backticks or tildes) are skipped, indented code blocks and
HTML are not; a code span or a link is on one line; reference links, autolinks and bare
addresses are not read; headings inside quotes and lists are not seen; a front matter block
that is not closed is body text. Inline code and links in the raw front matter text are read
as in the body.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from mosaic_format.canonical_json import canonical_json
from mosaic_format.writer import (
    Alias,
    Content,
    Edge,
    EdgeKey,
    Evidence,
    Header,
    Mention,
    Node,
    Type,
)
from mosaic_format.yaml_read import Document, YamlError, load
from mosaic_format.yaml_read import Path as YamlPath

from mosaic_build import __version__
from mosaic_build.tessera.notice import notice_problem
from mosaic_build.tessera.tree import TextFile, read_tree

__all__ = ["PRODUCER", "Settings", "load_settings", "read"]

PRODUCER = f"mosaic-markdown/{__version__}"
"""Written as the header's ``producer`` and the producer of every evidence row."""

SNIPPET = 1_000
"""The most characters of a snippet."""

_PLACES = ("path", "dir", "stem", "name")
_PLACE = re.compile(r"\{([^{}]*)\}")
_FIELD = re.compile(r"[a-z0-9_]+")
_MODES = ("value", "words")
_KNOWN = ("include", "notice", "label", "summary", "props", "aliases", "address", "mentions")

_HEADING = re.compile(r" {0,3}(#{1,6})(?:[ \t]+(.*))?$")
_CLOSING = re.compile(r"(?:^|[ \t]+)#+[ \t]*$")
_FENCE = re.compile(r" {0,3}(`{3,}|~{3,})(.*)$")
_TICKS = re.compile(r"`+")
_LINK = re.compile(
    r"(!?)\[(?:[^\[\]\\]|\\.|\[[^\[\]]*\])*\]"
    r"\([ \t]*(<[^<>]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)"
    r"(?:[ \t]+(?:\"[^\"]*\"|'[^']*'|\([^()]*\)))?[ \t]*\)"
)
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
_WORD = re.compile(r"[\w.]+")
_NOT_SLUG = re.compile(r"[^\w\- ]")


@dataclass(frozen=True)
class Settings:
    """What to read: the files, and the front matter fields that describe a page."""

    include: tuple[str, ...]
    notice: str | None = None
    label: str | None = None
    summary: str | None = None
    props: tuple[str, ...] = ()
    aliases: tuple[str, ...] = ()
    address: str | None = None
    mentions: Mapping[str, str] = field(default_factory=dict)

    def as_json(self) -> str:
        """The settings as canonical JSON text, for ``header.settings``: a settings file."""
        value: dict[str, object] = {"include": list(self.include)}
        for name in ("notice", "label", "summary", "address"):
            if getattr(self, name) is not None:
                value[name] = getattr(self, name)
        for name in ("props", "aliases"):
            if getattr(self, name):
                value[name] = list(getattr(self, name))
        if self.mentions:
            value["mentions"] = dict(self.mentions)
        return _json(value)


class _Wrong(ValueError):
    def __init__(self, where: YamlPath, message: str) -> None:
        super().__init__(message)
        self.where = where


def _text(given: Mapping[str, object], key: str) -> str | None:
    value = given.get(key)
    if value is None and key not in given:
        return None
    if not isinstance(value, str) or not value:
        raise _Wrong((key,), f"{key} must be text, not {value!r}")
    return value


def _texts(given: Mapping[str, object], key: str) -> tuple[str, ...]:
    value = given.get(key, [])
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise _Wrong((key,), f"{key} must be a list of text, not {value!r}")
    return tuple(value)


def _settings(data: object) -> Settings:
    if not isinstance(data, dict):
        raise _Wrong((), "the settings must be a mapping")
    for key in data:
        if key not in _KNOWN:
            raise _Wrong((key,), f"{key!r} is no setting; the settings are {_KNOWN}")
    include = _texts(data, "include")
    if not include:
        raise _Wrong(("include",), "include must name at least one pattern")
    notice = _text(data, "notice")
    problem = notice_problem(notice)
    if problem is not None:
        raise _Wrong(("notice",), problem)
    props = _texts(data, "props")
    if "path" in props:
        raise _Wrong(("props",), "props names 'path', which every page has: its path")
    address = _text(data, "address")
    for place in _PLACE.findall(address or ""):
        if place not in _PLACES:
            raise _Wrong(
                ("address",), f"address has no place {{{place}}}; the places are {_PLACES}"
            )
    mentions = data.get("mentions", {})
    if not isinstance(mentions, dict):
        raise _Wrong(("mentions",), "mentions must be a mapping of fields to value or words")
    for name, mode in mentions.items():
        if not _FIELD.fullmatch(name):
            raise _Wrong(
                ("mentions", name), f"mentions.{name}: a field here is named with a-z, 0-9 and _"
            )
        if mode not in _MODES:
            raise _Wrong(
                ("mentions", name), f"mentions.{name} must be value or words, not {mode!r}"
            )
    return Settings(
        include=include,
        notice=notice,
        label=_text(data, "label"),
        summary=_text(data, "summary"),
        props=props,
        aliases=_texts(data, "aliases"),
        address=address,
        mentions=dict(mentions),
    )


def load_settings(path: str | os.PathLike[str]) -> Settings:
    """Read and check the settings file ``path``.

    Raises :class:`ValueError` naming the file, the line when known and the setting for a
    file that is not UTF-8 YAML, a key that is no setting or a value of the wrong kind;
    :class:`OSError` when the file cannot be read.
    """
    file = Path(path)
    try:
        text = file.read_bytes().decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError(f"{file}: settings: not UTF-8 text (byte {e.start})") from None
    doc = load(text, str(file))  # YamlError names the file and line
    try:
        return _settings(doc.data)
    except _Wrong as e:
        line = doc.line(e.where)
        at = str(file) if line is None else f"{file}:{line}"
        raise ValueError(f"{at}: settings: {e}") from None


# --- scanning one file ---------------------------------------------------------------------


@dataclass(frozen=True)
class _Heading:
    start: int
    end: int  # the end of the heading line
    level: int
    text: str


type _Found = tuple[int, int, str, str]
"""A mention found: start, end, role and text."""


def _lines(text: str, start: int, end: int) -> Iterator[tuple[int, str]]:
    """Each line of ``text[start:end]`` with its offset, without its line break."""
    at = start
    while at < end:
        stop = text.find("\n", at, end)
        stop = end if stop == -1 else stop
        yield at, text[at:stop].removesuffix("\r")
        at = stop + 1


def _front(text: str) -> tuple[int, int, int] | None:
    """Where the front matter's YAML starts and ends, and where the body starts."""
    first = text.find("\n")
    if first == -1 or text[:first].rstrip() != "---":
        return None
    for at, line in _lines(text, first + 1, len(text)):
        if line.rstrip() == "---":
            after = text.find("\n", at)
            return first + 1, at, len(text) if after == -1 else after + 1
    return None


def _inline(line: str, at: int) -> list[_Found]:
    """The code names and link targets in one line that starts at offset ``at``."""
    found: list[_Found] = []
    runs = list(_TICKS.finditer(line))
    masked = line
    i = 0
    while i < len(runs):
        start, ticks = runs[i].start(), len(runs[i][0])
        if start and line[start - 1] == "\\":  # an escaped backtick opens nothing
            start, ticks = start + 1, ticks - 1
        close = next((j for j in range(i + 1, len(runs)) if len(runs[j][0]) == ticks), None)
        if not ticks or close is None:
            i += 1
            continue
        inner = line[runs[i].end() : runs[close].start()]
        name = inner.strip()
        if name and not any(c.isspace() for c in name):
            begin = at + runs[i].end() + len(inner) - len(inner.lstrip())
            found.append((begin, begin + len(name), "prose.code", name))
        stop = runs[close].end()
        masked = masked[:start] + " " * (stop - start) + masked[stop:]
        i = close + 1
    for link in _LINK.finditer(masked):
        begin, target = link.start(2), link[2]
        if target.startswith("<"):
            begin, target = begin + 1, target[1:-1]
        target = target.split("#", 1)[0]
        if link[1] or not target or _SCHEME.match(target) or target.startswith("//"):
            continue
        found.append((at + begin, at + begin + len(target), "prose.link", target))
    return sorted(found)


def _scan(text: str, start: int) -> tuple[list[_Heading], list[_Found]]:
    """The headings and the prose mentions of the body, which starts at ``start``."""
    headings: list[_Heading] = []
    found: list[_Found] = []
    fence = ""
    for at, line in _lines(text, start, len(text)):
        opened = _FENCE.match(line)
        if fence:
            if opened and opened[1].startswith(fence) and not opened[2].strip():
                fence = ""
            continue
        if opened and not (opened[1][0] == "`" and "`" in opened[2]):
            fence = opened[1]
            continue
        heading = _HEADING.match(line)
        if heading:
            title = _CLOSING.sub("", heading[2] or "").strip()
            headings.append(_Heading(at, at + len(line), len(heading[1]), title))
        found += _inline(line, at)
    return headings, found


def _scalar(value: object) -> str | None:
    """A front matter scalar as text, trimmed; None for null, a list or a mapping."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return None


def _scalars(value: object) -> list[tuple[tuple[int, ...], str]]:
    """The scalars of a field: its own, or each item of its list, with the item's index."""
    items = list(enumerate(value)) if isinstance(value, list) else [(None, value)]
    return [(() if i is None else (i,), t) for i, v in items if (t := _scalar(v))]


def _named(data: object, path: YamlPath, fields: Mapping[str, str]) -> Iterator[_FrontValue]:
    """Every scalar under a key that ``fields`` names, at any depth, in the file's order."""
    if isinstance(data, dict):
        for key, value in data.items():
            if key in fields:
                for index, text in _scalars(value):
                    yield key, (*path, key, *index), text
            yield from _named(value, (*path, key), fields)
    elif isinstance(data, list):
        for index, value in enumerate(data):
            yield from _named(value, (*path, index), fields)


type _FrontValue = tuple[str, YamlPath, str]
"""A front matter value to mention: its field, its place and its text."""


def _front_mentions(
    text: str, start: int, end: int, doc: Document, fields: Mapping[str, str]
) -> list[_Found]:
    """The ``front.<field>`` mentions of the YAML at ``text[start:end]``."""
    lines = list(_lines(text, start, end))
    found: list[_Found] = []
    after: dict[int, int] = {}  # per line, where the last mention found there ended
    for name, path, value in _named(doc.data, (), fields):
        number = doc.line(path)
        if number is None or number > len(lines):
            continue
        at, line = lines[number - 1]
        if fields[name] == "value":
            wanted = [value]
        else:
            wanted = [w for m in _WORD.finditer(value) if (w := m[0].strip("."))]
        for word in wanted:
            begin = line.find(word, after.get(number, 0))
            if begin == -1:
                found.append((at, at + len(line), f"front.{name}", word))
            else:
                after[number] = begin + len(word)
                found.append((at + begin, at + begin + len(word), f"front.{name}", word))
    return found


# --- building the tessera ------------------------------------------------------------------


def _json(value: Mapping[str, object]) -> str:
    return canonical_json(json.dumps(value, ensure_ascii=False, allow_nan=False))


@dataclass
class _Made:
    """The rows made so far, page by page."""

    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    aliases: list[Alias] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    mentions: list[Mention] = field(default_factory=list)


def _evidence(
    subject: str | EdgeKey, file: TextFile, start: int, end: int, snippet: str | None = None
) -> Evidence:
    return Evidence(
        subject=subject,
        source=file.source.id,
        locator=file.locator(start, end),
        method="extracted",
        producer=PRODUCER,
        snippet=snippet[:SNIPPET] if snippet else None,
    )


def _slugs(headings: list[_Heading]) -> list[str]:
    """Each heading's anchor as GitHub writes it; a repeated one gets ``-1``, ``-2``, ..."""
    seen: dict[str, int] = {}
    slugs: list[str] = []
    for heading in headings:
        slug = base = _NOT_SLUG.sub("", heading.text.lower()).replace(" ", "-")
        while slug in seen:
            seen[base] += 1
            slug = f"{base}-{seen[base]}"
        seen.setdefault(slug, 0)
        slugs.append(slug)
    return slugs


def _address(template: str, path: str) -> str:
    name = posixpath.basename(path)
    places = {
        "path": path,
        "dir": posixpath.dirname(path),
        "stem": posixpath.splitext(name)[0],
        "name": name,
    }
    return _PLACE.sub(lambda m: places[m[1]], template)


def _page(file: TextFile, shown: Path, settings: Settings, made: _Made) -> None:
    """Add the page of ``file``, its sections, edges, aliases, evidence and mentions."""
    text, path = file.text, file.path
    front = _front(text)
    fields: dict[str, object] = {}
    found: list[_Found] = []
    if front is not None:
        try:
            doc = load(text[front[0] : front[1]], str(shown))
        except YamlError as e:
            at = f"{shown}:{1 if e.line is None else e.line + 1}"
            raise ValueError(f"{at}: front matter: {e.message}") from None
        if doc.data is not None and not isinstance(doc.data, dict):
            raise ValueError(f"{shown}:2: front matter: must be a mapping of fields")
        fields = doc.data or {}
        found += _front_mentions(text, front[0], front[1], doc, settings.mentions)
        for at, line in _lines(text, front[0], front[1]):
            found += _inline(line, at)
    body = 0 if front is None else front[2]
    headings, prose = _scan(text, body)
    found += prose

    page = f"Page:{path}"
    title = next((h.text for h in headings if h.text), None)
    label = _scalar(fields.get(settings.label)) if settings.label else None
    summary = _scalar(fields.get(settings.summary)) if settings.summary else None
    props: dict[str, object] = {"path": path}
    props.update({p: t for p in settings.props if (t := _scalar(fields.get(p)))})
    made.nodes.append(
        Node(
            id=page,
            type="Page",
            key=path,
            label=label or title or posixpath.splitext(posixpath.basename(path))[0],
            summary=summary or None,
            props=_json(props),
        )
    )
    lead = text[body : headings[0].start if headings else len(text)].strip()
    made.evidence.append(_evidence(page, file, 0, len(text), lead))
    names = [t for a in settings.aliases for _, t in _scalars(fields.get(a))]
    if settings.address is not None:
        names.append(_address(settings.address, path))
    made.aliases.extend(Alias(text=t, node=page, origin="source") for t in dict.fromkeys(names))

    sections: list[str] = []
    for i, (heading, slug) in enumerate(zip(headings, _slugs(headings), strict=True)):
        anchor = f"{path}#{slug}"
        section = f"Section:{anchor}"
        sections.append(section)
        end = headings[i + 1].start if i + 1 < len(headings) else len(text)
        made.nodes.append(
            Node(
                id=section,
                type="Section",
                key=anchor,
                label=heading.text or None,
                props=_json({"anchor": anchor, "level": heading.level}),
            )
        )
        made.evidence.append(
            _evidence(section, file, heading.start, end, text[heading.start : end].strip())
        )
        above = next((j for j in range(i - 1, -1, -1) if headings[j].level < heading.level), None)
        edges = [Edge(type="part_of", src=section, dst=page)]
        if above is not None:
            edges.append(Edge(type="under", src=section, dst=sections[above]))
        for edge in edges:
            made.edges.append(edge)
            made.evidence.append(_evidence(edge.key, file, heading.start, heading.end))

    taken: set[str] = set()
    for start, end, role, name in found:
        locator = file.locator(start, end)
        if locator in taken:
            continue
        taken.add(locator)
        inside = [s for s, h in zip(sections, headings, strict=True) if h.start <= start]
        node = inside[-1] if inside else page
        made.mentions.append(
            Mention(text=name, locator=locator, node=node, role=role, kind="identifier")
        )


def read(root: str | os.PathLike[str], settings: Settings) -> Content:
    """The tessera of the Markdown files under ``root`` that the settings include.

    Raises :class:`ValueError` naming the directory, pattern or file (and line) when the
    directory or a file cannot be read as text, or a file's front matter is not a YAML
    mapping. Nothing under ``root`` is written.
    """
    files = read_tree(root, settings.include, settings.notice)
    made = _Made()
    for file in files:
        _page(file, Path(root) / file.path, settings, made)
    return Content(
        header=Header(kind="tessera", producer=PRODUCER, settings=settings.as_json()),
        sources=[f.source for f in files],
        types=[
            Type(
                name="Page",
                kind="node",
                key_prop="path",
                props=_json(dict.fromkeys(("path", *settings.props), "text")),
            ),
            Type(
                name="Section",
                kind="node",
                key_prop="anchor",
                props=_json({"anchor": "text", "level": "integer"}),
            ),
            Type(name="part_of", kind="edge", from_type="Section", to_type="Page"),
            Type(name="under", kind="edge", from_type="Section", to_type="Section"),
        ],
        nodes=made.nodes,
        edges=made.edges,
        aliases=made.aliases,
        evidence=made.evidence,
        mentions=made.mentions,
    )
