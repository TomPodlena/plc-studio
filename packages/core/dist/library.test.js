/** Testy firemní knihovny (library.ts) — node:test, bez závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleSmall } from "./samples.js";
import { buildBom } from "./bom.js";
import { ST_MOTOR, ST_VENTIL, SCL_MOTOR, genFor, codeLibrary } from "./codegen.js";
import { blankProject, validateProject, PLAT } from "./model.js";
import { docSWMd } from "./docs.js";
import { emulateCompile } from "./emu/index.js";
import { blankLibrary, exportLibrary, importLibrary, validateLibrary, validateFbTemplate, fbInterface, builtinTemplate, FB_CLASSES, libraryOverrides, attachLibrary, addLibraryDevice, libStepTime, libraryDocHeader, libraryApprovers, LIBRARY_SCHEMA, } from "./library.js";
const MY_MOTOR = ST_MOTOR.replace("T#3S", "T#5S").replace("(* Sablona: motor", "(* ACME firemni blok: motor");
function lib() {
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
    for (const cls of FB_CLASSES)
        for (const dialect of ["st", "scl"]) {
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
    assert.equal(exportLibrary(b, "2026-10-04"), txt, "druhý export shodný");
    assert.equal(b.schema, LIBRARY_SCHEMA);
    assert.deepEqual(b.deviceTypes, a.deviceTypes);
    assert.equal(b.fbTemplates[0].source, MY_MOTOR);
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
    bad.deviceTypes.push({ id: "pumpvfd", label: "dup", cls: "Motor" }, { id: "2bad", label: "x", cls: "Ventil", opt: { fbk: true }, prefix: "Č" }, { id: "Ai", label: "x", cls: "AnalogIn", rmin: 10, rmax: 5, limLo: 9, limHi: 1 }, { id: "Lamp", label: "x", cls: "DI", role: "run" });
    bad.company.approvers.push({ name: "" });
    const errs = validateLibrary(bad).filter(i => i.level === "error").map(i => i.where + ": " + i.msg);
    const has = (re) => assert.ok(errs.some(e => re.test(e)), "chybí chyba " + re + "\n" + errs.join("\n"));
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
    const err = (t) => validateFbTemplate({ id: "T", cls: "Motor", dialect: "st", source: MY_MOTOR, ...t })
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
    l.fbTemplates.push({ id: "Other", cls: "Motor", dialect: "st", source: MY_MOTOR });
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
    p.library.fbTemplates.push({ id: "Beck", cls: "Motor", dialect: "st", platforms: ["beckhoff"], source: spec });
    assert.equal(libraryOverrides(p, "beckhoff").templates.Motor, spec);
    assert.equal(libraryOverrides(p, "codesys").templates.Motor, MY_MOTOR);
    /* chybná šablona se vynechá a nahlásí */
    p.library.fbTemplates.push({ id: "BadV", cls: "Ventil", dialect: "st", source: ST_VENTIL.replace("cmdClose : BOOL;", "") });
    const o2 = libraryOverrides(p, "codesys");
    assert.equal(o2.templates.Ventil, undefined);
    assert.ok(o2.issues.some(i => i.level === "error" && /cmdClose/.test(i.msg)));
});
test("vlastní typ zařízení v projektu: zařízení, I/O, kusovník, časy, výchozí volby", () => {
    const p = blankProject();
    attachLibrary(p, lib());
    assert.deepEqual(p.platforms, ["codesys"], "výchozí platforma z knihovny");
    assert.equal(p.bom.plat, "codesys");
    assert.equal(p.sim.motorDelay, 2);
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
    const pump = bom.lines.find(l => l.id === "-P1:pump");
    assert.equal(pump.brand, "Grundfos");
    assert.equal(pump.type, "CR 5-4");
    assert.equal(pump.orderCode, "96516000");
    const vfd = bom.lines.find(l => l.id === "-U1:vfd");
    assert.ok(vfd, "díl navíc z typu knihovny");
    assert.equal(vfd.brand, "Danfoss");
    assert.equal(vfd.orderCode, "132F0018");
    assert.ok(bom.lines.find(l => l.id === "-U2:vfd"));
    /* volba uživatele se nepřepíše */
    p.bom.lines["-P1:pump"].type = "CR 10-2";
    addLibraryDevice(p, "PumpVfd", "PX");
    assert.equal(buildBom(p).lines.find(l => l.id === "-P1:pump").type, "CR 10-2");
    assert.throws(() => addLibraryDevice(p, "Nope"), /Nope/);
    assert.match(libraryDocHeader(p), /ACME Automation/);
    assert.deepEqual(libraryApprovers(p), ["Ing. Novák"]);
});
/* ------------------------------------------------ napojení knihovny do generátoru (genFor) */
const ALL = Object.keys(PLAT);
const MY_MOTOR_SCL = SCL_MOTOR.replace("T#3S", "T#5S").replace("// Šablona: motor", "// ACME firemní blok: motor");
/** Knihovna s vlastním FB_Motor (stejné rozhraní, rozběh 5 s místo 3 s) pro ST i SCL. */
function genLib() {
    const l = lib();
    l.fbTemplates = [
        { id: "AcmeMotor", cls: "Motor", dialect: "st", source: MY_MOTOR },
        { id: "AcmeMotorScl", cls: "Motor", dialect: "scl", source: MY_MOTOR_SCL },
    ];
    return l;
}
const errsOf = (fs) => fs.filter(f => f.level === "error").map(f => f.rule + " " + f.file + ":" + f.line + " " + f.msg);
test("knihovna v generátoru: vlastní FB_Motor na všech platformách, hlavička, README, FDS; emulátor přeloží", () => {
    const p = sampleSmall();
    p.platforms = [...ALL];
    attachLibrary(p, genLib(), false);
    for (const plat of ALL) {
        const f = genFor(p, plat), all = Object.values(f).join("\n");
        const lib = codeLibrary(p, plat);
        assert.deepEqual(lib.issues.filter(i => i.level === "error"), [], plat + ": šablona použitelná");
        assert.equal(lib.ids.Motor, plat === "siemens" ? "AcmeMotorScl" : "AcmeMotor", plat);
        /* vlastní šablona je v kódu (rozběh 5 s), vestavěná (3 s) už ne */
        if (plat === "siemens") {
            assert.match(f["Gen_Library.scl"], /ACME firemní blok/);
            assert.match(f["Gen_Library.scl"], /T_FBK : Time := T#5S/);
        }
        else if (plat === "rockwell") {
            assert.match(f["PLCdesk_Program.L5X"], /tonFbk\.PRE := 5000;/);
            assert.doesNotMatch(f["PLCdesk_Program.L5X"], /tonFbk\.PRE := 3000;/);
        }
        else if (plat === "unitronics") {
            assert.match(f["Machine.st"], /instM1_tonFbk\(IN := \(instM1_statStep = 10\), PT := T#5S\);/);
        }
        else {
            assert.match(f["Gen_Library.st"], /ACME firemni blok/);
            assert.match(f["Gen_Library.st"], /tonFbk\(IN := \(statStep = 10\), PT := T#5S\);/);
        }
        /* firemní hlavička v hlavním programu a README; README jmenuje šablonu */
        const mainName = plat === "siemens" ? "Gen_Main.scl" : plat === "rockwell" ? "MainRoutine.st" : plat === "unitronics" ? "Machine.st" : "MAIN.st";
        assert.match(f[mainName].slice(0, 400), plat === "siemens" ? /^﻿?\/\/ ACME Automation/ : /^\(\* ACME Automation/, plat + ": hlavička " + mainName);
        assert.match(f["README.txt"], /^ACME Automation/);
        assert.match(f["README.txt"], /AcmeMotor/);
        assert.doesNotMatch(all, /undefined|NaN/);
        /* emulátor: skutečný výstup s vlastní šablonou se přeloží bez chyby (běhová shoda se simulací
           se u vlastního bloku nepožaduje — simulace zrcadlí vestavěnou šablonu) */
        assert.deepEqual(errsOf(emulateCompile(p, plat).findings), [], plat + ": překlad s vlastní šablonou");
    }
    /* FDS (softwarová dokumentace): poznámka u typového bloku */
    assert.match(docSWMd(p), /FB_Motor \| .*AcmeMotor.*neověřeno simulací/);
    assert.doesNotMatch(docSWMd(p), /FB_Ventil \| .*knihovny/);
});
test("knihovna v generátoru: šablona s chybou ani nepřevoditelná šablona se nepoužije — vestavěná + issue", () => {
    const base = sampleSmall();
    base.platforms = [...ALL];
    const plain = Object.fromEntries(ALL.map(pl => [pl, genFor(base, pl)]));
    /* 1) chyba validace (chybí vstup) → nikde, kód knihovny bloků shodný s projektem bez knihovny */
    const p = sampleSmall();
    p.platforms = [...ALL];
    const l = genLib();
    l.fbTemplates = [{ id: "BadMotor", cls: "Motor", dialect: "st", source: MY_MOTOR.replace("    fault : BOOL;\n", "") }];
    attachLibrary(p, l, false);
    for (const plat of ALL) {
        if (plat === "siemens")
            continue;
        const lib = codeLibrary(p, plat);
        assert.equal(lib.templates.Motor, undefined, plat);
        assert.ok(lib.issues.some(i => i.level === "error" && /fault/.test(i.msg)), plat + ": issue chyby šablony");
        const f = genFor(p, plat);
        if (f["Gen_Library.st"])
            assert.equal(f["Gen_Library.st"], plain[plat]["Gen_Library.st"], plat + ": vestavěná šablona");
        if (f["Machine.st"])
            assert.match(f["Machine.st"], /PT := T#3S\);/);
    }
    /* 2) platná IEC šablona s R_TRIG: CODESYS ji použije, Unitronics (rozepsání) ani Logix (AOI) ne */
    const q = sampleSmall();
    q.platforms = [...ALL];
    const rt = MY_MOTOR.replace("    lastStart : BOOL;\n", "    rtStart : R_TRIG;\n")
        .replace("trigStart := cmdStart AND NOT lastStart;  lastStart := cmdStart;", "rtStart(CLK := cmdStart); trigStart := rtStart.Q;");
    assert.notEqual(rt, MY_MOTOR);
    assert.deepEqual(validateFbTemplate({ id: "RtMotor", cls: "Motor", dialect: "st", source: rt }).filter(i => i.level === "error"), []);
    const l2 = genLib();
    l2.fbTemplates = [{ id: "RtMotor", cls: "Motor", dialect: "st", source: rt }];
    attachLibrary(q, l2, false);
    assert.match(genFor(q, "codesys")["Gen_Library.st"], /rtStart\(CLK := cmdStart\)/);
    assert.deepEqual(errsOf(emulateCompile(q, "codesys").findings), []);
    for (const plat of ["unitronics", "rockwell"]) {
        const lib = codeLibrary(q, plat);
        assert.equal(lib.templates.Motor, undefined, plat + ": nepřevoditelná šablona se nepoužije");
        const iss = lib.issues.filter(i => i.level === "error");
        assert.ok(iss.length === 1 && /RtMotor/.test(iss[0].where) && /R_TRIG/.test(iss[0].msg), plat + ": issue s důvodem\n" + iss.map(i => i.msg).join("\n"));
        const f = genFor(q, plat);
        assert.doesNotMatch(Object.values(f).join("\n").replace(f["README.txt"], ""), /rtStart/, plat + ": v kódu vestavěná šablona");
        assert.match(f["README.txt"], /RtMotor/);
        assert.deepEqual(errsOf(emulateCompile(q, plat).findings), [], plat);
    }
    /* 3) RETURN jinde než v úvodním IF NOT enable → Unitronics ne */
    const ret = MY_MOTOR.replace("busy := (statStep = 10);", "IF fault THEN RETURN; END_IF;\nbusy := (statStep = 10);");
    const r = sampleSmall();
    r.platforms = [...ALL];
    const l3 = genLib();
    l3.fbTemplates = [{ id: "RetMotor", cls: "Motor", dialect: "st", source: ret }];
    attachLibrary(r, l3, false);
    assert.equal(codeLibrary(r, "unitronics").templates.Motor, undefined);
    assert.ok(codeLibrary(r, "unitronics").issues.some(i => i.level === "error" && /RETURN/.test(i.msg)));
    assert.equal(codeLibrary(r, "codesys").templates.Motor, ret);
});
test("knihovna bez šablon a bez firmy: výstup generátoru beze změny", () => {
    const a = sampleSmall(), b = sampleSmall();
    a.platforms = b.platforms = [...ALL];
    attachLibrary(b, { ...blankLibrary("prázdná"), company: undefined }, false);
    for (const plat of ALL)
        assert.deepEqual(genFor(b, plat), genFor(a, plat), plat);
});
