# Local QC Data Explorer (preview)

A browser-only JavaScript version of the [SNAP Quality Control Error Viewer](https://bettergovernmentlab.shinyapps.io/snap-qc-shiny/).
The whole tool is one HTML file, `docs/index.html`.

- It opens with the national public SNAP QC data for FY2017-FY2024 built in.
- A state agency can load its own CSV instead. The file is read on the user's computer and is
  never uploaded: the page carries a Content-Security-Policy that forbids all network
  connections, and the browser enforces it.

**Status.** Only the Error Pathways (Sankey) view is built. The other four tabs of the Shiny app
(Error Demographics, Error Severity, Pivot Table, Base Rates) are not.

## Definitions

These follow the Shiny app and the `snap_qc` munging script:

- A case is an error when its total error amount (`AMTERR`) is over the review year's threshold.
- The dollar amount of an error is `AMTERR`, attributed to the case's first-listed variance.
- Every recorded variance (`ELEMENT1`-`ELEMENT9`) is kept and labeled.

## Loading your own file

The file must be a CSV with one row per reviewed case, using the public QC file's column names.
Required: `STATE`, `STATUS`, `AMTERR`, `YRMONTH`, `ELEMENT1`, `NATURE1`, `AGENCY1`. Also read if
present: `ELEMENT2`-`9`, `NATURE2`-`9`, `AGENCY2`-`9`. All other columns are ignored.

Thresholds are defined for FY2017-FY2024. Cases from other years load, but are treated as under
the threshold.

## How it differs from the Shiny app's Error Pathways tab

- The "hide small flows" value starts at 0 when one state is selected or a local file is loaded.
  The Shiny app's defaults (1,000 occurrences, $10,000) are kept for the national view; applied
  to a single state they hide every flow.
- That control is labeled "Hide flows of this many or fewer". The Shiny app labels it "Filter
  flows >=" but applies the same rule (flows must be greater than the value).
- Only the filters shown for the selected pathway are applied.

## Layout

```
src/core.js          logic: public-layout rows -> variances, Sankey model, Plotly trace
src/ui.js            page code
src/template.html    page markup and styles
src/labels.js        generated: code -> label tables, yearly thresholds
src/groups.js        generated: grouped choice lists for the filters
data/public_data.js  generated: national public variances as compact code arrays
tools/build_inputs.R writes the three generated files and the test fixtures
fixtures/            what the Shiny app's Sankey logic produces for six filter settings
test/                Node tests that compare the JavaScript against those fixtures
vendor/              Plotly.js 2.35.2 (strict build), Papa Parse 5.4.1, logo
build.mjs            builds docs/index.html
docs/index.html      the built page (served by GitHub Pages)
```

## Build and test

Requires Node 20 or later.

```
npm install          # Papa Parse, for the tests only
npm test             # 8 tests
npm run build        # writes docs/index.html
```

To regenerate the labels, filter groups, national data and fixtures, you need R with `dplyr`,
`tidyr`, `haven` and `jsonlite`, a checkout of `snap-qc-shiny`, and the public
`qc_pub_fy<year>.sav` files:

```
Rscript tools/build_inputs.R <path to snap-qc-shiny> <folder with the .sav files>
```

## Data source

USDA Food and Nutrition Service, [SNAP Quality Control Data](https://www.fns.usda.gov/snap/qc/database).
