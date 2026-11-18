// The JavaScript Sankey must reproduce what the Shiny app's logic produces from its own data files
// (fixtures/sankey_expected.json, written by tools/build_inputs.R): the same links, the same values,
// and the same node order in every column.
// Run from the repo root:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { PUBLIC_DATA } from "../data/public_data.js";
import { LABELS } from "../src/labels.js";
import { GROUPS } from "../src/groups.js";
import { variancesFromCompact, variancesFromCaseRows, sankeyModel, sankeyTrace, USED_COLUMNS } from "../src/core.js";

const root = new URL("..", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("fixtures/sankey_expected.json", root), "utf8"));
const national = variancesFromCompact(PUBLIC_DATA);
const arr = (x) => (x === null || x === undefined ? null : Array.isArray(x) ? x : [x]);

for (const [name, fx] of Object.entries(expected)) {
  test(`Sankey matches the Shiny app: ${name}`, () => {
    const s = fx.settings;
    const model = sankeyModel(national, {
      years: arr(s.years), state: s.state, status: s.status, overThresholdOnly: s.overThresholdOnly,
      elements: arr(s.elements), natures: arr(s.natures), types: arr(s.types),
      combination: s.combination, mode: s.mode, minValue: s.minValue,
    });
    assert.equal(model.links.length, fx.links.length, "number of links");
    model.links.forEach((l, i) => assert.deepEqual(l, fx.links[i], `link ${i}`));
    assert.deepEqual(model.columns, fx.columns.map((c) => arr(c) ?? []), "node order by column");
    // the Plotly trace must point every link at a node in the right column
    const t = sankeyTrace(model, s.mode);
    model.links.forEach((l, i) => {
      assert.equal(t.node.label[t.link.source[i]], l.source);
      assert.equal(t.node.label[t.link.target[i]], l.target);
    });
  });
}

test("a public-layout CSV gives the same variances as the bundled data (Michigan FY2023-24)", () => {
  const rows = [];
  Papa.parse(readFileSync(new URL("testdata/michigan_fy2023_fy2024_public_layout.csv", root), "utf8"), {
    header: true, skipEmptyLines: true,
    step: (r) => { const o = {}; for (const k of USED_COLUMNS) o[k] = r.data[k]; rows.push(o); },
  });
  const fromCsv = variancesFromCaseRows(rows);
  assert.equal(fromCsv.cases, 1854);
  assert.equal(fromCsv.unknownYear, 0);
  const key = (v) => JSON.stringify([v.year, v.element, v.nature, v.type, v.status, v.dollars, v.overThreshold]);
  const want = national.filter((v) => v.state === "Michigan" && (v.year === 2023 || v.year === 2024)).map(key).sort();
  assert.deepEqual(fromCsv.variances.map(key).sort(), want);
  const dollars24 = fromCsv.variances.filter((v) => v.year === 2024 && v.overThreshold).reduce((s, v) => s + (v.dollars ?? 0), 0);
  assert.equal(dollars24, 20922);
});

test("every label in the data appears in a filter group, and no label is shared between columns", () => {
  for (const [dim, table] of [["element", LABELS.elements], ["nature", LABELS.natures], ["type", LABELS.causes]]) {
    for (const g of GROUPS[dim]) assert.ok(Array.isArray(g.items), `${dim} group ${g.group}: items must be an array`);
    const inGroups = new Set(GROUPS[dim].flatMap((g) => g.items));
    const used = new Set(national.map((v) => v[dim]).filter((x) => x !== null));
    for (const l of used) assert.ok(inGroups.has(l), `${dim} label missing from filter groups: ${l}`);
    assert.ok(Object.keys(table).length > 0);
  }
  const sets = ["element", "nature", "type"].map((d) => new Set(national.map((v) => v[d]).filter((x) => x !== null)));
  for (const l of sets[0]) assert.ok(!sets[1].has(l) && !sets[2].has(l), `label used in two columns: ${l}`);
  for (const l of sets[1]) assert.ok(!sets[2].has(l), `label used in two columns: ${l}`);
});
