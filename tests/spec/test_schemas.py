"""The four JSON Schemas are valid draft 2020-12 and accept/reject the documented cases.

Part 2 (Pattern schemas) says: "both examples validate, and nine broken variants are
rejected, including a missing format, an unpinned piece, an edge with both `mentions`
and `map`, a computed mapping and a confidence above 1."
"""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from jsonschema.protocols import Validator

from tests.conftest import SPEC

EXAMPLES = Path(__file__).parent / "examples"
SCHEMAS = ["pattern", "proposals", "build-report", "answers"]


def _schema(name: str) -> dict[str, Any]:
    return json.loads((SPEC / f"{name}.schema.json").read_text(encoding="utf-8"))


def _validator(name: str) -> Validator:
    return Draft202012Validator(_schema(name))


def _load(name: str) -> Any:
    text = (EXAMPLES / name).read_text(encoding="utf-8")
    return json.loads(text) if name.endswith(".json") else yaml.safe_load(text)


@pytest.mark.parametrize("name", SCHEMAS)
def test_schema_is_valid_2020_12(name: str) -> None:
    schema = _schema(name)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize(
    ("schema", "example"),
    [
        ("pattern", "pattern-museum.yaml"),
        ("proposals", "proposals.yaml"),
        ("build-report", "build-report.json"),
    ],
)
def test_documented_examples_validate(schema: str, example: str) -> None:
    errors = list(_validator(schema).iter_errors(_load(example)))
    assert errors == [], [e.message for e in errors]


def _pattern_variants() -> list[tuple[str, dict[str, Any]]]:
    base = _load("pattern-museum.yaml")
    out = []

    def variant(label: str, change: Any) -> None:
        p = copy.deepcopy(base)
        change(p)
        out.append((label, p))

    variant("missing format", lambda p: p.pop("format"))
    variant("unpinned piece", lambda p: p["pieces"].__setitem__(0, "catalogue"))
    variant("short hash", lambda p: p["pieces"].__setitem__(0, "catalogue@9f2c"))
    variant(
        "edge with mentions and map",
        lambda p: p["edges"]["describes"].__setitem__("map", ["code.calls"]),
    )
    variant("edge with neither", lambda p: p["edges"]["describes"].pop("mentions"))
    variant(
        "computed mapping",
        lambda p: p["types"]["Sculpture"]["from"]["catalogue.Row"].__setitem__("tag", "upper(Tag)"),
    )
    variant(
        "mapping value not a name",
        lambda p: p["types"]["Sculpture"]["from"]["catalogue.Row"].__setitem__(
            "tag", {"concat": 1}
        ),
    )
    variant(
        "lower-case type", lambda p: p["types"].__setitem__("sculpture", p["types"]["Sculpture"])
    )
    variant(
        "upper-case edge", lambda p: p["edges"].__setitem__("Describes", p["edges"]["describes"])
    )
    variant(
        "unknown normalise step",
        lambda p: p["types"]["Sculpture"].__setitem__("normalise", ["slug"]),
    )
    variant(
        "describe too long", lambda p: p["types"]["Sculpture"].__setitem__("describe", "x" * 201)
    )
    variant("trust zero", lambda p: p["mosaics"]["curators"].__setitem__("trust", 0))
    variant("trust above 1", lambda p: p["mosaics"]["curators"].__setitem__("trust", 1.5))
    variant("bad budget", lambda p: p["mosaics"]["curators"].__setitem__("budget", "twenty"))
    variant("unknown target field", lambda p: p["mosaics"]["curators"].__setitem__("cache", True))
    # Section 5.1, decision: a piece name contains no ".".
    variant("dotted piece name", lambda p: p["pieces"].__setitem__(0, "sculpture.list@9f2c41d0"))
    variant(
        "dotted piece name in an object",
        lambda p: p["pieces"].__setitem__(0, {"name": "sculpture.list", "hash": "9f2c41d0"}),
    )
    return out


@pytest.mark.parametrize(
    ("label", "doc"), _pattern_variants(), ids=lambda x: x if isinstance(x, str) else ""
)
def test_broken_patterns_rejected(label: str, doc: dict[str, Any]) -> None:
    assert not _validator("pattern").is_valid(doc), label


def _proposal_variants() -> list[tuple[str, dict[str, Any]]]:
    base = _load("proposals.yaml")
    out = []

    def variant(label: str, change: Any) -> None:
        p = copy.deepcopy(base)
        change(p)
        out.append((label, p))

    variant("confidence above 1", lambda p: p["proposals"][0].__setitem__("confidence", 1.2))
    variant("assistant without confidence", lambda p: p["proposals"][0].pop("confidence"))
    variant("person with confidence", lambda p: p["proposals"][1].__setitem__("confidence", 0.9))
    variant("decided without decided_by", lambda p: p["proposals"][1].pop("decided_by"))
    variant("open with decided_by", lambda p: p["proposals"][0].__setitem__("decided_by", "bob"))
    variant("identity without same_as", lambda p: p["proposals"][0].pop("same_as"))
    variant("edge with same_as", lambda p: p["proposals"][1].__setitem__("same_as", ["X"]))
    variant("no evidence", lambda p: p["proposals"][0].__setitem__("evidence", []))
    variant("unknown decision", lambda p: p["proposals"][0].__setitem__("decision", "maybe"))
    variant("extra field", lambda p: p["proposals"][0].__setitem__("score", 3))
    return out


@pytest.mark.parametrize(
    ("label", "doc"), _proposal_variants(), ids=lambda x: x if isinstance(x, str) else ""
)
def test_broken_proposals_rejected(label: str, doc: dict[str, Any]) -> None:
    assert not _validator("proposals").is_valid(doc), label


def test_failed_build_report_needs_reason() -> None:
    report = _load("build-report.json")
    report["outcome"] = "failed"
    assert not _validator("build-report").is_valid(report)
    report["reason"] = "over_budget"
    report["knowledge_hash"] = None
    report["file_size"] = None
    assert _validator("build-report").is_valid(report)


@pytest.mark.parametrize(
    "case",
    json.loads((Path(__file__).parent / "cases" / "answers.json").read_text("utf-8")),
    ids=lambda c: c["name"],
)
def test_answers_validate_as_expected(case: dict[str, Any]) -> None:
    errors = list(_validator("answers").iter_errors(case["answer"]))
    assert (errors == []) is case["valid"], [e.message for e in errors]


def _alias_conflict_variants() -> list[tuple[str, dict[str, Any]]]:
    """Alias conflicts (section 7.2, decision): broken shapes the schema must reject."""
    base = _load("build-report.json")
    entry = base["alias_conflicts"][0]
    variants = []

    def with_entry(label: str, changed: dict[str, Any]) -> None:
        doc = copy.deepcopy(base)
        doc["alias_conflicts"] = [changed]
        variants.append((label, doc))

    missing = copy.deepcopy(base)
    del missing["alias_conflicts"]
    variants.append(("alias_conflicts missing", missing))
    with_entry("no losers", {**entry, "losers": []})
    with_entry("a property name", {**entry, "property": "alias"})
    with_entry("a non-text spelling", {**entry, "winner": {"value": 3, "piece": "catalogue"}})
    with_entry("an empty spelling", {**entry, "winner": {"value": "", "piece": "catalogue"}})
    with_entry("no piece", {**entry, "losers": [{"value": "t-1889"}]})
    return variants


@pytest.mark.parametrize(
    ("label", "doc"), _alias_conflict_variants(), ids=lambda x: x if isinstance(x, str) else ""
)
def test_broken_alias_conflicts_rejected(label: str, doc: dict[str, Any]) -> None:
    assert not _validator("build-report").is_valid(doc), label


def test_alias_conflict_from_a_proposal_validates() -> None:
    report = _load("build-report.json")
    loser = {"value": "t-1889", "piece": "proposals.yaml"}
    report["alias_conflicts"][0]["losers"].append(loser)
    assert _validator("build-report").is_valid(report)


def test_a_conflict_names_a_node_or_an_edge_but_not_both() -> None:
    """Section 7.3: a conflict names a node by its id, or an edge by type, from, to, qualifier."""
    report = _load("build-report.json")
    conflict = report["conflicts"][0]
    edge = {"type": "reads", "from": "Step:A", "to": "Sculpture:T-1889", "qualifier": ""}
    on_edge = {k: v for k, v in conflict.items() if k != "node"} | {"edge": edge}
    report["conflicts"] = [conflict, on_edge]
    assert _validator("build-report").is_valid(report)
    report["conflicts"] = [conflict | {"edge": edge}]
    assert not _validator("build-report").is_valid(report), "node and edge"
    report["conflicts"] = [{k: v for k, v in conflict.items() if k != "node"}]
    assert not _validator("build-report").is_valid(report), "neither node nor edge"
    report["conflicts"] = [on_edge | {"edge": {k: v for k, v in edge.items() if k != "qualifier"}}]
    assert not _validator("build-report").is_valid(report), "edge without qualifier"


def _failed_report(reason: str) -> dict[str, Any]:
    """The documented report as section 7.3 describes it for a build that failed with `reason`."""
    report = _load("build-report.json")
    report["outcome"] = "failed"
    report["reason"] = reason
    if reason == "over_budget":  # sealed, then removed: hashes, size, counts and lists stay
        return report
    report["knowledge_hash"] = report["vector_hash"] = report["file_size"] = None
    if reason == "strict":  # steps 1-7 ran, nothing was sealed: counts and lists stay
        return report
    report["pattern_hash"] = None  # step 1: the pattern file may not even be readable
    report["counts"] = {"nodes": {}, "edges": {}}
    for name in (
        "conflicts",
        "alias_conflicts",
        "stale_references",
        "mentions",
        "weak_ids",
        "proposals",
        "notices",
    ):
        report[name] = []
    return report


@pytest.mark.parametrize("reason", ["invalid_input", "piece_mismatch", "strict", "over_budget"])
def test_failed_reports_as_section_7_3_describes_them_validate(reason: str) -> None:
    """Decision Q2: a schema-fit check that each failed report §7.3 describes is a valid
    report. Whether a builder writes these reports is for the builder's own tests."""
    report = _failed_report(reason)
    assert list(_validator("build-report").iter_errors(report)) == []


def test_the_schema_refuses_what_section_7_2_and_7_3_rule_out() -> None:
    """A weak-ids entry with count 0 is not listed (§7.2); a built report has hashes."""
    weak = _load("build-report.json")
    weak["weak_ids"] = [{"type": "Section", "count": 0}]
    assert not _validator("build-report").is_valid(weak)
    built = _load("build-report.json")
    built["knowledge_hash"] = None
    assert not _validator("build-report").is_valid(built)
