/** Testy přidání / parametrů / odebrání zařízení, hromadných úprav I/O a převzetí návrhu AI (edit.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncIO, devById, blankProject, type Project } from "./model.js";
import { setLang } from "./i18n.js";
import { sampleSmall } from "./samples.js";
import {
  addDevice, setDeviceParams, deviceParamsProblem, deviceUsage, deleteDevice, rangeProblem,
  parseRecordsForm, parseAxisPositionsForm, renumberIo, fixIoTags, projectIsEmpty, applyAiProposal,
  type AiProposal,
} from "./edit.js";

function small(): Project { setLang("cs"); const p = sampleSmall(); syncIO(p); return p; }
const byName = (p: Project, n: string) => p.devices.find(d => d.name === n)!;

test("addDevice: id, GUID, signály; kontrola označení, rozsahu a parametrů", () => {
  const p = small();
  const n0 = p.devices.length, next = p.nextId;
  const r = addDevice(p, { cls: "AnalogIn", name: "B3", desc: "Tlak", unit: "bar", rmin: 0, rmax: 10, limLo: 1, limHi: 9 });
  assert.equal(r.ok, true, r.error);
  const d = devById(p, r.id!)!;
  assert.equal(r.id, next);
  assert.equal(p.nextId, next + 1);
  assert.equal(p.devices.length, n0 + 1);
  assert.ok(d.guid, "GUID přidělen");
  assert.equal(d.limHi, 9);
  assert.ok(p.io.some(e => e.devId === d.id && e.dir === "AI"));
  /* chyby: projekt beze změny */
  const snap = JSON.stringify(p);
  assert.match(addDevice(p, { cls: "Motor", name: "m1" }).error!, /už má zařízení M1/);
  assert.match(addDevice(p, { cls: "Motor", name: "1M" }).error!, /identifikátor/);
  assert.match(addDevice(p, { cls: "AnalogIn", name: "B9", rmin: 10, rmax: 10 }).error!, /minimum musí být menší/);
  assert.match(addDevice(p, { cls: "AnalogIn", name: "B9", limLo: 5, limHi: 5 }).error!, /Mez min musí být menší/);
  assert.match(addDevice(p, { cls: "Vfd", name: "M9", rampS: -1 }).error!, /Rampa musí být 0/);
  assert.match(addDevice(p, { cls: "Vfd", name: "M9", rampS: 4000 }).error!, /nejvýš 3600 s/);
  assert.match(addDevice(p, { cls: "PosDrive", name: "M9", selBits: 7 }).error!, /1 až 6/);
  assert.match(addDevice(p, { cls: "PropValve", name: "Y9", tol: 0 }).error!, /musí být kladná/);
  assert.match(addDevice(p, { cls: "AnalogOut", name: "Y9", setpoint: 1e39 }).error!, /mimo rozsah REAL/);
  assert.match(addDevice(p, { cls: "Motor", name: "M9", limHi: 3 }).error!, /nemá parametr limHi/);
  assert.equal(JSON.stringify(p), snap);
  /* prázdné označení = další volné; osa bez rozsahu s jednotkou mm */
  const ra = addDevice(p, { cls: "Axis", axis: { vMax: 300 } });
  assert.equal(ra.ok, true, ra.error);
  const ax = devById(p, ra.id!)!;
  assert.equal(ax.unit, "mm"); assert.equal(ax.rmin, 0); assert.equal(ax.rmax, 0); assert.equal(ax.axis!.vMax, 300);
});

test("setDeviceParams: jen změněné klíče, druhá mez ze zařízení, null maže, bity mění signály", () => {
  const p = small();
  const b1 = byName(p, "B1");
  b1.limHi = 50;
  assert.match(setDeviceParams(p, b1.id, { limLo: 60 }).error!, /Mez min musí být menší/);
  assert.equal(b1.limLo, undefined);
  assert.equal(setDeviceParams(p, b1.id, { limLo: 10 }).ok, true);
  assert.equal(b1.limLo, 10);
  assert.equal(setDeviceParams(p, b1.id, { limHi: null }).ok, true);
  assert.equal("limHi" in b1, false);
  /* výstup DO: role */
  const h1 = byName(p, "H1");
  assert.equal(setDeviceParams(p, h1.id, { role: "run" }).ok, true);
  assert.equal(h1.role, "run");
  assert.equal(setDeviceParams(p, h1.id, { role: null }).ok, true);
  assert.equal(h1.role, undefined);
  assert.match(setDeviceParams(p, h1.id, { role: "xx" as any }).error!, /Neznámá vazba/);
  assert.match(setDeviceParams(p, h1.id, { rampS: 1 }).error!, /nemá parametr/);
  /* polohovací pohon: bity výběru záznamu = jiné signály */
  const r = addDevice(p, { cls: "PosDrive", name: "M5", selBits: 2 });
  assert.equal(r.ok, true, r.error);
  const sigs = () => p.io.filter(e => e.devId === r.id).length;
  const n2 = sigs();
  const rs = setDeviceParams(p, r.id!, { selBits: 4 });
  assert.equal(rs.ok, true, rs.error);
  assert.equal(sigs(), n2 + 2);
  assert.equal(rs.added!.length, 2);
  /* osa: sloučení, null = výchozí */
  const ra = addDevice(p, { cls: "Axis", name: "M6", axis: { vMax: 300, aMax: 1000, drive: "S210" } });
  const a = devById(p, ra.id!)!;
  assert.equal(setDeviceParams(p, a.id, { axis: { vMax: 400, aMax: null } }).ok, true);
  assert.equal(a.axis!.vMax, 400); assert.equal("aMax" in a.axis!, false); assert.equal(a.axis!.drive, "S210");
  assert.match(setDeviceParams(p, a.id, { axis: { vMax: NaN } }).error!, /Neplatné číslo/);
});

test("deviceParamsProblem a rangeProblem: meze shodné s kontrolou návrhu", () => {
  assert.equal(deviceParamsProblem({ cls: "PropValve" }, { tolTimeS: 3276.7 }), null);
  assert.match(deviceParamsProblem({ cls: "PropValve" }, { tolTimeS: 3276.8 })!, /3 276,7 s/);
  assert.match(deviceParamsProblem({ cls: "PosDrive" }, { travelS: 0 })!, /Doba jízdy/);
  assert.equal(deviceParamsProblem({ cls: "Vfd" }, { rampS: 0 }), null);
  assert.equal(rangeProblem(0, 1), null);
  assert.match(rangeProblem(0, NaN)!, /číslo/);
  assert.match(rangeProblem(-1e39, 0)!, /REAL/);
});

test("deviceUsage a deleteDevice: kroky, E-stop, blokování", () => {
  const p = small();
  const m1 = byName(p, "M1"), s1 = byName(p, "S1"), s2 = byName(p, "S2"), h1 = byName(p, "H1");
  assert.deepEqual(deviceUsage(p, m1.id), { steps: 2, estop: false, lock: false, used: true });
  assert.deepEqual(deviceUsage(p, s1.id), { steps: 0, estop: true, lock: false, used: true });
  assert.deepEqual(deviceUsage(p, s2.id), { steps: 0, estop: false, lock: true, used: true });
  assert.equal(deviceUsage(p, h1.id).used, false);
  const seq = p.program.seq.length;
  const r = deleteDevice(p, m1.id);
  assert.equal(r.ok, true);
  assert.ok(r.removed!.length > 0);
  assert.equal(p.program.seq.length, seq - 2);
  assert.ok(!p.io.some(e => e.devId === m1.id));
  deleteDevice(p, s1.id); deleteDevice(p, s2.id);
  assert.equal(p.program.estop, "");
  assert.deepEqual(p.program.interlocks, []);
  assert.equal(deleteDevice(p, 999).ok, false);
});

test("parseRecordsForm / parseAxisPositionsForm: nesrozumitelné části a duplicity hlásí", () => {
  assert.equal(parseRecordsForm("1 = a @ 0; 2 = b @ 5").error, null);
  assert.match(parseRecordsForm("1 = a; 1 = b").error!, /duplicitní: 1/);
  assert.match(parseRecordsForm("x = a").error!, /nesrozumitelné části/);
  assert.equal(parseAxisPositionsForm("a @ 1; b @ 2").positions.length, 2);
  assert.match(parseAxisPositionsForm("a @ 1; a @ 2").error!, /duplicitní/);
});

test("renumberIo a fixIoTags: počty změn", () => {
  const p = small();
  p.io[0].addr = "%I9.0";
  assert.equal(renumberIo(p).count, p.io.length);
  assert.notEqual(p.io[0].addr, "%I9.0");
  assert.equal(fixIoTags(p).count, 0);
  p.io[0].tag = "Čerpadlo chod"; p.io[1].tag = p.io[2].tag;
  const r = fixIoTags(p);
  assert.equal(r.count, 2);
  assert.equal(new Set(p.io.map(e => e.tag)).size, p.io.length);
  assert.match(p.io[0].tag, /^[A-Za-z0-9_]+$/);
});

test("projectIsEmpty", () => {
  const p = blankProject();
  assert.equal(projectIsEmpty(p), true);
  p.meta.number = "260001";                       // navržené číslo prázdný projekt nedělá neprázdným
  assert.equal(projectIsEmpty(p), true);
  p.meta.desc = "  ";
  assert.equal(projectIsEmpty(p), true);
  p.meta.name = "Lis";
  assert.equal(projectIsEmpty(p), false);
  assert.equal(projectIsEmpty(small()), false);
});

test("applyAiProposal: zachovaná zařízení si nechají pole, GUID a I/O; duplicity přejmenuje", () => {
  const p = small();
  const m1 = byName(p, "M1"), b1 = byName(p, "B1");
  m1.libType = "vlastni_motor";
  b1.limHi = 77;
  const io = p.io.find(e => e.devId === m1.id)!;
  io.addr = "%Q5.3"; io.cmt = "ručně"; io.tag = "Cerpadlo_chod";
  const guid = m1.guid, ioGuid = io.guid;
  const pr: AiProposal = {
    devices: [
      { name: "M1", cls: "Motor", desc: "Čerpadlo nové", opt: { fbk: true }, unit: "", rmin: 0, rmax: 100 },
      { name: "B1", cls: "AnalogIn", desc: "Tlak", opt: {}, unit: "bar", rmin: 0, rmax: 10 },
      { name: "m1", cls: "Motor", desc: "druhý motor", opt: {}, unit: "", rmin: 0, rmax: 100 },
      { name: "S1", cls: "DI", desc: "E-stop", opt: {}, unit: "", rmin: 0, rmax: 100 },
      { name: "S3", cls: "DI", desc: "Kryt", opt: {}, unit: "", rmin: 0, rmax: 100 },
      { name: "3x", cls: "Ventil", desc: "neplatné", opt: {}, unit: "", rmin: 0, rmax: 100 },
    ],
    estop: "S1", interlocks: ["S3", "S1", "B1"],
    seq: [
      { dev: "M1", act: "start", cond: "fbk", timeS: 3 },
      { dev: "", act: "wait", cond: "time", timeS: 2 },
      { dev: "m1", act: "start", cond: "time", timeS: 1 },
      { dev: "B1", act: "waitOn", cond: "fbk", timeS: 1 },       // čekání jen na DI → zahodit
      { dev: "XX", act: "stop", cond: "fbk", timeS: 1 },         // neznámé zařízení → zahodit
      { dev: "S3", act: "waitOn", cond: "time", timeS: 4 },
    ],
    takt: 12,
  };
  const r = applyAiProposal(p, pr);
  assert.equal(r.ok, true, r.error);
  const nm1 = byName(p, "M1");
  assert.equal(nm1.guid, guid, "GUID zachován");
  assert.equal(nm1.libType, "vlastni_motor", "pole, která AI neposlala, zůstala");
  assert.equal(nm1.desc, "Čerpadlo nové");
  assert.equal(byName(p, "B1").limHi, 77);
  const nio = p.io.find(e => e.guid === ioGuid)!;
  assert.ok(nio, "signál zachován");
  assert.equal(nio.devId, nm1.id);
  assert.equal(nio.addr, "%Q5.3"); assert.equal(nio.tag, "Cerpadlo_chod"); assert.equal(nio.cmt, "ručně");
  assert.deepEqual(r.renamed, [{ from: "m1", to: "M2" }, { from: "3x", to: "Y1" }]);
  assert.equal(new Set(p.devices.map(d => d.name.toUpperCase())).size, p.devices.length);
  assert.ok(p.devices.every(d => d.guid));
  assert.equal(p.program.estop, byName(p, "S1").id);
  assert.deepEqual(p.program.interlocks, [byName(p, "S3").id]);
  assert.deepEqual(p.program.seq.map(s => [devById(p, s.dev)?.name || "", s.act, s.cond]),
    [["M1", "start", "fbk"], ["", "wait", "time"], ["M2", "start", "time"], ["S3", "waitOn", "fbk"]]);
  assert.equal(p.meta.takt, 12);
  /* prázdný návrh = chyba, projekt beze změny */
  const snap = JSON.stringify(p);
  assert.equal(applyAiProposal(p, { devices: [] }).ok, false);
  assert.equal(JSON.stringify(p), snap);
});
