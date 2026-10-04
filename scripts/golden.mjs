#!/usr/bin/env node
/*
 * Referenční (golden) otisky výstupů generátoru — viz packages/core/src/golden.ts.
 *
 *   node scripts/golden.mjs                 porovná aktuální výstup s referencí (návrat 1 = rozdíl)
 *   node scripts/golden.mjs --write         přegeneruje referenci (jen při VĚDOMÉ změně výstupu,
 *                                           zdůvodnění do commitu)
 *   node scripts/golden.mjs --add           přidá jen NOVÉ soubory (nová platforma / styl kódu),
 *                                           existující otisky nechá beze změny
 *   node scripts/golden.mjs --dump DIR      navíc uloží plné výstupy do DIR/<projekt>/<jazyk>/…
 *                                           (pro diff dvou stavů kódu)
 *   node scripts/golden.mjs --only NAME     jen projekty, jejichž název obsahuje NAME
 *   node scripts/golden.mjs --code          jen kód (bez dokumentace s ověřením simulací; ~10 s
 *                                           místo ~6 min)
 *
 * Čte packages/core/dist — po změně jádra nejdřív build.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as G from "../packages/core/dist/golden.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const write = args.includes("--write"), dump = opt("--dump"), only = opt("--only");
const add = args.includes("--add");            // jen nové soubory do reference (staré otisky beze změny)
const codeOnly = args.includes("--code");      // bez dokumentace (rychlá kontrola kódu, ~10 s)
if (write && (codeOnly || only)) { console.error("--write zapisuje celou referenci: nekombinovat s --code / --only"); process.exit(2); }
const goldDir = join(root, "packages", "core", "test-data", "golden");
const sha = s => createHash("sha256").update(s, "utf8").digest("hex");

const projects = [];
const sdir = join(root, "samples");
for (const f of readdirSync(sdir).filter(f => f.endsWith(".plcstudio.json")).sort()) {
  const raw = JSON.parse(readFileSync(join(sdir, f), "utf8"));
  projects.push({ name: f.replace(/\.plcstudio\.json$/, ""), make: () => G.goldenProject(structuredClone(raw)) });
}
for (const [name, fn] of Object.entries(G.GOLDEN_BUILTIN)) projects.push({ name, make: () => G.goldenProject(fn()) });

let diffs = 0, files = 0;
const t0 = Date.now();
for (const p of projects) {
  if (only && !p.name.includes(only)) continue;
  const t = Date.now();
  const onFiles = dump ? (lang, fs) => {
    for (const [k, b] of Object.entries(fs)) {
      const out = join(dump, p.name, lang, k);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, b, "utf8");
    }
  } : undefined;
  const got = G.goldenSet(p.make, sha, { onFiles, docs: codeOnly ? () => false : undefined });
  const n = Object.values(got).reduce((a, m) => a + Object.keys(m).length, 0);
  files += n;
  const path = join(goldDir, p.name + ".json");
  if (add) {
    /* jen NOVÉ soubory (nová platforma, nový styl kódu) — existující otisky zůstávají beze změny */
    const want = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    let k = 0;
    for (const [l, m] of Object.entries(got)) for (const [f, e] of Object.entries(m)) {
      want[l] = want[l] || {};
      if (!want[l][f]) { want[l][f] = e; k++; }
    }
    for (const l of Object.keys(want)) want[l] = Object.fromEntries(Object.keys(want[l]).sort().map(f => [f, want[l][f]]));
    writeFileSync(path, JSON.stringify(want, null, 1) + "\n", "utf8");
    console.log(`${p.name}: ${k} nových otisků přidáno (${Date.now() - t} ms)`);
    continue;
  }
  if (write) {
    mkdirSync(goldDir, { recursive: true });
    writeFileSync(path, JSON.stringify(got, null, 1) + "\n", "utf8");
    console.log(`${p.name}: ${n} otisků zapsáno (${Date.now() - t} ms)`);
    continue;
  }
  if (!existsSync(path)) { console.log(`${p.name}: chybí reference ${path}`); diffs++; continue; }
  const d = G.goldenDiff(JSON.parse(readFileSync(path, "utf8")), got);
  diffs += d.length;
  console.log(`${p.name}: ${n} souborů, ${d.length ? d.length + " ROZDÍLŮ" : "shodné"} (${Date.now() - t} ms)`);
  for (const l of d.slice(0, 40)) console.log("  " + l);
  if (d.length > 40) console.log(`  … a dalších ${d.length - 40}`);
}
console.log(`celkem ${files} souborů, ${write ? "reference zapsána" : diffs ? diffs + " rozdílů" : "vše shodné"} (${Date.now() - t0} ms)`);
process.exit(!write && diffs ? 1 : 0);
