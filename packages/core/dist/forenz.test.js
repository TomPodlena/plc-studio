/**
 * Regrese z forenzního fuzzu jádra (2026-10-06): náhodné projekty mimo 18 příkladů našly místa, kde
 * validace pustila projekt, jehož kód se nepřeloží / rozejde s návrhem, a pády dokumentace a importu.
 * Každý test = minimální reprodukce jednoho nálezu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankProject, syncIO, validateProject } from "./model.js";
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
