"""The view file's chains: named chains saved beside the other choices.

docs/design.md, "Viewer: chains and cards": V-1, a chain is a start and an ordered list of
steps; V-2, any step can be pinned to one thing or left open; V-15, chains are saved in the view
file, beside the other choices it already holds; V-16, anyone who opens the same mosaic with the
same view file sees the same chains; V-18, a view file whose chains name what the mosaic lacks
still opens (the page reports it: viewer/test/viewchains.test.ts).

The view file holds them under ``chains``, one entry per chain, named by its label, in the
order written:

    chains:
      Titles made in a country:
        start: Country
        pin: Country:United States        # optional: the one thing it starts from
        steps:
          - made_in in                    # a link: an edge type and its direction
          - link: directed_by out         # or a link with a pin
            pin: Person:Jane Doe

A step's type is the other end of its edge type, so a step names only its link.
"""

import json
import shutil
from pathlib import Path

import jsonschema
import pytest
import yaml
from mosaic_build import view
from mosaic_build.cli import main
from mosaic_build.view_file import ChainStep, ChainView, from_json, read

from tests import test_export
from tests.conftest import REPO

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "views" / "view.schema.json").read_text(encoding="utf-8"))
EXAMPLE = ROOT / "views" / "example.yaml"


def _write(tmp_path: Path, text: str | bytes, name: str = "view.yaml") -> Path:
    path = tmp_path / name
    if isinstance(text, bytes):
        path.write_bytes(text)
    else:
        path.write_text(text, encoding="utf-8", newline="")
    return path


def test_no_chains_is_none_set() -> None:
    assert read(None).chains is None
    assert read(None).as_json()["chains"] is None
    assert from_json({"search": "text"}).as_json()["chains"] is None


def test_chains_are_read_with_their_label_start_steps_and_pins_in_the_order_written(
    tmp_path: Path,
) -> None:
    text = (
        "chains:\n"
        "  Titles made here:\n"
        "    start: Country\n"
        "    pin: Country:United States\n"
        "    steps:\n"
        "      - made_in in\n"
        "      - link: directed_by out\n"
        "        pin: Person:Jane Doe\n"
        "  All genres:\n"
        "    start: Genre\n"
    )
    settings = read(_write(tmp_path, text))
    assert settings.chains == (
        ChainView(
            name="Titles made here",
            start="Country",
            pin="Country:United States",
            steps=(
                ChainStep(link="made_in in"),
                ChainStep(link="directed_by out", pin="Person:Jane Doe"),
            ),
        ),
        ChainView(name="All genres", start="Genre"),
    )
    assert settings.as_json()["chains"] == [
        {
            "name": "Titles made here",
            "start": "Country",
            "pin": "Country:United States",
            "steps": [
                {"link": "made_in in", "pin": None},
                {"link": "directed_by out", "pin": "Person:Jane Doe"},
            ],
        },
        {"name": "All genres", "start": "Genre", "pin": None, "steps": []},
    ]


def test_a_step_written_as_a_link_alone_and_with_no_pin_are_the_same(tmp_path: Path) -> None:
    short = read(_write(tmp_path, "chains:\n  C:\n    start: A\n    steps: [e out]\n"))
    long = from_json({"chains": {"C": {"start": "A", "steps": [{"link": "e out"}]}}})
    assert short.chains == long.chains


def test_a_link_is_spelled_as_a_card_s_alone_or_with_in_or_out(tmp_path: Path) -> None:
    """Decided for the maintainer: a step's link
    is spelled as in ``cards``; alone, the page follows it out. The reader keeps it as written."""
    text = "chains:\n  C:\n    start: A\n    steps: [e, e out, e in, {link: e, pin: 'B:x'}]\n"
    got = read(_write(tmp_path, text)).chains
    assert got is not None
    assert [s.link for s in got[0].steps] == ["e", "e out", "e in", "e"]
    jsonschema.validate({"chains": {"C": {"start": "A", "steps": ["e", {"link": "e"}]}}}, SCHEMA)


def test_no_chains_written_is_none_and_an_empty_mapping_is_none_saved() -> None:
    assert from_json({"chains": {}}).as_json()["chains"] == []


def test_labels_and_ids_may_hold_any_text() -> None:
    chain = {"start": "A", "pin": "A:x: y #z", "steps": [{"link": "e in", "pin": "A:“é” [1]"}]}
    got = from_json({"chains": {"Été: 2024 #1": chain}}).chains
    assert got is not None and got[0].name == "Été: 2024 #1"
    assert got[0].pin == "A:x: y #z" and got[0].steps[0].pin == "A:“é” [1]"


@pytest.mark.parametrize(
    ("text", "line", "setting"),
    [
        ("chains: [a, b]\n", 1, "chains"),
        ("chains:\n", 1, "chains"),
        ("chains:\n  C:\n", 2, "chains.C"),
        ("chains:\n  C: x\n", 2, "chains.C"),
        ("chains:\n  C:\n    pin: A:x\n", 2, "chains.C"),  # no start
        ("chains:\n  C:\n    start: ''\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start: 3\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start: A\n    pin: ''\n", 4, "chains.C.pin"),
        ("chains:\n  C:\n    start: A\n    from: B\n", 4, "chains.C.from"),
        ("chains:\n  C:\n    start: A\n    steps: e out\n", 4, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - e both\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - e sideways\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - 'e  out'\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - 7\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - pin: A:x\n", 5, "chains.C.steps"),
        (
            "chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n        to: B\n",
            6,
            "chains.C.steps.to",
        ),
        (
            "chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n        pin: 4\n",
            6,
            "chains.C.steps.pin",
        ),
    ],
)
def test_a_wrong_value_names_the_file_the_line_and_the_setting(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:{line}: view file: {setting}\b"):
        read(path)


def test_a_wrong_step_says_which_step(tmp_path: Path) -> None:
    text = "chains:\n  C:\n    start: A\n    steps:\n      - e out\n      - e in out\n"
    with pytest.raises(ValueError, match=r":6: view file: chains\.C\.steps: step 2 "):
        read(_write(tmp_path, text))


def test_a_label_written_twice_is_refused(tmp_path: Path) -> None:
    text = "chains:\n  C:\n    start: A\n  C:\n    start: B\n"
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:4: duplicate key 'C'"):
        read(path)


def test_the_example_view_file_saves_a_chain_and_the_schema_takes_it() -> None:
    settings = read(EXAMPLE)
    assert settings.chains, "views/example.yaml shows a chain"
    jsonschema.validate(yaml.safe_load(EXAMPLE.read_text(encoding="utf-8")), SCHEMA)


@pytest.mark.parametrize(
    "chains",
    [
        {"C": {"start": "A"}},
        {"C": {"start": "A", "pin": "A:x", "steps": ["e out", {"link": "f in", "pin": "B:y"}]}},
        {"C": {"start": "A", "steps": []}},
    ],
)
def test_the_schema_takes_what_the_reader_takes(chains: dict[str, object]) -> None:
    jsonschema.validate({"chains": chains}, SCHEMA)
    assert from_json({"chains": chains}).chains is not None


@pytest.mark.parametrize(
    "chains",
    [
        {"C": {"pin": "A:x"}},
        {"C": {"start": "A", "steps": ["e both"]}},
        {"C": {"start": "A", "steps": ["e sideways"]}},
        {"C": {"start": "A", "steps": [{"pin": "A:x"}]}},
        {"C": {"start": "A", "steps": [{"link": "e out", "to": "B"}]}},
        {"C": {"start": "A", "from": "B"}},
        {"C": {"start": ""}},
        {"": {"start": "A"}},
    ],
)
def test_the_schema_refuses_what_the_reader_refuses(chains: dict[str, object]) -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"chains": chains}, SCHEMA)
    with pytest.raises(ValueError):
        from_json({"chains": chains})


MOSAIC = REPO / "conformance" / "reading" / "mosaic.mosaic"

# The built viewer's stand-in, as tests/test_export.py lays it out.
dist = test_export.dist


def _reads(tmp_path: Path, text: str) -> bool:
    try:
        read(_write(tmp_path, text))
    except ValueError:
        return False
    return True


def _schema_accepts(text: str) -> bool:
    try:
        jsonschema.validate(yaml.safe_load(text), SCHEMA)
    except jsonschema.ValidationError:
        return False
    return True


def _chains(tmp_path: Path, text: str) -> tuple[ChainView, ...]:
    chains = read(_write(tmp_path, text)).chains
    assert chains is not None
    return chains


# Duplicates and order (spec 0.1 section 5: duplicate keys are rejected).


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("chains:\n  C:\n    start: A\n    start: B\n", 4),
        ("chains:\n  C:\n    start: A\n    pin: A:x\n    pin: A:y\n", 5),
        ("chains:\n  C:\n    start: A\n    steps: []\n    steps: [e out]\n", 5),
        ("chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n        link: f in\n", 6),
        ("chains:\n  C:\n    start: A\n  D:\n    start: A\nchains:\n  E:\n    start: A\n", 6),
        ("chains: {C: {start: A}, C: {start: B}}\n", 1),
    ],
)
def test_a_duplicate_key_in_chains_names_file_and_line(
    tmp_path: Path, text: str, line: int
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:{line}: "):
        read(path)


def test_steps_keep_their_order_and_a_repeated_step_stays_repeated(tmp_path: Path) -> None:
    text = "chains:\n  C:\n    start: A\n    steps: [e out, f in, e out, e out]\n"
    (chain,) = _chains(tmp_path, text)
    assert [s.link for s in chain.steps] == ["e out", "f in", "e out", "e out"]


# What the words of a chain may hold.


def test_an_edge_type_name_of_any_non_space_text_is_a_step(tmp_path: Path) -> None:
    text = (
        "chains:\n  C:\n    start: A\n"
        '    steps: ["é-😀.x in", "a:b out", "a\u00a0b out", "#x in"]\n'
    )
    (chain,) = _chains(tmp_path, text)
    assert [s.link for s in chain.steps] == ["é-😀.x in", "a:b out", "a\u00a0b out", "#x in"]


def test_a_pin_may_be_text_YAML_would_read_as_another_type(tmp_path: Path) -> None:
    text = (
        'chains:\n  C:\n    start: "null"\n    pin: "true"\n'
        '    steps:\n      - {link: e out, pin: "1.5"}\n'
    )
    (chain,) = _chains(tmp_path, text)
    assert (chain.start, chain.pin, chain.steps[0].pin) == ("null", "true", "1.5")


# Wrong values: the file, the line and the key (V-18's "the viewer reports").


@pytest.mark.parametrize(
    ("text", "line", "setting"),
    [
        ("chains:\n  C:\n    start: [A]\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start: true\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start: ~\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start:\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start: {a: b}\n", 3, "chains.C.start"),
        ("chains:\n  C:\n    start: A\n    pin:\n", 4, "chains.C.pin"),
        ("chains:\n  C:\n    start: A\n    pin: ~\n", 4, "chains.C.pin"),
        ("chains:\n  C:\n    start: A\n    pin: [A:x]\n", 4, "chains.C.pin"),
        ("chains:\n  C:\n    start: A\n    steps:\n", 4, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps: ~\n", 4, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps: {link: e out}\n", 4, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      -\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - ~\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - [e, out]\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - {}\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - e in out\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - E IN\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - ' e out'\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - 'e out '\n", 5, "chains.C.steps"),
        ('chains:\n  C:\n    start: A\n    steps:\n      - "e\\tout"\n', 5, "chains.C.steps"),
        ('chains:\n  C:\n    start: A\n    steps:\n      - "e out\\n"\n', 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - out out out\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - ''\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - link: e both\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - link: ~\n", 5, "chains.C.steps"),
        ("chains:\n  C:\n    start: A\n    steps:\n      - link: [e out]\n", 5, "chains.C.steps"),
        (
            "chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n        pin:\n",
            6,
            "chains.C.steps.pin",
        ),
        (
            "chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n        pin: ''\n",
            6,
            "chains.C.steps.pin",
        ),
        (
            "chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n        pin: [x]\n",
            6,
            "chains.C.steps.pin",
        ),
    ],
)
def test_a_wrong_chain_value_names_the_file_the_line_and_the_key(
    tmp_path: Path, text: str, line: int, setting: str
) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:{line}: view file: "), str(e.value)
    assert setting in str(e.value)
    assert not _schema_accepts(text)


@pytest.mark.parametrize(
    "text",
    [
        "chains: 3\n",
        "chains: x\n",
        "chains: ~\n",
        "chains: []\n",
        "chains: [{C: {start: A}}]\n",
        "chains: true\n",
    ],
)
def test_chains_that_is_not_a_mapping_names_file_and_line(tmp_path: Path, text: str) -> None:
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:1: view file: chains"):
        read(path)


def test_of_several_wrong_chains_the_first_written_is_named(tmp_path: Path) -> None:
    text = "chains:\n  A:\n    start: X\n  B:\n    start: ''\n  C:\n    steps: [e]\n"
    path = _write(tmp_path, text)
    with pytest.raises(ValueError) as e:
        read(path)
    assert str(e.value).startswith(f"{path}:5: "), str(e.value)
    assert "chains.B.start" in str(e.value)


def test_an_unknown_key_in_a_step_names_the_key(tmp_path: Path) -> None:
    text = (
        "chains:\n  C:\n    start: A\n    steps:\n      - link: e out\n"
        "        pin: A:x\n        via: y\n"
    )
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:7: .*via"):
        read(path)


# The reader and the schema take the same chains.


@pytest.mark.parametrize(
    "step",
    [
        "e out",
        "e in",
        "e  out",
        "e\\tout",
        "e out\\n",
        "e out ",
        " e out",
        "e\\u00a0out",
        "e\\u2003out",
        "a\\u00a0b out",
        "e Out",
        "e inn",
        "e",
        "e in out",
        "in",
        "out out",
        "in in",
        "\\u0085 in",
        "e\\u2028out",
        "e\\u0085out",
        "é in",
        "😀 out",
    ],
)
def test_the_reader_and_the_schema_agree_on_a_step(tmp_path: Path, step: str) -> None:
    text = f'chains:\n  C:\n    start: A\n    steps:\n      - "{step}"\n'
    assert _reads(tmp_path, text) == _schema_accepts(text)
    link = f'chains:\n  C:\n    start: A\n    steps:\n      - link: "{step}"\n'
    assert _reads(tmp_path, link) == _schema_accepts(link)


@pytest.mark.parametrize("value", ["", " ", "\\u00a0", "a b", "a\\nb", "é", "-", "0", "x" * 5000])
def test_the_reader_and_the_schema_agree_on_a_start_and_a_pin(tmp_path: Path, value: str) -> None:
    for key in ("start", "pin"):
        body = (
            f'    start: "{value}"\n' if key == "start" else f'    start: A\n    pin: "{value}"\n'
        )
        text = f"chains:\n  C:\n{body}"
        assert _reads(tmp_path, text) == _schema_accepts(text), (key, value)


# Determinism and the other keys.


def test_chains_beside_the_other_keys_leave_them_as_they_are(tmp_path: Path) -> None:
    other = (
        "search: text\ntheme: dark\ntypes:\n  A:\n    label: Thing\ncards:\n  A:\n    show: [x]\n"
    )
    without = read(_write(tmp_path, other, "a.yaml"))
    withchains = read(_write(tmp_path, other + "chains:\n  C:\n    start: A\n", "b.yaml"))
    before = _write(tmp_path, "chains:\n  C:\n    start: A\n" + other, "c.yaml")
    a, b, c = without.as_json(), withchains.as_json(), read(before).as_json()
    for key in ("search", "theme", "types", "cards", "edges", "export"):
        assert a[key] == b[key] == c[key], key
    assert b["chains"] == c["chains"] and a["chains"] is None


def test_the_view_file_as_json_gives_chains_as_a_list_of_name_start_pin_steps(
    tmp_path: Path,
) -> None:
    path = _write(tmp_path, "chains:\n  C:\n    start: A\n")
    assert read(path).as_json()["chains"] == [{"name": "C", "start": "A", "pin": None, "steps": []}]


def test_chains_naming_what_the_mosaic_lacks_still_read_the_reader_does_not_check_the_mosaic(
    tmp_path: Path,
) -> None:
    text = (
        "chains:\n  Ghost:\n    start: NoSuchType\n    pin: NoSuchType:x\n    steps: [nope out]\n"
    )
    (chain,) = _chains(tmp_path, text)
    assert chain.start == "NoSuchType"


# The commands (V-18: a wrong chain is the view file's error; a missing thing is not).


def test_mosaic_view_names_the_file_line_and_key_of_a_wrong_chain_and_opens_no_page(
    tmp_path: Path,
    dist: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    opened: list[str] = []
    monkeypatch.setattr("webbrowser.open", lambda url, *a, **k: opened.append(url) or True)
    served: list[object] = []
    monkeypatch.setattr(view, "serve", lambda *a, **k: served.append(a))
    bad = _write(tmp_path, "chains:\n  C:\n    start: A\n    steps: [e both]\n")
    copy = tmp_path / "m.mosaic"
    shutil.copyfile(MOSAIC, copy)
    assert main(["view", str(copy), "--view", str(bad)]) == 1
    err = capsys.readouterr().err
    assert err.startswith(f"mosaic view: {bad}:4: view file: chains.C.steps")
    assert opened == [] and served == []


def test_mosaic_export_names_the_file_line_and_key_of_a_wrong_chain_and_writes_nothing(
    tmp_path: Path, dist: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bad = _write(tmp_path, "search: text\nchains:\n  C:\n    pin: A:x\n")
    out = tmp_path / "out.html"
    assert main(["export", str(MOSAIC), "--view", str(bad), "-o", str(out)]) == 1
    assert f"{bad}:3: view file: chains.C" in capsys.readouterr().err
    assert not out.exists()


def test_mosaic_view_still_opens_with_a_chain_naming_what_the_mosaic_lacks(
    tmp_path: Path, dist: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # V-18: the view file opens; the page reports what it could not apply.
    served: list[object] = []

    class Server:
        def shutdown(self) -> None: ...
        def server_close(self) -> None: ...

    def serve(*a: object, **k: object) -> tuple[Server, str]:
        served.append(a)
        return Server(), "http://127.0.0.1:1/"

    def stop(*a: object, **k: object) -> bool:
        raise KeyboardInterrupt

    monkeypatch.setattr(view, "serve", serve)
    monkeypatch.setattr("webbrowser.open", stop)
    path = _write(tmp_path, "chains:\n  Ghost:\n    start: Nope\n    steps: [knows out]\n")
    copy = tmp_path / "m.mosaic"
    shutil.copyfile(MOSAIC, copy)
    assert main(["view", str(copy), "--view", str(path)]) == 0
    assert len(served) == 1


# Spellings, as YAML double-quoted scalars (escapes allowed): good ones, then bad ones.
SPELLINGS = [
    "e",
    "e in",
    "e out",
    "in",
    "out",
    "in in",
    "in out",
    "out in",
    "out out",
    "é in",
    "😀",
    "a-b.c:d in",
    "e In",
    "e OUT",
    "e inn",
    "e  in",
    "e in ",
    " e in",
    "e\\tin",
    "e in\\n",
    "e\\nin",
    "e in in",
    "e out out",
    "e up",
    "e\\u00a0in",
    "e\\u2003in",
    "e\\u0085in",
    "\\u0085",
    "e\\v",
    "e\\f in",
    "e\\r",
    "e\\r\\nin",
]


@pytest.mark.parametrize("link", SPELLINGS)
def test_a_chain_step_spells_its_link_exactly_as_a_card_does(tmp_path: Path, link: str) -> None:
    # Rule: the same spelling is good in cards.links and in a chain step.
    card = f'cards:\n  T:\n    links: ["{link}"]\n'
    chain = f'chains:\n  C:\n    start: T\n    steps: ["{link}"]\n'
    pinned = f'chains:\n  C:\n    start: T\n    steps:\n      - link: "{link}"\n        pin: T:x\n'
    assert _reads(tmp_path, chain) == _reads(tmp_path, card)
    assert _reads(tmp_path, pinned) == _reads(tmp_path, card)
    assert _schema_accepts(chain) == _schema_accepts(card)
    assert _schema_accepts(pinned) == _schema_accepts(card)
    counts = f'cards:\n  T:\n    counts: ["{link}"]\n'
    assert _reads(tmp_path, counts) == _reads(tmp_path, card)


@pytest.mark.parametrize("link", ["e", "e in"])
def test_a_wrong_link_after_a_good_one_names_its_own_line(tmp_path: Path, link: str) -> None:
    text = f'chains:\n  C:\n    start: T\n    steps:\n      - {link}\n      - "{link} up"\n'
    path = _write(tmp_path, text)
    with pytest.raises(ValueError, match=rf"^{path}:6: "):
        read(path)
