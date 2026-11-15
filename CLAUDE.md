# Mosaic — notes for coding agents

Mosaic builds small, sealed knowledge graphs: one SQLite file per mosaic, with a source for
every fact. Python builds them (`packages/`), one TypeScript kit reads them (`kit/`), and a
Svelte viewer browses them (`viewer/`). This is an alpha: prefer the simple change that works.

## Read first

- `docs/design.md`: vision, needs and the roadmap. `docs/spec-0.1.md` and `spec/`: the format
  and the kit's tools. The spec is a **draft** until it is frozen and it follows the code:
  build the feature first, then update the spec once the feature has settled.
- `docs/adr/`: why things are the way they are. `design/`: tokens and the brand book.

## Principles

1. Agents first, people too. 2. Small by design. 3. Build any way; fix the result, not the method.
4. Every fact says where it came from. 5. Building a mosaic is deterministic: same pieces and
pattern, same knowledge hash. 6. Sealed and shareable. 7. Copy what fits, reference what doesn't.
8. Never write to a source. 9. Domain-neutral: no domain words in the format, the mosaic builder
or the kit. 10. Offline, embedded, open.

## Boundaries

- `mosaic-format` never imports `mosaic-build`. The kit never imports Python or the viewer.
  Python and TypeScript meet only at the mosaic file and the cases in `conformance/`.
- The mosaic builder uses no AI and no network.
- The viewer styles itself from the tokens (`viewer/src/design/tokens.css`, generated from
  `design/tokens.json`) and from shared components, not per-screen styles.

## Commands

```
uv sync && bun install      # install
./scripts/check-fast.sh     # the gate: lint, types, fast tests
uv run pytest -m slow       # fixtures, hashes, vectors: only when a change touches them
uv run mosaic --help        # the CLI
bun run build               # kit and viewer
```

## How to work

- **Commits**: work may go straight to `main` once the gate passes locally. Use a
  short-lived branch and a pull request when a change is large or you want it looked at
  first: cut it from the latest `main`, rebase (never merge `main` in), squash-merge, and
  start follow-up work on a new branch.
- **Size**: one commit or pull request per feature or fix, as large as the feature needs.
- **Before pushing**: run the gate. CI runs the same gate, plus the build, on `main` and on
  pull requests; the slow tests run in CI on `main`.
- **Review**: for a large or risky change, have one independent agent with a fresh context
  review it against these notes and fix what it finds. One round is normally enough.
- **Decisions**: decide implementation details yourself and say what you assumed. Ask the
  maintainer only about what the product should do, and keep working on something else
  meanwhile; don't stop the whole job for one open question.
- **Dependencies**: prefer a maintained library to about 100 lines of our own. The kit is
  the exception: it ships inside every export, so keep it small. A headless component
  library and d3-force are accepted for the viewer.

## Keeping work cheap

Most of a session's cost is reading, so keep what must be read small.

- **Read little**: search first, then read the part of a file you need. Don't re-read a
  file you just changed. `docs/design.md` is long: read the part the task names.
- **Quiet output**: the gate prints one line per step and a step's output only when it
  fails. Run one test file while working and the gate once at the end. Never paste full
  logs into the conversation.
- **Decide, then build once**: settle what the product should do before writing code. A
  rebuilt feature costs more than any other habit here saves.
- **Agents**: none for work under about 20 minutes. When one is worth it, give it a brief of
  about ten lines: the goal, the files to touch, and the check that says it is done. Use a
  smaller model for mechanical work (renames, moving tests into case files), the strongest
  one for design and for the independent review.
- **One session per stage**: start a new session for each milestone or large change. The
  roadmap in `docs/design.md` ("How we get there") is the hand-off; update it before you
  stop.
- **Don't save on review**: one independent review of a large change stays.

## Tests

Test what a user of the CLI, the kit or the viewer can observe. One test file per topic.
No tests that read source files as text, pin private names or exact wording, or restate
another test with a different input. Check a command's exit code and error name, not its
wording. Where tests differ only by input, keep the inputs as case files. Don't test test
helpers. For the viewer, use browser tests with screenshots.
Aim for tests about as large as the code they cover, not several times larger. Never
loosen a test to make it pass.

## Explaining a change

- The pull request description is short text: what changed for a user, why, and how it was
  checked. No generated diagrams or sheets in the repository or in pull requests.
- Explain the change to the maintainer in the session where you did the work, with one
  picture of the **idea**: the concept, the architecture or the behaviour that changed,
  with an example. Not a map of the files touched.

## Style

Python 3.14, typed, ruff-formatted, line length 100. TypeScript strict. Small modules and
plain names from the glossary (tessera, mosaic, piece, pattern, target, evidence, mention,
kit). Errors name what failed and where. All example data is invented or openly licensed.
Supported platforms are Linux and macOS, with UTF-8 input; builds are byte-identical there.
