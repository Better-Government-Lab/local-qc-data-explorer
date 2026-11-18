// Builds docs/index.html: one self-contained page with the libraries, labels, national public
// data, logic and page code inlined. It needs no network after it is opened, and GitHub Pages can
// serve it from the docs/ folder.
// Run from the repo root:  node build.mjs
// Optional: FEEDBACK_URL=https://... node build.mjs   adds a "send comments" link to the preview note.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const read = (p, enc = "utf8") => readFileSync(new URL(p, import.meta.url), enc);
// The modules are small and have no cycles, so bundling is: drop import lines and the export keyword.
const unmodule = (src) => src.replace(/^import [^;]*;\s*$/gm, "").replace(/^export /gm, "");
const inline = (js) => `<script>\n${js.replace(/<\/script/g, "<\\/script")}\n</script>`;

const modules = ["src/labels.js", "src/groups.js", "data/public_data.js", "src/core.js", "src/ui.js"];
const scripts = [
  inline(read("vendor/papaparse.min.js")),
  inline(read("vendor/plotly-strict.min.js")),
  inline(`(function () {\n"use strict";\n${modules.map((m) => unmodule(read(m))).join("\n")}\n})();`),
].join("\n");

const logo = "data:image/png;base64," + readFileSync(new URL("vendor/bgl_top_logo.png", import.meta.url)).toString("base64");
const feedback = process.env.FEEDBACK_URL
  ? ` Comments are welcome: <a href="${process.env.FEEDBACK_URL}" target="_blank" rel="noopener">send feedback</a>.` : "";

const html = read("src/template.html")
  .replace("<!--LOGO-->", () => logo)
  .replace("<!--FEEDBACK-->", () => feedback)  .replace("<!--SCRIPTS-->", () => scripts);
mkdirSync(new URL("docs/", import.meta.url), { recursive: true });
writeFileSync(new URL("docs/index.html", import.meta.url), html);
const kb = (n) => Math.round(n / 1024).toLocaleString("en-US") + " KB";
console.log(`docs/index.html: ${kb(Buffer.byteLength(html))} (${kb(gzipSync(html).length)} gzipped)`);
