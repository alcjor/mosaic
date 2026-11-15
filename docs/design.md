# Mosaic — Design

Mosaic builds small, sealed knowledge graphs that travel with small AI models. This document brings together, in reading order, the vision and direction (Part 1), the data model (Part 2), the architecture decisions (Part 3) and the measurements behind them with their spike results (Part 4). The architecture decisions themselves are the files in [`adr/`](adr/), and the normative Specification 0.1 is [`spec-0.1.md`](spec-0.1.md); Parts 3 and 5 link to them.

## Part 1 · Vision and direction

Mosaic builds small, sealed knowledge graphs that travel with small AI models: the curated data a local agent reads to answer questions about one system, with a source for every answer. People browse the same file. This part sets the vision, stakeholders, use cases, scope and direction; the formats, the mosaic builder and the mosaic kit are fixed in Part 5 (Specification 0.1).

### Why Mosaic

Small AI models now run on an ordinary laptop: offline, private and cheap. They know language, but nothing about the system you work on.

What is known about that system is spread across tables, structured files, code, documents and other tools. The same thing turns up under different names: T-1889 in a museum's catalogue, T\_1889 in its loan records, "Seated Figure" in the gallery guide. The links between those names live in people's heads.

The two usual ways to give a model that knowledge do not suit a small one:

- **Document search over chunks** ships raw text. It is big, repeats itself, and loses the links between things, so a small model must rebuild them from fragments in a short context.
- **A large knowledge graph on a server** centralises everything for big models. It needs a network, a host and someone to run it.

A small model needs the opposite: a small piece of curated knowledge that sits beside it. Each thing appears once with all its names, its key facts and its links, and every fact points to its source. The model should reach an answer in a few tool calls, inside a small context.

### The idea

**Many pieces in. One picture out.** Pieces of knowledge come from any source and any method. Mosaic assembles them by a pattern and builds small, sealed files that an agent carries and a person can browse.

- **Tessera:** a small graph made from one source, by any tessera builder: an importer, rules, AI or a person.
- **Mosaic:** the picture, built from tesserae and other mosaics by a pattern that says how they fit. The pattern names the mosaics to build, each with its own scope; any mosaic can be shared and imported into someone else's pattern.

Tessera builders decide what each source says; the mosaic builder decides what ships. Making tesserae is open-ended and can involve people, rules and AI. Building a mosaic is mechanical: the same pieces and pattern always give the same mosaic. MOSAIC stands for Model Of Systems Assembled from Information already Collected.

**In one line:** small, sealed knowledge for small models. Category line: your knowledge, one file.

- **For** people who run small AI models locally on a system they know, and the agents built on them,
- **who** need answers about that system that are correct, sourced and available offline,
- **Mosaic is** a builder of small knowledge graphs
- **that** assembles pieces from any source into one sealed file, which an agent reads in a few tool calls and people browse.
- **Unlike** document search, which ships raw text in chunks, and knowledge graph servers, which centralise everything for big models,
- **Mosaic** ships only the curated graph, small enough to travel with the model.

### Principles

Ten principles hold in every version; a design that breaks one is wrong, however convenient.

1. **Agents first, people too.** The mosaic is shaped for a small model's context and tools. The viewer reads the same file.
2. **Small by design.** Every layer is optional and sized: scope, summaries instead of raw text, text tier, vectors. A mosaic that does not fit is split, not grown.
3. **Build any way.** By hand, imported from a structured system or a knowledge graph, by rules, by AI, or a mix. Mosaic fixes the result, not the method.
4. **Every fact says where it came from.** Each node and edge records the tessera builder that made it, its source and location, and a confidence when one applies.
5. **Building mosaics is deterministic.** The same pieces and pattern give the same mosaic, with the same knowledge hash. Judgement happens in tessera builders and in the pattern; the mosaic builder only assembles, selects, indexes and seals.
6. **Sealed and shareable.** Tesserae and mosaics are immutable, versioned and named by their hash. Anyone can import them into their own pattern.
7. **Copy what fits, reference what doesn't.** Big data and full sources stay outside; the mosaic holds the keys to reach them.
8. **Never write to a source.** Corrections happen in each source's own tool, and a new build follows.
9. **Domain-neutral.** The domain lives in patterns and tessera builders, never in the format, the mosaic builder or the mosaic kit.
10. **Offline, embedded, open.** One file and a small library, with no server. Open formats and an Apache-2.0 licence.

### How it works

**Tessera builders turn sources into tesserae; the mosaic builder assembles them with pieces from others by a pattern, and seals the mosaics it names, which agents and people read through the mosaic kit.**

> *Diagram not in the repository yet: how it works · build tesserae, build mosaics, use*

Making tesserae may involve judgement; the mosaic builder is mechanical, so the same pieces and pattern always give the same mosaics. There is no working graph to edit or review: when a build reports a conflict, the user fixes it and builds again.

- **Tessera builder:** turns one source into a tessera. Mosaic ships a reference tessera builder: importers for tables, structured files and knowledge graphs, which need no AI; a rule-based linker for code and documents; and an optional AI step.
- **Tessera:** a small sealed graph from one source, with a source for every fact. It has the same format as a mosaic, without the agent layers.
- **Pattern:** one YAML file in Git, with one owner and four sections: the pieces, pinned by hash and listed in priority order for conflicting values; the types, each with its key, a description and the piece types it comes from; the edges, each with the mention role it comes from; and the mosaics to build. An optional proposals file holds proposals from the pattern assistant or from people, and the user's decisions on them. Anything that needs computation belongs in a tessera builder.
- **Mosaic builder:** assembles the pieces by the pattern and writes each mosaic the pattern names: it selects the scope, trust policy and text tier, writes link counts and indexes, checks the size and seals the file. It may cache its work, but nothing outside depends on that cache.
- **Build report:** the conflicts, unresolved names and failed checks of a build. Fixing them is up to the user, in a source, a tessera or the pattern, before building again.
- **Mosaic:** one read-only file with nodes, edges, names, link counts and citations, plus vectors (on by default) and optional text. Its scope is set by the pattern; any mosaic can be shared and imported into another pattern.
- **Mosaic kit:** a small read-only library with six tools, embedded by agents through an MCP server and by the viewer. It generates the card when it opens a mosaic.
- **Viewer:** the reference app for people: graph explorer, tables rebuilt from node types, and the source reader.

**The core of Mosaic** is the mosaic builder, the mosaic kit, and two formats: one file format with two profiles, tessera and mosaic, and the pattern format. Tessera builders, the viewer and the agent interface are built on that core; the reference ones ship with Mosaic, and anyone can write others.

**Imported mosaics** are pieces like any other. A mosaic arrives in its own pattern's types, so the importing pattern maps its types exactly as it maps a tessera's. Its evidence still points to the original sources: evidence names each source by its hash and location, and records every mosaic the fact passed through on the way. An importer can trace a fact to its origin even without holding that source, and can ask its publisher for it.

### How an agent uses a mosaic

The card tells the model what it can ask; a handful of fixed tools return short answers with ids, so the next call can build on the last.

- **Card:** under 1,500 tokens in the system prompt, generated by the kit when it opens the mosaic (ADR-006). It says what the mosaic covers, its types and links in plain words, example ids, a few worked tool calls, and its notices.
- **Tools:** `find` (names, aliases and meaning), `get` (summary, facts, link counts, main source), `neighbors`, `path`, `table` (a node type as rows) and `cite` (source, location, snippet). Every answer fits a token budget; long lists end with a count.
- **Tiny mosaics** skip the tools: when a mosaic fits in a quarter of the model's context (ADR-007), the whole graph loads into the context as compact text.
- **Bigger models** can query the graph directly as well, with read-only SQL over documented views.

A typical loop for "What describes the seated figure?":

1. Read the card.
2. `find("seated figure")` returns `Sculpture:T-1889`.
3. `get(Sculpture:T-1889)` shows it is described by 3 guide sections and mentioned in 12 places.
4. `neighbors(Sculpture:T-1889, describes, in)` lists the sections.
5. `cite` each one.
6. Answer with the ids and their sources.

### Stakeholders

Eight roles use Mosaic, defined by what they do with it rather than by job title. The examples use one invented museum, whose sculpture T-1889 runs through this document.

| Role | Wants from Mosaic | Example | Main tools |
| --- | --- | --- | --- |
| Agent | Short, sourced answers in a few calls, inside a small context | A local assistant answers "what describes T-1889?" on a guide's laptop | Card, mosaic kit tools over MCP |
| Agent developer | Build an assistant or tool on a mosaic without learning its internals | Embeds the museum mosaic in a visitor assistant | Mosaic kit library, card |
| Reader | Understand a thing and its context fast, and see where each fact comes from | A curator checks T-1889's date and its source | Viewer |
| Source owner | Turn their source into a tessera and keep it current | The registrar publishes the catalogue as a tessera | Reference tessera builder |
| Architect | Write the pattern: which pieces in which order, the types and edges, and the mosaics to build | Writes the museum's pattern and builds a mosaic for the curators | Pattern, mosaic builder |
| Reviewer | Accept or reject proposed facts and links, when the policy asks for review | Confirms in the pattern that T\_1889 in the loan records is T-1889 | Viewer, pattern |
| Publisher | Share pieces others can import | A supplier publishes its component library as a tessera | Tessera format |
| Recipient | Use a delivered mosaic offline, with nothing to install | A partner museum receives a mosaic of the loan and points their own model at it | Viewer, any agent |

Other stakeholders do not use Mosaic but shape it:

- **Adopting organisations:** low adoption cost, no lock-in, and data that stays theirs.
- **IT and security teams:** nothing leaves the machine, no server to run, and a licence their legal team accepts.
- **Local model runtimes:** a standard tool interface they can host without special code.
- **Contributors:** documented formats, a clear architecture, and tests that say when something broke.
- **Maintainer:** a codebase small enough to learn, test and change alone.

### Use cases

Sixteen use cases say what Mosaic must do, without domain words. UC-01 to UC-05 are what agents and readers do with a mosaic; UC-06 to UC-12 are how one is made and shared; UC-13 to UC-15 measure and extend it; UC-16 is a reader's walk through the viewer.

| ID | Use case | Example | Served by | Release |
| --- | --- | --- | --- | --- |
| UC-01 | **Answer with sources.** An agent answers a question about the system and cites each fact | "When was T-1889 made?": the date, with the catalogue row it came from | Agents | v0 |
| UC-02 | **Resolve a name.** Any name a thing goes by leads to that thing | "Seated Figure" and T\_1889 both lead to T-1889 | Agents, viewer | v0 |
| UC-03 | **Explore links.** What a thing connects to, and the path between two things | The guide sections and loans that involve T-1889 | Agents, viewer | v0 |
| UC-04 | **Browse as tables.** A node type shown as rows, filtered and sorted | All sculptures in bronze that are on loan | Viewer, agents | v0 |
| UC-05 | **Read the source.** Open the passage or row behind a fact | The guide section that describes T-1889 | Viewer, agents | v0, per text tier |
| UC-06 | **Build from any source.** Turn one source into a tessera, with whichever tessera builder fits | The catalogue by a table importer; the guide by rules plus AI | Reference tessera builder | v0 |
| UC-07 | **Import structure.** Bring in a tessera, a mosaic or an existing knowledge graph, with no AI needed | A supplier's component library | Pattern; a tessera builder for an external knowledge graph | v0 |
| UC-08 | **Assemble with a pattern.** Combine pieces by a pattern, with one identity per thing | T\_1889 in the loan records becomes T-1889 | Mosaic builder, build report | v0 |
| UC-09 | **Set the trust policy.** Choose what enters a mosaic: reviewed facts only, a confidence threshold, or everything with its confidence shown | Only reviewed AI links reach the operators' mosaic | Pattern, mosaic builder | v0 |
| UC-10 | **Build to size.** Pick the scope, text tier and vectors, and get a size report | A mosaic of a few megabytes for a laptop model | Mosaic builder | v0 |
| UC-11 | **Share a part.** Build a mosaic scoped to one part of the system, and publish it | The sculpture department shares its part of the collection | Mosaic builder | v0 |
| UC-12 | **Check consistency.** Report unresolved names, conflicting values and broken links while assembling | The guide says c. 1890, the catalogue 1889 | Build report | v0 |
| UC-13 | **Measure usefulness.** Score a small model's answers with a mosaic against known answers, against its size | 200 questions on a generated collection, answered with and without vectors | Benchmark | v0 |
| UC-14 | **Reach outside data.** Go from a thing to data that stays outside, such as images or time series | T-1889's images next to its record | Agents, viewer | Keys in v0; adapters later |
| UC-15 | **Follow changes.** Rebuild after a source changes, and list what changed between two mosaics | An artist's dates are corrected: which works are affected | Mosaic builder, viewer | Later |
| UC-16 | **Follow a chain.** Walk a chosen sequence of links from a thing, with what matters about each thing along the way shown side by side | Every room that shows a work by the artist of T-1889, with each work's date and each room's floor | Viewer | v0 |

### Scope

v0 fixes one file format, the pattern, the mosaic builder and the mosaic kit, and ships a reference tessera builder, an agent interface and a viewer. Anything beyond that waits until the benchmark shows it is needed.

| Part | v0 | Later |
| --- | --- | --- |
| Format | One file format with two profiles, tessera and mosaic, plus the pattern format; optional layers (summaries, indexes, vectors, text); versioned, minor versions only add | New optional layers as the benchmark asks for them |
| Reference tessera builder | Importers for tables, structured files and existing knowledge graphs; a rule-based linker for code and documents; an optional AI step that writes facts with a confidence | A plug-in interface so others publish builders |
| Pattern | One YAML file in Git: pieces in priority order, types, edges and mosaics; an optional proposals file | Per-field conflict policy and custom checks, when a real pattern needs them |
| Mosaic builder | Assembly by the pattern; then per target: scope, trust policy, text tier, link counts, name index, optional vectors, size report, seal | A cache for incremental builds; lists of changes between two mosaics |
| Mosaic kit | `find`, `get`, `neighbors`, `path`, `table`, `cite`; the generated card; native and WebAssembly builds | Outside data on demand through adapters |
| Agent interface | An MCP server over the mosaic kit, and the card | Ready-made integrations with local model runtimes |
| Viewer | Graph explorer, tables rebuilt from node types, source reader; works offline from a single file | Review workflow; editor assistant |
| Test data | A generated system with known answers and a question set | Generated systems in a second domain |

Never in scope, in any version:

- **Writing to a source.** Corrections happen in each source's own tool, and a new build follows.
- **Running or training models.** Mosaic feeds models; it does not host them.
- **A central server.** Mosaics are files; there is nothing to host.
- **Copying big data.** Outside data stays outside; the mosaic holds keys to it.
- **Domain logic in the format, the mosaic builder or the mosaic kit.** The domain lives in patterns and tessera builders.
- **Live sync between mosaics.** Shared pieces travel one way: published, sealed, versioned.
- **Reading pictures.** An OCR or drawing reader is a builder anyone may write, not part of Mosaic.

### Quality goals

Eight quality goals, ranked: when two conflict, the higher one wins. Size ranks below correctness on purpose, because a small mosaic never justifies a wrong answer.

| Rank | Goal | What it means | How we will know |
| --- | --- | --- | --- |
| 1 | Useful to small models | A small local model answers questions about the system correctly, in few calls and little context | Share of known-answer questions answered correctly, with calls and tokens used, on every change |
| 2 | Traceable | Every fact points to its builder, source and location | Every node and edge has evidence; one call reaches the row, line or passage |
| 3 | Correct | No uncertain fact is shown as certain; inferred facts carry their confidence | Precision 1.0 for exact links against known answers; every unresolved name is in the build report |
| 4 | Small | Bytes per node stay low, and each optional layer earns its size | The size report per layer; benchmark score per megabyte |
| 5 | Embeddable and offline | The mosaic kit runs inside agents, browsers, editors and notebooks, with no server or network | Native and WebAssembly builds pass the same tests with networking off |
| 6 | Fast | Fast enough for an interactive agent | Each tool answers in under 100 ms on a large generated system |
| 7 | Reproducible and stable | The same pieces and pattern give the same mosaic; the format is versioned on its own | Rebuilding gives an identical knowledge hash; each release reads the previous release's files |
| 8 | Domain-neutral | A new domain changes no format, mosaic builder or mosaic kit code | Two unrelated example systems run on an unchanged mosaic kit; a lint finds no domain words in it |

### How we get there

**Measured, not assumed: every step should make a small model answer more questions correctly, or answer them from a smaller file.** The first milestones were built without the benchmark, to get one working path from a source to a browsable file; the benchmark arrives with the agent interface (M9), and from then on a step that does not pay off is changed or dropped.

1. **Format, mosaic builder and mosaic kit:** one file format, the pattern, the mosaic builder and the tools, checked on the conformance fixtures (Netflix titles, then Chinook, later two museum collections, OpenFlights and Marlin).
2. **Viewer:** the graph explorer, tables, trails and source reader on the same file.
3. **Reference tessera builder:** tables first, then several pieces, then documents and code by rules, then the optional AI step. Each tessera builder is scored on the facts it gets right.
4. **Agent interface and benchmark:** the MCP server and the card, with a generated test system with known answers, a question set drawn from them, and small local models. Measure answers against size with each layer on and off: summaries, text tiers, vectors.
5. **Sharing:** publish mosaics and tesserae, import them into another pattern.
6. **Widen:** a second domain, and outside data through adapters.

v0 covers steps 1 to 5. No step has a date.

#### First milestone

The first implementation proved the whole flow on the Netflix titles fixture, then Chinook, with the smallest possible kit: just enough to power the viewer and semantic search. It is built (milestones M0 to M4 below). The table says what each part holds today and which milestone brings the rest.

| Part | Built (M0 to M4) | Later |
| --- | --- | --- |
| Format and checker | `format.sql`, `mosaic check`, knowledge and vector hashes | The hardening planned for the freeze (M11) |
| Reference tessera builder | Table importers only: CSV, with columns as linked things (optionally split on a separator) and value conversion (dates, mixed units), and SQLite, with rows as nodes and foreign keys as edges | Document and code importers (M8); the AI step (M10); knowledge graph importers (not scheduled) |
| Mosaic builder | The eight build steps, build report, strict mode, vectors with the v0 embedding model | Several pieces proved on a fixture (M7); link rules from mentions (M8); proposals in practice (M10); incremental builds (not scheduled) |
| Kit | TypeScript, running in the page: `find` (exact, full-text and vector tiers), `get`, `neighbors`, `table`, `cite`; query embedding with the v0 model | Counting the results of a chain (M6); `path`, the generated card and a Node build for the MCP server (M9); a Python wrapper for scripts and notebooks (M11); tiny-mosaic text and the answer schema in full (not scheduled) |
| Viewer | Search box (semantic search through `find`), tables rebuilt from node types, a node page with its links and sources, graph views, chains and cards; `mosaic view` to explore and a single-file HTML export, both shaped by a view file | The rework into four places (M5); "count by" and filter chips (M6); a path between two things (M9) |
| Agent interface | None | MCP server and card (M9) |

The first milestone was done when the Netflix titles and Chinook mosaics built with their expected hashes, the viewer opened them offline and exported each to one HTML file, and a plain-language search found the right titles.

#### Implementation plan

Python builds mosaics; one TypeScript kit reads them, in the browser for the viewer and later in Node for agents.

| Part | Choice | Why |
| --- | --- | --- |
| Tessera builder, mosaic builder, `mosaic check`, CLI | Python | Best libraries for importers and ONNX Runtime; vectors are always computed natively by the builder |
| Kit | One kit in TypeScript, on SQLite WebAssembly and ONNX Runtime Web | One kit everywhere: the viewer, exports, and later an MCP server in Node and a Python wrapper for scripts and notebooks. Until the wrapper exists, Python reads mosaics with SQL over the documented views |
| Viewer | Svelte page that always runs the kit inside the page | `mosaic view` opens the page with a mosaic loaded, no query server; `mosaic export` saves the same page with the mosaic inside as one HTML file that opens offline with a double-click |
| View file | YAML, used by both view and export | Edited in your own editor; mosaic view watches it and reloads the page on save. Sets which types appear, columns, what a node page shows, labels, theme, which types an export carries, and `search: semantic` (embedding model inside, about 25 MB) or `search: text` (a few MB) |
| Repository | uv workspace with `mosaic-format` (schema, hashes, checker) and `mosaic-build` (builders and CLI); npm packages `kit` and `viewer` | The kit cannot import builder code; Python and TypeScript meet only at the mosaic file and the conformance cases |
| Tooling | ruff, ty, pytest, import-linter; TypeScript strict, Vitest, Playwright; GitHub Actions on Linux only; slow fixture and hash checks run locally before each push | The same conformance tool cases run against the kit in CI |

**Repository layout**

```
mosaic/
├── pyproject.toml            # uv workspace root, Python 3.14, ruff, ty, pytest, import-linter
├── package.json              # npm workspaces: kit, viewer
├── spec/                     # the normative files: format.sql, 4 JSON Schemas
├── packages/
│   ├── mosaic-format/        # Python: schema, hashes, checker (mosaic check)
│   └── mosaic-build/         # Python: tessera builders, mosaic builder, CLI (mosaic …)
├── kit/                      # TypeScript: the kit (SQLite WASM, ONNX Runtime Web)
├── viewer/                   # Svelte: explore page and single-file export
├── conformance/              # fixtures (Netflix, Chinook, museums, OpenFlights, Marlin), invalid files, tool cases
├── views/                    # example view files
└── .github/workflows/        # CI: Linux
```

`mosaic-build` depends on `mosaic-format`; the kit depends on nothing in Python, and both sides are tested against `conformance/`. Fixture sources are downloaded and pinned by hash by a script, not committed, until their licences are confirmed.

**Milestones**

No dates: each milestone starts when the one before passes. M0 to M4 are built: M1 to M3 are the first milestone above, and M4 added chains and cards to the viewer. M5 onwards is the plan.

|  | Goal | Done when | Status |
| --- | --- | --- | --- |
| M0 | Skeleton | Workspace, CI green, the five normative files drafted in `spec/` | Built |
| M1 | Netflix, build side | CSV importer that can turn a column into linked things (optionally split on a separator: directors, cast, countries, genres, years) and convert dates and mixed fields, mosaic builder (8 steps, build report, strict), `mosaic check`; the Netflix mosaic builds with the same knowledge hash in repeated clean local builds | Built |
| M2 | Netflix, read side | Vectors in the builder; TypeScript kit with `find`, `get`, `neighbors`, `table`, `cite`; `mosaic view` explores the Netflix mosaic with semantic search | Built |
| M3 | First milestone complete | View files, single-file export with both search settings, the Chinook fixture and its tool cases pass | Built |
| M4 | Viewer: chains and cards | The viewer chains and cards needs V-1 to V-18 (below) are met, except V-4, which waits for the kit's `path` (M9): on the Netflix and Chinook mosaics a person defines a chain, sees its results as cards and as one table, and chooses what each type's card shows; the chains and cards are saved in the view file and look the same in `mosaic view` and in the single-file export, offline | Built |
| M5 | Viewer rework | The Netflix and Chinook mosaics can be explored end to end in the four places (Home, Explore, Trails, Tables), in `mosaic view` and in the single-file export | Planned |
| M6 | Counting | The question "which person appears in the most titles listed in Comedies" is answered on the Netflix mosaic in the viewer and through the kit, with tool cases in `conformance/` | Planned |
| M7 | Several pieces | A fixture with at least two sources that name the same things differently (two open museum collections, joined by their Wikidata ids; OpenFlights stays as the second case) builds, with merging pieces, qualifiers, weak ids and notices | Planned |
| M8 | Text and mentions | Document and code tessera builders, link rules from mentions and `source_text` work on the Marlin fixture (firmware source and its documentation, GPL-3.0, downloaded by hash) | Planned |
| M9 | Agents and benchmark | The generated card, `path` and an MCP server in Node work, and the benchmark with small local models ("How we get there", step 4) has run | Planned |
| M10 | AI input | The AI step in tessera builders, the pattern assistant and proposals work end to end | Planned |
| M11 | Freeze 0.1 | The Python wrapper exists, the budgets are met, the full conformance suite passes, and the specification is frozen | Planned |

**M5, viewer rework.** What the rework covers:

- **Shared building blocks.** Button, chip, panel, tabs, table and empty state are each styled once, from the design tokens, and used everywhere.
- **Four places.** The views are regrouped into Home (the map of types, and saved trails), Explore (the graph and the selected thing's card, side by side), Trails (a chain as columns, one per step) and Tables.
- **Graph layout.** The graph is laid out by forces, and a person can drag things and unfold them.
- **Dependencies.** A headless component library and d3-force are allowed.
- **Tests.** Browser tests with screenshots replace the tests that read source text.

**M6, counting.** The kit gains a tool that counts the results of a chain grouped by one of its steps, for questions such as "which person appears in the most titles listed in Comedies". Trails shows it as "count by", and table filters become chips.

**Until the format is frozen.** The hardening planned for the freeze is deliberately light until M11: running the full integrity check on every open, the large set of invalid-file cases, and the size and speed budgets. The knowledge hash and determinism stay from the start.

**Next small steps, before M5 is finished.**

- **Vector cache (done):** the builder keeps vectors by text hash and model hash in `~/.cache/mosaic` (`MOSAIC_CACHE_DIR` moves it; empty turns it off), so a repeated build skips embedding and does not load the model.
- **Slow tests in CI:** the slow suite runs on `main`, not in every working session.
- **Lighter checks on open:** opening a file checks its structure only. The hashes are checked by `mosaic build` and `mosaic check`, in the viewer in the background with a "verified" or "not verified" mark, and by an agent host once per file.
- **Fewer rules of our own:** a standard YAML loader with a duplicate-key check replaces the strict reader; Python 3.12 is the lowest supported version; a maintained library is preferred to about 100 lines of our own, except in the kit, which ships inside every export.
- **Tests as data:** rule tests become case files where they differ only by input, and tests of test helpers go.
- **Platforms:** Linux and macOS, with UTF-8 input. Builds are byte-identical on those; other platforms and encodings are not promised.
- **Errors:** a command's exit code and error name are the contract; the wording of a message is free.
- **Spec after code:** a feature is built first and its spec section is written once it has settled.
- **Export:** the single-file export is checked by a few end-to-end tests, not by repeating every viewer test.

**Under consideration, to decide with M7.** Today one source needs three files: the import settings, the pattern and the view. Each answers its own question (how to read this source; how the sources fit together and what ships; how it should look), so the three stay. These changes would make them lighter to write:

- **Optional pattern (accepted):** building from one tessera with no pattern uses a one-to-one pattern.
- **Pattern by exception:** a pattern states only what differs from the pieces' own types, such as two piece types that are one type.
- **One project file:** the import settings, the pattern and the views as named sections of one file, checked by one schema.
- **Tesserae as a cache:** the builder writes and reuses tesserae by hash; a person handles one only to share or pin it.
- **More ways to match keys:** a trial on two real sources that name the same things differently decides which declarative steps join the six normalisation steps, for example a pattern replace or a lookup table.
- **Tables for counting:** per-type tables or indexes derived at build time, so filters and counts over many rows are fast (with M6).
- **The first principle, reworded:** "people and agents read the same file".

**Decided: a view is never part of a mosaic.** A mosaic is data that any tool can read through the kit; most of those tools have no viewer. The view file belongs to the viewer and stays outside the file; the single-file HTML export carries the view it was made with.

**Agreed: the kit and the format are the product.** The viewer is a reference: it uses only the kit's public interface, and a test enforces it. Between the two sits a small reference layer of elements (card, search, table, graph as web components) that any page can use; it is an example, not the product. Two embed examples run in CI from M5: a plain web page of about 50 lines and a Node script that answer a question from a mosaic without the viewer. A flight map on the OpenFlights mosaic follows with M7.

**Agreed: semantic search is opt-in.** An export carries text search by default; vectors are added on request. The M9 benchmark decides whether that default changes. No re-ranker for 0.1.

**Agreed: sharing.** A mosaic is named `name@hash` and describes itself (title, licence, sources, notices) in its own header. A diff between two mosaics is planned with M9. Sharing tesserae is a team feature and comes after 0.1.

**Later.** A documentation site and repository badges come once there are users.

**Building GUI, after M7.** Once the pattern format has settled through real use, the viewer gains tools for people who are not programmers. Each is a front end to the files, never a separate store, and none edits the graph:

- **Pattern editor:** pick tesserae, map piece types to types, choose keys and normalisation, define edges from mention roles, and preview the mosaic. Every change is written to `pattern.yaml` as clean YAML that diffs well in Git.
- **Import wizard for table sources:** choose a CSV file or a database, pick the key and the columns, and get an ordinary tessera.
- **Proposal review:** accept or reject proposals, written to `proposals.yaml`; the home of the pattern assistant (M10).
- **Facts typed by hand** go through a source, such as a spreadsheet template turned into a tessera, never straight into a mosaic: corrections belong in sources, and a new build follows.

**Viewer: chains and cards, M4.** A person browsing a mosaic often asks a question that is a fixed walk across the links: from a thing, along one kind of link, then another. The path between two things (UC-03) answers "how are these connected"; a chain answers "show me everything connected this way, and what matters about each thing on the way" (UC-16). These needs say what the viewer must let a person do; how is left to the implementation. They are built, except V-4.

*Boundary.* These are needs of the reference viewer and its view file only. They change nothing in the file format, the pattern, the mosaic builder or the kit, and they must be met with what the kit already exposes. The one exception is V-4, which waits for the kit's `path` (planned for M9) and is not built before it. If any other need cannot be met with the kit as it is, that is a separate decision about the core, not something these needs imply.

*Define a chain.*

- **V-1.** The viewer lets a person define a chain as a start and an ordered list of steps, where each step follows one kind of link in one direction to the next thing.
- **V-2.** The viewer lets any step be pinned to one particular thing, or left open to any thing of that type.
- **V-3.** The viewer only offers steps the mosaic's types and links allow, so a chain that cannot be followed cannot be built.
- **V-4.** Once the kit has `path` (M9), the viewer can turn a path found between two things into a chain, so that "how these two connect" becomes "everything connected this way". Until then, chains are built only from steps the person picks (V-1).
- **V-5.** The viewer lets a person extend, shorten or change a chain and see the effect without starting over.

*Choose what each card shows.*

- **V-6.** The viewer lets a person choose, for each type, which facts its card shows: properties, the things it links to, and how many things it links to by a given link.
- **V-7.** A type's card looks the same wherever that type appears in the viewer: in a chain, a path, the graph or a node's page. It is set once per type, not per chain.
- **V-8.** Every fact on a card keeps its source (principle 4): the viewer lets a person open the passage or row behind any value, and behind each link between two steps.
- **V-9.** A type with no card set still gets a sensible default from what the mosaic holds.

*See chains as cards or as a table.*

- **V-10.** The viewer shows each result of a chain as a row of cards, one per step, joined by the links that connect them.
- **V-11.** The viewer shows all results of a chain as one table, with one group of columns per step, that can be sorted, filtered and saved as a file.
- **V-12.** The viewer switches between cards and table without losing the chain, the place in the results or the filters.
- **V-13.** The viewer always says how many results a chain has, even when only some are shown, and gives them in the same order every time for the same mosaic.
- **V-14.** A chain whose results would flood the page still answers quickly and says how much was left out, rather than failing or freezing.

*Share chains through the view file.*

- **V-15.** Chains and card choices are saved in the view file, beside the other choices it already holds, so they live in Git with one owner and are reviewed like any other change.
- **V-16.** Anyone who opens the same mosaic with the same view file sees the same chains and cards, in `mosaic view` and in the single-file export alike, offline.
- **V-17.** The viewer can link to one chain, with its pinned steps and filters, so a colleague lands on exactly the same results.
- **V-18.** A view file whose chains or cards name types, links or properties the mosaic does not have still opens; the viewer reports what it could not apply instead of failing.

### Constraints, assumptions and risks

The biggest bet is that distilled facts, links and short summaries answer most questions without raw text. The benchmark (M9) tests it.

**Constraints**

- Open source from the start, under Apache-2.0 for everything: format, mosaic builder, mosaic kit, reference tessera builder and viewer.
- All example and test data is invented; no real system data is ever published.
- Runs on an ordinary laptop, fully offline, with no server or database to install.
- The format and the mosaic kit tools must be usable from any language.
- One maintainer, learning as the project goes: the mosaic kit is written from scratch, and the rest reuses existing tools where they fit.

**Assumptions**

- Small local models can follow a card and use a handful of tools reliably.
- Sources are machine-readable, or a tessera builder makes them so.
- Things have names consistent enough to match, and the user settles the rest when a build reports a conflict.
- A useful mosaic fits in one file of a few megabytes; anything bigger stays outside as external data.

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Summaries too thin | Agents fall back to raw text and mosaics grow | Text tiers as a setting; the benchmark scores each tier |
| Small models misuse the tools | Wrong or missing answers | Few fixed tools, budgeted answers with ids, a card with examples; scored on every change |
| Tessera builders add wrong facts | Agents repeat them with confidence | Provenance and confidence on every fact; the trust policy decides what ships |
| Generic-metamodel trap | The mosaic kit grows domain concepts and fits no domain well | The domain lives in patterns and tessera builders; every use case runs on two unrelated systems |
| Mosaic kit absorbs builder work | Parsers and AI calls creep into the mosaic kit | Both builders sit outside the mosaic kit; the mosaic kit only reads one file and, apart from query embedding bounded by the kit tiers, runs no models, with a size budget checked in CI |
| Embedding lock-in | Queries need the same embedding model as the mosaic | Vectors are on by default but can be turned off; the mosaic names the model, kits bundle the supported models, and name search always works |
| Mosaic builder internals | An engine the mosaic builder uses inside, such as an embedded graph database, changes or stalls | Neither the format nor the pattern depends on it; the mosaic builder can swap it |
| Overlap with existing tools | Mosaic becomes one more retrieval stack | Stay narrow: small, sealed, offline and sourced |

### What Mosaic is not, and what it builds on

Mosaic combines known techniques. What is new is the combination: pieces from any tessera builder, a source for every fact, and one small sealed file shaped for a small model.

- **Not a document search pipeline.** It ships a distilled graph, not chunks of text; raw text is an optional layer.
- **Not a graph database.** There is no working store to host or edit: pieces and a pattern build sealed files.
- **Not a knowledge extractor.** Tessera builders, AI ones included, are interchangeable; Mosaic fixes the result, not the method.
- **Not a model or a model runtime.** It feeds models and is hosted by the runtimes they already use.
- **Not a data warehouse.** Big data stays outside, reached by keys.

| Approach | What Mosaic takes from it | What Mosaic adds |
| --- | --- | --- |
| Retrieval-augmented generation | Answers grounded in retrieved sources | Retrieval over a distilled graph, small and offline |
| Knowledge graphs for language models | Things and relations as context for a model | Sealed files sized for small models, from any tessera builder, with a source on every fact |
| Build systems (Make, Bazel) | Pinned inputs, rules in files, several targets, reproducible outputs | The same discipline, applied to knowledge instead of code |
| Baked data (Datasette, SQLite) | One read-only file that can be published | A card and a fixed tool set for agents |
| Code indexes (SCIP, LSIF) | Definitions and references with positions | The same for every kind of source |
| Entity resolution (Splink) | Matching records that name the same thing | Name mapping while assembling pieces |
| Model Context Protocol | A standard way to give models tools | A small, fixed tool set over one file |

### Decisions and open points

Vision-level decisions, some still to be confirmed by the benchmark; the detailed design is in Parts 2, 3 and 5.

- **Text tier, decision to test:** snippets by default, full text opt-in per source. Structured sources likely need no text; manuals need the passage behind each fact; procedures may need full text for exact wording. Confirm with the benchmark on 50 to 100 questions modelled on real ones, asked against a generated test system and tagged by type (lookup, link, set, why or how, exact wording), measuring accuracy, tokens and size per tier.
- **Smallest model, decision to test:** target models that run on an ordinary laptop offline, likely the 7 to 9B class at 4-bit. Make the tools easy for them: few short tools, answers that suggest the next step, and a card with worked examples. A chaining `ask(question)` tool is left out of 0.1 and comes back only if the benchmark shows small models need it. Benchmark a ladder of 3 or 4 open models (1–4B, 7–9B, 14B+) on the same questions, scoring correct cited answers, calls per answer and loops; record the result as a supported floor and re-run it as new models appear. Below the floor, tiny mosaics go into the context whole.
- **Vectors, decided:** mosaics ship precomputed vectors by default, and the mosaic names the embedding model used. The full mosaic kit bundles every supported embedding model, so it can search any mosaic; a single-model kit bundles only one, and then the mosaic must be built with that same model. A bare kit bundles none: it ignores vectors and searches by names, aliases and full text, which always work. v0 supports one small embedding model, snowflake-arctic-embed-xs in its official 23 MB quantized file, chosen by the spikes, so the full and single-model kits are the same (ADR-005).
- **Tessera format, decided:** require only what the mosaic builder cannot guess. Required: a header (format version, tessera builder and version, source path and hash, settings, the tessera's own hash); nodes with a stable id, a type and the source key, unique within the tessera; edges with type, from and to; every node and edge type declared with its properties, in the builder's own vocabulary; evidence on every node and edge (location in the source, extracted or inferred); a confidence on every inferred fact; and determinism for rule-based tessera builders, so the same source and settings give the same file; AI tessera builders record their model and settings, and their output is fixed by its hash once pinned. Optional: labels, aliases, summaries, snippets, further properties, mentions of things outside the tessera, external references. Not required: the pattern's types (mapping is the pattern's job), card, vectors or indexes. The mosaic kit ships a conformance checker and a conformance suite; minor versions only add optional fields.
- **Sharing, decided:** anyone can publish a tessera or a mosaic; files travel offline, by whatever means people already use. Mosaic has no registry or update service. A new revision is a new file with a new hash, and a pattern takes it only when its owner pins the new hash. Teams that want a shared store, such as an artifact repository, can set one up themselves.
- **Licences and access, decided:** whoever publishes a tessera or a mosaic chooses its licence and who may receive it; Mosaic enforces neither. Tesserae and mosaics carry an optional free-text notice per source (for example "Apache-2.0" or "Company confidential, export controlled"). A mosaic carries the notices of every piece it was built from, and the build report lists them, so whoever shares it can see what is inside and no marking is lost by accident.
- **Mosaic file container, decided:** one SQLite file, with read-only SQL over documented views for bigger models; a graph database may run only inside the mosaic builder (ADR-001). The choice fixes the WebAssembly build of the mosaic kit, how lexical search works, how vectors are stored, and the query language bigger models get (SQL rather than Cypher).
- **Node identity, decided:** tessera ids are unique only within a tessera, but agents cite ids, comparing two builds needs them, and imported mosaics refer to them. A node's id in a mosaic is its type plus its canonical key, such as `Sculpture:T-1889`; a changed key gives a new id, and stale references go to the build report (ADR-002).
- **Summaries and the card, decided:** summaries need judgement or AI, which the deterministic mosaic builder must not do. Tessera builders write summaries; the kit generates the card from a fixed template, using the descriptions in the pattern's types (ADR-006).
- **Vectors and determinism, decided:** embedding models do not always give bit-identical numbers across machines, so default vectors could break "the same pieces and pattern give the same mosaic". The mosaic's identity hash covers its knowledge, as rows in a canonical order rather than file bytes, so it is the same across SQLite versions; vectors are a separate layer with their own hash, the model's name and the hash of its exact file, built on CPU inference and stored as binary (ADR-001, ADR-005).
- **Mosaic kit tiers, decided:** a kit that bundles every supported embedding model is not small, runs model inference, and must do so in WebAssembly. Tiers are bare, single-model and full; in v0 the full and single-model kits are the same. Size budgets are in ADR-007.
- **Cross-piece linking input, decided:** link rules need something to match, such as mentions of ids in text or code; for documents and code these are essential. Tessera builders record mentions (text, location, containing node, role hint), and the pattern's edges turn them into links (ADR-003).
- **Pattern language, decided:** one YAML file with four sections (pieces, types, edges, mosaics) plus an optional proposals file; no LinkML, SQL or code. Computation belongs in tessera builders (ADR-004).
- **Untrusted mosaics, decided:** the card goes into the system prompt and snippets come from documents, so a third-party mosaic can carry instructions aimed at an agent. The mosaic kit generates the card from a fixed template, returns source text in marked data fields with its origin, checks the mosaic's hashes on every open and reads it defensively; signatures come later (ADR-006).
- **Numbers, decided:** provisional budgets for two reference sizes (10,000 and 100,000 nodes): about 1 KB per node, tools under 100 ms, a card under 1,500 tokens, a bare kit under 3 MB, and a tiny-mosaic threshold of a quarter of the model's context. They are checked in CI and moved by the benchmark (ADR-007).
- **Tesserae that read other tesserae, decided:** they don't. A tessera always has one source, never a mosaic. AI summaries come from the tessera builder of the source that describes the thing; AI proposals across pieces go into the pattern's proposals file, written by a pattern assistant (ADR-003).

### Glossary

These terms are domain-neutral and used throughout; Part 5 relies on them.

| Term | Meaning |
| --- | --- |
| System | What is being described: a collection, a machine, a product, a software service |
| Source | One artifact a tessera is made from, as it exists: a table, a database, a structured file, code, a document, an existing knowledge graph |
| Tessera builder | Any program or person that turns one source into a tessera |
| Reference tessera builder | The tessera builder Mosaic ships: importers, a rule-based linker and an optional AI step |
| Tessera | A sealed file in the tessera profile, made from exactly one source, with a source for every fact |
| Mosaic | A sealed, read-only file in the mosaic profile, built from pieces by a pattern: nodes, edges, names, link counts, citations and optional layers |
| Piece | A tessera or a mosaic that a pattern lists as input |
| Pattern | The YAML file (`pattern.yaml`) in Git saying which pieces make which mosaics and how they fit: pieces, types, edges and mosaics |
| Proposal | An identity or edge suggested by an AI assistant or a person in `proposals.yaml`, with the user's decision |
| Mosaic builder | Assembles pieces by a pattern and writes each mosaic the pattern names; deterministic |
| Target | One mosaic a pattern names: its scope, trust policy, text tier, vectors, evidence setting and size budget |
| Card | The short text in a model's system prompt that says what a mosaic holds and how to ask; generated by the kit |
| Node, edge | A thing, identified by its type and key, with its summary and facts; a typed link from one node to another |
| Evidence | Where a node or edge came from: tessera builder, source, locator, method, and a confidence when inferred |
| Snippet | The source passage behind one evidence row |
| Mention | In a tessera, a place where the source names something, with the node containing it and a role hint |
| Alias | Another name a thing goes by, such as T\_1889 or "the seated figure" |
| Summary | A short description of a node, written by a tessera builder, not by the mosaic builder |
| Notice | Optional free text on a source, such as a licence or a confidentiality marking, carried into every mosaic built from that piece |
| Knowledge hash | The hash of a file's content in canonical form (Part 5, section 3.6) |
| Vector hash | The hash of a mosaic's vector layer (Part 5, section 3.7) |
| Trust policy | The target setting that decides which inferred facts ship: none (reviewed, the default; accepted proposals are extracted facts), those above a confidence, or all |
| Text tier | How much source text a mosaic carries: none, snippets or full |
| Mapping | The `from` entries of a type: which piece types become it and which fields fill it |
| Identity | Same type and same key after normalisation is the same thing; spelling variants are aliases, and fuzzy matches arrive as proposals |
| Link rule | The `mentions` entry of an edge: which mentions, by role, become that edge across pieces |
| Policy | Which piece wins when pieces give different values for the same fact: the first in the pattern's pieces list |
| Build report | The conflicts, unresolved names, failed checks and notices of a build, for the user to act on |
| Mosaic kit | The small read-only library with the six tools, embedded by agents and the viewer |
| Viewer | The reference app people use to browse a mosaic |
| External reference | A key into data that stays outside, such as a time series |
| Benchmark | Known-answer questions on a system generated by the mocker, used to score every change |

## Part 2 · Data model

The data model of Mosaic's own formats: the file format with its two profiles, tessera and mosaic, and the pattern. It never defines a domain's types; those live in patterns. The normative definitions are a SQL DDL file (`format.sql`) for the file format and JSON Schemas for `pattern.yaml` and `proposals.yaml`, versioned with the format (Part 5); this part is the conceptual and logical layer above them. The decisions it builds on are in Part 3.

### Entities

Nineteen entities: fourteen in the file format, five in the pattern. The profile columns say where each one appears.

| Entity | What it is | Tessera | Mosaic | Pattern |
| --- | --- | --- | --- | --- |
| Header | Format version, kind (tessera or mosaic), producer, source or pattern, settings, hashes | Yes | Yes |  |
| Source | What a tessera was made from, or a piece a mosaic was built from: path, kind, hash | One | One per piece |  |
| Type | A node or edge type declared in the file, with its properties and description | Builder's vocabulary | Pattern's types |  |
| Node | A thing: id, type, key, label, summary, properties | Yes | Yes |  |
| Edge | A typed link between two nodes | Yes | Yes |  |
| Alias | Another name a node goes by | Optional | Yes |  |
| Evidence | Where a node or edge came from: source, location, how produced, confidence | Yes, full | Yes, per evidence setting |  |
| Mention | A place a source names something, with role hint and containing node (ADR-003) | Optional | No, used up by link rules |  |
| Snippet | The passage of a source behind a fact, per text tier | Optional | Per text tier |  |
| Notice | Free text such as a licence or confidentiality marking | Optional | Carried from every piece |  |
| Link count | Edges per node, type and direction, for `get` | No | Yes |  |
| Vector | A node's embedding, in its own layer with its own hash (ADR-005) | No | Default on |  |
| Pattern | The file: pieces, types, edges, mosaics |  |  | Yes |
| Piece entry | One pinned tessera or mosaic, in priority order |  |  | Yes |
| Type and edge definitions | Canonical types with key, description and `from` mappings; edges with the mention role they come from |  |  | Yes |
| Mosaic target | One mosaic to build: scope, trust policy, text tier, vectors, size budget, strict mode |  |  | Yes |
| Proposal | A proposed identity or edge, by an AI assistant or a person, with evidence, a confidence when by an AI, the build it came from, and the user's decision |  |  | Optional file |
| Source text | The entire text of a text source, kept only in the full text tier | Optional | Per text tier |  |
| External reference | A key into data that stays outside, such as a time series | Optional | Carried from pieces |  |

The card is not stored: the mosaic kit generates it at open time from types, link counts and example keys (ADR-006).

### Conceptual model

> *Diagram not in the repository yet: conceptual model · 14 file entities, 5 pattern sections*

The node sits at the centre: its type and key give its id, aliases give its other names, edges link it to other nodes, and evidence ties it to a source and, through snippets, to the passage behind it. Mentions exist only in tesserae, where link rules consume them; link counts and vectors exist only in mosaics. The pattern sits outside the file and builds mosaics from pieces.

### Logical model: file format

One format, two profiles. Fields marked *t* are tessera-only, *m* mosaic-only; the rest appear in both. Ids are text; keys and hashes are lowercase hex SHA-256.

| Entity | Fields | Key |
| --- | --- | --- |
| Header | format version, kind (tessera or mosaic), producer name and version, settings, knowledge hash, *m* vector hash, *m* embedding model name and model file hash, *m* pattern hash and target name, *t* AI model and settings when produced by AI | one row |
| Source | id, kind (file, database, knowledge graph, tessera, mosaic), path or URI, content hash, notice | id |
| Type | name, kind (node or edge), description, key property (node types), from and to types (edge types), declared properties with value kinds | name |
| Node | id (type plus canonical key, ADR-002; tessera-local in a tessera), type, key, label, summary, properties as a JSON object | id |
| Edge | type, from node, to node, qualifier, properties | type, from, to, qualifier |
| Alias | text, node, origin (source spelling, pattern, proposal) | text, node |
| Evidence | subject (node, edge or property), source, locator (row, line, page, character range), method (extracted, inferred), producer, confidence, *m* via (the mosaics it passed through) | all its fields |
| Mention | *t* text, locator, containing node, role hint, kind | locator |
| Snippet | evidence it belongs to, text | evidence |
| Notice | source, text | source |
| Link count | *m* node, edge type, direction, count | node, edge type, direction |
| Vector | *m* node, bits | node |
| Source text | source, text | source |
| External reference | node, system, kind, locator (a JSON object of keys), source | node, system, kind, locator |

Notes:

- **Properties** are stored as a JSON object per node and edge, typed by their type's declaration; the mosaic kit's `table` tool turns them into columns.
- **Text search** indexes labels, aliases, summaries and snippets; the index is part of the physical layer, not the logical model.
- **Evidence in a mosaic** keeps one row per fact by default; the target's evidence setting can keep all rows.

### Logical model: pattern

Two YAML files (ADR-004), validated by JSON Schemas.

| Element | Fields | Notes |
| --- | --- | --- |
| Pattern | format version, pieces, types, edges, mosaics | `pattern.yaml` |
| Piece entry | name, kind (tessera or mosaic), hash, optional path | Order is priority when values conflict |
| Type definition | name, key property, description, normalisation, `from` mappings | One per canonical node type |
| Mapping (`from` entry) | piece name and piece type, field map (canonical property to piece field), options (strip a prefix, normalise) | No computation; that belongs in tessera builders |
| Edge definition | name, from type, to type, description, mention role it comes from, or a piece edge type it maps | Mentions that match nothing go to the build report |
| Mosaic target | name, types in scope, trust policy (reviewed, a confidence threshold, or all), text tier (none, snippets, full), vectors (on or off), evidence (primary or all), size budget, strict (fail on conflicts, alias conflicts and unmatched mentions) | Default: one target, `default`, with every default |
| Proposal | id, kind (identity or edge), by (an assistant or a person), subject nodes, confidence (assistant only), evidence, build it came from, decision (open, accepted, rejected), decided\_by | `proposals.yaml`, written by the pattern assistant or a person, decided by the user |

### Invariants

The conformance checker enforces these; a file or pattern that breaks one is invalid. Part 5 (sections 3.9 and 5.6) states them normatively.

**Both profiles**

1. Exactly one header; its format version is supported by the reader.
2. Every node and every edge has at least one evidence row.
3. Every inferred fact has a confidence between 0 and 1; extracted facts have none.
4. Every node's and edge's type is declared, and edges join nodes of the declared from and to types.
5. Edges point to nodes in the same file.
6. Rows are in canonical order with dense row ids, and the knowledge hash matches the canonical encoding of the file's content.

**Tessera**

7. Exactly one source, which is never a tessera or a mosaic (ADR-003).
8. Node ids are unique within the tessera, and no evidence row has a `via`.
9. A rule-based tessera is deterministic: same source and settings give the same knowledge hash.

**Mosaic**

10. Node ids are type plus canonical key and unique; every type has a key property.
11. Every piece listed in the header's sources is pinned by hash and matches the pattern.
12. Every evidence row names its original source by hash, and records the mosaics it passed through, innermost first.
13. Link counts equal the edges they count.
14. The vector layer, when present, has one row per node and matches its own hash and model id.
15. Notices of every piece are carried.

**Pattern**

16. Valid against the JSON Schema.
17. Every piece is pinned by hash; every `from` names a listed piece and a node type it declares; every `map` entry names a listed piece and an edge type it declares.
18. Type names, edge names and target names are unique.
19. No piece has the name of a target of the same pattern, so no target lists its own output among its pieces.

### Physical model

One SQLite file per tessera or mosaic, with the same schema for both profiles: tables a profile does not use stay empty, and the header's kind says which profile applies. The normative DDL is `format.sql` (draft 0.1); this section explains its choices.

| Table | Holds | Notes |
| --- | --- | --- |
| `header` | The one header row | `CHECK (one = 1)`; profile rules as CHECK constraints |
| `source` | Sources (tessera); pieces and their original sources (mosaic) | Hash and notice per source |
| `type` | Node and edge types | Declared properties as a JSON object |
| `node` | Nodes | Integer `nid` for joins; text `id` unique; `UNIQUE (type, key)` |
| `edge` | Edges | `UNIQUE (src, type, dst, qualifier)` doubles as the outgoing index; `edge_in` on `(dst, type)` |
| `alias` | Other names | Case-insensitive; one row per name and node |
| `evidence` | Provenance | Exactly one of node or edge; confidence only when inferred, enforced by CHECK |
| `snippet` | Passages | One per evidence row, only in the snippets or full text tier |
| `mention` | Mentions | Tessera only |
| `link_count` | Edge counts per node, type, direction | Mosaic only |
| `vector` | Embeddings | Mosaic only; 48-byte binary vectors (384 bits) |
| `search` | Full-text index | FTS5, one row per node: label, aliases, summary, snippets |
| `source_text` | Entire source texts | One row per text source, only in the full text tier |
| `external_ref` | Keys into outside data | One row per node, system, kind and locator |

The mosaic kit reads through four views, `v_node`, `v_edge`, `v_alias` and `v_evidence`, which show text ids only; internal row numbers never leave the file.

#### Choices

- **Integer row ids inside, text ids outside.** Edges and evidence join on integers, which keeps them small and fast; ids such as `Sculpture:T-1889` appear once, in `node`.
- **Properties as JSON text,** checked with `json_valid`. The kit's `table` tool reads them with `json_extract`. No per-type tables, so the schema never depends on a domain.
- **Constraints carry invariants.** CHECK, UNIQUE and foreign keys enforce what SQLite can (invariants 1, 3, 5 and parts of 4 and 10); the conformance checker does the rest.
- **Contentless full-text index.** The text already lives in the tables, so the index stores only terms (`content = ''`), with node row ids as its row ids. Tokens keep `-`, `_` and `.`, so `T-1889` and `LOAN_X` stay whole words.
- **No prefix index.** It tripled the index for a gain of a fraction of a millisecond (see the measurements).
- **Sealing.** The builder inserts rows in a fixed order, runs `ANALYZE` and `VACUUM`, and the kit opens the file read-only and immutable. The knowledge hash covers the rows in canonical order, not the file's bytes, so a different SQLite version cannot change a mosaic's identity (spike S1: bytes differ between SQLite 3.45 and 3.53, the hash does not).
- **Identification.** `application_id` is `0x4D4F5341` ("MOSA") and `user_version` is the format version, so tools can recognise a file without reading its tables.
- **Canonical order and hash.** Rows are stored in a canonical order with dense row ids, so integer keys depend only on content and the hash is a plain scan of the base tables. The exact order and encoding are normative in Part 5, section 3.6 (knowledge hash) and 3.7 (vector hash). The kit recomputes both hashes on every open (ADR-006 amendment). Measured on the PX4 corpus: 113 ms at 18,000 nodes and 651 ms at 107,000 (plus 78 ms for vectors), identical on SQLite 3.45 and 3.53 and in the browser (SQLite 3.54.1 WebAssembly), where the full check takes 0.3 s at 18,000 nodes and 2.6 s at 107,000.

#### Measurements

A synthetic mosaic of 10,000 nodes, 30,000 edges, one evidence row per fact, 10,000 aliases and vectors on, built with SQLite 3.53:

| Variant | File size | Per node |
| --- | --- | --- |
| Text tier none | 10.6 MB | 1.06 KB |
| Snippets (about 300 characters each), chosen index | 16.3 MB | 1.63 KB |
| Snippets, with prefix index | 23.9 MB | 2.39 KB |
| Snippets, index without positions (no phrase search) | 14.8 MB | 1.48 KB |

The chosen layout meets ADR-007: about 1 KB per node without text, and a 10,000-node mosaic with snippets under 20 MB. `find` took about 0.05 ms and `neighbors` about 0.02 ms, far inside the 100 ms budget. The largest parts are the full-text index (25 %), snippets (21 %) and nodes (19 %); vectors are 3 %. On real PX4 text the full-text index is 16 % of the file (spike S3, Part 4).

Decided: no prefix index, and the full-text index keeps word positions so phrase search works.

### Pattern schemas

Two JSON Schemas (draft 2020-12, version 0.1) validate the YAML files: `pattern.schema.json` for `pattern.yaml` and `proposals.schema.json` for `proposals.yaml`. `mosaic check` runs both.

#### pattern.yaml

| Field | Shape | Default and rules |
| --- | --- | --- |
| `format` | `"0.1"` | Required |
| `pieces` | List of `name@hash`, or `{name, hash, kind, path}` | Required, at least one; order is priority; a hash is required, at least 8 hex characters |
| `types.<Name>` | `{key, describe, normalise, from}` | Names start with a capital; `key` and `from` required; `describe` at most 200 characters |
| `normalise` | List of steps: trim, upper, lower, collapse-spaces, dash-to-underscore, underscore-to-dash | Default `[trim]` |
| `from.<piece.Type>` | Map of canonical property to piece field | Values are field names only, so no computation; one reserved option, `strip` |
| `edges.<name>` | `{from, to, describe}` plus exactly one of `mentions` (a role hint) or `map` (piece edge types) | Names in lower case |
| `mosaics.<name>` | `{types, trust, text, vectors, evidence, budget, strict}` | `types: all`, `trust: reviewed`, `text: snippets`, `vectors: true`, `evidence: primary`; `budget` like `20 MB` |

The museum example, as it validates. It is the reference example used in Part 3:

```yaml
format: "0.1"
pieces:              # order = priority when values conflict
  - catalogue@9f2c41d0
  - loans@7ab1e93c
  - guide@41c0aa27

types:
  Sculpture:
    key: number
    describe: A work in the museum's collection
    normalise: [trim, upper]
    from:
      catalogue.Row: {number: Number, title: Title, date: Date}
      loans.Item:    {number: ref, strip: LOAN_}
  Section:
    key: id
    describe: One section of the gallery guide
    from:
      guide.Section: {id: id, title: title}

edges:
  describes:
    from: Section
    to: Sculpture
    mentions: caption.number

mosaics:
  curators: {types: all, text: snippets, budget: 20 MB}
  public:   {types: [Sculpture], text: none, vectors: false}
```

#### proposals.yaml

The file records `built_from` (the knowledge hash of the mosaic the assistant read) and the assistant that wrote it. Each proposal has an id, a by field (an assistant or a person; the file-level assistant is the default), a confidence when made by an assistant, at least one piece of evidence (source, locator, optional quote) and a decision: open, accepted or rejected, with decided\_by once decided. An accepted proposal enters the mosaic as an extracted fact sourced to its entry in this file. An identity proposal names the node that stays and the names that become its aliases; an edge proposal names the edge type and its two nodes.

```yaml
format: "0.1"
built_from: 3f6c0b1e…
assistant: pattern-assistant/0.1
proposals:
  - id: p1
    kind: identity
    node: Sculpture:T-1889
    same_as: [T1889]
    confidence: 0.86
    evidence: [{source: guide, locator: page=12, quote: "T1889, bronze"}]
    decision: open
```

#### What the schema cannot check

JSON Schema checks each file's shape, not references between parts. `mosaic check` adds these: every `from` names a listed piece and a type that piece declares; every `map` entry names a listed piece and an edge type it declares; edge `from` and `to` name declared types; a target's `types` exist; no target uses its own output as a piece (no piece is named like a target); YAML keys are not duplicated (a YAML loader would silently keep the last one); and a proposal's nodes have declared types and, when that mosaic is available, exist in the mosaic it was built from.

Tested: both examples validate, and nine broken variants are rejected, including a missing format, an unpinned piece, an edge with both `mentions` and `map`, a computed mapping and a confidence above 1.

### Next

1. **Physical model:** confirmed on 18,000 real nodes (Part 4); still to confirm on the museum example.
2. **Normative files:** `format.sql`, `pattern.schema.json` and `proposals.schema.json` are drafted (0.1); publish them in the repository, versioned with the format, and write `mosaic check` for the rules the schema cannot express.
3. **Museum example:** one tessera, the pattern and the resulting mosaic's rows, end to end, kept as an informative example; the conformance fixtures are listed in Part 5, section 11.

## Part 3 · Architecture

Architecture decisions for Mosaic, taken in order because each depends on the ones before. They answer the open points of Part 1. All seven are accepted (27 October 2026); the spikes they called for are in Part 4.

### Decision log

| ADR | Decision | Depends on | Status |
| --- | --- | --- | --- |
| ADR-001 | Mosaic file container: one SQLite file | — | Accepted |
| ADR-002 | Node identity across pieces and rebuilds: type plus canonical key | 001 | Accepted |
| ADR-003 | Cross-piece linking input, and where AI output goes | 002 | Accepted |
| ADR-004 | Pattern language: one YAML file | 002, 003 | Accepted |
| ADR-005 | Vectors: determinism and mosaic kit tiers | 001 | Accepted |
| ADR-006 | Untrusted mosaics: generated card, marked data, hash checks | 001 | Accepted |
| ADR-007 | Size, speed and context budgets: provisional, checked in CI | 001, 005 | Accepted |

Each decision is one file in [`adr/`](adr/), with its context, the options considered and the consequences:

- [ADR-001: Mosaic file container](adr/ADR-001-mosaic-file-container.md)
- [ADR-002: Node identity](adr/ADR-002-node-identity.md)
- [ADR-003: Linking input, and where AI output goes](adr/ADR-003-linking-input-and-where-ai-output-goes.md)
- [ADR-004: Pattern language](adr/ADR-004-pattern-language.md)
- [ADR-005: Vectors](adr/ADR-005-vectors.md)
- [ADR-006: Untrusted mosaics](adr/ADR-006-untrusted-mosaics.md)
- [ADR-007: Budgets](adr/ADR-007-budgets.md)

### Views

Seven views of the accepted decisions: what surrounds Mosaic, what it is made of, how it runs, where it is deployed and where untrusted content enters.

#### Context

> *Diagram not in the repository yet: context view · Mosaic core and its surroundings*

The core is what this project defines and ships: the mosaic builder, the mosaic kit and the two formats. Tessera builders turn sources into pieces outside the core; anyone can write one. The pattern author owns the pattern in Git and decides on the AI assistant's proposals. Agents and people only ever read sealed mosaics, and other teams contribute by sharing tesserae or mosaics, never by editing someone else's.

#### Building blocks

> *Diagram not in the repository yet: building blocks · components and the files between them*

No component calls another: each reads and writes files. Tessera builders and the mosaic builder meet at tesserae; the builder and the kit meet at the sealed mosaic; the pattern assistant reaches the build only through the proposals file, which the user reviews (ADR-003). A mosaic can also be a piece of another pattern, which this view leaves out for clarity.

#### Runtime: an agent answers a question

> *Diagram not in the repository yet: runtime view · agent query, 14 messages*

Opening checks the hashes and schema before anything reaches the model (ADR-006), and the card the model sees is generated by the kit, not read from the file. Every answer is marked as data (ADR-006) and kept short (ADR-007), and the final answer carries a citation the user can check against the source passage.

#### Runtime: building a mosaic

> *Diagram not in the repository yet: runtime view · mosaic build, 3 phases*

The builder first checks the pattern against its schema and every piece against its pinned hash; a mismatch stops the build. It then maps piece types to canonical types, merges nodes by key in piece order, turns mentions into edges with the link rules and adds accepted proposals. Conflicts, stale references and unmatched mentions go to the build report rather than into the mosaic. Sealing writes rows in a fixed order, builds the full-text index and vectors, and computes the hashes (ADR-001, ADR-005; steps in Part 5, section 7).

#### Runtime: the proposal loop

> *Diagram not in the repository yet: runtime view · proposal loop, 8 messages*

The assistant never writes to a mosaic. It reads the build report's unresolved names, looks up candidates in the mosaic, and writes proposals with confidence and evidence. The user accepts or rejects each one in the pattern's proposals file, and an ordinary build follows (ADR-003). Each proposals file records the mosaic it was made from, so proposals made from an outdated build are flagged in the next report.

#### Deployment

> *Diagram not in the repository yet: deployment view · one build side, three places the kit runs*

Building and reading are separate: tessera builders and the mosaic builder run in CI or on a laptop, and a mosaic travels as one file by whatever means the team already uses. The kit runs in three places: in process next to a local model, as a local MCP server inside a desktop host, or in the browser through WebAssembly. Each place can use the bare kit (names and full-text) or the single-model kit (adds vectors, up to 60 MB more). Spike S2 confirmed the browser budgets (Part 4).

#### Trust boundaries

> *Diagram not in the repository yet: trust boundaries · four entry points and their guards*

Untrusted content enters at four points, and each has its own guard (ADR-003, ADR-006). Shared mosaics are opened defensively; text inside any mosaic reaches the model only as quoted, marked data; AI tesserae are pinned by hash and carry their model and confidence; AI proposals need the user's decision. What is not guarded yet is authorship: a hash shows a mosaic is intact, not who made it. Marked data reduces but does not prevent prompt injection; a standing benchmark test measures how well small models respect it.

## Part 4 · Measurements

Before Mosaic was built, twelve spikes tested the architecture decisions on real data from several sources: the code, message files and user guide of PX4, an open-source autopilot (release v1.17.0; BSD 3-clause code, CC BY 4.0 guide), with MAVLink message definitions (MIT). A throwaway loader wrote about 18,000 nodes straight into a file made from `format.sql`; a six-fold copy gave the 100,000-node case. The decision records cite these results by spike number (S1 to S12).

The fixture for text and mentions (M8) is Marlin, an open-source 3D printer firmware with its documentation: smaller, one licence, and downloaded by hash like the other fixtures. Its corpus is planned with M8, and the measurements are repeated on it there.

### Results

All spikes except S8 have run, on 27 October 2026, on one Linux machine with Python 3.13 and SQLite 3.53.1 (browser runs in headless Chromium). Files: the PX4 mosaic from the loader (17,905 nodes, 19.5 MB) and a six-fold copy (107,430 nodes, 117 MB) made by `scale.py`. The tools are fast at both sizes; the first hash design broke the 1 s open budget at 100,000 nodes, and the cheaper canonical encoding below fixed it.

#### First round: S1, S3, S4, S9, S10

| Spike | Result | Verdict |
| --- | --- | --- |
| S1 Reproducible builds | Same SQLite twice: byte-identical. SQLite 3.45.1 against 3.53.1: knowledge hash identical, but 259 of 4,759 pages differ (mostly index pages rebuilt by VACUUM, plus the version in the file header) | Confirms ADR-001: identity is the hash of the rows, not the bytes. Closed; the cross-OS check is dropped: CI runs on Linux only, and repeated local builds check hash stability |
| S3 Full-text index | 3.2 MB of 19.5 MB (16 %) on real text, against 25 % on synthetic text. `find` p95 0.9 ms at 18k nodes, 5.9 ms at 107k | Within budget; layout stands |
| S4 Vector scan | With numpy: p95 3.8 ms at 18k, 25 ms at 107k, after loading the vectors in 6 ms and 45 ms. Pure Python reading from the file: p95 21 ms and 112 ms | Within budget with numpy; a bare kit without numpy misses 100 ms at 100k. Browser in S2 |
| S9 Path at scale | 4-hop bidirectional search: p95 0.5 ms, worst 2.2 ms at 107k. Only 30 % of module, parameter, topic and message pairs connect within 4 hops at 18k | Fast. The graph is sparse, so `path` will often answer "no path"; the scaled copy is artificial and understates connectivity |
| S10 Large mosaic | 117 MB at 107k nodes, about 1.1 KB per node. Opening 3 ms; `get`, `neighbors`, `cite` p95 under 0.05 ms; a page of `table` 7 ms. Recomputing the knowledge hash with the first encoding took 2.0 s (0.37 s at 18k); hashing the file's bytes 0.8 s | Tools well inside budget. Closed after the retest and cold-open run below |

Retest with a cheaper hash (same day): rows stored in canonical order with dense row ids, so the hash scans base tables with no joins or sorting, and SQLite encodes each row with `quote()`. The one REAL column, confidence, is hashed as whole millionths because `quote()` prints some floats differently across SQLite versions (1/3 differs between 3.45 and 3.53). Medians of five runs:

| Mosaic | Old hash | New hash | Vector hash |
| --- | --- | --- | --- |
| 17,905 nodes, 19 MB | 371 ms | 113 ms | 15 ms |
| 107,430 nodes, 117 MB | 1,993 ms | 651 ms | 78 ms |

The new hash is the same on SQLite 3.45.1 and 3.53.1. A full check now takes about 0.73 s at 107k nodes and 0.13 s at 18k. Cold open, measured afterwards with the page cache dropped before each run and checked empty (0 % of the file resident): open plus both hashes takes 151 ms at 18,000 nodes against 126 ms warm, and 972 ms at 107,000 against 773 ms warm. This machine reads the disk at about 190 MB/s; a laptop NVMe drive is faster, while a spinning disk or a network share could push the largest mosaic past 1 s. This led to the ADR-006 amendment: the kit runs the full hash check on every open, with this encoding.

#### S2: browser

The kit's queries and the every-open hash check work in a browser within budget, at both sizes. Setup: headless Chromium 153 driven by Playwright, the official SQLite WebAssembly build (SQLite 3.54.1, from the `sqlite/sqlite-wasm` repository, because the npm registry is blocked here), the mosaic fetched over local HTTP and opened from memory. The browser's hashes match Python's exactly. Three runs; p95 for tools, typical value for the rest.

| Measure | 17,905 nodes, 19 MB | 107,430 nodes, 117 MB | Budget |
| --- | --- | --- | --- |
| SQLite download (WebAssembly + JavaScript, gzip) | 619 KB | same | Bare kit under 3 MB compressed |
| Start SQLite | 62 ms | once per page |  |
| Open from memory | 31 ms | 56 ms |  |
| Knowledge hash | 0.25 s | 2.4 s |  |
| Vector hash | 0.04 s | 0.15 s |  |
| Open plus both hashes | 0.3 s | 2.6 s | Under 3 s in a browser |
| `find` | 2.4 ms | 6.4 ms | Under 300 ms (3 times native) |
| `get`, `neighbors`, `cite` | 0.3 ms or less | 0.2 ms or less |  |
| A page of `table` | 3.3 ms | 9.7 ms |  |
| `path`, 4 hops | 1.6 ms | 1.3 ms | Under 900 ms |
| Vector scan, top 10 (after a 30 ms or 217 ms load) | 0.8 ms | 4.2 ms | Under 300 ms |

Two changes were needed to fit. The first hash took 5 s at 107k because the rows passed through one 73 MB JavaScript string; SQLite now joins the rows of each chunk of 4,096 itself and returns them as bytes. The vector hash read one row at a time; it is now defined over the vector bits alone in node row order, which is canonical, so it still binds each vector to its node. Fetch time is excluded: over a real network a 117 MB mosaic will take longer to download than to check.

#### S6: embedding models

Vectors roughly double what full-text search finds for questions phrased in people's words, but the three models are too close to rank with 38 questions (one question is 2.6 points). What decides the pick is size: only a quantized model fits the 60 MB kit budget. Setup: all 17,905 nodes embedded with each model through ONNX Runtime on CPU (node text = type, key, label, summary and up to 800 characters of snippet); the 41 drafted questions, of which 38 have an answer. "Top 10" = a node the answer needs is in the first 10 results; "or 1 hop" also counts it one edge away from one of the first 5, which an agent reaches with `neighbors`.

| Method | Model file | Top 10 | Top 10 or 1 hop |
| --- | --- | --- | --- |
| Full-text only | none | 18 % | 39 % |
| bge-small-en-v1.5, float vectors | 133 MB | 42 % | 63 % |
| bge-small-en-v1.5, 48-byte bits, float query | 133 MB | 45 % | 63 % |
| bge-small-en-v1.5 quantized by us, 48-byte bits, float query | 34 MB | 21 % | 50 % |
| all-MiniLM-L6-v2, 48-byte bits, float query | 90 MB | 39 % | 55 % |
| snowflake-arctic-embed-xs, 48-byte bits, float query | 90 MB | 32 % | 50 % |
| snowflake-arctic-embed-xs quantized (official), 48-byte bits, float query | 23 MB | 32 % | 50 % |

Findings:

- Scoring the stored bits against the full-precision query (instead of turning the query into bits too) recovers most of the loss from 48-byte vectors at no storage cost: bge goes from 24 % to 45 % in the top 10.
- Mixing vector and full-text results with a plain rank fusion made results worse; `find` should put exact name and alias matches first and use vectors for the rest.
- Quantizing bge ourselves broke its bits (21 %); Snowflake's own quantized file kept its quality. Only models with an official small file are candidates.
- Doc sections dominate results (237 of 380 top-10 slots for MiniLM): the right page is often found when the parameter itself is not, which the one-hop column reflects.

#### S5: vector determinism

The same model file gives identical bits on CPU regardless of settings; a different file of the "same" model does not. On 2,000 nodes with bge-small-en-v1.5: 1, 4 and 8 threads gave 0 differing bits; turning off graph optimisation changed floats by up to 0.0000003 but no bits. The int8 file against the float32 file of the same model differed in 8.7 % of bits, and Snowflake's quantized file against its float32 file in 2.6 %. So a mosaic must record the exact model file by hash, not only its name. In the browser (ONNX Runtime Web 1.31.1, WebAssembly, one thread, same quantized Snowflake file, same token ids), vectors are close but not identical: 0.87 % of bits differ on 2,000 nodes and floats by up to 0.017. Search is unaffected: browser-made query vectors against Python-built stored bits give the same scores (32 % top 10) and share 9.3 of 10 results on average. Embedding in the browser is slow (2,000 texts in 187 s single-threaded), so vectors are built natively by the mosaic builder and the browser only embeds queries.

#### S7 and S12: ids and mentions

Ids are short enough for small models, and mentions are too small to need special storage. Ids average 11.2 tokens with the Qwen2.5 tokenizer (p95 18, max 26) and 15.9 with SmolLM2 (p95 25, max 36); doc sections are longest (14.7 and 19.7), topics and parameters shortest (5.5 to 10). As mention rows in the tessera format, the docs give 5,091 mentions and the code 4,227: 9,318 rows, 1.6 MB with the index, 175 bytes each. Storing mentions per section with offsets only (ADR-003, to revisit) is not needed at this scale.

#### S11: build time

The loader builds the PX4 file without vectors in about 2 s, a lower bound for the mosaic builder. With vectors, embedding 18,000 nodes takes about 8–10 minutes on 4 CPU threads, within the relaxed 15-minute budget (ADR-007).

#### Question set

The structured half of the S6 and S8 question set is generated: 59 questions (30 lookups, 11 relations, 18 retrievals) in `questions_generated.yaml`, with answers read from the data. Relation answers come from the loader's own matching, so spot-check a few. The hand-written half starts from `questions_handwritten.yaml`.

## Part 5 · Specification 0.1

The specification is its own file: [`spec-0.1.md`](spec-0.1.md). It is the normative contract for Mosaic's formats and tools, with the five normative files in [`spec/`](../spec/). Version 0.1 is a draft that may change until it is frozen (M11). References in this document to "Part 5, section …" point to the sections of that file.
