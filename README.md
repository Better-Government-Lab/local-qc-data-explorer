# Local QC Data Explorer (preview)

A browser-only JavaScript version of the [SNAP Quality Control Error Viewer](https://bettergovernmentlab.shinyapps.io/snap-qc-shiny/).
The whole tool is one HTML file, `docs/index.html`.

- It opens with the national public SNAP QC data for FY2017-FY2024 built in.
- A state agency can load its own CSV instead. The file is read on the user's computer and is
  never uploaded: the page carries a Content-Security-Policy that forbids all network
  connections, and the browser enforces it.

**Status.** Three of the Shiny app's five tabs are built: Error Pathways (Sankey), Error Severity
and Pivot Table. Error Demographics and Base Rates are not.

## Definitions

These follow the Shiny app and the `snap_qc` munging script:

- A case is an error when its total error amount (`AMTERR`) is over the review year's threshold.
- The dollar amount of an error is `AMTERR`, attributed to the case's first-listed variance.
- Every recorded variance (`ELEMENT1`-`ELEMENT9`) is kept and labeled.

## Loading your own file

The file must be a CSV with one row per reviewed case, using the public QC file's column names.
Required: `STATE`, `STATUS`, `AMTERR`, `YRMONTH`, `ELEMENT1`, `NATURE1`, `AGENCY1`. Also read if
present: `ELEMENT2`-`9`, `NATURE2`-`9`, `AGENCY2`-`9`, and, for the Pivot Table, `VERIF1`-`9`
(how the error was discovered), `TIMEPER1`-`9` (when it occurred) and `ACTNTYPE` (certification or
recertification). All other columns are ignored.

Thresholds are defined for FY2017-FY2027 (FY2025: $57, FY2026: $58, FY2027: $59, from
`snap_qc/additional_data/year_data.csv`). Cases from other years load, but are treated as under
the threshold.

A sample file is at `docs/sample/california_fy2017-2019_fy2022-2024.csv` and is linked from the
page: California's public QC cases for FY2017-2019 and FY2022-2024 (5,150 cases), with only the
columns the viewer reads.

## How it differs from the Shiny app

**Case counts across years (Error Severity and Pivot Table).** In the Shiny app's data files a
case id is the case's row number within its year's file, so the same id recurs in every year. The
Shiny app counts distinct case ids without the year. With more than one year selected, cases from
different years that share an id are counted as one. For all years and all states, over the
threshold, the Shiny pivot table's grand total is 23,096 cases; the actual number is 31,518. This
tool identifies a case by a number that is unique across years. With a single year selected the
two tools give the same numbers.

**Error Pathways**

- The "hide small flows" value starts at 0 when one state is selected or a local file is loaded.
  The Shiny app's defaults (1,000 occurrences, $10,000) are kept for the national view; applied
  to a single state they hide every flow.
- That control is labeled "Hide flows of this many or fewer". The Shiny app labels it "Filter
  flows >=" but applies the same rule (flows must be greater than the value).
- Only the filters shown for the selected pathway are applied.

**Error Severity**

- A dot's width is 3 x the square root of its case count, as in the Shiny app. Where the largest
  dot would be wider than 90 pixels (a group of more than 900 cases), all dots are scaled down
  together, so they do not cover each other in the national view.
- Axis labels get narrower lines when 10 groups are shown and are turned on their side when 20
  are shown. The Shiny app's labels overlap at those settings.
- The download holds what the chart is built from: every group under the current filters, with
  its average dollar amount and number of cases. The Shiny app's download ignores the Error
  Responsibility setting and splits each group by responsibility.

**Pivot Table**

- A missing value is its own group, "(not recorded)", shown last, and is an option in that
  field's filter. The Shiny app shows the group as "NA" and drops those rows as soon as the field
  is added to the filter list.
- Numbers have thousands separators, the header row and first column stay in view while
  scrolling, and the table can be downloaded as a CSV.
- Removing a field from "Choose filters" keeps the choices made in the other fields. The Shiny
  app resets them.

## Layout

```
src/core.js          logic: public-layout rows -> variances; Sankey, severity and pivot models; Plotly traces
src/ui.js            page code
src/template.html    page markup and styles
src/labels.js        generated: code -> label tables, yearly thresholds
src/groups.js        generated: grouped choice lists for the filters
data/public_data.js  generated: national public variances as compact code arrays
tools/build_inputs.R writes the three generated files, the sample file and the test fixtures
fixtures/            what the Shiny app's logic produces for a set of filter settings on each tab
test/                Node tests that compare the JavaScript against those fixtures
vendor/              Plotly.js 2.35.2 (strict build), Papa Parse 5.4.1, logo
build.mjs            builds docs/index.html
docs/index.html      the built page (served by GitHub Pages)
docs/sample/         generated: the downloadable California sample file
```

## Build and test

Requires Node 20 or later.

```
npm install          # Papa Parse, for the tests only
npm test             # 26 tests
npm run build        # writes docs/index.html
```

The fixtures for Error Severity and Pivot Table are computed in R with the Shiny app's steps on
the Shiny app's data files, except that a case is identified by year and case id together.

To regenerate the labels, filter groups, national data, sample file and fixtures, you need R with `dplyr`,
`tidyr`, `haven` and `jsonlite`, a checkout of `snap-qc-shiny`, and the public
`qc_pub_fy<year>.sav` files:

```
Rscript tools/build_inputs.R <path to snap-qc-shiny> <folder with the .sav files>
```

## Data source

USDA Food and Nutrition Service, [SNAP Quality Control Data](https://www.fns.usda.gov/snap/qc/database).

## License

Apache License 2.0; see `LICENSE`. The built page includes Plotly.js and Papa Parse, each under the
MIT license; their license texts are in `THIRD_PARTY_NOTICES.md`.
