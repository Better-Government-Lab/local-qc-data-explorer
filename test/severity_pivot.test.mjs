// The Error Severity and Pivot Table logic must reproduce what the Shiny app's logic produces from
// its own data files (fixtures/severity_expected.json and fixtures/pivot_expected.json, written by
// tools/build_inputs.R), with one stated difference: a case is identified by year and case id, where
// the Shiny app uses the case id alone.
// Run from the repo root:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { PUBLIC_DATA } from "../data/public_data.js";
import { LABELS } from "../src/labels.js";
import {
  variancesFromCompact, variancesFromCaseRows, severityModel, severityPlot, wrapLabel, MAX_DOT,
  pivotModel, pivotTable, pivotValues, pivotOrder, toCsv, PIVOT_FIELDS, NOT_RECORDED,
} from "../src/core.js";

const root = new URL("..", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, root), "utf8"));
const national = variancesFromCompact(PUBLIC_DATA);
const arr = (x) => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);

// ---------------------------------------------------------------- thresholds
test("thresholds run through FY2027, so a later year's file is judged against its own threshold", () => {
  assert.deepEqual(Object.keys(LABELS.thresholds).map(Number), [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
  const row = (yrmonth, amterr) => ({ STATE: 26, STATUS: 2, AMTERR: amterr, YRMONTH: yrmonth, ELEMENT1: 311, NATURE1: 35, AGENCY1: 10 });
  const over = (yrmonth, amterr) => variancesFromCaseRows([row(yrmonth, amterr)]).variances[0].overThreshold;
  // FY2025: $57. October 2024 is the first month of FY2025.
  assert.equal(over(202410, 57), false);
  assert.equal(over(202410, 58), true);
  // FY2026: $58; FY2027: $59
  assert.equal(over(202603, 58), false);
  assert.equal(over(202603, 59), true);
  assert.equal(over(202610, 59), false);
  assert.equal(over(202610, 60), true);
  // no threshold defined: counted, reported, never over
  const late = variancesFromCaseRows([row(202710, 500)]);
  assert.equal(late.unknownYear, 1);
  assert.equal(late.variances[0].overThreshold, false);
});

// ---------------------------------------------------------------- Error Severity
for (const [name, fx] of Object.entries(fixture("severity_expected.json"))) {
  test(`Error Severity matches the Shiny app's logic: ${name}`, () => {
    const s = { ...fx.settings, years: arr(fx.settings.years) };
    const model = severityModel(national, s);
    const want = arr(fx.groups);
    assert.ok(want.length > 0, "fixture has groups");
    assert.deepEqual(model.groups.map((g) => g.group), want.map((g) => g.group), "groups, in sort order");
    model.groups.forEach((g, i) => {
      assert.equal(g.n, want[i].n, `cases: ${g.group}`);
      assert.ok(Math.abs(g.avg - want[i].avg) < 1e-9 * Math.max(1, want[i].avg), `average: ${g.group}: ${g.avg} vs ${want[i].avg}`);
    });
    assert.equal(model.cases, want.reduce((t, g) => t + g.n, 0));
    // the plot shows the first N groups, in order, one marker each
    const { trace, layout } = severityPlot(model, s, 5);
    const shown = model.groups.slice(0, 5);
    assert.deepEqual(trace.x, shown.map((g) => wrapLabel(g.group)));
    assert.deepEqual(trace.y, shown.map((g) => g.avg));
    assert.equal(new Set(trace.x).size, trace.x.length, "wrapped labels are distinct");
    assert.deepEqual(layout.xaxis.categoryarray, trace.x);
  });
}

test("each case is counted once in Error Severity, in the group of its first-listed error", () => {
  const all = { years: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024], state: "All States", status: "All", overThresholdOnly: true, responsibility: "All", sortBy: "Number of Cases" };
  const overCases = new Set(national.filter((v) => v.overThreshold).map((v) => v.caseId)).size;
  for (const groupBy of ["Error Element", "Error Nature"]) assert.equal(severityModel(national, { ...all, groupBy }).cases, overCases);
  // Michigan FY2024: 123 cases over the threshold, $20,922
  const mi = severityModel(national, { ...all, years: [2024], state: "Michigan", groupBy: "Error Element" });
  assert.equal(mi.cases, 123);
  assert.equal(mi.dollars, 20922);
});

test("dot area is proportional to the number of cases, and no dot is wider than the cap", () => {
  const s = { years: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024], state: "All States", status: "All", overThresholdOnly: true, responsibility: "All", groupBy: "Error Type", sortBy: "Number of Cases" };
  // national: the largest group has thousands of cases, so the dots are scaled down together
  const big = severityModel(national, s);
  const sizes = severityPlot(big, s, 20).trace.marker.size;
  assert.ok(Math.abs(Math.max(...sizes) - MAX_DOT) < 1e-9);
  sizes.forEach((w, i) => assert.ok(Math.abs(w / sizes[0] - Math.sqrt(big.groups[i].n / big.groups[0].n)) < 1e-9));
  // one state, one year: small groups keep the Shiny app's size, 3 x sqrt(cases)
  const mi = { ...s, years: [2024], state: "Michigan" };
  const small = severityModel(national, mi);
  assert.deepEqual(severityPlot(small, mi, 5).trace.marker.size, small.groups.slice(0, 5).map((g) => Math.sqrt(g.n) * 3));
  // more groups shown: narrower label lines, then labels on their side
  assert.equal(severityPlot(big, s, 5).layout.xaxis.tickangle, 0);
  assert.equal(severityPlot(big, s, 10).layout.xaxis.tickangle, 0);
  assert.equal(severityPlot(big, s, 20).layout.xaxis.tickangle, -90);
  for (const top of [5, 10, 20]) { const x = severityPlot(big, s, top).trace.x; assert.equal(new Set(x).size, x.length); }
});

test("labels wrap at spaces into lines of at most 25 characters", () => {
  assert.equal(wrapLabel("Wages and salaries"), "Wages and salaries");
  assert.equal(wrapLabel("Reported information disregarded or not applied"), "Reported information<br>disregarded or not<br>applied");
  for (const l of Object.values(LABELS.causes)) for (const line of wrapLabel(l).split("<br>")) assert.ok(line.length <= 25 || !line.includes(" "), line);
});

// ---------------------------------------------------------------- Pivot Table
for (const [name, fx] of Object.entries(fixture("pivot_expected.json"))) {
  test(`Pivot Table matches the Shiny app's logic: ${name}`, () => {
    const s = { ...fx.settings, filters: Object.fromEntries(Object.entries(fx.settings.filters).map(([k, v]) => [k, arr(v)])) };
    const model = pivotModel(national, s);
    const cells = arr(fx.cells), rowTotals = arr(fx.rowTotals), colTotals = arr(fx.colTotals);
    assert.ok(cells.length > 0, "fixture has cells");
    assert.deepEqual([...model.rowKeys].sort(), rowTotals.map((r) => r.row).sort(), "row groups");
    assert.deepEqual([...model.colKeys].sort(), colTotals.map((c) => c.col).sort(), "column groups");
    for (const c of cells) assert.equal(model.cell(c.row, c.col), c.n, `cell ${c.row} / ${c.col}`);
    // every cell not in the fixture is empty
    const filled = model.rowKeys.reduce((t, r) => t + model.colKeys.filter((c) => model.cell(r, c) > 0).length, 0);
    assert.equal(filled, cells.length, "number of filled cells");
    for (const r of rowTotals) assert.equal(model.rowTotal(r.row), r.n, `row total ${r.row}`);
    for (const c of colTotals) assert.equal(model.colTotal(c.col), c.n, `column total ${c.col}`);
    assert.equal(model.total, fx.total, "grand total");
    // display order: sorted, the missing-value group last
    assert.deepEqual(model.rowKeys, [...model.rowKeys].sort(pivotOrder));
    if (model.rowKeys.includes(NOT_RECORDED)) assert.equal(model.rowKeys.at(-1), NOT_RECORDED);
    // the table for display and download
    const table = pivotTable(model, s);
    assert.equal(table.length, model.rowKeys.length + 2);
    assert.deepEqual(table[0], [s.rows, ...model.colKeys, "Total"]);
    assert.equal(table.at(-1).at(-1), fx.total);
  });
}

test("a case is counted once across years, and years sort as numbers", () => {
  // every case with a recorded variance, FY2017-FY2024
  const everything = pivotModel(national, { rows: "Year", cols: "Status of Error Findings", overThresholdOnly: false, filters: {} });
  assert.equal(everything.total, new Set(national.map((v) => v.caseId)).size);
  assert.deepEqual(everything.rowKeys, ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]);
  // one case falls in one year, so the year totals add up to the grand total
  assert.equal(everything.rowKeys.reduce((t, y) => t + everything.rowTotal(y), 0), everything.total);
  // an empty filter list is no filter
  const noFilter = pivotModel(national, { rows: "Year", cols: "Status of Error Findings", overThresholdOnly: false, filters: { State: [] } });
  assert.equal(noFilter.total, everything.total);
});

test("every pivot field has values, and a filter on all of a field's values changes nothing", () => {
  const base = pivotModel(national, { rows: "Error Type", cols: "Error Discovery", overThresholdOnly: true, filters: {} });
  for (const field of Object.keys(PIVOT_FIELDS)) {
    const values = pivotValues(national, field);
    assert.ok(values.length > 1, field);
    const filtered = pivotModel(national, { rows: "Error Type", cols: "Error Discovery", overThresholdOnly: true, filters: { [field]: values } });
    assert.equal(filtered.total, base.total, field);
    assert.equal(filtered.rowsInView, base.rowsInView, field);
  }
  assert.equal(pivotValues(national, "Error Timing").at(-1), NOT_RECORDED);
});

test("CSV output quotes commas and quotation marks", () => {
  assert.equal(toCsv([["a", "b,c", 'say "x"'], [1, "", null]]), 'a,"b,c","say ""x"""\r\n1,,\r\n');
});

// ---------------------------------------------------------------- local files
for (const [file, state, years] of [
  ["testdata/michigan_fy2023_fy2024_public_layout.csv", "Michigan", [2023, 2024]],
  ["docs/sample/california_fy2017-2019_fy2022-2024.csv", "California", [2017, 2018, 2019, 2022, 2023, 2024]],
]) {
  test(`a local file gives the same Error Severity and Pivot Table results as the bundled data: ${state}`, () => {
    const parsed = Papa.parse(readFileSync(new URL(file, root), "utf8"), { header: true, skipEmptyLines: true });
    const local = variancesFromCaseRows(parsed.data).variances;
    const sev = { years, state, status: "All", overThresholdOnly: true, responsibility: "All", groupBy: "Error Element", sortBy: "Number of Cases" };
    assert.deepEqual(severityModel(local, sev).groups, severityModel(national, sev).groups);
    for (const [rows, cols] of [["Error Type", "Error Discovery"], ["Error Timing", "Case Type"], ["Error Responsibility", "Year"]]) {
      const s = { rows, cols, overThresholdOnly: false, filters: {} };
      const a = pivotModel(local, s);
      const b = pivotModel(national, { ...s, filters: { State: [state], Year: years.map(String) } });
      assert.deepEqual(pivotTable(a, s), pivotTable(b, s), `${rows} by ${cols}`);
    }
  });
}
