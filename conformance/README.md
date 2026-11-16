# Conformance suite

Versioned with the specification (docs/spec-0.1.md, section 11). Both the Python
builders and the TypeScript kit are tested against the cases here; this is where
the two languages meet.

| Directory | Holds | Status |
| --- | --- | --- |
| `fixtures/` | `manifest.json` of fixture sources (pinned by hash, downloaded, never committed to `main`; sources without a reachable origin live on the `fixtures` branch), and per fixture: its pattern, view file and **expected** hashes and build report | Netflix and Chinook pinned; OpenFlights (M7) and PX4 (M8) not yet, their licences pending |
| `invalid/files/` | One invalid tessera or mosaic per invariant of section 3.9, each naming the invariant it breaks | M1 |
| `invalid/patterns/` | One invalid pattern or proposals file per rule of sections 5 and 5.6 | M1 |
| `reading/` | Files the reading rules of section 3.8 open or refuse, one per rule of step 2, with the header each reader returns; read by the Python reader and the kit | M2 |
| `views/` | `settings.json`: the settings each shipped view file gives the page, as the Python reader writes them; checked by the Python tests, read by the viewer's | M3 |
| `tools/` | Kit tool cases on the Chinook mosaic with expected answers, valid against `spec/answers.schema.json`; and the cases of `cite` with `around` (`expected-passages.json`) on `passages.mosaic`, a mosaic of the full text tier written by `scripts/make_tool_files.py` | M3, M8 |

**Expected values are the contract.** Never edit a file named `expected*` or the manifest to
make a test pass. If an expected value looks wrong, open an issue or a pull request that says
which section of the specification it contradicts.
