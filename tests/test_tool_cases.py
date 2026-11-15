"""The kit's tool cases on the Chinook mosaic, checked without a mosaic.

Specification 0.1, section 11: "tool cases with expected answers, on the Chinook mosaic. A kit's
answers match and are valid against ``answers.schema.json``". The slow test
(``tests/fixtures/test_chinook_tools.py``) builds the mosaic and runs every case in the kit; these
fast tests check every case's arguments (section 8.1) and expected answer (section 8.2,
``spec/answers.schema.json``), and that the cases cover each tool, each ``find`` tier and the
errors.
"""

import itertools
import json
import re
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from tests.conftest import REPO
from tests.fixtures.expected import load_expected
from tests.fixtures.tool_cases import SCHEMA, argument_problem, load

DATA = load()
CASES: dict[str, Any] = DATA["cases"]
VALIDATOR = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
CHINOOK = REPO / "conformance" / "fixtures" / "chinook"


def test_the_file_names_the_fixture_and_its_target() -> None:
    assert set(DATA) == {"comment", "fixture", "target", "cases"}
    assert DATA["fixture"] == "chinook"
    assert DATA["target"] in load_expected(CHINOOK)
    assert CASES


@pytest.mark.parametrize("name", list(CASES))
def test_every_case_calls_a_tool_with_the_arguments_section_8_1_gives_it(name: str) -> None:
    case = CASES[name]
    assert set(case) == {"tool", "arguments", "answer"}
    assert argument_problem(case["tool"], case["arguments"]) is None


@pytest.mark.parametrize("name", list(CASES))
def test_every_expected_answer_is_valid_against_the_answers_schema(name: str) -> None:
    errors = [e.message for e in VALIDATOR.iter_errors(CASES[name]["answer"])]
    assert not errors, errors


@pytest.mark.parametrize("name", list(CASES))
def test_every_answer_is_from_its_tool_and_the_expected_mosaic(name: str) -> None:
    """Section 8.2: each answer names its tool and the knowledge hash of the mosaic it read."""
    case = CASES[name]
    expected = load_expected(CHINOOK)[DATA["target"]]
    assert case["answer"]["tool"] == case["tool"]
    assert case["answer"]["mosaic"] == expected.knowledge_hash


def test_the_cases_cover_every_tool_with_an_answer_and_an_error() -> None:
    for tool in ("find", "get", "neighbors", "table", "cite"):
        answers = [c["answer"] for c in CASES.values() if c["tool"] == tool]
        assert any("data" in a for a in answers), tool
        assert any("error" in a for a in answers), tool


def test_the_find_cases_cover_each_tier() -> None:
    """Section 8.5: exact, text and vector."""
    tiers = {
        r["match"]
        for c in CASES.values()
        if c["tool"] == "find" and "data" in c["answer"]
        for r in c["answer"]["data"]["results"]
    }
    assert tiers == {"exact", "text", "vector"}
    exact_by_key = [
        c
        for c in CASES.values()
        if c["tool"] == "find"
        and ":" not in c["arguments"]["query"]
        and any(r["match"] == "exact" for r in c["answer"].get("data", {}).get("results", []))
    ]
    assert exact_by_key, "an exact match by key, not only by id"


def test_the_cases_cover_the_errors_a_reader_can_cause() -> None:
    codes = {c["answer"]["error"]["code"] for c in CASES.values() if "error" in c["answer"]}
    assert {"unknown_id", "unknown_type", "unknown_edge", "unknown_column", "bad_argument"} <= codes


def test_an_unknown_id_names_the_closest_matches() -> None:
    """Section 8.1: an unknown id is an error naming the closest matches, never empty success."""
    unknown = [c["answer"] for c in CASES.values() if "error" in c["answer"]]
    unknown = [a for a in unknown if a["error"]["code"] == "unknown_id"]
    assert unknown
    assert any(a["error"]["suggestions"] for a in unknown)


MARKER = "…"
TIER_ORDER = {"exact": 0, "text": 1, "vector": 2}


def _by(text: str) -> bytes:
    return text.encode("utf-8")


def _cases(tool: str, kind: str) -> list[tuple[str, dict[str, Any]]]:
    return [
        (n, c)
        for n, c in CASES.items()
        if c["tool"] == tool and (kind in c["answer"] or kind == "any")
    ]


def _answered(tool: str) -> list[str]:
    return [n for n, _ in _cases(tool, "data")]


# --- find: tiers and ties (section 8.5) ---------------------------------------------------------


@pytest.mark.parametrize("name", _answered("find"))
def test_find_results_are_listed_tier_by_tier_each_node_once(name: str) -> None:
    results = CASES[name]["answer"]["data"]["results"]
    tiers = [TIER_ORDER[r["match"]] for r in results]
    assert tiers == sorted(tiers), "exact, then text, then vector (8.5)"
    ids = [r["id"] for r in results]
    assert len(ids) == len(set(ids)), "a vector match 'not already listed' is not listed twice"


@pytest.mark.parametrize("name", _answered("find"))
def test_find_exact_matches_are_in_id_order(name: str) -> None:
    """Section 8.5: within a tier ties break by id; an exact tier has no engine order, so ids."""
    exact = [r["id"] for r in CASES[name]["answer"]["data"]["results"] if r["match"] == "exact"]
    assert exact == sorted(exact, key=_by)


# --- text is length-limited and cut with a marker (section 8.2) -----------------------------------


def test_every_label_is_at_most_120_characters_or_cut_to_120_with_the_marker() -> None:
    for name, case in CASES.items():
        data = case["answer"].get("data", {})
        labels = [r["label"] for r in data.get("results", []) + data.get("edges", [])]
        labels += [data["label"]] if "label" in data else []
        for label in labels:
            if label is None:
                continue
            assert len(label) <= 121, name
            if len(label) == 121:
                assert label.endswith(MARKER), f"{name}: a cut label ends in the marker"


# --- get (section 8.1) --------------------------------------------------------------------------


@pytest.mark.parametrize("name", _answered("get"))
def test_get_links_are_one_per_edge_type_and_direction_each_counted(name: str) -> None:
    data = CASES[name]["answer"]["data"]
    pairs = [(link["edge"], link["direction"]) for link in data["links"]]
    assert len(pairs) == len(set(pairs))
    assert data["links_total"] == len(data["links"]) <= 20
    assert data["aliases_total"] == len(data["aliases"])
    assert data["external_refs_total"] == len(data["external_refs"])
    assert data["id"] == CASES[name]["arguments"]["id"]
    assert data["id"].split(":", 1)[0] == data["type"]


# --- neighbors (section 8.1) --------------------------------------------------------------------


@pytest.mark.parametrize("name", _answered("neighbors"))
def test_neighbors_edges_are_the_edge_and_direction_asked_for_with_no_edge_twice(
    name: str,
) -> None:
    case = CASES[name]
    arguments = case["arguments"]
    data = case["answer"]["data"]
    assert data["id"] == arguments["id"]
    keys = [(e["edge"], e["direction"], e["id"], e.get("qualifier", "")) for e in data["edges"]]
    assert len(keys) == len(set(keys))
    for edge in data["edges"]:
        if "edge" in arguments:
            assert edge["edge"] == arguments["edge"]
        if arguments.get("direction", "both") != "both":
            assert edge["direction"] == arguments["direction"]


# --- table (section 8.6) ------------------------------------------------------------------------


def _cell(case: dict[str, Any], row: list[Any], column: str) -> Any:
    return row[case["answer"]["data"]["columns"].index(column)]


def _holds(cell: Any, op: str, value: Any) -> bool:
    """Section 8.6, ``where``: a value is compared only with a value of its own kind."""
    same = (
        (isinstance(cell, bool) and isinstance(value, bool))
        or (
            isinstance(cell, (int, float))
            and not isinstance(cell, bool)
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
        )
        or (isinstance(cell, str) and isinstance(value, str))
    )
    if op == "contains":
        if isinstance(cell, str):
            return str(value).lower() in cell.lower()
        if isinstance(cell, list):
            return any(isinstance(i, str) and str(value).lower() in i.lower() for i in cell)
        return False
    if op == "!=":
        return not (same and cell == value)
    if not same:
        return False
    if isinstance(cell, str):
        cell, value = _by(cell), _by(value)
    return {
        "=": cell == value,
        "<": cell < value,
        "<=": cell <= value,
        ">": cell > value,
        ">=": cell >= value,
    }[op]


@pytest.mark.parametrize("name", _answered("table"))
def test_table_columns_start_with_id_and_name_each_column_once(name: str) -> None:
    case = CASES[name]
    data = case["answer"]["data"]
    columns = data["columns"]
    assert columns[0] == "id"
    assert len(columns) == len(set(columns)) <= 21
    wanted = case["arguments"].get("columns")
    if wanted is not None:
        assert columns[1:] == wanted
    assert all(len(row) == len(columns) for row in data["rows"])
    assert data["type"] == case["arguments"]["type"]


@pytest.mark.parametrize("name", _answered("table"))
def test_table_rows_are_nodes_of_the_type_each_once(name: str) -> None:
    data = CASES[name]["answer"]["data"]
    ids = [row[0] for row in data["rows"]]
    assert len(ids) == len(set(ids))
    assert all(i.startswith(f"{data['type']}:") for i in ids)


@pytest.mark.parametrize(
    "name", [n for n in _answered("table") if "order" not in CASES[n]["arguments"]]
)
def test_table_rows_without_order_are_in_id_order_by_utf8_bytes(name: str) -> None:
    case = CASES[name]
    ids = [row[0] for row in case["answer"]["data"]["rows"]]
    assert ids == sorted(ids, key=_by), "section 8.6: calls without order go by id (UTF-8 bytes)"


@pytest.mark.parametrize("name", _answered("table"))
def test_table_rows_keep_the_condition_the_call_gave(name: str) -> None:
    case = CASES[name]
    where = case["arguments"].get("where")
    if where is None:
        return
    conditions = where if isinstance(where, list) else [where]
    for row in case["answer"]["data"]["rows"]:
        for condition in conditions:
            cell = _cell(case, row, condition["column"])
            assert _holds(cell, condition["op"], condition["value"]), (row[0], condition)


@pytest.mark.parametrize("name", _answered("table"))
def test_table_rows_are_in_the_order_the_call_gave_with_ties_by_id(name: str) -> None:
    case = CASES[name]
    order = case["arguments"].get("order")
    if order is None:
        return
    orders = order if isinstance(order, list) else [order]
    orders = [{"column": o, "direction": "asc"} if isinstance(o, str) else o for o in orders]
    rows = case["answer"]["data"]["rows"]

    def group(value: Any) -> tuple[int, Any]:
        if value is None:
            return (5, 0)
        if isinstance(value, bool):
            return (0, value)
        if isinstance(value, (int, float)):
            return (1, value)
        if isinstance(value, str):
            return (2, _by(value))
        if isinstance(value, list):
            return (3, _by(json.dumps(value, ensure_ascii=False)))
        return (4, _by(json.dumps(value, ensure_ascii=False)))

    for earlier, later in itertools.pairwise(rows):
        for o in orders:
            a, b = (_cell(case, r, o["column"]) for r in (earlier, later))
            ga, gb = group(a), group(b)
            if ga == gb:
                continue
            if o.get("direction", "asc") == "desc" and ga[0] == gb[0] and ga[0] != 5:
                ga, gb = gb, ga
            assert ga < gb, (earlier[0], later[0], o)
            break
        else:
            assert _by(earlier[0]) < _by(later[0]), "ties go by id"


# --- cite (section 8.1, 3.5) --------------------------------------------------------------------


@pytest.mark.parametrize("name", _answered("cite"))
def test_cite_evidence_follows_the_locator_and_method_rules_of_section_3_5(name: str) -> None:
    for row in CASES[name]["answer"]["data"]["evidence"]:
        for pair in row["locator"].split(";"):
            assert re.fullmatch(r"[a-z]+=[^;=]+", pair), (name, row["locator"])
        if row["method"] == "extracted":
            assert row["confidence"] is None, "an extracted row has NULL confidence (3.5)"
        else:
            assert row["confidence"] is not None
        assert "via" not in row or not row["via"], "a mosaic without mosaic pieces has no via"
