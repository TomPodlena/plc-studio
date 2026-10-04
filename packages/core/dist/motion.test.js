/**
 * Testy pohonů a proporcionálních prvků fáze 2a (Vfd, PosDrive, PropValve přes běžné I/O):
 * model a validace, IR (povely při vstupu do kroku, podmínky na výstupy bloku), šablony (SCL ze ST,
 * shoda časů se simulátorem), simulace (rampa, referování, odchylka, zastavení), emulátor
 * (vzor 11 na 10 platformách a v OOP = návrh, přeskočení klidu, mutace), dokumentace, HMI, kusovník.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankProject, syncIO, validateProject, PLAT, devDefaults, parseRecords, recordsText, rampStepOf, maxRecord, devRef, } from "./model.js";
import { genFor, ST_VFD, ST_POSDRIVE, ST_PROPVALVE, SCL_VFD, SCL_POSDRIVE, SCL_PROPVALVE, fbTemplate } from "./codegen.js";
import { buildIR, seqCond } from "./ir.js";
import { setLang } from "./i18n.js";
import { simulate, verifyProject, Simulator, T_VFD_SPEED, T_POS_ACK, T_POS_MOVE, T_PROP_SETTLE, T_TICK, T_POS_SEL, devDeadline, devFaultRaw, } from "./sim.js";
import { docFiles, docAlarmCsv, docFDSMd } from "./docs.js";
import { buildBom } from "./bom.js";
import { hmiTags, hmiAlarms } from "./hmi.js";
import { emulateRunMany, emulateRunFiles, emulateCompile } from "./emu/index.js";
const SAMPLE = new URL("../../../samples/11_podavaci_lisovaci_stanice_PS-11.plcstudio.json", import.meta.url);
const PLATS = Object.keys(PLAT);
const OOP_PLATS = ["codesys", "beckhoff", "schneider", "wago", "delta"];
function load() {
    const raw = JSON.parse(readFileSync(SAMPLE, "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    syncIO(prj);
    return prj;
}
const dev = (p, name) => p.devices.find(d => d.name === name);
const clone = (p) => JSON.parse(JSON.stringify(p));
/* ------------------------------------------------------------------ model a validace */
test("pohony: model — výchozí parametry, signály, záznamy, označení řadiče", () => {
    setLang("cs");
    const p = load();
    const M1 = dev(p, "M1"), M2 = dev(p, "M2"), Y2 = dev(p, "Y2");
    assert.deepEqual(p.io.filter(e => e.devId === M1.id).map(e => e.sig), ["ready", "atSpeed", "fault", "outRun", "rawSpeed", "rawAct"]);
    assert.deepEqual(p.io.filter(e => e.devId === M2.id).map(e => e.sig), ["ready", "inPos", "homed", "fault", "outEnable", "outStart", "outHome", "outHalt", "outSel0", "outSel1"]);
    assert.deepEqual(p.io.filter(e => e.devId === Y2.id).map(e => e.sig), ["rawSp", "rawAct"]);
    assert.equal(maxRecord(M2), 3);
    assert.equal(rampStepOf(M1), 2.5, "50 Hz za 2 s = 2,5 Hz na takt 0,1 s");
    assert.equal(devRef(M1), "TA1");
    assert.equal(devRef(dev(p, "Y1")), "Y1");
    assert.equal(devDefaults("PosDrive").selBits, 3);
    const recs = parseRecords("2 = lis @ 180; 1 = převzetí @ 0; x; 3=výstup");
    assert.deepEqual(recs, [{ no: 1, name: "převzetí", pos: 0 }, { no: 2, name: "lis", pos: 180 }, { no: 3, name: "výstup" }]);
    assert.deepEqual(parseRecords(recordsText(recs)), recs, "text ↔ záznamy beze ztráty");
    assert.deepEqual(validateProject(p).filter(i => i.level !== "info"), [], "vzor 11 je bez chyb a varování");
});
test("pohony: validace — akce patří třídě, číslo záznamu v rozsahu, bity a rampa", () => {
    setLang("cs");
    const p = load();
    const M2 = dev(p, "M2"), M1 = dev(p, "M1");
    const bad = clone(p);
    bad.program.seq.push({ dev: M2.id, act: "start", cond: "fbk", timeS: 3 }); // start na polohovací pohon
    bad.program.seq.push({ dev: M2.id, act: "posRecord", cond: "fbk", timeS: 3, rec: 4 }); // 2 bity → nejvýš 3
    bad.program.seq.push({ dev: M1.id, act: "start", cond: "fbk", timeS: 3, sp: 80 }); // mimo 0–50 Hz
    dev(bad, "M1").rampS = -1;
    const bits = clone(p);
    dev(bits, "M2").selBits = 9;
    const v = [...validateProject(bad), ...validateProject(bits)];
    assert.ok(v.some(i => i.level === "error" && /neplatí pro zařízení M2/.test(i.msg)), "akce mimo třídu");
    assert.ok(v.some(i => i.level === "error" && /Číslo záznamu M2/.test(i.msg)), "záznam mimo rozsah");
    assert.ok(v.some(i => i.level === "warn" && /mimo rozsah M1/.test(i.msg)), "žádaná mimo rozsah");
    assert.ok(v.some(i => i.level === "error" && /bitů výběru/.test(i.msg)), "počet bitů");
    assert.ok(v.some(i => i.level === "error" && /Rampa/.test(i.msg)), "záporná rampa");
});
/* ------------------------------------------------------------------ IR a šablony */
test("pohony: IR — povely kroku i při přechodu DO kroku, podmínky na výstupy bloku, přerušení", () => {
    const p = load();
    const ir = buildIR(p);
    const s2 = ir.seq.steps[1]; // M1 start 40 Hz
    assert.equal(s2.op, "run");
    assert.deepEqual(s2.sets.map(x => x.var), ["seqSpd_M1", "seqRun_M1"]);
    assert.deepEqual(ir.seq.resets.map(r => r.var), ["seqMove_M2", "seqHome_M2", "seqRec_M2", "seqRun_M1", "seqSpd_M1", "seqOn_Y2", "seqSp_Y2"]);
    const cnd = seqCond(p, p.program.seq[6]); // M2 záznam 1
    assert.equal(cnd.kind, "fbk");
    assert.ok(cnd.expr && JSON.stringify(cnd.expr).includes("actRec"));
    const main = genFor(p, "codesys")["MAIN.st"];
    /* přechod z kroku 1 do kroku 2 zapíše žádanou a chod už v přechodu (blok je zpracuje v tomtéž scanu) */
    assert.match(main, /IF instM2\.done AND instM2\.actRec = 0 THEN seqSpd_M1 := 40\.0; seqRun_M1 := TRUE; seqStep := 20;/);
    assert.match(main, /IF modeAuto AND enable AND NOT machineFault AND cmdAutoStart THEN seqMove_M2 := FALSE; seqHome_M2 := TRUE; seqStep := 10;/);
    assert.match(main, /seqSpd_M1 := 40\.0;\n\s+seqOn_Y2 := FALSE;/, "přerušení: výchozí žádaná měniče");
    assert.match(main, /rawMax := 32767, \(\* TODO/, "surový rozsah dle platformy");
    const sie = genFor(p, "siemens")["Gen_Main.scl"];
    assert.match(sie, /rawMax := 27648,/);
});
test("pohony: šablony — SCL vzniká ze ST, časy šablon = konstanty simulátoru, Logix bez IEC konstrukcí", () => {
    for (const [st, scl, name] of [[ST_VFD, SCL_VFD, "FB_Vfd"], [ST_POSDRIVE, SCL_POSDRIVE, "FB_PosDrive"], [ST_PROPVALVE, SCL_PROPVALVE, "FB_PropValve"]]) {
        assert.match(scl, new RegExp('^FUNCTION_BLOCK "' + name + '"\\n\\{ S7_Optimized_Access'));
        assert.match(scl, /\nBEGIN\n/);
        assert.ok(!/\bTON;/.test(scl) && /TON_TIME;/.test(scl), name + ": TON_TIME");
        assert.match(scl, /#statStep := 0;/);
        assert.equal(fbTemplate(name === "FB_Vfd" ? "Vfd" : name === "FB_PosDrive" ? "PosDrive" : "PropValve", "scl"), scl);
        assert.ok(/^[\x00-\x7F]*$/.test(st), name + ": ST jen ASCII (UniLogic, Logix)");
        for (const bad of [/\bABS\(/, /\bSEL\(/, /\bMOD\b/, /\bXOR\b/])
            assert.doesNotMatch(st, bad, name + ": konstrukce mimo společný základ");
    }
    const lit = (s) => "T#" + (s >= 1 ? s + "S" : s * 1000 + "MS");
    assert.ok(ST_VFD.includes(lit(T_VFD_SPEED)) && ST_VFD.includes(lit(T_TICK)));
    assert.ok(ST_POSDRIVE.includes(lit(T_POS_ACK)) && ST_POSDRIVE.includes(lit(T_POS_MOVE)) && ST_POSDRIVE.includes(lit(T_POS_SEL)));
    assert.ok(ST_PROPVALVE.includes(lit(T_PROP_SETTLE)) && ST_PROPVALVE.includes(lit(T_TICK)));
    const p = load();
    const l5x = genFor(p, "rockwell")["PLCdesk_Program.L5X"];
    assert.match(l5x, /<Parameter Name="rawSpeed" TagType="Base" DataType="REAL"/, "Logix: surový analog měniče REAL (5069)");
    assert.match(l5x, /<Parameter Name="actRec" TagType="Base" DataType="DINT"/);
    assert.match(l5x, /tonTick\.TimerEnable := \(statStep = 10\) AND NOT tonTick\.DN; TONR\(tonTick\);/);
});
/* ------------------------------------------------------------------ simulace */
test("pohony: simulace — běžný cyklus, rampa po taktech, referování, změna otáček za chodu", () => {
    setLang("cs");
    const p = load();
    const r = simulate(p);
    assert.ok(r.ok, r.faultCause);
    const dur = (i) => { const s = r.steps.find(x => x.i === i); return s.tEnd - s.tStart; };
    /* M1 0 → 40 Hz po 2,5 Hz / takt (takt = 0,1 s + scan) → 16 taktů, pak doběh měniče */
    assert.ok(dur(1) >= 16 * (T_TICK + 0.01) - 1e-9 && dur(1) < 16 * (T_TICK + 0.01) + 0.6, "rozběh: " + dur(1));
    /* 40 → 10 Hz za chodu: nová rampa (krok nepřejde se starým hlášením „otáčky dosaženy“) */
    assert.ok(dur(3) >= 12 * (T_TICK + 0.01) - 1e-9, "změna otáček: " + dur(3));
    /* referování a jízdy trvají doba jízdy modelu + potvrzení + výběr */
    assert.ok(dur(0) >= dev(p, "M2").travelS - 1e-9 && dur(6) >= dev(p, "M2").travelS + T_POS_SEL - 1e-9);
});
test("pohony: simulace — bez referování porucha, odchylka tlaku porucha, E-stop za jízdy = HALT, zastaví se vše", () => {
    setLang("cs");
    const p = load();
    /* bez referenční jízdy: blok odmítne jízdu (errCode 3) → porucha stroje; koncept na to upozorní */
    const q = clone(p);
    q.program.seq.splice(0, 1);
    const r = simulate(q);
    assert.ok(r.faulted && /M2/.test(r.faultCause), r.faultCause);
    assert.ok(verifyProject(q).checks.some(c => /bez referenční jízdy/.test(c.title)));
    /* odchylka skutečného tlaku v toleranci kroku → porucha nejpozději do lhůty */
    const n = simulate(p);
    const run = n.steps.find(s => s.i === 10); // Y3 dolů — Y2 drží 4,5 bar
    const at = Math.round((run.tStart + 0.2) * 1000) / 1000;
    const Y2 = dev(p, "Y2");
    const f = simulate(p, { faults: [{ kind: "analog", dev: Y2.id, at, raw: devFaultRaw(Y2, 4.5) }], maxTime: at + 3 });
    assert.ok(f.faulted && f.faultT - at <= devDeadline(Y2, 0.01) + 1e-9, "odchylka: " + f.faultT);
    /* E-stop během jízdy osy: výstupy pohybu vypnuté, žádný restart */
    const mv = n.steps.find(s => s.i === 8); // M2 → záznam 2
    const es = Math.round((mv.tStart + 0.5) * 1000) / 1000;
    const e = simulate(p, { faults: [{ kind: "estop", at: es, release: es + 1 }], maxTime: es + 3 });
    const last = e.frames[e.frames.length - 1];
    const keys = p.io.filter(x => ["M2_outStart", "M2_outHome", "M1_outRun"].includes(x.tag)).map(x => x.key);
    assert.ok(keys.every(k => last.io[k] === false) && last.step === -1);
});
test("pohony: ověření vzoru 11 — bez chyb, matice stavů s novými sloupci bez ✖", () => {
    setLang("cs");
    const v = verifyProject(load());
    assert.ok(v.ok, v.checks.filter(c => c.level === "error").map(c => c.title).join("; "));
    const cols = v.matrix.cols.map(c => c.id);
    for (const c of ["fault", "lost", "lostp", "dev"])
        assert.ok(cols.includes(c), "sloupec " + c);
    assert.equal(v.matrix.failed, 0);
    assert.ok(v.matrix.total > 90);
});
/* ------------------------------------------------------------------ emulátor */
test("pohony emu: vzor 11 × 10 platforem — překlad bez chyb, běh kódu = návrh (plná matice), i v OOP", () => {
    setLang("cs");
    const p = load();
    for (const pl of PLATS)
        assert.deepEqual(emulateCompile(p, pl).findings.filter(f => f.level === "error").map(f => f.file + ":" + f.line + " " + f.msg), [], pl);
    const r = emulateRunMany(p, PLATS, { scope: "full" });
    for (const pl of PLATS) {
        assert.ok(r[pl].scenarios.length > 150, pl + ": scénáře");
        assert.deepEqual(r[pl].diffs.map(d => d.scenario + " " + d.msg), [], pl + ": kód ≠ návrh");
        assert.deepEqual((r[pl].runtime || []).map(x => x.msg), [], pl + ": běhové chyby");
    }
    const o = clone(p);
    o.codeStyle = "oop";
    const ro = emulateRunMany(o, OOP_PLATS, { scope: "full" });
    for (const pl of OOP_PLATS)
        assert.deepEqual(ro[pl].diffs.map(d => d.scenario + " " + d.msg), [], "OOP " + pl);
});
test("pohony emu: přeskočení klidu (časovače bloků pohonů) = krokování scan po scanu", () => {
    setLang("cs");
    const p = load();
    const a = emulateRunMany(p, ["codesys", "unitronics"], { scope: "quick" });
    const b = emulateRunMany(p, ["codesys", "unitronics"], { scope: "quick", noSkip: true });
    for (const pl of ["codesys", "unitronics"]) {
        assert.deepEqual(a[pl].scenarios.map(s => s.end), b[pl].scenarios.map(s => s.end), pl);
        assert.equal(a[pl].diffs.length + b[pl].diffs.length, 0);
    }
    assert.ok((a.codesys.skippedScans || 0) > 0, "klidové úseky se přeskočily (časovače bloků pohonů se posunuly spolu s nimi)");
});
test("pohony emu mutace: jiná rampa, jiná doba odchylky, chybný výběr záznamu, ztracený HALT = rozdíl", () => {
    setLang("cs");
    const p = load();
    const muts = [
        ["rampa", "codesys", "MAIN.st", s => s.replace("rampStep := 2.5", "rampStep := 5.0")],
        ["doba odchylky", "siemens", "Gen_Main.scl", s => s.replace(/tolTicks := 5\b/, "tolTicks := 50")],
        ["výběr záznamu", "beckhoff", "Gen_Library.st", s => s.replace("outSel0 := selRest >= 1;", "outSel0 := selRest >= 2;")],
        ["HALT", "unitronics", "Machine.st", s => s.replace(/instM2_halted := TRUE; instM2_outStart := FALSE;/g, "instM2_outStart := FALSE;")],
    ];
    for (const [what, pl, file, fn] of muts) {
        const files = genFor(p, pl);
        const m = fn(files[file]);
        assert.notEqual(m, files[file], what + ": mutace se neuplatnila");
        const r = emulateRunFiles(p, pl, { ...files, [file]: m }, { scope: "full" });
        assert.ok(r.diffs.length > 0, what + " (" + pl + "): emulátor rozdíl nenašel");
    }
});
/* ------------------------------------------------------------------ dokumentace, HMI, kusovník */
test("pohony: dokumentace — FDS, alarmy s kódy chyb, README, FAT, SW dokumentace", () => {
    setLang("cs");
    const p = load();
    const fds = docFDSMd(p);
    assert.match(fds, /Pohony a proporcionální prvky/);
    assert.match(fds, /M2 \(.*\): polohovací pohon se záznamy/);
    const alarms = docAlarmCsv(p);
    for (const code of ["A_M1_FAULT", "A_M1_READY", "A_M1_SPEED", "A_M1_TIMEOUT", "A_M2_NOTHOMED", "A_M2_POS", "A_M2_TIMEOUT", "A_Y2_DEV", "A_Y2_TIMEOUT"])
        assert.ok(alarms.includes(code + ";"), code);
    const readme = genFor(p, "siemens")["README.txt"];
    assert.match(readme, /POHONY A PROPORCIONÁLNÍ PRVKY/);
    assert.match(readme, /Festo CMMO-ST/);
    const docs = Object.fromEntries(docFiles(p).map(f => [f.path, f.body]));
    assert.match(docs["05_testovaci_protokol_FAT.md"], /Referenční jízda → hlášení/);
    assert.match(docs["07_softwarova_dokumentace.md"], /FB_PosDrive/);
    assert.match(docs["01_funkcni_specifikace_FDS.md"], /manHome_/);
});
test("pohony: HMI — stav bloků a kód chyby, alarmy spouští errCode, Mitsubishi / Omron je mají globálně", () => {
    setLang("cs");
    const p = load();
    const tags = hmiTags(p);
    for (const n of ["instM1_inSpeed", "instM1_speedCmd", "instM1_errCode", "instM2_done", "instM2_actRec", "instY2_inTol", "instY2_value", "manHome_M2", "manOn_Y2"])
        assert.ok(tags.some(t => t.name === n), n);
    const al = hmiAlarms(p, tags);
    const nh = al.find(a => a.codes.includes("A_M2_NOTHOMED"));
    assert.deepEqual(nh.trigger, { tag: "instM2_errCode", kind: "value", value: 3 });
    const lbl = genFor(p, "mitsubishi")["GlobalLabels.csv"];
    for (const n of ["instM1_inSpeed", "instM2_errCode", "instY2_spAct"])
        assert.ok(lbl.includes('"' + n + '"'), "GX Works3: " + n);
});
test("pohony: kusovník — řadič měniče a pohonu (-TA), osa, motor, proporcionální ventil", () => {
    setLang("cs");
    const b = buildBom(load());
    const has = (tag, cat) => b.lines.some(l => l.tag === tag && l.cat === cat);
    assert.ok(has("-TA1", "vfd") && has("-M1", "gearmotor") && has("-Q1", "mcb"));
    assert.ok(has("-TA2", "positioning_drive") && has("-M2", "linear_axis"));
    assert.ok(has("-Y2", "proportional_valve"));
    const tags = b.lines.map(l => l.tag + ":" + l.cat);
    assert.equal(new Set(tags).size, tags.length, "řádky kusovníku jedinečné");
});
test("pohony: simulátor = model stroje jen ve vrstvě model (vnucená hodnota přebije, po uvolnění zpět)", () => {
    const p = load();
    const sim = new Simulator(p);
    const inPos = p.io.find(e => e.tag === "M2_inPos");
    sim.controls.force[inPos.key] = false;
    sim.run(0.05);
    assert.equal(sim.frame().io[inPos.key], false);
    delete sim.controls.force[inPos.key];
    sim.run(0.05);
    assert.equal(sim.frame().io[inPos.key], true, "model: pohon stojí v poloze");
});
