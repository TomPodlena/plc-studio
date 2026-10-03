/** Testy jádra — node:test, bez externích závislostí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankProject, syncIO, autoAddr, addrFor, sanitizeTag, validateProject, modules, dtFor, ioOf, PLAT, enableInputs, } from "./model.js";
import { genFor, genTagFile, seqBody, parseFbTemplate, ST_MOTOR, ST_VENTIL, SCL_MOTOR, SCL_VENTIL, TPL_COMMENTS, templateComments, trComments, timeLit } from "./codegen.js";
import { logixProblems } from "./logix.js";
import { LANGS, fill, getLang, setLang, tr, trx, withLang } from "./i18n.js";
import { detectAndParse, buildDevicesFromTags, normAddr } from "./importers.js";
import { sheetOps, opsToDXF, opsToSVG, svgBlock } from "./drawing.js";
import { simulate, Simulator, Checkpoints, verifyProject, docVerifyMd, stepCondText, T_MOTOR_FBK, T_VALVE_TRAVEL, DI_DELAY } from "./sim.js";
import { svgFlow, svgTiming, svgMachine } from "./flow.js";
import { allProjectFiles, docFiles } from "./docs.js";
import { sampleSmall, sampleComplex } from "./samples.js";
import { buildBom, bomCsv, bomMd } from "./bom.js";
import { genPLCopenXML, parseStPou, splitLibrary } from "./plcopen.js";
import { conceptNorm, conceptInstructions } from "./concept.js";
import { docFDSMd, CONCEPT_FILE } from "./docs.js";
import { extractFiles, inferProject, mergeProposals, splitTag, parseTimeLit } from "./reverse.js";
import { canonAddr, parseXml, xmlAll } from "./importers.js";
import { seqCond } from "./codegen.js";
import { interlockDevs } from "./model.js";
import { readFileSync } from "node:fs";
test("syncIO přiřadí unikátní adresy a NC podle popisu", () => {
    const p = sampleSmall();
    const addrs = p.io.map(e => e.addr);
    assert.equal(new Set(addrs).size, addrs.length, "adresy musí být unikátní");
    const estop = p.io.find(e => e.tag === "S1_in");
    assert.equal(estop.nc, true, "E-stop (NC) má mít nc=true");
    assert.match(estop.addr, /^%I\d+\.\d+$/);
});
test("autoAddr(force) přečísluje od nuly, AI slovní adresy sudé", () => {
    const p = sampleComplex();
    autoAddr(p, true);
    const di0 = p.io.filter(e => e.dir === "DI")[0];
    assert.equal(di0.addr, "%I0.0");
    for (const e of p.io.filter(e => e.dir === "AI")) {
        const m = e.addr.match(/^%IW(\d+)$/);
        assert.equal((+m[1]) % 2, 0, "AI adresa sudá: " + e.addr);
    }
});
test("addrFor převádí notace platforem", () => {
    const e = { addr: "%I1.3", dir: "DI" };
    assert.equal(addrFor("beckhoff", e), "%I*", "TwinCAT: AT %I* a nalinkování");
    assert.equal(addrFor("beckhoff", { addr: "%Q0.1", dir: "DO" }), "%Q*");
    assert.equal(addrFor("codesys", e), "%IX1.3");
    assert.equal(addrFor("mitsubishi", e), "X13", "FX5: X/Y osmičkově (%I1.3 = 11. vstup = X13)");
    assert.equal(addrFor("rockwell", e), "");
    const w = { addr: "%IW64", dir: "AI" };
    assert.equal(addrFor("codesys", w), "%IW32", "CODESYS: %IW = index slova (Siemens bajt 64 → slovo 32)");
});
test("sanitizeTag a validace chytí diakritiku a duplicity", () => {
    assert.equal(sanitizeTag("Čerpadlo 1 běh"), "Cerpadlo_1_beh");
    assert.equal(sanitizeTag("1motor"), "T_1motor");
    const p = sampleSmall();
    p.io[0].tag = p.io[1].tag; // duplicitní tag
    p.io[2].tag = "Příliš divný tag";
    const issues = validateProject(p);
    assert.ok(issues.some(i => i.level === "error" && i.msg.includes("Duplicitní tag")));
    assert.ok(issues.some(i => i.level === "error" && i.where === "Příliš divný tag" && i.msg.includes("identifikátor")), "neplatný identifikátor = chyba");
    /* CODESYS / Sysmac nerozlišují velikost písmen → duplicita */
    const q = sampleSmall();
    q.io[1].tag = q.io[0].tag.toLowerCase();
    assert.ok(validateProject(q).some(i => i.level === "error" && i.msg.includes("Duplicitní tag")));
    /* text uživatele s (* *) v komentáři nerozbije ST (vnořené komentáře) */
    const r = sampleSmall();
    r.devices[0].desc = "Čerpadlo (*) dle zákazníka *) konec";
    syncIO(r);
    for (const f of Object.values(genFor(r, "codesys"))) {
        const opens = (f.match(/\(\*/g) || []).length, closes = (f.match(/\*\)/g) || []).length;
        assert.equal(opens, closes, "vyvážené komentáře");
    }
});
test("Rockwell Tags.csv: hlavička, ASCII, atributy, escapování $, REAL analogy, aliasy 5069 a programové tagy", () => {
    const p = sampleSmall();
    p.devices[0].desc = 'Čerpadlo $1 "A" – 50 °C';
    p.io = [];
    syncIO(p);
    const f = genTagFile(p, "rockwell");
    const lines = f.body.split("\n");
    assert.equal(f.name, "Tags.csv");
    assert.match(lines[0], /^remark,"CSV-Import-Export"$/);
    const hdr = lines.indexOf("0.3");
    assert.ok(hdr > 0 && lines.slice(0, hdr).every(l => l.startsWith("remark,")), "před 0.3 jen remark");
    assert.equal(lines[hdr + 1], "TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES");
    assert.ok(!/[^\x00-\x7F]/.test(f.body), "ASCII (CSV neumí dvoubajtové znaky)");
    assert.ok(!f.body.includes("WORD") && !/"INT"/.test(f.body));
    assert.ok(f.body.includes('"Cerpadlo $$1 $QA$Q - 50 degC - beh"'), "escapování $ a uvozovek");
    assert.ok(f.body.includes('ALIAS,,M1_fbkRunning,') && f.body.includes('"Local:1:I.Pt00.Data"'), "alias DI na bod modulu 5069");
    assert.ok(f.body.includes('ALIAS,,B1_raw,') && /B1_raw,.*"Local:3:I\.Ch00\.Data","\(RADIX := Float/.test(f.body), "analog = REAL kanál");
    assert.ok(/remark,"I\/O .*1: 5069-IB16 \(DI 0-15\), 2: 5069-OB16 \(DO 0-15\), 3: 5069-IF8/.test(f.body), "předpoklad osazení slotů v remark");
    assert.ok(f.body.includes('TAG,PLCStudio,tonSeq10,"","FBD_TIMER"') && f.body.includes('TAG,PLCStudio,instM1,"","FB_Motor"'), "programové tagy se SCOPE");
    for (const l of lines.slice(hdr + 2))
        assert.ok(/,"\([^"]*ExternalAccess := Read\/Write\)"$/.test(l), "vyplněné ATTRIBUTES: " + l);
    /* adresa, kterou nejde převést → běžný tag (REAL / BOOL) */
    p.io.find(e => e.tag === "B2_raw").addr = "%IW63";
    assert.ok(/^TAG,,B2_raw,.*"REAL"/m.test(genTagFile(p, "rockwell").body));
});
test("Rockwell: L5X (AOI + tagy + rutina ST) je well-formed a bez konstrukcí, které Logix nemá", () => {
    /* nezávislá kontrola párování značek (bez knihoven) */
    const tagsBalanced = (xml) => {
        const st = [];
        const body = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, "");
        for (const m of body.matchAll(/<(\/?)([A-Za-z]\w*)[^>]*?(\/?)>/g)) {
            if (m[3])
                continue;
            if (!m[1])
                st.push(m[2]);
            else if (st.pop() !== m[2])
                return false;
        }
        return st.length === 0 && !/[<&]/.test(body.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot);/g, ""));
    };
    const weird = sampleSmall();
    weird.meta.name = 'Stroj "A" ]]> <b>&';
    weird.devices[0].desc = "Čerpadlo ]]> $ 中文";
    weird.io = [];
    syncIO(weird);
    for (const p of [sampleSmall(), sampleComplex(), weird]) {
        const files = genFor(p, "rockwell");
        assert.deepEqual(Object.keys(files), ["PLCStudio_Program.L5X", "MainRoutine.st", "Tags.csv", "README.txt"]);
        const x = files["PLCStudio_Program.L5X"], st = files["MainRoutine.st"];
        assert.ok(tagsBalanced(x), "párování značek");
        assert.deepEqual(logixProblems(files), [], "kontrola Logix");
        assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
        assert.match(x, /<RSLogix5000Content [^>]*TargetType="Program"[^>]*ContainsContext="true"/);
        assert.match(x, /<Program Use="Target" Name="PLCStudio"[^>]*MainRoutineName="MainRoutine"/);
        assert.ok(!/[^\x00-\x7F]/.test(x) && !/[^\x00-\x7F]/.test(st), "ASCII");
        /* rutina a AOI: jen Logix ST */
        const rout = [...x.matchAll(/<Line Number="\d+">((?:<!\[CDATA\[[\s\S]*?\]\]>)+)<\/Line>/g)]
            .map(m => m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).join("\n");
        const code = rout.replace(/\(\*[\s\S]*?\*\)/g, " ");
        for (const bad of [/\bVAR\b/, /\bEND_VAR\b/, /\bPROGRAM\b/, /T#/, /=>/, /\bWORD\b/, /\bRETURN\b/, /\bINT_TO_REAL\b/, /\bREAL_TO_INT\b/, /END_IF(?!;)/, /\bTON\s*\(/, /\.Q\b/]) {
            assert.ok(!bad.test(code), "nesmí obsahovat " + bad);
        }
        /* TONR: PRE a TimerEnable PŘED voláním (jinak zpoždění o scan proti simulaci) */
        const calls = [...code.matchAll(/TONR\((\w+)\);/g)];
        assert.ok(calls.length > 0);
        for (const m of calls) {
            const line = code.slice(code.lastIndexOf("\n", m.index) + 1, m.index);
            assert.match(line, new RegExp(m[1] + "\\.PRE := \\d+; " + m[1] + "\\.TimerEnable := .+; $"), "PRE před TONR(" + m[1] + ")");
        }
        /* každý tag použitý v rutině je v L5X deklarovaný */
        const declared = new Set([...x.matchAll(/<Tag Name="(\w+)"/g)].map(m => m[1]));
        const mainCode = st.replace(/\(\*[\s\S]*?\*\)/g, " ");
        const used = new Set([...mainCode.matchAll(/(?<![.\w])([A-Za-z_]\w*)/g)].map(m => m[1]));
        const KW = new Set(["IF", "THEN", "ELSIF", "ELSE", "END_IF", "CASE", "OF", "END_CASE", "AND", "OR", "NOT", "TONR", "FB_Motor", "FB_Ventil", "FB_AnalogIn", "FB_AnalogOut"]);
        for (const u of used)
            assert.ok(KW.has(u) || declared.has(u), "deklarace " + u);
    }
});
test("Rockwell: rutina je zrcadlo IEC generátoru (pořadí, časovače za CASE, volání přes členy instance)", () => {
    const p = sampleSmall();
    const st = genFor(p, "rockwell")["MainRoutine.st"];
    assert.ok(st.includes("IF Y1_fbkOpen THEN seqStep := 20;\n            ELSIF tonSeq10.DN THEN machineFault := 1; faultStep := 10;"));
    assert.ok(st.includes("tonSeq10.PRE := 5000; tonSeq10.TimerEnable := (seqStep = 10); TONR(tonSeq10);"));
    assert.ok(st.includes("IF tonSeq30.DN THEN seqStep := 40; END_IF;"), "výdrž");
    assert.ok(st.indexOf("END_CASE;") < st.indexOf("TONR(tonSeq10)") && st.indexOf("TONR(tonSeq50)") < st.indexOf("FB_Motor(instM1)"), "časovače za CASE, před instancemi");
    const cmd = "seqRun_M1 OR (manRun_M1 AND NOT modeAuto)";
    assert.ok(st.includes("instM1.enable := enable;\n    instM1.cmdStart := " + cmd + ";\n    instM1.cmdStop := NOT (" + cmd + ");\n    instM1.reset := cmdAck;"));
    assert.ok(st.includes("FB_Motor(instM1);\n    M1_outRun := instM1.outRun;"));
    assert.ok(st.includes("instB1.rawMax := 100.0;"), "analog 5069 REAL 0-100 %");
    const err = "instM1.error OR instY1.error";
    assert.ok(st.indexOf("FB_Ventil(instY1)") < st.indexOf("IF cmdAck AND NOT (" + err + ") THEN machineFault := 0; faultStep := 0; END_IF;"), "kvitace za bloky");
    assert.ok(!/tempUnused/.test(st));
    /* šablona → AOI: RETURN jako ELSE, TONR a DINT status */
    const x = genFor(p, "rockwell")["PLCStudio_Program.L5X"];
    assert.match(x, /<Parameter Name="status" TagType="Base" DataType="DINT" Usage="Output"/);
    assert.match(x, /<LocalTag Name="tonFbk" DataType="FBD_TIMER"/);
    assert.ok(x.includes("<![CDATA[    tonFbk.PRE := 3000; tonFbk.TimerEnable := (statStep = 10); TONR(tonFbk);]]>"));
    assert.ok(x.includes("<![CDATA[ELSE]]>"));
    /* bez sekvence: jen ruční povely */
    const q = sampleSmall();
    q.program.seq = [];
    const s2 = genFor(q, "rockwell")["MainRoutine.st"];
    assert.ok(s2.includes("instM1.cmdStart := manRun_M1;") && !s2.includes("seqStep"));
    /* README: skutečný postup + štítek neověřeno */
    const r = genFor(p, "rockwell")["README.txt"];
    assert.ok(r.includes("Import Program") && r.includes("NEOVĚŘENO") && r.includes("Local:1:I.Pt00.Data") && !r.includes("Gen_Library"));
});
test("validace: označení zařízení pro Logix (max. 32 znaků, bez __ a _ na konci)", () => {
    const p = blankProject();
    p.devices.push({ id: 1, name: "A".repeat(33), cls: "DI", desc: "", opt: {}, unit: "", rmin: 0, rmax: 1 }, { id: 2, name: "B__1", cls: "DI", desc: "", opt: {}, unit: "", rmin: 0, rmax: 1 }, { id: 3, name: "C_", cls: "DI", desc: "", opt: {}, unit: "", rmin: 0, rmax: 1 }, { id: 4, name: "D_" + "x".repeat(30), cls: "DI", desc: "", opt: {}, unit: "", rmin: 0, rmax: 1 });
    p.nextId = 5;
    syncIO(p);
    const bad = new Set(validateProject(p).filter(i => i.level === "error").map(i => i.where));
    assert.ok(bad.has("A".repeat(33)) && bad.has("B__1") && bad.has("C_"));
    assert.ok(!bad.has("D_" + "x".repeat(30)), "32 znaků je OK");
});
test("Siemens: Main obsahuje FB_Machine, instance a sekvenci; SCL AI bez NORM_X", () => {
    const p = sampleSmall();
    const files = genFor(p, "siemens");
    assert.ok(files["Gen_Main.scl"].includes('FUNCTION_BLOCK "FB_Machine"'));
    assert.ok(files["Gen_Main.scl"].includes("instM1"));
    assert.ok(files["Gen_Main.scl"].includes("CASE #seqStep OF"));
    assert.ok(!files["Gen_Library.scl"].includes("NORM_X"));
    assert.ok(files["Gen_Tags.tsv"].startsWith("\uFEFFName\tData Type"), "TSV s BOM pro Excel");
    assert.ok(files["Gen_Main.scl"].startsWith("\uFEFF") && files["Gen_Library.scl"].startsWith("\uFEFF"), "SCL s BOM pro TIA");
    assert.ok(/: TON_TIME;/.test(files["Gen_Main.scl"] + files["Gen_Library.scl"]) && !/: TON;/.test(files["Gen_Main.scl"] + files["Gen_Library.scl"]), "časovače TON_TIME");
    /* krok bez zpětného hlášení: komentář // až za END_IF (jinak zakomentuje THEN … END_IF) */
    const q = sampleSmall();
    q.devices.forEach(d => { if (d.cls === "Motor")
        d.opt.fbk = false; });
    syncIO(q);
    const m = genFor(q, "siemens")["Gen_Main.scl"];
    assert.ok(m.split("\n").every(l => !/\/\/.*\bTHEN\b/.test(l)), "žádné THEN za komentářem //");
    /* jen analog s mezí + DO s rolí: cmdAck / machineFault deklarované */
    const r = blankProject();
    r.devices.push({ id: 1, name: "B1", cls: "AnalogIn", desc: "", opt: {}, unit: "bar", rmin: 0, rmax: 10, limHi: 8 }, { id: 2, name: "H1", cls: "DO", desc: "", opt: {}, unit: "", rmin: 0, rmax: 100, role: "fault" });
    r.nextId = 3;
    syncIO(r);
    for (const plat of ["siemens", "codesys"]) {
        const all = Object.values(genFor(r, plat)).join("\n");
        assert.ok(/machineFault\s*:\s*BOOL/.test(all) && /cmdAck\s*:\s*BOOL/.test(all), plat + ": deklarace poruchy stroje");
    }
    assert.ok(files["Gen_IO.xml"].includes('<Engineering version="V21" />'));
});
test("IEC MAIN kompletní pro všechny neSiemens platformy", () => {
    const p = sampleComplex();
    for (const plat of ["beckhoff", "codesys", "mitsubishi", "schneider", "omron"]) {
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
    const p1 = b.devices.find(d => d.name === "P1");
    assert.equal(p1.cls, "Motor");
    const t1 = b.devices.find(d => d.name === "T1");
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
    for (const d of p.devices)
        assert.ok(block.includes('data-dev="' + d.id + '"'), "blok zařízení " + d.name);
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
    const y6 = p.devices.find(d => d.name === "Y6");
    p.program.seq.find(s => s.dev === y6.id).cond = "fbk"; // i větev „bez snímače"
    const body = seqBody(p, "codesys").split("\n");
    p.program.seq.forEach((s, i) => {
        const n = 10 + i * 10;
        const at = body.findIndex(l => l.includes(n + ": (* Krok " + (i + 1) + ":"));
        assert.ok(at >= 0, "krok " + (i + 1) + " v generovaném kódu");
        const cond = body.slice(at, at + 3).find(l => l.includes("IF "));
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
    assert.ok(r.cycleTime > 8 && r.cycleTime < 8.3, "doba cyklu " + r.cycleTime);
    assert.deepEqual(r.outputsOn, []);
    const wait = r.steps[2];
    assert.ok(Math.abs(wait.tEnd - wait.tStart - 5) < 0.05, "výdrž 5 s");
    const m1 = p.devices.find(d => d.name === "M1"), out = ioOf(p, m1).outRun.key;
    const on = r.frames.filter(f => f.io[out] === true);
    assert.ok(on.length > 0 && on[0].t > r.steps[1].tStart && on[on.length - 1].t <= r.steps[3].tEnd, "motor běží jen mezi kroky start a stop");
});
test("generátor: ruční povely, hlídání kroků, porucha stroje a kvitace na všech platformách", () => {
    const p = sampleSmall();
    /* Rockwell (Logix ST, L5X) má vlastní testy výše */
    for (const plat of ["siemens", "beckhoff", "codesys", "mitsubishi", "schneider", "omron"]) {
        const files = genFor(p, plat);
        const main = files[plat === "siemens" ? "Gen_Main.scl" : "MAIN.st"];
        const lib = files[plat === "siemens" ? "Gen_Library.scl" : "Gen_Library.st"];
        const L = (v) => plat === "siemens" ? "#" + v : v;
        const R = (t) => plat === "siemens" ? '"' + t + '"' : (plat === "beckhoff" || plat === "codesys" || plat === "schneider") ? "GVL_IO." + t : t;
        for (const v of ["modeAuto", "cmdAutoStart", "cmdAck", "machineFault", "manRun_M1", "manOpen_Y1", "faultStep", "tonSeq10"]) {
            assert.ok(new RegExp("^\\s+" + v + " : ", "m").test(main), plat + ": deklarace " + v);
        }
        // sekvence: reset při poruše, start jen bez poruchy, hlídání kroku na zpětné hlášení
        assert.ok(main.includes("IF NOT " + L("modeAuto") + " OR NOT " + L("enable") + " OR " + L("machineFault") + " THEN"), plat);
        assert.ok(main.includes("IF " + L("modeAuto") + " AND " + L("enable") + " AND NOT " + L("machineFault") + " AND " + L("cmdAutoStart") + " THEN " + L("seqStep") + " := 10;"), plat);
        assert.ok(main.includes("IF " + R("Y1_fbkOpen") + " THEN " + L("seqStep") + " := 20;\n            ELSIF " + L("tonSeq10") + ".Q THEN " + L("machineFault") + " := TRUE; " + L("faultStep") + " := 10;"), plat);
        assert.ok(main.includes(L("tonSeq10") + "(IN := (" + L("seqStep") + " = 10), PT := T#5S);"), plat);
        assert.ok(main.includes("IF " + L("tonSeq30") + ".Q THEN " + L("seqStep") + " := 40; END_IF"), plat + ": výdrž beze změny");
        // instance: povel = sekvence NEBO ruční v ručním režimu; kvitace do bloku
        const cmd = L("seqRun_M1") + " OR (" + L("manRun_M1") + " AND NOT " + L("modeAuto") + ")";
        const rst = plat === "omron" ? "resetIn" : "reset"; // Sysmac: Reset je instrukce
        assert.ok(main.includes("cmdStart := " + cmd + ",\n        cmdStop := NOT (" + cmd + "),\n        " + rst + " := " + L("cmdAck") + ","), plat);
        assert.ok(main.includes("cmdOpen := " + L("seqOpen_Y1") + " OR (" + L("manOpen_Y1") + " AND NOT " + L("modeAuto") + "),"), plat);
        // porucha stroje za instancemi
        const err = L("instM1") + ".error OR " + L("instY1") + ".error";
        assert.ok(main.includes("IF " + err + " THEN " + L("machineFault") + " := TRUE; END_IF;\n    IF " + L("cmdAck") + " AND NOT (" + err + ") THEN " + L("machineFault") + " := FALSE; " + L("faultStep") + " := 0; END_IF;"), plat);
        assert.ok(main.indexOf(L("instY1") + "(enable") < main.indexOf("machineFault := FALSE") || plat === "siemens" && main.indexOf("#instY1(enable") < main.indexOf("#machineFault := FALSE"), plat + ": kvitace až za voláním bloků");
        // šablony bloků: vstup reset, stop během rozběhu, obrat ventilu, dva časovače
        assert.ok(new RegExp(rst + " : B(OOL|ool);").test(lib), plat + ": vstup reset");
        assert.ok(!/TODO: \+ ru[čc]n/.test(main), plat + ": žádné TODO místo ručního povelu");
        assert.ok(files["README.txt"].includes("cmdAck") && files["README.txt"].includes("manRun_*"), plat);
    }
    assert.ok(/10: \(\* STARTING \*\)\s+outRun := TRUE;\s+IF fbkRunning THEN statStep := 20; END_IF;\s+IF trigStop THEN statStep := 0; END_IF;/.test(ST_MOTOR), "stop během rozběhu");
    assert.ok(ST_MOTOR.includes("IF trigReset AND NOT fault THEN statStep := 0; END_IF"));
    assert.ok(/10: \(\* OPENING \*\)[\s\S]*?IF trigClose THEN statStep := 30; END_IF;\s+20:/.test(ST_VENTIL), "zavření během otevírání");
    assert.ok(ST_VENTIL.includes("tonOpen(IN := (statStep = 10), PT := T#5S);") && ST_VENTIL.includes("tonClose(IN := (statStep = 30), PT := T#5S);"));
    assert.ok(SCL_MOTOR.includes("IF #instTrigReset.Q AND NOT #fault THEN") && SCL_VENTIL.includes("#instTonClose(IN := (#statStep = #STEP_CLOSING)"));
    // bez sekvence: jen ruční povely (bez režimů), kvitace a porucha zůstávají
    const q = sampleSmall();
    q.program.seq = [];
    const main = genFor(q, "codesys")["MAIN.st"];
    assert.ok(main.includes("cmdStart := manRun_M1,\n        cmdStop := NOT (manRun_M1),\n        reset := cmdAck,"));
    assert.ok(!main.includes("modeAuto") && !main.includes("seqStep"));
    assert.ok(main.includes("IF cmdAck AND NOT (instM1.error OR instY1.error) THEN machineFault := FALSE; END_IF;"));
});
test("Unitronics: plochý ST pro UniLogic — bez FB, stav v globálních tazích, vše deklarováno", () => {
    assert.equal(PLAT.unitronics.ide, "UniLogic");
    const KEYWORDS = new Set(["IF", "THEN", "ELSE", "ELSIF", "END_IF", "CASE", "OF", "END_CASE", "AND", "OR", "NOT", "TRUE", "FALSE", "TO_REAL", "TO_INT", "IN", "PT", "Q"]);
    for (const mk of [sampleSmall, sampleComplex]) {
        const p = mk();
        const files = genFor(p, "unitronics");
        assert.deepEqual(Object.keys(files), ["Tags.csv", "Machine.st", "README.txt"]);
        const st = files["Machine.st"];
        // UniLogic ST = funkce bez paměti: žádné FB, deklarace ani RETURN; čisté ASCII
        for (const bad of [/FUNCTION_BLOCK/, /END_VAR/, /\bRETURN\b/, /GVL_IO\./, /16#/, /INT_TO_REAL/, /\binst\w+\(enable/, /[^\x00-\x7F]/]) {
            assert.ok(!bad.test(st), "nesmí obsahovat " + bad);
        }
        const count = (re) => (st.match(re) || []).length;
        assert.equal(count(/\bIF\b/g), count(/\bEND_IF;/g), "párování IF / END_IF;");
        assert.equal(count(/\bEND_IF\b/g), count(/\bEND_IF;/g), "každé END_IF končí středníkem");
        assert.equal(count(/\bCASE\b/g), count(/\bEND_CASE;/g));
        // každý použitý identifikátor je v seznamu tagů k založení
        const tags = new Set(files["Tags.csv"].split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "")));
        const code = st.replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/T#[\w.]+/g, " ").replace(/\b\d[\d.]*(?:E[+-]?\d+)?\b/gi, " ");
        const unknown = [...new Set(code.match(/[A-Za-z_]\w*/g) || [])].filter(w => !KEYWORDS.has(w) && !tags.has(w));
        assert.deepEqual(unknown, [], "nedeklarované tagy");
        assert.equal(tags.size, files["Tags.csv"].split("\n").length - 1, "tagy jsou unikátní");
        assert.ok(!/[^\x00-\x7F]/.test(files["Tags.csv"]), "seznam tagů je čisté ASCII");
        assert.ok(files["README.txt"].includes("NEOVĚŘENO PŘEKLADEM") && files["README.txt"].includes("Add Structured Text Function"));
    }
    const p = sampleSmall();
    p.platforms = ["unitronics"];
    const st = genFor(p, "unitronics")["Machine.st"];
    for (const want of [
        "enable := S1_in",
        "instM1_cmdStart := seqRun_M1 OR (manRun_M1 AND NOT modeAuto);",
        "instM1_cmdStop := NOT (seqRun_M1 OR (manRun_M1 AND NOT modeAuto));",
        "instM1_reset := cmdAck;",
        "IF NOT instM1_enable THEN",
        "instM1_status := 32769; instM1_statStep := 0;\n    ELSE",
        "instM1_tonFbk(IN := (instM1_statStep = 10), PT := T#3S);",
        "IF instM1_trigReset AND NOT instM1_fault THEN instM1_statStep := 0; END_IF;",
        "M1_outRun := instM1_outRun;",
        "instY1_tonClose(IN := (instY1_statStep = 30), PT := T#5S);",
        "instB1_value := TO_REAL(instB1_rawValue) / TO_REAL(instB1_rawMax)",
        "instB1_scaleMax := 250.0;",
        "IF Y1_fbkOpen THEN seqStep := 20;",
        "IF instM1_error OR instY1_error THEN machineFault := TRUE; END_IF;",
    ])
        assert.ok(st.includes(want), "chybí: " + want);
    const tags = genFor(p, "unitronics")["Tags.csv"];
    for (const row of ['"M1_outRun","BIT","I/O DO","%Q0.0"', '"B1_raw","INT16","I/O AI","%IW64"', '"seqStep","INT16","Program"', '"instY1_tonOpen","TON"', '"tonSeq10","TON"', '"instM1_status","UINT16"']) {
        assert.ok(tags.includes(row), "chybí řádek " + row);
    }
    assert.ok(allProjectFiles(p).some(f => f.save === "unitronics_Machine.st" && f.group === "PLC — Unitronics"));
    // šablona se rozepisuje ze stejného zdroje jako u ostatních platforem
    const { vars, body } = parseFbTemplate(ST_VENTIL);
    assert.deepEqual(vars.filter(v => v.kind === "in").map(v => v.name), ["enable", "cmdOpen", "cmdClose", "reset", "fbkOpen", "fbkClosed"]);
    assert.ok(body.startsWith("IF NOT enable THEN") && body.endsWith("END_IF;"));
});
test("simulace: výpadek zpětného hlášení → porucha stroje, sekvence do klidu, výstupy vypnuty", () => {
    const p = sampleSmall();
    const m1 = p.devices.find(d => d.name === "M1");
    const nominal = simulate(p);
    const at = nominal.steps[1].tStart;
    const r = simulate(p, { faults: [{ kind: "frozen", dev: m1.id, at }], maxTime: at + 6 });
    assert.equal(r.ok, false);
    assert.equal(r.faulted, true);
    assert.equal(r.faultStep, 1);
    assert.ok(Math.abs(r.faultT - at - 3) < 0.05, "hlídací čas kroku 3 s: porucha v čase " + r.faultT);
    assert.ok(r.faultCause.startsWith("timeout kroku 2 (M1 start"), r.faultCause);
    assert.equal(r.stalledStep, null, "sekvence nezůstane viset v kroku");
    assert.equal(r.frames[r.frames.length - 1].step, -1);
    assert.deepEqual(r.outputsOn, [], "po poruše je vypnutý i upínací ventil");
    assert.equal(r.fault, true, "porucha drží do kvitace");
    // slepený stykač při stopu: blok poruchu nehlásí, zachytí ji hlídací čas kroku
    const at2 = nominal.steps[3].tStart;
    const r2 = simulate(p, { faults: [{ kind: "frozen", dev: m1.id, at: at2 }], maxTime: at2 + 8 });
    assert.equal(r2.errors.length, 0);
    assert.equal(r2.faultStep, 3);
    assert.ok(Math.abs(r2.faultT - at2 - 3) < 0.05);
    assert.deepEqual(r2.outputsOn, []);
    // ztráta hlášení běhu za chodu: chyba bloku → porucha stroje
    const r3 = simulate(p, { faults: [{ kind: "frozen", dev: m1.id, at: 0 }, { kind: "fault", dev: m1.id, at: nominal.steps[2].tStart + 1 }], maxTime: 12 });
    assert.equal(r3.faulted, true);
    const r4 = simulate(p, { faults: [{ kind: "fault", dev: m1.id, at: nominal.steps[2].tStart + 1 }], maxTime: 12 });
    assert.equal(r4.faultCause, "chyba bloku M1");
    assert.equal(r4.errors[0].dev, m1.id);
    assert.deepEqual(r4.outputsOn, []);
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
    // start držený během E-stopu sekvenci nespustí (dříve se krok 1 „proklikával")
    const s = new Simulator(p);
    s.controls.estop = true;
    s.controls.start = true;
    s.run(1);
    assert.equal(s.seqIndex, -1);
});
test("živá simulace: START, E-stop, porucha a kvitace, ruční režim", () => {
    const p = sampleSmall();
    const tag = (t) => p.io.find(e => e.tag === t).key;
    const y1 = p.devices.find(d => d.name === "Y1"), m1 = p.devices.find(d => d.name === "M1");
    const sim = new Simulator(p);
    sim.run(1);
    assert.equal(sim.seqIndex, -1, "bez startu stroj stojí");
    sim.pressStart();
    sim.run(2);
    assert.equal(sim.seqIndex, 2, "po 2 s je sekvence ve výdrži");
    assert.deepEqual(sim.outputsOn().sort(), [tag("M1_outRun"), tag("Y1_outOpen")].sort());
    assert.equal(sim.frame().dev[y1.id].pos, 1, "válec vysunutý");
    sim.controls.estop = true; // E-stop: výstupy dolů, sekvence do klidu
    sim.run(0.05);
    assert.deepEqual(sim.outputsOn(), []);
    assert.equal(sim.frame().enable, false);
    assert.equal(sim.seqIndex, -1);
    sim.controls.estop = false;
    sim.run(2);
    assert.equal(sim.seqIndex, -1, "po uvolnění se cyklus sám neobnoví");
    assert.equal(sim.cycles, 0);
    sim.pressStart(); // nový start: celý cyklus
    sim.run(10);
    assert.equal(sim.cycles, 1);
    assert.equal(sim.lastCycleTime, simulate(p).cycleTime, "krokování dává stejný cyklus jako dávková simulace");
    sim.pressStart(); // zaseknutý válec → hlídací čas kroku → porucha stroje
    sim.run(0.5);
    sim.controls.frozen = [y1.id];
    sim.run(6);
    assert.equal(sim.frame().fault, true);
    assert.equal(sim.frame().faultStep, 0);
    assert.equal(sim.seqIndex, -1, "sekvence se vrátila do klidu");
    assert.deepEqual(sim.outputsOn(), []);
    sim.pressStart(); // bez kvitace start nezabere
    sim.run(1);
    assert.equal(sim.seqIndex, -1);
    sim.run(5); // válec se nevrátil → blok hlásí poruchu zavírání
    assert.equal(sim.frame().dev[y1.id].error, true);
    sim.pressAck(); // závada trvá: kvitace blok uvolní, ale…
    sim.controls.frozen = [];
    sim.run(2);
    assert.equal(sim.frame().dev[y1.id].error, false);
    assert.equal(sim.frame().fault, false, "po odstranění závady kvitace poruchu zruší");
    sim.pressStart();
    sim.run(10);
    assert.equal(sim.cycles, 2, "po kvitaci proběhne nový cyklus");
    sim.controls.man[y1.id] = true; // ruční povel v AUTO je neúčinný
    sim.run(1);
    assert.deepEqual(sim.outputsOn(), []);
    sim.controls.modeAuto = false; // ruční režim: povel platí, start ne
    sim.run(1.5);
    assert.deepEqual(sim.outputsOn(), [tag("Y1_outOpen")]);
    assert.equal(sim.frame().dev[y1.id].label, "otevřeno");
    sim.pressStart();
    sim.run(0.5);
    assert.equal(sim.seqIndex, -1, "bez režimu AUTO start nezabere");
    sim.controls.man[y1.id] = false;
    sim.controls.man[m1.id] = true;
    sim.controls.frozen = [m1.id]; // ruční chod bez zpětného hlášení → porucha bloku
    sim.run(4);
    assert.equal(sim.frame().dev[m1.id].error, true);
    assert.equal(sim.frame().fault, true);
    assert.equal(sim.frame().faultStep, null, "porucha bloku nemá krok sekvence");
    sim.controls.frozen = [];
    sim.run(1);
    assert.equal(sim.frame().dev[m1.id].error, true, "porucha bloku drží do kvitace");
    sim.pressAck();
    sim.run(0.5);
    assert.equal(sim.frame().dev[m1.id].error, false);
    assert.equal(sim.frame().fault, false);
    assert.deepEqual(sim.outputsOn(), [], "po kvitaci se motor sám znovu nerozběhne (povel potřebuje novou hranu)");
    const s2 = tag("S2_in"); // vstup snímače jde přepnout ručně (S2 = kryt)
    assert.equal(sim.frame().io[s2], true, "blokovací vstup je v klidu TRUE (kryt zavřen)");
    sim.controls.di[s2] = false;
    sim.controls.di[tag("M1_fbkRunning")] = true; // zpětné hlášení bloku přepsat nejde
    sim.controls.ai[tag("B1_raw")] = 27648; // analogový vstup jde nastavit
    sim.run(0.02);
    assert.equal(sim.frame().io[s2], false);
    assert.equal(sim.frame().enable, false, "otevřený kryt vypne enable");
    assert.equal(sim.frame().io[tag("M1_fbkRunning")], false);
    assert.equal(sim.frame().io[tag("B1_raw")], 27648);
});
test("živá simulace: vnucený vstup přebije model stroje a po uvolnění se vrátí k jeho stavu", () => {
    const p = sampleSmall();
    const tag = (t) => p.io.find(e => e.tag === t).key;
    const y1 = p.devices.find(d => d.name === "Y1"), m1 = p.devices.find(d => d.name === "M1");
    const sim = new Simulator(p);
    const io = (t) => sim.frame().io[tag(t)];
    const msgs = () => sim.events.map(e => e.msg);
    sim.controls.force[tag("Y1_fbkOpen")] = true; // „otevřeno" bez pohybu válce
    sim.applyInputs();
    assert.equal(io("Y1_fbkOpen"), true, "zásah je vidět i při zastaveném čase");
    sim.pressStart();
    sim.run(0.1);
    assert.equal(sim.seqIndex, 1, "program vnucenému hlášení věří — krok 1 hned potvrzen");
    assert.ok(sim.frame().dev[y1.id].pos < 1, "válec přitom teprve jede");
    /* vnucení zrušené dřív, než válec dojede: koncák „otevřeno" v držené poloze odpadne → porucha */
    const early = sim.clone();
    delete early.controls.force[tag("Y1_fbkOpen")];
    early.run(0.02);
    assert.equal(early.frame().io[tag("Y1_fbkOpen")], false, "po uvolnění platí stav stroje");
    assert.equal(early.frame().dev[y1.id].error, true, "ventil hlídá drženou polohu");
    sim.run(1.2); // válec dojel — teď uvolnění nic nezmění
    delete sim.controls.force[tag("Y1_fbkOpen")];
    sim.run(0.02);
    assert.equal(io("Y1_fbkOpen"), true);
    assert.equal(sim.frame().fault, false);
    assert.ok(msgs().includes("Y1_fbkOpen: vstup vnucen na TRUE"));
    assert.ok(msgs().includes("Y1_fbkOpen: vnucení vstupu zrušeno"));
    sim.run(2); // výdrž: motor běží
    assert.equal(sim.seqIndex, 2);
    assert.equal(io("M1_fbkRunning"), true);
    sim.controls.force[tag("M1_fbkRunning")] = false; // ztráta zpětného hlášení za chodu
    sim.run(0.05);
    assert.equal(sim.frame().dev[m1.id].error, true);
    assert.equal(sim.frame().fault, true);
    assert.deepEqual(sim.outputsOn(), [], "porucha bloku vypne povely sekvence");
    sim.controls.force = {};
    sim.pressAck();
    sim.run(2);
    assert.equal(sim.frame().fault, false);
    assert.equal(io("Y1_fbkClosed"), true, "stroj se pod vnucenou hodnotou hýbal dál");
    sim.controls.force[tag("S1_in")] = false; // vstup E-stopu: FALSE = rozpojený okruh
    sim.controls.force[tag("B1_raw")] = 99999; // analog se ořízne na rozsah modulu
    sim.run(0.02);
    assert.equal(sim.frame().enable, false);
    assert.equal(io("B1_raw"), 27648);
    sim.controls.force = {};
    sim.run(0.02);
    assert.equal(sim.frame().enable, true);
    assert.equal(io("B1_raw"), 13824);
});
test("blokové schéma stroje: blok pro každé zařízení, kontrolka pro každý signál", () => {
    const p = sampleSmall();
    const svg = svgMachine(p);
    for (const d of p.devices)
        assert.ok(svg.includes('<g data-dev="' + d.id + '">'), d.name);
    assert.equal((svg.match(/<g data-io=/g) || []).length, p.io.length);
    assert.equal((svg.match(/<circle /g) || []).length, p.io.length);
    assert.ok(svg.includes("E-stop → enable") && svg.includes("kroky 2, 4"));
    assert.ok(svgMachine(blankProject()).includes("nemá žádná zařízení"));
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
    const y6 = p.devices.find(d => d.name === "Y6");
    p.program.seq.find(s => s.dev === y6.id && s.act === "open").cond = "fbk";
    assert.ok(verifyProject(p).checks.some(c => c.level === "warn" && /nepotvrzuje/.test(c.title) && c.dev === y6.id));
    // E-stop jako spínací kontakt → upozornění; bez sekvence není co simulovat
    const q = sampleSmall();
    q.io.find(e => e.tag === "S1_in").nc = false;
    assert.ok(verifyProject(q).checks.some(c => /není označen jako NC/.test(c.title)));
    q.program.seq = [];
    assert.equal(verifyProject(q).nominal, null);
});
test("ověření: matice stavů — každý krok × každý zásah, vyhodnocení proti konceptu", () => {
    const p = sampleComplex();
    const v = verifyProject(p);
    const m = v.matrix;
    assert.deepEqual(m.cols.map(c => c.id).slice(0, 6), ["estop", "lock-" + p.devices.find(d => d.name === "S2").id,
        "lock-" + p.devices.find(d => d.name === "S3").id, "lock-" + p.devices.find(d => d.name === "S4").id, "manual", "fbk"]);
    assert.equal(m.rows.length, p.program.seq.length + 2, "klid + ruční režim + každý krok");
    assert.equal(m.failed, 0);
    assert.ok(m.total > 120, "složitá linka: přes 120 kombinací");
    for (const r of m.rows) {
        for (const id of r.step === -2 ? ["estop"] : ["estop", "manual"])
            assert.equal(r.cells[id].ok, true, r.title + " / " + id);
        for (const c of Object.values(r.cells))
            if (c.ok !== null)
                assert.ok(c.scenario && c.scenario.opts.faults.length, "buňka jde přehrát");
    }
    const step2 = m.rows.find(r => r.step === 1); // M1 start: hlídání hlášení 3 s
    assert.equal(step2.cells.fbk.text, "✔ 3 s");
    assert.equal(m.rows[0].cells.fbk.ok, null, "v klidu není co zamrazit");
    assert.ok(v.checks.some(c => c.level === "ok" && /Všechny stavy odpovídají konceptu \(\d+ kombinací\)/.test(c.title)));
    /* koncept: vstupy, které program nečte, a výstupy, které neovládá */
    assert.ok(v.checks.some(c => c.level === "warn" && /^Koncept stroje není v programu pokrytý celý/.test(c.title)));
    for (const n of ["S5", "S6", "S7", "S8"])
        assert.ok(v.checks.some(c => c.title.startsWith("Vstup " + n + " ") && /nečte/.test(c.title)), n);
    for (const n of ["H1", "H4"])
        assert.ok(v.checks.some(c => c.title.startsWith("Výstup " + n + " ") && /neovládá/.test(c.title)), n);
    assert.ok(v.checks.some(c => /Blokování S4 není rozpínací/.test(c.title)));
    assert.ok(!v.checks.some(c => /Vstup S2 /.test(c.title)), "blokování program čte");
    /* zásahy jdou přehrát i dávkovou simulací */
    const lock = step2.cells["lock-" + p.devices.find(d => d.name === "S4").id].scenario;
    const r = simulate(p, lock.opts);
    assert.ok(r.events.some(e => e.msg.startsWith("Blokování S4 rozpojeno")));
    const man = simulate(p, step2.cells.manual.scenario.opts);
    assert.ok(!man.finished && man.outputsOn.length === 0, "vypnutí AUTO zastaví sekvenci");
    /* protokol obsahuje matici */
    const md = docVerifyMd(p);
    assert.ok(md.includes("## 3. Matice stavů") && md.includes("| Krok 2: M1 start |") && md.includes("Všech " + m.total + " kombinací odpovídá konceptu."));
    /* cache: druhé volání vrátí týž výsledek */
    assert.equal(verifyProject(p), v);
});
test("časové literály: celé sekundy i desetinné časy kroků", () => {
    assert.equal(timeLit(5), "T#5S");
    assert.equal(timeLit(1.5), "T#1S500MS");
    assert.equal(timeLit(0.25), "T#250MS");
    const p = sampleSmall();
    p.program.seq[2].timeS = 1.5; // výdrž 1,5 s
    for (const plat of Object.keys(PLAT)) {
        const all = Object.values(genFor(p, plat)).join("\n");
        if (plat === "rockwell") {
            assert.ok(all.includes("tonSeq30.PRE := 1500;"), plat);
            continue;
        } // Logix: TONR, PRE v ms
        assert.ok(all.includes("PT := T#1S500MS") || all.includes("PT := T#1S500MS)"), plat);
        assert.ok(!all.includes("T#1.5S"), plat);
    }
    assert.equal(simulate(p).ok, true);
});
test("ventil hlídá drženou polohu; matice: ztráta polohy, ruční režim; druhý cyklus", () => {
    for (const tpl of [SCL_VENTIL, ST_VENTIL])
        assert.ok(/NOT #?fbkOpen THEN #?statStep := (#STEP_ERROR|90)/.test(tpl), "šablona hlídá ztrátu polohy");
    const p = sampleSmall();
    const tag = (t) => p.io.find(e => e.tag === t).key;
    const sim = new Simulator(p);
    sim.pressStart();
    sim.run(3); // výdrž: Y1 drží otevřeno
    assert.equal(sim.frame().dev[p.devices.find(d => d.name === "Y1").id].label, "otevřeno");
    sim.controls.force[tag("Y1_fbkOpen")] = false; // upnutí povolilo
    sim.run(0.05);
    assert.equal(sim.frame().fault, true);
    assert.deepEqual(sim.outputsOn(), []);
    const v = verifyProject(p);
    assert.ok(v.matrix.cols.some(c => c.id === "lostv"));
    const man = v.matrix.rows.find(r => r.step === -2);
    assert.equal(man.title, "Ruční režim");
    assert.equal(man.cells.estop.ok, true);
    assert.equal(v.matrix.rows.find(r => r.step === 2).cells.lostv.ok, true, "výdrž: ztráta polohy Y1 → porucha");
    assert.ok(v.checks.some(c => c.level === "ok" && /^Druhý cyklus proběhne stejně \(8\.09 s\)/.test(c.title)));
    const q = sampleComplex(); // M1–M3 zůstávají v chodu → druhý cyklus je jiný
    assert.ok(verifyProject(q).checks.some(c => c.level === "warn" && /^Druhý cyklus trvá jinak/.test(c.title)));
    assert.ok(docFiles(p).find(f => f.path === "04_seznam_alarmu.csv").body.includes("A_Y1_POS"));
});
test("čekání na FALSE na začátku cyklu opravdu čeká a hlídací čas jde vyzkoušet", () => {
    const p = sampleSmall();
    p.devices.push({ id: p.nextId++, name: "S3", cls: "DI", desc: "Bedna na odpad plná", opt: {}, unit: "", rmin: 0, rmax: 100 });
    syncIO(p);
    const s3 = p.devices.find(d => d.name === "S3");
    p.program.seq.unshift({ dev: s3.id, act: "waitOff", cond: "fbk", timeS: 5 });
    const run = simulate(p);
    assert.ok(run.ok, "cyklus doběhne");
    const first = run.steps.find(s => s.i === 0);
    assert.ok(first.tEnd - first.tStart >= DI_DELAY - 1e-6, "krok čeká na proces, neprojde hned");
    const sim = new Simulator(p);
    sim.controls.modeAuto = true;
    sim.controls.frozen = [s3.id]; // bedna zůstane plná
    sim.pressStart();
    sim.run(7);
    assert.equal(sim.frame().fault, true, "vypršení hlídacího času = porucha stroje");
    assert.equal(verifyProject(p).matrix.failed, 0);
});
test("funkce stroje: čekání na vstup, meze analogů, žádaná hodnota, vazby výstupů, takt", () => {
    const p = sampleSmall();
    const dev = (n) => p.devices.find(d => d.name === n);
    const tag = (t) => p.io.find(e => e.tag === t).key;
    const add = (name, cls, desc, extra = {}) => {
        p.devices.push({ id: p.nextId++, name, cls, desc, opt: {}, unit: cls === "AnalogOut" ? "%" : "", rmin: 0, rmax: 100, ...extra });
    };
    add("S3", "DI", "Díl v upínači");
    add("H2", "DO", "Maják porucha", { role: "fault" });
    add("U1", "AnalogOut", "Tlak čerpadla", { setpoint: 70 });
    syncIO(p);
    dev("B1").limHi = 200;
    dev("B1").limLo = 50; // tlak hydrauliky 0–250 bar
    dev("H1").role = "ready";
    p.meta.takt = 12;
    p.program.seq.unshift({ dev: dev("S3").id, act: "waitOn", cond: "fbk", timeS: 10 });
    p.program.seq.push({ dev: dev("S3").id, act: "waitOff", cond: "fbk", timeS: 10 });
    for (const plat of Object.keys(PLAT)) {
        const all = Object.values(genFor(p, plat)).join("\n");
        assert.ok(/limitHi := 200\.0/.test(all) || /instB1_limitHi := 200\.0/.test(all), plat + ": mez B1");
        assert.ok(/alarmHi/.test(all) && /(H2_out"? := "?#?machineFault|H2_out := machineFault)/.test(all), plat + ": porucha z mezí, maják");
        assert.ok(/70\.0/.test(all), plat + ": žádaná hodnota U1");
        assert.ok(/IF "?S3_in"? THEN/.test(all) || /IF GVL_IO\.S3_in THEN/.test(all), plat + ": čekání na S3");
        assert.ok(!/TODO: [^\n]*žádaná hodnota/i.test(all), plat);
    }
    const run = simulate(p);
    assert.ok(run.ok, "cyklus s čekáním na díl doběhne");
    assert.ok(run.cycleTime > simulate(sampleSmall()).cycleTime, "čekání na díl prodlouží cyklus");
    const sim = new Simulator(p);
    sim.run(0.1);
    assert.equal(sim.frame().io[tag("H1_out")], true, "připraveno ke startu");
    sim.controls.force[tag("B1_raw")] = 27648; // 250 bar > 200
    sim.run(0.05);
    assert.equal(sim.frame().fault, true, "překročení meze = porucha stroje");
    assert.equal(sim.frame().io[tag("H2_out")], true, "maják porucha svítí");
    assert.ok(sim.events.some(e => e.msg.startsWith("B1 nad mezí")));
    delete sim.controls.force[tag("B1_raw")];
    sim.pressAck();
    sim.run(0.5);
    assert.equal(sim.frame().fault, false);
    const v = verifyProject(p);
    const m = v.matrix;
    assert.equal(m.failed, 0);
    assert.ok(m.cols.some(c => c.id === "limit"));
    const lim = m.rows.flatMap(r => r.cells.limit && r.cells.limit.ok ? [r.cells.limit.text] : []).join(" ");
    assert.ok(lim.includes("B1↑") && lim.includes("B1↓"), "obě meze vyzkoušené: " + lim);
    assert.ok(m.rows.some(r => r.cells.estop.text === "✔ ×3"), "zásah ve třech okamžicích kroku");
    assert.ok(v.checks.some(c => c.level === "ok" && /^Cyklus [\d.]+ s splňuje takt 12 s/.test(c.title)));
    assert.ok(!v.checks.some(c => /S3 .*nečte|H[12] .*neovládá|U1 .*není zadána|B1 .*se jen zobrazuje/.test(c.title)), "koncept zná nové funkce");
    p.meta.takt = 5;
    assert.ok(verifyProject(p).checks.some(c => c.level === "error" && /^Takt 5 s překročen/.test(c.title)));
    p.program.seq[1].timeS = 1.2; // Y1 otevřít trvá ~1 s
    assert.ok(verifyProject(p).checks.some(c => c.level === "warn" && /malá rezerva hlídacího času/.test(c.title)));
});
test("simulace z kontrolního bodu je shodná se simulací od začátku", () => {
    const p = sampleComplex();
    const cps = new Checkpoints(p);
    const v = verifyProject(p);
    const cells = v.matrix.rows.flatMap(r => Object.values(r.cells)).filter(c => c.scenario).map(c => c.scenario);
    const pick = [...v.scenarios.filter(s => s.id !== "nominal"), ...cells.filter((_x, i) => i % 7 === 0)];
    assert.ok(pick.length > 25);
    const strip = (r) => JSON.stringify({
        f: r.frames.map(fr => [fr.t, fr.step, fr.fault, fr.enable, fr.io]), e: r.events, s: r.steps, o: r.outputsOn,
        ff: [r.faulted, r.faultT, r.faultCause, r.faultStep, r.fault, r.finished, r.cycleTime, r.stalledStep, r.tEnd],
    });
    for (const sc of pick)
        assert.equal(strip(cps.run(sc.opts)), strip(simulate(p, sc.opts)), sc.id);
});
test("diagramy funkce: kroky s odkazy, časový diagram se signály", () => {
    const p = sampleSmall();
    const run = simulate(p);
    const flow = svgFlow(p, run);
    for (let i = -1; i < p.program.seq.length; i++)
        assert.ok(flow.includes('data-step="' + i + '"'), "krok " + i);
    assert.ok(flow.includes("Y1_fbkOpen"), "podmínka přechodu");
    assert.ok(flow.includes("cyklus " + run.cycleTime + " s"));
    const timing = svgTiming(p, run);
    assert.ok(timing.includes("M1_outRun") && timing.includes("S1_in"));
    assert.ok((timing.match(/<rect data-io=/g) || []).length >= 4, "pruhy signálů");
    const empty = blankProject();
    assert.ok(svgFlow(empty).includes("nemá automatickou sekvenci"));
});
test("kusovník: položky ze zařízení, PLC moduly platformy, volby uživatele", () => {
    const p = sampleComplex();
    p.platforms = ["codesys"];
    const b = buildBom(p);
    assert.equal(b.plat, "codesys");
    const by = (tag, cat) => b.lines.find(l => l.tag === tag && l.cat === cat);
    for (const d of p.devices.filter(d => d.cls === "Motor")) {
        const n = d.name.replace(/^\D+/, "");
        assert.ok(by("-" + d.name, "motor") || by("-" + d.name, "gearmotor") || by("-" + d.name, "pump"), d.name);
        assert.ok(by("-Q" + n, "motor_protection") && by("-K" + n, "contactor"), d.name + ": jištění a stykač");
    }
    assert.equal(by("-A2", "plc_di").qty, modules(p).filter(m => m.dir === "DI").length);
    assert.ok(by("-S1", "estop_button").safety, "E-stop jako HW s výhradou");
    assert.ok(b.lines.filter(l => l.safety).every(l => /13849/.test(l.note)));
    assert.ok(by("-K0", "safety_relay"));
    assert.deepEqual(b.lines.map(l => l.pos), b.lines.map((_, i) => i + 1));
    p.bom = { plat: "siemens", lines: { "-M1:gearmotor": { brand: "Vlastní", type: "XY 0,55 kW", qty: 2 } } };
    const b2 = buildBom(p);
    assert.equal(b2.plat, "siemens");
    const m1 = b2.lines.find(l => l.id === "-M1:gearmotor");
    assert.equal(m1.brand, "Vlastní");
    assert.equal(m1.qty, 2);
    assert.equal(m1.type, "XY 0,55 kW");
    const csv = bomCsv(p);
    assert.equal(csv.trim().split(/\r?\n/).length, b2.lines.length + 1);
    assert.ok(bomMd(p).includes("návrh k revizi"));
});
test("dokumentace: 11 dokumentů + schémata + soubory platforem", () => {
    const p = sampleComplex();
    p.platforms = ["siemens", "codesys"];
    assert.equal(docFiles(p).length, 11);
    const all = allProjectFiles(p);
    assert.ok(all.some(f => f.name === "blokove_schema.svg"));
    assert.ok(all.some(f => f.name === "funkcni_diagram.svg") && all.some(f => f.name === "casovy_diagram.svg"));
    const ver = all.find(f => f.name === "08_overeni_simulaci.md");
    assert.ok(/Doba cyklu: \d/.test(ver.body) && ver.body.includes("Neověřuje"));
    assert.ok(all.filter(f => f.kind === "dxf").length >= 5);
    assert.ok(all.some(f => f.group.includes("CODESYS") && f.name === "GVL_IO.st"));
    assert.ok(all.some(f => f.save === "siemens_Gen_Main.scl"));
    const dup = new Set();
    for (const f of all) {
        assert.ok(!dup.has(f.save), "duplicitní save: " + f.save);
        dup.add(f.save);
    }
});
test("dtFor: analogy INT, binární BOOL", () => {
    assert.equal(dtFor({ dir: "AI" }), "INT");
    assert.equal(dtFor({ dir: "DO" }), "BOOL");
});
test("blankProject je prázdný a konzistentní", () => {
    const p = blankProject();
    syncIO(p);
    assert.equal(p.io.length, 0);
    assert.equal(validateProject(p).length, 0);
});
test("blokování: kryty a závora jsou v enable kódu všech platforem a v simulaci zastaví stroj", () => {
    const p = sampleComplex();
    const tag = (t) => p.io.find(e => e.tag === t).key;
    assert.deepEqual(enableInputs(p).map(x => x.io.tag), ["S1_in", "S2_in", "S3_in", "S4_in"]);
    for (const plat of Object.keys(PLAT)) {
        const files = genFor(p, plat);
        const main = files["Gen_Main.scl"] || files["MAIN.st"] || files["Machine.st"] || files["MainRoutine.st"];
        assert.ok(/S1_in"? AND ("|GVL_IO\.)?S2_in"? AND ("|GVL_IO\.)?S3_in"? AND ("|GVL_IO\.)?S4_in/.test(main), plat + ": enable = E-stop AND blokování");
        const from = main.lastIndexOf("(DI/DO)");
        const freePart = main.slice(from, main.indexOf("END_", from) > 0 ? main.indexOf("END_", from) : undefined);
        assert.ok(!/S2_in|S4_in/.test(freePart), plat + ": blokování už není mezi volnými signály");
        assert.ok(freePart.includes("S7_in"), plat + ": ostatní volné signály zůstaly");
    }
    const sim = new Simulator(p);
    assert.equal(sim.frame().enable, true, "kryty v klidu zavřené, závora volná");
    sim.pressStart();
    sim.run(4);
    assert.ok(sim.seqIndex >= 1 && sim.outputsOn().length > 0);
    sim.controls.di[tag("S2_in")] = false; // otevřený kryt za chodu
    sim.run(0.05);
    assert.equal(sim.frame().enable, false);
    assert.deepEqual(sim.outputsOn(), [], "výstupy bloků vypnuté");
    assert.equal(sim.seqIndex, -1, "sekvence v klidu");
    assert.ok(sim.events.some(e => e.msg.startsWith("Blokování S2 rozpojeno")));
    sim.controls.di[tag("S2_in")] = true; // kryt zavřen: stroj stojí do nového startu
    sim.run(2);
    assert.equal(sim.seqIndex, -1);
    assert.ok(sim.events.some(e => e.msg.startsWith("Blokování S2 obnoveno")));
    sim.controls.force[tag("S4_in")] = false; // přerušená závora (vnucený vstup) — start nezabere
    sim.pressStart();
    sim.run(1);
    assert.equal(sim.seqIndex, -1);
    const v = verifyProject(p);
    for (const d of ["S2", "S3", "S4"]) {
        assert.ok(v.checks.some(c => c.level === "ok" && c.title.startsWith("Rozpojení blokování " + d + " zastaví stroj")), d);
    }
    assert.ok(docFiles(p).find(f => f.path === "04_seznam_alarmu.csv").body.includes("A_S4_OPEN"));
});
/* ------------------------------------------------------------ vícejazyčnost */
test("i18n: čeština je výchozí a klíčem je český text; chybějící překlad vrací češtinu", () => {
    assert.equal(getLang(), "cs");
    assert.deepEqual(Object.keys(LANGS), ["cs", "en", "de", "es", "zh"]);
    assert.equal(tr("Krok {n}: {title}", { n: 2, title: "M1 start" }), "Krok 2: M1 start");
    assert.equal(fill("{a} a {b}", { a: 1 }), "1 a {b}", "neznámý zástupný znak zůstane");
    assert.equal(setLang("xx"), "cs", "neznámý jazyk = čeština");
    withLang("en", () => {
        assert.equal(getLang(), "en");
        assert.equal(tr("text, který v katalogu není"), "text, který v katalogu není");
        assert.ok(tr("Zařízení") !== "Zařízení", "katalog EN je načtený");
    });
    assert.equal(getLang(), "cs", "withLang vrátí původní jazyk");
    const en = withLang("en", () => tr("Zařízení"));
    withLang("zh", () => {
        assert.equal(trx("Zařízení"), en, "technické výstupy jsou při čínštině anglicky");
        assert.ok(/[一-鿿]/.test(tr("Zařízení")), "texty UI čínsky");
    });
});
test("i18n: komentáře šablon bloků jsou v seznamu klíčů a překládají se až ve výstupu", () => {
    assert.deepEqual(templateComments().filter(c => !TPL_COMMENTS.includes(c)), []);
    assert.equal(trComments(ST_MOTOR), ST_MOTOR, "česky beze změny");
    withLang("en", () => {
        const lib = genFor(sampleSmall(), "codesys")["Gen_Library.st"];
        assert.ok(lib.includes("FUNCTION_BLOCK FB_Motor") && lib.includes("END_FUNCTION_BLOCK"));
        assert.ok(!/[ěščřžýáíéůúďťň]/i.test(lib), "komentáře knihovny jsou přeložené");
    });
});
test("i18n: výstupy ve všech jazycích — bez češtiny, bez nevyplněných zástupných znaků, technika v latince", () => {
    const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;
    for (const l of Object.keys(LANGS))
        withLang(l, () => {
            for (const mk of [sampleSmall, sampleComplex]) {
                /* obsah projektu (názvy a popisy zařízení) se nepřekládá a jde i do komentářů kódu —
                   pro čínštinu proto ukázka s anglickým obsahem, ať se testují jen texty generátoru */
                const p = l === "zh" ? withLang("en", mk) : mk();
                p.platforms = Object.keys(PLAT);
                const files = allProjectFiles(p);
                assert.ok(files.length > 40, l);
                for (const f of files) {
                    const where = l + " / " + f.save;
                    if (f.kind === "dxf")
                        assert.ok(!/[^\x00-\x7F]/.test(f.body), where + ": DXF musí být ASCII");
                    if (/^unitronics_(Machine\.st|Tags\.csv)$/.test(f.save))
                        assert.ok(!/[^\x00-\x7F]/.test(f.body), where + ": Unitronics musí být ASCII");
                    if (f.kind === "text" && /\.(md|txt|csv)$/.test(f.save)) {
                        const left = f.body.match(/\{[a-z][A-Za-z]*\}/);
                        assert.ok(!left, where + ": nevyplněný zástupný znak " + (left && left[0]));
                    }
                    if (l !== "cs") {
                        /* kusovník: vlastní jména dodavatelů (firmy, města) se nepřekládají — jako obsah projektu */
                        const body = f.save.startsWith("09_kusovnik")
                            ? buildBom(p).lines.reduce((t, ln) => ln.supplier ? t.split(ln.supplier).join("") : t, f.body) : f.body;
                        const m = body.match(CZ);
                        assert.ok(!m, where + ": nepřeložený český text kolem „" + (m ? body.slice(Math.max(0, m.index - 40), m.index + 40) : "") + "“");
                    }
                    if (l === "zh" && (f.kind === "dxf" || /\.(scl|st)$/.test(f.save))) {
                        assert.ok(!/[一-鿿]/.test(f.body), where + ": kód a výkresy jsou při čínštině anglicky");
                    }
                }
                const sim = new Simulator(p);
                sim.pressStart();
                sim.run(3);
                sim.controls.estop = true;
                sim.run(0.1);
                const text = sim.events.map(e => e.msg).join("\n") + verifyProject(p).checks.map(c => c.title + " " + c.detail).join("\n");
                if (l !== "cs")
                    assert.ok(!CZ.test(text), l + ": hlášení simulace a nálezy ověření jsou přeložené");
            }
        });
    assert.equal(getLang(), "cs");
});
/* --- z main: PLCopen XML export a koncepty řešení (sloučeno 2026-10-03) --- */
test("PLCopen XML: POU, GVL s adresami, MAIN instance, escapování", () => {
    const p = sampleComplex();
    const xml = genPLCopenXML(p, "codesys");
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes('xmlns="http://www.plcopen.org/xml/tc6_0200"'));
    for (const pou of ["FB_Motor", "FB_Ventil", "FB_AnalogIn", "FB_AnalogOut"]) {
        assert.ok(xml.includes('<pou name="' + pou + '" pouType="functionBlock">'), pou);
    }
    assert.ok(xml.includes('<pou name="MAIN" pouType="program">'));
    assert.ok(xml.includes('<pouInstance name="MAIN" typeName="MAIN" />'));
    assert.ok(xml.includes('<globalVars name="GVL_IO">'));
    assert.ok(xml.includes('address="%IX0.0"'));
    assert.ok(xml.includes('<derived name="TON" />'));
    assert.ok(xml.includes('<derived name="FB_Motor" />'), "instance v MAIN");
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml), "žádné neescapované &");
    const body = xml.split("<ST>")[1];
    assert.ok(body.includes("CASE statStep OF"));
    assert.ok(!body.split("</ST>")[0].includes("VAR_INPUT"));
    /* TwinCAT: proměnné GVL s AT %I* / %Q* (linkování) */
    assert.ok(genPLCopenXML(p, "beckhoff").includes('address="%I*"'));
});
test("PLCopen XML je z FINÁLNÍHO výstupu generátoru (= Gen_Library.st a MAIN.st)", () => {
    const p = sampleComplex();
    for (const plat of ["codesys", "beckhoff", "schneider"]) {
        const files = genFor(p, plat);
        const xml = files["PLCopen_Import.xml"];
        const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        assert.ok(xml.includes(esc(parseStPou(files["MAIN.st"]).body)), plat + ": tělo MAIN shodné s MAIN.st");
        const fbs = splitLibrary(files["Gen_Library.st"]);
        assert.ok(fbs.length >= 4, plat);
        for (const fb of fbs)
            assert.ok(xml.includes(esc(parseStPou(fb).body)), plat + ": tělo " + parseStPou(fb).name);
        /* ruční povely, porucha stroje a středníky jsou v importu stejně jako v souborech */
        assert.ok(xml.includes("manRun_M1") && xml.includes("machineFault") && !/END_IF(?!;)/.test(xml), plat);
    }
});
test("parseStPou: interface a tělo z MAIN", () => {
    const p = sampleSmall();
    const main = parseStPou(genFor(p, "codesys")["MAIN.st"]);
    assert.equal(main.kind, "program");
    assert.equal(main.name, "MAIN");
    assert.ok(main.locals.some(v => v.name === "instM1" && v.type === "FB_Motor"));
    assert.ok(main.locals.some(v => v.type === "TON"));
    assert.ok(main.body.includes("instM1("));
    assert.ok(!main.body.includes("END_PROGRAM"));
});
test("genFor: PLCopen jen pro CODESYS rodinu", () => {
    const p = sampleSmall();
    for (const plat of ["codesys", "beckhoff", "schneider"]) {
        assert.ok("PLCopen_Import.xml" in genFor(p, plat), plat);
        assert.ok(genFor(p, plat)["README.txt"].includes("PLCopen_Import.xml"), plat + ": README");
    }
    for (const plat of ["rockwell", "siemens", "mitsubishi", "omron", "unitronics"])
        assert.ok(!("PLCopen_Import.xml" in genFor(p, plat)), plat);
});
test("koncept: normalizace, markdown a podmíněný dokument", () => {
    const prop = conceptNorm({
        questions: [], note: "srovnání",
        variants: [{
                nazev: "Centralizované PLC s pneumatikou", shrnuti: "Jedno CPU, vše v rozvaděči.",
                architektura: "S7-1500 + centrální I/O", pohony: "pneumatika", bezpecnost: "E-stop + relé",
                hmi: "7\" panel", odhadIO: { di: 24, do: 16, ai: 4, ao: 2 },
                doporucenePlatformy: ["siemens", "nesmysl"], rizika: ["takt"], pracnostMD: 12,
            }],
    });
    assert.equal(prop.variants.length, 1);
    assert.deepEqual(prop.variants[0].doporucenePlatformy, ["siemens"]);
    assert.equal(prop.variants[0].odhadIO.do, 16);
    const p = sampleSmall();
    const n = docFiles(p).length;
    assert.equal(n, 11, "bez konceptu 11 dokumentů");
    p.concept = { ...prop.variants[0], zadani: "zkušební stanice" };
    const files = docFiles(p);
    assert.equal(files.length, n + 1, "s konceptem o dokument víc");
    const km = files.find(f => f.path === CONCEPT_FILE);
    assert.ok(km.body.includes("Centralizované PLC"));
    assert.ok(km.body.includes("ISO 13849"));
    assert.ok(docFDSMd(p).includes("Zvolený koncept řešení"));
    assert.ok(conceptInstructions(p).includes("AKTUÁLNĚ ZVOLENÝ KONCEPT"));
    /* v cizím jazyce přeložené nadpisy, prompt dostane pokyn k jazyku */
    withLang("en", () => {
        assert.ok(!/Koncept řešení|Princip řešení/.test(docFiles(p).find(f => f.path === CONCEPT_FILE).body), "nadpisy přeložené");
        assert.ok(conceptInstructions(p).includes("English"));
    });
    assert.equal(blankProject().concept, null);
});
/* ================================================= import stávajícího zařízení (reverse.ts) */
const PLATS_ALL = ["siemens", "rockwell", "beckhoff", "codesys", "mitsubishi", "schneider", "omron", "unitronics"];
const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);
const TEST_DATA = new URL("../test-data/", import.meta.url);
function loadSample(prefix) {
    const name = ["00a_hydraulicka_stanice", "03_nytovaci_lis_NL-1", "07_transferova_lisovna_TL-07", "10_vyrobni_hala_linka_rozdelovacu"]
        .find(n => n.startsWith(prefix));
    const j = JSON.parse(readFileSync(new URL(name + ".plcstudio.json", SAMPLE_DIR), "utf8"));
    const p = j.prj || j;
    syncIO(p);
    return p;
}
const filesOf = (o) => Object.entries(o).map(([name, text]) => ({ name, text }));
const clonePrj = (p) => JSON.parse(JSON.stringify(p));
/** Srovnatelný obraz projektu: zařízení (jméno, třída, volby, rozsahy, meze, role), I/O, E-stop, blokování, sekvence. */
function rtView(p) {
    const dn = (id) => (p.devices.find(d => d.id === id) || { name: "" }).name;
    return {
        devs: p.devices.map(d => {
            const o = d.opt || {};
            const opt = d.cls === "Motor" ? { fbk: o.fbk !== false, fault: !!o.fault } : d.cls === "Ventil" ? { fbkOpen: o.fbkOpen !== false, fbkClosed: !!o.fbkClosed } : {};
            const an = d.cls === "AnalogIn" || d.cls === "AnalogOut";
            return JSON.stringify({ name: d.name, cls: d.cls, opt, rng: an ? [d.rmin, d.rmax] : null, lim: d.cls === "AnalogIn" ? [d.limLo ?? null, d.limHi ?? null] : null,
                sp: d.cls === "AnalogOut" ? d.setpoint ?? null : null, role: d.cls === "DO" ? d.role ?? null : null });
        }),
        io: p.io.map(e => dn(e.devId) + "." + e.sig + "=" + e.tag + "@" + e.addr + ":" + e.dir),
        estop: dn(p.program.estop),
        locks: interlockDevs(p).map(d => d.name),
        seq: p.program.seq.map(s => { const k = seqCond(p, s).kind; return [s.act === "wait" ? "" : dn(s.dev), s.act, k, k === "none" ? null : s.timeS].join("/"); }),
    };
}
test("import: round-trip vlastních výstupů — 8 platforem × ukázky a příklady", () => {
    const projects = [["sampleSmall", sampleSmall()], ["sampleComplex", sampleComplex()],
        ...["00a", "03", "07", "10"].map(n => [n, loadSample(n)])];
    projects.forEach(([name, p], pi) => {
        const want = rtView(p);
        for (const plat of PLATS_ALL) {
            const ex = extractFiles(filesOf(genFor(p, plat)));
            assert.equal(ex.platform, plat, name + "/" + plat + ": platforma");
            assert.equal(ex.unparsed.length, 0, name + "/" + plat + ": vše přečteno");
            const r = inferProject(ex);
            assert.deepEqual(rtView(r.prj), want, name + "/" + plat);
            assert.deepEqual(validateProject(r.prj).filter(i => i.level === "error"), [], name + "/" + plat + ": validace");
            assert.deepEqual(r.conflicts, [], name + "/" + plat + ": bez rozporů");
            /* náš formát: zařízení, kroky, E-stop (i Siemens — poznámka pod voláním v OB1) a blokování přesně */
            for (const [k, e] of Object.entries(r.evidence))
                if (/^(dev|seq|lock):|^estop$/.test(k))
                    assert.equal(e.conf, "sure", name + "/" + plat + " " + k);
            assert.ok(r.evidence["dev:" + r.prj.devices[0].name].src[0].file, "evidence má zdroj");
            /* ověření simulací: každý projekt na jiné platformě (výsledek je pro všechny platformy tentýž) */
            if (PLATS_ALL[pi % PLATS_ALL.length] === plat)
                assert.equal(verifyProject(r.prj).ok, true, name + "/" + plat + ": ověření simulací");
        }
    });
});
test("import: round-trip v dalších jazycích (komentáře generátoru přeložené)", () => {
    for (const l of ["en", "de", "es", "zh"])
        withLang(l, () => {
            const p = sampleComplex();
            p.devices.find(d => d.name === "H1").role = "lock"; // run × lock: stejný výraz, rozliší až komentář
            p.devices.find(d => d.name === "H2").role = "fault";
            p.devices.find(d => d.name === "B1").limHi = 220;
            p.devices.find(d => d.name === "U1").setpoint = 35.5;
            const want = rtView(p);
            for (const plat of PLATS_ALL)
                assert.deepEqual(rtView(inferProject(extractFiles(filesOf(genFor(p, plat)))).prj), want, l + "/" + plat);
        });
});
test("import: adresy — přesně tam, kde je výstup nese; jinak doplněné a hlášené", () => {
    const p = sampleSmall();
    const set = { M1_fbkRunning: "%I4.3", M1_outRun: "%Q2.6", B1_raw: "%IW80", Y1_fbkClosed: "%I1.7" };
    for (const e of p.io)
        if (set[e.tag])
            e.addr = set[e.tag];
    const all = Object.keys(set);
    const carry = {
        siemens: all, rockwell: all, codesys: all, schneider: all, unitronics: all,
        mitsubishi: ["M1_fbkRunning", "M1_outRun", "Y1_fbkClosed"], beckhoff: [], omron: [],
    };
    for (const plat of PLATS_ALL) {
        const r = inferProject(extractFiles(filesOf(genFor(p, plat))));
        for (const t of carry[plat])
            assert.equal(r.prj.io.find(e => e.tag === t).addr, set[t], plat + " " + t);
        const lost = all.filter(t => !carry[plat].includes(t));
        for (const t of lost)
            assert.equal(r.evidence["io:" + t].conf, "guess", plat + " " + t + ": adresa odhadem");
        if (lost.length)
            assert.ok(r.missing.some(m => m.includes("Adresy I/O chybí")), plat + ": hlášení chybějících adres");
        assert.deepEqual(validateProject(r.prj).filter(i => i.level === "error"), [], plat);
    }
});
test("import: kanonické adresy (inverze addrFor) a pomocné parsery", () => {
    assert.equal(canonAddr("%IX1.3", "codesys"), "%I1.3");
    assert.equal(canonAddr("%IW32", "codesys"), "%IW64", "CODESYS %IW = index slova");
    assert.equal(canonAddr("%IW64", "siemens"), "%IW64");
    assert.equal(canonAddr("%E0.1"), "%I0.1", "německá mnemonika TIA");
    assert.equal(canonAddr("%AW66"), "%QW66");
    assert.equal(canonAddr("Q0.2"), "%Q0.2");
    assert.equal(canonAddr("PIW256"), "%IW256");
    assert.equal(canonAddr("X13", "mitsubishi"), "%I1.3", "FX5 osmičkově");
    assert.equal(canonAddr("X1F"), "%I3.7", "hexadecimálně (iQ-R)");
    assert.equal(canonAddr("Y7"), "%Q0.7");
    assert.equal(canonAddr("%I*"), "");
    for (const e of sampleComplex().io)
        for (const plat of ["siemens", "codesys", "mitsubishi"]) {
            const a = addrFor(plat, e);
            if (a)
                assert.equal(canonAddr(a, plat), e.addr, plat + " " + e.tag);
        }
    assert.equal(parseTimeLit("T#1S500MS"), 1.5);
    assert.equal(parseTimeLit("t#2m"), 120);
    assert.equal(parseTimeLit("TIME#250ms"), 0.25);
    assert.deepEqual(splitTag("M1_fbkRunning"), { dev: "M1", sig: "fbkRunning", sure: true });
    assert.equal(splitTag("Pump1Fbk", "DI").dev, "Pump1");
    assert.equal(splitTag("Pump1Fbk", "DI").sig, "fbkRunning");
    assert.equal(splitTag("M1_Ein", "DO").sig, "outRun");
    assert.equal(splitTag("Y1_Open", "DO").sig, "outOpen");
    assert.equal(splitTag("Motor_Run", "DO").dev, "Motor");
    assert.equal(splitTag("xValve2_Opened", "DI").dev, "Valve2", "maďarská notace pryč");
    const x = parseXml('<a x="1&amp;2"><b><![CDATA[<raw>]]></b><b>t&lt;</b></a>');
    assert.deepEqual(xmlAll(x, "b").map(n => n.text), ["<raw>", "t<"]);
    assert.equal(xmlAll(x, "a")[0].attrs.x, "1&2");
});
test("import: TIA Portal — SimaticML tabulka tagů a export tabulky do CSV (německá mnemonika)", () => {
    const xml = readFileSync(new URL("tia_PLC_tags.xml", TEST_DATA), "utf8");
    const ex = extractFiles([{ name: "tia_PLC_tags.xml", text: xml }]);
    assert.equal(ex.platform, "siemens");
    assert.equal(ex.signals.length, 7, "%M merker se nepočítá mezi I/O");
    const r = inferProject(ex);
    const d = (n) => r.prj.devices.find(x => x.name === n);
    assert.equal(d("Pump1").cls, "Motor");
    assert.deepEqual([d("Pump1").opt.fbk, d("Pump1").opt.fault], [true, true]);
    assert.equal(d("Y1").cls, "Ventil");
    assert.equal(d("PT101").cls, "AnalogIn");
    assert.deepEqual([d("PT101").rmin, d("PT101").rmax, d("PT101").unit], [0, 10, "bar"], "rozsah z komentáře");
    assert.equal(r.prj.io.find(e => e.tag === "Pump1_Trip").sig, "fault");
    assert.equal(r.prj.program.estop, d("EStop_OK").id, "E-stop podle popisu (bez programu odhadem)");
    assert.equal(r.evidence.estop.conf, "guess");
    assert.equal(r.evidence["dev:Pump1"].conf, "guess");
    assert.equal(r.evidence["io:Pump1_Run"].src[0].file, "tia_PLC_tags.xml");
    assert.ok(r.evidence["io:Pump1_Run"].src[0].line > 1);
    assert.ok(r.missing.length >= 2, "chybí program a takt");
    assert.deepEqual(validateProject(r.prj).filter(i => i.level === "error"), []);
    const csv = readFileSync(new URL("tia_PLCTags_de.csv", TEST_DATA), "utf8");
    const r2 = inferProject(extractFiles([{ name: "PLCTags.csv", text: csv }]));
    const m1 = r2.prj.devices.find(x => x.name === "M1");
    assert.equal(m1.cls, "Motor");
    assert.equal(r2.prj.io.find(e => e.tag === "M1_Ein").addr, "%Q0.0", "%A → %Q");
    assert.equal(r2.prj.io.find(e => e.tag === "M1_RM").sig, "fbkRunning");
    assert.equal(r2.prj.io.find(e => e.tag === "Druck_Ist").addr, "%IW64", "%EW → %IW");
    assert.ok(!r2.prj.io.some(e => e.tag === "Merker_Takt"), "merker ne");
    assert.equal(r2.prj.devices.find(x => x.name === "Schutztuer_zu").cls, "DI", "„zu“ bez výstupu není ventil");
    assert.equal(r2.prj.program.estop, r2.prj.devices.find(x => x.name === "NotHalt_OK").id);
    /* dva podklady ke stejnému označení (I/O list + tabulka tagů): jedno Y1 a rozpor, ne Y1_Open / Y1_Opened navíc */
    const cz = readFileSync(new URL("io_list_cz.csv", TEST_DATA), "utf8");
    const r3 = inferProject(extractFiles([{ name: "IO_list.csv", text: cz }, { name: "tia_PLC_tags.xml", text: xml }]));
    assert.deepEqual(r3.prj.devices.filter(d => /^Y1/.test(d.name)).map(d => d.name + ":" + d.cls), ["Y1:Ventil"]);
    assert.ok(r3.conflicts.some(c => c.what === "dev:Y1"), "rozpor rolí Y1");
    assert.deepEqual(validateProject(r3.prj).filter(i => i.level === "error"), []);
});
test("import: Rockwell L5X z Logix — aliasy na moduly 1769, AOI, TONR, sekvence z CASE (odhadem)", () => {
    const l5x = readFileSync(new URL("logix_Station10.L5X", TEST_DATA), "utf8");
    const ex = extractFiles([{ name: "Station10.L5X", text: l5x }]);
    assert.equal(ex.platform, "rockwell");
    assert.equal(ex.signals.length, 11, "jen aliasy na I/O, ne interní tagy");
    assert.ok(ex.pous.some(p => p.name === "Motor_AOI" && p.kind === "functionBlock"));
    assert.ok(ex.pous.some(p => p.name === "Sequence" && p.lang === "ST"));
    assert.ok(ex.pous.some(p => p.name === "MainRoutine" && p.lang === "LD"));
    const r = inferProject(ex);
    const p = r.prj, d = (n) => p.devices.find(x => x.name === n);
    assert.equal(d("Conv1").cls, "Motor", "instance AOI Motor_AOI");
    assert.equal(p.io.find(e => e.sig === "fault" && e.devId === d("Conv1").id).tag, "Conv1_OL", "parametr Overload → porucha");
    assert.equal(p.io.find(e => e.tag === "Conv1_Run").sig, "outRun", "výstup Out → povel");
    assert.equal(d("Clamp").cls, "Ventil");
    assert.deepEqual([d("Clamp").opt.fbkOpen, d("Clamp").opt.fbkClosed], [true, true]);
    assert.equal(p.io.find(e => e.tag === "EStop_OK").addr, "%I0.0");
    assert.equal(p.io.find(e => e.tag === "Conv1_Run").addr, "%Q0.0");
    assert.equal(p.io.find(e => e.tag === "PT101").addr, "%IW64");
    assert.equal(p.program.estop, d("EStop_OK").id, "E-stop z výrazu Enable");
    assert.deepEqual(p.program.interlocks, [d("Door_Closed").id], "kryt jako blokování");
    const seq = p.program.seq.map(s => [s.act === "wait" ? "" : p.devices.find(x => x.id === s.dev).name, s.act, s.timeS]);
    assert.deepEqual(seq.map(s => s.slice(0, 2)), [["Part_Present", "waitOn"], ["Clamp", "open"], ["Conv1", "start"], ["", "wait"], ["Conv1", "stop"], ["Clamp", "close"]]);
    assert.equal(seq[3][2], 4, "TONR PRE 4000 ms");
    assert.ok(Object.keys(r.evidence).filter(k => k.startsWith("seq:")).every(k => r.evidence[k].conf === "guess"), "cizí sekvence = odhad");
    assert.ok(r.evidence["seq:1"].src[0].line > 1 && r.evidence["seq:1"].src[0].quote.includes("20:"));
    assert.deepEqual(validateProject(p).filter(i => i.level === "error"), []);
});
test("import: GX Works3 globální návěští, Excel I/O list (česky) a Sysmac", () => {
    const gx = readFileSync(new URL("gxworks3_GlobalLabel.csv", TEST_DATA), "utf8");
    const ex = extractFiles([{ name: "GlobalLabel.csv", text: gx }]);
    assert.equal(ex.platform, "mitsubishi");
    assert.ok(!ex.signals.some(s => s.tag === "MAX_COUNT" || s.tag === "Count_Work"), "konstanty a datové registry ne");
    const r = inferProject(ex);
    const tag = (t) => r.prj.io.find(e => e.tag === t);
    assert.equal(tag("Box_Sensor").addr, "%I1.0", "X10 = osmý vstup (FX5 osmičkově)");
    assert.equal(tag("Conveyor_Trip").sig, "fault");
    assert.equal(tag("Pusher_Retracted").sig, "fbkClosed");
    assert.equal(tag("Level_AI").dir, "AI");
    assert.equal(r.evidence["io:Level_AI"].conf, "guess", "analog bez adresy");
    assert.equal(r.prj.devices.find(d => d.name === "Conveyor").desc, "Conveyor contactor");
    const cz = readFileSync(new URL("io_list_cz.csv", TEST_DATA), "utf8");
    const r2 = inferProject(extractFiles([{ name: "IO_list.csv", text: cz }]));
    const d = (n) => r2.prj.devices.find(x => x.name === n);
    assert.deepEqual(r2.prj.devices.map(x => x.name + ":" + x.cls), ["M1:Motor", "Y1:Ventil", "S1:DI", "S2:DI", "B1:AnalogIn", "H1:DO"]);
    assert.equal(r2.prj.io.find(e => e.tag === "M1_porucha").sig, "fault");
    assert.equal(r2.prj.io.find(e => e.tag === "Y1_zavreno").sig, "fbkClosed");
    assert.equal(r2.prj.io.find(e => e.tag === "B1").addr, "%IW64");
    assert.deepEqual([d("B1").rmin, d("B1").rmax, d("B1").unit], [0, 2000, "mm"]);
    assert.equal(r2.prj.program.estop, d("S1").id);
    assert.equal(d("S1").desc, "Nouzové zastavení (NC)");
    assert.equal(r2.prj.io.find(e => e.tag === "S1").nc, true);
    /* Sysmac: Name, Data Type, Initial Value, AT, Retain, Constant, Network Publish, Comment */
    const sys = "Conv_Run\tBOOL\t\t\tFALSE\tFALSE\tDo not publish\tConveyor contactor\nConv_Fbk\tBOOL\t\t\tFALSE\tFALSE\tDo not publish\tConveyor running\nLevel\tINT\t\t\tFALSE\tFALSE\tDo not publish\tLevel 0-100 %";
    const ex3 = extractFiles([{ name: "Variables.txt", text: sys }]);
    assert.equal(ex3.platform, "omron");
    const r3 = inferProject(ex3);
    assert.equal(r3.prj.devices.find(x => x.name === "Conv").cls, "Motor");
    assert.equal(r3.prj.io.find(e => e.tag === "Conv_Run").cmt, "Conveyor contactor");
});
test("import: cizí CODESYS (GVL + PRG) a TIA SCL — instance, uvolnění, sekvence odhadem", () => {
    const gvl = `{attribute 'qualified_only'}
VAR_GLOBAL
    xEStop AT %IX0.0 : BOOL;         // Emergency stop OK (NC)
    xGuard AT %IX0.1 : BOOL;         // Guard closed
    xPump1_Fbk AT %IX0.2 : BOOL;     // Pump 1 running
    xPump1_Trip AT %IX0.3 : BOOL;    // Pump 1 thermal trip
    xTankFull AT %IX0.4 : BOOL;      // Tank full
    xValve2_Opened AT %IX0.5 : BOOL; // Drain valve open
    xPump1_Run AT %QX0.0 : BOOL;     // Pump 1 contactor
    xValve2_Open AT %QX0.1 : BOOL;   (* Drain valve solenoid *)
    iLevel AT %IW3 : INT;            // Tank level 0..2000 mm
END_VAR`;
    const prg = `PROGRAM PLC_PRG
VAR
    fbPump1 : FB_Pump;
    iStep : INT;
    tFill : TON;
    xEnable : BOOL;
    xStart : BOOL;
END_VAR
xEnable := GVL.xEStop AND GVL.xGuard;
CASE iStep OF
    0: IF xEnable AND xStart THEN iStep := 10; END_IF
    10: GVL.xValve2_Open := TRUE;
        IF GVL.xValve2_Opened THEN iStep := 20; END_IF
    20: fbPump1.xStart := TRUE;
        IF GVL.xTankFull THEN iStep := 30; END_IF
    30: fbPump1.xStart := FALSE; GVL.xValve2_Open := FALSE;
        IF tFill.Q THEN iStep := 0; END_IF
END_CASE
tFill(IN := iStep = 30, PT := T#3S);
fbPump1(xFbk := GVL.xPump1_Fbk, xTrip := GVL.xPump1_Trip, xOut => GVL.xPump1_Run);
END_PROGRAM`;
    const ex = extractFiles([{ name: "GVL.st", text: gvl }, { name: "PLC_PRG.st", text: prg }]);
    assert.equal(ex.platform, "codesys");
    const r = inferProject(ex);
    const p = r.prj, d = (n) => p.devices.find(x => x.name === n);
    assert.equal(p.io.find(e => e.tag === "iLevel").addr, "%IW6", "%IW3 (slovo) → %IW6");
    assert.equal(d("Pump1").cls, "Motor");
    assert.deepEqual([d("Pump1").opt.fbk, d("Pump1").opt.fault], [true, true]);
    assert.equal(p.io.find(e => e.tag === "xPump1_Run").sig, "outRun");
    assert.equal(d("Valve2").cls, "Ventil");
    assert.equal(p.program.estop, d("xEStop").id);
    assert.deepEqual(p.program.interlocks, [d("xGuard").id]);
    const seq = p.program.seq.map(s => (s.act === "wait" ? "" : p.devices.find(x => x.id === s.dev).name) + "/" + s.act + "/" + s.cond);
    assert.deepEqual(seq, ["Valve2/open/fbk", "Pump1/start/fbk", "xTankFull/waitOn/fbk", "Pump1/stop/fbk", "Valve2/close/time"]);
    assert.equal(p.program.seq[4].timeS, 3);
    assert.deepEqual(validateProject(p).filter(i => i.level === "error"), []);
    const tsv = "Name\tData Type\tLogical Address\tComment\nConv_RunFB\tBool\t%I0.0\tConveyor running\nConv_MSS\tBool\t%I0.1\tConveyor motor protection\nConv_K1\tBool\t%Q0.0\tConveyor contactor\nEmergency_OK\tBool\t%I0.2\tE-Stop";
    const scl = `FUNCTION_BLOCK "FB_Station"
{ S7_Optimized_Access := 'TRUE' }
VAR
   Conveyor : "FB_Conveyor";
   Step : Int;
END_VAR
BEGIN
   #Conveyor(Start := #Step = 20,
             RunFeedback := "Conv_RunFB",
             MotorProtection := "Conv_MSS",
             Contactor => "Conv_K1");
END_FUNCTION_BLOCK`;
    const r2 = inferProject(extractFiles([{ name: "tags.tsv", text: tsv }, { name: "FB_Station.scl", text: scl }]));
    const c = r2.prj.devices.find(x => x.name === "Conveyor");
    assert.equal(c.cls, "Motor", "typ FB_Conveyor");
    assert.equal(r2.prj.io.find(e => e.tag === "Conv_MSS").sig, "fault", "MotorProtection → porucha");
    assert.equal(r2.prj.io.find(e => e.tag === "Conv_K1").devId, c.id);
    assert.equal(r2.evidence["dev:Conveyor"].conf, "guess");
});
test("import: neznámé a binární soubory jdou AI vrstvě; mergeProposals — přesné má přednost", () => {
    const ex = extractFiles([
        { name: "schema.pdf", mime: "application/pdf", size: 120000 },
        { name: "stitek.jpg", mime: "image/jpeg" },
        { name: "popis.txt", text: "Stroj plní lahve. Po vložení palety se spustí dopravník a čeká se na čidlo." },
    ]);
    assert.equal(ex.unparsed.length, 3);
    assert.ok(ex.files.every(f => !f.ok));
    assert.ok(inferProject(ex).missing.some(m => m.includes("schema.pdf")));
    const a = inferProject(extractFiles([{ name: "GlobalLabel.csv", text: readFileSync(new URL("gxworks3_GlobalLabel.csv", TEST_DATA), "utf8") }]));
    assert.equal(a.prj.program.seq.length, 0);
    /* AI: doplní sekvenci, nové zařízení a mez; adresu Conveyor_Run hlásí jinak (rozpor) */
    const b = { prj: clonePrj(a.prj), evidence: {}, conflicts: [], missing: [] };
    const bp = b.prj;
    const conv = bp.devices.find(d => d.name === "Conveyor"), push = bp.devices.find(d => d.name === "Pusher");
    bp.io.find(e => e.tag === "Conveyor_Run").addr = "%Q3.0";
    bp.devices.find(d => d.name === "Level").limHi = 1800;
    bp.devices.push({ id: 99, name: "H9", cls: "DO", desc: "Maják", opt: {}, unit: "", rmin: 0, rmax: 100, role: "fault" });
    syncIO(bp);
    bp.program.seq = [{ dev: push.id, act: "open", cond: "fbk", timeS: 3 }, { dev: conv.id, act: "start", cond: "fbk", timeS: 3 }];
    bp.meta.takt = 12;
    b.evidence = { "seq:0": { conf: "guess", src: [{ file: "popis.pdf", page: 2 }] }, "dev:H9": { conf: "guess", src: [{ file: "schema.pdf", page: 4 }] },
        "io:Conveyor_Run": { conf: "guess", src: [{ file: "schema.pdf", page: 3 }] } };
    b.missing = ["Typ snímače hladiny ze schématu nečitelný."];
    const m = mergeProposals(a, b);
    assert.equal(m.prj.io.find(e => e.tag === "Conveyor_Run").addr, "%Q0.0", "přesná adresa zůstává");
    assert.ok(m.conflicts.some(c => c.what === "io:Conveyor_Run"), "rozpor adres hlášen");
    assert.ok(m.prj.devices.some(d => d.name === "H9" && d.role === "fault"), "AI doplní zařízení");
    assert.ok(m.prj.io.some(e => e.tag === "H9_out"), "i jeho signál");
    assert.equal(m.prj.devices.find(d => d.name === "Level").limHi, 1800, "AI doplní mez");
    assert.equal(m.prj.program.seq.length, 2);
    assert.equal(m.prj.program.seq[0].dev, m.prj.devices.find(d => d.name === "Pusher").id);
    assert.equal(m.prj.meta.takt, 12);
    assert.equal(m.evidence["dev:H9"].src[0].page, 4);
    assert.equal(m.evidence["seq:0"].src[0].file, "popis.pdf");
    assert.ok(!m.missing.some(x => /Takt|Sekvence|Program/.test(x)), "sekvence a takt už nechybí");
    assert.ok(m.missing.includes("Typ snímače hladiny ze schématu nečitelný."), "missing z AI zůstává");
    /* adresy, které AI vrstva jen doplnila (bez evidence), nejsou adresy od AI → žádné falešné rozpory */
    const b2 = { prj: clonePrj(a.prj), evidence: {}, conflicts: [], missing: [] };
    for (const e of b2.prj.io)
        e.addr = "";
    autoAddr(b2.prj, true);
    b2.prj.io.reverse().forEach((e, i, arr) => { if (i < arr.length / 2) {
        const t = e.addr;
        e.addr = arr[arr.length - 1 - i].addr;
        arr[arr.length - 1 - i].addr = t;
    } });
    const m2 = mergeProposals(a, b2);
    assert.deepEqual(m2.conflicts.filter(c => c.what.startsWith("io:")), [], "bez falešných rozporů adres");
    assert.deepEqual(m2.prj.io.map(e => e.addr), a.prj.io.map(e => e.addr));
    assert.deepEqual(validateProject(m.prj).filter(i => i.level === "error"), []);
});
/* reálné výňatky (licence a zdroje v test-data/real/README.md) */
const REAL = new URL("../test-data/real/", import.meta.url);
const realFile = (n) => ({ name: n, text: readFileSync(new URL(n, REAL), "utf8") });
test("import: reálné — PLCopen SFC (taveren, balicí stroj) → sekvence s evidencí", () => {
    const ex = extractFiles([realFile("taveren_packaging_sfc.plc.xml")]);
    assert.ok(ex.files[0].ok && /SFC/.test(ex.files[0].note || ""));
    const r = inferProject(ex), p = r.prj;
    assert.equal(p.devices.length, 9);
    const d = (n) => p.devices.find(x => x.name === n);
    assert.equal(d("conveyor").cls, "Motor");
    assert.equal(d("product_valve").cls, "Ventil");
    assert.equal(d("start_button").cls, "DI");
    assert.equal(d("red_light").cls, "DO", "akce kroku = výstup");
    const seq = p.program.seq.map(s => (s.dev ? p.devices.find(x => x.id === s.dev).name : "") + "/" + s.act);
    assert.equal(seq.length, 9);
    for (const st of ["conveyor/start", "product_sensor/waitOn", "product_valve/open", "product_valve/close"])
        assert.ok(seq.includes(st), st);
    assert.ok(seq.indexOf("conveyor/start") < seq.indexOf("product_valve/open"), "pořadí kroků SFC");
    for (let i = 0; i < seq.length; i++) {
        assert.equal(r.evidence["seq:" + i].conf, "guess");
        assert.ok(/SFC/.test(r.evidence["seq:" + i].src[0].quote || ""), "zdroj = krok SFC");
    }
    assert.deepEqual(validateProject(p).filter(i => i.level === "error"), []);
});
test("import: reálné — L5X s konvencí I_/O_ (Apache-2.0) a výňatek BNL s AOI ve FBD (BSD-3)", () => {
    const r = inferProject(extractFiles([realFile("assembly_inspection_ladder.L5X")]));
    const p = r.prj, d = (n) => p.devices.find(x => x.name === n);
    assert.equal(p.io.length, 14, "jen I_/O_ tagy, ne stavové S_ / C_");
    assert.equal(p.devices.length, 13);
    assert.equal(d("Clamp").cls, "Ventil", "cívka + potvrzení upnutí");
    assert.deepEqual(p.io.filter(e => e.devId === d("Clamp").id).map(e => e.tag).sort(), ["I_ClampConfirm", "O_ClampSolenoid"]);
    assert.equal(d("Conveyor").cls, "Motor");
    assert.equal(d("LightCurtainClear").cls, "DI");
    assert.equal(p.program.estop, d("EStopOk").id);
    assert.ok(r.missing.some(m => /S_StartLatched|C_ClampRequest/.test(m)), "vnitřní tagy v missing, ne jako zařízení");
    const r2 = inferProject(extractFiles([realFile("bnl_vacuum_excerpt.L5X")]));
    const v = r2.prj.devices.find(x => x.name === "IDA_VA_BC1_GV2_D_1");
    assert.equal(v.cls, "Ventil", "instance GV_HNDL (FBD) = ventil");
    const sig = (s) => r2.prj.io.find(e => e.devId === v.id && e.sig === s).tag;
    assert.deepEqual([sig("fbkOpen"), sig("fbkClosed"), sig("outOpen")], ["IDA_VA_BC1_GV2_D_1_Opn", "IDA_VA_BC1_GV2_D_1_Cls", "IDA_VA_BC1_GV2_D_1_Coil"]);
    assert.match(r2.evidence["dev:IDA_VA_BC1_GV2_D_1"].note || "", /GV_HNDL/);
    assert.equal(r2.prj.devices.length, 2);
    assert.ok(r2.prj.io.find(e => e.tag === "IDA_VA_BC1_GV2_D_1_Opn").addr !== r2.prj.io.find(e => e.tag === "IDA_VA_BC1_CCG1_1_Sts").addr, "moduly Drop_FOE:3 a Local:1 se nepřekrývají");
    assert.deepEqual(validateProject(r2.prj).filter(i => i.level === "error"), []);
});
test("import: reálné — TwinCAT GVL s TcLinkTo (SLAC crixs, BSD-3): instance = zařízení, svorky EtherCAT", () => {
    const ex = extractFiles([realFile("crixs_vac_excerpt.TcGVL")]);
    assert.equal(ex.platform, "beckhoff");
    assert.equal(ex.signals.length, 8);
    const r = inferProject(ex), p = r.prj, d = (n) => p.devices.find(x => x.name === n);
    assert.deepEqual(p.devices.map(x => x.name + ":" + x.cls), ["CRIX_VGC_01:Ventil", "CRIX_VVC_10:Ventil", "CRIX_PTM_01:Motor", "CRIX_GPI_01:AnalogIn"]);
    assert.deepEqual([d("CRIX_VGC_01").opt.fbkOpen, d("CRIX_VGC_01").opt.fbkClosed], [true, true]);
    assert.deepEqual([d("CRIX_PTM_01").opt.fbk, d("CRIX_PTM_01").opt.fault], [true, true]);
    const e = p.io.find(x => x.devId === d("CRIX_VGC_01").id && x.sig === "fbkOpen");
    assert.match(e.cmt, /CRIX:VGC:01.*E41 \(EL1004\)/, "popis z pytmc + svorka a kanál");
    assert.equal(p.io.find(x => x.devId === d("CRIX_GPI_01").id).dir, "AI", "EL3174 = analogový vstup");
    assert.deepEqual(validateProject(p).filter(i => i.level === "error"), []);
});
test("import: binární projekty IDE se ohlásí s doporučeným exportem", () => {
    const ex = extractFiles([{ name: "_01_VE_K.ACD", size: 1131210 }, { name: "station.zap15" }, { name: "a.gxw" }]);
    assert.equal(ex.unparsed.length, 3);
    assert.ok(ex.files.every(f => !f.ok && f.note), "u každého doporučení exportu");
    assert.match(ex.files[0].note || "", /L5X/);
});
test("import: texty hlášení jsou přeložené", () => {
    const cz = readFileSync(new URL("io_list_cz.csv", TEST_DATA), "utf8");
    const csMissing = inferProject(extractFiles([{ name: "x.pdf", mime: "application/pdf" }, { name: "IO.csv", text: cz }])).missing;
    for (const l of ["en", "de", "es", "zh"])
        withLang(l, () => {
            const r = inferProject(extractFiles([{ name: "x.pdf", mime: "application/pdf" }, { name: "IO.csv", text: cz }]));
            assert.equal(r.missing.length, csMissing.length, l);
            r.missing.forEach((m, i) => assert.ok(m !== csMissing[i], l + ": " + m));
            assert.ok(extractFiles([{ name: "x.pdf", mime: "application/pdf" }]).files[0].fmt !== "dokument / obrázek (zpracuje AI)", l);
        });
});
