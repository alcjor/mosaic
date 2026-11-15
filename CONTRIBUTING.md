# Contributing to Mosaic

Mosaic is an alpha, and contributions are welcome. The easiest one is a tessera builder for a
format you know: a program that turns one source into a tessera. Tessera builders live in
`packages/mosaic-build/src/mosaic_build/tessera/`; the CSV and SQLite builders there are the
examples to follow, and section 4 of the specification says what a tessera must hold.

## Set up

You need [uv](https://docs.astral.sh/uv/) and [Bun](https://bun.sh) 1.4 or later.

```sh
uv sync && bun install
```

## Check your change

```sh
./scripts/check-fast.sh     # the gate: ruff, ty, import-linter, pytest, type checks, vitest
uv run pytest -m slow       # when you touch fixtures, hashes, vectors or budgets
```

The slow tests need the fixture sources and the embedding model:

```sh
uv run python scripts/fetch_fixtures.py
uv run python scripts/fetch_model.py
```

Some of them open the viewer in a real browser, so they also need a Chromium for Playwright
(`bunx playwright install chromium`).

Run the gate before you push. A change in behaviour comes with a test.

## Branches and pull requests

- Work on a short-lived branch cut from the latest `main`, one change per branch.
- Keep history linear: update your branch with `git rebase origin/main`, never by merging
  `main` into it.
- Pull requests are squash-merged. After the merge the branch is finished: start follow-up
  work on a new branch from `main`.

## The specification is a draft

`docs/spec-0.1.md` and the normative files in `spec/` are the contract, and version 0.1 may
change until it is frozen. A change to them is welcome, but it must come with a reason: say in
the pull request what a reader of a mosaic, a user of the CLI or another implementation would
observe differently, and why that is better. The same holds for the expected values in
`conformance/`.

## Example data

All example and test data must be invented or openly licensed. Fixture sources are not
committed: they are listed in `conformance/fixtures/manifest.json` with their licence, pinned
by hash and downloaded by `scripts/fetch_fixtures.py`.

## Style

Python is typed and formatted with ruff (line length 100); TypeScript is strict. Use the
glossary's names for things (tessera, mosaic, piece, pattern, target, evidence, mention, kit),
and no domain words in the format, the mosaic builder or the kit. Errors name what failed and
where.
