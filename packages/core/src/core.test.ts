/** Testy jádra — node:test, bez externích závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankProject, syncIO, autoAddr, addrFor, sanitizeTag, validateProject,
  modules, dtFor, ioOf, IoEntry,
} from "./model.js";
import { genFor, genTagFile, genMainSiemens, genMainIEC, seqBody, ST_MOTOR, ST_VENTIL, SCL_MOTOR, SCL_VENTIL } from "./codegen.js";
import { detectAndParse, buildDevicesFromTags, normAddr } from "./importers.js";
import { sheetOps, opsToDXF, opsToSVG, svgBlock } from "./drawing.js";
import { simulate, verifyProject, stepCondText, T_MOTOR_FBK, T_VALVE_TRAVEL } from "./sim.js";
import { svgFlow, svgTiming } from "./flow.js";
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

test("schémata nesou odkazy na zařízení, moduly a signály; DXF zůstává beze změny", () => {
  const p = sampleSmall();
  const mods = modules(p);
  const block = svgBlock(p, mods);
  assert.equal((block.match(/<line data-io=/g) || []).length, p.io.length, "každý signál má čáru s odkazem");
  for (const d of p.devices) assert.ok(block.includes('data-dev="' + d.id + '"'), "blok zařízení " + d.name);
  assert.equal((block.match(/<g data-mod=/g) || []).length, mods.length);
  assert.ok(block.includes("<title>M1 — Čerpadlo hydrauliky"), "popis v <title>");
  const sh = sheetOps(p, mods[0], 1, 1, mods.length, { projectName: "x", date: "1. 1. 2026" });
  assert.deepEqual([...new Set(sh.O.map(o => o.io).filter(Boolean))], mods[0].ch.map(e => e.key));
  assert.ok(opsToSVG(sh, "t").includes('data-io="' + mods[0].ch[0].key + '"'));
  const plain = { ...sh, O: sh.O.map(o => { const c = { ...o }; delete c.io; return c; }) };
  assert.equal(opsToDXF(sh), opsToDXF(plain), "odkazy se do DXF nepromítají");
});

test("simulace: timeouty odpovídají šablonám bloků", () => {
  assert.ok(ST_MOTOR.includes("PT := T#" + T_MOTOR_FBK + "S"));
  assert.ok(SCL_MOTOR.includes("T_FBK : Time := T#" + T_MOTOR_FBK + "S"));
  assert.ok(ST_VENTIL.includes("PT := T#" + T_VALVE_TRAVEL + "S"));
  assert.ok(SCL_VENTIL.includes("T_TRAVEL : Time := T#" + T_VALVE_TRAVEL + "S"));
});

test("simulace a generátor používají stejné podmínky přechodu kroků", () => {
  const p = sampleComplex();
  const y6 = p.devices.find(d => d.name === "Y6")!;
  p.program.seq.find(s => s.dev === y6.id)!.cond = "fbk";      // i větev „bez snímače"
  const body = seqBody(p, "codesys").split("\n");
  p.program.seq.forEach((s, i) => {
    const n = 10 + i * 10;
    const at = body.findIndex(l => l.includes(n + ": (* Krok " + (i + 1) + ":"));
    assert.ok(at >= 0, "krok " + (i + 1) + " v generovaném kódu");
    const cond = body.slice(at, at + 3).find(l => l.includes("IF "))!;
    const txt = stepCondText(p, s);
    const want = txt.startsWith("po ") ? "IF tonSeq" + n + ".Q THEN"
      : txt.startsWith("ihned") ? "IF TRUE "
      : "IF " + (txt.startsWith("NOT ") ? "NOT GVL_IO." + txt.slice(4) : "GVL_IO." + txt) + " THEN";
    assert.ok(cond.includes(want), "krok " + (i + 1) + ": „" + cond.trim() + "“ × „" + want + "“");
  });
});

test("simulace: běžný cyklus malé stanice doběhne a vypne výstupy", () => {
  const p = sampleSmall();
  const r = simulate(p);
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map(s => s.i), [0, 1, 2, 3, 4]);
  // ventil 1 s + motor 0,5 s + výdrž 5 s + doběh 0,5 s + ventil 1 s (+ scany)
  assert.ok(r.cycleTime! > 8 && r.cycleTime! < 8.3, "doba cyklu " + r.cycleTime);
  assert.deepEqual(r.outputsOn, []);
  const wait = r.steps[2];
  assert.ok(Math.abs(wait.tEnd! - wait.tStart - 5) < 0.05, "výdrž 5 s");
  const m1 = p.devices.find(d => d.name === "M1")!, out = ioOf(p, m1).outRun.key;
  const on = r.frames.filter(f => f.io[out] === true);
  assert.ok(on.length > 0 && on[0].t > r.steps[1].tStart && on[on.length - 1].t <= r.steps[3].tEnd!, "motor běží jen mezi kroky start a stop");
});

test("simulace: výpadek zpětného hlášení → porucha bloku po timeoutu, sekvence stojí", () => {
  const p = sampleSmall();
  const m1 = p.devices.find(d => d.name === "M1")!;
  const nominal = simulate(p);
  const at = nominal.steps[1].tStart;
  const r = simulate(p, { faults: [{ kind: "frozen", dev: m1.id, at }], maxTime: at + 6 });
  assert.equal(r.ok, false);
  assert.equal(r.stalledStep, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].dev, m1.id);
  assert.ok(Math.abs(r.errors[0].t - at - T_MOTOR_FBK) < 0.05, "porucha v čase " + r.errors[0].t);
  assert.equal(r.frames[r.frames.length - 1].io[ioOf(p, m1).outRun.key], false, "blok v poruše motor vypne");
  // slepený stykač při stopu: žádná porucha, sekvence jen stojí
  const at2 = nominal.steps[3].tStart;
  const r2 = simulate(p, { faults: [{ kind: "frozen", dev: m1.id, at: at2 }], maxTime: at2 + 8 });
  assert.equal(r2.errors.length, 0);
  assert.equal(r2.stalledStep, 3);
});

test("simulace: E-stop vypne výstupy do jednoho scanu a cyklus se sám neobnoví", () => {
  const p = sampleComplex();
  const r = simulate(p, { faults: [{ kind: "estop", at: 9, release: 11 }], maxTime: 15 });
  const dos = p.io.filter(e => e.dir === "DO").map(e => e.key);
  assert.ok(r.frames.some(f => f.t < 9 && dos.some(k => f.io[k] === true)), "před stiskem něco běží");
  for (const f of r.frames.filter(f => f.t > 9.02)) {
    assert.ok(dos.every(k => f.io[k] !== true), "výstup sepnutý v čase " + f.t);
    assert.equal(f.step, -1);
  }
  assert.equal(r.finished, false);
  assert.ok(r.frames.some(f => f.t >= 11 && f.enable), "po uvolnění je enable zpět");
});

test("ověření: nálezy pro složitou linku a pro krok bez potvrzení", () => {
  const p = sampleComplex();
  const v = verifyProject(p);
  assert.equal(v.ok, true, "žádná chyba úrovně error");
  assert.equal(v.checks[0].level, "ok");
  assert.ok(v.checks.some(c => c.level === "warn" && /zůstávají sepnuté/.test(c.title) && /M1_outRun/.test(c.detail)));
  assert.ok(v.checks.some(c => c.level === "ok" && /Nouzové zastavení/.test(c.title)));
  assert.ok(v.checks.filter(c => c.scenario).every(c => v.scenarios.some(s => s.id === c.scenario)), "každý nález jde přehrát");
  // Y6 nemá koncové snímače: přechod na zpětné hlášení by krok jen přeskočil
  const y6 = p.devices.find(d => d.name === "Y6")!;
  p.program.seq.find(s => s.dev === y6.id && s.act === "open")!.cond = "fbk";
  assert.ok(verifyProject(p).checks.some(c => c.level === "warn" && /nepotvrzuje/.test(c.title) && c.dev === y6.id));
  // E-stop jako spínací kontakt → upozornění; bez sekvence není co simulovat
  const q = sampleSmall();
  q.io.find(e => e.tag === "S1_in")!.nc = false;
  assert.ok(verifyProject(q).checks.some(c => /není označen jako NC/.test(c.title)));
  q.program.seq = [];
  assert.equal(verifyProject(q).nominal, null);
});

test("diagramy funkce: kroky s odkazy, časový diagram se signály", () => {
  const p = sampleSmall();
  const run = simulate(p);
  const flow = svgFlow(p, run);
  for (let i = -1; i < p.program.seq.length; i++) assert.ok(flow.includes('data-step="' + i + '"'), "krok " + i);
  assert.ok(flow.includes("Y1_fbkOpen"), "podmínka přechodu");
  assert.ok(flow.includes("cyklus " + run.cycleTime + " s"));
  const timing = svgTiming(p, run);
  assert.ok(timing.includes("M1_outRun") && timing.includes("S1_in"));
  assert.ok((timing.match(/<rect data-io=/g) || []).length >= 4, "pruhy signálů");
  const empty = blankProject();
  assert.ok(svgFlow(empty).includes("nemá automatickou sekvenci"));
});

test("dokumentace: 9 dokumentů + schémata + soubory platforem", () => {
  const p = sampleComplex();
  p.platforms = ["siemens", "codesys"];
  assert.equal(docFiles(p).length, 9);
  const all = allProjectFiles(p);
  assert.ok(all.some(f => f.name === "blokove_schema.svg"));
  assert.ok(all.some(f => f.name === "funkcni_diagram.svg") && all.some(f => f.name === "casovy_diagram.svg"));
  const ver = all.find(f => f.name === "08_overeni_simulaci.md")!;
  assert.ok(/Doba cyklu: \d/.test(ver.body) && ver.body.includes("Neověřuje"));
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
