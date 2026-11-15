# Mosaic fixture sources

This branch holds fixture sources that cannot be downloaded from a stable origin. The
`main` branch never contains them: `conformance/fixtures/manifest.json` links each file
here by commit and pins it by SHA-256, and `scripts/fetch_fixtures.py` downloads it.

| File | What it is | Licence |
| --- | --- | --- |
| `netflix-titles/netflix_titles.csv` | "Netflix Movies and TV Shows", a list of titles with their cast, directors, countries and categories, published on Kaggle by Shivam Bansal (https://www.kaggle.com/datasets/shivamb/netflix-shows) | CC0 1.0, as stated by the publisher of the dataset |

The licence is the publisher's statement, not ours. If you hold rights in this data and
object to it being here, open an issue and it will be removed.
