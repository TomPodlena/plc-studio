/**
 * Regrese z forenzního fuzzu jádra (2026-10-06): náhodné projekty mimo 18 příkladů našly místa, kde
 * validace pustila projekt, jehož kód se nepřeloží / rozejde s návrhem, a pády dokumentace a importu.
 * Každý test = minimální reprodukce jednoho nálezu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankProject, syncIO, validateProject, devDefaults } from "./model.js";
import { setIoTag, renameDevice, insertStep, updateStep, stepProblem, addDevice, applyAiProposal, deviceParamsProblem, setDeviceParams, setDeviceRange } from "./edit.js";
import { genFor } from "./codegen.js";
import { setLang } from "./i18n.js";
import { sampleSmall } from "./samples.js";
import { docFiles, docAlarmCsv } from "./docs.js";
import { buildHmi } from "./hmi.js";
import { registerHmiModule } from "./hmi_docs.js";
import { emulateCompile } from "./emu/index.js";
import { extractFiles, inferProject } from "./reverse.js";
import { buildBom } from "./bom.js";
import { commissioningPlan } from "./commission.js";
const S11 = new URL("../../../samples/11_podavaci_lisovaci_stanice_PS-11.plcstudio.json", import.meta.url);
function load11() {
    const raw = JSON.parse(readFileSync(S11, "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    syncIO(prj);
    return prj;
}
const errors = (p) => validateProject(p).filter(i => i.level === "error").map(i => i.msg);
const findings = (p, plat) => {
    const r = emulateCompile(p, plat);
    return (Array.isArray(r) ? r : r.findings || []).filter(f => f.level === "error");
};
const pv = (p) => p.devices.find(d => d.cls === "PropValve");
test("forenz: PropValve doba odchylky nad 3 276,7 s (tolTicks INT) = chyba validace", () => {
    setLang("cs");
    const p = load11();
    assert.deepEqual(errors(p), []);
    pv(p).tolTimeS = 5000;
    assert.ok(errors(p).some(m => /Doba odchylky/.test(m)));
    pv(p).tolTimeS = 3276.7;
    assert.ok(!errors(p).some(m => /Doba odchylky/.test(m)));
});
test("forenz: PropValve odchylka pod rozlišením analogu platforem projektu = chyba validace", () => {
    setLang("cs");
    const p = load11();
    const d = pv(p);
    d.tol = (d.rmax - d.rmin) / 1000; // ~ 10–30 kroků nejhrubšího modulu: v pořádku
    assert.ok(!errors(p).some(m => /kroky analogového modulu/.test(m)));
    d.tol = (d.rmax - d.rmin) / 100000; // pod krokem modulu
    assert.ok(errors(p).some(m => /kroky analogového modulu/.test(m)));
    p.platforms = ["rockwell"]; // Logix: analogy REAL v %, bez kvantizace → jen 27648 simulátoru
    d.tol = (d.rmax - d.rmin) / 20000;
    assert.ok(errors(p).some(m => /kroky analogového modulu/.test(m)));
});
test("forenz: Mitsubishi FX5 — čas nad 3 276,7 s a čas nad 32,767 s mimo násobek 0,1 s = chyba", () => {
    setLang("cs");
    const p = sampleSmall();
    p.platforms = ["mitsubishi"];
    const s = p.program.seq.find(x => x.act === "wait") || p.program.seq[0];
    s.timeS = 4000;
    assert.ok(errors(p).some(m => /TIMER_100_FB_M \(3 276,7 s\)/.test(m)));
    s.timeS = 40.05;
    assert.ok(errors(p).some(m => /násobkem 0,1 s/.test(m)));
    s.timeS = 40;
    assert.ok(!errors(p).some(m => /FX5/.test(m)));
    p.platforms = ["codesys"]; // jiné platformy časovač 100 ms nemají
    s.timeS = 40.05;
    assert.ok(!errors(p).some(m => /FX5/.test(m)));
});
test("forenz: záporný čas kroku a čas nad 24 h = chyba validace", () => {
    setLang("cs");
    const p = sampleSmall();
    p.program.seq[0].timeS = -1;
    assert.ok(errors(p).some(m => /nula nebo kladné/.test(m)));
    p.program.seq[0].timeS = 90000;
    assert.ok(errors(p).some(m => /24 h/.test(m)));
});
test("forenz: zařízení „END_IF“ — Rockwell a Unitronics přeloží (náhrada END_IF; jen celé slovo)", () => {
    setLang("cs");
    const p = sampleSmall();
    const d = p.devices.find(x => x.cls === "DI");
    d.name = "END_IF";
    syncIO(p);
    assert.deepEqual(errors(p), []);
    for (const plat of ["rockwell", "unitronics"])
        assert.deepEqual(findings(p, plat), [], plat);
    assert.ok(!/END_IF;_/.test(genFor(p, "unitronics")["Machine.st"]));
});
test("forenz: neplatné označení zařízení — validace chyba, dokumentace a HMI nespadnou", () => {
    setLang("cs");
    registerHmiModule();
    const p = sampleSmall();
    p.devices[0].name = "M 1";
    syncIO(p);
    assert.ok(errors(p).length > 0);
    docFiles(p); // výjimka = pád testu
});
test("forenz: zařízení bez opt (import / AI) — seznam alarmů a HMI nespadnou", () => {
    setLang("cs");
    const p = load11();
    for (const d of p.devices)
        delete d.opt;
    docAlarmCsv(p); // výjimka = pád testu
    buildHmi(p); // výjimka = pád testu
});
test("forenz: reverse import OOP bez kroků se zpětným hlášením — sekvence i role DO zůstanou", () => {
    setLang("cs");
    const p = sampleSmall();
    p.codeStyle = "oop";
    p.program.seq = p.program.seq.filter(s => s.act === "wait");
    if (!p.program.seq.length)
        p.program.seq = [{ dev: 0, act: "wait", cond: "time", timeS: 2 }];
    const ex = extractFiles(Object.entries(genFor(p, "codesys")).map(([name, text]) => ({ name, text })));
    const q = inferProject(ex).prj;
    assert.equal(q.program.seq.length, p.program.seq.length);
});
test("forenz: reverse import projektu jen s analogy (CODESYS) — GVL a PLCopen bez konfliktu adres", () => {
    setLang("cs");
    const p = sampleSmall();
    p.devices = p.devices.filter(d => d.cls === "AnalogIn");
    p.program.seq = [];
    syncIO(p);
    const files = genFor(p, "codesys");
    const r = inferProject(extractFiles(Object.entries(files).map(([name, text]) => ({ name, text }))));
    assert.deepEqual(r.conflicts, []);
    /* %IW32 v CODESYS = slovo 32 = kanonicky %IW64 */
    for (const m of files["GVL_IO.st"].matchAll(/(\w+) AT %IW(\d+)/g))
        assert.equal(r.prj.io.find(e => e.tag === m[1])?.addr, "%IW" + (+m[2] * 2), m[1]);
});
test("forenz (desktop): M1 a P1 → stejné označení -Q1 / -K1 — validace varování, kusovník s jedinečnými ID", () => {
    setLang("cs");
    const p = sampleSmall();
    const m = p.devices.find(d => d.cls === "Motor");
    p.devices.push({ ...structuredClone(m), id: Math.max(...p.devices.map(d => d.id)) + 1, name: "P" + m.name.replace(/^\D+/, ""), guid: undefined });
    syncIO(p);
    assert.ok(validateProject(p).some(x => x.level === "warn" && /stejné označení -Q/.test(x.msg)));
    const ids = buildBom(p).lines.map(l => l.id);
    assert.equal(new Set(ids).size, ids.length, "ID řádků kusovníku jedinečná");
});
test("forenz (desktop): duplicitní označení zařízení — validace chyba, plán oživení nespadne", () => {
    setLang("cs");
    const p = sampleSmall();
    const m = p.devices.find(d => d.cls === "Motor");
    p.devices.push({ ...structuredClone(m), id: Math.max(...p.devices.map(d => d.id)) + 1, guid: undefined });
    syncIO(p);
    assert.ok(errors(p).some(x => /Duplicitní označení/.test(x)));
    const ids = commissioningPlan(p).map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
});
test("forenz: měnič a polohovací pohon se stejným číslem → stejné -TA (výkresy, EPLAN) = chyba", () => {
    setLang("cs");
    const p = load11();
    assert.ok(!errors(p).some(x => /stejné označení -TA/.test(x)));
    const vfd = p.devices.find(d => d.cls === "Vfd"), pos = p.devices.find(d => d.cls === "PosDrive");
    pos.name = "X" + vfd.name.replace(/^\D+/, "");
    syncIO(p);
    assert.ok(errors(p).some(x => /stejné označení -TA/.test(x)));
});
/* ---- test odolnosti webu (2026-10-08): XSS přes apostrof / neescapované atributy, obří rampa, duplicitní jména */
test("odolnost: escHtml escapuje apostrof (atributy v apostrofech webu), esc / xmlEsc beze změny (exporty)", async () => {
    const { esc, xmlEsc, escHtml } = await import("./model.js");
    assert.equal(escHtml(`a' onfocus='x"<>&`), "a&#39; onfocus=&#39;x&quot;&lt;&gt;&amp;");
    assert.equal(esc("a'b"), "a'b");
    assert.equal(xmlEsc("a'b"), "a'b");
});
test("odolnost: časový diagram — dev čekacího kroku escapovaný, schémata bez surového HTML z dat", async () => {
    setLang("cs");
    const p = sampleSmall();
    p.program.seq.push({ dev: '"><img src=x onerror=alert(1)>', act: "wait", cond: "time", timeS: 1 });
    const files = docFiles(p);
    for (const [n, body] of Object.entries(files))
        if (typeof body === "string" && /\.(svg|html)$/.test(n))
            assert.doesNotMatch(body, /<img src=x/, n);
});
test("odolnost: rampa nad 3600 s = chyba validace (simulace by zamrzla)", () => {
    setLang("cs");
    const p = load11();
    const v = p.devices.find(d => d.cls === "Vfd");
    v.rampS = 1e9;
    assert.ok(errors(p).some(x => /3600 s/.test(x)));
    v.rampS = 3600;
    assert.ok(!errors(p).some(x => /3600 s/.test(x)));
});
test("odolnost: dvě nečinná zařízení se stejným označením — schválení a dokumentace nespadnou", async () => {
    setLang("cs");
    const { approvalItems } = await import("./approval.js");
    const p = sampleSmall();
    const di = p.devices.find(d => d.cls === "DI");
    const id = Math.max(...p.devices.map(d => d.id));
    p.devices.push({ ...structuredClone(di), id: id + 1, name: "S9", guid: undefined }, { ...structuredClone(di), id: id + 2, name: "S9", guid: undefined });
    syncIO(p);
    assert.ok(errors(p).some(x => /Duplicitní označení/.test(x)));
    const keys = approvalItems(p).map(i => i.key);
    assert.equal(new Set(keys).size, keys.length);
    docFiles(p); // výjimka = pád testu
});
/* ================================================================ odolnost desktop (test odolnosti 2026-10-08)
   Nálezy forenzního testu desktopu (apps/site/_shots/robust_desk/ZPRAVA.md) — většina platí i pro web
   (stejné jádro): A jednořádková pole s \n / \t / řídicími znaky, B meze REAL, C čas pod 0,01 s,
   D adresy, E zamrzlé ověření, F poškozený soubor projektu (normalizeProject). */
/** Konec řádku, tabulátor, BEL a VT; „ZZQ“ = značka textu za koncem řádku (nesmí začít nový řádek výstupu). */
const POISON = "A\nZZQ\tC\u0007D\u000bE\r\nF";
const S12 = new URL("../../../samples/12_portalovy_manipulator_PM-12.plcstudio.json", import.meta.url);
function loadUrl(u) {
    const raw = JSON.parse(readFileSync(u, "utf8"));
    const prj = Object.assign(blankProject(), raw.prj || raw);
    syncIO(prj);
    return prj;
}
function poisoned(p) {
    p.meta.name = "Linka" + POISON;
    p.meta.customer = "ACME" + POISON;
    p.meta.desc = "Popis" + POISON;
    for (const d of p.devices) {
        d.desc = "Popis " + d.name + POISON;
        if (d.unit)
            d.unit = "bar" + POISON;
        if (d.axis)
            d.axis.drive = "S210" + POISON;
        for (const r of d.records || [])
            r.name = "Zaznam" + POISON;
    }
    syncIO(p);
    for (const e of p.io)
        e.cmt = "Cmt " + e.tag + POISON;
    return p;
}
const BAD_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/;
/** Počet buněk řádku CSV / TSV s uvozovkami; -1 = neuzavřená uvozovka. */
function cells(line, sep) {
    let n = 1, q = false;
    for (const ch of line) {
        if (ch === '"')
            q = !q;
        else if (ch === sep && !q)
            n++;
    }
    return q ? -1 : n;
}
test("odolnost desktop A: \\n, \\t a řídicí znaky v textech — kód 20 platforem, XML, CSV / TSV, DXF, dokumentace, HMI", async () => {
    setLang("cs");
    registerHmiModule();
    const { PLAT, modules, normalizeProject } = await import("./index.js");
    const { sheetDXF } = await import("./drawing.js");
    const { eplanAml } = await import("./eplan.js");
    const { hmiFiles } = await import("./hmi_export.js");
    const { xmlProblem } = await import("./exp_util.test.js");
    const { emulateRun } = await import("./emu/index.js");
    for (const [name, base] of [["small", sampleSmall()], ["11", load11()], ["12", loadUrl(S12)]]) {
        const p = poisoned(base);
        assert.deepEqual(errors(p), [], name + ": řídicí znaky v textech nejsou chyba návrhu");
        assert.ok(validateProject(p).some(i => i.level === "warn" && /konec řádku, tabulátor/.test(i.msg)), name + ": varování");
        for (const plat of Object.keys(PLAT)) {
            const files = genFor(p, plat);
            for (const [fn, body] of Object.entries(files)) {
                assert.ok(!/[\x07\x0B]/.test(body), `${name}/${plat}/${fn}: BEL / VT ve výstupu`);
                assert.ok(!/^\s*ZZQ/m.test(body), `${name}/${plat}/${fn}: konec řádku z textu rozdělil řádek výstupu`);
                if (/\.(xml|l5x|tcpou|tcgvl|tcio)$/i.test(fn)) {
                    assert.ok(!BAD_XML.test(body), `${name}/${plat}/${fn}: znak, který XML nepovoluje`);
                    /* přísná kontrola sekce CDATA nezná (L5X): obsah CDATA nahradit prázdnou sekcí */
                    assert.equal(xmlProblem(body.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")), "", `${name}/${plat}/${fn}`);
                }
                if (/\.(csv|tsv)$/i.test(fn) || fn === "Variables.txt") {
                    const sep = /\.tsv$|Variables\.txt$/.test(fn) ? "\t" : /GlobalLabels|Tags\.csv/.test(fn) ? "," : ";";
                    const rows = body.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim() && !/^remark,/.test(l) && l !== "0.3");
                    const counts = new Set(rows.map(l => cells(l, sep)));
                    assert.ok(!counts.has(-1) && counts.size === 1, `${name}/${plat}/${fn}: počty sloupců ${[...counts]}`);
                }
            }
            const f = findings(p, plat).filter(x => !/servoosu nepodporuje/.test(x.msg));
            assert.deepEqual(f.map(x => x.msg), [], `${name}/${plat}: emulace překladu`);
        }
        for (const m of modules(p)) {
            const L = sheetDXF(p, m, 1).split(/\r?\n/);
            for (let i = 0; i + 1 < L.length; i += 2)
                assert.match(L[i], /^\s*-?\d+$/, `${name}: DXF kód skupiny na řádku ${i + 1}`);
        }
        for (const f of docFiles(p))
            if (/\.(svg|xml|aml|ssm)$/i.test(f.path))
                assert.ok(!BAD_XML.test(f.body), `${name}: ${f.path}`);
        assert.equal(xmlProblem(eplanAml(p)), "", name + ": EPLAN AML");
        assert.ok(!BAD_XML.test(eplanAml(p)), name + ": EPLAN AML řídicí znaky");
        buildHmi(p);
        for (const plat of ["siemens", "rockwell", "codesys", "mitsubishi", "omron"])
            for (const [fn, body] of Object.entries(hmiFiles(p, plat)))
                if (/\.xml$/i.test(fn))
                    assert.ok(!BAD_XML.test(body), `${name}: HMI ${plat}/${fn}`);
        /* jádro při načtení jednořádková pole vyčistí (web i desktop) — výstup pak beze změny proti outputSafe */
        const n = normalizeProject(JSON.parse(JSON.stringify(p)));
        assert.ok(!/[\n\t\x07]/.test(n.meta.name + n.meta.customer + n.devices.map(d => d.desc + d.unit).join("") + n.io.map(e => e.cmt).join("")), name + ": normalizeProject");
        assert.match(n.meta.desc, /\n/, name + ": popis projektu zůstává víceřádkový");
        assert.ok(!validateProject(n).some(i => /konec řádku, tabulátor/.test(i.msg)), name + ": po normalizaci bez varování");
    }
    /* emulace běhu (rychlé scénáře) nad otráveným projektem: kód = návrh */
    const p = poisoned(sampleSmall());
    for (const plat of ["siemens", "codesys", "mitsubishi", "omron", "unitronics", "rockwell"]) {
        const r = emulateRun(p, plat, { scope: "quick" });
        assert.ok(r.ok, `${plat}: ${r.skipped || ""} ${r.diffs.slice(0, 2).map(d => d.msg).join(" | ")}`);
    }
});
test("odolnost desktop A: víceřádkový popis blokovacího vstupu — HMI a dokumentace nespadnou (alarmy nezávisí na tvaru popisu)", () => {
    setLang("cs");
    registerHmiModule();
    const p = sampleSmall();
    const lock = p.devices.find(d => (p.program.interlocks || []).includes(d.id)) || p.devices.find(d => d.cls === "DI" && d.id !== p.program.estop);
    if (!(p.program.interlocks || []).includes(lock.id))
        p.program.interlocks = [...(p.program.interlocks || []), lock.id];
    lock.desc = "levy\nkryt;\nB;C\r\nD";
    const h = buildHmi(p);
    const a = h.alarms.find(x => x.codes.includes("A_" + lock.name + "_OPEN"));
    assert.ok(a, "alarm blokování");
    assert.ok(!/[\r\n]/.test(a.cause), "text alarmu jednořádkově");
    docFiles(p); // výjimka = pád testu
    const csv = docAlarmCsv(p).split("\n");
    assert.ok(csv.every(l => !/^\s*(kryt|B;C|D)/.test(l)), "seznam alarmů: řádek = alarm");
});
test("odolnost desktop B: hodnoty mimo REAL (|x| > 3,4E38) a rozsah, který REAL nerozliší = chyba; emulátor literál hlásí", async () => {
    setLang("cs");
    const { setDeviceRange } = await import("./edit.js");
    const p = sampleSmall();
    const a = p.devices.find(d => d.cls === "AnalogIn");
    a.rmax = 1e39;
    assert.ok(errors(p).some(m => /mimo rozsah REAL/.test(m)));
    assert.ok(findings(p, "codesys").some(f => /mimo rozsah typu REAL/.test(f.msg)), "emulátor CODESYS");
    assert.ok(findings(p, "siemens").some(f => /mimo rozsah typu REAL/.test(f.msg)), "emulátor Siemens");
    a.rmin = 0;
    a.rmax = 1e-300;
    assert.ok(errors(p).some(m => /v REAL nulový/.test(m)));
    a.rmax = 100;
    a.limHi = -1e300;
    assert.ok(errors(p).some(m => /mimo rozsah REAL/.test(m)));
    delete a.limHi;
    assert.deepEqual(errors(p), []);
    assert.equal(setDeviceRange(p, a.id, { rmin: 0, rmax: 1e39 }).ok, false);
});
test("odolnost desktop C: čas kroku 0 < t < 0,01 s = chyba (kód by zapsal T#0S), čas mimo celé ms = varování", async () => {
    setLang("cs");
    const { stepProblem } = await import("./edit.js");
    const p = sampleSmall();
    p.program.seq[0].timeS = 0.0001;
    assert.ok(errors(p).some(m => /kratší než 0,01 s/.test(m)));
    p.program.seq[0].timeS = 0.01;
    assert.ok(!errors(p).some(m => /kratší než 0,01 s/.test(m)));
    p.program.seq[0].timeS = 0.0155;
    assert.ok(validateProject(p).some(i => i.level === "warn" && /celý počet milisekund/.test(i.msg)));
    assert.match(stepProblem(p, { dev: 0, act: "wait", cond: "time", timeS: 0.005 }) || "", /0,01 s/);
    assert.equal(stepProblem(p, { dev: 0, act: "wait", cond: "time", timeS: 0.01 }), null);
});
test("odolnost desktop D: adresy — kanonický tvar (%Q00.1), obsazenost, adresní prostor", async () => {
    setLang("cs");
    const { setIoAddr } = await import("./edit.js");
    const { canonIoAddr } = await import("./model.js");
    assert.equal(canonIoAddr("%Q00.1"), "%Q0.1");
    assert.equal(canonIoAddr("%iw064"), "%IW64");
    assert.equal(canonIoAddr("%Q0.8"), "%Q0.8"); // neplatný bit: beze změny (validace)
    const p = sampleSmall();
    const dos = p.io.filter(e => e.dir === "DO");
    const taken = dos[0].addr, m = /^%Q(\d+)\.(\d)$/.exec(taken);
    const r1 = setIoAddr(p, dos[1].key, "%Q0" + m[1] + "." + m[2]);
    assert.equal(r1.ok, false, "úvodní nula obešla kontrolu obsazenosti");
    const r2 = setIoAddr(p, dos[1].key, "%Q099.3");
    assert.equal(r2.ok, true);
    assert.equal(r2.value, "%Q99.3");
    assert.equal(setIoAddr(p, dos[1].key, "%Q99999.7").ok, false);
    const ai = p.io.find(e => e.dir === "AI");
    assert.equal(setIoAddr(p, ai.key, "%IW99999").ok, false);
    dos[1].addr = "%Q5000.1";
    assert.ok(validateProject(p).some(i => i.level === "warn" && /obraz procesu CPU Siemens/.test(i.msg)));
    dos[1].addr = "%Q70000.1";
    assert.ok(errors(p).some(x => /adresní prostor/.test(x)));
    dos[1].addr = "%Q0" + m[1] + "." + m[2]; // uloženo ze starší verze: duplicita na kanonickém tvaru
    assert.ok(validateProject(p).some(i => i.level === "error" && /Duplicitní adresa/.test(i.msg)));
});
test("odolnost desktop E: krok 1e9 s — ověření, dokumentace a emulace běhu neběží (neověřeno), nezamrznou", async () => {
    setLang("cs");
    const { verifyProject, simBlockers } = await import("./sim.js");
    const { emulateRun } = await import("./emu/index.js");
    const { allProjectFiles } = await import("./docs.js");
    const p = sampleSmall();
    p.program.seq[0].timeS = 1e9;
    assert.ok(simBlockers(p).length);
    const t0 = Date.now();
    const v = verifyProject(p);
    assert.equal(v.ok, false);
    assert.match(v.checks[0].title, /Neověřeno/);
    docFiles(p);
    allProjectFiles(p);
    const { simulate, simScenarios } = await import("./sim.js");
    const { svgFlow } = await import("./flow.js");
    svgFlow(p, simulate(p)); // funkční diagram kroku Schéma (desktop most „schema“)
    simScenarios(p);
    const r = emulateRun(p, "codesys", { scope: "quick" });
    assert.equal(r.ok, false);
    assert.match(r.skipped || "", /oprav chyby návrhu/);
    assert.ok(Date.now() - t0 < 20000, "ověření s chybným zadáním nesmí běžet dlouho");
    /* totéž pro rampu, dobu jízdy a model stroje */
    const q = load11();
    q.devices.find(d => d.cls === "PosDrive").travelS = 1e9;
    assert.ok(simBlockers(q).length && errors(q).some(m => /Doba jízdy/.test(m)));
    const s = sampleSmall();
    s.sim = { motorDelay: 1e9 };
    assert.ok(simBlockers(s).length && errors(s).some(m => /modelu stroje/.test(m)));
});
test("odolnost desktop F: normalizeProject — poškozené typy zahodí po položkách, projekt zůstane použitelný", async () => {
    setLang("cs");
    const { normalizeProject } = await import("./project_norm.js");
    const { axisCfgOf } = await import("./axis.js");
    const good = loadUrl(S12);
    const raw = JSON.parse(JSON.stringify(good));
    const di = raw.devices.find((d) => d.cls === "DI");
    raw.program.estop = [di.id];
    raw.program.interlocks = [{ a: 1 }, di.id, "x"];
    raw.io[0].devId = [raw.io[0].devId];
    raw.program.seq[1].dev = [raw.program.seq[1].dev];
    raw.platforms = ["siemens", ["codesys"], "toString", "codesys"];
    const ax = raw.devices.find((d) => d.cls === "Axis");
    ax.axis = "osa";
    raw.devices.push({ id: "x", cls: "Motor" }, { id: 999, cls: "Nic" }, "text", { id: 1000, cls: "DO", role: ["run"], name: "H9", desc: 5 });
    raw.devices.push({ id: 1001, cls: "PosDrive", name: "P9", records: "1 = a", axis: { positions: "a @ 1" } });
    const n = normalizeProject(raw);
    assert.equal(n.program.estop, "");
    assert.deepEqual(n.program.interlocks, [di.id]);
    assert.equal(n.io.length, good.io.length - 1);
    assert.equal(n.program.seq.length, good.program.seq.length - 1);
    assert.deepEqual(n.platforms, ["siemens", "codesys"]);
    assert.equal(n.devices.find(d => d.cls === "Axis").axis, undefined);
    assert.equal(n.devices.length, good.devices.length + 2);
    const h9 = n.devices.find(d => d.name === "H9");
    assert.equal(h9.role, undefined);
    assert.equal(h9.desc, "");
    const p9 = n.devices.find(d => d.name === "P9");
    assert.equal(p9.records, undefined);
    assert.deepEqual(axisCfgOf({ axis: "osa" }).positions, []);
    assert.deepEqual(axisCfgOf({ axis: { positions: "a @ 1" } }).positions, []);
    syncIO(n);
    validateProject(n);
    for (const plat of ["siemens", "codesys"])
        genFor(n, plat);
    docFiles(n);
    assert.throws(() => normalizeProject([1, 2]), /not a project/);
    assert.throws(() => normalizeProject({ name: "package.json" }), /not a project/);
    normalizeProject({ meta: 5 }); // výjimka = pád testu
});
test("odolnost desktop F: rezervovaná jména Windows ve složkách a souborech, hlášení zahozených záznamů a poloh", async () => {
    const { folderSafe, fileSafe, notReserved } = await import("./project_meta.js");
    const { parseRecordsChecked } = await import("./model.js");
    const { parseAxisPositionsChecked } = await import("./axis.js");
    assert.equal(folderSafe("NUL"), "NUL_");
    assert.equal(folderSafe("com1"), "com1_");
    assert.equal(fileSafe("CON.txt"), "CON_.txt");
    assert.equal(notReserved("Linka"), "Linka");
    const r = parseRecordsChecked("1 = a @ 0; xx; 2 = b; 1 = c");
    assert.deepEqual(r.records.map(x => x.no), [1, 2]);
    assert.deepEqual(r.bad, ["xx"]);
    assert.deepEqual(r.dup, [1]);
    const a = parseAxisPositionsChecked("A @ 1; B; A @ 2");
    assert.deepEqual(a.positions, [{ name: "A", pos: 1 }]);
    assert.deepEqual(a.bad, ["B"]);
    assert.deepEqual(a.dup, ["A"]);
});
test("odolnost desktop F: revize s poškozeným zmrazeným obsahem — dokumentace nespadne", async () => {
    setLang("cs");
    const { allProjectFiles } = await import("./docs.js");
    await import("./revision.js"); // přihlásí dokument změn a hlavičku revize
    const p = sampleSmall();
    p.revisions = [{ id: "A", date: "x", by: "me", hash: "h", snapshot: "not json", approvalsAt: {}, note: "" }];
    docFiles(p); // výjimka = pád testu
    allProjectFiles(p);
});
/* ======================================================================================
 * forenz2: forenzní test jádra, kolo 2 (2026-10-10) — nálezy N1–N13 (apps/site/_shots/forenz2/core/ZPRAVA.md)
 * ====================================================================================== */
test("forenz2 N1: ověření s odhadem výpočtu nad limitem neběží (neověřeno), validace to řekne, E-stop čekání blokuje", async () => {
    setLang("cs");
    const { verifyProject, simBlockers, verifyCost, VERIFY_MAX_COST_S } = await import("./sim.js");
    const { emulateRun } = await import("./emu/index.js");
    const p = sampleSmall();
    assert.ok(verifyCost(p).seconds < 5 && !simBlockers(p).length);
    for (const s of p.program.seq)
        if (s.cond === "fbk")
            s.timeS = 80000; // hlídací časy 22 h: zamrzlé hlášení čeká celý čas
    assert.ok(verifyCost(p).seconds > VERIFY_MAX_COST_S);
    assert.ok(simBlockers(p).some(b => /odhad výpočtu ověření/.test(b)));
    assert.ok(validateProject(p).some(i => i.level === "warn" && /Ověření simulací by trvalo/.test(i.msg)));
    const t0 = Date.now();
    const v = verifyProject(p);
    assert.equal(v.ok, false);
    assert.match(v.checks[0].title, /Neověřeno/);
    assert.match(emulateRun(p, "codesys", { scope: "quick" }).skipped || "", /oprav chyby návrhu/);
    assert.ok(Date.now() - t0 < 5000);
    /* čekání na vstup E-stopu = událost za scan (OOM u dlouhých kroků) → neověřovat */
    const q = sampleSmall();
    q.program.seq.push({ dev: q.program.estop, act: "waitOn", cond: "fbk", timeS: 5 });
    assert.ok(simBlockers(q).some(b => /E-stopu/.test(b)));
});
test("forenz2 N1: kontrolní body ověření sdílejí záznam se zdrojem (paměť) a navazují z dřívějšího bodu", async () => {
    const { Checkpoints, simulate } = await import("./sim.js");
    const p = sampleSmall();
    const cps = new Checkpoints(p);
    const late = cps.at(6), early = cps.at(2); // zpět v čase: naváže z bodu ≤ 2 s (tady od začátku)
    const again = cps.at(4); // dopředu z bodu 2 s
    for (const [cp, t] of [[late, 6], [early, 2], [again, 4]]) {
        const opts = { faults: [{ kind: "estop", at: t, release: t + 1 }], maxTime: t + 2 };
        const strip = (r) => JSON.stringify([r.frames.map(f => [f.t, f.step, f.io]), r.events, r.steps]);
        assert.equal(strip(simulate(p, opts, cp)), strip(simulate(p, opts)), "t = " + t);
    }
});
test("forenz2 N2: tag = klíčové slovo / standardní blok / operand / jméno generované proměnné = chyba, setIoTag odmítne", () => {
    setLang("cs");
    const base = sampleSmall();
    base.platforms = ["siemens", "mitsubishi", "omron"]; // vyhrazená slova a operandy platforem jen pro platformy projektu
    const key = base.io.find(e => e.dir === "DI").key;
    for (const t of ["END_IF", "MOD", "TON", "R_TRIG", "reset", "seqStep", "SEQSTEP", "enable", "modeAuto", "cmdAck", "instM1", "instM1_outRun",
        "MAIN", "GVL_IO", "FB_Motor", "seqRun_M1", "manRun_M1", "tonSeq10", "M1", "Y1", "D100", "P_First"]) {
        const p = JSON.parse(JSON.stringify(base));
        const r = setIoTag(p, key, t);
        assert.equal(r.ok, false, t);
        p.io.find(e => e.key === key).tag = t;
        assert.ok(validateProject(p).some(i => i.level === "error" && i.where === t), t);
    }
    /* běžná jména dál projdou */
    for (const t of ["S1_start", "Q", "PT", "rawMax", "Status", "value"]) {
        const p = JSON.parse(JSON.stringify(base));
        assert.equal(setIoTag(p, key, t).ok, true, t);
        assert.ok(!validateProject(p).some(i => i.level === "error" && i.where === t), t);
    }
    /* „S1“, „B1“ (import TIA) jsou bez Mitsubishi v projektu v pořádku */
    const sie = JSON.parse(JSON.stringify(base));
    sie.platforms = ["siemens"];
    assert.equal(setIoTag(sie, key, "S1").ok, true);
    assert.equal(setIoTag(sie, key, "reset").ok, true);
    assert.equal(setIoTag(sie, key, "END_CASE").ok, false);
    /* kód s kolizí se nepřeloží — validace ji proto musí hlásit (Omron: generovaný seqStep i tag) */
    const p = JSON.parse(JSON.stringify(base));
    p.io.find(e => e.key === key).tag = "seqStep";
    assert.ok(findings(p, "omron").length > 0);
    /* označení zařízení, z něhož by vzniklo jméno, které už má tag */
    const q = JSON.parse(JSON.stringify(base));
    q.io.find(e => e.key === key).tag = "instX9";
    const m1 = q.devices.find(d => d.name === "M1");
    assert.equal(renameDevice(q, m1.id, "X9").ok, false);
    assert.equal(renameDevice(q, m1.id, "X8").ok, true);
});
test("forenz2 N3: proporcionální ventil bez rampy (rampS = 0) — matice odchylku vyzkouší a poruchu najde", async () => {
    setLang("cs");
    const { verifyProject } = await import("./sim.js");
    const p = blankProject();
    p.platforms = ["codesys"];
    const es = addDevice(p, { cls: "DI", desc: "E-stop" }).id;
    p.program.estop = es;
    const m = addDevice(p, { cls: "Motor" }).id;
    const y = addDevice(p, { cls: "PropValve", ...devDefaults("PropValve"), rampS: 0 }).id;
    insertStep(p, -1, { dev: m, act: "start", cond: "fbk", timeS: 5 });
    insertStep(p, 0, { dev: y, act: "setPressure", cond: "fbk", timeS: 10, sp: 5 });
    insertStep(p, 1, { dev: 0, act: "wait", cond: "time", timeS: 3 });
    insertStep(p, 2, { dev: y, act: "setPressure", cond: "fbk", timeS: 10, sp: 0 });
    insertStep(p, 3, { dev: m, act: "stop", cond: "fbk", timeS: 5 });
    const v = verifyProject(p);
    const dev = v.matrix.rows.map(r => r.cells.dev).filter(c => c && c.ok !== null);
    assert.ok(dev.length >= 2, "odchylka se zkouší v krocích ventilu");
    assert.ok(dev.every(c => c.ok === true), dev.map(c => c.detail).join(" | "));
    assert.equal(v.ok, true);
});
test("forenz2 N4: krok nesmí čekat na vstup E-stopu (stepProblem, validace)", () => {
    setLang("cs");
    const p = sampleSmall();
    const es = p.program.estop;
    assert.match(stepProblem(p, { dev: es, act: "waitOn", cond: "fbk", timeS: 5 }) || "", /E-stopu/);
    assert.equal(insertStep(p, 0, { dev: es, act: "waitOff", cond: "fbk", timeS: 5 }).ok, false);
    p.program.seq.push({ dev: es, act: "waitOn", cond: "fbk", timeS: 5 });
    assert.ok(errors(p).some(m => /čeká na vstup E-stopu/.test(m)));
});
test("forenz2 N5: E-stop / blokování na zařízení jiné třídy = chyba validace, generátor (i OOP) nespadne", () => {
    setLang("cs");
    const p = load11();
    const pd = p.devices.find(d => d.cls === "PosDrive");
    p.program.estop = pd.id;
    assert.ok(errors(p).some(m => /musí být digitální vstup/.test(m)));
    genFor(p, "codesys");
    genFor({ ...p, codeStyle: "oop" }, "codesys"); // výjimka = pád testu (dřív TypeError v seqMembers)
    const q = load11();
    q.program.interlocks = [q.devices.find(d => d.cls === "Vfd").id];
    assert.ok(errors(q).some(m => /Blokovací vstup .* musí být digitální vstup/.test(m)));
});
test("forenz2 N6: akce, která nepatří třídě — AI návrh ji vynechá s hlášením, validace = chyba", () => {
    setLang("cs");
    const p = blankProject();
    const r = applyAiProposal(p, {
        devices: [{ name: "M1", cls: "Motor" }, { name: "B1", cls: "AnalogIn" }, { name: "S1", cls: "DI" }],
        estop: "S1",
        seq: [{ dev: "M1", act: "start", timeS: 3 }, { dev: "B1", act: "start", timeS: 3 }, { dev: "M1", act: "open", timeS: 3 },
            { dev: "S1", act: "waitOn", timeS: 3 }, { dev: "X7", act: "start", timeS: 3 }],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(p.program.seq.map(s => s.act), ["start"]);
    assert.equal(r.dropped.length, 4);
    assert.ok(r.dropped.some(m => /neplatí pro zařízení B1/.test(m)) && r.dropped.some(m => /E-stopu S1/.test(m)) && r.dropped.some(m => /X7/.test(m)));
    p.program.seq.push({ dev: p.devices.find(d => d.name === "B1").id, act: "start", cond: "fbk", timeS: 3 });
    assert.ok(errors(p).some(m => /Akce „start“ neplatí pro zařízení B1/.test(m)));
});
test("forenz2 N7: šablona knihovny se syntaktickou chybou — chyba a vestavěný blok na všech platformách", async () => {
    setLang("cs");
    const { blankLibrary, attachLibrary, builtinTemplate, validateFbTemplate } = await import("./library.js");
    const st = builtinTemplate("Motor", "st");
    for (const bad of [st.replace(/END_FUNCTION_BLOCK/, "(* neuzavreny komentar\nEND_FUNCTION_BLOCK"),
        st.replace(/END_VAR\n/, "END_VAR\n    i : INT;\n")]) {
        const t = { id: "Acme_bad", cls: "Motor", dialect: "st", source: bad };
        assert.ok(validateFbTemplate(t).some(i => i.level === "error" && /Syntaktická chyba/.test(i.msg)));
        const p = sampleSmall();
        p.platforms = ["codesys", "beckhoff", "mitsubishi", "omron", "unitronics"];
        const lib = blankLibrary("ACME");
        lib.fbTemplates = [t];
        attachLibrary(p, lib, false);
        for (const plat of p.platforms)
            assert.deepEqual(findings(p, plat), [], plat);
    }
    assert.ok(!validateFbTemplate({ id: "ok", cls: "Motor", dialect: "st", source: st }).some(i => i.level === "error"));
});
test("forenz2 N8: meze analogu mimo měřicí rozsah = chyba (úprava parametrů, rozsahu i validace)", () => {
    setLang("cs");
    const p = sampleSmall();
    const b1 = p.devices.find(d => d.name === "B1"); // 0–250 bar
    assert.match(deviceParamsProblem(b1, { limLo: 300 }) || "", /měřicím rozsahu/);
    assert.equal(setDeviceParams(p, b1.id, { limLo: 10, limHi: 200 }).ok, true);
    assert.equal(setDeviceRange(p, b1.id, { rmin: 0, rmax: 5 }).ok, false);
    b1.rmax = 5;
    assert.ok(errors(p).some(m => /měřicím rozsahu/.test(m)));
});
test("forenz2 N9: jediný pohon proporcionální ventil / polohovací pohon — ruční režim × E-stop bez falešného ✖", async () => {
    setLang("cs");
    const { verifyProject } = await import("./sim.js");
    for (const [cls, step] of [["PropValve", { act: "setPressure", sp: 50 }], ["PosDrive", { act: "home" }]]) {
        const p = blankProject();
        p.platforms = ["codesys"];
        const es = addDevice(p, { cls: "DI", desc: "E-stop" }).id;
        p.program.estop = es;
        const id = addDevice(p, { cls }).id;
        assert.equal(insertStep(p, -1, { dev: id, cond: "fbk", timeS: 10, ...step }).ok, true);
        const row = verifyProject(p).matrix.rows.find(r => r.step === -2);
        assert.equal(row.cells.estop.ok, true, cls + ": " + row.cells.estop.detail);
    }
});
test("forenz2 N11: import dlouhého jména POU je lineární", () => {
    const t0 = Date.now();
    inferProject(extractFiles([{ name: "b.scl", text: "FUNCTION_BLOCK " + "A".repeat(100000) }]));
    inferProject(extractFiles([{ name: "b.st", text: "PROGRAM " + "A".repeat(100000) }]));
    assert.ok(Date.now() - t0 < 3000, "dřív 29 s");
});
test("forenz2 N12: osa na platformě, která ji negeneruje — export HMI se nevyrábí", async () => {
    const { hmiFiles } = await import("./hmi_export.js");
    const p = blankProject();
    p.platforms = ["mitsubishi", "schneider", "codesys"];
    const ax = addDevice(p, { cls: "Axis" }).id;
    insertStep(p, -1, { dev: ax, act: "home", cond: "fbk", timeS: 10 });
    assert.deepEqual(hmiFiles(p, "mitsubishi"), {});
    assert.deepEqual(hmiFiles(p, "schneider"), {});
    assert.ok(Object.keys(hmiFiles(p, "codesys")).length > 0);
});
test("forenz2 N13: krok — jen pole, která akce používá; updateStep bez akce = částečná změna", () => {
    setLang("cs");
    const p = load11();
    const vfd = p.devices.find(d => d.cls === "Vfd");
    insertStep(p, -1, { dev: 0, act: "wait", cond: "time", timeS: 1, vel: NaN, sp: Infinity, rec: 3 });
    assert.deepEqual(p.program.seq[0], { dev: 0, act: "wait", cond: "time", timeS: 1 });
    insertStep(p, -1, { dev: vfd.id, act: "stop", cond: "fbk", timeS: 1, sp: 20, rev: true, pos: 3 });
    assert.deepEqual(p.program.seq[0], { dev: vfd.id, act: "stop", cond: "fbk", timeS: 1 });
    insertStep(p, -1, { dev: vfd.id, act: "start", cond: "fbk", timeS: 5, sp: 20, rec: 4 });
    assert.deepEqual(p.program.seq[0], { dev: vfd.id, act: "start", cond: "fbk", timeS: 5, sp: 20 });
    assert.equal(updateStep(p, 0, { timeS: 7 }).ok, true); // jen čas: akce a žádaná zůstanou
    assert.deepEqual(p.program.seq[0], { dev: vfd.id, act: "start", cond: "fbk", timeS: 7, sp: 20 });
    const pv0 = p.devices.find(d => d.cls === "PropValve");
    const r = updateStep(p, 0, { dev: pv0.id }); // start neplatí pro ventil — srozumitelná chyba
    assert.equal(r.ok, false);
    assert.match(r.error || "", /neplatí/);
});
