#!/usr/bin/env node
/*
 * Kontrola příkladových projektů v samples/*.plcstudio.json (nebo zadaných souborů):
 * načtení, syncIO, validace, generování kódu pro všech 8 platforem, strukturní kontroly
 * kódu, dokumentace a úplné ověření simulací (běžný cyklus + matice stavů + koncept).
 *
 *   node scripts/check_samples.mjs                 všechny příklady, souhrn
 *   node scripts/check_samples.mjs soubor.json -v  jeden soubor, podrobně (nálezy, matice)
 *   node scripts/check_samples.mjs --json          souhrn jako JSON (pro testy)
 *
 * Návratový kód 1 = některý příklad má CHYBU (error): nevalidní projekt, vadný kód,
 * nedoběhnutý cyklus, nález úrovně „error" nebo buňka matice ✖. Upozornění (warn) nevadí.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const verbose = args.includes("-v"), asJson = args.includes("--json");
let files = args.filter(a => !a.startsWith("-"));
if (!files.length) {
  const dir = join(root, "samples");
  files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".plcstudio.json")).sort().map(f => join(dir, f)) : [];
}

/** Strukturní kontroly generovaného kódu jedné platformy; vrací seznam chyb. */
function codeProblems(plat, out, prj) {
  const errs = [];
  for (const [name, body] of Object.entries(out)) {
    if (!/\.(st|scl)$/.test(name)) continue;
    const code = body.replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/.*$/gm, " ");
    const count = re => (code.match(re) || []).length;
    const pairs = [[/\bIF\b/g, /\bEND_IF\b/g, "IF/END_IF"], [/\bCASE\b/g, /\bEND_CASE\b/g, "CASE/END_CASE"],
      [/\bFUNCTION_BLOCK\b/g, /\bEND_FUNCTION_BLOCK\b/g, "FUNCTION_BLOCK"]];
    for (const [a, b, what] of pairs) {
      const na = count(a), nb = count(b);          // \b nerozdělí „END_IF" — `_` je znak slova
      if (na !== nb) errs.push(`${plat}/${name}: nespárované ${what} (${na} × ${nb})`);
    }
    if (count(/\(/g) !== count(/\)/g)) errs.push(`${plat}/${name}: nespárované závorky`);
    if (/undefined|NaN|\[object Object\]/.test(body)) errs.push(`${plat}/${name}: obsahuje undefined/NaN`);
    if (/\{[a-z][A-Za-z]*\}/.test(body)) errs.push(`${plat}/${name}: nevyplněný zástupný znak`);
  }
  if (plat === "unitronics") {
    for (const n of ["Machine.st", "Tags.csv"]) if (/[^\x00-\x7F]/.test(out[n])) errs.push(`unitronics/${n}: není ASCII`);
    const tags = new Set(out["Tags.csv"].split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "")));
    const kw = new Set("IF THEN ELSE ELSIF END_IF CASE OF END_CASE AND OR NOT TRUE FALSE IN PT Q ET TO_REAL TO_INT T E".split(" "));
    const body = out["Machine.st"].replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/T#[\w.]+/g, " ");
    const und = [...new Set(body.match(/[A-Za-z_][A-Za-z0-9_]*/g))].filter(i => !kw.has(i) && !tags.has(i));
    if (und.length) errs.push(`unitronics/Machine.st: nedeklarované identifikátory ${und.slice(0, 5).join(", ")}`);
  }
  /* každý tag I/O musí být v generovaném kódu deklarovaný (soubor s tagy) */
  const all = Object.values(out).join("\n");
  const missing = prj.io.filter(e => !all.includes(e.tag)).map(e => e.tag);
  if (missing.length) errs.push(`${plat}: tagy chybí ve výstupu: ${missing.slice(0, 5).join(", ")}`);
  return errs;
}

const results = [];
let failed = false;
for (const file of files) {
  const t0 = Date.now();
  const r = { file: basename(file), name: "", devices: 0, io: 0, steps: 0, errors: [], warns: 0, infos: 0, matrix: "", cycle: null, ms: 0 };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const prj = Object.assign(core.blankProject(), raw.prj || raw);
    prj.platforms = Object.keys(core.PLAT);
    core.syncIO(prj);
    r.name = prj.meta.name; r.devices = prj.devices.length; r.io = prj.io.length; r.steps = prj.program.seq.length;
    for (const v of core.validateProject(prj)) if (v.level === "error") r.errors.push(`validace: ${v.where}: ${v.msg}`);
    for (const plat of Object.keys(core.PLAT)) r.errors.push(...codeProblems(plat, core.genFor(prj, plat), prj));
    const docs = core.allProjectFiles(prj);
    for (const f of docs) if (f.kind === "dxf" && /[^\x00-\x7F]/.test(f.body)) r.errors.push(`${f.save}: DXF není ASCII`);
    const v = core.verifyProject(prj);
    r.cycle = v.nominal ? v.nominal.cycleTime : null;
    for (const c of v.checks) {
      if (c.level === "error") r.errors.push(`ověření: ${c.title} — ${c.detail}`);
      else if (c.level === "warn") r.warns++;
      else if (c.level === "info") r.infos++;
    }
    r.matrix = `${v.matrix.total - v.matrix.failed}/${v.matrix.total}`;
    r.checks = v.checks.map(c => ({ level: c.level, title: c.title }));
    if (verbose) {
      console.log(`\n=== ${r.file}: ${prj.meta.name}`);
      for (const c of v.checks) console.log(`  ${c.level.padEnd(5)} ${c.title}`);
      console.log("  matice: " + v.matrix.cols.map(c => c.label).join(" | "));
      for (const row of v.matrix.rows) console.log("   " + row.title.slice(0, 34).padEnd(35) + v.matrix.cols.map(c => (row.cells[c.id] || { text: "?" }).text.padEnd(8)).join(""));
    }
  } catch (e) {
    r.errors.push("výjimka: " + (e && e.stack || e));
  }
  r.ms = Date.now() - t0;
  if (r.errors.length) failed = true;
  results.push(r);
}

if (asJson) console.log(JSON.stringify(results, null, 1));
else {
  console.log("soubor".padEnd(36) + "zaříz.  I/O  kroků  cyklus[s]  matice      warn  chyb   čas");
  for (const r of results) {
    console.log(r.file.slice(0, 35).padEnd(36) + String(r.devices).padStart(6) + String(r.io).padStart(5) + String(r.steps).padStart(7)
      + String(r.cycle ?? "—").padStart(11) + "  " + r.matrix.padEnd(10) + String(r.warns).padStart(5) + String(r.errors.length).padStart(6) + String(r.ms).padStart(7) + " ms");
    for (const e of r.errors.slice(0, 8)) console.log("    ✖ " + e);
  }
}
process.exit(failed ? 1 : 0);
