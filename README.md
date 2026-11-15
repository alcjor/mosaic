<picture>
  <source media="(prefers-color-scheme: dark)" srcset="design/assets/logos/mosaic-lockup-dark.svg">
  <img alt="Mosaic" src="design/assets/logos/mosaic-lockup-light.svg" width="420">
</picture>

**Your knowledge, one file.** Many pieces in. One picture out.

Mosaic builds small, sealed knowledge graphs that travel with small AI models: the curated data
a local agent reads to answer questions about one system, with a source for every answer.
Tessera builders turn each source into a tessera, a pattern says how the pieces fit, the mosaic
builder seals the mosaics it names, and the mosaic kit answers questions from them. A built
mosaic is one read-only SQLite file, and people browse the same file in the viewer.

## Status

Mosaic is an **alpha**. The file format is a draft ([Specification 0.1](docs/spec-0.1.md)) and
may change until it is frozen. The table says what works today and which milestone of the
[roadmap](docs/design.md#how-we-get-there) brings the rest.

| Part | Works today | Planned |
| --- | --- | --- |
| Format and checker | One SQLite file format with two profiles, tessera and mosaic; knowledge and vector hashes; `mosaic check` for files and patterns | The hardening planned for the freeze, and the frozen 0.1 (M11) |
| Builders | Tessera builders for CSV files and SQLite databases; the mosaic builder with its build report, strict mode and vectors | Several pieces proved on a fixture (M7); tessera builders for documents and code, and links from mentions (M8); the AI step and proposals (M10) |
| Kit | TypeScript, running in the browser, with five tools: `find`, `get`, `neighbors`, `table`, `cite` | Counting the results of a chain (M6); `path`, the generated card and a Node build (M9); a Python wrapper (M11) |
| Viewer | `mosaic view` and a single-file `mosaic export`, both shaped by a view file: search, tables, node pages with their sources, graph views, chains and cards | A rework into four places: Home, Explore, Trails and Tables (M5); "count by" (M6); a path between two things (M9) |
| Agent interface | Nothing yet | An MCP server, the card, and a benchmark with small local models (M9) |

The two examples that work end to end today are the conformance fixtures: Netflix titles (one
CSV file) and Chinook (one SQLite database).

## Quick start

You need [uv](https://docs.astral.sh/uv/) and [Bun](https://bun.sh) 1.4 or later. uv installs
Python 3.14 if you do not have it. Run everything from the repository root.

```sh
uv sync && bun install
bun run build                                # the viewer page that view and export use

# Fetch the fixture sources and the embedding model, each checked by its pinned hash
uv run python scripts/fetch_fixtures.py      # into conformance/fixtures/downloads/
uv run python scripts/fetch_model.py --dest .cache/demo/model

# Source -> tessera
mkdir -p .cache/demo/pieces
uv run mosaic import sqlite conformance/fixtures/downloads/chinook/Chinook_Sqlite.sqlite \
  --settings conformance/fixtures/chinook/settings.yaml \
  -o .cache/demo/pieces/chinook.tessera

# Tessera + pattern -> mosaic (writes default.mosaic and build-report.json)
uv run mosaic build conformance/fixtures/chinook/pattern.yaml \
  --pieces .cache/demo/pieces --model .cache/demo/model -o .cache/demo

# Check it, browse it, and save it as one HTML file that opens offline
uv run mosaic check .cache/demo/default.mosaic --pieces .cache/demo/pieces
uv run mosaic view .cache/demo/default.mosaic \
  --view conformance/fixtures/chinook/view.yaml --model .cache/demo/model
uv run mosaic export .cache/demo/default.mosaic \
  --view conformance/fixtures/chinook/view.yaml --model .cache/demo/model \
  -o .cache/demo/chinook.html
```

`mosaic view` serves the page on `127.0.0.1` and opens it in your browser; stop it with Ctrl-C.
The Netflix fixture follows the same steps, with `mosaic import csv` and the files in
`conformance/fixtures/netflix/`. `uv run mosaic --help` lists the commands, and each command
has its own `--help`.

## The six rules

1. Copy what fits, reference what doesn't.
2. Inputs keep their own shape.
3. Nothing changes once frozen.
4. Every value has evidence.
5. Conflicts are settled when building.
6. Machines propose, people decide.

## Read more

- [`docs/design.md`](docs/design.md): the vision, the data model, the architecture and the
  roadmap.
- [`docs/spec-0.1.md`](docs/spec-0.1.md): the draft specification, with the normative files in
  [`spec/`](spec/).
- [`docs/adr/`](docs/adr/): the architecture decisions.
- [`conformance/`](conformance/README.md): the fixtures and cases that the Python builders and
  the TypeScript kit are both tested against.

## Built with Mosaic?

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="design/assets/logos/powered-by-mosaic-dark.svg">
  <img alt="Powered by Mosaic" src="design/assets/logos/powered-by-mosaic-light.svg" height="32">
</picture>

If your project ships a mosaic or embeds the kit, you are welcome to show the "Powered by
Mosaic" badge: `design/assets/logos/powered-by-mosaic-light.svg` or `-dark.svg`.
It is appreciated, not required.

## Development

```sh
uv sync && bun install      # install
./scripts/check-fast.sh     # the gate: lint, types, import rules and the fast tests
uv run pytest -m slow       # slow tests: budgets and the fixtures
```

The slow tests need the fixtures, the embedding model and a browser; `CONTRIBUTING.md` says how to get them.

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licence

Apache-2.0: see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Each fixture's licence is in
[`conformance/fixtures/manifest.json`](conformance/fixtures/manifest.json).
