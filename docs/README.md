# Docs

Each document has one home; nothing here is a copy of another file.

- [`design.md`](design.md): *Mosaic — Design*. The vision and the roadmap (Part 1), the data
  model (Part 2), the architecture views (Part 3) and the measurements with their spike
  results (Part 4). Parts 3 and 5 link to the two entries below. Nine diagrams are not in the
  repository yet and are marked in place.
- [`spec-0.1.md`](spec-0.1.md): the Specification 0.1, the normative contract for the formats
  and the tools. It is a **draft** and may change until it is frozen. The five normative files
  it names are in [`../spec/`](../spec/).
- [`adr/`](adr/): the architecture decisions ADR-001 to ADR-007, one file each. The decision
  log in Part 3 of `design.md` lists them.

Where the specification and a normative file disagree, the file wins for structure and the text
for meaning, and the disagreement is a defect to report.

A change to the specification or to an accepted decision comes through a pull request that
gives its reason (see [`../CONTRIBUTING.md`](../CONTRIBUTING.md)).
