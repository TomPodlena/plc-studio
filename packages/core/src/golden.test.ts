/**
 * Referenční (golden) test generátoru: výstupy se musí shodovat znak po znaku s otisky
 * v `test-data/golden/*.json` (viz golden.ts). Změna výstupu jen vědomě:
 * `node scripts/golden.mjs --write` a zdůvodnění v commitu.
 *
 * Kód (genFor, 8 platforem) se kontroluje u všech příkladů ve všech jazycích. Dokumentace
 * obsahuje ověření simulací (u velkých příkladů desítky sekund na jazyk), proto ji test
 * kontroluje u příkladů do 30 zařízení ve všech jazycích, do 60 zařízení česky a u větších
 * vůbec — úplnou kontrolu dělá `node scripts/golden.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { GOLDEN_BUILTIN, goldenProject, goldenSet, goldenDiff, goldenFiles, withFixedClock, GOLDEN_TIME, type GoldenSet } from "./golden.js";
import type { Project } from "./model.js";
import { setLang } from "./i18n.js";

const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);        // dist/ → kořen repozitáře
const GOLD_DIR = new URL("../test-data/golden/", import.meta.url);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function projects(): Array<{ name: string; make: () => Project; devices: number }> {
  const out: Array<{ name: string; make: () => Project; devices: number }> = [];
  for (const f of readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".plcstudio.json")).sort()) {
    const text = readFileSync(new URL(f, SAMPLE_DIR), "utf8");
    const make = () => goldenProject(JSON.parse(text));
    out.push({ name: f.replace(/\.plcstudio\.json$/, ""), make, devices: make().devices.length });
  }
  for (const [name, fn] of Object.entries(GOLDEN_BUILTIN)) out.push({ name, make: () => goldenProject(fn()), devices: fn().devices.length });
  return out;
}

test("golden: pevný čas v testu nemění výstup jinak než datem", () => {
  const d = withFixedClock(() => [new Date().toISOString(), Date.now(), new Date(0).getTime()]);
  assert.deepEqual(d, [new Date(GOLDEN_TIME).toISOString(), GOLDEN_TIME, 0]);
  assert.notEqual(Date.now(), GOLDEN_TIME, "po skončení platí skutečný čas");
});

test("golden: výstupy generátoru = reference (kód × 8 platforem × 5 jazyků, dokumentace)", () => {
  const list = projects();
  assert.ok(list.length >= 14, "12 příkladů + 2 vestavěné ukázky");
  const t0 = Date.now();
  let files = 0;
  const all: string[] = [];
  for (const p of list) {
    const want = JSON.parse(readFileSync(new URL(p.name + ".json", GOLD_DIR), "utf8")) as GoldenSet;
    const got = goldenSet(p.make, sha, { docs: l => p.devices <= 30 || (p.devices <= 60 && l === "cs") });
    files += Object.values(got).reduce((a, m) => a + Object.keys(m).length, 0);
    all.push(...goldenDiff(want, got).map(d => p.name + " " + d));
  }
  assert.deepEqual(all.slice(0, 30), [], all.length + " rozdílů proti referenci — změna výstupu? (node scripts/golden.mjs --dump DIR pro diff)");
  assert.ok(files > 2000, "počet porovnaných souborů");
  console.log("golden: " + files + " souborů shodných (" + (Date.now() - t0) + " ms)");
});

test("golden: výstup je deterministický (dva běhy shodně)", () => {
  const p = projects().find(x => x.name === "sampleComplex")!;
  const a = withFixedClock(() => goldenFiles(p.make, "de")), b = withFixedClock(() => goldenFiles(p.make, "de"));
  setLang("cs");
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], k);
});
