// Page code for the three views: Error Pathways, Error Severity and Pivot Table.
// Uses the globals Papa (Papa Parse) and Plotly.
// A file the user chooses is read with the browser's File API; nothing is sent anywhere.
import { LABELS } from "./labels.js";
import { GROUPS } from "./groups.js";
import { PUBLIC_DATA } from "../data/public_data.js";
import {
  variancesFromCompact, variancesFromCaseRows, sankeyModel, sankeyTrace, COMBINATIONS, dimsOf, REQUIRED_COLUMNS, USED_COLUMNS,
  severityModel, severityPlot, SEVERITY_GROUPS, SEVERITY_SORTS, RESPONSIBILITIES,
  pivotModel, pivotTable, pivotValues, PIVOT_FIELDS, toCsv,
} from "./core.js";

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const checked = (name) => document.querySelector(`input[name=${name}]:checked`).value;

// ---------------------------------------------------------------- multi-select with optional groups
// options: [{group, items}] or a flat array. With emptyMeansAll, nothing checked means no filter, as in
// the Shiny app. `selected` is the list checked at the start; selectedAll checks everything.
// onChange fires after every change.
function multiSelect(host, { options, allLabel, emptyMeansAll = true, selectedAll = false, selected = null, wide = false, onChange }) {
  const groups = Array.isArray(options) && typeof options[0] === "object" && options[0] !== null && "items" in options[0]
    ? options : [{ group: null, items: options }];
  const all = groups.flatMap((g) => g.items.map(String));
  const chosen = new Set(selectedAll ? all : (selected ?? []).map(String).filter((x) => all.includes(x)));
  host.className = "ms" + (wide ? " wide" : "");
  host.innerHTML =
    `<button type="button" class="ms-button" aria-haspopup="listbox" aria-expanded="false"></button>
     <div class="ms-panel">
       <div class="ms-tools"><input type="search" placeholder="Search" aria-label="Search options">
         <button type="button" class="btn" data-act="all">All</button><button type="button" class="btn" data-act="none">Clear</button></div>
       <div class="ms-list" role="listbox" aria-multiselectable="true"></div>
     </div>`;
  const button = host.querySelector(".ms-button"), list = host.querySelector(".ms-list"), search = host.querySelector("input");

  const summary = () => {
    if (chosen.size === 0) return emptyMeansAll ? allLabel : "None selected";
    if (chosen.size === all.length) return allLabel;
    const picked = all.filter((x) => chosen.has(x));
    return picked.length <= 2 ? picked.join(", ") : `${picked.length} selected`;
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = groups.map((g, gi) => {
      const items = g.items.map(String).filter((x) => !q || x.toLowerCase().includes(q));
      if (!items.length) return "";
      return (g.group ? `<div class="ms-group" data-group="${gi}" title="Select or clear this group">${esc(g.group)}</div>` : "") +
        items.map((x) => `<label class="ms-item"><input type="checkbox" value="${esc(x)}"${chosen.has(x) ? " checked" : ""}><span>${esc(x)}</span></label>`).join("");
    }).join("") || `<div style="color:#777;padding:6px">No matches</div>`;
    button.textContent = summary();
  };
  const changed = () => { draw(); onChange(); };

  button.onclick = () => {
    const open = host.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    if (open) search.focus();
  };
  host.onkeydown = (e) => { if (e.key === "Escape" && host.classList.contains("open")) { closeMenu(host); button.focus(); } };
  search.oninput = draw;
  list.onchange = (e) => {
    if (e.target.matches("input[type=checkbox]")) { e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value); button.textContent = summary(); onChange(); }
  };
  list.onclick = (e) => {
    const g = e.target.closest(".ms-group");
    if (!g) return;
    const items = groups[Number(g.dataset.group)].items.map(String);
    const allOn = items.every((x) => chosen.has(x));
    items.forEach((x) => (allOn ? chosen.delete(x) : chosen.add(x)));
    changed();
  };
  host.querySelector("[data-act=all]").onclick = () => { all.forEach((x) => chosen.add(x)); changed(); };
  host.querySelector("[data-act=none]").onclick = () => { chosen.clear(); changed(); };
  draw();

  return {
    // null means "no filter"
    value: () => (chosen.size === all.length || (chosen.size === 0 && emptyMeansAll) ? null : all.filter((x) => chosen.has(x))),
    values: () => all.filter((x) => chosen.has(x)),
    all,
  };
}
const closeMenu = (host) => { host.classList.remove("open"); host.querySelector(".ms-button")?.setAttribute("aria-expanded", "false"); };
// one listener for every multi-select: a click outside an open menu closes it
document.addEventListener("click", (e) => {
  document.querySelectorAll(".ms.open").forEach((host) => { if (!host.contains(e.target)) closeMenu(host); });
});

// Hand the user a file made on this page. The text never leaves the browser.
function download(name, text) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ---------------------------------------------------------------- data sets
const NATIONAL = {
  national: true,
  name: "National public QC data, FY2017–FY2024",
  note: "Included with this page. Source: USDA-FNS public SNAP QC files.",
  variances: variancesFromCompact(PUBLIC_DATA),
};
let data = NATIONAL;
let controls = {};
let tab = "pathways";
let view = {}; // what each view last drew, for its download button

function describe(d) {
  d.years = [...new Set(d.variances.map((v) => v.year))].filter((y) => y !== null).sort((a, b) => b - a);
  d.states = [...new Set(d.variances.map((v) => v.state))].filter((s) => s !== null).sort();
  return d;
}

function defaultMinValue() {
  // The Shiny app's defaults (1,000 occurrences / $10,000) suit the national totals. For one state or a
  // local file they would hide everything, so start at 0 there.
  const wholeNation = data.national && el("state").value === "All States";
  if (!wholeNation) return 0;
  return checked("mode") === "dollars" ? 10000 : 1000;
}

function useData(d) {
  data = describe(d);
  el("dataName").textContent = data.name;
  el("dataNote").textContent = data.note;
  el("useNational").style.display = data.national ? "none" : "inline-block";
  const oneState = !data.national && data.states.length === 1 ? data.states[0] : null;
  for (const [years, state] of [["years", "state"], ["sevYears", "sevState"]]) {
    controls[years] = multiSelect(el(years), { options: data.years, allLabel: "All years", emptyMeansAll: false, selectedAll: true, onChange: render });
    el(state).innerHTML = ["All States", ...data.states].map((s) => `<option>${esc(s)}</option>`).join("");
    if (oneState) el(state).value = oneState;
  }
  el("minValue").value = defaultMinValue();
  pivotChoices = {};
  drawPivotFilters();
  render();
}

// ---------------------------------------------------------------- local file
function loadFile(file) {
  el("fileError").textContent = "";
  el("dataNote").textContent = `Reading ${file.name} …`;
  const rows = [];
  let fields = null;
  const t0 = performance.now();
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    step: (r) => {
      if (!fields) fields = r.meta.fields || [];
      const o = {};
      for (const k of USED_COLUMNS) o[k] = r.data[k];
      rows.push(o);
    },
    error: (err) => { el("fileError").textContent = `Could not read the file: ${err.message}`; useData(data); },
    complete: () => {
      const missing = REQUIRED_COLUMNS.filter((c) => !(fields || []).includes(c));
      if (!rows.length || missing.length) {
        el("fileError").textContent = !rows.length ? "The file has no data rows."
          : `The file is missing required column(s): ${missing.join(", ")}. It must use the public QC file's column names, one row per reviewed case.`;
        useData(data);
        return;
      }
      const built = variancesFromCaseRows(rows);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const years = Object.keys(LABELS.thresholds);
      useData({
        national: false,
        name: file.name,
        note: `${fmt(built.cases)} cases, ${fmt(built.variances.length)} recorded variances, read in ${secs} s on this computer. Nothing was uploaded.` +
          (built.unknownYear ? ` ${fmt(built.unknownYear)} case(s) fall outside FY${years[0]}–FY${years[years.length - 1]}; no threshold is defined for them, so they are treated as under the threshold.` : ""),
        variances: built.variances,
      });
    },
  });
}

// Show a message in place of a view's output, or clear it. Returns true when there is a problem.
function report(messageId, outputId, problem) {
  el(messageId).style.display = problem ? "block" : "none";
  el(messageId).textContent = problem || "";
  el(outputId).style.display = problem ? "none" : "block";
  return Boolean(problem);
}

// ---------------------------------------------------------------- Error Pathways
const HEADS = { Element: "What went wrong<br>(Error Element)", Nature: "How it happened<br>(Error Nature)", Type: "Why it happened<br>(Error Type)" };

function pathwaySettings() {
  const combination = el("combination").value;
  const dims = dimsOf(combination);
  const min = Number(el("minValue").value);
  return {
    years: controls.years.values().map(Number),
    state: el("state").value,
    status: el("status").value,
    overThresholdOnly: el("over").checked,
    // only the filters shown for this pathway apply
    elements: dims.includes("Element") ? controls.elements.value() : null,
    natures: dims.includes("Nature") ? controls.natures.value() : null,
    types: dims.includes("Type") ? controls.types.value() : null,
    combination,
    mode: checked("mode"),
    minValue: Number.isFinite(min) ? min : 0,
  };
}

function renderPathways() {
  const s = pathwaySettings();
  const dims = dimsOf(s.combination);
  el("fElement").style.display = dims.includes("Element") ? "" : "none";
  el("fNature").style.display = dims.includes("Nature") ? "" : "none";
  el("fType").style.display = dims.includes("Type") ? "" : "none";
  el("minLabel").textContent = s.mode === "count" ? "Hide flows of this many occurrences or fewer:" : "Hide flows of this many dollars or less:";
  el("heads").innerHTML = dims.map((d) => `<div>${HEADS[d]}</div>`).join("");

  const model = sankeyModel(data.variances, s);
  const problem = model.rowsInView === 0 ? "No data for the current filters."
    : model.links.length === 0 ? "No flows pass the threshold. Lower the “Hide flows” value to see smaller flows." : null;
  el("heads").style.visibility = problem ? "hidden" : "visible";
  if (report("message", "chart", problem)) { el("caption").textContent = ""; window.__view = { tab, problem, rowsInView: model.rowsInView }; return; }

  Plotly.react("chart", [sankeyTrace(model, s.mode)], {
    autosize: true,
    margin: { t: 0, b: 50, l: 0, r: 0 },
    font: { size: 12, color: "black", family: "Arial" },
  }, { displayModeBar: false, responsive: true });

  const total = model.links.filter((l) => l.step === 1).reduce((a, l) => a + l.value, 0);
  el("caption").textContent =
    `${fmt(model.rowsInView)} case-errors match the filters. ${fmt(model.links.length)} flows are shown` +
    (s.minValue > 0 ? `; flows of ${s.mode === "count" ? fmt(s.minValue) + " occurrences or fewer" : "$" + fmt(s.minValue) + " or less"} are hidden.` : ".");
  window.__view = { tab, rowsInView: model.rowsInView, links: model.links.length, firstColumnTotal: total, columns: model.columns.map((c) => c.length) };
}

// ---------------------------------------------------------------- Error Severity
function renderSeverity() {
  const s = {
    years: controls.sevYears.values().map(Number),
    state: el("sevState").value,
    status: el("sevStatus").value,
    overThresholdOnly: el("sevOver").checked,
    responsibility: checked("sevResp"),
    groupBy: el("sevGroup").value,
    sortBy: el("sevSort").value,
  };
  const top = Number(checked("sevTop"));
  const model = severityModel(data.variances, s);
  view.severity = { model, s };
  el("sevDownload").disabled = model.groups.length === 0;
  if (report("sevMessage", "sevChart", model.groups.length ? null : "No data for the current filters.")) {
    el("sevCaption").textContent = "";
    window.__view = { tab, problem: "No data for the current filters." };
    return;
  }
  const { trace, layout } = severityPlot(model, s, top);
  Plotly.react("sevChart", [trace], layout, { displayModeBar: false, responsive: true });
  const shown = Math.min(top, model.groups.length);
  el("sevCaption").textContent =
    `${fmt(model.cases)} cases with a dollar amount in error match the filters, $${fmt(model.dollars)} in all. ` +
    `Showing ${shown} of ${model.groups.length} groups; the download has all of them.`;
  window.__view = { tab, cases: model.cases, dollars: model.dollars, groups: model.groups.length, shown: model.groups.slice(0, top) };
}

function downloadSeverity() {
  const { model, s } = view.severity;
  const rows = [[s.groupBy, "Average dollar amount in error", "Number of cases"], ...model.groups.map((g) => [g.group, Math.round(g.avg * 100) / 100, g.n])];
  download(`error_severity_${today()}.csv`, toCsv(rows));
}

// ---------------------------------------------------------------- Pivot Table
let pivotChoices = {}; // field -> values checked in its filter, kept while the field stays in the list

// One multi-select per field named in "Choose filters". All of a field's values start checked.
function drawPivotFilters() {
  const fields = controls.pvFields.values();
  for (const f of Object.keys(pivotChoices)) if (!fields.includes(f)) delete pivotChoices[f];
  const host = el("pvFilters");
  host.innerHTML = fields.map((f, i) => `<div class="field"><span class="lab">${esc(f)}</span><div id="pvFilter${i}"></div></div>`).join("");
  controls.pvFilters = {};
  fields.forEach((f, i) => {
    const options = pivotValues(data.variances, f);
    const c = multiSelect(el("pvFilter" + i), {
      options, allLabel: "All", selected: pivotChoices[f] ?? options,
      onChange: () => { pivotChoices[f] = c.values(); render(); },
    });
    controls.pvFilters[f] = c;
  });
}

// "2019–2022" for a run of years, otherwise a list; long lists become a count.
function describeChoice(field, values) {
  if (field === "Year") {
    const y = values.map(Number).sort((a, b) => a - b);
    if (y.length >= 2 && y[y.length - 1] - y[0] + 1 === y.length) return `${y[0]}–${y[y.length - 1]}`;
    return y.join(", ");
  }
  return values.length <= 3 ? values.join(", ") : `${values.length} selected`;
}

function renderPivot() {
  const filters = {}, bits = [];
  for (const [f, c] of Object.entries(controls.pvFilters)) {
    const chosen = c.value(); // null: everything, or nothing, is checked, which is no filter
    if (chosen) { filters[f] = chosen; bits.push(`${f}: ${describeChoice(f, chosen)}`); }
  }
  const s = { rows: el("pvRows").value, cols: el("pvCols").value, overThresholdOnly: el("pvOver").checked, filters };
  const model = pivotModel(data.variances, s);
  const table = pivotTable(model, s);
  view.pivot = { table, s };

  el("pvTitle").innerHTML =
    `<div class="pvt-heading">${esc(s.rows)} by ${esc(s.cols)}</div>` +
    `<div class="pvt-sub">${bits.length ? "Showing " + esc(bits.join(" • ")) + "." : "Showing all data."} Metric: Unique Cases.</div>`;
  el("pvDownload").disabled = model.total === 0;
  if (report("pvMessage", "pvWrap", model.total ? null : "No data for the current filters.")) {
    el("pvCaption").textContent = "";
    window.__view = { tab, problem: "No data for the current filters." };
    return;
  }
  const cell = (x) => (x === "" ? "" : fmt(x));
  const head = table[0], foot = table[table.length - 1], body = table.slice(1, -1);
  el("pvWrap").innerHTML =
    `<table class="pvt"><thead><tr>${head.map((h, i) => `<th scope="col"${i === head.length - 1 ? ' class="total"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1, -1).map((x) => `<td>${cell(x)}</td>`).join("")}<td class="total">${cell(r[r.length - 1])}</td></tr>`).join("")}</tbody>` +
    `<tfoot><tr><th scope="row">${esc(foot[0])}</th>${foot.slice(1).map((x) => `<td>${cell(x)}</td>`).join("")}</tr></tfoot></table>`;
  el("pvCaption").textContent = `${fmt(model.total)} cases and ${fmt(model.rowsInView)} case-errors match the filters.`;
  window.__view = { tab, total: model.total, rowsInView: model.rowsInView, rows: model.rowKeys.length, cols: model.colKeys.length, table };
}

function downloadPivot() {
  const { table, s } = view.pivot;
  download(`pivot_${slug(s.rows)}_by_${slug(s.cols)}_${today()}.csv`, toCsv(table));
}

// ---------------------------------------------------------------- tabs
const RENDER = { pathways: renderPathways, severity: renderSeverity, pivot: renderPivot };
function render() {
  if (!controls.elements || !controls.pvFilters) return; // still starting up
  RENDER[tab]();
}
function showTab(name) {
  tab = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".controls, .view").forEach((x) => { x.hidden = x.dataset.tab !== name; });
  render();
}

// ---------------------------------------------------------------- start
const options = (list, selected) => list.map((x) => `<option${x === selected ? " selected" : ""}>${esc(x)}</option>`).join("");
el("combination").innerHTML = options(COMBINATIONS);
controls.elements = multiSelect(el("elements"), { options: GROUPS.element, allLabel: "Select All", wide: true, onChange: render });
controls.natures = multiSelect(el("natures"), { options: GROUPS.nature, allLabel: "Select All", wide: true, onChange: render });
controls.types = multiSelect(el("types"), { options: GROUPS.type, allLabel: "Select All", wide: true, onChange: render });
["combination", "status", "over", "minValue"].forEach((id) => el(id).addEventListener("input", render));
el("state").addEventListener("change", () => { el("minValue").value = defaultMinValue(); render(); });
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", () => { el("minValue").value = defaultMinValue(); render(); }));

el("sevResp").innerHTML = RESPONSIBILITIES.map((r, i) => `<label><input type="radio" name="sevResp" value="${esc(r)}"${i === 0 ? " checked" : ""}> ${esc(r)}</label>`).join("");
el("sevGroup").innerHTML = options(Object.keys(SEVERITY_GROUPS));
el("sevSort").innerHTML = options(SEVERITY_SORTS);
["sevState", "sevStatus", "sevOver", "sevGroup", "sevSort"].forEach((id) => el(id).addEventListener("input", render));
document.querySelectorAll("input[name=sevResp], input[name=sevTop]").forEach((r) => r.addEventListener("change", render));
el("sevDownload").addEventListener("click", downloadSeverity);

const pivotFields = Object.keys(PIVOT_FIELDS);
controls.pvFields = multiSelect(el("pvFields"), {
  options: pivotFields, allLabel: "All fields", emptyMeansAll: false, selected: ["State", "Year"],
  onChange: () => { drawPivotFilters(); render(); },
});
el("pvRows").innerHTML = options(pivotFields, "Error Type");
el("pvCols").innerHTML = options(pivotFields, "Error Discovery");
["pvRows", "pvCols", "pvOver"].forEach((id) => el(id).addEventListener("input", render));
el("pvDownload").addEventListener("click", downloadPivot);

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
el("file").addEventListener("change", (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; });
el("useNational").addEventListener("click", () => { el("fileError").textContent = ""; useData(NATIONAL); });
useData(NATIONAL);
