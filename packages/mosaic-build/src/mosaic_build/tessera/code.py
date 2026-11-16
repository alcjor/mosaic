"""C and C++ files under one directory, as one tessera.

Each file the ``include`` patterns name is one source and one ``File`` node (keyed by its path
below the directory). The builder records, best-effort and without failing on code it cannot
parse:

- ``Define``: one node per defined name, whatever the number of ``#define`` lines; the first one
  (files in order, then position) gives ``value`` and ``enabled``, and each line is one evidence
  row and one piece of evidence of the ``set_in`` edge to its file. With ``commented_defines``,
  a line ``//#define NAME ...`` is a define that is switched off (``enabled`` false).
- ``Function``: one node per function definition with a body, keyed ``<path>::<name as
  written>`` (``#2``, ``#3``... for a name the file defines again), with the first line of the
  comment directly above as its summary, its names as aliases and a ``defined_in`` edge to its
  file. A definition inside a function body is not one: macros with a block read like one.

Mentions (kind ``identifier``) are the names a pattern's link rules can resolve. Their node is
the innermost function whose definition contains the name, else the file. Roles:

- ``code.condition``: a name in the condition of ``#if``, ``#elif``, ``#ifdef`` or ``#ifndef``,
  except ``defined`` and a name that is called (``ENABLED`` in ``#if ENABLED(FAN)``).
- ``code.call``: a name called in a function body (``name(``).
- ``code.use``: any other plain name in a function body. Member names, type names, the
  function's parameters and local variables, and the names the same file defines (its defines
  that are switched on and its functions) are not mentions.

Defines and conditions are read line by line, with ``\\`` continuation lines and comments left
out; functions and the names in their bodies come from a tree-sitter parse. Offsets in locators
count characters (section 3.5).

Settings (YAML, the shape of ``header.settings``): ``include`` (a list of patterns, needed),
``notice`` and ``commented_defines`` (a boolean, false by default).
"""

from __future__ import annotations

import json
import os
import re
from bisect import bisect_right
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path

import tree_sitter_cpp
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
from mosaic_format.yaml_read import load
from tree_sitter import Language, Parser
from tree_sitter import Node as Syntax

from mosaic_build import __version__
from mosaic_build.tessera.notice import notice_problem
from mosaic_build.tessera.tree import TextFile, read_tree

__all__ = ["PRODUCER", "Settings", "load_settings", "read"]

PRODUCER = f"mosaic-code/{__version__}"
"""Written as the header's ``producer`` and the producer of every evidence row."""

SNIPPET_LENGTH = 1000
"""The most characters a snippet holds."""

_KNOWN = ("include", "notice", "commented_defines")
_LANGUAGE = Language(tree_sitter_cpp.language())

_COMMENT_OR_QUOTED = re.compile(
    r"""//[^\n]*|/\*.*?(?:\*/|\Z)|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'""", re.DOTALL
)
_DIRECTIVE = re.compile(r"^[ \t]*#[ \t]*([A-Za-z_]\w*)", re.MULTILINE)
_COMMENTED_DEFINE = re.compile(
    r"^[ \t]*(//[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)([^\n]*))", re.MULTILINE
)
_DEFINED_NAME = re.compile(r"[ \t]+([A-Za-z_]\w*)")
_CONTINUATION = re.compile(r"[ \t]*\\\r?\n[ \t]*")
_WORD = re.compile(r""""(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\d[\w.]*|[A-Za-z_]\w*""")
_CALLED = re.compile(r"\s*\(")
_MARKERS = re.compile(r"^\s*(?:/\*+!?|//+!?|\*+/?)|\*+/\s*$")
_CONDITIONS = ("if", "elif", "ifdef", "ifndef", "elifdef", "elifndef")
_KEYWORDS = frozenset(
    {"auto", "bool", "break", "case", "char", "class", "const", "constexpr", "continue",
     "default", "delete", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if",
     "inline", "int", "long", "new", "return", "short", "signed", "sizeof", "static", "struct",
     "switch", "typedef", "union", "unsigned", "void", "volatile", "while"}
)  # fmt: skip
"""Words that are no names, wherever a macro's arguments make the parse take them for one."""
_NAMES = (
    "identifier",
    "field_identifier",
    "qualified_identifier",
    "destructor_name",
    "operator_name",
    "template_function",
)
_DECLARATIONS = (
    "declaration",
    "parameter_declaration",
    "optional_parameter_declaration",
    "for_range_loop",
)


@dataclass(frozen=True)
class Settings:
    """What to read: the ``include`` patterns, the sources' notice and the defines to take."""

    include: tuple[str, ...]
    notice: str | None = None
    commented_defines: bool = False

    def as_json(self) -> str:
        """The settings as canonical JSON, for ``header.settings``."""
        value: dict[str, object] = {
            "include": list(self.include),
            "commented_defines": self.commented_defines,
        }
        if self.notice is not None:
            value["notice"] = self.notice
        return _json(value)


def load_settings(path: str | os.PathLike[str]) -> Settings:
    """Read and check the settings file ``path``.

    Raises ``ValueError`` naming the file, the line when known and the setting for a file that
    is not UTF-8 YAML or holds settings the builder refuses; ``OSError`` when it cannot be read.
    """
    file = Path(path)
    try:
        text = file.read_bytes().decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError(f"{file}: settings: not UTF-8 text (byte {e.start})") from None
    doc = load(text, str(file))  # YamlError names the file and line

    def refused(key: str | None, message: str) -> ValueError:
        line = doc.line(() if key is None else (key,))
        at = str(file) if line is None else f"{file}:{line}"
        return ValueError(f"{at}: settings: {message}")

    given = doc.data
    if not isinstance(given, dict):
        raise refused(None, "the settings must be a mapping of settings")
    for key in given:
        if key not in _KNOWN:
            raise refused(str(key), f"{key!r} is no setting; the settings are {_KNOWN}")
    include = given.get("include")
    if (
        not isinstance(include, list)
        or not include
        or not all(isinstance(p, str) and p for p in include)
    ):
        raise refused("include", f"include must be a list of patterns, not {include!r}")
    notice = given.get("notice")
    if "notice" in given and not isinstance(notice, str):
        raise refused("notice", f"notice must be text, not {notice!r}")
    problem = notice_problem(notice)
    if problem is not None:
        raise refused("notice", problem)
    commented = given.get("commented_defines", False)
    if not isinstance(commented, bool):
        raise refused(
            "commented_defines", f"commented_defines must be true or false, not {commented!r}"
        )
    return Settings(include=tuple(include), notice=notice, commented_defines=commented)


@dataclass(frozen=True)
class _Directive:
    """One preprocessor line with its continuation lines, comments blanked."""

    start: int  # of the line
    end: int
    word: str
    rest: int  # where the text after the directive's word starts


@dataclass(frozen=True)
class _Define:
    name: str
    value: str
    enabled: bool
    start: int
    end: int


@dataclass
class _Function:
    name: str
    written: str
    start: int
    end: int
    body: int
    parent: int | None
    id: str = ""
    locals: set[str] = field(default_factory=set)


def read(root: str | os.PathLike[str], settings: Settings) -> Content:
    """The tessera content of the C and C++ files under ``root`` that the settings name.

    Raises ``ValueError`` naming the directory, pattern or file for what
    :func:`~mosaic_build.tessera.tree.read_tree` refuses.
    """
    files = read_tree(root, settings.include, settings.notice)
    parser = Parser(_LANGUAGE)
    nodes: list[Node] = []
    edges: list[Edge] = []
    aliases: list[Alias] = []
    evidence: list[Evidence] = []
    mentions: list[Mention] = []
    defined: set[str] = set()

    for file in files:
        text = file.text
        file_id = f"File:{file.path}"
        nodes.append(
            Node(
                id=file_id,
                type="File",
                key=file.path,
                label=file.path.rsplit("/", 1)[-1],
                props=_json({"path": file.path}),
            )
        )
        evidence.append(_evidence(file_id, file, 0, len(text)))

        code, comments = _blank_comments(text)
        directives = _directives(code)
        own: set[str] = set()  # the names this file defines
        set_here: set[str] = set()
        for d in _defines(text, code, comments, directives, settings.commented_defines):
            node_id = f"Define:{d.name}"
            if d.name not in defined:
                defined.add(d.name)
                props: dict[str, object] = {"name": d.name, "enabled": d.enabled}
                if d.value:
                    props["value"] = d.value
                nodes.append(
                    Node(id=node_id, type="Define", key=d.name, label=d.name, props=_json(props))
                )
            edge = Edge(type="set_in", src=node_id, dst=file_id)
            if d.name not in set_here:
                set_here.add(d.name)
                edges.append(edge)
            snippet = text[d.start : d.end][:SNIPPET_LENGTH]
            evidence.append(_evidence(node_id, file, d.start, d.end, snippet))
            evidence.append(_evidence(edge.key, file, d.start, d.end))
            if d.enabled:
                own.add(d.name)

        data = text.encode("utf-8")
        at = _offsets(text, data)
        functions, found = _walk(parser.parse(data).root_node, data, at)
        repeats: dict[str, int] = {}
        for f in functions:
            n = repeats[f.written] = repeats.get(f.written, 0) + 1
            symbol = f"{file.path}::{f.written}" + ("" if n == 1 else f"#{n}")
            f.id = f"Function:{symbol}"
            above, summary = _comment_above(text, comments, f.start)
            nodes.append(
                Node(
                    id=f.id,
                    type="Function",
                    key=symbol,
                    label=f.written,
                    summary=summary,
                    props=_json({"symbol": symbol, "name": f.name}),
                )
            )
            for name in dict.fromkeys((f.name, f.written)):
                aliases.append(Alias(text=name, node=f.id, origin="source"))
            snippet = text[f.start if above is None else above : f.body].rstrip()
            evidence.append(_evidence(f.id, file, f.start, f.end, snippet[:SNIPPET_LENGTH]))
            edge = Edge(type="defined_in", src=f.id, dst=file_id)
            edges.append(edge)
            evidence.append(_evidence(edge.key, file, f.start, f.end))
            own.update((f.name, f.written))

        starts = [f.start for f in functions]
        for start, end in _condition_names(code, directives):
            i: int | None = bisect_right(starts, start) - 1
            while i is not None and i >= 0 and not functions[i].start <= start < functions[i].end:
                i = functions[i].parent
            inside = file_id if i is None or i < 0 else functions[i].id
            mentions.append(_mention(file, inside, "code.condition", start, end))
        lines = [d.start for d in directives]
        for fn, start, end in found:
            name = text[start:end]
            i = bisect_right(lines, start) - 1
            if i >= 0 and start < directives[i].end:
                continue  # a preprocessor line: its condition names are read above
            if name in own or name in functions[fn].locals or name in _KEYWORDS:
                continue
            role = "code.call" if _CALLED.match(code, end) else "code.use"
            mentions.append(_mention(file, functions[fn].id, role, start, end))

    return Content(
        header=Header(kind="tessera", producer=PRODUCER, settings=settings.as_json()),
        sources=[f.source for f in files],
        types=[
            Type(name="File", kind="node", key_prop="path", props=_json({"path": "text"})),
            Type(
                name="Define",
                kind="node",
                key_prop="name",
                props=_json({"name": "text", "value": "text", "enabled": "boolean"}),
            ),
            Type(
                name="Function",
                kind="node",
                key_prop="symbol",
                props=_json({"symbol": "text", "name": "text"}),
            ),
            Type(name="defined_in", kind="edge", from_type="Function", to_type="File"),
            Type(name="set_in", kind="edge", from_type="Define", to_type="File"),
        ],
        nodes=nodes,
        edges=edges,
        aliases=aliases,
        evidence=evidence,
        mentions=mentions,
    )


def _json(value: Mapping[str, object]) -> str:
    """Canonical JSON text (RFC 8785, section 3.1) of an object of JSON values."""
    return canonical_json(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _evidence(
    subject: str | EdgeKey, file: TextFile, start: int, end: int, snippet: str | None = None
) -> Evidence:
    return Evidence(
        subject=subject,
        source=file.source.id,
        locator=file.locator(start, end),
        method="extracted",
        producer=PRODUCER,
        snippet=snippet or None,
    )


def _mention(file: TextFile, node: str, role: str, start: int, end: int) -> Mention:
    return Mention(
        text=file.text[start:end],
        locator=file.locator(start, end),
        node=node,
        role=role,
        kind="identifier",
    )


def _blank_comments(text: str) -> tuple[str, list[tuple[int, int]]]:
    """``text`` with each comment as spaces (line breaks kept), and where the comments are."""
    parts: list[str] = []
    comments: list[tuple[int, int]] = []
    done = 0
    for m in _COMMENT_OR_QUOTED.finditer(text):
        if text[m.start()] != "/":
            continue  # a quoted text: nothing in it is a comment
        comments.append((m.start(), m.end()))
        parts += (text[done : m.start()], re.sub(r"[^\n]", " ", m.group()))
        done = m.end()
    parts.append(text[done:])
    return "".join(parts), comments


def _directives(code: str) -> list[_Directive]:
    found: list[_Directive] = []
    done = 0
    for m in _DIRECTIVE.finditer(code):
        if m.start() < done:
            continue  # a continuation line of the directive before
        line, end = m.start(), _line_end(code, m.end())
        while end < len(code) and code[line:end].rstrip().endswith("\\"):
            line, end = end + 1, _line_end(code, end + 1)
        found.append(_Directive(m.start(), end, m.group(1), m.end()))
        done = end
    return found


def _line_end(text: str, start: int) -> int:
    end = text.find("\n", start)
    return len(text) if end == -1 else end


def _defines(
    text: str,
    code: str,
    comments: list[tuple[int, int]],
    directives: list[_Directive],
    commented: bool,
) -> list[_Define]:
    """The file's defines in the order of their lines, each from its ``#`` or ``//``."""
    found: list[_Define] = []
    for d in directives:
        m = _DEFINED_NAME.match(code, d.rest, d.end) if d.word == "define" else None
        if m is not None:
            start = code.index("#", d.start)
            value = _CONTINUATION.sub(" ", code[m.end() : d.end]).strip()
            end = start + len(text[start : d.end].rstrip())
            found.append(_Define(m.group(1), value, True, start, end))
    if commented:
        line_comments = {start for start, _ in comments}
        for m in _COMMENTED_DEFINE.finditer(text):
            if m.start(1) in line_comments:
                value = _blank_comments(m.group(3))[0].strip()
                end = m.start(1) + len(m.group(1).rstrip())
                found.append(_Define(m.group(2), value, False, m.start(1), end))
    return sorted(found, key=lambda d: d.start)


def _condition_names(code: str, directives: list[_Directive]) -> Iterator[tuple[int, int]]:
    """Where the names in preprocessor conditions are."""
    for d in directives:
        if d.word not in _CONDITIONS:
            continue
        for m in _WORD.finditer(code, d.rest, d.end):
            word = m.group()
            if not (word[0].isalpha() or word[0] == "_") or word == "defined":  # text, number
                continue
            if not _CALLED.match(code, m.end(), d.end):
                yield m.start(), m.end()


def _offsets(text: str, data: bytes) -> Callable[[int], int]:
    """From a byte offset in ``data`` to the offset of its character in ``text``."""
    if len(data) == len(text):
        return lambda offset: offset
    table: list[int] = []
    for i, c in enumerate(text):
        o = ord(c)
        table.extend((i,) * (1 if o < 0x80 else 2 if o < 0x800 else 3 if o < 0x10000 else 4))
    table.append(len(text))
    return table.__getitem__


def _walk(
    root: Syntax, data: bytes, at: Callable[[int], int]
) -> tuple[list[_Function], list[tuple[int, int, int]]]:
    """The function definitions in document order, and the plain names in their bodies as
    (index of the innermost function, start, end)."""
    functions: list[_Function] = []
    found: list[tuple[int, int, int]] = []
    stack: list[tuple[Syntax, int | None, bool]] = [(root, None, False)]
    while stack:
        node, fn, body = stack.pop()
        kind = node.type
        if kind == "identifier":
            # A parse error leaves empty identifiers where the parser expected a name.
            if body and fn is not None and node.end_byte > node.start_byte:
                found.append((fn, at(node.start_byte), at(node.end_byte)))
            continue
        if fn is not None and kind in _DECLARATIONS:
            functions[fn].locals.update(_declared(node, data))
        if kind == "field_declaration_list":
            body = False  # a class in a body: its members are not the function's code
        elif kind == "function_definition" and not body:
            made = _function(node, data, at, fn)
            if made is not None:
                functions.append(made)
                block = node.child_by_field_name("body")
                assert block is not None
                for child in reversed(node.children):
                    stack.append((child, len(functions) - 1, child.id == block.id))
                continue
        for child in reversed(node.children):
            stack.append((child, fn, body))
    return functions, found


def _function(
    node: Syntax, data: bytes, at: Callable[[int], int], parent: int | None
) -> _Function | None:
    block = node.child_by_field_name("body")
    declarator = node.child_by_field_name("declarator")
    while declarator is not None and declarator.type != "function_declarator":
        declarator = _inner(declarator)
    name = None if declarator is None else declarator.child_by_field_name("declarator")
    if block is None or block.type != "compound_statement" or name is None:
        return None
    if name.type not in _NAMES:
        return None
    last = name
    while last.type == "qualified_identifier":
        inner = last.child_by_field_name("name")
        if inner is None:
            break
        last = inner
    outer = node
    while outer.parent is not None and outer.parent.type == "template_declaration":
        outer = outer.parent
    return _Function(
        name=_text(last, data),
        written=_text(name, data),
        start=at(outer.start_byte),
        end=at(node.end_byte),
        body=at(block.start_byte),
        parent=parent,
    )


def _text(node: Syntax, data: bytes) -> str:
    return " ".join(data[node.start_byte : node.end_byte].decode("utf-8").split())


def _inner(declarator: Syntax) -> Syntax | None:
    found = declarator.child_by_field_name("declarator")
    if found is None:
        kinds = (
            c for c in declarator.named_children if c.type.endswith(("declarator", "identifier"))
        )
        found = next(kinds, None)
    return found


def _declared(node: Syntax, data: bytes) -> Iterator[str]:
    """The names a declaration or parameter declares."""
    for declarator in node.children_by_field_name("declarator"):
        d: Syntax | None = declarator
        while d is not None and d.type not in ("identifier", "structured_binding_declarator"):
            d = _inner(d)
        if d is None:
            continue
        for named in [d] if d.type == "identifier" else d.named_children:
            if named.type == "identifier":
                yield _text(named, data)


def _comment_above(
    text: str, comments: list[tuple[int, int]], start: int
) -> tuple[int | None, str | None]:
    """Where the comment directly above the line of ``start`` begins, and its first line of
    text. A blank line, or code on the comment's line, parts them."""
    line = below = text.rfind("\n", 0, start) + 1
    i = bisect_right(comments, (below, below)) - 1
    first: int | None = None
    while i >= 0:
        begin, end = comments[i]
        gap = text[end:below]
        if end > below or gap.strip() or gap.count("\n") > 1:
            break
        if text[text.rfind("\n", 0, begin) + 1 : begin].strip():
            break
        first = begin
        if not text.startswith("//", begin):
            break  # a block comment is whole; `//` lines go on upwards
        below, i = begin, i - 1
    if first is None:
        return None, None
    lines = (_MARKERS.sub("", raw).strip() for raw in text[first:line].splitlines())
    return first, next((line for line in lines if line), None)
