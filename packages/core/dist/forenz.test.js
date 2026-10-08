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
