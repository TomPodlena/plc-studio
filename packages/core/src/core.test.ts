/** Testy jádra — node:test, bez externích závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankProject, syncIO, autoAddr, addrFor, sanitizeTag, validateProject,
  modules, dtFor, IoEntry,
} from "./model.js";
import { genFor, genTagFile, genMainSiemens, genMainIEC } from "./codegen.js";
import { detectAndParse, buildDevicesFromTags, normAddr } from "./importers.js";
import { sheetOps, opsToDXF, opsToSVG } from "./drawing.js";
import { allProjectFiles, docFiles } from "./docs.js";
import { sampleSmall, sampleComplex } from "./samples.js";

test("syncIO přiřadí unikátní adresy a NC podle popisu", () => {
  const p = sampleSmall();
  const addrs = p.io.map(e => e.addr);
  assert.equal(new Set(addrs).size, addrs.length, "adresy musí být unikátní");
  const estop = p.io.find(e => e.tag === "S1_in")!;
  assert.equal(estop.nc, true, "E-stop (NC) má mít nc=true");
  assert.match(estop.addr, /^%I\d+\.\d+$/);
});

test("autoAddr(force) přečísluje od nuly, AI slovní adresy sudé", () => {
  const p = sampleComplex();
  autoAddr(p, true);
  const di0 = p.io.filter(e => e.dir === "DI")[0];
  assert.equal(di0.addr, "%I0.0");
  for (const e of p.io.filter(e => e.dir === "AI")) {
    const m = e.addr.match(/^%IW(\d+)$/)!;
    assert.equal((+m[1]) % 2, 0, "AI adresa sudá: " + e.addr);
  }
});

test("addrFor převádí notace platforem", () => {
  const e = { addr: "%I1.3", dir: "DI" } as IoEntry;
  assert.equal(addrFor("beckhoff", e), "%IX1.3");
  assert.equal(addrFor("mitsubishi", e), "X" + (11).toString(16).toUpperCase());
  assert.equal(addrFor("rockwell", e), "");
  const w = { addr: "%IW64", dir: "AI" } as IoEntry;
  assert.equal(addrFor("codesys", w), "%IW64");
});

test("sanitizeTag a validace chytí diakritiku a duplicity", () => {
  assert.equal(sanitizeTag("Čerpadlo 1 běh"), "Cerpadlo_1_beh");
  assert.equal(sanitizeTag("1motor"), "T_1motor");
  const p = sampleSmall();
  p.io[0].tag = p.io[1].tag; // duplicitní tag
  p.io[2].tag = "Příliš divný tag";
  const issues = validateProject(p);
  assert.ok(issues.some(i => i.level === "error" && i.msg.includes("Duplicitní tag")));
  assert.ok(issues.some(i => i.level === "warn" && i.msg.includes("diakritiku")));
});

test("Rockwell Tags.csv má povinnou hlavičku (remark + 0.3) a žádný WORD", () => {
  const p = sampleSmall();
  const f = genTagFile(p, "rockwell");
  const lines = f.body.split("\n");
  assert.match(lines[0], /^remark,"CSV-Import-Export"$/);
  assert.equal(lines[3], "0.3");
  assert.equal(lines[4], "TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES");
  assert.ok(!f.body.includes("WORD"));
  assert.ok(f.body.includes('"INT"'));
});

test("Siemens: Main obsahuje FB_Machine, instance a sekvenci; SCL AI bez NORM_X", () => {
  const p = sampleSmall();
  const files = genFor(p, "siemens");
  assert.ok(files["Gen_Main.scl"].includes('FUNCTION_BLOCK "FB_Machine"'));
  assert.ok(files["Gen_Main.scl"].includes("instM1"));
  assert.ok(files["Gen_Main.scl"].includes("CASE #seqStep OF"));
  assert.ok(!files["Gen_Library.scl"].includes("NORM_X"));
  assert.ok(files["Gen_Tags.tsv"].startsWith("Name\tData Type"));
  assert.ok(files["Gen_IO.xml"].includes('<Engineering version="V21" />'));
});

test("IEC MAIN kompletní pro všechny neSiemens platformy", () => {
  const p = sampleComplex();
  for (const plat of ["rockwell", "beckhoff", "codesys", "mitsubishi", "schneider", "omron"] as const) {
    const files = genFor(p, plat);
    const main = files["MAIN.st"];
    assert.ok(main.includes("PROGRAM MAIN"), plat);
    assert.ok(main.includes("END_PROGRAM"), plat);
    assert.ok(main.includes("instY1"), plat);
    assert.ok(files["README.txt"].length > 200, plat);
  }
});

test("import: GVL se rozparsuje a seskupí do zařízení", () => {
  const gvl = `VAR_GLOBAL
    P1_run AT %IX0.0 : BOOL; (* cerpadlo beh *)
    P1_out AT %QX0.0 : BOOL; (* cerpadlo povel *)
    T1_raw AT %IW64 : INT; (* teplota *)
END_VAR`;
  const r = detectAndParse(gvl);
  assert.equal(r.tags.length, 3);
  const b = buildDevicesFromTags(r.tags);
  assert.equal(b.devices.length, 2);
  const p1 = b.devices.find(d => d.name === "P1")!;
  assert.equal(p1.cls, "Motor");
  const t1 = b.devices.find(d => d.name === "T1")!;
  assert.equal(t1.cls, "AnalogIn");
});

test("import: prostý I/O list a normalizace adres", () => {
  const r = detectAndParse("M1_run;%I0.0;M1;Motor;beh\nM1_out;%Q0.0;M1;Motor;povel");
  assert.equal(r.tags.length, 2);
  assert.equal(normAddr("%IX2.5"), "%I2.5");
  assert.equal(normAddr("X1F"), "%I3.7");
  assert.equal(normAddr("Y0"), "%Q0.0");
});

test("výkresy: DXF validní kostra, SVG se značením a čísly vodičů", () => {
  const p = sampleComplex();
  const mods = modules(p);
  const sh = sheetOps(p, mods[0], 1, 1, mods.length, { projectName: p.meta.name, date: "1. 1. 2026" });
  const dxf = opsToDXF(sh);
  assert.ok(dxf.startsWith("0\nSECTION\n2\nENTITIES"));
  assert.ok(dxf.endsWith("0\nENDSEC\n0\nEOF"));
  assert.ok(!/[ěščřžýáíéúůťď]/i.test(dxf), "DXF bez diakritiky");
  const svg = opsToSVG(sh, "test");
  assert.ok(svg.includes("-M1"));
  assert.ok(svg.includes("-W101"));
  assert.ok(svg.includes("X1:1"));
});

test("dokumentace: 8 dokumentů + schémata + soubory platforem", () => {
  const p = sampleComplex();
  p.platforms = ["siemens", "codesys"];
  assert.equal(docFiles(p).length, 8);
  const all = allProjectFiles(p);
  assert.ok(all.some(f => f.name === "blokove_schema.svg"));
  assert.ok(all.filter(f => f.kind === "dxf").length >= 5);
  assert.ok(all.some(f => f.group.includes("CODESYS") && f.name === "GVL_IO.st"));
  assert.ok(all.some(f => f.save === "siemens_Gen_Main.scl"));
  const dup = new Set<string>();
  for (const f of all) { assert.ok(!dup.has(f.save), "duplicitní save: " + f.save); dup.add(f.save); }
});

test("dtFor: analogy INT, binární BOOL", () => {
  assert.equal(dtFor({ dir: "AI" } as IoEntry), "INT");
  assert.equal(dtFor({ dir: "DO" } as IoEntry), "BOOL");
});

test("blankProject je prázdný a konzistentní", () => {
  const p = blankProject();
  syncIO(p);
  assert.equal(p.io.length, 0);
  assert.equal(validateProject(p).length, 0);
});
