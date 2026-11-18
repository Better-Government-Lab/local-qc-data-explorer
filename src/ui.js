// Page code for the Error Pathways view. Uses the globals Papa (Papa Parse) and Plotly.
// A file the user chooses is read with the browser's File API; nothing is sent anywhere.
import { LABELS } from "./labels.js";
import { GROUPS } from "./groups.js";
import { PUBLIC_DATA } from "../data/public_data.js";
import { variancesFromCompact, variancesFromCaseRows, sankeyModel, sankeyTrace, COMBINATIONS, dimsOf, REQUIRED_COLUMNS, USED_COLUMNS } from "./core.js";

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Math.round(n).toLocaleString("en-US");

// ---------------------------------------------------------------- multi-select with optional groups
// options: [{group, items}] or a flat array. Nothing checked means no filter (all), as in the Shiny app
// for the element / nature / type filters. onChange fires after every change.
function multiSelect(host, { options, allLabel, emptyMeansAll = true, selectedAll = false, wide = false, onChange }) {
  const groups = Array.isArray(options) && typeof options[0] === "object" && options[0] !== null && "items" in options[0]
    ? options : [{ group: null, items: options }];
  const all = groups.flatMap((g) => g.items.map(String));
  const chosen = new Set(selectedAll ? all : []);
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

  button.addEventListener("click", () => {
    const open = host.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    if (open) search.focus();
  });
  document.addEventListener("click", (e) => { if (!host.contains(e.target)) { host.classList.remove("open"); button.setAttribute("aria-expanded", "false"); } });
  host.addEventListener("keydown", (e) => { if (e.key === "Escape") { host.classList.remove("open"); button.setAttribute("aria-expanded", "false"); button.focus(); } });
  search.addEventListener("input", draw);
  list.addEventListener("change", (e) => {
    if (e.target.matches("input[type=checkbox]")) { e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value); button.textContent = summary(); onChange(); }
  });
  list.addEventListener("click", (e) => {
    const g = e.target.closest(".ms-group");
    if (!g) return;
    const items = groups[Number(g.dataset.group)].items.map(String);
    const allOn = items.every((x) => chosen.has(x));
    items.forEach((x) => (allOn ? chosen.delete(x) : chosen.add(x)));
    changed();
  });
  host.querySelector("[data-act=all]").addEventListener("click", () => { all.forEach((x) => chosen.add(x)); changed(); });
  host.querySelector("[data-act=none]").addEventListener("click", () => { chosen.clear(); changed(); });
  draw();

  return {
    // null means "no filter"
    value: () => (chosen.size === all.length || (chosen.size === 0 && emptyMeansAll) ? null : all.filter((x) => chosen.has(x))),
    values: () => all.filter((x) => chosen.has(x)),
  };
}

// ---------------------------------------------------------------- data sets
const NATIONAL = {
  national: true,
  name: "National public QC data, FY2017–FY2024",
  note: "Included with this page. Source: USDA-FNS public SNAP QC files.",
  variances: variancesFromCompact(PUBLIC_DATA),
};
let data = NATIONAL;
let controls = {};

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
  return mode() === "dollars" ? 10000 : 1000;
}
const mode = () => document.querySelector("input[name=mode]:checked").value;

function useData(d) {
  data = describe(d);
  el("dataName").textContent = data.name;
  el("dataNote").textContent = data.note;
  el("useNational").style.display = data.national ? "none" : "inline-block";
  controls.years = multiSelect(el("years"), { options: data.years, allLabel: "All years", emptyMeansAll: false, selectedAll: true, onChange: render });
  el("state").innerHTML = ["All States", ...data.states].map((s) => `<option>${esc(s)}</option>`).join("");
  if (!data.national && data.states.length === 1) el("state").value = data.states[0];
  el("minValue").value = defaultMinValue();
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

// ---------------------------------------------------------------- drawing
const HEADS = { Element: "What went wrong<br>(Error Element)", Nature: "How it happened<br>(Error Nature)", Type: "Why it happened<br>(Error Type)" };

function settings() {
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
    mode: mode(),
    minValue: Number.isFinite(min) ? min : 0,
  };
}

function render() {
  if (!controls.elements) return;
  const s = settings();
  const dims = dimsOf(s.combination);
  el("fElement").style.display = dims.includes("Element") ? "" : "none";
  el("fNature").style.display = dims.includes("Nature") ? "" : "none";
  el("fType").style.display = dims.includes("Type") ? "" : "none";
  el("minLabel").textContent = s.mode === "count" ? "Hide flows of this many occurrences or fewer:" : "Hide flows of this many dollars or less:";
  el("heads").innerHTML = dims.map((d) => `<div>${HEADS[d]}</div>`).join("");

  const model = sankeyModel(data.variances, s);
  const problem = model.rowsInView === 0 ? "No data for the current filters."
    : model.links.length === 0 ? "No flows pass the threshold. Lower the “Hide flows” value to see smaller flows." : null;
  el("message").style.display = problem ? "block" : "none";
  el("message").textContent = problem || "";
  el("chart").style.display = problem ? "none" : "block";
  el("heads").style.visibility = problem ? "hidden" : "visible";
  if (problem) { el("caption").textContent = ""; window.__view = { problem, rowsInView: model.rowsInView }; return; }

  Plotly.react("chart", [sankeyTrace(model, s.mode)], {
    autosize: true,
    margin: { t: 0, b: 50, l: 0, r: 0 },
    font: { size: 12, color: "black", family: "Arial" },
  }, { displayModeBar: false, responsive: true });

  const total = model.links.filter((l) => l.step === 1).reduce((a, l) => a + l.value, 0);
  el("caption").textContent =
    `${fmt(model.rowsInView)} case-errors match the filters. ${fmt(model.links.length)} flows are shown` +
    (s.minValue > 0 ? `; flows of ${s.mode === "count" ? fmt(s.minValue) + " occurrences or fewer" : "$" + fmt(s.minValue) + " or less"} are hidden.` : ".");
  window.__view = { rowsInView: model.rowsInView, links: model.links.length, firstColumnTotal: total, columns: model.columns.map((c) => c.length) };
}

// ---------------------------------------------------------------- start
el("combination").innerHTML = COMBINATIONS.map((c) => `<option>${c}</option>`).join("");
controls.elements = multiSelect(el("elements"), { options: GROUPS.element, allLabel: "Select All", wide: true, onChange: render });
controls.natures = multiSelect(el("natures"), { options: GROUPS.nature, allLabel: "Select All", wide: true, onChange: render });
controls.types = multiSelect(el("types"), { options: GROUPS.type, allLabel: "Select All", wide: true, onChange: render });
["combination", "status", "over", "minValue"].forEach((id) => el(id).addEventListener("input", render));
el("state").addEventListener("change", () => { el("minValue").value = defaultMinValue(); render(); });
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", () => { el("minValue").value = defaultMinValue(); render(); }));
el("file").addEventListener("change", (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; });
el("useNational").addEventListener("click", () => { el("fileError").textContent = ""; useData(NATIONAL); });
useData(NATIONAL);
