/* Seznam příkladů strojů pro webovou aplikaci (krok Projekt → Příklady strojů): samples/index.json
   = soubor, název stroje, počet zařízení a kroků. Statický server neumí vypsat složku, proto seznam.
   Desktop čte složku samples/ přímo.

   Názvy příkladů (meta.name, česky — obsah projektu se nepřekládá) jsou v seznamu zároveň popiskem UI:
   proto je skript zapíše i jako klíče překladu do apps/web/src/sample_names.js (N_), odkud je sebere
   scripts/i18n.py do katalogů. Web (steps.js) i desktop popisek přeloží přes katalog: tr(name) / _(name).

   node scripts/samples_index.mjs           # přegeneruje samples/index.json a apps/web/src/sample_names.js
   node scripts/samples_index.mjs --check   # jen ověří, že oba soubory odpovídají složce (návratový kód 1 = ne) */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "samples");
const INDEX = join(dir, "index.json");
const NAMES = join(here, "..", "apps", "web", "src", "sample_names.js");

export function samplesIndex() {
  return readdirSync(dir).filter(f => f.endsWith(".plcstudio.json")).sort().map(file => {
    const j = JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^﻿/, ""));
    const p = j.prj || j;
    return { file, name: p.meta.name || file.replace(/\.plcstudio\.json$/, ""), devices: p.devices.length, steps: p.program.seq.length };
  });
}
export const indexText = () => JSON.stringify(samplesIndex(), null, 1) + "\n";
/** Modul s názvy příkladů jako klíči překladu (jeden literál na řádek — sběr klíčů i18n.py). */
export const namesText = () => "/* GENEROVÁNO scripts/samples_index.mjs — neupravovat ručně.\n"
  + "   Názvy příkladů strojů (samples/*.plcstudio.json → meta.name) jako klíče překladu: popisek v seznamu\n"
  + "   Příklady strojů se překládá (tr(name)), obsah otevřeného projektu zůstává česky. */\n"
  + "import { N_ } from \"../../../packages/core/dist/index.js\";\n\n"
  + "export const SAMPLE_NAMES = [\n"
  + [...new Set(samplesIndex().map(s => s.name))].map(n => "  N_(" + JSON.stringify(n) + "),\n").join("")
  + "];\n";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = indexText(), names = namesText();
  if (process.argv.includes("--check")) {
    const ok = existsSync(INDEX) && readFileSync(INDEX, "utf8") === text;
    const okN = existsSync(NAMES) && readFileSync(NAMES, "utf8") === names;
    console.log(ok ? "samples/index.json odpovídá složce" : "samples/index.json NEODPOVÍDÁ — spusť node scripts/samples_index.mjs");
    console.log(okN ? "apps/web/src/sample_names.js odpovídá složce" : "apps/web/src/sample_names.js NEODPOVÍDÁ — spusť node scripts/samples_index.mjs");
    process.exit(ok && okN ? 0 : 1);
  }
  writeFileSync(INDEX, text);
  writeFileSync(NAMES, names);
  console.log("samples/index.json + apps/web/src/sample_names.js: " + JSON.parse(text).length + " příkladů");
}
