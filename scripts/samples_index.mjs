/* Seznam příkladů strojů pro webovou aplikaci (krok Projekt → Příklady strojů): samples/index.json
   = soubor, název stroje, počet zařízení a kroků. Statický server neumí vypsat složku, proto seznam.
   Desktop čte složku samples/ přímo.

   node scripts/samples_index.mjs           # přegeneruje samples/index.json
   node scripts/samples_index.mjs --check   # jen ověří, že seznam odpovídá složce (návratový kód 1 = ne) */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");
const INDEX = join(dir, "index.json");

export function samplesIndex() {
  return readdirSync(dir).filter(f => f.endsWith(".plcstudio.json")).sort().map(file => {
    const j = JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^﻿/, ""));
    const p = j.prj || j;
    return { file, name: p.meta.name || file.replace(/\.plcstudio\.json$/, ""), devices: p.devices.length, steps: p.program.seq.length };
  });
}
export const indexText = () => JSON.stringify(samplesIndex(), null, 1) + "\n";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = indexText();
  if (process.argv.includes("--check")) {
    const ok = existsSync(INDEX) && readFileSync(INDEX, "utf8") === text;
    console.log(ok ? "samples/index.json odpovídá složce" : "samples/index.json NEODPOVÍDÁ — spusť node scripts/samples_index.mjs");
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(INDEX, text);
  console.log("samples/index.json: " + JSON.parse(text).length + " příkladů");
}
