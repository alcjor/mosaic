# Design system

Mosaic's visual identity and the viewer's app style. This folder is the source of truth: the text, tokens and assets live here so code can use
them and tests can enforce them.

| File | What |
| --- | --- |
| `assets/` | Logos, state icons and imagery, as SVG and PNG files ready to use |
| `tokens.json` | Colours (light "Paper" and dark "Charcoal" themes), type, spacing, radii |
| `brand-book.md` | The brand book: naming, voice, colour roles, the shard motif, logo, **section 6: App** (the viewer's components and states) |
| `components/*.md` | Guidelines per component |

## How it is enforced

- `scripts/gen_tokens.py` turns `tokens.json` into `viewer/src/design/tokens.css`
  (CSS custom properties, one `.class` per type style). A test fails when the CSS
  is out of date.
- Viewer styles use tokens only: Stylelint (`viewer/.stylelintrc.json`) rejects
  hex, `rgb()`/`hsl()` and named colours, and raw lengths for spacing, radii and
  font sizes; a test rejects `var(--…)` names that are not tokens and inline
  `style=` attributes.

## Changing it

Change `tokens.json` (and any text that describes the change), then run
`uv run python scripts/gen_tokens.py`.
