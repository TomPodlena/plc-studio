/** Testy ručních úprav návrhu (edit.ts) — node:test, bez externích závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncIO, devById, validateProject, type Project } from "./model.js";
import { setLang, withLang, tr } from "./i18n.js";
import { sampleSmall } from "./samples.js";
import { genFor } from "./codegen.js";
import {
  renameDevice, setDeviceDesc, setDeviceOpts, setDeviceRange, updateStep, insertStep, duplicateStep,
  setIoTag, setIoAddr, setIoCmt, parseIoAddr, deviceNameProblem, stepProblem, deviceOpts,
} from "./edit.js";

const SAMPLES = new URL("../../../samples/", import.meta.url);   // dist/ → kořen repozitáře
function loadSample(name: string): Project {
  const j = JSON.parse(readFileSync(new URL(name + ".plcstudio.json", SAMPLES), "utf8"));
  const p: Project = j.prj || j;
  syncIO(p);
  return p;
}
function small(): Project { setLang("cs"); const p = sampleSmall(); syncIO(p); return p; }
const byName = (p: Project, n: string) => p.devices.find(d => d.name === n)!;
const io = (p: Project, key: string) => p.io.find(e => e.key === key)!;

test("renameDevice: výchozí tagy přejmenuje, ruční nechá, GUID / adresy / kroky zůstanou", () => {
  const p = small();
  const m1 = byName(p, "M1");
  io(p, "1:fault").tag = "Cerpadlo_porucha";                 // ručně změněný tag
  const before = p.io.filter(e => e.devId === m1.id).map(e => ({ key: e.key, guid: e.guid, addr: e.addr }));
  const steps = JSON.stringify(p.program.seq), guid = m1.guid;
  p.commissioning = { "drv:M1:dir": { result: "ok" } as any, "io:M1.fbkRunning": { result: "ok" } as any, "io:M10.x": { result: "ok" } as any };
  const r = renameDevice(p, m1.id, "P1");
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.keptTags, ["Cerpadlo_porucha"]);
  assert.equal(m1.name, "P1");
  assert.equal(m1.guid, guid);
  assert.equal(io(p, "1:fbkRunning").tag, "P1_fbkRunning");
  assert.equal(io(p, "1:outRun").tag, "P1_outRun");
  assert.equal(io(p, "1:fault").tag, "Cerpadlo_porucha");
  assert.deepEqual(p.io.filter(e => e.devId === m1.id).map(e => ({ key: e.key, guid: e.guid, addr: e.addr })), before);
  assert.equal(JSON.stringify(p.program.seq), steps);       // vazby přes id
  assert.deepEqual(Object.keys(p.commissioning!).sort(), ["drv:P1:dir", "io:M10.x", "io:P1.fbkRunning"]);
  /* syncIO po přejmenování nic nerozbije, kód používá nové jméno */
  syncIO(p);
  assert.equal(io(p, "1:fbkRunning").tag, "P1_fbkRunning");
  const main = genFor(p, "codesys")["MAIN.st"];
  assert.match(main, /instP1/);
  assert.doesNotMatch(main, /instM1\b/);
  assert.equal(validateProject(p).filter(i => i.level === "error").length, 0);
});

test("renameDevice: neplatné a duplicitní označení odmítne beze změny", () => {
  const p = small();
  const m1 = byName(p, "M1");
  const snap = JSON.stringify(p);
  for (const bad of ["y1", "Y1", "1M", "M 1", "M__1", "M1_", "Čerpadlo", "", "M".repeat(33)]) {
    const r = renameDevice(p, m1.id, bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.error, bad);
  }
  assert.equal(JSON.stringify(p), snap);
  assert.match(deviceNameProblem(p, "y1")!, /Y1/);
  assert.equal(deviceNameProblem(p, "M1", m1.id), null);       // sám sebe
  /* kolize nového výchozího tagu s ručním tagem jiného signálu */
  io(p, "2:outOpen").tag = "P1_outRun";
  const r = renameDevice(p, m1.id, "P1");
  assert.equal(r.ok, false);
  assert.match(r.error!, /P1_outRun/);
  assert.equal(m1.name, "M1");
  assert.equal(renameDevice(p, 999, "X1").ok, false);
});

test("renameDevice: klíče bezpečnostních funkcí a E-stop", () => {
  const p = small();
  const s1 = byName(p, "S1");
  p.safety = { fn: { "estop": { inputs: ["S1"] }, "guard:S1": { note: "x" }, "guard:S10": { note: "y" } }, add: [{ ref: "guard:S1", kind: "guard", inputs: ["S1", "S10"] }] } as any;
  assert.equal(renameDevice(p, s1.id, "SB1").ok, true);
  assert.deepEqual(Object.keys(p.safety!.fn!).sort(), ["estop", "guard:S10", "guard:SB1"]);
  assert.deepEqual(p.safety!.fn!.estop.inputs, ["SB1"]);
  assert.deepEqual(p.safety!.add![0], { ref: "guard:SB1", kind: "guard", inputs: ["SB1", "S10"] });
  assert.equal(p.program.estop, s1.id);
});

test("setDeviceDesc: výchozí komentáře a NC přepíše, ruční nechá (i komentář v jiném jazyce)", () => {
  const p = small();
  const m1 = byName(p, "M1");
  io(p, "1:fault").cmt = "Jistič Q1";
  /* komentář vzniklý v angličtině (jazyk UI při založení) je také výchozí */
  io(p, "1:outRun").cmt = m1.desc + " – " + withLang("en", () => tr("povel chod"));
  assert.notEqual(io(p, "1:outRun").cmt, "Čerpadlo hydrauliky – povel chod");
  const r = setDeviceDesc(p, m1.id, "Hlavní čerpadlo");
  assert.equal(r.ok, true);
  assert.equal(m1.desc, "Hlavní čerpadlo");
  assert.equal(io(p, "1:fbkRunning").cmt, "Hlavní čerpadlo – běh");
  assert.equal(io(p, "1:outRun").cmt, "Hlavní čerpadlo – povel chod");
  assert.equal(io(p, "1:fault").cmt, "Jistič Q1");
  assert.deepEqual(r.keptCmts, ["M1_fault"]);
  /* NC podle popisu: výchozí se přepne, ručně zapnuté zůstane */
  const s1 = byName(p, "S1"), s2 = byName(p, "S2");
  assert.equal(io(p, s1.id + ":in").nc, true);
  setDeviceDesc(p, s1.id, "Nouzové zastavení");
  assert.equal(io(p, s1.id + ":in").nc, false);
  assert.equal(io(p, s1.id + ":in").cmt, "Nouzové zastavení");
  io(p, s2.id + ":in").nc = true;                           // ruční NC
  setDeviceDesc(p, s2.id, "Kryt zavřen");
  assert.equal(io(p, s2.id + ":in").nc, true);
});

test("setDeviceOpts: přidání a odebrání signálu, adresy ostatních beze změny", () => {
  const p = small();
  const m1 = byName(p, "M1");
  const addrs = () => Object.fromEntries(p.io.filter(e => e.key !== "1:fault").map(e => [e.key, e.addr]));
  const before = addrs();
  const r = setDeviceOpts(p, m1.id, { fault: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.removed, ["M1_fault"]);
  assert.deepEqual(r.added, []);
  assert.equal(p.io.some(e => e.key === "1:fault"), false);
  assert.deepEqual(addrs(), before);
  /* zpětné hlášení běhu pryč → kroky M1 s přechodem na hlášení */
  const r2 = setDeviceOpts(p, m1.id, { fbk: false });
  assert.deepEqual(r2.removed, ["M1_fbkRunning"]);
  assert.deepEqual(r2.affectedSteps, [1, 3]);
  /* vrácení volby: nový signál dostane volný kanál, ostatní adresy beze změny */
  const keep = Object.fromEntries(p.io.map(e => [e.key, e.addr]));
  const r3 = setDeviceOpts(p, m1.id, { fault: true });
  assert.deepEqual(r3.added, ["M1_fault"]);
  const nf = io(p, "1:fault");
  assert.match(nf.addr, /^%I\d+\.[0-7]$/);
  assert.ok(nf.guid);
  for (const [k, a] of Object.entries(keep)) assert.equal(io(p, k).addr, a, k);
  assert.equal(new Set(p.io.map(e => e.addr)).size, p.io.length);
  assert.equal(setDeviceOpts(p, m1.id, { nesmysl: true } as any).ok, false);
});

test("deviceOpts: skutečný stav voleb = signály zařízení (zápis všech voleb nic nezmění)", () => {
  for (const name of ["11_podavaci_lisovaci_stanice_PS-11", "13_tridici_dopravnikova_linka_TD-13", "16_paletizacni_bunka_osy_PC-16", "00b_lisovaci_linka_LL-03"]) {
    const p = loadSample(name);
    const keys = JSON.stringify(p.io.map(e => e.key + e.addr));
    for (const d of p.devices) {
      const r = setDeviceOpts(p, d.id, deviceOpts(d));
      assert.equal(r.ok, true);
      assert.deepEqual([r.removed, r.added], [[], []], name + " " + d.name);
    }
    assert.equal(JSON.stringify(p.io.map(e => e.key + e.addr)), keys);
  }
});

test("setDeviceRange: jednotka a rozsah, výchozí komentář s jednotkou", () => {
  const p = small();
  const b1 = byName(p, "B1");
  const e = io(p, b1.id + ":raw");
  assert.equal(e.cmt, b1.desc + " – " + b1.unit);
  const r = setDeviceRange(p, b1.id, { unit: "MPa", rmin: 0, rmax: 25 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([b1.unit, b1.rmin, b1.rmax], ["MPa", 0, 25]);
  assert.equal(e.cmt, b1.desc + " – MPa");
  assert.equal(setDeviceRange(p, b1.id, { rmin: 30, rmax: 25 }).ok, false);
  assert.equal(setDeviceRange(p, b1.id, { rmin: NaN }).ok, false);
  assert.equal(setDeviceRange(p, byName(p, "M1").id, { unit: "x" }).ok, false);
  assert.equal(b1.rmin, 0);
});

test("kroky: úprava, vložení, duplikace a kontrola", () => {
  const p = small();
  const seq = p.program.seq;
  const n = seq.length;
  const m1 = byName(p, "M1").id, y1 = byName(p, "Y1").id, s2 = byName(p, "S2").id;
  assert.equal(updateStep(p, 1, { dev: m1, act: "start", cond: "time", timeS: 7 }).ok, true);
  assert.deepEqual(seq[1], { dev: m1, act: "start", cond: "time", timeS: 7 });
  /* výdrž se uloží bez zařízení a vždy časem */
  assert.equal(updateStep(p, 2, { dev: 0, act: "start", cond: "fbk", timeS: 2.5 }).ok, true);
  assert.deepEqual(seq[2], { dev: 0, act: "wait", cond: "time", timeS: 2.5 });
  const r = insertStep(p, 0, { dev: s2, act: "waitOn", cond: "fbk", timeS: 10 });
  assert.equal(r.index, 1);
  assert.equal(seq.length, n + 1);
  assert.equal(seq[1].act, "waitOn");
  assert.equal(insertStep(p, -1, { dev: 0, act: "wait", cond: "time", timeS: 1 }).index, 0);
  assert.equal(insertStep(p, 99, { dev: 0, act: "wait", cond: "time", timeS: 1 }).index, seq.length - 1);
  const d = duplicateStep(p, 2);
  assert.equal(d.index, 3);
  assert.deepEqual(seq[3], seq[2]);
  assert.notEqual(seq[3], seq[2]);
  /* odmítnuté: akce jiné třídy, čas, neexistující zařízení / krok */
  const snap = JSON.stringify(seq);
  for (const bad of [{ dev: m1, act: "open", cond: "fbk", timeS: 3 }, { dev: y1, act: "close", cond: "fbk", timeS: 0 },
    { dev: y1, act: "close", cond: "fbk", timeS: -1 }, { dev: y1, act: "close", cond: "fbk", timeS: 1e6 },
    { dev: 999, act: "start", cond: "fbk", timeS: 3 }, { dev: s2, act: "waitOn", cond: "time", timeS: 3 }] as any[]) {
    assert.equal(updateStep(p, 0, bad).ok, false, JSON.stringify(bad));
    assert.equal(insertStep(p, 0, bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(updateStep(p, 99, { dev: 0, act: "wait", cond: "time", timeS: 1 }).ok, false);
  assert.equal(duplicateStep(p, -1).ok, false);
  assert.equal(JSON.stringify(seq), snap);
  assert.equal(stepProblem(p, { dev: m1, act: "start", cond: "fbk", timeS: 0.5 }), null);
});

test("kroky pohonů a osy: záznam, cíl, rychlost", () => {
  const p = loadSample("11_podavaci_lisovaci_stanice_PS-11");
  const pos = p.devices.find(d => d.cls === "PosDrive")!;
  const i = p.program.seq.findIndex(s => s.dev === pos.id && s.act === "posRecord");
  assert.ok(i >= 0);
  assert.equal(updateStep(p, i, { ...p.program.seq[i], rec: 99 }).ok, false);
  assert.equal(updateStep(p, i, { ...p.program.seq[i], rec: 2 }).ok, true);
  assert.equal(p.program.seq[i].rec, 2);
  const q = loadSample("12_portalovy_manipulator_PM-12");
  const ax = q.devices.find(d => d.cls === "Axis")!;
  assert.match(stepProblem(q, { dev: ax.id, act: "moveAbs", cond: "fbk", timeS: 5 })!, /polohu/);
  assert.match(stepProblem(q, { dev: ax.id, act: "moveAbs", cond: "fbk", timeS: 5, posRef: "nikde" })!, /nikde/);
  assert.equal(stepProblem(q, { dev: ax.id, act: "moveAbs", cond: "fbk", timeS: 5, pos: 100 }), null);
  assert.ok(stepProblem(q, { dev: ax.id, act: "velocity", cond: "fbk", timeS: 5, vel: 0 }));
});

test("I/O: prázdný tag = výchozí, tag s diakritikou projde s nálezem, komentář", () => {
  const p = small();
  assert.equal(setIoTag(p, "1:outRun", "  ").value, "M1_outRun");
  const r = setIoTag(p, "1:outRun", "Čerpadlo běh");
  assert.equal(r.ok, true);
  assert.equal(io(p, "1:outRun").tag, "Čerpadlo běh");
  assert.ok(r.issues!.length > 0);
  assert.equal(setIoTag(p, "nic", "X").ok, false);
  assert.equal(setIoCmt(p, "1:outRun", "").value, "Čerpadlo hydrauliky – povel chod");
  assert.equal(setIoCmt(p, "1:outRun", "Stykač K1").value, "Stykač K1");
});

test("I/O: adresa — Siemens i notace platformy, směr, duplicita, prázdná = automaticky", () => {
  const p = small();
  const di = io(p, "1:fbkRunning"), dO = io(p, "1:outRun"), ai = p.io.find(e => e.dir === "AI")!;
  const snap = JSON.stringify(p.io);
  for (const bad of ["%Q0.5", "%I0.8", "abc", "%IW64", "Local:1:I.Data"]) {
    const r = setIoAddr(p, di.key, bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error!, /%I0\.0/);
  }
  assert.equal(setIoAddr(p, ai.key, "%I0.0").ok, false);
  assert.match(setIoAddr(p, di.key, dO.addr.replace("Q", "I").replace(/\d+\.\d$/, "0.1")).error || "", /už má signál|Adresu/);
  assert.equal(JSON.stringify(p.io), snap);
  assert.equal(setIoAddr(p, di.key, "i7.7").value, "%I7.7");      // bez % a malými písmeny
  assert.equal(setIoAddr(p, di.key, "E7.6").value, "%I7.6");      // německá notace
  assert.equal(setIoAddr(p, ai.key, "%IW96").value, "%IW96");
  assert.equal(parseIoAddr(p, "DI", "%IX3.2"), "%I3.2");           // CODESYS bitová
  p.bom = { plat: "mitsubishi" };
  assert.equal(parseIoAddr(p, "DI", "X17"), "%I1.7");               // FX5 osmičkově
  assert.equal(parseIoAddr(p, "DO", "X17"), null);
  delete p.bom;
  const r = setIoAddr(p, di.key, "");
  assert.equal(r.ok, true);
  assert.match(di.addr, /^%I\d+\.[0-7]$/);
  assert.equal(new Set(p.io.map(e => e.addr)).size, p.io.length);
});

test("úpravy bez změny nemění výstup generátoru (kontrolní: přejmenování tam a zpět)", () => {
  const p = loadSample("11_podavaci_lisovaci_stanice_PS-11");
  const ref = JSON.stringify(genFor(p, "siemens"));
  const d = p.devices[0], old = d.name;
  assert.equal(renameDevice(p, d.id, old + "X").ok, true);
  assert.notEqual(JSON.stringify(genFor(p, "siemens")), ref);
  assert.equal(renameDevice(p, d.id, old).ok, true);
  assert.equal(setDeviceDesc(p, d.id, d.desc).ok, true);
  assert.equal(JSON.stringify(genFor(p, "siemens")), ref);
  assert.equal(devById(p, d.id)!.name, old);
});
