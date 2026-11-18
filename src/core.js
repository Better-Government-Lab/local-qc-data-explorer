// Core logic for the standalone viewer: no DOM, no network, no dependencies.
// It mirrors data-raw/build_app_data.R and output$sankeyPlot in app.R of snap-qc-shiny,
// using the snap_qc definitions:
//   - a case is an error when AMTERR is over the review year's threshold
//   - the dollar amount is AMTERR, carried on the case's first-listed variance
//   - every recorded variance (ELEMENT1-9) is kept and labeled
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

function variance(year, stateCode, statusCode, elementCode, natureCode, causeCode, dollars, over) {
  // Nature 97 with no cause code reads as cause 26 (no action required).
  const cause = causeCode === null && natureCode === 97 ? 26 : causeCode;
  return {
    year,
    state: label(LABELS.states, stateCode),
    status: label(LABELS.status, statusCode),
    element: label(LABELS.elements, elementCode),
    nature: label(LABELS.natures, natureCode),
    type: label(LABELS.causes, cause),
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
    const state = num(r.STATE);
    const status = num(r.STATUS);
    let first = true;
    for (let slot = 1; slot <= 9; slot++) {
      const element = num(r["ELEMENT" + slot]);
      if (element === null) continue;
      variances.push(
        variance(year, state, status, element, num(r["NATURE" + slot]), num(r["AGENCY" + slot]),
                 first && amterr > 0 ? amterr : null, over)
      );
      first = false;
    }
  }
  return { variances, cases, unknownYear };
}

// The bundled national data: per fiscal year, parallel arrays of codes (see tools/build_inputs.R).
export function variancesFromCompact(compact) {
  const variances = [];
  for (const [y, d] of Object.entries(compact)) {
    const year = Number(y);
    for (let i = 0; i < d.el.length; i++) {
      variances.push(
        variance(year, d.st[i], d.fs[i], d.el[i], d.na[i], d.ca[i] === 0 ? null : d.ca[i],
                 d.d[i] > 0 ? d.d[i] : null, d.o[i] === 1)
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
