"""Read a pattern, proposals, settings or view file as YAML, rejecting duplicate keys (section 5).

The loader is ``ruamel.yaml``'s safe loader, which reads YAML 1.2 and refuses a duplicate key
and a tag it does not know. Two rules are added here, because the files are checked against
JSON Schemas: every mapping key is text, and every value is JSON data (so a date is quoted).
"""

from dataclasses import dataclass, field
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.constructor import DuplicateKeyError
from ruamel.yaml.error import MarkedYAMLError, YAMLError
from ruamel.yaml.nodes import MappingNode, Node, SequenceNode

MAX_VALUES = 100_000
"""The most values a document may hold, a repeated alias counted at each use (section 10)."""

type Path = tuple[str | int, ...]
"""Where a value lies in the document: mapping keys and sequence indexes from the root."""


class YamlError(ValueError):
    """Not YAML that holds JSON data; ``rule`` is ``yaml`` or ``duplicate-key``."""

    def __init__(self, file: str, line: int | None, rule: str, message: str) -> None:
        self.file = file
        self.line = line
        self.rule = rule
        self.message = message
        where = file if line is None else f"{file}:{line}"
        super().__init__(f"{where}: {message}")


@dataclass(frozen=True)
class Document:
    """The data of one YAML file and the line (1-based) where each value starts."""

    data: Any
    lines: dict[Path, int] = field(default_factory=dict)

    def line(self, path: Path) -> int | None:
        """The line of ``path``, else of its nearest parent that has one."""
        for end in range(len(path), -1, -1):
            if path[:end] in self.lines:
                return self.lines[path[:end]]
        return None


class _Check:
    """Walks the parsed nodes beside the loaded data: notes lines, refuses what is not JSON."""

    def __init__(self, file: str) -> None:
        self.file = file
        self.lines: dict[Path, int] = {}
        self.count = 0

    def fail(self, node: Node, message: str) -> YamlError:
        return YamlError(self.file, node.start_mark.line + 1, "yaml", message)

    def walk(self, node: Node, data: object, path: Path) -> None:
        self.lines.setdefault(path, node.start_mark.line + 1)
        self.count += 1
        if self.count > MAX_VALUES:
            raise self.fail(node, f"document too large: more than {MAX_VALUES} values")
        if isinstance(node, MappingNode) and isinstance(data, dict):
            for key_node, value_node in node.value:
                key = key_node.value
                if isinstance(key, str) and key in data and key_node.tag.endswith(":str"):
                    self.lines[(*path, key)] = key_node.start_mark.line + 1
                    self.walk(value_node, data[key], (*path, key))
            for key in data:
                if not isinstance(key, str):
                    raise self.fail(node, f"a mapping key must be text, not {key!r}; quote it")
        elif isinstance(node, SequenceNode) and isinstance(data, list):
            for index, (item_node, item) in enumerate(zip(node.value, data, strict=True)):
                self.walk(item_node, item, (*path, index))
        elif not (data is None or isinstance(data, (str, bool, int, float))):
            kind = type(data).__name__
            raise self.fail(node, f"a {kind} is not text, a number, true, false or null; quote it")


def load(text: str, file: str) -> Document:
    """Read ``text``, the contents of ``file``, as one YAML document of JSON data.

    Raises :class:`YamlError` naming the file and line when the text is not YAML, holds a
    duplicate key, an unknown tag, a key that is not text, a value that is not JSON data, or
    more than one document.
    """
    yaml = YAML(typ="safe", pure=True)
    check = _Check(file)
    try:
        node = yaml.compose(text)
        if node is None:
            return Document(None)
        data = yaml.constructor.construct_document(node)
        check.walk(node, data, ())
    except YamlError:
        raise
    except DuplicateKeyError as e:
        line = None if e.problem_mark is None else e.problem_mark.line + 1
        raise YamlError(file, line, "duplicate-key", f"duplicate key: {e.problem}") from None
    except MarkedYAMLError as e:
        mark = e.problem_mark or e.context_mark
        line = None if mark is None else mark.line + 1
        problem = e.problem or e.context or "unreadable"
        raise YamlError(file, line, "yaml", f"not valid YAML: {problem}") from None
    except YAMLError as e:
        raise YamlError(file, None, "yaml", f"not valid YAML: {e}") from None
    except ValueError as e:
        raise YamlError(file, None, "yaml", f"not valid YAML: {e}") from None
    except RecursionError:
        raise YamlError(file, None, "yaml", "not valid YAML: nested too deep") from None
    return Document(data, check.lines)
