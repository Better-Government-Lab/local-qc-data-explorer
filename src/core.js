// Core logic for the standalone viewer: no DOM, no network, no dependencies.
// It mirrors data-raw/build_app_data.R and, in app.R of snap-qc-shiny, output$sankeyPlot (Error
// Pathways), output$errorDollarPlot (Error Severity) and output$pvt_table (Pivot Table), using the
// snap_qc definitions:
//   - a case is an error when AMTERR is over the review year's threshold
//   - the dollar amount is AMTERR, carried on the case's first-listed variance
//   - every recorded variance (ELEMENT1-9) is kept and labeled
// A case is identified by a number that is unique across years. (In the Shiny app's data files a
// case id repeats in every year; the Shiny app pairs it with the year.)
import { LABELS } from "./labels.js";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const label = (table, code) => (code === null ? null : table[String(code)] ?? null);

export const REQUIRED_COLUMNS = ["STATE", "STATUS", "AMTERR", "YRMONTH", "ELEMENT1", "NATURE1", "AGENCY1"];

// Columns the viewer reads from a public-layout file. Everything else is dropped while parsing.
export const USED_COLUMNS = (() => {
  const cols = ["STATE", "STATUS", "AMTERR", "YRMONTH", "ACTNTYPE"];
  for (const p of ["ELEMENT", "NATURE", "AGENCY", "VERIF", "TIMEPER"]) for (let i = 1; i <= 9; i++) cols.push(p + i);
  return cols;
})();

// Fiscal year from YRMONTH (yyyymm): October-December belong to the next fiscal year.
export function fiscalYear(yrmonth) {
  const ym = num(yrmonth);
  if (ym === null) return null;
  const year = Math.floor(ym / 100);
  return ym % 100 >= 10 ? year + 1 : year;
}

// c: the codes for one recorded variance and its case
function variance(caseId, year, c, dollars, over) {
  // Nature 97 with no cause code reads as cause 26 (no action required).
  const cause = c.cause === null && c.nature === 97 ? 26 : c.cause;
  return {
    caseId,
    year,
    state: label(LABELS.states, c.state),
    status: label(LABELS.status, c.status),
    caseType: label(LABELS.caseType, c.actionType),
    element: label(LABELS.elements, c.element),
    nature: label(LABELS.natures, c.nature),
    type: label(LABELS.causes, cause),
    responsibility: label(LABELS.responsibility, cause),
    // a variance with no verification code is shown as "Other", as in the Shiny app
    discovery: label(LABELS.verifications, c.verification) ?? "Other",
    timing: label(LABELS.timePeriods, c.timePeriod),
    dollars,
    overThreshold: over,
  };
}

// rows: objects keyed by the public-use file's column names, one row per reviewed case.
// Returns the variance rows the Sankey works from, plus counts for the status line.
export function variancesFromCaseRows(rows, thresholds = LABELS.thresholds) {
  const variances = [];
  let cases = 0;
  let unknownYear = 0;
  for (const r of rows) {
    cases++;
    const year = fiscalYear(r.YRMONTH);
    const amterr = num(r.AMTERR) ?? 0;
    const threshold = thresholds[String(year)] ?? null;
    if (threshold === null) unknownYear++;
    const over = threshold !== null && amterr > threshold;
    const state = num(r.STATE), status = num(r.STATUS), actionType = num(r.ACTNTYPE);
    let first = true;
    for (let slot = 1; slot <= 9; slot++) {
      const element = num(r["ELEMENT" + slot]);
      if (element === null) continue;
      variances.push(
        variance(cases, year, {
          state, status, actionType, element,
          nature: num(r["NATURE" + slot]), cause: num(r["AGENCY" + slot]),
          verification: num(r["VERIF" + slot]), timePeriod: num(r["TIMEPER" + slot]),
        }, first && amterr > 0 ? amterr : null, over)
      );
      first = false;
    }
  }
  return { variances, cases, unknownYear };
}

// The bundled national data: per fiscal year, parallel arrays of codes (see tools/build_inputs.R).
export function variancesFromCompact(compact) {
  const variances = [];
  const code = (x) => (x === 0 ? null : x);
  let caseId = 0;
  for (const [y, d] of Object.entries(compact)) {
    const year = Number(y);
    for (let i = 0; i < d.el.length; i++) {
      if (d.n[i] === 1) caseId++;
      variances.push(
        variance(caseId, year, {
          state: d.st[i], status: d.fs[i], actionType: code(d.at[i]), element: d.el[i], nature: d.na[i],
          cause: code(d.ca[i]), verification: code(d.ve[i]), timePeriod: code(d.tp[i]),
        }, d.d[i] > 0 ? d.d[i] : null, d.o[i] === 1)
      );
    }
  }
  return variances;
}

const DIMENSIONS = { Element: "element", Nature: "nature", Type: "type" };
export const COMBINATIONS = ["Element → Nature → Type", "Element → Nature", "Element → Type", "Nature → Type"];
export const dimsOf = (combination) => combination.split(" → ");

// Plain code-unit order, the order R's group_by gives for these labels.
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The Sankey for one set of filter settings. Settings:
//   years (array), state ("All States" or a name), status ("All" / "Overissuance" / "Underissuance"),
//   overThresholdOnly (bool), elements / natures / types (array of labels, or null for all),
//   combination (one of COMBINATIONS), mode ("count" or "dollars"), minValue (flows at or below it are hidden)
// Returns { columns: [[node names, largest flow first], ...], links: [{step, source, target, value}], rowsInView }
export function sankeyModel(variances, s) {
  const dims = dimsOf(s.combination).map((d) => DIMENSIONS[d]);
  const years = new Set(s.years.map(Number));
  const pick = (list) => (list ? new Set(list) : null);
  const elements = pick(s.elements), natures = pick(s.natures), types = pick(s.types);
  const allStates = !s.state || s.state === "All States";
  const anyStatus = !s.status || s.status === "All";

  // step -> "source\0target" -> value
  const sums = dims.slice(1).map(() => new Map());
  let rowsInView = 0;
  for (const v of variances) {
    if (!years.has(v.year)) continue;
    if (s.overThresholdOnly && !v.overThreshold) continue;
    if (!allStates && v.state !== s.state) continue;
    if (types && !types.has(v.type)) continue;
    if (elements && !elements.has(v.element)) continue;
    if (natures && !natures.has(v.nature)) continue;
    if (!anyStatus && v.status !== s.status) continue;
    rowsInView++;
    if (dims.some((d) => v[d] === null)) continue;
    const add = s.mode === "count" ? 1 : Math.abs(v.dollars ?? 0);
    for (let i = 0; i < sums.length; i++) {
      const k = v[dims[i]] + "\u0000" + v[dims[i + 1]];
      sums[i].set(k, (sums[i].get(k) ?? 0) + add);
    }
  }

  const links = [];
  sums.forEach((m, i) => {
    for (const [k, value] of m) {
      if (value > s.minValue) {
        const [source, target] = k.split("\u0000");
        links.push({ step: i + 1, source, target, value });
      }
    }
  });
  links.sort((a, b) => a.step - b.step || byName(a.source, b.source) || byName(a.target, b.target));

  // Column i holds the sources of step i+1 and the targets of step i, largest total flow first.
  // A middle column sums both sides, as the Shiny app does.
  const columns = dims.map((_, i) => {
    const flow = new Map();
    for (const l of links) {
      if (l.step === i + 1) flow.set(l.source, (flow.get(l.source) ?? 0) + l.value);
      if (l.step === i) flow.set(l.target, (flow.get(l.target) ?? 0) + l.value);
    }
    return [...flow.keys()].sort(byName).sort((a, b) => flow.get(b) - flow.get(a));
  });

  return { columns, links, rowsInView };
}

// Plotly inputs for a model: node labels, positions and colors, and link indices.
export function sankeyTrace(model, mode) {
  const n = model.columns.length;
  const xs = n === 3 ? [0.01, 0.5, 0.99] : [0.01, 0.99];
  const colors = n === 3 ? ["#d48f90", "#ab84a5", "#d8b847"] : ["#d48f90", "#d8b847"];
  const index = model.columns.map(() => new Map());
  const label = [], x = [], y = [], color = [];
  model.columns.forEach((names, c) => {
    names.forEach((name, j) => {
      index[c].set(name, label.length);
      label.push(name);
      x.push(xs[c]);
      y.push(names.length === 1 ? 0.01 : 0.01 + (0.98 * j) / (names.length - 1));
      color.push(colors[c]);
    });
  });
  const unit = mode === "count" ? "%{value:,.0f} case-errors" : "$%{value:,.0f}";
  return {
    type: "sankey",
    arrangement: "snap",
    domain: { x: [0, 1], y: [0, 1] },
    link: {
      source: model.links.map((l) => index[l.step - 1].get(l.source)),
      target: model.links.map((l) => index[l.step].get(l.target)),
      value: model.links.map((l) => l.value),
      color: "rgba(220, 220, 220, 0.8)",
      hovertemplate: `%{source.label} → %{target.label}: ${unit}<extra></extra>`,
    },
    node: { label, x, y, color, pad: 15, thickness: 15, align: "center", hovertemplate: `%{label}<br>Total: ${unit}<extra></extra>` },
  };
}

// ---------------------------------------------------------------- Error Severity
export const SEVERITY_GROUPS = { "Error Type": "type", "Error Nature": "nature", "Error Element": "element" };
export const SEVERITY_SORTS = ["Average Dollar Amount", "Number of Cases"];
export const RESPONSIBILITIES = ["All", "Client Errors", "Agency Errors", "Technical Errors"];

// Average dollar amount in error and number of cases for each error type, nature or element.
// Settings: years, state, status, overThresholdOnly as for the Sankey; responsibility (one of
// RESPONSIBILITIES); groupBy (a key of SEVERITY_GROUPS); sortBy (one of SEVERITY_SORTS).
// A case's dollar amount sits on its first-listed variance only, so each case is counted once, in the
// group of its first-listed variance. Returns { groups: [{group, avg, n}] in sort order, cases, dollars }.
export function severityModel(variances, s) {
  const dim = SEVERITY_GROUPS[s.groupBy];
  const years = new Set(s.years.map(Number));
  const allStates = !s.state || s.state === "All States";
  const anyStatus = !s.status || s.status === "All";
  const anyResponsibility = !s.responsibility || s.responsibility === "All";
  const acc = new Map(); // group -> { sum, cases }
  for (const v of variances) {
    if (!years.has(v.year)) continue;
    if (s.overThresholdOnly && !v.overThreshold) continue;
    if (!allStates && v.state !== s.state) continue;
    if (!anyStatus && v.status !== s.status) continue;
    if (!anyResponsibility && v.responsibility !== s.responsibility) continue;
    if (v.dollars === null || v[dim] === null) continue;
    let a = acc.get(v[dim]);
    if (!a) acc.set(v[dim], (a = { sum: 0, cases: new Set() }));
    if (!a.cases.has(v.caseId)) { a.cases.add(v.caseId); a.sum += v.dollars; }
  }
  const groups = [...acc].map(([group, a]) => ({ group, avg: a.sum / a.cases.size, n: a.cases.size }));
  const key = s.sortBy === "Number of Cases" ? "n" : "avg";
  // largest first; ties keep name order, as dplyr's arrange(desc()) does after a grouped summary
  groups.sort((a, b) => byName(a.group, b.group)).sort((a, b) => b[key] - a[key]);
  return { groups, cases: groups.reduce((t, g) => t + g.n, 0), dollars: [...acc.values()].reduce((t, a) => t + a.sum, 0) };
}

// Break a label into lines of at most `width` characters, at spaces.
export function wrapLabel(text, width = 25) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + " " + word).length > width) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.join("<br>");
}

// The widest a dot is drawn, in pixels.
export const MAX_DOT = 90;

// Plotly trace and layout for the first `top` groups of a severity model.
// A dot's width is 3 x the square root of its case count, as in the Shiny app, so its area is
// proportional to the number of cases. Where that would make the largest dot wider than MAX_DOT (a
// group of more than 900 cases), all dots are scaled down together. The axis labels get narrower
// lines as more groups are shown, and are turned on their side past ten groups.
export function severityPlot(model, s, top) {
  const shown = model.groups.slice(0, top);
  const axis = shown.length <= 5 ? { width: 25, size: 11, angle: 0 } : shown.length <= 10 ? { width: 16, size: 10, angle: 0 } : { width: 38, size: 10, angle: -90 };
  const labels = shown.map((g) => wrapLabel(g.group, axis.width));
  const dollars = (x) => (Math.round(x * 10) / 10).toLocaleString("en-US");
  const widths = shown.map((g) => Math.sqrt(g.n) * 3);
  const scale = Math.min(1, MAX_DOT / Math.max(...widths, 1));
  return {
    trace: {
      type: "scatter",
      mode: "markers",
      x: labels,
      y: shown.map((g) => g.avg),
      marker: { size: widths.map((w) => w * scale), color: "rgba(93, 164, 214, 0.7)", line: { width: 1, color: "rgba(50,50,50,0.3)" } },
      text: shown.map((g) => `<b>${g.group}</b><br>Avg Dollar Error: $${dollars(g.avg)}<br>Number of Cases: ${g.n.toLocaleString("en-US")}`),
      hoverinfo: "text",
    },
    layout: {
      font: { family: "Arial" },
      title: { text: `Error Severity by ${s.sortBy}`, y: 0.95, font: { family: "Arial", size: 16 } },
      xaxis: { title: { text: s.groupBy, font: { family: "Arial" }, standoff: 25 }, tickangle: axis.angle, tickfont: { family: "Arial", size: axis.size },
               type: "category", categoryorder: "array", categoryarray: labels, automargin: true },
      yaxis: { title: { text: "Average Dollar Amount in Error ($)", font: { family: "Arial" } }, tickfont: { family: "Arial" } },
      showlegend: false,
      margin: { b: 160, t: 60 },
      autosize: true,
    },
  };
}

// ---------------------------------------------------------------- Pivot Table
export const NOT_RECORDED = "(not recorded)";
export const PIVOT_FIELDS = {
  "Error Responsibility": "responsibility", "Error Type": "type", "Error Nature": "nature", "Error Element": "element",
  "Error Discovery": "discovery", "Error Timing": "timing", "Status of Error Findings": "status",
  "Case Type": "caseType", "Year": "year", "State": "state",
};
// A field's value as the pivot table shows it: text, with a missing value as its own group.
export const pivotValue = (v, field) => { const x = v[PIVOT_FIELDS[field]]; return x === null || x === undefined ? NOT_RECORDED : String(x); };

const collator = new Intl.Collator("en");
// Alphabetical, numbers in numeric order, the missing-value group last.
export function pivotOrder(a, b) {
  if (a === NOT_RECORDED || b === NOT_RECORDED) return a === b ? 0 : a === NOT_RECORDED ? 1 : -1;
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return collator.compare(a, b);
}
// The values a field takes in a data set, in display order.
export function pivotValues(variances, field) {
  const seen = new Set();
  for (const v of variances) seen.add(pivotValue(v, field));
  return [...seen].sort(pivotOrder);
}

// Unique cases by a row field and a column field.
// Settings: rows, cols (keys of PIVOT_FIELDS); overThresholdOnly; filters: { field: [values] } where a
// missing or empty list means no filter on that field.
// Totals count each case once, so a total can be less than the sum of its cells: a case with two
// variances can fall in two cells.
// Returns { rowKeys, colKeys, cell(row, col), rowTotal(row), colTotal(col), total, rowsInView }.
export function pivotModel(variances, s) {
  const filters = Object.entries(s.filters ?? {}).filter(([, list]) => list && list.length).map(([field, list]) => [field, new Set(list.map(String))]);
  const cells = new Map(), rows = new Map(), cols = new Map(), all = new Set();
  const add = (map, key, id) => { let set = map.get(key); if (!set) map.set(key, (set = new Set())); set.add(id); };
  let rowsInView = 0;
  for (const v of variances) {
    if (s.overThresholdOnly && !v.overThreshold) continue;
    if (filters.some(([field, set]) => !set.has(pivotValue(v, field)))) continue;
    rowsInView++;
    const r = pivotValue(v, s.rows), c = pivotValue(v, s.cols);
    add(cells, r + "\u0000" + c, v.caseId);
    add(rows, r, v.caseId);
    add(cols, c, v.caseId);
    all.add(v.caseId);
  }
  const size = (map, key) => map.get(key)?.size ?? 0;
  return {
    rowKeys: [...rows.keys()].sort(pivotOrder),
    colKeys: [...cols.keys()].sort(pivotOrder),
    cell: (r, c) => size(cells, r + "\u0000" + c),
    rowTotal: (r) => size(rows, r),
    colTotal: (c) => size(cols, c),
    total: all.size,
    rowsInView,
  };
}

// A pivot model as rows of values, for a CSV file or an HTML table: a header row, one row per row
// group, and a Total row. A cell with no cases is an empty string.
export function pivotTable(model, s) {
  const out = [[s.rows, ...model.colKeys, "Total"]];
  for (const r of model.rowKeys) out.push([r, ...model.colKeys.map((c) => model.cell(r, c) || ""), model.rowTotal(r)]);
  out.push(["Total", ...model.colKeys.map((c) => model.colTotal(c)), model.total]);
  return out;
}

// Rows of values as CSV text.
export function toCsv(rows) {
  const q = (x) => { const t = x === null || x === undefined ? "" : String(x); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
