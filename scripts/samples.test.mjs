/* Regresní test příkladových projektů (samples/): každý se musí vygenerovat pro všech
   8 platforem a projít ověřením simulací bez chyby.  Spuštění: node --test scripts/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("příklady v samples/: generování a ověření bez chyb", () => {
  let out;
  try {
    out = execFileSync(process.execPath, [join(here, "check_samples.mjs"), "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) {
    out = e.stdout;                                   // návratový kód 1 = některý příklad má chybu
  }
  const results = JSON.parse(out);
  assert.ok(results.length >= 12, "aspoň 12 příkladů");
  for (const r of results) {
    assert.deepEqual(r.errors, [], r.file);
    assert.ok(r.cycle > 0, r.file + ": běžný cyklus doběhne");
    const [ok, total] = r.matrix.split("/").map(Number);
    assert.equal(ok, total, r.file + ": matice stavů bez ✖");
  }
  assert.ok(results.some(r => r.devices >= 120 && r.steps >= 100), "největší příklad ~4–5× LL-03");
});

test("samples/index.json (Příklady strojů ve webu) odpovídá složce samples/", async () => {
  const { indexText } = await import("./samples_index.mjs");
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(join(here, "..", "samples", "index.json"), "utf8"), indexText(),
    "po změně příkladů spusť node scripts/samples_index.mjs");
});
