/** Testy firemní knihovny (library.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleSmall } from "./samples.js";
import { buildBom } from "./bom.js";
import { ST_MOTOR, ST_VENTIL, SCL_MOTOR } from "./codegen.js";
import { blankProject, validateProject } from "./model.js";
import {
  CompanyLibrary, LibFbTemplate, blankLibrary, exportLibrary, importLibrary, validateLibrary, validateFbTemplate,
  fbInterface, builtinTemplate, FB_CLASSES, libraryOverrides, attachLibrary, addLibraryDevice, libStepTime,
  libraryDocHeader, libraryApprovers, LIBRARY_SCHEMA,
} from "./library.js";

const MY_MOTOR = ST_MOTOR.replace("T#3S", "T#5S").replace("(* Sablona: motor", "(* ACME firemni blok: motor");

function lib(): CompanyLibrary {
  return {
    ...blankLibrary("ACME standard"),
    version: "2.1.0",
    company: { name: "ACME Automation s.r.o.", logoText: "ACME", address: "Brno", approvers: [{ name: "Ing. Novák", role: "vedoucí elektro" }], codeHeader: ["(c) ACME 2026"] },
    deviceTypes: [{
      id: "PumpVfd", label: "Čerpadlo s měničem", cls: "Motor", prefix: "P", desc: "Oběhové čerpadlo", opt: { fbk: true, fault: true }, stepTimeS: 8,
      bom: [
        { cat: "pump", brand: "Grundfos", type: "CR 5-4", orderCode: "96516000" },
        { cat: "vfd", tagPrefix: "-U", brand: "Danfoss", type: "FC 51 0,75 kW", orderCode: "132F0018" },
      ],
    }, {
      id: "TempPt100", label: "Teplota Pt100", cls: "AnalogIn", unit: "°C", rmin: 0, rmax: 150, limHi: 95,
    }],
    fbTemplates: [{ id: "AcmeMotor", cls: "Motor", dialect: "st", source: MY_MOTOR }],
    platformDefaults: { platforms: ["codesys"], bomPlat: "codesys", sim: { motorDelay: 2 } },
  };
}

test("vestavěné šablony projdou validací vlastní šablony (vzor je konzistentní)", () => {
  for (const cls of FB_CLASSES) for (const dialect of ["st", "scl"] as const) {
    const errs = validateFbTemplate({ id: "X", cls, dialect, source: builtinTemplate(cls, dialect) }).filter(i => i.level === "error");
    assert.deepEqual(errs, [], cls + "/" + dialect);
  }
  const st = fbInterface(ST_MOTOR), scl = fbInterface(SCL_MOTOR);
  assert.equal(st.name, "FB_Motor");
  assert.deepEqual(st.inputs.map(p => p.name), scl.inputs.map(p => p.name));
  assert.ok(st.inputs.some(p => p.name === "fbkRunning" && p.type === "BOOL"));
});

test("knihovna: export → import beze změny", () => {
  const a = lib();
  const txt = exportLibrary(a, "2026-10-04");
  const { lib: b, issues } = importLibrary(txt);
  assert.ok(b);
  assert.deepEqual(issues.filter(i => i.level === "error"), []);
  assert.equal(exportLibrary(b!, "2026-10-04"), txt, "druhý export shodný");
  assert.equal(b!.schema, LIBRARY_SCHEMA);
  assert.deepEqual(b!.deviceTypes, a.deviceTypes);
  assert.equal(b!.fbTemplates![0].source, MY_MOTOR);
  /* BOM na začátku souboru nevadí */
  assert.ok(importLibrary("﻿" + txt).lib);
});

test("knihovna: chyby validace", () => {
  assert.equal(importLibrary("{nope").lib, null);
  assert.equal(importLibrary(JSON.stringify({ format: "jiny" })).lib, null);
  const newer = importLibrary(JSON.stringify({ ...lib(), schema: LIBRARY_SCHEMA + 1 }));
  assert.equal(newer.lib, null);
  assert.ok(newer.issues.some(i => i.level === "error" && /novější/.test(i.msg)));

  const bad = lib();
  bad.version = "v2";
  bad.deviceTypes!.push(
    { id: "pumpvfd", label: "dup", cls: "Motor" },
    { id: "2bad", label: "x", cls: "Ventil", opt: { fbk: true }, prefix: "Č" },
    { id: "Ai", label: "x", cls: "AnalogIn", rmin: 10, rmax: 5, limLo: 9, limHi: 1 },
    { id: "Lamp", label: "x", cls: "DI", role: "run" },
  );
  bad.company!.approvers!.push({ name: "" });
  const errs = validateLibrary(bad).filter(i => i.level === "error").map(i => i.where + ": " + i.msg);
  const has = (re: RegExp) => assert.ok(errs.some(e => re.test(e)), "chybí chyba " + re + "\n" + errs.join("\n"));
  has(/PUMPVFD: Duplicitní/);
  has(/typ 2bad: Identifikátor/);
  has(/typ 2bad: Volba fbk/);
  has(/typ 2bad: Předpona/);
  has(/typ Ai: Rozsah/);
  has(/typ Ai: Mez min/);
  has(/typ Lamp: Role/);
  has(/Schvalovatel 2/);
  assert.ok(validateLibrary(bad).some(i => i.level === "warn" && /1\.2\.3/.test(i.msg)), "verze ne semver = varování");
  assert.deepEqual(validateLibrary(lib()).filter(i => i.level === "error"), [], "vzorová knihovna bez chyb");
});

test("šablona FB: jiné rozhraní nebo jméno = error, ST jen ASCII", () => {
  const err = (t: Partial<LibFbTemplate>) => validateFbTemplate({ id: "T", cls: "Motor", dialect: "st", source: MY_MOTOR, ...t })
    .filter(i => i.level === "error").map(i => i.msg).join("\n");
  assert.equal(err({}), "");
  assert.match(err({ source: MY_MOTOR.replace("    fault : BOOL;\n", "") }), /Chybí vstup fault/);
  assert.match(err({ source: MY_MOTOR.replace("    busy : BOOL;", "    busy : BOOL;\n    extra : BOOL;") }), /výstup extra/);
  assert.match(err({ source: MY_MOTOR.replace("status : WORD;", "status : INT;") }), /status má typ INT/);
  assert.match(err({ source: MY_MOTOR.replace("FUNCTION_BLOCK FB_Motor", "FUNCTION_BLOCK FB_Pump") }), /FB_Motor/);
  assert.match(err({ source: MY_MOTOR.replace("statStep : INT;", "statStep : INT;\n    počet : INT;") }), /ASCII/);
  assert.equal(err({ source: MY_MOTOR.replace("Porucha", "Porucha čerpadla") }), "", "diakritika jen v komentáři = varování");
  assert.match(err({ source: MY_MOTOR.replace("END_CASE;", "") }), /CASE/);
  assert.match(err({ cls: "Ventil" }), /FB_Ventil/);
  assert.match(err({ platforms: ["siemens"] }), /dialekt scl/);
  /* SCL smí diakritiku */
  assert.equal(validateFbTemplate({ id: "S", cls: "Motor", dialect: "scl", source: SCL_MOTOR.replace("T#3S", "T#4S") }).filter(i => i.level === "error").length, 0);
  /* dvě šablony do stejného místa */
  const l = lib();
  l.fbTemplates!.push({ id: "Other", cls: "Motor", dialect: "st", source: MY_MOTOR });
  assert.ok(validateLibrary(l).some(i => i.level === "error" && /dvě šablony/.test(i.msg)));
});

test("libraryOverrides: šablona pro dialekt platformy, chybná se nepoužije, hlavička ASCII", () => {
  const p = sampleSmall();
  assert.deepEqual(libraryOverrides(p, "codesys").templates, {}, "bez knihovny nic");
  attachLibrary(p, lib(), false);
  const o = libraryOverrides(p, "codesys");
  assert.equal(o.templates.Motor, MY_MOTOR);
  assert.equal(o.templates.Ventil, undefined);
  assert.ok(o.header.every(l => /^[\x00-\x7F]*$/.test(l)), "ST hlavička ASCII");
  assert.ok(o.header.some(l => /ACME Automation/.test(l)));
  assert.ok(o.header.every(l => !/\(\*|\*\)/.test(l)));
  assert.equal(libraryOverrides(p, "siemens").templates.Motor, undefined, "ST šablona se na SCL nepoužije");
  /* šablona přesně pro platformu má přednost */
  const spec = ST_MOTOR.replace("T#3S", "T#7S");
  p.library!.fbTemplates!.push({ id: "Beck", cls: "Motor", dialect: "st", platforms: ["beckhoff"], source: spec });
  assert.equal(libraryOverrides(p, "beckhoff").templates.Motor, spec);
  assert.equal(libraryOverrides(p, "codesys").templates.Motor, MY_MOTOR);
  /* chybná šablona se vynechá a nahlásí */
  p.library!.fbTemplates!.push({ id: "BadV", cls: "Ventil", dialect: "st", source: ST_VENTIL.replace("cmdClose : BOOL;", "") });
  const o2 = libraryOverrides(p, "codesys");
  assert.equal(o2.templates.Ventil, undefined);
  assert.ok(o2.issues.some(i => i.level === "error" && /cmdClose/.test(i.msg)));
});

test("vlastní typ zařízení v projektu: zařízení, I/O, kusovník, časy, výchozí volby", () => {
  const p = blankProject();
  attachLibrary(p, lib());
  assert.deepEqual(p.platforms, ["codesys"], "výchozí platforma z knihovny");
  assert.equal(p.bom!.plat, "codesys");
  assert.equal(p.sim!.motorDelay, 2);
  const d = addLibraryDevice(p, "PumpVfd");
  assert.equal(d.name, "P1");
  assert.equal(d.cls, "Motor");
  assert.equal(d.libType, "PumpVfd");
  assert.deepEqual(p.io.filter(e => e.devId === d.id).map(e => e.sig).sort(), ["fault", "fbkRunning", "outRun"]);
  assert.equal(addLibraryDevice(p, "PumpVfd").name, "P2");
  const t = addLibraryDevice(p, "TempPt100");
  assert.equal(t.name, "B1");
  assert.equal(t.limHi, 95);
  assert.equal(t.unit, "°C");
  assert.deepEqual(validateProject(p).filter(i => i.level === "error"), []);
  assert.equal(libStepTime(p, d.id, 5), 8);
  assert.equal(libStepTime(p, t.id, 5), 5);
  const bom = buildBom(p);
  const pump = bom.lines.find(l => l.id === "-P1:pump")!;
  assert.equal(pump.brand, "Grundfos");
  assert.equal(pump.type, "CR 5-4");
  assert.equal(pump.orderCode, "96516000");
  const vfd = bom.lines.find(l => l.id === "-U1:vfd")!;
  assert.ok(vfd, "díl navíc z typu knihovny");
  assert.equal(vfd.brand, "Danfoss");
  assert.equal(vfd.orderCode, "132F0018");
  assert.ok(bom.lines.find(l => l.id === "-U2:vfd"));
  /* volba uživatele se nepřepíše */
  p.bom!.lines!["-P1:pump"].type = "CR 10-2";
  addLibraryDevice(p, "PumpVfd", "PX");
  assert.equal(buildBom(p).lines.find(l => l.id === "-P1:pump")!.type, "CR 10-2");
  assert.throws(() => addLibraryDevice(p, "Nope"), /Nope/);
  assert.match(libraryDocHeader(p), /ACME Automation/);
  assert.deepEqual(libraryApprovers(p), ["Ing. Novák"]);
});
